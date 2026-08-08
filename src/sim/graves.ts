/**
 * What the colony does about its dead.
 *
 * Before this, a settler who died lay face-down where they fell for the rest of
 * the game. The colony walked around them, built over them, and forgot. That is
 * the one thing a colony sim must not let you do, and it is the natural other
 * half of `social.ts`: the point of knowing who Sorrel's friend was is the day
 * you have to carry him.
 *
 * Three rules, and they are the whole file.
 *
 * **A body left out is a standing problem, not an event.** `needs.ts` charges
 * grief once when somebody dies and lets it fade over a day. A corpse in the yard
 * is different in kind — it is still true tomorrow, and the player can *do*
 * something about it. So it is priced the way the alerts panel prices things:
 * continuously, while it is true, and it stops the moment it is fixed.
 *
 * **The fix is a building and a job, both of which already have a shape.** A
 * grave costs a little wood and holds one person; a hauler shoulders the body and
 * carries it there, which is the warden's `capture` job with a different ending.
 * Nothing new was invented to make this work.
 *
 * **A colony that never learns about graves is not punished forever.** A body
 * nobody buries rots away on its own in about four days and stops counting. That
 * is not mercy, it is bookkeeping: without it, thirty raids leave thirty corpses
 * in `world.pawns` for the renderer to draw and every pass to skip over.
 */

import { livingColonists, msg } from './world';
import { TICKS_PER_DAY, type Building, type Pawn, type World } from './types';

/** How long an unburied body lasts before there is nothing left to bury. */
export const ROT_TICKS = TICKS_PER_DAY * 4;

/** Only run the pass twice a second — nothing here changes faster than that. */
export const GRAVE_INTERVAL = 10;

/**
 * Every body still lying out in the open.
 *
 * Animals are not in here. A dead dunhare is meat, and the hunting code already
 * takes it off the map; a colony that had to bury its livestock would spend the
 * whole game digging.
 */
export function unburiedDead(world: World): Pawn[] {
  const out: Pawn[] = [];
  for (const p of world.pawns) {
    if (!p.dead || p.buried || p.faction === 'fauna') continue;
    out.push(p);
  }
  return out;
}

/**
 * Is somebody already carrying this body?
 *
 * There is no back-pointer on the corpse — the carrier owns the relationship
 * through `carryingPawnId`, exactly as the warden's capture does — so the answer
 * is a scan. It is over the pawn list, which is dozens, not thousands.
 */
export function isCarried(world: World, id: number): boolean {
  return world.pawns.some((p) => p.carryingPawnId === id);
}

/** Bodies somebody could still be sent to fetch — the ones a job can target. */
export function buriableDead(world: World): Pawn[] {
  return unburiedDead(world).filter((p) => !isCarried(world, p.id));
}

/**
 * Every grave that is built and empty.
 *
 * The plural exists because the job system has to skip the ones another hauler
 * is already walking towards, and only it knows that — a grave is not marked
 * taken until somebody is actually laid in it.
 */
export function freeGraves(world: World): Building[] {
  return world.buildings.filter(
    (b) => b.kind === 'grave' && b.built && (b.occupant === undefined || b.occupant === null),
  );
}

/** The first empty grave, for callers that only need to know whether one exists. */
export function freeGrave(world: World): Building | null {
  return freeGraves(world)[0] ?? null;
}

/** Who is in this grave, if anybody. Read by the inspector, and by nothing else. */
export function occupantOf(world: World, grave: Building): Pawn | null {
  if (grave.occupant === undefined || grave.occupant === null) return null;
  return world.pawns.find((p) => p.id === grave.occupant) ?? null;
}

/**
 * Lay somebody in the ground.
 *
 * The body stays in `world.pawns` rather than being deleted, because a grave you
 * can click and read a name off is the entire reason to build one. It is simply
 * no longer a corpse: `buried` takes it out of the count, out of the renderer's
 * prone bodies, and out of every job's search.
 */
export function bury(world: World, dead: Pawn, grave: Building): void {
  dead.buried = true;
  dead.x = grave.x;
  dead.y = grave.y;
  grave.occupant = dead.id;
  if (dead.faction === 'colony') msg(world, `${dead.name} has been laid to rest.`, 'info');
}

/**
 * Age the bodies nobody came for, and tidy up after the ones that are gone.
 *
 * A grave whose occupant somehow left the world — the only way that happens today
 * is a save edited by hand — is emptied rather than left holding a dangling id,
 * so the next body has somewhere to go.
 */
export function tickGraves(world: World): void {
  if (world.tick % GRAVE_INTERVAL !== 0) return;

  const gone: number[] = [];
  for (const p of world.pawns) {
    if (!p.dead || p.buried || p.faction === 'fauna') continue;
    if (isCarried(world, p.id)) continue; // being carried is not being left out
    p.rot = (p.rot ?? 0) + GRAVE_INTERVAL;
    if (p.rot >= ROT_TICKS) gone.push(p.id);
  }
  if (gone.length > 0) {
    const names = world.pawns.filter((p) => gone.includes(p.id) && p.faction === 'colony');
    for (const p of names) msg(world, `Nothing is left of ${p.name} to bury.`, 'bad');
    world.pawns = world.pawns.filter((p) => !gone.includes(p.id));
    // A grave that was promised to a body which then rotted away is free again.
    for (const b of world.buildings) {
      if (b.kind === 'grave' && b.occupant !== undefined && b.occupant !== null && gone.includes(b.occupant)) {
        b.occupant = null;
      }
    }
  }

  for (const b of world.buildings) {
    if (b.kind !== 'grave' || b.occupant === undefined || b.occupant === null) continue;
    if (!world.pawns.some((p) => p.id === b.occupant)) b.occupant = null;
  }
}

/** True while there is a body out and somewhere to put it — the alert's condition. */
export function needsBurial(world: World): boolean {
  return unburiedDead(world).length > 0 && livingColonists(world).length > 0;
}
