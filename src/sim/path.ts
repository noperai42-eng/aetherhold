/**
 * A* over the walkability grid, with a tiny binary heap.
 *
 * Paths are arrays of packed cell indices, NOT including the start cell, so
 * `path[0]` is always "the next cell to step into". Pawns re-path on demand;
 * there is no navmesh cache to go stale when a wall goes up.
 */

import { canStep, moveCost, NEIGHBOURS_8, isWalkable } from './grid';
import { regionAt, wildRegionAt } from './regions';
import type { World } from './types';
import { inBounds } from './types';

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.vals[0]!;
    const lastKey = this.keys.pop()!;
    const lastVal = this.vals.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.vals[0] = lastVal;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.keys.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = k;
    const v = this.vals[a]!;
    this.vals[a] = this.vals[b]!;
    this.vals[b] = v;
  }
}

/**
 * Scratch space for the search, reused between calls.
 *
 * A* is asked "can this settler get to that sack" dozens of times per decision,
 * and each of those used to allocate three map-sized typed arrays and fill two of
 * them — thirty-six kilobytes and eight thousand writes before a single cell was
 * expanded. The arrays are reused instead, and `seen` holds a run number rather
 * than a flag so a fresh search costs one integer increment instead of a wipe.
 *
 * The sim is single-threaded and `findPath` never yields, so there is exactly one
 * search in flight at a time and sharing this is safe. The buffers grow to fit
 * the biggest map they have been asked about and never shrink; one 64×64 map is
 * thirty-six kilobytes held for the life of the tab.
 */
let gScore = new Float32Array(0);
let came = new Int32Array(0);
let seen = new Int32Array(0);
let run = 0;

function scratch(size: number): void {
  if (gScore.length < size) {
    gScore = new Float32Array(size);
    came = new Int32Array(size);
    seen = new Int32Array(size);
    run = 0;
  }
  // Wraps every two billion searches. Wiping on the wrap costs one pass in a
  // blue moon and keeps a stale run number from reading as this one's.
  if (++run === 0x7fffffff) {
    seen.fill(0);
    run = 1;
  }
}

const SQRT2 = Math.SQRT2;

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
}

export interface PathOptions {
  /** stop when any of these packed cells is reached (used for "stand next to X") */
  goals?: Set<number>;
  /** abort after this many expansions (keeps a wedged pawn from stalling a tick) */
  maxExpansions?: number;
  /**
   * Can whatever is walking this route work a door? Default yes.
   *
   * `false` is the wild: a fenwolf routes round a gated pen rather than through
   * the gate, and finds no route at all into one that is properly shut.
   *
   * What it does *not* do is make the wolf give up. An earlier version of this
   * comment said it did, and `wildlife.ts` deliberately went the other way: a
   * shut gate turns the hunt into working the fence line rather than choosing a
   * different animal, because a predator that shrugs and wanders off the moment a
   * pen is latched teaches the player that a gate is a solved problem. The
   * routing consequence is here; the giving-up decision was never here.
   */
  latch?: boolean;
}

/**
 * What a burning cell costs A*, in cells of detour, and what its neighbours cost.
 *
 * Not a wall. A settler has to be able to path *out* of a fire they are standing
 * in, and a rescuer has to be able to reach somebody lying in one, so fire is
 * priced rather than blocked — it takes a route around if there is one within
 * forty cells and goes through if there is not.
 *
 * The edge charge is the interesting one. A pawn walks the straight line between
 * cell centres, so a diagonal step past a burning cell passes within 0.64 of it —
 * inside `FIRE_TOUCH`. Cutting that corner is how a hauler crossing the yard on
 * perfectly reasonable business walked through the flames, caught, fled, was
 * handed the same haul back, and walked through them again: the settler was not
 * being stupid, the route simply did not know the fire was there.
 */
const FIRE_CELL_COST = 40;
const FIRE_EDGE_COST = 8;

/** Packed cell → detour charge, or null when nothing is alight. */
function fireCosts(world: World): Map<number, number> | null {
  if (world.fires.length === 0) return null;
  const W = world.width;
  const out = new Map<number, number>();
  for (const f of world.fires) {
    for (const [dx, dy] of NEIGHBOURS_8) {
      const nx = f.x + dx;
      const ny = f.y + dy;
      if (!inBounds(world, nx, ny)) continue;
      const i = ny * W + nx;
      if ((out.get(i) ?? 0) < FIRE_EDGE_COST) out.set(i, FIRE_EDGE_COST);
    }
  }
  // Second, so a cell that is both alight and beside another flame is priced as
  // the fire it is rather than the neighbour it also is.
  for (const f of world.fires) {
    if (!inBounds(world, f.x, f.y)) continue;
    out.set(f.y * W + f.x, FIRE_CELL_COST);
  }
  return out;
}

/**
 * Is there any point running the search at all?
 *
 * A failed A* is the most expensive thing in the simulation. It cannot stop early
 * — "there is no route" is only knowable once every cell it could have reached
 * has been reached — so it expands until it runs out of map or out of budget, and
 * on a 128-cell valley that is ten thousand expansions and about three
 * milliseconds. A successful one averages ten.
 *
 * That bill was being paid over and over by the wildlife. Ninety-three per cent of
 * every route a hungry animal asked for was a route to somewhere it could not
 * stand: a brambletail on the wrong side of the lake, reading the fruit on the far
 * shore and setting off for it once a second, flooding the entire island each
 * time. Thirty animals doing that was the whole cost of the ecosystem — A* and its
 * two helpers were eighty-six per cent of the profile — and it is why a valley
 * without a single colonist in it ran barely twice as fast as one with a colony.
 *
 * `regions.ts` already knows the answer for free. The flood fill it keeps is built
 * with `canStep`, the same rule this walks by, so a component is exactly the set
 * of cells this search could have found: two different labels mean no route
 * exists, whatever is in the way, and the search would be doing ten thousand
 * expansions to reach that conclusion.
 *
 * Doors were the residual, and they were most of the bill that was left. The
 * ordinary fill counts a door as passable, so a fenwolf that cannot work one
 * still shared a label with the barn it could never enter: the veto passed, the
 * real search ran, and it flooded the whole component to conclude what the
 * animal's own legs already knew. On a five-day valley that was two hundred and
 * seventy-two failed routes a day at twenty-four thousand expansions each —
 * ninety-nine per cent of every expansion the simulation performed, spent by
 * animals standing three cells from a shut door. So a walker that cannot work a
 * door is vetoed against `wildRegionAt`, the same fill under the rule it actually
 * walks by, and the flood is one array read.
 *
 * Only ever a veto. Same label is still not a promise: the fills are built from
 * `canStep` and know nothing of a cell somebody happens to be standing in. And a
 * start cell nothing can stand on (`-1`: somebody inside a wall, or a wall raised
 * on top of them) is left alone to path its way out.
 */
function worthSearching(
  world: World,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  goals: Set<number> | undefined,
  latch: boolean,
): boolean {
  const at = latch ? regionAt : wildRegionAt;
  const here = at(world, sx, sy);
  if (here < 0) return true;
  if (!goals) return at(world, tx, ty) === here;
  const W = world.width;
  for (const g of goals) {
    const gx = g % W;
    if (at(world, gx, (g - gx) / W) === here) return true;
  }
  return false;
}

/**
 * Find a path from (sx,sy) to (tx,ty) — or to any cell in `opts.goals`.
 * Returns packed cells excluding the start, or null when unreachable.
 */
export function findPath(
  world: World,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  opts: PathOptions = {},
): number[] | null {
  const W = world.width;
  const H = world.height;
  const start = sy * W + sx;
  const goals = opts.goals;
  // Two thirds of the map, which is exactly what the flat 6000 this replaced was
  // on the 96×96 map it was tuned against. Left flat, a bigger valley would quietly
  // start failing honest routes — a hauler that will not cross the map reads as a
  // broken settler, not as a budget.
  const maxExpansions = opts.maxExpansions ?? Math.max(6000, Math.round(W * H * 0.65));
  const latch = opts.latch ?? true;

  if (!inBounds(world, sx, sy)) return null;
  if (goals && goals.size === 0) return null;
  if (goals ? goals.has(start) : sx === tx && sy === ty) return [];

  // Aim the heuristic at the centroid of the goal set (fine for small goal sets).
  let hx = tx;
  let hy = ty;
  if (goals) {
    let ax = 0;
    let ay = 0;
    for (const g of goals) {
      ax += g % W;
      ay += Math.floor(g / W);
    }
    hx = ax / goals.size;
    hy = ay / goals.size;
  }

  if (!worthSearching(world, sx, sy, tx, ty, goals, latch)) return null;

  scratch(W * H);
  const burning = fireCosts(world);
  const open = new MinHeap();

  // `seen` doubles as both "has a score" and "is closed": `run` means opened,
  // `-run` means expanded. That is one array where there were three, and it is
  // why nothing has to be cleared between searches.
  seen[start] = run;
  gScore[start] = 0;
  came[start] = -1;
  open.push(octile(sx, sy, hx, hy), start);
  let expansions = 0;

  while (open.size > 0) {
    const cur = open.pop();
    if (seen[cur] === -run) continue;
    seen[cur] = -run;
    if (++expansions > maxExpansions) return null;

    const cx = cur % W;
    const cy = (cur - cx) / W;
    const reached = goals ? goals.has(cur) : cx === tx && cy === ty;
    if (reached) {
      const out: number[] = [];
      let n = cur;
      while (n !== start) {
        out.push(n);
        n = came[n]!;
      }
      out.reverse();
      return out;
    }

    for (const [dx, dy] of NEIGHBOURS_8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(world, nx, ny)) continue;
      const ni = ny * W + nx;
      if (seen[ni] === -run) continue;
      if (!canStep(world, cx, cy, nx, ny, latch)) continue;
      const step =
        (dx !== 0 && dy !== 0 ? SQRT2 : 1) * moveCost(world, nx, ny) +
        (burning === null ? 0 : (burning.get(ni) ?? 0));
      const ng = gScore[cur]! + step;
      // An unvisited cell has no score to beat, which is what the `Infinity` fill
      // used to say and what the run number says now.
      if (seen[ni] !== run || ng < gScore[ni]!) {
        seen[ni] = run;
        gScore[ni] = ng;
        came[ni] = cur;
        open.push(ng + octile(nx, ny, hx, hy), ni);
      }
    }
  }
  return null;
}

/** Convenience: path to any walkable cell adjacent to (tx,ty), or onto it if walkable. */
export function findPathAdjacent(
  world: World,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): number[] | null {
  const goals = new Set<number>();
  if (isWalkable(world, tx, ty)) goals.add(ty * world.width + tx);
  for (const [dx, dy] of NEIGHBOURS_8) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!inBounds(world, nx, ny)) continue;
    if (isWalkable(world, nx, ny)) goals.add(ny * world.width + nx);
  }
  return findPath(world, sx, sy, tx, ty, { goals });
}
