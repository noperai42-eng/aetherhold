# SEGMENT_STATUS.md

Ids and titles verbatim from `PLAN.md`. Statuses: `not-started | in-progress | blocked | awaiting-review | shipped | merged | complete`. Materialised 2026-09-13 at the `/solve` gate.

The EXECUTE workflow that built the first four rows was stopped on 2026-09-14 with three of them carrying blocking review findings, and the rows below were brought up to date by hand while resolving those findings. Until a workflow run owns this file again, it is maintained here.

| ID | Title | Status | Notes |
|---|---|---|---|
| 3a-sim-pin-build-rate | Pin what the colony builds and how many hands stand idle | merged | `35de80b`, PR #3. Review findings resolved by hand: `takeableTargets` hoist, rooms baseline, awake-tick denominator, dead stalled-bill branch deleted, four pins re-measured against a re-run grid (`4ca9864e`). |
| 3b-sim-probe-why | The probe that names the gap, per tick, before any fix | not-started | |
| 0-hud-escape-html | Escape the pawn's name before the HUD prints it | merged | `c530a40`, PR #6. Shipped outside the pass’s segment count, as agreed at the gate. |
| 3e-measure-label | Measure 'nothing fun to do' before touching it | not-started | |
| 3c-sim-fix-dispatch | One fix in dispatch, or a recorded no-op | not-started | |
| 3d-sim-fix-steward | The Steward's rule 4, reopened only if the probe names it | not-started | |
| 3e-fix-label | Fix the branch the label round named | not-started | |
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
