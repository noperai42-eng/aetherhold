/**
 * The one frame that freezes a colony for a month.
 *
 * Seed 7 carries a single unbuilt `fence` from day three to day thirty-three, and
 * `boardClear` keeps every ambition below `yard` — turrets, research, quarters —
 * switched off the whole time. This asks the frame itself: what does it want, has
 * the colony got it, and can anybody stand next to it?
 * `npx tsx scripts/probe-fence.ts [day] [seed]`
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { countResource, livingColonists } from '../src/sim/world';
import { missingResource, reachable } from '../src/sim/jobs';
import { isWalkable } from '../src/sim/grid';
import { regionAt } from '../src/sim/regions';
import { TICKS_PER_DAY } from '../src/sim/types';

const day = Number(process.argv[2] ?? 20);
const seed = Number(process.argv[3] ?? 7);
const world = createWorld(seed, 'harsh');
stepWorldN(world, makeStreams(world), Math.round(TICKS_PER_DAY * day));

for (const b of world.buildings.filter((x) => !x.built)) {
  const miss = missingResource(b);
  const around = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].map(([dx, dy]) => {
    const x = b.x + dx!;
    const y = b.y + dy!;
    return `${x},${y}${isWalkable(world, x, y) ? ' walk' : ' BLOCKED'} r${regionAt(world, x, y)}`;
  });
  console.log(`${b.kind} #${b.id} at ${b.x},${b.y} progress ${b.progress ?? 0}`);
  console.log(`  needs ${JSON.stringify(b.needs ?? null)} have ${JSON.stringify(b.have ?? null)}`);
  console.log(`  missing ${miss ? `${miss.kind}×${miss.amount} (stock ${countResource(world, miss.kind)})` : 'nothing'}`);
  console.log(`  around: ${around.join(' | ')}`);
  for (const j of world.jobs.filter((x) => x.buildingId === b.id)) {
    const owner = world.pawns.find((q) => q.id === j.pawnId);
    console.log(`  owner ${j.pawnId}: ${owner ? `${owner.name} faction ${owner.faction} dead ${owner.dead} downed ${owner.downed}` : 'NO SUCH PAWN'}`);
  }
  console.log(`  targeted: ${world.jobs.filter((j) => j.buildingId === b.id).map((j) => `${j.kind} by ${j.pawnId} done ${j.done ?? '-'}`).join(', ') || 'nobody'}`);
  for (const p of livingColonists(world)) {
    console.log(
      `    ${p.name} at ${Math.round(p.x)},${Math.round(p.y)} r${regionAt(world, Math.round(p.x), Math.round(p.y))}` +
        ` job ${world.jobs.find((j) => j.pawnId === p.id)?.kind ?? '-'} down ${p.downed} reach ${reachable(world, p, b.x, b.y, true)}`,
    );
  }
}
