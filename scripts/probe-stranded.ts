/**
 * Is a stack the probe called UNREACHABLE actually out of reach?
 *
 * `probe-wedge` asks whether anybody can stand *beside* a stack, but a stack is
 * lifted by standing *on* it — `findStack` uses `reachable(..., false)`. So the
 * flag it prints is the wrong question for an item, and this asks the right one:
 * per stack, is the cell walkable, which region is it in, and which regions can
 * the crew actually get to. `npx tsx scripts/probe-stranded.ts [days] [seed]`
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { livingColonists } from '../src/sim/world';
import { reachable } from '../src/sim/jobs';
import { isWalkable, buildingAt } from '../src/sim/grid';
import { regionAt } from '../src/sim/regions';
import { TICKS_PER_DAY } from '../src/sim/types';

const days = Number(process.argv[2] ?? 40);
const seed = Number(process.argv[3] ?? 1312);
const world = createWorld(seed, 'harsh');
stepWorldN(world, makeStreams(world), Math.round(TICKS_PER_DAY * days));

const crew = livingColonists(world);
console.log(`seed ${seed} day ${days}: crew ${crew.length} in regions ${[...new Set(crew.map((p) => regionAt(world, Math.round(p.x), Math.round(p.y))))].join(',')}`);
const sizes = new Map<number, number>();
for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
  const r = regionAt(world, x, y);
  if (r >= 0) sizes.set(r, (sizes.get(r) ?? 0) + 1);
}
console.log(`regions: ${[...sizes].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([r, n]) => `r${r}=${n}`).join(' ')} (of ${sizes.size})`);
const meals = world.items.filter((i) => i.kind === 'meal' && i.carriedBy === null);
console.log(`meals: ${meals.map((m) => `${m.amount}@${m.x},${m.y} r${regionAt(world, m.x, m.y)}`).join(' ')}`);
// What forms the shell of the pocket the crew is shut inside: every building on
// a cell touching their region but not in it.
const home = regionAt(world, Math.round(crew[0]!.x), Math.round(crew[0]!.y));
const shell = new Map<string, number>();
let x0 = 999, y0 = 999, x1 = -1, y1 = -1;
for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
  if (regionAt(world, x, y) !== home) continue;
  x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (regionAt(world, x + dx, y + dy) === home) continue;
    const b = buildingAt(world, x + dx, y + dy);
    const k = b ? `${b.kind}${b.built ? '' : ' UNBUILT'}` : 'open ground';
    shell.set(k, (shell.get(k) ?? 0) + 1);
  }
}
console.log(`home r${home} spans ${x0},${y0}..${x1},${y1}; shell: ${[...shell].map(([k, n]) => `${k}×${n}`).join(' ')}`);
for (const s of world.items) {
  if (s.carriedBy !== null) continue;
  const canLift = crew.some((p) => reachable(world, p, s.x, s.y, false));
  if (canLift) continue;
  const b = buildingAt(world, s.x, s.y);
  console.log(
    `  ${s.kind}×${s.amount} at ${s.x},${s.y} region ${regionAt(world, s.x, s.y)}` +
      ` walkable ${isWalkable(world, s.x, s.y)} building ${b ? `${b.kind} built ${b.built}` : 'none'}` +
      ` reserved ${s.reservedBy ?? '-'}`,
  );
}
