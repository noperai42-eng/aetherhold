/**
 * How much of a run the Steward spends frozen.
 *
 * `boardClear` is false while a single blueprint stands, and everything from
 * `defence` down — turrets, research, quarters — sits below that gate. A colony
 * whose crew keeps getting floored never finishes the frame, so the question this
 * asks is simple: after the first week, is the board ever clear at all?
 * `npx tsx scripts/probe-boardclear.ts [days] [seed...]`
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { countResource, livingColonists } from '../src/sim/world';
import { DESIG_NONE, TICKS_PER_DAY, type World } from '../src/sim/types';

const days = Number(process.argv[2] ?? 34);
const seeds = process.argv.slice(3).map(Number);

function clear(world: World): boolean {
  if (world.buildings.some((b) => !b.built)) return false;
  for (let i = 0; i < world.cellDesig.length; i++) if (world.cellDesig[i] !== DESIG_NONE) return false;
  return true;
}

for (const seed of seeds) {
  const world = createWorld(seed, 'harsh');
  const streams = makeStreams(world);
  console.log(`\nseed ${seed}`);
  for (let d = 0; d < days; d++) {
    let clearTicks = 0;
    const frames = new Set<string>();
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      stepWorld(world, streams, null);
      if (clear(world)) clearTicks++;
      for (const b of world.buildings) if (!b.built) frames.add(b.kind);
    }
    const turrets = world.buildings.filter((b) => b.built && b.kind === 'turret').length;
    const rifles = livingColonists(world).filter((p) => p.weapon === 'rifle').length;
    console.log(
      `day ${String(d).padStart(2)}  board clear ${String(Math.round((clearTicks / TICKS_PER_DAY) * 100)).padStart(3)}%  ` +
        `steward ${String(world.stewardLast ?? '-').padEnd(12)} turrets ${turrets}  rifles ${rifles}  ` +
        `steel ${countResource(world, 'steel')}  frames [${[...frames].join(' ')}]`,
    );
  }
}
