/**
 * The wood grows back.
 *
 * Every other renewable thing in this valley renews: brambles fruit again six
 * days after they are picked, a fished-out shallow refills, a crop comes round
 * with the year. The forest did not. Two and a half thousand trees were laid
 * down at worldgen and that was the entire supply for the rest of the game —
 * which is fine for a week and is a slow bug over a season, because the colony's
 * one inexhaustible-looking resource is the only one it spends every single day.
 *
 * Measured before this existed, seed 20260729, ninety days unattended: the colony
 * had cut every tree inside the Steward's twenty-two-cell reach by day eighty-five
 * and finished the run sitting at **zero wood** with fifteen settlers and three
 * hundred buildings — not starving, not raided, just quietly unable to put up
 * another wall for the rest of its life. A valley that runs out is a valley the
 * player can only lose slowly, and losing slowly to arithmetic is the least
 * interesting way for a colony to end.
 *
 * So: a gap next to a wood grows a tree. Three rules, and the interesting part is
 * that all three are *local* —
 *
 *  - **Seed rain.** A cell only sprouts if a grown tree is standing within a few
 *    paces of it. Seed falls near the parent, so a wood creeps out from its own
 *    edge rather than appearing in the middle of a meadow.
 *  - **Crowding.** A cell already packed in with eight trees is a wood, not a
 *    gap. Eight is measured rather than chosen — see `CROWD`.
 *  - **Clearance.** Nothing roots within four cells of anything the colony has
 *    built. A pine coming up through the kitchen floor is not ecology, it is a
 *    bug report, and a player who has to clear their own yard every spring has
 *    been handed a chore instead of a valley.
 *
 * Between them those bound the system without a single global decision: the cells
 * that qualify are exactly the holes the colony cut, which is why the regrowth
 * finds the logged ring near home on its own without anything in this file
 * knowing where home is. The valley-wide ceiling (`MAX_TREES_PER_CELL`) is the
 * one global term, and it is there so the long game is *replacement* rather than
 * a map slowly turning solid green.
 *
 * This is deliberately not the whole answer to the wood economy. A cut ring takes
 * a season to come back and a colony of fifteen wants timber this afternoon; the
 * Steward reaching further for its logs is what answers that, and it lives in
 * `steward.ts`. This is what keeps reaching further from being the same bug one
 * ring out.
 */

import { outdoorGrowth } from './farming';
import { buildingAt, isWalkable } from './grid';
import { toolYield } from './research';
import { Rng } from './rng';
import { addBuilding, itemsAt } from './world';
import {
  DESIG_NONE,
  TICKS_PER_DAY,
  inBounds,
  packCell,
  terrainAt,
  type Building,
  type World,
} from './types';

/** How often the valley is looked at. Slow, like everything else here that grows. */
export const FOREST_INTERVAL = 60;

/**
 * Days from a seedling to a tree worth felling, at an average year's growing.
 *
 * Fourteen days is nearly three of this valley's five-day seasons: long enough
 * that a player who clear-cuts their doorstep feels it for the rest of the year,
 * short enough that they see the answer arrive inside one run.
 *
 * The `MEAN_SEASON` divisor is what makes fourteen a *calendar* number rather
 * than a growing-weather one. Growth is scaled by the season every tick, so
 * without the correction the constant would mean "fourteen days of perfect
 * summer" — which the calendar never supplies in a row, and a sapling would take
 * most of two years. Dividing by the year's mean growth puts the constant back on
 * the calendar: fourteen ordinary days, about seven of unbroken high summer, and
 * none at all through the winter.
 */
export const MATURE_DAYS = 14;
const MEAN_SEASON = 0.5;
const GROW_PER_TICK = 1 / (MATURE_DAYS * MEAN_SEASON * TICKS_PER_DAY);

/** How big a tree starts. Above zero so a new sapling is visibly *something*. */
export const SAPLING = 0.06;

/** Wood off one grown tree, before the toolmaking bonus. */
export const TREE_WOOD = 24;

/** How far a seed carries from the tree that dropped it. */
const SEED_REACH = 3;

/**
 * Trees within two cells that make a cell a wood rather than a gap.
 *
 * Measured off the generator rather than guessed, which is the only reason it is
 * eight: a fresh valley puts a mean of 7.8 trees in the twenty-five cells around
 * each of its own trees (seeds 20260729 / 4242 / 7 gave 7.8, 7.7 and 7.2; the
 * ninetieth percentile is 12). A gap that fills to eight has filled to the density
 * the map was drawn at, and stopping there is what makes a regrown wood look like
 * the wood that was cut instead of like a hedge.
 */
export const CROWD = 8;
export const CROWD_R = 2;

/**
 * How far a sapling keeps away from the colony's own work.
 *
 * Four cells clears a wall and the path along it. Deliberately generous: being
 * wrong outward costs one tree in a valley of two thousand, and being wrong
 * inward costs the player an afternoon of chopping their own bedroom out.
 */
export const CLEAR_R = 4;

/**
 * The valley's ceiling, as a density — so a bigger map is a bigger wilderness
 * rather than the same one spread thinner, which is the argument
 * `PATCHES_PER_CELL` makes for the brambles.
 *
 * 0.066 is what the generator draws: 2446, 2416 and 2201 trees on a 192-square
 * valley for the three seeds above, or 6.6%, 6.6% and 6.0% of cells. Setting the
 * ceiling at the density the map was born with is what turns this from *growth*
 * into *replacement*: an untouched valley is already at its ceiling and grows
 * nothing at all, so every tree that comes back is one that was taken.
 */
const MAX_TREES_PER_CELL = 0.066;

/** How grown a tree is: 1 is timber, and a tree with no opinion is a grown one. */
export function treeGrowth(b: Building): number {
  return b.kind === 'tree' ? (b.grow ?? 1) : 1;
}

/**
 * Is this worth felling?
 *
 * The Steward asks before it marks, so the colony harvests its woodlot instead of
 * eating its seed corn. The player is not stopped from felling a sapling — being
 * able to clear ground you want to build on is what an axe is for — they just get
 * a sapling's worth of wood for it.
 */
export function isTimber(b: Building): boolean {
  return b.kind === 'tree' && treeGrowth(b) >= 1;
}

/**
 * Wood from felling this tree.
 *
 * Scaled by how grown it is, and that scaling is the only thing stopping regrowth
 * from being free money: without it a colony chops the seedling the morning after
 * it sprouts, banks the full twenty-four, and the valley is exactly as
 * exhaustible as it was before with an extra step in the loop. Never zero — an
 * axe swung at a seedling gets you kindling, and a chop that yields nothing at
 * all reads as the job being broken rather than as the tree being small.
 */
export function chopYield(world: World, b: Building): number {
  return Math.max(1, Math.round(TREE_WOOD * toolYield(world) * treeGrowth(b)));
}

/** Ground a seed can take on: open soil nobody has claimed. */
function canRoot(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return false;
  if (!isWalkable(world, x, y)) return false;
  const t = terrainAt(world, x, y);
  // Grass and dirt only, which rules out every floor the colony can lay: a floor
  // *is* terrain here, so "not grass or dirt" already means "not indoors".
  if (t !== 'grass' && t !== 'dirt') return false;
  const idx = packCell(world, x, y);
  if (world.cellBuilding[idx]! >= 0) return false;
  // A painted cell is a decision the colony has already made about this ground —
  // a plot to sow, a wall to raise, a floor to lay. Growing a tree through it
  // would be the sim arguing with the player.
  if (world.cellZone[idx] !== -1) return false;
  if (world.cellDesig[idx] !== DESIG_NONE) return false;
  // Nor over the colony's goods. A stack is picked up by standing on it, so a
  // tree rooting through a woodpile takes that wood out of the game while
  // leaving it on the books — the same trap a wall raised over a stack used to
  // be, and the reason `shoveItemsClear` exists. A tree has the whole valley to
  // grow in and can pick another square.
  if (itemsAt(world, x, y).length > 0) return false;
  // And not on top of anybody. The pathfinder survives this — a body inside a
  // solid cell is explicitly allowed to walk its way out, which is the same
  // recovery a wall raised over someone's head gets — so this is not a trap
  // being avoided. It is that a tree growing through a settler is a thing the
  // player *sees*, and in first person it is a tree growing through their own
  // face. One scan of the pawn list, eighty times a day, is nothing.
  for (const p of world.pawns) {
    if (!p.dead && Math.round(p.x) === x && Math.round(p.y) === y) return false;
  }
  return true;
}

/**
 * The three neighbourhood rules, read off one walk of the same square.
 *
 * One nine-by-nine pass rather than three scans at three radii: the clearance
 * ring is the widest of them, so the other two can be counted on the way past for
 * free. This runs once per sampled cell and the sampling is one cell every three
 * seconds of colony time, so the cost is nothing — but it is the kind of nothing
 * that becomes something when a valley doubles in size, and the shape is no
 * harder to read this way.
 */
function neighbourhood(
  world: World,
  x: number,
  y: number,
): { crowd: number; near: boolean; clear: boolean } {
  let crowd = 0;
  let near = false;
  let clear = true;
  for (let dy = -CLEAR_R; dy <= CLEAR_R; dy++) {
    for (let dx = -CLEAR_R; dx <= CLEAR_R; dx++) {
      const b = buildingAt(world, x + dx, y + dy);
      if (b === null) continue;
      if (b.kind !== 'tree') {
        // Anything the colony put here, finished or still a blueprint. A
        // blueprint counts because the ground under it is already spoken for.
        clear = false;
        continue;
      }
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      if (r <= CROWD_R) crowd++;
      if (r <= SEED_REACH && treeGrowth(b) >= 1) near = true;
    }
  }
  return { crowd, near, clear };
}

/**
 * One pass of the valley growing.
 *
 * Sample a single cell and ask whether a tree belongs in it. One cell per pass
 * looks absurdly slow written down and is not: eighty passes a day across a map
 * of thirty-six thousand cells, of which only the few percent that are gaps
 * beside a wood can say yes, works out at half a dozen seedlings a day — the
 * right order of magnitude beside a colony that fells one or two.
 *
 * Sampling cells rather than walking parents is what aims it. Pick a parent and
 * you seed hardest where the trees already are, which is the one place the rules
 * then refuse; pick a cell and every hole in the map competes on equal terms, so
 * the logged ring around the colony — the biggest hole there is — quietly gets
 * most of the attention.
 */
export function tickForest(world: World, rng: Rng): void {
  if (world.tick % FOREST_INTERVAL !== 0) return;

  const season = outdoorGrowth(world);
  if (season <= 0) return; // nothing grows through a hard winter

  const standing = world.buildings.filter((b) => b.kind === 'tree');
  const step = GROW_PER_TICK * FOREST_INTERVAL * season;
  for (const t of standing) {
    if (t.grow === undefined || t.grow >= 1) continue;
    t.grow = Math.min(1, t.grow + step);
  }

  if (standing.length >= Math.round(world.width * world.height * MAX_TREES_PER_CELL)) return;

  const x = rng.int(world.width);
  const y = rng.int(world.height);
  if (!canRoot(world, x, y)) return;
  const n = neighbourhood(world, x, y);
  if (!n.near || !n.clear || n.crowd >= CROWD) return;

  const b = addBuilding(world, 'tree', x, y, true);
  if (!b) return;
  b.grow = SAPLING;
  world.stats.grown = (world.stats.grown ?? 0) + 1;
}
