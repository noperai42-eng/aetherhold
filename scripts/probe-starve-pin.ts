/**
 * Find a run that still exercises all four starvation columns at once.
 *
 * `tests/colony-eval.test.ts` pins the columns to a named run so a new column
 * cannot quietly die wired to nothing. The run it named — harsh/424242, 20 days
 * — stopped working the moment `sendSomebodyToFeed` shipped: its floor spell
 * went to zero, which is the fix working and the pin failing for the right
 * reason. This walks the same short grid the test can afford and prints what
 * each candidate would assert, so the replacement is chosen off a reading
 * rather than a guess.
 *
 * It ran again the round `unfedStarveHours` split the stranded column in two, and
 * for the same reason: `RESCUER_KEEPS` moved the bar a would-be rescuer has to
 * clear, the pinned run's floor time collapsed, and the pin has to be re-chosen
 * off a reading. The `fits` column is the test's own conjunction, so the choice
 * is a lookup rather than an argument.
 *
 *   npx rolldown scripts/probe-starve-pin.ts --format esm --platform node -d .eval/build
 *   node .eval/build/probe-starve-pin.js [days...]
 */

import { runColony } from '../src/eval/run';
import type { Difficulty } from '../src/sim/types';

const dayOptions = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [20];
const seeds = [7, 424242, 1312, 99001, 20260729];
const difficulties: Difficulty[] = ['harsh', 'settler'];

console.log('starvation columns · past founding');
console.log('days  difficulty  seed       feet   floor  stranded   unfed  fits  verdict');
for (const days of dayOptions) {
  for (const difficulty of difficulties) {
    for (const seed of seeds) {
      // `steward: false` is not a default and must never be left off. `runColony`
      // opens with `opts.steward ?? true`, the fifteen sweep runs every starvation
      // principle is drawn from pass `false`, and a probe that omits the flag is
      // reading a managed colony living a different sixty days. It shows: this
      // file, run without it, put harsh/424242 at 155.7 h upright at zero over
      // twenty days against the grid's 6.5 h over sixty. Both numbers are real.
      // Neither is about the other's colony.
      const r = runColony({ seed, days, difficulty, playPastFounding: true, steward: false });
      const last = r.snapshots[r.snapshots.length - 1]!;
      // Exactly what `tells a walk home from a wait on the floor…` asserts, so a
      // run that reads `yes` here is a run the pin can be moved to unchanged.
      const fits =
        last.starveHours > 1 &&
        last.floorStarveHours > 1 &&
        last.strandedStarveHours > 1 &&
        last.unfedStarveHours > 1 &&
        last.starveHours !== last.floorStarveHours &&
        last.strandedStarveHours < last.floorStarveHours &&
        last.unfedStarveHours < last.strandedStarveHours;
      const cells = [
        String(days).padEnd(6),
        difficulty.padEnd(12),
        String(seed).padEnd(10),
        last.starveHours.toFixed(1).padStart(5),
        last.floorStarveHours.toFixed(1).padStart(8),
        last.strandedStarveHours.toFixed(1).padStart(10),
        last.unfedStarveHours.toFixed(1).padStart(8),
        (fits ? 'yes' : 'no').padStart(6),
        '  ' + r.verdict,
      ];
      console.log(cells.join(''));
    }
  }
}
