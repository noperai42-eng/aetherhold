/**
 * Eight healthy settlers, twenty frames, forty-nine wood — and nobody working.
 *
 * `probe-starved-board` ruled out every explanation that a summary can rule out:
 * on seed 1312 day 35 the colony is eight strong, none downed, none on a morale
 * break, mood 0.69, the larder full, twenty blueprints standing and nineteen
 * thousand colonist-ticks of idle. `assignJob` is being asked and is answering
 * "nothing", which is a claim about a specific line of code rather than about
 * the colony, so this walks that line for every settler against every frame and
 * prints which test says no.
 *
 * The distinction that matters and that the earlier probe got wrong: a frame is
 * worked from *beside* it (`reachable(..., true)`) and a stack is picked up from
 * *on top of* it (`reachable(..., false)`). A woodpile on a cell somebody has
 * since built over reads as reachable by the first test and is invisible to the
 * second — which is a colony with wood it can see and cannot lift.
 *
 *   npx tsx scripts/probe-noboard.ts [days] [seed]
 */

import { makeStreams, stepWorld } from '../src/sim/tick';
import { createWorld } from '../src/sim/worldgen';
import { findStack, isBuildingTargeted, missingResource, reachable } from '../src/sim/jobs';
import { buildingAt, isWalkable } from '../src/sim/grid';
import { livingColonists } from '../src/sim/world';
import { TICKS_PER_DAY, terrainAt } from '../src/sim/types';

const days = Number(process.argv[2] ?? 36);
const seed = Number(process.argv[3] ?? 1312);

const world = createWorld(seed, 'harsh');
const streams = makeStreams(world);
for (let t = 0; t < days * TICKS_PER_DAY; t++) stepWorld(world, streams);

const crew = livingColonists(world);
console.log(`seed ${seed} day ${days}: ${crew.length} settlers, ${world.buildings.filter((b) => !b.built).length} frames`);

console.log('\nevery loose stack, and whether a settler could pick it up:');
for (const s of world.items) {
  if (s.carriedBy !== null) continue;
  const standable = isWalkable(world, s.x, s.y);
  const canGet = crew.some((p) => reachable(world, p, s.x, s.y, false));
  if (s.kind !== 'wood' && s.kind !== 'steel') continue;
  console.log(
    `  ${s.kind} ${s.amount}@(${s.x},${s.y})` +
      (s.reservedBy !== null ? ` reserved:${s.reservedBy}` : '') +
      `  walkable ${standable}  anybody-can-reach ${canGet}` +
      `  terrain ${terrainAt(world, s.x, s.y)}` +
      (() => {
        const b = buildingAt(world, s.x, s.y);
        return b ? `  under ${b.kind}${b.built ? '' : ' (blueprint)'}` : '  nothing on it';
      })(),
  );
}

console.log('\nevery frame, and the test that turns the settler away:');
for (const b of world.buildings) {
  if (b.built) continue;
  const targeted = isBuildingTargeted(world, b.id);
  const canWork = crew.some((p) => reachable(world, p, b.x, b.y, true));
  const missing = missingResource(b);
  const haulers = missing ? crew.filter((p) => findStack(world, p, missing.kind) !== null).length : crew.length;
  const verdict = targeted
    ? 'somebody has it'
    : !canWork
      ? 'nobody can stand beside it'
      : !missing
        ? 'READY TO BUILD'
        : haulers === 0
          ? `no reachable stack of ${missing.kind}`
          : `${haulers} settlers could fetch ${missing.kind}`;
  console.log(`  ${b.kind.padEnd(9)} (${b.x},${b.y})  ${verdict}`);
}

console.log('\nwhat each settler is doing:');
for (const p of crew) {
  const job = world.jobs.find((j) => j.id === p.jobId);
  console.log(
    `  ${p.name.padEnd(18)} ${p.activity.padEnd(9)} job ${(job ? job.kind : 'NONE').padEnd(16)}` +
      ` mood ${p.mood.toFixed(2)} food ${p.needs.food.toFixed(2)} break ${p.breakTicks ?? 0}` +
      ` queue ${p.queue?.length ?? 0} construct ${p.priorities.construct}`,
  );
}
