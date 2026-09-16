# PLAN.md — the physics, graphics and simulator pass

Materialised 2026-09-13 at the `/solve` gate (plan run `wf_dc0b1a04-a5f`; Path B, colony first, ratified). Sixteen one-round segments and one out-of-ask fix, seventeen PRs in all, each its own PR, built by the EXECUTE workflow in the order of the table below. `SEGMENT_STATUS.md` is the status; this file is the contract and is never edited from inside a segment.

## The ask, as ratified

Run one pass over Aetherhold in three themed groups, in the order given, where every round obeys METHODOLOGY.md (one round, one measured gap, one fix; measure and pin as it is; a pin is a literal number; the golden is the floor; never weaken a test; two test categories; frames judge anything a player sees; the full suite runs alone before a commit; ROUND_NOTES.md entry + ACCEPTANCE.md row per round). Because the repo's locked rule is one gap per round, the ask's "three segments" become three groups of one-round segments, each its own PR. Group 1 (feel of the driven body): first a scripted-walk trace at 30/60/144 fps pinned in tests/fps-trace.test.ts with no knob moved; then frame-rate-independent eye easing (the dt*9 formula AND the hardcoded 1/60 at app.ts:349); then acceleration/stopping in FpsController.applyTick with top speed unchanged and moveWithCollision still the only mover; then lateral sway and a run amplitude beside the one settlerBob the rig and eye share; then an exponential-damp interpolation A/B shipped only if the trace says it is better. Group 2 (the frame): a GPU timer (EXT_disjoint_timer_query_webgl2) in scripts/look so every look round prints GPU ms beside the vsync-pinned 17 ms wall; a per-pool triangle census and a literal grass triangle pin (decor.ts's own arithmetic says the grass is 5.7% of the 8.0M, so the census decides where the fix would go); then the six untaken look briefs one round each in the order given (hair value break, walking feet, arms against the pitch, eight pile shapes, per-blade grass phase, animals' space). Group 3 (the colony builds more than not): add builtToday and idle-with-open-jobs per-tick counters to DaySnapshot/RunMeasure, pin them on a named run with both stewards' state stated (EvalOptions.steward drives src/eval/steward.ts; world.steward drives src/sim/steward.ts inside stepWorld), re-measure the grid (fingerprint moves); a per-tick probe over several seeds that names the gap (dispatch vs Steward vs hauling); then one fix in jobs.ts and/or one in steward.ts judged against the pin; then re-measure the 'nothing to do' label (already split in needs.ts) before touching it. No felled trees, projectile arcs or physics engine; no asset enters the repo.

## Standing rules

- One round, one measured gap, one fix (`METHODOLOGY.md`). A round that finds no gap is recorded as "measured, not the gap" with a round note and no code change.
- Measure and pin as it is, not as it should be. A pin is a literal number at a named sample; a copy of a shipped constant is not a pin. When a change moves a pin, the round note names the old and new literals and the reason. The golden is the floor, not the ceiling. Tests are never weakened.
- Two test categories per feature: functional (the unit, red first) and experience (the trace, the eval run, the frame, the PLAYTEST line).
- Anything a player sees is judged by before and after frames from the look loop (`LOOK.md`). Frames land in the gitignored `.look/shots/`, so the round note names each frame and what it showed, and the PR body lists the frame paths.
- The full suite runs alone before a commit, with the config's six workers (`vite.config.ts`); a red set that moves between runs is contention, rerun it. `npm run typecheck` is clean.
- Every round writes its entry at the top of `ROUND_NOTES.md` in the repo's voice with proper apostrophes (sections: Better / Worse and fixed inside the round / Still wrong / Verified / Next) and adds a row to `ACCEPTANCE.md`. A probe round and a no-op round add no ACCEPTANCE row.
- At most one fingerprint-moving segment is open at a time. `npm run measure` takes about ninety minutes with the box otherwise idle; run it in the background to a log and poll the log. The fingerprint old and new, the command, the SHA and the node version go in the round note.
- The invariant floor (`CLAUDE.md`) holds: `grid.isSolid` is the only collision gate, `moveWithCollision` the only writer of `animPhase`, the controller never scans `world.buildings`, the sim advances only in `TICK_DT` steps and the renderer writes no sim state, no asset enters the repo, no physics engine.
- Surgical changes: touch only what the round needs, never improve adjacent code, extract at three, log out-of-scope mess under Next. Shell: chain with `&&`, never `;`; `|| true` where a step may fail; no `timeout` binary; test servers bind `:0`; never restart a dev server another session started.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and then `Claude-Session: https://claude.ai/code/session_01UdXDmpaKgoPW1gA9gRBaML`. PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, a blank line, and that session URL.
- The box is a serial resource (suite alone, measure alone, GPU timing uncontended): no segment is parallel-safe.

## Rulings from the gate (2026-09-13)

- Path B: the colony group first, then the body, then the frame. The exponential-damp A/B and three look briefs (eight pile shapes, per-blade grass phase, the animals' space) stay as the written Next briefs they are.
- The Steward's rule 4 (one ambition at a time) may be reopened, gated on the probe naming it.
- The HUD escapeHtml fix ships as its own PR outside the pass's count.
- Acceleration is on the driven body only, controller-side; the rig infers running from displacement normalised by ground speed, render-side; eye easing preserves today's 60 fps feel exactly (pin the observable, not the coefficient); acceleration ceiling 4 ticks to 99% and 3 to stop; sway and the run multiplier are zeroed under prefers-reduced-motion.
- The walking-feet round may shift the bob's phase or the hips' rest height, never add a negative term to `settlerBob`; the eye floor pin stands.
- GPU ms comes from fence-sync completion when the timer extension is absent on ANGLE-Metal, always method-tagged, never bare, never zero; no second GL-backend launch. The grass pin is as asked; the census's top pool is a Next brief.
- The colony pin is four columns (`builtPerDay`, `roomsPerDay`, `idleBoardShare`, `idleTakeableShare`); fixes are judged on `roomsPerDay` and whichever idle column the probe attributes. The pinned arm is the in-sim foreman on with the eval driver off, the grid's default arm.
- The label round is split: measure right after the pin, fix after the last grid-moving round. The sighting is the mood row on a settler between jobs.
- Probes are rolldown-built and node-run (`METHODOLOGY.md`); the probe round corrects the two stale `npx tsx` headers it touches and lists the other thirteen under Discovered.
- One PR per round. The suite runs with six workers. A probe round adds no ACCEPTANCE row.
- Segments that move an existing pin (1b, 1d, 2d) carry `riskTrigger` so the independent verifier reads the reason for every moved literal; the planner had left them unflagged.

## Order

| # | ID | Title | Group | Depends on | riskTrigger |
|---|---|---|---|---|---|
| 1 | `3a-sim-pin-build-rate` | Pin what the colony builds and how many hands stand idle | colony | — | yes |
| 2 | `3b-sim-probe-why` | The probe that names the gap, per tick, before any fix | colony | `3a-sim-pin-build-rate` | no |
| 3 | `0-hud-escape-html` | Escape the pawn's name before the HUD prints it | out of ask | — | no |
| 4 | `3e-measure-label` | Measure 'nothing fun to do' before touching it | colony | `3a-sim-pin-build-rate` | no |
| 5 | `3c-sim-fix-dispatch` | One fix in dispatch, or a recorded no-op | colony | `3b-sim-probe-why` | yes |
| 6 | `3d-sim-fix-steward` | The Steward's rule 4, reopened only if the probe names it | colony | `3c-sim-fix-dispatch` | yes |
| 7 | `3e-fix-label` | Fix the branch the label round named | colony | `3e-measure-label`, `3d-sim-fix-steward` | yes |
| 8 | `1a-feel-trace` | A scripted walk traced at three frame rates, pinned as it is | body | — | no |
| 9 | `1e-feel-interp-phase` | The bob stops stepping at 20 Hz | body | `1a-feel-trace` | yes |
| 10 | `1b-feel-eye-ease` | The eye eases at the same speed at every frame rate | body | `1e-feel-interp-phase` | yes |
| 11 | `1c-feel-accel` | The driven body accelerates and stops | body | `1b-feel-eye-ease` | yes |
| 12 | `1d-feel-bob-sway-run` | Sway and a run amplitude beside the one bob | body | `1c-feel-accel` | yes |
| 13 | `2a-frame-gpu-timer` | GPU milliseconds beside the wall clock | frame | — | no |
| 14 | `2b-frame-census-grass-budget` | The triangle census and the grass pin | frame | `2a-frame-gpu-timer` | no |
| 15 | `2c-look-hair-value-break` | A value break on the hair | frame | `2b-frame-census-grass-budget` | no |
| 16 | `2d-look-walking-feet` | The walking feet | frame | `2c-look-hair-value-break` | yes |
| 17 | `2e-look-arms-against-pitch` | The arms against the pitch | frame | `2d-look-walking-feet` | no |

## Segments

### `3a-sim-pin-build-rate` — Pin what the colony builds and how many hands stand idle

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Pin, as it is, what the colony builds and how much of its hands stand idle — four columns, not two, because one predicate cannot answer both questions Group 3 must tell apart (vault scar: one predicate answering two questions strands the follower; three reviewers converged). DaySnapshot (src/eval/run.ts) gains builtToday (delta of the cumulative world.stats.built at run.ts:754 — it increments per wall cell and fence post at jobs.ts:2967, so it is the ask's words, not the player's), roomsToday (delta of roomIndex(world).rooms.size — the number 'one room a day' names; probe-buildout.ts already computes it), idleBoardTicks (colonist-ticks idle while any unbuilt blueprint, cellDesig designation or open bill stands — the player's perception, the Steward's gap) and idleTakeableTicks (idle while such work is in this pawn's region (reachable, jobs.ts:511 — a region lookup, not a pathfind), priority > 0 in pawn.priorities, and supplied/unreserved — dispatch's gap). 'Idle' = (pawn.jobId === null OR the held job's kind is 'recreate') AND not sleeping/downed/dead/drafted/manual/isBreaking — reuse the predicates src/sim/idle.ts:140-165 already uses; world.jobs never holds unassigned work (createJob at jobs.ts:265 always sets pawnId), so 'open work' is never world.jobs. Counted per tick beside freeTicks (run.ts:604), never at the 07:12 snapshot. Both predicates exported from run.ts with doc comments that are the contract (one-way door: they become grid columns). RunMeasure (sweep.ts) gains builtPerDay, roomsPerDay, idleBoardShare, idleTakeableShare (numerator / awake colonist-ticks, exclusions stated; zero denominator pinned as 0, never NaN); the fields cross src/eval/worker.ts and the Measurements type in src/eval/measurements.ts. Named-run pin in tests/colony-eval.test.ts (harsh/99001 style) with `steward: false` passed explicitly (the eval driver off — load-bearing per that file's comment at ~198) and world.steward left undefined (foreman on: stewardOn() is `world.steward !== false`, worldgen never sets it), both in the test name. Ruled at the gate: the pinned arm is world.steward on (the in-sim foreman, as worldgen leaves it) with EvalOptions.steward false (the eval driver off), which is also the balance grid's default unmanaged arm and the arm every Group 3 fix is judged on. Then npm run measure (~90 min, box alone) and npm run balance; .eval/measurements.json re-committed; fingerprint old→new, the command, the SHA measured against and node version in the round note. Determinism proof: every pre-existing column of the new grid identical to the old — instrumentation must not perturb the sim. No new bar in principles.ts; no new field on Pawn/World. Operational: npm run measure takes about ninety minutes and a single tool call is capped at ten, so run it in the background with its output redirected to a log file and poll that log; nothing else runs on the box while it does.

**Depends on.** nothing. **riskTrigger** true · **parallelSafe** false.

**Success criteria.**
- `npm run eval` tables and the sweep header print builtPerDay, roomsPerDay, idleBoardShare, idleTakeableShare; idleTakeableShare ≤ idleBoardShare asserted on every run (subset, so the widening cannot silently become an alias)
- Literal pins of all four on the named run with both steward flags in the test name; 'one room a day' becomes a literal roomsPerDay in 'The gap.'
- Each predicate proven red-first by a local mutation (count sleeping settlers; drop the priority check), restored byte-identical
- tests/colony-run.test.ts tick-cost pins (50 ms/tick at :316, 12.5 ms at :335) green; the eval's own wall clock recorded before/after
- Every pre-existing column of .eval/measurements.json identical to the previous file; fingerprint old→new, command, SHA, node version recorded; npm run balance green; zero-denominator case pinned

**Tests.**
- npx vitest run tests/colony-eval.test.ts tests/colony-run.test.ts tests/measurements.test.ts
- npm run typecheck
- npm run measure && npm run balance (box alone)
- Full suite alone (maxWorkers 6, the config's value) before commit; a moving red set is contention, rerun

**writeSet.** `src/eval/run.ts`, `src/eval/sweep.ts`, `src/eval/worker.ts`, `src/eval/measurements.ts`, `tests/colony-eval.test.ts`, `tests/measurements.test.ts`, `.eval/measurements.json`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `src/eval/run.ts` (pr-diff), `tests/colony-eval.test.ts` (pr-diff), `.eval/measurements.json` (pr-diff)

### `3b-sim-probe-why` — The probe that names the gap, per tick, before any fix

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. The why, per tick, before any fix — the round that decides whether 3c or 3d (or neither) has a gap. Build and run with the METHODOLOGY recipe (`npx rolldown scripts/probe-dispatch.ts --format esm --platform node -d .eval/build && node .eval/build/probe-dispatch.js 40 7 1312 4242`), never `npx tsx`: package.json has no tsx, METHODOLOGY.md:144 says so, and 15 probe headers (probe-buildout.ts:16, probe-boardclear.ts:8 among them) are stale on the wrong side — correct the two this round touches, list the other thirteen under Discovered. Reuse probe-buildout.ts (built by kind, rooms) and probe-boardclear.ts (board-clear share, stewardLast); add scripts/probe-dispatch.ts only for what neither carries: per day, per seed (7, 1312, 4242, 99001, 424242), both difficulty arms, foreman on and off (setSteward), 40 days, every tick: the 3a predicates' two idle counts broken down by idleReason (src/sim/idle.ts) and by what the ASSIGN_INTERVAL=12 cadence (tick.ts:112, :354) delivered when it fired — took work / declined / takeABreak (IDLE_REC 0.75, jobs.ts:2468) / assignNeedsOnly (manual) — and ticks at jobId===null between jobs; whether planAhead ran or was gated by anyoneIdle (jobs.ts:415); per STEWARD_INTERVAL pass which of the three gates returned — boardStarved (steward.ts:2134), !playerClear (:2143), stewardLoad>0 (:2168) — or which ambition marked, with stewardCursor; and per ambition its wall-time partitioned into marking-wait / haul / build / blocked (starved, sleep hours, hostiles) — because the stewardLoad return is rule 4 ('one ambition at a time'), the design and not a bug, and whether it is the ceiling is the number that decides 3d; share of the day hauling. Output: a table and ONE sentence naming the gap from {dispatch never offers a job to a takeable hand; the board is empty because rule 4 holds one ambition; an ambition is haul-blocked; hands are hauling}, and the file the fix goes to. Not under src/sim or src/eval.

**Depends on.** `3a-sim-pin-build-rate`. **riskTrigger** false · **parallelSafe** false.

**Success criteria.**
- Runs in ~2 min per seed-arm via the rolldown recipe; the two touched headers corrected; thirteen stale headers listed in Discovered
- ROUND_NOTES table + the one sentence naming the gap with numbers, the target file, and whether rule 4 is the ceiling
- npm run balance green (fingerprint did not move); no file under src/

**Tests.**
- Instrument round — no vitest case (METHODOLOGY probe rule); the group's two categories are carried by 3a (pins) and the fix round
- npm run balance
- npm run typecheck (scripts/ is outside tsconfig include — rolldown is the probe's type gate; say so)

**writeSet.** `scripts/probe-dispatch.ts`, `scripts/probe-buildout.ts`, `scripts/probe-boardclear.ts`, `ROUND_NOTES.md`

**evidenceSurface.** `scripts/probe-dispatch.ts` (pr-diff), `ROUND_NOTES.md` (pr-diff), `.eval/build/` (external)

### `0-hud-escape-html` — Escape the pawn's name before the HUD prints it

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Outside the ask, ruled in at the gate: ships as its own PR, not counted in the pass. Verified in the code: HudChrome.syncFps interpolates save-derived strings into innerHTML unescaped — hud.ts:2672 `${target.verb}`, :2678 `${p.name}` and `${p.weapon}`, :2684 carriedLabel()/jobLabel() — while every other sink in the file escapes; importColony (src/sim/transfer.ts) → deserialize (src/sim/save.ts) trusts every string, so a pasted colony code with a pawn named `<img src=x onerror=…>` runs script on the 5062 origin that holds every saved colony. Fix: wrap the five interpolations in escapeHtml(); add `'` to escapeHtml's class (hud.ts:4539) with `&#39;`. Red-first hud test: a pawn named `<b>x</b>` renders as text (selfPanel.textContent contains the literal; querySelector('b b') is null). Lands before 3e-measure opens hud.ts. Discovered, not fixed: main.ts:16 hangs the App on window unconditionally (the look harness depends on it at shot.mjs:154); vite.config allowedHosts ['.local'] is a suffix match on a 0.0.0.0-bound dev server.

**Depends on.** nothing. **riskTrigger** false · **parallelSafe** false.

**Success criteria.**
- Five sinks escaped; `'` in escapeHtml's class; no behaviour change on any existing call site
- hud test red-first then green
- ROUND_NOTES entry + ACCEPTANCE automated row; typecheck green

**Tests.**
- npx vitest run tests/hud*.test.ts (grep on entry for the existing HUD test file)
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/client/ui/hud.ts`, `tests/hud.test.ts`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `src/client/ui/hud.ts` (pr-diff), `tests/hud.test.ts` (pr-diff)

### `3e-measure-label` — Measure 'nothing fun to do' before touching it

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Reproduce 'nothing to do' before touching it — HUD/test side only, no fingerprint. needs.ts:553-556 already splits the row (`pawn.jobId === null ? 'nothing fun to do' : 'tired of working'`) and its comment at :550 admits the old label 'reads as the game plainly lying'; hud.ts appends idleReason(world, p) under the stack rows; alerts.ts carries its own copy. So the residual sighting is one of: (i) 'nothing fun to do' on a settler between jobs — jobId is null for up to ASSIGN_INTERVAL=12 ticks between finishing and the next cadence hit, and anyoneIdle (jobs.ts:415) disables planAhead colony-wide so construction hauls always pass through that gap; (ii) a drafted or manual settler, holding no job while visibly busy; (iii) a settler on a recreate job — idle.ts:158-165 treats that as idle; (iv) the alert panel copy. Ruled at the gate: the player quoted the mood-row labels ('Nothing Fun to do', 'Tired of working'), so the surface is the mood breakdown row; the working assumption is a settler between jobs (the ASSIGN_INTERVAL=12 gap at tick.ts:354, widened by anyoneIdle gating planAhead at jobs.ts:415). This round reproduces before anyone fixes, so a wrong assumption costs a probe, not a round. Instrument: a per-tick test that drives a settler job→idle→job on a named seed and records (label, jobId, drafted, manual, activity, job.kind) every tick the label reads 'nothing fun to do'; pin label-shown ticks per day on a settler who is not idle by 3a's definition, as a literal, as it is. Names the branch that fires; the fix is 3e-fix's. Any new label reaches the DOM via escapeHtml()/textContent, never raw interpolation.

**Depends on.** `3a-sim-pin-build-rate`. **riskTrigger** false · **parallelSafe** false.

**Success criteria.**
- Literal pin: label-shown ticks/day on a working settler, as it is; the branch that fires named with numbers
- No file under src/sim or src/eval; fingerprint unchanged and stated
- tests/morale.test.ts neighbours (~504-507) untouched and green; manual ACCEPTANCE row (open a working settler's card on 5063 and read the rows)

**Tests.**
- The new per-tick label test
- npx vitest run tests/morale.test.ts tests/idle.test.ts
- npm run typecheck
- Full suite alone before commit

**writeSet.** `tests/mood-label.test.ts`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `tests/mood-label.test.ts` (pr-diff), `ROUND_NOTES.md` (pr-diff)

### `3c-sim-fix-dispatch` — One fix in dispatch, or a recorded no-op

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. One fix in dispatch against the 3a pin, on the mechanism 3b named — or a recorded no-op. The cadence is real and lives in src/sim/tick.ts, not jobs.ts: ASSIGN_INTERVAL = 12 (:112) staggered by pawn id (:354), PLAN_INTERVAL = 48 (:120) gated by anyoneIdle (jobs.ts:415); takeABreak at IDLE_REC 0.75 (jobs.ts:2468) parks a hand; SUPPLY_RADIUS/GATHER_RADIUS bound reachable supply. Red-first unit test beside the existing assignJob coverage (grep on entry; tests/idle.test.ts, tests/morale.test.ts are the neighbours). The pin moves by a literal (idleTakeableShare down and/or roomsPerDay up on the named run) and the golden floor holds. Ruled at the gate: yes. If 3b says dispatch is not the gap, this round is recorded as 'measured, not the gap' with a ROUND_NOTES entry, no code change and no ACCEPTANCE row, and 3d runs next. No new field on Pawn/World (or a deserialize backfill + test in src/sim/save.ts's existing style). `npm run live` beside `npm run balance`: the liveness suite is the repo's own instrument for 'the rule stayed correct and the feature quietly stopped happening' — a dispatch retune's failure mode. Operational: npm run measure takes about ninety minutes and a single tool call is capped at ten, so run it in the background with its output redirected to a log file and poll that log; nothing else runs on the box while it does.

**Depends on.** `3b-sim-probe-why`. **riskTrigger** true · **parallelSafe** false.

**Success criteria.**
- Red-first unit test on the dispatch behaviour 3b named
- Named-run pin moves by a stated literal (old/new in 'Verified.') — or 'measured, not the gap' with 3b's numbers and no code change
- npm run measure && npm run balance green; .eval/measurements.json re-committed; fingerprint + command + SHA + node version recorded
- npm run live promises green and recorded; tick-cost pins green; gait/architecture untouched

**Tests.**
- npx vitest run <jobs test file> tests/colony-eval.test.ts tests/colony-run.test.ts
- npm run live
- npm run measure && npm run balance
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/sim/tick.ts`, `src/sim/jobs.ts`, `tests/colony-eval.test.ts`, `.eval/measurements.json`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `src/sim/jobs.ts` (pr-diff), `.eval/measurements.json` (pr-diff)

### `3d-sim-fix-steward` — The Steward's rule 4, reopened only if the probe names it

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. One change in the Steward against the 3a pin — and, as the code stands, a design decision rather than a bug fix. Read before writing 'The gap.': the yard-hogging starvation (the memory note 'an ambition below a never-finishing one') is already closed — steward.ts:2176-2189 walks AMBITIONS round-robin from world.stewardCursor; the gates in front are boardStarved (:2134), !playerClear (:2143) and `stewardLoad(world) > 0` (:2168). That last return is rule 4 of the file's header — one ambition per pass, the next only once the last is standing — and a room is one ambition, so rooms/day is capped by one ambition's haul+build cycle however many hands stand idle. If 3b's partition says marking-wait behind a haul-blocked ambition is where idleBoardShare goes, the fix reopens rule 4 — e.g. a second mark per pass when ≥ K takeable hands stand idle and the open ambition is haul-blocked (not build-blocked), K a literal from the probe — and whether rule 4 may be reopened at all is the human's call (hard question), taken from 3b's gate table and not from taste. Failing test first in tests/steward.test.ts; probe-boardclear before/after (rolldown-built); npm run live; golden floor. 'Measured, rule 4 is the ceiling and stays' is an acceptable outcome, written as such. Ruled at the gate: rule 4 may be reopened, gated on 3b's partition showing that marking-wait behind a haul-blocked ambition dominates idle-board ticks; the change is a second mark when at least K takeable hands stand idle and the open ambition is haul-blocked, K a literal from the probe. Otherwise this round is a recorded no-op with the numbers. Operational: npm run measure takes about ninety minutes and a single tool call is capped at ten, so run it in the background with its output redirected to a log file and poll that log; nothing else runs on the box while it does.

**Depends on.** `3c-sim-fix-dispatch`. **riskTrigger** true · **parallelSafe** false.

**Success criteria.**
- 'The gap.' quotes 3b's partition and names the gate; red-first steward test
- Pin moves by a stated literal — or the round is a recorded no-op with the numbers
- npm run measure && npm run balance && npm run live green; measurements.json re-committed; fingerprint + command + SHA recorded; probe-boardclear before/after table
- No starvation or stalled regression on any arm; no new World field beyond stewardCursor (which exists) or a deserialize backfill + test

**Tests.**
- npx vitest run tests/steward.test.ts tests/colony-eval.test.ts
- rolldown-built probe-boardclear 40 7 1312 4242 before and after
- npm run live
- npm run measure && npm run balance
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/sim/steward.ts`, `tests/steward.test.ts`, `tests/colony-eval.test.ts`, `.eval/measurements.json`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `src/sim/steward.ts` (pr-diff), `.eval/measurements.json` (pr-diff)

### `3e-fix-label` — Fix the branch the label round named

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Fix only the branch 3e-measure named, after the last grid-moving round so two grids never re-measure at once (rule: at most one segment that moves the fingerprint is open at a time). If the fix is in hud.ts/alerts.ts (label logic client-side), the fingerprint does not move; if it is in needs.ts (moods feed breaks — fingerprinted), the grid re-measures. The 3e-measure number moves to a new literal. New DOM strings go through escapeHtml()/textContent. Operational: npm run measure takes about ninety minutes and a single tool call is capped at ten, so run it in the background with its output redirected to a log file and poll that log; nothing else runs on the box while it does.

**Depends on.** `3e-measure-label`, `3d-sim-fix-steward`. **riskTrigger** true · **parallelSafe** false.

**Success criteria.**
- Pin before/after literals; tests/morale.test.ts neighbours green
- If needs.ts changes: measure + balance re-run, fingerprint + command + SHA recorded; if HUD only: fingerprint unchanged and stated
- Manual ACCEPTANCE row; typecheck green

**Tests.**
- npx vitest run tests/mood-label.test.ts tests/morale.test.ts tests/idle.test.ts
- npm run measure && npm run balance only on the needs.ts path
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/sim/needs.ts`, `src/client/ui/hud.ts`, `src/client/ui/alerts.ts`, `tests/mood-label.test.ts`, `.eval/measurements.json`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `tests/mood-label.test.ts` (pr-diff), `src/client/ui/hud.ts` (pr-diff)

### `1a-feel-trace` — A scripted walk traced at three frame rates, pinned as it is

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Instrument first, no knob moves — and the trace must be able to carry the frequencies it judges (LOOK.md's own lesson). tests/fps-trace.test.ts in the fps-view style (fakeInput, bodyIn, clearRun) drives FpsController.applyTick → a PawnsView-style prev/curr lerp → updateCamera with the frame loop rebuilt from pace()/alphaOf() at 30, 60 and 144 fps, the literal 1/60 reproduced exactly as app.ts:349 passes it. Script: stand 10 ticks, walk +X 40, Shift-run 40, release 20, one 90° turn — THEN lie down 20 ticks and stand 20 (activity 'sleeping' → 'idle'), because on flat ground `wanted` at controller.ts:161-162 is EYE_HEIGHT for the whole walk (standHeight is 0 off a built bed, eye starts at EYE_HEIGHT, attach() never displaces it) so the ease term is identically zero and frames-to-90% is undefined without a transient. Then a `speed` 3× fast-forward stretch and a >2-cell teleport with a stated snap rule (kept even though the A/B is a Next brief here — they cost nothing and the snap rule is what 1e-phase needs). Every pin a literal at a named sample frame (index + wall ms — parity-gate scar): eye height, shown x, per-tick speed (ticks-to-top = 1, ticks-to-stop = 1 as it is), frames-to-90% of the stand-up at each rate (same frame count today → three wall times: the eye gap), and the bob staircase — settlerBob(pawn.animPhase) is read raw by the eye (controller.ts:175) and the rig (pawns.ts:832, :1517) while PawnsView.onTick snapshots only {x, y, f} (pawns.ts:2652-2670), so the bob changes on ~2 of 3 frames at 30, 1 of 3 at 60, 1 of 7 at 144: pin 'bob changed on N of M frames' per rate. Also pin today's interpolation against a truth line independent of any candidate — the sim's position at each wall time, curr + v·alpha — mean/max positional error, latency through run→stop, jitter, heading error, each with a tolerance, so a later A/B cannot choose its own metric.

**Depends on.** nothing. **riskTrigger** false · **parallelSafe** false.

**Success criteria.**
- Green with zero changes under src/; every assertion a literal with its sample frame (index + wall ms)
- Eye-ease divergence in ROUND_NOTES 'The gap.' as three literal wall times on the stand-up transient
- Staircase pins per rate recorded as the larger gap; A's four interpolation metrics pinned per rate with tolerances
- Proven able to go red: dt*9 → dt*5 turns the trace red; restored byte-identical (in 'Verified.')
- ACCEPTANCE automated row; typecheck green

**Tests.**
- npx vitest run tests/fps-trace.test.ts
- npx vitest run tests/fps-view.test.ts tests/pace.test.ts tests/gait.test.ts tests/architecture.test.ts
- npm run typecheck
- Full suite alone before commit

**writeSet.** `tests/fps-trace.test.ts`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `tests/fps-trace.test.ts` (pr-diff), `ROUND_NOTES.md` (pr-diff)

### `1e-feel-interp-phase` — The bob stops stepping at 20 Hz

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. The largest gap the trace shows, fixed first: interpolate animPhase between ticks alongside x/y/f so the ONE bob is continuous at every frame rate instead of stepping at 20 Hz. PawnsView.prev/curr gain `ph`; sync() passes the lerped phase into rig.update (the rig at pawns.ts:832/:1517 reads the passed phase, not pawn.animPhase); interpolated() returns it; app.ts:348-349 hands it to updateCamera, which takes a phase argument in place of the raw read at controller.ts:175. animPhase only ever increases (movement.ts:116, PHASE_PER_CELL 7.5) so the lerp is safe; a snapshot reset (teleport, first sight) follows the 1a snap rule. The one-writer rule is untouched — the renderer reads two snapshots of a sim-written value and writes none. Evidence: frames land in the gitignored .look/shots/, so the round note's Verified section names each frame and what it showed, and the PR body lists the frame paths.

**Depends on.** `1a-feel-trace`. **riskTrigger** true · **parallelSafe** false.

**Success criteria.**
- fps-trace: at 144 fps the bob changes on every walking frame; max per-frame bob delta ≤ a literal; tick-boundary values equal the raw ones (exact at alpha 0/1); the 30/60 staircase pins move to their new literals with the reason
- fps-view 'rise ≈ settlerBob(phase)' and 'never below standing height' green unchanged; pace.test.ts unchanged; gait scan and architecture test green
- forge-recipes untouched; crew walking settler + 4-firstperson before/after read back (stills show pose, the trace shows continuity — both recorded)
- typecheck green; ACCEPTANCE row

**Tests.**
- Red-first: fps-trace 'bob changes every frame at 144 fps' fails against 1a code
- npx vitest run tests/fps-trace.test.ts tests/fps-view.test.ts tests/pace.test.ts tests/gait.test.ts tests/architecture.test.ts
- LOOK_MIRROR=<scratch> npm run look:crew before/after
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/client/render/pawns.ts`, `src/client/fps/controller.ts`, `src/client/app.ts`, `tests/fps-trace.test.ts`, `tests/fps-view.test.ts`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `src/client/render/pawns.ts` (pr-diff), `tests/fps-trace.test.ts` (pr-diff), `.look/shots/` (external)

### `1b-feel-eye-ease` — The eye eases at the same speed at every frame rate

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Frame-rate-independent eye easing. In src/client/fps/controller.ts replace `this.eye += (wanted - this.eye) * Math.min(1, dt * 9)` with `1 - Math.exp(-EYE_RATE * dt)`, and at app.ts:349 pass the real frame dt that render(alpha, dt) already holds (clamped at app.ts:216/272) instead of the literal 1/60. Pin the observable, not the coefficient: the exact rate −60·ln 0.85 = 9.7508… fails a 1e-6 pin on a rounded literal, so pin 'fraction remaining after one 1/60 s frame = 0.85 within 1e-6' and frames-to-90% of the stand-up collapsing to one wall time at 30/60/144. Ruled at the gate: preserve today's 60 fps ease exactly. Pin the observable (0.85 remaining after one 1/60 s frame, within 1e-6), not the coefficient; the round changes the rate's dependence on frame rate, not its value at the reference rate.

**Depends on.** `1e-feel-interp-phase`. **riskTrigger** true · **parallelSafe** false.

**Success criteria.**
- fps-trace: frames-to-90% at 30/60/144 collapse to one wall time within one frame (literal pins); the 60 fps values unchanged within 1e-6
- app.ts passes dt, not 1/60; the trace no longer reproduces a hardcoded dt
- applyLook rate×dt parity test and every other fps-view test green unchanged
- ROUND_NOTES 'Verified.' names the old three wall times and the new one; ACCEPTANCE row; typecheck green

**Tests.**
- Red-first: the new parity assertion fails before the change
- npx vitest run tests/fps-trace.test.ts tests/fps-view.test.ts tests/head-aim.test.ts
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/client/fps/controller.ts`, `src/client/app.ts`, `tests/fps-trace.test.ts`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `src/client/fps/controller.ts` (pr-diff), `tests/fps-trace.test.ts` (pr-diff)

### `1c-feel-accel` — The driven body accelerates and stops

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Acceleration and stopping on the driven body, top speed unchanged. FpsController keeps (vx, vy) in cells per tick and each applyTick eases it toward wanted = dir × (running ? PLAYER_RUN : PLAYER_WALK) × ground / len with per-tick constants (ACCEL_TICKS, STOP_TICKS — tick domain, frame-rate independent by construction), then calls moveWithCollision(world, pawn, vx, vy) exactly as today — still the only mover and the only writer of animPhase. Reconciliation the draft lacked: AFTER moveWithCollision, velocity := actual displacement (pawn.x − x0, pawn.y − y0) so blocked motion is forgotten (no phantom momentum launched out of a wall-slide); velocity reset in attach() (a body possessed mid-stride must not inherit another's) and when dead/downed/sleeping; pawn.activity stays 'walking' while |v| > ε so the bob does not stop while the body still slides (the else-branch at controller.ts:144-146 flips it on key release today). A ceiling as a hard criterion, not just a pin: 99% of top speed within ≤ ACCEL_CEIL ticks and stop within ≤ STOP_CEIL (ruled at the gate: ACCEL_CEIL 4, STOP_CEIL 3). Peak asserted against PLAYER_WALK × ground for the cell walked. Velocity lives in the controller, not on Pawn — no persisted field, no save backfill. PLAYER_WALK 0.165 and PLAYER_RUN 0.27 do not move. Ruled at the gate: the driven body only, controller-side, no fingerprint move. Settlers' followPath stays as it is; 1d's crew frames look for the possessed-starts-slower divergence and log it as a Next brief if it shows.

**Depends on.** `1b-feel-eye-ease`. **riskTrigger** true · **parallelSafe** false.

**Success criteria.**
- Literal pins: ticks to 99% of top speed = N ≤ ceiling; ticks from release to |v| < 0.001 = M ≤ ceiling; peak = PLAYER_WALK × ground / PLAYER_RUN × ground within 1e-9
- Wall case pinned: 60 ticks into a wall then D reaches top speed in the same N as from rest; attach() reset pinned; activity stays 'walking' until |v| < ε
- Existing fps-view tests green unchanged: wall stop, stride by ground covered, one stride per cell, eye rides the bob, eye still when idle
- fps-trace pins move only where speed changes, each named with the reason; 30/60/144 traces identical per tick
- gait.test.ts and architecture.test.ts unchanged and green; no new field on Pawn/World
- PLAYTEST.md §4 'Expect' gains one line; ACCEPTANCE manual row; the tier-2 verifier answers 'does the first press feel responsive' explicitly

**Tests.**
- Red-first in tests/fps-view.test.ts: 'reaches top speed over N ticks, not one' and 'forgets blocked motion at a wall'
- npx vitest run tests/fps-view.test.ts tests/fps-trace.test.ts tests/gait.test.ts tests/architecture.test.ts
- Manual: PLAYTEST §4 on the dev server (5063) — walk, run, stop, into a wall
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/client/fps/controller.ts`, `tests/fps-view.test.ts`, `tests/fps-trace.test.ts`, `PLAYTEST.md`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `src/client/fps/controller.ts` (pr-diff), `tests/fps-view.test.ts` (pr-diff)

### `1d-feel-bob-sway-run` — Sway and a run amplitude beside the one bob

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Lateral sway and a run amplitude beside the one bob the rig and the eye share — on the interpolated phase 1e-phase now provides. settlerBob(phase, r) keeps its signature AND its value (the draft's 'a running input on both' contradicted 'keeps its signature' — resolved: no new parameter; one literal RUN_BOB multiplier applied by the two callers). Beside it settlerSway(phase, r): signed, one cycle per stride (half the bob's frequency), zero at phase 0 so idle poses and the bench-vs-colony comparison are untouched. settlerPose adds a lateral root offset next to `lift`; updateCamera adds right-vector × sway next to bobY — the stackRise/settlerBob extraction discipline a third time. Ruled at the gate: (b). PawnsView.onTick infers running from the prev-to-curr displacement per tick, normalised by groundSpeed(world, x, y) before thresholding at WALK_SPEED x 1.1, render-only, no sim field; the eye uses the controller's own Shift flag. If (b): normalise the per-tick displacement by groundSpeed(world, x, y) — already imported client-side at controller.ts:21 — before thresholding, because paving lifts a walker above a bare threshold and SNOW_DRAG drops a runner below it; only combat.ts ever runs a settler, so the rig's run amplitude shows in combat frames only. Motion accommodation: the controller reads matchMedia('(prefers-reduced-motion: reduce)') once and zeroes sway and the run multiplier (today's eye bob stays), mirroring style.css:2466. Amplitudes chosen by the frames (bench bob slider + eight-pose grid, crew walking settler, 4-firstperson) AND a PLAYTEST §4 walk/run line (sway is a motion judgement), then pinned as literals. Evidence: frames land in the gitignored .look/shots/, so the round note's Verified section names each frame and what it showed, and the PR body lists the frame paths.

**Depends on.** `1c-feel-accel`. **riskTrigger** true · **parallelSafe** false.

**Success criteria.**
- settlerBob unchanged: forge-recipes lift table and the 0.035 fps-view pin pass without edit
- Literal pins: sway peak (walk), sway peak (run) = walk × RUN_BOB, bob peak (run); sway(0) = 0; sway period = 2 × bob period; amplitude unchanged across grass → paving → snow for the same input
- fps-view: the eye's lateral offset at the pinned phase equals settlerSway; run peak > walk peak; eye still when idle; reduced-motion zeroes sway and RUN_BOB
- Before/after frames (crew, 4-firstperson, forge walking pose) read back and the Verdict written; PLAYTEST §4 line; no new field on Pawn/World
- Architecture test green; typecheck green

**Tests.**
- Red-first: fps-view 'eye sways with the stride' and forge-recipes 'sway is zero at phase 0'
- npx vitest run tests/fps-view.test.ts tests/fps-trace.test.ts tests/forge-recipes.test.ts tests/lighting.test.ts
- LOOK_MIRROR=<scratch> npm run look:crew before and after; frames read back
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/client/render/pawns.ts`, `src/client/fps/controller.ts`, `tests/fps-view.test.ts`, `tests/fps-trace.test.ts`, `tests/forge-recipes.test.ts`, `PLAYTEST.md`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `src/client/render/pawns.ts` (pr-diff), `tests/fps-view.test.ts` (pr-diff), `.look/shots/` (external)

### `2a-frame-gpu-timer` — GPU milliseconds beside the wall clock

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. GPU ms beside the wall 17 ms — designed so the fallback is the primary path and the instrument names its method. shot.mjs:129-137 already knows the wall number is the swap interval (189→123 draw calls did not move it) and already reads renderer.info into the `cost` object at :153-171 — extend that object, do not build a second. Step one (research, one console call): gl.getSupportedExtensions() under the box's Chrome-for-Testing on --use-angle=metal — macOS historically exposes no timestamp queries and Safari's ANGLE-Metal lists no EXT_disjoint_timer_query_webgl2, so expect absent. Primary: after viewport.render, fenceSync(SYNC_GPU_COMMANDS_COMPLETE) + flush, poll getSyncParameter(SYNC_STATUS) on later rAFs, report submit→signalled as completion ms — with --disable-gpu-vsync added to the launch args only after re-checking the six standard frames come back pixel-identical under it (chrome.mjs:41-54 did exactly this for --disable-frame-rate-limit); cross-check once against a gl.finish() stall. Bonus: if the extension is listed, TIME_ELAPSED_EXT per frame, discard batches with GPU_DISJOINT_EXT, median/max over ≥10 valid samples. The cost line prints the method with the number — `gpu 4.1/6.3 ms (fence)` / `(timer)` / `gpu n/a` — never a bare number and never zero (vault scar: degrade in the product, fail in the measurement). Reducer pure and import-free in scripts/look/gpu.mjs with a hand-written scripts/look/gpu.d.mts beside it (tsconfig includes tests/ under strict with no allowJs, so the tests→scripts import is TS7016 under npm run typecheck without it); it pulls nothing from scripts/look/node_modules into the vitest worker. Flag constraint: rendering/timing flags only — --no-sandbox, --disable-web-security, --allow-file-access-from-files, --remote-debugging-port are out of bounds. The timing pass runs with nothing else on the box. LOOK.md instruments row; look-round.js Cost line reads it. Discovered, not fixed: main.ts:16 hangs the App on window unconditionally and the harness depends on it (shot.mjs:154). Evidence: frames land in the gitignored .look/shots/, so the round note's Verified section names each frame and what it showed, and the PR body lists the frame paths.

**Depends on.** nothing. **riskTrigger** false · **parallelSafe** false.

**Success criteria.**
- The six standard frames print method-tagged GPU ms or the explicit n/a with zero console errors
- Pixel-identity of the six frames under --disable-gpu-vsync recorded, or the flag not adopted and the round says why
- Reducer (disjoint discard, median/max, n/a path) unit-tested without a browser; gpu.mjs imports nothing
- Colony frame's first reading in ROUND_NOTES Cost as the baseline every later look round compares against
- No file under src/ changes; npm run typecheck green with the .d.mts

**Tests.**
- npx vitest run tests/look-gpu.test.ts
- npm run typecheck
- LOOK_MIRROR=<scratch> npm run look (six frames), cost lines read back
- Full suite alone before commit

**writeSet.** `scripts/look/gpu.mjs`, `scripts/look/gpu.d.mts`, `scripts/look/shot.mjs`, `scripts/look/chrome.mjs`, `tests/look-gpu.test.ts`, `LOOK.md`, `.claude/workflows/look-round.js`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `scripts/look/gpu.mjs` (pr-diff), `tests/look-gpu.test.ts` (pr-diff), `.look/shots/` (external)

### `2b-frame-census-grass-budget` — The triangle census and the grass pin

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. The census, then the grass pin — with the premise corrected. decor.ts:36-38's own arithmetic: 1,599,990 grass triangles of a colony frame's 8,000,822 is 20.0%, not 5.7% — the 5.7% is the 5→7 tufts increment (457,140), the comment is right and stays. The grass is a fifth of the frame in one instanced draw with castShadow false (:394), so it is not in the shadow pass; the ask's 'triangle budget for the grass' is better justified than the draft implied. Census: extend the cost object with the top-ten pools by indexCount/3 × (instanced ? count : 1), castShadow flagged, and the shadow-pass share (renderer.info triangles with shadowMap on vs off across two frames) — this says where the other 80% goes. Pin in tests/decor-view.test.ts: tufts.count × 15 on the standard meadow as a literal, one InstancedMesh draw, blade ≤16 unchanged. No triangle removed this round. Ruled at the gate: pin the grass as asked (it is 20.0% of the frame, not 6%); the census's top pool becomes the Next brief, not this round's fix. (The marker's '~6%' premise is the misread; the question that survives is whether the census's top pool becomes this round's fix or a Next brief.) Evidence: frames land in the gitignored .look/shots/, so the round note's Verified section names each frame and what it showed, and the PR body lists the frame paths.

**Depends on.** `2a-frame-gpu-timer`. **riskTrigger** false · **parallelSafe** false.

**Success criteria.**
- Colony frame prints the top-ten census and the shadow share; the numbers are in ROUND_NOTES beside the 2a GPU ms
- decor-view pins: tuft triangles on the standard meadow as a literal; one draw for the grass; blade ≤16 unchanged; red-first by a local TUFTS_PER_CELL bump, restored
- The TUFTS_PER_CELL comment is NOT edited (it is correct); the census's top pool written as the Next brief
- typecheck green; ACCEPTANCE row

**Tests.**
- npx vitest run tests/decor-view.test.ts tests/look-gpu.test.ts
- npm run typecheck
- npm run look:shot on the colony frame, cost line read back
- Full suite alone before commit

**writeSet.** `scripts/look/shot.mjs`, `scripts/look/gpu.mjs`, `tests/decor-view.test.ts`, `LOOK.md`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `tests/decor-view.test.ts` (pr-diff), `.look/shots/` (external)

### `2c-look-hair-value-break` — A value break on the hair

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Look round, pawns lane: round thirteen's brief — a value break on the hair ('a lighter crown or a darker nape') so the head reads at manager zoom. Executor reads the originating brief (ROUND_NOTES ~3446) before writing 'The gap.' Before frames from heads.mjs and crew.mjs; the change in the settler head's hair material/colour in src/client/render/pawns.ts (palette.ts only if the value comes from there); a literal luminance-difference pin (crown vs nape ≥ a stated number) in tests/lighting.test.ts; after frames read back; Verdict and Cost (with 2a's method-tagged GPU ms) written. Evidence: frames land in the gitignored .look/shots/, so the round note's Verified section names each frame and what it showed, and the PR body lists the frame paths.

**Depends on.** `2b-frame-census-grass-budget`. **riskTrigger** false · **parallelSafe** false.

**Success criteria.**
- Before/after heads and crew frames read back; Verdict written
- Literal luminance-difference pin, proven red-first
- Settler rig triangle budget (~3,000) and forge-recipes part comparison unchanged
- Cost line carries method-tagged GPU ms; typecheck green

**Tests.**
- npx vitest run tests/lighting.test.ts tests/forge-recipes.test.ts
- LOOK_MIRROR=<scratch> npm run look:heads and look:crew before and after
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/client/render/pawns.ts`, `src/client/render/palette.ts`, `tests/lighting.test.ts`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `src/client/render/pawns.ts` (pr-diff), `.look/shots/` (external)

### `2d-look-walking-feet` — The walking feet

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Look round, pawns lane: the walking settler's feet — the forge round measured the sole 44 mm off the turf at quarter stride while the bob lifts 0 there and peaks at the eighths. Constraint the draft missed: tests/fps-view.test.ts:332-364 pins the eye 'never below standing height' with stand sampled at animPhase 0, and the eye IS settlerBob — so 'drop the body by the planted sole's rise' as a negative term in settlerBob is forbidden. Pin-compatible moves only: a phase shift of the bob relative to the stride (the eye follows, correct by contract; fps-view/fps-trace/forge-recipes pins move with a stated reason, the 0.035 peak stays) or a rig root/hips rest-height change in settlerPose that leaves the eye untouched. The bench bob slider + eight-pose grid and the crew walking frame judge walk vs limp. Pin: lowest sole height at quarter stride ≤ a literal (from 0.0438 to what the frames pick); lift table re-pinned as literals. Evidence: frames land in the gitignored .look/shots/, so the round note's Verified section names each frame and what it showed, and the PR body lists the frame paths.

**Depends on.** `2c-look-hair-value-break`. **riskTrigger** true · **parallelSafe** false.

**Success criteria.**
- Before/after forge walking pose and crew frames read back; Verdict written
- Literal sole-height and lift-table pins in tests/forge-recipes.test.ts; any moved pin named
- fps-view 'never below standing height' and 'rise ≈ settlerBob(phase)' green — updated only for a phase shift, never loosened; the trace still green
- moveWithCollision remains the only writer of animPhase; gait scan green; typecheck green

**Tests.**
- npx vitest run tests/forge-recipes.test.ts tests/fps-view.test.ts tests/fps-trace.test.ts tests/gait.test.ts
- Bench at /forge.html (dev 5063) walking pose, and look:crew before/after
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/client/render/pawns.ts`, `src/client/gait.ts`, `tests/forge-recipes.test.ts`, `tests/fps-view.test.ts`, `tests/fps-trace.test.ts`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `tests/forge-recipes.test.ts` (pr-diff), `.look/shots/` (external)

### `2e-look-arms-against-pitch` — The arms against the pitch

**Goal.** Read the Standing rules in PLAN.md (commit footer, round note, ACCEPTANCE row, the suite alone with six workers) and METHODOLOGY.md before writing. Look round, pawns lane: the settler's arms against the pitch (briefs at ROUND_NOTES ~1785 and ~1887; armSplay 0.12 sits 5% under thumbLimit 0.12628, so the room is the arm's roll/pitch, not the splay). Executor reads the originating brief and states the gap as a number from the before frame (zoo/crew at the standard 27° pitch). One change in settlerPose/assembleSettler; a literal rotation pin in tests/forge-recipes.test.ts (extend the bench's distinctness test that already reads the four limb rotations — do not add a box); frames before/after. The three remaining look briefs (eight pile shapes, per-blade grass phase, animals' space) are left as the written Next briefs they already are, with 2a's GPU ms and 2b's census recorded so they start with numbers. Evidence: frames land in the gitignored .look/shots/, so the round note's Verified section names each frame and what it showed, and the PR body lists the frame paths.

**Depends on.** `2d-look-walking-feet`. **riskTrigger** false · **parallelSafe** false.

**Success criteria.**
- 'The gap.' quotes the originating brief and a measured number from the before frame
- One literal rotation pin, red-first; the bench default recipe remains buildable (the splay drill that turned nine tests red is the known trap)
- Before/after crew and zoo frames read back; Verdict written; typecheck green
- Next section names the three untaken briefs with the 2a/2b numbers beside them

**Tests.**
- npx vitest run tests/forge-recipes.test.ts tests/lighting.test.ts
- look:crew and look:zoo before/after
- npm run typecheck
- Full suite alone before commit

**writeSet.** `src/client/render/pawns.ts`, `tests/forge-recipes.test.ts`, `ROUND_NOTES.md`, `ACCEPTANCE.md`

**evidenceSurface.** `src/client/render/pawns.ts` (pr-diff), `.look/shots/` (external)

