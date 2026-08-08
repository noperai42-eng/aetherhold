/**
 * The grid played in parallel has to be the grid played in series — exactly.
 *
 * Every balance number this project has ever taken was measured by a loop that
 * played fifteen colonies one after another, and every principle is calibrated
 * against those numbers. Spreading the same colonies across workers is only
 * allowed to make them *faster*; if it makes any of them different, the entire
 * body of measurement is invalidated and nobody would necessarily notice,
 * because a colony that came out slightly different is still a plausible-looking
 * colony. So this file holds the line at identical rather than close.
 *
 * The cheap half runs with the suite: the spec list is the right list, the
 * shared difficulty table is put back after every arm run, and the arm keeps a
 * dial that measured zero. The expensive half — real workers, compared against a
 * real serial run — is gated behind POOL=1 (`npm run pool`) because it plays the
 * same colonies twice on purpose.
 */

import { describe, expect, it } from 'vitest';
import {
  sweepSpecs,
  runSpec,
  assembleSweep,
  SWEEP_SEEDS,
  ARM_SEEDS,
  ARM_DAYS,
  UPKEEP_DIALS,
  type RunMeasure,
  type RunSpec,
  type SpecResult,
} from '../src/eval/sweep';
import { runSpecsParallel, workerCount } from '../src/eval/pool';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/types';
import { existsSync } from 'node:fs';

declare const process: { env: Record<string, string | undefined> };

const WORKER = new URL('../.eval/build/worker.js', import.meta.url);

const isGrid = (s: RunSpec): s is Extract<RunSpec, { kind: 'grid' }> => s.kind === 'grid';
const isArm = (s: RunSpec): s is Extract<RunSpec, { kind: 'arm' }> => s.kind === 'arm';

describe('the spec list the parallel grid plays', () => {
  it('is the same grid the sweep has always asked for', () => {
    const specs = sweepSpecs({ days: 30 });
    const grid = specs.filter(isGrid);
    const arm = specs.filter(isArm);

    // One colony per (setting, seed), and the arm on top — the shape the serial
    // sweep produces by nesting two loops and then calling the arm separately.
    expect(grid.length).toBe(DIFFICULTY_ORDER.length * SWEEP_SEEDS.length);
    expect(arm.length).toBe(UPKEEP_DIALS.length * ARM_SEEDS.length);

    // The arm is *not* played at the grid's length. It is a controlled
    // experiment with its own shorter clock, and a spec list that quietly
    // promoted it to thirty days would turn a two-minute control into a
    // twenty-minute one every time somebody lengthened the grid.
    expect(new Set(grid.map((s) => s.days))).toEqual(new Set([30]));
    expect(new Set(arm.map((s) => s.days))).toEqual(new Set([ARM_DAYS]));

    // Every dial on the axis gets played, or the arm cannot show a slope.
    expect(new Set(arm.map((s) => s.dial))).toEqual(new Set(UPKEEP_DIALS));
  });

  it('carries a narrowed ask through instead of ignoring it', () => {
    const specs = sweepSpecs({ days: 60, seeds: [7], difficulties: ['harsh'] });
    const grid = specs.filter(isGrid);
    expect(grid).toEqual([{ kind: 'grid', seed: 7, days: 60, difficulty: 'harsh', steward: undefined }]);
  });
});

describe('the one piece of shared state in the harness', () => {
  it('puts the difficulty table back after an arm run', () => {
    // The arm works by writing a dial into the module-level `DIFFICULTIES`
    // table, which is the only mutable state a colony reads that a colony does
    // not own. In the serial sweep a leak would be contained to the arm; in a
    // worker, which is reused for spec after spec, a leaked dial silently
    // rewrites every colony that worker plays afterwards — including ordinary
    // grid runs that have nothing to do with the arm. That is a corruption that
    // looks exactly like a balance finding, so it is checked rather than
    // reasoned about.
    const before = DIFFICULTIES.settler.upkeep;
    const other = UPKEEP_DIALS.find((d) => d !== before);
    expect(other, 'the arm needs at least one dial that is not Settler own').toBeDefined();

    runSpec({ kind: 'arm', seed: SWEEP_SEEDS[0]!, days: 1, dial: other! });

    expect(DIFFICULTIES.settler.upkeep).toBe(before);
  });

  it('plays the same spec the same way twice', () => {
    // `runColony` is pure in (seed, days, difficulty, steward) — it builds its
    // own world and its own rng streams — which is the whole reason the
    // colonies can be moved off this thread at all. If that ever stops being
    // true the parallel grid stops being the serial grid, and this is the
    // cheapest place to find out.
    const spec: RunSpec = { kind: 'grid', seed: SWEEP_SEEDS[0]!, days: 1, difficulty: 'settler' };
    expect(runSpec(spec).measure).toEqual(runSpec(spec).measure);
  });
});

describe('assembling a grid from results that came back out of order', () => {
  const measureAt = (upkeepShare: number) => ({ upkeepShare }) as unknown as RunMeasure;

  it('keeps a dial whose colonies all measured zero', () => {
    // A dial that moves nothing is the exact failure this arm exists to catch.
    // Dropping its point for looking implausible would leave a two-point arm
    // that reads as healthy — the finding deleted by the code meant to report
    // it. A dial appears iff its colonies were played.
    const results: SpecResult[] = UPKEEP_DIALS.map((dial, i) => ({
      spec: { kind: 'arm', seed: 1, days: ARM_DAYS, dial },
      measure: measureAt(i === 1 ? 0 : 0.3),
    }));
    const sweep = assembleSweep({}, results);
    expect(sweep.arm.map((p) => p.dial)).toEqual(UPKEEP_DIALS);
    expect(sweep.arm[1]!.upkeepShare).toBe(0);
  });

  it('leaves a dial off only when nothing was played for it', () => {
    const results: SpecResult[] = [
      { spec: { kind: 'arm', seed: 1, days: ARM_DAYS, dial: UPKEEP_DIALS[0]! }, measure: measureAt(0.3) },
    ];
    expect(assembleSweep({}, results).arm.map((p) => p.dial)).toEqual([UPKEEP_DIALS[0]]);
  });
});

describe('how many workers a grid gets', () => {
  it('never starts more workers than there are colonies to play', () => {
    // A worker with nothing to play still costs a module graph and a thread,
    // and the arm alone is small enough for this to matter on a big box.
    expect(workerCount(3, 16)).toBe(3);
    expect(workerCount(1)).toBe(1);
  });

  it('honours an explicit ask, so a loaded box can be told to take less', () => {
    expect(workerCount(100, 2)).toBe(2);
    expect(workerCount(100, 0)).toBe(1);
  });
});

// Plays the same colonies twice — once across workers, once in this process —
// so it is gated. `npm run pool`.
describe.runIf(process.env.POOL)('the parallel grid against the serial one', () => {
  it(
    'returns the identical measures, in the order the specs were given',
    async () => {
      if (!existsSync(WORKER)) {
        throw new Error(`no worker bundle at ${WORKER} — run \`npm run build:eval\` first`);
      }

      // Deliberately mixed: two settings and an arm dial, so the comparison
      // covers both spec kinds and the workers get handed specs that mutate the
      // difficulty table in among ones that must not see it moved.
      const specs: RunSpec[] = [
        { kind: 'grid', seed: SWEEP_SEEDS[0]!, days: 2, difficulty: 'calm' },
        { kind: 'arm', seed: SWEEP_SEEDS[0]!, days: 2, dial: UPKEEP_DIALS[2]! },
        { kind: 'grid', seed: SWEEP_SEEDS[1]!, days: 2, difficulty: 'harsh' },
        { kind: 'grid', seed: SWEEP_SEEDS[0]!, days: 2, difficulty: 'settler' },
      ];

      const serial = specs.map((s) => runSpec(s).measure);
      // Two workers rather than four, so at least one of them is reused and a
      // dial left behind by the arm run would have somewhere to show up.
      const parallel = await runSpecsParallel(specs, { workerPath: WORKER, workers: 2 });

      expect(parallel.map((r) => r.spec)).toEqual(specs);
      expect(parallel.map((r) => r.measure)).toEqual(serial);
    },
    600_000,
  );

  it(
    'fails loudly when a colony cannot be played, rather than returning a short grid',
    async () => {
      // A grid that came back a row short would be judged as though that colony
      // had simply been peaceful — a missing measurement reading as a mild one.
      // So a spec the sim refuses has to bring the whole run down, both when the
      // worker catches it and when the worker never starts at all.
      await expect(
        runSpecsParallel(
          [{ kind: 'grid', seed: 1, days: 1, difficulty: 'no-such-setting' as Difficulty }],
          { workerPath: WORKER, workers: 1 },
        ),
      ).rejects.toThrow();

      await expect(
        runSpecsParallel([{ kind: 'grid', seed: 1, days: 1, difficulty: 'settler' }], {
          workerPath: new URL('../.eval/build/no-such-worker.js', import.meta.url),
          workers: 1,
        }),
      ).rejects.toThrow();
    },
    120_000,
  );
});
