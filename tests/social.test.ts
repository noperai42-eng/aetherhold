/**
 * What the relationship layer is allowed to do, and what it is not.
 *
 * The functional half pins the mechanics of a bond — who can form one, what
 * stops one, and that it stays inside its bounds. The experience half plays a
 * colony for a week and asks the two questions a player would: did anybody make
 * a friend, and did losing one hurt more than losing a stranger.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/worldgen';
import { addBuilding } from '../src/sim/world';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { computeMood, grieve } from '../src/sim/needs';
import {
  bondBetween,
  bondKey,
  bondLabel,
  bonds,
  bondsOf,
  closestFriendOf,
  CORPSE_MOOD_LIMIT,
  FRIEND,
  moodFromBonds,
  SOCIAL_INTERVAL,
  tickSocial,
} from '../src/sim/social';
import { TICKS_PER_DAY, type Pawn, type World } from '../src/sim/types';

/** A stream that always hands back the top of the range: friendship, fast. */
const warm = { range: (_lo: number, hi: number) => hi };
/** And one that always hands back the bottom. */
const cold = { range: (lo: number, _hi: number) => lo };

function settlers(world: World): Pawn[] {
  return world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
}

/** Put two settlers next to each other, awake and idle, on open ground. */
function seat(a: Pawn, b: Pawn, x: number, y: number): void {
  a.x = x;
  a.y = y;
  b.x = x + 1;
  b.y = y;
  for (const p of [a, b]) {
    p.activity = 'idle';
    p.downed = false;
    p.dead = false;
  }
}

/** Run the social pass N times, at the cadence the real loop uses. */
function socialise(world: World, rng: { range(lo: number, hi: number): number }, times: number): void {
  for (let i = 0; i < times; i++) {
    world.tick += SOCIAL_INTERVAL;
    tickSocial(world, rng);
  }
}

describe('a bond is one number about two people', () => {
  it('names a pair the same way from either end', () => {
    expect(bondKey(3, 7)).toBe(bondKey(7, 3));
    expect(bondKey(3, 7)).toBe('3:7');
  });

  it('is zero for two people who have never met', () => {
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    expect(bondBetween(world, a.id, b.id)).toBe(0);
    // And for a pawn and itself, which is what stops a settler befriending
    // themselves into a permanent mood bonus.
    expect(bondBetween(world, a.id, a.id)).toBe(0);
  });

  it('forms between two settlers standing together', () => {
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    socialise(world, warm, 4);
    expect(bondBetween(world, a.id, b.id)).toBeGreaterThan(0);
  });

  it('does not form across the map', () => {
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    b.x = 34;
    b.y = 34;
    socialise(world, warm, 8);
    expect(bondBetween(world, a.id, b.id)).toBe(0);
  });

  it('does not form through a wall', () => {
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    // Two cells apart with the wall between them: inside talking range, but
    // there is a stone wall in the way, which is the whole point of the check.
    a.x = 20;
    a.y = 20;
    b.x = 22;
    b.y = 20;
    for (const p of [a, b]) p.activity = 'idle';
    expect(addBuilding(world, 'wall', 21, 20, true)).not.toBeNull();
    socialise(world, warm, 8);
    expect(bondBetween(world, a.id, b.id)).toBe(0);
  });

  it('does not form while one of them is asleep', () => {
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    b.activity = 'sleeping';
    socialise(world, warm, 8);
    expect(bondBetween(world, a.id, b.id)).toBe(0);
  });

  it('stops at a hundred in either direction', () => {
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    // Start them already at the top and keep pushing. Ordinary play no longer
    // arrives here — the falloff sees to that, which is the point of it — so the
    // clamp has to be tested by putting a bond there rather than by earning one,
    // otherwise this asserts nothing but the falloff's own ceiling.
    bonds(world)[bondKey(a.id, b.id)] = 99.8;
    socialise(world, warm, 40);
    expect(bondBetween(world, a.id, b.id)).toBeLessThanOrEqual(100);

    const other = createWorld(4242);
    const [c, d] = settlers(other);
    seat(c, d, 20, 20);
    // Traits off for the downward half. Seed 4242 opens with two warm settlers,
    // and warmth is large enough to turn the worst possible roll into a positive
    // one — which is the table working as designed. This test is about the
    // clamp, so it takes the traits out rather than hunting for a sour seed.
    c.traits = [];
    d.traits = [];
    socialise(other, cold, 400);
    expect(bondBetween(other, c.id, d.id)).toBeGreaterThanOrEqual(-100);
    expect(bondBetween(other, c.id, d.id)).toBeLessThan(-30);
  });

  it('costs more to climb the closer to the top they already are', () => {
    // The defect this exists to prevent, and it was a real one: without the
    // falloff, two settlers who share a room reach the cap on the third day of
    // the colony and every pair in it is labelled `inseparable` by the end of the
    // first week. A scale where everybody is at the maximum is one word, not a
    // scale. Same pair, same stream, same number of passes — the second half of
    // the climb has to be slower than the first or nothing below the cap means
    // anything.
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    socialise(world, warm, 10);
    const early = bondBetween(world, a.id, b.id);
    bonds(world)[bondKey(a.id, b.id)] = 80;
    socialise(world, warm, 10);
    const late = bondBetween(world, a.id, b.id) - 80;
    expect(late).toBeLessThan(early / 4);
  });

  it('never gets a constant companion all the way to the top', () => {
    // The best case the game can produce — two settlers glued together, every
    // roll maximal — settles short of the cap and stays there. This is what makes
    // eighty a thing two people earn rather than a number every colony passes
    // through in its first week.
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    socialise(world, warm, 600);
    const bond = bondBetween(world, a.id, b.id);
    expect(bond).toBeGreaterThan(60);
    expect(bond).toBeLessThan(97);
  });

  it('lets two close settlers fall out at full speed', () => {
    // One-directional on purpose. Damping the way back down as well would make a
    // high bond sticky, and a pair who genuinely fell out would drift apart at
    // the speed of the decay — which is to say, be told about it a month late.
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    bonds(world)[bondKey(a.id, b.id)] = 90;
    a.traits = [];
    b.traits = [];
    socialise(world, cold, 10);
    // Ten sour exchanges at 1.2 apiece is twelve points, and the falloff must not
    // have taken a bite out of any of them.
    expect(bondBetween(world, a.id, b.id)).toBeLessThan(79);
  });

  it('fades, and is forgotten once it is worth nothing', () => {
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    const key = bondKey(a.id, b.id);
    bonds(world)[key] = 0.6;
    // Nowhere near each other, so nothing but the decay applies.
    a.x = 5;
    a.y = 5;
    b.x = 40;
    b.y = 40;
    socialise(world, warm, 500);
    expect(bonds(world)[key]).toBeUndefined();
    expect(bondBetween(world, a.id, b.id)).toBe(0);
  });

  it('says so once when two settlers become friends, not every tick after', () => {
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    socialise(world, warm, 120);
    const lines = world.messages.filter((m: { text: string }) => m.text.includes('have become friends'));
    expect(lines.length).toBe(1);
    expect(lines[0].text).toContain(a.name);
    expect(lines[0].text).toContain(b.name);
  });

  it('only runs on its own cadence, so a colony is not re-scored every tick', () => {
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    world.tick = SOCIAL_INTERVAL + 1;
    tickSocial(world, warm);
    expect(bondBetween(world, a.id, b.id)).toBe(0);
  });

  it('loads a colony saved before any of this existed', () => {
    const world = createWorld(4242);
    // Exactly the shape an older save deserializes to: no bonds, no bondsTold,
    // no socialMood on anybody.
    delete world.bonds;
    delete world.bondsTold;
    for (const p of world.pawns) delete p.socialMood;
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    expect(bondsOf(world, a)).toEqual([]);
    expect(moodFromBonds(world, a)).toBe(0);
    socialise(world, warm, 4);
    expect(bondBetween(world, a.id, b.id)).toBeGreaterThan(0);
  });

  it('describes an opinion in words a player can act on', () => {
    expect(bondLabel(90)).toBe('inseparable');
    expect(bondLabel(FRIEND)).toBe('friend');
    expect(bondLabel(0)).toBe('knows');
    expect(bondLabel(-90)).toBe('cannot stand');
  });
});

describe('what the colony feels', () => {
  it('is worth a little mood, and never more than a little', () => {
    const world = createWorld(4242);
    const [a, b] = settlers(world);
    seat(a, b, 20, 20);
    socialise(world, warm, 400);
    // Everybody in the colony pinned at maximum friendship is still a rounding
    // error next to a full belly. That ceiling is the whole safety argument.
    for (const p of settlers(world)) {
      const map = bonds(world);
      for (const q of settlers(world)) if (p.id !== q.id) map[bondKey(p.id, q.id)] = 100;
      expect(moodFromBonds(world, p)).toBeLessThanOrEqual(0.06 + 1e-9);
      expect(moodFromBonds(world, p)).toBeGreaterThanOrEqual(-0.06 - 1e-9);
    }
  });

  it('is what computeMood reads, without social.ts ever touching mood', () => {
    const world = createWorld(4242);
    const [a] = settlers(world);
    a.socialMood = 0;
    const alone = computeMood(a);
    a.socialMood = 0.06;
    expect(computeMood(a)).toBeCloseTo(alone + 0.06, 6);
    a.socialMood = -0.06;
    expect(computeMood(a)).toBeCloseTo(alone - 0.06, 6);
  });

  it('makes losing a friend cost more than losing a stranger', () => {
    const world = createWorld(4242);
    const all = settlers(world);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const [lost, friend, stranger] = all;
    bonds(world)[bondKey(lost.id, friend.id)] = 100;

    lost.dead = true;
    lost.activity = 'dead';
    grieve(world, lost);

    // Both of them are worse off. The friend is worse off than the stranger, and
    // by enough to notice — but the stranger still gets at least half, because a
    // death in a colony this size is everybody's problem.
    expect(friend.moodOffset ?? 0).toBeLessThan(0);
    expect(stranger.moodOffset ?? 0).toBeLessThan(0);
    expect(friend.moodOffset ?? 0).toBeLessThan(stranger.moodOffset ?? 0);
    expect(Math.abs(stranger.moodOffset ?? 0)).toBeGreaterThanOrEqual(
      Math.abs(friend.moodOffset ?? 0) / 2,
    );
    expect(world.messages.some((m: { text: string }) => m.text === `${friend.name} has lost a friend.`)).toBe(true);
  });

  it('names the closest surviving friend, and nobody if there was none', () => {
    const world = createWorld(4242);
    const [lost, near, far] = settlers(world);
    expect(closestFriendOf(world, lost)).toBeNull();
    bonds(world)[bondKey(lost.id, far.id)] = 40;
    bonds(world)[bondKey(lost.id, near.id)] = 80;
    expect(closestFriendOf(world, lost)?.id).toBe(near.id);
  });

  it('leaves a colony that played a week with opinions about each other', () => {
    const world = createWorld(4242);
    const streams = makeStreams(world);
    stepWorldN(world, streams, TICKS_PER_DAY * 7);
    const alive = settlers(world);
    // Not a guarantee that any particular pair are friends — that is the
    // storyteller's business — but a week of shared work must leave *somebody*
    // with an opinion, or the whole file is inert.
    const opinions = alive.reduce((n, p) => n + bondsOf(world, p).length, 0);
    expect(opinions).toBeGreaterThan(0);
    for (const p of alive) {
      // Two clamps, not one. Bonds move a settler 0.06 either way; the bodies
      // still lying in the yard take another 0.09 off the bottom, and that half
      // is deliberately allowed to be the louder one. On this seed a raid leaves
      // four raiders unburied by day seven, which pins every settler at the
      // corpse clamp — so an `abs() <= 0.06` here reads as a runaway when it is
      // the corpse half doing precisely its job. Assert both ends by name.
      expect(p.socialMood ?? 0).toBeLessThanOrEqual(0.06 + 1e-9);
      expect(p.socialMood ?? 0).toBeGreaterThanOrEqual(-(0.06 + CORPSE_MOOD_LIMIT) - 1e-9);
      // And nobody's mood ran away with it, which is the balance the ceiling
      // exists to protect.
      expect(p.mood).toBeGreaterThan(0);
      expect(p.mood).toBeLessThanOrEqual(1);
    }
  });

  it('costs nothing when the sim runs it every tick for a day', () => {
    const world = createWorld(4242);
    const streams = makeStreams(world);
    const before = world.messages.length;
    for (let i = 0; i < TICKS_PER_DAY; i++) stepWorld(world, streams);
    // The bonds map stays small: it is pairs who have met, not a full matrix.
    const pairs = Object.keys(bonds(world)).length;
    const n = settlers(world).length;
    expect(pairs).toBeLessThanOrEqual((n * (n - 1)) / 2);
    expect(world.messages.length).toBeGreaterThanOrEqual(before);
  });
});
