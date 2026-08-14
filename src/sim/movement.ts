/**
 * Movement. Both the AI (path following) and the first-person player (direct
 * input) end up in `moveWithCollision`, so the two views cannot disagree about
 * where a body is allowed to be.
 */

import { buildingAt, isSolid, isWalkable, nearestWalkable } from './grid';
import { findPath, findPathAdjacent } from './path';
import type { Pawn, World } from './types';
import { groundSpeed } from './snowpack';
import { unpackX, unpackY } from './types';

/**
 * Everything in this file needs from a body: where it is, where it is going, how
 * long it has been failing to get there, and which way it is pointing.
 *
 * `Pawn` satisfies this structurally, so nothing about settlers changes. It exists
 * so a Picky — which is not a colonist, has no needs, no skills and no job — walks
 * through the *same* pathfinder and the *same* collision as a settler instead of
 * getting a second, quietly-diverging one. A reachability tester that walks by
 * different rules than the thing it is testing is worse than no tester.
 */
export interface Walker {
  x: number;
  y: number;
  path: number[] | null;
  stuck: number;
  facing: number;
  animPhase: number;
}

/** cells per tick */
export const WALK_SPEED = 0.155;
export const RUN_SPEED = 0.225;
export const PLAYER_WALK = 0.165;
export const PLAYER_RUN = 0.27;

export const BODY_RADIUS = 0.34;

/**
 * Ticks of going nowhere before a body gives up on the route it is holding.
 *
 * Exported because `walkTo` has to tell this drop apart from the other one — a
 * wall raised across a live route, which wants a fresh path — and the only
 * evidence it has is whether the counter got this far. Two copies of the number
 * would mean a tune here silently turning every wedge back into a re-path loop.
 */
export const STUCK_LIMIT = 25;

/**
 * Gait phase per cell of ground covered — the unit `animPhase` is counted in.
 *
 * The sim never reads `animPhase`. It is here, rather than in the client, so that
 * the manager camera and the first-person camera cannot each invent their own
 * answer to *"how far along its stride is that body?"*; a settler you are standing
 * next to and the same settler seen from above are one walk.
 *
 * Its value is arbitrary. What is not arbitrary is that there is only one of it,
 * and that it multiplies **distance actually moved** — see `moveWithCollision`,
 * which is the only place in the sim allowed to advance a body's stride.
 */
export const PHASE_PER_CELL = 7.5;

/**
 * Slide-along-walls collision against the SAME solidity table pathfinding uses.
 * Axes are resolved separately so a body brushing a wall keeps its other axis.
 *
 * `latch` is passed straight down to `isSolid`, so a body that cannot work a door
 * is stopped by one here exactly as it was refused one by A\*. That equality is
 * the whole reason the flag lives on the grid gate rather than in the caller: a
 * wolf that routed round a shut gate and then slid through it would be a lie the
 * player can watch happening.
 */
export function moveWithCollision(
  world: World,
  pawn: Walker,
  dx: number,
  dy: number,
  latch = true,
): void {
  const r = BODY_RADIUS;

  // A body can end up already overlapping geometry — a wall raised beside it, a save
  // from an older layout, a body snapped onto furniture. Refusing every move that
  // still overlaps welds it in place: it cannot even step outwards, so its jobs die
  // on the stuck counter forever. While overlapping, allow whatever reduces the
  // overlap; once clear, the rule is the strict no-overlap one.
  const embedded = penetration(world, pawn.x, pawn.y, r, latch);
  const allowed = (nx: number, ny: number): boolean =>
    embedded > 0
      ? penetration(world, nx, ny, r, latch) < embedded
      : !collides(world, nx, ny, r, latch);

  const fromX = pawn.x;
  const fromY = pawn.y;

  if (dx !== 0) {
    const nx = pawn.x + dx;
    if (allowed(nx, pawn.y)) pawn.x = nx;
  }
  if (dy !== 0) {
    const ny = pawn.y + dy;
    if (allowed(pawn.x, ny)) pawn.y = ny;
  }

  // The stride is fed here and nowhere else, by ground the body actually covered.
  // Every walking thing in the game — settler, wolf, pet, Picky, the body the
  // player is driving — arrives through this function, so the alternative was
  // each caller remembering to do it, which is how the wolves ended up counting
  // their steps twice and the retreating settler counting them at a different
  // rate than the settler walking beside it.
  //
  // Deliberately before the unstick below: that is a rescue, not a step. A body
  // lifted out of a wall raised on top of it should not pay six cells of stride
  // for a journey it did not take.
  pawn.animPhase += Math.hypot(pawn.x - fromX, pawn.y - fromY) * PHASE_PER_CELL;

  // Never let rounding trap a body inside geometry (a wall built on top of it).
  // Same `latch` on both halves, or a door hung over a sleeping deer would find
  // the deer solid and then hand it the doorstep back as somewhere to stand.
  if (isSolid(world, Math.round(pawn.x), Math.round(pawn.y), latch)) {
    const free = nearestWalkable(world, pawn.x, pawn.y, 6, latch);
    if (free) {
      pawn.x = free.x;
      pawn.y = free.y;
    }
  }
}

/** Does a disc of radius r centred at (x,y) overlap any solid cell? */
export function collides(world: World, x: number, y: number, r: number, latch = true): boolean {
  return penetration(world, x, y, r, latch) > 0;
}

/** How far a disc of radius r centred at (x,y) reaches into solid geometry; 0 if clear. */
export function penetration(
  world: World,
  x: number,
  y: number,
  r: number,
  latch = true,
): number {
  const minX = Math.round(x - r);
  const maxX = Math.round(x + r);
  const minY = Math.round(y - r);
  const maxY = Math.round(y + r);
  let worst = 0;
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if (!isSolid(world, cx, cy, latch)) continue;
      // cell (cx,cy) covers [cx-0.5, cx+0.5] × [cy-0.5, cy+0.5]
      const nearestX = Math.max(cx - 0.5, Math.min(x, cx + 0.5));
      const nearestY = Math.max(cy - 0.5, Math.min(y, cy + 0.5));
      const ddx = x - nearestX;
      const ddy = y - nearestY;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < r * r) worst = Math.max(worst, r - Math.sqrt(d2));
    }
  }
  return worst;
}

export function setPathTo(
  world: World,
  pawn: Walker,
  tx: number,
  ty: number,
  latch = true,
): boolean {
  const p = findPath(world, Math.round(pawn.x), Math.round(pawn.y), tx, ty, { latch });
  if (!p) {
    pawn.path = null;
    return false;
  }
  pawn.path = p;
  pawn.stuck = 0;
  return true;
}

export function setPathAdjacentTo(world: World, pawn: Walker, tx: number, ty: number): boolean {
  const p = findPathAdjacent(world, Math.round(pawn.x), Math.round(pawn.y), tx, ty);
  if (!p) {
    pawn.path = null;
    return false;
  }
  pawn.path = p;
  pawn.stuck = 0;
  return true;
}

/** Advance along the current path. Returns true when the path is exhausted. */
export function followPath(world: World, pawn: Walker, speed: number, latch = true): boolean {
  if (!pawn.path || pawn.path.length === 0) {
    pawn.path = null;
    return true;
  }
  const nextPacked = pawn.path[0]!;
  const nx = unpackX(world, nextPacked);
  const ny = unpackY(world, nextPacked);

  // A wall built across a live path invalidates it; re-path rather than tunnel.
  // A door hung across one counts, for anything that cannot open it — that is how
  // a pack loses its route into a pen the moment the gate is finished, without
  // anybody having to go round and cancel the routes it already had.
  if (!isWalkable(world, nx, ny, latch)) {
    pawn.path = null;
    return false;
  }

  const dx = nx - pawn.x;
  const dy = ny - pawn.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) {
    pawn.path.shift();
    return pawn.path.length === 0;
  }
  // The ground underfoot scales the step. Read from the cell being *left* rather
  // than the one being entered, so a settler stepping off the last board slows to
  // grass speed as they leave it — the road is worth what you walked on it. In
  // winter that gap widens: the board is clear and the grass is under snow.
  const step = Math.min(speed * groundSpeed(world, Math.round(pawn.x), Math.round(pawn.y)), d);
  const before = { x: pawn.x, y: pawn.y };
  moveWithCollision(world, pawn, (dx / d) * step, (dy / d) * step, latch);
  pawn.facing = Math.atan2(dy, dx);

  const moved = Math.hypot(pawn.x - before.x, pawn.y - before.y);
  if (moved < step * 0.35) {
    pawn.stuck++;
    if (pawn.stuck > STUCK_LIMIT) {
      pawn.path = null;
      pawn.stuck = 0;
      return false;
    }
  } else {
    pawn.stuck = 0;
  }

  if (Math.hypot(nx - pawn.x, ny - pawn.y) < 0.06) {
    pawn.path.shift();
    if (pawn.path.length === 0) {
      pawn.path = null;
      return true;
    }
  }
  return false;
}

/**
 * Can this body work a latch? Everything with hands, and everything the colony
 * has taken responsibility for.
 *
 * The exemption for tame animals is not a kindness. A goat that could not follow
 * its handler back through the pen gate would be shut out of the pen the handler
 * had just walked it into, and a pet that lost its owner at a doorway would stand
 * against it until it starved — so the rule would cost the player two working
 * systems to buy one. Every animal the colony is answerable for keeps the run of
 * the place; only what walked in off the moor is stopped by a door.
 */
export function opensDoors(pawn: Pawn): boolean {
  return pawn.faction !== 'fauna' || pawn.tame === true;
}

/**
 * Doors swing open for anybody standing on or next to them, in both views.
 *
 * Not for the wild, though — a door that swung for a fenwolf would be showing the
 * player the opposite of what the grid is about to tell it. See `opensDoors`.
 */
export function tickDoors(world: World): void {
  const wanted = new Set<number>();
  const open = (x: number, y: number): void => {
    const px = Math.round(x);
    const py = Math.round(y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const b = buildingAt(world, px + dx, py + dy);
        if (b && b.built && b.kind === 'door') wanted.add(b.id);
      }
    }
  };
  for (const p of world.pawns) {
    if (p.dead || !opensDoors(p)) continue;
    open(p.x, p.y);
  }
  // Pickies too. A door is walkable, so the pathfinder routes them through one
  // and `moveWithCollision` lets them through it — if the leaf did not also swing
  // for them, a Picky would walk through a visibly shut door, which is the one
  // thing this build will not do.
  for (const p of world.pickies ?? []) open(p.x, p.y);
  for (const b of world.buildings) {
    if (b.kind !== 'door' || !b.built) continue;
    const target = wanted.has(b.id) ? 1 : 0;
    const cur = b.open ?? 0;
    const rate = 0.12;
    b.open = cur + Math.max(-rate, Math.min(rate, target - cur));
  }
}
