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

## Loom
This repo is a **Loom sub-loom** — lane map + invariant floor in `LOOM.md`
(read it at session start). Resume pointer: `CURRENT_WORK.md`. Operating
posture + session-start onboarding: workspace `~/CLAUDE.md` (single source —
never restate it here).
