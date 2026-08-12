import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fingerprint, staleness, type Measurements } from '../src/eval/measurements';
import type { Sweep } from '../src/eval/sweep';

/**
 * The guard that decides whether yesterday's grid may be scored today.
 *
 * It had never been read, which for a guard is the same as not having one: the
 * whole arrangement rests on it, and the way it fails is by quietly saying yes.
 * The cases below are the two answers that matter and the one that is easy to
 * get wrong — a sim that moved must invalidate, and a *judge* that moved must
 * not, because scoring a `Sweep` in nine milliseconds is the entire reason the
 * grid was split into a slow half and a fast one.
 */

const dirs: string[] = [];

/** A throwaway project tree with the two fingerprinted directories in it. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'aetherhold-fp-'));
  dirs.push(root);
  mkdirSync(join(root, 'src/sim'), { recursive: true });
  mkdirSync(join(root, 'src/eval'), { recursive: true });
  for (const [path, body] of Object.entries(files)) writeFileSync(join(root, path), body);
  return root;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const BASE = {
  'src/sim/tick.ts': 'export const HUNGER = 1;\n',
  'src/eval/principles.ts': 'export const BAR = 0.5;\n',
  'src/eval/measure.ts': 'console.log("play");\n',
};

describe('the fingerprint that decides whether a grid is still true', () => {
  it('changes when the sim changes, because the numbers came out of it', () => {
    const before = fingerprint(tree(BASE));
    const after = fingerprint(tree({ ...BASE, 'src/sim/tick.ts': 'export const HUNGER = 2;\n' }));
    expect(after).not.toBe(before);
  });

  it('changes when a file is added to the sim, so a new system invalidates by default', () => {
    // The skip list is what to *skip*, not what to include. A system somebody
    // adds next year has to stale the old grid without anybody remembering this
    // file exists, and that only works while the walk is opt-out.
    const before = fingerprint(tree(BASE));
    const after = fingerprint(tree({ ...BASE, 'src/sim/holdings.ts': 'export const WAR = 3;\n' }));
    expect(after).not.toBe(before);
  });

  it('does not change when the judge changes, because a judge plays no colony', () => {
    // The one that costs half an hour when it is wrong. `principles.ts` reads
    // the numbers and never makes them: a `Sweep` measured yesterday is exactly
    // as true today whatever bar the checks now hold it to, and fingerprinting
    // the judge would mean moving one threshold cost a fresh thirty-six-minute
    // grid before you could see whether the move was right.
    const before = fingerprint(tree(BASE));
    const after = fingerprint(tree({ ...BASE, 'src/eval/principles.ts': 'export const BAR = 9;\n' }));
    expect(after).toBe(before);
  });

  it('does not change when the harness that moves colonies around changes', () => {
    const before = fingerprint(tree(BASE));
    const after = fingerprint(tree({ ...BASE, 'src/eval/measure.ts': 'console.log("go");\n' }));
    expect(after).toBe(before);
  });

  it('refuses to fingerprint a tree with no sim in it rather than hashing nothing', () => {
    // A fingerprint over an empty walk is a constant, and a constant fingerprint
    // marks every stale grid as fresh for ever. Loud is the only safe answer.
    const root = mkdtempSync(join(tmpdir(), 'aetherhold-fp-'));
    dirs.push(root);
    expect(() => fingerprint(root)).toThrow(/cannot fingerprint the sim/);
  });
});

const emptySweep: Sweep = {
  seeds: [],
  difficulties: [],
  days: 30,
  playPastFounding: false,
  runs: [],
  arm: [],
  war: [],
};

const measured = (fp: string): Measurements => ({
  fingerprint: fp,
  taken: '2026-08-11T00:00:00.000Z',
  seconds: 1,
  steward: false,
  sweep: emptySweep,
});

describe('what the judge is told before it scores anything', () => {
  it('says nothing at all when the grid was played against this sim', () => {
    const root = tree(BASE);
    expect(staleness(measured(fingerprint(root)), root)).toBeNull();
  });

  it('names both fingerprints and the command to run when the sim has moved on', () => {
    // A stale grid is not a failing grid: it is a run that did not happen, so
    // the sentence has to send the reader to `measure` rather than to a bar.
    const root = tree(BASE);
    const reason = staleness(measured('deadbeef'), root);
    expect(reason).toContain('deadbeef');
    expect(reason).toContain('npm run measure');
  });

  it('says there is no grid rather than pretending an absent one is stale', () => {
    expect(staleness(null, tree(BASE))).toContain('no measurements at');
  });
});
