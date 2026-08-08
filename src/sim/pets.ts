/**
 * Bonded animals — the one a settler keeps, rather than the one the colony eats.
 *
 * Taming already existed and it produced livestock: a numbered goat that stands
 * in a painted rectangle and is worth so much wool a week. That is a supply line,
 * and a supply line is not a relationship. `husbandry.ts` says as much in its own
 * first paragraph — the only thing a tame animal was ever *for* was being
 * harvested. So a colony could spend two days coaxing a mossback out of the herd
 * and end up with a slightly slower crop.
 *
 * A bond is the other thing an animal can be. Three rules carry it:
 *
 * 1. **The handler keeps what they tame.** No dice. A settler who has no animal
 *    of their own bonds with the next one they bring in, every time. Hiding a
 *    delight behind a 45% roll makes it something that happens *to* the player
 *    instead of something they can go and do, and this is a game a thirteen year
 *    old is meant to be able to aim at.
 * 2. **A bonded animal is not livestock.** It gets a name, it walks at its
 *    person's heel wherever they go instead of being leashed to the pen, and
 *    nobody may mark it for the table. Which is the cost: bonding an animal is
 *    giving up the meat on it, decided in advance, once.
 * 3. **It is felt when it goes.** Its keeper takes real grief — the animal's own
 *    line in the message log and a line in the life they are remembered by — and
 *    the body is not butchered. Nobody is eating somebody's companion.
 *
 * ## What this module deliberately does not know
 *
 * Species. Not one line here reads the animal table, exactly as `livestock.ts`
 * knows about zones and nothing about species, and for the same reason: the
 * movement chain lives in `wildlife.ts`, `wildlife.ts` has to import the heel
 * target from here, and two modules pointing at each other is a cycle. So the pet
 * name is stored *beside* `Pawn.name` rather than over it — see `petName` — and
 * anything that wants "mossback" asks `animalDef` where it always did.
 */

import { dist } from './grid';
import { remember, rememberFirst } from './lifelog';
import { WALK_SPEED } from './movement';
import { nudgeMood } from './needs';
import type { Pawn, World } from './types';
import { msg } from './world';

/**
 * How close a pet keeps. Inside this ring it stops walking and mooches.
 *
 * A little over two cells: near enough to read as "with them" from the isometric
 * camera, far enough that it is not permanently shouldering its keeper out of
 * doorways. Bodies are `BODY_RADIUS` 0.34 apiece, so this is never a collision.
 */
export const PET_HEEL = 2.2;

/**
 * Slowest a pet ever moves while catching up, whatever species it is.
 *
 * A mossback grazes at 0.42× a settler's walk and a dunhare at 0.72×, so a pet
 * that simply moved at its own pace could not follow anybody anywhere — it would
 * fall behind on the first errand and spend the rest of the game as a dot on the
 * far side of the map. A pet is an animal that has decided to keep up.
 */
export const PET_TROT = WALK_SPEED * 1.15;

/** A pet moves at this multiple of its species pace, or `PET_TROT`, whichever is more. */
export const PET_EAGERNESS = 1.6;

/**
 * Beyond this many cells from its keeper a pet breaks into a bound.
 *
 * `PET_TROT` beats a walk and loses to a run, which is the right shape — a dog
 * falls behind a sprint — but only if losing is temporary. Without the bound, a
 * player who runs everywhere in first person leaves their pet permanently over
 * the horizon, and the feature becomes an animal they used to have.
 */
export const PET_STRETCH = 7;

/** How much faster the bound is than the trot. */
export const PET_CATCHUP = 1.9;

/**
 * Ticks between a pet re-finding the route to its person.
 *
 * Half a second. The keeper is walking the whole time, so a route found once goes
 * stale immediately — but re-pathing every tick would be an A* per pet per tick
 * for something nobody would be able to see. Staggered by the animal's own id at
 * the call site so a colony full of pets does not spend them all on one tick.
 */
export const PET_REPATH = 10;

/** What having a companion alive is worth on the mood scale, every tick, for free. */
export const PET_MOOD = 0.07;

/**
 * What losing one costs.
 *
 * Smaller than a person and not by much, and — unlike a death in the colony —
 * spent entirely on one settler. Everybody grieves a settler; only their person
 * grieves an animal, which is what makes it *theirs* rather than a second colony
 * event with a smaller number attached.
 */
export const PET_GRIEF = -0.22;

/** What letting one go costs. Real, and a tenth of losing it: they chose this. */
export const PET_RELEASE = -0.03;

/**
 * Names a bonded animal can end up with.
 *
 * Short, sayable, and pointedly not fantasy — the joke of a mossback called Biscuit
 * is the whole tone of the feature. Never drawn from a random stream: see
 * `nameFor`.
 */
export const PET_NAMES = [
  'Pip', 'Biscuit', 'Rusty', 'Moss', 'Bramble', 'Tuck', 'Nettle', 'Sixpence',
  'Clover', 'Ash', 'Pebble', 'Marrow', 'Fig', 'Dusty', 'Wren', 'Kettle',
  'Sorrel', 'Bodkin', 'Thistle', 'Pudding', 'Hob', 'Juniper', 'Scrap', 'Tallow',
];

/** Is this animal somebody's, rather than the colony's? */
export function isPet(animal: Pawn): boolean {
  return animal.bondedTo !== undefined;
}

/** What to call it: its own name if it has one, else whatever the species is called. */
export function petName(animal: Pawn): string {
  return animal.petName ?? animal.name;
}

/** The animal this settler keeps, alive, or null. */
export function petOf(world: World, keeper: Pawn): Pawn | null {
  for (const p of world.pawns) {
    if (p.bondedTo === keeper.id && !p.dead) return p;
  }
  return null;
}

/** The settler this animal belongs to, alive, or null for a bond that has outlived one. */
export function keeperOf(world: World, animal: Pawn): Pawn | null {
  if (animal.bondedTo === undefined) return null;
  for (const p of world.pawns) {
    if (p.id === animal.bondedTo) return p.dead ? null : p;
  }
  return null;
}

/**
 * A name nothing else in the colony is already using.
 *
 * Derived from the animal's own id rather than drawn from a stream, for the same
 * reason the Pickies number themselves: every `rng` in this game is shared, and an
 * animal being christened must not move the weather. The walk forward on a clash
 * keeps two mossbacks from both being Biscuit, which reads as a bug the moment the
 * player has two.
 */
function nameFor(world: World, animal: Pawn): string {
  const taken = new Set<string>();
  for (const p of world.pawns) {
    if (p.petName) taken.add(p.petName);
    else if (p.faction === 'colony') taken.add(p.name);
  }
  const start = (Math.imul(animal.id, 2654435761) >>> 8) % PET_NAMES.length;
  for (let i = 0; i < PET_NAMES.length; i++) {
    const name = PET_NAMES[(start + i) % PET_NAMES.length]!;
    if (!taken.has(name)) return name;
  }
  // Twenty-four pets and twenty-four names: number the twenty-fifth rather than
  // hand it a duplicate. A colony this far in has earned the joke.
  return `${PET_NAMES[start]!} II`;
}

/**
 * This settler keeps this animal now.
 *
 * Called the instant a tame job finishes, from the job itself, so the bond is the
 * handler's and not "whoever happened to be nearest when the sweep ran". Returns
 * false — and changes nothing — when either side is already spoken for, which is
 * the rule that keeps a bond to one apiece rather than one settler collecting a
 * menagerie while everybody else works.
 */
export function bondPet(world: World, keeper: Pawn, animal: Pawn): boolean {
  if (keeper.faction !== 'colony' || keeper.dead) return false;
  if (animal.faction !== 'fauna' || animal.dead || animal.tame !== true) return false;
  if (isPet(animal) || petOf(world, keeper)) return false;

  animal.bondedTo = keeper.id;
  animal.petName = nameFor(world, animal);
  // Marked for the table before it was ever anybody's: called off, because the
  // rule below is that nobody may mark a pet, and a mark that survived bonding
  // would be the one hunt order the player could not cancel.
  animal.hunted = false;
  // Not the pen's problem any more. Clearing the route it was walking home stops
  // it finishing that trip before it notices it has somebody to follow.
  animal.path = null;
  msg(
    world,
    `${animal.name} takes to ${keeper.name} — it is ${animal.petName} now, and it follows them.`,
    'good',
    { at: { x: Math.round(animal.x), y: Math.round(animal.y) } },
  );
  remember(world, keeper, `tamed ${animal.petName}`);
  return true;
}

/**
 * The player gives one back to the herd.
 *
 * Bonding is otherwise a one-way door — a pet cannot be slaughtered, cannot be
 * un-tamed and outlives most of the things the player built on the day they got
 * it — and a one-way door with no handle on it is a trap rather than a decision.
 * It costs a little, because it should.
 */
export function releasePet(world: World, animal: Pawn): boolean {
  if (!isPet(animal)) return false;
  const keeper = keeperOf(world, animal);
  const name = petName(animal);
  animal.bondedTo = undefined;
  animal.petName = undefined;
  animal.path = null;
  if (keeper) {
    nudgeMood(keeper, PET_RELEASE);
    msg(world, `${keeper.name} lets ${name} go. It drifts back to the herd.`, 'info');
  } else {
    msg(world, `${name} drifts back to the herd.`, 'info');
  }
  return true;
}

/**
 * Its person is dead, so it is nobody's.
 *
 * Said out loud rather than cleared quietly: a pet that silently reverted to
 * livestock the day its keeper was buried would be the one part of the loss the
 * player never saw happen.
 */
function orphan(world: World, animal: Pawn): void {
  const name = petName(animal);
  animal.bondedTo = undefined;
  animal.petName = undefined;
  animal.path = null;
  msg(world, `${name} has nobody to follow now. It goes back to the herd.`, 'bad');
}

/**
 * Its keeper's grief, spent once, at the moment the body hits the grass.
 *
 * Called from the wildlife pass rather than found later by a sweep, because the
 * carcass is removed from the world on the same tick it is noticed — a tick later
 * there is no animal left to name, and "somebody's pet died" with no name in it is
 * not a thing worth saying.
 */
export function mournPet(world: World, animal: Pawn): void {
  const name = petName(animal);
  const keeper = keeperOf(world, animal);
  animal.bondedTo = undefined;
  animal.petName = undefined;
  if (!keeper) {
    msg(world, `${name} is dead.`, 'bad');
    return;
  }
  nudgeMood(keeper, PET_GRIEF);
  msg(world, `${name} is dead. ${keeper.name} sits with the body a long while.`, 'bad', {
    at: { x: Math.round(animal.x), y: Math.round(animal.y) },
    headline: true,
  });
  rememberFirst(world, keeper, 'lost ', `lost ${name}`);
}

/**
 * Where a pet should be heading right now, or null to let it mooch.
 *
 * Returns the keeper's own position, not a spot beside them: the heel ring is
 * enforced by the caller refusing to close the last two cells, which is what stops
 * a pet oscillating across its person every tick the way a naive "walk to them"
 * does. `wildlife.ts` owns the actual step, because the step needs the species
 * pace and this module does not know about species.
 */
export function petHeel(world: World, animal: Pawn): { x: number; y: number } | null {
  const keeper = keeperOf(world, animal);
  if (!keeper) return null;
  if (dist(animal.x, animal.y, keeper.x, keeper.y) <= PET_HEEL) return null;
  return { x: keeper.x, y: keeper.y };
}

/** How fast a pet closes ground on its person, given its own grazing pace. */
export function petPace(speciesSpeed: number, away: number): number {
  const trot = Math.max(speciesSpeed * PET_EAGERNESS, PET_TROT);
  return away > PET_STRETCH ? trot * PET_CATCHUP : trot;
}

/**
 * Keep every bond honest, and price the ones that are holding.
 *
 * Runs after the wildlife pass — so a pet that died this tick has already been
 * mourned and removed — and before `tickNeeds`, which is where `petMood` is folded
 * into the mood the player actually sees. Both halves of that ordering matter and
 * both live in `tick.ts`.
 */
export function tickPets(world: World): void {
  for (const animal of world.pawns) {
    if (animal.bondedTo === undefined) continue;
    // Dead, buried, or never there: the bond outlived the person on the other end
    // of it. Covers a keeper lost to a raid, to illness, or to a save loaded from
    // a colony that has since buried them.
    if (!keeperOf(world, animal)) orphan(world, animal);
  }
  for (const p of world.pawns) {
    if (p.faction !== 'colony' || p.dead) continue;
    // Written every tick, including the zero: `computeMood` reads the field
    // directly, so a settler whose pet died yesterday must be actively told the
    // bonus is gone rather than left holding the last value it was given.
    p.petMood = petOf(world, p) ? PET_MOOD : 0;
  }
}
