# CURRENT_WORK — resume pointer

Read this first at session start. It says where the work stands and what the next
action is. Everything durable lives in the files it points at; this page is a map, not
a copy.

**Updated:** 2026-09-18 · branch `main`, at `b3336c5`.

---

## Where it stands

A pass at the simulator, the feel of the driven body and the frame. The rounds are
listed in `PLAN.md` in the order they are meant to be taken; `SEGMENT_STATUS.md` is the
status table and `INBOX.md` the rolling log. One round, one measured gap, one fix
(`METHODOLOGY.md`); a round ends with a `ROUND_NOTES.md` entry and, if a player could
see the change, an `ACCEPTANCE.md` row.

Twelve rounds are taken: `3a-sim-pin-build-rate` (the build-rate and idle pins),
`3b-sim-probe-why` (the per-tick dispatch probe), `0-hud-escape-html`, `1a-feel-trace`,
`1e-feel-interp-phase`, `3e-measure-label`, `3c-sim-fix-dispatch`, `3f-sim-probe-board-empty`,
`3d-sim-fix-steward` — three of those measurements that changed no sim code — `3e-fix-label`,
which closed the branch the label round named, and the first two frame rounds,
`2a-frame-gpu-timer` and `2b-frame-census-grass-budget`.

**The frame now has a cost the swap interval cannot hide.** `2a` put `gl.finish()` around a
hooked `viewport.render` and printed `gpu <median>/<max> ms (finish)` under the look frames;
the colony frame's baseline is **`gpu 3.0/3.8 ms (finish)`** at 122 draw calls and 8,357,240
triangles, and every later look round re-shoots that same frame to compare. The round's finding
is the instrument it rejected: `EXT_disjoint_timer_query_webgl2` is listed on this box with 64
counter bits, answers every query, and overstates by about five times — caught only by the
brief's `gl.finish()` cross-check and settled by rendering one frame N times in one window
(stall linear at `1.7·N + 0.1`; timer proportional to nothing). It was removed, and
`tests/look-gpu.test.ts` pins the removal.

**`2b` then said where the triangles are, and the answer was not the one the round expected.**
The census above the Cost line puts **the rock first at 23.0 %** (`terrain.ts:598` — 8,414
instances of a 234-triangle block, and it casts) and the grass second at 18.7 % (106,547 tufts of
15, one draw, casting nothing); seven building pools are 29.0 % between them. The grass is pinned
in `tests/decor-view.test.ts` as a literal, one draw and `castShadow` false. The brief's
shadow-share method turned out to be impossible — three excludes the shadow pass from
`renderer.info` by construction — so it is reported as the census's cast column (73.0 % of the
frame's triangles drawn twice) and as `2a`'s stall with shadows off (0.6 ms of a 1.6 ms frame).

**And `2b` corrected `2a`'s headline number.** The published `gpu 3.0/3.8 ms (finish)` baseline
does not reproduce: 1.6, 1.5, 1.6 and 1.8 ms on four readings of the same frame with no `src/`
change between them. The 3.0 was a loaded box. **The stall is a within-shoot comparator, not a
constant** — take a before and an after in one shoot on the same named frame, and never quote the
absolute number out of an earlier round's note.

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
the body rounds (`1b-feel-eye-ease`, `1c-feel-accel`, `1d-feel-bob-sway-run`) and the rest of the
look rounds (`2c-look-hair-value-break`, `2d-look-walking-feet`, `2e-look-arms-against-pitch`).
Any of those can be taken now; none needs the Steward question settled first. `2a` and `2b` are
both done, and `2c` is the next in `PLAN.md`'s order. `3e-fix-label` was the last of the
colony-line rounds.

**Three briefs fell out of `2b` and are in none of the rounds above.** The rock is the census's
top pool, it casts, and 8,414 blocks of 234 triangles is a lot of geometry for something a player
reads as a cliff face — that is `2b`'s own Next brief, ruled at the gate to be a later round and
not `2b`'s fix. The seven building pools are 29.0 % between them, more than the rock and more than
the grass. And `r23-5-dusk` carries no shadows at all — `r22-5-dusk` did not either, so it
predates this work — while the colony goes on paying 0.6 ms a frame for the depth pass; the frame
that exists to judge the light is showing none of it, which is a lighting round.

**Two briefs fell out of `2a` and are in neither.** Nine look harnesses cannot navigate at all —
`zoo`, `crew`, `heads`, `hollow`, `stress`, `diag-hang` and `trouble` (twice) wait on
`networkidle2`, `forge` and `review` on `networkidle0`, and the dev server's HMR WebSocket is a
request that never finishes, so each burns its full timeout and takes no frames. `shot.mjs` is
fixed (`load`, 539 ms) because it blocked the round; the rest want one of their own, and the trap
is written into `LOOK.md`'s *What will bite*. Separately: whether `TIME_ELAPSED_EXT` is wrong
only under this harness or on this whole platform — if the platform, every browser profiler on
this box is reading the same wrong number.

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
