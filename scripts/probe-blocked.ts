/**
 * Which guard actually ends an emergency meal, and why nobody is carrying one.
 *
 * `scripts/probe-churn.ts` classified every dispatch to a dying settler by what
 * changed on the tick the job vanished, and the answer on harsh/7 was 32 of 60
 * endings in the residual bucket — carrier alive and upright, meal still in the
 * world, patient still on the floor and still starving. That bucket has exactly
 * one door: `walkTo` returned `'blocked'` and `feedPatient` cancelled.
 *
 * `walkTo` says `'blocked'` for four different reasons and they want four
 * different fixes:
 *
 *   solid    `exact` and the target cell is not walkable — the `goto` leg asks to
 *            stand *on* the food stack, so a stack under a finished wall, or on a
 *            lake the thaw has re-opened, kills every dispatch that names it
 *   noadj    no adjacent stand cell — the `carry` leg, patient boxed in
 *   nopath   `findPath` came back null — different region, genuinely unreachable
 *   lost     the path was live and `followPath` dropped it mid-walk. Two causes,
 *            and `movement.ts` calls both a re-path: a wall built across the route
 *            ("re-path rather than tunnel"), or `pawn.stuck > 25` from jostling.
 *            `walkTo` turns that dropped path into `'blocked'` on the same tick,
 *            before it can re-path, and every caller reads `'blocked'` as final.
 *
 * The other half of the clock is idleness: `probe-carry.ts` found 58% of the
 * ticks a dying settler spent waiting on harsh/99001 had no live job at all,
 * even though `sendSomebodyToFeed` re-asks every single tick. So the second
 * census below stands where that function stands and records which gate sent it
 * home — no eligible carrier (and which gate rejected the last plausible one) or
 * an empty pantry.
 *
 * Not in the build, not under `src/sim` or `src/eval`, so it does not move the
 * fingerprint. Reads the world and writes nothing.
 *
 *   npx rolldown scripts/probe-blocked.ts --format esm --platform node -d .eval/build/blocked
 *   node .eval/build/blocked/probe-blocked.js [days]
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { dist, isWalkable, adjacentStandCells } from '../src/sim/grid';
import { findPath } from '../src/sim/path';
import { reachable, PATIENT_EMERGENCY_FOOD } from '../src/sim/jobs';
import { TICKS_PER_DAY, packCell, type Difficulty, type World, type Pawn } from '../src/sim/types';

const days = Number(process.argv[2] ?? 60);
const seeds = [7, 99001, 424242, 1312, 20260729];
const difficulties: Difficulty[] = ['harsh'];

const NEVER_INTERRUPTED = ['flee', 'rescue', 'feedPatient', 'caravan', 'campaign'];

type Why = 'solid' | 'noadj' | 'nopath' | 'lost' | 'unknown';
const WHYS: Why[] = ['solid', 'noadj', 'nopath', 'lost', 'unknown'];

/** Why `sendSomebodyToFeed` sent itself home on a tick nobody was carrying. */
type Quiet = 'asleep' | 'peckish' | 'busy' | 'unreachable' | 'drafted' | 'nofood' | 'other';
const QUIETS: Quiet[] = ['asleep', 'peckish', 'busy', 'unreachable', 'drafted', 'nofood', 'other'];

type Seen = {
  patient: number;
  carrier: number | null;
  stage: string;
  /** Where the leg was walking, and whether it had a route last tick. */
  tx: number;
  ty: number;
  hadPath: boolean;
  stuck: number;
  food: number;
};

/** `findFoodStack`'s scoring, copied — it is not exported. */
function anyFood(world: World, from: Pawn): boolean {
  for (const s of world.items) {
    if (s.carriedBy !== null || s.reservedBy !== null) continue;
    if (s.kind !== 'meal' && s.kind !== 'rawfood') continue;
    if (reachable(world, from, s.x, s.y, false)) return true;
  }
  return false;
}

function measure(
  seed: number,
  difficulty: Difficulty,
): { label: string; why: Map<Why, number>; stages: Map<string, number>; quiet: Map<Quiet, number>; idle: number } {
  const world = createWorld(seed, difficulty);
  const streams = makeStreams(world);
  const why = new Map<Why, number>(WHYS.map((w) => [w, 0]));
  const stages = new Map<string, number>();
  const quiet = new Map<Quiet, number>(QUIETS.map((q) => [q, 0]));
  let idle = 0;
  let seen = new Map<number, Seen>();

  for (let day = 1; day <= days; day++) {
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      stepWorld(world, streams);

      const now = new Map<number, Seen>();
      const claimed = new Set<number>();
      for (const j of world.jobs) {
        if (j.kind !== 'feedPatient' || j.targetPawnId == null) continue;
        claimed.add(j.targetPawnId);
        const carrier = world.pawns.find((q) => q.jobId === j.id);
        const patient = world.pawns.find((q) => q.id === j.targetPawnId);
        const stage = String(j.stage);
        let tx = 0;
        let ty = 0;
        if (stage === 'goto') {
          const food = world.items.find((s) => s.id === j.itemId);
          tx = food?.x ?? -1;
          ty = food?.y ?? -1;
        } else if (patient) {
          tx = Math.round(patient.x);
          ty = Math.round(patient.y);
        }
        now.set(j.id, {
          patient: j.targetPawnId,
          carrier: carrier?.id ?? null,
          stage,
          tx,
          ty,
          hadPath: !!carrier?.path && carrier.path.length > 0,
          stuck: carrier?.stuck ?? 0,
          food: patient?.needs.food ?? 0,
        });
      }

      for (const [id, was] of seen) {
        if (now.has(id)) continue;
        const p = world.pawns.find((q) => q.id === was.patient);
        // The residual bucket `probe-churn.ts` named, and only it: patient alive,
        // still down, still starving, carrier still on their feet, meal still
        // somewhere. Everything else ends the errand for a reason that is not a
        // route.
        if (!p || p.dead || !p.downed) continue;
        if (was.food > PATIENT_EMERGENCY_FOOD || p.needs.food > was.food + 0.001) continue;
        const carrier = was.carrier === null ? null : world.pawns.find((q) => q.id === was.carrier);
        if (!carrier || carrier.dead || carrier.downed) continue;

        stages.set(was.stage, (stages.get(was.stage) ?? 0) + 1);
        const exact = was.stage === 'goto';
        let w: Why = 'unknown';
        if (was.tx < 0) {
          w = 'unknown';
        } else if (exact && !isWalkable(world, was.tx, was.ty)) {
          w = 'solid';
        } else {
          const goals = new Set<number>();
          if (exact) {
            goals.add(packCell(world, was.tx, was.ty));
          } else {
            for (const c of adjacentStandCells(world, was.tx, was.ty)) goals.add(packCell(world, c.x, c.y));
            if (isWalkable(world, was.tx, was.ty)) goals.add(packCell(world, was.tx, was.ty));
          }
          if (goals.size === 0) w = 'noadj';
          else {
            const route = findPath(
              world,
              Math.round(carrier.x),
              Math.round(carrier.y),
              was.tx,
              was.ty,
              { goals },
            );
            // A route exists now and the leg had one a tick ago, so the leg did
            // not fail to find one — `followPath` threw the one it had away.
            w = route ? (was.hadPath ? 'lost' : 'unknown') : 'nopath';
          }
        }
        why.set(w, why.get(w)! + 1);
      }

      // The other census: a settler dying on the floor with nobody carrying.
      for (const p of world.pawns) {
        if (p.dead || !p.downed || p.faction !== 'colony') continue;
        if (p.needs.food > PATIENT_EMERGENCY_FOOD || claimed.has(p.id)) continue;
        idle++;
        // Walk the candidates the way `sendSomebodyToFeed` walks them and keep the
        // gate that turned away the *nearest* plausible carrier — the one whose
        // refusal actually cost this tick.
        let bestD = Infinity;
        let reason: Quiet = 'other';
        for (const q of world.pawns) {
          if (q.id === p.id || q.dead || q.downed || q.faction !== 'colony' || q.playerControlled) continue;
          if (q.manual || q.priorities.doctor <= 0) continue;
          const d = dist(q.x, q.y, p.x, p.y);
          if (d >= bestD) continue;
          let r: Quiet | null = null;
          if (q.drafted) r = 'drafted';
          else if (q.needs.food <= PATIENT_EMERGENCY_FOOD) r = 'peckish';
          else if (q.activity === 'sleeping') r = 'asleep';
          else {
            const busy = world.jobs.find((j) => j.id === q.jobId);
            if (busy && NEVER_INTERRUPTED.includes(busy.kind)) r = 'busy';
            else if (!reachable(world, q, Math.round(p.x), Math.round(p.y), true)) r = 'unreachable';
            else if (!anyFood(world, q)) r = 'nofood';
          }
          if (r === null) {
            // Eligible on every gate — the pass would have sent them, so this tick
            // is not a refusal at all. Leave it to `other`.
            continue;
          }
          bestD = d;
          reason = r;
        }
        quiet.set(reason, quiet.get(reason)! + 1);
      }

      seen = now;
    }
    if (world.gameOver) break;
  }
  return { label: `${difficulty}/${seed}`, why, stages, quiet, idle };
}

const rows = [];
for (const difficulty of difficulties) {
  for (const seed of seeds) rows.push(measure(seed, difficulty));
}

console.log(`why a blocked meal was blocked, ${days} days, unmanaged`);
console.log('run                ' + WHYS.map((w) => w.padStart(9)).join('') + '   |  goto  carry   work');
for (const r of rows) {
  console.log(
    r.label.padEnd(19) +
      WHYS.map((w) => String(r.why.get(w)).padStart(9)).join('') +
      '   |' +
      String(r.stages.get('goto') ?? 0).padStart(6) +
      String(r.stages.get('carry') ?? 0).padStart(7) +
      String(r.stages.get('work') ?? 0).padStart(7),
  );
}

console.log('');
console.log(`ticks a dying settler had nobody carrying, and the gate that cost it`);
console.log('run                    idle' + QUIETS.map((q) => q.padStart(12)).join(''));
for (const r of rows) {
  const pct = (n: number): string =>
    (r.idle === 0 ? '0%' : `${((n / r.idle) * 100).toFixed(0)}%`).padStart(12);
  console.log(
    r.label.padEnd(19) + String(r.idle).padStart(8) + QUIETS.map((q) => pct(r.quiet.get(q)!)).join(''),
  );
}
