/**
 * What `PawnsView` does between two simulation ticks, driven on the real class.
 *
 * `tests/fps-trace.test.ts` traces a walk through `TraceView`, a stand-in that
 * carries a copy of this arithmetic so a whole scripted run can be scored
 * cheaply. A copy cannot fail when the original changes. Two mutations proved
 * it: replacing both production lerps with a half-way step
 * (`pr.ph + (c.ph - pr.ph) * (alpha < 0.5 ? 0 : 1)`, which restores the 20 Hz
 * staircase) and disabling the teleport branch (`if (false && jump > SNAP_CELLS)`)
 * left all 315 tests in the repository green.
 *
 * So these tests import `PawnsView` itself and assert on what it returns and on
 * the pose it puts on the rig. Each one names the mutant it is red against.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { PawnsView, settlerBob } from '../src/client/render/pawns';
import { FpsController } from '../src/client/fps/controller';
import { createWorld } from '../src/sim/worldgen';
import type { Pawn, World } from '../src/sim/types';

const SEED = 20260914;

/** Phases picked so every midpoint below is exact in binary floating point. */
const PH_A = 1;
const PH_B = 2;
const PH_MID = 1.5;

/**
 * One colonist on a real map, alone, so `standHeight` has ground to answer with
 * and no second body can move under the view between ticks.
 */
function solo(): { world: World; pawn: Pawn; view: PawnsView } {
  const world = createWorld(SEED);
  const pawn = world.pawns.find((p) => !p.animal)!;
  world.pawns = [pawn];
  world.jobs = [];
  pawn.jobId = null;
  pawn.targetPawnId = null;
  pawn.carryingItemId = null;
  pawn.carryingPawnId = null;
  pawn.dead = false;
  pawn.downed = false;
  pawn.buried = false;
  pawn.activity = 'walking';
  pawn.animPhase = PH_A;
  return { world, pawn, view: new PawnsView() };
}

/** The left leg's swing, which `settlerPose` drives straight off `phase`. */
function legPitch(view: PawnsView): number {
  let found: number | null = null;
  view.group.traverse((o) => {
    if (found === null && o.name === 'leg' && (o as THREE.Mesh).position.x < 0) {
      found = (o as THREE.Mesh).rotation.x;
    }
  });
  if (found === null) throw new Error('no left leg in the rig');
  return found;
}

describe('PawnsView interpolates the gait phase', () => {
  /**
   * Red against the half-way-step mutant: it returns `pr.ph` at alpha 0.5, which
   * is `PH_A`, not the midpoint.
   */
  it('returns the midpoint phase half way through a tick', () => {
    const { world, pawn, view } = solo();
    view.onTick(world);

    pawn.x += 1;
    pawn.animPhase = PH_B;
    view.onTick(world);

    const half = view.interpolated(pawn.id, 0.5)!;
    expect(half.ph).toBe(PH_MID);
    expect(half.ph).not.toBe(PH_A);
    expect(half.ph).not.toBe(PH_B);
    expect(view.interpolated(pawn.id, 0)!.ph).toBe(PH_A);
    expect(view.interpolated(pawn.id, 1)!.ph).toBe(PH_B);
  });

  /**
   * The phase has to climb through the tick, not sit on one end of it and jump.
   * A staircase is monotone too, so monotonicity alone would not catch the
   * mutant; the count of distinct values is what does.
   */
  it('gives a different phase at every step across one tick', () => {
    const { world, pawn, view } = solo();
    view.onTick(world);
    pawn.x += 1;
    pawn.animPhase = PH_B;
    view.onTick(world);

    const alphas = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
    const phases = alphas.map((a) => view.interpolated(pawn.id, a)!.ph);
    expect(new Set(phases).size).toBe(alphas.length);
    for (let i = 1; i < phases.length; i += 1) expect(phases[i]!).toBeGreaterThan(phases[i - 1]!);
  });

  /**
   * `interpolated` feeds the camera; `sync` feeds the body. They have to agree,
   * and the mutation lived in both — so the rig is asserted on separately.
   *
   * Red against the half-way-step mutant: it poses the leg off `PH_A` at alpha
   * 0.5, which is exactly the alpha-0 pose.
   */
  it('poses the rig off the interpolated phase, not the raw one', () => {
    const { world, pawn, view } = solo();
    view.onTick(world);
    pawn.x += 1;
    pawn.animPhase = PH_B;
    view.onTick(world);

    // `dt` is zero so the head's own easing cannot move between the reads.
    view.sync(world, 0, null, 0);
    const atStart = legPitch(view);
    view.sync(world, 0.5, null, 0);
    const atHalf = legPitch(view);
    view.sync(world, 1, null, 0);
    const atEnd = legPitch(view);

    expect(atHalf).not.toBe(atStart);
    expect(atHalf).not.toBe(atEnd);
    // The swing is `sin(phase * phaseScale) * swing`, which is monotone over
    // this span, so half a tick's phase lands between the two ends' poses.
    expect(atHalf).toBeGreaterThan(Math.min(atStart, atEnd));
    expect(atHalf).toBeLessThan(Math.max(atStart, atEnd));
    view.dispose();
  });
});

describe('PawnsView snaps rather than sweeps across a teleport', () => {
  /**
   * The sim really does write pawn positions directly, past `moveWithCollision`:
   * `src/sim/ice.ts` puts someone who fell through on the bank, and
   * `src/sim/holdings.ts` and `src/sim/jobs.ts` each move a pawn outright. Any
   * of those can exceed the two-cell threshold.
   *
   * Red against the disabled-branch mutant: without the snap this returns the
   * midpoint of the gap instead of the destination.
   */
  it('shows the destination immediately when a pawn jumps more than two cells', () => {
    const { world, pawn, view } = solo();
    const x0 = pawn.x;
    view.onTick(world);

    pawn.x = x0 + 1;
    pawn.animPhase = PH_B;
    view.onTick(world);

    // Five cells at once, the shape a teleport has.
    pawn.x = x0 + 6;
    pawn.animPhase = 10;
    view.onTick(world);

    const half = view.interpolated(pawn.id, 0.5)!;
    expect(half.x).toBe(x0 + 6);
    expect(half.y).toBe(pawn.y);
    expect(half.ph).toBe(10);
    // And nothing is left mid-gap at any point in the tick.
    expect(view.interpolated(pawn.id, 0)!.x).toBe(x0 + 6);
  });

  /** An ordinary step is under the threshold and still lerps, as it always did. */
  it('still sweeps an ordinary one-cell step', () => {
    const { world, pawn, view } = solo();
    const x0 = pawn.x;
    view.onTick(world);

    pawn.x = x0 + 1;
    pawn.animPhase = PH_B;
    view.onTick(world);

    const half = view.interpolated(pawn.id, 0.5)!;
    expect(half.x).toBe(x0 + 0.5);
    expect(half.ph).toBe(PH_MID);
  });

  /** Exactly two cells is not a teleport: the threshold is strictly greater. */
  it('sweeps a two-cell step, the largest that is not a teleport', () => {
    const { world, pawn, view } = solo();
    const x0 = pawn.x;
    view.onTick(world);

    pawn.x = x0 + 2;
    pawn.animPhase = PH_B;
    view.onTick(world);

    expect(view.interpolated(pawn.id, 0.5)!.x).toBe(x0 + 1);
  });
});

describe('the camera reads the same phase the body does', () => {
  /**
   * `Rig.update`'s `phase` is a required parameter, so TypeScript catches a rig
   * call site that forgets it. The camera's is optional and defaults to
   * `pawn.animPhase`, which keeps the older five-argument callers working — and
   * means nothing but this test stands between the wiring at
   * `src/client/app.ts` and a silent return to the stepped bob.
   */
  it('bobs to a different height on the interpolated phase than on the raw one', () => {
    const { world, pawn, view } = solo();
    view.onTick(world);
    pawn.x += 1;
    pawn.animPhase = PH_B;
    view.onTick(world);

    const at = view.interpolated(pawn.id, 0.5)!;
    expect(at.ph).toBe(PH_MID);

    const controller = new FpsController();
    // `dt` is zero on both calls, so the eye height cannot ease between them and
    // the whole difference below is the bob.
    controller.updateCamera(world, pawn, at.x, at.y, 0, at.ph);
    const interpolatedEye = controller.camera.position.y;
    controller.updateCamera(world, pawn, at.x, at.y, 0);
    const defaultedEye = controller.camera.position.y;

    expect(interpolatedEye).not.toBe(defaultedEye);
    expect(interpolatedEye - defaultedEye).toBeCloseTo(settlerBob(PH_MID) - settlerBob(PH_B), 12);
    view.dispose();
  });
});
