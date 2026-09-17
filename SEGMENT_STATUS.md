# SEGMENT_STATUS.md

Ids and titles verbatim from `PLAN.md`. Statuses: `not-started | in-progress | blocked | awaiting-review | shipped | merged | complete`. Materialised 2026-09-13 at the `/solve` gate.

The EXECUTE workflow that built the first four rows was stopped on 2026-09-14 with three of them carrying blocking review findings, and the rows below were brought up to date by hand while resolving those findings. Until a workflow run owns this file again, it is maintained here.

| ID | Title | Status | Notes |
|---|---|---|---|
| 3a-sim-pin-build-rate | Pin what the colony builds and how many hands stand idle | merged | `35de80b`, PR #3. Review findings resolved by hand: `takeableTargets` hoist, rooms baseline, awake-tick denominator, dead stalled-bill branch deleted, four pins re-measured against a re-run grid (`4ca9864e`). |
| 3b-sim-probe-why | The probe that names the gap, per tick, before any fix | merged | PR #7 + 3c33bf352503335f82fd8cdbb6905c21cafa0c93 + board clean |
| 0-hud-escape-html | Escape the pawn's name before the HUD prints it | merged | `c530a40`, PR #6. Shipped outside the pass’s segment count, as agreed at the gate. |
| 3e-measure-label | Measure 'nothing fun to do' before touching it | merged | PR #10 + e3c1529522945ed679c286eaf5a6fe9b5fe09c63 + board clean |
| 3c-sim-fix-dispatch | One fix in dispatch, or a recorded no-op | complete | recorded no-op — both ways of ranking raise-over-fetch measured worse (9 and 6 suite failures); no sim change, refutation kept as two tests in `tests/hauling.test.ts` |
| 3f-sim-probe-board-empty | Why the board is empty, before anyone widens it | complete | new segment, added 2026-09-16 after 3c — probe only; rule 4 36%, hostiles 30%, sleep 26%, ambitions reached on ~1-2% of passes |
| 3d-sim-fix-steward | The Steward's rule 4, reopened only if the probe names it | complete | recorded no-op with the numbers, the branch PLAN.md allows. Headroom 2 and 4 both measured worse: stockpile hauling 1280.9 -> 727.0 -> 670.0 pawn-ticks/day with total haul work flat, and three guards red (larder rot 0 -> 0.183, roomsPerDay 0.03 -> -0.03, cabin fire late). The gate's own precondition for the ruled conditional design is unmet too - marking-wait with an idle takeable hand is 7.2-7.5%, it does not dominate. Rule 4 stays at zero; `src/sim` unchanged, grid still `4ca9864e` |
| 3e-fix-label | Fix the branch the label round named | complete | `needs.ts:554` asks `jobId === null && !drafted && !manual` — the two states `isIdlePawn` excludes first. Drafted literal moved **4800 -> 0** while the row still fires all 4800 ticks (the amount never depended on the words). Landed in `src/sim`, not the HUD, because `MOOD_REMEDY` (`alerts.ts:79`) keys the player's hint off the label string. Grid re-measured: fingerprint 4ca9864e -> e61c7f10, and **no measured number moved** — 3 changed leaves, all metadata. Balance unchanged (15 hold, 1 pre-existing break). `playerControlled` left out on purpose and logged. Also found: a bare `npm run measure` plays a 30-day grid, not the pinned 60-day one, and nothing catches it — `METHODOLOGY.md` tightened |
| 1a-feel-trace | A scripted walk traced at three frame rates, pinned as it is | merged | `28789ef`, PR #4. Clean review. |
| 1e-feel-interp-phase | The bob stops stepping at 20 Hz | merged | `fbba520`, PR #5. `tests/pawns-interp.test.ts` added to exercise the real `PawnsView`. |
| 1b-feel-eye-ease | The eye eases at the same speed at every frame rate | not-started | |
| 1c-feel-accel | The driven body accelerates and stops | not-started | |
| 1d-feel-bob-sway-run | Sway and a run amplitude beside the one bob | not-started | |
| 2a-frame-gpu-timer | GPU milliseconds beside the wall clock | not-started | |
| 2b-frame-census-grass-budget | The triangle census and the grass pin | not-started | |
| 2c-look-hair-value-break | A value break on the hair | not-started | |
| 2d-look-walking-feet | The walking feet | not-started | |
| 2e-look-arms-against-pitch | The arms against the pitch | not-started | |
