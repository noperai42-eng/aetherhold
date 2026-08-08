/**
 * Food goes off.
 *
 * Before this, a colony that got its plot running once never had to think about
 * food again — the pantry only ever went up, and by week three every seed ended
 * with three hundred raw food in a heap in the yard and nothing that wanted it.
 * Spoilage turns that heap back into a decision: grow what you eat, or build a
 * room cold enough to keep the rest.
 *
 * The rule is deliberately gentle at the rates a colony actually eats at. A
 * settlement burning what it grows will never see a spoil message; one sitting on
 * a fortnight's surplus in the open will lose the tail of it. That asymmetry is
 * the point — spoilage should punish hoarding, not eating.
 *
 * Rot lives on the stack rather than the unit, because `addItem` merges stacks
 * that share a cell and a per-unit clock would mean tracking seventy-five timers
 * for one pile of wheat. Merging averages by amount (see `mergeRot` in world.ts),
 * so tipping a fresh harvest onto an old one buys the old one time, which is both
 * what a player expects and what actually happens in a granary.
 */

import { mealSpoilScale } from './research';
import { cellTemp, FREEZING } from './temperature';
import type { ResourceKind, World } from './types';
import { TICKS_PER_DAY } from './types';
import { msg, removeItem } from './world';

/**
 * Days to go from fresh to inedible at the reference temperature, by resource.
 * Anything absent from this table never spoils — steel does not care.
 *
 * Meals go over faster than the raw food they were made from, which is the wrong
 * way round for most preserving and the right way round for a colony sim: it is
 * what stops "cook everything the moment it lands" being strictly correct.
 */
export const SPOIL_DAYS: Partial<Record<ResourceKind, number>> = {
  rawfood: 10,
  meal: 6,
};

/** The temperature `SPOIL_DAYS` is quoted at. */
const REFERENCE_TEMP = 20;

/**
 * How often the sweep runs, in ticks. Once a second at 1×.
 *
 * Rot is a multi-day process, so asking every tick would be forty-eight thousand
 * sight-ray casts a day to move a number by one part in ten thousand. The rate is
 * scaled by the interval, so the answer does not depend on it.
 */
const SPOIL_INTERVAL = 20;

/**
 * Spoilage rate multiplier at a given temperature.
 *
 * Frozen food keeps indefinitely — a hard zero rather than a very small number,
 * so a player who builds a proper cold store gets a promise rather than a
 * slightly better rate. Warm food is capped, because the difference between a hot
 * day and a very hot day is not a decision anybody makes.
 */
export function spoilFactor(temp: number): number {
  if (temp <= FREEZING) return 0;
  return Math.min(2.2, temp / REFERENCE_TEMP);
}

/** 0 = fresh, 1 = gone. Absent on saves written before spoilage existed. */
export function freshness(kind: ResourceKind, rot: number | undefined): number {
  if (SPOIL_DAYS[kind] === undefined) return 1;
  return Math.max(0, 1 - (rot ?? 0));
}

/** One sweep of every perishable stack on the ground. */
export function tickSpoilage(world: World): void {
  if (world.tick % SPOIL_INTERVAL !== 0) return;
  const mealScale = mealSpoilScale(world);
  let lost = 0;
  let lostKind: ResourceKind | null = null;
  for (const s of world.items.slice()) {
    let days = SPOIL_DAYS[s.kind];
    if (days === undefined) continue;
    if (s.kind === 'meal') days /= mealScale;
    // Stacks in somebody's arms are between two places and their cell is whatever
    // the carrier last stood on. They are also only carried for a few seconds, so
    // skipping them costs nothing and spares the sweep a meaningless lookup.
    if (s.carriedBy !== null) continue;
    const f = spoilFactor(cellTemp(world, s.x, s.y));
    if (f <= 0) continue;
    s.rot = (s.rot ?? 0) + (f * SPOIL_INTERVAL) / (days * TICKS_PER_DAY);
    if (s.rot < 1) continue;
    lost += s.amount;
    lostKind = s.kind;
    removeItem(world, s);
  }
  if (lost > 0 && lostKind) {
    msg(world, `${lost} ${lostKind === 'rawfood' ? 'raw food' : 'meals'} spoiled.`, 'bad');
  }
}
