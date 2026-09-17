# CURRENT_WORK — resume pointer

Read this first at session start. It says where the work stands and what the next
action is. Everything durable lives in the files it points at; this page is a map, not
a copy.

**Updated:** 2026-09-17 · branch `main`, at `671551d`.

---

## Where it stands

A pass at the simulator, the feel of the driven body and the frame. The rounds are
listed in `PLAN.md` in the order they are meant to be taken; `SEGMENT_STATUS.md` is the
status table and `INBOX.md` the rolling log. One round, one measured gap, one fix
(`METHODOLOGY.md`); a round ends with a `ROUND_NOTES.md` entry and, if a player could
see the change, an `ACCEPTANCE.md` row.

Ten rounds are taken: `3a-sim-pin-build-rate` (the build-rate and idle pins),
`3b-sim-probe-why` (the per-tick dispatch probe), `0-hud-escape-html`, `1a-feel-trace`,
`1e-feel-interp-phase`, `3e-measure-label`, `3c-sim-fix-dispatch`, `3f-sim-probe-board-empty`,
`3d-sim-fix-steward` — three of those measurements that changed no sim code — and
`3e-fix-label`, which closed the branch the label round named.

**The colony line is closed, and that is the finding.** `3a` pinned a build rate; `3b`, `3c`,
`3f` and `3d` then went looking for what caps it and found nothing broken. Dispatch is fine
(`idleTakeableShare` ~1.1%, and both ways of ranking raise-over-fetch measured worse). The
ambitions answer when asked (`no-ambition-marked` 4%). Rule 4 is a latch rather than a dial:
headroom at 2 and at 4 leaves *total* haul work flat while moving it off the stockpiles, and
turns three guards red — `larder.rot` 0 → 0.183, `roomsPerDay` 0.03 → **−0.03**, the cabin fire
late — each a harm `steward.ts:2168`'s comment predicts in words. What the Steward's time
actually goes to is night and raiders, both deliberate. The round notes are in
`ROUND_NOTES.md`; the instrument is `scripts/probe-dispatch.ts`.

## Next action

**Open question for the human, and the reason this pass has run out of Steward to fix.**

Four rounds have now looked for the ceiling `3a` pinned, and each found the colony behaving as
designed. `3c` refuted dispatch (both ways of ranking raise-over-fetch measured worse). `3f`
found the ambitions answer whenever the Steward reaches them (`no-ambition-marked` 4%). `3d`
refuted rule 4's headroom at 2 and at 4 — stockpile hauling 1280.9 → 727.0 → 670.0 pawn-ticks a
day with *total* haul work flat, three guards red, and the gate's own precondition for the
conditional design unmet at 7.2–7.5%.

What is left is not small, and it is not a defect. Across the foreman-on arms the Steward's
time goes to `blocked(hostiles)` 25–30% and `blocked(sleep)` 26–28%. Both are deliberate: night
and raids are right to stand the colony down. So the question the next round should put is not
"what is wrong with the Steward" but **"is `3a`'s build-rate pin measuring a colony that is
mostly asleep or under threat, and is that the floor?"** — which is a design question about the
day length and the raid cadence, not a marking question. Answering it either accepts the pins as
they stand or opens a deliberate brief against the invariant floor. That is a human call.

Until it is taken, the remaining rounds in `PLAN.md` are the ones that do not depend on it:
the body rounds (`1b-feel-eye-ease`, `1c-feel-accel`, `1d-feel-bob-sway-run`) and the frame and
look rounds (`2a-frame-gpu-timer`, `2b-frame-census-grass-budget`, `2c-look-hair-value-break`,
`2d-look-walking-feet`, `2e-look-arms-against-pitch`). Any of those can be taken now; none needs
the Steward question settled first. `3e-fix-label` is done — it was the last of the colony-line
rounds.

The box is a serial resource: the suite runs alone, `measure` runs alone, GPU timing wants no
contention. Check `ps -Ao rss,comm -r | head` before a long one — two runs were killed for memory
on 2026-09-16, and the cause was a running game at ~2.9 GB, not process count.

The grid is fresh at `e61c7f10`, re-measured by `3e-fix-label`, which changed `src/sim/needs.ts`
and moved no measured number — three differing leaves across 39 colonies and sixty days, all of
them metadata. The first round that changes `src/sim` again pays the ~100 minutes.

**When you pay them, pass the flags.** `npm run measure` bare plays a thirty-day grid stopping at
founding; the pinned grid is `npm run measure -- --days 60 --past-founding`. The bare run exits 0,
writes a valid file and leaves the freshness check green at 9/9 while having moved seven hundred
leaves, and nothing in the repo catches it — the fingerprint contract guards the sim a grid was
measured against, not the sweep. Diff `sweep.days` and `sweep.playPastFounding` against
`git show HEAD:.eval/measurements.json` before believing any re-measure.
