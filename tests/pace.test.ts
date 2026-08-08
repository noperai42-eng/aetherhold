/**
 * The frame pacer — the arithmetic that keeps a 20 Hz simulation honest on a
 * display that refreshes at whatever rate it likes.
 *
 * This is where "pause freezes the simulation" stops being a claim in a comment
 * and becomes a property something checks. `app.ts` cannot be loaded outside a
 * browser, which is exactly why the ten lines it used to hold inline now live in
 * `client/pace.ts` where a test can reach them.
 */

import { describe, expect, it } from 'vitest';

import { MAX_STEPS_PER_FRAME, TICK_DT, alphaOf, pace } from '../src/client/pace';
import { TICKS_PER_SECOND } from '../src/sim/types';

/** Run a run of identical frames, carrying the accumulator the way `App` does. */
function frames(count: number, dt: number, speed: number, from = 0): { steps: number; left: number } {
  let left = from;
  let steps = 0;
  for (let i = 0; i < count; i++) {
    const owed = pace(left, dt, speed);
    left = owed.left;
    steps += owed.steps;
  }
  return { steps, left };
}

describe('the tick rate', () => {
  it('runs twenty ticks per second of wall time, whatever the display does', () => {
    // A second of play at four refresh rates, including two that do not divide
    // into the tick. Within one tick, not exactly on it: a frame that lands a
    // float's breadth short of the boundary runs that tick on the next frame,
    // which is the accumulator working rather than failing.
    for (const fps of [60, 30, 144, 47]) {
      const ran = frames(fps, 1 / fps, 1).steps;
      expect(Math.abs(ran - TICKS_PER_SECOND)).toBeLessThanOrEqual(1);
    }
  });

  it('does not drift over a long run', () => {
    // The property that actually matters, and the one a per-second check cannot
    // see: the error must stay bounded by a tick rather than growing with time.
    // If it grew, a colony left running would slide against the wall clock and
    // every duration in the game — a day, a meal, a wound — would mean something
    // different on a different monitor.
    const minute = frames(60 * 60, 1 / 60, 1).steps;
    expect(Math.abs(minute - TICKS_PER_SECOND * 60)).toBeLessThanOrEqual(1);
    const awkward = frames(47 * 60, 1 / 47, 1).steps;
    expect(Math.abs(awkward - TICKS_PER_SECOND * 60)).toBeLessThanOrEqual(1);
  });

  it('multiplies wall time by the speed setting', () => {
    for (const speed of [2, 3]) {
      const ran = frames(60, 1 / 60, speed).steps;
      expect(Math.abs(ran - TICKS_PER_SECOND * speed)).toBeLessThanOrEqual(1);
    }
  });
});

describe('pause', () => {
  it('takes zero ticks, however long the frame', () => {
    // The anti-slop rule, stated as arithmetic: a paused colony does not move.
    // Not "moves slowly", not "moves on the next unpause" — zero.
    for (const dt of [1 / 60, 1 / 10, 1, 30]) {
      expect(pace(0, dt, 0).steps).toBe(0);
    }
    expect(frames(600, 1 / 60, 0).steps).toBe(0);
  });

  it('does not bank the time it spent paused', () => {
    // Half a minute paused, then one ordinary frame at 1x. If the accumulator
    // had kept filling, unpausing would dump six hundred ticks into the colony
    // in a single frame — the raid you paused to think about would already be
    // over. Pausing costs the *world* nothing and gains the player nothing.
    const paused = frames(1800, 1 / 60, 0);
    expect(paused.left).toBe(0);
    expect(pace(paused.left, 1 / 60, 1).steps).toBeLessThanOrEqual(1);
  });

  it('leaves a half-finished tick behind rather than rendering mid-step', () => {
    // A frame arrives partway between ticks, then the player pauses. Alpha must
    // fall to zero so the render sits *on* the last tick: interpolating towards
    // a tick that will never come is how a paused pawn slides across the floor.
    const mid = pace(0, TICK_DT * 1.5, 1);
    expect(mid.steps).toBe(1);
    expect(alphaOf(mid, 1)).toBeCloseTo(0.5, 6);
    expect(alphaOf(mid, 0)).toBe(0);
  });
});

describe('catching up', () => {
  it('carries the remainder of a frame into the next one', () => {
    // 1.5 ticks of time: one tick now, half a tick owed. The half is not lost,
    // or a 45 fps display would run the colony at 0.9 speed for ever.
    const first = pace(0, TICK_DT * 1.5, 1);
    expect(first.steps).toBe(1);
    expect(first.left).toBeCloseTo(TICK_DT * 0.5, 9);
    expect(pace(first.left, TICK_DT * 0.6, 1).steps).toBe(1);
  });

  it('caps a stalled frame instead of spiralling', () => {
    // Two whole seconds arrive in one frame — a tab that was in the background,
    // or a garbage-collection pause. Forty ticks are owed; the pacer runs the
    // cap and drops the rest. Running all forty would stall the frame further
    // and owe more next time, which is the spiral this cap exists to break.
    const stalled = pace(0, 2, 1);
    expect(stalled.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(stalled.left).toBe(0);
  });

  it('is worth less than a tick of debt on an ordinary frame', () => {
    // The cap must never fire during normal play at any offered speed, or the
    // colony would silently run slow on a healthy machine.
    for (const speed of [1, 2, 3]) {
      expect(pace(0, 1 / 60, speed).steps).toBeLessThan(MAX_STEPS_PER_FRAME);
    }
  });
});

describe('the render alpha', () => {
  it('stays inside one tick', () => {
    // Alpha is handed to the pawn interpolator. Outside 0..1 it would draw
    // bodies ahead of where the sim has actually put them.
    let left = 0;
    for (let i = 0; i < 500; i++) {
      const owed = pace(left, 1 / 61.3, 3);
      left = owed.left;
      const alpha = alphaOf(owed, 3);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });

  it('is the same number for the same frame, every time', () => {
    // The pacer is pure: two views rendering the same frame get the same alpha,
    // which is half of what makes the manager and the body agree on where a
    // settler is standing.
    const a = pace(0.013, 1 / 60, 2);
    const b = pace(0.013, 1 / 60, 2);
    expect(a).toEqual(b);
    expect(alphaOf(a, 2)).toBe(alphaOf(b, 2));
  });
});
