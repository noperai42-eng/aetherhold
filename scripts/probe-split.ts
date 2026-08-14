/**
 * Two sim changes landed in one grid. Which one moved the numbers?
 *
 * The sixty-day grid that judged them carried both `walkTo` re-pathing a route
 * cut by new geometry and raiders taking a fence apart, and it came back worse
 * on the aggregate the starvation principles are drawn from: across fifteen
 * unmanaged runs, survivors 141 → 110, buried 28 → 40, the unfed column 14.2 h →
 * 43.9 h. Blaming either change from that is a guess. calm/7 alone says why it
 * has to be: it lost five survivors with every starvation column still reading
 * zero, which is nobody starving and somebody dying — a combat outcome wearing a
 * feeding grid's clothes.
 *
 * So run the same colony under each change on its own. One seed at a time,
 * because the answer wanted is a difference between two runs of the *same* seed
 * and nothing else, and sixty days of one colony is two minutes rather than an
 * hour and a half.
 *
 * Meant to be run from a worktree with one of the two commits reverted, which is
 * why it takes no flags for them: the tree it is built in *is* the variant.
 *
 * Not under `src/sim` or `src/eval`, so it does not move the fingerprint.
 *
 *   npx rolldown scripts/probe-split.ts --format esm --platform node -d .eval/build
 *   node .eval/build/probe-split.js <label> [difficulty/seed ...]
 */

import { runColony } from '../src/eval/run';
import type { Difficulty } from '../src/sim/types';

const label = process.argv[2] ?? 'tree';
const pairs = process.argv.length > 3 ? process.argv.slice(3) : ['settler/1312', 'calm/7', 'harsh/7'];

console.log('label            run                feet   floor  strand   unfed  downs  buried  alive  verdict');
for (const pair of pairs) {
  const [difficulty, seed] = pair.split('/') as [Difficulty, string];
  // `steward: false` is the arm the grid measures and the arm every starvation
  // principle is drawn from. `runColony` opens `opts.steward ?? true`, so leaving
  // it off silently plays a managed colony and reads a different sixty days.
  const r = runColony({
    seed: Number(seed),
    days: 60,
    difficulty,
    playPastFounding: true,
    steward: false,
  });
  // The four columns are per-day snapshot fields, not report fields, and every
  // one of them is a running maximum — so the last snapshot is the whole run.
  // That is exactly how `sweep.ts` builds a `RunMeasure`, and reading them the
  // same way is the only reason these numbers can be set beside the grid's.
  const last = r.snapshots.at(-1);
  const n = (v: number | undefined, w = 7) => (v ?? 0).toFixed(1).padStart(w);
  console.log(
    label.padEnd(16) +
      pair.padEnd(16) +
      n(last?.starveHours) +
      n(last?.floorStarveHours) +
      n(last?.strandedStarveHours) +
      n(last?.unfedStarveHours) +
      String(last?.downs ?? 0).padStart(7) +
      String(last?.lost ?? 0).padStart(8) +
      String(last?.alive ?? 0).padStart(7) +
      '  ' +
      r.verdict,
  );
}
