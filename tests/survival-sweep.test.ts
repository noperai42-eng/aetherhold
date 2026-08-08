/**
 * The long look: five seeds, thirty days each, nobody at the controls but the
 * Steward. This is the test that catches balance rot the eight-day gate cannot
 * see — starvation cliffs, escalation the colony never catches up to, and the
 * raid stalemate that used to wipe three of these five colonies outright.
 *
 * It is slow by nature (180 simulated days), so it runs on demand — `npm run
 * sweep` — rather than on every `npm test`. Run it after touching needs, jobs,
 * combat, the storyteller or the Steward.
 *
 * Every run here plays past its founding. Most of these colonies close their
 * charter inside the month, and a long look that stopped there would be a
 * three-week look on the seeds that did best.
 */

import { describe, expect, it } from 'vitest';

import { formatReport, runColony } from '../src/eval/run';

const SEEDS = [20260729, 7, 1312, 99001, 424242];

/** The repo has no @types/node; this is the one thing the sweep needs from it. */
declare const process: { env: Record<string, string | undefined> };

describe.runIf(process.env.SWEEP)('30-day survival sweep', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed} keeps the colony standing`, () => {
      // Past the founding, because the whole month is what this file claims to
      // look at. Four of these five seeds close their charter around day 23-27
      // with the Steward driving, and while the harness stopped there they were
      // asserting `last.day === 30` against a run that ended on day 27 — red for
      // as long as that was true, and unnoticed because the gate is opt-in.
      const r = runColony({ seed, days: 30, playPastFounding: true });
      console.log(formatReport(r));
      expect(r.verdict).not.toBe('collapsed');
      const last = r.snapshots[r.snapshots.length - 1]!;
      expect(last.day).toBe(30);
      // Alive is not enough: a colony ending the month with no food and nobody
      // upright is a wipe that has not finished happening yet.
      expect(last.alive).toBeGreaterThan(0);
      expect(last.foodDays).toBeGreaterThan(1);
      // 144,000 ticks of real simulation each. Vitest's 5-second default is a
      // limit for unit tests, not for a month of colony life.
      //
      // Two minutes was the budget while these runs stopped at their charter,
      // and playing the rest of the month blew through all five: 126s to 322s
      // measured. Days past the founding are not the days before it — the
      // colony roughly doubles, so the back half of the month costs more per
      // day than the front half did.
    }, 600_000);
  }

  it('plays out the rest of the clock once the colony has founded', () => {
    // The stage in one assertion. Until `playPastFounding` existed the loop
    // broke on `hasWon`, so a colony that founded on day 23 of 30 was measured
    // for 23 days and the last week did not exist — which is why every number
    // the game has about itself describes the first act and nothing after it.
    //
    // Calm because it founds earliest, which is what leaves days on the far side
    // of the founding for this to be a test of.
    const r = runColony({ seed: SEEDS[0], days: 30, difficulty: 'calm', playPastFounding: true });
    console.log(formatReport(r));
    expect(r.foundedOn, `never founded inside 30 days — ${r.summary}`).not.toBeNull();
    expect(r.foundedOn!, 'founded on the last day, so nothing was played past').toBeLessThan(30);
    expect(r.snapshots.length, `stopped on day ${r.snapshots.length} — ${r.summary}`).toBe(30);
    // Reported, not ruled on: a run that keeps playing has to be judged by how
    // it ends. `charter.won` is a latch, so a colony that founds and later
    // starves would otherwise come back thriving.
    expect(r.summary).toContain(`founded on day ${r.foundedOn}`);
    // Five times the other runs' budget for the same thirty days: a founded
    // colony is a bigger one, so the days past the charter cost more to play
    // than the days before it. Measured at 300s and still going.
  }, 600_000);
});
