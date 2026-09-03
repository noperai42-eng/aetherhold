/** Does a colony left alone actually wall somebody a room? Not a test — a probe. */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { addItem, livingColonists } from '../src/sim/world';
import { canPlace } from '../src/sim/orders';
import { privateBeds, unhoused } from '../src/sim/quarters';
import { roomIndex } from '../src/sim/rooms';
import { countResource } from '../src/sim/world';

const SEED = Number(process.argv[2] ?? 4242);
const world = createWorld(SEED);
const streams = makeStreams(world);
// Beside the settlers, not at (40,40): a pile the colony cannot walk to is not
// a stocked colony, it is a colony with no wood, and it stalls on the first
// blueprint it cannot supply. Cost me a day of chasing a Steward bug that was
// entirely in this probe.
const home = livingColonists(world)[0]!;
function drop(kind: 'wood' | 'steel', n: number, dx: number): void {
  for (let r = 0; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const x = Math.round(home.x) + dx + r;
      const y = Math.round(home.y) + dy;
      if (canPlace(world, 'wall', x, y) === 'ok') {
        addItem(world, kind, n, x, y);
        return;
      }
    }
  }
  throw new Error('nowhere to drop ' + kind);
}
drop('wood', 900, 0);
drop('steel', 400, 2);

for (let day = 1; day <= 40; day++) {
  stepWorldN(world, streams, 2400);
  const idx = roomIndex(world);
  console.log(
    `s${SEED} day ${String(day).padStart(2)}  rooms ${String(idx.rooms.size).padStart(2)}` +
      `  private ${privateBeds(world).length}  unhoused ${unhoused(world).length}/${livingColonists(world).length}` +
      `  last=${world.stewardLast ?? '-'}  wood ${countResource(world, 'wood')} steel ${countResource(world, 'steel')}` +
      `  blueprints ${world.buildings.filter((b) => !b.built).length}`,
  );
}
