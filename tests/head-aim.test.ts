/**
 * The angles a settler's head is turned to, tested without a renderer.
 *
 * The whole point of `head-aim.ts` being free of three is that these can fail:
 * a neck limit, a frame-rate dependence and a sign are all things that can only
 * be *watched* once they are written onto a mesh, and all three are the kind of
 * bug that ships looking approximately right.
 */

import { describe, expect, it } from 'vitest';

import {
  aimFromWorld,
  approachAim,
  HEAD_NEUTRAL,
  headAimReaches,
  SETTLER_NECK,
  type HeadAim,
} from '../src/client/render/head-aim';

/** Rotate a ground offset about the vertical, so a case can be re-asked from another angle. */
function turn(dx: number, dz: number, by: number): [number, number] {
  return [dx * Math.cos(by) - dz * Math.sin(by), dx * Math.sin(by) + dz * Math.cos(by)];
}

// --- functional

describe('the angles that point a head at something', () => {
  it('reads dead ahead as no turn at all, from any facing', () => {
    // A settler walking north and a settler walking south-west both have their
    // job directly in front of them; neither should be turning their head. This
    // is the case a basis error cannot survive, because it is true in every
    // frame of reference at once.
    for (const facing of [0, 0.7, Math.PI / 2, Math.PI, -2.4]) {
      const aim = aimFromWorld(Math.cos(facing) * 3, 0, Math.sin(facing) * 3, facing);
      expect(aim, `facing ${facing} has no aim for a target in front of it`).not.toBeNull();
      expect(aim!.yaw, `facing ${facing} turns its head toward its own nose`).toBeCloseTo(0, 6);
      expect(aim!.pitch, `facing ${facing} tilts at a target on its own eyeline`).toBeCloseTo(0, 6);
    }
  });

  it('gives the same aim when the body and the target turn together', () => {
    // The invariant that says the two dot products really are a rotation into
    // body space and not two terms that happen to look like one. Turn the world
    // and the settler by the same amount and the neck has not moved.
    const base = aimFromWorld(2, 0.4, -1.5, 0)!;
    for (const by of [0.3, 1.1, -2.2, Math.PI]) {
      const [dx, dz] = turn(2, -1.5, by);
      const turned = aimFromWorld(dx, 0.4, dz, by)!;
      expect(turned.yaw, `turned by ${by}`).toBeCloseTo(base.yaw, 6);
      expect(turned.pitch, `turned by ${by}`).toBeCloseTo(base.pitch, 6);
    }
  });

  it('turns the head the way three will turn the mesh', () => {
    // The sign that the wiring depends on. A positive `rotation.y` swings a
    // child's +Z toward its +X, so a positive yaw here has to mean the same
    // side. Facing +X, the model's own +X points at world -Z, so a target at
    // world -Z is the one that must come back positive. Get this backwards and
    // every settler looks pointedly away from whatever they are doing, which is
    // a bug that reads as deliberate rudeness rather than as a broken sign.
    expect(aimFromWorld(0, 0, -1, 0)!.yaw).toBeGreaterThan(0);
    expect(aimFromWorld(0, 0, 1, 0)!.yaw).toBeLessThan(0);
  });

  it('will not crane at the sky for something lying behind the heels', () => {
    // atan2 of the rise against the forward component passes this in front and
    // fails it behind: the forward term goes negative and the angle swings past
    // vertical. A settler looking at a body on the ground behind them must look
    // DOWN, at an angle their neck will then refuse.
    const aim = aimFromWorld(-3, -1.4, 0, 0)!;
    expect(aim.pitch).toBeLessThan(0);
    expect(Math.abs(aim.pitch)).toBeLessThanOrEqual(Math.PI / 2);
  });

  it('has no answer for a target sitting on the head, and says so', () => {
    // Rather than a normalised zero, which is a NaN wearing a hat and would be
    // written straight onto a rotation.
    expect(aimFromWorld(0, 0, 0, 0)).toBeNull();
    expect(aimFromWorld(0, 0, 0, 1.2)).toBeNull();
  });
});

describe('what a neck refuses', () => {
  it('does not reach behind the shoulders', () => {
    expect(headAimReaches({ pitch: 0, yaw: Math.PI * 0.9 })).toBe(false);
    expect(headAimReaches({ pitch: 0, yaw: -Math.PI * 0.9 })).toBe(false);
  });

  it('reaches further down than up, because the work is down there', () => {
    // Soil, benches and the fallen are all below the eyeline of a body 1.5m
    // tall. A neck given symmetric limits refuses the commonest case in the game.
    expect(SETTLER_NECK.pitchDown).toBeGreaterThan(SETTLER_NECK.pitchUp);
    expect(headAimReaches({ pitch: -SETTLER_NECK.pitchUp - 0.1, yaw: 0 })).toBe(true);
    expect(headAimReaches({ pitch: SETTLER_NECK.pitchDown - 0.1, yaw: 0 })).toBe(false);
  });
});

describe('a head easing toward where it wants to be', () => {
  it('lands in the same place however the frame time is chopped up', () => {
    // The reason the approach is exponential. With a linear `rate * dt` these
    // two disagree badly, and the disagreement is worst exactly after a stall,
    // when one long frame overshoots the target and sends the head out the far
    // side of it. Nothing about a settler should depend on the frame rate.
    const wanted: HeadAim = { pitch: -0.3, yaw: 0.9 };
    const oneStep = approachAim(HEAD_NEUTRAL, wanted, SETTLER_NECK, 0.1);
    let many: HeadAim = HEAD_NEUTRAL;
    for (let i = 0; i < 10; i += 1) many = approachAim(many, wanted, SETTLER_NECK, 0.01);
    expect(many.yaw).toBeCloseTo(oneStep.yaw, 6);
    expect(many.pitch).toBeCloseTo(oneStep.pitch, 6);
  });

  it('moves toward the target without arriving in one frame', () => {
    // A head that arrives instantly is a turret. It has to be visibly on its way.
    const step = approachAim(HEAD_NEUTRAL, { pitch: 0, yaw: 1 }, SETTLER_NECK, 1 / 60);
    expect(step.yaw).toBeGreaterThan(0);
    expect(step.yaw).toBeLessThan(1);
  });

  it('eases back to straight ahead when there is nothing to look at', () => {
    // Not a freeze at the last angle: that is a settler whose neck has seized,
    // and it is what "keep the last value" looks like on screen.
    const turned: HeadAim = { pitch: -0.4, yaw: 1.0 };
    const relaxed = approachAim(turned, null, SETTLER_NECK, 0.05);
    expect(Math.abs(relaxed.yaw)).toBeLessThan(Math.abs(turned.yaw));
    expect(Math.abs(relaxed.pitch)).toBeLessThan(Math.abs(turned.pitch));
  });

  it('never pushes the head past what the neck allows, however long it is asked to', () => {
    // Clamping the goal rather than the result, so a target far off to one side
    // is looked at as far as the neck goes and then held there, steadily.
    let aim: HeadAim = HEAD_NEUTRAL;
    for (let i = 0; i < 200; i += 1) {
      aim = approachAim(aim, { pitch: -3, yaw: 3 }, SETTLER_NECK, 0.05);
      expect(aim.yaw).toBeLessThanOrEqual(SETTLER_NECK.yaw + 1e-9);
      expect(aim.pitch).toBeGreaterThanOrEqual(-SETTLER_NECK.pitchDown - 1e-9);
    }
    expect(aim.yaw).toBeCloseTo(SETTLER_NECK.yaw, 6);
  });

  it('stands still on a frame that took no time', () => {
    // Two syncs in one frame, or a paused tab handing back a zero: neither is a
    // reason for the head to move, and `1 - exp(0)` has to stay exactly 0.
    const turned: HeadAim = { pitch: -0.2, yaw: 0.5 };
    expect(approachAim(turned, HEAD_NEUTRAL, SETTLER_NECK, 0)).toEqual(turned);
    expect(approachAim(turned, HEAD_NEUTRAL, SETTLER_NECK, -1)).toEqual(turned);
  });
});
