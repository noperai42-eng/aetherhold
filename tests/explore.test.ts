/**
 * The dark part of the map.
 *
 * Ranked by what it would cost a player if it broke. Worst by a distance is
 * ground that *un*-reveals: a base that disappears the moment nobody is standing
 * in it is not a hard game, it is a broken one, and the whole manager view rests
 * on the map being a map. Next is a colony that loads out of an old save into a
 * black screen, because that is every colony anybody is already playing. Then
 * the counter drifting away from the flags, since the renderer keys off the
 * counter and would quietly stop lifting the haze. Then the sight/knowledge
 * line: seeing a cairn from the wall must never hand over what is buried under
 * it, or scouting is decoration.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { deserialize, serialize } from '../src/sim/save';
import {
  SIGHT,
  ensureSeen,
  exploredCells,
  exploredFraction,
  isSeen,
  revealAround,
  tickExplore,
} from '../src/sim/explore';
import { livingColonists } from '../src/sim/world';
import type { World } from '../src/sim/types';

const VIEW = {
  mode: 'manager' as const,
  possessedId: null,
  camera: { targetX: 48, targetY: 48, distance: 22, yaw: 0.5, pitch: 1.1 },
};

/** How many cells are actually flagged, counted the slow honest way. */
function flagged(world: World): number {
  return (world.seen ?? []).filter((v) => v === 1).length;
}

function played(seed: number, days: number): World {
  const world = createWorld(seed);
  stepWorldN(world, makeStreams(world), 4800 * days);
  return world;
}

describe('the map on the first morning', () => {
  it('shows the yard the colony is standing in', () => {
    const world = createWorld(31);
    stepWorld(world, makeStreams(world));

    for (const p of livingColonists(world)) {
      expect(isSeen(world, Math.round(p.x), Math.round(p.y))).toBe(true);
    }
    // Trees are buildings too, and deliberately do not light anything: a valley
    // with several hundred of them would hand over the whole map on tick one.
    for (const b of world.buildings) {
      if (b.built && b.kind !== 'tree') expect(isSeen(world, b.x, b.y)).toBe(true);
    }
  });

  it('leaves the rest of the valley to be walked', () => {
    const world = createWorld(31);
    stepWorld(world, makeStreams(world));

    expect(isSeen(world, 1, 1)).toBe(false);
    expect(isSeen(world, world.width - 2, world.height - 2)).toBe(false);
    // The point of the whole feature. A colony that can see four fifths of the
    // map on day one has a board, not a place.
    expect(exploredFraction(world)).toBeLessThan(0.2);
    // And it can see the yard it is standing in. In cells rather than as a
    // fraction, because what is lit on tick one is the homestead and the lamps in
    // it — the same patch of ground however much moor is laid out around it. As a
    // fraction it read 0.061 at 128 and 0.026 at 192 and went under a floor of
    // 0.03, with nothing wrong: the fog was doing exactly what it did before and
    // the denominator had moved underneath it.
    const seen = exploredFraction(world) * world.width * world.height;
    expect(seen).toBeGreaterThan(400);
  });

  it('reads off the map as unseen rather than throwing', () => {
    const world = createWorld(7);
    stepWorld(world, makeStreams(world));
    expect(isSeen(world, -1, 5)).toBe(false);
    expect(isSeen(world, world.width, 5)).toBe(false);
  });
});

describe('ground that has been walked', () => {
  it('stays on the map after everybody has gone home', () => {
    const world = createWorld(88);
    const streams = makeStreams(world);
    stepWorld(world, streams);

    const far = { x: 12, y: 12 };
    expect(isSeen(world, far.x, far.y)).toBe(false);

    const walker = livingColonists(world)[0]!;
    walker.x = far.x;
    walker.y = far.y;
    tickExplore(world);
    expect(isSeen(world, far.x, far.y)).toBe(true);

    // Home again, and a long way from there — the corner must still be drawn.
    walker.x = 48;
    walker.y = 48;
    stepWorldN(world, streams, 200);
    expect(isSeen(world, far.x, far.y)).toBe(true);
  });

  it('is not counted twice when it is walked again', () => {
    const world = createWorld(4);
    stepWorld(world, makeStreams(world));

    const first = revealAround(world, 20, 20, 6);
    expect(first).toBeGreaterThan(0);
    expect(revealAround(world, 20, 20, 6)).toBe(0);
    expect(exploredCells(world)).toBe(flagged(world));
  });

  it('covers a settler out to their own sight and no further', () => {
    const world = createWorld(12);
    stepWorld(world, makeStreams(world));

    const scout = livingColonists(world)[0]!;
    scout.x = 20;
    scout.y = 70;
    tickExplore(world);

    expect(isSeen(world, 20, 70)).toBe(true);
    expect(isSeen(world, 20, 70 - SIGHT)).toBe(true);
    expect(isSeen(world, 20, 70 - (SIGHT + 3))).toBe(false);
  });
});

describe('the counter the renderer trusts', () => {
  it('still matches the flags after a colony has run for days', () => {
    const world = played(20260802, 6);
    // The haze only lifts when this number moves, so a counter that has drifted
    // is a map that has silently stopped being drawn.
    expect(exploredCells(world)).toBe(flagged(world));
  });

  it('only ever goes up', () => {
    const world = createWorld(515);
    const streams = makeStreams(world);
    let last = 0;
    for (let day = 0; day < 4; day++) {
      stepWorldN(world, streams, 4800);
      const now = exploredCells(world);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBeGreaterThan(0);
  });
});

describe('seeing something and knowing what it is', () => {
  it('does not survey a site just because the colony can see it', () => {
    const world = createWorld(2024);
    stepWorld(world, makeStreams(world));

    const site = world.sites[0]!;
    revealAround(world, site.x, site.y, 4);
    tickExplore(world);

    expect(isSeen(world, site.x, site.y)).toBe(true);
    expect(site.sighted).toBe(true);
    // The whole reason scouting still exists. Sight is a marker on a map;
    // `found` is a settler who walked out, read the place and came back.
    expect(site.found).toBe(false);
  });

  it('puts a line in the log when a landmark first comes into view', () => {
    const world = createWorld(606);
    stepWorld(world, makeStreams(world));

    const unseen = world.sites.find((s) => !s.sighted);
    expect(unseen).toBeDefined();
    if (!unseen) return;

    const before = world.messages.length;
    const walker = livingColonists(world)[0]!;
    walker.x = unseen.x;
    walker.y = unseen.y;
    tickExplore(world);

    const fresh = world.messages.slice(before);
    expect(fresh.some((m) => m.text.includes('Something is standing out'))).toBe(true);
    // And exactly once — walking past it again all week must not re-announce it.
    const after = world.messages.length;
    tickExplore(world);
    expect(world.messages.length).toBe(after);
  });

  it('names a direction a player can act on', () => {
    const world = createWorld(909);
    stepWorld(world, makeStreams(world));
    const site = world.sites.find((s) => !s.sighted && s.y < 20)!;
    const walker = livingColonists(world)[0]!;
    walker.x = site.x;
    walker.y = site.y;
    tickExplore(world);
    const line = world.messages[world.messages.length - 1]!;
    expect(line.text).toContain('north');
    expect(line.at).toEqual({ x: site.x, y: site.y });
  });
});

describe('a colony that was saved before the map had any dark on it', () => {
  it('opens onto its own base rather than onto a black screen', () => {
    const world = played(4242, 3);
    const homes = livingColonists(world).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    const built = world.buildings
      .filter((b) => b.built && b.kind !== 'tree')
      .map((b) => ({ x: b.x, y: b.y }));

    // Exactly what an old save deserializes into: no flags, no counter.
    delete world.seen;
    delete world.stats.explored;

    ensureSeen(world);
    for (const h of homes) expect(isSeen(world, h.x, h.y)).toBe(true);
    for (const b of built) expect(isSeen(world, b.x, b.y)).toBe(true);
    expect(isSeen(world, 2, 2)).toBe(false);
    expect(exploredCells(world)).toBe(flagged(world));
  });

  it('does not announce the cairns its settlers have been walking past for days', () => {
    const world = played(4242, 3);
    delete world.seen;
    delete world.stats.explored;

    const before = world.messages.length;
    stepWorld(world, makeStreams(world));
    const fresh = world.messages.slice(before);
    expect(fresh.some((m) => m.text.includes('Something is standing out'))).toBe(false);
  });
});

describe('carrying the map across a save', () => {
  it('comes back with the same ground drawn', () => {
    const world = played(777, 2);
    const text = serialize(world, VIEW, 1, 1_760_000_000_000);
    const res = deserialize(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const back = res.save.world;
    expect(back.seen).toEqual(world.seen);
    expect(exploredCells(back)).toBe(exploredCells(world));
    expect(back.sites.map((s) => s.sighted ?? false)).toEqual(
      world.sites.map((s) => s.sighted ?? false),
    );
  });
});

describe('a week in the valley', () => {
  it('opens the map up as the colony works, without ever handing it over', () => {
    const world = played(20260729, 7);

    const opened = exploredFraction(world);
    // A working colony ranges: chopping, mining, hunting and scouting all take
    // settlers off the doorstep, so a week has to show real ground gained on the
    // patch they landed on.
    expect(opened).toBeGreaterThan(0.2);
    // And it has to still have somewhere to go. If a week of ordinary work draws
    // the whole valley, the far corners were never worth walking to.
    expect(opened).toBeLessThan(0.9);
    expect(exploredCells(world)).toBe(flagged(world));
  });

  it('draws the same map twice from the same seed', () => {
    // Exploration must not consume randomness — it runs on every tick of every
    // seed, and one draw from a shared stream would re-roll every balance test
    // in the suite. Identical maps from identical seeds is what that looks like
    // from the outside.
    const a = played(31337, 3);
    const b = played(31337, 3);
    expect(exploredCells(a)).toBe(exploredCells(b));
    expect(a.seen).toEqual(b.seen);
    expect(a.rng).toEqual(b.rng);
  });
});
