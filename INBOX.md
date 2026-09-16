# INBOX.md — the rolling log of the pass

Anything that should change the *next* segment goes here; PR comments cover the current one. The EXECUTE ship step appends one entry per shipped segment (id, commit, tier, verify, merge state). Handled items are archived below with the segment that handled them.

## Open

- **2026-09-13 kickoff.** `/solve` plan run `wf_dc0b1a04-a5f`; Path B ratified at the gate (colony first, then the body, then the frame). Seventeen PRs expected, one per segment, in `PLAN.md`'s order: `3a-sim-pin-build-rate`, `3b-sim-probe-why`, `0-hud-escape-html`, `3e-measure-label`, `3c-sim-fix-dispatch`, `3d-sim-fix-steward`, `3e-fix-label`, `1a-feel-trace`, `1e-feel-interp-phase`, `1b-feel-eye-ease`, `1c-feel-accel`, `1d-feel-bob-sway-run`, `2a-frame-gpu-timer`, `2b-frame-census-grass-budget`, `2c-look-hair-value-break`, `2d-look-walking-feet`, `2e-look-arms-against-pitch`. Merge posture is the vault's standing `ARM_AUTOMERGE` (tier cap 2): a segment merges itself only on a clean gate, a board publish with no coverage gap and, at tier 2, an independent verifier's AGREE; anything else stops at an open PR. Remove `~/LoomVault/.loom/ARM_AUTOMERGE` to revert to PR-Review. Known halt: the vault's readonly lock (`~/LoomVault/.loom/readonly-paths`, the `#@additions-ok` test globs) aborts a gate on any deletion inside `tests/`, and every pin-moving round rewrites a test literal; the human lifts that lock for the run and restores it after.

## Handled

(none yet)

- **3b-sim-probe-why shipped.** Commit `09397dff3a41727da87ab74855013c04344a69fb`, PR #7 opened, merge_state OPEN, awaiting board publish (no coverage gap).
- **3e-measure-label shipped.** Commit `7dce88e6431a4ffafa227a1fc4d9e0ea42c8ecba`, PR #10 opened, merge_state OPEN, awaiting board publish (no coverage gap).
