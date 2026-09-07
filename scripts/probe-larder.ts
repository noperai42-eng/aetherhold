/**
 * What the colony loses by keeping its food in the room it lives in.
 *
 * Worldgen paints the starting stockpile inside the cabin (`HOME+1..+4`), two
 * cells from the stove. `spoilFactor` is `temp / 20` above freezing and a hard
 * zero below it, so that heap rots at roughly the reference rate all year while a
 * walled cold room would stop the clock outright — the payoff `spoilage.ts` says
 * it exists to offer and that nothing in the game currently builds.
 *
 * Counts what actually spoiled, out of the colony's own log rather than inferred,
 * and reports the temperature the food is sitting at so the loss can be read
 * against its cause. `npx tsx scripts/probe-larder.ts [days] [seed...]`.
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { countResource, livingColonists } from '../src/sim/world';
import { cellTemp, FREEZING } from '../src/sim/temperature';
import { SPOIL_DAYS } from '../src/sim/spoilage';
import { TICKS_PER_DAY, type World } from '../src/sim/types';

const days = Number(process.argv[2] ?? 40);
const seeds = process.argv.slice(3).map(Number);

/** `12 raw food spoiled.` / `3 meals spoiled.` — the only two shapes `tickSpoilage` writes. */
function spoiled(text: string): number {
  const m = /^(\d+) (raw food|meals) spoiled\.$/.exec(text);
  return m ? Number(m[1]) : 0;
}

/** The temperature the colony's perishables are actually sitting at, and how much is cold. */
function larder(world: World): { warmest: number; frozen: number; total: number } {
  let warmest = -Infinity;
  let frozen = 0;
  let total = 0;
  for (const s of world.items) {
    if (SPOIL_DAYS[s.kind] === undefined || s.carriedBy !== null) continue;
    const t = cellTemp(world, s.x, s.y);
    total += s.amount;
    if (t <= FREEZING) frozen += s.amount;
    else warmest = Math.max(warmest, t);
  }
  return { warmest, frozen, total };
}

for (const seed of seeds) {
  const world = createWorld(seed, 'harsh');
  const streams = makeStreams(world);
  let lost = 0;
  for (let d = 0; d < days; d++) {
    // Read by tick, never by a saved index: `msg` trims `world.messages` to
    // `LOG_KEEP`, so a cursor that only counts up walks off the front of a ring
    // buffer and silently stops matching. That bug cost a whole probe run once.
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      const at = world.tick;
      stepWorld(world, streams);
      for (let i = world.messages.length - 1; i >= 0; i--) {
        const m = world.messages[i]!;
        if (m.tick < at) break;
        lost += spoiled(m.text);
      }
    }
    if (livingColonists(world).length === 0) break;
  }
  const l = larder(world);
  console.log(
    `seed ${seed}  spoiled ${lost} over ${days} days  |  larder ${l.total} ` +
      `(${l.frozen} frozen)  warmest stack at ${l.warmest === -Infinity ? 'n/a' : `${l.warmest.toFixed(1)}C`}  ` +
      `|  raw ${countResource(world, 'rawfood')} meal ${countResource(world, 'meal')} ` +
      `crew ${livingColonists(world).length}`,
  );
}
