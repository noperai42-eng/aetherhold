/**
 * The day the colony walls itself in.
 *
 * Seed 1312 ends day forty with all seven settlers inside a sixty-four cell
 * pocket whose shell is fifty-four walls and thirteen fence posts and not one
 * door, while the outdoors it can no longer reach is twenty-seven thousand cells.
 * This walks the clock and reports how big the crew's own region is, so the tick
 * the last gap closes is visible, along with what the Steward was doing.
 * `npx tsx scripts/probe-sealed.ts [days] [seed]`
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { livingColonists } from '../src/sim/world';
import { buildingAt } from '../src/sim/grid';
import { regionAt } from '../src/sim/regions';
import { TICKS_PER_DAY, type World } from '../src/sim/types';

const days = Number(process.argv[2] ?? 40);
const seed = Number(process.argv[3] ?? 1312);
const world = createWorld(seed, 'harsh');
const streams = makeStreams(world);

/** How much of the map the crew can walk to, and how many doors let them out. */
function room(world: World): { size: number; doors: number } {
  const crew = livingColonists(world);
  if (crew.length === 0) return { size: -1, doors: 0 };
  const home = regionAt(world, Math.round(crew[0]!.x), Math.round(crew[0]!.y));
  let size = 0;
  let doors = 0;
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      if (regionAt(world, x, y) !== home) continue;
      size++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (regionAt(world, x + dx, y + dy) === home) continue;
        const b = buildingAt(world, x + dx, y + dy);
        if (b && b.built && b.kind === 'door') doors++;
      }
    }
  return { size, doors };
}

let last = -1;
for (let d = 0; d < days; d++) {
  for (let t = 0; t < TICKS_PER_DAY; t++) stepWorld(world, streams, null);
  const r = room(world);
  if (last >= 0 && r.size < last / 4) console.log(`  *** sealed: ${last} -> ${r.size} cells`);
  last = r.size;
  console.log(
    `day ${String(d).padStart(2)}  crew room ${String(r.size).padStart(6)} cells  doors out ${r.doors}  ` +
      `steward ${world.stewardLast ?? '-'}`,
  );
}
