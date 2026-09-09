/**
 * Does everybody get a bed, and if not, what stopped it?
 *
 * `probe-buildout` samples one instant at the end of a run, and on seed 7 that
 * instant said four beds for six settlers. That reads as a broken ambition and
 * may only be a photograph taken on a bad morning: `beds` puts one bed on the
 * board at a time and waits for it, so a colony that took in two newcomers
 * yesterday is short two beds today no matter how well the foreman is working.
 * The two stories look identical from the end of the run and completely
 * different across it, which is what this prints — a line a day, so a chronic
 * shortfall shows as a floor the colony never climbs off and a transient shows
 * as a notch.
 *
 * `alive` is what `beds` measures itself against, and `planned` is every bed
 * marked or standing, which is the count it now caps on. So the two columns
 * separate the two answers: if `planned` reaches `alive` and `built` does not,
 * the crew is the bottleneck and the plan is fine; if `planned` sits short of
 * `alive` for days together, the ambition is being stopped and the plan is not.
 *
 * Not under `src/sim` or `src/eval`, so it does not move the fingerprint.
 *
 *   npx tsx scripts/probe-beds.ts [days] [seed...]
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { livingColonists } from '../src/sim/world';
import { privateBeds, unhoused } from '../src/sim/quarters';
import { roomIndex } from '../src/sim/rooms';
import { isBed } from '../src/sim/buildings';
import { TICKS_PER_DAY, type World } from '../src/sim/types';

const days = Number(process.argv[2] ?? 34);
const seeds = process.argv.slice(3).map(Number);
const SEEDS = seeds.length > 0 ? seeds : [7];

function beds(world: World, standing: boolean): number {
  let n = 0;
  for (const b of world.buildings) if (isBed(b.kind) && (!standing || b.built)) n++;
  return n;
}

const head = ['day', 'alive', 'built', 'planned', 'backlog', 'rooms', 'private', 'unhoused', 'ambition'];

for (const seed of SEEDS) {
  console.log(`--- seed ${seed} ---`);
  console.log(head.map((h) => h.padStart(9)).join(''));
  const world = createWorld(seed);
  const streams = makeStreams(world);
  for (let d = 1; d <= days; d++) {
    stepWorldN(world, streams, TICKS_PER_DAY);
    const row = [
      d,
      livingColonists(world).length,
      beds(world, true),
      beds(world, false),
      world.buildings.filter((b) => !b.built).length,
      roomIndex(world).rooms.size,
      privateBeds(world).length,
      unhoused(world).length,
      world.stewardLast ?? '-',
    ];
    console.log(row.map((v) => String(v).padStart(9)).join(''));
  }
}
