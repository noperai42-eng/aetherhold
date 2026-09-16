# Aetherhold

A browser colony sim: Three.js 0.180 on WebGL2, Vite, TypeScript, Vitest. The documents
are the map, and this file only says which one to open.

- **What the game is and how each system works:** [README.md](README.md). **How the code
  is laid out and why:** [ARCHITECTURE.md](ARCHITECTURE.md).
- **How a change is made and measured** — rounds, the ladder of instruments, the
  commands: [METHODOLOGY.md](METHODOLOGY.md). The log of rounds: [ROUND_NOTES.md](ROUND_NOTES.md).
- **Anything a player sees — models, materials, the HUD, a new screen, the feel of a
  frame — is iterated with the look loop in [LOOK.md](LOOK.md):** photograph the same
  frames before and after, look at them yourself, write the next brief from what you
  saw, and log the round. Any model can drive it; the frames are the judge.
- **Shaping a model rather than a screen** — the bench, served at `/forge.html` in dev:
  one model a page, its numbers on sliders, and a Generate 12 button. The plan for the
  recipe-and-bench loop over every procedural geometry in `src/client/render/`, which
  stages of it are built, and what Evergrow's forge does that this repo does not:
  [FORGING.md](FORGING.md).
- **Taking the models out of the game** — one command that writes every building,
  settler, animal and pile to `.glb`, and what another project needs to know to use
  them: [ASSETS.md](ASSETS.md).
- **What has been checked and by whom:** [ACCEPTANCE.md](ACCEPTANCE.md); the hands-on
  browser script: [PLAYTEST.md](PLAYTEST.md).

## The invariant floor

Six things this repo does not bend. Changing one is a deliberate brief, never a
side effect — say so out loud and expect the change to be checked hard.

- **One world, one clock, one collision.** `grid.isSolid` is the only gate a body
  passes; `moveWithCollision` in `src/sim/movement.ts` is the only writer of
  `animPhase`; the first-person controller never scans `world.buildings`.
  `tests/gait.test.ts` and `tests/architecture.test.ts` hold this.
- **The 20 Hz split.** The sim advances only in `TICK_DT` steps through
  `src/client/pace.ts`; paused means zero; the renderer reads interpolated state and
  writes none. A tick's cost ceiling is pinned in `tests/colony-run.test.ts`.
- **The seed contract and save/load.** A seed reproduces the valley; a save loads
  into the same colony. `src/sim/worldgen.ts`, `src/sim/rng.ts`, the save path.
- **The fingerprint contract** ([METHODOLOGY.md](METHODOLOGY.md)). The eval and
  balance numbers are pinned as measured, not as they should be; a retune is a
  brief, never a silent change.
- **Tests are never weakened.** The golden is the floor, not the ceiling; a pin is a
  literal number; anything a player sees is judged by the frames ([LOOK.md](LOOK.md)).
- **Nothing is downloaded into the box.** No model, texture or audio file enters the
  repo; every asset is procedural (`tests/architecture.test.ts`).

## Ports

`5062` is the play server (the built bundle, on the LAN — saves live in `localStorage`
keyed by origin, so it never moves) and `5063` is dev with HMR; both `strictPort` in
`vite.config.ts`. Test servers bind `:0`. Never restart a dev server another session
started.

Where the work stands: [CURRENT_WORK.md](CURRENT_WORK.md).
