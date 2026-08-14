/**
 * Does a colony farm? Day by day, with the Steward on and with it off.
 *
 * The report is that there is no planting, no crop growth and no field setup.
 * Every part of the machinery is present — a `grow` zone tool on B, a `till`
 * tool on N, `tickCrops` advancing `world.crops`, and cones in `fx.ts` that
 * scale and ripen with growth — so "it does not exist" and "it exists and
 * nobody ever sees it happen" look identical from the manager camera and want
 * opposite fixes.
 *
 * So: count the ground. Zone cells painted, of those how many can actually be
 * sown, how many have a crop in them, how ripe those are, and how many plant and
 * harvest jobs are live. A colony with zone cells and no sown cells is a
 * dispatch bug; no zone cells at all is the Steward never getting to it; sown
 * cells that never ripen is the growth rate; all four healthy means the farm is
 * real and the player simply cannot see it, which is a rendering and readout
 * question rather than a simulation one.
 *
 * Not in the build, not under `src/sim` or `src/eval`, so it does not move the
 * fingerprint.
 *
 *   npx rolldown scripts/probe-farm.ts --format esm --platform node -d .eval/build/farm
 *   node .eval/build/farm/probe-farm.js 20
 */

import { canSow, growingCells } from '../src/sim/farming';
import { setSteward } from '../src/sim/steward';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { TICKS_PER_DAY, unpackX, unpackY, type World } from '../src/sim/types';
import { createWorld } from '../src/sim/worldgen';

const DAYS = Number(process.argv[2] ?? 20);
const SEEDS = [7, 1312, 99001, 424242, 20260729];

interface Row {
  day: number;
  zone: number;
  sowable: number;
  sown: number;
  ripe: number;
  planting: number;
  harvesting: number;
  meals: number;
}

function census(world: World, day: number): Row {
  const cells = growingCells(world);
  let sowable = 0;
  let sown = 0;
  let ripe = 0;
  for (const c of cells) {
    const x = unpackX(world, c);
    const y = unpackY(world, c);
    if (canSow(world, x, y)) sowable++;
    const g = world.crops[c] ?? -1;
    if (g >= 0) sown++;
    if (g >= 1) ripe++;
  }
  return {
    day,
    zone: cells.length,
    sowable,
    sown,
    ripe,
    planting: world.jobs.filter((j) => j.kind === 'sow').length,
    harvesting: world.jobs.filter((j) => j.kind === 'harvestCrop').length,
    meals: world.items
      .filter((i) => i.kind === 'meal' || i.kind === 'rawfood')
      .reduce((n, i) => n + i.amount, 0),
  };
}

function play(seed: number, steward: boolean): Row[] {
  const world = createWorld(seed);
  const streams = makeStreams(world);
  setSteward(world, steward);
  const rows: Row[] = [];
  for (let day = 1; day <= DAYS; day++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) stepWorld(world, streams);
    rows.push(census(world, day));
  }
  return rows;
}

const pad = (s: string | number, n: number): string => String(s).padStart(n);

for (const steward of [true, false]) {
  console.log(`\n===== steward ${steward ? 'ON' : 'OFF'} =====`);
  for (const seed of SEEDS) {
    const rows = play(seed, steward);
    console.log(`\nseed ${seed}`);
    console.log('  day   zone sowable   sown   ripe  plant harvest   food');
    // Only the days where something moved, plus the last one — twenty identical
    // rows of zeroes says the same thing once.
    let prev = '';
    for (const r of rows) {
      const sig = `${r.zone}/${r.sowable}/${r.sown}/${r.ripe}`;
      if (sig === prev && r.day !== rows.length) continue;
      prev = sig;
      console.log(
        `  ${pad(r.day, 3)} ${pad(r.zone, 6)} ${pad(r.sowable, 7)} ${pad(r.sown, 6)} ` +
          `${pad(r.ripe, 6)} ${pad(r.planting, 6)} ${pad(r.harvesting, 7)} ${pad(r.meals, 6)}`,
      );
    }
  }
}
