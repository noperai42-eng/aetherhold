/**
 * How long the carry actually takes, and which leg of it is long.
 *
 * `unfedStarveHours` broke the stranded column in two and the half it kept —
 * nobody sent — is now small: 4.72 h worst across the sixty-day grid. The half it
 * discarded is not small. Between a third and nine tenths of every stranded
 * settler-tick was a meal already walking over, and **nothing measures whether
 * that walk is fast enough**. A per-tick latch cannot: it can only ask "is a job
 * live", and a job that is live for four hours and a job that is live for four
 * minutes read the same.
 *
 * So this is a per-delivery clock. It starts the tick a `feedPatient` job first
 * names a settler who is down at or below the emergency line, and stops when that
 * settler's food goes up — which, for somebody on the floor, can only mean
 * somebody fed them. `tickNeeds` drains and never fills, and tending does not
 * feed, so the rise is unambiguous.
 *
 * The clock is split by `job.stage`, because the errand has two walks in it and
 * only one of them is chosen by anybody:
 *
 *   goto   the carrier walks to a food stack — `findFoodStack` picks the stack
 *          nearest **the carrier**
 *   carry  the carrier walks that meal to the patient — nothing chose this leg
 *   work   forty ticks of feeding, fixed
 *
 * `sendSomebodyToFeed` picks the carrier by `dist(carrier, patient)`. The route is
 * carrier → food → patient. Nobody compares the sum, so the last column here is
 * the one to read: the best `carrier→food→patient` available on the tick against
 * the one the sim chose.
 *
 * A dispatch that ends without a meal is counted separately rather than dropped —
 * a mean over completed deliveries alone would hide the worst outcome there is.
 *
 * Not in the build, not under `src/sim` or `src/eval`, so it does not move the
 * fingerprint. Reads the world and writes nothing.
 *
 *   npx rolldown scripts/probe-carry.ts --format esm --platform node -d .eval/build/carry
 *   node .eval/build/carry/probe-carry.js [days]
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { livingColonists } from '../src/sim/world';
import { dist } from '../src/sim/grid';
import { reachable, PATIENT_EMERGENCY_FOOD } from '../src/sim/jobs';
import { TICKS_PER_DAY, type Difficulty, type World, type Pawn } from '../src/sim/types';

const days = Number(process.argv[2] ?? 60);
const seeds = [7, 1312, 99001, 424242, 20260729];
const difficulties: Difficulty[] = ['harsh', 'settler'];

/** Kinds `sendSomebodyToFeed` will not pull a settler off. Copied from `jobs.ts`. */
const NEVER_INTERRUPTED = ['flee', 'rescue', 'feedPatient', 'caravan', 'campaign'];

/**
 * `findFoodStack`'s scoring, copied — it is not exported, and the alternative
 * routes below have to be priced the way the sim would price them or the gap this
 * prints is a gap between the probe and the sim rather than one in the colony.
 *
 * One deliberate difference: a stack reserved by `exceptJob` counts as free. On
 * the tick a dispatch is spotted its own meal is already reserved, and pricing the
 * chosen route without its own meal would compare the sim's answer against a
 * pantry the sim did not have.
 */
function nearestFood(world: World, from: Pawn, exceptJob: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (const s of world.items) {
    if (s.carriedBy !== null) continue;
    if (s.reservedBy !== null && s.reservedBy !== exceptJob) continue;
    if (s.kind !== 'meal' && s.kind !== 'rawfood') continue;
    const d = dist(from.x, from.y, s.x, s.y);
    const score = d + (s.kind === 'meal' ? 0 : 22) - (s.rot ?? 0) * 8;
    if (score < bestScore && reachable(world, from, s.x, s.y, false)) {
      best = { x: s.x, y: s.y };
      bestScore = score;
    }
  }
  return best;
}

/** Every gate `sendSomebodyToFeed` applies to a candidate carrier, in its order. */
function couldCarry(world: World, p: Pawn, patient: Pawn): boolean {
  if (p.id === patient.id || p.dead || p.downed || p.drafted) return false;
  if (p.faction !== 'colony' || p.playerControlled) return false;
  if (p.manual || p.priorities.doctor <= 0 || p.needs.food <= PATIENT_EMERGENCY_FOOD) return false;
  if (p.activity === 'sleeping') return false;
  const busy = world.jobs.find((j) => j.id === p.jobId);
  if (busy && NEVER_INTERRUPTED.includes(busy.kind)) return false;
  return reachable(world, p, Math.round(patient.x), Math.round(patient.y), true);
}

type Open = {
  from: number;
  goto: number;
  carry: number;
  work: number;
  /** Ticks with no live job at all — the dispatch was cancelled and not replaced. */
  idle: number;
  jobs: Set<number>;
  food: number;
  /** Cells the sim's route asked for, and the best it could have asked for. */
  chosenRoute: number;
  bestRoute: number;
};

type Row = {
  label: string;
  fed: number[];
  died: number[];
  stood: number[];
  goto: number;
  carry: number;
  work: number;
  idle: number;
  rejobs: number;
  chosen: number[];
  best: number[];
};

function measure(seed: number, difficulty: Difficulty): Row {
  const world = createWorld(seed, difficulty);
  const streams = makeStreams(world);
  const open = new Map<number, Open>();
  const row: Row = {
    label: `${difficulty}/${seed}`,
    fed: [],
    died: [],
    stood: [],
    goto: 0,
    carry: 0,
    work: 0,
    idle: 0,
    rejobs: 0,
    chosen: [],
    best: [],
  };

  const close = (id: number, o: Open, into: number[]): void => {
    into.push(world.tick - o.from + 1);
    row.goto += o.goto;
    row.carry += o.carry;
    row.work += o.work;
    row.idle += o.idle;
    row.rejobs += o.jobs.size - 1;
    if (o.bestRoute > 0) {
      row.chosen.push(o.chosenRoute);
      row.best.push(o.bestRoute);
    }
    open.delete(id);
  };

  for (let day = 1; day <= days; day++) {
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      stepWorld(world, streams);

      const live = new Map<number, { id: number; stage: string }>();
      for (const j of world.jobs) {
        if (j.kind === 'feedPatient' && j.targetPawnId != null) {
          live.set(j.targetPawnId, { id: j.id, stage: String(j.stage) });
        }
      }

      // Close first, so a settler who is fed and stands up in the same tick is
      // recorded as fed rather than as somebody who wandered off.
      for (const [id, o] of [...open]) {
        const p = world.pawns.find((q) => q.id === id);
        if (!p || p.dead) {
          close(id, o, row.died);
          continue;
        }
        // The only thing that raises a downed settler's food is somebody feeding
        // them: `tickNeeds` drains, and tending is a different job.
        if (p.needs.food > o.food + 0.001) {
          close(id, o, row.fed);
          continue;
        }
        if (!p.downed) {
          close(id, o, row.stood);
          continue;
        }
        o.food = p.needs.food;
        const job = live.get(id);
        if (!job) {
          o.idle++;
          continue;
        }
        o.jobs.add(job.id);
        if (job.stage === 'goto') o.goto++;
        else if (job.stage === 'carry') o.carry++;
        else o.work++;
      }

      for (const [id, job] of live) {
        if (open.has(id)) continue;
        const p = world.pawns.find((q) => q.id === id);
        // The emergency case only. `feedPatient` also fires for a patient merely
        // peckish at 0.5, and how fast lunch reaches somebody who is not dying is
        // not the question this asks.
        if (!p || p.dead || !p.downed || p.needs.food > PATIENT_EMERGENCY_FOOD) continue;
        const carrier = world.pawns.find((q) => q.jobId === job.id);
        const o: Open = {
          from: world.tick,
          goto: 0,
          carry: 0,
          work: 0,
          idle: 0,
          jobs: new Set([job.id]),
          food: p.needs.food,
          chosenRoute: 0,
          bestRoute: 0,
        };
        if (carrier) {
          const mine = nearestFood(world, carrier, job.id);
          if (mine) {
            o.chosenRoute =
              dist(carrier.x, carrier.y, mine.x, mine.y) + dist(mine.x, mine.y, p.x, p.y);
            let best = o.chosenRoute;
            for (const q of world.pawns) {
              if (!couldCarry(world, q, p)) continue;
              const f = nearestFood(world, q, job.id);
              if (!f) continue;
              const route = dist(q.x, q.y, f.x, f.y) + dist(f.x, f.y, p.x, p.y);
              if (route < best) best = route;
            }
            o.bestRoute = best;
          }
        }
        open.set(id, o);
      }

      if (livingColonists(world).length === 0) break;
    }
    if (world.gameOver) break;
  }
  return row;
}

const hours = (t: number): string => ((t / TICKS_PER_DAY) * 24).toFixed(2);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const worst = (xs: number[]): number => (xs.length === 0 ? 0 : Math.max(...xs));

console.log(`dispatch to meal, ${days} days, unmanaged`);
console.log('run                fed  worst   mean | died  stood  rejob | goto  carry   work   idle');
const rows: Row[] = [];
for (const difficulty of difficulties) {
  for (const seed of seeds) {
    const r = measure(seed, difficulty);
    rows.push(r);
    const legs = r.goto + r.carry + r.work + r.idle || 1;
    const pct = (n: number): string => ((n / legs) * 100).toFixed(0).padStart(5) + '%';
    console.log(
      r.label.padEnd(19) +
        String(r.fed.length).padStart(3) +
        hours(worst(r.fed)).padStart(7) +
        hours(mean(r.fed)).padStart(7) +
        ' |' +
        String(r.died.length).padStart(5) +
        String(r.stood.length).padStart(7) +
        String(r.rejobs).padStart(7) +
        ' |' +
        pct(r.goto) +
        pct(r.carry) +
        pct(r.work) +
        pct(r.idle),
    );
  }
}

console.log('');
console.log('the route nobody compares: carrier→food→patient, in cells, at dispatch');
console.log('run                  n   chosen     best   on the table');
for (const r of rows) {
  if (r.chosen.length === 0) continue;
  const c = mean(r.chosen);
  const b = mean(r.best);
  console.log(
    r.label.padEnd(19) +
      String(r.chosen.length).padStart(3) +
      c.toFixed(1).padStart(9) +
      b.toFixed(1).padStart(9) +
      (c === 0 ? '' : `   ${(((c - b) / c) * 100).toFixed(0)}%`).padStart(15),
  );
}
