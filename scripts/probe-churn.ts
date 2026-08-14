/**
 * Why a meal already on its way stops being on its way.
 *
 * `scripts/probe-carry.ts` put a clock on the whole errand — dispatch to mouth —
 * and the first two seeds said the clock is not spent walking. On harsh/7, 49% of
 * the ticks a dying settler spent waiting had **no live `feedPatient` job at all**,
 * across 24 deliveries and 35 re-dispatches. The meal was on its way, then it was
 * not, then it was again.
 *
 * That is invisible to every column the eval has. `unfedStarveHours` breaks the
 * moment a job exists and restarts from zero when the next one does, so a patient
 * who waits twenty hours through six cancelled dispatches reads as six short
 * waits. The narrow column is not wrong — it answers "was anybody sent" honestly —
 * it just cannot see a colony that keeps sending and keeps giving up.
 *
 * So this classifies every ending. `tickJob`'s `feedPatient` case has six exits and
 * only one of them is a meal: the patient dies, the patient gets up, the patient is
 * full, the food stack is gone, the path is blocked, or somebody eats. From outside
 * the sim they are told apart by what changed on the tick the job vanished, which
 * is what the columns below are.
 *
 * Not in the build, not under `src/sim` or `src/eval`, so it does not move the
 * fingerprint. Reads the world and writes nothing.
 *
 *   npx rolldown scripts/probe-churn.ts --format esm --platform node -d .eval/build/churn
 *   node .eval/build/churn/probe-churn.js [days]
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { PATIENT_EMERGENCY_FOOD } from '../src/sim/jobs';
import { TICKS_PER_DAY, type Difficulty } from '../src/sim/types';

const days = Number(process.argv[2] ?? 60);
const seeds = [7, 1312, 99001, 424242, 20260729];
const difficulties: Difficulty[] = ['harsh', 'settler'];

type Ending = 'fed' | 'died' | 'stood' | 'full' | 'meal gone' | 'carrier down' | 'blocked';
const ENDINGS: Ending[] = ['fed', 'died', 'stood', 'full', 'meal gone', 'carrier down', 'blocked'];

/** What a live `feedPatient` job looked like last tick. */
type Seen = {
  patient: number;
  carrier: number | null;
  item: number | null;
  food: number;
  /** Tick the patient's current wait began — its first dispatch, not this job's. */
  waitFrom: number;
};

function measure(seed: number, difficulty: Difficulty): { label: string; counts: Map<Ending, number>; gaps: number[] } {
  const world = createWorld(seed, difficulty);
  const streams = makeStreams(world);
  const counts = new Map<Ending, number>(ENDINGS.map((e) => [e, 0]));
  /** Ticks between a dispatch ending with no meal and the next one starting. */
  const gaps: number[] = [];
  let seen = new Map<number, Seen>();
  /** Patients waiting with nobody sent, and since when. */
  const dropped = new Map<number, number>();

  for (let day = 1; day <= days; day++) {
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      stepWorld(world, streams);

      const now = new Map<number, Seen>();
      for (const j of world.jobs) {
        if (j.kind !== 'feedPatient' || j.targetPawnId == null) continue;
        const carrier = world.pawns.find((q) => q.jobId === j.id);
        const patient = world.pawns.find((q) => q.id === j.targetPawnId);
        const was = seen.get(j.id);
        now.set(j.id, {
          patient: j.targetPawnId,
          carrier: carrier?.id ?? null,
          item: j.itemId ?? null,
          food: patient?.needs.food ?? 0,
          waitFrom: was?.waitFrom ?? dropped.get(j.targetPawnId) ?? world.tick,
        });
        const from = dropped.get(j.targetPawnId);
        if (from !== undefined) {
          gaps.push(world.tick - from);
          dropped.delete(j.targetPawnId);
        }
      }

      for (const [id, was] of seen) {
        if (now.has(id)) continue;
        const p = world.pawns.find((q) => q.id === was.patient);
        // Only the emergency band. A meal abandoned on the way to somebody merely
        // peckish costs an afternoon, not a settler, and mixing the two would let
        // the common case set the shape of the rare one.
        if (!p || p.dead) {
          if (was.food <= PATIENT_EMERGENCY_FOOD) counts.set('died', counts.get('died')! + 1);
          continue;
        }
        if (was.food > PATIENT_EMERGENCY_FOOD) continue;
        let end: Ending;
        if (p.needs.food > was.food + 0.001) end = 'fed';
        else if (p.needs.food >= 0.95) end = 'full';
        else if (!p.downed) end = 'stood';
        else {
          const carrier = was.carrier === null ? null : world.pawns.find((q) => q.id === was.carrier);
          const item =
            was.item === null
              ? null
              : (world.items.find((s) => s.id === was.item) ?? null);
          if (!carrier || carrier.dead || carrier.downed) end = 'carrier down';
          else if (!item && carrier.carryingItemId === null) end = 'meal gone';
          else end = 'blocked';
        }
        counts.set(end, counts.get(end)! + 1);
        // Still dying, and nobody is coming. Start the clock on the gap.
        if (end !== 'fed' && end !== 'full' && end !== 'stood') dropped.set(was.patient, world.tick);
      }

      // A patient who stops needing one is no longer waiting for one.
      for (const [id] of [...dropped]) {
        const p = world.pawns.find((q) => q.id === id);
        if (!p || p.dead || !p.downed || p.needs.food > PATIENT_EMERGENCY_FOOD) dropped.delete(id);
      }

      seen = now;
    }
    if (world.gameOver) break;
  }
  return { label: `${difficulty}/${seed}`, counts, gaps };
}

const hours = (t: number): string => ((t / TICKS_PER_DAY) * 24).toFixed(2);
console.log(`how a dispatch to a dying settler ends, ${days} days, unmanaged`);
console.log(
  'run                ' + ENDINGS.map((e) => e.padStart(13)).join('') + '   re-sent  worst gap',
);
for (const difficulty of difficulties) {
  for (const seed of seeds) {
    const r = measure(seed, difficulty);
    console.log(
      r.label.padEnd(19) +
        ENDINGS.map((e) => String(r.counts.get(e)).padStart(13)).join('') +
        String(r.gaps.length).padStart(10) +
        hours(r.gaps.length === 0 ? 0 : Math.max(...r.gaps)).padStart(11),
    );
  }
}
