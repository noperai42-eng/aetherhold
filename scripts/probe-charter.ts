/**
 * A colony that never founds — which of the five charters was actually holding it?
 *
 * `probe-bench` answers "which project took the bench", which is the right
 * question only when research is the binding charter. It is not always: of the
 * three colonies that stopped founding this round, one finished five projects
 * against a need of six, and the other two finished nine and twelve. For those
 * two the founding failed on an axis the bench probe never prints, and reading
 * its output for a cause it cannot contain is how you spend an afternoon fixing
 * the wrong thing.
 *
 * So this walks the same sixty days and watches all five: how far each charter
 * ever got, how much of the run it spent met, and the longest stretch where all
 * five held at once — which is the number the founding actually turns on, since
 * they must hold together for `HOLD_DAYS`.
 *
 * Sampled every `SAMPLE` ticks rather than once a day. A day-boundary sample in
 * Aetherhold always lands at 07:12 — awake, unfed, nobody departed — and food in
 * a settler's hands reads as food the colony does not have, so a once-a-day
 * larder number is biased low at exactly the hour it is least representative.
 * Eighty samples a day costs a few seconds and removes the question.
 *
 * Not under `src/sim` or `src/eval`, so it does not move the fingerprint.
 *
 *   npx rolldown scripts/probe-charter.ts --format esm --platform node -d .eval/build
 *   node .eval/build/probe-charter.js <label> [difficulty/seed ...]
 */

import { makeStreams, stepWorld } from '../src/sim/tick';
import { HOLD_DAYS, charters, hasWon } from '../src/sim/victory';
import { createWorld } from '../src/sim/worldgen';
import { TICKS_PER_DAY, type Difficulty, type World } from '../src/sim/types';

const label = process.argv[2] ?? 'now';
const pairs =
  process.argv.length > 3 ? process.argv.slice(3) : ['settler/20260729', 'calm/1312', 'settler/7'];

const DAYS = 60;
/** Roughly eighty looks a day — see the note above about 07:12. */
const SAMPLE = 60;

interface Track {
  id: string;
  title: string;
  of: number;
  /** Furthest the colony ever got on this axis. */
  best: number;
  /** Samples where it was met, later divided into days. */
  metFor: number;
}

for (const pair of pairs) {
  const [difficulty, seed] = pair.split('/') as [Difficulty, string];
  const world: World = createWorld(Number(seed), difficulty);
  const streams = makeStreams(world);

  const track = new Map<string, Track>();
  let samples = 0;
  let allMet = 0;
  let streak = 0;
  let bestStreak = 0;
  let foundedOn: number | null = null;

  for (let tick = 0; tick < DAYS * TICKS_PER_DAY; tick++) {
    stepWorld(world, streams);
    if (foundedOn === null && hasWon(world)) foundedOn = Math.floor(world.tick / TICKS_PER_DAY);
    if (tick % SAMPLE !== 0) {
      if (world.gameOver) break;
      continue;
    }
    samples++;
    let met = 0;
    for (const c of charters(world)) {
      const t = track.get(c.id) ?? { id: c.id, title: c.title, of: c.of, best: 0, metFor: 0 };
      t.best = Math.max(t.best, c.at);
      if (c.met) {
        t.metFor++;
        met++;
      }
      track.set(c.id, t);
    }
    if (met === 5) {
      allMet++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
    }
    if (world.gameOver) break;
  }

  const perDay = TICKS_PER_DAY / SAMPLE;
  const day = (n: number) => (n / perDay).toFixed(1).padStart(5);
  console.log(
    `${label}  ${pair}  founded ${foundedOn === null ? 'never' : `day ${foundedOn}`}  ` +
      `ran ${(samples / perDay).toFixed(1)}d  over=${world.gameOver}\n` +
      `    all five at once: ${day(allMet)}d total, longest run ${day(bestStreak)}d ` +
      `of the ${HOLD_DAYS}d the founding needs`,
  );
  for (const t of track.values()) {
    // The blocking charter is the one that was rarely or never met — `best`
    // says whether it was ever close or never in the running at all, and those
    // are different bugs.
    console.log(
      `    ${t.id.padEnd(10)} best ${t.best.toFixed(1).padStart(6)} / ${String(t.of).padEnd(4)} ` +
        `met ${day(t.metFor)}d  ${t.metFor === 0 ? '  <- never' : ''}`,
    );
  }
}
