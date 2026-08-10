/**
 * Three rings, and the road that has to be earned to reach the outer two.
 *
 * The world used to be four places at one to three days' walk, all of them open
 * from the first morning. It is twelve now, in three rings, and the two outer
 * rings are shut behind three things at once: somebody one ring in has to vouch
 * for you, the pantry has to hold the meals the road eats, and enough settlers
 * have to stay behind to hold the valley while the party is gone.
 *
 * That is a gate, and a gate is exactly the kind of thing that quietly stops
 * gating. So this file is organised around the two ways it fails.
 *
 * **It opens too early.** A colony on its first morning must not be able to walk
 * a ten-day road — not with a full pantry, not with a big crew, not by asking
 * for the far place by id and skipping the panel. Each of the three conditions
 * is checked alone, with the other two satisfied, because a gate that only holds
 * when all three happen to be unmet is a gate held up by luck.
 *
 * **It never opens.** The other half of the promise. A colony that trades its
 * way outward has to get there, so the last block plays a colony forward with
 * the standing and the stores it would have earned and watches ring one, then
 * ring two, come open in order.
 *
 * And underneath both: the no-arbitrage guarantee was written when there were
 * four places and it does not get to be relaxed for eight more. Every rate at
 * every one of the twelve, at every standing a settler can reach, stays under
 * the cap — that block is first, because it is the one that must never bend.
 */

import { describe, expect, it } from 'vitest';

import {
  PACK_CEILING,
  PACK_SIZES,
  PASSAGE_RELATIONS,
  RATE_CAP,
  RELATIONS_MAX,
  RELATIONS_PER_VISIT,
  VALUE,
  caravanOf,
  packLimit,
  packMultiple,
  pickDestination,
  planCaravan,
  quote,
  rateOf,
  ringOf,
  ringOpen,
  settlementById,
  settlementsOf,
  withinRange,
} from '../src/sim/settlements';
import { COMMISSION_EVERY, commissionOf, tickCommissions } from '../src/sim/commissions';
import { addItem, livingColonists, removeItem } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { makePawn } from '../src/sim/pawn';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { createWorld } from '../src/sim/worldgen';
import { deserialize, serialize } from '../src/sim/save';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { ResourceKind, Settlement, World } from '../src/sim/types';

const KINDS: ResourceKind[] = ['wood', 'steel', 'rawfood', 'meal', 'medicine'];

function colony(seed = 20260805): World {
  return createWorld(seed);
}

/** Enough of `kind` loose on the ground, well clear of the cabin. */
function stock(world: World, kind: ResourceKind, amount: number): void {
  for (const s of [...world.items]) if (s.kind === kind) removeItem(world, s);
  let left = amount;
  let x = 4;
  while (left > 0 && x < 60) {
    const put = Math.min(60, left);
    if (addItem(world, kind, put, x, 4)) left -= put;
    x++;
  }
}

/**
 * A couple of packs of everything anybody is short of.
 *
 * By kind rather than by settlement, because twelve places share five goods
 * between them and `stock` clears what is already down before it lays more —
 * done per settlement, the last one to want steel would be the only one the
 * colony could help.
 */
function stockWhatTheyBuy(world: World, packs = 2.5): void {
  const want = new Map<ResourceKind, number>();
  for (const s of settlementsOf(world)) {
    want.set(s.buys, Math.max(want.get(s.buys) ?? 0, Math.round(PACK_SIZES[s.buys] * packs)));
  }
  for (const [kind, amount] of want) stock(world, kind, amount);
}

/** Standing at every place in a ring, as a colony that has walked it would have. */
function vouch(world: World, ring: number, relations: number): void {
  for (const s of settlementsOf(world)) if (ringOf(s) === ring) s.relations = relations;
}

/** The colony's own people, minus enough that only `left` remain at home. */
function keepAtHome(world: World, left: number): void {
  const living = livingColonists(world);
  for (const p of living.slice(left)) p.dead = true;
}

/** The colony as it would be some weeks on, with migrants taken in. */
function grownTo(world: World, headcount: number): void {
  const rng = new Rng(world.seed ^ 0x1234);
  let x = 10;
  while (livingColonists(world).length < headcount) {
    makePawn(world, rng, 'colony', x, 10, { name: `Settler ${x}` });
    x++;
  }
}

const inRing = (world: World, ring: number): Settlement[] =>
  settlementsOf(world).filter((s) => ringOf(s) === ring);

/** One pack: what the near ring carries, which is the size the economy was built on. */
const onePack = (world: World): number => packLimit(inRing(world, 0)[0]!);

/** The view/speed a save carries alongside the world. Irrelevant here. */
const VIEW = {
  mode: 'manager' as const,
  possessedId: null,
  camera: { targetX: 0, targetY: 0, distance: 20, yaw: 0, pitch: 1 },
};

// ---------------------------------------------------------------------------
// the guarantee that does not bend
// ---------------------------------------------------------------------------

describe('twelve places, one value table', () => {
  it('never quotes a rate at or above the cap, anywhere, at any standing', () => {
    // Every place, every good, and the whole span of a settler's charm — the
    // rate is the entire no-arbitrage guarantee, so eight new places get held
    // to it at the extremes rather than at the one standing a run happens to
    // reach. A rate of 1 would mean a round trip that ends richer than it
    // started, and two of those in a row is an infinite money press.
    for (let seed = 1; seed <= 6; seed++) {
      const world = colony(seed * 977);
      for (const s of settlementsOf(world)) {
        for (const social of [0, 0.5, 1]) {
          for (const kind of KINDS) {
            const rate = rateOf(s, social, kind);
            expect(rate).toBeLessThan(1);
            expect(rate).toBeLessThanOrEqual(RATE_CAP);
          }
        }
      }
    }
  });

  it('sends the biggest pack out and back at a loss, at every place', () => {
    // The far ring carries four packs at once, and the multiplier is the one
    // thing stage one added that touches the size of a trade. This is the check
    // that it is a lever on *distance* and not on the exchange rate: walk the
    // largest load any road allows into a place at the best standing anybody
    // can hold, take what they offer, and it is worth less than what was
    // handed over. Two of those in a row would be a money press.
    const world = colony();
    const walker = livingColonists(world).find((p) => !p.playerControlled)!;
    for (const s of settlementsOf(world)) {
      s.relations = RELATIONS_MAX;
      for (const kind of KINDS) {
        const give = { kind, amount: packLimit(s) };
        const got = quote(s, walker, give);
        expect(VALUE[got.kind] * got.amount).toBeLessThan(VALUE[kind] * give.amount);
      }
    }
  });

  it('sets the pack by the ring and leaves the near ring where it was', () => {
    // The near ring's pack is the number the whole economy was balanced on. It
    // does not move because eight places were built past it.
    const world = colony();
    const one = onePack(world);
    for (const s of settlementsOf(world)) {
      expect(packLimit(s)).toBe(one * packMultiple(s));
      if (ringOf(s) === 0) expect(packMultiple(s)).toBe(1);
      expect(packLimit(s)).toBeLessThanOrEqual(PACK_CEILING);
    }
  });
});

// ---------------------------------------------------------------------------
// the shape of the world
// ---------------------------------------------------------------------------

describe('the three rings', () => {
  it('lays out twelve places, four to a ring, further out each time', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const world = colony(seed * 4241);
      const all = settlementsOf(world);
      expect(all).toHaveLength(12);
      for (let ring = 0; ring < 3; ring++) expect(inRing(world, ring)).toHaveLength(4);

      // Rings are distances, not labels: nobody in a ring is closer than
      // anybody in the ring inside it. If this ever crossed over, "the far
      // ring" would stop meaning "the long road" and the gate would be
      // charging a price for nothing.
      const near = Math.max(...inRing(world, 0).map((s) => s.days));
      const mid = inRing(world, 1).map((s) => s.days);
      const far = inRing(world, 2).map((s) => s.days);
      expect(Math.min(...mid)).toBeGreaterThan(near);
      expect(Math.min(...far)).toBeGreaterThan(Math.max(...mid));
    }
  });

  it('gives every place its own name', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const names = new Set(settlementsOf(colony(seed * 8117)).map((s) => s.name));
      expect(names.size).toBe(12);
    }
  });

  it('is the same twelve places for the same seed', () => {
    const a = settlementsOf(colony(4242)).map((s) => `${s.name}/${s.days}/${s.sells}/${s.ring}`);
    const b = settlementsOf(colony(4242)).map((s) => `${s.name}/${s.days}/${s.sells}/${s.ring}`);
    expect(b).toEqual(a);
  });

  it('reads a ring off the distance for a place saved before rings existed', () => {
    // Old saves carry settlements with no `ring` at all. The migration is not
    // allowed to answer `undefined` and let the gate fall open, so `ringOf`
    // derives one from the distance and writes it back.
    const world = colony();
    const s = settlementsOf(world)[0]!;
    delete s.ring;
    s.days = 9;
    expect(ringOf(s)).toBe(2);
    expect(s.ring).toBe(2);
  });

  it('keeps the near places a save already knew, and builds the rest around them', () => {
    // A colony saved when the world was four places wide reloads into a world
    // of twelve. The four it knew have to survive with their standing intact —
    // they are places the player has a history with — and the eight new ones
    // fill in around them.
    const world = colony(31337);
    const old = settlementsOf(world).slice(0, 4).map((s) => ({ ...s, relations: 40, visits: 5 }));
    world.settlements = old.map((s) => ({ ...s }));

    const rebuilt = settlementsOf(world);
    expect(rebuilt).toHaveLength(12);
    for (let i = 0; i < 4; i++) {
      expect(rebuilt[i]!.name).toBe(old[i]!.name);
      expect(rebuilt[i]!.relations).toBe(40);
      expect(rebuilt[i]!.visits).toBe(5);
    }
    expect(new Set(rebuilt.map((s) => s.id)).size).toBe(12);
  });

  it('survives a save and a load with its rings on', () => {
    const world = colony(5150);
    vouch(world, 0, 30);
    const res = deserialize(serialize(world, VIEW, 1, 0));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const back = res.save.world;
    expect(settlementsOf(back)).toHaveLength(12);
    expect(settlementsOf(back).map((s) => ringOf(s))).toEqual(
      settlementsOf(world).map((s) => ringOf(s)),
    );
  });
});

// ---------------------------------------------------------------------------
// the gate: it must not open early
// ---------------------------------------------------------------------------

describe('the road out is shut at the start', () => {
  it('lets a new colony walk to the near ring and nowhere else', () => {
    const world = colony();
    stock(world, 'meal', 400);
    for (const s of inRing(world, 0)) expect(withinRange(world, s).ok).toBe(true);
    for (const ring of [1, 2]) {
      for (const s of inRing(world, ring)) expect(withinRange(world, s).ok).toBe(false);
      expect(ringOpen(world, ring)).toBe(false);
    }
  });

  it('refuses the middle ring for want of a voucher, with everything else in hand', () => {
    // Stores and settlers both fine; only the standing is missing. The refusal
    // has to name the standing, because a player told "not enough meals" would
    // go and cook, and cooking would not help.
    const world = colony();
    stock(world, 'meal', 400);
    const s = inRing(world, 1)[0]!;
    const reach = withinRange(world, s);
    expect(reach.ok).toBe(false);
    if (!reach.ok) expect(reach.text).toMatch(/vouch/i);
  });

  it('refuses the middle ring for want of provisions, with the standing already earned', () => {
    const world = colony();
    vouch(world, 0, RELATIONS_MAX);
    stock(world, 'meal', 4);
    const s = inRing(world, 1)[0]!;
    const reach = withinRange(world, s);
    expect(reach.ok).toBe(false);
    if (!reach.ok) expect(reach.text).toMatch(/meals/i);
  });

  it('refuses the middle ring for want of somebody to hold the valley', () => {
    const world = colony();
    vouch(world, 0, RELATIONS_MAX);
    stock(world, 'meal', 400);
    keepAtHome(world, 2);
    const s = inRing(world, 1)[0]!;
    const reach = withinRange(world, s);
    expect(reach.ok).toBe(false);
    if (!reach.ok) expect(reach.text).toMatch(/holding the valley/i);
  });

  it('asks the far ring for a colony that has grown since the founding', () => {
    // The founding three can just walk the middle ring. They cannot walk the
    // far one — twenty days away is the trip the colony has to have grown into,
    // and this is the check that the two rings ask different questions.
    const world = colony();
    vouch(world, 0, RELATIONS_MAX);
    vouch(world, 1, RELATIONS_MAX);
    stock(world, 'meal', 900);
    expect(livingColonists(world)).toHaveLength(3);
    expect(ringOpen(world, 1)).toBe(true);
    const far = inRing(world, 2)[0]!;
    const reach = withinRange(world, far);
    expect(reach.ok).toBe(false);
    if (!reach.ok) expect(reach.text).toMatch(/holding the valley/i);
  });

  it('will not let standing in the near ring open the far one', () => {
    // The rings unlock in order. Being on excellent terms with everybody one
    // day out says nothing about a road ten days long, and if it did, the
    // middle ring would be scenery.
    const world = colony();
    vouch(world, 0, RELATIONS_MAX);
    stock(world, 'meal', 900);
    expect(ringOpen(world, 1)).toBe(true);
    expect(ringOpen(world, 2)).toBe(false);
  });

  it('turns away a party ordered straight at a locked place', () => {
    // The panel hides what it cannot reach, so this is the check that the rule
    // lives under the panel rather than in it.
    const world = colony();
    stock(world, 'steel', 400);
    stock(world, 'meal', 400);
    const walker = livingColonists(world).find((p) => !p.playerControlled)!;
    const far = inRing(world, 2)[0]!;
    const plan = planCaravan(world, walker, far.id, { kind: 'steel', amount: 40 });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.text).toMatch(/vouch/i);
  });

  it('never sends the foreman anywhere it cannot reach', () => {
    // `pickDestination` scores by worth over distance, and the far ring carries
    // four packs — which is exactly the arithmetic that would make it the
    // highest-scoring choice on day one if reachability were not checked first.
    const world = colony();
    stock(world, 'meal', 900);
    for (const kind of KINDS) {
      const dest = pickDestination(world, kind, onePack(world));
      if (dest) expect(ringOf(dest)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// the gate: it must open
// ---------------------------------------------------------------------------

describe('the road out opens to a colony that earns it', () => {
  it('opens the middle ring on standing, meals and a crew', () => {
    const world = colony();
    vouch(world, 0, PASSAGE_RELATIONS);
    stock(world, 'meal', 400);
    expect(ringOpen(world, 1)).toBe(true);
    expect(ringOpen(world, 2)).toBe(false);
  });

  it('opens the far ring once the middle ring vouches in turn', () => {
    const world = colony();
    grownTo(world, 5);
    vouch(world, 0, PASSAGE_RELATIONS);
    vouch(world, 1, PASSAGE_RELATIONS);
    stock(world, 'meal', 900);
    expect(ringOpen(world, 2)).toBe(true);
  });

  it('asks for the passage standing and not a day more', () => {
    // The constant is the whole gate, so it is checked on both sides of itself.
    // One point under is shut; exactly the constant is open.
    const world = colony();
    stock(world, 'meal', 400);
    vouch(world, 0, PASSAGE_RELATIONS - 1);
    expect(ringOpen(world, 1)).toBe(false);
    vouch(world, 0, PASSAGE_RELATIONS);
    expect(ringOpen(world, 1)).toBe(true);
  });

  it('lets one good friend open the road, not the whole ring at once', () => {
    // Standing is per place and the road is vouched for by whoever will vouch,
    // so the best relationship in the ring inside is the one that counts.
    const world = colony();
    stock(world, 'meal', 400);
    const near = inRing(world, 0);
    for (const s of near) s.relations = 0;
    near[2]!.relations = PASSAGE_RELATIONS;
    expect(ringOpen(world, 1)).toBe(true);
  });

  it('takes a bigger pack the further out the road goes', () => {
    // Distance is the cost, so the load has to grow with it or nothing past the
    // near ring is ever worth walking to. This is the deviation from "pure
    // data" that stage one made on purpose.
    const world = colony();
    const limits = [0, 1, 2].map((ring) => packLimit(inRing(world, ring)[0]!));
    expect(limits[0]).toBe(onePack(world));
    expect(limits[1]).toBeGreaterThan(limits[0]!);
    expect(limits[2]).toBeGreaterThan(limits[1]!);
  });

  it('walks a colony outward one ring at a time, trade by trade', () => {
    // The whole stage in one test, and the only one here that plays anything
    // forward. No standing is handed out: the colony starts a stranger to
    // everybody, the foreman is asked where to go, the trip is applied, and it
    // is asked again — forty times. What has to come out is the shape the stage
    // promised. It walks the near ring first because that is all it can reach,
    // the middle ring opens once somebody near knows its face, and the far ring
    // opens after that and not before.
    //
    // This is also the check on the thing that is easiest to get wrong: a
    // foreman ranking purely on worth-over-distance would walk to the nearest
    // town forty times, never earn a vouch anywhere, and leave eight of the
    // twelve places as scenery for the whole game.
    const world = colony();
    grownTo(world, 6);
    stock(world, 'meal', 900);

    const walked: number[] = [];
    let midOpenedOn = -1;
    let farOpenedOn = -1;
    for (let trip = 0; trip < 40; trip++) {
      const dest = pickDestination(world, 'steel', PACK_CEILING);
      if (!dest) break;
      walked.push(ringOf(dest));
      dest.visits++;
      dest.relations = Math.min(RELATIONS_MAX, dest.relations + RELATIONS_PER_VISIT);
      if (midOpenedOn < 0 && ringOpen(world, 1)) midOpenedOn = trip;
      if (farOpenedOn < 0 && ringOpen(world, 2)) farOpenedOn = trip;
    }

    // Near first, because it is all there is.
    expect(walked[0]).toBe(0);
    expect(midOpenedOn).toBeGreaterThanOrEqual(0);
    // Then out, and only after the near ring vouched.
    const firstMid = walked.indexOf(1);
    expect(firstMid).toBeGreaterThan(midOpenedOn - 1);
    expect(farOpenedOn).toBeGreaterThan(midOpenedOn);
    // Six runs, not sixty: a colony that trades at all earns the far country,
    // and the number is small because a real one is not making forty trade runs
    // in six weeks. If this ever climbs, `the-far-ring-is-earned` is the
    // principle that will go red on the real grid.
    expect(farOpenedOn).toBeLessThanOrEqual(8);
    // And once the country is open the colony goes back to trading where trade
    // is good, rather than walking three weeks out of habit.
    expect(walked.slice(farOpenedOn + 1).every((r) => r === 0)).toBe(true);
  });

  it('lets a party actually leave for the far ring once everything is in hand', () => {
    const world = colony();
    grownTo(world, 5);
    vouch(world, 0, RELATIONS_MAX);
    vouch(world, 1, RELATIONS_MAX);
    stock(world, 'meal', 900);
    stock(world, 'steel', 600);
    const walker = livingColonists(world).find((p) => !p.playerControlled)!;
    const far = inRing(world, 2)[0]!;
    const plan = planCaravan(world, walker, far.id, { kind: 'steel', amount: packLimit(far) });
    expect(plan.ok).toBe(true);
  });

  it('still refuses a pack bigger than the road carries', () => {
    const world = colony();
    vouch(world, 0, RELATIONS_MAX);
    stock(world, 'meal', 900);
    stock(world, 'steel', 900);
    const walker = livingColonists(world).find((p) => !p.playerControlled)!;
    const mid = inRing(world, 1)[0]!;
    const plan = planCaravan(world, walker, mid.id, {
      kind: 'steel',
      amount: packLimit(mid) + 1,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.text).toMatch(/more than one party carries/i);
  });
});

// ---------------------------------------------------------------------------
// the gate must not take the rest of the trade system down with it
// ---------------------------------------------------------------------------

/**
 * A shut road is supposed to cost the colony that road and nothing else.
 *
 * The foreman puts an open letter ahead of an ordinary surplus run, which is
 * right — the letter has a clock on it and a woodpile does not. But that gives
 * one unanswerable letter the power to stand in front of every trade the colony
 * would otherwise make, for the fortnight the letter runs. `pickRequest` will not
 * write one from a place that cannot be reached; the case left over is the letter
 * that could be answered when it came and cannot be now, because the pantry fell
 * under the road it needs or the escort was buried.
 *
 * `answerable` already documents the intended behaviour for the other reason a
 * letter goes unanswerable — the goods are not there — and it is *fall through to
 * the surplus run and let the letter lapse*. This is the same rule applied to
 * range, and it is here rather than in `commissions.test.ts` because range is the
 * only thing that made it reachable.
 */
describe('a letter that has gone stale', () => {
  it('is never written to a place the colony cannot reach', () => {
    // The near ring is always reachable, so the interesting seeds are the ones
    // where the letter would otherwise have gone outward. Several, because
    // `pickRequest` ranks rather than rolls and one seed only proves one rank.
    for (let seed = 1; seed <= 8; seed++) {
      const world = colony(seed * 1013);
      // Four is the smallest colony anybody writes to, and a colony that has
      // taken migrants in is also the one that could walk a middle-ring road if
      // the standing were there. It is not, and that is the point.
      grownTo(world, 6);
      stockWhatTheyBuy(world);
      world.tick = COMMISSION_EVERY;
      tickCommissions(world);
      const com = commissionOf(world);
      if (!com) continue;
      const place = settlementById(world, com.settlementId)!;
      expect(ringOf(place)).toBe(0);
      expect(withinRange(world, place).ok).toBe(true);
    }
  });

  it('lapses instead of holding the whole road hostage', () => {
    const world = colony(90210);
    const streams = makeStreams(world);
    // A colony with everything the far road asks for except the one thing it
    // cannot buy: somebody who will speak for it. Six pairs of hands, a barn full
    // of meals, and no standing anywhere — so both outer rings are shut on the
    // vouch and the near ring is the only road there is.
    //
    // The vouch is the gate chosen deliberately, because it is the only one of the
    // three that cannot come open while the test is running. Standing moves in
    // exactly two places — a caravan arriving somewhere, and a letter answered —
    // and neither can happen before the first caravan has even left. Two earlier
    // versions of this test learned that the hard way. One shut the road with the
    // pantry, which is not a shut road but a famine: the colony cooked, the pantry
    // recovered, and the road reopened. The other shut it with the escort, which a
    // wanderer walking in undid inside the first day — five settlers, four left
    // holding the valley, road open, letter honoured.
    grownTo(world, 6);
    vouch(world, 0, 0);
    vouch(world, 1, 0);
    stock(world, 'meal', 900);
    stock(world, 'steel', 900);
    const far = inRing(world, 2)[0]!;
    // Shut on the vouch alone, and the sentence the road gives back says so.
    const shut = withinRange(world, far);
    expect(shut.ok).toBe(false);
    if (!shut.ok) expect(shut.text).toMatch(/vouch/i);
    expect(ringOpen(world, 1)).toBe(false);

    // The letter, posted by hand at the place under test rather than waited for:
    // which town writes is `pickRequest`'s business and the test above covers it.
    // This is the state that one cannot produce — a letter that was answerable
    // when it came and stopped being.
    world.commission = {
      settlementId: far.id,
      kind: 'steel',
      amount: PACK_SIZES.steel,
      reason: 'a forge gone cold',
      postedTick: world.tick,
      dueTick: world.tick + TICKS_PER_DAY * 14,
    };
    expect(commissionOf(world)).not.toBeNull();

    // Hands off. Fed, rested, and told to trade — nobody names a destination.
    for (const p of livingColonists(world)) {
      p.needs.food = 1;
      p.needs.rest = 1;
      p.skills.shooting = 20;
      p.priorities.caravan = 1;
    }
    // Waited for rather than counted out, for the reason written at length in
    // `commissions.test.ts`: what this leans on is how often the best talker is
    // between jobs, which moves with the size of the map. The letter's own clock
    // is the deadline, because a fortnight of refusing to trade is exactly the
    // failure being tested for. Re-fed as it goes, since the subject is the road
    // and not the settlers' stomachs.
    const deadline = world.commission.dueTick;
    while (!caravanOf(world) && world.tick < deadline) {
      stepWorldN(world, streams, 60);
      for (const p of livingColonists(world)) {
        p.needs.food = 1;
        p.needs.rest = 1;
      }
    }

    const out = caravanOf(world);
    expect(out).not.toBeNull();
    // The premise, re-checked after the fact rather than assumed: the road the
    // letter came down is still shut. Asserted because the failure it guards
    // against is the quiet one — a road that came open mid-run turns this into a
    // test that passes for the wrong reason, or fails for a reason that has
    // nothing to do with the fall-through.
    expect(withinRange(world, far).ok).toBe(false);
    // Somebody went, and they went to the near ring, which is the only place the
    // colony can get to — not the place that wrote.
    const dest = settlementById(world, out!.settlementId)!;
    expect(dest.id).not.toBe(far.id);
    expect(ringOf(dest)).toBe(0);
    // And the letter is still sitting there unanswered, which is the honest
    // outcome — not silently rewritten to somewhere easier.
    expect(commissionOf(world)?.settlementId).toBe(far.id);
  });
});
