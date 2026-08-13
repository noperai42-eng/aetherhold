/**
 * Why a settler who can walk is standing at zero food.
 *
 * The grid prints 102.1 h in the on-their-feet column and every hour of it comes
 * from **one run**: harsh/424242. The next fifteen-run field is 7.9 h, and the
 * calm colonies sit near a couple of hours, which is what a settler dipping to
 * zero on the last few steps to the pantry ought to cost. So this is not a
 * population, it is an outlier, and an outlier has a cause somebody can name.
 *
 * This walks the run a tick at a time and, on every tick where an upright settler
 * is at or below the starving line, asks the one question the column cannot:
 * what is stopping *them* from walking to a meal themselves. First blocking
 * reason only, in the order `tryNeedJob` would hit them, so the tally reads as
 * "what would have to change".
 *
 * Not in the build, not under `src/sim` or `src/eval`, so it does not move the
 * fingerprint. Reads the world and writes nothing.
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { countResource, livingColonists } from '../src/sim/world';
import { TICKS_PER_DAY, type Difficulty, type Pawn, type World } from '../src/sim/types';
import { stewardTick } from '../src/eval/steward';
import { reachable } from '../src/sim/jobs';

const seed = Number(process.argv[2] ?? 424242);
const difficulty = (process.argv[3] ?? 'harsh') as Difficulty;
const days = Number(process.argv[4] ?? 60);
/**
 * Off by default, and that default is load-bearing: the fifteen sweep runs the
 * grid reports are **unmanaged**, and a probe that drives the steward measures a
 * different colony living a different sixty days. This one did, the first time it
 * was run, and reported a starvation spell longer than the whole run's supply of
 * starving ticks — which sent a round chasing a latch bug that was not there.
 */
const steward = process.argv[5] === 'steward';

/** The line `run.ts` and the starvation principle both call starving. */
const STARVING = 0.02;

const world = createWorld(seed, difficulty);
const streams = makeStreams(world);

/** Ticks each blocking reason was the first that applied, per starving settler. */
const blocked: Record<string, number> = {};
/** Ticks where at least one upright settler was starving. */
let ticksInTrouble = 0;
/** Longest unbroken spell, and who served it. */
const since = new Map<number, number>();
let longest = 0;
let longestWho = '';
let longestEnded = 0;
/** How the worst sufferer was spending the tick, over their whole ordeal. */
const doing: Record<string, number> = {};
/** The colony's larder on the ticks the worst sufferer was starving. */
let larderSum = 0;
let larderTicks = 0;

/** A free meal or sack this settler could actually walk to, mirroring `findFoodStack`. */
function foodFor(world: World, pawn: Pawn): boolean {
  return world.items.some(
    (s) =>
      s.carriedBy === null &&
      s.reservedBy === null &&
      (s.kind === 'meal' || s.kind === 'rawfood') &&
      reachable(world, pawn, s.x, s.y, false),
  );
}

for (let day = 1; day <= days; day++) {
  for (let i = 0; i < TICKS_PER_DAY; i++) {
    stepWorld(world, streams);
    if (steward) stewardTick(world, world.tick);

    const living = livingColonists(world);
    const starving = living.filter((p) => !p.downed && p.needs.food <= STARVING);
    // Cleared off the *starving* set rather than off `living`, because a settler
    // lifted onto a road by `settlements.ts` is in neither and would otherwise
    // hold a latch across the whole journey. That artefact is what made the first
    // run of this probe report a spell longer than the run.
    const hungryNow = new Set(starving.map((p) => p.id));
    for (const id of since.keys()) if (!hungryNow.has(id)) since.delete(id);
    if (starving.length === 0) continue;
    ticksInTrouble++;

    const larder = countResource(world, 'meal') + countResource(world, 'rawfood');
    for (const p of starving) {
      const from = since.get(p.id) ?? world.tick;
      since.set(p.id, from);
      const spell = world.tick - from + 1;
      if (spell > longest) {
        longest = spell;
        longestWho = `${p.name} (#${p.id})`;
        longestEnded = world.tick;
      }
      const job = world.jobs.find((j) => j.id === p.jobId);
      // The sim's own order. Whichever fires first is what would have to change.
      const why =
        larder === 0
          ? 'the colony has no food at all'
          : job?.kind === 'eat'
            ? 'is already walking to a meal'
            : !foodFor(world, p)
              ? 'has no free food it can reach'
              : p.drafted
                ? 'is drafted'
                : p.activity === 'sleeping'
                  ? 'is asleep'
                  : job
                    ? `is mid-job (${job.kind})`
                    : 'nothing — the need pass should have sent them';
      blocked[why] = (blocked[why] ?? 0) + 1;
    }
    // The worst sufferer is picked once the run is over, so this books the tally
    // for whoever is currently the record holder and is re-keyed as it changes.
    const worst = starving.find((p) => `${p.name} (#${p.id})` === longestWho);
    if (worst) {
      const job = world.jobs.find((j) => j.id === worst.jobId);
      const what = job ? job.kind : worst.activity;
      doing[what] = (doing[what] ?? 0) + 1;
      larderSum += larder;
      larderTicks++;
    }
  }
}

const hours = (t: number): string => ((t / TICKS_PER_DAY) * 24).toFixed(1);
console.log(`${difficulty}/${seed}, ${days} days`);
console.log(`  ${ticksInTrouble} ticks (${hours(ticksInTrouble)} h) with an upright settler at zero`);
console.log(`  longest single spell: ${hours(longest)} h — ${longestWho}, ending day ${Math.ceil(longestEnded / TICKS_PER_DAY)}`);
console.log(`  mean larder while they starved: ${(larderSum / Math.max(1, larderTicks)).toFixed(1)} units`);
console.log('  first blocking reason, per starving settler per tick:');
for (const [why, n] of Object.entries(blocked).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(8)}  ${why}`);
}
console.log(`  what ${longestWho || 'they'} were doing:`);
for (const [what, n] of Object.entries(doing).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(8)}  ${what}`);
}
