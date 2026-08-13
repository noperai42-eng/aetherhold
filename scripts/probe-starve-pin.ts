/**
 * Find a run that still exercises all three starvation columns at once.
 *
 * `tests/colony-eval.test.ts` pins the columns to a named run so a new column
 * cannot quietly die wired to nothing. The run it named — harsh/424242, 20 days
 * — stopped working the moment `sendSomebodyToFeed` shipped: its floor spell
 * went to zero, which is the fix working and the pin failing for the right
 * reason. This walks the same short grid the test can afford and prints what
 * each candidate would assert, so the replacement is chosen off a reading
 * rather than a guess.
 *
 *   npx rolldown scripts/probe-starve-pin.ts --format esm --platform node -d .eval/build
 *   node .eval/build/probe-starve-pin.js [days]
 */

import { runColony } from '../src/eval/run';
import type { Difficulty } from '../src/sim/types';

const days = Number(process.argv[2] ?? 20);
const seeds = [7, 424242, 1312, 99001, 20260729];
const difficulties: Difficulty[] = ['harsh', 'settler'];

console.log(`starvation columns · ${days} days · past founding`);
console.log('difficulty  seed      feet   floor  stranded  verdict');
for (const difficulty of difficulties) {
  for (const seed of seeds) {
    const r = runColony({ seed, days, difficulty, playPastFounding: true });
    const last = r.snapshots[r.snapshots.length - 1]!;
    const cells = [
      difficulty.padEnd(12),
      String(seed).padEnd(10),
      last.starveHours.toFixed(1).padStart(5),
      last.floorStarveHours.toFixed(1).padStart(7),
      last.strandedStarveHours.toFixed(1).padStart(9),
      '  ' + r.verdict,
    ];
    console.log(cells.join(''));
  }
}
