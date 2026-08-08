/**
 * The census: does the game ever actually *do* these things?
 *
 * Every other test in this directory builds the state it wants and asserts the
 * rule that governs it. That is the right way to test a rule, and it has one
 * blind spot that nothing else here covers: a rule can be perfectly correct
 * about a state the colony never reaches.
 *
 * This is not hypothetical. `partners.ts` paired two settlers when their bond
 * crossed 80, and 29 tests said so, and every one of them set the bond itself.
 * When `social.ts` learned diminishing returns the highest bond an ordinary
 * colony could reach fell to about 74 — so the threshold became unreachable, the
 * partner system stopped existing in play along with widowing and mourning, and
 * the suite stayed entirely green. Nothing was broken. Everything was correct.
 * The feature was simply gone.
 *
 * So this file asserts the other half: run a real colony for three months and
 * count what happened. No mocks, no seeded state, no orders — the same
 * `stepWorld` the browser calls, from `createWorld` to day ninety. Then check
 * that each thing the game promises actually occurred at least once, and print
 * the day it first did.
 *
 * **Opt-in**, like the ecosystem run, because three colony-months is minutes of
 * wall clock and the default suite has to stay usable:
 *
 *     LIVE=1 npx vitest run tests/liveness.test.ts
 *
 * A signal that never fires is either a broken feature or a promise the game
 * should stop making. Both are worth a failing test; neither shows up anywhere
 * else.
 */

import { describe, expect, it } from 'vitest';

import { FRIEND, bonds } from '../src/sim/social';
import { createWorld } from '../src/sim/worldgen';
import { livingColonists } from '../src/sim/world';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { seasonOf } from '../src/sim/seasons';
import { hasWon } from '../src/sim/victory';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { World } from '../src/sim/types';

/** No `@types/node` in this project; the sweep and the eco run declare it the same way. */
declare const process: { env: Record<string, string | undefined> };

const DAYS = Number(process.env.LIVE_DAYS ?? 90);
const SEED = Number(process.env.LIVE_SEED ?? 20260729);

/**
 * One thing the game says it does.
 *
 * `by` is the whole editorial judgement in this file, and writing it down is most
 * of the value: it is the day this thing is *claimed* to happen by, which is a
 * claim the code makes everywhere and states nowhere. A signal with no `by` is
 * reported and never fails — those are the ones that need the colony to make a
 * particular choice or the storyteller to roll a particular way, and failing a
 * build because nobody happened to lose their temper this run would teach
 * everyone to ignore this file, which is worse than not having it.
 *
 * Deadlines are deliberately not uniform. Most of the early loop should be
 * running inside a fortnight; the slow social systems get most of the run,
 * because measurement says a pairing is a third-month event on an unlucky seed
 * and a deadline that contradicts the measurement is just a flaky test.
 */
interface Signal {
  name: string;
  /** Day this must have happened by, or absent for report-only. */
  by?: number;
  seen: (world: World) => boolean;
}

const SIGNALS: Signal[] = [
  // The colony as a going concern. If any of these are missing the run did not
  // happen at all, and every reading below it is meaningless. A week is generous
  // — all four are supposed to be true by the end of the first afternoon.
  { name: 'somebody is still alive', by: 1, seen: (w) => livingColonists(w).length > 0 },
  { name: 'food is gathered', by: 7, seen: (w) => (w.stats.rawGathered ?? 0) > 0 },
  { name: 'a meal is cooked', by: 7, seen: (w) => w.stats.mealsCooked > 0 },
  { name: 'something is built', by: 7, seen: (w) => w.stats.built > 0 },

  // The world pushing back. The storyteller's opening quiet is two and a half
  // days, so a fortnight with nothing in it means the threat clock has stopped.
  { name: 'a threat fires', by: 14, seen: (w) => w.storyteller.threatsFired > 0 },
  {
    name: 'somebody gets hurt',
    by: 21,
    seen: (w) => livingColonists(w).some((p) => (p.ailments?.length ?? 0) > 0 || p.hp < p.maxHp),
  },

  // The map opening up. Exploring starts on day one; walking to a scout site is
  // a decision the foreman has to make, so it gets longer.
  { name: 'the map gets explored', by: 3, seen: (w) => (w.stats.explored ?? 0) > explored0 },
  { name: 'a site is scouted', by: 45, seen: (w) => w.stats.sitesScouted > 0 },

  // The medium horizon: things a colony that is doing well should have behind it
  // before the first winter.
  { name: 'a milestone is earned', by: 14, seen: (w) => (w.objectives?.length ?? 0) > 0 },
  { name: 'a research project lands', by: 30, seen: (w) => w.research.done.length > 0 },
  { name: 'the seasons turn', by: 30, seen: (w) => seasonOf(w) !== seasonOf0 },

  // The slow social systems — the ones a three-day experience test structurally
  // cannot see, which is exactly why they are the ones that rot unnoticed.
  { name: 'two settlers become friends', by: 21, seen: (w) => topBond(w) >= FRIEND },
  {
    // The deadline is the whole run, and that is a measurement rather than a
    // preference: three ninety-day colonies put the first pairing at day 40-ish
    // on two seeds and just past day 90 on the third, whose settlers simply
    // spend less of the day near each other. Anything tighter would fail on the
    // unlucky seed and get muted, and a muted liveness signal is the exact
    // failure this file exists to prevent.
    name: 'a pair forms',
    by: DAYS,
    seen: (w) => Object.keys(w.partners ?? {}).length > 0,
  },

  // Reported, never failed — these need the colony to make a particular choice
  // or the storyteller to roll a particular way inside the run.
  //
  // The founding is here rather than above it because an unattended colony has
  // no player to send the caravans the ally charter wants, so a run that never
  // wins is a fair run. It is worth counting anyway: this census is the only
  // place that would notice the exam becoming unreachable, and it is the census
  // that would have caught a founding *stopping* the colony — the day it lands
  // is printed, and every signal below it goes on being reachable afterwards.
  { name: 'the colony is founded', seen: (w) => hasWon(w) },
  // Report-only for a different reason from the rest of this block: nothing the
  // colony chooses decides it, but the valley has to have been *cut* before it
  // can grow back, and a colony that never gets short of wood never cuts enough
  // to open a gap. The day it first happens is the reading worth having — it
  // going quiet is how you would find out the ceiling had been left below the
  // density the generator draws at.
  { name: 'the forest grows back', seen: (w) => (w.stats.grown ?? 0) > 0 },
  { name: 'a trade is struck', seen: (w) => (w.stats.trades ?? 0) > 0 },
  { name: 'a caravan comes home', seen: (w) => (w.stats.caravans ?? 0) > 0 },
  { name: 'a commission is answered', seen: (w) => (w.stats.commissions ?? 0) > 0 },
  { name: 'raiders are killed', seen: (w) => w.stats.raidersKilled > 0 },
  { name: 'a prisoner is taken', seen: (w) => (w.stats.captured ?? 0) > 0 },
  { name: 'somebody breaks', seen: (w) => (w.stats.moraleBreaks ?? 0) > 0 },
  { name: 'an animal is born', seen: (w) => w.pawns.some((p) => p.animal && (p.born ?? 0) > 0) },
];

let seasonOf0: string;
let explored0: number;

function topBond(world: World): number {
  let best = 0;
  for (const v of Object.values(bonds(world))) if (v > best) best = v;
  return best;
}

describe.runIf(process.env.LIVE)(`${DAYS} days, unattended, counted`, () => {
  // First day each signal was ever true, or -1. Read once at the end of each
  // day: a signal that flickers on and off still counts, because the question
  // this file asks is "did it ever happen", not "is it happening now".
  const firstDay = new Map<string, number>();

  it(
    'runs three colony-months without falling over',
    () => {
      const world = createWorld(SEED);
      const streams = makeStreams(world);
      seasonOf0 = seasonOf(world);
      explored0 = world.stats.explored ?? 0;

      for (let day = 0; day < DAYS; day++) {
        for (let t = 0; t < TICKS_PER_DAY; t++) stepWorld(world, streams);
        for (const sig of SIGNALS) {
          if (!firstDay.has(sig.name) && sig.seen(world)) firstDay.set(sig.name, day + 1);
        }
      }

      const rows = SIGNALS.map((s) => {
        const day = firstDay.get(s.name);
        const when = day === undefined ? (s.by === undefined ? 'never' : 'NEVER') : `day ${day}`;
        // The deadline is printed beside the reading, because a run that lands
        // on day 44 of a 45-day promise is the interesting one and it looks
        // identical to a comfortable pass without the number next to it.
        const bound = s.by === undefined ? '' : `  (by ${s.by})`;
        return `  ${when.padEnd(9)} ${s.name}${bound}`;
      });
      // Printed unconditionally. The census is the deliverable — a green tick
      // that hides which day the first pair formed is most of the value thrown
      // away, and the day numbers are how you notice a feature drifting from
      // "rare" to "the week before it stopped happening at all".
      console.log(`\nliveness census, seed ${SEED}, ${DAYS} days:\n${rows.join('\n')}\n`);

      expect(livingColonists(world).length).toBeGreaterThan(0);
    },
    60 * 60 * 1000,
  );

  it('does everything it promises at least once', () => {
    const missing = SIGNALS.filter((s) => s.by !== undefined && !firstDay.has(s.name)).map((s) => s.name);
    // Named in the failure, not counted: `expected 3 to be 0` sends the reader
    // back into the file, and the whole point of this test is that the thing it
    // catches is invisible from inside the code.
    expect(missing, `never happened in ${DAYS} days: ${missing.join(', ')}`).toEqual([]);
  });

  it('does each of them by the day it is supposed to', () => {
    // A feature that only fires on day 88 of 90 is one balance change away from
    // not firing at all, and the suite would go on passing right up until it
    // stopped. This is the early warning the partner bug did not have: 80 was
    // reachable on day 12 before the social falloff landed and unreachable
    // after it, and nothing anywhere would have reported the days in between.
    const late = SIGNALS.filter((s) => {
      const day = firstDay.get(s.name);
      return s.by !== undefined && day !== undefined && day > s.by;
    }).map((s) => `${s.name}: day ${firstDay.get(s.name)}, promised by ${s.by}`);
    expect(late, `slower than promised — ${late.join('; ')}`).toEqual([]);
  });
});
