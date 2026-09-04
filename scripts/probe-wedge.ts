/**
 * The Steward stops. Which blueprint is holding the board?
 *
 * `boardClear` gates every ambition on there being no unbuilt blueprint and no
 * designation anywhere — one outstanding order freezes the whole Steward, which
 * is deliberate (it will not queue a second project over a stalled first) and
 * turns any un-buildable order into a colony that quietly stops improving. Seen
 * on 4242/7/1312 from about day 24: a handful of fence posts, one a plank short
 * and the rest with nothing delivered at all, and nothing built for the rest of
 * the run.
 *
 * This walks with the Steward on and prints, per seed: the tick the board last
 * went dirty and never came clean again, and every outstanding blueprint at the
 * end with what it needs, what it has, what the colony is holding, and whether
 * anybody can stand next to it. That last column is the one the earlier probes
 * do not print, and a fence post on the wrong side of its own fence would look
 * exactly like a materials bug from the stock column alone.
 *
 * Sampled every tick for the board flag — a per-day sample of a flag that flips
 * is a flag you have not measured. See [[probe-aetherhold-per-tick]].
 *
 *   npx tsx scripts/probe-wedge.ts [days] [seed ...]
 */

import { makeStreams, stepWorld } from '../src/sim/tick';
import { boardClear } from '../src/sim/steward';
import { createWorld } from '../src/sim/worldgen';
import { countResource } from '../src/sim/world';
import { reachable } from '../src/sim/jobs';
import { TICKS_PER_DAY, type ResourceKind, type World } from '../src/sim/types';

const days = Number(process.argv[2] ?? 40);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [4242, 7, 1312, 20260729, 99001];

/**
 * Can *anybody* stand next to this and swing at it?
 *
 * Asked of every living settler and not of the first one found. A colony can be
 * split by its own walls, and the first settler in the array being shut out of
 * the half the blueprint is in would print as UNREACHABLE for a frame the other
 * four can walk straight up to.
 */
function adjacent(world: World, x: number, y: number): boolean {
  for (const p of world.pawns) {
    if (p.faction !== 'colony' || p.dead) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (reachable(world, p, x + dx, y + dy)) return true;
    }
  }
  return false;
}

/** Who is left, and what are they doing instead of hauling. */
function crew(world: World): string {
  const out: string[] = [];
  for (const p of world.pawns) {
    if (p.faction !== 'colony' || p.dead) continue;
    const job = world.jobs.find((j) => j.id === p.jobId);
    out.push(
      `${p.name} ${p.downed ? 'DOWNED' : p.activity}` +
        ` food ${p.needs.food.toFixed(2)} rest ${p.needs.rest.toFixed(2)}` +
        ` job ${job ? job.kind : 'none'}` +
        ` construct ${p.priorities.construct}` +
        (p.manual ? ' MANUAL' : '') +
        (p.drafted ? ' DRAFTED' : ''),
    );
  }
  return out.join('\n    ');
}

/** Every stack of a resource a blueprint is waiting on, and who is holding it. */
function stacks(world: World, kind: ResourceKind): string {
  const out: string[] = [];
  for (const s of world.items) {
    if (s.kind !== kind) continue;
    out.push(
      `${s.amount}@(${s.x},${s.y})` +
        (s.carriedBy !== null ? ` carried:${s.carriedBy}` : '') +
        (s.reservedBy !== null ? ` reserved:${s.reservedBy}` : '') +
        (adjacent(world, s.x, s.y) ? '' : ' UNREACHABLE'),
    );
  }
  return out.join('  ');
}

for (const seed of seeds) {
  const world = createWorld(seed, 'harsh');
  const streams = makeStreams(world);
  let dirtySince = -1;
  for (let t = 0; t < days * TICKS_PER_DAY; t++) {
    stepWorld(world, streams);
    if (boardClear(world)) dirtySince = -1;
    else if (dirtySince < 0) dirtySince = world.tick;
  }
  const stuck = dirtySince < 0 ? 'board clear at the end' : `dirty since day ${(dirtySince / TICKS_PER_DAY).toFixed(1)}`;
  const open = world.buildings.filter((b) => !b.built);
  const desig = world.cellDesig.reduce((n, d) => n + (d !== 0 ? 1 : 0), 0);
  console.log(`\nseed ${seed}  ${stuck}  ${open.length} blueprints  ${desig} designations`);
  console.log(`  crew: ${crew(world) || 'nobody left alive'}`);
  console.log(`  wood: ${stacks(world, 'wood') || 'none on the map'}`);
  console.log(`  jobs: ${world.jobs.map((j) => `${j.kind}#${j.id}${j.pawnId === null ? ' unclaimed' : ''}`).join(' ') || 'none'}`);
  for (const b of open) {
    const needs = Object.entries(b.needs).map(([k, v]) => `${k} ${v}`).join(' ') || '-';
    const have = Object.entries(b.have).map(([k, v]) => `${k} ${v}`).join(' ') || 'nothing';
    const stock = (Object.keys(b.needs) as ResourceKind[])
      .map((k) => `${k} ${countResource(world, k)}`)
      .join(' ');
    console.log(
      `  ${b.kind.padEnd(8)} (${b.x},${b.y})  needs ${needs.padEnd(12)} has ${have.padEnd(12)}` +
        `  stock ${stock.padEnd(12)}  work ${b.work}/${b.workLeft}  ${adjacent(world, b.x, b.y) ? 'reachable' : 'UNREACHABLE'}`,
    );
  }
}
