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

`3d-sim-fix-steward`, reopened and re-aimed by `3f-sim-probe-board-empty` — **rule 4's
headroom**, which is one literal number in `src/sim/steward.ts:2168`.

3f measured which of `tickSteward`'s gates returns, on 3b's own arms. The Steward marks work
on **one or two passes in a hundred**; the rest is `stewardLoad > 0` 36%, `blocked(hostiles)`
30%, `blocked(sleep)` 26%, `no-ambition-marked` 4%. Two readings are already dead: the colony
is not out of things to want (ambitions answer when asked), and the hostiles gate is not
over-broad (`world.ts:440` excludes fauna, traders, prisoners, the dead and the downed — it
counts real raiders only). Night and raids are right to stand the colony down. Rule 4 is the
one lock left that can move.

The brief: `steward.ts:2168` refuses to mark while *one* frame of its own is unfinished, and
its comment argues that as a binary against "two dozen" — which measurably killed hauling
(51, 6, 0, 0, 0, 0 pawn-ticks a day carried to a stockpile, seed 20260729). Nobody has tried
the middle. Give it a batch or two of headroom instead of exactly zero, red-first, and watch
both ends: the 3a pins (`roomsPerDay` 0.03, `builtPerDay` 4.8) should rise, and the hauling
number must not collapse. If both cannot hold at once, that is the finding and the round is
recorded as one, the way 3c was.

It changes `src/sim`, so it re-measures: land every `src/` edit first, then `npm run measure`
(about 100 minutes, detached to a log, nothing else on the box), then `npm run balance`, then
re-pin and re-commit `.eval/measurements.json`. The grid is currently fresh at `4ca9864e`.

After that: `3e-fix-label`, then the body rounds (`1b`, `1c`, `1d`) and the frame and look
rounds (`2a`–`2e`). The box is a serial resource: the suite runs alone, `measure` runs alone,
and GPU timing wants no contention. Note two long runs were killed for memory on 2026-09-16 —
Hytale (~2.9 GB) and leaked `chrome-headless-shell` processes were the cause; check `ps -Ao
rss,comm -r | head` before starting a long one.
