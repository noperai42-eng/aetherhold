/**
 * The two panels along the bottom of the screen, and what each of them does when
 * it has more to say than it has room for.
 *
 * They had the same bug in two shapes. The alert strip drew the first six rows
 * of a list that is routinely twenty long and then simply stopped — no scroll
 * hint, no count, nothing to tell a player that the list had been cut at all, so
 * a burning colony under raid with four settlers on the floor was never told it
 * had run out of food, because "No food left" was the seventh row. The log
 * sliced a fixed seven messages because the box was a fixed 132px tall, and then
 * the box grew a resize grip and a viewport-relative height and the seven stayed
 * where it was.
 *
 * So the property both halves hold to is the same one: a panel is allowed to run
 * out of room, and is not allowed to hide that it did.
 *
 * These run in node, like the rest of the suite, so they read the panel's own
 * row list rather than its DOM — `alertRows`, `logLines` and `logRows` are the
 * decisions the panels make, pulled out of the browser on purpose so they can be
 * asked.
 */

import { describe, expect, it } from 'vitest';

import { MAX_ALERTS, alertRows, logLines, logRows } from '../src/client/ui/hud';
import { alerts, type Alert } from '../src/sim/alerts';
import { createWorld } from '../src/sim/worldgen';
import { igniteFire } from '../src/sim/events';
import { livingColonists } from '../src/sim/world';
import { BREAK_MOOD } from '../src/sim/needs';
import type { Message, World } from '../src/sim/types';

/** A list of alerts with nothing behind them but their words, for counting. */
function stand(n: number): Alert[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `made-up:${i}`,
    text: `Problem ${i}`,
    hint: 'Do something about it.',
    level: (i < 4 ? 'urgent' : 'warn') as Alert['level'],
  }));
}

/** The bottom row of the panel, whether or not it is the count. */
const last = (rows: ReturnType<typeof alertRows>) => rows[rows.length - 1]!;

describe('the alert panel (functional)', () => {
  it('draws every row when they all fit, and adds nothing to a list it did not cut', () => {
    const rows = alertRows(stand(MAX_ALERTS));
    expect(rows).toHaveLength(MAX_ALERTS);
    // Every row stands for a real alert. A count row on a complete list would be
    // its own lie — "+0 more" is a panel apologising for nothing.
    expect(rows.every((r) => r.alert !== null)).toBe(true);
    expect(rows.map((r) => r.text)).toEqual(stand(MAX_ALERTS).map((a) => a.text));
  });

  it('says nothing at all about a colony that is fine', () => {
    expect(alertRows([])).toEqual([]);
  });

  it('caps the list and counts what it left underneath', () => {
    const rows = alertRows(stand(MAX_ALERTS + 4));
    // Exactly the rows that fit, plus one that says how many did not.
    expect(rows).toHaveLength(MAX_ALERTS + 1);
    expect(rows.filter((r) => r.alert !== null)).toHaveLength(MAX_ALERTS);
    expect(last(rows).text).toBe('+4 more');
    // The count is not an alert: nothing to click, nothing to do about it, and
    // no hint, because it is not a problem — it is the panel saying it is full.
    expect(last(rows).alert).toBeNull();
    expect(last(rows).hint).toBe('');
  });

  it('counts, rather than saying "more"', () => {
    // The number is the whole value of the row. "+1 more" and "+14 more" are
    // different situations and a player decides whether to scroll on which.
    expect(last(alertRows(stand(MAX_ALERTS + 1))).text).toBe('+1 more');
    expect(last(alertRows(stand(MAX_ALERTS + 14))).text).toBe('+14 more');
  });

  it('keeps the worst rows and drops from the bottom', () => {
    const all = stand(MAX_ALERTS + 3);
    const rows = alertRows(all);
    // `alerts()` has already sorted urgent over warn, so the panel's only job is
    // to take from the top. Taking from anywhere else would drop a fire.
    expect(rows.slice(0, MAX_ALERTS).map((r) => r.alert)).toEqual(all.slice(0, MAX_ALERTS));
  });
});

describe('the log (functional)', () => {
  it('shows the seven lines it was hardcoded to, at the height it was fixed at', () => {
    // 132px was `#log`'s max-height for as long as the seven was a literal. The
    // derivation has to reproduce it, or the panel silently changed size the day
    // this stopped being a constant.
    expect(logLines(132)).toBe(7);
  });

  it('follows the box the player drags', () => {
    expect(logLines(300)).toBe(16);
    expect(logLines(500)).toBe(28);
    // Never fewer lines in a taller box, at any height a grip can produce.
    let prev = 0;
    for (let h = 0; h <= 800; h += 3) {
      const n = logLines(h);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('keeps four lines in a box too short to hold four', () => {
    // A panel folded, unmeasured, or dragged to its 40px minimum still has to be
    // a log. Below four the box is better off scrolling than emptying, and the
    // stylesheet already lets it.
    expect(logLines(0)).toBe(4);
    expect(logLines(40)).toBe(4);
    // 72px is the log's height on a short viewport, where three would fit.
    expect(logLines(72)).toBe(4);
  });
});

/**
 * Eight settlers, half of them on the floor, a fire in the yard, raiders on the
 * map and an empty pantry. Downed, untended, breaking and near-breaking are all
 * per-settler alerts, so a colony this size stands two dozen at once — this is
 * the exact shape that used to fill a six-row panel with names before it reached
 * the one row that says the colony is starving.
 */
function collapsing(): World {
  const world = createWorld(1337);
  const start = livingColonists(world);
  // Up to eight. A three-settler starting colony cannot raise enough rows to
  // overflow anything, and the defect only exists at colony sizes people play.
  for (let i = start.length; i < 8; i++) {
    const src = start[i % start.length]!;
    world.pawns.push({ ...src, id: world.nextId++, name: `Settler ${i}`, x: 30 + i, y: 30 });
  }
  const crew = livingColonists(world);
  for (let i = 0; i < 4; i++) crew[i]!.downed = true;
  // The four still standing are watching it happen, and say so.
  for (let i = 4; i < crew.length; i++) {
    crew[i]!.mood = BREAK_MOOD - 0.01;
    crew[i]!.breakTicks = 0;
  }
  igniteFire(world, 30, 30);
  const raider = { ...crew[0]!, id: world.nextId++, faction: 'raider' as const, downed: false };
  world.pawns.push(raider);
  world.items = world.items.filter((s) => s.kind !== 'rawfood' && s.kind !== 'meal');
  for (const p of world.pawns) {
    if (p.carryingItemId !== null && !world.items.some((s) => s.id === p.carryingItemId)) {
      p.carryingItemId = null;
    }
  }
  return world;
}

describe('what the player is actually told', () => {
  it('tells a burning, raided, starving colony that it has no food', () => {
    const world = collapsing();
    const all = alerts(world);
    // The premise of the test, checked rather than assumed: this colony really
    // does have more to say than the panel has rows.
    expect(all.length).toBeGreaterThan(MAX_ALERTS);
    expect(all.find((a) => a.id === 'food')?.text).toBe('No food left');

    const rows = alertRows(all);
    // The row the player has to see. Under a six-row cap it was the seventh —
    // behind the fire, the raid and four names — and never appeared.
    expect(rows.map((r) => r.text)).toContain('No food left');
    // And the things that kill faster are still above it.
    const shown = rows.map((r) => r.text);
    expect(shown.indexOf('Fire burning')).toBeLessThan(shown.indexOf('No food left'));
  });

  it('never ends a cut list without saying it was cut', () => {
    const world = collapsing();
    const all = alerts(world);
    const rows = alertRows(all);
    // Whatever else is on the panel, the last row accounts for every alert that
    // did not make it. A player who reads the panel to the bottom now knows
    // whether they have read the colony's problems or only the first ten.
    expect(rows).toHaveLength(MAX_ALERTS + 1);
    expect(last(rows).text).toBe(`+${all.length - MAX_ALERTS} more`);
    expect(last(rows).alert).toBeNull();
  });

  it('shows the whole list once the colony has worked through it', () => {
    const world = collapsing();
    // The fire is out, the raider is dead, the settlers are back on their feet
    // and somebody has cooked. The panel has to shrink back with them — the
    // count row must not become part of the furniture.
    world.fires = [];
    for (const p of world.pawns) {
      if (p.faction === 'raider') p.dead = true;
      p.downed = false;
      p.mood = 0.8;
    }
    const rows = alertRows(alerts(world));
    expect(rows.length).toBeLessThanOrEqual(MAX_ALERTS);
    expect(rows.every((r) => r.alert !== null)).toBe(true);
  });
});

describe('the log, when the colony says the same thing four times', () => {
  const say = (text: string, kind: Message['kind'] = 'info', tick = 0): Message => ({
    tick,
    text,
    kind,
  });

  it('folds a run of one sentence into one row and a count', () => {
    const rows = logRows(
      [
        say('Three settlers reach the Aetherhold clearing.'),
        say('Corwin Verrow finished a fence.', 'good'),
        say('Corwin Verrow finished a fence.', 'good'),
        say('Corwin Verrow finished a fence.', 'good'),
      ],
      8,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ kind: 'good', text: 'Corwin Verrow finished a fence.', n: 3 });
  });

  it('leaves a line that happened once exactly as it was', () => {
    // The overwhelmingly common case, and the one where a count would be noise.
    const rows = logRows([say('Pell Emberly cooked 4 meals.', 'good')], 8);
    expect(rows).toEqual([{ kind: 'good', text: 'Pell Emberly cooked 4 meals.', n: 1 }]);
  });

  it('does not fold two identical sentences with something between them', () => {
    // Two fences either side of a wolf are two things that happened at two
    // moments. Folding those together would rewrite the order of the afternoon
    // rather than tidy it, and the order is most of what a log is for.
    const rows = logRows(
      [
        say('Corwin Verrow finished a fence.', 'good'),
        say('Fenwolf has brought down brambletail.', 'bad'),
        say('Corwin Verrow finished a fence.', 'good'),
      ],
      8,
    );
    expect(rows.map((r) => r.n)).toEqual([1, 1, 1]);
  });

  it('does not fold the same words said in two different voices', () => {
    // `kind` is the colour the line is printed in, so a good one and a bad one
    // that happen to share a sentence are not the same row and must not be
    // collapsed into whichever colour came first.
    const rows = logRows([say('The fire is out.', 'good'), say('The fire is out.', 'bad')], 8);
    expect(rows).toHaveLength(2);
  });

  it('fills the box with visible rows rather than with raw messages', () => {
    // The experience assertion, and the whole reason the collapse happens before
    // the slice. Twelve messages, ten of them one repeated sentence: sliced
    // first, a four-line box shows four rows saying three different things;
    // collapsed first it shows four rows saying four.
    const messages: Message[] = [
      say('The colony stakes out a fence line around the yard.'),
      say('The garden behind the cabin is already sown.'),
      ...Array.from({ length: 8 }, () => say('Corwin Verrow finished a fence.', 'good')),
      say('Pell Emberly cooked 4 meals.', 'good'),
      say('Fenwolf has brought down brambletail.', 'bad'),
    ];
    const rows = logRows(messages, 4);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.text)).size).toBe(4);
    // And the run that was folded still says how big it was, rather than
    // quietly becoming one fence.
    expect(rows.find((r) => r.text.includes('fence.'))?.n).toBe(8);
  });

  it('still gives back no more rows than the box can hold', () => {
    // The cap `logLines` computed is a cap on rows, and collapsing must not be
    // an excuse to overflow it — a panel that clips is the bug this file's other
    // half exists to catch.
    const messages = Array.from({ length: 40 }, (_, i) => say(`line ${i}`));
    expect(logRows(messages, logLines(132))).toHaveLength(7);
    expect(logRows(messages, 4)).toHaveLength(4);
  });

  it('keeps the newest lines, not the oldest', () => {
    const messages = Array.from({ length: 40 }, (_, i) => say(`line ${i}`));
    const rows = logRows(messages, 3);
    expect(rows.map((r) => r.text)).toEqual(['line 37', 'line 38', 'line 39']);
  });
});
