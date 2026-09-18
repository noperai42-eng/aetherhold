/**
 * Hand-written types for `gpu.mjs`.
 *
 * `tsconfig.json` includes `tests` under `strict` with no `allowJs`, so
 * `tests/look-gpu.test.ts` importing a `.mjs` file is TS7016 — an untyped import —
 * and `npm run typecheck` goes red without this file. It is written by hand rather
 * than generated because `scripts/` is not in the build: there is no emit step here
 * to produce it, and a declaration that drifts from the module beside it would be
 * caught by the tests that import both.
 */

/** Below this many clean samples the spread is noise, so no number is reported. */
export declare const MIN_VALID_SAMPLES: number;

/** At or under this, the clock did not actually move. */
export declare const ZERO_MS: number;

/**
 * How the page measured, or that it could not. There is one method: the timer query
 * this box lists was measured to overstate by about five times and is not used — see
 * the header of `gpu.mjs`.
 */
export type GpuMethod = 'finish' | 'n/a';

/** What the page collected, before reduction. */
export interface RawGpu {
  method: GpuMethod;
  samples: number[];
  /** Candidate frames thrown away before becoming samples (the app drew nothing). */
  spoiled?: number;
}

/**
 * The verdict. `median` and `max` are `null` exactly when `method` is `'n/a'` — never
 * `0`, which a caller could print as a measurement.
 */
export interface ReducedGpu {
  method: GpuMethod;
  median: number | null;
  max: number | null;
  valid: number;
  spoiled: number;
  /** Why there is no number, when there is no number. */
  reason: string | null;
}

export declare function reduceGpu(raw: RawGpu | null | undefined): ReducedGpu;

export declare function formatGpu(reduced: ReducedGpu | null | undefined): string;
