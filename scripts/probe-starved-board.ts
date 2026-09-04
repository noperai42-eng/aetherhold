/**
 * Is the board starved of hands, or is the colony right to be farming?
 *
 * `probe-wedge` found seed 1312 with twenty-one untouched blueprints, forty-nine
 * wood on the ground, eight healthy settlers and every one of them harvesting.
 * `farm` sits one slot above `construct` in `WORK_TYPES` and priorities were
 * equal, so at that instant nobody could reach the board. An instant is not a
 * finding: a colony in a genuine food crisis *should* farm and let the fence
 * wait, and that would look identical in a single sample.
 *
 * So this walks the run and prints, per day: what the larder holds, how hungry
 * the colony is, and how many colonist-ticks went to farm work against
 * construction work. A board starved by an errand that never runs out shows as
 * farm at the ceiling and construct flat at zero *while the larder is full* —
 * which is the case the forage ceiling was already written for, one work type
 * over. A real crisis shows as an empty larder.
 *
 *   npx tsx scripts/probe-starved-board.ts [days] [seed ...]
 */

import { makeStreams, stepWorld } from '../src/sim/tick';
import { boardClear } from '../src/sim/steward';
import { createWorld } from '../src/sim/worldgen';
import { countResource, livingColonists } from '../src/sim/world';
import { isBreaking } from '../src/sim/needs';
import { TICKS_PER_DAY } from '../src/sim/types';


const days = Number(process.argv[2] ?? 40);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1312];

for (const seed of seeds) {
  const world = createWorld(seed, 'harsh');
  const streams = makeStreams(world);
  console.log(`\nseed ${seed}`);
  for (let d = 0; d < days; d++) {
    const tally = new Map<string, number>();
    let idle = 0;
    let downed = 0;
    let asleep = 0;
    let breaking = 0;
    let moodSum = 0;
    let moodN = 0;
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      stepWorld(world, streams);
      for (const p of livingColonists(world)) {
        if (p.downed) { downed++; continue; }
        moodSum += p.mood; moodN++;
        if (isBreaking(p)) breaking++;
        if (p.activity === 'sleeping') { asleep++; continue; }
        const job = world.jobs.find((j) => j.id === p.jobId);
        if (!job) { idle++; continue; }
        tally.set(job.kind, (tally.get(job.kind) ?? 0) + 1);
      }
    }
    const crew = livingColonists(world);
    const hunger = crew.length ? crew.reduce((s, p) => s + p.needs.food, 0) / crew.length : 0;
    const open = world.buildings.filter((b) => !b.built).length;
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join('  ');
    console.log(
      `day ${String(d).padEnd(3)} crew ${crew.length}  meal ${String(countResource(world, 'meal')).padStart(3)}` +
        `  raw ${String(countResource(world, 'rawfood')).padStart(3)}  hunger ${hunger.toFixed(2)}` +
        `  open ${String(open).padStart(2)} ${boardClear(world) ? 'clear' : 'dirty'}` +
        `  | idle ${String(idle).padStart(5)} break ${String(breaking).padStart(5)} mood ${(moodN ? moodSum / moodN : 0).toFixed(2)}` +
        ` asleep ${String(asleep).padStart(5)} downed ${String(downed).padStart(5)}` +
        `  | ${top}`,
    );
  }
}
