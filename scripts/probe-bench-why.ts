/**
 * The bench went quiet on day sixteen with five projects on offer and a lab
 * standing built, and stayed quiet for forty-four days. `probe-bench` can say
 * *that* it stopped; it cannot say which of `tickSteward`'s five guards was
 * holding the door.
 *
 * So this one stands at the door and counts. Every tick from a given day
 * onwards it asks the same questions `tickSteward` asks, in the same order, and
 * tallies the first answer that would have turned the Steward around. A colony
 * that is simply always fighting looks nothing like a colony whose lab burned
 * down, and the tally tells them apart in one run.
 *
 * Not under `src/sim` or `src/eval`, so it does not move the fingerprint.
 *
 *   npx rolldown scripts/probe-bench-why.ts --format esm --platform node -d .eval/build
 *   node .eval/build/probe-bench-why.js <label> <difficulty/seed> [fromDay]
 */

import { isSleepHours } from '../src/sim/clock';
import { available } from '../src/sim/research';
import { stewardOn } from '../src/sim/steward';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { createWorld } from '../src/sim/worldgen';
import { hostiles, livingColonists } from '../src/sim/world';
import { TICKS_PER_DAY, type Difficulty, type World } from '../src/sim/types';

const label = process.argv[2] ?? 'now';
const pair = process.argv[3] ?? 'calm/99001';
const fromDay = Number(process.argv[4] ?? 17);
const DAYS = 60;

const [difficulty, seed] = pair.split('/') as [Difficulty, string];
const world: World = createWorld(Number(seed), difficulty);
const streams = makeStreams(world);

const tally: Record<string, number> = {
  off: 0,
  over: 0,
  raid: 0,
  night: 0,
  nobody: 0,
  busy: 0,
  nolab: 0,
  nothing: 0,
  would: 0,
};
// The day each reason was last the answer, so a guard that held for a week and
// let go reads differently from one that held for the whole run.
const lastDay: Record<string, number> = {};

for (let tick = 0; tick < DAYS * TICKS_PER_DAY; tick++) {
  stepWorld(world, streams);
  const day = Math.floor(world.tick / TICKS_PER_DAY);
  if (day < fromDay) continue;
  const reason = !stewardOn(world)
    ? 'off'
    : world.gameOver
      ? 'over'
      : hostiles(world).length > 0
        ? 'raid'
        : isSleepHours(world)
          ? 'night'
          : livingColonists(world).length === 0
            ? 'nobody'
            : world.research.current !== null
              ? 'busy'
              : !world.buildings.some((b) => b.built && b.kind === 'lab')
                ? 'nolab'
                : available(world).length === 0
                  ? 'nothing'
                  : 'would';
  tally[reason] = (tally[reason] ?? 0) + 1;
  lastDay[reason] = day;
  if (world.gameOver) break;
}

const line = Object.entries(tally)
  .filter(([, n]) => n > 0)
  .map(([k, n]) => `${k} ${n} (last day ${lastDay[k]})`)
  .join('  ');
console.log(`${label}  ${pair}  from day ${fromDay}: ${line}`);
console.log(
  `    end: done ${world.research.done.length} current=${world.research.current} ` +
    `open=${available(world).length} hands=${livingColonists(world).length} tick=${world.tick}`,
);
