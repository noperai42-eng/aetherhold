# Opus 5 — RimSim / Aetherhold next cycle + progressive fidelity

**Repo:** `~/Code/RimSim` (product name **Aetherhold**)  
**Settings:** Opus 5 · effort `xhigh`/`max` · thinking ON · omit temperature  
**Optional prefix:** `Full permissions. ultrathink. Effort max.`

This is a **continue** prompt for an already-large dual-view colony sim — not greenfield.

---

## Seed prompt (copy from here)

```text
# RimSim / Aetherhold — NEXT CYCLE + FIDELITY LAYERS
Continue this existing Three.js dual-view colony sim (manager + 1st-person colonist, one sim). Do NOT restart from zero. Do NOT invent a second simulation for FPS.

## Orient first
Read README.md, ARCHITECTURE.md, ACCEPTANCE.md, PLAYTEST.md, ENDGAME.md (in that spirit). Skim src/sim vs src/client. Run `npm test` / `npm run build` when you need ground truth. The killer feature is: **one world, two cameras, never disagree.**

## Opus 5 process (mandatory)
- You already self-verify. No critic-subagent swarms. No “double-check with another agent.”
- Subagents only for large independent tracks. Prefer solo work for coupled systems.
- NEVER parallelize: lighting+sky+tonemap; sim jobs+pathing+orders; manager/FPS camera sync.
- Chat short; outcome first; docs non-padded.
- Stop when ACCEPTANCE passes. Leave a short ROUND_NOTES.md (or update ACCEPTANCE/PLAYTEST as needed).

## Hard product law (never break)
1. **One sim, two views.** `src/sim/**` has no three.js. Client only reads/interpolates and sends orders.
2. **Collision equals geometry.** `buildings.ts` `solid` is authority; no ghost walls in FPS.
3. **View switch (V)** instant; same pawns, buildings, time, jobs; preserve selection/possessed id.
4. **Manager time scale vs FPS:** do not leave FPS at 3× in a way that nauseates; keep pause freezing sim not only animation.
5. Fixed-tick sim (TICKS_PER_SECOND as defined); seeded worldgen contracts stay honest.
6. Original IP only — Aetherhold setting; no RimWorld/Ludeon names or UI clones.
7. Prefer procedural geometry; no unpaid asset packs; keep self-hosted build habits.
8. Tests are load-bearing here (~1.7k+). Don’t delete pins to “make green”; extend them. `npm test` / `tsc` when you touch covered surface.

## Ambition
Deepen the dual-view fantasy and colony stakes without feature mush: manager orders become body work; body work shows in manager; raids/fire/seasons still readable from both cameras.

## Two orthogonal tracks this session
### Track A — Feature / honesty (pick ONE primary from measurement)
Prefer the worst gap you can prove (test fail, PLAYTEST pain, ACCEPTANCE “wants a human”, ENDGAME missing rung). Candidates:
- Dual-view desync (collision, doors, job progress after FPS interact)
- First 10 minutes confusing → steward/onboarding/objectives clarity
- Hauling/stockpile/stranded jobs lying
- Raid/defence unreadable in FPS or broken in manager
- Power/warmth/food spoilage invisible until death
- Save/load losing view mode or critical state
- An ENDGAME road that can’t be reached (balance/endings honesty)
- Performance: long frames, quality presets not wired

Ship one version-sized fix with before/after (test name or PLAYTEST step).

### Track B — Progressive fidelity (ONE layer only)
Do NOT say “more realistic” or soft-body. Densify one layer of *believability* (TokenGremlin ladder, arcade/colony readable):

| Layer | Aetherhold meaning | Freeze |
|------|--------------------|--------|
| L1 Volumes | Cabin/wall/pawn capsules, stockpile footprints | — |
| L2 Proportions | Door height, bed vs pawn, stockpile vs crate scale | L1 |
| L3 Silhouette | Manager zoom: settlers/buildings readable; FPS: room massing | L1–2 |
| L4 Materials | Wood/stone/earth/metal families, contact shadows; no topology rewrite | sim rules |
| L5 Motion | FPS walk weight, job anim snaps, camera settle; manager pawn motion clarity | mesh topology |
| L6 Env/post | Day/night + seasons tint, weather readability, particles, quality presets; **single lighting owner** | L5 tuning unless broken |

## Explicit non-goals this cycle
- Second sim for FPS
- Soft-body / photoreal humans / asset-store packs
- Multiplayer
- Infinite content breadth (new biotech trees for their own sake)
- Parallel agents thrashing lighting + combat + jobs

## Acceptance
1) `npx tsc --noEmit` clean for touched surface; `npm test` green or honest skip only with note.
2) `npm run build` works.
3) Track A: measured fix documented; dual-view still honest (switch V mid-job still consistent).
4) If Track B: named layer improved in both views where relevant.
5) ROUND_NOTES.md: what shipped, tests run, next target.
6) No RimWorld trademarks introduced.

## Start
Orient on the five docs + dual-view invariant. Track A first (or L-pass if the measured gap is pure visual mush). Ship when acceptance passes.
```
