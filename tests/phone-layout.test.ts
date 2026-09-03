/**
 * One HUD, two presentations — checked rather than trusted.
 *
 * The phone layout is a stylesheet and one class. That is the whole point of it:
 * there is no second HUD, no second set of panels and no second code path
 * drawing them, so nothing can drift out of step with the desk layout. But it
 * buys that with a promise the stylesheet has to keep — every rule the phone
 * needs is scoped to `#hud.phone` — and a promise a stylesheet keeps by
 * convention is a promise that lasts until the next hurried edit. One unscoped
 * `position: fixed` reaches every desk in the world and there is no test run,
 * no type error and no console line to say so. So the section is read as text
 * and the scoping is asserted.
 *
 * The other half is the bar: five destinations that each have to *raise*
 * something. A destination whose name does not match any rule is a button that
 * lights up and does nothing, which is the one failure here that looks fine in
 * a screenshot — the tab goes on, the world stays clear, and the panel the
 * player asked for is still at `opacity: 0`.
 *
 * The stylesheet is read with `node:fs` rather than the raw glob
 * `architecture.test.ts` uses: Vite owns `.css`, and `?raw` on a stylesheet
 * comes back as the empty string — a guard that reads nothing and passes is
 * worse than no guard. The TypeScript beside it still goes through the glob.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { isPhoneLayout } from '../src/client/ui/layout-mode';

const CSS = readFileSync(new URL('../src/client/ui/style.css', import.meta.url), 'utf8');

const HUD = Object.values(
  import.meta.glob('../src/client/ui/hud.ts', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

/** Where the phone section starts. Everything above it is the desk layout. */
const BANNER = 'the phone layout';

/**
 * The two selectors in the phone section that are allowed to stand unscoped,
 * because they name elements that exist only for the phone bar and are hidden
 * by default. Anything else unscoped would reach a desk.
 */
const NOT_SCOPED = ['#tabbar', '.sheetbtn'];

function phoneSection(): string {
  const at = CSS.indexOf(BANNER);
  expect(at, `the phone section banner ("${BANNER}") has gone from style.css`).toBeGreaterThan(0);
  // From the end of the banner comment: slicing at the banner itself would cut
  // the comment's own opening `/*` off and leave its prose to be read as CSS.
  return CSS.slice(CSS.indexOf('*/', at) + 2);
}

/** Every selector in a block of CSS, comments and declarations stripped. */
function selectors(css: string): string[] {
  const out: string[] = [];
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/(^|\})([^{}]+)\{/g)) {
    const head = m[2]!.trim();
    // Skip at-rule preludes: `@media (...)` opens a block but selects nothing.
    if (head.startsWith('@') || head === '') continue;
    for (const one of head.split(',')) out.push(one.trim());
  }
  return out;
}

// ------------------------------------------------------------------ functional

describe('which presentation a device gets', () => {
  const win = (coarse: boolean, w: number, h: number): Window =>
    ({
      matchMedia: (q: string) => ({ matches: q.includes('coarse') ? coarse : false }),
      screen: { width: w, height: h },
      innerWidth: w,
      innerHeight: h,
    }) as unknown as Window;

  it('gives a phone the phone layout', () => {
    expect(isPhoneLayout(win(true, 390, 844))).toBe(true);
  });

  it('gives the same phone the same layout turned on its side', () => {
    // The rule reads the short side, not the width. A layout that rearranges
    // itself on rotation moves the button out from under the thumb reaching
    // for it, which is worse than either layout being slightly wrong.
    expect(isPhoneLayout(win(true, 844, 390))).toBe(true);
  });

  it('leaves a tablet on the desk layout', () => {
    // A finger is coarse on an iPad too, and an iPad has the room.
    expect(isPhoneLayout(win(true, 768, 1024))).toBe(false);
  });

  it('leaves a touchscreen laptop on the desk layout', () => {
    expect(isPhoneLayout(win(true, 1512, 945))).toBe(false);
  });

  it('leaves a small window on a mouse-driven machine alone', () => {
    // A desk window dragged narrow is still a desk: there is a cursor on it,
    // and the panels the player has arranged must not be swept into sheets.
    expect(isPhoneLayout(win(false, 420, 700))).toBe(false);
  });
});

// ------------------------------------------------------------------ experience

describe('the phone layout cannot reach a desk', () => {
  it('scopes every rule it adds to #hud.phone', () => {
    const loose = selectors(phoneSection()).filter(
      (s) => !s.includes('#hud.phone') && !NOT_SCOPED.some((ok) => s.startsWith(ok)),
    );
    expect(loose, 'these phone rules would apply to a desktop browser').toEqual([]);
  });

  it('keeps the two bar-only selectors hidden by default', () => {
    // They are unscoped, so the desk sees them too — and must see nothing.
    expect(CSS).toMatch(/#tabbar\s*\{\s*display:\s*none;\s*\}/);
  });
});

describe('every destination on the bar raises something', () => {
  // Sliced to the SHEETS table: hud.ts has other `['key', 'Label']` tables.
  const start = HUD.indexOf('const SHEETS');
  const table = HUD.slice(start, HUD.indexOf('];', start));
  const keys = [...table.matchAll(/\['(\w+)', '[^']+'\]/g)].map((m) => m[1]!);

  it('finds the five sheets declared in hud.ts', () => {
    expect(keys).toEqual(['build', 'crew', 'events', 'info', 'more']);
  });

  for (const key of ['build', 'crew', 'events', 'info', 'more']) {
    it(`has a rule that shows the ${key} sheet`, () => {
      expect(phoneSection()).toContain(`[data-sheet='${key}']`);
    });
  }

  it('leaves no manager panel unreachable', () => {
    // Every panel the desk layout puts on screen at once has to be behind one
    // of the five destinations, or a phone player simply cannot see it. The
    // goals banner is the exception and stays on the glass: it is the tutorial,
    // and a tutorial you have to go looking for is not one.
    const section = phoneSection();
    for (const id of ['#buildbar', '#colonists', '#log', '#alerts', '#inspector', '#sysbtns']) {
      expect(section, `${id} is on no sheet`).toMatch(
        new RegExp(`\\[data-sheet='\\w+'\\][^{]*${id}`),
      );
    }
  });
});

describe('the phone is never told about hardware it has not got', () => {
  it('routes every shortcut in a button label through the key helper', () => {
    // `Work (P)` on a phone is an instruction for a keyboard the reader does not
    // have, and it is the label a hurried edit will re-hardcode: the parenthesis
    // is the right answer on every other machine, so it looks correct in the
    // source and wrong only on the one screen nobody is testing on.
    const hard = [...HUD.matchAll(/'([A-Za-z][A-Za-z ]* \([A-Za-z;'`]\))'/g)].map((m) => m[1]!);
    expect(hard, 'these labels name a key without asking the layout first').toEqual([]);
  });

  it('keeps the keyboard tables out of the phone help card', () => {
    // The card is the first thing a new player reads. On a phone the keyboard
    // half is forty lines naming keys, a wheel and two mouse buttons — none of
    // which exist — before anything says what the five words along the bottom
    // of their screen do.
    expect(HUD).toMatch(/const controls = this\.phone\s*\?\s*bar\s*:/);
    // And the desk keeps them: a phone-shaped card everywhere is the same bug
    // pointed the other way.
    expect(HUD).toContain('KEYS_COLONY');
    expect(HUD).toContain('KEYS_FPS');
  });
});
