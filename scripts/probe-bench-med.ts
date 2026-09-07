/**
 * Why a colony with two hundred sacks of food and a level-ten doctor has no
 * medicine. Runs a seed to a day and asks the bench itself, settler by settler.
 * `npx tsx scripts/probe-bench-med.ts [day] [seed]`
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { countResource, livingColonists } from '../src/sim/world';
import { benchRecipe, benchRefusal, wantedRecipes } from '../src/sim/jobs';
import { skillOf } from '../src/sim/skills';
import { TICKS_PER_DAY } from '../src/sim/types';

const day = Number(process.argv[2] ?? 20);
const seed = Number(process.argv[3] ?? 7);
const world = createWorld(seed, 'harsh');
stepWorldN(world, makeStreams(world), Math.round(TICKS_PER_DAY * day));

const free = world.items.filter((i) => i.kind === 'rawfood' && i.carriedBy === null && i.reservedBy === null).reduce((n, i) => n + i.amount, 0);
const heaps = world.items
  .filter((i) => i.kind === 'rawfood' && i.carriedBy === null)
  .map((i) => i.amount)
  .sort((a, b) => b - a);
console.log(`day ${day} seed ${seed}`);
console.log(`rawfood ${countResource(world, 'rawfood')} free ${free} in ${heaps.length} heaps: ${heaps.slice(0, 20).join(' ')}`);
console.log(`medicine ${countResource(world, 'medicine')}  steel ${countResource(world, 'steel')}  wood ${countResource(world, 'wood')}`);
const steelHeaps = world.items.filter((i) => i.kind === 'steel' && i.carriedBy === null && i.reservedBy === null).map((i) => i.amount).sort((a, b) => b - a);
console.log(`steel free heaps: ${steelHeaps.join(' ') || 'none'}`);
console.log(`blueprints: ${world.buildings.filter((b) => !b.built).map((b) => b.kind).join(' ') || 'none'}`);
const built = new Map<string, number>();
for (const b of world.buildings) if (b.built) built.set(b.kind, (built.get(b.kind) ?? 0) + 1);
console.log(`defence: ${[...built].filter(([k]) => /turret|sandbag|wall|door|generator/.test(k)).map(([k, n]) => `${k}×${n}`).join(' ') || 'none'}`);
console.log(`hostiles now ${world.pawns.filter((q) => !q.dead && q.faction !== 'colony' && q.faction !== 'fauna' && q.faction !== 'trader' && q.faction !== 'prisoner').length}`);
for (const p of livingColonists(world)) {
  const wants = wantedRecipes(world, p);
  console.log(
    `  ${p.name} plants ${skillOf(p, 'plants').toFixed(1)} doc ${skillOf(p, 'medicine').toFixed(1)}` +
      ` hp ${(p.hp / p.maxHp).toFixed(2)} weapon ${p.weapon ?? 'fists'} shoot ${skillOf(p, 'shooting').toFixed(1)} down ${p.downed} wants [${wants.join(',')}] bench ${benchRecipe(world, p)?.recipe ?? '-'} :: ${benchRefusal(world, p)}`,
  );
}
