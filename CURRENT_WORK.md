# CURRENT_WORK — resume pointer

Read this first at session start. It says where the work stands and what the next
action is. Everything durable lives in the files it points at; this page is a map, not
a copy.

**Updated:** 2026-09-13 · **`main` at write time:** the spine commit directly above
`edd648b` (the sub-loom adoption).

---

## Where it stands

The pass at the physics, the graphics and the simulator went through `/solve` on
2026-09-13. The plan is `PLAN.md`: Path B, the colony group first, then the feel of the
driven body, then the frame; sixteen one-round segments plus the HUD escape fix, one PR
each, in the order of its table. The status table is `SEGMENT_STATUS.md` and the
rolling log is `INBOX.md`. The EXECUTE workflow builds the segments in that order, each
on its own branch off `origin/main`, and merges a segment itself only under the vault's
standing `ARM_AUTOMERGE` (tier cap 2: a clean gate, a board publish with no coverage
gap, and at tier 2 an independent verifier's AGREE); anything else stops at an open PR.

Before the pass, the forge bench (`FORGING.md`) had run through stage 5 (every
procedural building a recipe with its numbers pinned, `FrontPlate` shared), and the look
loop (`LOOK.md`) had six briefs untaken. Three of those briefs are segments of the pass
(hair value break, walking feet, arms against the pitch); the other three (eight pile
shapes, per-blade grass phase, the animals' space) and the exponential-damp A/B stay the
Next briefs at the top of `ROUND_NOTES.md`.

## Next action

1. Reconcile before touching anything: `python3 ~/LoomVault/bin/resume.py reconcile
   --repo . --json`, then read `SEGMENT_STATUS.md` and `INBOX.md`, and `gh pr list` for
   what is open.
2. If the EXECUTE run is still going, leave the working tree alone: its agents check
   branches out in this directory.
3. If it halted, the run result's `haltedAt` names the segment and the reason. The two
   known halts are the vault's readonly test lock (`~/LoomVault/.loom/readonly-paths`,
   the `#@additions-ok` globs: any deletion inside `tests/` aborts the gate, and every
   pin-moving round rewrites a test literal) and a board coverage gap holding a merge.
   Both are the human's to clear. Then relaunch the execute workflow, resuming from the
   run id or fresh with the segments of `PLAN.md`.
4. When every row of `SEGMENT_STATUS.md` reads merged, close the pass: confirm the
   retro's lessons reached the vault (`vault.py reindex`), and write the next pointer.
