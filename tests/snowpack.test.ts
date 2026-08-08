/**
 * Snow that lies on the ground.
 *
 * Two things are being pinned here and they are different in kind. The first is
 * arithmetic: how fast a pack builds, how fast it goes, and what ground it
 * settles on. The second is the only thing that makes the first worth having —
 * that a year in the valley actually *has* a winter in it, with bare ground in
 * July, a white map in January and a thaw in between, and that a settler wading
 * through the drifts gets home later than one walking your paving.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { TerrainView } from '../src/client/render/terrain';
import { WALK_SPEED, followPath, setPathTo } from '../src/sim/movement';
import { Rng } from '../src/sim/rng';
import { groundSpeed, holdsSnow, snowAt, snowDepth, tickSnowpack } from '../src/sim/snowpack';
import {
  TERRAIN_LIST,
  TICKS_PER_DAY,
  type Terrain,
  type WeatherKind,
  type World,
  packCell,
  unpackY,
} from '../src/sim/types';
import { tickWeather } from '../src/sim/weather';
import { livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

function setWeather(world: World, kind: WeatherKind, blend = 1): void {
  world.weather.kind = kind;
  world.weather.blend = blend;
  world.weather.ticksLeft = 999_999;
}

/** Midnight of day 13 — the coldest hour of the coldest week of the year. */
function midwinter(world: World): void {
  world.tick = Math.round(TICKS_PER_DAY * 13);
}

/** Mid-afternoon of day 2 — high summer, nothing frozen is going to fall. */
function midsummer(world: World): void {
  world.tick = Math.round(TICKS_PER_DAY * 2.6);
}

function paint(world: World, kind: Terrain, x0: number, x1: number, y: number): void {
  const t = TERRAIN_LIST.indexOf(kind);
  for (let x = x0; x <= x1; x++) world.terrain[packCell(world, x, y)] = t;
  // Nothing standing in the lane: this is a test about the ground, and a tree in
  // the way would make it a test about pathfinding around one.
  world.buildings = world.buildings.filter((b) => !(b.y === y && b.x >= x0 && b.x <= x1));
}

/**
 * Ticks for a settler to walk a straight lane, with the pack at `depth`.
 *
 * The real path follower, not the speed function it calls — the number that
 * matters is how long the trip takes, and a test that read the multiplier back
 * would pass just as happily if nothing was using it.
 */
function walk(seed: number, kind: Terrain, depth: number): number {
  const world = createWorld(seed);
  const pawn = livingColonists(world)[0]!;
  const y = Math.round(pawn.y);
  const x0 = Math.round(pawn.x);
  const x1 = x0 + 18;
  paint(world, kind, x0, x1, y);
  pawn.x = x0;
  pawn.y = y;
  world.snow = depth;
  expect(setPathTo(world, pawn, x1, y)).toBe(true);
  let ticks = 0;
  while (!followPath(world, pawn, WALK_SPEED) && ticks < 5000) ticks++;
  return ticks;
}

describe('the pack', () => {
  it('starts bare, and only something frozen falling puts anything down', () => {
    const world = createWorld(4);
    expect(snowDepth(world)).toBe(0);

    // A clear midwinter sky: freezing, and nothing coming out of it.
    midwinter(world);
    setWeather(world, 'clear');
    for (let i = 0; i < 2000; i++) tickSnowpack(world);
    expect(snowDepth(world)).toBe(0);

    // The same freezing air with a front in it is a different matter.
    setWeather(world, 'storm');
    for (let i = 0; i < 2000; i++) tickSnowpack(world);
    expect(snowDepth(world)).toBeGreaterThan(0.5);
  });

  it('buries the valley in about half a day of blizzard, and no deeper', () => {
    const world = createWorld(4);
    midwinter(world);
    setWeather(world, 'storm');
    for (let i = 0; i < TICKS_PER_DAY * 0.5; i++) tickSnowpack(world);
    // Half a day of unbroken whiteout is the design's definition of buried. Not
    // exactly 1, because the cold hours around midnight are cold enough that the
    // melt term is zero and the warm ones are not.
    expect(snowDepth(world)).toBeGreaterThan(0.85);

    // And it stops there. A fortnight of blizzard is still one valley deep.
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) tickSnowpack(world);
    expect(snowDepth(world)).toBe(1);
  });

  it('holds through the freeze and goes in the thaw', () => {
    const cold = createWorld(4);
    midwinter(cold);
    setWeather(cold, 'clear');
    cold.snow = 0.6;
    for (let i = 0; i < 600; i++) tickSnowpack(cold);
    // Midnight in midwinter is nowhere near the melting point: what fell last
    // week is still there, which is the whole difference between a snowpack and
    // a weather effect.
    expect(snowDepth(cold)).toBe(0.6);

    const warm = createWorld(4);
    midsummer(warm);
    setWeather(warm, 'clear');
    warm.snow = 0.6;
    for (let i = 0; i < TICKS_PER_DAY; i++) tickSnowpack(warm);
    expect(snowDepth(warm)).toBe(0);
  });

  it('says so when it settles and when it goes', () => {
    const world = createWorld(4);
    midwinter(world);
    setWeather(world, 'storm');
    for (let i = 0; i < 1500; i++) tickSnowpack(world);
    const settled = world.messages.filter((m) => m.text.includes('Snow is lying'));
    expect(settled.length).toBe(1);

    midsummer(world);
    setWeather(world, 'clear');
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) tickSnowpack(world);
    expect(world.messages.filter((m) => m.text.includes('The thaw has taken')).length).toBe(1);
    // And neither line comes round again while nothing is changing.
    for (let i = 0; i < TICKS_PER_DAY; i++) tickSnowpack(world);
    expect(world.messages.filter((m) => m.text.includes('The thaw has taken')).length).toBe(1);
  });

  it('opens a colony saved before the ground had snow on it', () => {
    // The field is optional so that `SAVE_VERSION` never had to move for this.
    // An absent depth has to read as bare rather than as `undefined` leaking into
    // the arithmetic and turning every walking speed in the colony into NaN.
    const world = createWorld(4);
    delete world.snow;
    expect(snowDepth(world)).toBe(0);
    expect(groundSpeed(world, 5, 5)).toBeGreaterThan(0);
    midwinter(world);
    setWeather(world, 'storm');
    tickSnowpack(world);
    expect(snowDepth(world)).toBeGreaterThan(0);
  });

  it('is the same winter every time from the same seed', () => {
    const run = (): number => {
      const world = createWorld(77);
      const rng = new Rng(77);
      for (let i = 0; i < TICKS_PER_DAY * 14; i++) {
        world.tick++;
        tickWeather(world, rng, () => {});
        tickSnowpack(world);
      }
      return snowDepth(world);
    };
    expect(run()).toBe(run());
  });
});

describe('what the snow settles on', () => {
  it('lies on the ground the valley made and not on the ground a settler did', () => {
    for (const kind of ['grass', 'dirt', 'sand', 'stone'] as Terrain[]) {
      expect(holdsSnow(kind), `${kind} should hold snow`).toBe(true);
    }
    // Boards and paving are the point of the whole layer: the one ground with no
    // snow on it is the ground somebody built, which is what makes a path worth
    // laying before the first front rather than after it. Water and rock are out
    // for their own reasons — neither is walked over.
    for (const kind of ['plank', 'paved', 'water', 'rock'] as Terrain[]) {
      expect(holdsSnow(kind), `${kind} should stay clear`).toBe(false);
    }
  });

  it('slows the bare ground and leaves the paving alone', () => {
    const world = createWorld(4);
    paint(world, 'grass', 10, 12, 20);
    paint(world, 'paved', 13, 15, 20);

    world.snow = 0;
    const dryGrass = groundSpeed(world, 11, 20);
    const dryPaving = groundSpeed(world, 14, 20);

    world.snow = 1;
    expect(snowAt(world, 11, 20)).toBe(1);
    expect(snowAt(world, 14, 20)).toBe(0);
    expect(groundSpeed(world, 11, 20)).toBeLessThan(dryGrass);
    expect(groundSpeed(world, 14, 20)).toBe(dryPaving);
  });
});

describe('a year in the valley', () => {
  /**
   * The claim the whole slice exists to make, checked against a year of real
   * fronts rather than a hand-placed blizzard: bare ground in high summer, a
   * white valley in the depths, and a thaw that takes it away again.
   *
   * Two of the three claims are absolute and two are not, and the split is the
   * interesting part. *Never in summer* and *gone by spring* are properties of
   * the model — they hold on every seed because the arithmetic makes them hold,
   * and a single counter-example would be a bug. *Deep in the depths* is a
   * property of the **weather**, and the weather is allowed to be unlucky: a
   * couple of seeds in twelve draw a dry winter with barely a front in the cold
   * band, and asserting per-seed there would be asserting that the sky never
   * takes a year off. So the depth claim is made over the sample instead — most
   * winters bury the valley, half of them properly — which is the thing a player
   * actually experiences and does not break the day somebody retunes a weather
   * transition by a percent.
   */
  it('is bare in summer, white in most winters, and bare again by the spring', () => {
    const seeds = [1, 2, 3, 4, 5, 7, 13, 31, 42, 77, 101, 99001];
    const winters: number[] = [];
    for (const seed of seeds) {
      const world = createWorld(seed);
      const rng = new Rng(seed);
      let deepest = 0;
      let summer = 0;
      for (let i = 0; i < TICKS_PER_DAY * 22; i++) {
        world.tick++;
        tickWeather(world, rng, () => {});
        tickSnowpack(world);
        const day = world.tick / TICKS_PER_DAY;
        const depth = snowDepth(world);
        if (day < 4) summer = Math.max(summer, depth);
        if (day >= 9 && day <= 20) deepest = Math.max(deepest, depth);
      }
      // No seed, ever, wakes up white in July.
      expect(summer, `seed ${seed} snowed in high summer`).toBe(0);
      // And no seed is still under snow a fortnight after the solstice.
      expect(snowDepth(world), `seed ${seed} never thawed`).toBeLessThan(0.06);
      winters.push(deepest);
    }

    const lying = winters.filter((d) => d > 0.15).length;
    const deep = winters.filter((d) => d > 0.7).length;
    expect(lying, `only ${lying}/${seeds.length} seeds had snow on the ground: ${winters}`).toBeGreaterThanOrEqual(9);
    expect(deep, `only ${deep}/${seeds.length} seeds were properly buried: ${winters}`).toBeGreaterThanOrEqual(5);
  });

  it('makes a settler wade, and makes the road you laid worth what it cost', () => {
    // `groundSpeed` is what both the path follower and the possessed body ask —
    // `tests/architecture.test.ts` holds that seam shut — so a trip that gets
    // slower here gets slower in first person too, on the same drift.
    const bare = walk(4, 'grass', 0);
    const drifts = walk(4, 'grass', 1);
    expect(drifts).toBeGreaterThan(bare * 1.3);

    // And the answer to it. Paving is worth a little in summer and a great deal
    // in February, which is the decision this layer is for: a colony that spent
    // its autumn laying a road through the base keeps working through the winter.
    const paved = walk(4, 'paved', 1);
    expect(paved).toBeLessThan(drifts);
    expect(drifts / paved).toBeGreaterThan(bare / walk(4, 'paved', 0));
  });

  /**
   * The road only pays if the *planner* knows about it.
   *
   * Walking speed is half the story: a settler who still takes the shortest line
   * across the yard gets the drag and none of the answer to it, and the paving
   * you laid in autumn is decoration. So this measures the decision rather than
   * the multiplier — same map, same two routes, and the only thing that changes
   * between the runs is how much snow is on the ground.
   *
   * The map is a rock box with exactly two ways through it: ten cells of bare
   * ground straight across, or twenty cells of paving the long way round. In
   * summer the short way wins on distance. Under a full pack it should lose.
   */
  it('sends a settler round by the road once the short way is under snow', () => {
    const routeAt = (depth: number): number[] => {
      const world = createWorld(9);
      const rock = TERRAIN_LIST.indexOf('rock');
      for (let y = 23; y <= 32; y++) {
        for (let x = 18; x <= 32; x++) world.terrain[packCell(world, x, y)] = rock;
      }
      // The short way: bare ground, straight across.
      paint(world, 'grass', 20, 30, 30);
      // The long way: paving, five cells down, across and five back up.
      paint(world, 'paved', 20, 30, 25);
      const paved = TERRAIN_LIST.indexOf('paved');
      for (let y = 25; y <= 30; y++) {
        world.terrain[packCell(world, 20, y)] = paved;
        world.terrain[packCell(world, 30, y)] = paved;
      }
      // Both ends belong to the short way, so the two routes share a start and a
      // goal and differ in nothing but what they are made of.
      world.terrain[packCell(world, 20, 30)] = TERRAIN_LIST.indexOf('grass');
      world.terrain[packCell(world, 30, 30)] = TERRAIN_LIST.indexOf('grass');
      world.buildings = world.buildings.filter(
        (b) => !(b.x >= 18 && b.x <= 32 && b.y >= 23 && b.y <= 32),
      );

      const pawn = livingColonists(world)[0]!;
      pawn.x = 20;
      pawn.y = 30;
      world.snow = depth;
      expect(setPathTo(world, pawn, 30, 30)).toBe(true);
      return pawn.path!;
    };

    const bare = routeAt(0);
    const white = routeAt(1);
    const usesRoad = (path: number[]): boolean => path.some((c) => unpackY(world0, c) < 28);
    expect(bare.length, 'the short way should be the short way').toBe(10);
    expect(usesRoad(bare), 'took the long way round in summer').toBe(false);
    expect(usesRoad(white), 'ploughed straight through the drifts').toBe(true);
  });
});

/**
 * A world only used for unpacking cell indices, which needs nothing but a width.
 * Cheaper than threading a `World` through a predicate for one arithmetic op.
 */
const world0 = createWorld(9);

describe('the pack has depth', () => {
  /** The ground mesh out of a `TerrainView` — the one child that is not the rocks. */
  function groundOf(view: TerrainView): THREE.Mesh {
    const mesh = view.group.children.find(
      (c) => (c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh,
    );
    return mesh as THREE.Mesh;
  }

  function heightsOf(view: TerrainView): Float32Array {
    return (groundOf(view).geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
  }

  /** The six vertex heights of one cell's two triangles. */
  function cellHeights(world: World, pos: Float32Array, x: number, y: number): number[] {
    const base = packCell(world, x, y) * 18;
    return [0, 3, 6, 9, 12, 15].map((o) => pos[base + o + 1]!);
  }

  it('lies flat on ground with nothing on it', () => {
    const world = createWorld(9);
    world.snow = 0;
    const view = new TerrainView(world);
    const pos = heightsOf(view);
    let highest = 0;
    for (let i = 1; i < pos.length; i += 3) highest = Math.max(highest, pos[i]!);
    expect(highest).toBe(0);
    view.dispose();
  });

  it('never opens a crack between one cell and the next', () => {
    // The failure this exists for is not subtle to look at and is very easy to
    // ship: two cells are separate triangles with no shared vertices, so if a
    // snowy cell lifts and the path beside it does not, there is a slot straight
    // through the ground — and from inside a body, a hole in the floor. Every
    // vertex standing on the same spot has to stand at the same height.
    const world = createWorld(9);
    paint(world, 'plank', 30, 34, 40);
    paint(world, 'water', 30, 34, 44);
    world.snow = 1;
    const view = new TerrainView(world);
    const pos = heightsOf(view);

    const seen = new Map<string, number>();
    let checked = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const key = `${pos[i]!.toFixed(3)},${pos[i + 2]!.toFixed(3)}`;
      const y = pos[i + 1]!;
      const had = seen.get(key);
      if (had === undefined) seen.set(key, y);
      else {
        expect(y, `two vertices at ${key} disagree about the ground`).toBe(had);
        checked++;
      }
    }
    // And the check actually met some shared corners rather than passing on an
    // empty set — every interior corner is shared by four cells.
    expect(checked).toBeGreaterThan(world.width * world.height);
    view.dispose();
  });

  it('rises on bare ground, stays down on a floor, and is never a step', () => {
    const world = createWorld(9);
    // A block wide enough to have an inside: the cell in the middle of it has all
    // four corners touching nothing but its own kind.
    for (let y = 38; y <= 42; y++) paint(world, 'plank', 30, 34, y);
    for (let y = 50; y <= 54; y++) paint(world, 'grass', 30, 34, y);
    for (let y = 60; y <= 64; y++) paint(world, 'water', 30, 34, y);
    world.snow = 1;
    const view = new TerrainView(world);
    const pos = heightsOf(view);

    const field = cellHeights(world, pos, 32, 52);
    const path = cellHeights(world, pos, 32, 40);
    const pond = cellHeights(world, pos, 32, 62);

    // Open ground carries the whole pack.
    expect(Math.min(...field)).toBeGreaterThan(0);
    // The one ground a settler made is the one ground still at ground level, so
    // a plank walk in deep snow reads as a trench you can see from the camera.
    expect(Math.max(...path)).toBe(0);
    // And the pond takes none of it. It sits below ground level now that the lake
    // exists — the same corner lattice that lifts snow sinks water — so the claim
    // worth making is not where the pond is but that the snow did not move it:
    // the bed is at exactly the same height in a blizzard as it is in high summer.
    world.snow = 0;
    view.sync(world);
    expect(cellHeights(world, heightsOf(view), 32, 62)).toEqual(pond);
    world.snow = 1;
    view.sync(world);

    // A surface, not terrain. Nothing in the sim knows this number, so if it ever
    // grew to something a body could stand on, the picture and the collision
    // would have quietly forked — which is the one thing this project does not do.
    let highest = 0;
    for (let i = 1; i < pos.length; i += 3) highest = Math.max(highest, pos[i]!);
    expect(highest).toBeLessThan(0.2);
    view.dispose();
  });

  it('goes back down with the thaw', () => {
    const world = createWorld(9);
    world.snow = 1;
    const view = new TerrainView(world);
    let deep = 0;
    const before = heightsOf(view);
    for (let i = 1; i < before.length; i += 3) deep = Math.max(deep, before[i]!);
    expect(deep).toBeGreaterThan(0);

    world.snow = 0;
    view.sync(world);
    const after = heightsOf(view);
    let left = 0;
    for (let i = 1; i < after.length; i += 3) left = Math.max(left, after[i]!);
    expect(left).toBe(0);
    view.dispose();
  });
});
