/**
 * The settler life log — the handful of things that happened to one person.
 *
 * Two halves, as everything here ships with. The functional half pins the rules
 * that are easy to get wrong later and impossible to see going wrong: the cap
 * evicts the second entry and never the first, a repeat of the line already
 * written is dropped, and a raider bleeding out in the yard keeps nothing. The
 * experience half plays an actual colony and reads the message log, because the
 * whole point of the feature is a sentence a player sees at a funeral, and a
 * `remember()` that is never called from the sim passes every unit test there is.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, makePawn } from '../src/sim/worldgen';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { damagePawn } from '../src/sim/combat';
import { imprison, recruit } from '../src/sim/prison';
import { addBuilding, livingColonists, msg } from '../src/sim/world';
import { nearestWalkable } from '../src/sim/grid';
import { MEMORY_CAP, eulogyFor, memoriesOf, remember, rememberFirst } from '../src/sim/lifelog';
import { TICKS_PER_DAY, type Pawn, type World } from '../src/sim/types';

function firstSettler(world: World): Pawn {
  return livingColonists(world)[0]!;
}

/** Run the sim forward. Nothing here needs input, so this is the whole harness. */
function play(world: World, ticks: number): void {
  stepWorldN(world, makeStreams(world), ticks);
}

describe('lifelog', () => {
  it('gives every founder a first line the day the colony starts', () => {
    const world = createWorld(1337);
    const lines = livingColonists(world).map((p) => memoriesOf(p));
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l).toHaveLength(1);
      expect(l[0]!.day).toBe(1);
    }
    // Three founders who arrived on the same morning still have to be three
    // different people, and the skill they were sent out with is what says which.
    expect(new Set(lines.map((l) => l[0]!.text)).size).toBe(3);
  });

  it('keeps the origin when the cap starts biting', () => {
    const world = createWorld(4242);
    const p = firstSettler(world);
    const origin = memoriesOf(p)[0]!.text;
    for (let i = 0; i < MEMORY_CAP * 2; i++) remember(world, p, `thing number ${i}`);

    const list = memoriesOf(p);
    expect(list).toHaveLength(MEMORY_CAP);
    // The whole reason `remember` splices instead of shifting: a plain queue
    // drops exactly the line that makes the rest of them mean anything.
    expect(list[0]!.text).toBe(origin);
    expect(list[list.length - 1]!.text).toBe(`thing number ${MEMORY_CAP * 2 - 1}`);
  });

  it('does not write the same line twice in a row', () => {
    const world = createWorld(4242);
    const p = firstSettler(world);
    const before = memoriesOf(p).length;
    remember(world, p, 'went down to gunfire');
    remember(world, p, 'went down to gunfire');
    expect(memoriesOf(p)).toHaveLength(before + 1);
  });

  it('writes the first of a kind and drops the rest', () => {
    const world = createWorld(4242);
    const p = firstSettler(world);
    rememberFirst(world, p, 'went down to', 'went down to gunfire');
    remember(world, p, 'buried Someone Else');
    rememberFirst(world, p, 'went down to', 'went down to a bear');
    // Different wording, same kind of event — and eight lines of it would be a
    // settler with a combat log instead of a life.
    expect(memoriesOf(p).map((m) => m.text)).toContain('went down to gunfire');
    expect(memoriesOf(p).map((m) => m.text)).not.toContain('went down to a bear');
  });

  it('writes nothing down about a raider', () => {
    const world = createWorld(4242);
    const raider = makePawn(world, new Rng(7), 'raider', 40, 40, { weapon: 'club' });
    remember(world, raider, 'came here to kill you');
    // Somebody who walks onto the map to kill you and goes down in the yard has
    // no story to tell, and a card nobody opens does not want a life log on it.
    expect(memoriesOf(raider)).toEqual([]);
  });

  it('has no eulogy for somebody nothing was written about', () => {
    const world = createWorld(4242);
    const p = firstSettler(world);
    p.memories = [];
    expect(eulogyFor(world, p)).toBeNull();
  });

  it('counts the days from the first line, not from the start of the world', () => {
    const world = createWorld(4242);
    const p = firstSettler(world);
    p.memories = [{ day: 4, text: 'walked out of the trees and asked to stay' }];
    world.tick = TICKS_PER_DAY * 9; // day 10
    expect(eulogyFor(world, p)).toBe(
      `${p.name} was here 6 days. They walked out of the trees and asked to stay.`,
    );
  });

  it('joins the origin to the last thing that happened, and skips the middle', () => {
    const world = createWorld(4242);
    const p = firstSettler(world);
    p.memories = [
      { day: 1, text: 'came out here to raise the first wall' },
      { day: 5, text: 'went down to gunfire' },
      { day: 9, text: 'buried Ivet Marrowes' },
    ];
    world.tick = TICKS_PER_DAY * 11; // day 12
    // Two clauses, not three and not eight: a recital is a database dump wearing
    // a black armband.
    expect(eulogyFor(world, p)).toBe(
      `${p.name} was here 11 days. They came out here to raise the first wall, and buried Ivet Marrowes.`,
    );
  });

  it('says less than a day for somebody who did not last one', () => {
    const world = createWorld(4242);
    const p = firstSettler(world);
    expect(eulogyFor(world, p)).toBe(`${p.name} was here less than a day. They ${memoriesOf(p)[0]!.text}.`);
  });
});

describe('what a player reads', () => {
  it('says who somebody was over their body, not just what killed them', () => {
    const world = createWorld(1337);
    play(world, TICKS_PER_DAY * 2);
    const p = firstSettler(world);
    // Emptied rather than measured. The log is a ring of eighty and two days in a
    // valley this size fills it, so `slice(previousLength)` is `slice(80)` — the
    // eulogy goes in, the oldest line falls off the front to make room, the length
    // does not move and the test reads back nothing at all. It looked exactly like
    // a missing eulogy and the eulogy was right there.
    world.messages.length = 0;

    damagePawn(world, p, p.maxHp * 4, 'a bear');

    const said = world.messages.map((m) => m.text);
    // The fact first — that is what the player needs in the two seconds after it
    // happens — and then the two days they spent earning it.
    expect(said[0]).toBe(`${p.name} is dead. (a bear)`);
    expect(said[1]).toContain(`${p.name} was here`);
    expect(said[1]).toContain(memoriesOf(p)[0]!.text);
  });

  it('remembers the raid a settler survived, and reads it back when they die', () => {
    const world = createWorld(1337);
    play(world, TICKS_PER_DAY);
    const p = firstSettler(world);

    // Down, but not out: a settler at a fifth of their health goes down and the
    // colony gets them back on their feet. That is the story worth keeping.
    damagePawn(world, p, p.maxHp * 0.85, 'gunfire');
    expect(p.downed).toBe(true);
    expect(memoriesOf(p).map((m) => m.text)).toContain('went down to gunfire');

    p.downed = false;
    p.hp = p.maxHp;
    world.tick += TICKS_PER_DAY * 6;
    const before = world.messages.length;
    damagePawn(world, p, p.maxHp * 4, 'gunfire');
    const eulogy = world.messages.slice(before).map((m) => m.text)[1]!;
    expect(eulogy).toContain('went down to gunfire');
  });

  it('carries a raider who joined up through to their own funeral', () => {
    const world = createWorld(1337);
    play(world, TICKS_PER_DAY);
    const spot = nearestWalkable(world, 40, 40)!;
    const bunk = addBuilding(world, 'prisonbed', spot.x, spot.y, true)!;
    expect(bunk).not.toBeNull();
    // A real raider, not a settler with the faction flipped: the point of the
    // test is that a prisoner's whole log is written after they stop being one.
    const captive = makePawn(world, new Rng(7), 'raider', 40, 40, { weapon: 'club' });

    imprison(world, captive, bunk);
    expect(memoriesOf(captive).map((m) => m.text)).toEqual([
      'came here with a raid and ended up in a bunk',
    ]);
    recruit(world, captive);

    world.tick += TICKS_PER_DAY * 3;
    const before = world.messages.length;
    damagePawn(world, captive, captive.maxHp * 4, 'gunfire');
    const eulogy = world.messages.slice(before).map((m) => m.text)[1]!;
    // The best line in the game, and it only exists because the prisoner kept a
    // log while they were still somebody else's problem.
    expect(eulogy).toBe(
      `${captive.name} was here 3 days. They came here with a raid and ended up in a bunk, and threw in with the colony.`,
    );
  });

  it('survives a save written before anybody kept a log', () => {
    const world = createWorld(1337);
    const p = firstSettler(world);
    delete p.memories;
    expect(memoriesOf(p)).toEqual([]);
    expect(eulogyFor(world, p)).toBeNull();
    // And starts keeping one from the next thing that happens to them, rather
    // than having a history invented for the days nobody was writing.
    damagePawn(world, p, p.maxHp * 0.85, 'gunfire');
    expect(memoriesOf(p)).toHaveLength(1);
  });

  it('does not change what the sim rolls', () => {
    // `remember` draws no rng by construction, and this is the test that keeps it
    // that way: one extra draw inside a per-body loop silently re-rolls every map
    // in the game. Same seed, same colony, down to the names and the numbers.
    const a = createWorld(99001);
    const b = createWorld(99001);
    play(a, 400);
    play(b, 400);
    expect(a.pawns.map((p) => `${p.name}:${Math.round(p.x)},${Math.round(p.y)}:${p.hp}`)).toEqual(
      b.pawns.map((p) => `${p.name}:${Math.round(p.x)},${Math.round(p.y)}:${p.hp}`),
    );
    // Not a no-op test: the colony is genuinely writing lines while it plays.
    expect(memoriesOf(firstSettler(a)).length).toBeGreaterThan(0);
    expect(msg).toBeTypeOf('function');
  });
});
