# INBOX.md — the rolling log of the pass

Anything that should change the *next* round goes here; PR comments cover the current one. Handled items are archived below with the round that handled them.

## Open

- **2026-09-16 — the harness is retired; the rounds are not.** The remaining rounds are taken by hand, in `PLAN.md`'s order, one at a time. The kickoff entry below describes a merge posture that no longer applies: no gate, no board publish, no automerge, no segment workflow. What survives from it is the plan itself and the standing rules — one round, one measured gap, one fix; a pin is a literal number; the golden is the floor; never weaken a test; a `ROUND_NOTES.md` entry per round and an `ACCEPTANCE.md` row for anything a player sees. Why: `3e-measure-label` cost eight agents, 129 tool calls and nineteen hours to land 267 additive lines of test and prose, and every round still needed checking by hand afterwards. `LOOM.md` is deleted; its invariant floor and port lane moved into `CLAUDE.md`.

- **2026-09-13 kickoff.** `/solve` plan run `wf_dc0b1a04-a5f`; Path B ratified at the gate (colony first, then the body, then the frame). Seventeen PRs expected, one per segment, in `PLAN.md`'s order: `3a-sim-pin-build-rate`, `3b-sim-probe-why`, `0-hud-escape-html`, `3e-measure-label`, `3c-sim-fix-dispatch`, `3d-sim-fix-steward`, `3e-fix-label`, `1a-feel-trace`, `1e-feel-interp-phase`, `1b-feel-eye-ease`, `1c-feel-accel`, `1d-feel-bob-sway-run`, `2a-frame-gpu-timer`, `2b-frame-census-grass-budget`, `2c-look-hair-value-break`, `2d-look-walking-feet`, `2e-look-arms-against-pitch`. Merge posture is the vault's standing `ARM_AUTOMERGE` (tier cap 2): a segment merges itself only on a clean gate, a board publish with no coverage gap and, at tier 2, an independent verifier's AGREE; anything else stops at an open PR. Remove `~/LoomVault/.loom/ARM_AUTOMERGE` to revert to PR-Review. Known halt: the vault's readonly lock (`~/LoomVault/.loom/readonly-paths`, the `#@additions-ok` test globs) aborts a gate on any deletion inside `tests/`, and every pin-moving round rewrites a test literal; the human lifts that lock for the run and restores it after.

## Handled

(none yet)

- **3b-sim-probe-why shipped.** Commit `09397dff3a41727da87ab74855013c04344a69fb`, PR #7 opened, merge_state OPEN, awaiting board publish (no coverage gap).
- **3e-measure-label shipped.** Commit `7dce88e6431a4ffafa227a1fc4d9e0ea42c8ecba`, PR #10 opened, merge_state OPEN, awaiting board publish (no coverage gap).
