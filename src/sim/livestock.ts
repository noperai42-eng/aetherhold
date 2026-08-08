/**
 * Pens — where the colony keeps the animals it did not shoot.
 *
 * Hunting is a food supply you spend: every mossback taken is one fewer on the
 * map, and the herd only walks back in on the respawn clock. Livestock is the
 * other half of that trade — coax one in instead of shooting it, put a pen round
 * it, and it becomes a supply that *grows*. Slower than a crop and dearer than a
 * bullet, which is the shape a third food loop should have.
 *
 * Two rules carry the whole thing, and both live here:
 *
 * 1. **A pen is a zone, not a fence.** Livestock stay inside the painted pen the
 *    way a crop only grows inside a growing zone. The `fence` building is a real
 *    barrier a player can raise around it, but the containment is the zone —
 *    otherwise every pen would need a gate the animals could walk straight out of,
 *    and the feature would be a pathfinding trick instead of an order.
 * 2. **A pen feeds what it has room for.** The herd stops growing at one head per
 *    `PEN_CELLS_PER_HEAD` cells, which is the whole of the carrying-capacity idea
 *    without giving animals a hunger clock of their own to starve on.
 *
 * This module knows about zones and nothing about species, so `wildlife.ts` can
 * import it without the two pointing at each other. Taming and breeding — the
 * parts that need the species table — live over there.
 */

import { dist } from './grid';
import { isPet } from './pets';
import type { Pawn, World } from './types';
import { packCell, TICKS_PER_DAY, unpackX, unpackY } from './types';

/**
 * Ticks of a handler's time to bring one animal in — about a minute at 1×.
 *
 * Dearer than sowing a cell and cheaper than a wall, because it is the same class
 * of decision as a wall: a thing you commit an afternoon to and then have forever.
 */
export const TAME_WORK = 220;

/** How close the handler has to be for the animal to settle. */
export const TAME_REACH = 1.6;

/** Cells of pen one animal needs before the herd will grow past it. */
export const PEN_CELLS_PER_HEAD = 6;

/**
 * Average ticks between births in a pen with room and a pair to breed.
 *
 * Two game days. A crop feeds the colony in three, so livestock is never the fast
 * answer to being hungry today — it is what makes next month cheaper.
 */
export const BREED_INTERVAL = 9600;

/**
 * Ticks from birth to grown: three game days.
 *
 * Longer than the breeding interval on purpose. A calf that could breed the day
 * after it was born would make a pen a compound-interest account with a cap, and
 * the only decision left would be how much pen to paint. Three days means the
 * herd you have this week is the herd you tamed, and the one you bred is next
 * week's — which is the whole reason livestock is the slow food loop.
 */
export const MATURE_TICKS = TICKS_PER_DAY * 3;

/**
 * The least a body is worth on the ground, as a fraction of the grown animal.
 *
 * A newborn is not nothing — the meat is real — but it is a quarter of a mossback
 * and the player should be able to feel that they took it too early. Anything
 * lower and slaughtering a calf becomes a mistake with no signal; anything higher
 * and there is no reason to wait.
 */
export const CALF_YIELD = 0.25;

export type Sex = 'm' | 'f';

/**
 * Which one it is. Derived from the id rather than stored or rolled.
 *
 * Rolled would have been the obvious way and is the wrong one twice over: an
 * `Rng` draw inside `spawnAnimal` would shift every seed in the game by one step
 * — worldgen spends one shared stream in order and `tests/hunting.test.ts` pins
 * the result — and a stored field would be one more thing a save from before
 * today has to be given on load. The id is already unique, already saved, and
 * already the thing pet names are drawn from, so this is the same trick a second
 * time: an id counter is a stream too.
 *
 * The mix is the standard finalizer rather than `id & 1`, because ids are handed
 * out in sequence and the low bit of a sequence is not a coin, it is stripes —
 * two animals tamed one after the other would always have been a pair, and every
 * pen in the game would have bred on the first try.
 */
export function animalSex(animal: Pawn): Sex {
  let h = animal.id | 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h & 1) === 0 ? 'f' : 'm';
}

/**
 * How grown it is: 0 the moment it is born, 1 once it is an adult.
 *
 * An animal with no birthday was already grown when the colony met it. That is
 * every wild animal on the map, every animal in a save written before today, and
 * it is not a fallback — nothing is born out on the moor in this game. The pen is
 * the only place young come from, so the pen is the only place that stamps a
 * birthday.
 */
export function maturity(world: World, animal: Pawn): number {
  if (animal.born === undefined) return 1;
  const age = world.tick - animal.born;
  if (age >= MATURE_TICKS) return 1;
  return Math.max(0, age / MATURE_TICKS);
}

/** Grown enough to breed, and to be worth the full carcass. */
export function isAdult(world: World, animal: Pawn): boolean {
  return maturity(world, animal) >= 1;
}

/** What a body is worth, as a fraction: a quarter at birth, all of it grown. */
export function bodyScale(world: World, animal: Pawn): number {
  return CALF_YIELD + (1 - CALF_YIELD) * maturity(world, animal);
}

/**
 * How long a failed search for a route stands before anybody tries again.
 *
 * One game minute. Long enough that an animal stranded across the water costs one
 * search a minute instead of one per idle settler per tick, short enough that a
 * mined-out channel or a demolished wall puts it back on the list while the player
 * still remembers marking it.
 */
export const REACH_RETRY = 1200;

/** Has a handler recently given up on finding a way to this animal? */
export function outOfReach(world: World, pawn: Pawn): boolean {
  return pawn.unreachable !== undefined && world.tick - pawn.unreachable < REACH_RETRY;
}

/** Packed cells of every pen zone, in zone order. */
export function penCells(world: World): number[] {
  const out: number[] = [];
  for (const z of world.zones) {
    if (z.kind !== 'pen') continue;
    for (const c of z.cells) out.push(c);
  }
  return out;
}

export function hasPen(world: World): boolean {
  for (const z of world.zones) if (z.kind === 'pen' && z.cells.length > 0) return true;
  return false;
}

export function inPen(world: World, x: number, y: number): boolean {
  const c = packCell(world, Math.round(x), Math.round(y));
  for (const z of world.zones) {
    if (z.kind !== 'pen') continue;
    if (z.cells.includes(c)) return true;
  }
  return false;
}

/** The colony's animals: tame, alive, wherever they happen to be standing. */
export function livestock(world: World): Pawn[] {
  return world.pawns.filter((p) => p.faction === 'fauna' && !p.dead && p.tame === true);
}

/**
 * An animal a handler can still go and work on.
 *
 * A pen has to exist first. Taming an animal with nowhere to put it would leave
 * it wandering the map as somebody else's problem, and the player would have no
 * way to tell it from the wild ones except by clicking each in turn.
 *
 * And a bolting animal is not one either. The tame job already drops the moment
 * the beast takes fright, but the handler used to be handed the same animal
 * again on the very next assignment sweep — a job created and thrown away every
 * few ticks for as long as the fright lasted, with the settler standing there
 * doing nothing in between. "Frightened" has to mean the same thing to the
 * scheduler as it does to the job.
 */
export function isTameable(world: World, pawn: Pawn): boolean {
  return (
    pawn.faction === 'fauna' &&
    !pawn.dead &&
    pawn.tame !== true &&
    pawn.tameTarget === true &&
    (pawn.fleeUntil ?? 0) <= world.tick &&
    hasPen(world) &&
    !outOfReach(world, pawn)
  );
}

/**
 * Where a strayed animal should be pulled back towards, or null if it is fine.
 *
 * Only tame animals are leashed, and only when a pen exists — livestock kept
 * before the player has painted anywhere to keep them simply graze free, which is
 * a strange colony but not a broken one.
 */
export function penTarget(world: World, animal: Pawn): { x: number; y: number } | null {
  if (animal.tame !== true) return null;
  // Somebody's, and so not the pen's. A bonded animal follows its person around
  // the map; leashing it as well would mean a pet that walked out of the base
  // behind its keeper and then turned round and walked home without them, which
  // reads as the follow being broken. See `pets.ts`.
  if (isPet(animal)) return null;
  // An animal walking home at 1.3× its own pace is one a butcher on foot closes on
  // at a crawl, and the slaughter turns into a week-long walk across the map. One
  // marked for the table is not going back to the pen anyway.
  if (animal.hunted === true) return null;
  const cells = penCells(world);
  if (cells.length === 0) return null;
  if (inPen(world, animal.x, animal.y)) return null;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const c of cells) {
    const x = unpackX(world, c);
    const y = unpackY(world, c);
    const d = dist(animal.x, animal.y, x, y);
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

/** How many head the painted pen can carry. */
export function penCapacity(world: World): number {
  return Math.floor(penCells(world).length / PEN_CELLS_PER_HEAD);
}
