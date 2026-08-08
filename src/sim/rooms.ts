/**
 * Rooms — the flood fill that turns four walls into a place.
 *
 * Until now "indoors" was a guess: four short rays from a cell, and if all four
 * hit something solid you were under cover. It was cheap and it was honest about
 * corridors, but it could not tell a sealed larder from a lean-to, could not say
 * how much air a cooler had to chill, and had no idea a door was standing open.
 *
 * This module answers the question properly. Every cell that is not part of an
 * enclosing edge gets flood-filled into a region; a region that stays small and
 * never reaches the map edge is a *room*, with a cell count and a tally of how
 * much of its boundary is solid wall versus door. That tally is what
 * temperature.ts spends: walls hold heat, doors leak it, and a big room takes
 * longer to warm than a small one.
 *
 * Two things are load-bearing here and both are the result of getting them wrong:
 *
 *  - **Trees do not enclose.** They are 4.5 m tall and solid, so the old ray test
 *    counted a gap in the woods as shelter. Worse, under a flood fill a stand of
 *    trees can pinch the outdoors into pockets, and every pocket would become a
 *    heated room. A room is what you *built*, so only buildable walls and doors
 *    (and natural rock, which is what a mined-out cave is made of) enclose.
 *  - **A region has a size cap.** Worldgen rims the map in rock, so the great
 *    outdoors is itself a closed region — several thousand cells of it. Without
 *    MAX_ROOM_CELLS the whole map would read as one enormous well-sealed room
 *    and the weather would stop mattering.
 *
 * The index is derived state. It is cached per-world in a WeakMap rather than
 * stored on the world, so nothing here touches the save format, and it is rebuilt
 * whenever the wall layout changes (or every second, which catches terrain edits
 * like a mined rock face without every caller having to remember to invalidate).
 */

import { defOf } from './buildings';
import type { Building, World } from './types';
import { TERRAIN_LIST, inBounds } from './types';

/** Metres. Walls (2.6) and doors (2.6) reach it; nothing else buildable does. */
export const ROOM_WALL_HEIGHT = 2;

/**
 * Largest enclosed region that still counts as a room. The starter cabin is 99
 * cells and a generous player base is a few hundred; the outdoors on a 64x64 map
 * is upwards of 2,500. Anything between is a hall so big it may as well have
 * weather in it.
 */
export const MAX_ROOM_CELLS = 600;

/**
 * Ticks between forced rebuilds — a backstop, since `terrainRev` catches the edits.
 *
 * See `REGION_REBUILD_INTERVAL`, which was the same timer for the same reason and
 * is now the same backstop. A mined-out rock face changes what encloses a room,
 * and it moves the counter the moment the pick goes through.
 */
export const ROOM_REBUILD_INTERVAL = 600;

export interface Room {
  id: number;
  /** Packed cell indices (y * width + x) that make up the room's floor. */
  cells: number[];
  size: number;
  /** Boundary edges made of wall or rock. */
  wallEdges: number;
  /** Boundary edges made of door — the leaky ones. */
  doorEdges: number;
  /**
   * Remembered air temperature in °C, stepped by temperature.ts. NaN means
   * "never settled", which makes the first read snap straight to the target
   * instead of drifting up from zero.
   */
  temp: number;
}

export interface RoomIndex {
  /** Room id per cell, -1 for outdoors (including wall and door cells themselves). */
  cellRoom: Int32Array;
  rooms: Map<number, Room>;
  /** Hash of the enclosing layout this index was built from. */
  stamp: number;
  builtTick: number;
  /** Last tick temperature was stepped. Carried across rebuilds so heat is not reset. */
  tempTick: number;
}

const CACHE = new WeakMap<World, RoomIndex>();

/** Wall/rock, door, or open — the only three things the fill cares about. */
const OPEN = 0;
const WALL = 1;
const DOOR = 2;

/**
 * Does this cell block the sky?
 *
 * Rock is natural wall. Buildable structures qualify on height, which is how a
 * door — height 2.6 but walkable — stays part of the boundary while a lamp at
 * 1.7 does not. Water is deliberately absent: a lake is not a roof.
 */
function edgeKind(world: World, i: number, byId: Map<number, Building>): number {
  if (TERRAIN_LIST[world.terrain[i]] === 'rock') return WALL;
  const id = world.cellBuilding[i];
  if (id === undefined || id < 0) return OPEN;
  const b = byId.get(id);
  if (!b || !b.built) return OPEN;
  const d = defOf(b.kind);
  if (!d.buildable || d.height < ROOM_WALL_HEIGHT) return OPEN;
  return b.kind === 'door' ? DOOR : WALL;
}

/**
 * Cheap fingerprint of everything that can enclose a room.
 *
 * Three counters and no loop. This used to walk every building on the map and
 * hash the walls, and the comment here called that cheap enough to check on every
 * query — which it was, while the callers were a handful of `roomAt`s per tick.
 * Then temperature and crop growth started asking per cell. At 192² that is tens
 * of thousands of walks a tick, and the profile put this function above the
 * entirety of wildlife: the check for whether the answer had changed cost far more
 * than recomputing the answer would have. `buildRev` moves when a building is
 * added, removed, or finishes; `terrainRev` when the ground does, because rock is
 * wall and mining one out is a room boundary moving.
 *
 * `buildings.length` rides along as a belt to the counter's braces. It cannot
 * catch a missed `built` flip, but it does catch the likelier mistake — a new line
 * that pushes onto the building list without saying so — and it costs one property
 * read against the several hundred multiplies it replaced.
 */
function stampOf(world: World): number {
  let h = 2166136261;
  h = Math.imul(h ^ (world.buildRev ?? 0), 16777619);
  h = Math.imul(h ^ world.buildings.length, 16777619);
  h = Math.imul(h ^ (world.terrainRev ?? 0), 16777619);
  return h | 0;
}

const STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Rebuild the index from scratch.
 *
 * Buildings are snapshotted into a Map first. `buildingAt` is a linear search of
 * world.buildings, and calling it once per cell would be the better part of a
 * million comparisons per rebuild; this way the whole pass is O(cells +
 * buildings), which is a fifth of a millisecond and can therefore run on a timer
 * without anyone noticing.
 */
function build(world: World, prev: RoomIndex | undefined): RoomIndex {
  const w = world.width;
  const h = world.height;
  const n = w * h;
  const byId = new Map<number, Building>();
  for (const b of world.buildings) byId.set(b.id, b);

  const edge = new Uint8Array(n);
  for (let i = 0; i < n; i++) edge[i] = edgeKind(world, i, byId);

  const cellRoom = new Int32Array(n).fill(-1);
  const rooms = new Map<number, Room>();
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const cells: number[] = [];
  let nextRoom = 1;

  for (let start = 0; start < n; start++) {
    if (seen[start] || edge[start] !== OPEN) continue;
    cells.length = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let wallEdges = 0;
    let doorEdges = 0;
    let outdoors = false;

    while (stack.length > 0) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % w;
      const y = (i - x) / w;
      // A region that reaches the map edge is under open sky by definition, and
      // so is one that has swallowed more cells than any building could hold.
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) outdoors = true;
      if (cells.length > MAX_ROOM_CELLS) outdoors = true;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const e = edge[j];
        if (e === WALL) {
          wallEdges++;
          continue;
        }
        if (e === DOOR) {
          doorEdges++;
          continue;
        }
        if (seen[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }

    if (outdoors) continue;
    const id = nextRoom++;
    // Inherit whatever heat the old index remembered at this spot, so adding a
    // wall to a warm room does not blow the fire out. With no old index — a fresh
    // world, or one just loaded off disk — the save's own remembered temperatures
    // stand in, keyed by this same anchor cell. A room that neither knows about
    // starts at NaN and settles on its first read.
    const anchor = cells[0]!;
    const inherited = prev
      ? (prev.rooms.get(prev.cellRoom[anchor] ?? -1)?.temp ?? NaN)
      : (world.roomTemps?.[anchor] ?? NaN);
    const room: Room = {
      id,
      cells: cells.slice(),
      size: cells.length,
      wallEdges,
      doorEdges,
      temp: inherited,
    };
    rooms.set(id, room);
    for (const i of cells) cellRoom[i] = id;
  }

  return {
    cellRoom,
    rooms,
    stamp: stampOf(world),
    builtTick: world.tick,
    tempTick: prev?.tempTick ?? -1,
  };
}

/**
 * The current room index, rebuilt if the walls moved or the timer came round.
 *
 * Callers never have to invalidate anything. That is deliberate: mining, fires
 * and raiders all change the layout, and an invalidation call that has to be
 * remembered in four places is an invalidation call that will be forgotten in a
 * fifth.
 */
export function roomIndex(world: World): RoomIndex {
  const cached = CACHE.get(world);
  if (cached) {
    const stale =
      cached.stamp !== stampOf(world) ||
      world.tick - cached.builtTick >= ROOM_REBUILD_INTERVAL ||
      world.tick < cached.builtTick;
    if (!stale) return cached;
  }
  const next = build(world, cached);
  CACHE.set(world, next);
  return next;
}

export function roomAt(world: World, x: number, y: number): Room | null {
  if (!inBounds(world, x, y)) return null;
  const idx = roomIndex(world);
  const id = idx.cellRoom[y * world.width + x];
  if (id === undefined || id < 0) return null;
  return idx.rooms.get(id) ?? null;
}

/** Is this cell inside a room? The replacement for the old four-ray `sheltered`. */
export function indoors(world: World, x: number, y: number): boolean {
  return roomAt(world, x, y) !== null;
}

/** The room a building sits in — walls and doors are boundaries, so they have none. */
export function roomOf(world: World, b: { x: number; y: number }): Room | null {
  return roomAt(world, b.x, b.y);
}
