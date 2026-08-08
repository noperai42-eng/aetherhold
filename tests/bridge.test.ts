/**
 * Bridges — the third answer to the lake.
 *
 * The first two were built already: fish it in summer, walk across it in
 * January. Both leave the water in charge. A bridge is the one the player
 * decides, and it is the only floor in the game that goes somewhere nobody can
 * stand, which is what the functional half is about — that `canFloor` says
 * water and only water, and that the job system is what turns "only water" into
 * something buildable instead of something impossible.
 *
 * One assertion here is a regression rather than a feature. `canFloor` used to
 * gate on `isSolid`, which answers *today*: for four months of the year the lake
 * bears weight, so a player could pave the ice in January and keep a steel
 * causeway across open water in April, with the lake gone from under it for
 * good. The frozen-lake cases below are what stop that coming back.
 *
 * The experience half asks the only question a player has about a crossing: I
 * painted a line out into the lake, did it build itself from the bank, and can
 * anybody actually get out there afterwards.
 */

import { describe, expect, it } from 'vitest';

import { FLOOR_DEFS, canFloor, desigForFloor, floorForDesig, layFloor } from '../src/sim/floors';
import { TERRAIN_GROWTH, canSow, canTill } from '../src/sim/farming';
import { isSolid, isWalkable, moveCost } from '../src/sim/grid';
import { iceBears } from '../src/sim/ice';
import { WALK_SPEED, followPath, setPathTo } from '../src/sim/movement';
import { designate, setPriority } from '../src/sim/orders';
import { defaultCamera, deserialize, serialize } from '../src/sim/save';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import {
  DESIG_FLOOR_BRIDGE,
  DESIG_FLOOR_PAVED,
  DESIG_FLOOR_PLANK,
  DESIG_NONE,
  TERRAIN_LIST,
  isFloor,
  packCell,
  terrainAt,
  terrainSpeed,
} from '../src/sim/types';
import type { Pawn, Terrain, World } from '../src/sim/types';
import { addItem, countResource, livingColonists } from '../src/sim/world';
import { HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';

function game(seed = 20260729) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

function setTerrain(world: World, x: number, y: number, t: Terrain): void {
  world.terrain[packCell(world, x, y)] = TERRAIN_LIST.indexOf(t);
}

type Cell = { x: number; y: number };

const STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Every cell touching this one, corners included — bounds checked, unlike `terrainAt`. */
function around(world: World, x: number, y: number): Cell[] {
  const out: Cell[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
      out.push({ x: nx, y: ny });
    }
  }
  return out;
}

/**
 * A run of open water leading straight out from a bank, nearest the cabin.
 *
 * Every cell past the first is required to have *nothing but water* around it,
 * which is stricter than the feature needs and is the point: it makes the order
 * the span gets built in a fact rather than a coin toss. A bay whose second cell
 * happened to touch the far shore could legitimately be decked from both ends at
 * once, and a test that asserted otherwise would be testing the coastline.
 */
function span(world: World, len: number): { bank: Cell; cells: Cell[] } {
  let best: { bank: Cell; cells: Cell[] } | null = null;
  let bestD = Infinity;
  for (let y = 2; y < world.height - 2; y++) {
    for (let x = 2; x < world.width - 2; x++) {
      if (!isWalkable(world, x, y)) continue;
      if (world.cellBuilding[y * world.width + x]! >= 0) continue;
      const d = (x - HOME_X) ** 2 + (y - HOME_Y) ** 2;
      if (d >= bestD) continue;
      for (const [dx, dy] of STEPS) {
        const cells: Cell[] = [];
        for (let i = 1; i <= len; i++) cells.push({ x: x + dx * i, y: y + dy * i });
        if (cells.some((c) => c.x < 1 || c.y < 1 || c.x >= world.width - 1 || c.y >= world.height - 1)) continue;
        if (!cells.every((c) => terrainAt(world, c.x, c.y) === 'water')) continue;
        const clear = cells.slice(1).every((c, i) => {
          const prev = cells[i]!;
          return around(world, c.x, c.y).every(
            (n) => (n.x === prev.x && n.y === prev.y) || terrainAt(world, n.x, n.y) === 'water',
          );
        });
        if (!clear) continue;
        bestD = d;
        best = { bank: { x, y }, cells };
        break;
      }
    }
  }
  if (!best) throw new Error(`no ${len}-cell run of open lake on this map`);
  return best;
}

/** One water cell, for the rules that do not care which one. */
function wetCell(world: World): Cell {
  return span(world, 1).cells[0]!;
}

/** Everyone on construction and nothing else, so the bridge is the work on offer. */
function buildersOnly(world: World): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
      setPriority(world, p.id, w, w === 'construct' ? 3 : 0);
    }
  }
}

// ---------------------------------------------------------------- functional

describe('where a bridge can go', () => {
  it('accepts open water', () => {
    const { world } = game();
    const c = wetCell(world);
    expect(canFloor(world, c.x, c.y, 'bridge')).toBe(true);
  });

  it('refuses dry land — a bridge over a field is a plank floor with extra wood in it', () => {
    const { world } = game();
    const c = wetCell(world);
    for (const t of ['grass', 'dirt', 'stone', 'sand', 'rock'] as Terrain[]) {
      setTerrain(world, c.x, c.y, t);
      expect(canFloor(world, c.x, c.y, 'bridge')).toBe(false);
    }
  });

  it('refuses water that already carries a deck', () => {
    const { world } = game();
    const c = wetCell(world);
    layFloor(world, c.x, c.y, 'bridge');
    expect(canFloor(world, c.x, c.y, 'bridge')).toBe(false);
    // And nothing may be laid over it either: paving the deck would leave a steel
    // floor with a lake under it that nothing in the game remembers is there.
    expect(canFloor(world, c.x, c.y, 'plank')).toBe(false);
    expect(canFloor(world, c.x, c.y, 'paved')).toBe(false);
  });

  it('refuses cells off the map', () => {
    const { world } = game();
    expect(canFloor(world, -1, 5, 'bridge')).toBe(false);
    expect(canFloor(world, world.width, 5, 'bridge')).toBe(false);
  });

  it('accepts water nobody can reach yet — the whole point of the tool', () => {
    const { world } = game();
    const far = span(world, 4).cells[3]!;
    // Four cells out into the lake in summer: not walkable, not next to anything
    // walkable, and legal anyway. Reachability is the job system's problem, and it
    // solves it the right way round by laying the near cells first.
    expect(isWalkable(world, far.x, far.y)).toBe(false);
    expect(canFloor(world, far.x, far.y, 'bridge')).toBe(true);
  });

  it('is the only floor the frozen lake will take', () => {
    const { world } = game();
    const c = wetCell(world);
    world.ice = 1;
    // The temptation is real: in midwinter the lake genuinely bears weight, and a
    // floor tool that asked "can somebody stand here" would say yes.
    expect(iceBears(world)).toBe(true);
    expect(isSolid(world, c.x, c.y)).toBe(false);
    // Saying yes would hand the player a permanent steel causeway across open
    // water in April, so the answer is the ground rather than the season.
    expect(canFloor(world, c.x, c.y, 'plank')).toBe(false);
    expect(canFloor(world, c.x, c.y, 'paved')).toBe(false);
    expect(canFloor(world, c.x, c.y, 'bridge')).toBe(true);
  });
});

describe('the bridge order', () => {
  it('has its own designation, and maps to the floor and back', () => {
    expect(DESIG_FLOOR_BRIDGE).not.toBe(DESIG_FLOOR_PLANK);
    expect(DESIG_FLOOR_BRIDGE).not.toBe(DESIG_FLOOR_PAVED);
    expect(floorForDesig(DESIG_FLOOR_BRIDGE)).toBe('bridge');
    expect(desigForFloor('bridge')).toBe(DESIG_FLOOR_BRIDGE);
  });

  it('takes on water and refuses everything else', () => {
    const { world } = game();
    const c = wetCell(world);
    expect(designate(world, c.x, c.y, DESIG_FLOOR_BRIDGE)).toBe(true);
    expect(world.cellDesig[packCell(world, c.x, c.y)]).toBe(DESIG_FLOOR_BRIDGE);
    expect(designate(world, c.x, c.y, DESIG_NONE)).toBe(true);

    setTerrain(world, c.x, c.y, 'grass');
    expect(designate(world, c.x, c.y, DESIG_FLOOR_BRIDGE)).toBe(false);
  });

  it('costs wood, and costs more of it than laying the same boards on dry land', () => {
    expect(FLOOR_DEFS.bridge.cost).toBe('wood');
    // Piles under it, and the fact that it can only be built out from one end.
    // Dear enough that decking a lake is absurd; cheap enough that crossing a
    // neck of it is a morning's work.
    expect(FLOOR_DEFS.bridge.amount).toBeGreaterThan(FLOOR_DEFS.plank.amount);
    expect(FLOOR_DEFS.bridge.work).toBeGreaterThan(FLOOR_DEFS.plank.work);
  });
});

describe('what a deck changes about the lake', () => {
  it('is walkable in the middle of summer, unlike the water it replaced', () => {
    const { world } = game();
    const c = wetCell(world);
    world.ice = 0;
    expect(isWalkable(world, c.x, c.y)).toBe(false);
    layFloor(world, c.x, c.y, 'bridge');
    expect(isWalkable(world, c.x, c.y)).toBe(true);
  });

  it('stays walkable through the freeze and the thaw', () => {
    const { world } = game();
    const c = wetCell(world);
    layFloor(world, c.x, c.y, 'bridge');
    for (const ice of [0, 0.5, 1, 0.5, 0]) {
      world.ice = ice;
      expect(isWalkable(world, c.x, c.y)).toBe(true);
    }
  });

  it('walks like the boards it is made of, and beats the ice beside it', () => {
    const { world } = game();
    const c = wetCell(world);
    const land = { x: HOME_X, y: HOME_Y };
    setTerrain(world, land.x, land.y, 'plank');
    layFloor(world, c.x, c.y, 'bridge');
    // Same speed as a plank road. A bridge that hurried you across would make the
    // long way round the lake feel like a punishment rather than a choice.
    expect(terrainSpeed(world, c.x, c.y)).toBe(terrainSpeed(world, land.x, land.y));
    expect(moveCost(world, c.x, c.y)).toBe(moveCost(world, land.x, land.y));
    // And in midwinter the deck is what a settler takes, not the frozen lake it
    // stands over — swept boards against ice you pick your way across.
    world.ice = 1;
    const frozen = wetCell(world);
    expect(moveCost(world, c.x, c.y)).toBeLessThan(moveCost(world, frozen.x, frozen.y));
  });

  it('is not soil, and cannot be made into soil', () => {
    const { world } = game();
    const c = wetCell(world);
    layFloor(world, c.x, c.y, 'bridge');
    expect(isFloor(terrainAt(world, c.x, c.y))).toBe(true);
    expect(canTill(world, c.x, c.y)).toBe(false);
    expect(canSow(world, c.x, c.y)).toBe(false);
    expect(TERRAIN_GROWTH.bridge).toBe(0);
  });

  it('survives a save, and did not shuffle anybody else out of their index', () => {
    const { world } = game();
    const c = wetCell(world);
    layFloor(world, c.x, c.y, 'bridge');
    const text = serialize(
      world,
      { mode: 'manager', possessedId: null, camera: defaultCamera(world) },
      1,
      0,
    );
    const res = deserialize(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(terrainAt(res.save.world, c.x, c.y)).toBe('bridge');
    // A saved map is a list of indexes into this list. Appending is free and
    // reordering turns every old colony's grass into stone, so the order of
    // everything that shipped before bridges is pinned here by name.
    expect(TERRAIN_LIST.slice(0, 8)).toEqual([
      'grass',
      'dirt',
      'stone',
      'rock',
      'water',
      'sand',
      'plank',
      'paved',
    ]);
    expect(TERRAIN_LIST[8]).toBe('bridge');
  });
});

// ---------------------------------------------------------------- experience

describe('the crossing, played', () => {
  it('builds itself outward from the bank, one cell at a time', () => {
    const { world, streams } = game();
    buildersOnly(world);
    const { bank, cells } = span(world, 3);
    for (const c of cells) expect(designate(world, c.x, c.y, DESIG_FLOOR_BRIDGE)).toBe(true);
    addItem(world, 'wood', 60, bank.x, bank.y);
    const wood = countResource(world, 'wood');

    /**
     * The tick each cell first read as decked, or -1 for never.
     *
     * Sampled every twenty ticks rather than at the end, and twenty because that
     * is `REGION_REBUILD_INTERVAL` — the soonest the colony can even notice that
     * the last cell became somewhere to stand. Any coarser and all three decks
     * land in one sample, and the ordering below would pass without meaning it.
     */
    const laid = cells.map(() => -1);
    for (let t = 0; t < 9000; t += 20) {
      stepWorldN(world, streams, 20);
      cells.forEach((c, i) => {
        if (laid[i] === -1 && terrainAt(world, c.x, c.y) === 'bridge') laid[i] = world.tick;
      });
      if (laid.every((n) => n > 0)) break;
    }

    // It finished at all. This is the assertion that fails if `assignFloor` and
    // the carry stage ever disagree about where a settler stands to lay a bridge:
    // one of them offers the job and the other sends them to a cell that is still
    // lake, and the deck never gets past the first plank.
    for (const c of cells) expect(terrainAt(world, c.x, c.y)).toBe('bridge');
    // And it finished in order, because until the near cell is decked the far one
    // has nowhere to stand. Nothing enforces this directly — it falls out of the
    // one flag that lets a settler work a cell from beside it.
    expect(laid[0]).toBeLessThan(laid[1]!);
    expect(laid[1]).toBeLessThan(laid[2]!);
    expect(countResource(world, 'wood')).toBeLessThan(wood);
    expect(world.cellDesig[packCell(world, cells[2]!.x, cells[2]!.y)]).toBe(DESIG_NONE);
  });

  it('is the only reason anybody can stand out in the middle of the lake', () => {
    const { world } = game();
    const { bank, cells } = span(world, 3);
    world.ice = 0;
    const end = cells[2]!;
    const pawn = livingColonists(world)[0] as Pawn;
    pawn.x = bank.x;
    pawn.y = bank.y;
    pawn.path = null;

    // Summer, open water, no deck: there is no route to that cell at all.
    expect(setPathTo(world, pawn, end.x, end.y)).toBe(false);

    for (const c of cells) layFloor(world, c.x, c.y, 'bridge');
    expect(setPathTo(world, pawn, end.x, end.y)).toBe(true);
    let ticks = 0;
    while (ticks < 400 && !followPath(world, pawn, WALK_SPEED)) ticks++;
    expect(ticks).toBeLessThan(400);
    expect(Math.round(pawn.x)).toBe(end.x);
    expect(Math.round(pawn.y)).toBe(end.y);
  });
});
