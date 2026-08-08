/**
 * Crops — the colony's only renewable food.
 *
 * Worldgen hands out 45 units of raw food and nothing ever makes more, so before
 * this existed every colony was on a hard two-week countdown: the eval runs
 * showed `mealsCooked` freezing around day 6 and three settlers bleeding out
 * from starvation on day 15 on every seed. A colony sim needs a food loop the
 * players can widen, and this is it — paint a growing zone, settlers sow it,
 * sunlight ripens it, settlers harvest raw food back into the pantry.
 *
 * Growth is driven by `daylight()` rather than by a flat per-tick rate, which is
 * why a crop stalls overnight and why both views can read the same plant and see
 * the same stage.
 */

import { daylight } from './clock';
import { buildingAt, isWalkable } from './grid';
import { cropGrowthScale } from './research';
import { growingTemp, seasonMeanTemp } from './temperature';
import { growthMultiplier } from './weather';
import { TICKS_PER_DAY, type Terrain, type World } from './types';
import { inBounds, isFloor, packCell, terrainAt, unpackX, unpackY } from './types';

/** Bare soil. Anything >= 0 is a living plant, 1 is ripe. */
export const CROP_NONE = -1;

/** In-game days from sown to ripe, in wall-clock days at 1x speed. */
const RIPEN_DAYS = 3;
/**
 * Mean of `daylight()` across a full day. Growth is multiplied by the live
 * daylight value, so this factor is what keeps RIPEN_DAYS readable as days
 * rather than as "days of perfect noon".
 */
const MEAN_DAYLIGHT = 0.4;
const GROWTH_PER_TICK = 1 / (RIPEN_DAYS * MEAN_DAYLIGHT * TICKS_PER_DAY);

/**
 * The temperature band a crop grows in, in °C.
 *
 * Full speed at ten and above, nothing at all at four, straight line between.
 * Ten is chosen so the band is invisible in the weather the game was balanced
 * in — the coldest daily mean of summer is thirteen, so a summer plot runs at
 * exactly the rate it always did and none of the numbers above move. It is
 * autumn that reads the slope, and winter that sits under the floor: midwinter
 * outdoors is about -2 °C mean, so a plot left out in it does not creep along
 * slowly, it stops. That is the whole reason the season exists — a pantry you
 * fill in autumn or a greenhouse you heat, not a plot you keep sowing and hope.
 *
 * Four rather than zero for the floor, and it is the number that decides what a
 * roof is worth. Agronomy puts the base temperature of cool-season crops at
 * about that — below it a plant is alive but not accumulating anything — and
 * the game reason lands in the same place: a sealed, *unheated* room in
 * midwinter settles around seven degrees, which against a zero floor would run
 * a plot at two thirds speed and make four walls very nearly the whole answer
 * to winter. Against four it runs at half, which is what a roof should buy —
 * real, and not enough. The fire is what buys the rest.
 */
const GROW_STOP = 4;
const GROW_FULL = 10;

/**
 * How much of its full speed a crop on this cell is growing at, 0..1.
 *
 * Per cell rather than per world, because a plot indoors is answering to its
 * room and a plot outdoors is answering to the year, and a colony that has built
 * a greenhouse has earned the difference.
 */
export function seasonScale(world: World, x: number, y: number): number {
  return growthAt(growingTemp(world, x, y));
}

/**
 * The same curve for anything growing under the open sky, read once for the
 * whole valley instead of once per plant.
 *
 * Every outdoor cell answers to `seasonMeanTemp` and nothing else — `roomAt`
 * returns null out there, so `growingTemp` hands back the year's number and the
 * per-cell lookup was asking a question whose answer could not vary. That is
 * fine for a dozen furrows and ruinous for a moor: `roomAt` re-hashes the whole
 * building list on every call, so a hundred and fifty bramble bushes were
 * walking the colony's buildings a hundred and fifty times a tick to be told the
 * same number. It was the single most expensive thing in the sim.
 */
export function outdoorGrowth(world: World): number {
  return growthAt(seasonMeanTemp(world));
}

function growthAt(t: number): number {
  const f = (t - GROW_STOP) / (GROW_FULL - GROW_STOP);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** Work to plant one cell, and to pull one ripe cell. */
export const SOW_WORK = 40;
export const HARVEST_WORK = 55;

/**
 * Raw food from one ripe cell, before the grower's skill bonus.
 *
 * Three settlers burn about eight raw food a day once it is cooked, so a
 * twelve-cell plot on a three-day cycle runs at roughly twice the colony's
 * appetite. Enough that a fed colony stays fed through a bad week; not so much
 * that a player can ignore the plot and still eat.
 */
export const CROP_YIELD = 4;

/**
 * How fast a crop grows on each kind of ground.
 *
 * Broken soil is 1.0 and everything else is measured down from it. The anchor has
 * to be dirt rather than grass because worldgen lays the starter garden on dirt:
 * anchoring anywhere else would have handed the existing plot a silent buff or
 * nerf and re-tuned the whole food economy behind the feature's back. So tilling
 * does not make good ground better — it brings poor ground *up* to the ground the
 * colony already farms, which is the honest version of the promise.
 */
export const TERRAIN_GROWTH: Record<Terrain, number> = {
  dirt: 1,
  grass: 0.8,
  sand: 0.55,
  stone: 0.4,
  // Neither can hold a growing zone in the first place — listed so the record is
  // total and a new terrain cannot be added without deciding what grows on it.
  rock: 0,
  water: 0,
  // A laid floor is the opposite of a field. Nothing grows through boards.
  plank: 0,
  paved: 0,
  // Boards with a lake under them, which is two reasons rather than one.
  bridge: 0,
};

/** The work of breaking one cell of ground. Half a mining job: turning soil, not cutting it. */
export const TILL_WORK = 90;

/**
 * Ground a settler can break. Rock and water are out because nothing can stand
 * there, a building means the soil is already spoken for, and dirt is the answer
 * rather than the question.
 */
export function canTill(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return false;
  if (!isWalkable(world, x, y)) return false;
  const t = terrainAt(world, x, y);
  if (t === 'dirt') return false;
  // Boards are not soil with a covering — a floor has to be pulled up before the
  // ground under it is ground again.
  if (isFloor(t)) return false;
  return buildingAt(world, x, y) === null;
}

/** Growth multiplier from the ground a cell stands on. */
export function soilScale(world: World, x: number, y: number): number {
  return TERRAIN_GROWTH[terrainAt(world, x, y)];
}

/** Can a crop live in this cell? Growing zones can be painted over anything walkable. */
export function canSow(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return false;
  if (!isWalkable(world, x, y)) return false;
  if (isFloor(terrainAt(world, x, y))) return false;
  // A building on the cell (a wall raised over the plot, a bed dragged onto it)
  // takes the soil out of production rather than growing wheat through a floor.
  return buildingAt(world, x, y) === null;
}

/** Packed cells of every growing zone, in zone order. */
export function growingCells(world: World): number[] {
  const out: number[] = [];
  for (const z of world.zones) {
    if (z.kind !== 'growing') continue;
    for (const c of z.cells) out.push(c);
  }
  return out;
}

export function cropAt(world: World, x: number, y: number): number {
  if (!inBounds(world, x, y)) return CROP_NONE;
  return world.crops[packCell(world, x, y)] ?? CROP_NONE;
}

export function isRipe(world: World, x: number, y: number): boolean {
  return cropAt(world, x, y) >= 1;
}

/**
 * Advance every planted cell by one tick of sunlight.
 *
 * Only cells inside a growing zone are considered, so this costs a dozen array
 * reads rather than a sweep of the whole map — and a crop whose zone was erased
 * is cleared at erase time (orders.ts) rather than left growing invisibly.
 */
export function tickCrops(world: World): void {
  const light = daylight(world);
  if (light <= 0) return;
  // Rain is the only thing a player can be handed that makes a plot ripen
  // faster, which is what turns a wet afternoon into a reason to sow more.
  const step = GROWTH_PER_TICK * light * growthMultiplier(world) * cropGrowthScale(world);
  for (const c of growingCells(world)) {
    const g = world.crops[c] ?? CROP_NONE;
    if (g < 0 || g >= 1) continue;
    // Per cell, not per plot: a half-tilled zone really does ripen in two waves,
    // which is the visible reward for having broken the ground.
    const x = unpackX(world, c);
    const y = unpackY(world, c);
    world.crops[c] = Math.min(1, g + step * soilScale(world, x, y) * seasonScale(world, x, y));
  }
}
