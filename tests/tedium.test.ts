/**
 * Nobody wants to do the same job all day.
 *
 * The work board is a strict ranking, which means that without something like
 * this a settler whose top column is farming farms until they die of old age.
 * These tests pin the three properties that make the fix safe to ship:
 *
 *  - it counts *runs*, not lifetimes, so a settler already switching between two
 *    trades is never told they are bored of either;
 *  - it is a preference and never a refusal — a colony with one job left on the
 *    board still gets it done, and the settler is grumpy about it rather than
 *    idle, which is the failure this whole mechanic risks;
 *  - emergencies are outside it entirely.
 *
 * The last block runs a real colony for half a day and watches what one settler
 * actually does with two trades in front of them, because "the counter goes up"
 * and "the settler changes their mind" are not the same claim.
 */

import { describe, expect, it } from 'vitest';

import { assignJob } from '../src/sim/jobs';
import { designate } from '../src/sim/orders';
import { type Passion, passionOf } from '../src/sim/skills';
import { RESPITE, bore, boredOf, stintFor, tediumOf } from '../src/sim/tedium';
import { TRAITS, stintMultiplier } from '../src/sim/traits';
import { makeStreams, stepWorld } from '../src/sim/tick';
import type { Pawn, SkillName, World, WorkType } from '../src/sim/types';
import { DESIG_HARVEST, TICKS_PER_DAY } from '../src/sim/types';
import { addItem, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

/**
 * A settler this world happens to feel a particular way about a trade.
 *
 * Passion is hashed off the seed and the settler's id and is not stored
 * anywhere, so the only way to ask "what does someone who does not care about
 * plants do" is to go and find one. Ids are scanned rather than the colony,
 * because a four-person colony has no reason to contain all three answers.
 */
function withPassion(world: World, pawn: Pawn, skill: SkillName, want: Passion): Pawn {
  const taken = new Set(world.pawns.map((p) => p.id));
  for (let id = 9000; id < 12000; id++) {
    if (taken.has(id)) continue;
    pawn.id = id;
    if (passionOf(world, pawn, skill) === want) return pawn;
  }
  throw new Error(`no id in this world is ${want} about ${skill}`);
}

/** Clear the work board down to the columns a test is actually watching. */
function onlyWork(world: World, keep: WorkType[]): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    for (const w of Object.keys(p.priorities) as WorkType[]) {
      p.priorities[w] = keep.includes(w) ? 1 : 0;
    }
  }
}

/** Book `n` jobs of one work type against a settler. */
function work(world: World, pawn: Pawn, w: WorkType, n: number): void {
  for (let i = 0; i < n; i++) bore(world, pawn, w);
}

// ---------------------------------------------------------------- functional

describe('how long somebody stays on one trade', () => {
  it('gives a settler with no feeling for it about three jobs', () => {
    const world = createWorld(20260729);
    const p = withPassion(world, livingColonists(world)[0]!, 'plants', 0);
    expect(stintFor(world, p, 'farm')).toBe(3);
  });

  it('lets somebody who loves the work stay on it far longer', () => {
    const world = createWorld(20260729);
    const p = livingColonists(world)[0]!;
    const cold = stintFor(world, withPassion(world, p, 'plants', 0), 'farm');
    const keen = stintFor(world, withPassion(world, p, 'plants', 1), 'farm');
    const burning = stintFor(world, withPassion(world, p, 'plants', 2), 'farm');
    expect(keen).toBeGreaterThan(cold);
    expect(burning).toBeGreaterThan(keen);
  });

  it('treats the trades nobody has a feeling for as exactly that', () => {
    // Hauling crates is not a craft: there is no skill behind it, so there is no
    // passion behind it either, and everybody tires of it at the base rate.
    const world = createWorld(20260729);
    for (const p of livingColonists(world)) {
      expect(stintFor(world, p, 'haul')).toBe(Math.max(1, Math.round(3 * stintMultiplier(p))));
    }
  });

  it('lets temperament stretch the run, in both directions', () => {
    expect(TRAITS.hardworking.stint).toBeGreaterThan(1);
    expect(TRAITS.slothful.stint).toBeLessThan(1);
    const world = createWorld(20260729);
    const p = withPassion(world, livingColonists(world)[0]!, 'plants', 0);
    p.traits = ['hardworking'];
    const long = stintFor(world, p, 'farm');
    p.traits = ['slothful'];
    expect(stintFor(world, p, 'farm')).toBeLessThan(long);
    // Never zero, whatever the multipliers do: "will not do any of it, ever" is
    // a broken settler, not a lazy one.
    expect(stintFor(world, p, 'farm')).toBeGreaterThanOrEqual(1);
  });
});

describe('the run itself', () => {
  it('holds out for the whole stint and then wants a change', () => {
    const world = createWorld(20260729);
    const p = withPassion(world, livingColonists(world)[0]!, 'plants', 0);
    const limit = stintFor(world, p, 'farm');
    for (let i = 1; i < limit; i++) {
      bore(world, p, 'farm');
      expect(boredOf(world, p, 'farm')).toBe(false);
    }
    bore(world, p, 'farm');
    expect(boredOf(world, p, 'farm')).toBe(true);
    expect(tediumOf(world, p)).toEqual(['farm']);
  });

  it('resets the moment they do something else', () => {
    // The whole reason it is a run and not a tally: a settler alternating two
    // trades is already doing what this system exists to make them do.
    const world = createWorld(20260729);
    const p = withPassion(world, livingColonists(world)[0]!, 'plants', 0);
    const limit = stintFor(world, p, 'farm');
    for (let i = 0; i < 20; i++) {
      work(world, p, 'farm', limit - 1);
      bore(world, p, 'mine');
      expect(boredOf(world, p, 'farm')).toBe(false);
    }
  });

  it('is over in under an hour of colony time, and starts clean', () => {
    const world = createWorld(20260729);
    const p = withPassion(world, livingColonists(world)[0]!, 'plants', 0);
    work(world, p, 'farm', stintFor(world, p, 'farm'));
    expect(boredOf(world, p, 'farm')).toBe(true);
    expect(RESPITE).toBeLessThan(TICKS_PER_DAY * 0.25);

    world.tick += RESPITE + 1;
    expect(boredOf(world, p, 'farm')).toBe(false);
    expect(tediumOf(world, p)).toEqual([]);
    // And the next field does not put them straight back off it: the run they
    // walked away from is spent, not paused.
    bore(world, p, 'farm');
    expect(boredOf(world, p, 'farm')).toBe(false);
  });

  it('keeps each trade on its own clock', () => {
    const world = createWorld(20260729);
    const p = withPassion(world, livingColonists(world)[0]!, 'plants', 0);
    work(world, p, 'farm', stintFor(world, p, 'farm'));
    expect(boredOf(world, p, 'farm')).toBe(true);
    expect(boredOf(world, p, 'mine')).toBe(false);
    expect(boredOf(world, p, 'haul')).toBe(false);
  });

  it('never gets tired of an emergency', () => {
    // A burning roof is not a matter of taste, and the colony's only doctor
    // being fed up with medicine on the morning of a raid is a lost run.
    const world = createWorld(20260729);
    const p = livingColonists(world)[0]!;
    for (const w of ['firefight', 'doctor', 'warden'] as WorkType[]) {
      work(world, p, w, 40);
      expect(boredOf(world, p, w)).toBe(false);
    }
    expect(tediumOf(world, p)).toEqual([]);
    expect(p.stint ?? null).toBe(null);
  });

  it('costs them something when the colony makes them do it anyway', () => {
    const world = createWorld(20260729);
    const p = withPassion(world, livingColonists(world)[0]!, 'plants', 0);
    const limit = stintFor(world, p, 'farm');
    work(world, p, 'farm', limit);
    const before = p.moodOffset ?? 0;
    bore(world, p, 'farm');
    expect(p.moodOffset ?? 0).toBeLessThan(before);
  });

  it('charges the grievance once a run, not once a crate', () => {
    // A colony with one column on the board is the player's problem to fix, not
    // grounds for walking their only hauler into a morale break. Going back to
    // the work ends the bout, so the complaint arrives at the rate a run does
    // and the offset decays faster than that.
    const world = createWorld(20260729);
    const p = withPassion(world, livingColonists(world)[0]!, 'plants', 0);
    const limit = stintFor(world, p, 'farm');
    work(world, p, 'farm', limit);

    const first = p.moodOffset ?? 0;
    bore(world, p, 'farm');
    const grumbled = p.moodOffset ?? 0;
    expect(grumbled).toBeLessThan(first);
    // Straight back into a fresh run rather than a second grievance.
    expect(boredOf(world, p, 'farm')).toBe(false);
    work(world, p, 'farm', limit - 1);
    expect(p.moodOffset ?? 0).toBe(grumbled);
    expect(boredOf(world, p, 'farm')).toBe(true);
  });

  it('rides an old save that has never heard of any of it', () => {
    const world = createWorld(20260729);
    const p = livingColonists(world)[0]!;
    delete p.stint;
    delete p.tedium;
    expect(boredOf(world, p, 'farm')).toBe(false);
    expect(tediumOf(world, p)).toEqual([]);
    bore(world, p, 'farm');
    expect(p.stint).toEqual({ work: 'farm', count: 1 });
  });
});

// --------------------------------------------------------------- experience

describe('a settler with something else to do', () => {
  /**
   * One settler, a yard full of loose goods, and a stand of trees marked.
   *
   * Hauling is the whole of their level 1 and chopping is all of their level 2,
   * so the board's answer is "haul" every single time there is anything left on
   * the ground — and there is: fourteen stacks is more than a morning's work.
   * Every chop in the run below is therefore the settler's idea, not the
   * ranking's.
   */
  function twoTrades(): { world: World; pawn: Pawn } {
    const world = createWorld(20260729);
    const pawn = livingColonists(world)[0]!;
    onlyWork(world, []);
    pawn.priorities.haul = 1;
    pawn.priorities.chop = 2;
    pawn.needs.food = 1;
    pawn.needs.rest = 1;

    let dropped = 0;
    for (let dy = -4; dy <= 4 && dropped < 14; dy++) {
      for (let dx = -4; dx <= 4 && dropped < 14; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (addItem(world, 'wood', 5, Math.round(pawn.x) + dx, Math.round(pawn.y) + dy)) dropped++;
      }
    }
    let trees = 0;
    for (const b of world.buildings) {
      if (b.kind !== 'tree' || trees >= 12) continue;
      if (designate(world, b.x, b.y, DESIG_HARVEST)) trees++;
    }
    expect(dropped).toBe(14);
    expect(trees).toBe(12);
    return { world, pawn };
  }

  it('takes the other job on the board rather than the one they are sick of', () => {
    const { world, pawn } = twoTrades();
    work(world, pawn, 'haul', stintFor(world, pawn, 'haul'));
    assignJob(world, pawn);
    const job = world.jobs.find((j) => j.id === pawn.jobId);
    expect(job).toBeDefined();
    // Hauling is a whole priority level above chopping and there are crates at
    // their feet; they go and cut a tree down instead.
    expect(job!.kind).toBe('chop');
  });

  it('goes back to it rather than standing there, when it is all there is', () => {
    // The failure this mechanic could ship: a colony of people sulking in the
    // yard with work on the board. A preference is not a refusal.
    const { world, pawn } = twoTrades();
    pawn.priorities.chop = 0;
    work(world, pawn, 'haul', stintFor(world, pawn, 'haul'));
    expect(boredOf(world, pawn, 'haul')).toBe(true);
    assignJob(world, pawn);
    expect(pawn.jobId).not.toBeNull();
    expect(world.jobs.find((j) => j.id === pawn.jobId)?.kind).toBe('haulToStockpile');
  });

  it('changes its mind on its own, in a colony nobody is poking', () => {
    const { world, pawn } = twoTrades();
    const streams = makeStreams(world);
    const did = new Set<string>();
    for (let i = 0; i < TICKS_PER_DAY * 0.3; i++) {
      stepWorld(world, streams);
      const job = world.jobs.find((j) => j.id === pawn.jobId);
      if (job) did.add(job.kind);
    }
    // Both halves matter. They hauled, because that is the top of their board;
    // and somewhere in the middle of the morning they went and cut a tree down,
    // which no ranking in this game would ever have told them to do.
    expect(did.has('haulToStockpile')).toBe(true);
    expect(did.has('chop')).toBe(true);
  });
});
