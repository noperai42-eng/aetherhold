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

Seven rounds are taken: `3a-sim-pin-build-rate` (the build-rate and idle pins),
`3b-sim-probe-why` (the per-tick dispatch probe), `0-hud-escape-html`, `1a-feel-trace`,
`1e-feel-interp-phase`, `3e-measure-label`, and `3c-sim-fix-dispatch` — the last of them
a measured refutation that changed no sim code.

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

`3d-sim-fix-steward` — **promoted**, because 3c refuted the reading that put it second.
3c ranked raising a supplied frame above fetching for a nearer one, two ways: outright
(nine suite failures — `roomsPerDay` to nothing, no turret in three weeks, the Steward's
fence stuck at its first batch of eight, a month-old colony with no wood left) and bounded
by the shorter walk (six failures — enclosures and turrets back, `builtPerDay` still cut
from 4.8 to 2.8). Both directions lose, so the current nearest-first rule is a local
optimum and the haul-to-build ratio is arithmetic, not a dispatch defect. `src/sim/jobs.ts`
is unchanged; the refutation is kept as two characterization tests in
`tests/hauling.test.ts` and the round note "The haul-to-build ratio is arithmetic, not a
dispatch defect".

So the gap 3a pinned is **upstream of dispatch, in how much the Steward ever puts on the
board** — `idleTakeableShare` 1.02% with the cadence declining 83% of the time because
there is genuinely nothing takeable. 3b read that as a second symptom; it was the answer.
`PLAN.md` queued 3d as the likely no-op behind 3c; the two have swapped places, and 3d
should be taken against the emptiness of the board rather than against rule 4's
marking-wait (which 3b measured at 5.9% colony-wide and did not show as the ceiling).

The grid on disk is current — fingerprint `4ca9864e`, `tests/measurements.test.ts` green,
`npm run measure` not owed. It becomes owed again the moment any `.ts` under `src/sim` or
`src/eval` changes by even a comment, so land every `src/` edit first, then
`npm run measure` (about 100 minutes, detached to a log, nothing else on the box), then
`npm run balance`, then re-commit `.eval/measurements.json`.

After 3d: `3e-fix-label`, then the body rounds (`1b`, `1c`, `1d`) and the frame and look
rounds (`2a`–`2e`). The box is a serial resource: the suite runs alone, `measure` runs
alone, and GPU timing wants no contention.
