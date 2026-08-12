/**
 * Who has the hands while an overlay is over the world.
 *
 * The bug this file exists for was only ever reachable from inside a body. At
 * the desk an overlay is a card with a cursor on it. In first person the mouse
 * is locked away by the browser, so there is no cursor to answer it with, and
 * the keyboard and the mouse both keep driving the settler behind it — the
 * player reads *Aetherhold stands* while walking blind into a wall, with no way
 * to press the button that says so.
 *
 * `app.ts` cannot be loaded outside a browser, which is why the rule lives in
 * `client/overlays.ts` where a test can reach it. `tests/architecture.test.ts`
 * pins the other half: that `app.ts` asks these functions rather than deciding
 * it inline again.
 */

import { describe, expect, it } from 'vitest';

import { NO_OVERLAYS, anyOverlayUp, bodyMayAct, pointerMustBeFree } from '../src/client/overlays';
import type { Overlays } from '../src/client/overlays';
import type { ViewMode } from '../src/sim/save';

const KEYS = ['help', 'backup', 'setup', 'ending'] as const;
const MODES: ViewMode[] = ['manager', 'fps'];

/** Every combination of the four overlays — sixteen of them, so nothing is sampled. */
function everyCombination(): Overlays[] {
  const out: Overlays[] = [];
  for (let bits = 0; bits < 1 << KEYS.length; bits++) {
    const o = { ...NO_OVERLAYS };
    KEYS.forEach((key, i) => {
      o[key] = (bits & (1 << i)) !== 0;
    });
    out.push(o);
  }
  return out;
}

/** One overlay up and the other three down. */
function only(key: (typeof KEYS)[number]): Overlays {
  return { ...NO_OVERLAYS, [key]: true };
}

describe('what counts as an overlay', () => {
  it('is nothing at all on an empty screen', () => {
    expect(anyOverlayUp(NO_OVERLAYS)).toBe(false);
  });

  it('counts all four, so no card is a special case', () => {
    // Named one at a time rather than in a loop over the same list the source
    // uses, because the failure this catches is a fifth overlay arriving and
    // being left out of the union — and a loop over the shipped keys would
    // welcome the omission instead of noticing it.
    expect(anyOverlayUp(only('help'))).toBe(true);
    expect(anyOverlayUp(only('backup'))).toBe(true);
    expect(anyOverlayUp(only('setup'))).toBe(true);
    expect(anyOverlayUp(only('ending'))).toBe(true);
  });

  it('agrees with itself over every combination', () => {
    for (const o of everyCombination()) {
      expect(anyOverlayUp(o)).toBe(KEYS.some((k) => o[k]));
    }
  });
});

describe('the body', () => {
  it('has its controls when nothing is over the world', () => {
    expect(bodyMayAct('fps', NO_OVERLAYS)).toBe(true);
  });

  it('loses them to any one of the four', () => {
    // The one that matters most is `ending`, because it is the only overlay the
    // player did not ask for: it lands on the tick the colony is founded or the
    // ship sails, and until this rule existed it landed on a settler who kept
    // walking. But a card the player *did* open is no different — reading the
    // key list is not a reason to be driving.
    for (const key of KEYS) {
      expect(bodyMayAct('fps', only(key)), `${key} left the body driving`).toBe(false);
    }
  });

  it('has none to lose at the desk', () => {
    // The manager has no body to drive, so this must be false with or without a
    // card — otherwise `app.ts` would start feeding WASD to a settler nobody is
    // standing in the moment an overlay closed.
    for (const o of everyCombination()) {
      expect(bodyMayAct('manager', o)).toBe(false);
    }
  });
});

describe('the pointer', () => {
  it('is handed back exactly when the body stops driving', () => {
    // These two are one decision, not two: any frame where the body is not
    // driving in first person is a frame where the player needs the cursor to
    // answer the card, and any frame where they are driving is a frame the
    // cursor must stay locked away or the mouse stops turning their head.
    for (const o of everyCombination()) {
      expect(pointerMustBeFree('fps', o)).toBe(!bodyMayAct('fps', o));
    }
  });

  it('is never taken from the manager', () => {
    // The manager never locked it, so asking for it back is at best a no-op and
    // at worst a call into the pointer-lock API on a view that has no business
    // touching it.
    for (const o of everyCombination()) {
      expect(pointerMustBeFree('manager', o)).toBe(false);
    }
  });

  it('stays locked while the world is uncovered', () => {
    for (const mode of MODES) expect(pointerMustBeFree(mode, NO_OVERLAYS)).toBe(false);
  });
});
