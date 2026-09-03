/**
 * Need-driven research cost two colonies their founding. Which project took the
 * bench, and what did it push behind it?
 *
 * The sixty-day grid that judged the change came back with two enforced
 * principles broken that had held the round before — `the-first-act-is-finishable`
 * (5 of 10 founded → 4) and `the-long-road-is-walked` (6 of 10 walked past the
 * near ring → 4). Both are downstream of a colony being slower, and the grid
 * reports only the ending, so it cannot say which project arriving late did it.
 *
 * This walks one colony a tick at a time and writes down every time the bench
 * changes hands: which day, which project, what the colony had to eat, and which
 * pressure the Steward named. Run it against the tree as it stands and again
 * against the tree with the change backed out, and the difference between the
 * two lists is the whole answer.
 *
 * One seed, sixty days, about two minutes — against an hour and a half for a
 * grid that would still only report the ending.
 *
 * Not under `src/sim` or `src/eval`, so it does not move the fingerprint.
 *
 *   npx rolldown scripts/probe-bench.ts --format esm --platform node -d .eval/build
 *   node .eval/build/probe-bench.js <label> [difficulty/seed ...]
 */

import { foodDays } from '../src/sim/alerts';
import { available } from '../src/sim/research';
import { researchWants } from '../src/sim/steward';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { hasWon } from '../src/sim/victory';
import { createWorld } from '../src/sim/worldgen';
import { livingColonists } from '../src/sim/world';
import { TICKS_PER_DAY, type Difficulty, type World } from '../src/sim/types';

const label = process.argv[2] ?? 'now';
const pairs =
  process.argv.length > 3 ? process.argv.slice(3) : ['settler/20260729', 'calm/1312', 'settler/7'];

const DAYS = 60;

for (const pair of pairs) {
  const [difficulty, seed] = pair.split('/') as [Difficulty, string];
  const world: World = createWorld(Number(seed), difficulty);
  const streams = makeStreams(world);

  let current: string | null = null;
  let foundedOn: number | null = null;
  const bench: string[] = [];

  for (let tick = 0; tick < DAYS * TICKS_PER_DAY; tick++) {
    stepWorld(world, streams);
    if (world.research.current !== current) {
      current = world.research.current;
      const day = Math.floor(world.tick / TICKS_PER_DAY);
      // The Steward's own line for the pick, taken from the log rather than
      // recomputed — the point of the probe is what the colony was told.
      const said = world.messages.at(-1)?.text ?? '';
      // What was on the table when the bench changed hands, and what each of it
      // was worth. The pick alone cannot say whether a project lost narrowly or
      // was never in the running, and that difference is the whole fix.
      const wants = researchWants(world);
      const table = available(world)
        .map((d) => {
          const w = wants.get(d.id);
          return `${d.id}:${(w?.score ?? 0).toFixed(2)}/${d.cost}`;
        })
        .join(' ');
      bench.push(
        `    day ${String(day).padStart(2)}  ${(current ?? '—').padEnd(14)}` +
          `food ${foodDays(world).toFixed(1).padStart(5)}d  hands ${String(livingColonists(world).length).padStart(2)}  ` +
          `done ${String(world.research.done.length).padStart(2)}  ${said.slice(0, 50)}\n` +
          `             open  ${table}`,
      );
    }
    if (foundedOn === null && hasWon(world)) foundedOn = Math.floor(world.tick / TICKS_PER_DAY);
    if (world.gameOver) break;
  }

  // Why the bench stopped, when it stopped. A run that ends with projects still
  // on offer and nothing being studied has lost either the lab or the Steward,
  // and those are different bugs.
  const labs = world.buildings.filter((b) => b.kind === 'lab');
  console.log(
    `${label}  ${pair}  founded ${foundedOn === null ? 'never' : `day ${foundedOn}`}  ` +
      `done ${world.research.done.length}: ${world.research.done.join(' ')}\n` +
      `    end: current=${world.research.current} open=${available(world).length} ` +
      `labs=${labs.length} built=${labs.filter((b) => b.built).length} ` +
      `hands=${livingColonists(world).length} over=${world.gameOver} tick=${world.tick}`,
  );
  for (const line of bench) console.log(line);
}
