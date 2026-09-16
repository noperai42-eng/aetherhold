# CURRENT_WORK — resume pointer

Read this first at session start. It says where the work stands and what the next
action is. Everything durable lives in the files it points at; this page is a map, not
a copy.

**Updated:** 2026-09-16 · branch `colony-death-spiral`, `main` merged through PR #12.

---

## Where it stands

A pass at the simulator, the feel of the driven body and the frame. The rounds are
listed in `PLAN.md` in the order they are meant to be taken; `SEGMENT_STATUS.md` is the
status table and `INBOX.md` the rolling log. One round, one measured gap, one fix
(`METHODOLOGY.md`); a round ends with a `ROUND_NOTES.md` entry and, if a player could
see the change, an `ACCEPTANCE.md` row.

Six rounds are merged: `3a-sim-pin-build-rate` (the build-rate and idle pins),
`3b-sim-probe-why` (the per-tick dispatch probe), `0-hud-escape-html`, `1a-feel-trace`,
`1e-feel-interp-phase`, `3e-measure-label`.

**What 3b found, and it decides what happens next.** Sampling every tick across twenty
arms, dispatch is *not* the gap — `idleTakeableShare` is 1.09% against an
`idleBoardShare` of 10.60%, and the `ASSIGN_INTERVAL` cadence declines 85% of the times
it fires on an idle pawn because there is genuinely nothing takeable. Nor is the
Steward's rule 4: marking-wait with an idle takeable hand standing by is 5.9%
colony-wide, worst arm 17.4%. What the probe does name is **hauling** — haul time meets
or beats build time in 18 of the 19 ambitions the Steward opened, and hauling costs
17.91% of every day. The round note is `ROUND_NOTES.md`, "The Steward isn't the
bottleneck; the cart is"; the instrument is `scripts/probe-dispatch.ts`.

## Next action

`3c-sim-fix-dispatch` — one fix against the 3a pin, in the **haul-vs-build ordering in
`src/sim/jobs.ts`'s `assignJob`**, not in the `tick.ts` cadence its PLAN.md text was
written against (3b ruled that out). Red-first unit test; the pin moves by a literal
(`idleTakeableShare` down and/or `roomsPerDay` up) or the round is recorded as
"measured, not the gap" with numbers and no code change.

It re-measures the grid, so before starting: all `src/` edits land first, then
`npm run measure` (about 100 minutes — run it detached to a log, nothing else on the
box), then `npm run balance`, then re-commit `.eval/measurements.json`. `src/eval/run.ts`
is fingerprinted; `tests/measurements.test.ts` fails if the grid on disk no longer
describes the sim on disk.

After 3c: `3d-sim-fix-steward` (likely a recorded no-op — 3b did not show rule 4 as the
ceiling), `3e-fix-label`, then the body rounds (`1b`, `1c`, `1d`) and the frame and look
rounds (`2a`–`2e`). The box is a serial resource: the suite runs alone, `measure` runs
alone, and GPU timing wants no contention.
