/**
 * Stride length: the arithmetic that turns distance walked into a gait.
 *
 * `Pawn.animPhase` is advanced by the simulation, by the distance a body
 * actually travelled after collision — `followPath` in `src/sim/movement.ts`
 * adds `step * PHASE_PER_CELL` every tick a body moves. That is the honest half
 * of a walk: both cameras read one number, and a settler shoved against a wall
 * stops striding instead of running on the spot.
 *
 * The dishonest half was on this side. A rig swung its legs about the hip by a
 * fixed amplitude while the body translated on its own, so the two agreed only
 * by accident — and they did not agree. A settler's foot reaches 0.43 cells
 * ahead of the hip and 0.43 behind it, 0.86 across the step, while the body
 * covers 0.42 over the same half-cycle. The planted foot slid backwards across
 * the ground by about the length of the step it had just taken. From the
 * manager camera, eleven cells up, that is invisible. At eye level it is
 * skating, and eye level is half of what this game is.
 *
 * The fix is not inverse kinematics. It is one equation: a foot stays put when
 * a full swing carries the body exactly as far as the foot reaches. Nothing
 * here touches the sim — the phase still means distance travelled, and each rig
 * converts that distance into its own gait using its own legs, which is why a
 * calf can trot beside its dam without either of them scrubbing.
 */

/**
 * What the sim adds to `animPhase` per cell walked.
 *
 * Mirrored rather than imported. The literal lives inline in `followPath`, and
 * exporting it would edit `src/sim/**`, which changes the fingerprint keying
 * `.eval/measurements.json` — a sixty-day grid re-run spent to say exactly what
 * it already says. `tests/gait.test.ts` reads the sim's source text instead and
 * fails the day the two drift apart, which is the thing an import would have
 * bought us.
 */
export const PHASE_PER_CELL = 7.5;

/**
 * How far one full stride cycle carries a body whose feet do not scrub.
 *
 * A leg pivoted at the hip puts its foot `legLength * sin(swing)` ahead of the
 * hip at the top of the swing and the same distance behind it at the bottom, so
 * one step spans twice that. A full cycle of `sin` is two steps — left, then
 * right — hence four.
 */
export const strideCells = (legLength: number, swing: number): number =>
  4 * legLength * Math.sin(swing);

/**
 * The number a rig multiplies `animPhase` by to get its own stride phase.
 *
 * Zero for a body with no stride to speak of — a leg of no length, or a swing
 * of none. Such a rig stands with its legs still rather than dividing by zero
 * and scissoring at infinity, which is what a newborn scaled to nothing should
 * do anyway.
 */
export const phaseScale = (legLength: number, swing: number): number => {
  const stride = strideCells(legLength, swing);
  return stride > 0 && Number.isFinite(stride) ? (Math.PI * 2) / (stride * PHASE_PER_CELL) : 0;
};

/**
 * How far the planted foot drags across the ground over one step, in cells.
 *
 * Positive means the foot outruns the ground — legs scissoring faster than the
 * world goes by, the settler skating. Negative means the ground outruns the
 * foot, a moonwalk. Zero is a foot that stays where it was put, which is what
 * `phaseScale` is for; this exists so a test can say so in cells rather than in
 * adjectives.
 */
export const footScrub = (legLength: number, swing: number, scale: number): number => {
  const foot = 2 * legLength * Math.sin(swing);
  const ground = scale > 0 ? Math.PI / (scale * PHASE_PER_CELL) : Infinity;
  return foot - ground;
};

/**
 * Steps per second for a body moving at `cellsPerSecond`, once its feet plant.
 *
 * The other half of the check: planting the foot fixes the scrub by slowing the
 * legs, and slowing the legs far enough turns a walk into a moon-bounce. A cell
 * is a metre and a second is a second, so this number can be held against a
 * real gait — people walk at about two steps a second and run at three or four.
 */
export const stepsPerSecond = (
  cellsPerSecond: number,
  legLength: number,
  swing: number,
): number => {
  const step = 2 * legLength * Math.sin(swing);
  return step > 0 ? cellsPerSecond / step : 0;
};

/**
 * A settler's leg, hip to sole. The rig hangs its legs from exactly this height,
 * which is why the soles reach the floor rather than hover above it.
 */
export const SETTLER_LEG = 0.74;

/** How far the hip carries that leg, either side of straight down. */
export const SETTLER_SWING = 0.62;

/**
 * The multiplier the settler's rig, the eye riding inside it, and the possessed
 * body all read. Three places each used to hold their own idea of how fast a
 * settler's legs go — a swing amplitude, a wall clock and a flat per-tick
 * constant — and no two of them agreed. This is the one they agree on.
 */
export const SETTLER_PHASE = phaseScale(SETTLER_LEG, SETTLER_SWING);
