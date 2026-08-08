/**
 * Somewhere to spend the evening.
 *
 * The functional half pins the three rules that make recreation a choice rather
 * than a lookup: a spot has a fixed number of seats and the count has to include
 * the people still walking to it, a fire that has burnt out is not a spot at all,
 * and company is worth enough to beat a slightly better empty table without being
 * worth crossing the base for. The experience half plays it out — bored settlers
 * end up at the same spot instead of taking private turns at one table, the games
 * table fills a bar faster than the dining table, and a fire going out while
 * somebody is sitting at it puts them back to work.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/worldgen';
import { addBuilding, removeBuilding } from '../src/sim/world';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { assignJob, reachable, tickJob } from '../src/sim/jobs';
import { defOf, BUILD_GROUPS } from '../src/sim/buildings';
import { isWalkable } from '../src/sim/grid';
import { BORED, REC_GAIN_TABLE } from '../src/sim/needs';
import {
  COMPANY_DETOUR,
  COMPANY_GAIN,
  REC_SPOTS,
  SPOT_RANGE,
  bestSpot,
  claimsOn,
  isRecSpot,
  recLabel,
  recRate,
  usersOf,
} from '../src/sim/recreation';
import type { Building, Pawn, World } from '../src/sim/types';

/**
 * Anywhere a building can actually go, searched outward from a wish — and with
 * room to stand on its east side, because every test in this file sits somebody at
 * `b.x + 1`.
 *
 * That second condition is the whole of a bug this file already documents once,
 * further down, in different clothes. A cell can be perfectly good to build on and
 * have a boulder against its flank; a settler placed inside that boulder is in no
 * region at all, so `reachable` says no to every spot in the colony and the pick
 * comes back null. The symptom is a bored settler who will not go and sit down,
 * which reads as a bug in choosing a spot rather than what it is — the test
 * standing its own subject inside a rock. On the old map (30, 30) happened to have
 * a clear east side; in a valley this size it has a building on it.
 */
function freeCell(world: World, wx: number, wy: number): { x: number; y: number } {
  for (let r = 0; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = wx + dx;
        const y = wy + dy;
        if (!isFree(world, x, y)) continue;
        if (!isFree(world, x + 1, y)) continue;
        return { x, y };
      }
    }
  }
  throw new Error('nowhere to build');
}

/** Is there room to build here, and nobody standing on it? */
function isFree(world: World, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) return false;
  if (world.cellBuilding[y * world.width + x]! >= 0) return false;
  if (!isWalkable(world, x, y)) return false;
  return !world.pawns.some((p) => !p.dead && Math.round(p.x) === x && Math.round(p.y) === y);
}

/**
 * Two clear cells a fixed distance apart, with clear ground in the middle.
 *
 * The alternative is naming coordinates, which is what the comparison below used
 * to do: a table wished at (30,30), a fire at (30,34), and a settler stood at the
 * midpoint of wherever those two actually ended up. It held while those numbers
 * happened to be open ground. When the valley grew they were not — `freeCell`
 * walked the fire eight cells off to find room, and the midpoint of the pair
 * landed inside a boulder. A settler standing in rock is in no region at all, so
 * every spot in the colony read as unreachable and the pick came back null, which
 * is a failure about coordinates wearing the costume of a failure about company.
 *
 * Asking for the shape the test actually needs — two spots, one walk, clear
 * between — cannot rot that way, and it is a better test besides: the two are now
 * exactly equidistant, so quality and company are the only terms left in it.
 */
function facingPair(
  world: World,
  gap = 4,
): { one: { x: number; y: number }; two: { x: number; y: number }; mid: { x: number; y: number } } {
  const half = gap / 2;
  for (let y = 1 + gap; y < world.height - 1 - gap; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      if (![0, half, gap].every((d) => isFree(world, x, y + d))) continue;
      // Room to stand beside each spot, or nobody can sit at them.
      if (!isFree(world, x + 1, y) || !isFree(world, x + 1, y + gap)) continue;
      return { one: { x, y }, two: { x, y: y + gap }, mid: { x, y: y + half } };
    }
  }
  throw new Error('no clear pair on this map');
}

/**
 * Take away everywhere the colony already has to sit.
 *
 * Worldgen puts two tables in the starter cabin, which is right and which would
 * quietly answer half the questions below — a settler passing up a full board is
 * only interesting if the alternative is one the test put there.
 */
function clearSpots(world: World): void {
  for (const b of [...world.buildings]) {
    if (REC_SPOTS[b.kind]) removeBuilding(world, b);
  }
}

/** Stand a finished recreation spot somewhere near a wish, wherever it fits. */
function spot(world: World, kind: 'table' | 'campfire' | 'gametable', wx: number, wy: number): Building {
  const cell = freeCell(world, wx, wy);
  const b = addBuilding(world, kind, cell.x, cell.y, true);
  if (!b) throw new Error('could not build the spot');
  if (kind === 'campfire') b.fuel = 500;
  return b;
}

function settlers(world: World): Pawn[] {
  return world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
}

/** Put somebody next to a spot with nothing else on their mind. */
function sitAt(pawn: Pawn, b: Building): Pawn {
  pawn.x = b.x + 1;
  pawn.y = b.y;
  pawn.path = null;
  pawn.jobId = null;
  pawn.activity = 'relaxing';
  return pawn;
}

/** The only thing this settler could possibly want to do is stop working. */
function makeBored(pawn: Pawn): Pawn {
  pawn.needs.recreation = 0.05;
  pawn.needs.food = 0.9;
  pawn.needs.rest = 0.9;
  pawn.jobId = null;
  pawn.path = null;
  pawn.drafted = false;
  return pawn;
}

const reach = (world: World, pawn: Pawn) => (x: number, y: number) =>
  reachable(world, pawn, x, y, true);

describe('what counts as somewhere to go', () => {
  it('will not seat more people than the spot holds, counting the ones still walking', () => {
    const world = createWorld(41);
    clearSpots(world);
    const board = spot(world, 'gametable', 30, 30);
    const [a, b, c] = settlers(world);

    // Two claims from settlers who have not arrived yet. A seat count that only
    // looks at who is sitting there sends all three, and the third arrives to
    // find a two-seat board with two people at it.
    a.x = board.x + 6;
    a.y = board.y;
    b.x = board.x + 6;
    b.y = board.y + 1;
    for (const p of [a, b]) {
      makeBored(p);
      assignJob(world, p);
    }
    expect(claimsOn(world, board)).toBe(2);

    makeBored(c);
    c.x = board.x + 1;
    c.y = board.y;
    expect(bestSpot(world, c, reach(world, c))).toBeNull();
  });

  it('counts somebody who has arrived and dropped their job exactly once', () => {
    const world = createWorld(42);
    const board = spot(world, 'gametable', 30, 30);
    const [a] = settlers(world);
    sitAt(a, board);

    expect(usersOf(world, board)).toHaveLength(1);
    expect(claimsOn(world, board)).toBe(1);

    // And a settler asking about their own seat is not competing with themselves.
    expect(claimsOn(world, board, a)).toBe(0);
  });

  it('stops being a spot when the fire goes out', () => {
    const world = createWorld(43);
    const fire = spot(world, 'campfire', 30, 30);
    expect(isRecSpot(fire)).toBe(true);

    fire.fuel = 0;
    expect(isRecSpot(fire)).toBe(false);

    // A blueprint is not a place to sit either, however well stocked.
    const cell = freeCell(world, 34, 30);
    const planned = addBuilding(world, 'gametable', cell.x, cell.y, false)!;
    expect(isRecSpot(planned)).toBe(false);
  });

  it('joins the occupied table over the slightly better empty fire', () => {
    const world = createWorld(44);
    clearSpots(world);
    const pair = facingPair(world);
    const table = spot(world, 'table', pair.one.x, pair.one.y);
    const fire = spot(world, 'campfire', pair.two.x, pair.two.y);
    const [a, b] = settlers(world);
    sitAt(a, table);

    // The fire is worth more per tick than the table, and the settler goes to
    // the table anyway, because the company term outweighs that much of a
    // difference. That is the design: the colony gathers, it does not optimise.
    makeBored(b);
    b.x = pair.mid.x;
    b.y = pair.mid.y;
    // The fire is lit, empty, and exactly as far away — so it is a real offer and
    // the only thing left between them is the two terms under test.
    expect(isRecSpot(fire)).toBe(true);
    expect(REC_SPOTS.campfire!.gain - REC_SPOTS.table!.gain).toBeLessThan(COMPANY_GAIN);
    expect(bestSpot(world, b, reach(world, b))?.id).toBe(table.id);
  });

  it('but not over the best thing in the colony standing free', () => {
    const world = createWorld(48);
    clearSpots(world);
    const table = spot(world, 'table', 30, 30);
    const board = spot(world, 'gametable', 30, 34);
    const [a, b] = settlers(world);
    sitAt(a, table);

    // Company is worth a step up in quality, not two. Somebody sitting at the
    // dining table does not make the whole colony ignore the board they built —
    // the second settler goes and plays, and the first will drift over when
    // their turn at the table ends.
    makeBored(b);
    b.x = Math.round((table.x + board.x) / 2);
    b.y = Math.round((table.y + board.y) / 2);
    expect(REC_SPOTS.gametable!.gain - REC_SPOTS.table!.gain).toBeGreaterThan(COMPANY_GAIN);
    expect(bestSpot(world, b, reach(world, b))?.id).toBe(board.id);
  });

  it('will not cross the base for company', () => {
    const world = createWorld(45);
    clearSpots(world);
    const near = spot(world, 'table', 30, 30);
    const far = spot(world, 'table', 30 + COMPANY_DETOUR * 2, 30);
    const [a, b] = settlers(world);
    sitAt(a, far);

    makeBored(b);
    b.x = near.x + 1;
    b.y = near.y;
    // Same quality, one of them occupied — and the walk still costs more than
    // the company is worth, so the settler sits down where they are.
    expect(bestSpot(world, b, reach(world, b))?.id).toBe(near.id);
  });

  it('pays more for an hour spent with other people, up to a crowd', () => {
    const world = createWorld(46);
    const fire = spot(world, 'campfire', 30, 30);
    const all = settlers(world);
    const [a, b, c] = all;

    const alone = recRate(world, a, fire);
    expect(alone).toBeCloseTo(REC_SPOTS.campfire!.gain, 6);

    sitAt(b, fire);
    expect(recRate(world, a, fire)).toBeCloseTo(alone * (1 + COMPANY_GAIN), 6);

    sitAt(c, fire);
    const withTwo = recRate(world, a, fire);
    expect(withTwo).toBeCloseTo(alone * (1 + 2 * COMPANY_GAIN), 6);

    // A fourth body does not make the evening any better. The cap exists so a
    // big colony cannot stack one campfire into a recreation machine.
    for (const p of all.slice(3)) sitAt(p, fire);
    expect(recRate(world, a, fire)).toBeCloseTo(withTwo, 6);
  });

  it('only counts the people actually at the spot, doing nothing', () => {
    const world = createWorld(47);
    const fire = spot(world, 'campfire', 30, 30);
    const [a, b] = settlers(world);

    sitAt(b, fire);
    b.activity = 'working';
    expect(usersOf(world, fire)).toHaveLength(0);

    b.activity = 'relaxing';
    b.x = fire.x + SPOT_RANGE + 1;
    expect(usersOf(world, fire)).toHaveLength(0);

    b.x = fire.x + 1;
    b.dead = true;
    expect(usersOf(world, fire)).toHaveLength(0);
    b.dead = false;
    expect(usersOf(world, fire).map((p) => p.id)).toEqual([b.id]);
    expect(a.id).not.toBe(b.id);
  });

  it('names each spot as the thing it actually is', () => {
    expect(recLabel('campfire')).toBe('sitting by the fire');
    expect(recLabel('gametable')).toBe('playing a game');
    expect(recLabel('table')).toBe('relaxing');
    // Every spot in the table has a name, so a spot added later cannot ship
    // silently labelled as something it is not.
    for (const kind of Object.keys(REC_SPOTS)) {
      expect(recLabel(kind as never).length).toBeGreaterThan(0);
    }
  });
});

describe('an evening in the colony', () => {
  it('gathers bored settlers at one spot instead of queueing them at a table', () => {
    const world = createWorld(51);
    clearSpots(world);
    const fire = spot(world, 'campfire', 30, 30);
    const crowd = settlers(world).slice(0, 3);
    for (const p of crowd) {
      makeBored(p);
      p.x = fire.x + 3;
      p.y = fire.y + (crowd.indexOf(p) - 1);
      p.path = null;
    }

    const rng = makeStreams(world).main;
    // The most people the fire ever held at once, not the count at the end: a
    // settler whose bar is full goes back to work, so the evening is a thing
    // that happens and then finishes rather than a state to read off afterwards.
    let peak = 0;
    for (let t = 0; t < 400; t++) {
      for (const p of crowd) {
        if (p.jobId === null) assignJob(world, p);
        tickJob(world, p, rng);
      }
      peak = Math.max(peak, usersOf(world, fire).length);
    }

    // A six-seat fire and three bored settlers: they should have sat round it
    // together, not one at a time, and the company should have paid.
    expect(peak).toBeGreaterThanOrEqual(2);
    for (const p of crowd) expect(p.needs.recreation).toBeGreaterThan(BORED);
  });

  it('fills a bar faster at the board than at the dining table', () => {
    const rates = (kind: 'table' | 'gametable') => {
      const world = createWorld(52);
      const b = spot(world, kind, 30, 30);
      const p = makeBored(settlers(world)[0]);
      p.x = b.x + 1;
      p.y = b.y;
      const rng = makeStreams(world).main;
      const start = p.needs.recreation;
      for (let t = 0; t < 120; t++) {
        if (p.jobId === null) assignJob(world, p);
        tickJob(world, p, rng);
      }
      return p.needs.recreation - start;
    };

    const table = rates('table');
    const board = rates('gametable');
    expect(table).toBeGreaterThan(0);
    // Alone at each, so the only difference is the spot itself.
    expect(board).toBeCloseTo(table * (REC_SPOTS.gametable!.gain / REC_SPOTS.table!.gain), 3);
    expect(board).toBeGreaterThan(table);
  });

  it('sends a settler back to work when the fire they were sitting at goes out', () => {
    const world = createWorld(53);
    const fire = spot(world, 'campfire', 30, 30);
    const p = makeBored(settlers(world)[0]);
    p.x = fire.x + 1;
    p.y = fire.y;

    const rng = makeStreams(world).main;
    for (let t = 0; t < 60; t++) {
      if (p.jobId === null) assignJob(world, p);
      tickJob(world, p, rng);
    }
    expect(p.activity).toBe('relaxing');
    const job = world.jobs.find((j) => j.id === p.jobId);
    expect(job?.kind).toBe('recreate');

    fire.fuel = 0;
    tickJob(world, p, rng);
    // Cancelled rather than left standing in the dark at a ring of cold stones
    // getting full marks for it.
    expect(world.jobs.some((j) => j.kind === 'recreate' && j.buildingId === fire.id)).toBe(false);
  });

  it('runs off the real tick, with a real bar and a real gain', () => {
    const world = createWorld(54);
    const board = spot(world, 'gametable', 30, 30);
    const p = makeBored(settlers(world)[0]);
    p.x = board.x + 1;
    p.y = board.y;
    stepWorldN(world, makeStreams(world), 150);

    expect(p.needs.recreation).toBeGreaterThan(BORED);
    // And the gain is the module's, not a flat table rate left behind in jobs.ts.
    expect(REC_GAIN_TABLE * REC_SPOTS.gametable!.gain).toBeGreaterThan(REC_GAIN_TABLE);
  });

  it('sells the games table as something a young colony can afford', () => {
    const table = defOf('table');
    const board = defOf('gametable');
    expect(board.buildable).toBe(true);
    expect(board.solid).toBe(true);
    // Cheaper than the thing you eat off, because a colony that cannot afford
    // anywhere to spend an evening is being punished for being young.
    const cost = (c: Record<string, number | undefined>) =>
      (c.wood ?? 0) + (c.steel ?? 0) * 2;
    expect(cost(board.cost)).toBeLessThan(cost(table.cost) + 12);
    expect(BUILD_GROUPS.find((g) => g.name === 'Comfort')?.kinds).toContain('gametable');
  });
});

/**
 * The evening a colony has earned.
 *
 * `BORED` is the level at which sitting down beats *working*, and it has to stay
 * low or nothing gets built. It is the wrong number for a settler with no work to
 * down: measured over twenty days on three seeds, settlers spent between a third
 * and seven eighths of their waking hours idle once the build-out finished, and
 * stood in the yard through all of it at around half recreation — a standing
 * morale drag for want of a chair nobody else was using.
 */
describe('a settler the colony has nothing for', () => {
  /** Take the whole work board away, so `pickWorkJob` genuinely has no answer. */
  function unemployed(pawn: Pawn): Pawn {
    for (const k of Object.keys(pawn.priorities)) {
      pawn.priorities[k as keyof typeof pawn.priorities] = 0;
    }
    pawn.needs.food = 0.9;
    pawn.needs.rest = 0.9;
    pawn.jobId = null;
    pawn.path = null;
    pawn.drafted = false;
    return pawn;
  }

  it('goes and sits down long before it is bored', () => {
    const world = createWorld(55);
    clearSpots(world);
    const table = spot(world, 'table', 30, 30);
    const p = unemployed(settlers(world)[0]!);
    // Half full: nowhere near BORED, so nothing in the need pass wants this.
    p.needs.recreation = 0.5;
    expect(p.needs.recreation).toBeGreaterThan(BORED);
    p.x = table.x + 3;
    p.y = table.y;

    assignJob(world, p);
    expect(p.jobId).not.toBeNull();
    expect(world.jobs.find((j) => j.id === p.jobId)!.kind).toBe('recreate');
  });

  it('leaves a settler who has had their evening alone', () => {
    const world = createWorld(55);
    clearSpots(world);
    const table = spot(world, 'table', 30, 30);
    const p = unemployed(settlers(world)[0]!);
    // Above the line, and above where the recreate job finishes — otherwise a
    // settler would stand up and sit straight back down for ever.
    p.needs.recreation = 0.95;
    p.x = table.x + 3;
    p.y = table.y;

    assignJob(world, p);
    expect(p.jobId).toBeNull();
  });

  it('never takes the seat while there is still work on the board', () => {
    const world = createWorld(55);
    clearSpots(world);
    spot(world, 'table', 30, 30);
    const p = settlers(world)[0]!;
    p.needs.food = 0.9;
    p.needs.rest = 0.9;
    p.needs.recreation = 0.5;
    p.jobId = null;
    p.path = null;
    // A full board and a settler who can work it: hauling, cutting, anything.
    for (let i = 0; i < 40; i++) {
      assignJob(world, p);
      if (p.jobId === null) break;
      const job = world.jobs.find((j) => j.id === p.jobId)!;
      expect(job.kind).not.toBe('recreate');
      // Hand the job back and try again, so this samples the board rather than
      // one lucky pick.
      p.jobId = null;
      world.jobs.splice(world.jobs.indexOf(job), 1);
    }
  });
});
