/**
 * `3e-measure-label` — reproducing "nothing fun to do" before anyone touches it.
 *
 * The label itself is not broken: `needs.ts:553-556` already splits the row on
 * `pawn.jobId === null`, and `tests/morale.test.ts:494-517` pins that split held
 * in isolation. What is still unmeasured is whether a *player*, watching a real
 * colony, can see the row fire on a settler who is not idle — because
 * `moodBreakdown` only ever asks one question (is `jobId` null) and the sim
 * clears `jobId` for reasons that have nothing to do with recreation.
 *
 * This file drives a real colony, tick by tick, and records every tick the row
 * reads `nothing fun to do` against `isIdlePawn` — `src/eval/run.ts:403`, the
 * literal predicate `3a-sim-pin-build-rate` pinned as "idle" for the grid. Two
 * trips are driven, both job → idle → job on the same settler:
 *
 * - The ordinary one: a settler finishes a job and waits out the
 *   `ASSIGN_INTERVAL` gap (`tick.ts:112`, `:354`) before the next one is
 *   handed to them. The row fires here, and `isIdlePawn` agrees — this settler
 *   really is idle, so it is not the sighting the player quoted.
 * - The drafted one: `setDrafted` (`src/sim/orders.ts:374-389`) cancels the
 *   job and clears `jobId` the instant the player presses T, and never sets it
 *   again for as long as the settler stays drafted — `tick.ts:316` skips the
 *   whole job/idle pass for a drafted pawn. `isIdlePawn` excludes drafted
 *   settlers on purpose (`run.ts:405`); `moodBreakdown` never asks. The row
 *   fires on every one of those ticks, and this time `isIdlePawn` says no.
 *
 * `3e-measure-label` named the branch and left it open; `3e-fix-label` closed
 * it at `needs.ts:554`, and the drafted literal below moved from 4800 to 0.
 * Both trips are kept exactly as they were driven — the fix had to close the
 * drafted one without disturbing the ordinary gap, and this file is what says
 * so.
 */

import { describe, expect, it } from 'vitest';

import { isIdlePawn } from '../src/eval/run';
import { moodBreakdown } from '../src/sim/needs';
import { setDrafted } from '../src/sim/orders';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { TICKS_PER_DAY, type Job, type Pawn, type World } from '../src/sim/types';
import { livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

/** The one row this round is about, read straight off the real panel data. */
function recreationLabel(pawn: Pawn): string | null {
  const row = moodBreakdown(pawn).find(
    (f) => f.label === 'nothing fun to do' || f.label === 'tired of working',
  );
  return row?.label ?? null;
}

interface Sighting {
  tick: number;
  label: string;
  jobId: number | null;
  drafted: boolean;
  manual: boolean;
  activity: Pawn['activity'];
  jobKind: Job['kind'] | null;
  /** `isIdlePawn`, called live against this tick's real world/pawn. */
  idleBy3a: boolean;
}

/** Every field the goal asked this round to record, for one tick. */
function sightingOf(world: World, pawn: Pawn, label: string): Sighting {
  const job = pawn.jobId !== null ? world.jobs.find((j) => j.id === pawn.jobId) : undefined;
  return {
    tick: world.tick,
    label,
    jobId: pawn.jobId,
    drafted: pawn.drafted,
    manual: pawn.manual ?? false,
    activity: pawn.activity,
    jobKind: job?.kind ?? null,
    idleBy3a: isIdlePawn(world, pawn),
  };
}

describe('reproducing "nothing fun to do" before touching it (3e-measure-label)', () => {
  it('drives a settler job -> idle -> job on the ASSIGN_INTERVAL gap alone, seed 20260801: the row fires but isIdlePawn agrees every time', () => {
    const world = createWorld(20260801);
    const streams = makeStreams(world);
    const p = livingColonists(world)[0]!;
    const id = p.id;

    // A day of ordinary running first: worldgen starts recreation at 1, and
    // the row is silent (`amount !== 0` gate in `needs.ts`'s `put`) until it
    // has drained under that once. This is the sim doing it on its own — no
    // need is set by hand anywhere in this file.
    for (let i = 0; i < TICKS_PER_DAY; i++) stepWorld(world, streams);
    expect(livingColonists(world).find((q) => q.id === id)!.needs.recreation).toBeLessThan(1);

    const sightings: Sighting[] = [];
    let sawJob = false;
    let sawGapAfterJob = false;
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      stepWorld(world, streams);
      const pawn = livingColonists(world).find((q) => q.id === id)!;
      if (pawn.jobId !== null) sawJob = true;
      const label = recreationLabel(pawn);
      if (label === 'nothing fun to do') {
        if (sawJob) sawGapAfterJob = true;
        sightings.push(sightingOf(world, pawn, label));
      }
    }

    // The job -> idle -> job trip actually happened today, not asserted on
    // faith: this settler held a job, then was seen with the row lit, in
    // that order, on the same tracked id.
    expect(sawJob).toBe(true);
    expect(sawGapAfterJob).toBe(true);

    // The literal, as it is: on this seed, this settler, this day, the row
    // fires this many ticks. Every sighting the ASSIGN_INTERVAL gap produces
    // is drafted: false, manual: false, activity: 'idle' or 'walking',
    // jobId: null, jobKind: null.
    expect(sightings.length).toBe(293);
    expect(sightings.every((s) => !s.drafted && !s.manual)).toBe(true);
    expect(sightings.every((s) => s.jobId === null && s.jobKind === null)).toBe(true);

    // And every single one of those ticks, `isIdlePawn` — the literal
    // predicate `3a-sim-pin-build-rate` pinned, called live each tick above —
    // agreed this settler really was idle. The ASSIGN_INTERVAL gap is not
    // the mismatch the player saw.
    expect(sightings.every((s) => s.idleBy3a)).toBe(true);
  });

  it('closes the branch: setDrafted clears jobId and never sets it back, and the row now reads tired of working on a drafted settler — every tick, all day', () => {
    const world = createWorld(20260801);
    const streams = makeStreams(world);
    const p = livingColonists(world)[0]!;
    const id = p.id;

    for (let i = 0; i < TICKS_PER_DAY; i++) stepWorld(world, streams);

    // Leg one of the trip: run until this settler is actually holding real
    // work — not a `recreate` job, which `isIdlePawn` (rightly) still calls
    // idle — so drafting interrupts real work, not a settler already sat
    // down at the table `idle.ts` sent them to.
    let pawn = livingColonists(world).find((q) => q.id === id)!;
    let job = pawn.jobId !== null ? world.jobs.find((j) => j.id === pawn.jobId) : undefined;
    let ticksToJob = 0;
    while ((pawn.jobId === null || job?.kind === 'recreate') && ticksToJob < TICKS_PER_DAY) {
      stepWorld(world, streams);
      pawn = livingColonists(world).find((q) => q.id === id)!;
      job = pawn.jobId !== null ? world.jobs.find((j) => j.id === pawn.jobId) : undefined;
      ticksToJob++;
    }
    expect(pawn.jobId).not.toBeNull();
    expect(job?.kind).not.toBe('recreate');
    expect(isIdlePawn(world, pawn)).toBe(false);

    // Leg two: the player drafts them. `setDrafted` cancels the job outright
    // (`orders.ts:383`) — this is not the ASSIGN_INTERVAL gap, it is instant.
    setDrafted(world, id, true);
    pawn = livingColonists(world).find((q) => q.id === id)!;
    expect(pawn.jobId).toBeNull();
    expect(pawn.drafted).toBe(true);
    // 3a's own predicate already calls this settler not-idle for exactly the
    // reason the mood row is blind to.
    expect(isIdlePawn(world, pawn)).toBe(false);

    const sightings: Sighting[] = [];
    let mismatches = 0;
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      stepWorld(world, streams);
      pawn = livingColonists(world).find((q) => q.id === id)!;
      // tick.ts:316 skips the whole job/idle pass for a drafted pawn, so
      // nothing in the sim ever sets jobId again while this holds.
      expect(pawn.jobId).toBeNull();
      const label = recreationLabel(pawn);
      if (label !== null) sightings.push(sightingOf(world, pawn, label));
      if (label === 'nothing fun to do') mismatches++;
    }

    // The literal `3e-measure-label` pinned, and the one `3e-fix-label` moved
    // it to. It read 4800 of 4800 mismatches: `needs.ts:554` asked
    // `jobId === null` and nothing else, so a drafted settler was told they
    // had nothing fun to do for every tick of the draft, while `run.ts:405`
    // (`isIdlePawn`) excluded `pawn.drafted` first and called them not-idle.
    // It now reads 0.
    expect(mismatches).toBe(0);

    // The row still fires every one of those ticks, and that is the point of
    // keeping the count here rather than deleting it: the recreation need is
    // real, the amount never depended on the words, and a fix that silenced
    // the row would have changed the settler's mood instead of the sentence.
    expect(sightings.length).toBe(TICKS_PER_DAY);
    expect(sightings.every((s) => s.label === 'tired of working')).toBe(true);
    expect(sightings.every((s) => s.drafted && s.jobId === null)).toBe(true);

    // `isIdlePawn` still says not-idle every tick — it always was right. What
    // changed is that the mood row agrees with it now.
    expect(sightings.every((s) => s.idleBy3a === false)).toBe(true);

    // Leg three, closing the trip: undraft, and the colony hands them a job
    // again within the ordinary assignment cadence — job -> idle -> job.
    setDrafted(world, id, false);
    pawn = livingColonists(world).find((q) => q.id === id)!;
    expect(pawn.drafted).toBe(false);
    let ticksToReassign = 0;
    while (pawn.jobId === null && ticksToReassign < TICKS_PER_DAY) {
      stepWorld(world, streams);
      pawn = livingColonists(world).find((q) => q.id === id)!;
      ticksToReassign++;
    }
    expect(pawn.jobId).not.toBeNull();
    expect(ticksToReassign).toBeLessThanOrEqual(12);
  });
});
