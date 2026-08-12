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
import { endingRecord, endingTitle } from '../sim/endings';
import {
  PACK_CEILING,
  bestTalker,
  caravanAllowed,
  caravansOf,
  colonySize,
  errandRing,
  ringOf,
  ringOpen,
  settlementById,
  spareGoods,
} from '../sim/settlements';
import { escalation } from '../sim/events';
import { researchStalled } from '../sim/research';
import { roadRungs } from '../sim/roads';
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
   * The longest unbroken spell any settler has spent at or below the starving
   * line **on their feet**, in in-game hours, run to date.
   *
   * `minFood` says somebody touched zero and this says for how long, which turns
   * out to be the whole question. A settler who comes back from a forage at the
   * far end of the valley bottoms out on the walk home and eats on arrival, and
   * that is this column: a long walk, hours of it, ending in a meal. Sampled
   * every tick, because a walk and a starvation are the same reading at one
   * sample a day and the day boundary always lands at the same hour — the hunger
   * curve has a phase, and a daily probe reads that phase rather than the day.
   */
  starveHours: number;
  /**
   * The longest unbroken spell any settler has spent at or below the starving
   * line **on the floor**, in in-game hours, run to date.
   *
   * This is the column the starvation promise is actually about, and it is
   * disjoint from the one above rather than a subset of it: a settler on their
   * feet at zero is walking towards a meal under their own power and arrives; a
   * downed settler is waiting for one to be brought, and nothing in the sim
   * brings it. Kept apart so one long collapse cannot fill both columns and
   * leave the walk invisible.
   */
  floorStarveHours: number;
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
   * Was the bench, at this moment, worked out and waiting on a delivery?
   *
   * The third tier costs goods as well as points, and that opens a failure mode
   * the tree did not have before: a project at a hundred per cent that never
   * finishes because the parts are five days away and nobody went. It looks
   * exactly like an idle bench from `tech` alone — the count stops climbing
   * either way — so without this column a grid could report the tree fixed while
   * every colony on it was standing still for a different reason.
   */
  stalled: boolean;
  /**
   * How far out the road is that ends this stall — the ring, or −1 for none.
   *
   * `stalled` says the bench is waiting; this says what it is waiting on, in the
   * only unit a waiting time can fairly be judged in. Twelve days was a
   * reasonable bar while every bill in the game was payable at a workshop five
   * days out and an unreasonable one the moment the top of the tier started
   * asking for machinery from nine. The bar has to move with the map or it stops
   * being a claim about the colony.
   *
   * A day sample like `stalled` beside it, and safe for the same reason: an
   * outstanding bill lasts as long as the stall does, so it does not flicker
   * inside an hour the way permission to leave does. It asks the sim's own
   * shopping list rather than a copy — see `errandRing`.
   */
  errandRing: number;
  /**
   * Where the colony stands on each of the three end-game roads, in ladder
   * order — science, economy, warfare. See `roads.ts`.
   *
   * Sampled once a day and read off the world rather than accumulated, because
   * a rung is a threshold on a tally the world already keeps and not a thing
   * that happens at a moment. Two of the three tallies only ever climb; the
   * economy one can fall, if a place is lost or standing decays, and the column
   * is the rung rather than the peak so that it says where the colony *is*.
   *
   * A daily sample is the right resolution here for the reason `unsent` was the
   * wrong one: a rung is a state that lasts days at minimum — the fastest of
   * them needs six raiders put down — so no rung can appear and vanish between
   * two looks.
   */
  roads: number[];
  /**
   * There is deliberately no `unsent` here any more. It was a day-boundary
   * boolean and that is precisely what was wrong with it — see `unsentDays` on
   * the report, which counts the same thing at tick resolution and explains why
   * the difference is a factor of thirty rather than a rounding.
   *
   * `stalled` stays a day sample, and the same objection does not apply to it: a
   * stalled bench is a state that lasts days, so one look a day loses almost
   * nothing. Measured on settler/1312 it reads 12 days against 11.76 at tick
   * resolution. A permission that flickers on and off inside an hour is a
   * different kind of quantity, and it is the only one that had to move.
   */
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
  /**
   * Everybody the colony is feeding, including the ones over the horizon.
   *
   * `alive` is who is standing on the map, which is the right number for almost
   * every question here and the wrong one for the war: a colony of seven with
   * three on the moor reads `alive: 4`, and a principle asking whether it ever
   * had the hands to send a party would read every campaigning colony as too
   * small to have sent one. This is `colonySize` — the sim's own answer to how
   * big the colony is — sampled daily so `peakHands` can be taken off it.
   */
  hands: number;
  /**
   * War parties sent, holdings taken and kept, and settler-days spent on the
   * road to them. Cumulative, like every other counter here, so the last
   * snapshot is the whole run.
   */
  campaigns: number;
  holdingsTaken: number;
  warPawnDays: number;
  /**
   * Worth handed over to the neighbours across every deal so far — the berths'
   * whole bill, and the one column in this list denominated in worth rather than
   * in things. Sampled even on runs that never open the economy road's top rung,
   * because "nobody could afford it" and "nobody was ever allowed to try" are the
   * two answers `every-ending-is-reachable` has to tell apart.
   */
  tradedWorth: number;
}

/**
 * `landed` is the fourth and it is not a fourth grade of "how is it doing" — the
 * other three are that question asked on the last day, and this one says the
 * question stopped applying. See `judge`.
 */
export type Verdict = 'thriving' | 'holding' | 'collapsed' | 'landed';

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
  /**
   * Trade parties sent, indexed by the ring they walked to.
   *
   * The companion to `ringOpenedOn`, and the more honest of the two: that one
   * says the colony *could* have gone, this one says whether it did. They came
   * apart the first time anybody looked — the middle ring came into range on
   * day five of nearly every run and then went almost entirely unvisited.
   */
  tripsByRing: number[];
  /**
   * Days the colony had a pack it could spare.
   *
   * The other half of "why didn't it trade": a colony sends no caravans either
   * because it never had a spare crate or because it never had a spare hand,
   * and only the first of those is a problem with the economy.
   */
  spareDays: number;
  /**
   * Days' worth of ticks the bench was waiting on parts and the colony could
   * have sent somebody and did not — a real number, not a count of days.
   *
   * Every other column here is a day sample and this one is not, because it is
   * the only quantity in the report that turns on and off inside an hour. The
   * settler who is permitted at 07:12 and walking by 08:00 is the ordinary case
   * rather than the exception, so a once-a-day look does not sample this
   * quantity, it samples *breakfast*. Measured against the tick truth the old
   * boolean overstated by roughly thirty to one, in the same direction, on every
   * seed — which is the shape of an instrument fault and not of noise.
   *
   * "Could have sent somebody" is `caravanAllowed` itself, asked of the best
   * talker. Only the best talker is ever permitted to lead a party, so that one
   * question is exactly "was anybody permitted" at a thirteenth of the cost, and
   * it is the sim's own rule rather than a second copy of it that could drift.
   * What it excludes are the ticks the sim refuses — asleep, unfed, under
   * attack, on fire, every road already walking — and none of those is a
   * decision the colony declined to make.
   */
  unsentDays: number;
  /**
   * The ending this colony committed to, the day it committed, and the day it
   * landed — all three null on a run that never reached the top of a road.
   *
   * Read off the world at the end rather than latched per day, because unlike
   * `ringOpenedOn` there is nothing here a colony can pass through and lose:
   * `world.ending` is written once at the commitment and once at the landing and
   * is cleared only by a player abandoning it, which the Steward never does. A
   * run that abandoned one would read as never having committed, and that is a
   * gap worth naming rather than hiding — it opens the day anything on the grid
   * can abandon, and nothing can today.
   */
  endingId: string | null;
  endingCommittedOn: number | null;
  endingLandedOn: number | null;
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
  // Where each settler's current spell at or below the starving line began, and
  // the longest any of them has run. Kept as a start tick rather than a counter
  // so the maximum can be taken every tick and a settler who dies mid-spell
  // needs no closing bookkeeping — the spell simply stops growing.
  const starveSince = new Map<number, number>();
  const floorStarveSince = new Map<number, number>();
  let longestStarve = 0;
  let longestFloorStarve = 0;
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
  // Where the colony's trade parties actually went, indexed by ring.
  //
  // `ringOpenedOn` says the road was walkable; it does not say anybody walked
  // it, and those turned out to be very different claims. Latched on the tick a
  // party leaves rather than counted at the end, because a caravan is only in
  // `world.caravans` while it is out and a near-ring round trip can be over
  // inside two days.
  //
  // By party number rather than by a was-anybody-out flag, which is the change
  // the second road forces. An edge on "the list stopped being empty" counts one
  // trip when two parties leave on consecutive days and never counts the second
  // at all, so the column that measures the fix would have been blind to half of
  // it. A set of ids seen is exact and cheap; ids are never reused within a run.
  const tripsByRing = [0, 0, 0];
  const seenTrips = new Set<number>();
  /**
   * Ticks the colony was stalled, permitted to send somebody, and did not.
   *
   * This used to be a boolean on the day snapshot, and the cadence was the bug.
   * `snapshot()` runs after the 4 800th tick of a game day, and a world starts at
   * 07:12 — so every `unsent` reading the grid has ever taken was taken at 07:12,
   * an hour after the valley wakes and before anybody has eaten or gone anywhere.
   *
   * That is not a neutral instant, and a probe on settler/1312 said how far from
   * neutral. Of the twelve stalled samples it charged three as days nobody was
   * sent; attributing each one by hand gives nine with every road already filled,
   * **two where the best talker was simply hungry** — `caravanAllowed` refuses a
   * settler below `ROAD_FOOD` and at 07:12 nobody has had breakfast — and one that
   * was genuinely free and idle. Permission by hour over the same run is nonzero
   * only at hours 6, 7, 18 and 19 and is a flat zero from eight in the morning to
   * five in the afternoon, because by eight the party has left. The sample landed
   * in the one gap in the day: awake, unfed, not yet departed.
   *
   * So the column read three days where the truth was 0.09. Not noise — a
   * thirty-fold overstatement, structural, in the same direction every single day.
   *
   * The fix is the cadence and the question, and nothing else: ask every tick, and
   * ask `caravanAllowed` rather than a proxy for it. Only the best talker can lead
   * a caravan, so asking the best talker is the whole of `some(caravanAllowed)`
   * and costs one call instead of one per colonist. What this stops charging for
   * is time the sim itself refuses — asleep, hungry, under attack, on fire, or
   * every road already full — and none of those is a decision nobody made. What
   * it still charges for is unchanged in kind: free, permitted, stalled, idle.
   *
   * The threshold does not move with it. `A_DECISION` stays at two days, and the
   * corrected instrument will almost certainly read well under that everywhere,
   * which makes the principle a regression guard rather than a live constraint —
   * worth saying plainly, because a threshold left alone while the instrument
   * under it is replaced is the one honest way to find out what the instrument
   * was worth. Moving both at once would have made the grid unreadable.
   */
  let idleTicks = 0;
  // Days the colony had a pack it could spare, which is the other half of the
  // question: a colony that never trades is either too busy or too poor, and
  // only one of those is fixed by making the road cheaper.
  //
  // Sampled at the day boundary rather than per tick — it is a share and sixty
  // samples is plenty for one, and `spareGoods` counts every stack on the map.
  let spareDays = 0;

  for (let day = 1; day <= days; day++) {
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      stepWorld(world, streams);
      if (useSteward) stewardTick(world, world.tick);
      // Edge, not level: a party that is out stays out for days, and counting
      // the level would count one trip once per tick of the road.
      for (const out of caravansOf(world)) {
        if (out.id === undefined || seenTrips.has(out.id)) continue;
        seenTrips.add(out.id);
        const to = settlementById(world, out.settlementId);
        if (to) tripsByRing[ringOf(to)]!++;
      }
      if (researchStalled(world)) {
        const talker = bestTalker(world);
        if (talker && caravanAllowed(world, talker)) idleTicks++;
      }
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
        // Before the `downed` branch below, because a settler on the floor is
        // the case this measures and that branch does not come back.
        // Two spells rather than one and a subset, because the question each
        // answers is different and a settler who goes down mid-spell has stopped
        // being able to answer the first one. On their feet, hungry, is a walk
        // that ends; on the floor, hungry, is a wait for something the sim does
        // not do. Overlapping them would let one long collapse dominate both
        // columns and hide the walk entirely.
        const hungry = p.needs.food <= STARVING;
        const on = hungry && !p.downed ? starveSince : null;
        const floor = hungry && p.downed ? floorStarveSince : null;
        if (on) {
          const from = on.get(p.id) ?? world.tick;
          on.set(p.id, from);
          longestStarve = Math.max(longestStarve, world.tick - from + 1);
        } else starveSince.delete(p.id);
        if (floor) {
          const from = floor.get(p.id) ?? world.tick;
          floor.set(p.id, from);
          longestFloorStarve = Math.max(longestFloorStarve, world.tick - from + 1);
        } else floorStarveSince.delete(p.id);
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
        longestStarve,
        longestFloorStarve,
      }),
    );
    if (foundedOn === null && hasWon(world)) foundedOn = day;
    if (spareGoods(world, PACK_CEILING) !== null) spareDays++;
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
    tripsByRing,
    spareDays,
    unsentDays: round(idleTicks / TICKS_PER_DAY),
    endingId: world.ending?.id ?? null,
    endingCommittedOn: dayOf(world.ending?.committed),
    endingLandedOn: dayOf(world.ending?.landed ?? undefined),
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
  time: {
    upkeepTicks: number;
    freeTicks: number;
    longestStarve: number;
    longestFloorStarve: number;
  },
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
    starveHours: round(hoursOf(time.longestStarve)),
    floorStarveHours: round(hoursOf(time.longestFloorStarve)),
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
    stalled: researchStalled(world),
    errandRing: errandRing(world),
    roads: roadRungs(world),
    breaks: world.stats.moraleBreaks ?? 0,
    trades: world.stats.trades ?? 0,
    captured: world.stats.captured ?? 0,
    recruited: world.stats.recruited ?? 0,
    rung: escalation(world),
    downs,
    biggestBand,
    raidersSeen,
    armedRaiders,
    hands: colonySize(world),
    campaigns: world.stats.campaigns ?? 0,
    holdingsTaken: world.stats.holdingsTaken ?? 0,
    warPawnDays: round(world.stats.warPawnDays ?? 0),
    tradedWorth: round(world.stats.tradedWorth ?? 0),
  };
}

/**
 * Four outcomes, because "did it survive" is too coarse to tune against:
 * a colony that ends the run whole and fed is thriving, one that buried
 * somebody or is out of food is holding, and one with nobody left collapsed.
 *
 * The fourth is an ending, and it is taken before any of them. Not because it
 * is the best outcome — it is not a grade at all — but because the other three
 * are the same question asked about the last day, and a colony that reached the
 * far end of a road has an answer that the last day cannot overwrite. The run
 * carries on after a terminal lands (see `EndingRecord` for why), so those
 * remaining days can look like anything: the ship sails with six of nine and
 * the three who stayed starve, and the last snapshot is a hungry colony with
 * somebody buried in it. Judged on that snapshot the run reads `holding`, and
 * the fact that it got out is gone from the report entirely. So the verdict is
 * taken from the record, and the summary carries the wipe rather than losing
 * it — what happened to the valley afterwards is worth a clause, not the whole
 * line.
 *
 * Exported for the one test that pins that order. Everything else here is
 * exercised by running a colony, but the run that produces a landed ending
 * naturally is a forty-day one and the gate cannot afford one of those — and an
 * ordering is exactly the kind of thing that gets quietly rearranged.
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
export function judge(
  world: World,
  snapshots: DaySnapshot[],
  foundedOn: number | null,
  playedPast: boolean,
): { verdict: Verdict; summary: string } {
  const last = snapshots[snapshots.length - 1];
  // Empty on every run that stopped at its founding, so every summary the grid
  // has ever printed is the string it was before.
  const founded = foundedOn === null ? '' : `founded on day ${foundedOn}, `;
  const record = endingRecord(world);
  if (record && world.ending) {
    const after = world.gameOver ? `, and the valley was empty by day ${last?.day ?? record.day}` : '';
    return {
      verdict: 'landed',
      summary:
        `${founded}${endingTitle(world.ending.id).toLowerCase()} on day ${record.day}, ` +
        `${record.standing} still standing${after}`,
    };
  }
  if (!playedPast && hasWon(world)) {
    return { verdict: 'thriving', summary: `founded on day ${foundedOn ?? last?.day ?? 0}` };
  }
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

/**
 * A world tick as the day number the rest of this report counts in — one-based,
 * because the loop above is, and a colony that committed on the first afternoon
 * committed on day 1 rather than day 0.
 */
const dayOf = (tick: number | null | undefined): number | null =>
  tick === null || tick === undefined ? null : Math.floor(tick / TICKS_PER_DAY) + 1;

/**
 * The food need at or below which the run report already calls a settler
 * starving. Shared by `minFood`'s readers and by the two spell columns, so the
 * level and the duration are talking about the same line.
 */
const STARVING = 0.02;
/**
 * Ticks as in-game hours, which is the unit a spell at zero food is legible in.
 * Days hide it — a settler is on the floor at zero for *most of a day* and the
 * number reads 0.8, which sounds like a rounding error rather than a night.
 */
const hoursOf = (ticks: number): number => (ticks / TICKS_PER_DAY) * 24;
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
