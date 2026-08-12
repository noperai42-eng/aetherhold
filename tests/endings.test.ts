/**
 * The far end of the three roads.
 *
 * An ending is the one thing in this game that can only happen once, which
 * makes it the one thing that cannot be balanced by watching it happen a lot.
 * So this file is organised around the three ways a terminal stops being a
 * commitment and quietly becomes something cheaper.
 *
 * **The bills have to be bought from numbers that already existed.** Every
 * other stage in this project earns that sentence and this one has the most to
 * lose by breaking it: three endings are three balance problems the day one of
 * their prices is a literal somebody typed. The first block holds each bill and
 * the day count to the thing it was derived from — the research tree, the
 * `VALUE` yardstick, the founding's own hold.
 *
 * **The gate has to stay a gate.** `endingOpen` is read live and not latched,
 * and the whole reason dominion has a bill at all is that a colony which took
 * the moor and then lost a piece of it is not holding the moor. The second
 * block is the commitment rules and the fall-out: what is refused, what stalls,
 * and what a stall costs — the days, never the goods.
 *
 * **It has to cost the days.** The bug this stage is one careless line away
 * from is a hull that swallows twelve instalments in an afternoon because the
 * terminal is ticked sixty times a minute and the bill is quoted per day. The
 * third block ticks the sim the way the sim is ticked and counts what came out
 * of the yard, and the last block plays a whole ending end to end through
 * `stepWorldN` — the real loop, the real charters, the real clock.
 */

import { describe, expect, it } from 'vitest';

import { dayNumber } from '../src/sim/clock';
import {
  BERTHS_WORTH,
  ENDING_DAYS,
  ENDING_IDS,
  ENDING_TICKS,
  SHIP_BILL,
  abandonEnding,
  commitEnding,
  endingOffer,
  endingProgress,
  endingRecord,
  endingsOpen,
  hasEnded,
  tickEndings,
  worthOf,
} from '../src/sim/endings';
import { STANDING_BAND } from '../src/sim/events';
import { holdingsOf } from '../src/sim/holdings';
import { makePawn } from '../src/sim/pawn';
import { RESEARCH, RESEARCH_ORDER } from '../src/sim/research';
import { Rng } from '../src/sim/rng';
import { ROAD_RUNGS, roadRungs } from '../src/sim/roads';
import { deserialize, serialize } from '../src/sim/save';
import { VALUE, settlementsOf } from '../src/sim/settlements';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { TICKS_PER_DAY, type ResourceKind, type World } from '../src/sim/types';
import {
  HOLD_DAYS,
  HOLD_TICKS,
  NEED_PEOPLE,
  NEED_RELATIONS,
  NEED_RESEARCH,
  charters,
  hasWon,
} from '../src/sim/victory';
import {
  addBuilding,
  addItem,
  countResource,
  livingColonists,
  takeResource,
} from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

const VIEW = {
  mode: 'manager' as const,
  camera: { targetX: 32, targetY: 32, distance: 40, yaw: 0.8, pitch: 0.9 },
  possessedId: null,
};

/**
 * A founded colony, the same way `roads.test.ts` and `victory.test.ts` build
 * one: qualify on every axis by hand, tell the storyteller to stay away, and
 * let the real loop run the hold. Copied rather than shared because a fixture
 * imported across test files is a fixture that gets tuned for one file and
 * silently changes what another one was asserting.
 *
 * The one thing it does differently is the pantry. Those two files hold a
 * colony together for four days; this one holds it for sixteen, and a founding
 * charter that lapses on day nine because the meals ran out would look exactly
 * like the ending mechanism dropping its clock.
 *
 * Built once and handed out as a deep copy. Nineteen thousand ticks of real
 * loop is twelve seconds, and fifteen tests each paying it is four minutes to
 * arrive at the same colony fifteen times. The copy is honest because the world
 * is plain JSON by construction — that is `save.ts`'s whole premise, and the
 * round-trip test below is what keeps it true.
 */
let base: World | null = null;

function founded(): World {
  base ??= foundOnce();
  return JSON.parse(JSON.stringify(base)) as World;
}

function foundOnce(seed = 4242): World {
  const world = createWorld(seed);
  const rng = new Rng(99);
  while (livingColonists(world).length < NEED_PEOPLE) makePawn(world, rng, 'colony', 30, 30);
  addItem(world, 'meal', 900, 31, 34);
  for (const at of [
    { x: 24, y: 30 },
    { x: 24, y: 32 },
  ]) {
    let up = false;
    for (let r = 0; r < 12 && !up; r++) {
      for (let dy = -r; dy <= r && !up; dy++) {
        for (let dx = -r; dx <= r && !up; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          up = !!addBuilding(world, 'turret', at.x + dx, at.y + dy, true);
        }
      }
    }
    if (!up) throw new Error(`nowhere to stand a turret near ${at.x},${at.y}`);
  }
  world.research.done = RESEARCH_ORDER.slice(0, NEED_RESEARCH).slice();
  settlementsOf(world)[0]!.relations = NEED_RELATIONS;
  world.storyteller.nextThreat = TICKS_PER_DAY * 90;
  world.storyteller.nextScout = TICKS_PER_DAY * 90;
  world.storyteller.nextOutbreak = TICKS_PER_DAY * 90;
  const streams = makeStreams(world);
  for (let i = 0; i < HOLD_TICKS + TICKS_PER_DAY && !hasWon(world); i++) {
    stepWorldN(world, streams, 1);
  }
  if (!hasWon(world)) throw new Error('the fixture failed to found');
  return world;
}

/** Put one road at its top rung, the way `roads.test.ts` does: by hand, not by playing. */
function topOf(world: World, road: 'science' | 'economy' | 'warfare'): void {
  if (road === 'science') world.research.done = RESEARCH_ORDER.slice();
  if (road === 'economy') {
    for (const s of settlementsOf(world)) s.relations = NEED_RELATIONS;
  }
  if (road === 'warfare') {
    for (const h of holdingsOf(world)) h.held = true;
    world.stats.raidersKilled = STANDING_BAND;
  }
}

/**
 * Tick the terminal the way the loop ticks it, without the rest of the loop.
 *
 * `stepWorldN` for sixteen days is seventy thousand ticks of pathfinding and
 * weather to watch one counter, and the thing being watched here is a cadence:
 * `tickEndings` fires on every twentieth tick and the bill is quoted per day.
 * Advancing the clock one tick at a time and calling it exactly where `tick.ts`
 * calls it is that cadence faithfully. The end-to-end run is the last block.
 */
function runTerminal(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    tickEndings(world);
  }
}

// ---------------------------------------------------------------------------
// bills bought from numbers that already existed
// ---------------------------------------------------------------------------

describe('three bills and not one of them typed in', () => {
  it('bills the ship for the whole research tree over again', () => {
    // Not a multiple of anything and not a round number: it is the sum of every
    // materials line in `research.ts`, so a fourth tier moves it without
    // anybody opening `endings.ts`.
    const tally: Partial<Record<ResourceKind, number>> = {};
    for (const id of RESEARCH_ORDER) {
      for (const [kind, n] of Object.entries(RESEARCH[id].materials ?? {}) as Array<
        [ResourceKind, number]
      >) {
        tally[kind] = (tally[kind] ?? 0) + n;
      }
    }
    expect(SHIP_BILL).toEqual(tally);
    // And the tree has to actually charge for something, or the assertion above
    // is two empty objects agreeing with each other.
    expect(worthOf(SHIP_BILL)).toBeGreaterThan(0);
  });

  it('prices the berths at what the ship costs, in the other currency', () => {
    // The point of this equality is that the two endings cannot drift apart:
    // grow the tree and the fare grows with it, because there is only one
    // number and `VALUE` is the exchange rate between the units.
    expect(BERTHS_WORTH).toBe(Math.round(worthOf(SHIP_BILL)));
    expect(worthOf({ steel: 2, medicine: 1 })).toBe(VALUE.steel * 2 + VALUE.medicine);
  });

  it('asks for one of the founding holds per rung the colony climbed', () => {
    expect(ENDING_DAYS).toBe(HOLD_DAYS * ROAD_RUNGS);
    expect(ENDING_TICKS).toBe(TICKS_PER_DAY * ENDING_DAYS);
    // Longer than the founding by enough that it is a different kind of ask.
    // Equal-or-shorter would make the last act of the game cheaper than its
    // first, which is the failure this assertion exists to name.
    expect(ENDING_TICKS).toBeGreaterThan(HOLD_TICKS);
  });

  it('has one ending per road and names them in road order', () => {
    expect(ENDING_IDS).toEqual(['ship', 'berths', 'dominion']);
    expect(ENDING_IDS).toHaveLength(ROAD_RUNGS - 1);
    const world = createWorld(7);
    // Each reads its own road. Three endings behind one gate would be one
    // ending with three labels, which is the failure `roads.ts` is built to
    // avoid one layer down.
    expect(ENDING_IDS.map((id) => endingOffer(world, id).road)).toEqual([
      'science',
      'economy',
      'warfare',
    ]);
  });
});

// ---------------------------------------------------------------------------
// the gate, and falling out through it
// ---------------------------------------------------------------------------

describe('a gate that is read every time and not remembered', () => {
  it('offers nothing to a colony on its first morning', () => {
    const world = createWorld(7);
    expect(endingsOpen(world)).toEqual([]);
    expect(endingProgress(world)).toBe(null);
    expect(hasEnded(world)).toBe(false);
  });

  it('opens exactly the ending whose road reached the top', () => {
    const world = founded();
    topOf(world, 'warfare');
    expect(roadRungs(world)[2]).toBe(ROAD_RUNGS);
    expect(endingsOpen(world)).toEqual(['dominion']);
  });

  it('refuses a commitment the road has not paid for', () => {
    const world = founded();
    expect(commitEnding(world, 'ship')).toBe(false);
    expect(world.ending).toBeUndefined();
  });

  it('refuses a second commitment while the first is running', () => {
    const world = founded();
    topOf(world, 'warfare');
    topOf(world, 'science');
    expect(commitEnding(world, 'dominion')).toBe(true);
    // Both are open. Committing to both would turn the choice of which road to
    // finish — most of what the three roads are for — into a checklist.
    expect(endingsOpen(world)).toContain('ship');
    expect(commitEnding(world, 'ship')).toBe(false);
    expect(world.ending?.id).toBe('dominion');
  });

  it('stops the clock when the road slips back under its own gate', () => {
    const world = founded();
    topOf(world, 'warfare');
    commitEnding(world, 'dominion');
    runTerminal(world, TICKS_PER_DAY * 4);
    const before = endingProgress(world)!;
    expect(before.running).toBe(true);
    expect(before.daysLeft).toBeLessThan(ENDING_DAYS);

    holdingsOf(world)[0]!.held = false;
    runTerminal(world, 20);
    const after = endingProgress(world)!;
    expect(after.running).toBe(false);
    expect(after.stalled).toContain('warfare');
    // The four days are gone, not paused. That is the whole of what falling out
    // costs, and it is the same rule the founding hold plays by.
    expect(after.daysLeft).toBe(ENDING_DAYS);
  });

  it('stops the clock when the colony stops being a colony', () => {
    const world = founded();
    topOf(world, 'warfare');
    commitEnding(world, 'dominion');
    runTerminal(world, 20);
    expect(endingProgress(world)!.running).toBe(true);

    // No sixth bar: the terminal reads the founding's own five charters, so a
    // colony that eats the store it was examined on loses the ending too.
    takeResource(world, 'meal', countResource(world, 'meal'));
    takeResource(world, 'rawfood', countResource(world, 'rawfood'));
    expect(charters(world).find((c) => c.id === 'larder')!.met).toBe(false);
    runTerminal(world, 20);
    const p = endingProgress(world)!;
    expect(p.running).toBe(false);
    expect(p.stalled).toBe('twelve days of food in the store');
  });

  it('gives back the days and keeps the goods when it is abandoned', () => {
    const world = founded();
    topOf(world, 'science');
    addItem(world, 'steel', 400, 31, 34);
    const stock = countResource(world, 'steel');
    commitEnding(world, 'ship');
    runTerminal(world, TICKS_PER_DAY * 3);
    const paid = world.ending!.paid.steel ?? 0;
    expect(paid).toBeGreaterThan(0);

    expect(abandonEnding(world)).toBe(true);
    expect(world.ending).toBeUndefined();
    // What went into the hull is gone — that is what committing meant — and the
    // colony is free to commit again.
    expect(countResource(world, 'steel')).toBe(stock - paid);
    expect(abandonEnding(world)).toBe(false);
    expect(commitEnding(world, 'ship')).toBe(true);
    expect(world.ending!.paid.steel ?? 0).toBe(0);
  });

  it('never touches the flag that means nobody is left', () => {
    const world = founded();
    topOf(world, 'warfare');
    commitEnding(world, 'dominion');
    runTerminal(world, ENDING_TICKS + TICKS_PER_DAY);
    expect(hasEnded(world)).toBe(true);
    // `victory.ts` documents the slice where winning switched the foreman off.
    // An ending is its own field; the game-over flag still means what nine
    // other passes read it to mean.
    expect(world.gameOver).toBe(false);
  });

  it('carries a committed terminal through a save and back', () => {
    const world = founded();
    topOf(world, 'warfare');
    commitEnding(world, 'dominion');
    runTerminal(world, TICKS_PER_DAY * 2);
    const back = deserialize(serialize(world, VIEW, 1, 0));
    if (!back.ok) throw new Error(`save refused: ${back.detail}`);
    expect(back.save.world.ending).toEqual(world.ending);
    expect(endingProgress(back.save.world)!.daysLeft).toBeCloseTo(
      endingProgress(world)!.daysLeft,
      5,
    );
  });
});

// ---------------------------------------------------------------------------
// what a day of it costs
// ---------------------------------------------------------------------------

describe('a bill paid by the day and not by the tick', () => {
  it('takes one instalment a day out of the yard, not one every twentieth tick', () => {
    const world = founded();
    topOf(world, 'science');
    addItem(world, 'steel', 900, 31, 34);
    const stock = countResource(world, 'steel');
    commitEnding(world, 'ship');

    const day = Math.ceil((SHIP_BILL.steel ?? 0) / ENDING_DAYS);
    runTerminal(world, TICKS_PER_DAY);
    const afterOne = stock - countResource(world, 'steel');
    // Whole instalments only, and two of them at most: the day it committed on
    // and the one boundary a day's worth of ticks can cross. A day is 240 calls
    // to `tickEndings`, so a hull paying per call would be off by two orders of
    // magnitude here rather than by one.
    expect(afterOne % day).toBe(0);
    expect(afterOne / day).toBeLessThanOrEqual(2);

    // The load-bearing half. Whatever the first window caught, the next day
    // adds exactly one more instalment — that is what "by the day" means, and
    // it is the assertion that would have caught the hull eating twelve days of
    // steel in an afternoon.
    runTerminal(world, TICKS_PER_DAY);
    expect(stock - countResource(world, 'steel')).toBe(afterOne + day);
  });

  it('lands the hull on the day the bill and the clock are both met', () => {
    const world = founded();
    topOf(world, 'science');
    for (const [kind, n] of Object.entries(SHIP_BILL) as Array<[ResourceKind, number]>) {
      addItem(world, kind, n + 50, 31, 34);
    }
    commitEnding(world, 'ship');
    runTerminal(world, ENDING_TICKS - TICKS_PER_DAY);
    // The bill can be finished early — an instalment is a ceiling, not a floor —
    // and it still does not land, because the days are the other half.
    expect(hasEnded(world)).toBe(false);
    runTerminal(world, TICKS_PER_DAY + 20);
    expect(hasEnded(world)).toBe(true);
    expect(endingProgress(world)!.progress).toBe(1);
  });

  it('runs the clock out under a hull nobody stocked, and does not land', () => {
    const world = founded();
    topOf(world, 'science');
    commitEnding(world, 'ship');
    runTerminal(world, ENDING_TICKS + TICKS_PER_DAY);
    // Twelve days served and the ship is still a pile of plans. The clock alone
    // is never the ending — that is what makes the bill a bill.
    expect(hasEnded(world)).toBe(false);
    const p = endingProgress(world)!;
    expect(p.running).toBe(true);
    expect(p.daysLeft).toBe(0);
    expect(p.bill.at).toBeLessThan(p.bill.of);
  });

  it('reads the fare off the whole run, not off the terminal', () => {
    const world = founded();
    topOf(world, 'economy');
    // Nobody has traded anything, so the fare is unpaid however long they wait.
    commitEnding(world, 'berths');
    runTerminal(world, ENDING_TICKS + TICKS_PER_DAY);
    expect(hasEnded(world)).toBe(false);

    // The road is where that is bought, and `settlements.ts` is what books it.
    world.stats.tradedWorth = BERTHS_WORTH;
    runTerminal(world, 20);
    expect(hasEnded(world)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the whole thing, through the loop the game actually runs
// ---------------------------------------------------------------------------

describe('an ending played end to end', () => {
  it('takes the moor, holds it for twelve days and leaves the colony standing', () => {
    const world = founded();
    topOf(world, 'warfare');
    const streams = makeStreams(world);

    expect(endingsOpen(world)).toEqual(['dominion']);
    expect(commitEnding(world, 'dominion')).toBe(true);
    const committedOn = world.ending!.committed;

    // The real loop: pathfinding, hunger, the pantry draining, the founding
    // charters re-examined every tick underneath. Nothing here calls the
    // terminal by hand. Stepped in blocks because the landing tick is recorded
    // by the sim, not by this loop — checking between blocks costs a fraction
    // of a day of wall clock and nothing at all in accuracy.
    for (let i = 0; i < ENDING_TICKS + TICKS_PER_DAY * 2 && !hasEnded(world); i += 200) {
      stepWorldN(world, streams, 200);
    }

    expect(hasEnded(world)).toBe(true);
    const days = (world.ending!.landed! - committedOn) / TICKS_PER_DAY;
    // The floor `no-ending-is-free` reads on the grid, asserted here on one
    // colony: an ending cannot be reached in fewer days than it costs.
    expect(days).toBeGreaterThanOrEqual(ENDING_DAYS);
    // Still a colony on the day it landed, which is not a nicety — it is the
    // condition the terminal was checking every twentieth tick for twelve days,
    // read back one last time from the outside.
    expect(charters(world).filter((c) => !c.met)).toEqual([]);
    expect(world.gameOver).toBe(false);
    // And the headline is in the chronicle, which is where the run is read back
    // from — an ending nobody can find afterwards did not happen.
    expect((world.chronicle ?? []).some((c) => c.text.includes('dominion'))).toBe(true);
  });

  it('offers the choice to a colony standing at the top of two roads', () => {
    const world = founded();
    topOf(world, 'economy');
    topOf(world, 'warfare');
    const open = endingsOpen(world);
    expect(open).toEqual(['berths', 'dominion']);
    // What the panel quotes before anybody commits. The fare is partly paid on
    // the way here and the moor entirely so — both are honest numbers, and a
    // quote that pretended otherwise would be offering a discount.
    const berths = endingOffer(world, 'berths');
    expect(berths.bill.of).toBe(BERTHS_WORTH);
    expect(berths.bill.at).toBe(Math.round(world.stats.tradedWorth ?? 0));
    expect(endingOffer(world, 'dominion').bill.at).toBe(holdingsOf(world).length);
  });
});

// ---------------------------------------------------------------------------
// the record, kept because the day it is about goes past
// ---------------------------------------------------------------------------

/** A colony one tick short of landing the hull, with the yard fully stocked. */
function aboutToSail(): World {
  const world = founded();
  topOf(world, 'science');
  for (const [kind, n] of Object.entries(SHIP_BILL) as Array<[ResourceKind, number]>) {
    addItem(world, kind, n + 50, 31, 34);
  }
  commitEnding(world, 'ship');
  runTerminal(world, ENDING_TICKS);
  return world;
}

describe('a record of the day it landed', () => {
  it('keeps nothing until there is something to keep', () => {
    const world = founded();
    expect(endingRecord(world)).toBeNull();
    topOf(world, 'science');
    commitEnding(world, 'ship');
    // Committed and paying, which is a colony in the middle of something rather
    // than one that has finished it. A record taken here would be a card about
    // a day that has not happened.
    runTerminal(world, TICKS_PER_DAY * 3);
    expect(endingRecord(world)).toBeNull();
  });

  it('freezes the tally on the tick it lands, and not a tick later', () => {
    const world = aboutToSail();
    runTerminal(world, 20);
    expect(hasEnded(world)).toBe(true);
    const rec = endingRecord(world)!;
    expect(rec.day).toBe(dayNumber(world));
    expect(rec.standing).toBe(livingColonists(world).length);
    const built = rec.stats.built;

    // Twenty days in the valley after the ship is away: somebody dies, the
    // survivors put up a wall, the pantry keeps being cooked out of. None of it
    // is what the ship left with, and none of it may move a number on the card.
    livingColonists(world)[0]!.dead = true;
    world.stats.colonistsLost += 1;
    world.stats.built += 7;
    world.tick += TICKS_PER_DAY * 20;
    const after = endingRecord(world)!;
    expect(after.day).toBe(rec.day);
    expect(after.day).toBeLessThan(dayNumber(world));
    expect(after.standing).toBe(rec.standing);
    expect(after.standing).toBeGreaterThan(livingColonists(world).length);
    expect(after.stats.built).toBe(built);
    expect(after.stats.colonistsLost).toBe(rec.stats.colonistsLost);
  });

  it('carries the record through a save and back', () => {
    const world = aboutToSail();
    runTerminal(world, 20);
    const rec = endingRecord(world)!;
    const back = deserialize(serialize(world, VIEW, 1, 0));
    if (!back.ok) throw new Error(`save refused: ${back.detail}`);
    // The whole point of the freeze is that it outlives the moment, and a
    // colony reopened tomorrow is the longest way for a moment to be over.
    expect(endingRecord(back.save.world)).toEqual(rec);
  });

  it('falls back to the world for an ending that landed before records existed', () => {
    const world = aboutToSail();
    runTerminal(world, 20);
    // Exactly the shape of a save written by the stage that shipped terminals
    // without a record: landed, and nothing kept about the day.
    delete world.ending!.record;
    const rec = endingRecord(world)!;
    expect(rec).not.toBeNull();
    expect(rec.day).toBe(dayNumber(world));
    expect(rec.standing).toBe(livingColonists(world).length);
  });

  it('freezes a bag of numbers, which is the only reason a shallow copy is honest', () => {
    const world = aboutToSail();
    runTerminal(world, 20);
    // `takeRecord` spreads `world.stats` one level deep. That is right for as
    // long as the tally is flat — the day somebody nests an object in it the
    // copy starts aliasing the live world again and the test above would still
    // pass, because it only reads numbers. This is the one that fails.
    for (const [key, value] of Object.entries(endingRecord(world)!.stats)) {
      expect(typeof value, `stats.${key} is not a number`).toBe('number');
    }
  });
});
