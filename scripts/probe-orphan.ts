/**
 * The tick a job outlives its owner.
 *
 * Seed 7 carries a `build` job on the fence at 86,87 whose pawn is not in
 * `world.pawns` at all, and that one orphan holds the frame — and with it
 * `boardClear`, and with it every Steward ambition below `yard` — for thirty
 * days. This finds the moment it happens and prints what the colony was doing.
 * `npx tsx scripts/probe-orphan.ts [days] [seed]`
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { TICKS_PER_DAY } from '../src/sim/types';

const days = Number(process.argv[2] ?? 34);
const seed = Number(process.argv[3] ?? 7);
const world = createWorld(seed, 'harsh');
const streams = makeStreams(world);
const seen = new Set<number>();

for (let t = 0; t < TICKS_PER_DAY * days; t++) {
  const before = new Map(world.pawns.map((p) => [p.id, p.name] as const));
  stepWorld(world, streams, null);
  for (const j of world.jobs) {
    if (seen.has(j.id)) continue;
    if (world.pawns.some((p) => p.id === j.pawnId)) continue;
    seen.add(j.id);
    console.log(
      `day ${(t / TICKS_PER_DAY).toFixed(2)}  job #${j.id} ${j.kind} building ${j.buildingId ?? '-'}` +
        ` orphaned from pawn ${j.pawnId} (${before.get(j.pawnId) ?? 'gone earlier'})`,
    );
    for (const m of world.messages.slice(-4)) console.log(`    ${m.text}`);
  }
}
console.log(`\norphans still standing at day ${days}: ${world.jobs.filter((j) => !world.pawns.some((p) => p.id === j.pawnId)).length}`);
