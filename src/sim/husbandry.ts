/**
 * What the herd gives you for keeping it alive.
 *
 * Taming, pens and breeding all shipped before this, and together they had a
 * hole in the middle: the only thing a tame animal was ever *for* was being
 * killed later. A pen cost a zone, a fence, and a handler's afternoon, and paid
 * out exactly what a hunter's bullet paid out, later. So nobody built one twice.
 *
 * This is the other side of that ledger. A penned animal ripens on a clock and a
 * hand goes out and collects — milk off a mossback, down off the dunhares — and
 * the animal is still standing afterwards. That turns the pen into the thing it
 * was always drawn as: the slow, safe, renewable version of hunting.
 *
 * ## Why it pays out in food and hide rather than in something new
 *
 * There are six resources in the game and every one of them is plumbed into
 * stockpiles, hauling, trade prices, the pantry, spoilage and the resource
 * readout. A seventh — "milk", "wool" — would be a week of plumbing for a
 * material whose only use would be a recipe written to consume it.
 *
 * Paying out `rawfood` and `hide` instead makes the pen a *strategic* answer
 * rather than a parallel one. Hides are the wardrobe's bottleneck and the whole
 * reason a mossback is worth crossing the valley for; a colony that pens its
 * dunhares gets a trickle of them forever without ever finding a mossback. The
 * choice the player now has in front of a marked animal — shoot it for 34 meat
 * today, or pen it and take 8 a day until the raid that eats it — is the entire
 * point, and it only exists because both sides of it spend the same currency.
 *
 * ## Why ripeness is a timestamp and not a counter
 *
 * `ripeAt` is the tick the animal is next worth walking to. Nothing accumulates,
 * so there is no per-tick arithmetic over the herd and no number to migrate into
 * old saves — an animal with no `ripeAt` is simply one nobody has looked at yet,
 * and `tickHusbandry` gives it one. It also staggers itself for free: animals
 * are tamed and born on different ticks, so a herd of six ripens across six
 * different mornings rather than all at once on the hour.
 */

import { inPen, livestock } from './livestock';
import type { AnimalKind, Pawn, ResourceKind, World } from './types';
import { TICKS_PER_DAY } from './types';

export interface AnimalYield {
  /** What comes off the animal, in the currency the colony already counts. */
  kind: ResourceKind;
  amount: number;
  /** Ticks between one collection and the next being ready. */
  every: number;
  /** What the colony calls the stuff, for the log line and the inspector. */
  label: string;
  /** What the handler does to get it. */
  verb: string;
}

/**
 * The two payouts, sized against the animal you gave up to get them.
 *
 * A mossback is 34 meat in the hand if you shoot it. Penned it gives 8 a day,
 * so it pays for itself on the fifth morning and every morning after that is
 * profit — slow enough that hunting is still the right answer to being hungry
 * *today*, fast enough that a pen laid down in week one is feeding the colony by
 * week two.
 *
 * The dunhare's is the interesting one. Two hides every day and a half is a
 * miserable rate next to the nine off a dressed mossback, but hares are the
 * animal that is always on the map and always cheap to tame, and hides are the
 * one material the colony cannot farm. A pen of six of them is a coat a week
 * from nothing but grass, which is the first time the wardrobe has had a supply
 * that does not depend on finding the big animal.
 */
export const YIELDS: Partial<Record<AnimalKind, AnimalYield>> = {
  mossback: {
    kind: 'rawfood',
    amount: 8,
    every: Math.round(TICKS_PER_DAY * 0.85),
    label: 'milk',
    verb: 'milks',
  },
  dunhare: {
    kind: 'hide',
    amount: 2,
    every: Math.round(TICKS_PER_DAY * 1.5),
    label: 'down',
    verb: 'combs',
  },
};

/**
 * A handler's time to collect from one animal — about six seconds at 1×.
 *
 * Deliberately trivial next to `TAME_WORK`. The cost of livestock is the taming
 * and the pen; collection is the payout, and a payout that takes a full minute
 * of a settler's day would have the player doing arithmetic about whether the
 * pen is worth staffing. It is meant to feel like walking the round, not like a
 * shift.
 */
export const GATHER_WORK = 120;

/** How close the handler has to stand. Same reach as taming, for the same reason. */
export const GATHER_REACH = 1.6;

/** What this species is worth keeping, or null for one that is only ever meat. */
export function yieldOf(animal: Pawn): AnimalYield | null {
  return YIELDS[animal.animal ?? 'dunhare'] ?? null;
}

/**
 * Is this one worth walking out to right now?
 *
 * The pen check is the containment rule doing double duty: an animal that has
 * strayed is walking home under `penTarget`, and a handler chasing it across the
 * map to milk it would be a job that outlasts the walk. Wait for it to get back.
 *
 * An animal marked for the table is skipped too. Not because a condemned animal
 * cannot be milked, but because the butcher is already on the way and the two
 * jobs would fight over the same body — and losing the milk is the cheaper of
 * the two ways that argument can end.
 */
export function isRipe(world: World, animal: Pawn): boolean {
  if (animal.tame !== true || animal.dead) return false;
  if (animal.hunted === true) return false;
  if (!yieldOf(animal)) return false;
  if (animal.ripeAt === undefined || world.tick < animal.ripeAt) return false;
  return inPen(world, animal.x, animal.y);
}

/** Everything in the pen with something to collect. */
export function readyLivestock(world: World): Pawn[] {
  return livestock(world).filter((a) => isRipe(world, a));
}

/**
 * Take the payout and start the clock again.
 *
 * Drops where the animal stands rather than in a stockpile, exactly like a
 * harvested crop or a dressed carcass — the hauling is somebody else's job, and
 * a pen too far from the pantry costing an extra walk is the same lesson the
 * farm already teaches.
 */
export function collectFrom(world: World, animal: Pawn, drop: (y: AnimalYield) => void): void {
  const y = yieldOf(animal);
  if (!y) return;
  drop(y);
  animal.ripeAt = world.tick + y.every;
}

/**
 * How long until this one is worth a walk, in ticks. Negative means it is ready.
 *
 * For the inspector, which wants to tell the player *why* nobody is going out to
 * the pen this morning.
 */
export function ticksUntilRipe(world: World, animal: Pawn): number | null {
  if (animal.tame !== true || !yieldOf(animal)) return null;
  if (animal.ripeAt === undefined) return null;
  return animal.ripeAt - world.tick;
}

/**
 * Ticks between sweeps of the herd.
 *
 * The pass only ever writes a timestamp onto an animal that has never had one,
 * so it is idle on every tick but the handful after a taming or a birth. A
 * second of colony time between sweeps is far below the fastest yield clock and
 * costs one filter over a herd that is capped in the low tens.
 */
export const HUSBANDRY_INTERVAL = 20;

/**
 * Give any new arrival its first clock.
 *
 * A freshly tamed animal waits a full cycle before its first collection. Taming
 * one and immediately milking it would make the pen pay on the same afternoon it
 * was built, which is the one thing this system must not do — the whole shape of
 * it is that livestock is the slow answer.
 */
export function tickHusbandry(world: World): void {
  if (world.tick % HUSBANDRY_INTERVAL !== 0) return;
  for (const a of livestock(world)) {
    if (a.ripeAt !== undefined) continue;
    const y = yieldOf(a);
    if (y) a.ripeAt = world.tick + y.every;
  }
}
