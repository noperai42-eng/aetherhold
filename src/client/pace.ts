/**
 * How many sim ticks this frame owes — the one piece of arithmetic that keeps a
 * 20 Hz simulation honest on a display that refreshes at whatever it feels like.
 *
 * It lives in its own module, importing nothing but the tick rate, for one
 * reason: `app.ts` cannot be loaded outside a browser (it pulls in the renderer,
 * the HUD and three.js), and "pause freezes the simulation" is a rule that has to
 * be *provable*, not asserted in a comment. Eleven lines here mean the rule is
 * pinned by a test in `tests/pace.test.ts` instead of by eye.
 */

import { TICKS_PER_SECOND } from '../sim/types';

/** Seconds of simulated time in one tick. The sim's clock, not the monitor's. */
export const TICK_DT = 1 / TICKS_PER_SECOND;

/** Never simulate more than this many steps in one frame: a stall must not spiral. */
export const MAX_STEPS_PER_FRAME = 12;

export interface Pace {
  /** Ticks to run this frame. */
  steps: number;
  /** Simulated time left over, carried into the next frame — and the render alpha. */
  left: number;
}

/**
 * Advance the accumulator by one frame of wall time.
 *
 * `speed` scales wall time into simulated time, and *zero means zero*: a paused
 * game does not bank the time it spent paused, which is why unpausing never
 * dumps a fast-forward into the colony. Past `MAX_STEPS_PER_FRAME` the remainder
 * is dropped rather than carried, because a machine that cannot keep up should
 * run slow, not spiral trying to catch up with a debt it keeps adding to.
 */
export function pace(accumulator: number, dt: number, speed: number): Pace {
  if (speed <= 0) return { steps: 0, left: 0 };
  let left = accumulator + dt * speed;
  let steps = 0;
  while (left >= TICK_DT && steps < MAX_STEPS_PER_FRAME) {
    left -= TICK_DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) left = 0; // gave up catching up
  return { steps, left };
}

/** Where the render sits between the last tick and the next, 0..1. */
export function alphaOf(pace: Pace, speed: number): number {
  if (speed <= 0) return 0;
  return Math.min(1, pace.left / TICK_DT);
}
