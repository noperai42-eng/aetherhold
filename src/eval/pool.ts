/**
 * The grid, played on every core at once.
 *
 * The balance grid takes about thirty-six minutes for fifteen thirty-day
 * colonies, and the end game needs sixty-day ones — which is ninety minutes
 * before a single new column exists, on a loop that only earns its keep if
 * somebody is willing to run it. So the colonies get spread across workers.
 *
 * This is the *only* kind of speed-up this harness is allowed to take. Every
 * number the grid prints is denominated in the sim being byte-for-byte the game
 * as it was written, so making the sim cheaper — skipping a system in eval mode,
 * coarsening a tick — would make the grid faster by making it measure a
 * different game. Running the same colonies, unchanged, in eight processes at
 * once changes nothing about any one of them. `tests/eval-pool.test.ts` holds
 * that line: parallel results must equal serial results exactly, not closely.
 *
 * Determinism survives for a reason worth writing down. `runColony` is pure in
 * `(seed, days, difficulty, steward)` — it builds its own world and its own rng
 * streams and shares nothing — so colonies never needed to be sequential; they
 * were only sequential because a loop is the simplest way to write them. The one
 * piece of shared state in the whole harness is the `DIFFICULTIES` table the
 * controlled arm writes into, and a worker has its own module registry, so each
 * one gets its own copy. `runSpec` still restores the dial per run, because
 * workers are reused and a leak inside one would be invisible from here.
 */

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import type { RunSpec, SpecResult } from './sweep';

export interface PoolOptions {
  /** The bundled worker entry. A path rather than a constant because only the
   *  build knows where it put it — see `measure.ts`. */
  workerPath: string | URL;
  /** Defaults to two cores short of the box, so the machine stays usable. */
  workers?: number;
  /** Called as each colony lands, in completion order, so a long grid is not silent. */
  onResult?: (result: SpecResult, done: number, total: number) => void;
}

/**
 * How many workers, given how many colonies there are to play.
 *
 * Two short of the box because a balance grid runs on a machine somebody is
 * using, and never more workers than specs because a worker with nothing to play
 * costs a module graph and returns nothing.
 */
export function workerCount(specs: number, requested?: number): number {
  const cores = Math.max(1, availableParallelism() - 2);
  return Math.max(1, Math.min(specs, requested ?? cores));
}

/**
 * Play every spec, and return the results in the order the specs were given.
 *
 * Completion order is whatever the box decides — a calm twelve-day arm colony
 * finishes long before a harsh sixty-day one — so results are placed by index
 * rather than pushed. A grid whose rows reordered themselves depending on how
 * busy the machine was would be a grid nobody could diff against yesterday's.
 */
export function runSpecsParallel(specs: RunSpec[], opts: PoolOptions): Promise<SpecResult[]> {
  if (specs.length === 0) return Promise.resolve([]);

  return new Promise<SpecResult[]>((resolve, reject) => {
    const results: (SpecResult | undefined)[] = new Array(specs.length);
    const count = workerCount(specs.length, opts.workers);
    const workers: Worker[] = [];
    let next = 0;
    let done = 0;
    let failed = false;

    const stop = () => {
      for (const w of workers) void w.terminate();
    };

    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      stop();
      reject(err);
    };

    const feed = (w: Worker) => {
      if (failed) return;
      if (next >= specs.length) {
        // Nothing left for this one. Terminating here rather than at the end
        // means the last few long colonies get the whole box to themselves.
        void w.terminate();
        return;
      }
      const index = next++;
      w.postMessage({ index, spec: specs[index] });
    };

    for (let i = 0; i < count; i++) {
      const w = new Worker(opts.workerPath);
      workers.push(w);

      w.on('message', (msg: { index: number; measure?: SpecResult['measure']; error?: string }) => {
        if (failed) return;
        if (msg.error || !msg.measure) {
          // A colony that failed to play is not a colony that scored zero. Kill
          // the whole grid loudly rather than judging a set of promises against
          // a set of runs that is quietly one short.
          fail(new Error(`spec ${msg.index} failed in a worker: ${msg.error ?? 'no measure'}`));
          return;
        }
        results[msg.index] = { spec: specs[msg.index]!, measure: msg.measure };
        done++;
        opts.onResult?.(results[msg.index]!, done, specs.length);
        if (done === specs.length) {
          stop();
          resolve(results as SpecResult[]);
          return;
        }
        feed(w);
      });

      w.on('error', (err) => fail(err));

      w.on('exit', (code) => {
        // Exit code 1 is a worker we terminated on purpose once the queue ran
        // dry; anything else while runs are outstanding is a crash, and a crash
        // that only showed up as a missing row would be the worst possible way
        // to find out.
        if (!failed && done < specs.length && code !== 0 && code !== 1) {
          fail(new Error(`a grid worker exited with code ${code} after ${done}/${specs.length}`));
        }
      });

      feed(w);
    }
  });
}
