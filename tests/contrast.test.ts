/**
 * What the panels are actually legible against.
 *
 * Every panel in this HUD is `rgba(14, 19, 26, 0.82)` with a blur behind it, so
 * nothing in the interface is ever drawn on the colour it names. What a word
 * sits on is that panel mixed with whatever the world is doing underneath —
 * eighteen per cent of it — and the world changes colour four times a year and
 * again every time the camera drops to eye height. That is why this file exists
 * and why it derives rather than asserts a hand-written table: a token that
 * reads perfectly in a screenshot of a spring afternoon can fail in the snow,
 * which is the season the urgent alerts fire in.
 *
 * The stylesheet is read with `node:fs` for the reason `tests/phone-layout.ts`
 * gives: Vite owns `.css`, and `?raw` on a stylesheet comes back as the empty
 * string, so a guard built on the glob would read nothing and pass.
 *
 * The maths is WCAG 2.1: sRGB channel to linear light, luminance, then the
 * (L+0.05) ratio. It is spelled out here rather than pulled in, because the
 * whole point of the file is that the number is derived from the colours in the
 * sheet rather than eyeballed off a frame.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../src/client/ui/style.css', import.meta.url), 'utf8');

// ------------------------------------------------------------------ the maths

type RGB = [number, number, number];

/** One 0-255 channel to linear light. The 0.04045 knee is the sRGB transfer curve. */
function toLinear(channel8: number): number {
  const c = channel8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, WCAG 2.1 — the coefficients are the sRGB primaries in Y. */
function luminance([r, g, b]: RGB): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrast(fg: RGB, bg: RGB): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `fg` at `alpha` painted over `bg`, rounded back to eight bits — which is what
 * the compositor hands the screen, and therefore what a contrast reading of a
 * screenshot would find.
 */
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return [0, 1, 2].map((i) => Math.round(alpha * fg[i]! + (1 - alpha) * bg[i]!)) as RGB;
}

/** `#rrggbb` or `rgba(r, g, b, a)` to a colour and its alpha. */
function parse(value: string): { rgb: RGB; alpha: number } {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const fn = value.trim().match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/);
  if (!fn) throw new Error(`cannot read the colour "${value}"`);
  return {
    rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])] as RGB,
    alpha: fn[4] === undefined ? 1 : Number(fn[4]),
  };
}

// ------------------------------------------------------------ reading the sheet

/** The declared value of a custom property on `:root`. */
function token(name: string): string {
  const m = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`));
  expect(m, `--${name} has gone from the palette`).not.toBeNull();
  return m![1]!.trim();
}

/**
 * The body of the block whose head begins at `from`, braces counted — so it
 * works on an at-rule with rules inside it as well as on a plain rule.
 */
function block(from: number): string {
  const open = CSS.indexOf('{', from);
  expect(open, 'no block opens after that point in the stylesheet').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(open + 1, i);
  }
  throw new Error('unclosed block in style.css');
}

/** The declarations of the rule with exactly this selector list, comments out. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = bare.search(new RegExp(`(^|[};])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm'));
  expect(at, `no rule in style.css has the selector "${selector}"`).toBeGreaterThan(-1);
  const open = bare.indexOf('{', at);
  return bare.slice(open + 1, bare.indexOf('}', open));
}

/** The `opacity` a rule sets, or 1 if it sets none. */
function opacityOf(selector: string): number {
  const m = rule(selector).match(/opacity:\s*([\d.]+)/);
  return m ? Number(m[1]) : 1;
}

// -------------------------------------------------------------- the backdrops

/**
 * The ground under the panels, sampled out of the round-8 frames. The first is
 * the one that matters: a lighter backdrop is a worse one for light text, so
 * snow and pale sand set the bar and everything else has slack. It is kept a
 * list of four anyway, because a change that helped the snow at the dusk
 * frame's expense is exactly the kind of thing a single sample hides.
 */
const GROUND: ReadonlyArray<readonly [string, RGB]> = [
  ['snow and pale sand, the brightest ground the game draws', [156, 185, 124]],
  ['summer grass, which is most of what a panel sits on', [125, 140, 95]],
  ['the valley from a settlers eye height, in first person', [124, 152, 180]],
  ['the same valley at dusk', [50, 52, 30]],
];

/** A panel over one of those: the surface every word in the HUD is really on. */
function panelOver(ground: RGB): RGB {
  const panel = parse(token('panel'));
  return over(panel.rgb, panel.alpha, ground);
}

// ------------------------------------------------------------------ functional

describe('what a panel is legible against', () => {
  /*
   * The 4.5 set is text a player reads as a sentence or a number: names, counts,
   * costs, alerts, log lines. --bad is here rather than in the 3.0 set on
   * purpose — its headline job is the urgent alert at 11.5px weight 600, which
   * is under the 18.66px WCAG calls large, so it gets the body-text bar.
   */
  const BODY = ['ink', 'dim', 'good', 'bad', 'warn', 'threat', 'edge-strong'];

  for (const name of BODY) {
    for (const [where, ground] of GROUND) {
      it(`keeps --${name} above 4.5:1 over ${where}`, () => {
        const bg = panelOver(ground);
        const fg = parse(token(name));
        expect(fg.alpha, `--${name} is translucent, so it is not a colour but a multiplier`).toBe(
          1,
        );
        expect(contrast(fg.rgb, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  /*
   * The 3.0 set is the two glyphs that are controls rather than reading: the ✕
   * that dismisses a docket row or the tutorial, and the grip that says a panel
   * can be dragged. WCAG holds a non-text control to 3:1, and holding these to
   * 4.5 would make them as loud as the text they sit beside — which is the
   * thing the old opacity was trying, badly, to avoid.
   */
  const CONTROL: ReadonlyArray<readonly [string, string]> = [
    ['the dismiss glyph on a docket row and on the goals banner', '#7f878f'],
    ['the drag grip on a movable panel', 'rgba(154, 163, 173, 0.85)'],
  ];

  for (const [what, value] of CONTROL) {
    for (const [where, ground] of GROUND) {
      it(`keeps ${what} above 3:1 over ${where}`, () => {
        const bg = panelOver(ground);
        const fg = parse(value);
        expect(contrast(over(fg.rgb, fg.alpha, bg), bg)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('still uses both of those colours, so the thresholds above are about something', () => {
    expect(CSS).toContain('#7f878f');
    expect(CSS).toContain('rgba(154, 163, 173, 0.85)');
  });

  it('holds --bad to the bar it only just clears', () => {
    // The token was #e0745f and measured 4.36:1 on the brightest backdrop, which
    // is the reading that moved it. This asserts the direction as well as the
    // floor: a red that drifts back down a shade fails here rather than in
    // somebody's winter.
    const bg = panelOver(GROUND[0]![1]);
    expect(contrast(parse('#e0745f').rgb, bg)).toBeLessThan(4.5);
    expect(contrast(parse(token('bad')).rgb, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('never lets --edge, which is a border, be used as ink', () => {
    // 35% amber composites to about 2:1 on a panel. It was the colour of the ✕
    // that switches the whole tutorial off, and it is the one token in the file
    // whose name does not say what it is for.
    const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const asInk = [...bare.matchAll(/(^|[;{])\s*color:\s*var\(--edge\)/g)];
    expect(asInk.map((m) => m[0]), '--edge is a border token').toEqual([]);
  });
});

// ------------------------------------------------------------------ experience

describe('the rules a player actually meets', () => {
  /*
   * Every one of these dimmed its text with `opacity`, which states a multiplier
   * over whatever ink is beneath it rather than the colour it wants. On --ink a
   * multiplier survives; on --dim, which has about three quarters of a stop of
   * headroom on the brightest backdrop, it does not. The worst was the build
   * tile: the cost line is the answer to "why can't I build a wall?" and it was
   * at 2.2:1.
   */
  const WAS_MULTIPLIED = [
    '.tile.no',
    '#researchtab .proj.locked',
    '#tradetab .deal.locked, #roadtab .deal.locked',
    '#inspector .sect',
    '#inspector .stack-head',
    '#inspector .stack-n',
    '#inspector .stack-at',
    '.bd-x',
  ];

  for (const selector of WAS_MULTIPLIED) {
    it(`states a colour rather than a factor on ${selector}`, () => {
      expect(opacityOf(selector), `${selector} is dimming its text by multiplying again`).toBe(1);
    });
  }

  it('gives the unaffordable tile its three colours by name', () => {
    // The tile sinks by carrying a fainter border and less fill; what is written
    // on it says what colour it is. The cost is --bad rather than merely quiet,
    // because the cost is the thing that is wrong.
    expect(rule('.tile.no .lbl')).toMatch(/color:\s*var\(--dim\)/);
    expect(rule('.tile.no .key')).toMatch(/color:\s*rgba\(214, 168, 92, 0\.55\)/);
    expect(rule('.tile.no .cost')).toMatch(/color:\s*var\(--bad\)/);
  });

  it('gives the settler strip a ceiling and somewhere for the overflow to go', () => {
    // hud.ts appends one card per living settler with no bound, and the win
    // condition asks for eight. Without both of these the eighth card is drawn
    // off the bottom of the screen where it cannot be clicked at all.
    const strip = rule('#colonists');
    expect(strip, 'the strip can grow past the screen').toMatch(/max-height:/);
    expect(strip, 'the strip has a ceiling and no way to reach what is under it').toMatch(
      /overflow-y:\s*auto/,
    );
  });

  it('leaves the tutorial ✕ a colour and a target instead of a border token', () => {
    const off = rule('.goalhead a.off');
    expect(off, 'the ✕ that deletes the tutorial is back to 2:1').not.toMatch(
      /color:\s*var\(--edge\)/,
    );
    // The padding is what makes the box; the negative margin is what keeps the
    // header row from growing when the box does.
    expect(off).toMatch(/padding:\s*6px 8px/);
    expect(off).toMatch(/margin:\s*-6px/);
  });

  it('sizes touch targets from the pointer rather than from the screen width', () => {
    // Every 44px rule in the file is behind #hud.phone, and #hud.phone is set
    // from a screen-size test — so a tablet, which is a screen full of fingers,
    // was getting the 22px desk buttons for all eighteen destinations in the
    // top bar.
    const at = CSS.indexOf('@media (pointer: coarse)');
    expect(at, 'nothing in the sheet sizes a target by the input device').toBeGreaterThan(-1);
    const coarse = block(at);
    expect(coarse).toContain('#speeds button');
    expect(coarse).toContain('.btn');
    expect(coarse).toMatch(/min-height:\s*44px/);
    expect(coarse).toMatch(/min-width:\s*44px/);
  });

  it('caps the two draggable panels against the viewport, not at a fixed height', () => {
    // Both get `resize: both`, and the help card tells the player to drag them.
    // An inline height written by the resize grip loses to a max-height, so a
    // flat 132px or 216px swallowed the drag silently — the grip moved and the
    // panel did not.
    for (const id of ['#log', '#alerts']) {
      const cap = rule(id).match(/max-height:\s*([^;]+);/);
      expect(cap, `${id} has no ceiling at all`).not.toBeNull();
      expect(cap![1], `${id} is capped at a fixed height its resize grip cannot beat`).toMatch(
        /vh|100vh|var\(--/,
      );
    }
  });

  it('leaves the minimap face to minimap.ts', () => {
    // The phone layout used to force the canvas to 96px with !important, which
    // drew a desk-sized bitmap scaled down. minimap.ts now draws its face at the
    // size it is shown at; an override here would fight that and win.
    expect(CSS, 'the stylesheet is overriding the map face again').not.toMatch(
      /#minimap canvas\s*\{[^}]*!important/,
    );
  });
});
