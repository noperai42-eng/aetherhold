/**
 * The right-hand column, and the fact that it is a column.
 *
 * Three panels hang off `right: 8px`. Two of them drop from the top bar —
 * `#goals`, which says what to do next, and `#inspector`, which is whoever is
 * selected — and the third, `#alerts`, stands up from the build bar and says
 * what is still wrong. None of them had any way to know the other two were
 * there, so the column was three independent claims on the same 800 pixels and
 * the tallest one won.
 *
 * Measured at 1280 by 800 with a colony on fire, raided, out of food and two
 * settlers down: `#goals` had no ceiling of any kind and covered the alert
 * strip until three of its eleven rows were left; with a settler selected
 * instead, `#inspector` ran 712px down through a build bar standing at y703 and
 * the strip covered its bottom 368px, so the card's own Possess button was
 * behind an opaque panel. Both of those photograph as a tidy screen — the
 * covering panel looks correct, and nothing on it says it is standing on
 * something.
 *
 * So the rule, and deliberately about the *column* rather than about the two
 * panels that were caught: anything anchored to the top of this column takes
 * its ceiling from what the strip below is currently using. `hud.ts` measures
 * the strip and publishes it as `--alerts-h`, the same trick it already plays
 * for the top bar and the build bar, and it reads zero whenever the colony is
 * fine and the strip is not on screen at all — which is the case where the
 * panels above should have the whole column back.
 *
 * The fallback in `var(--alerts-h, 0px)` fails open on purpose, because a
 * missing variable must not collapse a panel to nothing. That makes deleting
 * the publisher a silent, screenshot-clean regression, which is why the first
 * test here is about `hud.ts` rather than about the stylesheet.
 *
 * Read with `node:fs` for the stylesheet, like `phone-layout.test.ts`: Vite owns
 * `.css` and `?raw` hands back the empty string, and a guard that reads nothing
 * and passes is worse than no guard.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../src/client/ui/style.css', import.meta.url), 'utf8');
const HUD = readFileSync(new URL('../src/client/ui/hud.ts', import.meta.url), 'utf8');

interface Rule {
  readonly selectors: readonly string[];
  readonly body: string;
}

/** The stylesheet as a flat list of rules, comments stripped first. */
function rules(css: string): Rule[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  for (const m of bare.matchAll(/(^|\})([^{}]+)\{([^{}]*)\}/g)) {
    out.push({
      selectors: m[2]!.split(',').map((s) => s.trim()).filter(Boolean),
      body: m[3]!,
    });
  }
  return out;
}

const RULES = rules(CSS);

/**
 * Every rule that pins a panel to the right edge and hangs it from the top bar.
 * Found rather than listed, so a fourth panel that joins the column inherits the
 * rule instead of quietly reintroducing the bug.
 */
const HANGING = RULES.filter(
  (r) =>
    /right:\s*8px/.test(r.body) &&
    /top:\s*calc\(var\(--topbar-h/.test(r.body) &&
    !r.selectors.some((s) => s.includes('.phone')),
);

describe('the panels that share the right edge share the room', () => {
  it('finds the panels that hang in this column, so this file is not guarding an empty set', () => {
    // Named individually as well as swept: if a refactor renames or moves one,
    // the sweep below would go green on a smaller set and say nothing.
    const named = HANGING.flatMap((r) => r.selectors);
    expect(named).toContain('#goals');
    expect(named).toContain('#inspector');
  });

  it('gives every one of them a ceiling that stops above the alert strip', () => {
    const unbounded = HANGING.filter((r) => !/max-height:/.test(r.body)).flatMap(
      (r) => r.selectors,
    );
    expect(unbounded, 'these panels would grow until the window stopped them').toEqual([]);
    const deaf = HANGING.filter((r) => !/var\(--alerts-h/.test(r.body)).flatMap((r) => r.selectors);
    expect(deaf, 'these panels would be drawn over the alert strip').toEqual([]);
  });

  it('gives every one of them a ceiling that stops above the build bar', () => {
    // The inspector had a ceiling that cleared the top bar and nothing else, so
    // its Possess button sat behind the build bar rather than off the window —
    // unreachable in exactly the way the ceiling was added to prevent.
    const overBar = HANGING.filter((r) => !/var\(--buildbar-h/.test(r.body)).flatMap(
      (r) => r.selectors,
    );
    expect(overBar, 'these panels would run down behind the build bar').toEqual([]);
  });

  it('scrolls what it can no longer show, rather than trimming it', () => {
    const silent = HANGING.filter((r) => !/overflow(-y)?:\s*(auto|scroll)/.test(r.body)).flatMap(
      (r) => r.selectors,
    );
    // `#inspector` takes its overflow from the rule that gives it a resize grip
    // rather than from its own block, so this asks the whole sheet per selector
    // rather than the one rule the sweep found it in.
    const reallySilent = silent.filter(
      (sel) =>
        !RULES.some(
          (r) => r.selectors.includes(sel) && /overflow(-y)?:\s*(auto|scroll)/.test(r.body),
        ),
    );
    expect(reallySilent, 'these panels would cut their content with no way to reach it').toEqual([]);
  });
});

describe('the height the column subscribes to is measured, not guessed', () => {
  it('publishes the alert strip’s real height from hud.ts', () => {
    // The stylesheet's `var(--alerts-h, 0px)` fails open, which is right for a
    // missing variable and wrong for a deleted publisher: without this, both
    // ceilings quietly become the whole column again and the screenshot looks
    // fine. So the publisher is pinned here rather than left to convention.
    expect(HUD).toContain("this.root.style.setProperty('--alerts-h'");
    expect(HUD).toContain('this.alertPanel.getBoundingClientRect().height');
  });

  it('keeps the variable up to date as the strip grows and shrinks', () => {
    // A one-shot read at construction would be measured once, on an empty
    // colony, and be wrong for the whole rest of the game.
    expect(HUD).toMatch(/new ResizeObserver\(publishAlertsHeight\)\.observe\(this\.alertPanel\)/);
  });

  it('measures the same way the two bars it copies are measured', () => {
    // Three publishers, one shape. A fourth that invents its own is the drift
    // this asks about.
    const observers = [...HUD.matchAll(/new ResizeObserver\((publish\w+)\)/g)].map((m) => m[1]!);
    expect(observers).toEqual(['publishBarHeight', 'publishBuildHeight', 'publishAlertsHeight']);
  });
});
