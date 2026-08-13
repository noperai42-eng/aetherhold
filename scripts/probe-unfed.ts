/**
 * What the stranded column would read if a meal already walking over did not count.
 *
 * `strandedStarveHours` is the narrowest of the eval's three starvation spells —
 * at zero, on the floor, with somebody still upright — and it was meant to name a
 * feeding failure. `scripts/probe-feed.ts`, once it stopped driving the steward,
 * says most of it is not one: on harsh/20260729 the reachable hours split 35.2 h
 * with a `feedPatient` job already live against 0.8 h with somebody standing free
 * and nothing moving, and on harsh/7 it is 19.8 h against 0.6 h. A rescuer walking
 * a meal across the colony is the promise being *kept*, and the column counts it.
 *
 * So this measures the spell the column would report if it broke the moment somebody
 * was sent: at zero, on the floor, hands up, **and nobody carrying**. That is the
 * reading a fix to the work board can move, and this exists to get its before-value
 * without spending a sixty-day grid on an instrument that does not exist yet.
 *
 * Latches copied from `src/eval/run.ts` line for line — including the delete pass
 * that ends a spell when the settler stands up, eats, or is the last one standing —
 * so the number this prints is the number that column will print.
 *
 * Not in the build, not under `src/sim` or `src/eval`, so it does not move the
 * fingerprint. Reads the world and writes nothing.
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { livingColonists } from '../src/sim/world';
import { TICKS_PER_DAY, type Difficulty } from '../src/sim/types';
import { stewardTick } from '../src/eval/steward';

const seed = Number(process.argv[2] ?? 1312);
const difficulty = (process.argv[3] ?? 'harsh') as Difficulty;
const days = Number(process.argv[4] ?? 60);
/** Off by default. The fifteen sweep runs the grid reports are unmanaged. */
const steward = process.argv[5] === 'steward';

/** The line `run.ts` and the starvation principles all call starving. */
const STARVING = 0.02;

const world = createWorld(seed, difficulty);
const streams = makeStreams(world);

const strandedSince = new Map<number, number>();
const unfedSince = new Map<number, number>();
let longestStranded = 0;
let longestUnfed = 0;
/** Ticks inside a stranded spell that a meal was already on its way. */
let carriedTicks = 0;
let strandedTicks = 0;

for (let day = 1; day <= days; day++) {
  for (let i = 0; i < TICKS_PER_DAY; i++) {
    stepWorld(world, streams);
    if (steward) stewardTick(world, world.tick);

    const living = livingColonists(world);
    const flooredHungry: number[] = [];
    let upright = 0;
    for (const p of living) {
      if (p.downed) {
        if (p.needs.food <= STARVING) flooredHungry.push(p.id);
      } else upright++;
    }

    // Whose meal is already moving. One job per patient — `sendSomebodyToFeed`
    // skips a patient who already has one — so this is a set, not a count.
    const carried = new Set<number>();
    if (flooredHungry.length > 0) {
      for (const j of world.jobs) {
        if (j.kind === 'feedPatient' && j.targetPawnId != null) carried.add(j.targetPawnId);
      }
    }

    if (upright > 0) {
      for (const id of flooredHungry) {
        const from = strandedSince.get(id) ?? world.tick;
        strandedSince.set(id, from);
        longestStranded = Math.max(longestStranded, world.tick - from + 1);
        strandedTicks++;
        if (carried.has(id)) {
          carriedTicks++;
          continue;
        }
        const ufrom = unfedSince.get(id) ?? world.tick;
        unfedSince.set(id, ufrom);
        longestUnfed = Math.max(longestUnfed, world.tick - ufrom + 1);
      }
    }
    for (const id of strandedSince.keys()) {
      if (upright === 0 || !flooredHungry.includes(id)) strandedSince.delete(id);
    }
    // The narrower latch breaks on everything the wide one breaks on, and also the
    // moment somebody is sent. That break is the whole point: a spell that survives
    // a rescuer being dispatched is not measuring dispatch.
    for (const id of unfedSince.keys()) {
      if (upright === 0 || !flooredHungry.includes(id) || carried.has(id)) unfedSince.delete(id);
    }
  }
}

const hours = (t: number): string => ((t / TICKS_PER_DAY) * 24).toFixed(2);
console.log(`${difficulty}/${seed}, ${days} days${steward ? ', steward on' : ''}`);
console.log(`  stranded  ${hours(longestStranded)} h  longest spell at zero, floored, hands up`);
console.log(`  unfed     ${hours(longestUnfed)} h  the same, minus every tick a meal was moving`);
console.log(
  `  of ${strandedTicks} stranded settler-ticks, ${carriedTicks} (${
    strandedTicks === 0 ? '0' : ((carriedTicks / strandedTicks) * 100).toFixed(0)
  }%) had a meal on its way`,
);
