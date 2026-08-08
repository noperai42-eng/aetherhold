/**
 * The lake freezes.
 *
 * Two things are being pinned here and they are different in kind. The first is
 * arithmetic: when a surface forms, when it goes, and that the two-degree band
 * between the freezing and thawing means does not let it flicker. That one is
 * absolute — the ice is driven by the calendar and draws no randomness, so every
 * seed gets the same winter and any seed may be asked about it.
 *
 * The second is the only reason the first is worth having: that for six days a
 * year the one permanent obstacle on the map becomes the fastest road across it,
 * for everybody who walks — and that the morning it goes, the colony was warned,
 * nobody is left standing on open water, and nothing they own is either. That
 * last clause is not politeness. A corpse under the lake is a burial job with no
 * path to it and a stack of steel out there is a haul job retried forever, and a
 * hazard that leaves the world in a state the AI cannot resolve is a bug.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { TerrainView } from '../src/client/render/terrain';
import { groundColor } from '../src/client/render/palette';
import { isSolid, isWalkable, moveCost } from '../src/sim/grid';
import { hasAilment } from '../src/sim/health';
import { BEARING, iceBears, iceDepth, tickIce } from '../src/sim/ice';
import { canPlace, paintPenZone, paintStockpile } from '../src/sim/orders';
import { findPath } from '../src/sim/path';
import { seasonMeanTemp } from '../src/sim/temperature';
import { TICKS_PER_DAY, packCell, terrainAt, type World } from '../src/sim/types';
import { addItem } from '../src/sim/world';
import { createWorld, HOME_X, HOME_Y } from '../src/sim/worldgen';

const SEEDS = [1, 2, 3, 5, 13, 42, 99001];

/** Every water cell on the map, packed. */
function waterCells(world: World): number[] {
  const out: number[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (terrainAt(world, x, y) === 'water') out.push(packCell(world, x, y));
    }
  }
  return out;
}

/**
 * The deepest water on the map — the cell furthest from any dry ground.
 *
 * Not the centroid, and the difference is the whole point. A centroid says where
 * the lake *is*; the tests below want a cell that is unambiguously *in* it, with
 * water on all eight sides, because they ask whether open water renders as a
 * hole and whether ice bears weight out in the middle. A centroid pushed onto
 * the nearest water cell — which is what this used to do — lands on the shore of
 * any lake bent round a headland, and a shore cell has a bank corner holding its
 * mesh up. That read as the renderer failing to sink open water when what had
 * actually happened is that the lake got a bend in it.
 *
 * Breadth-first from every dry cell at once, so the ring numbers are true
 * distances rather than a diagonal-flavoured guess.
 */
function lakeMiddle(world: World): { x: number; y: number } {
  const w = world.width;
  const depth = new Int32Array(w * world.height).fill(-1);
  let edge: number[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < w; x++) {
      if (terrainAt(world, x, y) === 'water') continue;
      depth[y * w + x] = 0;
      edge.push(y * w + x);
    }
  }
  let deepest = waterCells(world)[0]!;
  for (let d = 1; edge.length > 0; d++) {
    const next: number[] = [];
    for (const i of edge) {
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx!;
        const ny = y + dy!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= world.height) continue;
        const j = ny * w + nx;
        if (depth[j] !== -1) continue;
        depth[j] = d;
        deepest = j;
        next.push(j);
      }
    }
    edge = next;
  }
  const x = deepest % w;
  return { x, y: (deepest - x) / w };
}

/**
 * Two dry, standable cells on opposite shores of the lake, with the water
 * between them.
 *
 * Walks out from the middle along the lake's widest axis until it is back on
 * land — so "across" means across, and the summer route is genuinely the long
 * way round rather than a step sideways.
 */
function oppositeBanks(world: World): [{ x: number; y: number }, { x: number; y: number }] | null {
  const mid = lakeMiddle(world);
  const cells = waterCells(world);
  let w = 0;
  let h = 0;
  for (const c of cells) {
    const x = c % world.width;
    const y = (c - x) / world.width;
    if (y === mid.y) w++;
    if (x === mid.x) h++;
  }
  const [dx, dy] = w >= h ? [1, 0] : [0, 1];
  const ends: Array<{ x: number; y: number }> = [];
  for (const sign of [1, -1]) {
    let x = mid.x;
    let y = mid.y;
    for (let step = 0; step < 40; step++) {
      x += dx * sign;
      y += dy * sign;
      if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) return null;
      if (terrainAt(world, x, y) === 'water') continue;
      // Past the shore; take the first cell out here anybody could stand on.
      if (!isWalkable(world, x, y)) continue;
      ends.push({ x, y });
      break;
    }
  }
  return ends.length === 2 ? [ends[0]!, ends[1]!] : null;
}

/** Run the ice through a whole year from tick 0, returning its depth each day. */
function aYearOfIce(world: World): number[] {
  const byDay: number[] = [];
  for (let day = 0; day < 20; day++) {
    byDay.push(iceDepth(world));
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      world.tick = day * TICKS_PER_DAY + t;
      tickIce(world);
    }
  }
  return byDay;
}

describe('the ice arithmetic', () => {
  it('makes a surface midway through winter and loses it midway through spring', () => {
    const world = createWorld(3);
    // No pawns: this test is about the water, and a settler wandering onto it
    // would be a test about the settler.
    world.pawns.length = 0;
    const byDay = aYearOfIce(world);

    // Summer and autumn: open water, exactly. Not "nearly" — the clamp at zero
    // is what stops a warm year leaving a negative depth to climb back out of.
    for (let day = 0; day <= 9; day++) {
      expect(byDay[day], `day ${day} had ice on it in the warm half of the year`).toBe(0);
    }
    // Winter starts on day 10. It takes a day and a half of it to make a
    // surface, which is the point: the crossing is a thing that happens *in*
    // winter rather than a thing the calendar hands over on the first morning.
    expect(byDay[11], 'the lake bore weight on the first night of winter').toBeLessThan(BEARING);
    expect(byDay[12], 'the lake never bore weight in deep winter').toBeGreaterThanOrEqual(BEARING);
    expect(byDay[13]).toBe(1);
    // And it survives the turn into spring — the ice outlasts the cold that made
    // it, which is why the dangerous days are the mild ones.
    expect(byDay[16], 'the lake opened the moment spring started').toBeGreaterThanOrEqual(BEARING);
    expect(byDay[19], 'the lake was still frozen in late spring').toBe(0);
  });

  it('holds what it has through the two degrees between freezing and thawing', () => {
    const world = createWorld(3);
    world.pawns.length = 0;
    // Asked of every tick of the year rather than of one chosen day, because the
    // mean moves continuously: the band opens somewhere inside day 9, shuts
    // inside day 16, and picking a day boundary to stand on would be picking the
    // edge of the thing being measured. Whenever the valley is between the two
    // lines, the lake keeps exactly what it has — no drift, not a thousandth.
    // Without the gap these are the days the lake spends flickering between road
    // and wall, and the pathfinder hands out routes that expire.
    world.ice = 0.8;
    let held = 0;
    for (let t = 0; t < TICKS_PER_DAY * 20; t++) {
      world.tick = t;
      const mean = seasonMeanTemp(world);
      const before = iceDepth(world);
      tickIce(world);
      if (mean > 1 && mean < 3) {
        expect(iceDepth(world), `the lake moved at tick ${t}, mean ${mean.toFixed(2)}`).toBe(before);
        held++;
      }
    }
    // And the band is genuinely visited — a test that never enters it would pass
    // on a lake with no hold at all.
    expect(held, 'the year never passed through the holding band').toBeGreaterThan(TICKS_PER_DAY);
  });

  it('bears weight exactly at the thickness the renderer levels the bank at', () => {
    const world = createWorld(3);
    world.ice = BEARING - 0.0001;
    expect(iceBears(world)).toBe(false);
    world.ice = BEARING;
    expect(iceBears(world)).toBe(true);
  });

  it('reads a save from before there was ice as open water', () => {
    const world = createWorld(3);
    delete world.ice;
    expect(iceDepth(world)).toBe(0);
    expect(iceBears(world)).toBe(false);
    // And the lake is a wall again, which is the same answer that save was
    // written under.
    const mid = lakeMiddle(world);
    expect(isSolid(world, mid.x, mid.y)).toBe(true);
  });

  it('spends no randomness on the weather', () => {
    // The whole map is seeded off one stream and the ice is not allowed to touch
    // it — a system that drew a single number here would re-roll every tuned
    // test downstream of worldgen, which this project has already paid for once.
    const world = createWorld(3);
    world.pawns.length = 0;
    const before = world.rng.main;
    aYearOfIce(world);
    expect(world.rng.main).toBe(before);
  });
});

describe('the frozen lake is a road', () => {
  it('is a shortcut across the valley in winter and a wall the rest of the year', () => {
    let crossings = 0;
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      const banks = oppositeBanks(world);
      expect(banks, `seed ${seed}: could not find two shores`).not.toBeNull();
      const [a, b] = banks!;

      world.ice = 0;
      const summer = findPath(world, a.x, a.y, b.x, b.y, { maxExpansions: 40000 });
      world.ice = 1;
      const winter = findPath(world, a.x, a.y, b.x, b.y, { maxExpansions: 40000 });
      expect(summer, `seed ${seed}: no way round the lake at all`).not.toBeNull();
      expect(winter, `seed ${seed}: no way across the frozen lake`).not.toBeNull();

      // The frozen route is never the longer one — the ice can only ever add a
      // way through, so a longer winter path would mean the pathfinder is
      // ignoring it.
      expect(winter!.length, `seed ${seed}: winter route is longer than the detour`).toBeLessThanOrEqual(
        summer!.length,
      );
      const wet = winter!.filter((c) => terrainAt(world, c % world.width, Math.floor(c / world.width)) === 'water');
      if (wet.length > 0) {
        crossings++;
        expect(winter!.length, `seed ${seed}: crossed the ice and got no shorter`).toBeLessThan(
          summer!.length,
        );
      }
    }
    // Not every lake is worth crossing — a narrow one is quicker to walk round
    // and the pathfinder is right to. The claim is that the shortcut is real on
    // the map in general, so most of the sample takes it.
    expect(crossings, 'no seed produced a lake worth crossing').toBeGreaterThanOrEqual(
      Math.ceil(SEEDS.length / 2),
    );
  });

  it('gives the same road to whatever is walking on it', () => {
    // There is no ice rule in the pathfinder, the movement code, the collision
    // capsule or the raider AI — there is one rule, in `isSolid`, and this is
    // what that buys. A raid that came the long way in July walks over the lake
    // in January without a line being written for it.
    const world = createWorld(3);
    const mid = lakeMiddle(world);
    world.ice = 0;
    expect(isSolid(world, mid.x, mid.y)).toBe(true);
    expect(isWalkable(world, mid.x, mid.y)).toBe(false);
    world.ice = 1;
    expect(isSolid(world, mid.x, mid.y)).toBe(false);
    expect(isWalkable(world, mid.x, mid.y)).toBe(true);
  });

  it('is picked across rather than strolled over, but still beats the drifts', () => {
    const world = createWorld(3);
    world.ice = 1;
    world.snow = 0;
    const mid = lakeMiddle(world);
    const bare = moveCost(world, HOME_X, HOME_Y);
    expect(moveCost(world, mid.x, mid.y), 'the ice is not slower than bare ground').toBeGreaterThan(
      bare,
    );
    // And the reason anybody takes it: the fields either side of a frozen lake
    // are under the deepest snow of the year, and wading is dearer than
    // shuffling.
    world.snow = 1;
    expect(
      moveCost(world, mid.x, mid.y),
      'the ice is no better than the snow beside it',
    ).toBeLessThan(moveCost(world, HOME_X, HOME_Y));
  });

  it('is never anywhere to build, however hard it freezes', () => {
    // A road, never real estate. Everything here is walkable in midwinter and
    // under water in April, so the one thing the player must not be allowed to
    // do is put something on it that cannot be taken back off.
    const world = createWorld(3);
    world.ice = 1;
    const mid = lakeMiddle(world);
    expect(isWalkable(world, mid.x, mid.y)).toBe(true);
    expect(canPlace(world, 'wall', mid.x, mid.y)).toBe('terrain');
    expect(paintStockpile(world, mid.x, mid.y)).toBe(false);
    expect(paintPenZone(world, mid.x, mid.y)).toBe(false);
  });
});

describe('the thaw', () => {
  /** Tick the ice from a full surface into spring, collecting what it says. */
  function throughTheThaw(world: World): Array<{ tick: number; text: string }> {
    world.ice = 1;
    const said: Array<{ tick: number; text: string }> = [];
    let seen = world.messages.length;
    for (let t = 16 * TICKS_PER_DAY; t < 20 * TICKS_PER_DAY; t++) {
      world.tick = t;
      tickIce(world);
      while (seen < world.messages.length) {
        said.push({ tick: t, text: world.messages[seen]!.text });
        seen++;
      }
    }
    return said;
  }

  it('creaks a long time before it goes', () => {
    const world = createWorld(3);
    world.pawns.length = 0;
    const said = throughTheThaw(world);
    const creak = said.find((m) => m.text.includes('creaking'));
    const gone = said.find((m) => m.text.includes('gone out'));
    expect(creak, 'the lake opened without a word of warning').toBeDefined();
    expect(gone, 'the lake never opened').toBeDefined();
    // A minute of real play at 20 Hz, which is time to notice the line, find
    // whoever is out on the water and walk them back to a bank from anywhere on
    // a 96-cell map. A warning shorter than the walk home is not a warning.
    expect(gone!.tick - creak!.tick, 'the warning came too late to act on').toBeGreaterThan(1200);
  });

  it('puts a settler who was still out there on the bank, with a chill', () => {
    const world = createWorld(3);
    const mid = lakeMiddle(world);
    const pawn = world.pawns.find((p) => p.faction === 'colony')!;
    pawn.x = mid.x;
    pawn.y = mid.y;
    pawn.path = [packCell(world, HOME_X, HOME_Y)];
    world.ice = BEARING - 0.01;
    world.tick = 18 * TICKS_PER_DAY;
    tickIce(world);

    expect(terrainAt(world, Math.round(pawn.x), Math.round(pawn.y)), 'left standing in the lake').not.toBe(
      'water',
    );
    expect(hasAilment(pawn, 'flu'), 'went through the ice and came out dry').toBe(true);
    // Whatever they were walking to is off — the route they had was across a
    // lake that is not there any more.
    expect(pawn.path).toBeNull();
    expect(world.messages.some((m) => m.text.includes('goes through the ice'))).toBe(true);
  });

  it('washes the leftovers ashore rather than swallowing them', () => {
    const world = createWorld(3);
    const mid = lakeMiddle(world);
    const stack = addItem(world, 'steel', 30, mid.x, mid.y)!;
    const body = world.pawns.find((p) => p.faction === 'colony')!;
    body.dead = true;
    body.x = mid.x;
    body.y = mid.y;

    world.ice = BEARING - 0.01;
    world.tick = 18 * TICKS_PER_DAY;
    tickIce(world);

    // The steel is somewhere a hauler can reach, still worth what it was worth.
    expect(terrainAt(world, stack.x, stack.y), 'the steel sank').not.toBe('water');
    expect(isWalkable(world, stack.x, stack.y)).toBe(true);
    expect(stack.amount).toBe(30);
    // And the body is somewhere a grave can be dug beside, without a line in the
    // log — the living get the drama, the dead get a burial that works.
    expect(terrainAt(world, Math.round(body.x), Math.round(body.y))).not.toBe('water');
    expect(world.messages.some((m) => m.text.includes(`${body.name} goes through`))).toBe(false);
  });
});

describe('the ice is drawn', () => {
  function groundOf(view: TerrainView): THREE.Mesh {
    return view.group.children.find(
      (c) => (c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.Mesh;
  }

  function cellHeights(world: World, view: TerrainView, x: number, y: number): number[] {
    const attr = groundOf(view).geometry.getAttribute('position') as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    const base = packCell(world, x, y) * 18;
    return [0, 3, 6, 9, 12, 15].map((o) => pos[base + o + 1]!);
  }

  it('comes up level with the bank on the tick it starts bearing', () => {
    // This is the anti-slop rule in one assertion. A shelf of ice standing over
    // open water is a surface nobody can cross; a hole under a settler who is
    // walking on it is worse. The bowl has to be flush at exactly `BEARING` and
    // it has to get there because the renderer divides by that same constant,
    // not because two numbers happened to be tuned to each other.
    const world = createWorld(3);
    world.snow = 0;
    const mid = lakeMiddle(world);
    const view = new TerrainView(world);

    world.ice = 0;
    view.sync(world);
    expect(Math.max(...cellHeights(world, view, mid.x, mid.y)), 'open water is not a hole').toBeLessThan(
      -0.3,
    );

    world.ice = BEARING;
    view.sync(world);
    const surface = cellHeights(world, view, mid.x, mid.y);
    expect(Math.min(...surface)).toBe(0);
    expect(Math.max(...surface)).toBe(0);
    // Level with the ground the settler steps off, to the vertex — the seam is
    // shared corner heights, so there is nothing here to open a crack.
    expect(surface).toEqual(cellHeights(world, view, HOME_X, HOME_Y));

    // Thicker still changes nothing: the surface is level, not rising.
    world.ice = 1;
    view.sync(world);
    expect(cellHeights(world, view, mid.x, mid.y)).toEqual(surface);
    view.dispose();
  });

  it('repaints when the lake freezes without anything else changing', () => {
    // The mesh caches on a checksum, so a season that changes only the ice would
    // otherwise leave the valley showing last week's lake.
    const world = createWorld(3);
    world.snow = 0;
    world.ice = 0;
    const view = new TerrainView(world);
    view.sync(world);
    const mid = lakeMiddle(world);
    const before = cellHeights(world, view, mid.x, mid.y);
    world.ice = 1;
    view.sync(world);
    expect(cellHeights(world, view, mid.x, mid.y)).not.toEqual(before);
    view.dispose();
  });

  it('reads as a different white from the snow lying beside it', () => {
    // Both are pale in January, and if they were the same pale the one road
    // across the map would vanish into the fields exactly when it starts
    // mattering.
    const open = groundColor(new THREE.Color(), 'water', 0.6, 0, 0);
    const frozen = groundColor(new THREE.Color(), 'water', 0.6, 0, 1);
    const field = groundColor(new THREE.Color(), 'grass', 0.6, 1, 0);
    const lum = (c: THREE.Color): number => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    expect(lum(frozen), 'the ice is no brighter than the water under it').toBeGreaterThan(lum(open));
    expect(lum(frozen), 'the ice is as bright as the snowfield').toBeLessThan(lum(field) - 0.05);
  });
});
