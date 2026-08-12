/**
 * The balance grid: the same seeds played on every difficulty, reduced to the
 * handful of numbers the setup card makes promises about.
 *
 * `run.ts` answers "what happened in this colony". This answers "is Hard country
 * actually harder than Settler, on more than one map, by more than noise" — which
 * is a question no single run can answer and the only question a difficulty
 * setting has to get right. Every number here comes out of the same stepWorld the
 * browser calls; nothing is modelled or extrapolated.
 *
 * A grid is described here (`sweepSpecs`), played one colony at a time
 * (`runSpec`), and folded back together (`assembleSweep`) — three pure steps with
 * the *where* taken out of the middle one. That is what lets `measure.ts` play
 * the identical list across eight workers and a test play it serially, without
 * either of them owning a second definition of what the grid is.
 */

import { runColony, type EvalReport, type Verdict } from './run';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../sim/difficulty';
import { WAR_PARTY } from '../sim/holdings';
import { RESEARCH } from '../sim/research';
import { CAN_SPARE_ONE } from '../sim/settlements';
import type { Difficulty } from '../sim/types';

/** Every project there is. The number a finished bench is finished against. */
const TREE_SIZE = Object.keys(RESEARCH).length;

/**
 * One colony's life, flattened. A `DaySnapshot` is a moment and this is the
 * whole run, because a difficulty promise ("they come sooner") is a claim about
 * a run and cannot be read off any single day of it.
 */
export interface RunMeasure {
  seed: number;
  difficulty: Difficulty;
  verdict: Verdict;
  /** days actually played — short of the ask if the colony was wiped or founded */
  daysLived: number;
  /**
   * The day trouble first came. If none ever did this is `daysLived + 1`, not
   * zero, so that "later" is always the larger number and an ordering check
   * never reads a peaceful run as the most violent one.
   */
  firstThreatDay: number;
  threats: number;
  /** most raiders standing in the valley at once, all run */
  biggestBand: number;
  /** distinct trips to a sick bed, latched per settler */
  downs: number;
  buried: number;
  survivors: number;
  raidersKilled: number;
  peakRung: number;
  /** hungriest anybody ever got, 0..1 — the number that predicts a starvation */
  worstFood: number;
  /** how well fed the colony was on an average day, 0..1 */
  meanFood: number;
  /**
   * Share of a free settler's day spent eating, sleeping or relaxing — the
   * upkeep column. Read off the last snapshot rather than averaged over them,
   * because the underlying counters are cumulative and the last one is already
   * the whole run.
   */
  upkeepShare: number;
  endFoodDays: number;
  /** distinct raiders seen all run, and the share of them carrying a rifle */
  raidersSeen: number;
  armedShare: number;
  /**
   * The day the charter closed, or null. On a grid that stops at the founding
   * this is just `daysLived` again; on one played past it, it is the boundary
   * between the act the game has always measured and the one after it.
   */
  foundedOn: number | null;
  /**
   * First day each ring of the world came into range, indexed by ring, or null
   * for a ring that never did. Ring 0 is home country and is always day 0.
   *
   * The only column here that is about somewhere the colony is not. It is what
   * `the-far-ring-is-earned` reads, and it is a day rather than a flag because
   * the promise has two halves — shut in week one, open by week six — and a
   * boolean can only ever answer one of them.
   */
  ringOpenedOn: (number | null)[];
  /**
   * Trade parties sent, indexed by the ring walked to, and the days the colony
   * had something to spare.
   *
   * Here because `ringOpenedOn` on its own was misleading in the way a metric
   * usually is: it measures permission, and permission read like traffic. The
   * middle ring opened on day five in ten runs out of ten and was walked to
   * twice in sixty days, and nothing on the grid said so.
   */
  tripsByRing: number[];
  spareDays: number;
  /**
   * Projects finished by the last day, and how many days the colony stood at a
   * bench with nothing left on it.
   *
   * The second is the one that matters and the first is there so it can be read.
   * A tree that runs dry on day forty and a tree that is one project short on day
   * sixty both end the run with the bench unused, and only the count of finished
   * projects tells them apart.
   */
  tech: number;
  emptyTreeDays: number;
  /**
   * Days that ended with the bench worked out and short of materials.
   *
   * The bookend to `emptyTreeDays` and the reason it can be trusted. The third
   * tier was added to stop the tree running dry at day forty; the obvious way to
   * do that badly is to trade an idle bench for a stalled one, where the count of
   * finished projects stops climbing for exactly as long and the colony is no
   * better off. Reported, not asserted on — a few stalled days is a colony
   * organising a road trip, which is the tier working. It is what the number does
   * across a grid that says whether the road is walkable.
   */
  stalledDays: number;
  /**
   * The deepest ring the bench's bill pointed at while it was stalled, or −1 if
   * it never stalled.
   *
   * The unit the wait is judged in. `stalledDays` counts how long the colony
   * stood there and says nothing about how far away the answer was, so a fixed
   * bar over it is a claim about one particular map: twelve days was two round
   * trips to the near ring, which sells no parts, and it stayed twelve while the
   * only components in the world sat five days out. The top of the tier now
   * bills machinery from nine days out and a fixed bar would condemn every
   * colony that reached it for walking the distance the design put there.
   *
   * The deepest rather than the last, because a run that waited on parts and
   * then on machinery should be judged against the longer road it was made to
   * walk. That makes it generous to a run whose long wait was the near one, and
   * generous is the right direction for a bar whose failure mode is "the game
   * stopped" — see `the-road-keeps-up-with-the-bench`.
   */
  stallRing: number;
  /**
   * How much of that wait the colony could have ended and did not — a real
   * number of days, summed a tick at a time rather than counted once a day.
   *
   * `stalledDays` is honest about how long the tier took and dishonest about
   * whose fault that was, because it counts the walk as if it were the wait. This
   * column is the half of it a rule can be written against: the bench principle
   * promises the colony *decides* promptly, not that the map is small, so it
   * reads this and lets `stalledDays` report the distance beside it.
   *
   * The two are worth reading together. A big gap between them means the colony
   * walked a long way; a run where they are close never set out. The first is a
   * road problem and the second is a decision problem, and they are fixed at
   * opposite ends of the codebase.
   *
   * It reads in fractions and it is meant to. Permission to leave flickers on
   * and off inside an hour — a settler is hungry at seven and gone by eight —
   * and the day sample this column used to be always landed in that one gap,
   * reporting roughly thirty times the idleness that was there. Column widths
   * assume two decimal places; a run that shows a whole day here has genuinely
   * stood still for one.
   */
  unsentDays: number;
  /**
   * The steel stock at the end, and the largest it ever fell from a high-water
   * mark — the two halves of "is this a resource or a scoreboard".
   *
   * A stock that only ever climbs is a resource with nothing to buy. Measured as
   * a drawdown rather than a slope because a material cost is a step, not a
   * gradient: a project that costs three hundred steel takes three hundred out of
   * the pile on the day it is started, whenever that day happens to be, and a
   * check that read the closing fortnight's growth instead would call a colony
   * that spent its pile on day forty and mined a new one broken.
   *
   * Sampled once a day, so a purchase that is mined back before the day rolls
   * over is invisible here. That is the right blindness for this question: a
   * cost the colony absorbs inside a day is not a cost it had to plan around.
   */
  endSteel: number;
  steelDrawdown: number;
  /**
   * The rung the colony finished on for each of the three end-game roads, in
   * ladder order — science, economy, warfare. See `src/sim/roads.ts`.
   *
   * The *last* rung rather than the peak, on purpose and unlike `peakRung`
   * beside it. The escalation ladder is the Ashbound's opinion of the colony and
   * resets when somebody gets hurt, so only its high-water mark says anything; a
   * road is where the colony got to, and a run that reached a rung and lost it
   * has not walked that road. The one tally that can fall is the economy's —
   * places at charter standing — and a colony that let its friends go is exactly
   * the case this column should report honestly rather than remember fondly.
   */
  roadRungs: number[];
  /**
   * The war, in four numbers: the most hands the colony ever had, the parties it
   * sent, the ground it kept, and what the walking cost.
   *
   * `peakHands` is the peak and the other three are totals, and the asymmetry is
   * the point. Whether a colony *could* have marched is a question about the best
   * day it ever had — a colony that reached eight settlers and buried two had the
   * hands and chose otherwise, and reading its final headcount would score that
   * choice as an impossibility. Whether it *did* march is a question about the
   * whole run. `the-war-is-a-choice` needs both halves and would be measuring the
   * wrong thing with either one twice.
   *
   * `warPawnDays` is booked in full at the muster rather than accrued day by day
   * — see the note on `stats.warPawnDays`. It is what makes the pawn-days-per-
   * holding ratio meaningful on the tick a holding falls rather than a week later.
   */
  peakHands: number;
  campaigns: number;
  holdingsTaken: number;
  warPawnDays: number;
}

export interface SweepOptions {
  seeds?: number[];
  difficulties?: Difficulty[];
  days?: number;
  steward?: boolean;
  /**
   * Play each grid colony to the end of its clock instead of stopping at the
   * founding. The arm does not take it: the arm is a twelve-day controlled
   * experiment on one multiplier, held still in every other respect, and twelve
   * days is short of the earliest founding on any setting — so the flag could
   * only add variance to a measurement whose whole value is that it has none.
   */
  playPastFounding?: boolean;
}

/**
 * One point on the controlled arm: Settler played with a single multiplier
 * moved, everything else — threat, larder, seeds, days — held still.
 */
export interface ArmPoint {
  dial: number;
  upkeepShare: number;
}

export interface Sweep {
  seeds: number[];
  difficulties: Difficulty[];
  days: number;
  /**
   * Whether the grid colonies played their whole clock. Recorded rather than
   * inferred, because a principle about what the back half of a run looks like
   * is measuring the harness rather than the game if the runs stopped at their
   * founding — and a grid that stopped cannot be told from one that played on
   * by looking at the numbers, since a colony that never founds also reaches
   * day sixty.
   */
  playPastFounding: boolean;
  runs: RunMeasure[];
  /**
   * The `upkeep` axis, measured with the other axes held still.
   *
   * Every other promise on the setup card is checkable straight off the grid,
   * because the dial that drives it is the loudest thing in its column: nothing
   * else in the game moves the rifle share the way `tech` does. `upkeep` is not
   * like that. It moves a settler's day by two to three points, and `larder`
   * and `band` move the same column by more, in the other direction — so a grid
   * where all seven multipliers move at once cannot say whether `upkeep` did
   * anything, and the first thirty-day grid duly reported it broken while the
   * dial was working exactly as specified.
   *
   * An observational grid cannot separate a small effect from the large ones it
   * travels with. A controlled one can, and this is it.
   */
  arm: ArmPoint[];
  /**
   * The same colonies, played by somebody.
   *
   * The grid runs with `steward: false` — *nobody manages the colony*, the floor
   * the sim must clear alone — and that is the right instrument for all but two
   * of the promises here, because every other errand in the game is one the
   * colony's own foreman eventually picks up. A campaign is not. `types.ts` says
   * so in as many words: never planned by the colony, a war is the player's
   * decision every time. So an unmanaged grid cannot march, will never march,
   * and reported `campaigns 0` on all fifteen runs of the first sixty-day grid
   * after stage 4 shipped — which reads exactly like a game where the holdings
   * are priced out and is in fact a grid with nobody at the wheel.
   *
   * The fix is not to hand the whole grid to the Steward. Twenty-four of the
   * twenty-six promises are calibrated against the unmanaged floor and would
   * quietly start measuring the Steward instead. It is to play a second family
   * *with* a player and judge only the two war promises on it — the same seeds,
   * settings and days, so the two families differ in one thing.
   *
   * Empty on a sweep read off a measurements file older than this field, which
   * both war principles answer with `untested` rather than a verdict.
   */
  war: RunMeasure[];
}

/**
 * Five maps, because three of the balance surprises found so far showed up on
 * exactly one seed and would have been called noise with fewer.
 */
export const SWEEP_SEEDS = [20260729, 7, 1312, 99001, 424242];

/**
 * Thirty, because the two things the grid most needs to see both live past day
 * twelve: the escalation ladder is built to start after the eval window closes,
 * and the long probes did not see a colony take real casualties until the back
 * half of a run. A ten-day grid answers "did the colony get on its feet", which
 * `npm run sweep` already answers, and every principle about how the settings
 * differ comes back untested.
 */
export const SWEEP_DAYS = 30;

/**
 * One colony to play, as plain data.
 *
 * The grid used to be a pair of nested loops that called `runColony` where they
 * stood, which is fine until the colonies want to be played somewhere else. A
 * spec is the same instruction with the *where* taken out of it: it survives
 * `structuredClone`, so the identical list drives the serial grid in this
 * process and the parallel one across eight workers, and the two cannot drift
 * apart because there is only one list.
 */
export type RunSpec =
  | {
      kind: 'grid';
      seed: number;
      days: number;
      difficulty: Difficulty;
      steward?: boolean;
      playPastFounding?: boolean;
    }
  | { kind: 'arm'; seed: number; days: number; dial: number; steward?: boolean }
  /**
   * A grid colony with a player at the wheel. Same seed, setting and clock; the
   * Steward drives it. See `Sweep.war` for why this family exists at all.
   *
   * It carries no `steward` field, and that absence is the point: this is the
   * one kind of run for which the flag is not a choice the caller gets to make.
   */
  | { kind: 'war'; seed: number; days: number; difficulty: Difficulty; playPastFounding?: boolean };

/** A spec and what playing it produced. Ordered results are the caller's job. */
export interface SpecResult {
  spec: RunSpec;
  measure: RunMeasure;
}

/** Every colony a full sweep plays — grid, then war, then arm, in printing order. */
export function sweepSpecs(opts: SweepOptions = {}): RunSpec[] {
  const seeds = opts.seeds ?? SWEEP_SEEDS;
  const difficulties = opts.difficulties ?? [...DIFFICULTY_ORDER];
  const days = opts.days ?? SWEEP_DAYS;
  const specs: RunSpec[] = [];
  for (const difficulty of difficulties) {
    for (const seed of seeds) {
      specs.push({
        kind: 'grid',
        seed,
        days,
        difficulty,
        steward: opts.steward,
        playPastFounding: opts.playPastFounding,
      });
    }
  }
  // Queued behind the whole grid rather than paired with it, so the fifteen
  // colonies every other promise is read off are the fifteen a reader watching
  // the progress lines sees finish first.
  for (const difficulty of difficulties) {
    for (const seed of seeds) {
      specs.push({ kind: 'war', seed, days, difficulty, playPastFounding: opts.playPastFounding });
    }
  }
  for (const dial of UPKEEP_DIALS) {
    for (const seed of ARM_SEEDS) {
      specs.push({ kind: 'arm', seed, days: ARM_DAYS, dial, steward: opts.steward });
    }
  }
  return specs;
}

/**
 * Play one spec, wherever this happens to be running.
 *
 * This is the only place a colony is played for the grid — serially from a test,
 * or one per worker from `measure.ts`. There is deliberately no second loop that
 * also knows how to build a sweep: the numbers every principle is calibrated
 * against come out of here, and a serial "reference implementation" sitting
 * beside it would be a second definition of the grid that nothing compares
 * against the first.
 *
 * The arm leg swaps `DIFFICULTIES.settler.upkeep` for the duration. Swapped in
 * the table rather than threaded through the sim because `difficultyOf` reads
 * the table on every tick, so this is the whole override — the alternative is an
 * eval-only parameter on `createWorld` that the game would carry forever for the
 * sake of one measurement. Put back in `finally`, and put back per *run* rather
 * than per dial, because a worker is reused across specs: a dial left set by one
 * arm run would silently rewrite every colony that worker played afterwards,
 * including ordinary grid runs that have nothing to do with the arm.
 *
 * The war leg hard-codes `steward: true` instead of reading a field off the spec,
 * which is the difference between a family and a flag. `Sweep.war` exists because
 * a campaign is the one errand nothing plans for itself; a war run that could be
 * asked to play unmanaged would be a grid run with a misleading label on it, and
 * the two promises read off it would report the holdings as scenery.
 */
export function runSpec(spec: RunSpec): SpecResult {
  if (spec.kind === 'arm') {
    const settler = DIFFICULTIES.settler;
    const original = settler.upkeep;
    try {
      settler.upkeep = spec.dial;
      const report = runColony({
        seed: spec.seed,
        days: spec.days,
        difficulty: 'settler',
        steward: spec.steward,
      });
      return { spec, measure: measure(report) };
    } finally {
      settler.upkeep = original;
    }
  }
  if (spec.kind === 'war') {
    const report = runColony({
      seed: spec.seed,
      days: spec.days,
      difficulty: spec.difficulty,
      steward: true,
      playPastFounding: spec.playPastFounding,
    });
    return { spec, measure: measure(report) };
  }
  const report = runColony({
    seed: spec.seed,
    days: spec.days,
    difficulty: spec.difficulty,
    steward: spec.steward,
    playPastFounding: spec.playPastFounding,
  });
  return { spec, measure: measure(report) };
}

/**
 * Fold played specs back into a grid.
 *
 * Pure, and deliberately separate from playing them: the same function assembles
 * a sweep whether the colonies ran here or in eight workers or were read off
 * disk an hour later, which is what lets a principle be rewritten and re-judged
 * without playing anything again.
 */
export function assembleSweep(opts: SweepOptions, results: SpecResult[]): Sweep {
  const seeds = opts.seeds ?? SWEEP_SEEDS;
  const difficulties = opts.difficulties ?? [...DIFFICULTY_ORDER];
  const days = opts.days ?? SWEEP_DAYS;
  const runs = results.filter((r) => r.spec.kind === 'grid').map((r) => r.measure);
  const war = results.filter((r) => r.spec.kind === 'war').map((r) => r.measure);

  // Grouped by the dial that was played rather than by position, so a result
  // list that came back out of order — which a worker pool's will — still lands
  // on the right point of the arm.
  // A dial appears on the arm when its colonies were *played*, never when their
  // mean looks plausible. Dropping a point because it came back at zero would
  // turn the one failure this arm exists to catch — a dial that moves nothing —
  // into a two-point arm that reads as healthy.
  const arm: ArmPoint[] = [];
  for (const dial of UPKEEP_DIALS) {
    const shares = results
      .filter((r) => r.spec.kind === 'arm' && r.spec.dial === dial)
      .map((r) => r.measure.upkeepShare);
    if (shares.length > 0) arm.push({ dial, upkeepShare: mean(shares) });
  }

  // Read off the specs that were actually played rather than off `opts`, for the
  // same reason the arm is: `assembleSweep` is what a grid read back from disk
  // goes through, and the options it is handed there are a description of what
  // was asked for, not a record of what ran.
  const playPastFounding = results.some((r) => r.spec.kind === 'grid' && r.spec.playPastFounding);

  return { seeds, difficulties, days, playPastFounding, runs, arm, war };
}

/**
 * Three seeds and twelve days, against the grid's five and thirty. The upkeep
 * share is a steady-state quantity — a settler's day settles into its shape
 * within a week and the separation is already clean by day eight — and a
 * shorter arm means fewer raids to muddy a measurement whose entire purpose is
 * to hold the fighting still.
 */
export const ARM_SEEDS = SWEEP_SEEDS.slice(0, 3);
export const ARM_DAYS = 12;

/**
 * The three values to play, read once at module load and never again.
 *
 * This is not a convenience. The arm works by writing into `DIFFICULTIES.settler`,
 * and that is the same object `DIFFICULTIES.settler.upkeep` is read from — so a
 * loop that reads its next target out of the table mid-sweep reads back what it
 * wrote on the previous pass, plays the Settler leg at the calm value, and reports
 * two identical points. That is not a hypothetical: it is what the first grid run
 * of this arm did, and the check duly called the axis broken over it.
 */
export const UPKEEP_DIALS = DIFFICULTY_ORDER.map((d) => DIFFICULTIES[d].upkeep);

export function measure(r: EvalReport): RunMeasure {
  const last = r.snapshots[r.snapshots.length - 1];
  const daysLived = r.snapshots.length;
  const firstThreat = r.snapshots.find((s) => s.threats > 0);
  // The high-water mark walks forward with the column, so the fall recorded is
  // always a fall from a peak the colony had actually reached — not from the
  // peak it would go on to reach later.
  let peakSteel = 0;
  let steelDrawdown = 0;
  for (const s of r.snapshots) {
    if (s.steel > peakSteel) peakSteel = s.steel;
    if (peakSteel - s.steel > steelDrawdown) steelDrawdown = peakSteel - s.steel;
  }
  return {
    seed: r.seed,
    difficulty: r.difficulty,
    verdict: r.verdict,
    daysLived,
    firstThreatDay: firstThreat?.day ?? daysLived + 1,
    threats: last?.threats ?? 0,
    biggestBand: last?.biggestBand ?? 0,
    downs: last?.downs ?? 0,
    buried: last?.lost ?? 0,
    survivors: last?.alive ?? 0,
    raidersKilled: last?.raidersKilled ?? 0,
    peakRung: Math.max(0, ...r.snapshots.map((s) => s.rung)),
    worstFood: Math.min(1, ...r.snapshots.map((s) => s.minFood)),
    meanFood: mean(r.snapshots.map((s) => s.avgFood)),
    upkeepShare: last?.upkeepShare ?? 0,
    endFoodDays: last?.foodDays ?? 0,
    raidersSeen: last?.raidersSeen ?? 0,
    armedShare: last && last.raidersSeen > 0 ? last.armedRaiders / last.raidersSeen : 0,
    foundedOn: r.foundedOn,
    ringOpenedOn: r.ringOpenedOn,
    tripsByRing: r.tripsByRing,
    spareDays: r.spareDays,
    tech: last?.tech ?? 0,
    // Counted off the whole tree rather than the display list, because the panel
    // is allowed to leave a project out of its order and the bench is not.
    emptyTreeDays: r.snapshots.filter((s) => s.tech >= TREE_SIZE).length,
    stalledDays: r.snapshots.filter((s) => s.stalled).length,
    stallRing: r.snapshots.reduce((deepest, s) => (s.stalled ? Math.max(deepest, s.errandRing ?? -1) : deepest), -1),
    unsentDays: r.unsentDays,
    endSteel: last?.steel ?? 0,
    steelDrawdown,
    roadRungs: last?.roads ?? [],
    peakHands: Math.max(0, ...r.snapshots.map((s) => s.hands)),
    campaigns: last?.campaigns ?? 0,
    holdingsTaken: last?.holdingsTaken ?? 0,
    warPawnDays: last?.warPawnDays ?? 0,
  };
}

/** Every run played on one setting. */
export function on(sweep: Sweep, d: Difficulty): RunMeasure[] {
  return sweep.runs.filter((r) => r.difficulty === d);
}

/** The same seed on two settings, paired — the only fair comparison. */
export function pairs(
  sweep: Sweep,
  a: Difficulty,
  b: Difficulty,
): { seed: number; a: RunMeasure; b: RunMeasure }[] {
  const out: { seed: number; a: RunMeasure; b: RunMeasure }[] = [];
  for (const seed of sweep.seeds) {
    const ra = sweep.runs.find((r) => r.seed === seed && r.difficulty === a);
    const rb = sweep.runs.find((r) => r.seed === seed && r.difficulty === b);
    if (ra && rb) out.push({ seed, a: ra, b: rb });
  }
  return out;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export const avg = (rs: RunMeasure[], f: (m: RunMeasure) => number) => mean(rs.map(f));

/**
 * The share of raiders carrying a rifle across a set of runs, pooled rather than
 * averaged. A mean of per-run ratios weights a quiet map that saw four raiders
 * the same as a bloody one that saw sixty, which is exactly backwards for a
 * question about what the Ashbound are typically armed with.
 */
export function armedShareOf(rs: RunMeasure[]): number {
  const seen = rs.reduce((a, m) => a + m.raidersSeen, 0);
  if (seen === 0) return 0;
  return rs.reduce((a, m) => a + m.armedShare * m.raidersSeen, 0) / seen;
}

/** A fixed-width grid, because a balance pass is read by eye. */
export function formatSweep(sweep: Sweep): string {
  const cols =
    'setting        seed  verdict     days  1st  threats  band  downs  buried  alive  kills  rung  worstFood  fed  upkeep  foodDays  raiders  rifles     trips  spare   tree  idle   wait  unsent   steel  spent        roads  hands';
  const lines: string[] = [`balance grid · ${sweep.days} days · ${sweep.seeds.length} seeds`, cols];
  for (const d of sweep.difficulties) {
    const rs = on(sweep, d);
    for (const m of rs) {
      lines.push(
        [
          pad(d, -14),
          pad(m.seed, 9),
          '  ' + pad(m.verdict, -10),
          pad(m.daysLived, 4),
          pad(m.firstThreatDay, 5),
          pad(m.threats, 9),
          pad(m.biggestBand, 6),
          pad(m.downs, 7),
          pad(m.buried, 8),
          pad(m.survivors, 7),
          pad(m.raidersKilled, 7),
          pad(m.peakRung, 6),
          pad(m.worstFood.toFixed(2), 11),
          pad(m.meanFood.toFixed(2), 5),
          pad(`${Math.round(m.upkeepShare * 100)}%`, 8),
          pad(m.endFoodDays.toFixed(1), 10),
          pad(m.raidersSeen, 9),
          pad(`${Math.round(m.armedShare * 100)}%`, 8),
          pad((m.tripsByRing ?? []).join('/') || '—', 10),
          pad(`${Math.round((m.spareDays / Math.max(1, m.daysLived)) * 100)}%`, 7),
          pad(`${m.tech ?? 0}/${TREE_SIZE}`, 7),
          pad(m.emptyTreeDays ?? 0, 6),
          // The ring rides in the same cell as the wait, because the two are one
          // reading: eighteen days is a fault at ring one and inside the bar at
          // ring two, and a table that printed them in different columns would
          // be read as if the number alone meant something.
          pad(`${m.stalledDays ?? 0}${(m.stallRing ?? -1) >= 0 ? `@${m.stallRing}` : ''}`, 7),
          pad((m.unsentDays ?? 0).toFixed(2), 8),
          pad(m.endSteel ?? 0, 8),
          pad(m.steelDrawdown ?? 0, 7),
          // Science/economy/warfare, in one cell for the same reason the trips
          // column is one cell: three rungs read together are a shape — a colony
          // deep in the tree and nowhere on the road — and three columns of small
          // integers would be read as three unrelated numbers.
          pad((m.roadRungs ?? []).join('/') || '—', 12),
          // High-water headcount, which is the biggest the colony ever was and
          // the only place the grid reports it. There is deliberately no war
          // column beside it: this family plays unmanaged, so its campaign count
          // is nought on every row by construction, and fifteen dashes down a
          // column labelled `war` is a table telling a reader something false in
          // the most convincing way available. The war is printed below, off the
          // family that could fight one.
          pad(m.peakHands ?? 0, 7),
        ].join(''),
      );
    }
    lines.push(
      [
        pad(`${d} mean`, -14),
        pad('—', 9),
        '  ' + pad(`${rs.filter((r) => r.verdict === 'collapsed').length} lost`, -10),
        pad(avg(rs, (m) => m.daysLived).toFixed(0), 4),
        pad(avg(rs, (m) => m.firstThreatDay).toFixed(1), 5),
        pad(avg(rs, (m) => m.threats).toFixed(1), 9),
        pad(avg(rs, (m) => m.biggestBand).toFixed(1), 6),
        pad(avg(rs, (m) => m.downs).toFixed(1), 7),
        pad(avg(rs, (m) => m.buried).toFixed(1), 8),
        pad(avg(rs, (m) => m.survivors).toFixed(1), 7),
        pad(avg(rs, (m) => m.raidersKilled).toFixed(1), 7),
        pad(avg(rs, (m) => m.peakRung).toFixed(1), 6),
        pad(avg(rs, (m) => m.worstFood).toFixed(2), 11),
        pad(avg(rs, (m) => m.meanFood).toFixed(2), 5),
        pad(`${(avg(rs, (m) => m.upkeepShare) * 100).toFixed(1)}%`, 8),
        pad(avg(rs, (m) => m.endFoodDays).toFixed(1), 10),
        pad(avg(rs, (m) => m.raidersSeen).toFixed(1), 9),
        pad(`${Math.round(armedShareOf(rs) * 100)}%`, 8),
        pad([0, 1, 2].map((r) => avg(rs, (m) => m.tripsByRing?.[r] ?? 0).toFixed(1)).join('/'), 10),
        pad(`${Math.round(avg(rs, (m) => m.spareDays / Math.max(1, m.daysLived)) * 100)}%`, 7),
        pad(`${avg(rs, (m) => m.tech ?? 0).toFixed(1)}/${TREE_SIZE}`, 7),
        pad(avg(rs, (m) => m.emptyTreeDays ?? 0).toFixed(1), 6),
        pad(avg(rs, (m) => m.stalledDays ?? 0).toFixed(1), 7),
        pad(avg(rs, (m) => m.unsentDays ?? 0).toFixed(2), 8),
        pad(avg(rs, (m) => m.endSteel ?? 0).toFixed(0), 8),
        pad(avg(rs, (m) => m.steelDrawdown ?? 0).toFixed(0), 7),
        pad([0, 1, 2].map((r) => avg(rs, (m) => m.roadRungs?.[r] ?? 0).toFixed(1)).join('/'), 12),
        pad(avg(rs, (m) => m.peakHands ?? 0).toFixed(1), 7),
      ].join(''),
      '',
    );
  }
  lines.push(...formatWar(sweep));
  return lines.join('\n');
}

/**
 * The played family, in the few columns it is read for.
 *
 * Deliberately not the grid's thirty. These colonies are not a second opinion
 * about food or upkeep — they are a different player, so their food column is
 * not comparable with anything above it and printing it side by side would
 * invite exactly that comparison. What they are asked is: could this colony have
 * gone, did it go, and what did the ground cost. `hands` and `war` are that
 * question; the verdict and the survivors are beside them so that a colony which
 * won its holdings and was hollowed out doing it cannot read as a success.
 */
function formatWar(sweep: Sweep): string[] {
  const rs = sweep.war ?? [];
  if (rs.length === 0) return [];
  const lines = [
    `the war road · ${rs.length} of the same colonies, played by the Steward`,
    'setting            seed  verdict   alive  hands           war',
  ];
  for (const d of sweep.difficulties) {
    for (const m of rs.filter((r) => r.difficulty === d)) {
      lines.push(
        [
          pad(d, -14),
          pad(m.seed, 9),
          '  ' + pad(m.verdict, -10),
          pad(m.survivors, 5),
          // Could it have gone, and did it. The peak headcount stands next to the
          // war because it is only ever read as the first half of that question:
          // a run showing no campaign beside seven hands made a choice, and the
          // same run beside five never had one to make.
          pad(m.peakHands ?? 0, 7),
          // Parties sent / ground kept · pawn-days spent walking. One cell, same
          // argument as the grid's trips and roads columns: the three numbers are
          // one reading — two campaigns for one holding is a war that went badly,
          // and the pawn-days say whether it was fought at the far ring or the
          // near one.
          pad(
            m.campaigns
              ? `${m.campaigns}/${m.holdingsTaken ?? 0}·${Math.round(m.warPawnDays ?? 0)}`
              : '—',
            14,
          ),
        ].join(''),
      );
    }
  }
  const able = rs.filter((m) => (m.peakHands ?? 0) >= CAN_SPARE_ONE + WAR_PARTY);
  const went = able.filter((m) => (m.campaigns ?? 0) > 0);
  lines.push(
    '',
    `  ${went.length} of ${able.length} colonies that had the hands went out; ` +
      `${rs.reduce((a, m) => a + (m.holdingsTaken ?? 0), 0)} holdings taken across ${rs.length} runs`,
    '',
  );
  return lines;
}

/** Negative width left-aligns, which the setting column needs and the numbers do not. */
const pad = (v: string | number, w: number) =>
  w < 0 ? String(v).padEnd(-w) : String(v).padStart(w);
