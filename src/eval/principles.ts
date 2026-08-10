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
      'A settler at zero on food while the colony is holding weeks of meals is a feeding or a ' +
      'hauling failure. It is not the hard setting being hard, and it happens on the kind one.',
    // Found by the first thirty-day grid, not designed in: seed 424242 on calm
    // put a settler at 0.00 with 24.5 days of food in store and nobody hurt, and
    // seed 99001 on calm reached 0.01 with 30.2 days in store and not one trip
    // to a sick bed all run. Open rather than enforced because it is a report of
    // something nobody has diagnosed yet — a downed settler nobody carried a
    // meal to, a recruit who joined starving, and a hauling reservation are all
    // live explanations, and the last balance diagnosis made on a plausible
    // story rather than a measurement was wrong. This prints the runs; it does
    // not claim the cause.
    enforced: false,
    check: (s) => {
      // The 0.02 the run verdict already calls starvation, and five days of food
      // as "the colony is not short" — a colony genuinely out of food is a
      // different and honest failure.
      const stranded = s.runs.filter((m) => m.worstFood <= 0.02 && m.endFoodDays >= 5);
      return stranded.length === 0
        ? { verdict: 'holds', detail: 'nobody starved next to a stocked larder' }
        : {
            verdict: 'broken',
            detail: `${stranded.length} of ${s.runs.length} runs — ${stranded
              .map(
                (m) =>
                  `${m.difficulty}/${m.seed} hit ${m.worstFood.toFixed(2)} on ${m.endFoodDays.toFixed(0)} days of food`,
              )
              .join(', ')}`,
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
];
