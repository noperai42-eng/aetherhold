# INBOX.md — the rolling log of the pass

Anything that should change the *next* round goes here; PR comments cover the current one. Handled items are archived below with the round that handled them.

## Open

- **2026-09-18 — 2b measured where the triangles are, and the grass is not the answer.** The
  colony frame's census: **the rock first at 23.0 %** (`TerrainView.rocks`, `terrain.ts:598` —
  8,414 instances of a 234-triangle block, and it casts), the grass second at 18.7 % (106,547
  tufts of 15, drawn once and casting nothing), seven `BuildingsView` pools 29.0 % between them,
  the shroud 5.2 %. The brief's premise correction stands — `TUFTS_PER_CELL`'s "5.7 %" is the
  five-to-seven *increment*, the total is a fifth of the frame — and the comment is correct and
  was not edited. The grass is pinned three ways in `tests/decor-view.test.ts`; nothing under
  `src/` changed. **What this changes about the next round:** `2b`'s own Next brief is the rock,
  as the gate ruled — it is the top pool, it casts, and 8,414 blocks of 234 triangles is a lot of
  geometry for something a player reads as a cliff face. Two others fell out and are in neither:
  (1) the seven building pools are 29.0 % between them, more than the rock and more than the
  grass, which is one question under seven census rows; (2) `r23-5-dusk` carries **no shadows at
  all** — and neither did `r22-5-dusk`, so it predates this round — while the colony goes on
  paying 0.6 ms a frame for a depth pass; the frame that exists to judge the light is showing
  none of it, and that is a lighting round, not a frame round.

- **2026-09-18 — and 2a's baseline does not reproduce, which is a caution for every look round
  after it.** `2a` published `gpu 3.0/3.8 ms (finish)` as the number later rounds compare
  against. Four readings of that same frame on the same box came back 1.6, 1.5, 1.6 and 1.8 ms —
  tight among themselves, half of the published figure, with no file under `src/` changed in
  between. The 3.0 was a loaded box, and nothing in a round note can distinguish a loaded box
  from a heavier frame. **The stall is repeatable within a shoot and not across them.** Take the
  before and the after in the *same* shoot, on the same named frame, and compare those; the
  absolute figure is worth writing down only as the order of magnitude it is. `LOOK.md`'s *What
  will bite* and the `2a` acceptance row both say so now.

- **2026-09-18 — 2a shipped a GPU millisecond, and the first instrument it tried was lying.**
  The Cost line now carries `gpu <median>/<max> ms (finish)`; the colony frame reads
  **`gpu 3.0/3.8 ms (finish)`** at 122 draw calls and 8,357,240 triangles, and that is the baseline
  every later look round re-shoots the same frame to compare against. The round's finding is what it
  *didn't* ship: `EXT_disjoint_timer_query_webgl2` is listed on this box with 64 counter bits, answers
  every query, never flags disjoint — and overstates by about five times. Only the brief's mandated
  `gl.finish()` cross-check caught it (2.2 ms against the timer's 9.8), and an N-renders decider
  settled it: the stall is linear in the work (`1.7·N + 0.1` for N = 1, 2, 4), the timer is
  proportional to nothing (~8.7 ms a render at every N, and 7.40 then 5.06 ms for the identical frame
  minutes apart). It was removed rather than demoted, and the removal is pinned in
  `tests/look-gpu.test.ts`. **What this changes about the next round:** `2b-frame-census-grass-budget`
  now has a card number to put its triangle census beside, which was the whole reason it depends on
  this one — but read 3.0 ms as a median of 24 samples on one *named* frame, not a constant (a
  younger colony of nearly the same triangle count read ~1.7 ms), so a comparison that quotes across
  frames is worthless. Two briefs fell out of this round and neither is in it: (1) **nine look
  harnesses cannot navigate at all** — `zoo`, `crew`, `heads`, `hollow`, `stress`, `diag-hang` and
  `trouble` (×2) on `networkidle2`, `forge` and `review` on `networkidle0`; the dev server's HMR
  WebSocket is a request that never finishes, so they burn their full timeout and take no frames.
  `shot.mjs` is fixed (`load`, 539 ms); the rest want a round. (2) **Is `TIME_ELAPSED_EXT` wrong only
  here, or wrong on this whole platform?** If it is the platform, the number is wrong in every browser
  profiler on this box, which is worth knowing before trusting one.

- **2026-09-16 — 3e-fix-label is closed, and it names one leftover.** The mood row picked its
  sentence on `pawn.jobId === null`, which answers *are they holding work* where the row means
  *was the colony free to give them any*. `needs.ts:554` now asks
  `jobId === null && !drafted && !manual`, the two states `isIdlePawn` (`run.ts:405`) excludes
  first; the drafted literal moved **4,800 → 0** and the row still fires all 4,800 ticks, because
  the amount never depended on the words. It had to land in `src/sim`, not the HUD: `MOOD_REMEDY`
  (`alerts.ts:79`) keys the player's *hint* off the label string and lives in the sim, so a
  client-side patch would have left the alert panel recommending furniture to a settler the player
  had standing on a firing line. **What this changes about the next round:** `jobs.ts:406`
  withholds work from `playerControlled` exactly as it does from `drafted` and `manual`, so the
  same lie is presumably reachable that way — left out on purpose, because `isIdlePawn` does not
  exclude it either and adding it would close one mismatch by opening another. It wants its own
  measured round, and it drags `isIdlePawn` in with it, which is a one-way door onto two grid
  columns. The wider version of the same question: eleven other rows in `moodBreakdown` have never
  been checked against the states a player can put a settler into.

- **2026-09-16 - 3d is a recorded no-op, and it closes the Steward line.** Rule 4's headroom was tried at 2 and at 4 on identical arms: stockpile hauling falls 1280.9 -> 727.0 -> 670.0 pawn-ticks a day while *total* haul work stays flat (241.8k / 227.1k / 236.3k), so the colony does the same work pointed somewhere less useful, and 84% of the loss lands at the first notch off zero. Three guards go red and each names a harm `steward.ts:2168`'s comment predicts in prose - `larder.rot` 0 -> 0.183, `roomsPerDay` 0.03 -> **-0.03**, the cabin fire at 17.03 against a floor of 17.33 - and all three are green at pristine. The mechanism is a latch, not a dial: ambitions mark in batches of ~8, so any headroom >= 2 refills the board before it drains and the zero-load window never reopens. The conditional design ruled at the `/solve` gate (`PLAN.md:170`) is not licensed either: its precondition was marking-wait behind a haul-blocked ambition *dominating* idle-board ticks, and that is 7.2-7.5% (3b measured 5.9%). **What this changes about the next round:** stop looking for a ceiling inside the Steward. Four rounds have now checked dispatch (3c), the board (3f) and rule 4 (3d) and found the colony behaving as designed at every gate. What is actually large is `blocked(hostiles)` 25-30% and `blocked(sleep)` 26-28%, both deliberate - so the open question is whether `3a`'s build-rate pin is simply measuring a colony that is mostly asleep or under threat, and should be accepted as the floor it is.

- **2026-09-16 — 3f says the Steward is asked and says nothing, 92% of the time.** A new probe-only segment taken after 3c, on 3b's own arms. The Steward marks work on one or two passes in a hundred: `stewardLoad > 0` 36%, `blocked(hostiles)` 30%, `blocked(sleep)` 26%, `no-ambition-marked` 4%. So the colony is not out of things to want, and the hostiles gate is not over-broad (`world.ts:440` counts real raiders only — fauna, traders, prisoners, the dead and the downed are all excluded). What this changes about the next round: `3d-sim-fix-steward` is no longer about rule 4's *marking-wait*, it is about rule 4's *headroom*. `steward.ts:2168` refuses to mark while one frame of its own is unfinished and argues that as a binary against two dozen, which killed hauling. Try the middle, red-first, and hold both ends — the 3a pins up, the hauling number not collapsing.

- **2026-09-16 — 3c is a recorded no-op, and it re-points 3d.** Ranking a supplied frame above a nearer one wanting materials measured worse both ways it can be written: outright, nine suite failures (`roomsPerDay` to nothing, no turret in three weeks, the Steward's fence stuck at eight, a month-old colony with no wood left); bounded by the shorter of the two walks, six (enclosures and turrets back, `builtPerDay` still 4.8 → 2.8). The haul-to-build ratio `3b` measured is arithmetic — a wall costs its wood and one build action — not a dispatch defect, so `src/sim/jobs.ts` is unchanged and the grid is still fresh at `4ca9864e`. What this changes about the next round: the gap `3a` pinned is upstream of dispatch, in how little the Steward ever puts on the board (`idleTakeableShare` 1.02%, the cadence declining 83% of the time for want of anything takeable). Take `3d-sim-fix-steward` against the emptiness of the board, not against rule 4's marking-wait, which `3b` measured at 5.9% colony-wide and did not name as the ceiling.

- **2026-09-16 — the harness is retired; the rounds are not.** The remaining rounds are taken by hand, in `PLAN.md`'s order, one at a time. The kickoff entry below describes a merge posture that no longer applies: no gate, no board publish, no automerge, no segment workflow. What survives from it is the plan itself and the standing rules — one round, one measured gap, one fix; a pin is a literal number; the golden is the floor; never weaken a test; a `ROUND_NOTES.md` entry per round and an `ACCEPTANCE.md` row for anything a player sees. Why: `3e-measure-label` cost eight agents, 129 tool calls and nineteen hours to land 267 additive lines of test and prose, and every round still needed checking by hand afterwards. `LOOM.md` is deleted; its invariant floor and port lane moved into `CLAUDE.md`.

- **2026-09-13 kickoff.** `/solve` plan run `wf_dc0b1a04-a5f`; Path B ratified at the gate (colony first, then the body, then the frame). Seventeen PRs expected, one per segment, in `PLAN.md`'s order: `3a-sim-pin-build-rate`, `3b-sim-probe-why`, `0-hud-escape-html`, `3e-measure-label`, `3c-sim-fix-dispatch`, `3d-sim-fix-steward`, `3e-fix-label`, `1a-feel-trace`, `1e-feel-interp-phase`, `1b-feel-eye-ease`, `1c-feel-accel`, `1d-feel-bob-sway-run`, `2a-frame-gpu-timer`, `2b-frame-census-grass-budget`, `2c-look-hair-value-break`, `2d-look-walking-feet`, `2e-look-arms-against-pitch`. Merge posture is the vault's standing `ARM_AUTOMERGE` (tier cap 2): a segment merges itself only on a clean gate, a board publish with no coverage gap and, at tier 2, an independent verifier's AGREE; anything else stops at an open PR. Remove `~/LoomVault/.loom/ARM_AUTOMERGE` to revert to PR-Review. Known halt: the vault's readonly lock (`~/LoomVault/.loom/readonly-paths`, the `#@additions-ok` test globs) aborts a gate on any deletion inside `tests/`, and every pin-moving round rewrites a test literal; the human lifts that lock for the run and restores it after.

## Handled

(none yet)

- **3b-sim-probe-why shipped.** Commit `09397dff3a41727da87ab74855013c04344a69fb`, PR #7 opened, merge_state OPEN, awaiting board publish (no coverage gap).
- **3e-measure-label shipped.** Commit `7dce88e6431a4ffafa227a1fc4d9e0ea42c8ecba`, PR #10 opened, merge_state OPEN, awaiting board publish (no coverage gap).
