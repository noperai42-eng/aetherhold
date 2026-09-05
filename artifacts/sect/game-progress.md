# Game progress — Sect Iter 1

## Decisions

- **Additive scene mode**, not a sim hook. The colony fingerprint stays put; the pocket is `src/client/scene` + `src/client/worldkit`.
- **One walker, two cameras.** Inhabit is human-height; manager is an oblique read of the same bowl. `V` swaps. WASD always moves the mortal, never a qi dash.
- **Jam clear is bone-setter competence:** gate-lever, then haul the snag. Headman talk is optional and cannot finish the slice.
- **Shared material roles** (10): wood, wetWood, thatch, stone, plaster, water, cloth, ground, mountain, foliage. Wheel and debris stay un-baked so they can turn and leave.
- Branch: `cursor/sect-iter-1-hollow-mill-106a` (named equivalent of `sect/iter-1-hollow-mill`). Not merged to main. Not claimed as ship.

## Play path

`npm run dev` → `http://localhost:5063/?pocket=hollow`  
or top-bar **Hollow** / `window.aetherhold.enterHollow()`.

## Budget (kit, counted in `tests/hollow-mill.test.ts`)

Caps from the brief: ≤60 draws, ≤120k tris, ≤12 unique materials.

Measured on the assembled kit (`buildHollowKit`, 2026-09-05): **29 draws, 3074 tris, 10 unique materials / 10 roles**. The test keeps the caps; these figures are the slice as authored.

## Tests

- New: `tests/hollow-mill.test.ts` (loop + kit budget).
- Full suite: `npm test` — run on this branch; skips remain the existing opt-in gates (`ECO`, `SWEEP`, `BALANCE`, `LIVE`, `POOL`) only.

## Next (not this slice)

- Headman as a longer conversation / errand giver
- A second pocket (ridge shrine or paddy) on the same kit
- Optional tiny sim hook only if the valley must *know* the mill was cleared
- Do not invent a cultivation combat layer until the mortal verbs feel like a place
