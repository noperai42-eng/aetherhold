/**
 * Does a wall raised across a live errand end the errand? By hand, on a bare map.
 *
 * The census probes say the dominant way a dispatch to a dying settler ends is
 * the residual one: carrier alive, meal in the world, patient still on the floor.
 * That bucket has one door — `walkTo` returned `'blocked'` — and `movement.ts`
 * has a comment claiming the opposite about one of the ways it can happen:
 *
 *   // A wall built across a live path invalidates it; re-path rather than tunnel.
 *
 * `followPath` does drop the stale path. What it cannot do is get a new one: it
 * returns to `walkTo`, which has already run its re-path block for this tick, and
 * `walkTo` turns a null path into `'blocked'` — which every job in the file reads
 * as final. So the re-path the comment promises never happens for anybody.
 *
 * This builds the smallest colony that can show it: one settler on the floor at
 * zero food, one settler with hands free, one meal on the ground, all three in a
 * row on open ground. Once the carrier is walking the meal over, a wall goes up
 * across the row. Everything is placed by hand, so nothing here depends on what
 * worldgen felt like doing.
 *
 * Not in the build, not under `src/sim` or `src/eval`, so it does not move the
 * fingerprint.
 *
 *   npx rolldown scripts/probe-repro.ts --format esm --platform node -d .eval/build/repro
 *   node .eval/build/repro/probe-repro.js
 */

import { buildingAt } from '../src/sim/grid';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { addBuilding, addItem } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { terrainAt, type Pawn, type World } from '../src/sim/types';
import { createWorld, makePawn } from '../src/sim/worldgen';

function empty(seed = 1337): { world: World; streams: ReturnType<typeof makeStreams> } {
  const world = createWorld(seed);
  const streams = makeStreams(world);
  world.pawns.length = 0;
  world.jobs.length = 0;
  world.items.length = 0;
  return { world, streams };
}

/** A run of open ground long enough to put a whole errand on one row. */
function corridor(world: World, want: number): { x: number; y: number } {
  for (let y = 10; y < world.height - 10; y++) {
    for (let x = 10; x < world.width - 10 - want; x++) {
      let clear = true;
      for (let dx = -1; dx <= want + 1 && clear; dx++) {
        for (let dy = -2; dy <= 2 && clear; dy++) {
          if (buildingAt(world, x + dx, y + dy)) clear = false;
          else if (terrainAt(world, x + dx, y + dy) === 'rock') clear = false;
          else if (terrainAt(world, x + dx, y + dy) === 'water') clear = false;
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('no corridor on this map');
}

function settler(world: World, x: number, y: number): Pawn {
  const p = makePawn(world, new Rng(7 + world.pawns.length), 'colony', x, y);
  p.x = x;
  p.y = y;
  p.jobId = null;
  p.path = null;
  p.activity = 'idle';
  p.needs.food = 0.9;
  p.priorities.doctor = 3;
  return p;
}

function starving(p: Pawn): Pawn {
  p.downed = true;
  p.activity = 'downed';
  p.hp = p.maxHp * 0.5;
  // The combat pass stands a downed pawn back up once it has stopped bleeding, so
  // a patient who is only `downed` is upright again a tick later.
  p.bleed = 20 * 45;
  p.needs.food = 0;
  return p;
}

/** Walk the colony forward until `stop` says so, or `limit` ticks pass. */
function run(
  world: World,
  streams: ReturnType<typeof makeStreams>,
  limit: number,
  stop: () => boolean,
): number {
  for (let i = 0; i < limit; i++) {
    stepWorld(world, streams);
    if (stop()) return i + 1;
  }
  return -1;
}

const SPAN = 20;
const { world, streams } = empty();
const home = corridor(world, SPAN);
// patient — carrier — meal, left to right, so the errand walks the row twice.
const patient = starving(settler(world, home.x, home.y));
const carrier = settler(world, home.x + 8, home.y);
addItem(world, 'meal', 4, home.x + SPAN, home.y);

const feeding = (): number | null => {
  const j = world.jobs.find((k) => k.kind === 'feedPatient' && k.targetPawnId === patient.id);
  return j ? j.id : null;
};

const sent = run(world, streams, 200, () => feeding() !== null);
console.log(`dispatched after ${sent} ticks (job ${feeding()})`);

const carrying = run(world, streams, 2000, () => {
  const id = feeding();
  const j = world.jobs.find((k) => k.id === id);
  return !!j && j.stage === 'carry';
});
console.log(`carrying after ${carrying} more ticks, carrier at ${carrier.x.toFixed(1)}`);

const jobId = feeding();
const job = world.jobs.find((k) => k.id === jobId)!;
const hands = world.pawns.find((q) => q.id === job.pawnId);
console.log(
  `job ${job.id} ${job.kind} stage ${String(job.stage)} → ${job.tx},${job.ty} · pawn ${job.pawnId} · age ${job.age}`,
);
for (const p of world.pawns) {
  console.log(
    `  pawn #${p.id} ${p.faction} at ${p.x.toFixed(1)},${p.y.toFixed(1)} job ${String(p.jobId)} ${p.activity} path ${p.path?.length ?? 0} food ${p.needs.food.toFixed(2)} carry ${String(p.carryingItemId)}`,
  );
}
console.log(`items ${world.items.map((i) => `${i.kind}@${i.x},${i.y}×${i.amount}`).join(' ')}`);
if (!hands) throw new Error('nobody holds the errand');
// The pick-up tick leaves the path null — `walkTo` lays the carry route on the
// next one. Wait for a route long enough to have a middle.
const routed = run(world, streams, 200, () => (hands.path?.length ?? 0) > 4);
console.log(
  `carry route after ${routed} ticks: ${hands.path?.length ?? 0} cells from ${hands.x.toFixed(1)},${hands.y.toFixed(1)}`,
);
// A wall on the carrier's own route, a few cells ahead — in front of them and
// still short of the patient, so the route is stale but a way round plainly
// exists: the corridor is five cells deep and the wall is one cell wide. Taken
// off `pawn.path` rather than guessed, because a wall beside the route is not a
// wall across it and the difference is the whole question.
const ahead = hands.path?.[Math.min(3, hands.path.length - 1)] ?? null;
const wx = ahead === null ? -1 : ahead % world.width;
const wy = ahead === null ? -1 : Math.floor(ahead / world.width);
const wall = ahead === null ? null : addBuilding(world, 'wall', wx, wy, true);
console.log(`wall at ${wx},${wy} — ${wall ? 'raised' : 'REFUSED'}`);

const gone = run(world, streams, 200, () => !world.jobs.some((k) => k.id === jobId));
console.log(
  gone < 0
    ? 'errand survived the wall'
    : `errand cancelled ${gone} ticks after the wall went up (patient food ${patient.needs.food.toFixed(3)})`,
);

const refed = run(world, streams, 4000, () => patient.needs.food > 0.01 || patient.dead);
console.log(
  patient.dead
    ? 'patient died'
    : refed < 0
      ? 'never fed'
      : `fed again ${refed} ticks later, food ${patient.needs.food.toFixed(2)}`,
);
