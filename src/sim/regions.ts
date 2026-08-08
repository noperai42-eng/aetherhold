/**
 * Reachability — which cells a settler can walk between, without walking them.
 *
 * "Can this settler get to that sack" is the single most-asked question in the
 * sim: every job the assignment pass considers asks it once, and it considers
 * every loose stack, every marked cell and every unfinished blueprint. It used to
 * be answered by running A* and seeing whether it arrived, which is the right
 * answer computed the most expensive way there is.
 *
 * It got worse the better the colony did. A* is fast when it can head straight at
 * the target and slow when it has to feel its way round an obstacle, so the first
 * time a colony fenced its yard the search had to flood the whole enclosure
 * before it found the gate — on every question, about every sack. Walling the
 * yard in, which is the thing the game is *for*, made the simulation five times
 * slower. That is the wrong incentive to put in front of a player.
 *
 * So reachability is stored, not searched. Walkable cells are flood-filled into
 * connected components once, and two cells are mutually reachable exactly when
 * they carry the same label — a single array read, whatever is in the way. The
 * fill uses `canStep`, the same rule the pathfinder walks by, so a component is
 * precisely the set of cells A* could have found and the two can never disagree.
 *
 * The index is derived state, cached in a WeakMap rather than stored on the
 * world, so nothing here touches the save format. It follows `rooms.ts` in
 * rebuilding itself when the layout changes rather than making callers remember
 * to invalidate — a chopped tree, a burnt wall and a mined rock face all change
 * what is reachable, and an invalidation call that has to be remembered in four
 * places will be forgotten in a fifth.
 */

import { defOf } from './buildings';
import { iceBears } from './ice';
import { NEIGHBOURS_8, canStep, isWalkable } from './grid';
import type { World } from './types';
import { inBounds } from './types';

/**
 * Ticks between forced rebuilds — a backstop now, not the mechanism.
 *
 * This was twenty: a full flood fill of every cell on the map, once a second,
 * because terrain edits were not in the stamp and something had to catch them.
 * They are in the stamp now (`terrainRev`), and so is the ice, so a rebuild
 * happens when the map changes. What is left is a belt to the braces — if some
 * future thing learns to block a step without touching a building, a terrain cell
 * or the lake, the index is wrong for at most half a minute rather than forever.
 */
export const REGION_REBUILD_INTERVAL = 600;

export interface RegionIndex {
  /** Component label per cell; -1 for cells nothing can stand on. */
  cellRegion: Int32Array;
  /**
   * The same labelling for something that cannot work a door — computed on
   * demand, because only the wild ever asks. See `wildRegionAt`.
   */
  wild?: Int32Array;
  /** Cells in each component, indexed by label. Counted during the fill. */
  sizes: number[];
  /** Total standable cells — the sum of `sizes`, kept so callers need not add up. */
  walkable: number;
  /** Hash of the solid layout this index was built from. */
  stamp: number;
  builtTick: number;
  /** The last tick the stamp was actually recomputed. See `regionIndex`. */
  stampTick: number;
  /** How many buildings existed when it was. A splice moves this. */
  stampLen: number;
  /** The world's id counter when it was. Anything built moves this. */
  stampId: number;
  /** `terrainRev` when it was. Laying a floor moves this and nothing else does. */
  stampRev: number;
  /** The lake's state when it was. Freezing moves this and nothing else does. */
  stampIce: number;
}

const CACHE = new WeakMap<World, RegionIndex>();

/**
 * Fingerprint of everything that blocks a step.
 *
 * Every solid building, by id and cell — trees and boulders included, because a
 * felled tree opens a route just as surely as a demolished wall. Terrain is in
 * here as a revision number rather than a hash: sixteen thousand cells is too
 * many to read on every question and one counter is one multiply, which is why
 * `setTerrain` exists to move it.
 */
function stampOf(world: World): number {
  let h = 2166136261;
  for (const b of world.buildings) {
    if (!b.built || !defOf(b.kind).solid) continue;
    h = Math.imul(h ^ b.id, 16777619);
    h = Math.imul(h ^ (b.y * world.width + b.x), 16777619);
  }
  // Two things that are not buildings and still decide where a step can land: the
  // ground itself, counted rather than hashed, and the lake, which is a wall for
  // half the year and a road for the rest of it.
  h = Math.imul(h ^ (world.terrainRev ?? 0), 16777619);
  h = Math.imul(h ^ (iceBears(world) ? 1 : 2), 16777619);
  return h | 0;
}

/**
 * Label every walkable cell with the component it belongs to.
 *
 * Depth-first over `canStep`, which is what makes the labels mean what they say:
 * the pathfinder refuses to clip the corner between two walls, so a diagonal gap
 * that looks open from above is not a route, and the fill has to agree or the
 * index would promise paths A* cannot deliver.
 */
function flood(world: World, latch: boolean): { cellRegion: Int32Array; sizes: number[]; walkable: number } {
  const w = world.width;
  const h = world.height;
  const n = w * h;
  const cellRegion = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  let next = 0;
  let walkable = 0;

  for (let start = 0; start < n; start++) {
    if (cellRegion[start] !== -1) continue;
    const sx = start % w;
    const sy = (start - sx) / w;
    if (!isWalkable(world, sx, sy, latch)) continue;

    const id = next++;
    cellRegion[start] = id;
    sizes[id] = 1;
    walkable++;
    stack.length = 0;
    stack.push(start);

    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of NEIGHBOURS_8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(world, nx, ny)) continue;
        const j = ny * w + nx;
        if (cellRegion[j] !== -1) continue;
        if (!canStep(world, x, y, nx, ny, latch)) continue;
        cellRegion[j] = id;
        sizes[id]!++;
        walkable++;
        stack.push(j);
      }
    }
  }

  return { cellRegion, sizes, walkable };
}

function build(world: World): RegionIndex {
  const { cellRegion, sizes, walkable } = flood(world, true);

  return {
    cellRegion,
    sizes,
    walkable,
    stamp: stampOf(world),
    builtTick: world.tick,
    stampTick: world.tick,
    stampLen: world.buildings.length,
    stampId: world.nextId,
    stampRev: world.terrainRev ?? 0,
    stampIce: world.ice ?? 0,
  };
}

/**
 * The current index, rebuilt if the layout moved or the timer came round.
 *
 * The stamp is checked at most once a tick, and immediately whenever anything
 * was added or removed in between. Those two tripwires are what make the
 * once-a-tick part safe: a demolished wall is a `splice`, so the building count
 * drops; anything raised takes an id from `world.nextId`, so the counter climbs.
 * Between them they catch a knock-down-and-rebuild in the same tick, which the
 * count alone reads as nothing having happened — the first version of this cache
 * missed exactly that, and the two swap-a-wall-for-a-door tests in
 * `regions.test.ts` are the ones that said so.
 *
 * The ground and the lake are two more, and they were missed for longer. Both
 * are in `stampOf`, which is exactly no help when the shortcut's whole purpose
 * is not calling `stampOf`: a bridge decked across open water changed nothing
 * the triple was watching — no tick, no building, no id — so the index went on
 * insisting the far end of the deck was water and A* refused to search a route
 * anybody could see. Laying a floor is not rare and neither is the lake
 * freezing, so both go in the triple, where they cost one field read each rather
 * than a walk over six hundred buildings.
 *
 * What is still a tick late is a blueprint whose `built` flag flipped: a cell
 * that was already occupied becoming solid, with no id drawn and nothing
 * spliced. The index is optimistic for that one tick — it will say a settler can
 * reach through a gap that has just been closed — and the settler simply fails
 * to path and picks other work. A tick is a twentieth of a second.
 *
 * It matters because this is the hot path of the whole simulation. `stampOf`
 * walks every building on the map, trees and boulders included, and `regionAt`
 * is asked thousands of times a tick: every settler looking for work asks it
 * about every loose sack, every marked cell and every unfinished plan. Hashing
 * six hundred buildings to answer a single array read made a thirty-day colony
 * run take twenty seconds a day by the time it was nine settlers strong, and
 * ninety per cent of that was this line.
 */
export function regionIndex(world: World): RegionIndex {
  const cached = CACHE.get(world);
  if (cached) {
    const settled =
      cached.stampTick === world.tick &&
      cached.stampLen === world.buildings.length &&
      cached.stampId === world.nextId &&
      cached.stampRev === (world.terrainRev ?? 0) &&
      cached.stampIce === (world.ice ?? 0);
    const stale =
      (!settled && cached.stamp !== stampOf(world)) ||
      world.tick - cached.builtTick >= REGION_REBUILD_INTERVAL ||
      world.tick < cached.builtTick;
    if (!stale) {
      cached.stampTick = world.tick;
      cached.stampLen = world.buildings.length;
      cached.stampId = world.nextId;
      cached.stampRev = world.terrainRev ?? 0;
      cached.stampIce = world.ice ?? 0;
      return cached;
    }
  }
  const next = build(world);
  CACHE.set(world, next);
  return next;
}

/** Which component is this cell in? -1 for anything nothing can stand on. */
export function regionAt(world: World, x: number, y: number): number {
  if (!inBounds(world, x, y)) return -1;
  return regionIndex(world).cellRegion[y * world.width + x] ?? -1;
}

/**
 * The same question for something that cannot work a door.
 *
 * `worthSearching` in `path.ts` explains why this exists and what it cost not to
 * have it: the ordinary fill counts a door as passable, so a fenwolf outside a
 * shut barn carries the same label as the hay inside it. The veto passes, the
 * real search runs, and — because "there is no route" is only knowable once
 * every reachable cell has been reached — it floods the entire component before
 * giving up. Twenty-four thousand expansions, for an animal three cells from a
 * door it can never open, once every fifteen ticks for the rest of the game.
 *
 * Measured on a five-day valley: two hundred and seventy-two of the seven hundred
 * and thirty routes asked for in a day failed that way, and they were six and a
 * half million of the day's six and a half million expansions. The four hundred
 * and fifty-eight that succeeded averaged an eighteen-cell path and cost almost
 * nothing. The whole bill was doors.
 *
 * So the wild gets its own labelling, under the stricter rule that a door is a
 * wall — and one array read replaces the flood. It is built the first time
 * something asks and thrown away with the rest of the index when the layout
 * moves, because only wildlife ever asks and a colony-only map should not pay
 * for a second flood fill it never reads.
 */
export function wildRegionAt(world: World, x: number, y: number): number {
  if (!inBounds(world, x, y)) return -1;
  const idx = regionIndex(world);
  idx.wild ??= flood(world, false).cellRegion;
  return idx.wild[y * world.width + x] ?? -1;
}

/**
 * Could something standing at A walk to B?
 *
 * False when either end is unstandable, which is the honest answer: a settler
 * cannot walk into a wall, and one somehow inside one cannot walk out.
 */
export function connected(world: World, ax: number, ay: number, bx: number, by: number): boolean {
  const a = regionAt(world, ax, ay);
  if (a < 0) return false;
  return a === regionAt(world, bx, by);
}

