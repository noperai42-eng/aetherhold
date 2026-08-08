/**
 * The thing that eats the herd.
 *
 * Until now every animal on the map was food and nothing else: a mossback stood
 * in a pen until somebody wanted it, and the only risk of keeping livestock was
 * the grass it did not need. A pen was a food supply with no downside, which is
 * the same as a food supply with no decision in it.
 *
 * A fenwolf pack is the downside. It is not a raid — it never comes for your
 * settlers, and drafting everybody in the doorway answers nothing, because what
 * it wants is standing out in the yard. Three rules, and each of them is a rule
 * about *not* being the raid beat:
 *
 * 1. **It hunts animals, not people.** A wolf walks past a settler without
 *    looking at them. It is minding the pen. That is the whole of what makes it
 *    a different problem from the thornback that crashes out of the woods, and
 *    it is why a colony answers it with hunters and not with a wall.
 * 2. **It eats what it kills.** No meat and no hide on the ground where a wolf
 *    brought something down — otherwise a pack in the yard is thirty-four free
 *    food a night and the player's correct move is to leave them to it.
 * 3. **It moves on.** A pack that stayed forever would grind the map's wildlife
 *    to nothing and then be a permanent tax with no beat to it. They hunt for
 *    about a day and a half and then walk off the far edge, and what they got in
 *    that time is the price of not having noticed.
 *
 * This module is deliberately free of the species table, the same way `pets.ts`
 * and `livestock.ts` are: it knows about *hunger* and nothing about fenwolves, so
 * `wildlife.ts` — which owns the speeds and the shapes — can import it without
 * the two ever pointing at each other. A predator is anything with `hunts` set,
 * which is one field a spawner writes and everything downstream reads.
 */

import { dist, nearestWalkable } from './grid';
import { inPen } from './livestock';
import { isPet, petName } from './pets';
import { TICKS_PER_DAY, type Pawn, type World } from './types';
import { msg } from './world';

/** How far a hungry wolf will look for something worth chasing. */
export const HUNT_REACH = 26;
/**
 * How much nearer a tame animal reads than a wild one of the same distance.
 *
 * A wolf prefers the pen, and it should: penned animals are slow, they are
 * standing still, and they are the reason the pack came down. This is the number
 * that makes losing livestock the thing that happens rather than a coincidence.
 */
export const PEN_PULL = 0.55;
/** Close enough to get its teeth in. */
export const BITE_REACH = 1.2;
/** Ticks between re-aims at a running animal. Tighter than a pet's heel: prey jinks. */
export const CHASE_REPATH = 8;
/** Ticks between bites, so a kill is a struggle rather than a subtraction. */
export const BITE_INTERVAL = 12;
/** Damage a bite does. A hare goes in one, a mossback in four and a long chase. */
export const BITE_DAMAGE = 16;
/** How long a wolf leaves the herd alone after a meal. */
export const GORGE_TICKS = Math.round(TICKS_PER_DAY * 0.55);
/** How close a wolf gets before an animal minds it — people are minded at `wary`. */
export const PREY_ALARM = 7;
/** A wolf this near a settler is marked for the hunters without anybody clicking. */
export const ALARM_RADIUS = 15;
/** How long a pack hunts this valley before it moves on. */
export const PACK_STAY = Math.round(TICKS_PER_DAY * 1.5);
/**
 * How many come down, at the smallest.
 *
 * Three, and the floor matters more than the ceiling. One wolf is a chore — the
 * first settler with a rifle walks out and it is over, and the colony has learned
 * nothing. Three is enough that they are in two places at once and the player has
 * to pick which corner of the map to defend, which is the decision the beat is for.
 */
export const PACK_MIN = 3;
/** Spread on top of the floor, so a bad night is a bad night. */
export const PACK_SPAN = 3;

/** Anything that hunts other animals. One field, written by whatever spawned it. */
export function isHunter(p: Pawn): boolean {
  return p.hunts === true;
}

/** Full, and not interested in your goats until it is hungry again. */
export function isFed(world: World, hunter: Pawn): boolean {
  return (hunter.fed ?? 0) > world.tick;
}

/** Living predators, for the alerts panel and the tests. */
export function hunters(world: World): Pawn[] {
  return world.pawns.filter((p) => p.faction === 'fauna' && !p.dead && p.hunts === true);
}

/** The nearest hunter an animal ought to be running from, or null. */
export function nearestHunter(world: World, animal: Pawn, within: number): Pawn | null {
  let best: Pawn | null = null;
  let bestD = within;
  for (const p of world.pawns) {
    if (p.dead || p.faction !== 'fauna' || p.hunts !== true) continue;
    const d = dist(animal.x, animal.y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * What this wolf is going for, or null if it is fed, leaving, or alone on the map.
 *
 * Distance is weighted rather than filtered — a penned mossback forty cells off
 * still loses to a hare underfoot, but it beats a wild one at the same range,
 * which is what "the pack came down for the livestock" means in numbers.
 */
export function preyFor(world: World, hunter: Pawn): Pawn | null {
  if (isFed(world, hunter) || hunter.migrateTo) return null;
  let best: Pawn | null = null;
  let bestScore = HUNT_REACH;
  for (const p of world.pawns) {
    if (p.dead || p.faction !== 'fauna' || p.hunts === true || p.id === hunter.id) continue;
    const d = dist(hunter.x, hunter.y, p.x, p.y);
    if (d > HUNT_REACH) continue;
    const score = p.tame === true ? d * PEN_PULL : d;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Its teeth are in something this tick, on a stagger so a pack does not chew in unison. */
export function biteReady(world: World, hunter: Pawn, prey: Pawn): boolean {
  if (dist(hunter.x, hunter.y, prey.x, prey.y) > BITE_REACH) return false;
  return (world.tick + hunter.id) % BITE_INTERVAL === 0;
}

/**
 * The kill, from the wolf's side.
 *
 * Called once, by whoever landed the killing bite. Marks the body eaten so the
 * carcass pass leaves nothing on the grass, and puts the whole pack off its
 * hunger — they share, and a pack that took an animal each in the same minute
 * would empty the map in a night.
 */
export function feast(world: World, hunter: Pawn, prey: Pawn): void {
  prey.eaten = true;
  const at = { x: Math.round(prey.x), y: Math.round(prey.y) };
  for (const p of hunters(world)) {
    if (dist(p.x, p.y, prey.x, prey.y) <= HUNT_REACH) p.fed = world.tick + GORGE_TICKS;
  }
  hunter.fed = world.tick + GORGE_TICKS;
  // Named when it was somebody's. The whole reason a pet can be taken is that
  // this line lands differently when it has a name in it — the grief itself is
  // charged in `pets.ts`, which the carcass pass calls a tick later.
  const what = isPet(prey) ? petName(prey) : prey.name.toLowerCase();
  msg(world, `${hunter.name} has brought down ${what}.`, 'bad', { at, headline: isPet(prey) });
}

/**
 * A wolf in among the buildings gets marked for the hunters on its own.
 *
 * Deliberately automatic. A raid announces itself and drafts an answer out of the
 * player; a predator is quiet, and a colony that lost its herd because nobody was
 * looking at the right corner of the map has not been beaten, it has been missed.
 * Marking is not the same as killing it: somebody still has to be free, armed and
 * willing to walk out there, which is the decision that is left.
 */
export function tickAlarm(world: World): void {
  for (const hunter of hunters(world)) {
    if (hunter.hunted === true || hunter.migrateTo) continue;
    let seen = inPen(world, Math.round(hunter.x), Math.round(hunter.y));
    if (!seen) {
      for (const p of world.pawns) {
        if (p.faction !== 'colony' || p.dead) continue;
        if (dist(p.x, p.y, hunter.x, hunter.y) <= ALARM_RADIUS) {
          seen = true;
          break;
        }
      }
    }
    if (!seen) continue;
    hunter.hunted = true;
    msg(world, `${hunter.name} is in among the animals. The hunters are on it.`, 'threat', {
      at: { x: Math.round(hunter.x), y: Math.round(hunter.y) },
    });
  }
}

/**
 * The pack's clock. Sets the survivors walking off the map when their stay is up.
 *
 * Out the nearest edge rather than back the way it came: a wolf standing in your
 * pen at dawn is four cells from a border on some maps and forty on others, and
 * the beat that matters is that they *go*, not which treeline they use. Reuses
 * the migration machinery wholesale — `migrateTo` already means "walking off the
 * map and then gone", and a second way of leaving would be a second way to leak.
 */
export function tickPackLeaving(world: World): void {
  let leaving = 0;
  for (const hunter of hunters(world)) {
    if (hunter.migrateTo) continue;
    if ((hunter.packUntil ?? Infinity) > world.tick) continue;
    const edge = nearestEdge(world, hunter);
    if (!edge) continue;
    hunter.migrateTo = { x: edge.x, y: edge.y, until: world.tick + PACK_STAY };
    hunter.path = null;
    hunter.hunted = false;
    leaving++;
  }
  if (leaving > 0) msg(world, 'The pack gives up on the valley and moves off.', 'good');
}

/** The nearest walkable cell on the map's border, which is where "away" is. */
function nearestEdge(world: World, p: Pawn): { x: number; y: number } | null {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  const sides = [
    { x, y: 2, d: y },
    { x, y: world.height - 3, d: world.height - 3 - y },
    { x: 2, y, d: x },
    { x: world.width - 3, y, d: world.width - 3 - x },
  ].sort((a, b) => a.d - b.d);
  for (const side of sides) {
    const spot = nearestWalkable(world, side.x, side.y, 14);
    if (spot) return spot;
  }
  return null;
}
