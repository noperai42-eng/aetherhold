/**
 * Headless colony evaluation: run the real sim for N days under the Steward and
 * report what happened, day by day.
 *
 * This is the balance instrument. Reading a settler's mood in the HUD tells you
 * about one moment; a ten-day run over five seeds tells you whether the colony
 * is *survivable*, which is the only question that matters when a nine-year-old
 * is the tester. Nothing here mocks the sim — it is the same stepWorld the
 * browser calls, at the same 20 Hz.
 */

import { createWorld } from '../sim/worldgen';
import { makeStreams, stepWorld } from '../sim/tick';
import { CROP_NONE, growingCells } from '../sim/farming';
import { countResource, livingColonists } from '../sim/world';
import { FOOD_VALUE } from '../sim/needs';
import {
  TICKS_PER_DAY,
  type Difficulty,
  type Message,
  type PawnActivity,
  type World,
} from '../sim/types';
import { hasWon } from '../sim/victory';
import { ringOpen } from '../sim/settlements';
import { escalation } from '../sim/events';
import { stewardTick } from './steward';

export interface DaySnapshot {
  day: number;
  alive: number;
  downed: number;
  lost: number;
  /** worst food need in the colony, 0..1 — the number that predicts a collapse */
  minFood: number;
  /**
   * Mean food need across the colony, 0..1 — how well fed everybody is on an
   * ordinary day. `minFood` is the emergency and this is the standard of living:
   * one settler stranded at zero drags the minimum to zero and leaves this
   * almost untouched, which is exactly the difference between a hauling failure
   * and a colony that is genuinely being run tight.
   */
  avgFood: number;
  /**
   * Share of a *free* settler's day spent eating, sleeping or relaxing rather
   * than working, run to date.
   *
   * The `upkeep` axis multiplies exactly three drains, and this is the only
   * column that reads what those drains cost the colony. `avgFood` cannot: a
   * settler eats when they get hungry and stops when they are full, so a faster
   * drain buys more trips to the table at roughly the same average fullness —
   * the number is damped by the very behaviour it is trying to measure. Time is
   * not damped. A colony that spends a third of its day feeding itself has a
   * third less day to build a wall with, which is what "must be managed more
   * tightly" actually means.
   *
   * Both halves count only the settler who was free to choose. Downed and
   * drafted are both left out, and for one reason rather than two: neither can
   * take an upkeep action at all, so each is a guaranteed zero on top and a
   * guaranteed one underneath. Leave either in and the bloodiest, most-raided
   * setting reports the *slackest* upkeep — the `bite`, `band` and `respite`
   * axes bleeding into a column that belongs to `upkeep` alone.
   */
  upkeepShare: number;
  avgMood: number;
  avgHp: number;
  /** days of eating left in store, at the current colony's drain rate */
  foodDays: number;
  wood: number;
  steel: number;
  medicine: number;
  built: number;
  mealsCooked: number;
  raidersKilled: number;
  threats: number;
  /** finished turrets — the one number that says whether defence got off the ground */
  turrets: number;
  /** finished sandbags */
  sandbags: number;
  /**
   * Settlers holding a rifle. The sweeps kept ending with club-armed settlers
   * against rifle-armed raiders, so whether the bench closes that gap is a number
   * the report has to show, not something to infer from the steel column.
   */
  armed: number;
  /** cultivated cells, and how many of them are ripe right now */
  plot: number;
  ripe: number;
  /**
   * Projects finished. The tree's payoffs are all multipliers on numbers already
   * in this table — yield, treatment, meal value, accuracy — so without this
   * column a balance pass cannot tell a colony that out-produced the storyteller
   * from one that simply got a quiet week.
   */
  tech: number;
  /**
   * Morale breaks started so far. `avgMood` alone cannot tell a colony that
   * never faltered from one that broke on day three and recovered by day five —
   * the average is back where it started either way.
   */
  breaks: number;
  /**
   * Deals struck with a caravan. Without it a run where the Steward never met a
   * trader and one where it met four and could not afford any of them read the
   * same — steel high, medicine low, and no way to tell which.
   */
  trades: number;
  /** Downed raiders carried in, and prisoners talked round. */
  captured: number;
  recruited: number;
  /**
   * Where the Ashbound's escalation ladder stands right now, 0..4. The band
   * ceiling and the raider stat step both read it, so a run where the colony
   * never gave anybody a bloody nose and one where it climbed to rung two are
   * fighting different wars — and every other column here reads the same.
   */
  rung: number;
  /**
   * Distinct trips to a sick bed since day one, latched per settler so one long
   * spell on the floor counts once. `downed` is who is down at the instant of
   * the snapshot and `lost` is who got buried; neither can see the settler who
   * went down on day 12 and was back on their feet by day 14, which is most of
   * what "was that raid dangerous" actually means.
   */
  downs: number;
  /**
   * The most raiders that stood in the valley at one time, so far. `threats` is
   * how often trouble came and this is how big it was when it did — the setup
   * card promises "smaller bands" and "greater numbers", and this is the only
   * column that can tell whether either promise is kept.
   */
  biggestBand: number;
  /**
   * Every raider seen standing so far, and how many of those carried a rifle.
   * Two columns rather than a ratio because the ratio is meaningless early —
   * one rifleman out of one raider is not "100% armed", it is one straggler —
   * and a principle that has to know the denominator should be handed it.
   */
  raidersSeen: number;
  armedRaiders: number;
}

export type Verdict = 'thriving' | 'holding' | 'collapsed';

export interface EvalReport {
  seed: number;
  difficulty: Difficulty;
  days: number;
  startingColonists: number;
  snapshots: DaySnapshot[];
  /** every bad/threat message, so a collapse can be read back to its cause */
  incidents: Message[];
  verdict: Verdict;
  /** why the verdict is what it is, in one line */
  summary: string;
  /**
   * The day the colony founded, or null if it never did. Not derivable from the
   * verdict any more: a run played past its founding can found on day 25 and be
   * judged on what day 60 looked like.
   */
  foundedOn: number | null;
  /**
   * The first day the colony could have put a party on the road to the middle
   * ring, and to the far one, or null if it never could.
   *
   * Latched per day rather than read at the end, because range is a state the
   * colony passes through and not one it keeps: a colony that opened the far
   * road on day forty and then ate its way back below the provisioning floor is
   * a colony that earned it, and an end-of-run read would call it locked.
   */
  ringOpenedOn: (number | null)[];
}

export interface EvalOptions {
  seed?: number;
  days?: number;
  /** Off means nobody manages the colony — the floor the sim must clear alone. */
  steward?: boolean;
  /**
   * Which setting to play on. Defaults to `settler`, which `createWorld` also
   * defaults to, so every run recorded before difficulty was measurable is
   * still the run this produces — the sweeps and the seed contracts in
   * tests/hunting.test.ts are calibrated against exactly that.
   */
  difficulty?: Difficulty;
  /**
   * Play the whole clock instead of stopping the moment the colony founds.
   *
   * The sim has kept going after a founding since `victory.ts` stopped setting
   * `gameOver` on a win — the Steward keeps planning, events keep firing,
   * caravans keep coming. The harness was the last thing that treated the
   * founding as the end, which meant every number ever measured describes the
   * first act and nothing after it: on the thirty-day grid the quiet valley
   * stops playing on day 26 of 30.
   *
   * Off by default, and that default is load-bearing rather than cautious. Every
   * grid the difficulty work was calibrated on stops at the founding, and a run
   * that plays on is a different run — more days, more raids, more graves. The
   * flag exists so the two can be measured side by side rather than one quietly
   * replacing the other.
   */
  playPastFounding?: boolean;
}

/** Food a settler burns per day, from needs.ts, so the two cannot drift apart. */
const FOOD_PER_DAY = 0.82;

export function runColony(opts: EvalOptions = {}): EvalReport {
  const seed = opts.seed ?? 20260729;
  const days = opts.days ?? 8;
  const useSteward = opts.steward ?? true;
  const difficulty = opts.difficulty ?? 'settler';
  const playPastFounding = opts.playPastFounding ?? false;

  const world = createWorld(seed, difficulty);
  const streams = makeStreams(world);
  const startingColonists = livingColonists(world).length;
  const snapshots: DaySnapshot[] = [];
  // Latched inside the tick loop rather than read at the day boundary, because a
  // settler can be shot at dawn and be back on the job by dusk — sampling once a
  // day reports that raid as though nobody was touched.
  const onFloor = new Set<number>();
  let downs = 0;
  let biggestBand = 0;
  // Every raider ever seen standing, and how many of them were carrying. Counted
  // by id because a raider is only in `world.pawns` while the fight lasts, and
  // the whole point of the `tech` dial is what the player faces across a run
  // rather than in one raid.
  const seenRaiders = new Set<number>();
  let armedRaiders = 0;
  // Pawn-ticks, not days: the upkeep share has to be read at the resolution the
  // colony actually spends its time at.
  let freeTicks = 0;
  let upkeepTicks = 0;
  // The day the charter closed, latched. `hasWon` is a latch itself and never
  // goes back to false, so once the run plays on it can only answer *whether*
  // the colony founded and never *when* — and when is the interesting half the
  // moment the founding stops being the last day of the run.
  let foundedOn: number | null = null;
  // Index is the ring. Ring 0 is home country and never shut, so it is stamped
  // day zero and the loop below starts at one.
  const ringOpenedOn: (number | null)[] = [0, null, null];

  for (let day = 1; day <= days; day++) {
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      stepWorld(world, streams);
      if (useSteward) stewardTick(world, world.tick);
      // One pass for all of it, because this runs 4 800 times a game day and the
      // sweep runs it across fifteen colonies.
      let band = 0;
      for (const p of world.pawns) {
        if (p.dead) continue;
        if (p.faction === 'raider') {
          band++;
          if (!seenRaiders.has(p.id)) {
            seenRaiders.add(p.id);
            if (p.weapon === 'rifle') armedRaiders++;
          }
          continue;
        }
        if (p.faction !== 'colony') continue;
        if (p.downed) {
          if (!onFloor.has(p.id)) {
            onFloor.add(p.id);
            downs++;
          }
          continue;
        }
        onFloor.delete(p.id);
        // A settler holding the firing line is not choosing between work and
        // supper: `takeJob` skips the drafted outright, so these ticks are a
        // guaranteed zero in the numerator and a guaranteed one in the
        // denominator. Leaving them in lets `band` and `respite` push the
        // upkeep column *down* on the setting that raids hardest.
        if (p.drafted) continue;
        freeTicks++;
        if (UPKEEP_ACTIVITIES.has(p.activity)) upkeepTicks++;
      }
      if (band > biggestBand) biggestBand = band;
    }
    snapshots.push(
      snapshot(world, day, downs, biggestBand, seenRaiders.size, armedRaiders, {
        upkeepTicks,
        freeTicks,
      }),
    );
    if (foundedOn === null && hasWon(world)) foundedOn = day;
    for (let ring = 1; ring < ringOpenedOn.length; ring++) {
      if (ringOpenedOn[ring] === null && ringOpen(world, ring)) ringOpenedOn[ring] = day;
    }
    // Two endings, and only one of them is an ending. `gameOver` is a wipe and
    // always stops the run; a founding stops it only because the harness has
    // always asked "how did this run end", and the game itself goes on. Asked
    // to play past it, the clock is the only thing that finishes the run.
    if (world.gameOver) break;
    if (foundedOn !== null && !playPastFounding) break;
  }

  const incidents = world.messages.filter((m) => m.kind === 'bad' || m.kind === 'threat');
  return {
    seed,
    difficulty,
    days,
    startingColonists,
    snapshots,
    incidents,
    foundedOn,
    ringOpenedOn,
    ...judge(world, snapshots, foundedOn, playPastFounding),
  };
}

function snapshot(
  world: World,
  day: number,
  downs: number,
  biggestBand: number,
  raidersSeen: number,
  armedRaiders: number,
  time: { upkeepTicks: number; freeTicks: number },
): DaySnapshot {
  const colonists = livingColonists(world);
  const n = Math.max(1, colonists.length);
  let food = 0;
  let mood = 0;
  let hp = 0;
  let minFood = 1;
  let bellies = 0;
  let downed = 0;
  for (const p of colonists) {
    mood += p.mood;
    hp += p.hp / p.maxHp;
    minFood = Math.min(minFood, p.needs.food);
    bellies += p.needs.food;
    if (p.downed) downed++;
  }
  const cells = growingCells(world);
  food += countResource(world, 'rawfood') * (FOOD_VALUE.rawfood ?? 0);
  food += countResource(world, 'meal') * (FOOD_VALUE.meal ?? 0);

  return {
    day,
    alive: colonists.length,
    downed,
    lost: world.stats.colonistsLost,
    minFood: round(minFood),
    avgFood: round(bellies / n),
    upkeepShare: round3(time.upkeepTicks / Math.max(1, time.freeTicks)),
    avgMood: round(mood / n),
    avgHp: round(hp / n),
    foodDays: round(food / (FOOD_PER_DAY * n)),
    wood: countResource(world, 'wood'),
    steel: countResource(world, 'steel'),
    medicine: countResource(world, 'medicine'),
    built: world.stats.built,
    mealsCooked: world.stats.mealsCooked,
    raidersKilled: world.stats.raidersKilled,
    threats: world.storyteller.threatsFired,
    turrets: world.buildings.filter((b) => b.kind === 'turret' && b.built).length,
    sandbags: world.buildings.filter((b) => b.kind === 'sandbag' && b.built).length,
    armed: livingColonists(world).filter((p) => p.weapon === 'rifle').length,
    plot: cells.length,
    ripe: cells.filter((c) => (world.crops[c] ?? CROP_NONE) >= 1).length,
    tech: world.research.done.length,
    breaks: world.stats.moraleBreaks ?? 0,
    trades: world.stats.trades ?? 0,
    captured: world.stats.captured ?? 0,
    recruited: world.stats.recruited ?? 0,
    rung: escalation(world),
    downs,
    biggestBand,
    raidersSeen,
    armedRaiders,
  };
}

/**
 * Three outcomes, because "did it survive" is too coarse to tune against:
 * a colony that ends the run whole and fed is thriving, one that buried
 * somebody or is out of food is holding, and one with nobody left collapsed.
 *
 * A founding is worth two different verdicts depending on whether the run
 * stopped there. Stopped at, it *is* the outcome — checked first, or the best
 * run the harness can produce is scored as the worst one, because a founded
 * colony is still standing and the wipe check below would read `gameOver` into
 * it. Played past, it is a milestone inside the run and the verdict is still
 * earned by how the colony is doing when the clock runs out: `charter.won` is a
 * latch, so a colony that founds on day 25 and starves by day 60 answers
 * `hasWon` exactly as brightly as one that is thriving, and taking that answer
 * first would report the failure this stage exists to expose as a success.
 */
function judge(
  world: World,
  snapshots: DaySnapshot[],
  foundedOn: number | null,
  playedPast: boolean,
): { verdict: Verdict; summary: string } {
  const last = snapshots[snapshots.length - 1];
  if (!playedPast && hasWon(world)) {
    return { verdict: 'thriving', summary: `founded on day ${foundedOn ?? last?.day ?? 0}` };
  }
  // Empty on every run that stopped at its founding, so every summary the grid
  // has ever printed is the string it was before.
  const founded = foundedOn === null ? '' : `founded on day ${foundedOn}, `;
  if (!last || last.alive === 0 || world.gameOver) {
    return { verdict: 'collapsed', summary: `${founded}wiped out on day ${last?.day ?? 0}` };
  }
  if (last.lost > 0) {
    // Against everybody who ever lived here, not against the founders: a colony
    // that buried two and recruited seven reads as "8/3 settlers left" otherwise,
    // which is a fraction the wrong way up and the first thing the eye trips on.
    return {
      verdict: 'holding',
      summary: `${founded}${last.alive} settlers standing of ${last.alive + last.lost}, ${last.lost} buried`,
    };
  }
  if (last.foodDays < 1) {
    return { verdict: 'holding', summary: `${founded}whole colony, but under a day of food left` };
  }
  const hungriest = Math.min(...snapshots.map((s) => s.minFood));
  if (hungriest <= 0.02) {
    return {
      verdict: 'holding',
      summary: `${founded}nobody died, but somebody went hungry enough to starve`,
    };
  }
  return {
    verdict: 'thriving',
    summary: `${founded}all ${last.alive} settlers, ${last.foodDays} days of food, mood ${last.avgMood}`,
  };
}

const round = (v: number) => Math.round(v * 100) / 100;
/** The upkeep share separates the settings in the third decimal, not the second. */
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The three things `upkeep` scales, and nothing else. Not `breaking` — a mental
 * break is mood's doing and mood has three other inputs — and not `walking`,
 * even the walk to the table, because that is the pathing cost of where the
 * kitchen was built rather than the cost of needing to eat.
 */
const UPKEEP_ACTIVITIES: ReadonlySet<PawnActivity> = new Set<PawnActivity>([
  'eating',
  'sleeping',
  'relaxing',
]);

/** A fixed-width table, because a balance pass is read by eye. */
export function formatReport(r: EvalReport): string {
  const head = `seed ${r.seed} · ${r.difficulty} · ${r.days} days · steward · verdict ${r.verdict.toUpperCase()} — ${r.summary}`;
  const cols =
    'day alive down downs lost  minFood  mood    hp   foodDays  wood steel  med built meals kills threats rung band  turr  bags rifles  plot ripe tech brk trd cap rec';
  const rows = r.snapshots.map((s) =>
    [
      pad(s.day, 3),
      pad(s.alive, 5),
      pad(s.downed, 4),
      pad(s.downs, 5),
      pad(s.lost, 4),
      pad(s.minFood.toFixed(2), 8),
      pad(s.avgMood.toFixed(2), 6),
      pad(s.avgHp.toFixed(2), 5),
      pad(s.foodDays.toFixed(1), 10),
      pad(s.wood, 5),
      pad(s.steel, 5),
      pad(s.medicine, 5),
      pad(s.built, 5),
      pad(s.mealsCooked, 5),
      pad(s.raidersKilled, 5),
      pad(s.threats, 7),
      pad(s.rung, 5),
      pad(s.biggestBand, 5),
      pad(s.turrets, 6),
      pad(s.sandbags, 6),
      pad(s.armed, 7),
      pad(s.plot, 6),
      pad(s.ripe, 5),
      pad(s.tech, 5),
      pad(s.breaks, 4),
      pad(s.trades, 4),
      pad(s.captured, 4),
      pad(s.recruited, 4),
    ].join(''),
  );
  const worst = r.incidents.slice(-6).map((m) => `  day ${(m.tick / TICKS_PER_DAY).toFixed(1)}  ${m.text}`);
  return [head, cols, ...rows, worst.length ? 'last incidents:' : '', ...worst].filter(Boolean).join('\n');
}

const pad = (v: string | number, w: number) => String(v).padStart(w);
