/**
 * The colony's memory.
 *
 * `world.messages` is a window: eighty lines, older ones dropped, which is the
 * right shape for a panel that answers "what is the crew doing right now" and
 * the wrong shape for the only record the game had of anything. A colony that
 * finished eighty walls after a settler died had no way left to know the settler
 * had ever existed — the sentence was gone, and nothing anywhere had kept it.
 *
 * So headlines are copied into `world.chronicle`, which keeps five hundred. The
 * tests below are mostly about the seam between the two lists, because that is
 * where this can go wrong quietly: they must not share objects, the trim on one
 * must not reach into the other, and the whole thing has to survive the JSON
 * round trip that is the save file.
 *
 * The last test is the one that matters most, and it is the lesson from
 * `tests/liveness.test.ts` applied at file scope: everything above it constructs
 * the messages it asserts on, so none of it can tell you whether a real colony
 * ever raises a headline at all.
 */

import { describe, expect, it } from 'vitest';

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { msg } from '../src/sim/world';
import { serialize, deserialize } from '../src/sim/save';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { World } from '../src/sim/types';

const fresh = (): World => createWorld(4242);

/**
 * The most recent thing the colony remembers.
 *
 * Not `chronicle[0]` — worldgen writes the founding into every colony, so index
 * zero always belongs to the arrival and never to whatever the test just said.
 */
const latest = (world: World) => world.chronicle![world.chronicle!.length - 1]!;

/** What the camera was doing when the colony was saved. Irrelevant here. */
const VIEW = {
  mode: 'manager' as const,
  possessedId: null,
  camera: { targetX: 0, targetY: 0, distance: 20, yaw: 0, pitch: 1 },
};

describe('the chronicle', () => {
  it('keeps the story and ignores the work log', () => {
    const world = fresh();
    const log0 = world.messages.length;
    const story0 = (world.chronicle ?? []).length;
    msg(world, 'somebody finished a wall');
    msg(world, 'a settler has died', 'bad', { headline: true });
    msg(world, 'somebody hauled a log');

    // All three are in the log; only the one that mattered is in the history.
    expect(world.messages.length - log0).toBe(3);
    const story = world.chronicle!;
    expect(story.length - story0).toBe(1);
    expect(story[story.length - 1]!.text).toBe('a settler has died');
    expect(story[story.length - 1]!.kind).toBe('bad');
  });

  it('opens on the founding', () => {
    // The one headline worldgen raises, and it has to be there: a history whose
    // first entry is the day somebody got shot at reads as though the colony
    // was never founded at all.
    const world = fresh();
    expect(world.chronicle).toHaveLength(1);
    expect(world.chronicle![0]!.text).toContain('reach the Aetherhold clearing');
    // Stamped with the hour the colony starts on, not zero — the clock begins
    // at dawn of the first day, and the panel groups by the day it reads here.
    expect(world.chronicle![0]!.tick).toBe(world.tick);
  });

  it('remembers where it happened', () => {
    const world = fresh();
    msg(world, 'raiders break the treeline', 'threat', { headline: true, at: { x: 40.4, y: 12.6 } });
    // Rounded on the way in, like the log's copy: the panel turns this into a
    // button that puts the camera on a cell, and a cell is an integer.
    expect(latest(world).at).toEqual({ x: 40, y: 13 });
  });

  it('survives the log trimming underneath it', () => {
    const world = fresh();
    msg(world, 'the first winter closes in', 'bad', { headline: true });
    // Ninety ordinary lines is more than the log's eighty, so the headline is
    // pushed off the end of it.
    for (let i = 0; i < 90; i++) msg(world, `wall ${i} finished`);

    expect(world.messages.some((m) => m.text === 'the first winter closes in')).toBe(false);
    expect(latest(world).text).toBe('the first winter closes in');
  });

  it('does not hand the log a shared object', () => {
    // The two lists trim independently. If they shared entries, mutating one
    // would reach into the other's history — and the bug would only show up on
    // a colony old enough to have trimmed, which is to say never in a test that
    // was not looking for it.
    const world = fresh();
    msg(world, 'a hard frost', 'bad', { headline: true });
    const inLog = world.messages[world.messages.length - 1]!;
    const inChronicle = latest(world);
    expect(inLog).not.toBe(inChronicle);
    inLog.text = 'rewritten';
    expect(inChronicle.text).toBe('a hard frost');
  });

  it('is bounded, and drops the oldest first', () => {
    const world = fresh();
    for (let i = 0; i < 620; i++) msg(world, `beat ${i}`, 'info', { headline: true });
    const c = world.chronicle!;
    expect(c).toHaveLength(500);
    // The five hundred kept are the five hundred most recent — a history that
    // dropped the newest entries would be worse than no history.
    expect(c[0]!.text).toBe('beat 120');
    expect(c[c.length - 1]!.text).toBe('beat 619');
  });

  it('comes back out of a save', () => {
    const world = fresh();
    msg(world, 'the valley is claimed', 'good', { headline: true, at: { x: 96, y: 96 } });
    const round = deserialize(serialize(world, VIEW, 1, 0));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    const kept = round.save.world.chronicle!;
    // The founding and the line just written.
    expect(kept).toHaveLength(2);
    expect(kept[1]!.text).toBe('the valley is claimed');
    expect(kept[1]!.at).toEqual({ x: 96, y: 96 });
  });

  it('loads a colony saved before it existed', () => {
    const world = fresh();
    msg(world, 'an old colony, from before there was a chronicle', 'good', { headline: true });
    const raw = JSON.parse(serialize(world, VIEW, 1, 0)) as { world: Record<string, unknown> };
    // The field is optional and the save version is deliberately not bumped, so
    // a colony saved before there was a chronicle has to load into "no story
    // kept yet" rather than into an exception on the title screen.
    delete raw.world.chronicle;
    const round = deserialize(JSON.stringify(raw));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    const back = round.save.world;
    expect(back.chronicle).toBeUndefined();
    // Absent, not crashed, and the next headline starts the history off.
    msg(back, 'and here is the first thing it will remember', 'good', { headline: true });
    expect(back.chronicle).toHaveLength(1);
  });

  it('fills up on its own in a colony nobody is playing', () => {
    // The one test here that does not write its own messages. Everything above
    // proves the plumbing; this proves the game pours anything into it. A
    // chronicle that is correct and always empty is a panel that says "nothing
    // worth remembering yet" forever, and no other test in this file could
    // tell the difference.
    const world = createWorld(20260729);
    stepWorldN(world, makeStreams(world), 10 * TICKS_PER_DAY);
    const c = world.chronicle ?? [];
    expect(c.length).toBeGreaterThan(0);
    // In order, and stamped with when — the panel groups by day off these ticks.
    for (let i = 1; i < c.length; i++) expect(c[i]!.tick).toBeGreaterThanOrEqual(c[i - 1]!.tick);
    expect(c[c.length - 1]!.tick).toBeLessThanOrEqual(world.tick);
  });
});
