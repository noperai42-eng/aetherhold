/**
 * Where a hauler puts things down — and what the bench can make out of the result.
 *
 * The bug behind this file, from a twenty-two day headless run of seed 1337: the
 * colony reached the day-twenty raid with a hundred and one steel, a built bench,
 * every settler on craft priority three — and its best shot standing there with
 * no weapon at all. The steel was in five piles of 16, 32, 14, 9 and 30, on five
 * adjacent cells of the same stockpile, because every miner dropped on whichever
 * cell was nearest the vein they had just come from and stacks only ever merge
 * within one cell. A rifle costs thirty-five out of a *single* stack, so the job
 * never formed. Nothing logged. The colony was wiped by six raiders.
 *
 * There were two failures stacked on top of each other, and this file pins both:
 * the hauler never consolidating, and the bench treating "wanted" as "makeable"
 * — an impossible rifle sat in front of the medicine the colony could have been
 * making the whole time.
 */

import { describe, expect, it } from 'vitest';

import { FREEZING, cellTemp } from '../src/sim/temperature';
import { addBuilding, addCellToZone, addItem, addZone, livingColonists, removeItem } from '../src/sim/world';
import { benchRecipe, findStockpileCell, wantedRecipe } from '../src/sim/jobs';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { CABIN, HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';
import { TICKS_PER_DAY } from '../src/sim/types';
import { isWalkable } from '../src/sim/grid';
import { findPath } from '../src/sim/path';
import { setPriority } from '../src/sim/orders';
import { tickPower } from '../src/sim/power';
import type { Cell, World, Zone } from '../src/sim/types';
import { qualifyAll } from './qualify';

/** The starter world with an empty floor: these tests count every stack by hand. */
function bare(seed = 20260731): World {
  const world = createWorld(seed);
  world.items.length = 0;
  for (const p of world.pawns) p.carryingItemId = null;
  // The bug this file pins is about stacks, not about who is allowed to craft, so
  // the settlers here can make both recipes and the failure can only be the heap.
  qualifyAll(world, 'rifle', 'medicine');
  return world;
}

/** The cabin stockpile worldgen paints: four cells across, three deep. */
function pile(world: World): Zone {
  const z = world.zones.find((zz) => zz.kind === 'stockpile');
  expect(z).toBeDefined();
  return z!;
}

/**
 * Open ground a long walk from the cabin, for the depot nobody should use.
 *
 * Searched rather than written down: the only cells worldgen promises are clear
 * are the ones in the yard, and the yard is exactly what "far away" must not be.
 */
function farOpen(world: World): Cell {
  for (let d = 20; d < 30; d++) {
    for (const c of [
      { x: HOME_X - d, y: HOME_Y - d },
      { x: HOME_X + d, y: HOME_Y - d },
      { x: HOME_X - d, y: HOME_Y + d },
    ]) {
      if (isWalkable(world, c.x, c.y)) return c;
    }
  }
  throw new Error('nowhere open far from the cabin');
}

/**
 * Open ground the colony can actually walk to, a few heaps' worth, spread out.
 *
 * The heaps were written down for a long time — (33,33), (24,39), (40,30) — and
 * those were yard cells while the valley was 96 across and the cabin sat at
 * (48,48). The cabin is measured from the middle of the map, so growing the
 * valley moved it and left the constants forty cells out in country that is rock
 * on plenty of seeds. Steel nobody can reach is not a scattered stockpile, it is
 * no stockpile at all, and the failure lies about which: the test read back a
 * peak pile of twenty and called it a colony that never converges its steel, when
 * what actually happened is that four heaps in five were on the wrong side of a
 * boulder field.
 */
function scatter(world: World, n: number): Cell[] {
  const out: Cell[] = [];
  for (let d = 5; d < 24 && out.length < n; d++) {
    for (let a = 0; a < 8 && out.length < n; a++) {
      const x = HOME_X + Math.round(d * Math.cos((a * Math.PI) / 4));
      const y = HOME_Y + Math.round(d * Math.sin((a * Math.PI) / 4));
      if (!isWalkable(world, x, y)) continue;
      if (out.some((c) => Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) < 3)) continue;
      if (!findPath(world, HOME_X, HOME_Y, x, y)) continue;
      out.push({ x, y });
    }
  }
  if (out.length < n) throw new Error('not enough open ground near the cabin');
  return out;
}

/** The nth empty walkable cell inside the cabin, scanning from the door end. */
function freeCabinCell(world: World, skip: number): Cell {
  let seen = 0;
  for (let y = CABIN.y1 - 1; y > CABIN.y0; y--) {
    for (let x = CABIN.x0 + 1; x < CABIN.x1; x++) {
      if (!isWalkable(world, x, y)) continue;
      if (seen++ < skip) continue;
      return { x, y };
    }
  }
  throw new Error('cabin has no room');
}

describe('choosing a cell to put it down on', () => {
  it('tops up a pile that is already there rather than starting a new one', () => {
    const world = bare();
    addItem(world, 'steel', 20, HOME_X + 4, HOME_Y + 3);

    // The near corner of the stockpile is empty and under the hauler's feet; the
    // pile is three cells off.
    expect(findStockpileCell(world, 'steel', { x: HOME_X + 1, y: HOME_Y + 1 })).toEqual({ x: HOME_X + 4, y: HOME_Y + 3 });
  });

  it('feeds the fullest pile in reach, not the nearest one', () => {
    const world = bare();
    addItem(world, 'steel', 10, HOME_X + 1, HOME_Y + 1);
    addItem(world, 'steel', 40, HOME_X + 4, HOME_Y + 3);

    // The whole point is to get *one* pile over a recipe's threshold. Topping up
    // whichever heap is closest keeps them all growing in step, which is the
    // shape of the original bug.
    expect(findStockpileCell(world, 'steel', { x: HOME_X + 1, y: HOME_Y + 1 })).toEqual({ x: HOME_X + 4, y: HOME_Y + 3 });
  });

  it('will not walk the map to do it', () => {
    const world = bare();
    const far = farOpen(world);
    expect(isWalkable(world, far.x, far.y)).toBe(true);
    const depot = addZone(world, 'stockpile', ['steel']);
    addCellToZone(world, depot, far.x, far.y);
    addItem(world, 'steel', 40, far.x, far.y);

    // A pile twenty cells away is not worth the walk: a colony that carried every
    // armful to the far depot would spend its whole day in transit.
    const dest = findStockpileCell(world, 'steel', { x: HOME_X + 2, y: HOME_Y + 2 })!;
    expect(dest).not.toEqual(far);
    expect(dest.x).toBeGreaterThanOrEqual(HOME_X + 1);
  });

  it('skips a cell whose pile is already full', () => {
    const world = bare();
    addItem(world, 'steel', 75, HOME_X + 1, HOME_Y + 1);

    expect(findStockpileCell(world, 'steel', { x: HOME_X + 1, y: HOME_Y + 1 })).not.toEqual({ x: HOME_X + 1, y: HOME_Y + 1 });
  });

  it('still sends anything that rots to the cold store first', () => {
    const world = bare();
    const shelf = coldStore(world);
    addCellToZone(world, pile(world), shelf.x, shelf.y);
    // A warm pile with room in it, directly under the hauler's feet. Freezing the
    // food still wins: the cold room is the only reason a player built one.
    addItem(world, 'rawfood', 20, HOME_X + 2, HOME_Y + 2);
    expect(cellTemp(world, shelf.x, shelf.y)).toBeLessThan(FREEZING);
    expect(cellTemp(world, HOME_X + 2, HOME_Y + 2)).toBeGreaterThan(FREEZING);

    expect(findStockpileCell(world, 'rawfood', { x: HOME_X + 2, y: HOME_Y + 2 })).toEqual(shelf);
  });
});

/**
 * A walled pantry off the cabin with a powered cooler in it — the same six cells
 * the Steward partitions. A cooler holds a room, not a radius, so the room has to
 * exist before anything in it goes below zero; and the powered flag is written by
 * the power pass, so it is switched on by running that rather than by hand.
 */
function coldStore(world: World): Cell {
  const at = { x: CABIN.x0 + 1, y: CABIN.y1 - 2 };
  for (let x = at.x; x < at.x + 3; x++) {
    expect(addBuilding(world, 'wall', x, at.y - 1, true)).not.toBeNull();
  }
  expect(addBuilding(world, 'wall', at.x + 3, at.y + 1, true)).not.toBeNull();
  expect(addBuilding(world, 'door', at.x + 3, at.y, true)).not.toBeNull();
  const cooler = addBuilding(world, 'cooler', at.x, at.y + 1, true);
  expect(cooler).not.toBeNull();
  addItem(world, 'wood', 400, CABIN.x0 + 4, CABIN.y0 + 4);
  tickPower(world);
  expect(cooler!.powered).toBe(true);
  return { x: at.x + 1, y: at.y + 1 };
}

describe('what the bench does with a stockpile it cannot spend', () => {
  it('wants a rifle it has no single stack to make', () => {
    const world = bare();
    const pawn = livingColonists(world)[0]!;
    pawn.weapon = 'club';
    for (let i = 0; i < 3; i++) addItem(world, 'steel', 30, HOME_X + 1 + i, HOME_Y + 1);

    // Ninety steel on the floor, and not thirty-five of it in one place.
    expect(wantedRecipe(world, pawn)).toBe('rifle');
    expect(benchRecipe(world, pawn)).toBeNull();
  });

  it('makes the medicine it can rather than nothing at all', () => {
    const world = bare();
    const pawn = livingColonists(world)[0]!;
    pawn.weapon = 'club';
    for (let i = 0; i < 3; i++) addItem(world, 'steel', 30, HOME_X + 1 + i, HOME_Y + 1);
    addItem(world, 'rawfood', 40, HOME_X + 2, HOME_Y + 2);

    // This is the second half of the bug: the impossible rifle used to be the
    // only answer this ever gave, and it starved the shelf for twenty days.
    expect(benchRecipe(world, pawn)?.recipe).toBe('medicine');
  });

  it('still puts the rifle first once one heap is big enough', () => {
    const world = bare();
    const pawn = livingColonists(world)[0]!;
    pawn.weapon = 'club';
    addItem(world, 'steel', 40, HOME_X + 1, HOME_Y + 1);
    addItem(world, 'steel', 30, 34, 33);
    addItem(world, 'rawfood', 40, HOME_X + 2, HOME_Y + 2);

    expect(benchRecipe(world, pawn)?.recipe).toBe('rifle');
  });
});

// ---------------------------------------------------------------------------
// Experience: does a colony sitting on scattered steel ever arm itself?
// ---------------------------------------------------------------------------

describe('the armoury, played', () => {
  it('converges the piles and arms a settler who started with a club', () => {
    const world = createWorld(20260731);
    qualifyAll(world, 'rifle', 'medicine');
    const streams = makeStreams(world);
    for (const s of [...world.items]) if (s.kind === 'steel') removeItem(world, s);
    for (const p of world.pawns) p.carryingItemId = null;

    const bench = freeCabinCell(world, 0);
    expect(addBuilding(world, 'bench', bench.x, bench.y, true)).not.toBeNull();
    for (const p of livingColonists(world)) {
      p.weapon = 'club';
      setPriority(world, p.id, 'craft', 3);
      setPriority(world, p.id, 'haul', 3);
      // No scouting: a cache found in the woods is steel arriving from outside
      // the experiment, and this one is about the steel already on the floor.
      setPriority(world, p.id, 'scout', 0);
    }

    // Eighty steel in four heaps of twenty — the day-twenty stockpile, in
    // miniature. Nobody can make a rifle out of any of it.
    const heaps = scatter(world, 6);
    for (let i = 0; i < 4; i++) addItem(world, 'steel', 20, heaps[i]!.x, heaps[i]!.y);
    const first = livingColonists(world)[0]!;
    expect(wantedRecipe(world, first)).toBe('rifle');
    expect(benchRecipe(world, first)?.recipe).not.toBe('rifle');

    // Two more armfuls come in off the map, the way mined ore does.
    addItem(world, 'steel', 20, heaps[4]!.x, heaps[4]!.y);
    addItem(world, 'steel', 20, heaps[5]!.x, heaps[5]!.y);

    // Measured as a peak rather than an end state: the pile the haulers build is
    // spent the moment it is big enough, which is the whole point of building it.
    let peak = 0;
    for (let i = 0; i < TICKS_PER_DAY * 3; i += 40) {
      stepWorldN(world, streams, 40);
      for (const s of world.items) if (s.kind === 'steel') peak = Math.max(peak, s.amount);
    }

    expect(peak).toBeGreaterThanOrEqual(35);
    expect(livingColonists(world).some((p) => p.weapon === 'rifle')).toBe(true);
  });
});
