/**
 * Bramblebushes — the bottom of the food chain.
 *
 * Everything the colony could eat before this was something the colony made: a
 * plot it sowed, a lake it built a stage over, an animal it walked out and shot.
 * All three are answers to "what do I build", and none of them is an answer to
 * "what is *out there*". A valley you can eat out of before you have built
 * anything is what makes the first three days a place rather than a countdown,
 * and it is the only food in the game the player does not have to earn twice.
 *
 * It is deliberately poor. Two raw food a bush, six days to fruit again, and
 * nothing at all through the cold half of the year — a colony can forage its way
 * out of a bad week and cannot forage its way through a winter. The plot is still
 * the answer; the brambles are the reason the first week is survivable while you
 * dig one.
 *
 * The part that makes this a food *chain* rather than a third pantry is that the
 * colony is not the only thing eating here. A brambletail strips a ripe bush and
 * leaves nothing, a fenwolf eats brambletails, and so a valley the colony has
 * cleared of predators quietly stops yielding berries. That loop is the whole
 * point of the module and it is why `stripBush` exists beside `pickBush`: the two
 * do the same thing to the plant and only one of them puts food in the pantry.
 *
 * Sparse by construction — a list of bushes, not a grid. There are about three
 * hundred and thirty of them on a map of thirty-seven thousand cells, and a
 * per-cell array would be a thirty-seven-thousand-entry scan twenty times a
 * second to find them.
 */

import { daylight } from './clock';
import { buildingAt, isWalkable } from './grid';
import { outdoorGrowth } from './farming';
import { Rng } from './rng';
import { growthMultiplier } from './weather';
import { TICKS_PER_DAY, type Bush, type World } from './types';
import { inBounds, packCell, terrainAt, unpackX, unpackY } from './types';

export type { Bush };

/**
 * Raw food off one ripe bush, before the forager's skill.
 *
 * Two, against a crop cell's four, and the gap is the argument for the plot. A
 * bush is also a walk — the plot is twelve cells in one place and the brambles
 * are eighty cells scattered over a valley — so the real ratio at the pantry door
 * is worse than two-to-four, which is correct: this is what you eat while you are
 * building the thing you meant to eat.
 */
export const BUSH_YIELD = 2;

/** Standing at a bush, stripping it. Under a crop harvest: there is no soil to work. */
export const FORAGE_WORK = 40;

/** Days from picked to ripe again, at mean daylight in the growing season. */
const REGROW_DAYS = 6;
const MEAN_DAYLIGHT = 0.4;
const REGROW_PER_TICK = 1 / (REGROW_DAYS * MEAN_DAYLIGHT * TICKS_PER_DAY);

/**
 * Bramble patches per cell of map, expressed against the old 96×96 valley.
 *
 * A density rather than a count, for the same reason the wildlife cap is one: a
 * bigger valley should be a bigger wilderness, not the same wilderness spread
 * thinner. See `populationCap` in `wildlife.ts`.
 *
 * Thirty rather than the ten this shipped as, because ten was a guess and the
 * arithmetic falsified it. A browser strips one bush every three quarters of a
 * day and a bush takes six days to come back, so a moor of N bushes feeds N/8
 * animals and no more — at ten patches that was fifty-odd bushes carrying six
 * brambletails, against eleven the valley actually spawns. The moor was stripped
 * bare inside two days and stayed that way, which is not a food chain: it is a
 * population crash with no bottom, and a player who walked out to forage would
 * have found bare sticks and concluded the feature was decorative.
 */
const PATCHES_PER_CELL = 30 / (96 * 96);
/** Bushes in a patch. Patches rather than singles, because a patch reads as a place. */
const PATCH_MIN = 3;
const PATCH_SPAN = 4;
/** How far from its centre a patch scatters. */
const PATCH_RADIUS = 3;
/**
 * Nothing inside this of the homestead.
 *
 * Not because berries by the door would be unbalanced — they would barely be —
 * but because the first thing a player should see when they look at their yard is
 * the yard. Foraging is a reason to go *out*, and a bramble growing against the
 * cabin wall would turn it into another thing that happens in the same fifteen
 * cells everything else already happens in.
 */
const HOME_CLEARANCE = 9;

/** Which ground carries brambles. Soil, and nothing anybody laid down. */
function canRoot(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return false;
  if (!isWalkable(world, x, y)) return false;
  const t = terrainAt(world, x, y);
  if (t !== 'grass' && t !== 'dirt') return false;
  if (buildingAt(world, x, y) !== null) return false;
  // A growing zone is soil the colony has claimed. A bush in the middle of the
  // plot would be picked as forage and re-sown as wheat by two settlers who each
  // think they own the cell.
  return world.cellZone[packCell(world, x, y)] === -1;
}

/**
 * Scatter the brambles. Called once from worldgen, with its own private stream.
 *
 * Private for the same reason the lake's is: worldgen spends one shared `Rng` in
 * a fixed order, and a single extra roll taken from it re-rolls every terrain,
 * tree and settler decision downstream — which is to say every seed in the game.
 * See the note above `carveLake`.
 *
 * Where home is, this function decides — it used to be told, and being told is
 * what broke it. Worldgen passed the cabin's geometric centre and `ensureBushes`,
 * regrowing the same valley for a save written before brambles existed, passed
 * the centre of the map. The cabin is one cell wider to the west than to the east
 * so those two are a cell apart, which is nothing until a patch centre lands in
 * the ring between them: then the two calls disagree about whether it is in the
 * yard, and the save that never had bushes gets a *different moor* from the seed
 * it was written under. It hid at 128 because a hundred and thirty-nine patch
 * centres never happened to land in that ring; at 192 there are three hundred and
 * thirty-eight and two of them do. One rule, one caller-proof place to keep it.
 */
export function scatterBushes(world: World, rng: Rng): void {
  const homeX = Math.round(world.width / 2);
  const homeY = Math.round(world.height / 2);
  const bushes: Bush[] = [];
  const taken = new Set<number>();
  const patches = Math.max(4, Math.round(world.width * world.height * PATCHES_PER_CELL));
  for (let p = 0; p < patches; p++) {
    // One try per patch rather than a retry loop. A patch centre that lands in the
    // lake or in the yard simply does not happen, which is what makes the count a
    // ceiling on a rocky map instead of a promise the generator has to keep.
    const cx = 3 + rng.int(world.width - 6);
    const cy = 3 + rng.int(world.height - 6);
    if (Math.hypot(cx - homeX, cy - homeY) < HOME_CLEARANCE) continue;
    const n = PATCH_MIN + rng.int(PATCH_SPAN);
    for (let i = 0; i < n; i++) {
      const x = cx + rng.int(PATCH_RADIUS * 2 + 1) - PATCH_RADIUS;
      const y = cy + rng.int(PATCH_RADIUS * 2 + 1) - PATCH_RADIUS;
      // The clearance again, on the bush this time. The line above keeps patch
      // *centres* out of the yard and a patch is four cells wide, so a centre
      // standing just outside the ring can still put a bush inside it — which is
      // how a bramble came to be growing eight paces from the door on a rule that
      // says nine. Cheap, and it makes the promise a promise instead of a
      // tendency.
      if (Math.hypot(x - homeX, y - homeY) < HOME_CLEARANCE) continue;
      if (!canRoot(world, x, y)) continue;
      const c = packCell(world, x, y);
      if (taken.has(c)) continue;
      taken.add(c);
      // Ripeness spread across the cycle *and over the top of it*, so the valley
      // the colony lands in has some fruit on it now and some coming, rather than
      // every bush ripening on the same afternoon for the rest of the run. The
      // range runs past 1 on purpose: drawn in [0,1) not one bush on the map is
      // ever in fruit on the first morning, and a player who walked out to look
      // at the feature on day one would find a valley of bare sticks and six days
      // of nothing. A third of them are ready when the colony lands.
      bushes.push({ c, ripe: Math.min(1, rng.range(0, 1.5)) });
    }
  }
  world.bushes = bushes;
}

/**
 * The valley's brambles, laid down if this world has never had any.
 *
 * A save written before brambles existed gets the ones its seed would have grown
 * — the same private stream, the same map, so a colony that loads an old save is
 * not handed a different valley, it is handed the valley it was always standing
 * in. The alternative was an empty moor, which reads as the feature being broken
 * rather than as the save being old.
 */
export function ensureBushes(world: World): Bush[] {
  if (!world.bushes) scatterBushes(world, new Rng(world.seed ^ 0x2b7f19c5));
  return world.bushes!;
}

export function isRipeBush(bush: Bush): boolean {
  return bush.ripe >= 1;
}

export function bushAt(world: World, x: number, y: number): Bush | null {
  if (!inBounds(world, x, y)) return null;
  const c = packCell(world, x, y);
  return ensureBushes(world).find((b) => b.c === c) ?? null;
}

export function bushCell(world: World, bush: Bush): { x: number; y: number } {
  return { x: unpackX(world, bush.c), y: unpackY(world, bush.c) };
}

/** How many bushes are standing in fruit right now. The food chain's supply term. */
export function ripeBushes(world: World): Bush[] {
  return ensureBushes(world).filter(isRipeBush);
}

/**
 * The nearest bush in fruit, or null.
 *
 * Straight-line distance and no reachability test of its own: both callers — the
 * work board and a hungry brambletail — do their own, and they disagree about
 * what counts. A settler needs a route through its own doors; a squirrel is
 * door-blind. Baking either answer in here would give one of them the other's map.
 *
 * `accept` is where a caller puts its version of the question, and it is asked
 * only about a bush that has already beaten every bush before it. That is a
 * handful of calls over a few hundred plants rather than one per plant, which is
 * what makes it cheap enough for something asked every tick by every animal.
 */
export function nearestRipeBush(
  world: World,
  x: number,
  y: number,
  within: number,
  accept?: (bx: number, by: number) => boolean,
): Bush | null {
  let best: Bush | null = null;
  let bestD = within;
  for (const b of ensureBushes(world)) {
    if (!isRipeBush(b)) continue;
    const bx = unpackX(world, b.c);
    const by = unpackY(world, b.c);
    const d = Math.hypot(bx - x, by - y);
    if (d >= bestD) continue;
    if (accept && !accept(bx, by)) continue;
    best = b;
    bestD = d;
  }
  return best;
}

/**
 * A settler picks it. Returns the raw food, or 0 if something got there first.
 *
 * The caller drops the food and charges the skill — this owns the plant and
 * nothing else, so a brambletail can strip the same bush through `stripBush`
 * without the pantry or the work board ever hearing about it.
 */
export function pickBush(bush: Bush, plants = 0): number {
  if (!isRipeBush(bush)) return 0;
  bush.ripe = 0;
  return BUSH_YIELD + Math.floor(plants * 0.25);
}

/** An animal ate it. Same plant, no pantry. */
export function stripBush(bush: Bush): void {
  bush.ripe = 0;
}

/**
 * Grub a bush out of the ground. Called when a growing zone is painted over it.
 *
 * `scatterBushes` will not root inside a plot, but a player can paint a plot
 * around a bush that was already there, and a cell that is both a bramble and a
 * furrow is a cell two work-types will fight over — the farm board will queue a
 * sow on it and a forage on it in the same tick, forever. Clearing the ground you
 * decided to farm is also just what happens.
 */
export function clearBushAt(world: World, x: number, y: number): void {
  if (!world.bushes || !inBounds(world, x, y)) return;
  const c = packCell(world, x, y);
  const i = world.bushes.findIndex((b) => b.c === c);
  if (i >= 0) world.bushes.splice(i, 1);
}

/**
 * Fruit ripens on daylight, weather and the season — the same three terms a crop
 * answers to, read off the cell the bush stands in.
 *
 * The season term is what makes brambles a summer thing rather than a permanent
 * income. `outdoorGrowth` bottoms out below four degrees, and a midwinter valley
 * sits under that everywhere outdoors, so the bushes do not slow down in winter,
 * they stop — and a colony that planned to forage its way through the cold finds
 * the moor bare on exactly the day that mattered.
 *
 * Read once for the whole valley rather than once per bush, and the cell is not
 * consulted at all. A bramble is a wild thing standing under the open sky: it is
 * never inside a room, so the per-cell form could only ever return the year's
 * number, and asking it a hundred and fifty times a tick meant walking the
 * colony's whole building list a hundred and fifty times to be told so. That one
 * line was the most expensive thing in the sim once the valley grew to 128
 * cells square.
 */
export function tickBushes(world: World): void {
  const light = daylight(world);
  if (light <= 0) return;
  const season = outdoorGrowth(world);
  if (season <= 0) return;
  const step = REGROW_PER_TICK * light * growthMultiplier(world) * season;
  for (const b of ensureBushes(world)) {
    if (b.ripe >= 1) continue;
    b.ripe = Math.min(1, b.ripe + step);
  }
}
