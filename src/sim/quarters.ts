/**
 * Who has a room of their own.
 *
 * The colony could already build beds, and it built them all in the same place:
 * every settler in one hall, for the whole game. That is a barracks, and a
 * barracks is what a colony sleeps in on the way to somewhere — it is not the
 * place people are trying to make. This module is the difference between a
 * shelter with eight bunks in it and eight people who live somewhere.
 *
 * The whole idea is one sentence: **a room with exactly one bed in it belongs to
 * whoever sleeps in that bed.** Nothing is declared, nothing is assigned by the
 * player, and there is no new building — a bedroom is an ordinary room that
 * happens to contain one ordinary bed. Wall off a corner of the bunkhouse and
 * you have made somebody a bedroom; drag a second bed into it and you have taken
 * it away again. That is a rule a player can be told once and then predict, and
 * it costs the save format one number.
 *
 * Three things follow, and they are the file:
 *
 *  - **Ownership is derived, not remembered.** The owner is stored so a settler
 *    keeps the same room night after night rather than shuffling, but every pass
 *    re-checks it: an owner who died, a bed that burned down, or a second bed
 *    carried in all release the claim. Nothing can end up owning a room that is
 *    no longer a room.
 *  - **Not having one is a small, standing complaint.** It is deliberately the
 *    size of `socialMood` and not the size of hunger — a colonist in a bunkhouse
 *    is grumbling, not dying, and a colony that never gets past bunks should
 *    still be a colony. See `MOOD_NO_PRIVACY`.
 *  - **Sleeping in the open is a different thing entirely and is not in here.**
 *    That is not a comfort problem, it is a colony failing to shelter its
 *    people, and it is priced in health rather than mood — see `tickGroundSleep`
 *    in jobs.ts.
 *
 * The Steward's `quarters` ambition is what actually builds the rooms; this
 * module only answers who lives where.
 */

import { isBed } from './buildings';
import { buildingAt } from './grid';
import { canPlace } from './orders';
import { roomAt, roomIndex } from './rooms';
import { livingColonists } from './world';
import type { Building, Pawn, World } from './types';

/**
 * What a bunkhouse costs a settler who wants a door of their own.
 *
 * The same size as having a friend in the room, and for the same reason: it is
 * a fact about how somebody feels rather than a fact about whether they live.
 * Big enough that a player watching the mood card sees the colony asking for
 * bedrooms; small enough that eight people in a hall is a colony with a problem
 * to solve rather than a colony on its way down.
 */
export const MOOD_NO_PRIVACY = -0.05;

/**
 * Largest room the colony will treat as somebody's quarters rather than a hall.
 *
 * A bunkhouse room is six cells. The slack is for a room the player walled
 * themselves — a closet, a porch, a corner of the barn — which should get a bed
 * and become somebody's if it is the right size for one. Past this it is a space
 * with a purpose of its own, and dropping a bunk in the middle of it is vandalism.
 */
export const QUARTERS_MAX_CELLS = 12;

/** Only run the pass twice a second — nobody moves house faster than that. */
export const QUARTERS_INTERVAL = 30;

/**
 * Beds that make a room somebody's own.
 *
 * A hospital cot and a prison bunk are excluded on purpose. Both of them live in
 * rooms that are emphatically *not* private — a ward with one cot in it is still
 * a ward, and a cell somebody is locked in is not a bedroom however few bunks it
 * holds — and counting them would hand a settler a claim on the sickbay.
 */
function isOwnable(b: Building): boolean {
  return b.kind === 'bed' && b.built;
}

/**
 * Every bed that stands alone in an enclosed room.
 *
 * Alone means alone against *all* beds, hospital and prison included: a cot
 * wheeled in beside somebody's bunk has made the room a two-bed room, and the
 * privacy is gone whatever the second bed is for.
 */
export function privateBeds(world: World): Building[] {
  const idx = roomIndex(world);
  const beds = new Map<number, Building[]>();
  for (const b of world.buildings) {
    if (!b.built || !isBed(b.kind)) continue;
    const id = idx.cellRoom[b.y * world.width + b.x];
    if (id === undefined || id < 0) continue;
    const list = beds.get(id);
    if (list) list.push(b);
    else beds.set(id, [b]);
  }
  const out: Building[] = [];
  for (const list of beds.values()) {
    if (list.length !== 1) continue;
    const only = list[0]!;
    if (isOwnable(only)) out.push(only);
  }
  return out;
}

/** The bed this settler has claimed, if the claim is still good. */
export function ownedBed(world: World, pawn: Pawn): Building | null {
  return world.buildings.find((b) => b.ownerId === pawn.id && isOwnable(b)) ?? null;
}

/** Does this settler have a room with a door and their own bed in it? */
export function hasPrivacy(world: World, pawn: Pawn): boolean {
  const bed = ownedBed(world, pawn);
  if (!bed) return false;
  return roomAt(world, bed.x, bed.y) !== null;
}

/** Settlers with nowhere of their own — what the Steward builds the next room for. */
export function unhoused(world: World): Pawn[] {
  return livingColonists(world).filter((p) => !hasPrivacy(world, p));
}

/**
 * Match settlers to rooms, and tell everybody how they feel about it.
 *
 * Claims are released before they are handed out, so a bed that stopped being
 * private this pass is available to nobody rather than still counting for its
 * old owner. Unhoused settlers are served in id order, which is arbitrary but
 * stable — the alternative is a colony that reshuffles its bedrooms every time
 * two people are equally roomless.
 */
export function tickQuarters(world: World): void {
  if (world.tick % QUARTERS_INTERVAL !== 0) return;

  const beds = privateBeds(world);
  const priv = new Set(beds.map((b) => b.id));
  const alive = new Set(livingColonists(world).map((p) => p.id));

  // Release anything that is no longer a private bed, or whose owner is gone.
  for (const b of world.buildings) {
    if (b.ownerId === undefined) continue;
    if (!priv.has(b.id) || !alive.has(b.ownerId)) b.ownerId = undefined;
  }

  // One settler cannot hold two rooms — the second claim wins nothing and would
  // leave a bed nobody could ever be given.
  const housed = new Set<number>();
  for (const b of beds) {
    if (b.ownerId !== undefined) {
      if (housed.has(b.ownerId)) b.ownerId = undefined;
      else housed.add(b.ownerId);
    }
  }

  const waiting = livingColonists(world)
    .filter((p) => !housed.has(p.id))
    .sort((a, b) => a.id - b.id);
  let next = 0;
  for (const b of beds) {
    if (b.ownerId !== undefined) continue;
    const p = waiting[next++];
    if (!p) break;
    b.ownerId = p.id;
    housed.add(p.id);
  }

  // Nobody is charged for the shared hall until somebody is *out* of it.
  //
  // A founding party sleeps in one room and that is not a failure — the colony
  // starts with every bunk in the main building on purpose, and the thing that
  // matters is a roof, not a door. What makes the hall worth leaving is a
  // neighbour who has left it: the want arrives the day the first room does.
  //
  // Charged from tick zero instead, this was -0.05 on the whole colony from the
  // founding, before a room was buildable at all. That is a mood the player
  // cannot answer, and it is not free: measured on seed 20260729 the colony
  // worked slowly enough gloomy to send somebody out after a deer inside the
  // first week, which nothing in an ordinary week used to do.
  const anyRooms = beds.length > 0;
  for (const p of livingColonists(world)) {
    p.privacyMood = housed.has(p.id) || !anyRooms ? 0 : MOOD_NO_PRIVACY;
  }
}

/**
 * Bunks standing in a room with another bunk — the hall, whatever it is called.
 *
 * Defined by the company they keep rather than by being in `heart(world)`, and
 * that is not just to dodge an import cycle. What makes a bed a *spare* is that
 * taking it away leaves the room it came from still a room people sleep in and
 * still nobody's in particular. A bed alone in a room is somebody's bedroom by
 * this module's one rule, and carrying it off would be evicting them.
 */
export function sharedBunks(world: World): Building[] {
  const idx = roomIndex(world);
  const byRoom = new Map<number, Building[]>();
  for (const b of world.buildings) {
    if (!b.built || !isBed(b.kind)) continue;
    const id = idx.cellRoom[b.y * world.width + b.x];
    if (id === undefined || id < 0) continue;
    const list = byRoom.get(id);
    if (list) list.push(b);
    else byRoom.set(id, [b]);
  }
  const out: Building[] = [];
  for (const list of byRoom.values()) {
    if (list.length < 2) continue;
    for (const b of list) if (isOwnable(b)) out.push(b);
  }
  return out;
}

/**
 * Is this cell a finished room waiting for its bed?
 *
 * The question a settler asks on arrival, and the same one the colony asked
 * when it sent them — a room can be given a bed by somebody else, or walled in,
 * or stop being a room at all, while a bunk is being carried across the yard.
 */
export function bedlessTarget(world: World, x: number, y: number): boolean {
  const idx = roomIndex(world);
  const id = idx.cellRoom[y * world.width + x];
  if (id === undefined || id < 0) return false;
  const room = idx.rooms.get(id);
  if (!room || room.size > QUARTERS_MAX_CELLS) return false;
  for (const b of world.buildings) {
    if (!b.built || !isBed(b.kind)) continue;
    if (idx.cellRoom[b.y * world.width + b.x] === id) return false;
  }
  return canPlace(world, 'bed', x, y) === 'ok';
}

/**
 * Every empty room that is the right size to be somebody's, and where the bed
 * would go in it.
 *
 * Against a wall, like the hall's own bunks, so the doorway stays walkable — a
 * six-cell room with a bed in the middle of it is a room you cannot cross.
 */
export function emptyQuarters(world: World): { x: number; y: number }[] {
  const idx = roomIndex(world);
  const out: { x: number; y: number }[] = [];
  for (const room of idx.rooms.values()) {
    if (room.size > QUARTERS_MAX_CELLS) continue;
    let spot: { x: number; y: number } | null = null;
    let taken = false;
    for (const packed of room.cells) {
      const x = packed % world.width;
      const y = (packed - x) / world.width;
      // `buildingAt` and not a scan of `world.buildings`: this runs per cell of
      // per room, and a linear find inside it made the whole thing quadratic in
      // the size of the compound — measured at 11 % on the colony-eval suite,
      // on the one file that already sits nearest the timeout.
      const b = buildingAt(world, x, y);
      if (b && b.built && isBed(b.kind)) {
        taken = true;
        break;
      }
      if (!spot && canPlace(world, 'bed', x, y) === 'ok') spot = { x, y };
    }
    if (!taken && spot) out.push(spot);
  }
  return out;
}
