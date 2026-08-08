/**
 * The wood grows back.
 *
 * Every rule in `forest.ts` is a decision about one cell taken from the eighty
 * cells around it, and the thing that makes them testable is that `tickForest`
 * asks its random stream for the cell before it asks anything else. Hand it a
 * stream that always names the same cell and the whole system becomes a pure
 * question about a neighbourhood you built yourself — no sampling, no waiting,
 * no seed luck. Most of this file is that: a bare valley, one clearing, and the
 * three local rules asked one at a time.
 *
 * The experience half is the only place the sampling matters, and it is the only
 * claim worth making about the feature as a whole: clear-cut a real colony's
 * doorstep, let it run unattended, and it has to still be able to build.
 */

import { describe, expect, it } from 'vitest';

import {
  CLEAR_R,
  CROWD,
  CROWD_R,
  FOREST_INTERVAL,
  MATURE_DAYS,
  SAPLING,
  TREE_WOOD,
  chopYield,
  isTimber,
  tickForest,
  treeGrowth,
} from '../src/sim/forest';
import { HARVEST_RADIUS, HARVEST_REACHES, boardClear } from '../src/sim/steward';
import { HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';
import { addBuilding, countResource, removeBuilding } from '../src/sim/world';
import { buildingAt, dist, isWalkable } from '../src/sim/grid';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { outdoorGrowth } from '../src/sim/farming';
import { Rng } from '../src/sim/rng';
import { DESIG_NONE, TICKS_PER_DAY, packCell, terrainAt } from '../src/sim/types';
import type { Building, World } from '../src/sim/types';

/**
 * A stream that always names the same cell.
 *
 * `tickForest` draws x then y and nothing else, so two numbers in a loop is the
 * whole contract. This is the difference between a test that states a rule and a
 * test that waits for a random walk to wander into the cell it cares about —
 * with 36 864 cells to choose from, the second kind is either slow or flaky and
 * usually both.
 */
function always(x: number, y: number): Rng {
  let n = 0;
  return { int: () => (n++ % 2 === 0 ? x : y) } as unknown as Rng;
}

/**
 * The valley with every tree taken off it.
 *
 * Two reasons, and the second one is the one that bites. The obvious one is that
 * an empty map makes a neighbourhood mean exactly what the test put in it. The
 * other is the ceiling: a fresh valley is already *at* the density the generator
 * drew it at, so `tickForest` on an untouched map correctly refuses to do
 * anything at all, and a test that forgot to clear first would pass for the wrong
 * reason on every single assertion below.
 */
function bareValley(seed = 20260729): World {
  const world = createWorld(seed);
  for (const b of [...world.buildings]) if (b.kind === 'tree') removeBuilding(world, b);
  return world;
}

/** A cell with nothing within the clearance ring, and room to plant a crowd. */
function clearing(world: World): { x: number; y: number } {
  for (let y = CLEAR_R + 2; y < world.height - CLEAR_R - 2; y++) {
    for (let x = CLEAR_R + 2; x < world.width - CLEAR_R - 2; x++) {
      let ok = true;
      // The whole ring has to be plantable, not just the middle: the crowding
      // case fills the inner square with trees, and a scenario that silently
      // failed to place them would read as "crowding does not stop it".
      for (let dy = -CLEAR_R; dy <= CLEAR_R && ok; dy++) {
        for (let dx = -CLEAR_R; dx <= CLEAR_R; dx++) {
          const cx = x + dx;
          const cy = y + dy;
          const t = terrainAt(world, cx, cy);
          const idx = packCell(world, cx, cy);
          if (
            !isWalkable(world, cx, cy) ||
            (t !== 'grass' && t !== 'dirt') ||
            buildingAt(world, cx, cy) !== null ||
            world.cellZone[idx] !== -1 ||
            world.cellDesig[idx] !== DESIG_NONE
          ) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('no clearing on this map');
}

function plant(world: World, x: number, y: number, grow?: number): Building {
  const b = addBuilding(world, 'tree', x, y, true);
  expect(b, `could not plant at ${x},${y}`).not.toBeNull();
  if (grow !== undefined) b!.grow = grow;
  return b!;
}

const grown = (world: World): number => world.stats.grown ?? 0;

describe('how grown a tree is', () => {
  const world = bareValley();

  it('reads a tree with no opinion as full grown', () => {
    // The save contract. `grow` is optional so that `SAVE_VERSION` never had to
    // move: every tree written before this system existed has no number on it,
    // and every one of them is supposed to be a hundred years old. If this ever
    // flips to 0 the first thing an old save does on load is turn its entire
    // forest into seedlings worth one wood each.
    const t = plant(world, 20, 20);
    expect(t.grow).toBeUndefined();
    expect(treeGrowth(t)).toBe(1);
    expect(isTimber(t)).toBe(true);
  });

  it('does not call a sapling timber', () => {
    const t = plant(world, 24, 20, SAPLING);
    expect(isTimber(t)).toBe(false);
  });

  it('answers 1 for anything that is not a tree', () => {
    // Not pedantry: `chopYield` multiplies by this, and the wall the colony is
    // deconstructing goes through the same call.
    const w = addBuilding(world, 'wall', 28, 20, true)!;
    expect(treeGrowth(w)).toBe(1);
  });
});

describe('what an axe gets you', () => {
  const world = bareValley();

  it('pays a full load for a grown tree', () => {
    const t = plant(world, 20, 24);
    expect(chopYield(world, t)).toBe(TREE_WOOD);
  });

  it('pays a sapling what a sapling is worth', () => {
    const t = plant(world, 24, 24, SAPLING);
    // The whole anti-exploit. Without the scaling a colony chops the seedling the
    // morning after it sprouts, banks the full load, and the valley is exactly as
    // exhaustible as it was before with one more step in the loop.
    expect(chopYield(world, t)).toBeLessThan(TREE_WOOD / 3);
  });

  it('never pays nothing at all', () => {
    // A chop that yields zero reads as the job being broken rather than as the
    // tree being small, and the player has no way to tell those apart.
    const t = plant(world, 28, 24, 0.001);
    expect(chopYield(world, t)).toBeGreaterThan(0);
  });
});

describe('where a seed may take', () => {
  it('grows nothing at all with no parent in reach', () => {
    const world = bareValley();
    const { x, y } = clearing(world);
    // A thousand passes at the same empty clearing. Seed rain is the rule that
    // stops a wood appearing in the middle of a meadow, and it is the one that
    // would fail silently: without it the valley slowly turns into a lawn of
    // evenly spaced trees and nothing in the game would complain.
    for (let i = 0; i < 1000; i++) tickForest(world, always(x, y));
    expect(grown(world)).toBe(0);
    expect(buildingAt(world, x, y)).toBeNull();
  });

  it('takes beside a standing wood', () => {
    const world = bareValley();
    const { x, y } = clearing(world);
    plant(world, x - 2, y);
    tickForest(world, always(x, y));
    expect(grown(world)).toBe(1);
    const b = buildingAt(world, x, y);
    expect(b?.kind).toBe('tree');
    expect(b?.grow).toBe(SAPLING);
  });

  it('will not take from a parent that is out of reach', () => {
    const world = bareValley();
    const { x, y } = clearing(world);
    plant(world, x - 4, y);
    for (let i = 0; i < 100; i++) tickForest(world, always(x, y));
    expect(grown(world)).toBe(0);
  });

  it('will not take from a parent that is itself a sapling', () => {
    const world = bareValley();
    const { x, y } = clearing(world);
    plant(world, x - 2, y, SAPLING);
    // Otherwise one seedling is a chain reaction: it seeds its neighbour on the
    // next pass, which seeds the next, and a single sapling fills the map to the
    // ceiling in an afternoon without one of them ever being worth felling.
    for (let i = 0; i < 100; i++) tickForest(world, always(x, y));
    expect(grown(world)).toBe(0);
  });

  it('keeps clear of anything the colony built', () => {
    const world = bareValley();
    const { x, y } = clearing(world);
    plant(world, x - 2, y);
    addBuilding(world, 'wall', x + CLEAR_R, y, true);
    // A pine coming up through the kitchen floor is not ecology, it is a bug
    // report — and the version of this the player actually notices is having to
    // clear their own yard every spring.
    for (let i = 0; i < 100; i++) tickForest(world, always(x, y));
    expect(grown(world)).toBe(0);
  });

  it('keeps clear of a blueprint too', () => {
    const world = bareValley();
    const { x, y } = clearing(world);
    plant(world, x - 2, y);
    // Ground the colony has decided about is spoken for whether or not anyone has
    // got round to building on it yet. A tree rooting inside a planned wall is a
    // job the player queued turning into a job they have to undo.
    addBuilding(world, 'wall', x + CLEAR_R, y, false);
    for (let i = 0; i < 100; i++) tickForest(world, always(x, y));
    expect(grown(world)).toBe(0);
  });

  it('will not grow through somebody standing there', () => {
    const world = bareValley();
    const { x, y } = clearing(world);
    plant(world, x - 2, y);
    const p = world.pawns.find((q) => !q.dead)!;
    p.x = x;
    p.y = y;
    // Survivable — the pathfinder lets a body inside a solid cell walk its way
    // out, the same recovery it gives someone with a wall raised over their
    // head. That is not the point. The point is that in first person this is a
    // pine coming up through the player's own face.
    for (let i = 0; i < 100; i++) tickForest(world, always(x, y));
    expect(grown(world)).toBe(0);

    p.x = x + 6;
    p.y = y + 6;
    tickForest(world, always(x, y));
    expect(grown(world)).toBe(1);
  });

  it('stops filling a gap once it is a wood', () => {
    const world = bareValley();
    const { x, y } = clearing(world);
    // Exactly the crowd, all of them grown, all inside the crowding radius — so
    // seed rain is satisfied and the only rule left to refuse is density.
    const spots: Array<[number, number]> = [];
    for (let dy = -CROWD_R; dy <= CROWD_R && spots.length < CROWD; dy++) {
      for (let dx = -CROWD_R; dx <= CROWD_R && spots.length < CROWD; dx++) {
        if (dx === 0 && dy === 0) continue;
        spots.push([x + dx, y + dy]);
      }
    }
    for (const [px, py] of spots) plant(world, px, py);
    for (let i = 0; i < 100; i++) tickForest(world, always(x, y));
    expect(grown(world)).toBe(0);

    // And one fewer neighbour is a gap again. Asserting the other side of the
    // threshold is what makes this a test of the rule rather than a test that
    // something, somewhere, said no.
    removeBuilding(world, buildingAt(world, spots[0]![0], spots[0]![1])!);
    tickForest(world, always(x, y));
    expect(grown(world)).toBe(1);
  });

  it('leaves an untouched valley alone', () => {
    // The ceiling is set at the density the generator draws, which makes the
    // whole system *replacement* rather than growth: a valley nobody has logged
    // is already full, and every tree that comes back is one that was taken.
    const world = createWorld(20260729);
    const trees = world.buildings.filter((b) => b.kind === 'tree').length;
    expect(trees).toBeGreaterThan(2000);
    for (let i = 0; i < 500; i++) tickForest(world, new Rng(1 + i));
    expect(grown(world)).toBe(0);
  });

  it('grows nothing through a hard winter', () => {
    const world = bareValley();
    const { x, y } = clearing(world);
    plant(world, x - 2, y);
    const sap = plant(world, x + 3, y + 3, SAPLING);
    // Midwinter, where the growing curve reads zero. Found rather than asserted
    // from a constant so this keeps meaning "winter" if the calendar moves.
    for (world.tick = 0; world.tick < TICKS_PER_DAY * 20; world.tick += FOREST_INTERVAL) {
      if (outdoorGrowth(world) === 0) break;
    }
    expect(outdoorGrowth(world)).toBe(0);
    for (let i = 0; i < 100; i++) tickForest(world, always(x, y));
    expect(grown(world)).toBe(0);
    expect(sap.grow).toBe(SAPLING);
  });
});

describe('a sapling growing up', () => {
  it('reaches timber in about a fortnight of ordinary weather', () => {
    const world = bareValley();
    const { x, y } = clearing(world);
    const sap = plant(world, x, y, SAPLING);
    let ticks = 0;
    for (; ticks < TICKS_PER_DAY * 60; ticks += FOREST_INTERVAL) {
      world.tick = ticks;
      tickForest(world, always(0, 0));
      if (isTimber(sap)) break;
    }
    const days = ticks / TICKS_PER_DAY;
    // A band, not a number, and deliberately: the exact day depends on which
    // season the seed happened to fall in, and pinning it to the tick would make
    // this a test of the calendar. What is being guarded is the order of
    // magnitude — that it is neither overnight nor never.
    //
    // This particular seed falls on the first morning of high summer, which is
    // the fastest run the year has: it measures 6.6 days against a fourteen-day
    // constant, because the constant is a calendar figure corrected for a year
    // that is only half growing weather. A seed dropped in late autumn spends
    // most of a season doing nothing and comes in at the other end of the band.
    expect(isTimber(sap)).toBe(true);
    expect(days).toBeGreaterThan(MATURE_DAYS / 4);
    expect(days).toBeLessThan(MATURE_DAYS * 3);
  });

  it('never grows past full', () => {
    const world = bareValley();
    const t = plant(world, 30, 30, 0.99);
    for (let i = 0; i < 200; i++) {
      world.tick = i * FOREST_INTERVAL;
      tickForest(world, always(0, 0));
    }
    expect(t.grow).toBe(1);
  });
});

describe('the foreman and the forest', () => {
  it('leaves the steward with a clear board', () => {
    // The sharpest edge in this feature and the one that would never have shown
    // up in play as a forest bug. `boardClear` is false while *any* building is
    // unbuilt, and the steward does nothing at all until the board is clear — so
    // a sapling added as a blueprint would have quietly switched the foreman off
    // for the rest of the run, with every steward test in the suite still green
    // because none of them grow a tree.
    const world = bareValley();
    const { x, y } = clearing(world);
    plant(world, x - 2, y);
    expect(boardClear(world)).toBe(true);
    tickForest(world, always(x, y));
    expect(grown(world)).toBe(1);
    expect(boardClear(world)).toBe(true);
  });

  it('reaches further out than its home ring', () => {
    // The other half of the answer. Regrowth takes a fortnight and a colony of
    // fifteen wants timber this afternoon, so the ring the foreman marks in has
    // to widen when the near wood comes back empty — otherwise the first ring
    // running out reads to the foreman as the valley being empty.
    expect(HARVEST_REACHES[0]).toBe(HARVEST_RADIUS);
    expect(HARVEST_REACHES.length).toBeGreaterThan(1);
    for (let i = 1; i < HARVEST_REACHES.length; i++) {
      expect(HARVEST_REACHES[i]!).toBeGreaterThan(HARVEST_REACHES[i - 1]!);
    }
  });
});

describe('a colony that clear-cut its own doorstep', () => {
  it('can still build a month later', () => {
    // The experience test, and the measurement that caused this whole module:
    // seed 20260729 ran ninety unattended days, cut every tree inside the
    // foreman's twenty-two-cell reach by day eighty-five, and finished sitting at
    // zero wood with fifteen settlers and three hundred buildings — not starving,
    // not raided, just permanently unable to put up another wall.
    //
    // So: do the damage on day one instead of waiting eighty-five days for the
    // colony to do it, and then ask the only question that matters.
    const world = createWorld(20260729);
    for (const b of [...world.buildings]) {
      if (b.kind === 'tree' && dist(b.x, b.y, HOME_X, HOME_Y) < HARVEST_RADIUS) {
        removeBuilding(world, b);
      }
    }
    const near = () =>
      world.buildings.filter(
        (b) => b.kind === 'tree' && dist(b.x, b.y, HOME_X, HOME_Y) < HARVEST_RADIUS,
      ).length;
    expect(near()).toBe(0);

    const streams = makeStreams(world);
    stepWorldN(world, streams, TICKS_PER_DAY * 30);

    // Two independent things had to work. The valley put trees back up on its
    // own — which it can only do because the clear-cut opened room under the
    // ceiling — and the colony got hold of wood anyway during the fortnight
    // before any of them were worth felling, which is the foreman walking out to
    // the wider ring.
    expect(grown(world)).toBeGreaterThan(0);
    expect(countResource(world, 'wood')).toBeGreaterThan(0);
    expect(world.stats.built).toBeGreaterThan(0);
    // Thirty days is 144 000 ticks and the sim costs about 1.7 ms of them, so
    // this run measures 247 s alone on a quiet machine — the old 300 s budget
    // left twenty percent of headroom and the suite eats that in contention.
    // Same reasoning, and the same multiple, as the twenty-day connectivity run.
  }, 900_000);
});
