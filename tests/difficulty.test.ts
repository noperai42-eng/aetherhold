/**
 * Difficulty — how hard the valley bites.
 *
 * Two things have to be true at once and they pull against each other, which is
 * why this file exists.
 *
 * **The middle setting has to be the old game, exactly.** Every measurement in
 * this repo — the seed contract in `hunting.test.ts`, the eval sweeps, the
 * survival harness, the thousand-day ecosystem run — was taken against a world
 * that had no difficulty in it. If `settler` shifted a single roll, all of that
 * silently became a measurement of something else. So the tests below do not
 * merely check that `settler` is "about the same": they check that the same seed
 * produces a byte-identical world and that the raid stream is tick-for-tick the
 * run it was before the setting existed.
 *
 * **The other two settings have to actually change the game.** A difficulty
 * setting that a player cannot feel is worse than none, because it costs them a
 * decision and gives nothing back. So the second half runs real colonies through
 * a fortnight of story and counts what came out of the treeline.
 *
 * The trap this file is really guarding is subtler than either: a multiplier
 * applied *inside* an rng draw rather than after it. `rng.chance(p * bite)`
 * consumes the same single number as `rng.chance(p)`, but `rng.int(16 * bite)`
 * does not have to, and the moment one call site draws a different *number* of
 * values the three settings diverge into three different stories on the same
 * seed. The stream test below is what catches that.
 */

import { describe, expect, it } from 'vitest';

import { DIFFICULTIES, DIFFICULTY_ORDER, difficultyOf } from '../src/sim/difficulty';
import { Rng } from '../src/sim/rng';
import { createWorld } from '../src/sim/worldgen';
import { tickStoryteller } from '../src/sim/events';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { Difficulty } from '../src/sim/types';

const SEED = 20260729;

/**
 * Run the storyteller alone for `days`, and report what it sent.
 *
 * Deliberately not `stepWorldN`: a whole world tick would let hunger, wounds and
 * work change how many colonists are standing, and colonist count feeds the band
 * size — so a harsher run would shrink its own raids by killing people and the
 * measurement would fold in on itself. Here the colony is a fixed backdrop and
 * the only variable is the setting.
 */
function storyRun(difficulty: Difficulty, days: number): { beats: number; raiders: number } {
  const world = createWorld(SEED, difficulty);
  // One stream, seeded off the world, so two runs at different difficulties see
  // the same numbers in the same order — the whole point of the neutrality test.
  const rng = new Rng(4242);
  const before = world.storyteller.threatsFired;
  for (let t = 0; t < days * TICKS_PER_DAY; t++) tickStoryteller(world, rng);
  return {
    beats: world.storyteller.threatsFired - before,
    raiders: world.pawns.filter((p) => p.faction === 'raider').length,
  };
}

describe('the difficulty table', () => {
  it('scales nothing at all on settler', () => {
    // Not "close to 1" — exactly 1. Every call site multiplies by these, and a
    // multiplier of 0.999 is a rounding away from a different game.
    const mid = DIFFICULTIES.settler;
    expect(mid.respite).toBe(1);
    expect(mid.band).toBe(1);
    expect(mid.bite).toBe(1);
    expect(mid.grace).toBe(1);
  });

  it('orders kindest to harshest on every axis', () => {
    const [calm, settler, harsh] = DIFFICULTY_ORDER.map((id) => DIFFICULTIES[id]);
    expect(DIFFICULTY_ORDER).toEqual(['calm', 'settler', 'harsh']);
    // Respite and grace are quiet, so kind means bigger. Band and bite are
    // trouble, so kind means smaller. Getting one of the four backwards is the
    // easy mistake and it produces a "kind" setting that is harder in one way.
    expect(calm!.respite).toBeGreaterThan(settler!.respite);
    expect(settler!.respite).toBeGreaterThan(harsh!.respite);
    expect(calm!.grace).toBeGreaterThan(settler!.grace);
    expect(settler!.grace).toBeGreaterThan(harsh!.grace);
    expect(calm!.band).toBeLessThan(settler!.band);
    expect(settler!.band).toBeLessThan(harsh!.band);
    expect(calm!.bite).toBeLessThan(settler!.bite);
    expect(settler!.bite).toBeLessThan(harsh!.bite);
  });

  it('reads an absent setting as settler, so old saves are the game they were played on', () => {
    // Saves written before the setting existed have no `difficulty` field. They
    // are not "a bit easier now" — they are the run they always were.
    const world = createWorld(SEED);
    delete world.difficulty;
    expect(difficultyOf(world)).toBe(DIFFICULTIES.settler);
  });

  it('stamps the world so a save carries the setting without a version bump', () => {
    // The save is the whole world as JSON, so this field alone is the feature's
    // entire persistence story. If it stops being written, a loaded colony
    // quietly drops to settler mid-run.
    expect(createWorld(SEED, 'harsh').difficulty).toBe('harsh');
    expect(createWorld(SEED).difficulty).toBe('settler');
  });
});

describe('the default run is untouched', () => {
  it('builds the same valley it built before the setting existed', () => {
    // The seed contract. `tests/hunting.test.ts` pins this same number from the
    // other side; it is repeated here because *this* file is the one that would
    // have broken it, and a contract is worth more when the code most likely to
    // violate it is the code standing next to the assertion.
    expect(createWorld(SEED).rng.main).toBe(1672083406);
    expect(createWorld(SEED, 'settler').rng.main).toBe(1672083406);
  });

  it('grows the identical map on all three settings', () => {
    // Difficulty is threat, not terrain. A player has to be able to hand a
    // friend a seed without also having to hand them a setting, and the eval
    // harness has to be able to compare two difficulties on one map.
    const mid = createWorld(SEED, 'settler');
    for (const id of DIFFICULTY_ORDER) {
      const other = createWorld(SEED, id);
      expect(other.rng.main).toBe(mid.rng.main);
      expect(other.terrain).toEqual(mid.terrain);
      expect(other.pawns.map((p) => p.name)).toEqual(mid.pawns.map((p) => p.name));
      expect(other.buildings.length).toBe(mid.buildings.length);
    }
  });

  it('leaves the first raid on the tick it always landed on', () => {
    expect(createWorld(SEED, 'settler').storyteller.nextThreat).toBe(
      Math.round(TICKS_PER_DAY * 2.5),
    );
  });

  /**
   * The one that catches a multiplier applied inside a draw.
   *
   * Three worlds, same seed, same story stream, different settings — all forced
   * to fire the *same* beat on the same tick from the same rng state. That beat
   * is the opener, which is one raider on every setting, so the three runs have
   * exactly the same work to do and must take exactly the same number of values
   * out of the stream doing it.
   *
   * A single misplaced multiplier breaks this: `rng.int(16 * bite)` reads the
   * same one value as `rng.int(16)` and would pass, but `rng.chance(p) && bite >
   * 1 ? rng.chance(q) : false` would not, and neither would any "harder raiders
   * also get an extra roll for armour" that a later hand might add. The point of
   * pinning it now is that the failure it guards against is invisible in play —
   * the game still works, it is just a different game on every seed.
   *
   * The invariant is per-band, not per-run: further in, hard country genuinely
   * draws more, because rolling up four raiders takes more numbers than rolling
   * up two. That is the setting doing its job, not a leak.
   */
  it('spends the same draws on the same band, whatever the setting', () => {
    const drift = DIFFICULTY_ORDER.map((id) => {
      const world = createWorld(SEED, id);
      // Land the opener on this tick from a known state, so grace — which moves
      // *when* the beat lands, not what it costs — is held out of the measurement.
      world.storyteller.nextThreat = 1;
      const rng = new Rng(99);
      tickStoryteller(world, rng);
      expect(world.storyteller.threatsFired).toBe(1);
      return rng.state;
    });
    expect(new Set(drift).size).toBe(1);
  });
});

describe('the settings a player can feel', () => {
  it('gives the quiet valley longer before the first beat and hard country less', () => {
    const calm = createWorld(SEED, 'calm').storyteller.nextThreat;
    const mid = createWorld(SEED, 'settler').storyteller.nextThreat;
    const harsh = createWorld(SEED, 'harsh').storyteller.nextThreat;
    expect(calm).toBeGreaterThan(mid);
    expect(harsh).toBeLessThan(mid);
    // Concrete, in the units the player experiences: most of a week versus a day
    // and a half. A setting that moves the first raid by four hours is a setting
    // nobody notices.
    expect(calm / TICKS_PER_DAY).toBeGreaterThan(4);
    expect(harsh / TICKS_PER_DAY).toBeLessThan(2);
  });

  it('sends fewer beats over a fortnight on the quiet valley than on hard country', () => {
    // The experience test: not "the multiplier is 1.9" but "the player gets
    // materially fewer interruptions in the two weeks they are trying to build a
    // wall in". This is the number the setting is actually selling.
    const calm = storyRun('calm', 14);
    const mid = storyRun('settler', 14);
    const harsh = storyRun('harsh', 14);
    expect(calm.beats).toBeLessThan(mid.beats);
    expect(mid.beats).toBeLessThan(harsh.beats);
    // And the gap is worth a decision — roughly half again, not one extra beat.
    expect(harsh.beats).toBeGreaterThanOrEqual(calm.beats + 3);
  });

  it('opens with a single straggler on every setting', () => {
    // The tutorial raid. Hard country gets it a day sooner, not three-handed —
    // a first raid a new player cannot survive teaches nothing except to stop.
    for (const id of DIFFICULTY_ORDER) {
      const world = createWorld(SEED, id);
      const rng = new Rng(7);
      while (world.storyteller.threatsFired === 0) tickStoryteller(world, rng);
      expect(world.pawns.filter((p) => p.faction === 'raider' && !p.dead).length).toBe(1);
    }
  });

  it('arms the raiders harder on hard country and softer on the quiet valley', () => {
    // Measured on the same beat number from the same stream, so the only
    // difference between the three numbers is `bite`.
    const hpAt = (id: Difficulty): number => {
      const world = createWorld(SEED, id);
      const rng = new Rng(1234);
      // Past the scripted opener, so this is a scaled band and not the tutorial.
      while (world.storyteller.threatsFired < 4) tickStoryteller(world, rng);
      const raiders = world.pawns.filter((p) => p.faction === 'raider');
      return raiders.reduce((sum, p) => sum + p.maxHp, 0) / Math.max(1, raiders.length);
    };
    const calm = hpAt('calm');
    const mid = hpAt('settler');
    const harsh = hpAt('harsh');
    expect(calm).toBeLessThan(mid);
    expect(mid).toBeLessThan(harsh);
  });
});
