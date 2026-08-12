/**
 * Who has the hands while an overlay is over the world.
 *
 * The manager can always answer one: it never took the cursor away. First
 * person did — the mouse is *locked*, which means there is no pointer on the
 * screen at all — and every overlay in this game ends in buttons. So an overlay
 * that opens while the player is inside a body is an overlay the player cannot
 * answer, and one of them opens without being asked for: the ending lands on
 * its own tick, whether the player is at the desk or out in the yard.
 *
 * The rule stated here is one sentence — *an overlay takes the body's controls
 * and gives back the mouse* — and it lives in its own module for the reason
 * `pace.ts` does: `app.ts` cannot be loaded outside a browser, so a rule about
 * who is allowed to move has to be provable rather than asserted in a comment.
 * Pinned by `tests/overlays.test.ts`.
 */

import type { ViewMode } from '../sim/save';

/** The four overlays the HUD can put over the world, and whether each is up. */
export interface Overlays {
  /** The key list, opened with `/` or F1. */
  help: boolean;
  /** The colony code box — the one overlay the player types into. */
  backup: boolean;
  /** The new-colony card, whose confirm button throws this colony away. */
  setup: boolean;
  /** Founding, wipe or terminal. The only one that opens by itself. */
  ending: boolean;
}

/** Nothing over the world. */
export const NO_OVERLAYS: Overlays = { help: false, backup: false, setup: false, ending: false };

/** Is anything over the world right now? */
export function anyOverlayUp(o: Overlays): boolean {
  return o.help || o.backup || o.setup || o.ending;
}

/**
 * May the possessed body read the keyboard and the mouse this frame?
 *
 * `keydown` and `mousemove` are bound to the window rather than to the canvas,
 * so without this the answer is always yes: WASD keeps walking the settler and
 * the mouse keeps turning their head behind a card the player is trying to
 * read. Nothing is *released* here — the keys stay held, the body simply stops
 * being asked — so a player who was mid-stride when the ending landed picks up
 * mid-stride when they dismiss it.
 */
export function bodyMayAct(mode: ViewMode, o: Overlays): boolean {
  return mode === 'fps' && !anyOverlayUp(o);
}

/**
 * Must the pointer be handed back?
 *
 * Only first person ever holds it, and it has to be handed back *before* the
 * player reaches for it. Chrome eats the Escape keypress that exits a pointer
 * lock — the page never sees that keydown — so a locked player pressing Escape
 * at a card gets a cursor and nothing else, and the card is still there. Handing
 * the pointer back on the frame the overlay opens means the *next* Escape
 * reaches the game and closes it, exactly the way it does at the desk.
 */
export function pointerMustBeFree(mode: ViewMode, o: Overlays): boolean {
  return mode === 'fps' && anyOverlayUp(o);
}
