/**
 * Terraforming — breaking ground into soil.
 *
 * The functional half pins the two rules the feature rests on: which cells a
 * settler is allowed to break, and what the ground under a crop is worth. The
 * experience half is the only question a player asks about a shovel — I painted
 * the order, did anybody actually go and dig, and did the plot come in faster
 * afterwards.
 *
 * The `dirt = 1.0` anchor is load-bearing and is asserted directly. Worldgen lays
 * the starter garden on dirt, so that is the ground every balance number in the
 * food economy was tuned against — tilling has to bring poor ground *up* to it,
 * never move it.
 */

import { describe, expect, it } from 'vitest';

import {
  CROP_NONE,
  TERRAIN_GROWTH,
  TILL_WORK,
  canTill,
  cropAt,
  growingCells,
  soilScale,
  tickCrops,
} from '../src/sim/farming';
import { CABIN, GARDEN, createWorld } from '../src/sim/worldgen';
import { addBuilding } from '../src/sim/world';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { designate, paintGrowingZone, setPriority } from '../src/sim/orders';
import { TILL_BATCH, breakGroundInThePlot, stewardTick } from '../src/eval/steward';
import {
  DESIG_NONE,
  DESIG_TILL,
  TERRAIN_LIST,
  TICKS_PER_DAY,
  packCell,
  terrainAt,
} from '../src/sim/types';
import type { Terrain, World } from '../src/sim/types';

function game(seed = 4242) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

/**
 * Open ground near the cabin: walkable, nothing built on it, not already soil.
 *
 * Scanned rather than hard-coded because worldgen scatters trees and rock by
 * seed — a fixed cell is a clear yard on one seed and the inside of a boulder on
 * the next, and the test would be asserting worldgen's luck rather than the rule.
 */
function openCell(world: World): { x: number; y: number } {
  for (let r = 2; r < 12; r++) {
    for (let y = CABIN.y0 - r; y <= CABIN.y1 + r; y++) {
      for (let x = CABIN.x0 - r; x <= CABIN.x1 + r; x++) {
        if (canTill(world, x, y) && canTill(world, x + 1, y)) return { x, y };
      }
    }
  }
  throw new Error('no open ground on this seed');
}

function setTerrain(world: World, x: number, y: number, t: Terrain): void {
  world.terrain[packCell(world, x, y)] = TERRAIN_LIST.indexOf(t);
}

/** Everyone on farm duty and nothing else, so a till order is the work on offer. */
function farmhandsOnly(world: World): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
      setPriority(world, p.id, w, w === 'farm' ? 3 : 0);
    }
  }
}

describe('what ground can be broken', () => {
  it('accepts plain grass', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'grass');
    expect(canTill(world, c.x, c.y)).toBe(true);
  });

  it('refuses ground that is already soil — there is nothing left to break', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'dirt');
    expect(canTill(world, c.x, c.y)).toBe(false);
  });

  it('accepts a mined-out quarry floor, which is the point of having stone be poor', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'stone');
    expect(canTill(world, c.x, c.y)).toBe(true);
  });

  it('refuses rock and water — nobody can stand there', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'rock');
    expect(canTill(world, c.x, c.y)).toBe(false);
    setTerrain(world, c.x, c.y, 'water');
    expect(canTill(world, c.x, c.y)).toBe(false);
  });

  it('refuses a cell with a building on it — that soil is spoken for', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'grass');
    expect(addBuilding(world, 'wall', c.x, c.y, true)).not.toBeNull();
    expect(canTill(world, c.x, c.y)).toBe(false);
  });

  it('refuses cells off the map', () => {
    const { world } = game();
    expect(canTill(world, -1, 10)).toBe(false);
    expect(canTill(world, world.width, 10)).toBe(false);
  });
});

describe('what the ground is worth', () => {
  it('anchors soil at exactly 1, so tilling never re-tunes the starter garden', () => {
    // Not a taste assertion. Worldgen lays the starter plot on dirt, so dirt is
    // the multiplier the whole food economy was balanced at — if this drifts off
    // 1, every crop number in the game silently moved with it.
    expect(TERRAIN_GROWTH.dirt).toBe(1);
    const { world } = game();
    for (let x = GARDEN.x0; x <= GARDEN.x1; x++) {
      for (let y = GARDEN.y0; y <= GARDEN.y1; y++) {
        expect(soilScale(world, x, y)).toBe(1);
      }
    }
  });

  it('makes broken soil the best ground and rock the worst', () => {
    expect(TERRAIN_GROWTH.dirt).toBeGreaterThan(TERRAIN_GROWTH.grass);
    expect(TERRAIN_GROWTH.grass).toBeGreaterThan(TERRAIN_GROWTH.sand);
    expect(TERRAIN_GROWTH.sand).toBeGreaterThan(TERRAIN_GROWTH.stone);
    expect(TERRAIN_GROWTH.rock).toBe(0);
    expect(TERRAIN_GROWTH.water).toBe(0);
  });

  it('reads the scale off the cell, not off the plot', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'sand');
    expect(soilScale(world, c.x, c.y)).toBe(TERRAIN_GROWTH.sand);
    setTerrain(world, c.x, c.y, 'dirt');
    expect(soilScale(world, c.x, c.y)).toBe(TERRAIN_GROWTH.dirt);
  });
});

describe('growth per cell', () => {
  /** Two neighbouring plot cells, one broken and one not, sown at the same instant. */
  function twoBeds(world: World): { rich: number; plain: number } {
    const y = GARDEN.y0;
    const rich = packCell(world, GARDEN.x0, y);
    const plain = packCell(world, GARDEN.x0 + 1, y);
    for (const [x, t] of [
      [GARDEN.x0, 'dirt'],
      [GARDEN.x0 + 1, 'grass'],
    ] as const) {
      setTerrain(world, x, y, t as Terrain);
      paintGrowingZone(world, x, y);
    }
    world.crops[rich] = 0;
    world.crops[plain] = 0;
    return { rich, plain };
  }

  it('ripens broken soil faster than the grass beside it', () => {
    const { world } = game();
    const { rich, plain } = twoBeds(world);
    // Noon, so daylight is not zero and the two cells get the same sunlight.
    world.tick = Math.round(4800 * 0.5);
    for (let i = 0; i < 400; i++) tickCrops(world);
    expect(world.crops[rich]!).toBeGreaterThan(world.crops[plain]!);
    expect(world.crops[plain]!).toBeGreaterThan(0);
  });

  it('still ripens the starter garden on its documented three-day clock', () => {
    // The regression that matters. `soilScale` multiplies into the growth step, so
    // a wrong anchor would not throw or fail a type check — it would just quietly
    // move every harvest in the game. This measures the plot the way the design
    // note claims it behaves, on the ground worldgen actually laid it on.
    const { world } = game();
    const seedling = packCell(world, GARDEN.x0, GARDEN.y0);
    world.crops[seedling] = 0;
    // Crops only, no settlers: a farmhand would pull the cell the moment it ripened
    // and the reading would be about harvest speed instead of growth speed.
    const grow = (days: number) => {
      for (let i = 0; i < TICKS_PER_DAY * days; i++) {
        world.tick++;
        tickCrops(world);
      }
    };
    grow(2);
    expect(world.crops[seedling]!).toBeLessThan(1);
    grow(1.5);
    expect(world.crops[seedling]!).toBeGreaterThanOrEqual(1);
  });

  it('does not grow anything on a cell with no plant in it', () => {
    const { world } = game();
    const bare = packCell(world, GARDEN.x0, GARDEN.y0);
    setTerrain(world, GARDEN.x0, GARDEN.y0, 'dirt');
    paintGrowingZone(world, GARDEN.x0, GARDEN.y0);
    world.crops[bare] = CROP_NONE;
    world.tick = Math.round(4800 * 0.5);
    for (let i = 0; i < 200; i++) tickCrops(world);
    expect(world.crops[bare]).toBe(CROP_NONE);
  });
});

describe('the till order', () => {
  it('takes on ground that can be broken and refuses ground that cannot', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'grass');
    expect(designate(world, c.x, c.y, DESIG_TILL)).toBe(true);
    expect(world.cellDesig[packCell(world, c.x, c.y)]).toBe(DESIG_TILL);

    setTerrain(world, c.x + 1, c.y, 'water');
    expect(designate(world, c.x + 1, c.y, DESIG_TILL)).toBe(false);
  });

  it('can be rubbed out again', () => {
    const { world } = game();
    const c = openCell(world);
    setTerrain(world, c.x, c.y, 'grass');
    designate(world, c.x, c.y, DESIG_TILL);
    expect(designate(world, c.x, c.y, DESIG_NONE)).toBe(true);
    expect(world.cellDesig[packCell(world, c.x, c.y)]).toBe(DESIG_NONE);
  });
});

describe('the shovel, played', () => {
  it('sends a settler out to break the ground and leaves soil behind', () => {
    const { world, streams } = game();
    farmhandsOnly(world);
    // Just outside the cabin door, so the walk is short enough to finish inside
    // the window without the test asserting anything about pathfinding.
    const x = CABIN.doorX;
    const y = CABIN.doorY + 3;
    setTerrain(world, x, y, 'grass');
    expect(canTill(world, x, y)).toBe(true);
    expect(designate(world, x, y, DESIG_TILL)).toBe(true);

    stepWorldN(world, streams, 1200);

    expect(terrainAt(world, x, y)).toBe('dirt');
    expect(world.cellDesig[packCell(world, x, y)]).toBe(DESIG_NONE);
  });

  it('never leaves a ripe cell standing to go and dig', () => {
    // Tilling is the farm's idle work on purpose. A colony with a ripe plot and a
    // yard full of till orders has to bring the food in first.
    const { world, streams } = game();
    farmhandsOnly(world);
    for (let x = GARDEN.x0; x <= GARDEN.x1; x++) {
      for (let y = GARDEN.y0; y <= GARDEN.y1; y++) {
        paintGrowingZone(world, x, y);
        world.crops[packCell(world, x, y)] = 1;
      }
    }
    for (let i = 0; i < 12; i++) {
      const x = CABIN.doorX - 5 + i;
      const y = CABIN.doorY + 2;
      if (canTill(world, x, y)) designate(world, x, y, DESIG_TILL);
    }

    stepWorldN(world, streams, 1200);

    let ripe = 0;
    for (let x = GARDEN.x0; x <= GARDEN.x1; x++) {
      for (let y = GARDEN.y0; y <= GARDEN.y1; y++) {
        if (cropAt(world, x, y) >= 1) ripe++;
      }
    }
    expect(ripe).toBe(0);
  });

  it('gives up on a cell somebody walled over instead of standing there forever', () => {
    const { world, streams } = game();
    farmhandsOnly(world);
    const x = CABIN.doorX;
    const y = CABIN.doorY + 3;
    setTerrain(world, x, y, 'grass');
    designate(world, x, y, DESIG_TILL);
    stepWorldN(world, streams, 40);
    expect(addBuilding(world, 'wall', x, y, true)).not.toBeNull();

    stepWorldN(world, streams, 200);

    expect(world.cellDesig[packCell(world, x, y)]).toBe(DESIG_NONE);
    expect(world.jobs.some((j) => j.kind === 'till')).toBe(false);
  });

  it('costs real work — one cell does not fall in a couple of ticks', () => {
    expect(TILL_WORK).toBeGreaterThan(40);
    const { world, streams } = game();
    farmhandsOnly(world);
    const x = CABIN.doorX;
    const y = CABIN.doorY + 3;
    setTerrain(world, x, y, 'grass');
    designate(world, x, y, DESIG_TILL);
    stepWorldN(world, streams, 30);
    expect(terrainAt(world, x, y)).not.toBe('dirt');
  });

  it('brings a broken plot in ahead of an untouched one', () => {
    // The payoff, measured the way a player would notice it: same seed, same plot,
    // same clock — one colony broke the ground first and eats sooner.
    function plotAfter(soil: Terrain): number {
      const { world, streams } = game(777);
      farmhandsOnly(world);
      for (let x = GARDEN.x0; x <= GARDEN.x1; x++) {
        for (let y = GARDEN.y0; y <= GARDEN.y1; y++) {
          setTerrain(world, x, y, soil);
          paintGrowingZone(world, x, y);
          world.crops[packCell(world, x, y)] = 0;
        }
      }
      stepWorldN(world, streams, TICKS_PER_DAY * 2);
      let sum = 0;
      for (let x = GARDEN.x0; x <= GARDEN.x1; x++) {
        for (let y = GARDEN.y0; y <= GARDEN.y1; y++) sum += Math.max(0, cropAt(world, x, y));
      }
      return sum;
    }
    expect(plotAfter('dirt')).toBeGreaterThan(plotAfter('grass'));
  });
});

describe('the Steward breaks its own ground', () => {
  /** A plot of raw ground, so there is something left to break. */
  function rawPlot(world: World): number {
    let n = 0;
    for (let x = GARDEN.x0; x <= GARDEN.x1; x++) {
      for (let y = GARDEN.y0; y <= GARDEN.y1; y++) {
        setTerrain(world, x, y, 'grass');
        paintGrowingZone(world, x, y);
        n++;
      }
    }
    return n;
  }

  it('marks plot cells for tilling, in batches rather than all at once', () => {
    const { world } = game();
    const cells = rawPlot(world);
    breakGroundInThePlot(world);
    const marked = world.cellDesig.filter((d) => d === DESIG_TILL).length;
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThan(cells);
  });

  it('does not pile on more marks while the last batch is still outstanding', () => {
    const { world } = game();
    rawPlot(world);
    breakGroundInThePlot(world);
    const first = world.cellDesig.filter((d) => d === DESIG_TILL).length;
    breakGroundInThePlot(world);
    breakGroundInThePlot(world);
    expect(world.cellDesig.filter((d) => d === DESIG_TILL).length).toBe(first);
  });

  it('stops marking once the plot is all soil', () => {
    const { world } = game();
    rawPlot(world);
    for (let x = GARDEN.x0; x <= GARDEN.x1; x++) {
      for (let y = GARDEN.y0; y <= GARDEN.y1; y++) setTerrain(world, x, y, 'dirt');
    }
    breakGroundInThePlot(world);
    expect(world.cellDesig.filter((d) => d === DESIG_TILL).length).toBe(0);
  });

  it('turns a plot of raw ground into soil on its own, hands-off', () => {
    // The whole feature, from the Steward's side: nobody paints a till order, the
    // colony just notices its beds are poor ground and fixes them while it works.
    const { world, streams } = game(31337);
    const cells = rawPlot(world);
    expect(plotSoil(world)).toBe(0);
    for (let day = 0; day < 5; day++) {
      for (let i = 0; i < TICKS_PER_DAY; i++) {
        stewardTick(world, world.tick);
        stepWorldN(world, streams, 1);
      }
    }
    // Not `=== cells`: the Steward also widens the plot as it goes, and the point
    // is that it leaves no raw bed behind it — including the ones it just added.
    expect(plotSoil(world)).toBeGreaterThanOrEqual(cells);
    // "No raw bed behind it" means none it is not already dealing with, not none
    // at any instant. The plot is sized off the head count, so a settler who walks
    // in on the last afternoon adds six beds that are marked and queued but not yet
    // dug — and freezing the clock there is not a Steward that fell behind. Stated
    // as the two things that are actually promised: nothing raw that is not marked,
    // and never more than one batch of marks outstanding. A Steward that stopped
    // digging fails the first; one that carpeted the plot in orders fails the second.
    const raw = growingCells(world).length - plotSoil(world);
    const marked = world.cellDesig.filter((d) => d === DESIG_TILL).length;
    expect(raw).toBeLessThanOrEqual(marked);
    expect(marked).toBeLessThanOrEqual(TILL_BATCH);
  });
});

function plotSoil(world: World): number {
  let n = 0;
  for (const z of world.zones) {
    if (z.kind !== 'growing') continue;
    for (const c of z.cells) {
      if (TERRAIN_LIST[world.terrain[c]!] === 'dirt') n++;
    }
  }
  return n;
}

describe('the till order in a running colony', () => {
  it('never leaves a mark, or a job, pointing at ground that cannot be dug', () => {
    // The invariant a designation system lives or dies by. Checked every half day
    // rather than only at the end, because the failure mode is a mark that gets
    // stranded mid-run — a wall raised over it, a crop zone moved — and a colony
    // that quietly accumulates undiggable orders looks exactly like a working one
    // until a settler is standing in front of a boulder with a hoe.
    const { world, streams } = game(2468);
    for (let half = 0; half < 8; half++) {
      stepWorldN(world, streams, TICKS_PER_DAY / 2);
      for (let i = 0; i < world.cellDesig.length; i++) {
        if (world.cellDesig[i] !== DESIG_TILL) continue;
        expect(canTill(world, i % world.width, Math.floor(i / world.width))).toBe(true);
      }
      for (const j of world.jobs) {
        if (j.kind !== 'till') continue;
        expect(canTill(world, j.tx, j.ty)).toBe(true);
      }
    }
    expect(world.gameOver).toBe(false);
  });
});
