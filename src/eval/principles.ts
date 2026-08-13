/**
 * The balance principles, written down and checked.
 *
 * Every claim here is a promise the game already makes out loud — most of them
 * on the setup card the player reads before they choose. "Trouble comes about
 * half as often, in smaller bands, and hits softer." "They come sooner, in
 * greater numbers, and better armed." Those are measurable statements, and
 * until something measures them they are decoration: the difficulty numbers
 * could be transposed, or a later change could quietly flatten them, and the
 * only signal would be a player who felt the setting did nothing.
 *
 * A principle is `enforced` or `open`. Enforced ones the balance test asserts —
 * breaking one is a bug. Open ones are measured and printed but not asserted,
 * because the design question behind them is genuinely unsettled and the grid
 * is here to settle it; asserting an unsettled question just teaches everyone
 * to ignore a red suite.
 *
 * A check may also answer `untested`, which is not a pass. A ten-day grid
 * cannot see whether the late game gets dangerous, and a principle that
 * silently returned "holds" for want of evidence would be worse than no
 * principle at all.
 */

import { DIFFICULTY_ORDER } from '../sim/difficulty';
import { ENDING_DAYS, ENDING_IDS } from '../sim/endings';
import { WAR_PARTY } from '../sim/holdings';
import { RESEARCH, RESEARCH_ORDER } from '../sim/research';
import { ROAD_IDS, ROAD_RUNGS } from '../sim/roads';
import { CAN_SPARE_ONE, roundTripDays } from '../sim/settlements';
import { armedShareOf, avg, on, type RunMeasure, type Sweep } from './sweep';

export type PrincipleVerdict = 'holds' | 'broken' | 'untested';

export interface Principle {
  id: string;
  /** the promise, in the words the game makes it in */
  claim: string;
  enforced: boolean;
  check(sweep: Sweep): { verdict: PrincipleVerdict; detail: string };
}

export interface PrincipleResult extends Omit<Principle, 'check'> {
  verdict: PrincipleVerdict;
  /** the measurement, in one line — shown pass or fail, because a passing
   *  principle with no number behind it is just the claim again */
  detail: string;
}

export function judgePrinciples(sweep: Sweep): PrincipleResult[] {
  return PRINCIPLES.map(({ check, ...p }) => ({ ...p, ...check(sweep) }));
}

export function formatPrinciples(results: PrincipleResult[]): string {
  const mark = { holds: 'HOLDS ', broken: 'BROKEN', untested: 'no data' } as const;
  const lines = ['balance principles'];
  for (const r of results) {
    lines.push(
      `  ${mark[r.verdict]}  ${r.id}${r.enforced ? '' : '  (open)'}`,
      `          claim: ${r.claim}`,
      `          saw:   ${r.detail}`,
    );
  }
  return lines.join('\n');
}

// ── the checks ──────────────────────────────────────────────────────────────

/**
 * The two dates the far country is measured against.
 *
 * Week one is the shape of the promise: a colony that has not yet fed itself
 * twice has no business on a ten-day road, and if the grid ever finds one out
 * there the gate has stopped gating. Week six is the other half — a road that
 * is shut in week one and still shut on day sixty is not a distance, it is a
 * wall, and the far ring may as well not have been built.
 */
const WEEK_ONE = 7;
const WEEK_SIX = 42;

/** the outermost ring; the one the promise is about */
const FAR_RING = 2;

/**
 * What a road costs in trips, and therefore what "went there" is allowed to mean.
 *
 * A vouch from a middle-ring town is two visits' worth of standing, so two is
 * the smallest number that is about the road rather than about the town. One is
 * a tourist: a colony that walks out once and never again has not made the far
 * country reachable, it has run a long errand.
 */
const VOUCH_TRIPS = 2;

/**
 * The full clock, and what running out of game inside it is allowed to look like.
 *
 * Sixty days because that is the grid a person would actually be judged by — the
 * thirty-day one stops before the second tier is finished on any setting, so it
 * cannot tell a tree with a month of slack from one with none. A week of idle
 * bench rather than a day because the last project landing on day fifty-nine is a
 * tree that fit, and a colony standing at nothing for its final week is one that
 * has run out of somewhere to go.
 */
const DAY_SIXTY = 60;
const IDLE_WEEK = 7;

/**
 * What counts as a pile, and what counts as having spent it.
 *
 * Three hundred steel is ten turrets, or fifteen walls and a workbench with
 * change: a colony holding that at the end of a run is not saving up, it has
 * bought everything the game will sell it. A quarter of that pile is the smallest
 * fall that means something — the biggest single thing there is to buy today
 * costs thirty, so a stock of a thousand can absorb every purchase in the game
 * without ever visibly moving, and a check that accepted a two-per-cent dip would
 * be measuring the mining rate rather than the demand.
 */
const A_PILE = 300;
const SPENT_SHARE = 0.25;

/**
 * Days a finished bench may stand with nobody on the road before it is a fault.
 *
 * Two, and it is a decision rather than a journey. The first cut of this
 * threshold was ten — a round trip, five days out to the parts town and five
 * back — on the reasoning that ten days is the wait a colony cannot avoid and
 * the eleventh is one it did not set out for. The reasoning was sound and the
 * column it was written against could not carry it: `stalledDays` counts the
 * walk as well as the wait, so a party that left on the first morning and was
 * robbed on the fourth day spent seventeen days stalled while doing everything
 * the claim asks. calm/424242 is that run, and it *finished the tier*.
 *
 * So the threshold moved to the column that means what the claim says.
 * `unsentDays` counts only the days the colony had a party free and did not send
 * it, and against that a round trip is not the unit — the unit is how long a
 * colony may take to notice. Two days: one for the bench to finish and the job
 * pass to see it, one for a settler to put down what is in their hands and come
 * looking for the next thing. Three is a colony that had somebody spare, knew
 * what it needed, and stayed home.
 *
 * Note what the two do *not* cover, because it is the thin part: a party already
 * out when the bar fills is not slack against this threshold, it is invisible to
 * it — `unsentDays` does not count those days at all. That is right while a
 * colony can field one party and it stops being right the moment it can field
 * two, at which point this number is measuring something looser than it says.
 *
 * Sixty-day figure, and unlike its predecessor this one does not depend on where
 * the map put the parts town.
 *
 * The number has not moved since; the instrument under it has, and that is worth
 * knowing before reading a verdict against it. `unsentDays` was a day sample and
 * a world starts its clock at 07:12, so every reading this threshold was ever
 * shown was taken at 07:12 — awake, not yet fed, not yet departed. On
 * settler/1312 twelve such samples attributed nine to every road already
 * walking, two to a best talker under `ROAD_FOOD`, and one to a colony that was
 * genuinely free and stayed home; permission ran flat zero from eight in the
 * morning to six at night, because by eight the party had gone. Three days
 * charged where the truth was 0.09.
 *
 * It counts ticks now, and asks `caravanAllowed` rather than a proxy for it. Two
 * stays deliberately: a threshold left alone while the instrument beneath it is
 * replaced is the one honest way to find out what the old instrument was worth,
 * and moving both at once would have made the grid unreadable. What it buys at
 * this cadence is a regression guard rather than a live constraint — nothing on
 * the shipped grid comes near two days of genuine idleness — and a guard is the
 * correct thing for a promise the colony is currently keeping easily.
 */
const A_DECISION = 2;

/**
 * Days a finished bench may stand waiting on deliveries — walking included —
 * before the road itself is the fault.
 *
 * This is the threshold `A_DECISION` used to be asked for and could not carry.
 * `unsentDays` judges whether the colony decided; nothing judged whether the
 * deciding got the parts here in time, and "the road is allowed to cost days"
 * was doing duty as an excuse with no ceiling on it.
 *
 * Twelve, and it was read off the map rather than off the grid — off the wrong
 * part of the map, as the grid then demonstrated. Every third-tier project bills
 * components, and the derivation went: ring zero sells every kind there is, the
 * longest road in that ring is three days out, six there and back, and two of
 * those is the bar — one trip that went wrong and one that went right.
 *
 * Ring zero does not sell components. The middle ring is the only place in the
 * world that does, `RINGS` says so in its own comment, and it is five or six days
 * out: a parts round trip is ten to twelve days. So twelve is not two round trips
 * with a mistake in them, it is *one* — the bar asks a colony to have the parts
 * home before the only trip that can fetch them is over. Nothing can pass that on
 * purpose, and the runs that failed it failed it by walking.
 *
 * The number stays anyway, unenforced, because it is the yardstick the two-party
 * work was measured against and re-deriving it now would erase that reading. The
 * re-derivation is owed to the slice that changes where parts come from, which is
 * the slice that will know what the honest distance is.
 *
 * Deliberately `stalledDays` and not `unsentDays`, which is the reverse of the
 * move slice two made. That move was right there and is right here for the same
 * reason: the bench principle asks who decided and must not be charged for a
 * walk, this one asks how long the walking took and must not be *credited* for
 * one. The player waits the whole number either way, and the two columns exist
 * so that a run can be told which half it failed.
 *
 * It is scoped by that ceiling to what the road can answer for. A colony with
 * nothing worth trading waits here too and is counted, because a bench at the top
 * of the free tree with an empty yard is also a broken promise — a different one,
 * and this check is blind to which. If it ever fails on that cause the detail
 * line will say so, since `unsentDays` travels beside the verdict.
 *
 * Before-reading, off the shipped grid at 4903917 and one party: four of the
 * runs that reached the tier are over it — calm/1312 eighteen days, calm/424242
 * seventeen, calm/7 and settler/1312 thirteen. After the second party, calm/7
 * fell to seven and the two calm outliers did not move, which is what sent
 * somebody to look at where components are actually sold. Both of those colonies
 * had a road free for one hour in sixty days: they were not deciding badly, they
 * were walking.
 *
 * **Re-derived here, in the slice that moved where the tier's goods come from,
 * which is the slice the note above said owed it.** The number is gone and a
 * function stands in its place: one round trip to the ring the bill is payable
 * in, plus a decision. Six days at the near ring, fourteen at the workshops,
 * twenty-two out in the far country.
 *
 * One round trip and not two, and that is the second thing this slice changed
 * rather than a softening. Two was written when the colony had one road: a bill
 * bigger than one load meant two journeys end to end, so the bar had to allow
 * for both. Two roads walk at once, so a bill of any size is one round trip of
 * wall clock, and the second trip the old derivation paid for is now slack the
 * colony spends only when a road goes wrong — which is `one-robbery-does-not-
 * end-the-tier`'s question, asked and answered next door.
 *
 * The test the repo set for any re-derivation, written down when 24 was rejected
 * for failing it: it must still fail the one-party build this bar was made to
 * catch. Fourteen at the middle ring against calm/1312's eighteen and
 * calm/424242's seventeen — it fails them, and it fails them on the shipped
 * two-party grid too, where both still read eighteen. A bar that turned green
 * the moment it was re-derived would be a bar chosen to flatter.
 *
 * What deliberately does *not* move with it is the instrument. `stalledDays` is
 * still a total and still a day sample, and the temptation was to make it the
 * longest single wait in the same breath — which is the better column and would
 * have made this grid unreadable, because nobody could then say whether a number
 * moved because the bar moved or because the ruler did. That is the same rule
 * `unsentDays` was replaced under, one slice ago, and it is owed the same way:
 * the per-delivery column comes after this bar has been read once.
 */
function deliveryBar(ring: number): number {
  // A run that never stalled has no road to be judged against and no wait to
  // judge; the near ring's own bar is the harmless answer, since nothing can be
  // over a bar it never approached.
  return roundTripDays(Math.max(0, ring)) + A_DECISION;
}

/**
 * How many projects a colony finishes before it meets one that costs goods.
 *
 * Counted off the tree rather than written down, so that adding a fourth tier —
 * or moving a bill onto an earlier project — moves this with it instead of
 * leaving a principle quietly scoped to the wrong half of the game.
 */
const THIRD_TIER = RESEARCH_ORDER.filter((id) => !RESEARCH[id].materials).length;

/**
 * How much of the grid that reaches the third tier has to get through it.
 *
 * Three quarters, and the number comes off the road rather than off a wish. A
 * ring-1 parts town is five days out and `mishapChance` puts a party on that
 * road at about one in six, so a colony that reaches the tier with two round
 * trips of calendar left and can absorb a setback should fail perhaps one time
 * in thirty. Three quarters is far looser than that on purpose: it leaves room
 * for the colony that reaches the tier on day fifty with no time to walk
 * anywhere, which is a pacing fact and not a broken promise.
 *
 * What it does not leave room for is the measured shape — three of nine stopped
 * dead on the last free project — because that is not a calendar edge. Two of
 * those three were robbed on the first attempt and never got a second, which is
 * the whole claim: the tier is bought one twelve-day round trip at a time, and a
 * tier bought that way is a tier one robbery ends.
 */
const THE_TIER_CONVERTS = 0.75;

/**
 * How much of the grid below hard country has to reach the founding.
 *
 * Half, set as a floor under a measured seven of ten rather than as a target to
 * climb to — the gap is the room a fair map is allowed to be unlucky in, not
 * slack to spend. It is scoped below hard country because hard country not
 * founding is the setting working; harsh managed one map in five and that is a
 * fact about harsh, not a broken promise.
 *
 * It exists because of a regression that nothing caught. The middle ring used to
 * be guaranteed a parts town by dealing it a fixed card, which quietly moved
 * every other town on the ring and halved the foundings from eight to four — and
 * the whole board of principles reported HOLDS, because `the-game-does-not-end-
 * at-the-founding` only asks whether founded runs play on, never whether anybody
 * founds. A first act half the colonies never finish is a different game, and it
 * was invisible for as long as nothing measured the rate.
 */
const FOUNDING_SHARE = 0.5;

/**
 * The three settings, kindest first, each reduced to one mean. Means rather
 * than per-seed comparisons because a difficulty dial is a claim about the
 * distribution: one map where Hard country happened to stay quiet is not a
 * broken promise, and a check that called it one would be turned off inside a
 * week.
 */
function trend(
  sweep: Sweep,
  metric: string,
  f: (m: RunMeasure) => number,
  dir: 'rises' | 'falls',
  minGap: number,
  // Counts read fine to one decimal. A 0..1 column does not: at one decimal a
  // needed gap of 0.02 prints as "moved 0.0", which reads as a dial that did
  // nothing when it may have done exactly what was asked.
  places = 1,
): { verdict: PrincipleVerdict; detail: string } {
  const present = DIFFICULTY_ORDER.filter((d) => sweep.difficulties.includes(d));
  if (present.length < 2) {
    return { verdict: 'untested', detail: `grid ran only ${present.join(', ')}` };
  }
  const means = present.map((d) => ({ d, v: avg(on(sweep, d), f) }));
  const shown = means.map((m) => `${m.d} ${m.v.toFixed(places)}`).join(' → ');
  if (means.every((m) => m.v === 0)) {
    return { verdict: 'untested', detail: `${metric} was zero everywhere — ${shown}` };
  }
  for (let i = 1; i < means.length; i++) {
    const lo = means[i - 1]!.v;
    const hi = means[i]!.v;
    const gap = dir === 'rises' ? hi - lo : lo - hi;
    if (gap < minGap) {
      return {
        verdict: 'broken',
        detail:
          `${metric} ${shown} — ${means[i - 1]!.d} to ${means[i]!.d} moved ${gap.toFixed(places)}, ` +
          `needed ${minGap} the way it ${dir}`,
      };
    }
  }
  return { verdict: 'holds', detail: `${metric} ${shown}` };
}

const seedsOf = (rs: RunMeasure[], p: (m: RunMeasure) => boolean) =>
  rs.filter(p).map((m) => m.seed);

export const PRINCIPLES: Principle[] = [
  {
    id: 'trouble-comes-sooner-as-it-gets-harder',
    claim: 'Quiet valley "gives you time to get a wall up first"; Hard country "they come sooner".',
    enforced: true,
    check: (s) => trend(s, 'first threat on day', (m) => m.firstThreatDay, 'falls', 0.4),
  },
  {
    id: 'trouble-comes-more-often-as-it-gets-harder',
    claim: 'Quiet valley: "trouble comes about half as often". Settler: "every day or two".',
    enforced: true,
    check: (s) => trend(s, 'threats fired', (m) => m.threats, 'rises', 0.5),
  },
  {
    id: 'bands-get-bigger-as-it-gets-harder',
    claim: 'Quiet valley "in smaller bands"; Hard country "in greater numbers".',
    enforced: true,
    check: (s) => trend(s, 'biggest band', (m) => m.biggestBand, 'rises', 0.4),
  },
  {
    id: 'the-valley-hurts-more-as-it-gets-harder',
    claim: 'Quiet valley "hits softer"; Hard country "better armed".',
    enforced: true,
    check: (s) => trend(s, 'trips to a sick bed', (m) => m.downs, 'rises', 0),
  },
  {
    id: 'the-raiders-are-better-armed-as-it-gets-harder',
    claim:
      'Quiet valley: raiders come "mostly with clubs". Hard country: "better armed — expect ' +
      'rifles early". This is the one threat dial the player can read off the screen.',
    enforced: true,
    // Pooled across runs rather than averaged per run, and stated as a share
    // rather than a count, because a harder setting sends more raiders in the
    // first place — counting rifles would report the `band` dial a second time
    // and call it a tech difference.
    check: (s) => {
      const shares = DIFFICULTY_ORDER.map((d) => ({ d, rs: on(s, d) }))
        .filter((x) => x.rs.length > 0)
        .map((x) => ({ d: x.d, seen: x.rs.reduce((a, m) => a + m.raidersSeen, 0), v: armedShareOf(x.rs) }));
      if (shares.length < 2 || shares.some((x) => x.seen === 0)) {
        return { verdict: 'untested', detail: 'a setting saw no raiders at all' };
      }
      const shown = shares.map((x) => `${x.d} ${(x.v * 100).toFixed(0)}%`).join(' → ');
      for (let i = 1; i < shares.length; i++) {
        // A hard rise rather than a tolerance: a rifle is a discrete thing the
        // player either faces or does not, and "the same share, give or take"
        // is the dial doing nothing.
        if (shares[i]!.v <= shares[i - 1]!.v) {
          return { verdict: 'broken', detail: `raiders carrying rifles: ${shown}` };
        }
      }
      return { verdict: 'holds', detail: `raiders carrying rifles: ${shown}` };
    },
  },
  {
    id: 'the-tighter-setting-is-tighter-to-run',
    claim:
      'Hard country asks the player to run the kitchen and the schedule more attentively — ' +
      'settlers burn through food, sleep and patience faster than they do on the quiet valley.',
    enforced: true,
    // Measured as the share of a standing settler's day that goes to eating,
    // sleeping and relaxing instead of work. Three instruments were tried before
    // this one, and each was discarded for a reason worth keeping:
    //
    // Not the drain constant — that is the input, and the question is whether
    // the player ever feels it. Not days-of-food-in-store — that is `larder`'s
    // column, and reading it here would credit upkeep with the starting
    // stockpile. Not `worstFood` — the grid's own starvation finding pins the
    // minimum near 0.00 on all three settings, so the column that should
    // separate them is held down by a bug that has nothing to do with them.
    //
    // And not `avgFood`, which is the subtle one, because it looked right for a
    // while: 0.60 → 0.57 → 0.54 on a twelve-day grid. On an eight-day grid the
    // same column read 0.608 → 0.556 → 0.571 and harsh came out *better fed*
    // than Settler. It is a damped instrument — a settler eats when hungry and
    // stops when full, so a faster drain buys more trips to the table at about
    // the same average fullness — and it is confounded by `larder`, since a
    // fuller store is easier to stay fed from. It passed on noise.
    //
    // Time is neither damped nor borrowed from another dial: a colony that
    // spends a third of its day feeding itself has a third less day to build a
    // wall with, which is what "must be managed more tightly" means.
    //
    // Read off the controlled arm rather than the grid, and that is the part
    // worth remembering. The grid's own column is not wrong, it is just too
    // quiet to trust: 30.7% → 34.7% → 36.1% over five seeds, a Settler→Hard step
    // of 1.4 points against a floor of 1.0. Read the same runs on three seeds
    // instead and that step is 0.3 — the same code, the same thirty days, and
    // the opposite verdict. Held on its own the dial moves a settler's day
    // 30.9% → 34.6% → 37.3%, and a probe carried it to ×1.30 for 40.5%: dead
    // straight, with headroom past anything the game ships. So the effect is
    // about 2.7 points and the grid reports half of it, because `larder` and
    // `band` write into this same column *harder* than `upkeep` does and in the
    // other direction — a colony that is starving and fighting spends less of
    // its day on itself, not more.
    //
    // The fix is not a better column. Every other axis is the loudest thing in
    // the column it is read from; this one is quiet and travels in loud company,
    // and a promise whose verdict turns on the seed draw is not being verified
    // by anything. It gets an experiment instead of an observation.
    //
    // One point of a settler's day is the floor: comfortably under the smallest
    // gap the arm has ever shown (2.7 points) and far above the spread within a
    // dial, so a multiplier that reads well and moves nothing still fails here.
    check: (s) => {
      const arm = s.arm ?? [];
      if (arm.length < 2) {
        return { verdict: 'untested', detail: 'the grid was run without the controlled arm' };
      }
      const shown = arm.map((p) => `×${p.dial} ${(p.upkeepShare * 100).toFixed(1)}%`).join(' → ');
      for (let i = 1; i < arm.length; i++) {
        const gap = arm[i]!.upkeepShare - arm[i - 1]!.upkeepShare;
        if (gap < 0.01) {
          return {
            verdict: 'broken',
            detail:
              `share of the day spent on upkeep, at fixed threat: ${shown} — ` +
              `×${arm[i - 1]!.dial} to ×${arm[i]!.dial} moved ${gap.toFixed(3)}, needed 0.010`,
          };
        }
      }
      return { verdict: 'holds', detail: `share of the day spent on upkeep, at fixed threat: ${shown}` };
    },
  },
  {
    id: 'the-quiet-valley-is-survivable',
    claim: 'Quiet valley is the setting a nine-year-old plays. No map on it should wipe a colony.',
    enforced: true,
    check: (s) => {
      const rs = on(s, 'calm');
      if (rs.length === 0) return { verdict: 'untested', detail: 'grid did not run calm' };
      const lost = seedsOf(rs, (m) => m.verdict === 'collapsed');
      const buried = seedsOf(rs, (m) => m.buried > 0);
      return lost.length > 0
        ? { verdict: 'broken', detail: `wiped out on seed ${lost.join(', ')}` }
        : {
            verdict: 'holds',
            detail: `${rs.length} maps, none wiped${buried.length ? `, funerals on seed ${buried.join(', ')}` : ', no funerals'}`,
          };
    },
  },
  {
    id: 'difficulty-moves-the-treeline-not-the-larder',
    claim:
      'Difficulty is a valley, not a handicap. It multiplies what comes out of the treeline; it ' +
      'is allowed to touch the larder, and only by a fraction of that.',
    enforced: true,
    // The check that keeps `larder` and `upkeep` honest now that they exist, and
    // the second version of it — the first was wrong in a way worth the note.
    //
    // It used to assert that nobody on calm or settler ever went hungry enough
    // to starve, and the first thirty-day grid broke it on five runs, two of
    // them calm. Reading the rows showed the check was at fault: seed 424242 on
    // calm had a settler at zero with twenty-four days of meals in the larder,
    // which is a hauling failure and not a difficulty one, and by exempting
    // harsh it had hidden four more of them. It is its own finding below now.
    //
    // What is left is a ratio, and a ratio is the right shape because the honest
    // version of "difficulty does not touch supply" was never true: with an
    // identical starting larder on every setting, harsh still ended thirty days
    // on a third less food than calm, because a settler who is shooting is not
    // farming. The promise a player can actually be held to is that the gap
    // between the settings is mostly the treeline — threat by multiples, the
    // pantry by a fraction of that — and that no setting is quietly starved.
    check: (s) => {
      const kind = on(s, 'calm');
      const hard = on(s, 'harsh');
      if (kind.length === 0 || hard.length === 0) {
        return { verdict: 'untested', detail: 'grid did not run both calm and harsh' };
      }
      const threatLow = avg(kind, (m) => m.threats);
      const threatHigh = avg(hard, (m) => m.threats);
      if (threatLow <= 0) {
        return { verdict: 'untested', detail: 'calm fired no threats at all' };
      }
      const foodLow = avg(hard, (m) => m.endFoodDays);
      const foodHigh = avg(kind, (m) => m.endFoodDays);
      const threatRatio = threatHigh / threatLow;
      const foodRatio = foodHigh / (foodLow || 0.01);
      const shown =
        `threat ×${threatRatio.toFixed(2)} calm→harsh (${threatLow.toFixed(1)}→${threatHigh.toFixed(1)} beats), ` +
        `larder ×${foodRatio.toFixed(2)} (${foodHigh.toFixed(1)}→${foodLow.toFixed(1)} days of food)`;
      // Days of food left, not hunger: one settler starving is the finding
      // below, and a colony with a week in store is the thing this asserts.
      const thin = s.difficulties
        .map((d) => ({ d, v: avg(on(s, d), (m) => m.endFoodDays) }))
        .filter((x) => x.v < 5);
      if (thin.length > 0) {
        return {
          verdict: 'broken',
          detail: `${thin.map((x) => `${x.d} ends on ${x.v.toFixed(1)} days of food`).join(', ')} — ${shown}`,
        };
      }
      if (threatRatio < 2) {
        return { verdict: 'broken', detail: `the settings barely differ — ${shown}` };
      }
      return foodRatio < threatRatio
        ? { verdict: 'holds', detail: shown }
        : {
            verdict: 'broken',
            detail: `difficulty moved the larder as hard as the treeline — ${shown}`,
          };
    },
  },
  {
    id: 'nobody-starves-beside-a-full-pantry',
    claim:
      'A settler who cannot walk to a meal is brought one, by somebody who can. Lying on the ' +
      'floor at zero food for hours while a colonist is on their feet and the colony holds weeks ' +
      'of meals is a feeding failure, not the hard setting being hard.',
    // Found by the first thirty-day grid, not designed in. It named runs for
    // several rounds without naming a cause, because it asked how *low* anybody
    // got and the answer to that is zero in almost every colony ever played,
    // including healthy ones.
    //
    // Diagnosed by replaying two of the named runs a tick at a time and asking
    // who was at zero, for how long, and what they were doing. Three
    // explanations had been standing since this was written — a downed settler
    // nobody carried a meal to, a recruit who joined starving, a hauling
    // reservation — and the recruits were the first to go: across both runs
    // every settler who joined mid-run arrived at 0.45 food or better, so
    // nobody walked in already starving. What is left is two
    // populations. Settlers on their feet touch zero for one to six hours,
    // walking, and the spell ends in `eating`. Settlers on the floor sit at zero
    // for up to a full day with meals in store the whole time, and the spell
    // ends when they get up or die.
    //
    // The round that first shipped that measurement guessed at the cause and
    // wrote the guess down as fact — "nothing in the sim carries food to a
    // downed settler" — which was false. `jobs.ts` has `tryFeedPatient`, and an
    // emergency feeding lane above the work board in both assignment entry
    // points. A second probe asked which gate was shut instead of assuming
    // there was no door, and split seed 1312's 88.2 h on the floor four ways:
    // 49.6 h with the whole colony downed, 31.0 h with a meal already walking
    // over, 0.3 h of assignment cadence, and 7.2 h where every settler on their
    // feet was mid-job. Only that last slice was a decision the colony got
    // wrong: both entry points return early on a settler who already has a job,
    // so from the floor "everyone is busy" and "everyone is unconscious" read
    // the same. `sendSomebodyToFeed` closes it.
    //
    // Still open rather than enforced: the diagnosis is a measurement now, but
    // the fix is not written, and a promise that fails on every grid teaches
    // nobody anything the day it starts passing.
    enforced: false,
    check: (s) => {
      // Was `worstFood <= 0.02`, which is a level, and a level cannot answer
      // this claim. A per-tick probe of the runs it named found two different
      // things wearing the same reading: settlers walking home from the far end
      // of the valley who bottom out on the way and eat on arrival — hours, on
      // their feet, resolved — and settlers lying downed at zero for most of a
      // day with the pantry stocked the entire time. The first is a long walk.
      // The second is the failure this promise is named after, and it was being
      // reported in the same breath as the walks, which is why six of fifteen
      // runs read broken and no round could tell what to fix.
      //
      // The sixty-day grid then said something the probe could not: swapping the
      // level for the floor took the count *up*, six to seven. Every run the old
      // check named had a real downed casualty, so it was not over-firing here —
      // it was missing one. settler/20260729 left a settler down and unfed for
      // 6.7 h and never quite touched 0.00, and a bar drawn at the bottom of the
      // scale read that as a colony that was fine.
      //
      // It also put a number on the upright population for the first time, and
      // it is not the one the probe led me to expect: 26.3 h at zero on their
      // feet, where the probe's two runs topped out under six. That is longer
      // than a walk home and this check does not fire on it, deliberately —
      // there is no measurement yet of what those settlers were doing, and the
      // whole reason this principle spent four rounds saying nothing useful is
      // that somebody once drew a bar around a story instead of a reading.
      //
      // Then the grid moved once more, and this time it was the fix that moved
      // it. `sendSomebodyToFeed` shipped, the probe's busy-hands slice went to
      // zero settler-ticks on the seed it was written from — and the count here
      // went *up* again, seven to nine, with the floor column barely stirring
      // (153.2 h summed across fifteen runs to 131.3). Not a regression: the
      // column is mostly not measuring what the fix touches. Half of seed 1312's
      // hours on the floor were hours with the entire colony unconscious, and no
      // rule on the work board reaches a settlement with nobody left standing.
      // Widen the bar and it reads a wipe as a hauling failure.
      //
      // So the bar moves in one more notch, to the narrowest of the three
      // spells: at zero, on the floor, **with somebody still on their feet**.
      // That is hands available and a meal not arriving, which is the only
      // version of this promise the colony can be held to. The floor hours ride
      // along in the detail rather than the check, because how bad the run got
      // is still worth reading beside how much of it was anyone's fault.
      //
      // Five days of food still stands in for "the colony is not short", because
      // a colony genuinely out of food is a different and honest failure.
      const stranded = s.runs.filter((m) => m.strandedStarveHours >= 1 && m.endFoodDays >= 5);
      // Printed either way. On a grid where nobody starves within reach of help
      // these are the only sign left that settlers still hit zero — on their
      // feet, or on the floor of a colony past saving — and a number that only
      // appears on failures is a number nobody tunes.
      const onFeet = Math.max(0, ...s.runs.map((m) => m.starveHours));
      const onFloor = Math.max(0, ...s.runs.map((m) => m.floorStarveHours));
      const walked =
        `longest spell at zero on their feet anywhere: ${onFeet.toFixed(1)} h; ` +
        `on the floor, help or none: ${onFloor.toFixed(1)} h`;
      return stranded.length === 0
        ? { verdict: 'holds', detail: `nobody starved within reach of help beside a stocked larder — ${walked}` }
        : {
            verdict: 'broken',
            detail: `${stranded.length} of ${s.runs.length} runs — ${stranded
              .map(
                (m) =>
                  `${m.difficulty}/${m.seed} left a downed settler at zero for ${m.strandedStarveHours.toFixed(1)} h with somebody on their feet, on ${m.endFoodDays.toFixed(0)} days of food`,
              )
              .join(', ')} (${walked})`,
          };
    },
  },
  {
    id: 'hard-country-is-a-different-game',
    claim:
      'Three settings rather than five because "every one of them has to be worth playing" — ' +
      'so Hard country has to cost a colony something Settler does not.',
    enforced: true,
    check: (s) => {
      const hard = on(s, 'harsh');
      const mid = on(s, 'settler');
      if (hard.length === 0 || mid.length === 0) {
        return { verdict: 'untested', detail: 'grid did not run both settler and harsh' };
      }
      const cost = (rs: RunMeasure[]) => avg(rs, (m) => m.downs + m.buried * 5);
      const h = cost(hard);
      const m = cost(mid);
      if (h === 0 && m === 0) {
        // Nobody got hurt on either setting. That is a grid too short to have an
        // opinion, not a hard setting that costs nothing — and reporting it as
        // the latter would be the harness lying about its own reach.
        return {
          verdict: 'untested',
          detail: `${s.days} days cost neither setting a single trip to a sick bed`,
        };
      }
      // Half again as expensive, not merely more expensive. "A different game"
      // is a claim about magnitude and `h > m` is not: it would sign off on
      // harsh costing 8 against settler 7, which is the same game with worse
      // luck. The floor is conservative against what the valley actually does —
      // the measured grid runs 8.2 → 52.0 — and is here to catch the setting
      // going soft, not to pin the current numbers.
      const shown = `cost of a run (downs + 5×funerals): settler ${m.toFixed(1)} → harsh ${h.toFixed(1)}`;
      if (m === 0) return { verdict: 'holds', detail: `${shown} — settler cost nothing` };
      return h >= m * 1.5
        ? { verdict: 'holds', detail: `${shown} (×${(h / m).toFixed(1)})` }
        : {
            verdict: 'broken',
            detail: `${shown} (×${(h / m).toFixed(1)}) — harsh is Settler with worse luck`,
          };
    },
  },
  {
    id: 'the-escalation-ladder-is-climbable-to-the-top',
    claim:
      'The ladder has five rungs and a line of prose for each. A rung nothing ever reaches is ' +
      'content the player is never shown.',
    // Open: measured, not asserted. The grid is what decides whether the top
    // rungs should be made reachable or the ladder should be shortened, and
    // that is a design call with a test in tests/balance.test.ts on the other
    // side of it.
    enforced: false,
    check: (s) => {
      // The ladder is built to start *after* the eval window closes — three
      // clean fights lands past day twelve, and that constant is three for
      // exactly that reason. A short grid reporting "rung 0, broken" would be
      // measuring the harness rather than the game.
      if (s.days < 30) {
        return {
          verdict: 'untested',
          detail: `${s.days}-day grid — the first rung lands past day 12 by design`,
        };
      }
      const top = Math.max(0, ...s.runs.map((m) => m.peakRung));
      const reached = [...new Set(s.runs.map((m) => m.peakRung))].sort((a, b) => a - b);
      return top >= 4
        ? { verdict: 'holds', detail: `reached rung ${top} across the grid` }
        : {
            verdict: 'broken',
            detail: `highest rung reached anywhere was ${top} of 4; peaks seen: ${reached.join(', ')}`,
          };
    },
  },
  {
    id: 'the-valley-can-still-bury-somebody',
    claim:
      'A colony sim where nobody ever dies is a screensaver. Somewhere on the grid, on the ' +
      'hardest setting, a run should end with a grave.',
    // Open for the same reason, and because a short grid cannot see it: the
    // colonies that got dangerous in the long probes got dangerous after day 40.
    enforced: false,
    check: (s) => {
      const hard = on(s, 'harsh');
      if (hard.length === 0) return { verdict: 'untested', detail: 'grid did not run harsh' };
      if (s.days < 20) {
        return {
          verdict: 'untested',
          detail: `${s.days}-day grid — the long probes saw the first graves after day 40`,
        };
      }
      const graves = hard.filter((m) => m.buried > 0);
      return graves.length > 0
        ? { verdict: 'holds', detail: `${graves.length} of ${hard.length} harsh maps buried somebody` }
        : {
            verdict: 'broken',
            detail: `${hard.length} harsh maps over ${s.days} days, not one funeral`,
          };
    },
  },
  {
    id: 'the-game-does-not-end-at-the-founding',
    claim:
      'The founding is the end of the first act, not the end of the run. A colony that founds ' +
      'on day 25 of 60 has thirty-five days left to play.',
    enforced: true,
    check: (s) => {
      const founded = s.runs.filter((m) => m.foundedOn !== null);
      // A grid that stopped at the founding cannot answer this, and saying so is
      // the point: the number in the detail is the size of the problem, in
      // colony-days of clock that were asked for and never played.
      if (!s.playPastFounding) {
        if (founded.length === 0) {
          return {
            verdict: 'untested',
            detail: `grid stops at the founding, and none of ${s.runs.length} runs founded inside ${s.days} days`,
          };
        }
        const unplayed = founded.reduce((n, m) => n + (s.days - m.daysLived), 0);
        return {
          verdict: 'untested',
          detail:
            `grid stops at the founding — ${founded.length} of ${s.runs.length} runs founded, ` +
            `${unplayed} colony-days of the ${s.days}-day clock never played`,
        };
      }
      if (founded.length === 0) {
        return { verdict: 'untested', detail: `no run founded inside ${s.days} days` };
      }
      // Short of the clock is only allowed for a wipe, which is a real ending
      // and the one thing that still stops a run early.
      const short = founded.filter((m) => m.daysLived < s.days && m.verdict !== 'collapsed');
      const earliest = Math.min(...founded.map((m) => m.foundedOn ?? s.days));
      return short.length === 0
        ? {
            verdict: 'holds',
            detail:
              `${founded.length} of ${s.runs.length} runs founded, earliest on day ${earliest}, ` +
              `and every one played its full ${s.days} days`,
          }
        : {
            verdict: 'broken',
            detail:
              `${short.length} founded runs stopped short of day ${s.days}: ` +
              short.map((m) => `${m.difficulty}/${m.seed} at ${m.daysLived}`).join(', '),
          };
    },
  },
  {
    id: 'the-first-act-is-finishable',
    claim:
      'Most colonies below hard country should reach the founding. The first act is the one ' +
      'every player is promised; a map where half of them never finish it is a different game.',
    enforced: true,
    check: (s) => {
      if (s.days < DAY_SIXTY) {
        return { verdict: 'untested', detail: `${s.days}-day grid cannot see day ${DAY_SIXTY}` };
      }
      // Below hard country only. Not founding on harsh is the setting doing its
      // job, and averaging it in would let a real fall on the kind settings hide
      // behind a number that was always going to be low.
      const fair = s.runs.filter((m) => m.difficulty !== 'harsh');
      if (fair.length === 0) {
        return { verdict: 'untested', detail: 'no runs below hard country on this grid' };
      }
      const founded = fair.filter((m) => m.foundedOn !== null);
      const share = founded.length / fair.length;
      const missed = fair
        .filter((m) => m.foundedOn === null)
        .map((m) => `${m.difficulty}/${m.seed}`)
        .join(', ');
      const seen =
        `${founded.length} of ${fair.length} below hard country founded ` +
        `(${Math.round(share * 100)}%)`;
      return share >= FOUNDING_SHARE
        ? {
            verdict: 'holds',
            detail: missed === '' ? seen : `${seen}; never got there: ${missed}`,
          }
        : {
            verdict: 'broken',
            detail:
              `${seen}, under the ${Math.round(FOUNDING_SHARE * 100)}% floor; ` +
              `never got there: ${missed}`,
          };
    },
  },
  {
    id: 'the-far-ring-is-earned',
    claim:
      'The far country is a capability, not an unlock. No colony can reach it in its first week, ' +
      'and a colony that trades its way outward reaches it by its sixth.',
    enforced: true,
    check: (s) => {
      // A grid that never gets to week six can only answer half of this, and the
      // half it can answer is the easy one — so it does not get to say "holds".
      if (s.days < WEEK_SIX) {
        return { verdict: 'untested', detail: `${s.days}-day grid cannot see day ${WEEK_SIX}` };
      }
      const opened = (m: RunMeasure) => m.ringOpenedOn?.[FAR_RING] ?? null;
      // Shut in week one, everywhere, no exceptions: this is the half that says
      // the far ring is a place and not a button.
      const early = s.runs.filter((m) => {
        const day = opened(m);
        return day !== null && day <= WEEK_ONE;
      });
      if (early.length > 0) {
        return {
          verdict: 'broken',
          detail:
            `${early.length} runs opened the far road inside week one: ` +
            early.map((m) => `${m.difficulty}/${m.seed} on day ${opened(m)}`).join(', '),
        };
      }
      // Open by week six, somewhere a person would actually be playing. Scoped
      // to the settled half of the grid on purpose: Hard country reaching day
      // sixty without ever provisioning a three-week road is a fact about Hard
      // country, and stage 2's note about fixed gates is the same warning.
      const gentle = s.runs.filter((m) => m.difficulty !== 'harsh');
      if (gentle.length === 0) {
        return { verdict: 'untested', detail: 'grid ran nothing below harsh' };
      }
      const earned = gentle.filter((m) => {
        const day = opened(m);
        return day !== null && day <= WEEK_SIX;
      });
      const best = gentle.reduce((soonest: number | null, m) => {
        const day = opened(m);
        return day === null ? soonest : soonest === null ? day : Math.min(soonest, day);
      }, null);
      return earned.length > 0
        ? {
            verdict: 'holds',
            detail:
              `shut for all ${s.runs.length} runs through day ${WEEK_ONE}; ` +
              `${earned.length} of ${gentle.length} below harsh opened it by day ${WEEK_SIX}, earliest day ${best}`,
          }
        : {
            verdict: 'broken',
            detail:
              `shut through day ${WEEK_ONE} as promised, but none of ${gentle.length} runs below harsh ` +
              `reached it by day ${WEEK_SIX}` +
              (best === null ? ' — or ever' : ` — soonest anywhere was day ${best}`),
          };
    },
  },
  {
    id: 'the-long-road-is-walked',
    claim:
      'The rings past the first are places the colony goes, not places it is permitted to go. ' +
      'Left to itself, a colony below Hard country walks out past the near ring often enough to earn a vouch there.',
    enforced: true,
    check: (s) => {
      // The sibling above measures permission. This one measures traffic, and
      // the two came apart the first time anybody looked: the middle ring came
      // into range on day five of ten runs out of ten and went almost entirely
      // unvisited, and no column on the grid could tell the difference between a
      // road that was open and a road that was walked. A promise asserted on the
      // first is not a promise about the second, which is why this is its own
      // principle and not another clause of that one.
      if (s.days < WEEK_SIX) {
        return { verdict: 'untested', detail: `${s.days}-day grid cannot see day ${WEEK_SIX}` };
      }
      // Scoped below Hard for the same reason its sibling is: hard country
      // finishing sixty days with nothing to spare is a fact about hard country,
      // and a colony with an empty barn is not refusing to trade, it is unable
      // to. Whether that is a problem is stage 2's question, not this one's.
      const gentle = s.runs.filter((m) => m.difficulty !== 'harsh');
      if (gentle.length === 0) {
        return { verdict: 'untested', detail: 'grid ran nothing below harsh' };
      }
      const outward = (m: RunMeasure) =>
        (m.tripsByRing?.[1] ?? 0) + (m.tripsByRing?.[FAR_RING] ?? 0);
      const spare = (m: RunMeasure) =>
        Math.round((m.spareDays / Math.max(1, m.daysLived)) * 100);
      const walked = gentle.filter((m) => outward(m) >= VOUCH_TRIPS);
      // A majority rather than every run, because five seeds a setting is a
      // small sample of weather and a colony that spent its sixth week putting
      // out fires is allowed to stay home. Half is not enough: half is what the
      // grid measured while the foreman was, in fact, never leaving the valley.
      if (walked.length * 2 > gentle.length) {
        const ring = (r: number) =>
          (gentle.reduce((sum, m) => sum + (m.tripsByRing?.[r] ?? 0), 0) / gentle.length).toFixed(1);
        return {
          verdict: 'holds',
          detail:
            `${walked.length} of ${gentle.length} below harsh sent ${VOUCH_TRIPS} or more parties past the near ring; ` +
            `mean trips by ring ${ring(0)}/${ring(1)}/${ring(FAR_RING)}`,
        };
      }
      const homebound = gentle.filter((m) => outward(m) < VOUCH_TRIPS);
      return {
        verdict: 'broken',
        detail:
          `only ${walked.length} of ${gentle.length} below harsh walked past the near ring ${VOUCH_TRIPS} times: ` +
          homebound
            .map((m) => `${m.difficulty}/${m.seed} ${(m.tripsByRing ?? []).join('/')} on ${spare(m)}% spare days`)
            .join(', '),
      };
    },
  },
  {
    id: 'the-far-country-is-walked',
    claim:
      'The far country is a place, not a permission. A colony that opens that road with a round ' +
      'trip still on the clock goes out there.',
    // Written before the thing that is meant to satisfy it, which on this one
    // cost nothing at all: the columns it needs have shipped for three grids and
    // the answer was sitting in `.eval/measurements.json` unread. Seven runs below
    // hard country opened the far road with twenty days left to walk it, and two
    // of them went — calm/20260729 and settler/99001, two trips each. Broken on
    // arrival, off the grid that shipped the slice before this one.
    //
    // It is `the-long-road-is-walked` one ring out and it exists for the same
    // reason that one does: its sibling `the-far-ring-is-earned` measures whether
    // the road opened, and a road that opens and is never used has kept the
    // letter of that promise while breaking the point of it. The difference is
    // that the middle ring's traffic problem was permission — the colony had one
    // party and could not spare it — and this one is not. Ten maps in ten opened
    // the far road. Nothing was stopping them. There was simply nothing out there
    // that could not be bought four days nearer, so `pickDestination`, which
    // divides worth by distance, ranked it last every time, and `shoppingRun`,
    // which takes the nearest road selling what the bench wants, never had a
    // reason to look past the workshops.
    //
    // Which is why the fix is a trade good and not a bonus. A thumb on the scale
    // — a far-ring multiplier, a standing order, a shorter first rung — would
    // make colonies walk out there for things they could get nearer, and that is
    // a colony being managed by its scoring function. `assemblies` gives the far
    // country the one thing the middle country does not have, and the trip pays
    // for itself in the ordinary way: the bench wants it, nowhere else sells it.
    enforced: false,
    check: (s) => {
      // Full clock only, and a full clock is not enough by itself: a colony that
      // opened the road on day fifty-five never had the twenty days a round trip
      // costs, and counting it as a refusal would charge the calendar to the
      // colony. That scope is the whole reason this reads seven runs and not ten.
      if (s.days < DAY_SIXTY) {
        return { verdict: 'untested', detail: `${s.days}-day grid cannot see day ${DAY_SIXTY}` };
      }
      const trip = roundTripDays(FAR_RING);
      // Below hard country, exactly as both siblings are scoped and for the
      // reason they give: hard country reaching day sixty without provisioning a
      // three-week road is the setting working, and a colony that spent its last
      // month burying people is not refusing to travel.
      const able = s.runs.filter((m) => {
        if (m.difficulty === 'harsh' || m.daysLived < s.days) return false;
        const opened = m.ringOpenedOn?.[FAR_RING] ?? null;
        return opened !== null && opened + trip <= s.days;
      });
      if (able.length === 0) {
        return {
          verdict: 'untested',
          detail: `no run below hard country opened the far road with ${trip} days left to walk it`,
        };
      }
      const walked = able.filter((m) => (m.tripsByRing?.[FAR_RING] ?? 0) > 0);
      // Half, and one trip rather than `VOUCH_TRIPS`. Both are looser than the
      // middle ring's bar on purpose: twenty days of the sixty a run has is a
      // third of the game spent on one errand, so a colony that walks out there
      // once has made the far country part of how it plays, and a colony that
      // walks out twice has done little else. The claim is that the road is used,
      // not that it is commuted.
      const seen =
        `${walked.length} of ${able.length} below hard country that opened the far road with ` +
        `${trip} days to spare walked it`;
      return walked.length * 2 >= able.length
        ? {
            verdict: 'holds',
            detail:
              `${seen}; ` +
              walked
                .map((m) => `${m.difficulty}/${m.seed} ${m.tripsByRing?.[FAR_RING] ?? 0}`)
                .join(', '),
          }
        : {
            verdict: 'broken',
            detail:
              `${seen}; stayed home: ` +
              able
                .filter((m) => (m.tripsByRing?.[FAR_RING] ?? 0) === 0)
                .map(
                  (m) =>
                    `${m.difficulty}/${m.seed} open from day ${m.ringOpenedOn?.[FAR_RING]} ` +
                    `on trips ${(m.tripsByRing ?? []).join('/')}`,
                )
                .join(', '),
          };
    },
  },
  {
    id: 'the-tree-is-not-empty-at-day-sixty',
    claim:
      'A colony that plays its whole clock still has a project worth starting. ' +
      'The bench is a place to go back to, not a list to be finished.',
    enforced: true,
    check: (s) => {
      // Written open, on purpose, a tier before the feature that would satisfy
      // it: nine of fourteen full runs finished the whole tree and then stood at
      // an empty bench, and asserting that would have painted the suite red for
      // a month. Enforced now because the third tier landed and the grid agrees
      // — fourteen full runs, longest idle nought days. Writing it first is what
      // makes that number worth anything: the bar was set before there was a
      // result to choose it to flatter.
      if (s.days < DAY_SIXTY) {
        return { verdict: 'untested', detail: `${s.days}-day grid cannot see day ${DAY_SIXTY}` };
      }
      // Only the colonies that played the whole clock. A run cut short by a wipe
      // has an unfinished tree for a reason that has nothing to do with the tree.
      const full = s.runs.filter((m) => m.daysLived >= s.days);
      if (full.length === 0) {
        return { verdict: 'untested', detail: `no run reached day ${s.days}` };
      }
      const idle = full.filter((m) => (m.emptyTreeDays ?? 0) >= IDLE_WEEK);
      const tree = (m: RunMeasure) => `${m.tech ?? 0} projects`;
      // Carried on every verdict below, never asserted on. The third tier can fail
      // this principle two ways now — a bench with nothing on it, and a bench with
      // something on it that will never finish because the parts are five days out
      // — and only the first is what the check measures. A grid that reports this
      // holding with thirty stalled days a run has not fixed the tree, it has moved
      // where the colony stands still, and the number has to be in front of whoever
      // reads the verdict for that to be noticed.
      const stall = (rs: RunMeasure[]) => {
        const days = rs.map((m) => m.stalledDays ?? 0);
        const worst = Math.max(0, ...days);
        if (worst === 0) return 'no run waited on a delivery';
        const mean = days.reduce((a, b) => a + b, 0) / days.length;
        return `waiting on deliveries ${mean.toFixed(1)} days a run, worst ${worst}`;
      };
      if (idle.length > 0) {
        return {
          verdict: 'broken',
          detail:
            `${idle.length} of ${full.length} full runs finished the tree with time to spare: ` +
            idle
              .map((m) => `${m.difficulty}/${m.seed} idle ${m.emptyTreeDays} days`)
              .join(', ') +
            `; ${stall(full)}`,
        };
      }
      // The nearest miss is the whole story on a passing run. "Nobody ran out" is
      // true of a tree with one day of slack and of one with a month, and only
      // one of those is a tree worth having.
      const closest = full.reduce((a, m) =>
        (m.emptyTreeDays ?? 0) > (a.emptyTreeDays ?? 0) ? m : a,
      );
      const richest = full.reduce((a, m) => ((m.tech ?? 0) > (a.tech ?? 0) ? m : a));
      return {
        verdict: 'holds',
        detail:
          `no run of ${full.length} stood at an empty bench for ${IDLE_WEEK} days; ` +
          `furthest anybody got was ${richest.difficulty}/${richest.seed} at ${tree(richest)}, ` +
          `longest idle was ${closest.emptyTreeDays ?? 0} days; ${stall(full)}`,
      };
    },
  },
  {
    id: 'the-bench-does-not-wait-on-an-errand',
    claim:
      'A colony with one settler to spare and a bench that has finished studying spends that ' +
      'settler on what the bench is short of. Standing still is allowed to cost a road; it is ' +
      'not allowed to cost a decision nobody made.',
    enforced: true,
    check: (s) => {
      // Written for the fix in the same commit and not after it, which is the
      // only order that makes the number mean anything. Before the fix this
      // reads broken on five of fifteen — calm/424242 twenty-two days, calm/1312
      // eighteen, settler/1312 and calm/7 thirteen, calm/20260729 twelve.
      //
      // Instrumenting those runs found three causes and not the one the fix was
      // first written for. `jobs.ts` honouring an open letter ahead of a shopping
      // run is real and is the largest. Under it sat a reserve mismatch —
      // `answerable` measures a pack against `COMMISSION_KEEP` and `spareGoods`
      // against the much higher `SURPLUS`, so a colony could afford to give a
      // pack away and not to spend it, and the stricter test was guarding the
      // trip that helps. Under *that* sat the ranking itself: `pickDestination`
      // scores worth over days, and a bonus of three against a five-day road is
      // not enough to move a pack the size of a letter. All three had to go, and
      // the reason one commit fixed three bugs is that only the last of them is
      // visible once the first two stop firing.
      //
      // The sixty-day grid is the first thing that could see any of it: below the
      // third tier `researchNeeds` is empty on every project, so the clause that
      // now yields never had anything to yield to.
      //
      // Then the fix landed and this still read broken — four of nine, calm/1312
      // eighteen days, calm/424242 seventeen, calm/7 and settler/1312 thirteen —
      // and the fourth cause turned out to be this check. calm/424242 chose the
      // foundry on day thirty-six, sent its party, was robbed, sent it again, and
      // *finished the project* on day fifty-seven. Seventeen stalled days, every
      // one of them somebody walking. The claim says standing still is allowed to
      // cost a road; `stalledDays` was charging the road to the colony's account.
      // So the check moved to `unsentDays`, which counts only the days with
      // nobody out, and `A_ROUND_TRIP` retired with the reasoning that named it.
      //
      // What the old column was seeing is real and is not this principle's to
      // judge: a five-day road at a seventeen-per-cent mishap rate is a tier one
      // robbery can end, and two of those three seeds it did end. That reading
      // moved out into `one-robbery-does-not-end-the-tier` — same evidence, the
      // promise it actually breaks.
      //
      // That left one run, and it took a second narrowing — which deserves
      // saying plainly, because narrowing a column until a principle passes is
      // what tuning to pass looks like from the outside. calm/99001 read four
      // unsent days of seven on eighteen projects. Its party left on day
      // forty-six for a meal town, when `waystations` had not been chosen and
      // the bench was short of nothing; the bill appeared on day fifty-four with
      // the settler three days from home; it walked in on fifty-six, ate and
      // slept, and set out for the parts on fifty-eight. Days fifty-four to
      // fifty-six were charged to a colony that had nobody to charge — one
      // party, already committed, on an errand it was right to take. So `unsent`
      // stopped asking where the party was going and started asking whether
      // there was a party at all.
      //
      // The test that this is a correction and not a fit: it still fails things.
      // Day fifty-seven is counted and always was — twenty-eight hundred ticks
      // with every gate open and nobody sent — and a colony that sat at home for
      // a week would read seven. What it stopped counting is a road, which is
      // the same mistake as the first narrowing, one step further out. It leaves
      // the margin thin: calm/99001 now reads one day against a threshold of
      // two, and the honest reading of that is that the one-party colony is at
      // the edge of what this principle can excuse. The next slice gives it a
      // second party, and then "committed" and "nothing to spare" stop being the
      // same sentence and this column has to be re-read.
      //
      // Re-read, and the column was worse than thin — it was reading the wrong
      // instant. Every sample it ever took was taken at 07:12, because a world
      // starts its clock there and this was a day-boundary boolean, and 07:12 is
      // the one gap in a settler's day: awake, not yet fed, not yet gone. Of
      // twelve such samples on settler/1312, nine had every road already walking
      // and two had a best talker too hungry for `caravanAllowed` to let out the
      // gate. One was a real idle morning. The column said three days; the ticks
      // said 0.09.
      //
      // It counts ticks now and asks `caravanAllowed` itself. What that costs is
      // this principle's teeth: at tick resolution no shipped run is anywhere
      // near two days, so what stands here is a guard against a colony learning
      // to sit still rather than a live constraint on one. That is a fair trade
      // for a column that was overstating by thirty to one in the same direction
      // on every seed — a threshold is only worth what the instrument under it
      // is, and this one was buying its margin from breakfast.
      if (s.days < DAY_SIXTY) {
        return { verdict: 'untested', detail: `${s.days}-day grid cannot see day ${DAY_SIXTY}` };
      }
      // Full runs only, and the same reason as its two siblings: a colony that
      // was wiped on day nine has a bench that waited nought days because it
      // never got one, and counting that as a pass would let a grid full of
      // corpses satisfy a principle about trade.
      const full = s.runs.filter((m) => m.daysLived >= s.days);
      if (full.length === 0) {
        return { verdict: 'untested', detail: `no run reached day ${s.days}` };
      }
      // Only the colonies that got deep enough for the question to exist. A run
      // that never reached a project with a material bill has a bench that never
      // waited on a delivery, and it is evidence of nothing either way — hard
      // country is mostly these, which is exactly why this must not be scored as
      // a pass there.
      const reached = full.filter((m) => (m.stalledDays ?? 0) > 0 || (m.tech ?? 0) >= THIRD_TIER);
      if (reached.length === 0) {
        return {
          verdict: 'untested',
          detail: `no run of ${full.length} reached a project that costs materials`,
        };
      }
      const waited = reached.filter((m) => (m.unsentDays ?? 0) > A_DECISION);
      if (waited.length > 0) {
        return {
          verdict: 'broken',
          detail:
            `${waited.length} of ${reached.length} runs that reached the third tier stood at a ` +
            `finished bench with a party free and nobody sent for more than ${A_DECISION} days: ` +
            waited
              .map(
                (m) =>
                  `${m.difficulty}/${m.seed} sent nobody for ` +
                  `${(m.unsentDays ?? 0).toFixed(2)} of ${m.stalledDays} waiting days, on ` +
                  `${m.tech} projects`,
              )
              .join(', '),
        };
      }
      const worst = reached.reduce((a, m) => ((m.unsentDays ?? 0) > (a.unsentDays ?? 0) ? m : a));
      const mean =
        reached.reduce((a, m) => a + (m.unsentDays ?? 0), 0) / Math.max(1, reached.length);
      // The road figure travels with the verdict on purpose. This principle
      // passing says the colony decided; it says nothing about how long the
      // deciding cost, and the two are easy to confuse precisely because one
      // column used to be asked both questions. `one-robbery-does-not-end-the-tier`
      // is where the distance is judged — this line is only so a reader of the
      // pass can see what the walking came to.
      const walked =
        reached.reduce((a, m) => a + (m.stalledDays ?? 0), 0) / Math.max(1, reached.length);
      return {
        verdict: 'holds',
        detail:
          `all ${reached.length} runs that reached the third tier had a party committed within ` +
          `${A_DECISION} days; longest gap was ${worst.difficulty}/${worst.seed} at ` +
          `${(worst.unsentDays ?? 0).toFixed(2)} days, mean ${mean.toFixed(2)}; ` +
          `the road itself took ${walked.toFixed(1)} days a run`,
      };
    },
  },
  {
    id: 'the-road-keeps-up-with-the-bench',
    claim:
      'The road is a rate, not a permit. A colony that has earned the far country and can spare ' +
      'the bodies gets its goods inside one round trip to wherever they are sold — the distance ' +
      'is allowed to cost days, and it is not allowed to cost the act.',
    // Open, still, and now for the opposite reason to the one it was opened for.
    // It was opened because the bar was wrong: twelve days was two round trips to
    // a ring that sells no parts, which is one round trip to the ring that does,
    // so it asked for the goods home before the only journey that could fetch
    // them was over. That is fixed — `deliveryBar` asks the map how far away the
    // answer is — and it stays unenforced for one grid because a bar nobody has
    // read yet is not a promise anybody can be held to. The grid that reads it
    // green is the one that gets to enforce it.
    //
    // What it must not be enforced on before then: the shipped grid says two runs
    // are still over it, and both are ring-1 bills of eighteen days against a bar
    // of fourteen. Enforcing now would paint the suite red on a fault this slice
    // did not introduce and does not claim to fix.
    enforced: false,
    check: (s) => {
      // Written before the second party and not after it, which is the only order
      // that makes the number mean anything — and unusually, the before-reading
      // did not cost a grid. The column already existed and the shipped run at
      // 4903917 already published it: `wait` reads 7/13/18/7/17 on the quiet
      // valley and 5/3/13/0/0 on settler, so four of the runs that reached the
      // tier are over twelve and this is broken on arrival.
      //
      // The second party is still the right fix for what it was aimed at, and the
      // same grid says why. calm/1312 sat eighteen days without closing a twelve
      // component bill; `caravanAllowed` refuses while a raid is up, while
      // anything is burning, through sleep hours, and — the binding one — while
      // anybody at all is already walking. A colony of fifteen had one road and
      // used it like a colony of four. Afterwards calm/7 fell from thirteen days
      // to seven and mean trips to the middle ring went from 3.4 to 4.5.
      //
      // What it did not fix is the pair that stayed at eighteen and seventeen,
      // and those are the runs that unmasked the bar. Both spent sixty days with
      // a road free for about an hour: at that point the wait is the length of
      // the road and no permission rule can shorten it.
      //
      // The thing this must not be read as promising: robberies do not get rarer.
      // `tickCaravan` seeds its dice off the settlement and its visit count, so a
      // town's luck is a deck dealt in order and a second party draws the next
      // card rather than a second copy of the same one. What two parties buy is
      // draws per day. That is the failure this principle names, and it is the
      // whole of what it claims.
      if (s.days < DAY_SIXTY) {
        return { verdict: 'untested', detail: `${s.days}-day grid cannot see day ${DAY_SIXTY}` };
      }
      const full = s.runs.filter((m) => m.daysLived >= s.days);
      if (full.length === 0) {
        return { verdict: 'untested', detail: `no run reached day ${s.days}` };
      }
      // Same gate as its sibling and for the same reason: hard country is mostly
      // colonies that never reached a project with a bill, and scoring their nought
      // waiting days as a pass would let a grid of corpses certify the road.
      const reached = full.filter((m) => (m.stalledDays ?? 0) > 0 || (m.tech ?? 0) >= THIRD_TIER);
      if (reached.length === 0) {
        return {
          verdict: 'untested',
          detail: `no run of ${full.length} reached a project that costs materials`,
        };
      }
      const over = (m: RunMeasure) => (m.stalledDays ?? 0) - deliveryBar(m.stallRing ?? -1);
      const slow = reached.filter((m) => over(m) > 0);
      if (slow.length > 0) {
        return {
          verdict: 'broken',
          detail:
            `${slow.length} of ${reached.length} runs that reached the third tier waited longer ` +
            `than one round trip to the ring their bill was payable in: ` +
            slow
              // `unsentDays` rides along so a reader can tell the two failures
              // apart without opening the table: a run whose wait is nearly all
              // unsent had nobody to send or nothing to send them with, and that
              // is the yard's fault rather than the road's.
              .map(
                (m) =>
                  `${m.difficulty}/${m.seed} waited ${m.stalledDays} days on a ring-` +
                  `${m.stallRing ?? -1} bill against ${deliveryBar(m.stallRing ?? -1)} ` +
                  `(${(m.unsentDays ?? 0).toFixed(2)} of them with a road free), on ` +
                  `${m.tech} projects`,
              )
              .join(', '),
        };
      }
      // Worst by how far over its own bar it came, not by raw days: with the bar
      // moving from ring to ring, the longest wait on the grid is often the one
      // with the most road behind it and the most slack left.
      const worst = reached.reduce((a, m) => (over(m) > over(a) ? m : a));
      const mean =
        reached.reduce((a, m) => a + (m.stalledDays ?? 0), 0) / Math.max(1, reached.length);
      return {
        verdict: 'holds',
        detail:
          `all ${reached.length} runs that reached the third tier got their goods inside one ` +
          `round trip to the ring that sells them; closest was ${worst.difficulty}/${worst.seed} ` +
          `at ${worst.stalledDays ?? 0} days against ${deliveryBar(worst.stallRing ?? -1)}, ` +
          `mean wait ${mean.toFixed(1)}`,
      };
    },
  },
  {
    id: 'one-robbery-does-not-end-the-tier',
    claim:
      'A colony that reaches the top of the free tree and walks for the parts finishes at least ' +
      'one project that costs them. A robbery on the road is a setback the colony absorbs; it is ' +
      'not allowed to be the end of the tier.',
    enforced: false,
    check: (s) => {
      // Open on purpose and written before the thing that would satisfy it, the
      // same way `the-tree-is-not-empty-at-day-sixty` was written a tier early.
      // The grid it is written against reads six of nine — calm/1312, settler/1312
      // and harsh/7 all stopped dead on the fifteenth project, the last one the
      // tree gives away. Two of those three were instrumented: calm/1312 chose the
      // foundry on day forty, had a party on the road by day forty-two, was robbed
      // on the forty-seventh, limped home on the fifty-second, set out again on
      // the fifty-third and was robbed again on the fifty-eighth. settler/1312 was
      // robbed on day fifty-one and ran out of calendar on the second attempt.
      // Neither hesitated. Both did what `the-bench-does-not-wait-on-an-errand`
      // asks and neither got the parts.
      //
      // That is why the two principles are separate checks over the same runs.
      // One asks whether the colony decided; this one asks whether deciding was
      // enough. Splitting them is what makes either number mean anything — a
      // single column that fails on both cannot say which fix to write, and the
      // first one written against it sent the work after the wrong bug.
      //
      // The answer this is waiting for is a road that survives a bad day: a second
      // party, so the tier is not bought one twelve-day round trip at a time. Not
      // a shorter road and not a standing order — `components` exists to be the
      // first material whose supply is a road, and both of those undo it.
      //
      // A caution for whoever reads the number after that lands: the third of the
      // three, harsh/7, does not belong in it. Instrumented, it reached the tier
      // on day fifty-eight of sixty and every one of its seven trips all game was
      // to the near ring — it never opened a road to a parts town at all. It
      // reads nought waiting days because it never once stood at a finished bench
      // wanting parts, which is not this claim's failure; it is a colony arriving
      // as the clock runs out, and hard country is where that is supposed to be
      // possible. The denominator wants scoping to runs that had a bill and a
      // road to answer it with.
      //
      // Left uncorrected here on purpose. Re-deriving the denominator and the bar
      // in the same commit as the feature they grade would leave nothing to
      // compare: the before and the after have to be read off the same rule, and
      // this rule is the "before". Scope it when the second party lands, and
      // report both numbers on the honest denominator.
      //
      // The second-party fix also buys something narrower than it looks, and the
      // comment should not overstate it. `stepCaravan` seeds its roll on
      // `(seed, settlement, visits)`, so a town's luck is a pre-drawn deck indexed
      // by visit — two parties to the same town draw the same two cards a lone
      // party would have drawn on consecutive trips. What a second party buys is
      // draws per day, not a second chance at one draw. calm/1312 burned two bad
      // cards over twenty days; two parties would have burned the same two by day
      // fifty-two and been on the third and fourth by sixty-three.
      if (s.days < DAY_SIXTY) {
        return { verdict: 'untested', detail: `${s.days}-day grid cannot see day ${DAY_SIXTY}` };
      }
      const full = s.runs.filter((m) => m.daysLived >= s.days);
      // Only the colonies that got far enough to be asked. A run that never
      // reached the third tier has not failed to cross it — it never arrived, and
      // why it did not is `the-escalation-ladder`'s question, not this one.
      //
      // "Far enough to be asked" is two conditions and the second one is the
      // deferred scoping fix, taken now because this slice moves the tier's goods
      // and a denominator this loose would carry the old fault into the new
      // reading. Reaching the tier is not being asked for anything: harsh/7 got
      // there on day fifty-eight and stood at **nought** waiting days, because it
      // never once had a finished bench wanting parts. Counting it as a colony
      // that failed to cross the tier is counting a colony that ran out of
      // calendar, which is a pacing fact and belongs to a different principle.
      //
      // So: it either stood short of goods at some point, or it got through. The
      // second clause is not slack — dropping it would quietly delete the
      // colonies that bought their parts before the points ran out, which are
      // successes, and a denominator that excludes successes is worse than a
      // loose one. The fix was held back for two grids on purpose so that the
      // before and the after could be read off one rule; both readings are now in
      // `ACCEPTANCE.md` and the rule can move.
      const reached = full.filter(
        (m) => (m.tech ?? 0) >= THIRD_TIER && ((m.stalledDays ?? 0) > 0 || (m.tech ?? 0) > THIRD_TIER),
      );
      if (reached.length === 0) {
        return {
          verdict: 'untested',
          detail: `no run of ${full.length} reached the third tier and was asked for goods`,
        };
      }
      const through = reached.filter((m) => (m.tech ?? 0) > THIRD_TIER);
      const share = through.length / reached.length;
      const stuck = reached.filter((m) => (m.tech ?? 0) <= THIRD_TIER);
      if (share < THE_TIER_CONVERTS) {
        return {
          verdict: 'broken',
          detail:
            `only ${through.length} of ${reached.length} runs that reached the third tier ` +
            `finished a project in it (${Math.round(share * 100)}%, wanted ` +
            `${Math.round(THE_TIER_CONVERTS * 100)}%); stopped dead on the last free project: ` +
            stuck
              .map((m) => `${m.difficulty}/${m.seed} after ${m.stalledDays ?? 0} waiting days`)
              .join(', '),
        };
      }
      return {
        verdict: 'holds',
        detail:
          `${through.length} of ${reached.length} runs that reached the third tier finished a ` +
          `project in it (${Math.round(share * 100)}%)`,
      };
    },
  },
  {
    id: 'the-surplus-finds-a-buyer',
    claim:
      'Steel is something the colony spends. A run that ends sitting on a pile has been handed ' +
      'a resource with no demand, and a pile that never once came down is the proof.',
    enforced: false,
    check: (s) => {
      // Still open, but for a smaller reason than its sibling was. The third tier
      // arrived and took seven of the ten piles down with it. What is left is
      // three maps — calm/1312 ending on 986 steel having never given back more
      // than 196 of it, calm/99001 on 1006 against 204, settler/1312 on 757
      // against 123 — roughly a fifth returned, against the quarter this asks
      // for. Near enough to read as a tier that costs a little too little rather
      // than one nobody reaches, which is what the earlier grid showed. It stays
      // open until stage 2's assemblies give the far ring something to sell;
      // enforcing it on the strength of seven out of ten would be scoring the
      // grid on the runs that agreed with it.
      if (s.days < DAY_SIXTY) {
        return { verdict: 'untested', detail: `${s.days}-day grid cannot see day ${DAY_SIXTY}` };
      }
      const full = s.runs.filter((m) => m.daysLived >= s.days);
      // Only the colonies that ended rich. Hard country reaches day sixty holding
      // nothing, and a colony with an empty store has not failed this promise —
      // it never had a surplus for anyone to buy. Scoping it by wealth rather
      // than by setting is what keeps the check honest when the settings move:
      // the question is about piles, not about difficulty.
      const piled = full.filter((m) => (m.endSteel ?? 0) >= A_PILE);
      if (piled.length === 0) {
        return {
          verdict: 'untested',
          detail: `no run of ${full.length} ended holding ${A_PILE} steel — nothing to find a buyer for`,
        };
      }
      // A quarter of the ending pile, because that is roughly what a material
      // gate has to cost to be a decision. Smaller than that and the colony pays
      // it out of change it was never going to spend, which is the situation this
      // principle exists to describe rather than a fix for it.
      const spent = (m: RunMeasure) => (m.steelDrawdown ?? 0) / Math.max(1, m.endSteel ?? 0);
      const ratchets = piled.filter((m) => spent(m) < SPENT_SHARE);
      if (ratchets.length > 0) {
        return {
          verdict: 'broken',
          detail:
            `${ratchets.length} of ${piled.length} runs that ended rich never spent the pile down: ` +
            ratchets
              .map(
                (m) =>
                  `${m.difficulty}/${m.seed} ended on ${m.endSteel} steel, biggest fall ${m.steelDrawdown}`,
              )
              .join(', '),
        };
      }
      const leanest = piled.reduce((a, m) => (spent(m) < spent(a) ? m : a));
      return {
        verdict: 'holds',
        detail:
          `all ${piled.length} runs that ended above ${A_PILE} steel spent at least ` +
          `${Math.round(SPENT_SHARE * 100)}% of the pile down at some point; ` +
          `thinnest was ${leanest.difficulty}/${leanest.seed} at ${Math.round(spent(leanest) * 100)}% ` +
          `of ${leanest.endSteel}`,
      };
    },
  },
  {
    id: 'the-three-roads-are-three-roads',
    claim:
      'Three roads, not one number printed three times. For every pair of them the grid holds a ' +
      'colony that is ahead on one and behind on the other.',
    // Stage 3's own principle, and — like the far country's — written before the
    // thing meant to satisfy it. What it guards against is the failure a ladder
    // is most likely to have and least likely to be caught having: three tallies
    // that all move with the same underlying thing, so that "science 3, economy
    // 3, warfare 3" is one fact wearing three hats and the player's choice of
    // road is a choice between synonyms.
    //
    // The test is inversion rather than correlation, on purpose. Two roads that
    // usually rise together are fine and probably true of any working colony —
    // a colony that is doing well is doing well at several things. What is not
    // fine is two roads that *never* disagree about which colony is ahead,
    // because that is the signature of one measurement counted twice. One
    // inversion each way is a low bar and it is meant to be: this is a floor
    // under "these are different things", not a claim about how different.
    //
    // Rungs rather than tallies, because the tallies are in different units —
    // projects, places, raiders — and any comparison between them would be
    // arithmetic on apples. The rung is the only comparable quantity the three
    // ladders produce, which is most of why `roads.ts` has rungs at all.
    //
    // Read off `sweep.war`, the family with a player at the wheel, and this is
    // the second promise to have moved there. Stage 4 rewired the warfare ladder
    // to count ground held, and ground is only taken on the far side of a
    // decision the unmanaged grid never makes: on `sweep.runs` every colony
    // reads warfare rung 1 — the standing band it put down at home — on all
    // fifteen. Two of the three pairs there were therefore comparing a moving
    // number against a constant, and the one inversion they found was science
    // dipping under that constant on one hard map. A pair cannot be shown to
    // disagree with a road nobody walks.
    //
    // What the played family cannot do is prove the *opposite*, and the reason
    // is the same one `the-war-is-a-choice` gives: one policy, fifteen colonies,
    // so every colony walks whichever road that policy favours and pairs may
    // lean for that reason alone. So a flat pair here is evidence and an
    // inverting pair here is only the absence of it. That asymmetry is the price
    // of having any reading at all, and it is cheap next to the alternative,
    // which is a reading of the instrument.
    enforced: false,
    check: (s) => {
      const full = (s.war ?? []).filter(
        (m) => m.daysLived >= s.days && (m.roadRungs?.length ?? 0) >= ROAD_IDS.length,
      );
      if (full.length < 2) {
        return {
          verdict: 'untested',
          detail: `${full.length} played runs finished the clock with a road reading — need two to compare`,
        };
      }
      const flat: string[] = [];
      const seen: string[] = [];
      for (let a = 0; a < ROAD_IDS.length; a++) {
        for (let b = a + 1; b < ROAD_IDS.length; b++) {
          const ahead = full.some((m) => (m.roadRungs?.[a] ?? 0) > (m.roadRungs?.[b] ?? 0));
          const behind = full.some((m) => (m.roadRungs?.[a] ?? 0) < (m.roadRungs?.[b] ?? 0));
          const pair = `${ROAD_IDS[a]}/${ROAD_IDS[b]}`;
          if (ahead && behind) seen.push(pair);
          // Which way a flat pair leans is the whole diagnosis, so it has to be
          // in the sentence: a pair that is always level is one measurement
          // counted twice, and a pair that leans is a road nothing is walking.
          else {
            const way = ahead
              ? `${ROAD_IDS[a]} only ever ahead`
              : behind
                ? `${ROAD_IDS[a]} only ever behind`
                : 'always level';
            flat.push(`${pair} never inverts (${way})`);
          }
        }
      }
      return flat.length === 0
        ? {
            verdict: 'holds',
            detail: `all ${seen.length} pairs disagree somewhere across ${full.length} runs: ${seen.join(', ')}`,
          }
        : {
            verdict: 'broken',
            detail:
              `${flat.length} of ${flat.length + seen.length} pairs never disagree across ` +
              `${full.length} runs: ${flat.join(', ')}`,
          };
    },
  },
  {
    id: 'no-road-is-already-finished',
    claim:
      'The end game is where the game goes, not where it has been. A colony that plays its whole ' +
      'clock has road left on all three — or walked through the door its top rung opened.',
    // The other half of stage 3, and the one that will fail first. A ladder is
    // only a ladder while somebody is still climbing it: the moment a sixty-day
    // colony stands on the top rung, that road has stopped being somewhere to go
    // and become a thing that already happened, and the game after the founding
    // is back to the problem the founding was built to solve.
    //
    // This is `the-tree-is-not-empty-at-day-sixty` generalised to all three
    // roads, and it is deliberately the stricter of the two: the tree principle
    // asks whether there is a project left to start, and this asks whether there
    // is a *rung* left, which a colony can run out of while the bench still has
    // work. It exists because stages 4 and 5 are going to extend these ladders,
    // and the failure mode of extending a ladder is discovering afterwards that
    // the old top was reachable all along.
    //
    // Stage 5a is why the claim now has a second half, and the second half is
    // not a softening. The original sentence was written when a top rung was a
    // dead end — nothing was behind it, so a colony standing there had nowhere
    // left to go and the promise was exactly right. Terminals put something
    // behind it. Two colonies then topped warfare, committed, and landed the
    // dominion, and the check called that a broken promise, which is the
    // instrument reading the letter of a sentence whose subject had changed
    // underneath it. What the promise was ever about is *somewhere to go*, and
    // a top rung with a door behind it is somewhere to go; a top rung with the
    // door still shut at the end of the clock is the failure it always was.
    // The check was left visibly broken for one stage rather than re-worded in
    // the same breath as the change that broke it, because a guard that has
    // stopped meaning what it says is easier to spot open and red than quietly
    // adjusted — and 5b is the stage that could tell the two cases apart,
    // because until an ending had a verdict there was nothing to read.
    //
    // It should hold on the grid that ships it, and that is not a reason to
    // skip it. A guard that has never been read is a guard nobody knows the
    // shape of, and this one has a shape worth knowing: the science road's top
    // rung is the whole research tree, which one colony on the grid before this
    // one finished. It would have failed a grid ago.
    //
    // `sweep.war` for the reason the principle above it gives at length: a road
    // nobody walks cannot be found already finished, and warfare is a road the
    // unmanaged grid cannot walk at all. Asking whether a colony has road left
    // is a question about a colony that went somewhere.
    enforced: false,
    check: (s) => {
      if (s.days < DAY_SIXTY) {
        return {
          verdict: 'untested',
          detail: `${s.days}-day grid cannot see day ${DAY_SIXTY}`,
        };
      }
      const full = (s.war ?? []).filter(
        (m) => m.daysLived >= s.days && (m.roadRungs?.length ?? 0) >= ROAD_IDS.length,
      );
      if (full.length === 0) {
        return {
          verdict: 'untested',
          detail: 'no played run finished the clock with a road reading',
        };
      }
      const topped: string[] = [];
      for (const m of full) {
        for (let i = 0; i < ROAD_IDS.length; i++) {
          if ((m.roadRungs?.[i] ?? 0) < ROAD_RUNGS) continue;
          // The ladders and the terminals are the same three in the same order
          // — `endings.ts` derives each gate from the road it belongs to — so
          // the rung's index is the ending's index, and that is checked once by
          // a test rather than trusted three times here.
          const out = m.endingId === ENDING_IDS[i] && m.endingLandedOn !== null;
          if (!out) topped.push(`${m.difficulty}/${m.seed} finished ${ROAD_IDS[i]}`);
        }
      }
      // The furthest anybody got, reported either way. On a holding grid it is
      // the only number here that says anything — "nobody finished a road" is
      // true of a grid where nobody started one, and this is what tells them
      // apart.
      const deepest = Math.max(...full.map((m) => Math.max(...(m.roadRungs ?? [0]))));
      return topped.length === 0
        ? {
            verdict: 'holds',
            detail:
              `no run of ${full.length} ended the clock on a top rung it had not walked off; ` +
              `furthest anybody got was rung ${deepest} of ${ROAD_RUNGS}`,
          }
        : {
            verdict: 'broken',
            detail:
              `${topped.length} road${topped.length === 1 ? '' : 's'} finished by day ${s.days} ` +
              `with the ending still shut: ${topped.join(', ')}`,
          };
    },
  },
  {
    id: 'every-ending-is-reachable',
    claim:
      'All three roads go somewhere. Each of the three endings is reached by somebody on the grid, ' +
      'inside the clock the grid runs.',
    // Stage 5's first promise, and it is written *knowing it fails*. That is the
    // point of it rather than an embarrassment about it.
    //
    // `ENDGAME.md` names the one thing stage 5 could not settle on its own: the
    // played sixty-day grid reaches warfare rung 4 twice, science rung 3 at
    // best, and economy rung 1 — so read against gates that are the top rung of
    // each road, exactly one of the three endings is reachable inside sixty
    // days, and two are not. Either the grid's clock grows, or two roads have
    // top rungs the game as it stands cannot deliver. Both answers are
    // defensible and they cost different things, so neither is taken in
    // passing.
    //
    // What this principle does is stop the question being a paragraph nobody
    // re-reads. Every grid from here on prints how many of the three anybody
    // reached and how close the other two came, so the day the answer changes —
    // because the clock grew, or because something upstream made a road faster
    // — the instrument says so without anybody remembering to look.
    //
    // `sweep.war` for the reason the two road promises above it give at length:
    // an ending is the far end of a road, and the unmanaged family does not walk
    // roads. Asking whether an ending was reached on a grid where nobody left
    // the valley is asking a question about the harness.
    enforced: false,
    check: (s) => {
      if (s.days < DAY_SIXTY) {
        return { verdict: 'untested', detail: `${s.days}-day grid cannot see day ${DAY_SIXTY}` };
      }
      const full = (s.war ?? []).filter((m) => m.daysLived >= s.days);
      if (full.length === 0) {
        return { verdict: 'untested', detail: 'no played run finished the clock' };
      }
      const landed = ENDING_IDS.filter((id) =>
        full.some((m) => m.endingId === id && m.endingLandedOn !== null),
      );
      // How close the ones nobody reached came, in the unit that would have to
      // move for them to be reached: the rung of their own road. "Nobody built
      // the ship" is true of a grid that finished the tree and ran out of days
      // and of one that never opened a foundry, and this is what tells them
      // apart.
      const missed = ENDING_IDS.map((id, i) => {
        const best = Math.max(0, ...full.map((m) => m.roadRungs?.[i] ?? 0));
        return `${id} (best rung ${best} of ${ROAD_RUNGS})`;
      }).filter((_, i) => !landed.includes(ENDING_IDS[i]!));
      return landed.length === ENDING_IDS.length
        ? {
            verdict: 'holds',
            detail: `all ${ENDING_IDS.length} endings reached across ${full.length} played runs`,
          }
        : {
            verdict: 'broken',
            detail:
              `${landed.length} of ${ENDING_IDS.length} endings reached in ${s.days} days` +
              ` — unreached: ${missed.join(', ')}`,
          };
    },
  },
  {
    id: 'no-ending-is-free',
    claim:
      'An ending is a commitment, not a threshold. Every ending that landed was committed to first ' +
      'and then survived, and the colony had to still be a colony the whole way.',
    // The other half of stage 5, and the one that guards the mistake
    // `victory.ts` already made once and documented: a win that lands on the
    // tick a number ticks over. A rung is a number. If an ending ever fires the
    // moment a road tops out, the most dramatic moment in the run becomes a
    // tally incrementing, and the three roads become three progress bars with a
    // cutscene on the end.
    //
    // What it reads is the gap between the day a colony committed and the day
    // its ending landed. `ENDING_DAYS` is the floor, and it is a floor rather
    // than an equality on purpose: a terminal that took exactly its days is a
    // colony that never once fell out of the running, and a longer one paid for
    // the days it lost — a stalled hull, a holding taken back, a charter dropped
    // in the middle of it. Both are the mechanism working. Anything *shorter*
    // is the mechanism gone.
    //
    // Deliberately not enforced yet, for the plainest reason there is: nothing
    // on the grid has landed an ending, so this has never been read against a
    // real one. A guard promoted on the strength of never having been tested is
    // a guard that fails the first time it matters, and `every-ending-is-
    // reachable` above is the principle whose job it is to change that.
    enforced: false,
    check: (s) => {
      const landed = (s.war ?? []).filter(
        (m) => m.endingLandedOn !== null && m.endingCommittedOn !== null,
      );
      if (landed.length === 0) {
        return { verdict: 'untested', detail: 'no played run landed an ending' };
      }
      const quick = landed.filter(
        (m) => m.endingLandedOn! - m.endingCommittedOn! < ENDING_DAYS,
      );
      const slowest = Math.max(...landed.map((m) => m.endingLandedOn! - m.endingCommittedOn!));
      return quick.length === 0
        ? {
            verdict: 'holds',
            detail:
              `${landed.length} ending${landed.length === 1 ? '' : 's'} landed, none in under ` +
              `${ENDING_DAYS} days; the longest took ${slowest}`,
          }
        : {
            verdict: 'broken',
            detail:
              `${quick.length} of ${landed.length} landed in under ${ENDING_DAYS} days: ` +
              quick
                .map(
                  (m) =>
                    `${m.difficulty}/${m.seed} ${m.endingId} in ${m.endingLandedOn! - m.endingCommittedOn!}`,
                )
                .join(', '),
          };
    },
  },
  {
    id: 'an-ending-is-the-last-word',
    claim:
      'An ending is what happened to a colony, not something that happened to it. A run that ' +
      'landed one is reported as having landed it, on the day it landed.',
    // Stage 5b's promise, and it guards the mistake `judge` already documents
    // itself against for the founding: an outcome that is true of the whole run
    // being overwritten by whatever the last day happened to look like.
    //
    // The colony does not stop when its ending lands. That is deliberate — the
    // grid's unit is the clock, every other principle here filters on `daysLived
    // >= days`, and a harness that stopped the moment a terminal landed would
    // quietly delete those runs from every promise that asks about a colony that
    // went the distance. So a landed ending is followed by days that can look
    // like anything: the ship leaves with six of nine and the three who stayed
    // starve, and on the last day the snapshot is a colony out of food with
    // somebody buried. Read off that day the verdict is `holding`, or with the
    // valley emptied `collapsed`, and the run that reached the far end of a road
    // is filed beside the ones that never left the yard.
    //
    // Which is why the verdict is taken from the record rather than the last
    // snapshot, and why this reads both halves of that: the verdict says
    // `landed`, and the day on the record is the day it landed rather than the
    // day the grid stopped. The gap between them is printed pass or fail,
    // because it is the number that says whether the harness is still playing
    // past the ending — the day somebody makes it stop, that reads zero and this
    // detail line says so without anybody having to remember why it mattered.
    //
    // `sweep.war` for the reason the other ending promises give at length: the
    // unmanaged family does not walk roads, so it cannot reach a terminal, and a
    // principle about landed endings read against a grid with none in it is a
    // question about the harness.
    enforced: false,
    check: (s) => {
      const landed = (s.war ?? []).filter((m) => m.endingLandedOn !== null);
      if (landed.length === 0) {
        return { verdict: 'untested', detail: 'no played run landed an ending' };
      }
      const misfiled = landed.filter((m) => m.verdict !== 'landed');
      const impossible = landed.filter((m) => m.endingLandedOn! > m.daysLived);
      const after = landed.map((m) => m.daysLived - m.endingLandedOn!);
      const longest = Math.max(...after);
      const wrong = [...misfiled, ...impossible];
      return wrong.length === 0
        ? {
            verdict: 'holds',
            detail:
              `${landed.length} landed ending${landed.length === 1 ? '' : 's'}, all filed as ` +
              `landed; the colony played on for up to ${longest} day${longest === 1 ? '' : 's'} after`,
          }
        : {
            verdict: 'broken',
            detail:
              `${wrong.length} of ${landed.length} landed endings misreported: ` +
              [
                ...misfiled.map((m) => `${m.difficulty}/${m.seed} filed as ${m.verdict}`),
                ...impossible.map(
                  (m) =>
                    `${m.difficulty}/${m.seed} landed on day ${m.endingLandedOn} of a ${m.daysLived}-day run`,
                ),
              ].join(', '),
          };
    },
  },
  {
    id: 'no-holding-falls-for-free',
    claim:
      'Ground is bought with people. A holding cost a war party the whole walk out and back, and ' +
      'the colony worked short-handed for every day of it.',
    // Stage 4's first promise, written before `holdings.ts` existed.
    //
    // The failure it guards is the one every game with a map on it eventually
    // has: an army that is cheap to field and free to move, so taking ground
    // becomes the thing the player does because there is nothing else to click.
    // This colony's whole cost model is bodies — a caravan is expensive because
    // the traveller is *genuinely gone*, and `CAN_SPARE_ONE` is the standing
    // argument that four left behind is a colony that can still hold a wall — so
    // a war party is charged the same way and harder: `WAR_PARTY` settlers, off
    // the map, for the round trip to wherever the holding is.
    //
    // Counted in pawn-days rather than in campaigns, because campaigns are the
    // number a bug would keep right. A campaign that resolved on the tick it was
    // ordered, or one that lifted a single settler out and called them a war
    // party, each show one campaign and one holding; neither shows
    // `WAR_PARTY * roundTripDays(0)` pawn-days, which is the cheapest legal war
    // in the game — the smallest legal party, walking to the nearest ring, and
    // home again.
    //
    // A floor and not a window. A campaign that lost and walked home empty
    // spends the same days and takes no ground, so a colony that lost two wars
    // and won one reads three times the floor and is not in breach: the promise
    // is that ground is never *cheaper* than the walk, not that every war was
    // worth fighting. Whether it was is `the-war-is-a-choice`'s question.
    //
    // Read off `sweep.war` and not `sweep.runs`, like the other war promise and
    // for the reason set out on `Sweep.war`: the grid plays with nobody at the
    // wheel, and a campaign is the one errand nobody but a player ever orders.
    enforced: false,
    check: (s) => {
      const played = s.war ?? [];
      if (played.length === 0) {
        return { verdict: 'untested', detail: 'no colony was played by a Steward on this grid' };
      }
      const took = played.filter((m) => (m.holdingsTaken ?? 0) > 0);
      if (took.length === 0) {
        return { verdict: 'untested', detail: `no run of ${played.length} took a holding` };
      }
      const floor = WAR_PARTY * roundTripDays(0);
      const paid = took.map((m) => ({
        m,
        each: (m.warPawnDays ?? 0) / (m.holdingsTaken ?? 1),
      }));
      const cheap = paid.filter((p) => p.each < floor);
      const thinnest = paid.reduce((a, b) => (b.each < a.each ? b : a));
      return cheap.length === 0
        ? {
            verdict: 'holds',
            detail:
              `all ${took.length} runs that took ground paid at least ${floor.toFixed(1)} pawn-days ` +
              `a holding; thinnest ${thinnest.m.difficulty}/${thinnest.m.seed} at ${thinnest.each.toFixed(1)}`,
          }
        : {
            verdict: 'broken',
            detail:
              `${cheap.length} of ${took.length} runs took ground under the ${floor.toFixed(1)} pawn-day floor: ` +
              cheap.map((p) => `${p.m.difficulty}/${p.m.seed} at ${p.each.toFixed(1)}`).join(', '),
          };
    },
  },
  {
    id: 'the-war-is-a-choice',
    claim:
      'Warfare is a road a colony chooses to walk. Of the colonies with the hands to field a war ' +
      'party, some went out and some stayed home.',
    // Stage 4's other promise, and the one that decides whether the stage was
    // worth building. It fails in both directions and that is the point:
    //
    // - **Nobody goes.** The war party is priced out of the game, the holdings
    //   are scenery, and the warfare road is a ladder whose top three rungs
    //   nothing can reach. This is `the-far-country-is-walked`'s failure — a
    //   road built, opened, and never walked — and that one has been open for
    //   four grids, so it is not a hypothetical.
    // - **Everybody goes.** Worse, and quieter. A campaign that is simply the
    //   right move makes warfare mandatory, and a road every colony walks is not
    //   a road, it is the game. It would show up here long before a player felt
    //   it, and it is exactly what `the-three-roads-are-three-roads` needs to be
    //   false for the pairs to invert at all.
    //
    // The denominator is the colonies that *could*: `CAN_SPARE_ONE + WAR_PARTY`
    // is the headcount the sim demands before it will let a party out of the
    // gate, so a five-settler colony that never campaigned is not evidence of
    // anything and is left out rather than counted as a stay-at-home. Peak
    // rather than final headcount, because the choice was live on the day the
    // colony was biggest, whatever the raid a fortnight later did to it.
    // The colonies read here are `sweep.war` — the family with a player at the
    // wheel. On the unmanaged grid this question has no answer to give: nothing
    // in the sim ever orders a campaign, so every colony would read as having
    // stayed home and the promise would report `broken` for ever while the game
    // it describes was working. See `Sweep.war`.
    enforced: false,
    check: (s) => {
      const played = s.war ?? [];
      if (played.length === 0) {
        return { verdict: 'untested', detail: 'no colony was played by a Steward on this grid' };
      }
      const able = played.filter((m) => (m.peakHands ?? 0) >= CAN_SPARE_ONE + WAR_PARTY);
      if (able.length < 2) {
        return {
          verdict: 'untested',
          detail:
            `${able.length} of ${played.length} runs ever had ${CAN_SPARE_ONE + WAR_PARTY} hands; ` +
            'a choice needs two colonies that had one',
        };
      }
      const went = able.filter((m) => (m.campaigns ?? 0) > 0);
      const where = `${went.length} of ${able.length} colonies with ${CAN_SPARE_ONE + WAR_PARTY}+ hands sent a war party`;
      if (went.length === 0) {
        return { verdict: 'broken', detail: `${where} — the holdings are scenery` };
      }
      if (went.length === able.length) {
        return { verdict: 'broken', detail: `${where} — every one of them, so the war is not a choice` };
      }
      return {
        verdict: 'holds',
        detail:
          `${where}; ${went.map((m) => `${m.difficulty}/${m.seed}×${m.campaigns}`).join(', ')} went, ` +
          `${able
            .filter((m) => !(m.campaigns ?? 0))
            .map((m) => `${m.difficulty}/${m.seed}`)
            .join(', ')} stayed home`,
      };
    },
  },
];
