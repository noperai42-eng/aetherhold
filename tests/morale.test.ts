/**
 * Morale has to be load-bearing or it should not be on the screen.
 *
 * The inspector drew a mood bar and the settler panel would print "breaking"
 * from the day the game shipped, and nothing in the sim read either number: a
 * settler at zero mood hauled planks exactly as fast as a settler at full. That
 * is the worst kind of stat — one that teaches the player to watch something
 * that cannot bite. These tests pin both teeth. Slower work while miserable, and
 * a settler who stops entirely below the line the label already promised.
 *
 * The other half is the way out. A break must be survivable: a settler on one
 * still eats, still sleeps, still sits at the table, because those are exactly
 * the things that end it. A break that starved the settler having it would turn
 * one bad afternoon into a wipe, which is a worse game than no morale at all.
 */

import { describe, expect, it } from 'vitest';

import { addResearchPoints, setProject } from '../src/sim/research';
import { assignJob, workRate } from '../src/sim/jobs';
import {
  BREAK_MAX_TICKS,
  BREAK_MIN_TICKS,
  BREAK_MOOD,
  BREAK_RECOVER_MOOD,
  celebrate,
  computeMood,
  grieve,
  HUNGRY,
  isBreaking,
  MOOD_BASE,
  MOOD_OFFSET_LIMIT,
  moodBreakdown,
  moraleScale,
  nudgeMood,
  tickNeeds,
  worstMoodFactor,
} from '../src/sim/needs';
import { alerts, type Alert } from '../src/sim/alerts';
import { spawnRaid } from '../src/sim/events';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { TICKS_PER_DAY, type Pawn, type World } from '../src/sim/types';
import { addBuilding, livingColonists, msg } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

function colony(seed = 20260729): World {
  return createWorld(seed);
}

/** Drive the needs down far enough that mood is under the break line. */
function despair(pawn: Pawn): void {
  pawn.needs.food = 0.05;
  pawn.needs.rest = 0;
  pawn.needs.recreation = 0;
  pawn.mood = computeMood(pawn);
}

/** Everything a settler could want, so mood sits at the top of its range. */
function content(pawn: Pawn): void {
  pawn.needs.food = 1;
  pawn.needs.rest = 1;
  pawn.needs.recreation = 1;
  pawn.hp = pawn.maxHp;
  pawn.mood = computeMood(pawn);
}

/**
 * Unconscious is not awake.
 *
 * Every "is this settler asleep" branch in the sim reads `activity === 'sleeping'`,
 * and a settler on the floor after a raid has activity `'downed'` — so the rest
 * need drained flat out through every hour they lay there. A colony that had a bad
 * afternoon woke up an exhausted one, and `tired` was the top morale drag in the
 * days after every fight, which is the game punishing the player twice for the
 * same event and offering no move against the second one.
 */
describe('a settler flat on their back', () => {
  it('recovers rest instead of burning it', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    content(p);
    p.needs.rest = 0.4;
    p.downed = true;
    p.activity = 'downed';
    for (let i = 0; i < 200; i++) tickNeeds(world, p);
    expect(p.needs.rest).toBeGreaterThan(0.4);
  });

  it('still gets hungry, or being knocked out would be a free lunch', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    content(p);
    p.downed = true;
    p.activity = 'downed';
    for (let i = 0; i < 200; i++) tickNeeds(world, p);
    expect(p.needs.food).toBeLessThan(1);
  });

  it('leaves an ordinary settler on their feet draining as before', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    content(p);
    p.needs.rest = 0.4;
    p.activity = 'idle';
    for (let i = 0; i < 200; i++) tickNeeds(world, p);
    expect(p.needs.rest).toBeLessThan(0.4);
  });
});

describe('mood is made of things that happened', () => {
  it('takes a nudge and folds it into the mood on the same tick', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    // Mid-range on purpose: at full needs mood is already pinned at 1 and there
    // is nowhere for a nudge to show up.
    p.needs.food = 0.6;
    p.needs.rest = 0.6;
    p.needs.recreation = 0.6;
    p.mood = computeMood(p);
    const before = p.mood;
    nudgeMood(p, 0.1);
    expect(p.moodOffset).toBeCloseTo(0.1, 6);
    // The whole reason nudgeMood exists: mood is recomputed from the needs every
    // tick, so a direct write to `mood` would live for one tick and vanish.
    expect(p.mood).toBeGreaterThan(before);
    tickNeeds(world, p);
    expect(p.mood).toBeGreaterThan(before);
  });

  it('will not let a run of good days outweigh an empty stomach', () => {
    const p = livingColonists(colony())[0]!;
    for (let i = 0; i < 40; i++) nudgeMood(p, 0.1);
    expect(p.moodOffset).toBeCloseTo(MOOD_OFFSET_LIMIT, 6);
    for (let i = 0; i < 40; i++) nudgeMood(p, -0.1);
    expect(p.moodOffset).toBeCloseTo(-MOOD_OFFSET_LIMIT, 6);
  });

  it('forgets a good dinner inside a day', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    content(p);
    nudgeMood(p, 0.2);
    for (let i = 0; i < TICKS_PER_DAY; i++) tickNeeds(world, p);
    expect(p.moodOffset).toBe(0);
  });

  it('spreads a death across everyone left and skips the person it happened to', () => {
    const world = colony();
    const crew = livingColonists(world);
    expect(crew.length).toBeGreaterThan(2);
    for (const p of crew) content(p);
    const raider = spawnRaid(world, new Rng(5), 1)[0]!;
    const lost = crew[0]!;
    grieve(world, lost);
    expect(lost.moodOffset ?? 0).toBe(0);
    for (const p of crew.slice(1)) expect(p.moodOffset!).toBeLessThan(0);
    // A raid is not a bereavement.
    expect(raider.moodOffset ?? 0).toBe(0);
  });

  it('lifts everyone when a project lands', () => {
    const world = colony();
    for (const p of livingColonists(world)) content(p);
    celebrate(world);
    for (const p of livingColonists(world)) expect(p.moodOffset!).toBeGreaterThan(0);
  });
});

describe('a miserable settler works slower', () => {
  it('scales the whole work rate, not the skill', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    p.skills.construction = 10;

    content(p);
    const happy = workRate(p, 'construction');
    despair(p);
    const wretched = workRate(p, 'construction');

    expect(wretched).toBeLessThan(happy);
    // Narrow on purpose. Morale is a tax you feel over a day, not a cliff — the
    // cliff is the break, where at least the player is told what happened.
    expect(wretched / happy).toBeGreaterThan(0.7);
    expect(moraleScale(p)).toBeLessThan(moraleScale({ ...p, mood: 1 } as Pawn));
  });
});

describe('a break', () => {
  it('starts when mood falls to the line the label already promised', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    content(p);
    tickNeeds(world, p);
    expect(isBreaking(p)).toBe(false);

    despair(p);
    expect(p.mood).toBeLessThanOrEqual(BREAK_MOOD);
    tickNeeds(world, p);
    expect(isBreaking(p)).toBe(true);
    expect(world.messages.at(-1)!.text).toContain(p.name);
  });

  it('is counted once, so a balance sweep can see a colony that faltered', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    expect(world.stats.moraleBreaks ?? 0).toBe(0);
    despair(p);
    tickNeeds(world, p);
    // A hundred more ticks of the same misery is still the one break — the
    // counter has to survive the tick that made it, not restate it.
    for (let i = 0; i < 100; i++) tickNeeds(world, p);
    expect(world.stats.moraleBreaks).toBe(1);
  });

  it('takes a drafted settler off the line', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    p.drafted = true;
    p.orderX = 10;
    p.orderY = 10;
    despair(p);
    tickNeeds(world, p);
    expect(p.drafted).toBe(false);
    expect(p.orderX).toBeNull();
  });

  it('never takes the controls off the player', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    p.playerControlled = true;
    despair(p);
    for (let i = 0; i < 200; i++) tickNeeds(world, p);
    expect(isBreaking(p)).toBe(false);
  });

  it('ends once they feel better, but not before the floor', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    despair(p);
    tickNeeds(world, p);
    expect(isBreaking(p)).toBe(true);

    // Fixed instantly. They still sulk for the minimum, or a settler hovering on
    // the line flickers in and out of breaking every tick.
    content(p);
    expect(p.mood).toBeGreaterThan(BREAK_RECOVER_MOOD);
    for (let i = 0; i < BREAK_MIN_TICKS - 2; i++) {
      content(p);
      tickNeeds(world, p);
    }
    expect(isBreaking(p)).toBe(true);
    for (let i = 0; i < 4; i++) {
      content(p);
      tickNeeds(world, p);
    }
    expect(isBreaking(p)).toBe(false);
  });

  it('runs out on its own so a hopeless colony still gets a chance to answer it', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    despair(p);
    tickNeeds(world, p);
    // Nothing ever improves — no food, no bed, no table. Left to the mood alone
    // this settler would never stand up again.
    for (let i = 0; i < BREAK_MAX_TICKS + 2; i++) {
      despair(p);
      tickNeeds(world, p);
    }
    expect(isBreaking(p)).toBe(false);
    // And they do not simply re-break on the next tick.
    expect(p.moodOffset!).toBeGreaterThan(0);
    tickNeeds(world, p);
    expect(isBreaking(p)).toBe(false);
  });
});

describe('a settler on a break', () => {
  it('refuses work but still goes to eat', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    // Something to do: plenty of loose wood and the run of the board.
    for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
      p.priorities[w] = 1;
    }
    content(p);
    assignJob(world, p);
    expect(p.jobId).not.toBeNull();

    p.jobId = null;
    despair(p);
    tickNeeds(world, p);
    expect(isBreaking(p)).toBe(true);
    // Hungry, so the need job still fires — that is what will end the break.
    assignJob(world, p);
    const job = world.jobs.find((j) => j.id === p.jobId);
    expect(job?.kind).toBe('eat');

    // Fed, and now there is no reason for them to be doing anything at all.
    world.jobs.length = 0;
    p.jobId = null;
    p.needs.food = 1;
    p.needs.rest = 1;
    p.needs.recreation = 1;
    p.mood = BREAK_MOOD;
    assignJob(world, p);
    expect(p.jobId).toBeNull();
  });

  it('is visible from the colony view without opening a panel', () => {
    const world = colony();
    const streams = makeStreams(world);
    const p = livingColonists(world)[0]!;
    p.jobId = null;
    despair(p);
    tickNeeds(world, p);
    // Fed and rested so no need job outranks the sulk, but mood pinned low so
    // the break does not end.
    p.needs.food = 1;
    p.needs.rest = 1;
    p.needs.recreation = 1;
    p.moodOffset = -MOOD_OFFSET_LIMIT;
    let seen = false;
    for (let i = 0; i < 200 && !seen; i++) {
      p.moodOffset = -MOOD_OFFSET_LIMIT;
      stepWorld(world, streams);
      seen = p.activity === 'breaking';
    }
    expect(seen).toBe(true);
  });
});

describe('the colony that looks after its people', () => {
  it('keeps working through a famine that breaks the one that does not', () => {
    const run = (fed: boolean): number => {
      const world = colony();
      const streams = makeStreams(world);
      if (!fed) {
        // A real failure mode, staged: the pantry is bare, the plot is barren and
        // there is nowhere comfortable to sleep it off. Nothing here is reachable
        // only by test surgery — it is what a bad week looks like.
        world.items.length = 0;
        world.crops.fill(0);
        // And the moor is bare too, which is the line that keeps this a famine.
        // Emptying the pantry stopped being enough the day brambles went in: a
        // hundred and fifty bushes is food the colony did not have to build, so a
        // settler on nothing simply walked out and picked breakfast and the three
        // days this test stages passed with nobody more than peckish. Left in, the
        // test would have gone on reporting that the mood system was fine because
        // the colony was never actually hungry.
        world.bushes = [];
        for (const b of world.buildings) if (b.kind === 'bed' || b.kind === 'stove') b.built = false;
      }
      let broken = 0;
      for (let i = 0; i < TICKS_PER_DAY * 3; i++) {
        stepWorld(world, streams);
        for (const p of livingColonists(world)) if (p.activity === 'breaking') broken++;
      }
      return broken;
    };
    // Same map, same settlers, same three days. The only difference is whether
    // there was anything to eat.
    expect(run(true)).toBe(0);
    expect(run(false)).toBeGreaterThan(0);
  });

  it('pulls itself back together once the food comes back', () => {
    const world = colony();
    const streams = makeStreams(world);
    world.items.length = 0;
    world.crops.fill(0);
    // Same reason as the famine above: a valley with brambles in it is a valley
    // with food in it, and this test needs one with none.
    world.bushes = [];
    for (const b of world.buildings) if (b.kind === 'bed' || b.kind === 'stove') b.built = false;

    let sawABreak = false;
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
      stepWorld(world, streams);
      if (livingColonists(world).some((p) => p.activity === 'breaking')) sawABreak = true;
    }
    expect(sawABreak).toBe(true);

    // A break is a bad week, not a death sentence: the settlers keep eating and
    // sleeping through it, so the colony that finds food again gets its people
    // back without the player doing anything clever.
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) stepWorld(world, streams);
    for (const p of livingColonists(world)) expect(isBreaking(p)).toBe(false);
  });

  it('starts nobody on a break', () => {
    const world = colony();
    const streams = makeStreams(world);
    for (let i = 0; i < TICKS_PER_DAY; i++) stepWorld(world, streams);
    for (const p of livingColonists(world)) expect(isBreaking(p)).toBe(false);
  });
});

describe('the whole thing still round-trips', () => {
  it('reads a settler saved before morale existed as one who is fine', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    content(p);
    // Exactly what an old save deserialises to: the fields simply are not there.
    delete p.moodOffset;
    delete p.breakTicks;
    expect(isBreaking(p)).toBe(false);
    expect(computeMood(p)).toBeGreaterThan(BREAK_RECOVER_MOOD);
    tickNeeds(world, p);
    expect(isBreaking(p)).toBe(false);
  });
});

describe('research still pays its morale dividend through the real loop', () => {
  it('lifts the colony when the project actually lands', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    addBuilding(world, 'lab', Math.round(p.x) + 2, Math.round(p.y), true);
    expect(setProject(world, 'toolmaking')).toBe(true);
    for (const q of livingColonists(world)) content(q);
    const before = livingColonists(world).map((q) => q.moodOffset ?? 0);
    // Straight to the finish line — this test is about the payout, not the grind.
    const done = addResearchPoints(world, 999999);
    expect(done?.id).toBe('toolmaking');
    celebrate(world);
    const after = livingColonists(world).map((q) => q.moodOffset ?? 0);
    for (let i = 0; i < after.length; i++) expect(after[i]!).toBeGreaterThan(before[i]!);
    msg(world, 'done', 'info');
  });
});

/**
 * The number, and the reason for it.
 *
 * `computeMood` folds twelve things into one figure, and for most of this game's
 * life that figure was all anybody ever saw — including the alert that fired when
 * somebody broke, which gave every settler in the colony the same advice about
 * beds and hot dinners whether they were starving, freezing or simply a pessimist
 * having an ordinary week.
 *
 * The breakdown is a second reading of the same twelve terms, which is exactly
 * the shape of thing that drifts: somebody adds a term to the mood and not to the
 * explanation, and the panel keeps adding up to the wrong number quietly and
 * forever. The first test here is the one that makes that impossible.
 */
describe('why that mood', () => {
  /** Every field mood is computed from, set to something arbitrary but legal. */
  function scramble(pawn: Pawn, rng: Rng): void {
    pawn.needs.food = rng.chance(0.2) ? 0 : rng.next();
    pawn.needs.rest = rng.chance(0.2) ? 0 : rng.next();
    pawn.needs.recreation = rng.next();
    pawn.hp = Math.max(1, Math.round(pawn.maxHp * rng.next()));
    pawn.downed = rng.chance(0.2);
    pawn.comfort = rng.range(-1, 1);
    pawn.socialMood = rng.range(-0.08, 0.08);
    pawn.roomMood = rng.range(-0.08, 0.08);
    pawn.fumesMood = rng.range(-0.12, 0);
    pawn.moodOffset = rng.range(-MOOD_OFFSET_LIMIT, MOOD_OFFSET_LIMIT);
    pawn.traits = rng.chance(0.5) ? ['optimist'] : rng.chance(0.5) ? ['pessimist'] : [];
  }

  it('adds up to the mood itself, whatever state the settler is in', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    const rng = new Rng(20260801);
    for (let i = 0; i < 400; i++) {
      scramble(p, rng);
      const sum = moodBreakdown(p).reduce((a, f) => a + f.amount, 0);
      // The whole contract. A term added to `computeMood` and not to
      // `moodBreakdown` fails here rather than shipping a panel that silently
      // stops explaining part of the number it is standing under.
      expect(Math.max(0, Math.min(1, MOOD_BASE + sum))).toBeCloseTo(computeMood(p), 10);
    }
  });

  it('has nothing to say about a settler with nothing wrong with them', () => {
    const p = livingColonists(colony())[0]!;
    content(p);
    p.comfort = 0;
    p.socialMood = 0;
    p.roomMood = 0;
    p.fumesMood = 0;
    p.moodOffset = 0;
    p.traits = [];
    // Zero terms are dropped, so the panel does not print six rows of "+0%" at a
    // settler who is simply fine.
    expect(moodBreakdown(p)).toEqual([]);
    expect(worstMoodFactor(p)).toBeNull();
  });

  it('says which way the thermometer went wrong', () => {
    const p = livingColonists(colony())[0]!;
    content(p);
    p.comfort = -0.8;
    expect(moodBreakdown(p).map((f) => f.label)).toContain('cold');
    p.comfort = 0.8;
    expect(moodBreakdown(p).map((f) => f.label)).toContain('too hot');
  });

  it('separates a settler who is hungry from one who is starving', () => {
    const p = livingColonists(colony())[0]!;
    content(p);
    p.needs.food = 0.3;
    expect(moodBreakdown(p).map((f) => f.label)).not.toContain('starving');
    p.needs.food = 0;
    // Two rows, not one that quietly doubles in size: "get round to it" and
    // "drop everything" are different instructions to the player.
    const labels = moodBreakdown(p).map((f) => f.label);
    expect(labels).toContain('hungry');
    expect(labels).toContain('starving');
  });

  /**
   * "hungry" used to be the top mood drag on every day of every seed, in colonies
   * sitting on three hundred units of food. The drag was linear across the whole
   * need while settlers only stop work to eat below HUNGRY — so a colony doing
   * everything right paid a tax it had no move against, and the one row that was
   * supposed to say "somebody is not getting fed" said it constantly and meant
   * nothing. It starts where eating starts now.
   */
  it('says nothing about hunger until a settler would go and eat', () => {
    const p = livingColonists(colony())[0]!;
    content(p);
    p.needs.food = HUNGRY + 0.01;
    expect(moodBreakdown(p).map((f) => f.label)).not.toContain('hungry');

    p.needs.food = HUNGRY - 0.01;
    const nibbling = moodBreakdown(p).find((f) => f.label === 'hungry')!;
    expect(nibbling).toBeDefined();
    // And it grows from nothing rather than arriving as a cliff.
    expect(Math.abs(nibbling.amount)).toBeLessThan(0.02);

    p.needs.food = 0;
    const empty = moodBreakdown(p).find((f) => f.label === 'hungry')!;
    expect(Math.abs(empty.amount)).toBeGreaterThan(Math.abs(nibbling.amount));
  });

  it('puts the worst thing first', () => {
    const p = livingColonists(colony())[0]!;
    content(p);
    p.needs.food = 0.2;
    p.needs.rest = 0.9;
    p.comfort = -0.2;
    const amounts = moodBreakdown(p).map((f) => f.amount);
    for (let i = 1; i < amounts.length; i++) expect(amounts[i]!).toBeGreaterThanOrEqual(amounts[i - 1]!);
    expect(worstMoodFactor(p)!.label).toBe('hungry');
  });

  it('never tells the player to go and fix somebody’s personality', () => {
    const p = livingColonists(colony())[0]!;
    content(p);
    p.traits = ['pessimist'];
    p.comfort = -0.2;
    p.mood = computeMood(p);
    // Pessimist is -0.10 and the cold is -0.036, so the trait is genuinely the
    // largest thing on the card — and is still the least useful answer to "what
    // do I do about it". The panel lists it; the advice does not.
    expect(moodBreakdown(p)[0]!.label).toBe('Pessimist');
    expect(worstMoodFactor(p)!.label).toBe('cold');
  });

  it('reads a settler saved before any of this as one with nothing wrong', () => {
    const p = livingColonists(colony())[0]!;
    content(p);
    delete p.comfort;
    delete p.socialMood;
    delete p.roomMood;
    delete p.fumesMood;
    delete p.moodOffset;
    delete p.traits;
    expect(moodBreakdown(p)).toEqual([]);
  });
});

describe('the alert that says somebody is breaking', () => {
  /** The alert about this settler, whichever of the two it is. */
  function moodAlert(world: World, p: Pawn): Alert {
    const found = alerts(world).find((a) => a.pawnId === p.id && /breaking|stopped working/.test(a.text));
    expect(found).toBeDefined();
    return found!;
  }

  it('names what is actually wrong instead of guessing at beds and dinners', () => {
    const world = colony();
    const [cold, hungry] = livingColonists(world);
    for (const p of livingColonists(world)) content(p);

    // Fed, and freezing. Both of these are miserable for several reasons at once,
    // because one cause is never enough to break a settler on its own — the cold
    // is worth 0.18 at its very worst and the line is at 0.24. What matters is
    // which cause is the *largest*, and for this one it is not the one the old
    // hint named: it told the player to feed a settler who was full.
    content(cold!);
    cold!.traits = [];
    cold!.comfort = -1;
    cold!.needs.rest = 0.3;
    cold!.needs.recreation = 0.3;
    cold!.hp = cold!.maxHp * 0.5;
    cold!.moodOffset = -0.17;
    cold!.mood = computeMood(cold!);

    content(hungry!);
    hungry!.traits = [];
    hungry!.needs.food = 0;
    hungry!.needs.rest = 0.5;
    hungry!.needs.recreation = 0.5;
    hungry!.moodOffset = -0.1;
    hungry!.mood = computeMood(hungry!);

    expect(cold!.mood).toBeLessThan(BREAK_MOOD + 0.06);
    expect(hungry!.mood).toBeLessThan(BREAK_MOOD + 0.06);
    // Same alert, same colony, same tick — two different answers, because the
    // two settlers have two different problems.
    expect(moodAlert(world, cold!).hint).toMatch(/freezing/i);
    expect(moodAlert(world, hungry!).hint).toMatch(/hungry|cook/i);
    expect(moodAlert(world, cold!).hint).not.toBe(moodAlert(world, hungry!).hint);
  });

  it('still has something to say for a settler nothing in particular is wrong with', () => {
    const world = colony();
    const p = livingColonists(world)[0]!;
    for (const q of livingColonists(world)) content(q);
    content(p);
    p.traits = ['pessimist'];
    p.mood = BREAK_MOOD - 0.01;
    p.breakTicks = 10;
    // A pessimist on a bad week has no single cause worth naming, and an alert
    // with no answer on it is just anxiety. The generic line survives for exactly
    // this case.
    expect(moodAlert(world, p).hint).toMatch(/morale/i);
  });
});
