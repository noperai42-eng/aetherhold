/**
 * Annexes — how the compound grows a room instead of a bigger hall.
 *
 * The Steward could raise a fence, wire a turret and put a bed against a wall,
 * but every bed it ever placed went into the same room: `heart(world)`. Twenty
 * days in, a colony of eight was eight bunks along the walls of one cabin, and
 * there was no ambition on the list that could ever have produced anything else.
 * A colony that only knows how to fill a hall is a colony that never builds a
 * *place*.
 *
 * This module owns one question and no policy: **where would another small room
 * fit onto what we have already got?** It returns cells. It does not mark
 * blueprints, does not know what the room is for, and does not care whether the
 * thing that ends up inside is a bed, a hospital cot or a prison bunk — the
 * Steward's ambitions decide that, and all three want the same box.
 *
 * The shape is deliberate and it is the cheapest one that works:
 *
 *  - **It leans on a wall that already exists.** A free-standing hut costs a
 *    ring of sixteen walls; an annex sharing the cabin's south wall costs nine.
 *    The colony is spending planks it felled by hand, and the difference is a
 *    day of somebody's life.
 *  - **The door opens onto the yard, not into the hall.** Cutting a doorway
 *    through the host wall would mean deconstructing a standing wall and
 *    building a door in the hole — two passes, an ordering problem, and a
 *    colony that has knocked a hole in its own cabin if it is interrupted
 *    between them. Walking out of the front door and along the wall to your own
 *    room is a real building, and it never leaves the compound half-open.
 *  - **Three wide and two deep.** `YARD_MARGIN` puts the fence four cells off
 *    the cabin, so an annex may be at most three cells deep — two of floor and
 *    its own outer wall — and still leave a lane between it and the boundary.
 *    Anything roomier would have the colony fencing itself out of its own yard.
 *
 * Nothing here is private-bedroom-specific. `planAnnex` is the primitive; what
 * it is used for lives in steward.ts.
 */

import { defOf } from './buildings';
import { buildingAt } from './grid';
import { canPlace } from './orders';
import { ROOM_WALL_HEIGHT, type Room } from './rooms';
import type { BuildingKind, World } from './types';
import { terrainAt } from './types';

/** Floor cells across the front of an annex. */
export const ANNEX_WIDE = 3;

/**
 * Floor cells from the host wall outward.
 *
 * One, not two, and the difference is the whole feature working or not. An annex
 * `d` deep occupies `d + 1` cells counting its own outer wall, and `YARD_MARGIN`
 * is 4 — but the fence ring is laid at exactly `margin` cells out, so a two-deep
 * annex puts its outer wall *on the fence line* and `canPlace` refuses every span.
 * Measured on seed 4242: the colony managed exactly one bedroom, on the one side
 * where a field had already pushed the ring further out, and then never found
 * anywhere to put another for the rest of the run.
 *
 * One deep leaves a two-cell lane between the room and the fence, which is what
 * makes the shape available on all four sides. Three cells of floor is a bed and
 * a lamp with a square to stand on, which is what a room of one's own has to be
 * and is not required to be more than.
 */
export const ANNEX_DEEP = 1;

export interface Annex {
  /** Which side of the host it leans on — for the log line, and for tests. */
  side: 'north' | 'south' | 'east' | 'west';
  /** The floor. `ANNEX_WIDE` by the plan's depth, nothing standing on them. */
  floor: { x: number; y: number }[];
  /** Cells that must carry a wall. Excludes the shared host wall and the door. */
  walls: { x: number; y: number }[];
  /** The one gap in the outer wall. */
  door: { x: number; y: number };
}

/** Along-the-wall and out-from-the-wall unit vectors for each side of a box. */
const SIDES = [
  { side: 'south' as const, ax: 1, ay: 0, ox: 0, oy: 1 },
  { side: 'north' as const, ax: 1, ay: 0, ox: 0, oy: -1 },
  { side: 'east' as const, ax: 0, ay: 1, ox: 1, oy: 0 },
  { side: 'west' as const, ax: 0, ay: 1, ox: -1, oy: 0 },
];

/**
 * Does this cell enclose a room — a wall, a door, or the rock a cave is cut from?
 *
 * This asks the question exactly the way `rooms.ts` asks it, on **height** and
 * not on `solid`, and the difference is the whole reason this comment is long.
 *
 * It used to say `def.solid || b.kind === 'door'`, which is true of a fence. A
 * fence is solid — it stops a body — and it is waist-high, so `rooms.ts` reads
 * straight over the top of it and calls the far side outdoors. Every south-facing
 * annex on seed 4242 was therefore planned with the *yard fence* as its outer
 * wall: `planAnnex` returned a clean-looking plan, the Steward found a building
 * already standing on all three of those cells and marked nothing, and the box it
 * had walled off on two sides was never a room, so no bed was ever placed in it.
 * Twenty-two days of a colony politely building nothing.
 *
 * A door in the host wall is still welcome — it means the annex can be reached
 * from indoors too — and a door is tall, so it passes on its own merits.
 */
function encloses(world: World, x: number, y: number): boolean {
  const b = buildingAt(world, x, y);
  if (b) {
    const def = defOf(b.kind);
    return def.buildable && def.height >= ROOM_WALL_HEIGHT;
  }
  return terrainAt(world, x, y) === 'rock';
}

/**
 * The host's bounding box, one cell out — the line its own walls stand on.
 *
 * Taken from the room's floor rather than from its walls because a room knows
 * its cells and not its shell. The ring around the floor *is* the shell.
 */
function hostBox(world: World, room: Room): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const packed of room.cells) {
    const x = packed % world.width;
    const y = (packed - x) / world.width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Somewhere another room could go, or null if the compound has run out of wall.
 *
 * `kind` is the wall the caller intends to raise, because affording stone and
 * affording timber are different questions and `canPlace` answers for one kind
 * at a time. Candidates are scanned in a fixed order — south, north, east, west,
 * and along each side from its low end — so a half-built annex is proposed again
 * on the next pass rather than abandoned for a different corner. The Steward
 * builds in batches; without that stability it would leave three walls standing
 * in three different places.
 */
export function planAnnex(
  world: World,
  room: Room,
  kind: BuildingKind = 'wall',
  deep: number = ANNEX_DEEP,
): Annex | null {
  const b = hostBox(world, room);

  for (const s of SIDES) {
    // The host wall line, and where along it the span may start. Along-offsets
    // are measured from the low corner of the side.
    const lo = s.ax === 1 ? b.x0 : b.y0;
    const hi = s.ax === 1 ? b.x1 : b.y1;
    // The wall line sits one cell beyond the floor on the outward side.
    const baseX = s.ax === 1 ? 0 : s.ox > 0 ? b.x1 + 1 : b.x0 - 1;
    const baseY = s.ay === 1 ? 0 : s.oy > 0 ? b.y1 + 1 : b.y0 - 1;
    const at = (t: number, d: number): { x: number; y: number } => ({
      x: (s.ax === 1 ? t : baseX) + s.ox * d,
      y: (s.ay === 1 ? t : baseY) + s.oy * d,
    });

    for (let start = lo; start + ANNEX_WIDE - 1 <= hi; start++) {
      const plan = tryAt(world, s, at, start, kind, deep);
      if (plan) return plan;
    }
  }
  return null;
}

/** One candidate: the span `[start-1, start+ANNEX_WIDE]` on one side. */
function tryAt(
  world: World,
  s: (typeof SIDES)[number],
  at: (t: number, d: number) => { x: number; y: number },
  start: number,
  kind: BuildingKind,
  deep: number,
): Annex | null {
  const t0 = start - 1;
  const t1 = start + ANNEX_WIDE;
  const dWall = deep + 1;

  // The host must actually be walled behind the whole span. An annex hung off a
  // gap in the shell is not a room, it is an alcove of the great outdoors, and
  // rooms.ts would rightly refuse to call it anything.
  for (let t = t0; t <= t1; t++) {
    const c = at(t, 0);
    if (!encloses(world, c.x, c.y)) return null;
  }

  const floor: { x: number; y: number }[] = [];
  const walls: { x: number; y: number }[] = [];

  for (let t = t0; t <= t1; t++) {
    for (let d = 1; d <= dWall; d++) {
      const c = at(t, d);
      const edge = t === t0 || t === t1 || d === dWall;
      // The floor must be genuinely free. The shell may already be standing:
      // the Steward marks blueprints `BATCH` at a time, so it meets its own
      // half-built annex on the next pass and has to recognise it rather than
      // wander off and start a second one somewhere down the wall. Cells that
      // already carry a wall are kept in the plan and simply fail to blueprint.
      if (edge) {
        if (!(canPlace(world, kind, c.x, c.y) === 'ok' || encloses(world, c.x, c.y))) return null;
        walls.push(c);
      } else {
        if (canPlace(world, 'bed', c.x, c.y) !== 'ok') return null;
        floor.push(c);
      }
    }
  }

  // The middle of the outer wall, so the doorway is never in a corner where a
  // settler has to cut two diagonals to use it.
  const door = at(start + Math.floor(ANNEX_WIDE / 2), dWall);
  const kept = walls.filter((w) => w.x !== door.x || w.y !== door.y);
  if (kept.length === walls.length) return null;

  return { side: s.side, floor, walls: kept, door };
}

/**
 * The cheaper room: a corner of the hall, walled off from the inside.
 *
 * `planAnnex` is the fallback and this is the primary, which is the reverse of
 * the order they were written in and the reverse of what seems obvious. Two
 * measured reasons:
 *
 *  - **It always fits.** An annex needs free ground outside the host wall and
 *    inside the fence, and `YARD_MARGIN` leaves so little of it that on three of
 *    four probe seeds the colony found exactly one site in forty days and then
 *    never another. A hall of ninety-nine cells has four corners and no fence to
 *    argue with.
 *  - **It is cheaper.** Six walls against nine, and no outer shell to keep
 *    weatherproof, because the hall's own walls are already three sides of it.
 *
 * The shape is an L cut across a corner: `ANNEX_WIDE` by `PARTITION_DEEP` of
 * floor, a partition along the two exposed faces, and a door in the middle of the
 * long one opening back into the hall. Everything it touches must already be
 * inside the room, so it can never eat the hall's own shell or wall off its door.
 */
export const PARTITION_DEEP = 2;

/** What has to be left of the hall afterwards for it to still be a hall. */
const HALL_FLOOR_LEFT = 12;

/**
 * Where a cut can be anchored: the hall floor row nearest each wall, and the
 * direction "further into the hall" from it.
 */
const FACES = [
  { along: 'x' as const, base: 'y0' as const, ix: 0, iy: 1 },
  { along: 'x' as const, base: 'y1' as const, ix: 0, iy: -1 },
  { along: 'y' as const, base: 'x0' as const, ix: 1, iy: 0 },
  { along: 'y' as const, base: 'x1' as const, ix: -1, iy: 0 },
];

export function planPartition(world: World, room: Room, kind: BuildingKind = 'wall'): Annex | null {
  const walls = 2 * (PARTITION_DEEP + 1) + ANNEX_WIDE;
  if (room.size - ANNEX_WIDE * PARTITION_DEEP - walls < HALL_FLOOR_LEFT) return null;
  const b = hostBox(world, room);
  const inRoom = new Set(room.cells);

  for (const f of FACES) {
    const alongX = f.along === 'x';
    const lo = alongX ? b.x0 : b.y0;
    const hi = alongX ? b.x1 : b.y1;
    const fixed = b[f.base];
    // `t` runs along the wall, `d` runs into the hall; d = 0 is the row of floor
    // against the wall. Flush-with-a-corner is just the first and last `t` —
    // there is no special case for it, because a side face that lands on the
    // hall's own wall is accepted by the `encloses` test below like any other
    // course already standing.
    const at = (t: number, d: number): { x: number; y: number } =>
      alongX ? { x: t, y: fixed + f.iy * d } : { x: fixed + f.ix * d, y: t };

    for (let t = lo; t + ANNEX_WIDE - 1 <= hi; t++) {
      const plan = cutAt(world, inRoom, at, t, world.width, kind, alongX ? (f.iy > 0 ? 'north' : 'south') : f.ix > 0 ? 'west' : 'east');
      if (plan) return plan;
    }
  }
  return null;
}

/** One candidate cut: `ANNEX_WIDE` of the wall, `PARTITION_DEEP` into the hall. */
function cutAt(
  world: World,
  inRoom: Set<number>,
  at: (t: number, d: number) => { x: number; y: number },
  start: number,
  width: number,
  kind: BuildingKind,
  side: Annex['side'],
): Annex | null {
  const packed = (x: number, y: number): number => y * width + x;
  const floor: { x: number; y: number }[] = [];
  const walls: { x: number; y: number }[] = [];

  // A bunk already standing in the corner is not an obstacle, it is the point.
  //
  // Requiring bare ground looked right and measured wrong: the `beds` ambition
  // lines the hall's walls with bunks long before anyone gets round to walling a
  // room, so every cut that was not on bare floor was refused and seed 4242
  // managed exactly one bedroom in forty days. Walling one existing bunk in *is*
  // `quarters.ts`'s rule ("a room with one bed in it belongs to whoever sleeps in
  // that bed") arriving a step earlier, and it costs six planks instead of six
  // planks and a bed.
  //
  // One, though. Two bunks behind one door is a smaller barracks, not a bedroom.
  let bunks = 0;
  for (let i = 0; i < ANNEX_WIDE; i++) {
    for (let d = 0; d < PARTITION_DEEP; d++) {
      const c = at(start + i, d);
      if (!inRoom.has(packed(c.x, c.y))) return null;
      const standing = buildingAt(world, c.x, c.y);
      if (standing) {
        // A stove, a table, a workbench: this corner is the hall's kitchen and
        // the hall keeps it. Only a bed earns the exception.
        if (standing.kind !== 'bed' || !standing.built) return null;
        if (++bunks > 1) return null;
      } else if (canPlace(world, 'bed', c.x, c.y) !== 'ok') {
        return null;
      }
      floor.push(c);
    }
  }

  // Three faces: the two sides, and the front looking back into the hall. The
  // hall's own wall is the fourth.
  for (let d = 0; d <= PARTITION_DEEP; d++) {
    walls.push(at(start - 1, d));
    walls.push(at(start + ANNEX_WIDE, d));
  }
  for (let i = 0; i < ANNEX_WIDE; i++) walls.push(at(start + i, PARTITION_DEEP));

  const door = at(start + Math.floor(ANNEX_WIDE / 2), PARTITION_DEEP);

  for (const w of walls) {
    // Already standing — a course from an earlier batch, or the hall's own wall
    // where the cut sits flush with a corner. Tested *before* `inRoom`, not
    // after: a wall or a door is a boundary, so the moment one goes up its cell
    // stops being room floor. A plan that insisted every course was still floor
    // would reject the corner it had itself half-built, propose a different one,
    // and leave the colony planting doors round the hall one abandoned bedroom at
    // a time — which is exactly what three seeds measured.
    if (encloses(world, w.x, w.y)) continue;
    if (!inRoom.has(packed(w.x, w.y))) return null;
    if (canPlace(world, kind, w.x, w.y) !== 'ok') return null;
  }

  // Nothing of the hall's may be shut in behind the partition. The floor is
  // already known free; a door is the one thing `canPlace` says nothing useful
  // about, because the question is not whether the cell is clear but what it
  // opens onto. Our own doorway is exempt — it is the way in.
  for (const w of walls) {
    if (w.x === door.x && w.y === door.y) continue;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = w.x + dx;
      const y = w.y + dy;
      if (x === door.x && y === door.y) continue;
      const n = buildingAt(world, x, y);
      if (n && n.kind === 'door') return null;
    }
  }

  const kept = walls.filter((w) => w.x !== door.x || w.y !== door.y);
  if (kept.length === walls.length) return null;

  return { side, floor, walls: kept, door };
}

/**
 * How deep a bunkhouse room is — the other half of the 3×2 the colony asked for.
 *
 * `ANNEX_DEEP` is 1 because an annex hung off the *cabin* has `YARD_MARGIN` and
 * the fence line to argue with, and two deep put its outer wall on the ring. A
 * bunkhouse room hung off another bunkhouse room is already out in the yard with
 * the lane in front of it, so the constraint that forced one deep is not there
 * and the room can be the size a room should be: six cells, a bed and a lamp and
 * somewhere to stand that is not the foot of the bed.
 */
export const BUNK_DEEP = 2;

/**
 * The next room in the bunkhouse — a box sharing a wall with one already up.
 *
 * There is no separate bunkhouse building and there is no bunkhouse in the save.
 * A bunkhouse is what a row of rooms *is* once each one has been hung off the
 * last, and that is the whole trick: the first room leans on the cabin, the
 * second leans on the first, and every wall after the first room is a divider
 * two rooms are paying half of.
 *
 * It also lifts the ceiling that carving the hall ran into. `planPartition` eats
 * the shared room until `HALL_FLOOR_LEFT` stops it, which measured at two or
 * three bedrooms and then nothing for the rest of the run; a row that grows off
 * its own far end has no such number in it, because every room it finishes is
 * somewhere the next one can lean.
 *
 * Hosts are tried in the order given — the caller owns the policy, this owns the
 * geometry — and the deeper room is tried against *every* host before the
 * shallow one is tried against any. A proper six-cell room round the far side is
 * worth more than a three-cell slot next door.
 */
export function planBunkhouse(world: World, hosts: Room[], kind: BuildingKind = 'wall'): Annex | null {
  for (const deep of [BUNK_DEEP, ANNEX_DEEP]) {
    for (const room of hosts) {
      const plan = planAnnex(world, room, kind, deep);
      if (plan) return plan;
    }
  }
  return null;
}
