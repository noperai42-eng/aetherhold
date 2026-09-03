/**
 * Which of the two presentations of the HUD this device gets.
 *
 * There is one HUD and one DOM — see `hud.ts`. What changes between a phone and
 * a desk is where the panels sit and how big the things you press are, and both
 * of those are stylesheet decisions. So the only job here is to answer one
 * question, once, and hang the answer on the HUD root as a class.
 *
 * The test is *both* a coarse pointer and a small screen, and it asks for the
 * screen's short side rather than its width. A finger is coarse on a tablet too,
 * and a tablet has room for the desk layout; a laptop with a touchscreen is a
 * desk. And the short side does not change when the player turns the phone over,
 * which matters because the layout must not rearrange itself mid-game — a rule
 * that fires on rotation is a rule that moves the button under the thumb that
 * was reaching for it.
 */

/** Below this, on a finger-driven screen, the desk layout does not fit. */
const SHORT_SIDE = 560;

export function isPhoneLayout(win: Window = window): boolean {
  const coarse = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
  if (!coarse) return false;
  return Math.min(win.screen?.width ?? win.innerWidth, win.screen?.height ?? win.innerHeight) < SHORT_SIDE;
}
