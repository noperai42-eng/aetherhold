/**
 * Why is a hand standing still, tick by tick, before anyone touches a fix.
 *
 * `probe-buildout` counts what got raised; `probe-boardclear` counts how much
 * of a day the board stood empty. Neither says *why* a colonist was idle while
 * the board was not — the question `3c-sim-fix-dispatch` and `3d-sim-fix-steward`
 * both need answered before either spends a change. This probe samples every
 * tick (never once a day — Aetherhold's day boundary is 07:12 and a daily
 * snapshot reads reserved items as absent) across five seeds, both the
 * `settler` and `harsh` difficulty arms (the two this pass's rounds already
 * name; `calm` is a Next brief, trivial to add if it is ever asked for), and
 * the foreman on and off (`setSteward`), and breaks the two 3a idle counters
 * down four ways:
 *
 *  1. **`idleReason`** (`src/sim/idle.ts`) — the one sentence the HUD would
 *     show a player, bucketed by which branch produced it.
 *  2. **What the `ASSIGN_INTERVAL` = 12 cadence delivered** when it fired for
 *     a pawn that was idle going in (`tick.ts:112`, `:354`): a real job
 *     (`took-work`), a recreate job assigned because rest was critical
 *     (`break-need`, `needs.BORED` = 0.24), a recreate job assigned because
 *     nothing else was found (`takeABreak`, `IDLE_REC` = 0.75 —
 *     `jobs.ts:2468`), nothing at all (`declined`), or the hand-driven path
 *     (`assignNeedsOnly`, manual). Ticks where the pawn is idle but the
 *     cadence has not hit yet, or a queued job pre-empted it, are their own
 *     buckets.
 *  3. **Whether `planAhead` ran or was gated by `anyoneIdle`** (`jobs.ts:415`)
 *     on the `PLAN_INTERVAL` = 48 cadence for a *busy* pawn.
 *  4. **Which of the Steward's three gates returned, or which ambition
 *     marked**, on every `STEWARD_INTERVAL` pass (`steward.ts`, imported —
 *     it is the one cadence constant this file does not have to copy):
 *     `boardStarved` (`:2134`), `!playerClear` (`:2143`), `stewardLoad > 0`
 *     (`:2168`), or a named ambition off `world.stewardCursor`. Each tick an
 *     ambition is open (attributed to `world.stewardLast`, the same field
 *     `probe-boardclear` reads — `bySteward` is a flat boolean and does not
 *     keep per-ambition attribution, so this is "what the Steward is
 *     narrating", not a ledger) is bucketed `blocked` (hostiles, sleep hours,
 *     or the colony starved of a material), `build`, `haul`
 *     (`haulToBlueprint`), or `marking-wait` — nobody hauling or building
 *     toward a blueprint despite nothing blocking it. `stewardLoad > 0` is
 *     rule 4, "one ambition at a time" — the file's own header says so, and
 *     it is a design choice, not a bug. Whether `marking-wait` carries idle,
 *     takeable hands *while* rule 4 holds the board shut is the number that
 *     answers whether it is the ceiling.
 *
 * Two rules a probe has to keep to be worth trusting (METHODOLOGY.md
 * "Probes"): sample every tick, and vary what reality varies — five seeds,
 * two difficulties, both foreman settings, never one pinned input standing
 * in for all of them.
 *
 * `boardStarved` and `anyoneIdle` are not exported from `src/sim` (only
 * `playerClear`, `stewardLoad`, `missingResource`, `countResource` and
 * `STEWARD_INTERVAL` are), so this file carries read-only mirrors of both,
 * cited at the line they copy. They are not sim code and never run inside a
 * colony — a probe reproducing a gate it cannot import is the same trade
 * `probe-boardclear.ts`'s own `clear()` already makes.
 *
 * Not under `src/sim` or `src/eval`, so it does not move the fingerprint.
 * Built and run, never interpreted — there is no `tsx` dependency
 * (METHODOLOGY.md, package.json has none):
 *
 *   npx rolldown scripts/probe-dispatch.ts --format esm --platform node -d .eval/build
 *   node .eval/build/probe-dispatch.js [days] [seed...]
 */

import { STEWARD_INTERVAL, playerClear, stewardLoad, setSteward, AMBITIONS } from '../src/sim/steward';
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { livingColonists, hostiles, countResource } from '../src/sim/world';
import { isSleepHours } from '../src/sim/clock';
import { missingResource } from '../src/sim/jobs';
import { isBreaking, BORED } from '../src/sim/needs';
import { idleReason } from '../src/sim/idle';
import { isIdlePawn, boardOpen, takeableTargets, hasTakeableWork } from '../src/eval/run';
import { DESIG_NONE, TICKS_PER_DAY, type Difficulty, type Pawn, type World } from '../src/sim/types';

const days = Number(process.argv[2] ?? 40);
const seeds = process.argv.slice(3).map(Number);
const SEEDS = seeds.length > 0 ? seeds : [7, 1312, 4242, 99001, 424242];
/** The two difficulty arms this pass's own rounds already name; see the header. */
const ARM_DIFFICULTIES: Difficulty[] = ['settler', 'harsh'];

/** `tick.ts:112` — not exported, so copied and cited rather than guessed at. */
const ASSIGN_INTERVAL = 12;
/** `tick.ts:120` (`ASSIGN_INTERVAL * 4`). */
const PLAN_INTERVAL = ASSIGN_INTERVAL * 4;
/** `jobs.ts:2468`'s own literal — not exported. */
const IDLE_REC = 0.75;

// --- Read-only mirrors of two sim gates that are not exported. Both are pure
// reads of world state; neither is called from inside a colony. ---

/** Mirrors `steward.ts:2103-2113` (`boardStarved`, not exported). */
function boardStarvedProbe(world: World): boolean {
  for (let i = 0; i < world.cellDesig.length; i++) {
    if (world.cellDesig[i] !== DESIG_NONE) return false;
  }
  for (const b of world.buildings) {
    if (b.built) continue;
    const missing = missingResource(b);
    if (missing && countResource(world, missing.kind) === 0) return true;
  }
  return false;
}

/** Mirrors `jobs.ts:389-396` (`anyoneIdle`, not exported). */
function anyoneIdleProbe(world: World, except: Pawn): boolean {
  for (const p of world.pawns) {
    if (p.id === except.id || p.faction !== 'colony') continue;
    if (p.dead || p.downed || p.drafted || p.manual || p.playerControlled) continue;
    if (p.jobId === null && p.activity !== 'sleeping') return true;
  }
  return false;
}

/** The denominator `isIdlePawn`'s own exclusions imply — not itself exported. */
function isAwakeColonist(pawn: Pawn): boolean {
  return (
    pawn.faction === 'colony' &&
    !pawn.dead &&
    !pawn.downed &&
    !pawn.drafted &&
    !pawn.manual &&
    pawn.activity !== 'sleeping' &&
    !isBreaking(pawn)
  );
}

/** Buckets `idleReason`'s sentence by which branch produced it (idle.ts:139-194). */
function classifyIdleReason(reason: string | null): string {
  if (reason === null) return 'resting/no-signal';
  if (reason === 'every kind of work is switched off in their Work tab.') return 'all-work-off';
  if (reason.startsWith('the blueprints are short ')) return 'short-on-resource';
  if (reason === 'they cannot reach any of the blueprints from where they are standing.') return 'unreachable-blueprints';
  if (reason.endsWith('but building is switched off for them.')) return 'construct-off';
  if (reason.startsWith('only ') && reason.endsWith('switched on for them.')) return 'narrow-worklist';
  if (reason === 'nothing on the board they can take — put up a blueprint, or set a bill at a bench.') return 'nothing-takeable';
  // A canary: idleReason grew a branch this classifier does not know about.
  return 'other';
}

function tally(): Record<string, number> {
  return {};
}
function bump(t: Record<string, number>, key: string, n = 1): void {
  t[key] = (t[key] ?? 0) + n;
}
function sum(t: Record<string, number>): number {
  return Object.values(t).reduce((a, b) => a + b, 0);
}
function fmtTally(t: Record<string, number>): string {
  const total = sum(t);
  if (total === 0) return '-';
  return Object.entries(t)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${Math.round((n / total) * 100)}%`)
    .join(', ');
}

interface DayRow {
  day: number;
  awakeTicks: number;
  idleBoardTicks: number;
  idleTakeableTicks: number;
  haulTicks: number;
}

interface ArmResult {
  seed: number;
  difficulty: Difficulty;
  foreman: boolean;
  days: DayRow[];
  reasonTally: Record<string, number>;
  cadenceTally: Record<string, number>;
  planAheadTally: Record<string, number>;
  stewardGateTally: Record<string, number>;
  ambitionTicks: Record<string, Record<string, number>>;
  /** `marking-wait` ticks under an open ambition where a hand had takeable work and stood idle anyway. */
  markingWaitIdleTakeable: number;
  markingWaitTicks: number;
}

function runArm(seed: number, difficulty: Difficulty, foreman: boolean, totalDays: number): ArmResult {
  const world = createWorld(seed, difficulty);
  setSteward(world, foreman);
  const streams = makeStreams(world);

  const result: ArmResult = {
    seed,
    difficulty,
    foreman,
    days: [],
    reasonTally: tally(),
    cadenceTally: tally(),
    planAheadTally: tally(),
    stewardGateTally: tally(),
    ambitionTicks: {},
    markingWaitIdleTakeable: 0,
    markingWaitTicks: 0,
  };

  for (let d = 0; d < totalDays; d++) {
    const row: DayRow = { day: d, awakeTicks: 0, idleBoardTicks: 0, idleTakeableTicks: 0, haulTicks: 0 };

    for (let t = 0; t < TICKS_PER_DAY; t++) {
      const nextTick = world.tick + 1;

      // Pre-tick snapshot for the ASSIGN_INTERVAL cadence: which idle pawns
      // will hit the cadence line this tick, and their state going in.
      const cadenceCandidates: { pawn: Pawn; recreation: number; hitsCadence: boolean }[] = [];
      // Pre-tick snapshot for the PLAN_INTERVAL cadence on busy pawns.
      const planCandidates: { pawn: Pawn }[] = [];
      for (const p of world.pawns) {
        if (p.faction !== 'colony' || p.dead || p.downed || p.drafted || p.playerControlled) continue;
        if (p.jobId === null) {
          if (p.activity === 'sleeping') continue;
          const queued = (p.queue?.length ?? 0) > 0;
          if (!queued && (nextTick + p.id) % ASSIGN_INTERVAL === 0) {
            cadenceCandidates.push({ pawn: p, recreation: p.needs.recreation, hitsCadence: true });
          }
        } else if (!p.manual && (nextTick + p.id) % PLAN_INTERVAL === 0) {
          if (p.activity !== 'sleeping' && !isBreaking(p)) planCandidates.push({ pawn: p });
        }
      }
      const anyoneIdlePre = new Map<number, boolean>();
      for (const c of planCandidates) anyoneIdlePre.set(c.pawn.id, anyoneIdleProbe(world, c.pawn));

      // Pre-tick snapshot for the STEWARD_INTERVAL pass, evaluated against the
      // state the tick begins in (systems that run ahead of tickSteward within
      // the same tick — weather, rebuild, stranded — can nudge these by a
      // little; see the header on why this is close enough for an instrument).
      let stewardSample: null | {
        stewardOnFlag: boolean;
        hostileCount: number;
        sleepFlag: boolean;
        livingCount: number;
        starved: boolean;
        clear: boolean;
        load: number;
        cursorBefore: number;
      } = null;
      if (nextTick % STEWARD_INTERVAL === 0) {
        stewardSample = {
          stewardOnFlag: foreman,
          hostileCount: hostiles(world).length,
          sleepFlag: isSleepHours(world),
          livingCount: livingColonists(world).length,
          starved: boardStarvedProbe(world),
          clear: playerClear(world),
          load: stewardLoad(world),
          cursorBefore: world.stewardCursor ?? 0,
        };
      }

      stepWorld(world, streams);

      // ASSIGN_INTERVAL cadence outcome.
      for (const c of cadenceCandidates) {
        const p = c.pawn;
        if (p.manual) {
          bump(result.cadenceTally, 'assignNeedsOnly(manual)');
          continue;
        }
        if (p.jobId === null) {
          bump(result.cadenceTally, 'declined');
          continue;
        }
        const job = world.jobs.find((j) => j.id === p.jobId);
        if (job?.kind === 'recreate') {
          bump(result.cadenceTally, c.recreation < BORED ? 'break-need(BORED)' : 'takeABreak(IDLE_REC)');
        } else {
          bump(result.cadenceTally, 'took-work');
        }
      }

      // PLAN_INTERVAL / anyoneIdle gate.
      for (const c of planCandidates) {
        const gated = anyoneIdlePre.get(c.pawn.id) ?? false;
        bump(result.planAheadTally, gated ? 'gated(anyoneIdle)' : 'ran');
      }

      // STEWARD_INTERVAL gate.
      if (stewardSample) {
        const s = stewardSample;
        if (!s.stewardOnFlag) {
          // foreman off: tickSteward never runs. Nothing to tally.
        } else if (s.hostileCount > 0) {
          bump(result.stewardGateTally, 'blocked(hostiles)');
        } else if (s.sleepFlag) {
          bump(result.stewardGateTally, 'blocked(sleep)');
        } else if (s.livingCount === 0) {
          bump(result.stewardGateTally, 'blocked(no-colonists)');
        } else if (s.starved) {
          bump(result.stewardGateTally, 'boardStarved');
        } else if (!s.clear) {
          bump(result.stewardGateTally, '!playerClear');
        } else if (s.load > 0) {
          bump(result.stewardGateTally, 'stewardLoad>0');
        } else {
          const cursorAfter = world.stewardCursor ?? 0;
          if (cursorAfter !== s.cursorBefore) {
            const marked = AMBITIONS[(cursorAfter - 1 + AMBITIONS.length) % AMBITIONS.length]!.id;
            bump(result.stewardGateTally, `marked(${marked})`);
          } else {
            bump(result.stewardGateTally, 'no-ambition-marked');
          }
        }
      }

      // Idle counters, idleReason breakdown, and the ambition wall-time
      // partition — every tick, per METHODOLOGY's own rule.
      const stalled = boardOpen(world);
      const targets = takeableTargets(world);
      const idleAwake: Pawn[] = [];
      let hauling = false;
      let building = false;
      for (const p of world.pawns) {
        if (!isAwakeColonist(p)) continue;
        row.awakeTicks++;
        if (isIdlePawn(world, p)) {
          idleAwake.push(p);
          bump(result.reasonTally, classifyIdleReason(idleReason(world, p)));
        } else {
          const job = world.jobs.find((j) => j.id === p.jobId);
          if (job?.kind === 'build') building = true;
          else if (job?.kind === 'haulToBlueprint' || job?.kind === 'haulToStockpile') hauling = true;
        }
      }
      if (hauling) row.haulTicks++;
      let anyTakeable = false;
      if (idleAwake.length > 0 && stalled) {
        row.idleBoardTicks += idleAwake.length;
        for (const p of idleAwake) {
          if (hasTakeableWork(world, p, targets)) {
            row.idleTakeableTicks++;
            anyTakeable = true;
          }
        }
      }

      // Ambition wall-time bucket, attributed to world.stewardLast — see the
      // header on why this is "what the Steward is narrating", not a ledger.
      if (foreman && world.stewardLast !== undefined) {
        const open = result.ambitionTicks[world.stewardLast] ?? (result.ambitionTicks[world.stewardLast] = tally());
        const blocked = hostiles(world).length > 0 || isSleepHours(world) || boardStarvedProbe(world);
        if (blocked) {
          bump(open, 'blocked');
        } else if (building) {
          bump(open, 'build');
        } else if (hauling) {
          bump(open, 'haul');
        } else {
          bump(open, 'marking-wait');
          result.markingWaitTicks++;
          if (anyTakeable) result.markingWaitIdleTakeable++;
        }
      }
    }

    result.days.push(row);
  }

  return result;
}

function printArm(r: ArmResult): void {
  console.log(`\n=== seed ${r.seed}  ${r.difficulty}  foreman ${r.foreman ? 'on' : 'off'} ===`);
  const head = ['day', 'idleBoard%', 'idleTake%', 'haul%'];
  console.log(head.map((h) => h.padStart(11)).join(''));
  for (const row of r.days) {
    const denom = Math.max(1, row.awakeTicks);
    const cells = [
      row.day,
      ((row.idleBoardTicks / denom) * 100).toFixed(1),
      ((row.idleTakeableTicks / denom) * 100).toFixed(1),
      ((row.haulTicks / TICKS_PER_DAY) * 100).toFixed(1),
    ];
    console.log(cells.map((v) => String(v).padStart(11)).join(''));
  }
  console.log(`idleReason breakdown: ${fmtTally(r.reasonTally)}`);
  console.log(`ASSIGN_INTERVAL cadence: ${fmtTally(r.cadenceTally)}`);
  console.log(`PLAN_INTERVAL/anyoneIdle: ${fmtTally(r.planAheadTally)}`);
  if (r.foreman) {
    console.log(`STEWARD_INTERVAL gate: ${fmtTally(r.stewardGateTally)}`);
    console.log('per-ambition wall time (attributed to world.stewardLast):');
    for (const [id, t] of Object.entries(r.ambitionTicks).sort((a, b) => sum(b[1]) - sum(a[1]))) {
      console.log(`  ${id.padEnd(14)} ${fmtTally(t)}`);
    }
    console.log(
      `marking-wait ticks with an idle, takeable hand standing by: ${r.markingWaitIdleTakeable} / ${r.markingWaitTicks} marking-wait ticks`,
    );
  }
}

const armResults: ArmResult[] = [];
const start = Date.now();
for (const seed of SEEDS) {
  for (const difficulty of ARM_DIFFICULTIES) {
    for (const foreman of [true, false]) {
      const armStart = Date.now();
      const r = runArm(seed, difficulty, foreman, days);
      armResults.push(r);
      printArm(r);
      console.log(`(${((Date.now() - armStart) / 1000).toFixed(1)}s)`);
    }
  }
}

// --- Grand totals across every arm, which is what the one-sentence gap is judged on. ---
const grandReason = tally();
const grandCadence = tally();
let grandAwake = 0;
let grandIdleBoard = 0;
let grandIdleTakeable = 0;
let grandHaulTicks = 0;
let grandHaulDenomTicks = 0;
let grandMarkingWait = 0;
let grandMarkingWaitIdleTakeable = 0;
const grandAmbition: Record<string, Record<string, number>> = {};
for (const r of armResults) {
  for (const [k, n] of Object.entries(r.reasonTally)) bump(grandReason, k, n);
  for (const [k, n] of Object.entries(r.cadenceTally)) bump(grandCadence, k, n);
  for (const row of r.days) {
    grandAwake += row.awakeTicks;
    grandIdleBoard += row.idleBoardTicks;
    grandIdleTakeable += row.idleTakeableTicks;
    grandHaulTicks += row.haulTicks;
    grandHaulDenomTicks += TICKS_PER_DAY;
  }
  grandMarkingWait += r.markingWaitTicks;
  grandMarkingWaitIdleTakeable += r.markingWaitIdleTakeable;
  for (const [id, t] of Object.entries(r.ambitionTicks)) {
    const g = grandAmbition[id] ?? (grandAmbition[id] = tally());
    for (const [k, n] of Object.entries(t)) bump(g, k, n);
  }
}

console.log('\n=== grand totals, every arm ===');
console.log(`idleBoardShare  ${((grandIdleBoard / Math.max(1, grandAwake)) * 100).toFixed(2)}%`);
console.log(`idleTakeableShare  ${((grandIdleTakeable / Math.max(1, grandAwake)) * 100).toFixed(2)}%`);
console.log(`share of the day hauling  ${((grandHaulTicks / Math.max(1, grandHaulDenomTicks)) * 100).toFixed(2)}%`);
console.log(`idleReason breakdown: ${fmtTally(grandReason)}`);
console.log(`ASSIGN_INTERVAL cadence: ${fmtTally(grandCadence)}`);
console.log('per-ambition wall time, foreman-on arms only, all seeds/difficulties:');
for (const [id, t] of Object.entries(grandAmbition).sort((a, b) => sum(b[1]) - sum(a[1]))) {
  console.log(`  ${id.padEnd(14)} ${fmtTally(t)}`);
}
const markingWaitIdlePct = grandMarkingWait > 0 ? (grandMarkingWaitIdleTakeable / grandMarkingWait) * 100 : 0;
console.log(
  `marking-wait ticks with an idle, takeable hand standing by: ${grandMarkingWaitIdleTakeable} / ${grandMarkingWait} (${markingWaitIdlePct.toFixed(1)}%)`,
);
console.log(`\n(${((Date.now() - start) / 1000).toFixed(1)}s total)`);
