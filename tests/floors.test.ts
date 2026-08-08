/**
 * Laid floors — the ground a colony makes for itself.
 *
 * The functional half pins the three rules the feature rests on: where a floor
 * may go, what it costs, and what it changes about the cell underneath it. The
 * experience half is the only question a player asks about a road — I painted
 * the boards, did anybody go and lay them, and is the walk actually shorter
 * afterwards.
 *
 * The save assertion is load-bearing rather than decorative. Floors are stored
 * as an index into `TERRAIN_LIST`, so appending to that list is safe and
 * reordering it silently turns every plank floor in every old save into
 * something else. The test reads the indices back by name for exactly that
 * reason.
 */

import { describe, expect, it } from 'vitest';

import {
  FLOOR_DEFS,
  canFloor,
  canRemoveFloor,
  desigForFloor,
  floorAt,
  floorForDesig,
  layFloor,
  removeFloor,
} from '../src/sim/floors';
import { CROP_NONE, canSow, canTill, cropAt } from '../src/sim/farming';
import { igniteFire, tickFires } from '../src/sim/events';
import { isSolid, moveCost } from '../src/sim/grid';
import { WALK_SPEED, followPath, setPathTo } from '../src/sim/movement';
import { designate, orderJob, setManual, setPriority } from '../src/sim/orders';
import { Rng } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import {
  DESIG_DECONSTRUCT,
  DESIG_FLOOR_PAVED,
  DESIG_FLOOR_PLANK,
  DESIG_NONE,
  TERRAIN_LIST,
  TERRAIN_SPEED,
  isFloor,
  packCell,
  terrainAt,
  terrainSpeed,
} from '../src/sim/types';
import type { FloorKind, Pawn, Terrain, World } from '../src/sim/types';
import { addBuilding, addItem, countResource, itemsAt, livingColonists } from '../src/sim/world';
import { CABIN, createWorld } from '../src/sim/worldgen';

function game(seed = 4242) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

function setTerrain(world: World, x: number, y: number, t: Terrain): void {
  world.terrain[packCell(world, x, y)] = TERRAIN_LIST.indexOf(t);
}

/**
 * Open ground near the cabin, scanned rather than hard-coded: worldgen scatters
 * trees and rock by seed, so a fixed cell is a clear yard on one seed and the
 * inside of a boulder on the next.
 */
function openCell(world: World): { x: number; y: number } {
  for (let r = 2; r < 14; r++) {
    for (let y = CABIN.y0 - r; y <= CABIN.y1 + r; y++) {
      for (let x = CABIN.x0 - r; x <= CABIN.x1 + r; x++) {
        if (canFloor(world, x, y, 'plank')) {
          return { x, y };
        }
      }
    }
  }
  throw new Error('no open ground on this seed');
}

/**
 * A 5×5 patch with nothing built in it. The fire test needs one: a single tree
 * inside the patch is flammable, and paving is only a firebreak for the ground
 * — a fire will happily cross it to reach something that burns.
 */
function openYard(world: World): { x: number; y: number } {
  for (let y = 4; y < world.height - 4; y++) {
    scan: for (let x = 4; x < world.width - 4; x++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (world.cellBuilding[(y + dy) * world.width + x + dx]! >= 0) continue scan;
          if (cropAt(world, x + dx, y + dy) !== CROP_NONE) continue scan;
        }
      }
      return { x, y };
    }
  }
  throw new Error('no clear yard on this seed');
}

/**
 * A straight east-west run of clear ground, for measuring a walk over it.
 *
 * The nearest one to the cabin, which is a change from "the first one the scan
 * finds" and worth a line. Scanning from (2,2) means the top-left corner, and the
 * corner of a valley twice the width is a hundred and thirty cells from home
 * rather than sixty. One of these runs is walked by a pawn placed on it and does
 * not care; the other is laid by settlers who have to get there, and it stopped
 * finishing inside its tick budget — not because anything about laying floors
 * changed, but because the test had been quietly asking them to cross the map
 * first. Near home the errand is the thing the test is about.
 */
function clearRun(world: World, len: number): { x: number; y: number } {
  const hx = Math.round(world.width / 2);
  const hy = Math.round(world.height / 2);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = 2; y < world.height - 2; y++) {
    scan: for (let x = 2; x < world.width - len - 2; x++) {
      const d = Math.hypot(x + len / 2 - hx, y - hy);
      if (d >= bestD) continue;
      for (let i = 0; i < len; i++) {
        if (isSolid(world, x + i, y)) continue scan;
        if (world.cellBuilding[y * world.width + x + i]! >= 0) continue scan;
        if (terrainAt(world, x + i, y) === 'sand') continue scan;
      }
      best = { x, y };
      bestD = d;
    }
  }
  if (!best) throw new Error('no clear run on this seed');
  return best;
}

/** Everyone on construction and nothing else, so a floor order is the work on offer. */
function buildersOnly(world: World): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
      setPriority(world, p.id, w, w === 'construct' ? 3 : 0);
    }
  }
}

describe('where a floor can be laid', () => {
  it('accepts plain open ground', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'grass');
    expect(canFloor(world, c.x, c.y, 'plank')).toBe(true);
    expect(canFloor(world, c.x, c.y, 'paved')).toBe(true);
  });

  it('refuses rock and water — nobody can stand there to lay it', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'rock');
    expect(canFloor(world, c.x, c.y, 'plank')).toBe(false);
    setTerrain(world, c.x, c.y, 'water');
    expect(canFloor(world, c.x, c.y, 'plank')).toBe(false);
  });

  it('refuses ground that already wears that floor, and allows swapping the other one in', () => {
    const { world } = game();
    const c = openCell(world);
    layFloor(world, c.x, c.y, 'plank');
    expect(canFloor(world, c.x, c.y, 'plank')).toBe(false);
    // Changing your mind is how you take a floor up — there is no un-lay.
    expect(canFloor(world, c.x, c.y, 'paved')).toBe(true);
  });

  it('refuses a cell with a crop in it — boards over a seedling would eat the harvest', () => {
    const { world } = game();
    const c = openCell(world);
    world.crops[packCell(world, c.x, c.y)] = 0.5;
    expect(canFloor(world, c.x, c.y, 'plank')).toBe(false);
  });

  it('refuses a walled cell but allows the floor under furniture', () => {
    const { world } = game();
    const a = openCell(world);
    expect(addBuilding(world, 'wall', a.x, a.y, true)).not.toBeNull();
    expect(canFloor(world, a.x, a.y, 'plank')).toBe(false);

    // The whole reason floors are terrain: a cell holds one building, so boards
    // under a bed have to be the ground rather than a second thing standing there.
    const b = openCell(world);
    expect(addBuilding(world, 'bed', b.x, b.y, true)).not.toBeNull();
    expect(canFloor(world, b.x, b.y, 'plank')).toBe(true);
  });

  it('refuses cells off the map', () => {
    const { world } = game();
    expect(canFloor(world, -1, 5, 'plank')).toBe(false);
    expect(canFloor(world, world.width, 5, 'paved')).toBe(false);
  });
});

describe('the floor order', () => {
  it('maps each designation to its floor and back', () => {
    expect(floorForDesig(DESIG_FLOOR_PLANK)).toBe('plank');
    expect(floorForDesig(DESIG_FLOOR_PAVED)).toBe('paved');
    expect(floorForDesig(DESIG_NONE)).toBeNull();
    expect(desigForFloor('plank')).toBe(DESIG_FLOOR_PLANK);
    expect(desigForFloor('paved')).toBe(DESIG_FLOOR_PAVED);
  });

  it('takes on ground it can floor and refuses ground it cannot', () => {
    const { world } = game();
    const c = openCell(world);
    expect(designate(world, c.x, c.y, DESIG_FLOOR_PLANK)).toBe(true);
    expect(world.cellDesig[packCell(world, c.x, c.y)]).toBe(DESIG_FLOOR_PLANK);

    setTerrain(world, c.x, c.y, 'water');
    expect(designate(world, c.x, c.y, DESIG_FLOOR_PAVED)).toBe(false);
  });

  it('can be rubbed out again', () => {
    const { world } = game();
    const c = openCell(world);
    designate(world, c.x, c.y, DESIG_FLOOR_PLANK);
    expect(designate(world, c.x, c.y, DESIG_NONE)).toBe(true);
    expect(world.cellDesig[packCell(world, c.x, c.y)]).toBe(DESIG_NONE);
  });

  it('charges wood for boards and steel for paving', () => {
    expect(FLOOR_DEFS.plank.cost).toBe('wood');
    expect(FLOOR_DEFS.paved.cost).toBe('steel');
    // Paving is the dearer floor in work as well as in material, which is what
    // makes boards the thing you lay first and paving the thing you lay on purpose.
    expect(FLOOR_DEFS.paved.work).toBeGreaterThan(FLOOR_DEFS.plank.work);
  });
});

describe('what a floor changes about the cell', () => {
  it('walks faster than open ground, and paving faster than boards', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'grass');
    const bare = terrainSpeed(world, c.x, c.y);
    layFloor(world, c.x, c.y, 'plank');
    const plank = terrainSpeed(world, c.x, c.y);
    layFloor(world, c.x, c.y, 'paved');
    const paved = terrainSpeed(world, c.x, c.y);
    expect(plank).toBeGreaterThan(bare);
    expect(paved).toBeGreaterThan(plank);
  });

  it('costs a router less to cross, by more than the speed bonus is worth', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'grass');
    const bare = moveCost(world, c.x, c.y);
    layFloor(world, c.x, c.y, 'plank');
    const plank = moveCost(world, c.x, c.y);
    layFloor(world, c.x, c.y, 'paved');
    const paved = moveCost(world, c.x, c.y);
    expect(plank).toBeLessThan(bare);
    expect(paved).toBeLessThan(plank);
    // A* has to want the road more than the road strictly saves, or a settler
    // takes the diagonal across the grass and the path you built goes unused.
    // The break-even discount is 1/speed — anything above that and the router
    // would rather cut the corner than follow the boards.
    expect(plank).toBeLessThan(1 / TERRAIN_SPEED.plank);
    expect(paved).toBeLessThan(1 / TERRAIN_SPEED.paved);
  });

  it('cannot be farmed — no tilling it, no sowing it', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'grass');
    expect(canTill(world, c.x, c.y)).toBe(true);
    layFloor(world, c.x, c.y, 'plank');
    expect(canTill(world, c.x, c.y)).toBe(false);
    expect(canSow(world, c.x, c.y)).toBe(false);
    expect(isFloor(terrainAt(world, c.x, c.y))).toBe(true);
  });

  it('does not carry a fire across paving, but grass does', () => {
    /** How many cells other than the source ever caught, over a fixed window. */
    const spread = (ground: Terrain): number => {
      const { world } = game();
      const c = openYard(world);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setTerrain(world, c.x + dx, c.y + dy, ground);
      }
      // Dry weather: rain smothers a fire before it can travel, and this test is
      // about the ground rather than the sky.
      world.weather = { ...world.weather, kind: 'clear', blend: 0 };
      const rng = new Rng(7);
      const caught = new Set<number>();
      for (let i = 0; i < 2000; i++) {
        world.tick++;
        // Keep the source alight at a size that spreads (>0.5) but does not trip
        // the burn-out roll (>0.85), so both runs get the same 80 spread attempts.
        let src = world.fires.find((f) => f.x === c.x && f.y === c.y);
        if (!src) {
          igniteFire(world, c.x, c.y);
          src = world.fires[world.fires.length - 1]!;
        }
        src.size = 0.6;
        tickFires(world, rng);
        for (const f of world.fires) {
          if (f.x !== c.x || f.y !== c.y) caught.add(packCell(world, f.x, f.y));
        }
      }
      return caught.size;
    };
    expect(spread('grass')).toBeGreaterThan(0);
    expect(spread('paved')).toBe(0);
  });

  it('survives a save, by name and not by luck of the index', () => {
    const { world } = game();
    const c = openCell(world);
    layFloor(world, c.x, c.y, 'plank');
    layFloor(world, c.x + 1, c.y, 'paved');
    const text = serialize(
      world,
      {
        mode: 'manager',
        possessedId: null,
        camera: { targetX: 0, targetY: 0, distance: 10, yaw: 0, pitch: 1 },
      },
      1,
      0,
    );
    const res = deserialize(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(terrainAt(res.save.world, c.x, c.y)).toBe('plank');
    expect(terrainAt(res.save.world, c.x + 1, c.y)).toBe('paved');
  });
});

/**
 * Taking a floor back up.
 *
 * The header of `floors.ts` used to end by saying this was impossible: a floor is
 * terrain, laying terrain destroys what it covered, and the only way to change
 * your mind was to lay something else on top. What makes it possible is one note
 * per floored cell — `world.floorUnder`, written when boards first go over open
 * ground — and every test in here is about that note. Where it is written, where
 * it deliberately is not, and what happens when it is missing, because every
 * colony saved before today has floors nobody wrote down.
 */
describe('taking a floor up again', () => {
  it('puts back the ground it covered rather than a default one', () => {
    const { world } = game();
    const c = openCell(world);
    // Sand, because it is nobody's fallback. Grass would pass this test whether
    // the note was read or quietly ignored.
    setTerrain(world, c.x, c.y, 'sand');
    layFloor(world, c.x, c.y, 'plank');
    expect(terrainAt(world, c.x, c.y)).toBe('plank');

    removeFloor(world, c.x, c.y);

    expect(terrainAt(world, c.x, c.y)).toBe('sand');
  });

  it('remembers the original ground through a change of floor, not the floor before', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'sand');
    layFloor(world, c.x, c.y, 'plank');
    // The player changes their mind about the material, which is the one thing
    // they could always do. The note must not follow.
    layFloor(world, c.x, c.y, 'paved');

    removeFloor(world, c.x, c.y);

    // Sand, not plank. A note that got overwritten here would hand back boards
    // nobody laid and lose the sand for good.
    expect(terrainAt(world, c.x, c.y)).toBe('sand');
  });

  it('falls back to grass for a floor laid before anyone was writing it down', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'sand');
    // Exactly what an old save looks like: the terrain says plank and there is no
    // note. Not reachable through `layFloor`, which is the point of writing it by
    // hand — this is the shape loaded off disk, not the shape the sim produces.
    setTerrain(world, c.x, c.y, 'plank');
    expect(world.floorUnder?.[packCell(world, c.x, c.y)]).toBeUndefined();

    removeFloor(world, c.x, c.y);

    expect(terrainAt(world, c.x, c.y)).toBe('grass');
  });

  it('gives a bridge back to the lake, with no note needed', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'water');
    layFloor(world, c.x, c.y, 'bridge');
    // Nothing written down: water is the only ground a bridge is ever allowed on,
    // so what is under it is known rather than remembered.
    expect(world.floorUnder?.[packCell(world, c.x, c.y)]).toBeUndefined();

    removeFloor(world, c.x, c.y);

    expect(terrainAt(world, c.x, c.y)).toBe('water');
  });

  it('refuses ground that is not a floor, and a floor with something standing on it', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'grass');
    expect(canRemoveFloor(world, c.x, c.y)).toBe(false);

    layFloor(world, c.x, c.y, 'plank');
    expect(canRemoveFloor(world, c.x, c.y)).toBe(true);

    // The bed goes first. Ripping the boards out from under it would be the tool
    // reaching past what the player clicked on.
    expect(addBuilding(world, 'bed', c.x, c.y, true)).not.toBeNull();
    expect(canRemoveFloor(world, c.x, c.y)).toBe(false);
    expect(floorAt(world, c.x, c.y)).toBe('plank');
  });

  it('reads the X tool as the building first and the floor underneath second', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'grass');
    // Bare ground: there is nothing on this cell to take off it.
    expect(designate(world, c.x, c.y, DESIG_DECONSTRUCT)).toBe(false);

    layFloor(world, c.x, c.y, 'plank');
    expect(designate(world, c.x, c.y, DESIG_DECONSTRUCT)).toBe(true);
    expect(world.cellDesig[packCell(world, c.x, c.y)]).toBe(DESIG_DECONSTRUCT);

    // Same key, same cell, different meaning once there is furniture on it — and
    // the order still lands, because now it is the bed being marked.
    designate(world, c.x, c.y, DESIG_NONE);
    expect(addBuilding(world, 'bed', c.x, c.y, true)).not.toBeNull();
    expect(designate(world, c.x, c.y, DESIG_DECONSTRUCT)).toBe(true);
    expect(canRemoveFloor(world, c.x, c.y)).toBe(false);
  });

  it('carries the note through a save, so a reloaded colony can still lift its boards', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'sand');
    layFloor(world, c.x, c.y, 'plank');
    const text = serialize(
      world,
      {
        mode: 'manager',
        possessedId: null,
        camera: { targetX: 0, targetY: 0, distance: 10, yaw: 0, pitch: 1 },
      },
      1,
      0,
    );
    const res = deserialize(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    removeFloor(res.save.world, c.x, c.y);

    // The whole reason the note is a plain object of numbers rather than
    // anything cleverer: it has to survive JSON without being taught how.
    expect(terrainAt(res.save.world, c.x, c.y)).toBe('sand');
  });

  it('takes a hand-issued order to lift a floor, but only where one was marked', () => {
    const { world } = game();
    const p = livingColonists(world)[0];
    setManual(world, p.id, true);
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'sand');
    layFloor(world, c.x, c.y, 'plank');

    // Unmarked, the boards are somewhere to walk to — `orderJob`'s last resort
    // is always a walk, so the order is accepted either way and the code it
    // returns cannot tell the two apart. What it queued can. A player who clicks
    // their own corridor while driving a settler by hand means "go there", and
    // losing the corridor to that click is the sort of thing you cannot undo.
    expect(orderJob(world, p.id, c.x, c.y)).toBe('ok');
    expect(world.jobs.some((j) => j.kind === 'deconstruct')).toBe(false);
    expect(floorAt(world, c.x, c.y)).toBe('plank');

    designate(world, c.x, c.y, DESIG_DECONSTRUCT);
    expect(orderJob(world, p.id, c.x, c.y)).toBe('ok');
    expect(world.jobs.some((j) => j.kind === 'deconstruct' && j.floorX === c.x)).toBe(true);
  });

  it('will not hand two settlers the same square to lift', () => {
    const { world } = game();
    const [a, b] = livingColonists(world);
    setManual(world, a.id, true);
    setManual(world, b.id, true);
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'sand');
    layFloor(world, c.x, c.y, 'plank');
    designate(world, c.x, c.y, DESIG_DECONSTRUCT);

    expect(orderJob(world, a.id, c.x, c.y)).toBe('ok');
    // Same answer the mining and tilling orders give, and for the same reason:
    // the second settler would arrive to find nothing there and stand about.
    expect(orderJob(world, b.id, c.x, c.y)).toBe('taken');
  });
});

describe('the road, played', () => {
  it('sends a settler to fetch boards and leaves a floor behind', () => {
    const { world, streams } = game();
    buildersOnly(world);
    // Just outside the cabin door, so the walk is short enough to finish inside
    // the window without the test asserting anything about pathfinding.
    const x = CABIN.doorX;
    const y = CABIN.doorY + 2;
    setTerrain(world, x, y, 'grass');
    world.crops[packCell(world, x, y)] = CROP_NONE;
    addItem(world, 'wood', 40, CABIN.doorX, CABIN.doorY + 1);
    const wood = countResource(world, 'wood');
    expect(designate(world, x, y, DESIG_FLOOR_PLANK)).toBe(true);

    stepWorldN(world, streams, 1500);

    expect(terrainAt(world, x, y)).toBe('plank');
    expect(world.cellDesig[packCell(world, x, y)]).toBe(DESIG_NONE);
    expect(countResource(world, 'wood')).toBeLessThan(wood);
  });

  it('lays a whole corridor without two settlers fighting over one cell', () => {
    const { world, streams } = game();
    buildersOnly(world);
    const run = clearRun(world, 5);
    const cells: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 5; i++) {
      const cell = { x: run.x + i, y: run.y };
      world.crops[packCell(world, cell.x, cell.y)] = CROP_NONE;
      if (!designate(world, cell.x, cell.y, DESIG_FLOOR_PLANK)) continue;
      cells.push(cell);
    }
    expect(cells.length).toBeGreaterThanOrEqual(4);
    addItem(world, 'wood', 60, run.x, run.y + 1);

    stepWorldN(world, streams, 4000);

    // Two settlers claiming one cell shows up as a job that never lands, so the
    // assertion that matters is that the whole run finished, not that it started.
    for (const c of cells) expect(terrainAt(world, c.x, c.y)).toBe('plank');
    expect(livingColonists(world).length).toBeGreaterThan(0);
  });

  it('gets a body across a paved run faster than the same run of grass', () => {
    const walk = (paved: boolean): number => {
      const { world } = game();
      const run = clearRun(world, 8);
      for (let i = 0; i < 8; i++) {
        setTerrain(world, run.x + i, run.y, paved ? 'paved' : 'grass');
      }
      const pawn = livingColonists(world)[0] as Pawn;
      pawn.x = run.x;
      pawn.y = run.y;
      expect(setPathTo(world, pawn, run.x + 7, run.y)).toBe(true);
      let ticks = 0;
      while (ticks < 400 && !followPath(world, pawn, WALK_SPEED)) ticks++;
      expect(ticks).toBeLessThan(400);
      return ticks;
    };
    const grass = walk(false);
    const paved = walk(true);
    expect(paved).toBeLessThan(grass);
    // Not just faster — noticeably faster, or the player paid steel for nothing.
    expect(paved).toBeLessThan(grass * 0.85);
  });

  it('clears the order and keeps the boards if the ground changes under it', () => {
    const { world, streams } = game();
    buildersOnly(world);
    const x = CABIN.doorX;
    const y = CABIN.doorY + 2;
    setTerrain(world, x, y, 'grass');
    world.crops[packCell(world, x, y)] = CROP_NONE;
    addItem(world, 'wood', 40, CABIN.doorX, CABIN.doorY + 1);
    designate(world, x, y, DESIG_FLOOR_PLANK);
    stepWorldN(world, streams, 60);
    // Somebody walls the cell while the boards are on their way.
    expect(addBuilding(world, 'wall', x, y, true)).not.toBeNull();

    stepWorldN(world, streams, 400);

    expect(world.cellDesig[packCell(world, x, y)]).toBe(DESIG_NONE);
    expect(terrainAt(world, x, y)).not.toBe('plank');
    // The wood went back on the ground rather than evaporating with the job.
    expect(countResource(world, 'wood')).toBeGreaterThan(0);
    expect(world.jobs.some((j) => j.kind === 'floor')).toBe(false);
  });

  it('sends a settler out to lift a floor and leaves the old ground behind', () => {
    const { world, streams } = game();
    buildersOnly(world);
    // The same doorstep the laying test uses, so this is about the order being
    // picked up and not about how far it is to the far side of the valley.
    const x = CABIN.doorX;
    const y = CABIN.doorY + 2;
    setTerrain(world, x, y, 'sand');
    world.crops[packCell(world, x, y)] = CROP_NONE;
    layFloor(world, x, y, 'plank');
    expect(designate(world, x, y, DESIG_DECONSTRUCT)).toBe(true);

    // Stepped one tick at a time and stopped on the tick the boards come up,
    // rather than run for a flat fifteen hundred and looked afterwards. The
    // payout is a loose stack on an open square outside the cabin door, and a
    // settler on construction will pick loose wood back up to feed the next
    // blueprint — so a fixed run measures whether anything else wanted the plank
    // more, which is not what this test is about. The moment of the lift is.
    let lifted = 0;
    while (lifted < 1500 && terrainAt(world, x, y) !== 'sand') {
      stepWorldN(world, streams, 1);
      lifted++;
    }

    // The three things a player watches for: the boards are gone, the sand is
    // back rather than a default green patch, and the order rubbed itself out.
    expect(lifted).toBeLessThan(1500);
    expect(terrainAt(world, x, y)).toBe('sand');
    expect(world.cellDesig[packCell(world, x, y)]).toBe(DESIG_NONE);
    // And half the wood is lying where it was lifted, the same deal a
    // deconstructed wall pays.
    expect(itemsAt(world, x, y).some((s) => s.kind === 'wood')).toBe(true);
  });
});

describe('every floor kind is a real, laid-down thing', () => {
  it('has a def for every kind, and every kind is in the terrain list', () => {
    for (const kind of Object.keys(FLOOR_DEFS) as FloorKind[]) {
      expect(FLOOR_DEFS[kind].amount).toBeGreaterThan(0);
      expect(FLOOR_DEFS[kind].work).toBeGreaterThan(0);
      expect(TERRAIN_LIST.indexOf(kind)).toBeGreaterThanOrEqual(0);
      expect(isFloor(kind)).toBe(true);
    }
  });
});
