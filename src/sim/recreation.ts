/**
 * What a settler does when there is nothing that has to be done.
 *
 * Recreation used to be one line in the job picker: bored settler walks to the
 * nearest table and their bar goes back up. That works and it is dead. Nobody
 * chooses anything, nowhere is worth building, and the colony's one social
 * multiplier — two people relaxing near each other bond faster, see
 * `social.ts` — fires by accident when the table happens to be the only one.
 *
 * This module is the small amount of structure that fixes all three: a table of
 * places worth going, how good each one is, and how many people it holds. Three
 * decisions:
 *
 *  - **A spot is an ordinary building with a second job.** The campfire is
 *    already a heater; sitting round it is not a new object, it is what a fire
 *    is *for*. Only the games table exists solely to be played at, and it is
 *    cheap on purpose — recreation should never be the thing a young colony
 *    cannot afford.
 *  - **Company is worth more than quality.** A settler will pass a better empty
 *    spot to sit at a worse occupied one, within reason, because the point of
 *    the whole system is that the colony gathers somewhere in the evening rather
 *    than each taking a private turn at the same table.
 *  - **Full means full.** A spot seats a fixed number and the picker will not
 *    overbook it, so four settlers and a two-seat board do not end up stacked on
 *    one cell pretending to play.
 */

import { dist } from './grid';
import type { Building, BuildingKind, Pawn, World } from './types';

/**
 * How good each kind of place is to spend an hour at, and how many it holds.
 *
 * A table, not a field on `BuildingDef`, for the same reason `power.ts` keeps
 * `DRAW` and `beauty.ts` keeps `BEAUTY` in their own modules: this is one
 * system's opinion about buildings, and most buildings have no opinion to hold.
 *
 * `gain` is a multiplier on the base rate a table gives, so the numbers here
 * read as "how much better than sitting at the table is this".
 */
export const REC_SPOTS: Partial<Record<BuildingKind, { gain: number; seats: number }>> = {
  // The dining table. Somewhere to sit and talk, which is most of it.
  table: { gain: 1, seats: 4 },
  // A fire to sit round. The best of the three when it is burning, and worth
  // nothing at all when it is not, which is the one thing that makes a campfire
  // different from furniture: it needs feeding.
  campfire: { gain: 1.25, seats: 6 },
  // The only object in the game whose entire job is having fun at it.
  gametable: { gain: 1.6, seats: 2 },
};

/** How much better a spot gets with somebody else already at it. */
export const COMPANY_GAIN = 0.35;

/**
 * How far out of their way a settler will walk to join the others.
 *
 * Roughly the width of a cabin. Far enough that the colony converges on one
 * fire in the evening, short enough that nobody crosses the whole base to do it
 * while a better spot stands empty next to them.
 */
export const COMPANY_DETOUR = 9;

/** Cells within which two settlers count as at the same spot. */
export const SPOT_RANGE = 2.2;

/** Is this building usable as somewhere to spend an evening right now? */
export function isRecSpot(b: Building): boolean {
  if (!b.built) return false;
  const spot = REC_SPOTS[b.kind];
  if (!spot) return false;
  // A cold fire pit is a ring of stones. Everything else works whatever the hour.
  if (b.kind === 'campfire' && (b.fuel ?? 0) <= 0) return false;
  return true;
}

/** Settlers already relaxing at this spot. Sleepers and workers do not count. */
export function usersOf(world: World, b: Building, except?: Pawn): Pawn[] {
  const out: Pawn[] = [];
  for (const p of world.pawns) {
    if (p.faction !== 'colony' || p.dead || p.downed) continue;
    if (p === except) continue;
    if (p.activity !== 'relaxing') continue;
    if (dist(p.x, p.y, b.x, b.y) > SPOT_RANGE) continue;
    out.push(p);
  }
  return out;
}

/**
 * Everybody on their way to this spot or sitting at it.
 *
 * Both halves matter. Counting only the people already there overbooks a spot
 * three settlers are walking towards; counting only the walkers loses the ones
 * who have arrived. Jobs are the source of truth for intent and position is the
 * source of truth for arrival, so the seat count needs both.
 */
export function claimsOn(world: World, b: Building, except?: Pawn): number {
  let n = 0;
  const seen = new Set<number>();
  for (const job of world.jobs) {
    if (job.kind !== 'recreate' || job.buildingId !== b.id) continue;
    if (job.pawnId === except?.id) continue;
    seen.add(job.pawnId);
    n++;
  }
  for (const p of usersOf(world, b, except)) {
    if (!seen.has(p.id)) n++;
  }
  return n;
}

/**
 * The best place for this settler to go and do nothing.
 *
 * Scored rather than sorted, because the three things that matter pull against
 * each other: how good the spot is, how far it is, and who is already there. The
 * company term is deliberately large enough to beat a *modestly* better empty
 * spot at the same distance — a settler will leave the fire to somebody rather
 * than sit alone at the table — and small enough that it beats neither the walk
 * across the base nor the best object in the game standing free next door.
 */
export function bestSpot(
  world: World,
  pawn: Pawn,
  reachable: (x: number, y: number) => boolean,
): Building | null {
  let best: Building | null = null;
  let bestScore = -Infinity;
  for (const b of world.buildings) {
    if (!isRecSpot(b)) continue;
    const spot = REC_SPOTS[b.kind]!;
    const taken = claimsOn(world, b, pawn);
    if (taken >= spot.seats) continue;
    const d = dist(pawn.x, pawn.y, b.x, b.y);
    if (d > COMPANY_DETOUR * 3) continue;
    if (!reachable(b.x, b.y)) continue;
    // Quality, minus the walk, plus the company. The distance divisor is the
    // detour: one cabin's width of walking costs about as much as a whole point
    // of quality, so nobody crosses the map for a marginally better board.
    const score = spot.gain - d / COMPANY_DETOUR + (taken > 0 ? COMPANY_GAIN : 0);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

/**
 * The multiplier on the recreation bar for spending this tick at this spot.
 *
 * Company counts here as well as in the picking, and for a different reason: it
 * is not just that a settler would rather sit with somebody, it is that doing so
 * is better for them. It stacks with `social.ts` raising the bond at the same
 * time — the evening round the fire is meant to be the single most efficient
 * hour in the colony's day, and the player never has to be told that.
 */
export function recRate(world: World, pawn: Pawn, b: Building): number {
  const spot = REC_SPOTS[b.kind];
  if (!spot) return 0;
  const company = usersOf(world, b, pawn).length;
  return spot.gain * (1 + Math.min(2, company) * COMPANY_GAIN);
}

/** What the settler's job label says they are doing, so 'relaxing' is not one word for three things. */
export function recLabel(kind: BuildingKind): string {
  if (kind === 'campfire') return 'sitting by the fire';
  if (kind === 'gametable') return 'playing a game';
  return 'relaxing';
}
