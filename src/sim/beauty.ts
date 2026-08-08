/**
 * What it is like to live here.
 *
 * Every building in this game earns its place by doing something: a bed restores
 * rest, a stove cooks, a wall stops a bullet. That makes a colony that is
 * *working* and a colony that is *pleasant* the same colony, and it means the
 * only reason to lay a plank floor is that it is quicker underfoot. This module
 * is the second reason.
 *
 * A room gets a beauty score from what stands in it — furniture and a laid floor
 * lift it, machinery and prison bunks and bodies drag it down — and a settler
 * standing in that room carries a small mood term for it. Three decisions hold
 * the whole thing up:
 *
 *  - **It is per room, not per cell.** Rooms already exist for temperature, and a
 *    room is the unit a player already thinks in ("the bunkhouse", "the larder").
 *    A per-cell falloff would be more faithful and would give the player nothing
 *    they could act on.
 *  - **It is an average, not a total.** Otherwise the way to a beautiful colony
 *    is one enormous hall with forty lamps in it. Dividing by room size means
 *    decorating a bigger space costs proportionally more, which is the actual
 *    trade a player should be making.
 *  - **Outdoors scores nothing at all.** Not zero-as-in-neutral by accident —
 *    zero on purpose. A settler who walks into a field must not be charged for
 *    the field being undecorated, and the outdoors is not a thing you furnish.
 *
 * The mood term is deliberately small: about a third of what an empty stomach
 * costs at its worst. A beautiful colony is a colony that holds together a little
 * longer under the same pressure. It is not a colony that survives a famine.
 */

import { roomAt, type Room } from './rooms';
import { unburiedDead } from './graves';
import type { BuildingKind, Pawn, Terrain, World } from './types';
import { terrainAt } from './types';

/**
 * What each kind of building does to the room it stands in.
 *
 * A table, not a field on `BuildingDef`, for the same reason `power.ts` keeps
 * `DRAW` here rather than there: beauty is one system's opinion about buildings,
 * and twenty-odd defs should not each carry a zero for it. Anything absent is
 * worth nothing either way, which is the right default — most things are.
 */
export const BEAUTY: Partial<Record<BuildingKind, number>> = {
  // The only thing in the game whose entire job is this.
  statue: 26,
  // Somewhere to sit down and eat like a person.
  table: 6,
  // A board with the pieces still out. Worth a little more than the dining
  // table it sits beside, because a room somebody chose to spend an evening in
  // looks like one.
  gametable: 7,
  // Light you chose to put there rather than light you needed.
  lamp: 3,
  bed: 1,
  // A hospital bed is a good thing to own and a grim thing to look at.
  medbed: -1,
  // Working machinery. None of it is ugly on purpose; it is just not for you.
  stove: -1,
  bench: -1,
  lab: -1,
  generator: -3,
  battery: -2,
  cooler: -2,
  heater: -1,
  // Defences indoors read as a colony expecting to be shot at in its own kitchen.
  turret: -4,
  sandbag: -3,
  trap: -4,
  // A cell is a cell.
  prisonbed: -5,
  // A grave under your own roof. Outdoors this never comes up: the graveyard is
  // not in a room, so it is not in anybody's score.
  grave: -8,
};

/** What a laid floor is worth per cell. Bare ground is worth nothing. */
export const FLOOR_BEAUTY: Partial<Record<Terrain, number>> = {
  plank: 0.35,
  paved: 0.15,
  // Bridges are left off deliberately rather than forgotten. This score is only
  // ever read for the cells of an enclosed room, and a room is four walls — which
  // cannot be raised on water, which is the only place a bridge can go.
};

/**
 * A body on the floor of a room you live in.
 *
 * Larger than anything else on the list, and it should be: `graves.ts` already
 * charges the whole colony for a corpse lying anywhere at all, and this is the
 * extra for it lying *in here*.
 */
export const CORPSE_BEAUTY = -14;

/** Score at which a room stops being somewhere you merely sleep. */
export const BEAUTY_GOOD = 6;

/**
 * Where the mood term saturates, in either direction.
 *
 * Scores run roughly −20 (a bunkhouse with a body in it) to +20 (a floored hall
 * with statues), so the clamp is at the edge of what a player can actually build
 * rather than an arbitrary ceiling.
 */
export const BEAUTY_SCALE = 20;

/**
 * The most a room can lift or sink a settler. About a third of what going hungry
 * costs, and the same order as the friends they have — the three small
 * background terms are meant to be comparable to each other and small next to
 * the needs.
 */
export const BEAUTY_MOOD = 0.06;

/** Ticks between passes. Rooms change slowly; opinions about them change slower. */
export const BEAUTY_INTERVAL = 20;

/**
 * The beauty of one room, as an average over its floor.
 *
 * Scaled by `BEAUTY_SCALE / size` rather than plain `1 / size` so the number that
 * comes out is on a human scale — a single statue in a nine-cell bedroom reads
 * as a large number because it is a large gesture in a small room.
 */
export function roomBeauty(world: World, room: Room): number {
  if (room.size <= 0) return 0;
  let total = 0;

  for (const b of world.buildings) {
    if (!b.built) continue;
    const v = BEAUTY[b.kind];
    if (v === undefined) continue;
    if (roomAt(world, b.x, b.y)?.id !== room.id) continue;
    total += v;
  }

  // The floor, cell by cell. This is the one term a player can spend an
  // afternoon on and see move, which is why boards are worth more than paving:
  // paving is the floor you lay for the walking speed.
  for (const packed of room.cells) {
    const x = packed % world.width;
    const y = (packed - x) / world.width;
    const v = FLOOR_BEAUTY[terrainAt(world, x, y)];
    if (v !== undefined) total += v;
  }

  for (const body of unburiedDead(world)) {
    if (roomAt(world, Math.round(body.x), Math.round(body.y))?.id !== room.id) continue;
    total += CORPSE_BEAUTY;
  }

  return (total * BEAUTY_SCALE) / room.size;
}

/** What the inspector calls a score. Five words, because a number is not a feeling. */
export function beautyLabel(score: number): string {
  if (score <= -8) return 'grim';
  if (score <= -2) return 'bleak';
  if (score < 2) return 'plain';
  if (score < BEAUTY_GOOD) return 'tidy';
  if (score < 14) return 'handsome';
  return 'beautiful';
}

/** The mood a room of this beauty is worth, clamped both ways. */
export function beautyMood(score: number): number {
  const t = Math.max(-1, Math.min(1, score / BEAUTY_SCALE));
  return t * BEAUTY_MOOD;
}

/**
 * Write `roomMood` for everybody standing somewhere.
 *
 * Scores are computed once per room per pass rather than once per settler,
 * because four settlers in the same bunkhouse have the same opinion of it and
 * `roomBeauty` walks every building in the world to find out.
 */
export function tickBeauty(world: World): void {
  if (world.tick % BEAUTY_INTERVAL !== 0) return;
  const scores = new Map<number, number>();
  for (const p of world.pawns) {
    if (p.faction !== 'colony' || p.dead) continue;
    const room = roomAt(world, Math.round(p.x), Math.round(p.y));
    if (!room) {
      p.roomMood = 0;
      continue;
    }
    let score = scores.get(room.id);
    if (score === undefined) {
      score = roomBeauty(world, room);
      scores.set(room.id, score);
    }
    p.roomMood = beautyMood(score);
  }
}

/** The room a settler is in and what it is worth, for the details panel. */
export function surroundings(
  world: World,
  pawn: Pawn,
): { room: Room; score: number; label: string } | null {
  const room = roomAt(world, Math.round(pawn.x), Math.round(pawn.y));
  if (!room) return null;
  const score = roomBeauty(world, room);
  return { room, score, label: beautyLabel(score) };
}
