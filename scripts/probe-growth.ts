/**
 * Why does a crop take eighteen days to ripen when the file says three?
 *
 * `probe-farm` settled the first question — the colony really does paint zones
 * and really does sow them, twelve cells on day one — and opened this one: on
 * every seed the `ripe` column sat at zero until about day eighteen. `RIPEN_DAYS`
 * is 3. Something in the chain
 *
 *   GROWTH_PER_TICK * daylight * growthMultiplier * cropGrowthScale
 *                   * soilScale * seasonScale
 *
 * is eating a factor of six, and each of those terms wants a different fix: a
 * daylight mean that is not 0.4 is a wrong constant, a cold `seasonScale` is the
 * starting season being outside the growing band, and a low `soilScale` is the
 * zone being painted on the wrong ground.
 *
 * So report each term per day, plus what one cell sown on day one has actually
 * accumulated, and let the numbers name the culprit.
 *
 * Not under `src/sim` or `src/eval`, so it does not move the fingerprint.
 *
 *   npx rolldown scripts/probe-growth.ts --format esm --platform node -d .eval/build/growth
 *   node .eval/build/growth/probe-growth.js 24
 */

import { daylight } from '../src/sim/clock';
import { growingCells, seasonScale, soilScale } from '../src/sim/farming';
import { cropGrowthScale } from '../src/sim/research';
import { seasonMeanTemp } from '../src/sim/temperature';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { setSteward } from '../src/sim/steward';
import { growthMultiplier } from '../src/sim/weather';
import { TICKS_PER_DAY, terrainAt, unpackX, unpackY, type World } from '../src/sim/types';
import { createWorld } from '../src/sim/worldgen';

const DAYS = Number(process.argv[2] ?? 24);
const SEED = Number(process.argv[3] ?? 7);

const world: World = createWorld(SEED);
const streams = makeStreams(world);
setSteward(world, true);

const pad = (n: number, w = 6, d = 3): string => n.toFixed(d).padStart(w);

// The mean of `daylight()` over one whole day, sampled rather than assumed —
// this is the number `MEAN_DAYLIGHT = 0.4` claims to be.
{
  let sum = 0;
  const saved = world.tick;
  for (let t = 0; t < TICKS_PER_DAY; t++) {
    world.tick = t;
    sum += daylight(world);
  }
  world.tick = saved;
  console.log(`mean daylight over a day: ${(sum / TICKS_PER_DAY).toFixed(4)} (constant says 0.400)`);
}

console.log('\n  day  meanLight  weather  research  season  seasonT   soil  terrain   maxCrop  cells');
for (let day = 1; day <= DAYS; day++) {
  let light = 0;
  let weather = 0;
  for (let t = 0; t < TICKS_PER_DAY; t++) {
    stepWorld(world, streams);
    light += daylight(world);
    weather += growthMultiplier(world);
  }
  light /= TICKS_PER_DAY;
  weather /= TICKS_PER_DAY;

  const cells = growingCells(world);
  // One representative cell: the first in the zone. Soil and season are read
  // there so the row describes ground the colony is actually farming.
  const c = cells[0];
  let season = 0;
  let soil = 0;
  let terrain = '-';
  if (c !== undefined) {
    const x = unpackX(world, c);
    const y = unpackY(world, c);
    season = seasonScale(world, x, y);
    soil = soilScale(world, x, y);
    terrain = terrainAt(world, x, y);
  }
  let maxCrop = -1;
  for (const cell of cells) maxCrop = Math.max(maxCrop, world.crops[cell] ?? -1);

  console.log(
    `  ${String(day).padStart(3)} ${pad(light)}    ${pad(weather)}   ${pad(cropGrowthScale(world))}  ` +
      `${pad(season)}  ${pad(seasonMeanTemp(world), 6, 1)}  ${pad(soil)}  ${terrain.padEnd(7)}  ` +
      `${pad(maxCrop)}  ${String(cells.length).padStart(5)}`,
  );
}
