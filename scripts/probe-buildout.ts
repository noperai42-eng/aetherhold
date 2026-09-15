/**
 * Does the colony actually raise more, or only think about more?
 *
 * `probe-boardclear` reports which ambition the Steward last committed to, which
 * is the right question for "what is it stuck on" and the wrong one for "did the
 * change work". A foreman that marks twice as much and finishes none of it reads
 * as a busier histogram and a worse colony.
 *
 * So this counts what is standing at the end of the run — built, by kind, plus
 * the rooms and the bedrooms, which are what the Steward is for — and beside it
 * the backlog it never got to, which is the number that says whether it marked
 * more than the crew could raise.
 *
 * Not under `src/sim` or `src/eval`, so it does not move the fingerprint.
 *
 *   npx rolldown scripts/probe-buildout.ts --format esm --platform node -d .eval/build
 *   node .eval/build/probe-buildout.js [days] [seed...]
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { livingColonists } from '../src/sim/world';
import { privateBeds, unhoused } from '../src/sim/quarters';
import { roomIndex } from '../src/sim/rooms';
import { TICKS_PER_DAY, type BuildingKind, type World } from '../src/sim/types';

const days = Number(process.argv[2] ?? 34);
const seeds = process.argv.slice(3).map(Number);
const SEEDS = seeds.length > 0 ? seeds : [7, 1312, 4242];

/** The kinds worth a column: what a colony is judged by rather than made of. */
const KINDS: BuildingKind[] = ['bed', 'fence', 'turret', 'wall', 'door', 'gametable', 'statue', 'lamp'];

function built(world: World, kind: BuildingKind): number {
  let n = 0;
  for (const b of world.buildings) if (b.built && b.kind === kind) n++;
  return n;
}

const head = ['seed', 'alive', 'built', 'backlog', 'rooms', 'private', 'unhoused', ...KINDS];
console.log(head.map((h) => h.padStart(9)).join(''));

for (const seed of SEEDS) {
  const world = createWorld(seed);
  stepWorldN(world, makeStreams(world), TICKS_PER_DAY * days);
  // Trees are buildings too, and a colony is not credited with the forest.
  const raised = world.buildings.filter((b) => b.built && b.kind !== 'tree').length;
  const backlog = world.buildings.filter((b) => !b.built).length;
  const row = [
    seed,
    livingColonists(world).length,
    raised,
    backlog,
    roomIndex(world).rooms.size,
    privateBeds(world).length,
    unhoused(world).length,
    ...KINDS.map((k) => built(world, k)),
  ];
  console.log(row.map((v) => String(v).padStart(9)).join(''));
}
