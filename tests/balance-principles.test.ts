/**
 * The principle checks, tested against grids made of numbers instead of grids
 * made of colonies.
 *
 * This file exists because of a mistake. The first thirty-day grid failed on an
 * enforced principle after thirty-five minutes of simulation, and the principle
 * was the thing that was wrong — it asserted a property of the food economy
 * under a promise about difficulty, so it broke on a run where difficulty was
 * behaving perfectly. A wrong check should not cost thirty-five minutes to find.
 *
 * Every check in principles.ts is a pure function of a `Sweep`, so the grid it
 * reads can be written by hand. What follows is one synthetic grid per verdict
 * that matters: a valley that behaves, a valley that does not, and the
 * short-grid cases that must come back `untested` rather than `broken`.
 * `tests/balance-grid.test.ts` still plays the real colonies — this only fixes
 * what the numbers coming out of them are read to mean.
 */

import { describe, expect, it } from 'vitest';
import { judgePrinciples } from '../src/eval/principles';
import { UPKEEP_DIALS, type ArmPoint, type RunMeasure, type Sweep } from '../src/eval/sweep';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../src/sim/difficulty';
import { WAR_PARTY } from '../src/sim/holdings';
import { RESEARCH, RESEARCH_ORDER } from '../src/sim/research';
import { CAN_SPARE_ONE, roundTripDays } from '../src/sim/settlements';
import type { Difficulty } from '../src/sim/types';

/**
 * The last project the tree gives away, derived the same way the check derives
 * it — a literal here would go stale the day a bill moves onto an earlier
 * project, and it would go stale silently, which is the worst way for a test
 * about a threshold to be wrong.
 */
const THIRD_TIER = RESEARCH_ORDER.filter((id) => !RESEARCH[id].materials).length;

/** A run that did nothing interesting, overridden field by field per case. */
function run(difficulty: Difficulty, over: Partial<RunMeasure> = {}): RunMeasure {
  return {
    seed: 1,
    difficulty,
    verdict: 'thriving',
    daysLived: 30,
    firstThreatDay: 4,
    threats: 10,
    biggestBand: 4,
    downs: 2,
    buried: 0,
    survivors: 8,
    raidersKilled: 10,
    peakRung: 2,
    worstFood: 0.4,
    meanFood: 0.6,
    upkeepShare: 0.42,
    endFoodDays: 20,
    raidersSeen: 20,
    armedShare: 0.3,
    foundedOn: null,
    // thirty days is the default grid, and thirty days is not long enough to
    // walk the far road, so the baseline run has only ever stood in ring zero
    ringOpenedOn: [0, null, null],
    // and a colony that never left home country walked the near ring and
    // nothing else, which is what the grid measured before anybody counted
    tripsByRing: [6, 0, 0],
    spareDays: 20,
    // A colony a fortnight into the second tier, with a working store: the tree
    // still has somewhere to go and the steel is being spent as fast as it is
    // dug. Both of the industrial-base principles read a sixty-day grid, so the
    // thirty-day baseline never reaches them — these are here so a case that
    // *does* want them only has to say which way it differs.
    tech: 9,
    emptyTreeDays: 0,
    // Nobody standing at a finished bench waiting for a cart. The default is a
    // colony that fetched what the project cost before the points ran out, which
    // is the behaviour the third tier is built to produce.
    stalledDays: 0,
    // −1 is "never stood short of anything", which is what a run that did
    // nothing interesting did. Cases about the road override it with the ring
    // their bill was payable in, because that is what sets the bar they are
    // judged against.
    stallRing: -1,
    // …and so, trivially, nobody standing there with nobody on the road either.
    // The two columns are only interesting when they disagree, which is a thing
    // a case has to ask for: a run stalled for a fortnight with a party out the
    // whole time keeps this at nought, and one that never sent anybody sets it
    // equal to `stalledDays`.
    unsentDays: 0,
    endSteel: 120,
    steelDrawdown: 60,
    // One rung on each road, which is what the rest of this fixture describes: a
    // colony nine projects into the tree, ten raiders put down, and on speaking
    // terms with the near ridge it has walked six times. It is deliberately level
    // across all three — a baseline that already had one road ahead of another
    // would hand `the-three-roads-are-three-roads` half its evidence for free,
    // and a case about the roads should have to say so out loud.
    roadRungs: [1, 1, 1],
    // Eight settlers at the high-water mark — the same colony `survivors`
    // describes, which is what makes a run built off this baseline *able* to have
    // campaigned and then not. A default below `CAN_SPARE_ONE + WAR_PARTY` would
    // drop every run out of `the-war-is-a-choice`'s denominator, and a case about
    // the war would come back `untested` while looking like it had been asked.
    //
    // The two war promises read `sweep.war`, not `sweep.runs` — the family played
    // with a Steward at the wheel — so these four columns only reach a verdict
    // when a fixture puts the run in that family. `healthyWar` does.
    peakHands: 8,
    // …and having been able, it stayed home. Warfare is the one road the baseline
    // does not walk, because a war is the only thing in the game nothing plans:
    // the colony that did nothing interesting never ordered one.
    campaigns: 0,
    holdingsTaken: 0,
    warPawnDays: 0,
    ...over,
  };
}

/** A controlled arm that separates properly, to vary only where a case needs it. */
const healthyArm = (): ArmPoint[] => [
  { dial: 0.85, upkeepShare: 0.313 },
  { dial: 1, upkeepShare: 0.347 },
  { dial: 1.12, upkeepShare: 0.371 },
];

/**
 * A war family where both stage-4 promises are kept, to vary only where a case
 * needs it.
 *
 * These are not the grid's colonies. `sweep.runs` plays unmanaged — the floor
 * the sim has to clear with nobody at the wheel — and a campaign is the one
 * errand nothing in the sim ever plans for itself, so on that family the war
 * columns are zero by construction and a fixture that put a campaign there would
 * be describing a colony that cannot exist. The war questions are asked of the
 * replay with a Steward driving, and that is the family these three belong to.
 *
 * Their disagreement is the promise rather than decoration: all three had the
 * hands, two went out and one stayed home. `run`'s default `peakHands: 8` clears
 * `CAN_SPARE_ONE + WAR_PARTY`, so all three are in the denominator.
 */
const healthyWar = (): RunMeasure[] => [
  // Able and stayed home — without this one the war stops being a choice.
  run('calm'),
  // One party out to the near ring and home again is `WAR_PARTY *
  // roundTripDays(0)` = 18 pawn-days, the cheapest legal war in the game — so
  // this run sits exactly *on* the floor `no-holding-falls-for-free` sets rather
  // than comfortably above it. A fixture whose healthiest war is also its
  // thinnest is the honest one: if that check ever starts reading its own
  // boundary as a breach, this catches it.
  run('settler', { campaigns: 1, holdingsTaken: 1, warPawnDays: 18 }),
  // Three wars, two holdings: the one that lost a party and walked home empty
  // still paid for the walk. Reads well above the floor and is not in breach,
  // because the floor is a floor and not a window.
  run('harsh', { campaigns: 3, holdingsTaken: 2, warPawnDays: 62 }),
];

function sweep(
  runs: RunMeasure[],
  days = 30,
  arm: ArmPoint[] = healthyArm(),
  playPastFounding = false,
  war: RunMeasure[] = healthyWar(),
): Sweep {
  return {
    seeds: [...new Set(runs.map((r) => r.seed))],
    difficulties: ['calm', 'settler', 'harsh'],
    days,
    playPastFounding,
    runs,
    arm,
    war,
  };
}

/**
 * The shape of a valley where every promise is kept, to vary one field at a time.
 *
 * Its three colonies went three different ways, and that is one of the promises
 * rather than decoration: a healthy grid is one where the roads out of the
 * valley disagree about which colony is ahead. The quiet map studied, the
 * middling one traded, and the one that was attacked ninety times fought.
 */
const healthy = () => [
  run('calm', {
    roadRungs: [2, 1, 0],
    firstThreatDay: 5,
    threats: 6,
    biggestBand: 2,
    downs: 0,
    endFoodDays: 27,
    worstFood: 0.35,
    meanFood: 0.72,
    upkeepShare: 0.38,
    raidersSeen: 12,
    armedShare: 0.15,
  }),
  run('settler', {
    roadRungs: [1, 2, 1],
    firstThreatDay: 3,
    threats: 13,
    biggestBand: 6,
    downs: 7,
    endFoodDays: 22,
    worstFood: 0.2,
    meanFood: 0.63,
    upkeepShare: 0.42,
    raidersSeen: 40,
    armedShare: 0.3,
  }),
  run('harsh', {
    roadRungs: [1, 0, 2],
    firstThreatDay: 2,
    threats: 22,
    biggestBand: 8,
    downs: 42,
    buried: 2,
    endFoodDays: 18,
    worstFood: 0.08,
    meanFood: 0.51,
    upkeepShare: 0.47,
    raidersSeen: 90,
    armedShare: 0.55,
    peakRung: 4,
  }),
];

const verdictOf = (s: Sweep, id: string) => judgePrinciples(s).find((p) => p.id === id)?.verdict;
const detailOf = (s: Sweep, id: string) => judgePrinciples(s).find((p) => p.id === id)?.detail ?? '';

describe('the balance principles, read against grids that are known wrong', () => {
  it('passes a valley where every setting behaves', () => {
    const results = judgePrinciples(sweep(healthy()));
    const broken = results.filter((r) => r.verdict === 'broken');
    expect(broken.map((r) => `${r.id}: ${r.detail}`)).toEqual([]);
  });

  it('catches settings that are ordered backwards', () => {
    // Harsh handed the calm numbers and vice versa. Each of the four ordering
    // promises has to notice on its own, because in a real regression only one
    // multiplier moves and the grid should name which one.
    const s = sweep([
      run('calm', { firstThreatDay: 2, threats: 22, biggestBand: 8, downs: 42 }),
      run('settler', { firstThreatDay: 3, threats: 13, biggestBand: 6, downs: 7 }),
      run('harsh', { firstThreatDay: 5, threats: 6, biggestBand: 2, downs: 0, endFoodDays: 27 }),
    ]);
    expect(verdictOf(s, 'trouble-comes-sooner-as-it-gets-harder')).toBe('broken');
    expect(verdictOf(s, 'trouble-comes-more-often-as-it-gets-harder')).toBe('broken');
    expect(verdictOf(s, 'bands-get-bigger-as-it-gets-harder')).toBe('broken');
    expect(verdictOf(s, 'the-valley-hurts-more-as-it-gets-harder')).toBe('broken');
  });

  it('catches settings that are pointed the right way and too small to feel', () => {
    // The failure a difficulty setting is most likely to have in practice, and
    // the reason the promises are split the way they are. The ordering checks
    // only claim a *direction*, so they are satisfied here and should be — a
    // grid going 11 → 12 → 13 is not out of order. Whether the player can feel
    // the difference is a claim about magnitude, and it is the two magnitude
    // principles that have to be the ones to fail.
    const s = sweep([
      run('calm', { threats: 11, biggestBand: 5, downs: 6 }),
      run('settler', { threats: 12, biggestBand: 5, downs: 7 }),
      run('harsh', { threats: 13, biggestBand: 6, downs: 8 }),
    ]);
    expect(verdictOf(s, 'trouble-comes-more-often-as-it-gets-harder')).toBe('holds');
    expect(verdictOf(s, 'difficulty-moves-the-treeline-not-the-larder')).toBe('broken');
    expect(detailOf(s, 'difficulty-moves-the-treeline-not-the-larder')).toContain('barely differ');
    expect(verdictOf(s, 'hard-country-is-a-different-game')).toBe('broken');
  });

  it('lets the hard setting reach the pantry, but not as hard as it reaches the treeline', () => {
    // The distinction the first grid got wrong. A settler who is shooting is not
    // farming, so difficulty is *allowed* to cost food — this is the check that
    // says how much. Threat ×3.7 against larder ×1.5 is the shape of the real
    // measured grid, and it holds.
    expect(verdictOf(sweep(healthy()), 'difficulty-moves-the-treeline-not-the-larder')).toBe(
      'holds',
    );

    // Same threat scaling, but the hard setting also empties the larder by the
    // same multiple: now difficulty is a scarcity dial by the back door, which
    // is the thing the charter forbids.
    const scarcity = sweep([
      run('calm', { threats: 6, endFoodDays: 27 }),
      run('settler', { threats: 13, endFoodDays: 14 }),
      run('harsh', { threats: 22, endFoodDays: 6 }),
    ]);
    expect(verdictOf(scarcity, 'difficulty-moves-the-treeline-not-the-larder')).toBe('broken');

    // And a valley where every setting is genuinely running out of food is a
    // food-economy failure, caught even though the *ratio* is fine.
    const famine = sweep([
      run('calm', { threats: 6, endFoodDays: 4 }),
      run('settler', { threats: 13, endFoodDays: 3 }),
      run('harsh', { threats: 22, endFoodDays: 2 }),
    ]);
    expect(verdictOf(famine, 'difficulty-moves-the-treeline-not-the-larder')).toBe('broken');
    expect(detailOf(famine, 'difficulty-moves-the-treeline-not-the-larder')).toContain('calm ends');
  });

  it('reads the tech dial as a share of raiders, not a count of rifles', () => {
    // The trap this check is built to avoid. Harsh sends three times as many
    // raiders, so counting rifles would show a rise on any setting at all and
    // report the `band` dial a second time under a different name. Here every
    // setting arms the same one raider in five and only the head-count differs:
    // the tech promise is not being kept, and the check has to say so.
    const sameTech = sweep([
      run('calm', { raidersSeen: 12, armedShare: 0.2 }),
      run('settler', { raidersSeen: 40, armedShare: 0.2 }),
      run('harsh', { raidersSeen: 90, armedShare: 0.2 }),
    ]);
    expect(verdictOf(sameTech, 'the-raiders-are-better-armed-as-it-gets-harder')).toBe('broken');
    expect(detailOf(sameTech, 'the-raiders-are-better-armed-as-it-gets-harder')).toContain(
      'harsh 20%',
    );

    expect(
      verdictOf(sweep(healthy()), 'the-raiders-are-better-armed-as-it-gets-harder'),
    ).toBe('holds');

    // And a grid where nothing ever attacked cannot have an opinion about what
    // the raiders were carrying.
    const peaceful = sweep([
      run('calm', { raidersSeen: 0, armedShare: 0 }),
      run('settler', { raidersSeen: 0, armedShare: 0 }),
    ]);
    expect(verdictOf(peaceful, 'the-raiders-are-better-armed-as-it-gets-harder')).toBe('untested');
  });

  it('pools the rifle share across runs instead of averaging the ratios', () => {
    // A quiet map that saw four raiders must not count as much as a bloody one
    // that saw sixty. Averaged per run, calm here reads 50%; pooled, it reads
    // the 10% that a player actually faced — and only the pooled number keeps
    // the ordering promise true.
    const s = sweep([
      run('calm', { seed: 1, raidersSeen: 2, armedShare: 1.0 }),
      run('calm', { seed: 2, raidersSeen: 98, armedShare: 0.08 }),
      run('settler', { seed: 1, raidersSeen: 50, armedShare: 0.3 }),
      run('harsh', { seed: 1, raidersSeen: 50, armedShare: 0.6 }),
    ]);
    expect(verdictOf(s, 'the-raiders-are-better-armed-as-it-gets-harder')).toBe('holds');
    expect(detailOf(s, 'the-raiders-are-better-armed-as-it-gets-harder')).toContain('calm 10%');
  });

  it('reads management tightness off the settler\'s day, not off the starting stockpile', () => {
    // `larder` and `upkeep` both end up showing in the food economy, and the two
    // have to be told apart or the grid credits one dial for the other's work.
    // This grid has the stockpile ordered the right way, a full store keeping
    // everybody well fed on all three settings, and the settlers' days identical:
    // the larder is doing its job and upkeep is doing nothing, and only the
    // upkeep promise should break.
    const s = sweep(
      [
        run('calm', { endFoodDays: 27, meanFood: 0.6, upkeepShare: 0.33 }),
        run('settler', { endFoodDays: 22, meanFood: 0.6, upkeepShare: 0.33 }),
        run('harsh', {
          endFoodDays: 18,
          meanFood: 0.6,
          upkeepShare: 0.33,
          threats: 22,
          downs: 42,
          buried: 2,
        }),
      ],
      30,
      [
        { dial: 0.85, upkeepShare: 0.33 },
        { dial: 1, upkeepShare: 0.33 },
        { dial: 1.12, upkeepShare: 0.33 },
      ],
    );
    expect(verdictOf(s, 'the-tighter-setting-is-tighter-to-run')).toBe('broken');
    expect(verdictOf(s, 'difficulty-moves-the-treeline-not-the-larder')).toBe('holds');
  });

  it('does not read the upkeep promise off a grid where the other axes drown it', () => {
    // The failure that cost a thirty-five-minute grid, pinned. These are the real
    // measured numbers: on the grid the upkeep column goes 30.5% → 34.0% → 34.8%
    // and the last step is a third of the floor, because a starving, besieged
    // colony spends *less* of its day on itself — `larder` and `band` pushing the
    // same column the other way. Held on its own the dial is fine. The check has
    // to believe the experiment and not the observation, or it condemns a
    // multiplier that is working.
    const s = sweep([
      run('calm', { upkeepShare: 0.305 }),
      run('settler', { upkeepShare: 0.34 }),
      run('harsh', { upkeepShare: 0.348 }),
    ]);
    expect(verdictOf(s, 'the-tighter-setting-is-tighter-to-run')).toBe('holds');
    expect(detailOf(s, 'the-tighter-setting-is-tighter-to-run')).toContain('at fixed threat');
  });

  it('breaks when the dial is flat even though the grid column rises', () => {
    // And the mirror image, which is the one that matters more. A grid can show a
    // rising upkeep column for reasons that have nothing to do with `upkeep` —
    // more raids alone will do it. If the dial itself moves nothing, no amount of
    // ordering in the grid may rescue it.
    const s = sweep(
      [
        run('calm', { upkeepShare: 0.28 }),
        run('settler', { upkeepShare: 0.34 }),
        run('harsh', { upkeepShare: 0.41 }),
      ],
      30,
      [
        { dial: 0.85, upkeepShare: 0.344 },
        { dial: 1, upkeepShare: 0.347 },
        { dial: 1.12, upkeepShare: 0.349 },
      ],
    );
    expect(verdictOf(s, 'the-tighter-setting-is-tighter-to-run')).toBe('broken');
    expect(detailOf(s, 'the-tighter-setting-is-tighter-to-run')).toContain('needed 0.010');
  });

  it('reports the upkeep promise untested rather than kept when no arm was run', () => {
    // Fail loud: a grid that skipped the controlled arm has not verified this
    // promise, and must not report that it did.
    const s = sweep([run('calm'), run('settler'), run('harsh')], 30, []);
    expect(verdictOf(s, 'the-tighter-setting-is-tighter-to-run')).toBe('untested');
  });

  it('separates a settler starving from a colony being out of food', () => {
    // The two cases the old check ran together. One settler at zero with weeks
    // of meals in the larder is a feeding or hauling failure and gets reported;
    // a colony that has actually eaten everything is not this finding.
    const stranded = sweep([run('calm', { worstFood: 0.0, endFoodDays: 24.5 })]);
    expect(verdictOf(stranded, 'nobody-starves-beside-a-full-pantry')).toBe('broken');
    expect(detailOf(stranded, 'nobody-starves-beside-a-full-pantry')).toContain('calm/1');

    const empty = sweep([run('harsh', { worstFood: 0.0, endFoodDays: 0.5 })]);
    expect(verdictOf(empty, 'nobody-starves-beside-a-full-pantry')).toBe('holds');
  });

  it('says untested rather than broken when the grid was too short to look', () => {
    // The failure mode that would quietly rot the whole harness: a ten-day grid
    // reaches no rungs and takes no casualties, and every principle about the
    // back half of a run reads that silence as the game being broken.
    const short = sweep(
      healthy().map((r) => ({ ...r, peakRung: 0, buried: 0, daysLived: 10 })),
      10,
    );
    expect(verdictOf(short, 'the-escalation-ladder-is-climbable-to-the-top')).toBe('untested');
    expect(verdictOf(short, 'the-valley-can-still-bury-somebody')).toBe('untested');
  });

  it('does not pass a full-length grid that never reaches the top rung', () => {
    // The other half of the guard above: at thirty days the ladder has had its
    // chance, and rung 2 of 4 is content no player is ever shown.
    const s = sweep(healthy().map((r) => ({ ...r, peakRung: 2 })));
    expect(verdictOf(s, 'the-escalation-ladder-is-climbable-to-the-top')).toBe('broken');
  });

  it('will not call the quiet valley survivable on the strength of a wipe', () => {
    // Calm is the setting a nine-year-old plays; one collapsed map is the whole
    // promise gone, even with four good ones beside it.
    const s = sweep([
      ...healthy(),
      run('calm', { seed: 2, verdict: 'collapsed', daysLived: 12, survivors: 0, buried: 3 }),
    ]);
    expect(verdictOf(s, 'the-quiet-valley-is-survivable')).toBe('broken');
  });

  it('will not judge the founding against a grid that stopped at it', () => {
    // The grid the difficulty work was calibrated on stops the moment a colony
    // founds, so every one of its runs *did* end at the founding — and reading
    // that as the promise being broken would blame the game for the harness.
    // The number in the detail is the size of the gap, which is the only thing
    // a grid like this can honestly say.
    const s = sweep([
      run('calm', { seed: 1, foundedOn: 23, daysLived: 23 }),
      run('calm', { seed: 2, foundedOn: 26, daysLived: 26 }),
    ]);
    expect(verdictOf(s, 'the-game-does-not-end-at-the-founding')).toBe('untested');
    expect(detailOf(s, 'the-game-does-not-end-at-the-founding')).toContain('11 colony-days');
  });

  it('holds when every colony that founded played the rest of its clock', () => {
    const s = sweep(
      [
        run('calm', { seed: 1, foundedOn: 23, daysLived: 30 }),
        run('settler', { seed: 2, foundedOn: 28, daysLived: 30 }),
        run('harsh', { seed: 3, foundedOn: null, daysLived: 30 }),
      ],
      30,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-game-does-not-end-at-the-founding')).toBe('holds');
    expect(detailOf(s, 'the-game-does-not-end-at-the-founding')).toContain('earliest on day 23');
  });

  it('breaks when a founded colony still stops short of the clock', () => {
    // The regression this exists to catch: the break on `hasWon` coming back,
    // in `run.ts` or anywhere downstream of it.
    const s = sweep(
      [
        run('calm', { seed: 1, foundedOn: 23, daysLived: 23 }),
        run('settler', { seed: 2, foundedOn: 28, daysLived: 30 }),
      ],
      30,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-game-does-not-end-at-the-founding')).toBe('broken');
    expect(detailOf(s, 'the-game-does-not-end-at-the-founding')).toContain('calm/1 at 23');
  });

  it('lets a founded colony that was later wiped stop short, because a wipe is an ending', () => {
    // A colony that founds on day 20 and is gone by day 44 is the most
    // interesting run on the grid, and a check that called it a harness bug
    // would push everyone toward never letting it happen.
    const s = sweep(
      [
        run('harsh', {
          seed: 1,
          foundedOn: 20,
          daysLived: 44,
          verdict: 'collapsed',
          survivors: 0,
          buried: 9,
        }),
        run('settler', { seed: 2, foundedOn: 28, daysLived: 60 }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-game-does-not-end-at-the-founding')).toBe('holds');
  });

  it('says untested rather than holds when no colony founded at all', () => {
    const s = sweep(
      [run('harsh', { seed: 1, foundedOn: null, daysLived: 60 })],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-game-does-not-end-at-the-founding')).toBe('untested');
  });

  it('holds the first act finishable on the settings it is promised on, not on hard country', () => {
    // Seven below hard country reach it and hard country reaches nothing, which
    // is the shape of the real grid. The harsh column has to be invisible here:
    // averaged in, five settlers who never found would drag a healthy 70% to
    // 47% and the check would fail a valley that is working.
    const s = sweep(
      [
        run('calm', { seed: 1, foundedOn: 27, daysLived: 60 }),
        run('calm', { seed: 2, foundedOn: 49, daysLived: 60 }),
        run('calm', { seed: 3, foundedOn: null, daysLived: 60 }),
        run('settler', { seed: 4, foundedOn: 26, daysLived: 60 }),
        run('harsh', { seed: 5, foundedOn: null, daysLived: 60 }),
        run('harsh', { seed: 6, foundedOn: null, daysLived: 60 }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-first-act-is-finishable')).toBe('holds');
    expect(detailOf(s, 'the-first-act-is-finishable')).toContain('3 of 4');
    // and it names the map that missed, because a rate with no names is a number
    // nobody can go and look at
    expect(detailOf(s, 'the-first-act-is-finishable')).toContain('calm/3');
  });

  it('breaks when half the kind settings never finish the first act', () => {
    // The regression this exists to catch, in the numbers it actually had:
    // guaranteeing the middle ring a parts town by dealing it a fixed card
    // moved every die after it and took the foundings from eight in fifteen to
    // four, and every other principle on the board still said HOLDS.
    const s = sweep(
      [
        run('calm', { seed: 1, foundedOn: 27, daysLived: 60 }),
        run('calm', { seed: 2, foundedOn: null, daysLived: 60 }),
        run('calm', { seed: 3, foundedOn: null, daysLived: 60 }),
        run('settler', { seed: 4, foundedOn: null, daysLived: 60 }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-first-act-is-finishable')).toBe('broken');
    expect(detailOf(s, 'the-first-act-is-finishable')).toContain('1 of 4');
    expect(detailOf(s, 'the-first-act-is-finishable')).toContain('50% floor');
  });

  it('says untested rather than broken on a grid too short to reach a founding', () => {
    // Thirty days is not a colony that failed to found; it is a clock that
    // stopped before the question was asked.
    const s = sweep([run('calm', { seed: 1, foundedOn: null, daysLived: 30 })], 30);
    expect(verdictOf(s, 'the-first-act-is-finishable')).toBe('untested');
  });

  // ── the industrial base, measured before it is built ──────────────────────
  //
  // Both of these are open, both of them describe a promise the game does not
  // keep yet, and both of them are here so that the day it does, the number it
  // has to beat was written down first.

  it('breaks when a colony finishes the whole tree and stands at the bench for a week', () => {
    const s = sweep(
      [run('calm', { seed: 1, daysLived: 60, tech: 15, emptyTreeDays: 19 })],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-tree-is-not-empty-at-day-sixty')).toBe('broken');
    expect(detailOf(s, 'the-tree-is-not-empty-at-day-sixty')).toContain('idle 19 days');
  });

  it('lets the last project land on the second-to-last day', () => {
    // A tree that fits is not a tree that ran out. The distinction the check has
    // to make is between slack and none, and a colony that finished on day 59 has
    // spent its whole run with somewhere to go.
    const s = sweep(
      [run('calm', { seed: 1, daysLived: 60, tech: 15, emptyTreeDays: 1 })],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-tree-is-not-empty-at-day-sixty')).toBe('holds');
    expect(detailOf(s, 'the-tree-is-not-empty-at-day-sixty')).toContain('longest idle was 1 days');
  });

  it('does not blame the tree for a colony that was wiped before it could finish', () => {
    // The run that dies on day fifty-two has an unfinished tree for a reason that
    // has nothing to do with the tree, and counting it as evidence either way
    // would make a check about content into a check about survival.
    const s = sweep(
      [
        run('harsh', { seed: 1, daysLived: 52, verdict: 'collapsed', tech: 4 }),
        run('calm', { seed: 2, daysLived: 60, tech: 15, emptyTreeDays: 30 }),
      ],
      60,
      healthyArm(),
      true,
    );
    const detail = detailOf(s, 'the-tree-is-not-empty-at-day-sixty');
    expect(verdictOf(s, 'the-tree-is-not-empty-at-day-sixty')).toBe('broken');
    expect(detail).toContain('1 of 1 full runs');
    expect(detail).not.toContain('harsh/1');
  });

  it('will not judge the tree on a grid that stopped before day sixty', () => {
    const s = sweep([run('calm', { seed: 1, daysLived: 30, tech: 15, emptyTreeDays: 17 })]);
    expect(verdictOf(s, 'the-tree-is-not-empty-at-day-sixty')).toBe('untested');
  });

  // ── the two halves of a stalled bench ─────────────────────────────────────
  //
  // The pair below is the reason `unsentDays` exists. Both runs stand at a
  // finished bench for seventeen days; they differ only in whether anybody was
  // walking, and they are opposite verdicts. A single column cannot hold both,
  // and the first version of this check had only the single column.

  it('does not blame the colony for a road it walked the whole time', () => {
    // calm/424242, to the day: foundry chosen on the thirty-sixth, party out on
    // the fortieth, robbed, sent again, project finished on the fifty-seventh.
    // Seventeen stalled days and a settler on the road for every one of them.
    // That run kept the promise the claim makes, and the check has to say so.
    const s = sweep(
      [
        run('calm', {
          seed: 424242,
          daysLived: 60,
          tech: THIRD_TIER + 1,
          stalledDays: 17,
          unsentDays: 0,
        }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-bench-does-not-wait-on-an-errand')).toBe('holds');
    // And the distance is still reported, because a pass here is not a claim
    // that seventeen days is fine — only that it was not indecision.
    expect(detailOf(s, 'the-bench-does-not-wait-on-an-errand')).toContain(
      'the road itself took 17.0 days a run',
    );
  });

  it('still breaks on the same seventeen days when nobody ever set out', () => {
    const s = sweep(
      [
        run('calm', {
          seed: 424242,
          daysLived: 60,
          tech: THIRD_TIER + 1,
          stalledDays: 17,
          unsentDays: 17,
        }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-bench-does-not-wait-on-an-errand')).toBe('broken');
    // Two decimal places, and the assertion says so rather than matching loosely.
    // `unsentDays` is summed a tick at a time now — the day sample it replaced was
    // taken at 07:12 every time and read about thirty times the truth — so a whole
    // number here is a real seventeen days rather than seventeen samples, and the
    // detail line is where a reader finds that out.
    expect(detailOf(s, 'the-bench-does-not-wait-on-an-errand')).toContain(
      'sent nobody for 17.00 of 17 waiting days',
    );
  });

  it('allows the two days it takes to notice the bench has stopped', () => {
    // The threshold is a decision, not a journey: a day for the bar to fill and
    // the job pass to see it, a day for a settler to finish what is in their
    // hands and come looking for the next thing. Two passes and three does not,
    // and this pins which side of that line the number sits on so that moving it
    // has to be deliberate. calm/99001 is the run that lives here — it owes
    // exactly one day, the twenty-eight hundred ticks of its fifty-seventh with
    // every gate open and nobody sent.
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, tech: THIRD_TIER + 1, stalledDays: 12, unsentDays: 2 }),
        run('calm', { seed: 2, daysLived: 60, tech: THIRD_TIER + 1, stalledDays: 12, unsentDays: 3 }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-bench-does-not-wait-on-an-errand')).toBe('broken');
    const detail = detailOf(s, 'the-bench-does-not-wait-on-an-errand');
    expect(detail).toContain('1 of 2 runs');
    expect(detail).toContain('calm/2');
    expect(detail).not.toContain('calm/1');
  });

  // ── the road the bench principle no longer judges ─────────────────────────

  it('breaks when reaching the third tier is where the run stops', () => {
    // The measured shape, three of nine: the colony finishes the last project
    // the tree gives away and never finishes one that costs goods. Two of the
    // three were robbed on a five-day road and never got a second attempt in.
    const s = sweep(
      [
        run('calm', { seed: 1312, daysLived: 60, tech: THIRD_TIER, stalledDays: 18, unsentDays: 0 }),
        run('settler', {
          seed: 1312,
          daysLived: 60,
          tech: THIRD_TIER,
          stalledDays: 13,
          unsentDays: 0,
        }),
        run('calm', { seed: 7, daysLived: 60, tech: THIRD_TIER + 1 }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'one-robbery-does-not-end-the-tier')).toBe('broken');
    const detail = detailOf(s, 'one-robbery-does-not-end-the-tier');
    expect(detail).toContain('1 of 3 runs');
    expect(detail).toContain('calm/1312 after 18 waiting days');
    // The two checks read the same runs and must not read them the same way:
    // nobody hesitated in this grid, so the bench principle has nothing to say
    // about it. That separation is the whole point of splitting them.
    expect(verdictOf(s, 'the-bench-does-not-wait-on-an-errand')).toBe('holds');
  });

  it('holds once three quarters of the colonies that arrive get through', () => {
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, tech: THIRD_TIER + 2 }),
        run('calm', { seed: 2, daysLived: 60, tech: THIRD_TIER + 1 }),
        run('calm', { seed: 3, daysLived: 60, tech: THIRD_TIER + 1 }),
        // The one that stopped. It has waiting days on it because a colony that
        // failed to cross the tier is a colony that stood at a bench wanting
        // goods — see the case below for what a bare `tech` reading counts.
        run('calm', { seed: 4, daysLived: 60, tech: THIRD_TIER, stalledDays: 9 }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'one-robbery-does-not-end-the-tier')).toBe('holds');
    expect(detailOf(s, 'one-robbery-does-not-end-the-tier')).toContain('3 of 4 runs');
  });

  it('leaves out the colony that reached the tier and was never asked for anything', () => {
    // harsh/7 on the shipped grid, in one line: it finished the last free
    // project on day fifty-eight and stood at **nought** waiting days, because
    // there was never a moment where a bench wanted goods it did not have. It
    // did not fail to cross the tier, it ran out of calendar, and for two grids
    // it sat in this denominator dragging the share down as if it had.
    //
    // The pair is the test. Same tech, same clock; one waited and one never got
    // the chance, and only the first is this principle's business.
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, tech: THIRD_TIER + 1 }),
        run('harsh', { seed: 7, daysLived: 60, tech: THIRD_TIER, stalledDays: 0 }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'one-robbery-does-not-end-the-tier')).toBe('holds');
    expect(detailOf(s, 'one-robbery-does-not-end-the-tier')).toContain('1 of 1 runs');
  });

  it('says nothing about the road when nobody got as far as the tier', () => {
    // Hard country is mostly this, and scoring it as a pass would let a grid of
    // colonies that never left the second tier certify a road none of them saw.
    const s = sweep(
      [run('harsh', { seed: 1, daysLived: 60, tech: THIRD_TIER - 3 })],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'one-robbery-does-not-end-the-tier')).toBe('untested');
  });

  it('breaks when a rich colony ends on a pile that never once came down', () => {
    // The shape the sixty-day grid actually has: over a thousand steel in store
    // and a biggest-ever fall of one turret, because a turret is the largest
    // thing there is to buy and the mine refills it inside a day.
    const s = sweep(
      [run('calm', { seed: 1, daysLived: 60, endSteel: 1367, steelDrawdown: 34 })],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-surplus-finds-a-buyer')).toBe('broken');
    expect(detailOf(s, 'the-surplus-finds-a-buyer')).toContain('ended on 1367 steel');
  });

  it('holds when the pile is spent down by something worth a quarter of it', () => {
    const s = sweep(
      [run('calm', { seed: 1, daysLived: 60, endSteel: 800, steelDrawdown: 300 })],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-surplus-finds-a-buyer')).toBe('holds');
  });

  it('does not call a colony with an empty store a colony that found a buyer', () => {
    // Hard country reaches day sixty holding nothing. That is poverty, not
    // demand, and reading it as a kept promise is exactly how a fixed material
    // gate would come to look fine on the one setting it is a wall for.
    const s = sweep(
      [run('harsh', { seed: 1, daysLived: 60, endSteel: 0, steelDrawdown: 0 })],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-surplus-finds-a-buyer')).toBe('untested');
    expect(detailOf(s, 'the-surplus-finds-a-buyer')).toContain('nothing to find a buyer for');
  });

  it('breaks when the far road opens with time to walk it and nobody goes', () => {
    // The shape measured off the shipped grid, in miniature: three runs below
    // hard country with the far road open from the first week and twenty days
    // of clock to spend on it, and one of them walks. That is a road the
    // colony was permitted to use and had no reason to.
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, ringOpenedOn: [0, 5, 9], tripsByRing: [8, 4, 2] }),
        run('calm', { seed: 2, daysLived: 60, ringOpenedOn: [0, 5, 11], tripsByRing: [9, 5, 0] }),
        run('settler', { seed: 3, daysLived: 60, ringOpenedOn: [0, 6, 14], tripsByRing: [7, 6, 0] }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-far-country-is-walked')).toBe('broken');
    expect(detailOf(s, 'the-far-country-is-walked')).toContain('1 of 3');
    expect(detailOf(s, 'the-far-country-is-walked')).toContain('calm/2 open from day 11');
  });

  it('holds at half, because twenty days on one errand is a third of the game', () => {
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, ringOpenedOn: [0, 5, 9], tripsByRing: [8, 4, 1] }),
        run('settler', { seed: 2, daysLived: 60, ringOpenedOn: [0, 6, 14], tripsByRing: [7, 6, 0] }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-far-country-is-walked')).toBe('holds');
    expect(detailOf(s, 'the-far-country-is-walked')).toContain('1 of 2');
  });

  it('does not charge the calendar to a colony that got the far road on day fifty-five', () => {
    // A round trip out there is twenty days. A road that opens with sixteen left
    // was never an offer, and counting the refusal would be the check marking its
    // own homework — the same run would fail on a grid that ran one day shorter.
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, ringOpenedOn: [0, 5, 55], tripsByRing: [8, 4, 0] }),
        run('harsh', { seed: 2, daysLived: 60, ringOpenedOn: [0, 5, 9], tripsByRing: [8, 4, 0] }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-far-country-is-walked')).toBe('untested');
    expect(detailOf(s, 'the-far-country-is-walked')).toContain('20 days left to walk it');
  });

  it('judges the same wait against the road it was waiting on', () => {
    // The re-derivation, stated as a test: eighteen days is not a number that
    // means anything on its own. Waiting eighteen for parts sold six days out is
    // a colony that never went; waiting eighteen for machinery nine days out is
    // a colony that went, walked twenty days of road, and came back on time.
    // The old flat bar called both of them broken and would have called the
    // second one broken for doing exactly what the tier asks.
    const near = sweep(
      [run('calm', { seed: 1, daysLived: 60, tech: THIRD_TIER, stalledDays: 18, stallRing: 1 })],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(near, 'the-road-keeps-up-with-the-bench')).toBe('broken');
    expect(detailOf(near, 'the-road-keeps-up-with-the-bench')).toContain('ring-1 bill against 14');

    const far = sweep(
      [run('calm', { seed: 1, daysLived: 60, tech: THIRD_TIER, stalledDays: 18, stallRing: 2 })],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(far, 'the-road-keeps-up-with-the-bench')).toBe('holds');

    // And the far bar is a bar, not an exemption: three days past a round trip
    // to the works is still a bench standing still.
    const late = sweep(
      [run('calm', { seed: 1, daysLived: 60, tech: THIRD_TIER, stalledDays: 25, stallRing: 2 })],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(late, 'the-road-keeps-up-with-the-bench')).toBe('broken');
    expect(detailOf(late, 'the-road-keeps-up-with-the-bench')).toContain('ring-2 bill against 22');
  });

  it('calls three roads that always agree one road printed three times', () => {
    // The failure the check exists for, in its purest form: every colony reads
    // the same rung on all three, so "science 2, economy 2, warfare 2" is one
    // fact wearing three hats and the player's choice of ending is a choice
    // between synonyms. Note that the runs *differ* from each other — a grid
    // where every colony is identical would be a different complaint.
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, roadRungs: [1, 1, 1] }),
        run('settler', { seed: 2, daysLived: 60, roadRungs: [2, 2, 2] }),
        run('harsh', { seed: 3, daysLived: 60, roadRungs: [3, 3, 3] }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-three-roads-are-three-roads')).toBe('broken');
    expect(detailOf(s, 'the-three-roads-are-three-roads')).toContain('3 of 3 pairs');
    expect(detailOf(s, 'the-three-roads-are-three-roads')).toContain('always level');
  });

  it('is not satisfied by two roads that only ever lead the same way', () => {
    // The subtler half. Warfare disagrees with both of the others, so two of the
    // three pairs invert and a check that counted pairs rather than requiring
    // all of them would call this fine. But science is ahead of economy on every
    // run and never behind it: whatever those two are measuring, no colony on
    // this grid has ever had to choose between them.
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, roadRungs: [3, 1, 0] }),
        run('settler', { seed: 2, daysLived: 60, roadRungs: [2, 1, 3] }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-three-roads-are-three-roads')).toBe('broken');
    expect(detailOf(s, 'the-three-roads-are-three-roads')).toContain('1 of 3 pairs');
    // Which way it leans has to be in the sentence. A flat pair that is always
    // level is one measurement counted twice; a flat pair that leans is a road
    // nobody is walking, and the first grid to read this line got the second
    // case reported as the first.
    expect(detailOf(s, 'the-three-roads-are-three-roads')).toContain(
      'science/economy never inverts (science only ever ahead)',
    );
  });

  it('holds when each road leads somewhere on some colony', () => {
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, roadRungs: [3, 1, 0] }),
        run('settler', { seed: 2, daysLived: 60, roadRungs: [1, 2, 3] }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'the-three-roads-are-three-roads')).toBe('holds');
    expect(detailOf(s, 'the-three-roads-are-three-roads')).toContain('all 3 pairs');
  });

  it('will not compare roads across a grid of one colony', () => {
    // One run can be ahead on one road and behind on another, which looks like
    // an inversion and is not one: it is a single colony's shape, and three
    // ladders wired to the same number would produce it just as readily on a
    // colony that happened to be measured mid-climb. The check needs a grid.
    const s = sweep([run('calm', { seed: 1, daysLived: 60, roadRungs: [3, 1, 0] })], 60);
    expect(verdictOf(s, 'the-three-roads-are-three-roads')).toBe('untested');
    expect(detailOf(s, 'the-three-roads-are-three-roads')).toContain('need two to compare');
  });

  it('says a road somebody finished in sixty days has stopped being a road', () => {
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, roadRungs: [2, 4, 1] }),
        run('harsh', { seed: 2, daysLived: 60, roadRungs: [1, 2, 3] }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'no-road-is-already-finished')).toBe('broken');
    expect(detailOf(s, 'no-road-is-already-finished')).toContain('calm/1 finished economy');
  });

  it('reports how far the furthest colony got, so a quiet grid is not read as a good one', () => {
    // "Nobody finished a road" is true of a grid where nobody started one, and
    // the two want telling apart. The detail line carries the deepest rung for
    // exactly that reason, and this is the test that keeps it there.
    const s = sweep(
      [
        run('calm', { seed: 1, daysLived: 60, roadRungs: [3, 1, 0] }),
        run('harsh', { seed: 2, daysLived: 60, roadRungs: [1, 0, 2] }),
      ],
      60,
      healthyArm(),
      true,
    );
    expect(verdictOf(s, 'no-road-is-already-finished')).toBe('holds');
    expect(detailOf(s, 'no-road-is-already-finished')).toContain('furthest anybody got was rung 3');
  });
});

/**
 * The two stage-4 promises, and the family they are allowed to read.
 *
 * The bug these are written against cost a sixty-day grid. Both checks used to
 * read `sweep.runs`, which is played with `steward: false` — nobody managing the
 * colony — and a campaign is the one errand nothing in the sim ever plans for
 * itself. So the grid came back `campaigns 0` on all fifteen colonies and both
 * promises reported it as a finding: the holdings priced out, the war party
 * scenery. The game was fine. The instrument had been asking a question about
 * the player of a colony that had no player.
 */
describe('the war promises, and the colonies they are asked of', () => {
  const FLOOR = WAR_PARTY * roundTripDays(0);
  const ABLE = CAN_SPARE_ONE + WAR_PARTY;

  it('reads the played family and not the grid', () => {
    // Both directions, because either alone is passed by a check wired to the
    // wrong field: a grid full of campaigns must not be able to answer, and a
    // grid with none must not stop the played family from answering.
    const marched = healthyWar();
    expect(verdictOf(sweep(marched, 30, healthyArm(), false, []), 'the-war-is-a-choice')).toBe(
      'untested',
    );
    expect(
      verdictOf(sweep(marched, 30, healthyArm(), false, []), 'no-holding-falls-for-free'),
    ).toBe('untested');

    const s = sweep(healthy());
    expect(verdictOf(s, 'the-war-is-a-choice')).toBe('holds');
    expect(verdictOf(s, 'no-holding-falls-for-free')).toBe('holds');
  });

  it('says so plainly when nobody played a colony', () => {
    // The detail line is what a reader sees on every measurements file taken
    // before this family existed, so it has to name the reason rather than read
    // as a war that did not happen.
    const s = sweep(healthy(), 30, healthyArm(), false, []);
    expect(detailOf(s, 'the-war-is-a-choice')).toContain('no colony was played by a Steward');
  });

  it('breaks when every colony that could march did', () => {
    // The quiet failure, and the one worth more than the loud one. A campaign
    // that is simply the right move is not a road the player chooses, it is the
    // game — and it would show up here long before anybody felt it at the table.
    const s = sweep(healthy(), 30, healthyArm(), false, [
      run('calm', { campaigns: 1, holdingsTaken: 1, warPawnDays: FLOOR }),
      run('settler', { campaigns: 2, holdingsTaken: 1, warPawnDays: 40 }),
      run('harsh', { campaigns: 1, holdingsTaken: 1, warPawnDays: 22 }),
    ]);
    expect(verdictOf(s, 'the-war-is-a-choice')).toBe('broken');
    expect(detailOf(s, 'the-war-is-a-choice')).toContain('the war is not a choice');
  });

  it('breaks when the holdings are scenery', () => {
    const s = sweep(healthy(), 30, healthyArm(), false, [run('calm'), run('settler')]);
    expect(verdictOf(s, 'the-war-is-a-choice')).toBe('broken');
    expect(detailOf(s, 'the-war-is-a-choice')).toContain('scenery');
  });

  it('leaves out the colony that never had the hands to go', () => {
    // A five-settler colony that stayed home chose nothing — the sim would have
    // refused it a war party. Counting it as a stay-at-home would let a grid of
    // small colonies manufacture the choice the promise is looking for.
    const s = sweep(healthy(), 30, healthyArm(), false, [
      run('calm', { peakHands: ABLE - 1 }),
      run('settler', { peakHands: ABLE, campaigns: 1, holdingsTaken: 1, warPawnDays: FLOOR }),
    ]);
    expect(verdictOf(s, 'the-war-is-a-choice')).toBe('untested');
    expect(detailOf(s, 'the-war-is-a-choice')).toContain('a choice needs two colonies');
  });

  it('breaks when ground came cheaper than the walk to it', () => {
    // The failure the pawn-day count exists for: a campaign that resolved on the
    // tick it was ordered shows one campaign and one holding, exactly like a war
    // that was fought. It cannot show the days.
    const s = sweep(healthy(), 30, healthyArm(), false, [
      run('calm'),
      run('settler', { campaigns: 1, holdingsTaken: 1, warPawnDays: FLOOR - 1 }),
      run('harsh', { campaigns: 1, holdingsTaken: 1, warPawnDays: FLOOR }),
    ]);
    expect(verdictOf(s, 'no-holding-falls-for-free')).toBe('broken');
    expect(detailOf(s, 'no-holding-falls-for-free')).toContain('settler/1');
  });

  it('does not charge a war that was lost for ground it never took', () => {
    // Two parties out, one holding home. The floor is a floor and not a window:
    // the days the losing party spent are days, and a check that divided them
    // into the ground taken and called the result generous would be reading a
    // defeat as proof the war is too cheap.
    const s = sweep(healthy(), 30, healthyArm(), false, [
      run('calm'),
      run('settler', { campaigns: 2, holdingsTaken: 1, warPawnDays: FLOOR * 2 }),
    ]);
    expect(verdictOf(s, 'no-holding-falls-for-free')).toBe('holds');
  });

  it('says untested rather than holds when no war was won', () => {
    // Nothing to divide. A grid where every campaign came home empty has not
    // shown that ground is expensive; it has shown that no ground changed hands.
    const s = sweep(healthy(), 30, healthyArm(), false, [
      run('calm'),
      run('settler', { campaigns: 1, warPawnDays: 30 }),
    ]);
    expect(verdictOf(s, 'no-holding-falls-for-free')).toBe('untested');
    expect(detailOf(s, 'no-holding-falls-for-free')).toContain('took a holding');
  });
});

describe('the dials the controlled arm plays', () => {
  it('names three distinct values, in the order the settings are listed', () => {
    // The arm writes into `DIFFICULTIES.settler` and Settler's own dial is read
    // out of that same object, so a version of this that looked up its next
    // target mid-sweep read back what it had just written, played the Settler leg
    // at the calm value, and reported two identical points — which the check, to
    // its credit, called broken. Forty-four minutes of grid to find a bug in the
    // instrument. Snapshotting the values at module load is the fix; this is the
    // assertion that they are three real ones and not one value three times.
    expect(UPKEEP_DIALS).toEqual(DIFFICULTY_ORDER.map((d) => DIFFICULTIES[d].upkeep));
    expect(new Set(UPKEEP_DIALS).size).toBe(DIFFICULTY_ORDER.length);
    for (let i = 1; i < UPKEEP_DIALS.length; i++) {
      expect(UPKEEP_DIALS[i]!).toBeGreaterThan(UPKEEP_DIALS[i - 1]!);
    }
  });
});
