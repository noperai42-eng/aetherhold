/**
 * The balance grid, judged: every seed played on every difficulty, reduced to
 * the promises the setup card makes, and asserted.
 *
 * The colonies are not played here any more. `npm run measure` plays them on
 * every core and writes a `Sweep` to `.eval/measurements.json`; this file scores
 * that file, which takes milliseconds instead of half an hour. The split is what
 * makes a sixty-day grid affordable, and it buys exactly one new way to be
 * wrong — judging yesterday's numbers against today's sim — so the first thing
 * the gated block does is refuse to score measurements whose fingerprint no
 * longer matches the source.
 *
 * The judging half stays gated behind BALANCE=1 (`npm run balance`) because it
 * needs a measurement file a fresh checkout will not have. What is *not* gated
 * is the trio of checks below: that Settler is byte-for-byte the game as it was
 * written, and that no setting touches what the valley hands you on day one.
 * Those are what every measurement in the grid is denominated in — if they
 * drift, every number the grid prints is measuring something else, and they are
 * cheap enough that there is no excuse for finding out late.
 */

import { describe, expect, it } from 'vitest';
import { runColony } from '../src/eval/run';
import { formatSweep } from '../src/eval/sweep';
import { loadMeasurements, staleness } from '../src/eval/measurements';
import { formatPrinciples, judgePrinciples } from '../src/eval/principles';
import { DIFFICULTY_ORDER } from '../src/sim/difficulty';
import { countResource, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

declare const process: { env: Record<string, string | undefined> };

describe('the ground the balance grid stands on', () => {
  it('plays Settler exactly as the game was written, with difficulty asked for or not', () => {
    // Not a tautology about a default argument: `respite`, `band`, `bite` and
    // `grace` are read in four different places at four different times, and
    // this is the only check that all four multiply by one on Settler all the
    // way through a run. Every seed contract in the suite, and every number the
    // grid prints, is calibrated against this run being the old one.
    const asked = runColony({ seed: 20260729, days: 2, difficulty: 'settler' });
    const unasked = runColony({ seed: 20260729, days: 2 });
    expect(asked.snapshots).toEqual(unasked.snapshots);
    expect(asked.incidents.map((m) => m.text)).toEqual(unasked.incidents.map((m) => m.text));
  });

  it('hands every setting the same ground, whatever it stacks on it', () => {
    // A seed is a place. Difficulty is allowed to change what the last lot left
    // in the stockpile — that is the `larder` dial and the setup card says so —
    // but the ore, the woods, the water and the soil have to be identical on all
    // three, or two settings can never be compared on one valley and every
    // number the grid prints is confounded by a different map.
    //
    // Checked at genesis, before a single tick, because after one raid the three
    // colonies have spent different amounts and no comparison means anything.
    const valleys = DIFFICULTY_ORDER.map((d) => createWorld(20260729, d));
    const [calm, settler, harsh] = valleys;
    for (const other of [calm!, harsh!]) {
      expect(other.width).toBe(settler!.width);
      expect(other.height).toBe(settler!.height);
      expect(other.terrain).toEqual(settler!.terrain);
      expect(other.sites.map((s) => `${s.kind}@${s.x},${s.y}`)).toEqual(
        settler!.sites.map((s) => `${s.kind}@${s.x},${s.y}`),
      );
      // Same three people, too — `larder` is a dial on supplies, not on hands.
      expect(livingColonists(other).length).toBe(livingColonists(settler!).length);
      expect(livingColonists(other).map((p) => p.name)).toEqual(
        livingColonists(settler!).map((p) => p.name),
      );
    }
  });

  it('stacks the day-one stores in the order the setup card promises', () => {
    // The other half of the same charter: `larder` has to actually do something,
    // in the direction the card claims, on every resource rather than just on
    // food. A dial that reads well and moves nothing is the failure mode this
    // whole harness exists to catch.
    const stores = (d: (typeof DIFFICULTY_ORDER)[number]) => {
      const w = createWorld(20260729, d);
      return {
        rawfood: countResource(w, 'rawfood'),
        meals: countResource(w, 'meal'),
        wood: countResource(w, 'wood'),
        steel: countResource(w, 'steel'),
        medicine: countResource(w, 'medicine'),
      };
    };
    const calm = stores('calm');
    const settler = stores('settler');
    const harsh = stores('harsh');
    for (const k of Object.keys(settler) as (keyof typeof settler)[]) {
      expect(calm[k], `calm should start with more ${k}`).toBeGreaterThan(settler[k]);
      expect(harsh[k], `harsh should start with less ${k}`).toBeLessThan(settler[k]);
    }
    // Nobody lands without a bandage on any setting, however thin the store —
    // the first raid is a tutorial and it has to be able to teach what it costs.
    expect(harsh.medicine).toBeGreaterThan(0);
  });
});

// Gated because it needs `.eval/measurements.json`, which a fresh checkout does
// not have — see `npm run measure`, then `npm run balance`. The judging itself
// is milliseconds now that the colonies are played somewhere else.
describe.runIf(process.env.BALANCE)('the balance grid', () => {
  it('keeps every promise the setup card makes', () => {
    const m = loadMeasurements();
    // Thrown rather than skipped, and rather than reported as a broken
    // principle: measurements that are missing or older than the sim describe a
    // run that did not happen, and the one unacceptable outcome here is a
    // verdict about a game nobody played.
    const stale = staleness(m);
    if (stale || !m) throw new Error(`cannot judge the grid: ${stale}`);

    const { sweep } = m;

    // `DAYS=60 npm run balance` used to mean "play a sixty-day grid". It now
    // means "judge one", and asking for a length the measurements do not have
    // is a mismatch worth stopping on rather than a quiet judgement of whatever
    // happens to be on disk.
    if (process.env.DAYS && Number(process.env.DAYS) !== sweep.days) {
      throw new Error(
        `asked to judge ${process.env.DAYS} days but the measurements are ${sweep.days} — ` +
          `run \`npm run measure -- --days ${process.env.DAYS}\``,
      );
    }

    console.log(
      `judging ${sweep.runs.length} colonies measured ${m.taken} in ` +
        `${m.seconds.toFixed(0)}s${m.steward ? ', steward driving' : ''}\n`,
    );
    console.log(`${formatSweep(sweep)}`);

    const results = judgePrinciples(sweep);
    console.log(`\n${formatPrinciples(results)}\n`);

    // Asserted one at a time rather than as a count, so a failure names the
    // promise that broke and prints the number that broke it. `broken` rather
    // than `not holds`, because a short grid legitimately cannot reach some of
    // these and answers `untested` — which is not a pass, and is reported
    // below, but is also not the game being wrong.
    for (const r of results.filter((p) => p.enforced)) {
      expect(`${r.id}: ${r.verdict === 'broken' ? 'broken' : 'ok'} — ${r.detail}`).toBe(
        `${r.id}: ok — ${r.detail}`,
      );
    }

    // Everything the grid could not settle, in one place at the end: the open
    // design questions, and the promises this run was too short to reach.
    // Printed rather than swallowed, so nobody reads a green grid as a grid
    // that proved everything.
    const unsettled = results.filter((r) => r.verdict !== 'holds');
    if (unsettled.length > 0) {
      console.log(
        `unsettled after ${sweep.days} days:\n` +
          unsettled
            .map((r) => `  ${r.verdict.padEnd(8)} ${r.id}${r.enforced ? '' : ' (open)'} — ${r.detail}`)
            .join('\n') +
          '\n',
      );
    }
  });
});
