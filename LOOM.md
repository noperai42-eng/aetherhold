# LOOM.md — Aetherhold is a loom sub-loom

This repo is a **sub-loom**: it points at the kit `~/Code/loom` @ `b7485e0`
(github.com/noperai42-eng/loom), reference-only, never copied. Adopt and update
directions: `~/Code/loom/ADOPTING.md`. The operating posture (`/solve`,
`review-board`) is the workspace `~/CLAUDE.md` "Default operating posture", the
single source of truth; this file points at it and never restates it.

The vault scope for this repo is its directory name, `RimSim`
(`~/LoomVault/projects/RimSim/`), even though the game is called Aetherhold.

## Spine
`CLAUDE.md` (the map of the documents) · `CURRENT_WORK.md` (resume pointer) ·
`CAPTURE.md` (catch-net) · `METHODOLOGY.md` (how a change is made and measured) ·
`ROUND_NOTES.md` (the log of rounds) · `ACCEPTANCE.md` (what has been checked and by
whom). `PLAN.md` and `SEGMENT_STATUS.md` are materialised by `/solve` at its gate.

## Port lane
`5060–5069`, reserved in the hub `~/Code/DanLoom/PORTS.md`. `5062` is the play server
(the built bundle, on the LAN; saves live in `localStorage` keyed by origin, so it
never moves) and `5063` is dev with HMR, both `strictPort` in `vite.config.ts`.
Test servers bind `:0`. Never restart a dev server another session started.

## The invariant floor
Touching any of these forces Scorecard tier ≥2 and routes to the **independent**
verifier, never self-certified:

- **One world, one clock, one collision.** `grid.isSolid` is the only gate a body
  passes; `moveWithCollision` in `src/sim/movement.ts` is the only writer of
  `animPhase`; the first-person controller never scans `world.buildings`.
  `tests/gait.test.ts` and `tests/architecture.test.ts` hold this.
- **The 20 Hz split.** The sim advances only in `TICK_DT` steps through
  `src/client/pace.ts`; paused means zero; the renderer reads interpolated state and
  writes none. A tick's cost ceiling is pinned in `tests/colony-run.test.ts`.
- **The seed contract and save/load.** A seed reproduces the valley; a save loads
  into the same colony. `src/sim/worldgen.ts`, `src/sim/rng.ts`, the save path.
- **The fingerprint contract** (`METHODOLOGY.md`). The eval and balance numbers are
  pinned as measured, not as they should be; a retune is a brief, never a silent
  change.
- **Tests are never weakened.** The golden is the floor, not the ceiling; a pin is a
  literal number; anything a player sees is judged by the frames (`LOOK.md`).
- **Nothing is downloaded into the box.** No model, texture or audio file enters the
  repo; every asset is procedural (`tests/architecture.test.ts`).

## Lane map
| Lane | Artifact |
|---|---|
| Capture | `CAPTURE.md` |
| Feature-dev | one round, one measured gap, one fix (`METHODOLOGY.md`) → `ROUND_NOTES.md`; `PLAN.md` + `SEGMENT_STATUS.md` at the first `/solve` gate |
| Research | `~/Code/loom/scripts/loom_research.sh` + `vault.py recall RimSim …` |
| Delivery | `npm run ship` (build to the play server on `5062`); no `deploy.sh` yet |
| Documentation | `README.md` · `ARCHITECTURE.md` · `LOOK.md` · `FORGING.md` · `PLAYTEST.md` |
| Discovered | the *Next* and *Still wrong* sections of each round in `ROUND_NOTES.md` |
| Learning (write-back) | retro → `~/LoomVault/projects/RimSim/` |

## Hub
Registered in `~/Code/DanLoom/registry.md`.
