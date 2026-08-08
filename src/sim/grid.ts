/**
 * Grid queries. This module owns the answer to "can something be here?" for the
 * whole game — pathfinding, the first-person collision capsule, blueprint
 * placement and line-of-sight all route through it, which is why a wall can
 * never be a ghost in one view and a wall in the other.
 */

import { defOf, SHOOT_OVER_HEIGHT } from './buildings';
import { SNOW_PATH_COST, snowCover } from './snowpack';
import { iceBears } from './ice';
import type { Building, World } from './types';
import { SOLID_TERRAIN, inBounds, terrainAt } from './types';

/**
 * `world.buildings` keyed by id, so `buildingAt` is a hash lookup and not a scan.
 *
 * This used to be `world.buildings.find(...)`, which is fine with a starter cabin
 * and ruinous by week three: `canStep` asks it three times per neighbour, A*
 * expands thousands of cells per path, and every one of those was a linear walk
 * over three hundred buildings. Walling a yard in — which is the whole point of
 * the game — made the sim six times slower, because a wall is both more buildings
 * to scan and longer paths to scan them for.
 *
 * The cache is deliberately not part of `World`: it is never saved, and it is
 * rebuilt from scratch whenever the array it was built from is replaced, which is
 * what a load or a test fixture does. Entries for demolished buildings are left
 * behind on purpose — `cellBuilding` is cleared on removal, so nothing can ever
 * ask for one again, and pruning would mean coupling `world.ts` to this file for
 * no benefit a chopped tree can measure.
 */
const BUILDING_INDEX = new WeakMap<Building[], Map<number, Building>>();

function buildingIndex(world: World): Map<number, Building> {
  let index = BUILDING_INDEX.get(world.buildings);
  if (index === undefined) {
    index = new Map<number, Building>();
    for (const b of world.buildings) index.set(b.id, b);
    BUILDING_INDEX.set(world.buildings, index);
  }
  return index;
}

export function buildingAt(world: World, x: number, y: number): Building | null {
  if (!inBounds(world, x, y)) return null;
  const id = world.cellBuilding[y * world.width + x];
  if (id === undefined || id < 0) return null;
  const index = buildingIndex(world);
  const hit = index.get(id);
  if (hit !== undefined) return hit;
  // Somebody pushed onto `world.buildings` without going through `addBuilding`.
  // Pay for the scan once and remember the answer.
  const found = world.buildings.find((b) => b.id === id);
  if (found === undefined) return null;
  index.set(id, found);
  return found;
}

/** A finished door stands here — the one hole a colony leaves in its own wall. */
export function isDoor(world: World, x: number, y: number): boolean {
  const b = buildingAt(world, x, y);
  return b !== null && b.built && b.kind === 'door';
}

/**
 * Blueprints do not block: settlers must be able to stand where they build.
 *
 * `latch` is who is asking, reduced to the only thing the grid needs to know
 * about them: whether they have hands. A door is `solid: false`, so for most of
 * this game's life anything with legs walked through one — which meant a fenced,
 * gated pen was worth exactly as much against a fenwolf as an open field, the
 * only answer to a pack was a rifle, and a deer could let itself into somebody's
 * bedroom. Pass `false` and a built door reads as wall.
 *
 * It is a flag on the single gate rather than a rule in the animal code because
 * of the promise the rest of this file makes: a route, a pair of legs, the
 * collision capsule the player is standing in and every raider's approach all get
 * the same answer about the same cell on the same tick. A wolf that pathed round
 * the gate and then slid through it anyway would break that in the one place the
 * player is looking.
 *
 * Deliberately not a function of `b.open`: the door is a wall to the wild whether
 * or not somebody happens to be holding it ajar. A rule the player can see from
 * across the map beats a rule that is true four ticks in nine.
 */
export function isSolid(world: World, x: number, y: number, latch = true): boolean {
  if (!inBounds(world, x, y)) return true;
  if (!latch && isDoor(world, x, y)) return true;
  const t = terrainAt(world, x, y);
  // Water is a wall for eleven months of the year and a road for the twelfth.
  // The exception lives here, in the single gate, rather than in the pathfinder
  // — so a settler's route, their legs, the collision capsule the player is
  // standing in and every raider's approach all get the same answer about the
  // lake on the same tick.
  if (SOLID_TERRAIN.has(t) && !(t === 'water' && iceBears(world))) return true;
  const b = buildingAt(world, x, y);
  if (!b || !b.built) return false;
  return defOf(b.kind).solid;
}

/** Height of the walkable surface in a cell (metres). Beds are a low platform. */
export function standHeight(world: World, x: number, y: number): number {
  const b = buildingAt(world, x, y);
  if (!b || !b.built) return 0;
  return defOf(b.kind).standHeight;
}

/**
 * Movement cost multiplier; doors cost a little extra (opening them).
 *
 * Laid floors cost *less* than open ground, which is the only reason a settler
 * will walk the long way round a path instead of straight across the grass.
 * The discount is deliberately bigger than the speed bonus it stands in for:
 * A* has to prefer a road enough to leave a diagonal for it.
 *
 * And then winter puts its thumb on the scale. Snow lying on bare ground makes
 * it dearer to cross while leaving the boards exactly as they were, so the same
 * road a colony barely bothered with in July is the obvious way home in January
 * — the route changes because the ground did, without anybody re-planning
 * anything. A door is a flat toll for the opening and keeps its own number.
 */
export function moveCost(world: World, x: number, y: number): number {
  const b = buildingAt(world, x, y);
  if (b && b.built && b.kind === 'door') return 1.6;
  const t = terrainAt(world, x, y);
  const snow = 1 + snowCover(world, t) * SNOW_PATH_COST;
  // Only ever asked about frozen water — `isSolid` refuses the rest of the year.
  // Dearer than bare ground because you pick your way across it, and still much
  // cheaper than the deep snow lying on every field around it, so the frozen lake
  // becomes the fastest way across the valley in midwinter without ever being the
  // way somebody goes to save two cells.
  if (t === 'water') return 1.15;
  if (t === 'sand') return 1.25 * snow;
  if (t === 'plank') return 0.72;
  if (t === 'paved') return 0.6;
  // The same boards as a plank road, so the same number. What that buys is the
  // midwinter case: a bridge beats the frozen lake lying beside it, which is
  // right — one is swept deck and the other is picked across — so a colony that
  // built a crossing in summer keeps using it after the water has hardened,
  // instead of watching every settler wander off the end of it onto the ice.
  if (t === 'bridge') return 0.72;
  return snow;
}

export function isWalkable(world: World, x: number, y: number, latch = true): boolean {
  return !isSolid(world, x, y, latch);
}

/** Does a fire or a bullet get stopped here? Same table as movement. */
export function blocksSight(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return true;
  if (terrainAt(world, x, y) === 'rock') return true;
  const b = buildingAt(world, x, y);
  if (!b || !b.built) return false;
  const d = defOf(b.kind);
  // Sandbags and turrets are hard cover you shoot over; walls and doors stop
  // bullets. Same threshold the cover roll uses — see SHOOT_OVER_HEIGHT.
  return d.solid && d.height > SHOOT_OVER_HEIGHT;
}

/**
 * Sampling step along a sight line, in cells. Finer than the distance a bullet
 * covers between its own collision checks, so anything the bullet would hit is
 * seen here first.
 */
const SIGHT_STEP = 0.18;

/**
 * Can a shot travel from one position to another?
 *
 * This marches the actual ray and rounds each sample, because that is exactly
 * what a projectile does in combat.ts — a cell covers [c-0.5, c+0.5] for
 * collision, pathing and bullets alike. It used to be a Bresenham walk on
 * floored coordinates, which answered for a lattice half a cell off the one
 * bullets fly through and cut corners they cannot: settlers inside the cabin and
 * raiders outside it both read "clear shot" past the doorway, both fired all day
 * into the wall panel beside the door, and the stand-off only ended when the
 * colony starved standing at arms. Whatever answers "can I shoot?" has to answer
 * for the grid the bullet travels.
 */
export function hasLineOfSight(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return true;
  const startX = Math.round(x0);
  const startY = Math.round(y0);
  const endX = Math.round(x1);
  const endY = Math.round(y1);
  const steps = Math.ceil(len / SIGHT_STEP);
  // Only test a cell when the ray actually enters a new one — consecutive
  // samples usually land in the same cell, and `blocksSight` is not free.
  let lastX = startX;
  let lastY = startY;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(x0 + dx * t);
    const cy = Math.round(y0 + dy * t);
    if (cx === lastX && cy === lastY) continue;
    lastX = cx;
    lastY = cy;
    // Neither end blocks: the shooter and the target are standing in those cells.
    if (cx === startX && cy === startY) continue;
    if (cx === endX && cy === endY) return true;
    if (blocksSight(world, cx, cy)) return false;
  }
  return true;
}

export const NEIGHBOURS_8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export const NEIGHBOURS_4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Would putting something solid on this cell brick up a doorway?
 *
 * A door is only a door because of the two cells it joins. Take one of them away
 * and the door still stands there, still reads `built`, still reports itself
 * walkable — and leads nowhere. That is not a hypothetical: the colony's own
 * defence planner laid a sandbag directly outside the cabin's only door, a
 * settler built it, and the cabin — the beds, the stove, the pantry and the two
 * people who happened to be indoors — was cut off from the other six for the
 * rest of the game. They starved in the yard with forty meals eight metres away,
 * and nothing in the sim was in a position to notice, because every individual
 * part of it was working.
 *
 * So: solid things keep off doorsteps. Checked in cell terms rather than by
 * pathfinding, because this has to be cheap enough for the build tool's drag
 * preview to run it on four hundred cells a frame — a door needs at least two
 * open cells around it, and the wall it sits in accounts for the other two.
 */
export function wouldBlockDoorway(world: World, x: number, y: number): boolean {
  for (const [dx, dy] of NEIGHBOURS_4) {
    const door = buildingAt(world, x + dx, y + dy);
    if (!door || door.kind !== 'door') continue;
    let open = 0;
    for (const [ex, ey] of NEIGHBOURS_4) {
      const nx = door.x + ex;
      const ny = door.y + ey;
      if (nx === x && ny === y) continue;
      if (inBounds(world, nx, ny) && isWalkable(world, nx, ny)) open++;
    }
    if (open < 2) return true;
  }
  return false;
}

/** Diagonal moves are only legal if both orthogonal neighbours are open (no corner clipping). */
export function canStep(
  world: World,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  latch = true,
): boolean {
  if (!isWalkable(world, tx, ty, latch)) return false;
  const dx = tx - fx;
  const dy = ty - fy;
  if (dx !== 0 && dy !== 0) {
    if (isSolid(world, fx + dx, fy, latch) || isSolid(world, fx, fy + dy, latch)) return false;
  }
  return true;
}

/** Nearest walkable cell to (x,y), searched in rings. Used for spawns + move orders. */
export function nearestWalkable(
  world: World,
  x: number,
  y: number,
  maxR = 12,
  latch = true,
): { x: number; y: number } | null {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (isWalkable(world, cx, cy, latch)) return { x: cx, y: cy };
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (isWalkable(world, nx, ny, latch)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/** Walkable cells orthogonally/diagonally adjacent to a target — where a worker stands. */
export function adjacentStandCells(world: World, x: number, y: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const [dx, dy] of NEIGHBOURS_8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(world, nx, ny)) continue;
    if (!isWalkable(world, nx, ny)) continue;
    if (dx !== 0 && dy !== 0 && (isSolid(world, x + dx, y) || isSolid(world, x, y + dy))) continue;
    out.push({ x: nx, y: ny });
  }
  return out;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * How close you have to be to a flame for it to burn you.
 *
 * Exported and shared with the burn pass in `tickFires` rather than written out
 * twice, because the two readings have to agree: if "this fire is hurting me" and
 * "I am standing in a fire" ever drift apart, a settler takes damage from a fire
 * they do not believe they are in, and so never runs from it.
 */
export const FIRE_TOUCH = 0.75;

/**
 * Far enough from every flame to count as out of it. Wider than `FIRE_TOUCH`,
 * because a fire spreads to its neighbours: somewhere that is merely not alight
 * yet is not somewhere to stop running.
 */
export const FIRE_CLEAR = 2.2;

/** Is whatever is standing here in the flames? */
export function fireAt(world: World, x: number, y: number, radius = FIRE_TOUCH): boolean {
  for (const f of world.fires) {
    if (dist(f.x, f.y, x, y) < radius) return true;
  }
  return false;
}

/**
 * Nearest cell that is walkable and a clear margin from every flame — where
 * somebody who is on fire runs to.
 *
 * Rings outward like `nearestWalkable`, and for the same reason: the answer is
 * almost always one or two cells away, so a ring search reads the handful of
 * cells that matter instead of the whole map.
 *
 * Two passes, and the second one is the interesting one. Asking for a clear
 * margin is right when there is one to be had — somewhere merely not alight yet
 * is not somewhere to stop running. But a settler ringed by fire against a rock
 * face used to be told there was nowhere better and stand in the flames, and
 * that is how a headless run produced five straight seconds of a settler burning
 * on the spot with no job, no order and nothing wrong with the code that put
 * them there. Anywhere not actually alight beats the cell that is, so when the
 * margin cannot be found the search settles for the flames themselves being
 * elsewhere. Null now means genuinely walled in.
 */
export function nearestSafeCell(
  world: World,
  x: number,
  y: number,
  maxR = 14,
): { x: number; y: number } | null {
  return ringForSafety(world, x, y, maxR, FIRE_CLEAR) ?? ringForSafety(world, x, y, maxR, FIRE_TOUCH);
}

function ringForSafety(
  world: World,
  x: number,
  y: number,
  maxR: number,
  clearance: number,
): { x: number; y: number } | null {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isWalkable(world, nx, ny)) continue;
        if (fireAt(world, nx, ny, clearance)) continue;
        return { x: nx, y: ny };
      }
    }
  }
  return null;
}
