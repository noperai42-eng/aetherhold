/**
 * Why nobody is feeding the settler on the floor.
 *
 * `scripts/probe-food.ts` found the population: downed settlers sit at zero for
 * up to a day and a half with the pantry stocked the whole time. It did not find
 * the cause, and the round that shipped the measurement guessed one — "nothing
 * in the sim carries food to a downed settler" — which is **false**. `jobs.ts`
 * has `tryFeedPatient`, it has an emergency lane above the work board in both
 * `assignJob` and `assignNeedsOnly`, and its comment names this exact failure.
 *
 * So the question is not whether the colony has the behaviour. It is which gate
 * in front of the behaviour is shut, and for how long. This walks the run a tick
 * at a time and, on every tick where a downed settler is starving, asks every
 * other settler why they are not the one carrying a meal — first blocking reason
 * only, in the order the sim itself checks them, so the tally reads as "what
 * would have to change" rather than "what was also true".
 *
 * Not in the build, not under `src/sim` or `src/eval`, so it does not move the
 * fingerprint. Reads the world and writes nothing.
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { countResource, livingColonists } from '../src/sim/world';
import { TICKS_PER_DAY, type Difficulty } from '../src/sim/types';
import { stewardTick } from '../src/eval/steward';
import { HUNGRY } from '../src/sim/needs';
import { reachable } from '../src/sim/jobs';

const seed = Number(process.argv[2] ?? 1312);
const difficulty = (process.argv[3] ?? 'harsh') as Difficulty;
const days = Number(process.argv[4] ?? 60);

/** The line `run.ts` and the starvation principle both call starving. */
const STARVING = 0.02;

const world = createWorld(seed, difficulty);
const streams = makeStreams(world);

/** Ticks each blocking reason was the first one that applied, over all candidates. */
const blocked: Record<string, number> = {};
/** Ticks where at least one settler cleared every gate and still nobody arrived. */
let ticksWithSomebodyFree = 0;
/** Ticks with a starving downed settler at all. */
let ticksInTrouble = 0;
/** Of those, ticks where the colony held no food. */
let ticksNoFood = 0;
/** Ticks where a feedPatient job for the starving patient was already live. */
let ticksJobLive = 0;
/** Ticks where every upright settler was mid-job and nobody could be spared. */
let ticksOnlyBusy = 0;
/** Ticks where the whole colony was on the floor. */
let ticksNobodyUp = 0;
/**
 * On a tick where every upright settler was mid-job, why the interrupt declined.
 *
 * `sendSomebodyToFeed` exists now, so a tick that still reads "only busy hands"
 * is a tick where the pass looked and said no. This re-states its gates rather
 * than calling it — the pass has already run and returned nothing by the time
 * this code sees the tick — so it is an approximation, and it is here to point
 * at the next thing to read rather than to prove anything on its own.
 */
const declined: Record<string, number> = {};
/** Jobs `sendSomebodyToFeed` will not pull a settler off. Kept in step by hand. */
const NEVER_INTERRUPTED = ['flee', 'rescue', 'feedPatient', 'caravan', 'campaign'];

for (let day = 1; day <= days; day++) {
  for (let i = 0; i < TICKS_PER_DAY; i++) {
    stepWorld(world, streams);
    stewardTick(world, world.tick);

    const living = livingColonists(world);
    const patients = living.filter((p) => p.downed && p.needs.food <= STARVING);
    if (patients.length === 0) continue;
    ticksInTrouble++;

    if (countResource(world, 'meal') + countResource(world, 'rawfood') === 0) {
      ticksNoFood++;
      continue;
    }
    const ids = new Set(patients.map((p) => p.id));
    if (world.jobs.some((j) => j.kind === 'feedPatient' && ids.has(j.targetPawnId ?? -1))) {
      ticksJobLive++;
      continue;
    }

    let anybodyFree = false;
    let upright = 0;
    let uprightMidJob = 0;
    for (const p of living) {
      if (ids.has(p.id)) continue;
      // The sim's own order, top to bottom. Whichever fires first is the one that
      // would have to change for this settler to be the rescuer.
      const why = p.downed
        ? 'is downed themselves'
        : p.drafted
          ? 'is drafted'
          : p.activity === 'sleeping'
            ? 'is asleep'
            : p.jobId !== null
              ? 'is mid-job'
              : p.priorities.doctor <= 0
                ? 'has doctor switched off'
                : p.needs.food <= HUNGRY
                  ? 'is hungry themselves'
                  : null;
      if (!p.downed) upright++;
      if (why === 'is mid-job') uprightMidJob++;
      if (why) blocked[why] = (blocked[why] ?? 0) + 1;
      else anybodyFree = true;
    }
    if (anybodyFree) ticksWithSomebodyFree++;
    // The one gap the emergency lane cannot close by design: `assignJob` and
    // `assignNeedsOnly` both return early on a settler who already has a job, so
    // the whole colony being *busy* reads the same as the whole colony being
    // *floored* from the patient's point of view.
    if (!anybodyFree && upright > 0 && uprightMidJob === upright) {
      ticksOnlyBusy++;
      const patient = patients[0];
      const anyFood = world.items.some(
        (s) =>
          s.carriedBy === null &&
          s.reservedBy === null &&
          (s.kind === 'meal' || s.kind === 'rawfood'),
      );
      for (const p of living) {
        if (ids.has(p.id) || p.downed) continue;
        const busy = world.jobs.find((j) => j.id === p.jobId);
        const why = busy && NEVER_INTERRUPTED.includes(busy.kind)
          ? `is on a job nobody is pulled off (${busy.kind})`
          : p.manual || p.playerControlled
            ? 'is the player’s to move'
            : p.priorities.doctor <= 0
              ? 'has doctor switched off'
              : p.needs.food <= HUNGRY
                ? 'is hungry themselves'
                : !anyFood
                  ? 'has no unreserved food to carry'
                  : !reachable(world, p, Math.round(patient.x), Math.round(patient.y), true)
                    ? 'cannot reach the patient'
                    : 'nothing — the pass should have sent them';
        declined[why] = (declined[why] ?? 0) + 1;
      }
    }
    if (upright === 0) ticksNobodyUp++;
  }
}

const hours = (t: number): string => ((t / TICKS_PER_DAY) * 24).toFixed(1);
console.log(`${difficulty}/${seed}, ${days} days`);
console.log(`  ${ticksInTrouble} ticks (${hours(ticksInTrouble)} h) with a starving settler down`);
console.log(`    ${hours(ticksNoFood)} h of that with no food in the colony at all`);
console.log(`    ${hours(ticksJobLive)} h of that with a meal already on its way`);
console.log(`    ${hours(ticksWithSomebodyFree)} h with somebody standing free and no meal moving`);
console.log(`    ${hours(ticksOnlyBusy)} h where the only settlers on their feet were all mid-job`);
console.log(`    ${hours(ticksNobodyUp)} h with the whole colony on the floor`);
console.log('  first blocking reason, per settler per tick:');
for (const [why, n] of Object.entries(blocked).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(8)}  ${why}`);
}
if (Object.keys(declined).length > 0) {
  console.log('  on the busy-hands ticks, why the interrupt declined:');
  for (const [why, n] of Object.entries(declined).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(8)}  ${why}`);
  }
}
