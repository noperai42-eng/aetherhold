/**
 * `npm run measure` — play the grid on every core and write down what happened.
 *
 * The half of the balance loop that costs money. It plays every colony the sweep
 * asks for, spread across workers, and leaves a `Sweep` on disk for
 * `npm run balance` to score in milliseconds. Nothing here judges anything: a
 * principle that fails is still a principle this script writes down and walks
 * away from, because a measuring instrument that suppressed inconvenient
 * readings would be worse than no instrument.
 *
 * Usage, all optional:
 *
 *   npm run measure -- --days 60 --seeds 20260729,1312 --difficulties calm,harsh
 *   npm run measure -- --workers 4 --steward
 *   npm run measure -- --days 60 --past-founding
 *
 * Defaults are the sweep's own — five seeds, three settings, thirty days — so
 * the bare command reproduces the grid the difficulty work was calibrated on.
 *
 * `--steward` is not the way to measure the war, and it is the flag most likely
 * to be reached for by somebody who has just read a war promise come back
 * `untested`. It hands the *whole* grid to the Steward, and twenty-four of the
 * twenty-six promises are calibrated against a colony nobody manages — they would
 * carry on printing verdicts against a baseline that had quietly moved. The two
 * war promises read `Sweep.war`, a second family this script already plays with a
 * Steward on every run, and the recorded command has never passed this flag.
 */

import {
  sweepSpecs,
  runSpec,
  assembleSweep,
  formatSweep,
  type SpecResult,
  type SweepOptions,
  type RunSpec,
} from './sweep';
import { DIFFICULTY_ORDER } from '../sim/difficulty';
import type { Difficulty } from '../sim/types';
import { runSpecsParallel } from './pool';
import { fingerprint, saveMeasurements } from './measurements';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  // A flag whose value is missing is a typo, and a typo that silently fell back
  // to the default would produce a grid labelled with days it never played.
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} needs a value`);
  }
  return value;
}

function numbers(name: string): number[] | undefined {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  return raw.split(',').map((s) => {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`--${name}: ${s} is not a number`);
    return n;
  });
}

function difficulties(): Difficulty[] | undefined {
  const raw = flag('difficulties');
  if (raw === undefined) return undefined;
  return raw.split(',').map((s) => {
    if (!(DIFFICULTY_ORDER as readonly string[]).includes(s)) {
      throw new Error(`--difficulties: ${s} is not one of ${DIFFICULTY_ORDER.join(', ')}`);
    }
    return s as Difficulty;
  });
}

const days = numbers('days')?.[0];
const workers = numbers('workers')?.[0];
const steward = process.argv.includes('--steward');

const opts: SweepOptions = {
  seeds: numbers('seeds'),
  difficulties: difficulties(),
  days,
  steward,
  playPastFounding: process.argv.includes('--past-founding'),
};

const label = (s: RunSpec) => {
  if (s.kind === 'grid') return `${s.difficulty} ${s.seed} ${s.days}d`;
  if (s.kind === 'war') return `war ${s.difficulty} ${s.seed} ${s.days}d`;
  return `arm upkeep=${s.dial} ${s.seed} ${s.days}d`;
};

const specs = sweepSpecs(opts);
const started = Date.now();

// Taken before a single colony is played, not after. The fingerprint is what the
// judge trusts to say these numbers describe this sim, and a grid runs long
// enough that editing the sim while it plays is the obvious thing to do with the
// wait — it nearly happened on the first run of this script. Stamped at the end,
// that edit would be recorded as the source the numbers came from, which is the
// exact lie the guard exists to prevent.
const before = fingerprint();

const progress = (r: SpecResult, done: number, total: number) => {
  const elapsed = (Date.now() - started) / 1000;
  // Completion order, not spec order — this is a progress line, not the grid.
  console.log(
    `  [${String(done).padStart(3)}/${total}] ${elapsed.toFixed(0)}s  ` +
      `${label(r.spec)} — ${r.measure.verdict}, ${r.measure.daysLived}d lived`,
  );
};

console.log(
  `measuring ${specs.length} colonies` +
    `${steward ? ', steward driving' : ''} — this is the slow half, and it only runs when you ask`,
);

// `--serial` plays them one at a time in this process. Not a second
// implementation of the grid — the same `runSpec` over the same spec list — but
// an escape hatch worth having: if a parallel grid and a serial one ever
// disagree, the argument is settled by running both, not by reading the pool.
const results = process.argv.includes('--serial')
  ? specs.map((spec, i) => {
      const r = runSpec(spec);
      progress(r, i + 1, specs.length);
      return r;
    })
  : await runSpecsParallel(specs, {
      workerPath: new URL('./worker.js', import.meta.url),
      workers,
      onResult: progress,
    });

const seconds = (Date.now() - started) / 1000;

// Refused rather than saved with a warning. Measurements that half-describe two
// versions of the sim are worse than no measurements, because they look exactly
// like measurements.
const after = fingerprint();
if (after !== before) {
  throw new Error(
    `the sim changed while the grid was being measured (${before} → ${after}) — ` +
      `nothing was written; run \`npm run measure\` again on a settled tree`,
  );
}

const sweep = assembleSweep(opts, results);
const path = saveMeasurements({
  fingerprint: before,
  taken: new Date().toISOString(),
  seconds,
  steward,
  sweep,
});

console.log(formatSweep(sweep));
console.log(`\n${specs.length} colonies in ${seconds.toFixed(0)}s → ${path}`);
console.log('now judge them: npm run balance');
