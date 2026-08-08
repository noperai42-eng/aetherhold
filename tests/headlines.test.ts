/**
 * What the player is told, and how loudly.
 *
 * Two things are pinned here, and they fail in opposite directions. The first is
 * that the moments a colony turns on — a raid, a fire, somebody dead, somebody
 * arriving — are marked as headlines by the sim, with a place attached, so the
 * card that comes up over the world has somewhere to send the camera. The second
 * is the one that actually bites: that the *work log* is not marked. A game that
 * raises a card for "Ruth finished a wall" has reinvented the log with bigger
 * letters and covered the map with it, which is worse than the problem the cards
 * were built to fix.
 *
 * The stack itself is arithmetic — three at a time, oldest goes, a threat does
 * not get pushed off by good news — and it is tested without a browser, because
 * that is the half a browser cannot make any easier.
 */

import { describe, expect, it } from 'vitest';

import {
  CARD_GAP,
  CARD_MAX,
  CARD_MIN,
  cardChannel,
  MAX_TOASTS,
  TOAST_LIFE,
  ToastStack,
} from '../src/client/ui/toasts';
import { damagePawn } from '../src/sim/combat';
import { spawnRaid, startFireEvent } from '../src/sim/events';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { TICKS_PER_DAY, type Message, type World } from '../src/sim/types';
import { livingColonists, msg } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

/** A colony with the storyteller told to stay away, so one beat fires at a time. */
function game(seed = 4242): World {
  const world = createWorld(seed);
  const st = world.storyteller;
  st.nextThreat = TICKS_PER_DAY * 60;
  st.nextArrival = TICKS_PER_DAY * 60;
  st.nextScout = TICKS_PER_DAY * 60;
  st.nextOutbreak = TICKS_PER_DAY * 60;
  return world;
}

/** The messages the world raised after `from`, newest last. */
function since(world: World, from: number): Message[] {
  return world.messages.slice(from);
}

function headlines(world: World, from: number): Message[] {
  return since(world, from).filter((m) => m.headline);
}

function card(kind: Message['kind'], text = 'something happened'): Message {
  return { tick: 0, text, kind, headline: true };
}

describe('what the sim calls a headline', () => {
  it('marks a raid, and says where it came in', () => {
    const world = game();
    const from = world.messages.length;
    const raiders = spawnRaid(world, new Rng(7), 3);
    expect(raiders.length).toBeGreaterThan(0);

    const [raid] = headlines(world, from);
    expect(raid).toBeDefined();
    expect(raid!.kind).toBe('threat');
    expect(raid!.at).toBeDefined();
    // The place is one of the raiders, not the middle of the map: a Look button
    // that puts the camera on the cabin during a raid is a lie about where the
    // trouble is.
    const near = raiders.some(
      (r) => Math.abs(r.x - raid!.at!.x) < 2 && Math.abs(r.y - raid!.at!.y) < 2,
    );
    expect(near).toBe(true);
  });

  it('marks a fire on the cell that is burning', () => {
    const world = game();
    const from = world.messages.length;
    startFireEvent(world, new Rng(3));

    const [fire] = headlines(world, from);
    expect(fire).toBeDefined();
    expect(fire!.kind).toBe('threat');
    expect(fire!.at).toBeDefined();
    expect(world.fires.some((f) => f.x === fire!.at!.x && f.y === fire!.at!.y)).toBe(true);
  });

  it('marks one of ours going down, and does not mark a raider going down', () => {
    const world = game();
    const rng = new Rng(11);
    const raiders = spawnRaid(world, rng, 3);
    const settler = livingColonists(world)[0]!;
    const raider = raiders[0]!;

    let from = world.messages.length;
    damagePawn(world, settler, settler.maxHp * 0.9, 'a test');
    expect(headlines(world, from).length).toBe(1);

    from = world.messages.length;
    damagePawn(world, raider, raider.maxHp * 0.9, 'a test');
    // Something was said — it is still worth a line — but nothing was raised.
    expect(since(world, from).length).toBeGreaterThan(0);
    expect(headlines(world, from).length).toBe(0);
  });

  it('leaves the work log alone through a day of ordinary colony life', () => {
    const world = game();
    const streams = makeStreams(world);
    const from = world.messages.length;
    stepWorldN(world, streams, TICKS_PER_DAY);

    // A quiet day says plenty — meals cooked, walls finished, things hauled. If
    // any of it came up as a card the player would spend the day dismissing
    // cards instead of playing.
    const said = since(world, from);
    expect(said.length).toBeGreaterThan(0);
    for (const m of headlines(world, from)) {
      throw new Error(`a quiet day raised a card: ${m.text}`);
    }
  });

  it('carries the place through the save shape and not a whole pawn with it', () => {
    const world = game();
    const settler = livingColonists(world)[0]!;
    settler.x = 12.7;
    settler.y = 4.2;
    msg(world, 'somebody is somewhere', 'bad', { at: settler, headline: true });

    const m = world.messages[world.messages.length - 1]!;
    // Rounded to a cell and copied, so a saved message is four numbers and not a
    // second, stale copy of a settler that has walked off since.
    expect(m.at).toEqual({ x: 13, y: 4 });
    expect(Object.keys(m.at!)).toEqual(['x', 'y']);
  });

  it('says nothing extra when nobody asked for a card', () => {
    const world = game();
    msg(world, 'an ordinary line', 'good');
    const m = world.messages[world.messages.length - 1]!;
    expect(m.headline).toBeUndefined();
    expect(m.at).toBeUndefined();
  });
});

describe('the card stack', () => {
  it('ignores everything that is not a headline', () => {
    const s = new ToastStack();
    s.push({ tick: 0, text: 'finished a wall', kind: 'good' });
    expect(s.list().length).toBe(0);
  });

  it('puts the newest card at the top', () => {
    const s = new ToastStack();
    s.push(card('good', 'first'));
    s.push(card('good', 'second'));
    expect(s.list().map((t) => t.text)).toEqual(['second', 'first']);
  });

  it('refreshes a repeat instead of stacking a duplicate', () => {
    const s = new ToastStack();
    s.push(card('bad', 'the same thing again'));
    s.age(TOAST_LIFE.bad - 2);
    s.push(card('bad', 'the same thing again'));
    expect(s.list().length).toBe(1);
    expect(s.list()[0]!.life).toBe(TOAST_LIFE.bad);
  });

  it('holds three and drops the oldest', () => {
    const s = new ToastStack();
    for (const t of ['a', 'b', 'c', 'd']) s.push(card('good', t));
    expect(s.list().length).toBe(MAX_TOASTS);
    expect(s.list().map((t) => t.text)).toEqual(['d', 'c', 'b']);
  });

  it('does not let good news push a raid off the screen', () => {
    const s = new ToastStack();
    s.push(card('threat', 'raiders'));
    s.push(card('good', 'a meal'));
    s.push(card('good', 'another meal'));
    s.push(card('good', 'a third meal'));
    // The raid is the oldest card and would have gone first under a plain queue.
    // It is also the only one that costs the run if it is missed.
    expect(s.list().some((t) => t.text === 'raiders')).toBe(true);
    expect(s.list().length).toBe(MAX_TOASTS);
  });

  it('outlives good news when it is a threat', () => {
    const s = new ToastStack();
    s.push(card('threat', 'raiders'));
    s.push(card('good', 'a meal'));
    s.age(TOAST_LIFE.good + 0.1);
    expect(s.list().map((t) => t.text)).toEqual(['raiders']);
  });

  it('does not age while the game is paused', () => {
    const s = new ToastStack();
    s.push(card('threat', 'raiders'));
    // What the app passes with the game stopped. A player who hit space to think
    // about the raid must still have the raid card when they look up.
    for (let i = 0; i < 400; i++) s.age(0);
    expect(s.list().length).toBe(1);
    expect(s.list()[0]!.life).toBe(TOAST_LIFE.threat);
  });

  it('fades over its last moment and not before', () => {
    const s = new ToastStack();
    s.push(card('good', 'a meal'));
    expect(ToastStack.opacity(s.list()[0]!)).toBe(1);
    s.age(TOAST_LIFE.good - 0.6);
    expect(ToastStack.opacity(s.list()[0]!)).toBeGreaterThan(0);
    expect(ToastStack.opacity(s.list()[0]!)).toBeLessThan(1);
  });

  it('goes away when dismissed by hand', () => {
    const s = new ToastStack();
    s.push(card('threat', 'raiders'));
    const id = s.list()[0]!.id;
    s.dismiss(id);
    expect(s.list().length).toBe(0);
    // And a card raised after it does not reuse the id, or the panel would draw
    // the new card into the dismissed one's element.
    s.push(card('bad', 'something else'));
    expect(s.list()[0]!.id).not.toBe(id);
  });

  it('forgets the last colony when a save is loaded', () => {
    const s = new ToastStack();
    s.push(card('bad', 'Ruth is dead'));
    s.clear();
    expect(s.list().length).toBe(0);
  });
});

describe('where the card column goes', () => {
  const band = { top: 112, bottom: 332 };
  /** The roster, top-left, at the size it has with three settlers. */
  const roster = { left: 8, right: 216, top: 110, bottom: 325 };
  /** The goals panel, top-right, on a tablet held upright. */
  const goalsPortrait = { left: 527, right: 760, top: 108, bottom: 597 };
  /** The same panel on a desktop window. */
  const goalsDesktop = { left: 1180, right: 1432, top: 108, bottom: 597 };

  it('takes its full width down the middle when there is room', () => {
    const fit = cardChannel(1440, band, [roster, goalsDesktop]);
    expect(fit.width).toBe(CARD_MAX);
    // Centred in the channel, which on a wide screen is very near the middle of
    // the window — the placement the CSS alone used to get right.
    const centre = fit.left + fit.width / 2;
    expect(Math.abs(centre - 720)).toBeLessThan(40);
  });

  it('gives up width rather than sit on the panels when the window is narrow', () => {
    // The bug this exists for: 768 wide, and a column centred on the window runs
    // under the roster on one side and the goals panel on the other. Every card
    // takes pointer events, so the overlap does not just look wrong — it eats
    // the click meant for the settler underneath.
    const fit = cardChannel(768, band, [roster, goalsPortrait]);
    expect(fit.left).toBeGreaterThanOrEqual(roster.right);
    expect(fit.left + fit.width).toBeLessThanOrEqual(goalsPortrait.left);
    expect(fit.width).toBeLessThan(CARD_MAX);
    expect(fit.width).toBeGreaterThanOrEqual(CARD_MIN);
  });

  it('ignores a panel that is nowhere near it', () => {
    // The log lives at the bottom of the screen and has no opinion about a card
    // at the top. Nothing says so anywhere — it falls out of the band test.
    const log = { left: 8, right: 330, top: 590, bottom: 700 };
    const withLog = cardChannel(1440, band, [roster, goalsDesktop, log]);
    const without = cardChannel(1440, band, [roster, goalsDesktop]);
    expect(withLog).toEqual(without);
  });

  it('ignores a panel that is not on screen', () => {
    // What a folded or hidden panel measures. Treating it as an obstacle would
    // shove the cards aside to dodge something the player cannot see.
    const folded = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(cardChannel(1440, band, [roster, goalsDesktop, folded])).toEqual(
      cardChannel(1440, band, [roster, goalsDesktop]),
    );
  });

  it('stops shrinking before a card is too narrow to read', () => {
    // Panels dragged together until the channel is a slot. Past a point the
    // cards take the overlap instead: a column too thin for a sentence and two
    // buttons has stopped being a card.
    const left = { left: 0, right: 500, top: 100, bottom: 400 };
    const right = { left: 560, right: 1024, top: 100, bottom: 400 };
    const fit = cardChannel(1024, band, [left, right]);
    expect(fit.width).toBe(CARD_MIN);
    expect(fit.left).toBeGreaterThanOrEqual(CARD_GAP);
    expect(fit.left + fit.width).toBeLessThanOrEqual(1024 - CARD_GAP);
  });

  it('never hangs off the edge of the screen', () => {
    // A panel pinned to the right on a phone-narrow window: there is no channel
    // left at all, and the wrong answer is a negative left.
    const hog = { left: 300, right: 700, top: 100, bottom: 400 };
    const fit = cardChannel(700, band, [hog]);
    expect(fit.left).toBeGreaterThanOrEqual(CARD_GAP);
    expect(fit.left + fit.width).toBeLessThanOrEqual(700 - CARD_GAP);
  });

  it('reads a panel by its middle, not by whichever edge it finds first', () => {
    // Wider than half the screen, so it has an edge on both sides of centre. It
    // is a left panel, and the cards belong to its right.
    const wide = { left: 0, right: 800, top: 100, bottom: 400 };
    const fit = cardChannel(1440, band, [wide]);
    expect(fit.left).toBeGreaterThanOrEqual(800);
  });
});
