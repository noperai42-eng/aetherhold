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

/**
 * The panels allowed to answer this differently, each paired with the rule that
 * earns it the exemption. Both have a sticky footer that says *what* is below the
 * fold — `+N more` on the strip, the row of buttons on a card — which is strictly
 * more than a fade says. A mask over either would fade out the one line on the
 * panel whose whole job is to be read, and on the phone it did exactly that: the
 * strip's count row came out dimmer than the rows it was counting. Neither
 * exemption is taken on trust; a test below makes each prove its footer is there.
 */
const ANSWERS_DIFFERENTLY: ReadonlyArray<readonly [string, string]> = [
  ['#alerts', '.alert.more'],
  ['.card', '.card .acts'],
];

/** Whether a selector names one of the panels that answers differently. */
function answersDifferently(sel: string): boolean {
  return ANSWERS_DIFFERENTLY.some(([p]) => sel === p || sel.endsWith(` ${p}`));
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
      if (answersDifferently(sel)) continue;
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

/**
 * The desk was supposed to be exempt from all of this, and is not.
 *
 * The argument at the top of this file is that the phone needs a fade because it
 * has no scrollbar and no resize grip. The desk has both, so the desk was left
 * alone — and then round fifteen gave `#goals` and `#inspector` measured
 * ceilings, they began landing on the middle of a line, and the frames showed a
 * sentence sliced through its glyphs with nothing whatsoever to say why.
 *
 * The reason the scrollbar did not save it: on macOS these are overlay
 * scrollbars, drawn while you scroll and invisible until then. The cue that
 * would tell a player to scroll only appears once they already have. So the
 * desk needs the same twenty pixels the phone has had for rounds.
 *
 * The class matters as much as the fade. These panels shrink to their contents,
 * so a settler card short enough to fit would have its last line faded for no
 * reason — the same lie pointed the other way, promising more where there is
 * none. `hud.ts` puts the class on from three numbers and takes it off again.
 */
describe('the desk tells you too, now that it has ceilings to hit', () => {
  /**
   * Every desk panel that has been given a ceiling and told to scroll under it —
   * which is to say, every panel on the desk that is able to cut a line in half.
   * Swept rather than listed, so the next panel to get a ceiling inherits the
   * obligation instead of quietly reintroducing the bug.
   */
  const CAPPED = [...new Set(RULES.flatMap((r) => r.selectors))].filter(
    (sel) =>
      !sel.includes('.phone') &&
      !sel.includes('.clipped') &&
      // Per selector across the whole sheet rather than per rule: `#alerts` caps
      // itself in one rule and takes its overflow from the rule that gives it a
      // resize grip, and a per-rule sweep sees neither half and walks past it.
      RULES.some((r) => r.selectors.includes(sel) && /max-height:/.test(r.body)) &&
      RULES.some((r) => r.selectors.includes(sel) && scrolls(r.body).includes('y')),
  );

  /** Which selectors have a downward fade hung on the clipped class. */
  const faded = new Set(
    RULES.filter((r) => fades(r.body).includes('y'))
      .flatMap((r) => r.selectors)
      .filter((s) => s.endsWith('.clipped'))
      .map((s) => s.slice(0, -'.clipped'.length)),
  );

  it('finds the desk panels that can cut a line, so this is not guarding an empty set', () => {
    expect(CAPPED).toContain('#goals');
    expect(CAPPED).toContain('#inspector');
    expect(CAPPED).toContain('#alerts');
  });

  it('fades the foot of every one of them', () => {
    const silent = CAPPED.filter((s) => !faded.has(s) && !answersDifferently(s));
    // Named rather than counted: the useful failure is which panel went quiet.
    expect(silent, 'these desk panels would cut a line with nothing to say so').toEqual([]);
  });

  it('makes each exemption earn itself', () => {
    // These two skip the mask because they have something better. If either
    // footer stops being sticky the exemption above becomes a silent hole, and
    // this is the line that notices rather than a screenshot six rounds later.
    for (const [panel, footer] of ANSWERS_DIFFERENTLY) {
      const rule = RULES.find((r) => r.selectors.includes(footer));
      expect(rule, `${panel} is exempt on the strength of ${footer}, which is gone`).toBeDefined();
      expect(rule!.body, footer).toMatch(/position:\s*sticky/);
      expect(rule!.body, footer).toMatch(/bottom:/);
    }
  });

  it('keeps the fade off the two panels that answer differently', () => {
    // For these the mask is not merely unnecessary, it is actively wrong, and
    // the exemption above only says they may skip it. This says they must. On
    // the phone the strip carried both for a round: the mask fell across the
    // count row and left `+5 more` dimmer than the five rows it was counting,
    // on a background the map showed through.
    for (const [panel] of ANSWERS_DIFFERENTLY) {
      const masked = RULES.filter((r) => fades(r.body).length > 0)
        .flatMap((r) => r.selectors)
        .filter((sel) => sel === panel || sel.endsWith(` ${panel}`));
      expect(masked, `${panel} says what it cut; a fade over that row buries it`).toEqual([]);
    }
  });

  it('hangs the fade on a class, so a panel that fits is not made to promise more', () => {
    // Straight on `#inspector` this would fade the last line of every short
    // card — an animal, a rock, a settler with three skills — none of which
    // have anything below the fold at all.
    for (const sel of ['#goals', '#inspector']) expect(faded.has(sel)).toBe(true);
    expect(CSS).not.toMatch(/^#goals\s*\{[^}]*mask-image/m);
  });

  it('decides the class from the content, the band and the scroll position together', () => {
    // All three move independently: the content changes when another settler is
    // selected, the band changes when the alert strip grows under it, and the
    // scroll position changes when the player reads to the end — at which point
    // there is nothing left to promise and the fade has to go.
    expect(HUD).toContain(
      "p.classList.toggle('clipped', p.scrollHeight - p.clientHeight - p.scrollTop > 1)",
    );
  });

  it('re-asks whenever any of the three can have changed', () => {
    // A one-shot read at construction is measured once, on an empty colony, and
    // is wrong for the rest of the game.
    expect(HUD).toMatch(/new ResizeObserver\(mark\)\.observe\(p\)/);
    expect(HUD).toMatch(/p\.addEventListener\('scroll', mark, \{ passive: true \}\)/);
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

describe('the alert strip, which has to be able to say it ran out of room', () => {
  /**
   * The third panel with the same defect, and the worst of the three, because
   * here the row that gets cut is the row whose entire job is to report the cut.
   *
   * `alertRows` caps the strip at `MAX_ALERTS` and appends a row counting what
   * it dropped; `alert-panel.test.ts` holds that list to the property that a
   * panel is allowed to run out of room and is not allowed to hide that it did.
   * That file reads the row list rather than the DOM, on purpose, so it could
   * not see what the DOM then did with it: `#alerts` has a viewport-relative
   * ceiling of its own, which at 1280 by 800 shows about seven rows, and the
   * count row is the last child. A colony carrying fifteen standing problems
   * photographed as a colony carrying seven, with nothing on screen saying
   * otherwise — the exact failure the row was added to prevent, one layer down.
   *
   * So this asks the two halves separately: that the panel still emits a row it
   * can be told apart by, and that the stylesheet still sticks that row to the
   * floor. Either one alone goes quietly green while the bug is back.
   */
  it('gives the count row a name the stylesheet can reach', () => {
    // Read out of the source rather than out of a rendered panel, like the help
    // card's keys below: there is no jsdom here, and the class name is the whole
    // of the contract between these two files.
    expect(HUD).toContain("`alert ${a.level}` : 'alert more'");
  });

  it('sticks the count row to the floor of the panel it is counting for', () => {
    const more = RULES.find((r) => r.selectors.includes('.alert.more'));
    expect(more).toBeDefined();
    expect(more!.body).toMatch(/position:\s*sticky/);
    expect(more!.body).toMatch(/background:\s*var\(--panel-solid\)/);
  });

  it('fades the alerts sliding under it, so the cut edge is not a hard line', () => {
    const fade = RULES.find((r) => r.selectors.includes('.alert.more::before'));
    expect(fade).toBeDefined();
    expect(fade!.body).toMatch(/bottom:\s*100%/);
    expect(fade!.body).toMatch(/linear-gradient\(to top, var\(--panel-solid\), transparent\)/);
    expect(fade!.body).toMatch(/pointer-events:\s*none/);
  });

  it('cancels the panel’s own bottom padding, so no row shows through underneath', () => {
    // The sticky row is offset by exactly the padding it has to cover and pays
    // it back as its own, which is the same arithmetic `.card .acts` does at
    // -20px. A mismatch leaves a translucent strip below the row with the
    // scrolled alerts still legible through it.
    const panel = RULES.find((r) => r.selectors.includes('#alerts'))!;
    const more = RULES.find((r) => r.selectors.includes('.alert.more'))!;
    const below = Number(panel.body.match(/padding:\s*\d+px\s+\d+px\s+(\d+)px/)![1]);
    expect(more.body).toMatch(new RegExp(`bottom:\\s*-${below}px`));
    expect(more.body).toMatch(new RegExp(`padding:[^;]*\\s${below}px\\s`));
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
