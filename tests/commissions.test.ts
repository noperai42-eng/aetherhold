/**
 * The letters from over the ridge.
 *
 * A commission is the only system in the game that asks the colony for
 * something rather than offering it, which puts it in a position to do more
 * damage than most: it writes to the message log, it moves standing, it adds
 * goods to a caravan's return, and it outranks the foreman's own judgement about
 * what to put on the road. Ordered by what would hurt most if it broke:
 *
 * 1. **It pays over the ceiling.** Every price in the game is clamped to
 *    `RATE_CAP` and the whole no-arbitrage promise in `settlements.ts` is that
 *    clamp. The bonus is defined as the gap up to it — if that arithmetic is
 *    ever wrong in the player's favour, a commission is a loop and the economy
 *    is over.
 * 2. **It empties the granary to be liked.** The foreman answers letters without
 *    being asked, so an unattended colony must never walk its own winter over
 *    the ridge.
 * 3. **It asks for the impossible.** A letter the colony has no way to answer is
 *    a scolding on a timer, and the player learns to ignore the panel.
 * 4. **It lapses out from under somebody already carrying it.** Three days of a
 *    settler's life spent, and the clock runs out while they are in sight of the
 *    gate — the single most infuriating way this could fail.
 *
 * The last block drives the whole thing through `stepWorldN` with nobody
 * touching the controls, because every one of the promises above is about what
 * the colony does when the player is not looking.
 */

import { describe, expect, it } from 'vitest';
import {
  COMMISSION_EVERY,
  COMMISSION_MIN_COLONISTS,
  COMMISSION_SLACK,
  RELATIONS_PER_COMMISSION,
  RELATIONS_PER_LAPSE,
  answerable,
  commissionBonus,
  commissionDaysLeft,
  commissionOf,
  satisfies,
  tickCommissions,
} from '../src/sim/commissions';
import { makePawn } from '../src/sim/pawn';
import { Rng } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import {
  PACK_SIZES,
  RATE_CAP,
  RELATIONS_PER_VISIT,
  relationsPerVisit,
  VALUE,

  caravanOf,
  caravansOf,
  legTicks,
  quote,
  settlementById,
  settlementsOf,
} from '../src/sim/settlements';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { Caravan, Commission, Pawn, ResourceKind, World } from '../src/sim/types';
import { addItem, countResource, livingColonists, removeItem } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

const KINDS: ResourceKind[] = ['wood', 'steel', 'rawfood', 'meal', 'medicine', 'hide'];

function colony(seed = 20260801): World {
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
 * A fourth pair of hands. The colony starts with three, and three is one below
 * the floor at which anybody bothers writing — so most of this file would be
 * testing that floor over and over rather than what it guards.
 */
function fourthSettler(world: World): Pawn {
  const p = makePawn(world, new Rng(31 + world.pawns.length), 'colony', 40, 44);
  p.jobId = null;
  p.path = null;
  p.activity = 'idle';
  return p;
}

/** Two and a half packs of everything anybody round here buys. */
function stockWhatTheyBuy(world: World, packs = 2.5): void {
  for (const s of settlementsOf(world)) {
    stock(world, s.buys, Math.round(PACK_SIZES[s.buys] * packs));
  }
}

/** Put a letter on the table by hand, for the tests that are about the clock. */
function letter(world: World, over: Partial<Commission> = {}): Commission {
  const s = settlementsOf(world)[0]!;
  const com: Commission = {
    settlementId: s.id,
    kind: s.buys,
    amount: PACK_SIZES[s.buys],
    reason: 'they are short and they are asking',
    postedTick: world.tick,
    dueTick: world.tick + legTicks(s) + COMMISSION_SLACK,
    ...over,
  };
  world.commission = com;
  return com;
}

// ---------------------------------------------------------------------------
// the price
// ---------------------------------------------------------------------------

describe('what answering a letter is worth', () => {
  it('never pays a penny over the ceiling every other quote is clamped to', () => {
    const world = colony();
    const walker = livingColonists(world)[0]!;
    let worst = 0;
    for (const s of settlementsOf(world)) {
      // The same corners `settlements.test.ts` sweeps, because a rate that only
      // goes over in one of them is still a rate that goes over, and a player
      // who found that corner would move into it and never leave.
      for (const relations of [-100, 0, 50, 100]) {
        for (const social of [0, 5, 10, 15, 20]) {
          s.relations = relations;
          walker.skills.social = social;
          for (const kind of KINDS) {
            const give = { kind, amount: PACK_SIZES[kind] };
            const paid = quote(s, walker, give);
            const bonus = commissionBonus(s, social, give);
            const back = VALUE[paid.kind] * (paid.amount + bonus);
            worst = Math.max(worst, back / (VALUE[kind] * give.amount));
          }
        }
      }
    }
    // At the cap, never through it. This is the one assertion in the file that
    // the economy actually rests on: `commissionBonus` is defined as the gap up
    // to `RATE_CAP`, so anything above this line means a commission is a machine
    // for turning a pack of wood into more wood.
    expect(worst).toBeLessThanOrEqual(RATE_CAP + 1e-9);
  });

  it('adds nothing at all when the colony is already being quoted the ceiling', () => {
    const world = colony();
    const s = settlementsOf(world)[0]!;
    // Everybody's best friend, walked by somebody who could sell them their own
    // roof. They are already paying the most the game allows anyone to pay.
    s.relations = 100;
    const give = { kind: s.buys, amount: PACK_SIZES[s.buys] };
    expect(commissionBonus(s, 20, give)).toBe(0);
    // Which is the design, not a shortfall: what a commission pays a colony
    // that is already everybody's friend is standing, and standing is the thing
    // no amount of hauling buys.
    expect(RELATIONS_PER_COMMISSION).toBeGreaterThan(RELATIONS_PER_VISIT);
  });

  it('only counts a pack that is the right goods, big enough, at the right door', () => {
    const world = colony();
    const com = letter(world);
    const other = settlementsOf(world).find((s) => s.id !== com.settlementId)!;
    const right = { kind: com.kind, amount: com.amount };
    expect(satisfies(com, com.settlementId, right)).toBe(true);
    // More than asked still answers it — nobody turns away a heavier cart.
    expect(satisfies(com, com.settlementId, { ...right, amount: com.amount + 10 })).toBe(true);
    expect(satisfies(com, com.settlementId, { ...right, amount: com.amount - 1 })).toBe(false);
    expect(satisfies(com, other.id, right)).toBe(false);
    expect(satisfies(com, com.settlementId, { kind: com.kind === 'wood' ? 'steel' : 'wood', amount: 999 })).toBe(false);
    expect(satisfies(null, com.settlementId, right)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// who gets written to, and about what
// ---------------------------------------------------------------------------

describe('the letter itself', () => {
  it('names one pack, one reason and a deadline of the walk out plus slack', () => {
    const world = colony();
    fourthSettler(world);
    stockWhatTheyBuy(world);
    world.tick = COMMISSION_EVERY;
    tickCommissions(world);

    const com = commissionOf(world);
    expect(com).not.toBeNull();
    const s = settlementById(world, com!.settlementId)!;
    // What they buy, in the size the road panel already sells — so answering is
    // a row that is already on the screen rather than a sum the player does.
    expect(com!.kind).toBe(s.buys);
    expect(com!.amount).toBe(PACK_SIZES[com!.kind]);
    expect(com!.reason.length).toBeGreaterThan(10);
    expect(com!.postedTick).toBe(world.tick);
    // The road out plus two days, never the round trip: they want the goods, not
    // the courier home. A deadline that included the walk back would make every
    // far settlement unanswerable and quietly delete half the map.
    expect(com!.dueTick - com!.postedTick).toBe(legTicks(s) + COMMISSION_SLACK);
    expect(commissionDaysLeft(world, com!)).toBeCloseTo(
      (legTicks(s) + COMMISSION_SLACK) / TICKS_PER_DAY,
      6,
    );
  });

  it('does not write to a colony too small to spare the person who would carry it', () => {
    const world = colony();
    stockWhatTheyBuy(world);
    // Three, which is what the valley starts with, and one below the floor.
    expect(livingColonists(world).length).toBe(COMMISSION_MIN_COLONISTS - 1);
    world.tick = COMMISSION_EVERY;
    tickCommissions(world);
    // Silence. A colony of three that sends one away is a colony of two, and two
    // cannot hold a wall — asking is asking them to choose between the letter
    // and the colony, which is not a decision, it is a trap.
    expect(commissionOf(world)).toBeNull();
  });

  it('does not ask for what the colony has not got', () => {
    const world = colony();
    fourthSettler(world);
    for (const item of [...world.items]) removeItem(world, item);
    world.tick = COMMISSION_EVERY;
    tickCommissions(world);
    // An unanswerable letter is a scolding on a timer. The panel has to be worth
    // reading or the player stops reading it.
    expect(commissionOf(world)).toBeNull();
  });

  it('does not ask for what the colony is drowning in', () => {
    const world = colony();
    fourthSettler(world);
    // Ten packs of everything anybody wants. At this point handing one over is
    // tidying up, and a "commission" nobody has to think about is a loading
    // screen with a message attached.
    stockWhatTheyBuy(world, 10);
    world.tick = COMMISSION_EVERY;
    tickCommissions(world);
    expect(commissionOf(world)).toBeNull();
  });

  it('holds off while the colony is being raided', () => {
    const world = colony();
    fourthSettler(world);
    stockWhatTheyBuy(world);
    world.storyteller.raidActive = true;
    world.tick = COMMISSION_EVERY;
    tickCommissions(world);
    // A runner walking into a firefight to ask about firewood is the game
    // talking over itself, and the clock would start while nobody could move.
    expect(commissionOf(world)).toBeNull();
  });

  it('keeps to one letter at a time', () => {
    const world = colony();
    fourthSettler(world);
    stockWhatTheyBuy(world);
    const first = letter(world);
    world.tick = COMMISSION_EVERY;
    tickCommissions(world);
    // Four open requests is a spreadsheet. One is a decision.
    expect(commissionOf(world)!.postedTick).toBe(first.postedTick);
    expect(commissionOf(world)!.settlementId).toBe(first.settlementId);
  });
});

// ---------------------------------------------------------------------------
// the clock
// ---------------------------------------------------------------------------

describe('when the clock runs out', () => {
  it('costs the colony standing, and less of it than a single run earns back', () => {
    const world = colony();
    const s = settlementsOf(world)[0]!;
    s.relations = 50;
    const com = letter(world);
    world.tick = com.dueTick + 1;
    tickCommissions(world);

    expect(commissionOf(world)).toBeNull();
    expect(s.relations).toBe(50 - RELATIONS_PER_LAPSE);
    // Disappointment, not betrayal. Nobody agreed to anything, and a game that
    // punishes a player for a letter they never opened teaches them to dread
    // the panel — so one ordinary trip always puts it back and then some.
    expect(RELATIONS_PER_LAPSE).toBeLessThan(RELATIONS_PER_VISIT);
    expect(world.messages.some((m) => m.text.includes('made do'))).toBe(true);
  });

  it('does not run out under a settler who is already on the road with the pack', () => {
    const world = colony();
    const s = settlementsOf(world)[0]!;
    s.relations = 50;
    const com = letter(world);
    const walker = livingColonists(world)[0]!;
    world.caravans = [{
      settlementId: com.settlementId,
      pawn: walker,
      give: { kind: com.kind, amount: com.amount },
      take: null,
      x: 40,
      y: 40,
      dueTick: com.dueTick + 200,
      phase: 'outbound',
    } as Caravan];

    world.tick = com.dueTick + 1;
    tickCommissions(world);
    // Three days of somebody's life are in that pack. Expiring it while they are
    // in sight of the gate is the single most infuriating way this could fail,
    // so the clock stops the moment the right goods are actually walking.
    expect(commissionOf(world)).not.toBeNull();
    expect(s.relations).toBe(50);
  });

  it('does run out under a settler carrying something else entirely', () => {
    const world = colony();
    const s = settlementsOf(world)[0]!;
    s.relations = 50;
    const com = letter(world);
    const walker = livingColonists(world)[0]!;
    world.caravans = [{
      settlementId: com.settlementId,
      pawn: walker,
      give: { kind: com.kind, amount: com.amount - 1 },
      take: null,
      x: 40,
      y: 40,
      dueTick: com.dueTick + 200,
      phase: 'outbound',
    } as Caravan];

    world.tick = com.dueTick + 1;
    tickCommissions(world);
    // The grace above is for the pack that answers it, not for anybody who
    // happens to be pointed the same way — otherwise a surplus run to the same
    // town silently holds a letter open for ever.
    expect(commissionOf(world)).toBeNull();
    expect(s.relations).toBe(50 - RELATIONS_PER_LAPSE);
  });
});

// ---------------------------------------------------------------------------
// what the foreman will and will not send
// ---------------------------------------------------------------------------

describe('the colony answering its own post', () => {
  it('will not strip the stores to be liked', () => {
    const world = colony();
    const com = letter(world);
    // Exactly the pack and not a unit more. Handing this over is the colony
    // giving away every last one of something on a promise of goodwill, which
    // is a decision a player is allowed to make and the foreman is not.
    stock(world, com.kind, com.amount);
    expect(answerable(world)).toBeNull();

    stock(world, com.kind, com.amount * 4);
    const send = answerable(world)!;
    expect(send).not.toBeNull();
    expect(send.kind).toBe(com.kind);
    expect(send.amount).toBe(com.amount);
    expect(send.settlementId).toBe(com.settlementId);
  });

  it('will not load a pack for a letter that has already lapsed', () => {
    const world = colony();
    const com = letter(world);
    stock(world, com.kind, com.amount * 4);
    world.tick = com.dueTick + 1;
    // The lapse pass has not run yet — this is the same tick. Sending anyway
    // would be a settler walking three days to deliver goods nobody is waiting
    // for any more.
    expect(answerable(world)).toBeNull();
  });

  it('has nothing to load when there is no letter', () => {
    const world = colony();
    stockWhatTheyBuy(world, 6);
    expect(answerable(world)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the save
// ---------------------------------------------------------------------------

/** The view/speed a save carries alongside the world. Irrelevant here. */
const VIEW = {
  mode: 'manager' as const,
  possessedId: null,
  camera: { targetX: 0, targetY: 0, distance: 20, yaw: 0, pitch: 1 },
};

describe('a letter across a save', () => {
  it('comes back with the same clock and the same asking price', () => {
    const world = colony();
    const com = letter(world);
    const round = deserialize(serialize(world, VIEW, 1, 0));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    const kept = commissionOf(round.save.world);
    expect(kept).not.toBeNull();
    expect(kept!.settlementId).toBe(com.settlementId);
    expect(kept!.kind).toBe(com.kind);
    expect(kept!.amount).toBe(com.amount);
    expect(kept!.dueTick).toBe(com.dueTick);
    expect(kept!.reason).toBe(com.reason);
  });

  it('reads a save written before anybody was asking as simply no letter', () => {
    const world = colony();
    const raw = JSON.parse(serialize(world, VIEW, 1, 0)) as { world: Record<string, unknown> };
    // The field is optional and the save version is deliberately not bumped, so
    // an older colony has to load into "nobody has written yet" rather than into
    // an exception on the title screen.
    delete raw.world.commission;
    const round = deserialize(JSON.stringify(raw));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    const back = round.save.world;
    expect(commissionOf(back)).toBeNull();
    // And the next quiet day it is a colony like any other.
    fourthSettler(back);
    stockWhatTheyBuy(back);
    back.tick = COMMISSION_EVERY * 4;
    tickCommissions(back);
    expect(commissionOf(back)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the whole road, hands off
// ---------------------------------------------------------------------------

describe('a colony left to itself', () => {
  it('gets a letter, walks the pack out to them, and comes home better thought of', () => {
    const world = colony(90210);
    const streams = makeStreams(world);
    fourthSettler(world);
    stockWhatTheyBuy(world);
    // Standing worth measuring from, and a traveller who can discourage a
    // robbery. The road's dice are real and never zero, so the test sits in the
    // corner where they are as close to safe as the game allows and asserts on
    // what a trip that goes well actually does.
    for (const s of settlementsOf(world)) s.relations = 40;
    for (const p of livingColonists(world)) p.skills.shooting = 20;
    // The road is held shut until the letter lands. Without this the colony's
    // own surplus run leaves first — correctly — and the trip under test would
    // be whatever the foreman got round to second, which is a test about
    // scheduling rather than about commissions. Re-applied as it goes because a
    // wanderer who walks in halfway arrives with their own opinions.
    while (world.tick < COMMISSION_EVERY) {
      for (const p of livingColonists(world)) p.priorities.caravan = 0;
      stepWorldN(world, streams, Math.min(240, COMMISSION_EVERY - world.tick));
    }
    expect(caravanOf(world)).toBeNull();
    const com = commissionOf(world);
    expect(com).not.toBeNull();
    const place = settlementById(world, com!.settlementId)!;
    const standingBefore = place.relations;

    // Fed and rested. The road refuses a settler who is neither and it is right
    // to — but a colony of four in its first fortnight usually *is* neither, and
    // a test that skipped this would be measuring the food supply.
    stock(world, 'meal', 60);
    stock(world, com!.kind, PACK_SIZES[com!.kind] * 3);
    for (const p of livingColonists(world)) {
      p.needs.food = 1;
      p.needs.rest = 1;
    }

    // Hands off from here. Nobody orders the run; the foreman reads the post.
    for (const p of livingColonists(world)) p.priorities.caravan = 2;
    // Waited for rather than counted out, and that is a scar with two rings in
    // it now. It began as a flat 1 200 ticks — a quarter-day, comfortable while
    // the valley was 96 cells square. At 128 every errand got about a third
    // longer, and what this test really leans on is not how long a walk takes: it
    // is how often the best talker is between jobs at all, because the work board
    // is only read on those ticks. Widening it to a full day bought enough room
    // for that, and a day was enough right up until the valley went to 192.
    //
    // At this size the foraging and hauling that fill a settler's morning reach a
    // hundred cells out, so the best talker is mid-errand at the far end of the
    // moor for most of the day. Measured on this seed the pack leaves at 5 240
    // ticks — nine per cent past a budget that had itself just been widened, with
    // the letter's clock showing another three days on it. Nothing was wrong with
    // the road. The number was wrong, and a number that has now been wrong twice
    // for the same reason will be wrong again the next time the map moves.
    //
    // So it stopped being a duration. The loop runs until the pack leaves or the
    // letter runs out of time, and what gets asserted is the thing the player
    // actually cares about: a letter that arrives with the goods already in the
    // barn gets answered before it lapses. A bigger map cannot invalidate that.
    // Only the trade road genuinely breaking can.
    //
    // Stopping the moment it happens still matters as much as the waiting.
    // Stepping a flat span instead would let a short road be walked, delivered
    // and walked back inside the wait, and everything below here is about a party
    // that is still out.
    while (!caravanOf(world) && world.tick < com!.dueTick) {
      stepWorldN(world, streams, 20);
    }
    const out = caravanOf(world);
    expect(out).not.toBeNull();
    // Left with time to spare rather than on the last possible tick — the letter
    // is still open, which is what makes the delivery below worth standing.
    expect(commissionOf(world)).not.toBeNull();
    // The pack they chose is the pack that was asked for, at the door it was
    // asked at — an open letter outranks a surplus run.
    expect(out!.settlementId).toBe(com!.settlementId);
    expect(out!.give.kind).toBe(com!.kind);
    expect(out!.give.amount).toBeGreaterThanOrEqual(com!.amount);
    // Genuinely gone: the pack costs the colony a pair of hands as well as the
    // goods, which is what makes answering a letter a decision.
    expect(world.pawns.some((p) => p.id === out!.pawn.id)).toBe(false);

    // Out to them, the deal struck, and the letter settled on the same tick.
    stepWorldN(world, streams, legTicks(place) + 40);
    expect(commissionOf(world)).toBeNull();
    expect(world.stats.commissions).toBe(1);
    // Three ordinary visits' worth of standing, on top of the visit itself.
    expect(place.relations).toBe(
      Math.min(100, standingBefore + relationsPerVisit(place) + RELATIONS_PER_COMMISSION),
    );
    expect(world.messages.some((m) => m.text.includes('has what it needed'))).toBe(true);

    // And they come home. The traveller is a settler again, not a number on a
    // panel that quietly never returned.
    //
    // Followed by name rather than by "is anybody out". This colony can field a
    // second road now, and the foreman will cheerfully have somebody on it when
    // this one walks back in — so an empty road is no longer evidence that a
    // particular settler returned, and demanding one would be asking the colony
    // to stop trading in order to prove it.
    const walkerId = out!.pawn.id;
    stepWorldN(world, streams, legTicks(place) + 200);
    expect(caravansOf(world).some((c) => c.pawn.id === walkerId)).toBe(false);
    expect(livingColonists(world).some((p) => p.id === walkerId)).toBe(true);
    expect(countResource(world, place.sells)).toBeGreaterThan(0);
  });
});
