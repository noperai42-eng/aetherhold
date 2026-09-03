/**
 * A colony under siege for forty-three days.
 *
 * `probe-bench-why` found calm/99001's research bench idle from day sixteen to
 * day sixty with a built lab and five projects on offer, and named the guard
 * holding it: `hostiles(world).length > 0`, on **every tick** from day
 * seventeen onward. No storyteller schedules raids back to back for six weeks,
 * so somebody out there is not fighting and not leaving.
 *
 * This asks who. Once a day it counts the hostiles, and for each one writes down
 * where it is, what it is doing, how far it is from the nearest colonist, and
 * whether it has moved since the day before. A band that is walking is a siege;
 * a band standing on the same cell for six weeks is a pawn nothing is ticking,
 * and those want different fixes.
 *
 * Not under `src/sim` or `src/eval`, so it does not move the fingerprint.
 *
 *   npx rolldown scripts/probe-siege.ts --format esm --platform node -d .eval/build
 *   node .eval/build/probe-siege.js <difficulty/seed> [fromDay] [days]
 */

import { makeStreams, stepWorld } from '../src/sim/tick';
import { createWorld } from '../src/sim/worldgen';
import { hostiles, livingColonists } from '../src/sim/world';
import { TICKS_PER_DAY, type Difficulty, type World } from '../src/sim/types';

const pair = process.argv[2] ?? 'calm/99001';
const fromDay = Number(process.argv[3] ?? 15);
const DAYS = Number(process.argv[4] ?? 60);

const [difficulty, seed] = pair.split('/') as [Difficulty, string];
const world: World = createWorld(Number(seed), difficulty);
const streams = makeStreams(world);

/** Where each hostile stood at the last reading, to tell a walk from a statue. */
const wasAt = new Map<number, string>();

for (let tick = 0; tick < DAYS * TICKS_PER_DAY; tick++) {
  stepWorld(world, streams);
  if (world.tick % TICKS_PER_DAY !== 0) continue;
  const day = Math.floor(world.tick / TICKS_PER_DAY);
  if (day < fromDay) continue;
  const band = hostiles(world);
  const us = livingColonists(world);
  const who = band
    .map((h) => {
      const here = `${Math.round(h.x)},${Math.round(h.y)}`;
      const moved = wasAt.get(h.id) === here ? 'STILL' : 'moved';
      wasAt.set(h.id, here);
      const near = us.reduce(
        (best, p) => Math.min(best, Math.abs(p.x - h.x) + Math.abs(p.y - h.y)),
        Infinity,
      );
      return (
        `#${h.id} ${here} ${moved} ${h.activity}` +
        ` hp ${h.health.toFixed(2)} d${near === Infinity ? '—' : Math.round(near)}` +
        ` job ${world.jobs.find((j) => j.id === h.jobId)?.kind ?? '—'}`
      );
    })
    .join('  |  ');
  console.log(`day ${String(day).padStart(2)}  hostiles ${band.length}  ${who}`);
  if (world.gameOver) break;
}
