/**
 * Where a settler's head is pointed, as two angles — the whole of the aim, with
 * no three, no meshes and no frame anywhere in it.
 *
 * Aiming a head is not "point the skull at the thing". A head that snaps onto a
 * target is a turret, a head that reaches any angle is an owl, and a head driven
 * straight off the target's position twitches every time that position does.
 * All three are decisions about ANGLES rather than about meshes, so they live
 * here, where a test can fail them, instead of inside `PawnRig.update` where
 * they could only ever be watched.
 *
 * The angles are measured in the BODY's frame, not the head's. Yaw is the turn
 * off the shoulders, which is what a neck actually limits; measuring off the
 * head's own current orientation instead would let the limit drift, because the
 * head could keep turning as long as something kept turning it. `PawnRig` hangs
 * the head under a group already rotated to the pawn's facing, so writing these
 * angles onto `head.rotation` puts them in the body's frame for free.
 *
 * One convention, stated once because the wiring depends on it: positive pitch
 * is UP. Three rotates a child's +Z toward −Y for a positive `rotation.x`, so
 * the call site negates. That is deliberate — a module about where a creature is
 * looking should not be written upside down to save one minus sign at its only
 * consumer.
 */

/** How far a head may be pushed off the body, and how fast it gets there. */
export interface NeckLimits {
  /** Left and right, in radians, off the body's own facing. */
  readonly yaw: number;
  /** Up, in radians. */
  readonly pitchUp: number;
  /** Down, in radians, given as a positive number. */
  readonly pitchDown: number;
  /**
   * How quickly the head closes the gap to where it wants to be, per second.
   *
   * A rate and not a step, so the turn takes the same wall time whatever the
   * frame rate: `dt` is what converts it. Higher is more alert. Far above this
   * and it is a turret again; far below and the settler notices things some
   * seconds after they happen, which reads as a person who is not all there.
   */
  readonly rate: number;
}

/**
 * What a settler's neck can do.
 *
 * Roughly seventy degrees each way, which is a person turning their head
 * without turning their shoulders. Wider was tried on paper and rejected for
 * the reason a doll looks wrong: past about ninety the head is no longer
 * "looking over there", it is detached from the body and the eye reads it as a
 * bug rather than as attention. Down is given more room than up because almost
 * everything a colonist attends to — the soil, the bench, the fallen — is below
 * the eyeline of a body that stands one and a half metres tall.
 */
export const SETTLER_NECK: NeckLimits = {
  pitchDown: 0.7,
  pitchUp: 0.45,
  rate: 8,
  yaw: 1.22,
};

/** An aim in the body's frame. Positive yaw is the body's left-hand side; positive pitch is up. */
export interface HeadAim {
  readonly pitch: number;
  readonly yaw: number;
}

/** Looking straight ahead: what a head with nothing to attend to returns to. */
export const HEAD_NEUTRAL: HeadAim = { pitch: 0, yaw: 0 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The angles that point at a world offset, given the body's facing.
 *
 * `facing` is the sim's own angle, where 0 is +X, and the rig hangs the model
 * so its nose is along that. The two dot products below are that basis read
 * back: forward is (cos f, sin f) across the ground and the body's left is
 * (sin f, −cos f), so this is a rotation into body space written out rather
 * than a matrix built to be used once.
 *
 * Returns null for an offset with no length — a target sitting exactly on the
 * head. There is no aim for that, and the honest answer is "keep the one you
 * have" rather than a normalised zero, which is a NaN wearing a hat.
 */
export function aimFromWorld(dx: number, dy: number, dz: number, facing: number): HeadAim | null {
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 1e-6)) return null;
  const fx = Math.cos(facing);
  const fz = Math.sin(facing);
  return {
    // asin of the vertical share of the whole offset, rather than atan2 of the
    // rise against the FORWARD component. The two agree in front of the body and
    // part company behind it: for something low and behind, the forward term
    // goes negative and atan2 swings past vertical, so a settler asked to look
    // at their own heels would crane at the sky. asin cannot do that, because
    // the length it divides by is never negative.
    pitch: Math.asin(clamp(dy / length, -1, 1)),
    yaw: Math.atan2(dx * fz - dz * fx, dx * fx + dz * fz),
  };
}

/** Whether a neck can reach an aim at all, before anything tries to. */
export function headAimReaches(aim: HeadAim, limits: NeckLimits = SETTLER_NECK): boolean {
  return (
    Math.abs(aim.yaw) <= limits.yaw && aim.pitch <= limits.pitchUp && aim.pitch >= -limits.pitchDown
  );
}

/**
 * Advances an aim one FRAME toward where it wants to point.
 *
 * A frame and not a tick, on purpose. Nothing in the simulation depends on
 * where a head is pointed; it is presentation, and a head that moved on the
 * sim's 20 Hz while the body was drawn at 144 would visibly step while the feet
 * did not.
 *
 * `wanted` of null means there is nothing to attend to, and the head eases back
 * to neutral rather than holding its last angle. That is the difference between
 * a settler who has finished looking at something and a settler whose neck has
 * seized.
 *
 * The approach is exponential — `1 - exp(-rate * dt)` — and not `rate * dt`,
 * which is the same thing only while the frame time is small and is a wild
 * overshoot when it is not. A frame that took a fifth of a second after a stall
 * would send a linear step past the target and out the far side.
 */
export function approachAim(
  from: HeadAim,
  wanted: HeadAim | null,
  limits: NeckLimits,
  dt: number,
): HeadAim {
  if (!(dt > 0)) return from;
  const goal = wanted
    ? {
        pitch: clamp(wanted.pitch, -limits.pitchDown, limits.pitchUp),
        yaw: clamp(wanted.yaw, -limits.yaw, limits.yaw),
      }
    : HEAD_NEUTRAL;
  const k = 1 - Math.exp(-limits.rate * dt);
  return {
    pitch: from.pitch + (goal.pitch - from.pitch) * k,
    yaw: from.yaw + (goal.yaw - from.yaw) * k,
  };
}
