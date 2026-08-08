/**
 * The grid, written down — and the guard that says whether it is still true.
 *
 * Splitting the balance grid into a slow *measure* step and a fast *judge* step
 * is what makes a sixty-day grid affordable: the colonies get played once, on
 * every core, and then every principle is scored against the same JSON in
 * milliseconds. The whole arrangement has exactly one new way to be wrong, and
 * it is a bad one — judging yesterday's numbers against today's sim and printing
 * green.
 *
 * So the file carries a fingerprint of the source that decided those numbers.
 * The judge recomputes it and refuses to score a mismatch. A stale grid is not a
 * failing grid and must not read as one either: it is a run that did not happen,
 * and the only honest thing to print is "these measurements are older than the
 * game — measure again".
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Sweep } from './sweep';

/** Where `npm run measure` writes and `npm run balance` reads. Relative to the project root. */
export const MEASUREMENTS_PATH = '.eval/measurements.json';

/**
 * Eval files that move colonies around without changing what a colony does.
 *
 * Everything else under `src/sim` and `src/eval` is fingerprinted, including
 * files that do not exist yet — the list is what to *skip*, not what to include,
 * so a new system added to the sim invalidates old measurements by default
 * rather than by somebody remembering to add it here.
 */
const TRANSPORT = new Set(['measure.ts', 'pool.ts', 'worker.ts', 'measurements.ts', 'node.d.ts']);

export interface Measurements {
  /** Of the sim and eval sources that decide what a colony does. */
  fingerprint: string;
  /** For the human reading the file. Never compared against anything. */
  taken: string;
  /** Wall-clock seconds the grid took, so the cost of the loop stays visible. */
  seconds: number;
  /** Whether the colonies were played with the steward driving. */
  steward: boolean;
  sweep: Sweep;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.ts') && !TRANSPORT.has(entry.name)) out.push(path);
  }
}

/**
 * A 32-bit FNV-1a over every source file that decides what a colony does, paths
 * included and sorted so the answer does not depend on directory order.
 *
 * Thirty-two bits is a one-in-four-billion chance that a changed sim hashes to
 * an unchanged grid. That is the fail-quiet risk here, stated rather than
 * hidden, and it is small enough against the alternative of no guard at all.
 *
 * `root` defaults to the working directory because both callers — the `measure`
 * script and the `balance` test — are launched by npm from the project root.
 */
export function fingerprint(root: string = process.cwd()): string {
  const files: string[] = [];
  for (const dir of ['src/sim', 'src/eval']) {
    const full = join(root, dir);
    // Loud, because a fingerprint over nothing is a constant, and a constant
    // fingerprint would silently mark every stale grid as fresh forever.
    if (!existsSync(full)) throw new Error(`cannot fingerprint the sim: ${full} does not exist`);
    walk(full, files);
  }
  files.sort();

  let h = 0x811c9dc5;
  const eat = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const file of files) {
    eat(file.slice(root.length));
    eat(readFileSync(file, 'utf8'));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function saveMeasurements(m: Measurements, root: string = process.cwd()): string {
  const path = join(root, MEASUREMENTS_PATH);
  mkdirSync(join(root, '.eval'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
  return path;
}

/** Null when the grid has never been measured, which is a different problem from a stale one. */
export function loadMeasurements(root: string = process.cwd()): Measurements | null {
  const path = join(root, MEASUREMENTS_PATH);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Measurements;
}

/**
 * What the judge needs to know before it scores anything: either the
 * measurements are usable, or here is the sentence to print instead.
 *
 * Returns the reason as a string rather than throwing so the caller decides how
 * loud to be — but every caller should be loud. There is no reading of a stale
 * grid that is worth having.
 */
export function staleness(m: Measurements | null, root: string = process.cwd()): string | null {
  if (!m) return `no measurements at ${MEASUREMENTS_PATH} — run \`npm run measure\` first`;
  const now = fingerprint(root);
  if (m.fingerprint !== now) {
    return (
      `measurements were taken against a different sim (${m.fingerprint}, now ${now}) — ` +
      `run \`npm run measure\` again`
    );
  }
  return null;
}
