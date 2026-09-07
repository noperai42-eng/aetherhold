/**
 * Why the colony never builds its cold store.
 *
 * The `cellar` ambition is in the list and its tests pass, but a real forty-day
 * run on seed 7 still spoils 268 food with nothing ever frozen — so something
 * upstream of the ambition is answering first, or one of its own gates is shut.
 * This prints the gates, read-only: it never calls `mark`, because `mark` plans
 * blueprints and would change the run it is measuring.
 *
 * `node .eval/build/probe-cellar.js [days] [seed...]`
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { countResource, livingColonists } from '../src/sim/world';
import { DRAW, GENERATOR_OUTPUT } from '../src/sim/power';
import { BUILDING_DEFS } from '../src/sim/buildings';
import { roomIndex } from '../src/sim/rooms';
import { AMBITIONS } from '../src/sim/steward';
import { TICKS_PER_DAY, type World } from '../src/sim/types';

const days = Number(process.argv[2] ?? 40);
const seeds = process.argv.slice(3).map(Number);

function built(world: World, kind: string): number {
  let n = 0;
  for (const b of world.buildings) if (b.built && b.kind === kind) n++;
  return n;
}

function planned(world: World, kind: string): number {
  let n = 0;
  for (const b of world.buildings) if (!b.built && b.kind === kind) n++;
  return n;
}

function load(world: World): number {
  let q = 0;
  for (const b of world.buildings) {
    if (!b.built) continue;
    q += (DRAW as Record<string, number>)[b.kind] ?? 0;
  }
  return q;
}

/** Rooms with no bed, no prison bunk and no cooler — what `cellar` has to choose from. */
function emptyRooms(world: World): number {
  const idx = roomIndex(world);
  const taken = new Set<number>();
  for (const b of world.buildings) {
    if (!b.built) continue;
    if (!/bed|cooler/.test(b.kind)) continue;
    const id = idx.cellRoom[b.y * world.width + b.x];
    if (id !== undefined && id >= 0) taken.add(id);
  }
  let n = 0;
  for (const [id, room] of idx.rooms) if (!taken.has(id) && room.size > 0) n++;
  return n;
}

for (const seed of seeds) {
  const world = createWorld(seed, 'harsh');
  const streams = makeStreams(world);
  console.log(`\nseed ${seed}`);
  for (let d = 0; d < days; d++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) stepWorld(world, streams);
    // Asking the list who is holding is not a read — `mark` plans blueprints and
    // changes the run — so it lives behind WHY and its numbers must never be
    // quoted alongside an unperturbed run's.
    let holding = '-';
    if (process.env.WHY) {
      for (const a of AMBITIONS) {
        if (a.mark(world) > 0) { holding = a.id; break; }
      }
    }
    const q = load(world);
    const gen = built(world, 'generator');
    const steel = countResource(world, 'steel');
    const blueprints = world.buildings.filter((b) => !b.built).length;
    const designations = world.designations?.length ?? -1;
    console.log(
      `day ${String(d).padStart(2)}  crew ${livingColonists(world).length}` +
        `  steel ${steel}/${BUILDING_DEFS.cooler.cost.steel ?? 0}` +
        `  gen ${gen} (${gen * GENERATOR_OUTPUT} vs load ${q}+${DRAW.cooler})` +
        `  cooler ${built(world, 'cooler')} built / ${planned(world, 'cooler')} planned` +
        `  empty rooms ${emptyRooms(world)}  board ${blueprints} bp ${designations} desig  holding ${holding}`,
    );
  }
}
