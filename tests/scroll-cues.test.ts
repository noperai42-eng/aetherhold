/**
 * A panel that clips its content has to say so.
 *
 * This is a phone problem specifically, and the reason is worth writing down
 * because it is the whole argument for the rule below. On the desk, a panel
 * that overflows announces it twice: the scrollbar appears, and the panel can
 * be dragged bigger by a grip that is always there. The phone has neither.
 * `#hud.phone #topbar::-webkit-scrollbar` hides the bar, `scrollbar-width:
 * none` hides it everywhere else, and `makeMovable` returns early on a phone
 * because there is nowhere to move a panel to. So a phone panel that clips its
 * content clips it in silence, and the only evidence reaching the player is a
 * sentence that stops mid-word.
 *
 * That is not a hypothetical. One round of photographs at 390 by 844 caught
 * three of them at once: the top bar cut the clock to "12:0" and stopped; the
 * next-steps panel ended on "Steel is what everything after this costs" with
 * the rest of the sentence below the fold; and the build sheet showed four of
 * its eleven categories, so seven whole tabs of things to build were reachable
 * only by a swipe that nothing on the screen suggested. Every one of those
 * reads as a broken layout rather than as a panel with more inside it.
 *
 * So the invariant, and it is deliberately about the *class* rather than about
 * the three panels that were caught: every phone-scoped rule that turns on
 * scrolling in an axis must also carry a fade in that axis. A future panel that
 * clips fails here rather than in a screenshot somebody takes six rounds later.
 *
 * The stylesheet is read with `node:fs` rather than through Vite's `?raw`,
 * which comes back as the empty string for a `.css` file — a guard that reads
 * nothing and passes is worse than no guard. `phone-layout.test.ts` learned
 * this first; this file follows it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../src/client/ui/style.css', import.meta.url), 'utf8');

const HUD = Object.values(
  import.meta.glob('../src/client/ui/hud.ts', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

interface Rule {
  readonly selectors: readonly string[];
  readonly body: string;
}

/**
 * The stylesheet as a flat list of rules.
 *
 * Comments come out first, because they are full of the words the assertions
 * below look for — this file's own reasoning quotes `overflow-x: auto` at least
 * twice — and a guard that matches its own explanation is a guard that cannot
 * fail. Nesting is not handled because the stylesheet has none; `@media` blocks
 * would need it, and if one ever appears this parser will see its contents as
 * top-level rules, which is wrong in a way that shows up as a failure here
 * rather than as a silent pass.
 */
function rules(css: string): Rule[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter((s) => s.length > 0 && !s.startsWith('@'));
    if (selectors.length > 0) out.push({ selectors, body: m[2]! });
  }
  return out;
}

const RULES = rules(CSS);

/** Which way a rule lets its content run past the edge, if it lets it at all. */
function scrolls(body: string): ReadonlyArray<'x' | 'y'> {
  const axes: Array<'x' | 'y'> = [];
  for (const m of body.matchAll(/overflow(-x|-y)?\s*:\s*(auto|scroll)/g)) {
    const axis = m[1];
    if (axis === '-x') axes.push('x');
    else if (axis === '-y') axes.push('y');
    else axes.push('x', 'y');
  }
  return axes;
}

/** Which way a rule fades out, if it fades at all. */
function fades(body: string): ReadonlyArray<'x' | 'y'> {
  const axes: Array<'x' | 'y'> = [];
  for (const m of body.matchAll(/mask-image\s*:\s*linear-gradient\(\s*to (right|left|bottom|top)/g)) {
    axes.push(m[1] === 'right' || m[1] === 'left' ? 'x' : 'y');
  }
  return axes;
}

describe('the phone tells you when it has cut something off', () => {
  /**
   * A selector can be written more than once — the top bar sets its overflow in
   * the rule that lays it out and takes its fade from the rule that groups
   * every sideways-scrolling thing together — so the two have to be gathered
   * across the whole sheet before they can be compared.
   */
  const scrollAxes = new Map<string, Set<string>>();
  const fadeAxes = new Map<string, Set<string>>();
  for (const rule of RULES) {
    for (const sel of rule.selectors) {
      if (!sel.includes('.phone')) continue;
      for (const a of scrolls(rule.body)) {
        if (!scrollAxes.has(sel)) scrollAxes.set(sel, new Set());
        scrollAxes.get(sel)!.add(a);
      }
      for (const a of fades(rule.body)) {
        if (!fadeAxes.has(sel)) fadeAxes.set(sel, new Set());
        fadeAxes.get(sel)!.add(a);
      }
    }
  }

  it('finds the phone panels that scroll, so this file is not guarding an empty set', () => {
    // The three that were caught by eye, named individually: if a refactor
    // renames or drops one of them, the sweep below would go quietly green on a
    // smaller set and this says so instead.
    expect([...scrollAxes.keys()]).toContain('#hud.phone #topbar');
    expect([...scrollAxes.keys()]).toContain('#hud.phone #buildbar .bartabs');
    expect([...scrollAxes.keys()]).toContain('#hud.phone #goals');
    expect(scrollAxes.size).toBeGreaterThanOrEqual(12);
  });

  it('fades every phone panel that scrolls, in the axis it scrolls', () => {
    const silent: string[] = [];
    for (const [sel, axes] of scrollAxes) {
      const fade = fadeAxes.get(sel) ?? new Set<string>();
      for (const axis of axes) if (!fade.has(axis)) silent.push(`${sel} (${axis})`);
    }
    // Named rather than counted, because the useful failure here is *which*
    // panel went quiet, and a bare number sends the next person back to the
    // stylesheet to work it out again.
    expect(silent).toEqual([]);
  });

  it('fades sideways by more than it fades downward, because a cut glyph is worse than a cut line', () => {
    // A word chopped in half mid-letter reads as damage; a paragraph whose last
    // line goes soft reads as a paragraph that continues. So the horizontal
    // fade is the longer of the two, and this pins the relationship rather than
    // either number, since both are still being tuned by eye.
    const across = CSS.match(/to right, #000 calc\(100% - (\d+)px\)/);
    const down = CSS.match(/to bottom, #000 calc\(100% - (\d+)px\)/);
    expect(across).not.toBeNull();
    expect(down).not.toBeNull();
    expect(Number(across![1])).toBeGreaterThan(Number(down![1]));
  });
});

describe('the desk card, whose footer is stuck to its floor', () => {
  /**
   * The one place on the desk with the same defect, and it has it for a
   * different reason: `.card .acts` is opaque and `position: sticky`, so it is
   * not the window edge that cuts the text but a button row sitting on top of
   * it. On an 800-tall window that cut lands immediately under the heading "How
   * a run ends", so the section that explains how the game is won photographs
   * as a heading with nothing beneath it.
   */
  it('fades the text sliding under the sticky button row', () => {
    const rule = RULES.find((r) => r.selectors.includes('.card .acts::before'));
    expect(rule).toBeDefined();
    expect(rule!.body).toMatch(/bottom:\s*100%/);
    expect(rule!.body).toMatch(/linear-gradient\(to top, var\(--panel-solid\), transparent\)/);
    expect(rule!.body).toMatch(/pointer-events:\s*none/);
  });

  it('keeps the button row itself opaque, so the fade is over the text and not over the buttons', () => {
    const acts = RULES.find((r) => r.selectors.includes('.card .acts'));
    expect(acts).toBeDefined();
    expect(acts!.body).toMatch(/position:\s*sticky/);
    expect(acts!.body).toMatch(/background:\s*var\(--panel-solid\)/);
  });
});

describe('a key you can see is a key you can press', () => {
  /**
   * Four of the seventeen colony bindings are one thin glyph: the apostrophe
   * for the work board, the semicolon for the story, the backtick for a Picky,
   * and the erase glyph for cancel. Set bare in twelve-pixel mono on a dark
   * panel each of those is three or four lit pixels, so the row beside it reads
   * as an action with no key at all.
   */
  it('sets every key in the help card on a plate', () => {
    const dt = RULES.find((r) => r.selectors.includes('.card dt'));
    expect(dt).toBeDefined();
    expect(dt!.body).toMatch(/border:\s*1px solid/);
    expect(dt!.body).toMatch(/background:\s*rgba/);
    // Otherwise the plate is 132 pixels wide whatever it holds, which turns a
    // key column into a column of boxes.
    expect(dt!.body).toMatch(/justify-self:\s*start/);
  });

  it('does not put a plate round the phone card, which has no keys in it', () => {
    // The phone help card describes gestures and tabs, so its terms are "Build",
    // "Two fingers", "Inside a body" — words, legible in amber, that would only
    // look like buttons if they were boxed. Fixing a desk problem on a phone
    // that does not have it is how a fix becomes a regression.
    const phone = RULES.find((r) => r.selectors.includes('#hud.phone .card dt'));
    expect(phone).toBeDefined();
    expect(phone!.body).toMatch(/border:\s*0/);
    expect(phone!.body).toMatch(/background:\s*none/);
  });

  it('still has the four single-glyph keys the plate was cut for', () => {
    expect(HUD).toContain("<dt>'</dt>");
    expect(HUD).toContain('<dt>;</dt>');
    expect(HUD).toContain('<dt>\\`</dt>');
    expect(HUD).toContain('⌫');
  });

  it('reserves the hotkey line on a blueprint tile that has no hotkey', () => {
    // Eleven blueprints hold a digit and the rest hold nothing, which is right:
    // there are more things to build than there are keys to build them with.
    // But an empty block is a block of no height, so the Fence tile pulled its
    // label up a line and sat out of step with the Wall and the Door either
    // side of it.
    const key = RULES.find((r) => r.selectors.includes('.tile .key'));
    expect(key).toBeDefined();
    expect(key!.body).toMatch(/min-height:/);
  });
});

describe('numbers that are read as numbers', () => {
  it('capitalises the watts like every other heading in the resource strip', () => {
    // Eight resources come out of RESOURCE_LABEL capitalised and the ninth cell
    // is written by hand, which is exactly how it came to be the only lowercase
    // word in the top bar of the game.
    expect(HUD).toContain('<i>Power</i>');
    expect(HUD).not.toContain('<i>power</i>');
  });

  it('does not put a comma between a cell x and a cell y', () => {
    // Every other number in this HUD is a quantity, so a comma between two of
    // them is read as a thousands separator: the cell at 86, 103 came out as
    // "86,103", which is a number a colony could plausibly have of something.
    expect(HUD).toContain('${job.tx} · ${job.ty}');
    expect(HUD).not.toContain('${job.tx},${job.ty}');
  });
});
