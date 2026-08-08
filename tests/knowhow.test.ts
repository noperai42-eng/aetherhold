/**
 * What the colony notices about its own trades.
 *
 * The functional half pins the mechanics of the watch — that it records before
 * it reports, that it names the gate when a trade is lost, that a settler on the
 * road is not a settler lost. The experience half plays a colony, kills the only
 * person who could brew balm, and asks whether a player would find out.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { colonyCanCraft, gateWords, pawnQualified } from '../src/sim/crafting';
import { KNOWHOW_INTERVAL, knowhowNow, tickKnowhow } from '../src/sim/knowhow';
import { settlementsOf } from '../src/sim/settlements';
import { livingColonists } from '../src/sim/world';
import { TICKS_PER_DAY, type Pawn, type World } from '../src/sim/types';

/** Nobody in this colony has ever held a trowel or a scalpel. */
function deskill(world: World): void {
  for (const p of livingColonists(world)) {
    p.skills.plants = 0;
    p.skills.medicine = 0;
  }
}

/** Make this settler a herbalist, which is one of the two doors into balm. */
function herbalist(p: Pawn, level = 6): Pawn {
  p.skills.plants = level;
  return p;
}

/** Kill somebody the way the sim does, without dragging the combat pass in. */
function fell(pawn: Pawn): Pawn {
  pawn.dead = true;
  pawn.downed = true;
  pawn.activity = 'dead';
  pawn.hp = 0;
  pawn.jobId = null;
  pawn.path = null;
  return pawn;
}

/** Run the watch once, at a tick it actually fires on. */
function watch(world: World): void {
  world.tick += KNOWHOW_INTERVAL - (world.tick % KNOWHOW_INTERVAL);
  tickKnowhow(world);
}

function said(world: World, re: RegExp): string[] {
  return world.messages.filter((m: { text: string }) => re.test(m.text)).map((m: { text: string }) => m.text);
}

describe('a colony keeping track of what it can make', () => {
  it('records where it stands the first time, and says nothing', () => {
    const world = createWorld(4242);
    delete world.knowhow;
    world.messages.length = 0;
    watch(world);
    expect(world.knowhow).toBeDefined();
    expect(world.knowhow!.can).toEqual(knowhowNow(world).can);
    // A colony that has just been read off a disk has not learned anything.
    expect(world.messages).toHaveLength(0);
  });

  it('says so when somebody grows into a trade nobody here had', () => {
    const world = createWorld(4242);
    deskill(world);
    delete world.knowhow;
    watch(world);
    expect(colonyCanCraft(world, 'balm')).toBe(false);
    world.messages.length = 0;

    const grew = herbalist(livingColonists(world)[0]!);
    watch(world);

    const lines = said(world, /brews healing balm now/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(grew.name);
    // Once. The colony does not congratulate itself every two seconds after.
    watch(world);
    expect(said(world, /brews healing balm now/)).toHaveLength(1);
  });

  it('says so when the last one who could is gone, and names the gate', () => {
    const world = createWorld(4242);
    deskill(world);
    const only = herbalist(livingColonists(world)[0]!);
    delete world.knowhow;
    watch(world);
    expect(colonyCanCraft(world, 'balm')).toBe(true);
    world.messages.length = 0;

    fell(only);
    watch(world);

    const lines = said(world, /brews healing balm any more/);
    expect(lines).toHaveLength(1);
    // The gate, not the absence: something the player can go and do.
    expect(lines[0]).toContain(gateWords('balm'));
    expect(lines[0]).toContain('a herbalist at 5 or a doctor at 4');
    expect(world.messages.some((m: { kind: string }) => m.kind === 'bad')).toBe(true);
  });

  it('warns when it is down to the last person who can', () => {
    const world = createWorld(4242);
    deskill(world);
    const [a, b] = livingColonists(world);
    herbalist(a!);
    herbalist(b!);
    delete world.knowhow;
    watch(world);
    world.messages.length = 0;

    fell(b!);
    watch(world);

    const lines = said(world, /only one here who brews healing balm/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(a!.name);
    // Still a colony that can make it — this is a warning, not a loss.
    expect(colonyCanCraft(world, 'balm')).toBe(true);
    expect(said(world, /any more/)).toHaveLength(0);
  });

  it('does not mistake a settler on the road for a settler lost', () => {
    const world = createWorld(4242);
    deskill(world);
    const only = herbalist(livingColonists(world)[0]!);
    delete world.knowhow;
    watch(world);
    world.messages.length = 0;

    // Exactly what `departCaravan` does to the colony: the traveller leaves
    // `world.pawns` for the round trip and comes back at the end of it.
    world.pawns = world.pawns.filter((p) => p.id !== only.id);
    world.caravan = {
      settlementId: settlementsOf(world)[0]!.id,
      pawn: only,
      give: { kind: 'wood', amount: 40 },
      take: null,
      x: Math.round(only.x),
      y: Math.round(only.y),
      dueTick: world.tick + TICKS_PER_DAY,
      phase: 'outbound',
    };
    expect(colonyCanCraft(world, 'balm')).toBe(false);

    watch(world);
    watch(world);
    expect(said(world, /balm/)).toHaveLength(0);

    // And when they walk back in, nothing has been forgotten and nothing is news.
    world.caravan = null;
    world.pawns.push(only);
    watch(world);
    expect(said(world, /balm/)).toHaveLength(0);
  });

  it('only runs on its own cadence', () => {
    const world = createWorld(4242);
    deskill(world);
    delete world.knowhow;
    watch(world);
    world.messages.length = 0;

    herbalist(livingColonists(world)[0]!);
    world.tick += 1;
    tickKnowhow(world);
    expect(said(world, /balm/)).toHaveLength(0);
  });

  it('loads a colony saved before any of this existed', () => {
    const world = createWorld(4242);
    delete world.knowhow;
    const streams = makeStreams(world);
    for (let i = 0; i < KNOWHOW_INTERVAL * 2; i++) stepWorld(world, streams);
    expect(world.knowhow).toBeDefined();
    // Nothing changed in eighty ticks, so nothing was announced about trades.
    expect(said(world, /any more|only one here who can/)).toHaveLength(0);
  });
});

describe('what a player finds out', () => {
  it('tells the colony when it loses the only person who could brew balm', () => {
    const world = createWorld(4242);
    const streams = makeStreams(world);
    stepWorldN(world, streams, TICKS_PER_DAY);

    // Whoever the seed made a herbalist, plus anybody who has grown into it since.
    const makers = livingColonists(world).filter((p) => pawnQualified(p, 'balm'));
    expect(makers.length).toBeGreaterThan(0);
    expect(colonyCanCraft(world, 'balm')).toBe(true);
    const before = world.messages.length;

    for (const p of makers) fell(p);
    stepWorldN(world, streams, KNOWHOW_INTERVAL * 2);

    const news = world.messages.slice(before);
    const lost = news.filter((m: { text: string }) => /brews healing balm any more/.test(m.text));
    expect(lost).toHaveLength(1);
    // A headline, so it reaches the player as a card rather than a line in a log
    // they were not reading. Losing a trade is the kind of thing you look up from.
    expect(lost[0].headline).toBe(true);
    expect(colonyCanCraft(world, 'balm')).toBe(false);
  });

  it('stays quiet through a week of a colony that never loses anybody', () => {
    const world = createWorld(7);
    const streams = makeStreams(world);
    stepWorldN(world, streams, TICKS_PER_DAY * 7);
    // Trades come and go with deaths and level-ups, and a week has few of either.
    // The bar is that the watch is not chatter: it must not be able to fire twice
    // for the same recipe in the same direction on the strength of nothing.
    const lost = said(world, /any more/);
    expect(new Set(lost).size).toBe(lost.length);
    const learned = said(world, /now\. Nobody here could before/);
    expect(new Set(learned).size).toBe(learned.length);
  });
});
