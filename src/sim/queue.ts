/**
 * The control stack — what a settler is doing, and what they are doing next.
 *
 * A settler used to be a black box: they had one job, and where it came from and
 * what came after it were both invisible. The stack makes that legible and, for a
 * settler the player has taken off the work board, editable.
 *
 * The one design decision worth stating: a queued entry is a **real `Job` on
 * `world.jobs`**, not a note about a job to create later. That is what makes the
 * whole thing safe. Every claim check in the sim — `isCellTargeted`,
 * `isBuildingTargeted`, `reservedBy` — is a scan of `world.jobs`, so a queued job
 * holds its tree, its bed and its sack of steel from the moment it is queued, and
 * two settlers can never walk to the same rock. Cancelling one goes through
 * `cancelJob`, which already knows how to hand all of that back. The only thing
 * that separates a queued job from the one in hand is that nothing ticks it.
 *
 * This module is deliberately dependency-free — plain operations on plain data —
 * so `world.ts` can strip a cancelled job out of the stack without importing the
 * job system, which imports it.
 */

import type { Job, Pawn, World } from './types';

/**
 * How many entries the stack holds in total, counting the one in hand.
 *
 * Three, because the stack is a readout before it is a plan: a player glances at
 * it to answer "what is this one up to", and a list longer than a glance stops
 * answering that. It is also a brake on the colony hoarding work — see
 * `LOOKAHEAD`.
 */
export const STACK_MAX = 3;

/**
 * How far ahead the colony's own picker plans, in waiting entries.
 *
 * One, not two, and this is a throughput decision rather than a UI one. A queued
 * job is claimed work, so a settler who plans three deep takes three jobs off the
 * board the moment they go looking — and with a dozen settlers and ten available
 * tasks, the first four would hold everything and the rest would stand in the
 * yard. Planning one ahead makes the transition between jobs instant without
 * letting anyone corner the market, and `planAhead` will not plan at all while
 * somebody else is idle.
 *
 * The player is not held to this: their own stack goes to `STACK_MAX`, because
 * work they queued by hand is work they have already decided to spend.
 */
export const LOOKAHEAD = 1;

/** The stack behind the job in hand. Lazily created, so old saves cost nothing. */
export function queueOf(pawn: Pawn): number[] {
  if (!pawn.queue) pawn.queue = [];
  return pawn.queue;
}

/** Drop a job id out of a stack. Called by `cancelJob` for every cancellation. */
export function removeFromQueue(pawn: Pawn, jobId: number): void {
  if (!pawn.queue) return;
  const i = pawn.queue.indexOf(jobId);
  if (i >= 0) pawn.queue.splice(i, 1);
}

/**
 * The waiting entries, resolved to jobs.
 *
 * Ids that no longer name a job are dropped from the stack on the way past
 * rather than skipped, so a stack cannot silently accumulate holes.
 */
export function queuedJobs(world: World, pawn: Pawn): Job[] {
  const q = pawn.queue;
  if (!q || q.length === 0) return [];
  const out: Job[] = [];
  for (let i = q.length - 1; i >= 0; i--) {
    const job = world.jobs.find((j) => j.id === q[i]);
    if (job) out.unshift(job);
    else q.splice(i, 1);
  }
  return out;
}

/** The whole stack the player sees: the job in hand first, then the waiting ones. */
export function controlStack(world: World, pawn: Pawn): Job[] {
  const stack = queuedJobs(world, pawn);
  if (pawn.jobId !== null) {
    const live = world.jobs.find((j) => j.id === pawn.jobId);
    if (live) stack.unshift(live);
  }
  return stack;
}

/** How many more entries this settler will accept. */
export function stackRoom(world: World, pawn: Pawn): number {
  return Math.max(0, STACK_MAX - controlStack(world, pawn).length);
}
