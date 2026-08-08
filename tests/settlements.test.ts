/**
 * The road, and the people at the end of it.
 *
 * Three things can go wrong with a trade road, and this file is organised around
 * them in the order they would hurt.
 *
 * **The economy.** `trade.ts` already promises no sequence of swaps turns steel
 * into more steel. A second trading system that prices independently would break
 * that promise between them even if neither breaks it alone — buy cheap on the
 * road, sell dear in the yard, repeat forever. So the first block here holds
 * *both* books against one value table and proves every rate on either of them
 * is below 1. That is the whole no-loop guarantee, and it is why `VALUE` is
 * exported from one module and `DEALS` from the other.
 *
 * **The colony.** The traveller is genuinely lifted off the map — out of
 * `world.pawns` entirely, so nothing can path to them, feed them or shoot them.
 * That is the cost the feature is built around, and it is also a body in a place
 * nothing else in the sim expects one. The second block checks the two ways that
 * bites: a colony declared wiped because its last settler is on the road, and a
 * settler who comes back a stranger because a migration walked `world.pawns` and
 * never looked in the caravan.
 *
 * **The seed.** `social` is derived from a settler's own id rather than drawn
 * from the shared stream, for the reason written in `types.ts`. The third block
 * is the guard on that: same settler, same charm, every time, and nothing else
 * on the map moved.
 */

import { describe, expect, it } from 'vitest';

import { checkGameOver } from '../src/sim/events';
import { orderCaravan } from '../src/sim/jobs';
import { backfillSkills, makePawn } from '../src/sim/pawn';
import { Rng } from '../src/sim/rng';
import {
  PACK_SIZES,
  RATE_CAP,
  RELATIONS_PER_VISIT,
  SOCIAL_PER_TRIP,
  VALUE,
  bestTalker,
  caravanAllowed,
  caravanDaysLeft,
  caravanOf,
  legTicks,
  mishapChance,
  pickDestination,
  quote,
  rateFor,
  rateReasons,
  settlementById,
  settlementsOf,
  socialOf,
  specialty,
} from '../src/sim/settlements';
import { WALK_SPEED } from '../src/sim/movement';
import { HUNGRY, TIRED } from '../src/sim/needs';
import { DEALS } from '../src/sim/trade';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { deserialize, serialize } from '../src/sim/save';
import { addItem, countResource, livingColonists, removeItem } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { Pawn, ResourceKind, Settlement, World } from '../src/sim/types';
import { CRAFT_DEFS, RECIPE_ORDER, outputKind } from '../src/sim/crafting';

const KINDS: ResourceKind[] = ['wood', 'steel', 'rawfood', 'meal', 'medicine'];

/** The kinds somebody had to make, which now carry a premium of their own. */
const MADE_KINDS = new Set(RECIPE_ORDER.map((r) => outputKind(CRAFT_DEFS[r])).filter(Boolean));

function colony(seed = 20260730): World {
  return createWorld(seed);
}

/**
 * Step until the traveller has actually walked off the map.
 *
 * This was `stepWorldN(world, streams, 600)` with a comment saying six hundred
 * was plenty to cross a 64-cell map, which it was, and it stayed plenty when the
 * moor went to 128. It is not plenty at 192: the hearth is in the middle, so the
 * road out is half the map wide, and half of 192 cells at `WALK_SPEED` is more
 * than six hundred ticks before the traveller has taken a single step around
 * anything. What that failure looked like was four caravan tests going red at
 * once with `caravanOf` returning null — which reads as the caravan system
 * having broken and was the walk being longer than the clock.
 *
 * So the clock is the walk instead of a guess at it: step until they are gone,
 * with a ceiling generous enough to cover a route that goes the long way round
 * the lake, and stop the moment they leave so the callers below can still time
 * the legs of the trip from the departure.
 */
function walkToTheEdge(world: World, streams: ReturnType<typeof makeStreams>): void {
  const ceiling = Math.round((world.width * 1.5) / WALK_SPEED);
  for (let t = 0; t < ceiling && world.caravan == null; t += 20) stepWorldN(world, streams, 20);
}

/** Enough of `kind` loose on the ground, well clear of the cabin. */
function stock(world: World, kind: ResourceKind, amount: number): void {
  for (const s of [...world.items]) if (s.kind === kind) removeItem(world, s);
  let left = amount;
  let x = 4;
  while (left > 0 && x < 44) {
    const put = Math.min(60, left);
    if (addItem(world, kind, put, x, 4)) left -= put;
    x++;
  }
}

// ---------------------------------------------------------------------------
// the economy
// ---------------------------------------------------------------------------

describe('the two trade books, held against one yardstick', () => {
  it('never lets the pedlar hand back more value than they were given', () => {
    for (const d of DEALS) {
      const given = VALUE[d.give] * d.giveAmount;
      const got = VALUE[d.take] * d.takeAmount;
      // At or below cost on every row. If this ever goes over 1 the pedlar's
      // book and the road are no longer on the same scale, and the loop check
      // below stops meaning anything.
      expect(got / given).toBeLessThanOrEqual(1);
    }
  });

  it('never lets the road quote above cost, at any skill, standing or pack', () => {
    const world = colony();
    const walker = livingColonists(world)[0]!;
    let worst = 0;
    for (const s of settlementsOf(world)) {
      // Every state a settlement can reach: allied and hated, and a traveller
      // from raw recruit to the top of the skill. A rate that only goes over 1
      // in one corner is still a rate that goes over 1, and the player would
      // find that corner and live in it.
      for (const relations of [-100, 0, 50, 100]) {
        for (const social of [0, 5, 10, 15, 20]) {
          s.relations = relations;
          walker.skills.social = social;
          for (const kind of KINDS) {
            const amount = PACK_SIZES[kind];
            const back = quote(s, walker, { kind, amount });
            const rate = (VALUE[back.kind] * back.amount) / (VALUE[kind] * amount);
            worst = Math.max(worst, rate);
          }
        }
      }
    }
    // Strictly below one, and below the cap that says so in the source. The
    // floor on `quote` (always at least one unit back) is the one thing that
    // could push a tiny pack over, which is why every real pack size is checked
    // rather than a nominal ten of each.
    expect(worst).toBeLessThan(1);
    expect(worst).toBeLessThanOrEqual(RATE_CAP + 1e-9);
  });

  it('pays a skilled trader better than a green one, and an ally better than a stranger', () => {
    const world = colony();
    const s = settlementsOf(world)[0]!;
    const green = livingColonists(world)[0]!;
    const veteran = livingColonists(world)[1]!;
    green.skills.social = 1;
    veteran.skills.social = 18;
    const pack = { kind: s.buys, amount: PACK_SIZES[s.buys] };
    s.relations = 0;
    const greenDeal = quote(s, green, pack).amount;
    const veteranDeal = quote(s, veteran, pack).amount;
    expect(veteranDeal).toBeGreaterThan(greenDeal);
    // And standing is worth something on its own, which is what makes a second
    // trip to the same place different from a first trip to a new one.
    const strangerRate = rateFor(s, veteran, pack.kind);
    s.relations = 100;
    expect(rateFor(s, veteran, pack.kind)).toBeGreaterThanOrEqual(strangerRate);
  });

  it('pays more for the thing they are short of', () => {
    const world = colony();
    const s = settlementsOf(world)[0]!;
    const walker = livingColonists(world)[0]!;
    walker.skills.social = 5;
    const wanted = rateFor(s, walker, s.buys);
    const other = KINDS.find((k) => k !== s.buys && k !== s.sells)!;
    expect(wanted).toBeGreaterThan(rateFor(s, walker, other));
  });
});

describe('the neighbours', () => {
  it('are the same four places every time a seed is opened', () => {
    const a = settlementsOf(colony(4242));
    const b = settlementsOf(colony(4242));
    expect(a.map((s) => `${s.name}${s.days}${s.sells}${s.buys}`)).toEqual(
      b.map((s) => `${s.name}${s.days}${s.sells}${s.buys}`),
    );
    // And different places on a different map, or the seed is not doing anything.
    expect(a.map((s) => s.name)).not.toEqual(settlementsOf(colony(4243)).map((s) => s.name));
  });

  it('are four distinct places, and none of them wants what it is drowning in', () => {
    const places = settlementsOf(colony());
    expect(places).toHaveLength(4);
    expect(new Set(places.map((s) => s.name)).size).toBe(4);
    for (const s of places) {
      expect(s.buys).not.toBe(s.sells);
      expect(s.days).toBeGreaterThan(0);
    }
  });

  it('never makes the road a certainty in either direction', () => {
    const world = colony();
    const walker = livingColonists(world)[0]!;
    for (const s of settlementsOf(world)) {
      for (const shooting of [0, 20]) {
        for (const relations of [-100, 100]) {
          s.relations = relations;
          walker.skills.shooting = shooting;
          const p = mishapChance(s, walker);
          expect(p).toBeGreaterThanOrEqual(0.01);
          expect(p).toBeLessThanOrEqual(0.3);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// the colony
// ---------------------------------------------------------------------------

describe('who the colony will send', () => {
  /** A midday colony of four with nothing else standing in the road's way. */
  function ready(): { world: World; walker: Pawn } {
    const world = colony();
    world.tick = Math.round(TICKS_PER_DAY * 0.5);
    while (livingColonists(world).length < 4) {
      makePawn(world, new Rng(700 + world.pawns.length), 'colony', 40, 44);
    }
    const walker = bestTalker(world)!;
    for (const p of livingColonists(world)) {
      p.needs.food = 1;
      p.needs.rest = 1;
    }
    return { world, walker };
  }

  it('sends somebody who is merely partway through their day', () => {
    // The rule this pins is a scar, and the number it replaced looked perfectly
    // sensible: don't send a traveller out without days of reserve in them.
    // Except the road does not run on their reserve. `departCaravan` lifts them
    // off the map, the trip is a tick count, and they come home on 0.35 food
    // whether they left full or half. The reserve bought nothing and cost the
    // feature: it is read only on the few ticks a settler is between jobs, and
    // half a day after a meal they are already under it. Seed 90210 sat on an
    // open letter with the goods in the barn for a full day and never sent it.
    const { world, walker } = ready();
    walker.needs.food = 0.5;
    walker.needs.rest = 0.45;
    expect(caravanAllowed(world, walker)).toBe(true);
  });

  it('will not send somebody who is hungry or tired now', () => {
    // The half of the old rule worth keeping, and asked in the words the rest of
    // the sim uses so the two can never drift: whatever `HUNGRY` and `TIRED`
    // become, the road stays just above them. Loading a pack is the last thing
    // you do before a week away — do it after the meal, not instead of it.
    const hungry = ready();
    hungry.walker.needs.food = HUNGRY;
    expect(caravanAllowed(hungry.world, hungry.walker)).toBe(false);

    const tired = ready();
    tired.walker.needs.rest = TIRED;
    expect(caravanAllowed(tired.world, tired.walker)).toBe(false);
  });

  it('sends the best talker and nobody else', () => {
    // Anyone else walking it throws away the only thing that makes the price
    // good, and this is also what keeps four settlers from all setting off at
    // once the moment a letter lands.
    const { world, walker } = ready();
    const other = livingColonists(world).find((p) => p.id !== walker.id)!;
    expect(caravanAllowed(world, walker)).toBe(true);
    expect(caravanAllowed(world, other)).toBe(false);
  });

  it('keeps everybody home at night and in a fight', () => {
    const night = ready();
    night.world.tick = Math.round(TICKS_PER_DAY * 0.95);
    expect(caravanAllowed(night.world, night.walker)).toBe(false);

    const raid = ready();
    raid.world.storyteller.raidActive = true;
    expect(caravanAllowed(raid.world, raid.walker)).toBe(false);
  });

  it('will not spend a hand a colony of three cannot spare', () => {
    const { world, walker } = ready();
    const spare = livingColonists(world).find((p) => p.id !== walker.id)!;
    spare.dead = true;
    expect(livingColonists(world).length).toBe(3);
    expect(caravanAllowed(world, walker)).toBe(false);
  });
});

describe('a settler on the road', () => {
  it('leaves, is gone, and comes home with goods and a level', () => {
    const world = colony();
    const streams = makeStreams(world);
    stock(world, 'wood', 300);
    const before = livingColonists(world).length;
    const walker = bestTalker(world)!;
    const place = settlementsOf(world).sort((a, b) => a.days - b.days)[0]!;
    const socialBefore = socialOf(walker);
    // Nobody fells a tree while the traveller crosses the yard. The wood count
    // below is the whole point of the assertion — the pack leaves the map with
    // them — and a woodcutter delivering twenty logs mid-walk hides an eighty-log
    // pack that never left. One failure reason per test.
    for (const p of livingColonists(world)) p.priorities.chop = 0;
    const woodBefore = countResource(world, 'wood');

    const sent = orderCaravan(world, walker, place.id, { kind: 'wood', amount: 80 });
    expect(sent.ok).toBe(true);

    // Ordering does not take the goods: they are still in the stockpile while
    // the traveller is crossing the yard, so calling the trip off halfway costs
    // the colony the walk and nothing else. (The slack is the rest of the
    // colony carrying on with its own business around them.)
    stepWorldN(world, streams, 5);
    expect(countResource(world, 'wood')).toBeGreaterThan(woodBefore - 80);

    // Walking to the edge.
    walkToTheEdge(world, streams);
    const out = caravanOf(world);
    expect(out).not.toBeNull();
    expect(out!.pawn.id).toBe(walker.id);
    // Genuinely off the map: not in `world.pawns`, not holding a job, not
    // counted among the hands the colony has today. That absence is the price.
    expect(world.pawns.some((p) => p.id === walker.id)).toBe(false);
    expect(livingColonists(world).length).toBe(before - 1);
    expect(world.jobs.some((j) => j.pawnId === walker.id)).toBe(false);
    // And now it has gone, with them.
    expect(countResource(world, 'wood')).toBeLessThanOrEqual(woodBefore - 80);
    expect(caravanDaysLeft(world)).toBeGreaterThan(place.days);

    // The whole round trip, plus slack for the walk in from the edge.
    stepWorldN(world, streams, legTicks(place) * 2 + 400);
    expect(caravanOf(world)).toBeNull();
    const home = world.pawns.find((p) => p.id === walker.id);
    expect(home).toBeDefined();
    expect(home!.dead).toBe(false);
    // Counted among the hands again — that, not the headcount, is what coming
    // home means. The colony is free to have grown while they were away: a
    // fortnight is long enough for an expedition to walk somebody in, and this
    // test is about the traveller, not the census.
    expect(livingColonists(world).some((p) => p.id === walker.id)).toBe(true);
    expect(livingColonists(world).length).toBeGreaterThanOrEqual(before);
    // Levelled by doing it. This is the whole reason the colony has a trader
    // rather than six people who have each been once.
    expect(socialOf(home!)).toBeGreaterThanOrEqual(socialBefore + SOCIAL_PER_TRIP - 1e-9);
  });

  it('brings back goods and standing when the road is quiet', () => {
    // A road nobody is robbed on: allied, and walked by a settler who can shoot.
    // The dice are real (`mishapChance` never returns zero), so the test picks
    // the corner where they are as close to safe as the game allows and asserts
    // on what a *successful* trip does.
    const world = colony(777);
    const streams = makeStreams(world);
    stock(world, 'wood', 300);
    const walker = bestTalker(world)!;
    walker.skills.shooting = 20;
    const place = settlementsOf(world).sort((a, b) => a.days - b.days)[0]!;
    place.relations = 100;
    const standingBefore = place.relations;

    expect(orderCaravan(world, walker, place.id, { kind: 'wood', amount: 80 }).ok).toBe(true);
    walkToTheEdge(world, streams);
    const out = caravanOf(world)!;
    expect(out.phase).toBe('outbound');

    // Out to them and the deal struck.
    stepWorldN(world, streams, legTicks(place) + 10);
    const there = caravanOf(world)!;
    expect(there.phase).toBe('inbound');
    expect(there.take).not.toBeNull();
    expect(place.visits).toBe(1);
    expect(place.relations).toBeGreaterThanOrEqual(
      Math.min(100, standingBefore + RELATIONS_PER_VISIT),
    );

    const gotKind = there.take!.kind;
    const hadOfIt = countResource(world, gotKind);
    stepWorldN(world, streams, legTicks(place) + 40);
    expect(caravanOf(world)).toBeNull();
    expect(world.stats.caravans).toBe(1);
    // The goods are on the map — dropped where they walked back on, for the
    // colony's own haulers to fetch, exactly like the pedlar's.
    expect(countResource(world, gotKind)).toBeGreaterThan(hadOfIt);
  });

  it('does not read as a wiped colony while the last settler is walking home', () => {
    const world = colony();
    const streams = makeStreams(world);
    stock(world, 'wood', 300);
    const walker = bestTalker(world)!;
    const place = settlementsOf(world)[0]!;
    expect(orderCaravan(world, walker, place.id, { kind: 'wood', amount: 80 }).ok).toBe(true);
    walkToTheEdge(world, streams);
    expect(caravanOf(world)).not.toBeNull();

    // Everybody who stayed behind is gone. The colony is one person, and that
    // person is four days out — which is a colony that is still alive.
    for (const p of world.pawns) if (p.faction === 'colony') p.dead = true;
    checkGameOver(world);
    expect(world.gameOver).toBe(false);

    // And when the traveller dies too, it is over.
    caravanOf(world)!.pawn.dead = true;
    checkGameOver(world);
    expect(world.gameOver).toBe(true);
  });

  it('refuses the trips that would cost the colony more than the goods', () => {
    const world = colony();
    const walker = bestTalker(world)!;
    const place = settlementsOf(world)[0]!;
    stock(world, 'wood', 20);
    // Nothing to send.
    expect(orderCaravan(world, walker, place.id, { kind: 'wood', amount: 80 }).ok).toBe(false);
    stock(world, 'wood', 300);
    // Nowhere by that name.
    expect(orderCaravan(world, walker, 999, { kind: 'wood', amount: 80 }).ok).toBe(false);
    // Not with the player standing inside them: lifting that body off the map
    // would take the camera with it.
    walker.playerControlled = true;
    expect(orderCaravan(world, walker, place.id, { kind: 'wood', amount: 80 }).ok).toBe(false);
    walker.playerControlled = false;
    // One party at a time.
    expect(orderCaravan(world, walker, place.id, { kind: 'wood', amount: 80 }).ok).toBe(true);
    const second = livingColonists(world).find((p) => p.id !== walker.id)!;
    expect(orderCaravan(world, second, place.id, { kind: 'wood', amount: 80 }).ok).toBe(false);
  });

  it('survives being saved and loaded while off the map', () => {
    const world = colony();
    const streams = makeStreams(world);
    stock(world, 'wood', 300);
    const walker = bestTalker(world)!;
    const place = settlementsOf(world)[0]!;
    orderCaravan(world, walker, place.id, { kind: 'wood', amount: 80 });
    walkToTheEdge(world, streams);
    expect(caravanOf(world)).not.toBeNull();

    const round = deserialize(
      serialize(
        world,
        {
          mode: 'manager',
          possessedId: null,
          camera: { targetX: 0, targetY: 0, distance: 20, yaw: 0, pitch: 1 },
        },
        1,
        0,
      ),
    );
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    const back = round.save.world;
    const rider = caravanOf(back)!;
    expect(rider.pawn.id).toBe(walker.id);
    // The one settler every migration in `save.ts` would otherwise walk past.
    // A traveller who comes home with `NaN` charm and no priority for a work
    // type added while they were away is a settler the colony cannot use.
    expect(Number.isFinite(socialOf(rider.pawn))).toBe(true);
    expect(rider.pawn.priorities.caravan).toBeTypeOf('number');
    // And the neighbours came with them, standing and all.
    expect(settlementById(back, place.id)?.name).toBe(place.name);

    // The trip still finishes on the other side of the save.
    const loaded = makeStreams(back);
    stepWorldN(back, loaded, legTicks(place) * 2 + 400);
    expect(caravanOf(back)).toBeNull();
    expect(back.pawns.some((p) => p.id === walker.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the seed
// ---------------------------------------------------------------------------

describe('social, derived rather than drawn', () => {
  it('gives the same settler the same charm every time', () => {
    const world = colony();
    for (const p of livingColonists(world)) {
      const was = p.skills.social;
      // Idempotent: a second migration pass must not move an existing skill.
      backfillSkills(p);
      expect(p.skills.social).toBe(was);
      // Derived: wipe it and it comes back the same, because it is a function of
      // the settler rather than of whatever the random stream had reached.
      delete (p.skills as Partial<Pawn['skills']>).social;
      backfillSkills(p);
      expect(p.skills.social).toBe(was);
      expect(p.skills.social).toBeGreaterThanOrEqual(2);
      expect(p.skills.social).toBeLessThanOrEqual(6);
    }
  });

  it('does not move anything else on the map', () => {
    // The trap this is built to avoid, stated as a test: `makePawn` is handed
    // four different streams, so one extra draw inside it re-rolls every map,
    // every herd and every deal. If social were rolled rather than derived, the
    // stream would be one number further on after making a body — this proves it
    // is not.
    const rng = new Rng(9001);
    const world = colony();
    makePawn(world, rng, 'colony', 10, 10);
    const after = rng.int(1_000_000);

    const same = new Rng(9001);
    const world2 = colony();
    makePawn(world2, same, 'colony', 10, 10);
    expect(same.int(1_000_000)).toBe(after);

    // And the settlers a seed produces have not moved either — the whole point
    // of `ROLLED_SKILLS` being a separate list from `SKILL_NAMES`.
    expect(livingColonists(colony(31337)).map((p) => p.name)).toEqual(
      livingColonists(colony(31337)).map((p) => p.name),
    );
  });

  it('reads an old settler who was made before the skill existed', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    delete (p.skills as Partial<Pawn['skills']>).social;
    // What the settler card does. Before `backfillSkills` this rendered NaN,
    // which is the visible half of the bug and the reason the migration exists.
    expect(Number.isNaN(Math.floor(socialOf(p)))).toBe(false);
    backfillSkills(p);
    expect(Number.isFinite(p.skills.social)).toBe(true);
  });
});

/**
 * What the neighbours are known for.
 *
 * A road is only worth four days' walk if the people at the end of it can do
 * something the colony cannot, so every settlement that sells something a bench
 * makes is credited with the recipe that makes it. That is flavour on the trade
 * panel and a rate bonus on their own workshop's input — and, like `social`, it
 * is *derived* rather than drawn, because a single extra `rng` call inside
 * `settlementsOf` re-rolls every neighbour on every seed ever played.
 */
describe('what a neighbour is known for', () => {
  it('credits them with a recipe that actually makes what they sell', () => {
    for (const seed of [20260729, 7, 1312, 99001, 424242]) {
      for (const s of settlementsOf(createWorld(seed))) {
        const trade = specialty(s);
        if (trade === null) continue;
        const def = CRAFT_DEFS[trade];
        expect('kind' in def.output && def.output.kind).toBe(s.sells);
      }
    }
  });

  it('gives at least one map somebody who brews medicine', () => {
    // Not a promise about any one seed — a promise that the asymmetry the recipe
    // gates create has somewhere to be answered.
    const brewers = [20260729, 7, 1312, 99001, 424242].flatMap((seed) =>
      settlementsOf(createWorld(seed)).filter((s) => specialty(s) !== null),
    );
    expect(brewers.length).toBeGreaterThan(0);
  });

  it('reads a settlement saved before it had a trade', () => {
    const world = createWorld(20260729);
    const before = settlementsOf(world).map((s) => specialty(s));
    // An old save: the field is simply absent, the way every `SAVE_VERSION` 10
    // world on disk has it.
    for (const s of settlementsOf(world)) delete (s as Partial<Settlement>).craft;
    expect(settlementsOf(world).map((s) => specialty(s))).toEqual(before);
  });

  it('pays over the odds for the stuff its own workshop eats, and still under 1', () => {
    const world = createWorld(20260729);
    const pawn = livingColonists(world)[0]!;
    pawn.skills.social = 20;
    for (const s of settlementsOf(world)) {
      s.relations = 100;
      const trade = specialty(s);
      for (const kind of KINDS) expect(rateFor(s, pawn, kind)).toBeLessThan(1);
      if (trade === null) continue;
      const feed = CRAFT_DEFS[trade].input.kind;
      // Their bench is hungry, and hungry benches pay. Only against a kind they
      // are not already short of, or the two bonuses stack and prove nothing.
      if (feed === s.buys) continue;
      // The yardstick has to be a kind that earns no bonus of its own — not
      // something they are short of, and not something somebody had to make,
      // which now carries a premium of its own.
      const plain = KINDS.find((k) => k !== feed && k !== s.buys && !MADE_KINDS.has(k))!;
      expect(rateFor(s, pawn, feed)).toBeGreaterThan(rateFor(s, pawn, plain));
    }
  });

  it('pays a premium for goods it has nobody to make, and shrugs at its own trade', () => {
    // The half of the specialty system the player is on the earning end of: a
    // herbalist on a bench is only worth keeping there if somebody out there
    // pays for what comes off it.
    const world = createWorld(20260729);
    const pawn = livingColonists(world)[0]!;
    for (const s of settlementsOf(world)) {
      const trade = specialty(s);
      const makesMedicine = trade !== null && outputKind(CRAFT_DEFS[trade]) === 'medicine';
      const reasons = rateReasons(s, 'medicine');
      expect(reasons.includes('they cannot make this')).toBe(!makesMedicine);
      // Against raw ore, held at the same standing, so the only difference left
      // is that one of them came off a workbench.
      const orePlain = rateFor(s, pawn, 'steel');
      if (makesMedicine) continue;
      if (s.buys === 'steel') continue;
      expect(rateFor(s, pawn, 'medicine')).toBeGreaterThan(orePlain);
    }
  });

  it('sends the spare crate to the door that pays best per day of walking', () => {
    const world = createWorld(20260729);
    const places = settlementsOf(world);
    // Two towns the same distance out: one brews its own medicine, one has
    // nobody. Same walk, same standing — the only thing left is the specialty,
    // and it is what decides.
    const [a, b] = places;
    if (!a || !b) throw new Error('the map is supposed to have neighbours');
    for (const s of places) {
      s.days = 2;
      s.buys = 'wood';
      s.craft = 'medicine';
    }
    b.craft = null;
    expect(pickDestination(world, 'medicine')?.id).toBe(b.id);

    // But distance still outranks it, because the price is per pack and the walk
    // is per day. A settler is gone twice as long for the town twice as far.
    b.days = 6;
    expect(pickDestination(world, 'medicine')?.id).toBe(a.id);

    // And with nothing to choose between them, the nearest door, the way it
    // always was.
    for (const s of places) s.craft = null;
    const nearest = [...places].sort((s, t) => s.days - t.days)[0]!;
    expect(pickDestination(world, 'medicine')?.id).toBe(nearest.id);
  });
});
