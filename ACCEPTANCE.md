# Acceptance

What the build promised, and where each promise is actually held down. Rows marked
**automated** fail the suite if they stop being true; rows marked **manual** need a
browser and live as a numbered step in [PLAYTEST.md](PLAYTEST.md).

*The other five documents:* [README.md](README.md) is what the game is and how each
system works, [ARCHITECTURE.md](ARCHITECTURE.md) is how the code is laid out and why,
[PLAYTEST.md](PLAYTEST.md) is the browser tour these manual rows point into,
[METHODOLOGY.md](METHODOLOGY.md) is the loop that produces the rows below — which
instrument answers which question, and why a promise needs one — and
[ENDGAME.md](ENDGAME.md) is what is still missing at the far end of a run.

Four sections: [the killer feature](#the-killer-feature),
[the engine constraints](#the-engine-constraints), [the anti-slop rules](#the-anti-slop-rules),
and [what still wants a human](#what-still-wants-a-human) — which is the long one, and is
ordered to match `PLAYTEST.md` rather than by importance.

Last run — 2026-09-17, the mood-label round: `src/sim/needs.ts` changed, so the sixty-day
grid was re-run — fingerprint `4ca9864e` → `e61c7f10`, 39 colonies, 6077.867 s — and **no
measured number moved**. Three leaves differ and all three are metadata: the fingerprint,
the wall-clock, and the timestamp. The label the round fixed is read by the card, the
alert hint and nothing else; `src/eval` never looks at one. The numbers below are still
the build-rate round's, described as it measured them:

Before that — 2026-09-14, the build-rate round: two counters in `src/eval/run.ts` and four
columns in `src/eval/sweep.ts`, so the sixty-day grid was re-run — fingerprint `4e67f12b`
→ `4ca9864e`, 39 colonies, 6223.073 s. The grid could already see downs, threats and
the food line, and never the two things a player is actually watching when a colony
feels stuck:
whether anything is getting built, and whether the hands standing idle could have picked
something up. `builtPerDay`/`roomsPerDay` are literal deltas of
`world.stats.built`/`roomIndex(world).rooms.size`; idle is two questions, not one —
`idleBoardShare` (the Steward's gap) counts a colonist-tick idle while *any* work stands
on the board, `idleTakeableShare` (dispatch's gap) counts idle only while work stands
reachable, prioritized, supplied and unclaimed for *that* pawn. harsh/99001, the named
pin (foreman on, eval driver off — `steward: false` stated in the test name):
`builtPerDay` **4.8**, `roomsPerDay` **0.03**, `idleBoardShare` **0.124**,
`idleTakeableShare` **0.049** — the row's own seven-and-a-half-point split between "the
board has something" and "this pawn can take it" is measured, not yet explained, and is
the whole of `3b-sim-probe-why`'s ask.

Three of those four numbers moved after review, because three of the four columns were
measuring something other than what their names say. `roomsPerDay` started its delta at
zero, so day one booked every room the world was *generated* with — `roomIndex` counts
natural rock as wall, and an untouched map holds 3 rooms on seed 99001 and 34 on
20260729 before a settler lifts anything. The published 0.13 was 0.10 world-gen and 0.03
colony; on 20260729 the baseline alone would have read 1.13 a day, which is the whole of
"one room a day" manufactured out of worldgen. `awakeTicks`, the denominator, excluded
only sleep while `isIdlePawn`, the numerator, also excludes drafted, hand-driven and
on-a-break — a tick that can only be a zero on top counted as a one underneath, so the
settings that break most read as idling least. And `hasTakeableWork` answered true on a
stalled research bill whose parts were already on the map, which was never work:
`researchNeeds` subtracts `spendableResource` to get its gap, so the branch hunted for
exactly the stacks its own need had already counted. Deleted. `builtPerDay` held at 4.8,
but read it as buildings a day — beds, stoves and doors included — not wall cells:
`jobs.ts:2967` has no filter on kind.

Cost of the round, measured three ways on a quiet box (`origin/main` with no counters,
the first cut, this one; 30 days, `playPastFounding`): harsh/99001 76.9 s → 91.0 s →
82.1 s, and harsh/7 — three times as idle — 104.8 s → 151.5 s → 118.9 s. The first cut
rebuilt the whole 36,864-cell designation scan inside the per-pawn loop, so the harness
charged most for exactly the colonies it exists to study: +44.5% on the idle-heavy seed,
which the round's original "~21%, accepted rather than chased" had never measured because
it timed the least idle seed on the grid. `takeableTargets` hoists every pawn-independent
check out to once a tick, leaving only priorities and `reachable` per pawn, and the
overhead falls to +13.4% and +6.8%.

The staleness guard is the other thing this round leaves behind. `staleness` was called
from exactly one place — inside `describe.runIf(process.env.BALANCE)` — so `npm test`
never asked whether the grid on disk describes the sim on disk. That is how `main` came
to carry a grid claiming `effc8eef` against a `2e868453` tree across thirteen commits
under `src/sim`/`src/eval`, every gate green, while rounds in that window quoted its
numbers. `tests/measurements.test.ts` now asks unconditionally, at no measurement cost.
The trade is deliberate: a sim-touching PR must re-measure or drop the grid.

`npm run balance` — the one break, `on-their-feet-at-zero-is-a-walk-home`, is real and
pre-existing: proven by an A/B on this branch's own base commit that comes back
byte-identical on every pre-existing field, `starveHours: 28.32` included. The round's
first draft blamed something outside the fingerprinted sim; the fingerprint says
otherwise. `effc8eef` was fresh at `5cffcee`, `ea26e6a0` hashes `2e868453`, and thirteen
commits touch `src/sim`/`src/eval` between them. The drift is inside that window, so
the follow-up round is a bounded bisect of thirteen commits rather than a search of
everything the sim is not. Flagged for its own round; not patched here.

- `npx tsc --noEmit` clean.
- `npm test` — **130 files passed and 2 skipped, 2,828 tests passed and 13 skipped,
  1,205.69 s**.
  `tests/idle-predicates.test.ts` (24 tests) pins `isIdlePawn`/`boardOpen`/
  `hasTakeableWork` and `takeableTargets` directly, including the till-designation
  branch, the reserved blueprint, and the stalled bill now reading false with hauling
  on. A new block enumerates every `DESIG_` constant off `src/sim/types.ts` itself, so
  a designation added without a matching branch in `takeableTargets` fails rather than
  reading as a colony with less work on it.
  `tests/colony-eval.test.ts` pins all four rates on harsh/99001 with both steward flags
  named, and both zero-denominator guards on hand-built reports — the run-based version
  returned at the first guard and never reached the one its own comment described.
- Four red-first mutations, each restored byte-identical from a kept copy: adding a
  `DESIG_` constant with no branch failed two tests; restoring the stalled-bill branch
  failed one; `prevRooms` back to zero failed the rooms pin; `awakeTicks` back to
  sleep-only failed both share pins.
- `npm run balance` — 15 of 16 enforced principles hold, and every verdict line the
  judge prints is byte-identical to the one it printed against the grid before this
  round: the same 15 HOLDS and the same single enforced break,
  `on-their-feet-at-zero-is-a-walk-home`, naming settler/1312 at 28.3 h, settler/99001
  at 45.2 h and harsh/7 at 34.6 h. A re-measured grid returning identical verdicts is
  the strongest form the "pre-existing, not this round's doing" claim can take.
- Determinism against the previous grid: all 1,266 pre-existing `RunMeasure` fields
  across the 15 unmanaged runs, the 15 war runs and the 3 arm rows are byte-identical
  to the grid measured at `5a04b0e` — `starveHours` to the hundredth, `meanFood`,
  `upkeepShare`, `tradedWorth`, `ringOpenedOn`, all of it. Every difference sits in the
  four new columns, and each moves the way its own correction predicts: `builtPerDay`
  does not move on any of the thirty rows; `roomsPerDay` falls on all thirty;
  `idleBoardShare` rises on twenty-one and falls on none, its only correction being a
  denominator that can only shrink; and `idleTakeableShare`, the one column pulled two
  ways, rises on seven, holds on twenty-two and falls on one — war calm/7, 0.061 →
  0.013, a colony whose takeable work was almost all the research bill that was never
  takeable.

Last run — 2026-08-13, the rescuer round: one constant in `src/sim/jobs.ts` and one latch in
`src/eval/run.ts`, so the sixty-day grid was re-run — fingerprint `ce4d9a8f` → `8b19f4e1`, 39
colonies, 3016 s. `strandedStarveHours` named the right population and still could not name a defect:
between a third and nine tenths of it, seed by seed, was a settler somebody **had** answered, with
the meal still walking over. `unfedStarveHours` is that column minus every tick a `feedPatient` job
already names the patient, and with it in hand the defect was one tally away — **of 6036
settler-ticks where the feeding pass looked at an upright colonist and declined to send them to
somebody lying at 0.00, 6035 declined on the rescuer's own hunger.** One tick in six thousand was
anything else; the pass was working, it was being asked the wrong question. The gate read `HUNGRY`,
0.34, most of a working day still in hand, for an errand that *begins* at the food stack. It now
reads `RESCUER_KEEPS = PATIENT_EMERGENCY_FOOD`, 0.14 — deliberately the same constant, so a settler
is excused from carrying a meal exactly when they are the person somebody should be carrying one to.
Worst wait on the floor 58.39 h → **35.14 h**, stranded 10.48 h → **8.04 h**, 53 fewer downs, one
fewer burial, three more survivors. `nobody-starves-beside-a-full-pantry` reads the narrow column now
and goes 9 of 15 runs at worst 10.5 h → **7 of 15 at worst 4.7 h**; like-for-like on the old column
the count is unchanged at 9, so the fix shortened the waits and did not end them, and the one-hour
bar was left where it was rather than tuned until the grid went green. The cost is one column up and
it is the one the change asks for — rescuers now spend their own margin on the errand, so the longest
spell **upright** at zero went 7.92 h → **9.79 h** against `on-their-feet-at-zero-is-a-walk-home`'s
enforced twelve. It holds, with less room than it had.

- `npx tsc --noEmit` clean.
- `npm test` — **98 of 100 files, 1866 tests green**, 13 skipped, in 861 s.
  **Three** of the four new ones are in `tests/feeding.test.ts`, sitting either side of the moved
  line: a settler on 0.30 food is worth the lunch break because the errand starts at the pantry
  anyway, one on 0.14 exactly is not — the gate is `<=` and they are nearly the next patient — and one
  experience test, a colony where *everybody* is hungry and the settler on the floor is still fed
  inside 100 ticks. That bar was measured rather than guessed: a throwaway probe put the old gate at
  176 ticks and the new one at 49, so 100 sits between them and near neither. The first version of it
  asserted a food level after 900 ticks and **passed on the old code**, which is a decoration, not a
  test.
  **One** is in `tests/balance-principles.test.ts`: the principle must not count a settler a meal is
  already walking over. Both halves fail on the old check — the sweep is handed the same nine-hour
  stranded spell twice and has to answer *holds* or *broken* off the unfed column alone.
  The named-run pin in `tests/colony-eval.test.ts` moved for the second time, and again because a fix
  worked: harsh/1312's floor and stranded columns **converged** at 12.56 h, feeding sooner having kept
  the colony conscious enough never to go fully dark. It pins harsh/99001 now — feet 1.9, floor 18.2,
  stranded 8.0, unfed 4.7 over twenty days, the widest margins any candidate offered, and the grid's
  own worst run on both columns the promise is drawn from. Chosen off `scripts/probe-starve-pin.ts`,
  whose `fits` column is the test's own conjunction, so the choice is a lookup rather than an
  argument.
  Probe and fixture both say `steward: false` out loud now, with the reason. `runColony` defaults it
  to **true** while `--steward` is opt-in on `npm run measure`, so the managed colony has no grid
  coverage at all, and any probe that forgets the flag is reading the one arm nothing else reads. It
  has cost three rounds. The tell this time was arithmetic: 155.7 h upright at zero over twenty days
  against the grid's 6.5 h over sixty for the same seed, which no monotone longest-spell latch can do.
- `npm run build` clean — 113 modules, 920 kB, 263 kB gzipped.
- The sleep round, one below: **1862 tests** green in 935 s, and the grid's first paired sample —
  fourteen of fifteen sweep runs byte-identical, harsh/424242's longest upright spell at zero
  102.12 h → **7.23 h**, from deleting one early return that handed a settler sleeping rough on a bed
  cell back to a sleep job which does not exist at that call site. Eight of its tests are
  `tests/sleep.test.ts`: seven waking-rule assertions one apiece, so a failure names which rule moved,
  and one experience test that fails on the pre-fix files at its first assertion. The upright column
  is judged from that round on, by `on-their-feet-at-zero-is-a-walk-home`, **enforced** at twelve
  in-game hours — twice the widest crossing of a 192-cell map at `WALK_SPEED`, so the bar is drawn off
  the map rather than off the grid.
- The stride round, one below: **1840 tests** green in 1184 s.
  **Four** of those are the newest and they are the stride's one writer.
  **Two** are in `tests/gait.test.ts` and they replaced a weaker one. It used to read
  `movement.ts` as text to check that a copied constant still matched; the constant is imported
  now, so instead the file **scans every `.ts` under `src/sim`** and fails if any place other
  than `moveWithCollision` converts a distance into a stride. That is the contract the round
  bought, and it is worth a test because the thing it replaced was four call sites at three
  rates with two of them stacked — a wolf's legs ran at 2.2× the ground it covered, and nothing
  in the build could tell. A third pins the flat per-tick advances in `jobs.ts` as *flat*: a
  settler at a bench covers no ground and still has to move, which is a working cadence rather
  than a gait, and the test says so rather than letting the next reader assume they were missed.
  **Two** are in `tests/sim-units.test.ts` and they are behaviour rather than source text: a body
  walking into a wall advances its stride by exactly the ground it got and then **stops** while
  still pushing, and a body lifted out of a wall built on top of it is charged **nothing** — the
  unstick can carry it six cells, and a rescue is not a journey.
  **Fourteen** arrived one round ago and they are the walk.
  **Eleven** are `tests/gait.test.ts`, a new file for the arithmetic that turns distance walked
  into a gait — its own module for the reason `pace.ts` and `overlays.ts` are theirs: it holds no
  three.js, so `environment: 'node'` can load it and a decision made in it is a test rather than a
  comment. What they pin is that a foot **stays where it was put**, expressed as a distance in the
  same cells the sim moves bodies through, because *"it reads as skating"* is a feeling and a
  feeling cannot fail a build. Foot scrub is asserted at zero for the settler, for a calf, and
  across a grid of leg lengths and swings that no rig currently uses — the rule has to be a rule,
  not a constant that happens to fit the two bodies in the game today. One case records **what the
  old fixed swing cost** (0.441 cells of backwards slide per step, better than twice as fast as
  the ground went by) so a revert cannot pass quietly; one pins that a body with no legs stands
  still rather than dividing by zero and scissoring at the frame rate, which is what a calf scaled
  to nothing or a rig mid-vanish would otherwise do; and three hold the *cadence* the fix leaves
  behind, since planting a foot is done by slowing the legs and slowing them far enough is its own
  bug. One of them read the sim's source as text to guard a copied constant; the constant is
  imported now, and that test was replaced by the two above it.
  **Three** are `tests/fps-view.test.ts`, on the body you drive, and they are the dual-view law
  rather than a rendering detail: held against a wall the possessed settler's stride **stops with
  it** — it used to advance on intent, so the manager camera watched a body sprint on the spot
  while its feet stayed put; the stride advances by ground actually covered, the same arithmetic
  `followPath` does for every free settler; and it is **one stride per cell whether it walks or
  runs**, where two unrelated flat constants used to make breaking into a run change the legs and
  the ground by different amounts.
  **Eleven** more arrived one round ago and they are all instrument rather than game: the two
  far end, `every-ending-is-reachable` and `no-ending-is-free`, which had no cases until now for a
  reason worth writing down. Both are `enforced: false`, and on every grid ever run they report
  `broken` or `untested` — the honest state of a game whose sixty days reach one ending of three.
  So **their `holds` branches had never executed anywhere**, nor the detail line that says which
  roads came up short and by how much. A check that has only ever printed one verdict is
  half-unwritten, and the day it prints the other one is a day nobody is standing over the report.
  Six build the grids the sim has not produced: a short grid is `untested` and not `broken`, or the
  promise would be describing the clock and calling it the game; a full-length grid whose colonies
  all died first is `untested` too, which is the failure that looks most like the real one; the
  three endings **spread across three colonies** is the only shape this promise can be kept in,
  since committing to one ending shuts the other two; the failure names each unreached road with
  the best rung anybody got to, because *rung 3 of 4* and *rung 1 of 4* are two different problems
  in the same sentence; a commitment still being paid when the clock stopped is not an arrival; and
  it reads the played family and not the grid. Five are the other promise, and the load-bearing one
  is the boundary: **exactly `ENDING_DAYS` holds**, because a floor is a floor and a `<=` would
  call the best possible run the breach. The last of them pins a *silence* — a landing whose
  commitment day was never written down is skipped rather than scored from day nought, since
  treating the missing day as zero reads as a pass on exactly the records that lost data.
  These eleven were checked by mutation rather than trusted: `<` to `<=` on the floor fails three
  of five, and `s.war` to `s.runs` on the reachability check fails four of six. `principles.ts` was
  restored to `HEAD` after each and verified with `git diff --stat`, so the source fingerprint
  `.eval/measurements.json` is keyed on never moved.
  **Twenty-one** more arrived two rounds ago and they are the whole of stage 5c, split by what each
  half can be held to.
  **Ten** are `tests/endings.test.ts`, on the roll as the sim writes it: that it holds everybody
  the colony still had a body for and drops the prisoners, who are not the colony; that the ship
  and the moor file their people under different fates; that a partner who is *buried* is still
  named, which `partnerOf` will not do and which the test asserts by calling `partnerOf` beside it
  and getting null; that the levels are whole and only the trades a settler actually has one in,
  best first; that the roll freezes on the landing tick — the test plays twenty more days and
  asserts not a row moved; that what it holds are copies and not a window onto the pawns; that it
  survives a `serialize`/`deserialize` round trip, which is the only reason any of this was worth
  writing; and that a record written before manifests existed **does not grow one**, because the
  fallback that is right for a stale number is a lie about a list of people.
  **Ten** more are `tests/manifest.test.ts`, a new file for what the card is allowed to say — its
  own file for the reason `tests/overlays.test.ts` is: `hud.ts` cannot be loaded under
  `environment: 'node'`, so a decision made in there is a comment and a decision made in
  `client/manifest.ts` is a test. The dead go in their own list under the living; the fate is in
  the heading rather than repeated down every row; three skills are shown and the fourth stays in
  the record where a sequel can still read it; a settler with no trade gets an empty line rather
  than an invented judgement; wounds are noted on the living and never on the dead, where they
  would be a cause of death the record never claimed to know; and a trait a later build no longer
  ships costs that settler one word instead of costing the card, which is the failure mode a roll
  read out of an old save actually has.
  The **twenty-first** is one new rule in `tests/architecture.test.ts`, pinning that `hud.ts`
  *asks* `manifest.ts` rather than reading `.manifest?.` itself — the same half a refactor drops
  silently, where the pure module keeps passing its own tests while the client goes back to its
  own answer.
  **Ten** more arrived one slice ago and they are the whole of the overlay rule. **Nine** are
  `tests/overlays.test.ts`,
  a new file for a rule that is three functions long, because the alternative was a comment in
  `app.ts` that nothing can run: an overlay takes the body's controls and hands back the mouse.
  It is walked over **all sixteen** combinations of the four overlays rather than sampled, since
  the failure being guarded against is a fifth overlay arriving and being left out of the union.
  The four cards are also named one at a time instead of looped over the shipped key list —
  a loop over `KEYS` would welcome an omission rather than notice it. Two of the nine are the
  manager's side and they are there to stop the fix over-reaching: at the desk the body may
  never act and the pointer is never taken, with or without a card, or `app.ts` would start
  feeding WASD to a settler nobody is standing in the moment an overlay closed. The last one is
  the load-bearing equivalence — `pointerMustBeFree` is exactly `!bodyMayAct` in first person,
  over all sixteen — because these are one decision and a version where they drift is a version
  where the cursor comes back while the settler is still walking.
  The **tenth** is one new rule in `tests/architecture.test.ts`, pinning that `app.ts` *asks*
  `overlays.ts` rather than deciding it inline again. That is the half a refactor drops
  silently: the pure module would keep passing its own tests while the client quietly went back
  to its own answer.
  **Fifteen** more arrived one slice ago and they are the whole of stage 5b, spread over three
  files by what each one can afford to run. **Five** are `tests/endings.test.ts`, on the record
  itself: that nothing
  is kept until there is something to keep; that the tally is frozen on the landing tick and not
  a tick later — the test kills a settler, builds, and plays twenty more days, then asserts that
  nothing on the record moved; that the record survives a `serialize`/`deserialize` round trip;
  that an ending which landed before records existed falls back to the world rather than
  throwing; and that what was copied is a bag of numbers, which is the only thing that makes a
  shallow copy honest — the day a nested object joins `stats` that copy starts aliasing without
  a line of `endings.ts` changing.
  **Three** are `tests/colony-eval.test.ts` and they exist for the **order** `judge` takes its
  branches in, which is the part of this slice that breaks by being rearranged rather than by
  being wrong: a landed run is filed under its ending and named by it; a colony that landed and
  was *then* wiped out keeps the ending and names the empty valley in the same sentence; and a
  terminal that was committed to but never landed is still judged on its last day. The gate
  cannot afford the forty-day colony that lands an ending by playing, so `judge` is exported and
  called on worlds built to hold exactly one interesting fact each — the same split `npm run
  sweep` already carries for the founding, and the reason the fourth verdict also has a promise
  on the grid.
  The last **seven** are `tests/balance-principles.test.ts`: four on the new promise — untested
  when nobody landed, holding with the days-played-on counted, and broken in each of its two
  directions — and three on the rewritten one, which is where the risk actually was. A top rung
  is forgiven when **its own** ending landed, not when a different road's did, and not when one
  was merely committed to. That exemption is the kind of loosening that passes by accident if
  the road-to-ending index is dropped, so it is pinned from all three sides rather than
  demonstrated once.
  Nineteen more arrived with the terminal the slice before that, all of them
  `tests/endings.test.ts`. They
  are organised around the three ways this file could be wrong rather than around its functions.
  That **none of the three bills was typed in**: the ship's is the summed materials of every
  line in the research tree, so the test recomputes that sum from `research.ts` and asserts the
  constant equals it — grow the tree and the assertion moves with it; the berths' is
  `worthOf(SHIP_BILL)` at the `VALUE` table, asserted against a fresh `worthOf` call rather than
  against a literal, so the two endings cannot drift apart; and the twelve days are
  `HOLD_DAYS × ROAD_RUNGS`, derived in the test the same way. That **the gate is read every time
  and never remembered**: nothing is open on day one, only the topped road opens, an unpaid
  commitment is refused, a second one is refused, a road that slips below its gate stalls the
  count, a charter that goes unmet stalls it in the founding's own words, abandoning keeps the
  goods and gives back the days, and a committed terminal survives a `serialize`/`deserialize`
  round trip. That the bill is **paid by the day and not by the tick** — the instalment cadence,
  the landing when clock and bill are both met, and a hull that runs out of steel. The last of
  the nineteen plays a colony to a dominion through the ordinary tick rather than by calling the
  pieces in order, and it is the only one that would notice if `tick.ts` stopped calling this
  file at all. One of them found a wart rather than a bug: the terminal logged *"Work resumes on
  the ship"* on the first tick after the commitment, duplicating the headline the commitment had
  just written, which is now only ever said as a resumption.
  Of the rest, forty-one arrived with the war road a grid ago and twenty-seven of those are on
  `sim/holdings.ts`, which was the whole of that stage. That every number in the file is bought from one that already existed — one holding
  behind each ring, one fewer marcher than the colony must keep at home, a garrison rolled out
  of `raiderBand` so it scales with difficulty and with the ladder without knowing either
  exists, a pack per ring on that ring's own cadence, and a far holding that is dearer without
  being richer. That the muster turns down every colony it should: one that cannot leave four
  behind, one with raiders in the yard, one that already has an army out, one that has never
  walked the ring, one already standing on the ground. That each of the four ways a march can
  fall apart puts **everybody** back on the map, because a party half-lifted off it is the one
  state nothing else in the sim knows how to read. That the bill is booked at the muster and
  not at the homecoming. That a beaten party comes home wrecked and alive. That a taken
  holding sends a cart down off the moor on its own cadence and ground the colony does not
  hold sends nothing. And that a party in the field survives a `serialize`/`deserialize` round
  trip still out, still not on the map, still due home at the same moment. The last of the
  twenty-seven musters, walks, fights and comes home through the ordinary tick rather than by
  calling the pieces in order, and it is the only one of the twenty-seven that would notice if
  `tick.ts` stopped calling this file at all. Eight more of the forty-one are on the two war
  promises and four on the sweep's spec list — those twelve exist because of the instrument
  fault below, not because of the stage. The last two hold the warfare ladder to
  `1 + HOLDING_COUNT` rungs, which is the rewiring that made warfare read ground instead of
  kills. The 13 skips are the opt-in gates and nothing else — `ECO`, `SWEEP`, `BALANCE`,
  `LIVE`, `POOL` — and two files (`tests/liveness.test.ts`, `tests/survival-sweep.test.ts`)
  hold nothing but a gated describe, which is why the file count reads 93 and not 95.
  **Ten** of the tests are newer than that stage and belong to the instrument rather than the
  game. Eight are `tests/measurements.test.ts`, which is the first thing ever to read the
  staleness guard — the guard that decides whether yesterday's grid may be scored today, which
  the whole split-the-grid arrangement rests on, which had never been read, and whose failure
  mode is quietly saying yes. It pins the three answers that matter: a sim that moved must
  invalidate, a *judge* that moved must not, and an empty walk must throw rather than hash
  nothing, because a constant fingerprint marks every stale grid as fresh for ever. The other
  two hold the road promises to the family they are now denominated in, one in each direction —
  that a road is read off the colonies that walked it, and that a road is not called unfinished
  on the strength of colonies that never set foot on one.
- `npm run eval` — the same `tests/colony-eval.test.ts` the suite above already ran, not
  re-run separately. It is the one file both entry points share, so a second run is a second
  reading of a number already recorded rather than a second piece of evidence.
- `npm run measure -- --days 60 --past-founding` then `npm run balance` — 4 tests green.
  **39 colonies in 3,037 s**, re-run because this round edited `src/eval/**` and moved the source
  fingerprint from `4e7e7e91` to `4952c293`. Every pre-existing column compares identical on all
  fifteen sweep runs, which is what a round that only adds instruments is supposed to look like,
  and the two new columns — `starveHours`, `floorStarveHours` — are the only things on the grid
  that were not there before. Eight principles open, seven returning their previous verdict and
  detail to the character. The eighth is the point: the starvation promise now names a downed
  settler and the hours they waited instead of a number nobody could act on, and it names **seven**
  colonies where the level had named six. The extra one is `settler/20260729`, which left a settler
  down and unfed for 6.7 h without ever quite touching 0.00 — the old bar read it as a healthy
  colony. The round below re-ran the same grid at 2,470 s to prove a stride was cosmetic.
  **Twenty-nine** principles are scored, one more than the run before that one:
  all **fifteen** enforced ones hold, and of the fourteen open ones — reported without
  asserting — **six** do, up from four. Both of the two that moved are 5b's: the promise it
  wrote and the promise it rewrote.
  **Two colonies out of fifteen reached an ending, and both of them reached the same one.**
  calm/1312 committed to the dominion on day 37 and landed it on day 49; settler/1312 committed
  on day 47 and landed on day 59, one day inside the clock. The other thirteen never got the
  offer. That is the whole of stage 5a's result and it is the answer the stage was built to
  extract, so it is worth being precise about which part of it is a surprise: that dominion is
  reachable is not — calm/1312 and settler/1312 were the two colonies standing on warfare rung 4
  a grid ago, and this grid they walked out of the door those rungs had been holding shut. What
  the grid adds is the shape of the other two, and they are not the same shape.
  **The grid could not see the war, and reported that in the most convincing way available.**
  The first sixty-day grid after stage 4 shipped read `campaigns 0` on all fifteen colonies,
  on every setting, to four decimal places. That is what a road nobody can afford looks like,
  and it was the instrument. The grid plays `steward: false` — *nobody manages the colony*,
  the floor the sim must clear alone — and `orderCampaign` is the one errand in the game the
  colony's own foreman never picks up, because a war is the player's decision every time and
  `types.ts` says so. A per-tick probe on settler/1312 settled it in one run: handed to a
  Steward, that same seed sends three parties, keeps three holdings, and orders the first on
  day 12. Sampling once a day would have missed it, because a marching party is off the map
  between snapshots. The fix is a second family rather than `--steward` on the whole grid,
  which would have re-based the twenty-four promises calibrated against the unmanaged floor
  without printing a word about it: the same fifteen seed-and-setting colonies replayed with a
  player at the wheel, read by the two war promises and nothing else. `ENDGAME.md` stage 4
  carries the long version, and `measure.ts`'s own header now warns off the flag.
  *No holding falls for free* — **new this slice, written before `holdings.ts` existed, and it
  holds.** Fourteen of the fifteen played colonies took ground, twenty-three holdings between
  them, and every one of them paid at least 18.0 pawn-days a holding — the cheapest legal war,
  being the smallest party walking to the nearest ring and home again. The thinnest is
  settler/1312 at 38.0, better than twice the floor, so the margin is not a rounding artefact.
  It is counted in pawn-days rather than campaigns because a campaign that resolved on the
  tick it was ordered would report one campaign and one holding and look perfect.
  *The war is a choice* — **new, and broken on arrival in the direction that was always the
  risk**: **15 of 15 colonies with seven hands sent a war party**. Half of that verdict is
  about the instrument and half is about the game, and the halves want saying apart. The
  played family has exactly one player in it, and a policy that marches whenever the gates
  open cannot disagree with itself — a choice is not something fifteen identically-played
  colonies can exhibit, whatever the game does. What does *not* depend on the policy is the
  other half: **nothing in the game ever says no.** harsh/99001 sent **ten** parties, took
  **nothing**, and spent 180 pawn-days finding out; harsh/424242 sent ten for one holding and
  234. Ten defeats did not make staying home right, because a lost war costs a week of walking
  and three settlers in bed for a few days after it, and then nothing — no funeral, which this
  stage rules out on purpose, and nothing that is still true a fortnight later. A colony that
  can absorb that ten times is a colony for which marching is never the wrong call.
  Until there is a price for a war that fails, the promise has nothing to catch. That is a
  standing bill against stage 5, and moving the bar here would be the fitted-bar mistake
  `ENDGAME.md` rejects by name.
  *The three roads are three roads* — **broken, and worse than it was read a pass ago, which
  is the point.** It read **1 of 3 pairs never disagree** while it was denominated in the
  unmanaged grid, and that number was an artefact: stage 4 rewired warfare to count ground, so
  on a grid where nobody ever marches it stands at **rung 1 on all fourteen** full-clock runs,
  and two of the three pairs were being scored against a constant. The one inversion it did
  report was science dipping under that constant on the hard maps. Moved onto the played
  family it reads **3 of 3 pairs never disagree across 15 runs: science/economy never inverts
  (science only ever ahead), science/warfare never inverts (science only ever behind),
  economy/warfare never inverts (economy only ever behind)** — the order is warfare ≥ science ≥
  economy on all fifteen and nothing crosses anywhere. That is the honest reading and it is a
  harder bill: warfare is the cheapest ending on the board and economy never climbs past its
  first rung, five of the fifteen never reaching it. The caveat belongs in the same breath —
  fifteen colonies played by one deterministic policy make a *flat* pair evidence and an
  *inverting* pair only the absence of it, so this family can convict and cannot acquit.
  Unchanged this pass, and stage 5a is why it is worth restating rather than re-reading: with
  an ending standing at the top of each road, *warfare ≥ science ≥ economy on all fifteen* is no
  longer an ordering of ladders. It is an ordering of **endings**, and the grid below now says
  so out loud.
  *Nobody starves beside a full pantry* — 6 of 15 runs, each bottoming out at exactly 0.00
  while the colony held eleven to twenty-two days of food: two Settler maps and four Hard
  country ones. Unchanged for a sixth grid, down to the seeds and the day counts, and the
  shape of the spread still cannot be told apart from Hard country being hard by this
  measurement alone. The argument that it is a feeding failure rests on the mechanism — a
  settler at 0.00 beside three weeks of meals — and not on the spread, and the claim's own
  words *"it happens on the kind one"* remain unsupported.
  *The escalation ladder is climbable to the top* — broken, highest rung anywhere 3 of 4,
  peaks seen 0/1/2/3. Three grids ago a lone calm map touched rung 4 and no grid since has,
  which is why the principle stays open rather than being promoted on seed luck.
  *The far country is walked* — 3 of the 7 runs that opened the far road with twenty days to
  spare walked it. Unchanged, and the diagnosis still holds: every colony ever billed
  machinery went, every colony that was not, stayed home, and what is short is the number that
  climb far enough up the tree to be asked.
  *The road keeps up with the bench* — 2 of the 11 runs that reached the third tier waited
  longer than one round trip to the ring their bill was payable in: calm/1312 and calm/424242,
  18 days each on ring-1 bills against a bar of 14, both with a road standing free for 0.05
  and 0.01 days out of sixty.
  *One robbery does not end the tier* — 6 of 9 runs that reached the third tier finished a
  project inside it (67 %, against a 75 % bar); the three that stopped dead are calm/1312 after
  18 waiting days, settler/1312 after 12, settler/424242 after 3.
  *The tree is not empty at day sixty* holds: no run of the fourteen that played a full clock
  stood at an empty bench for a week, furthest calm/20260729 at 17 of 19 projects, longest
  idle 0 days, 6.4 days a run waiting on a delivery and 18 at worst. *The surplus finds a
  buyer* holds for a fifth grid: all 8 runs that ended above 300 steel spent at least a
  quarter of the pile down, the thinnest settler/20260729 at 40 % of 853. *No road is already
  finished* — **holds, on the first grid after the rewrite that paid its bill.** It was broken
  on the last two passes for a reason that was never a balance fault: calm/1312 and settler/1312
  finished warfare at rung 4 of 4 and the promise called that a road that had run out, when in
  fact both of them walked through the door those rungs had opened and landed the dominion. The
  claim was rewritten in 5b to the narrow version — *road left on all three, **or** that road's
  own ending landed* — and it now reads **no run of fifteen ended its clock on a top rung it had
  not walked off; furthest anybody got was rung 4 of 4**. What makes this a real green rather
  than a re-worded one is the exemption's shape: it is *that road's own* ending, not any ending
  and not a commitment, which is pinned from all three sides in
  `tests/balance-principles.test.ts` precisely because the loose version would also have printed
  *holds* here.
  *No ending is free* — **new this slice, and it holds**: **2 endings landed, none in under 12
  days; the longest took 12.** Both landed on the twelfth day exactly, which is the number the
  promise is a floor against and not evidence that the floor binds. The caveat is the whole
  reading and it wants stating before the tick is banked: **the one ending anybody reached is
  the one that buys nothing.** The dominion's bill is that every holding is still yours on the
  last day, so for these two colonies *paid for* and *waited out* are the same twelve days, and
  the promise cannot yet tell them apart. It will the first time a hull lands, because a hull
  that cannot get its steel serves the days without landing — which is a case the unit tests
  cover and the grid has never seen.
  *An ending is the last word* — **new with 5b, and it holds on its first reading**: **2 landed
  endings, all filed as `landed`, and the colony played on for up to 11 days after.** The three
  ways it could have failed are the three the promise checks and none of them fired: no run
  holding a record was filed under a different verdict, no ending landed on a day its run never
  reached, and no run was filed as landed without a record to show for it. The days-played-on
  figure is the one worth reading twice — it is the evidence that the frozen record and the
  living world are two different things, which is the whole design decision of the slice. A run
  that stopped on the landing tick would print 0 there and the promise would still be green.
  *Every ending is reachable* — **new, and broken on arrival, which is what it was written for**:
  **1 of 3 endings reached in 60 days — unreached: ship (best rung 3 of 4), berths (best rung 1
  of 4).** `ENDGAME.md` posed this as one question — *does the grid's clock grow, or do two roads
  have top rungs the game cannot deliver?* — and the first thing the instrument did was split
  it, because the two unreached endings are not unreached for the same reason and a single
  answer would be wrong for one of them.
  **The ship is a clock question.** Best rung 3 of 4 against a top rung that is the whole
  research tree, and the tree column reads 17 of 19 projects on calm/20260729 with the bench
  never idle. That is a colony walking at the right pace and running out of days, and it is the
  case a longer grid would settle — at twice 2,847 s every time anything under `src/sim` moves.
  **The berths are not.** Best rung **1 of 4**, on a ladder whose top rung is every neighbour on
  the map at standing, and five of the fifteen never reach rung 1 at all. Sixty more days of the
  same behaviour does not close that, and the reason is already on the board two promises up:
  *the far country is walked* reads 3 of 7 — the colonies that could open the far road mostly
  did not walk it, and standing is only earned by arriving. The economy road is not too long;
  it is not being walked. Growing the clock to reach the berths would be buying a reachability
  result with sixty days of wall time and learning nothing about why the road is empty.
  So the clock question, as posed, has one honest answer and one honest refusal, and neither is
  a number to move here.
  The enforced set is unchanged. *The far ring is earned* — shut for all 15 runs through day 7,
  7 of the 10 below Hard country had it open by day 42, earliest day 16. *The long road is
  walked* — 10 of 10 below Hard country sent two or more parties past the near ring, mean trips
  by ring 6.0/4.4/0.6. *The first act is finishable* — 9 of 10 below Hard country reached the
  founding (90 %, against a 50 % floor), the only one that never got there being settler/99001.
  *The bench does not wait on an errand* — all 11 runs that reached the third tier had a party
  committed within 2 days, longest gap 0.63 days on settler/424242, mean 0.09, while the road
  itself took 8.1 days a run.
  **Every field that existed before this slice came back byte-identical, on all thirty colonies
  of both families, and the four new columns are the only thing that moved.** That was checked
  against the stored pre-slice grid field by field — 510 shared fields a family, zero
  differences, and the `arm` dial rows identical as strings — rather than eyeballed off the
  table, because eyeballing a table is how a slice that moved the game gets recorded as one that
  did not. It is worth more than the same sentence was a grid ago, because this time **two of
  the colonies actually ran the new subsystem to completion**: calm/1312 and settler/1312
  committed to an ending and landed it, and not one measured figure moved. That is the right
  answer and it is the *narrow* answer — the dominion buys nothing, so there was nothing for it
  to move. The first hull to be committed to will take steel off the yard for twelve days and
  this paragraph will read differently, which is the point of writing down which of the two
  sentences this grid earned.
- `npm run build` — 919.45 kB JS (263.12 kB gzip), 23.76 kB CSS (5.15 kB gzip). The starvation
  round emitted the **same content hash** as the round below it, `index-GQkx7ZcS.js`, which is the
  strongest form the claim "no game code changed" comes in: the two new columns live in the eval
  harness, the probe that found them is not in the build at all, and the player's download is the
  same file. The stride round before it
  came in **0.16 kB smaller** than the round before *that*, which is the only bundle line here that
  reads as a saving: it deleted five hand-written phase advances and wrote one, and a rule that
  lives in the one function everybody already calls is cheaper than the same rule remembered in
  five places. The gait module, a round ago, cost **0.16 kB and no CSS**, which is what a page of
  arithmetic that deletes two fields on its way in should cost; that build also caught that
  round's only type error — a `URL` handed to a `readFileSync` the hand-written `node.d.ts` had
  declared as `string`-only — which is the gate doing its job rather than confirming a green that
  was already there.
  The manifest cost
  **1.60 kB of JS and 0.35 kB of CSS**, and nearly all of that JS is the sim's half rather than
  the card's: `manifestSections` is one `map` over rows, while `takeManifest` walks every pawn and
  copies them. The overlay rule, a slice ago,
  cost **1.26 kB of JS and nothing at all in CSS**, which is what a rule that only decides who
  reads the keyboard should cost. The far end
  cost **4.96 kB of JS and 0.34 kB of CSS**: the panel is the trade offers' own row again —
  `deal`, `ttl`, `cost`, `gain`, `blurb` — and the whole of the new stylesheet is a gold border,
  a warmer fill, and a quiet link, because a card that looked like nothing else on the panel
  would be a fourth thing to learn to read at the point the game is asking for a decision. The
  war road, a grid ago, cost 8.19 kB of JS and no CSS at all on the same principle.
- The far end panel is **not** covered by an automated render, and neither is the war road or
  the three roads beside it. Vitest runs `environment: 'node'` here, so nothing in the suite
  mounts the HUD; what is proved above is the data behind every row — including that a card
  quoting a price *before* the commitment reads it off the live colony rather than off a stored
  figure, which is the one place this panel could lie: two of the three endings are already
  partly paid at the gate, and a quote that showed zero there would be offering a discount.
  Seeing it on screen is a manual step —
  [PLAYTEST.md](PLAYTEST.md) 9jj for the roads, 9kk for the war party, and 9ll for the far end —
  and none of the three has been walked yet. The same is true of the ending card's roll, one
  layer up and one layer down: `manifestSections` is proved down to the last row, and the six
  lines of `hud.ts` that turn those rows into `<li>`s are not, because nothing in the suite can
  mount them. That is 9oo, and it has not been walked either.
- Dev server on `5063`, play server on `5062` — and on the same port at this machine's
  LAN address, which is deliberately not written down here because it changes with the
  network and a stale IP in a document is worse than no IP.

## The killer feature

| Promise | How it is held | Evidence |
|---|---|---|
| Two views onto **one** simulation | `sim/` cannot import `client/`, and `client/fps/` may not build or step a world of its own | automated — `tests/architecture.test.ts` |
| Possess any living colonist; walk, open doors, haul, fight, sleep in a real bed | the FPS controller driven with a stand-in `Input`, same sim, same collision, same combat call | automated — `tests/fps-view.test.ts` |
| `V` switches instantly, no reload | `toggleView()` swaps camera + HUD layer in the same frame; nothing rebuilds the scene or the world | read `app.ts:405`; manual — PLAYTEST §4 |
| Selection and possessed id survive the switch | `enterFps` sets `manager.selection` to the body you entered; `exitFps` remembers the id so `V` drops you back in | read `app.ts:422`, `app.ts:447`; manual — PLAYTEST §4 |
| Collision matches the visuals | the possessed body moves through `moveWithCollision` — the same call a settler's job makes — and never scans `world.buildings` itself | automated — `tests/architecture.test.ts`, `tests/fps-view.test.ts` |
| One gait, whichever camera is watching | limbs come off `animPhase`, and `moveWithCollision` is the **only** thing in the sim that advances it — by ground actually covered, at one exported rate, for every body that walks. So a body held against a wall stops striding in both views instead of sprinting on the spot, and the settler you are standing next to, the wolf outside the fence and the body you are driving are all counting the same steps. There is no animation clock left anywhere in the client, and each rig derives its stride from its own legs | automated — `tests/gait.test.ts`, `tests/sim-units.test.ts`, `tests/fps-view.test.ts`; manual — PLAYTEST §9pp |
| One answer to what the colony has seen | `sim/explore.ts` owns `world.seen`; the shroud keeps no flags of its own, mirrors that array, and can only ever take haze away — so the map view and the body standing in it end at the same edge | automated — `tests/explore.test.ts`; read `render/shroud.ts:103`; manual — PLAYTEST §9m |

## The engine constraints

| Promise | How it is held | Evidence |
|---|---|---|
| Three.js + WebGL2 + Vite + TypeScript, `npm install && npm run dev` → playable | one dependency (`three`), three dev dependencies | `package.json`; dev server verified answering 200 |
| Fixed 20 Hz sim, separate from rAF | the accumulator is a pure function: 20 ticks per second of wall time at 60, 30, 144 and 47 fps, and no drift over a simulated minute | automated — `tests/pace.test.ts` |
| Render interpolation between ticks | `alphaOf()` stays inside 0..1 across 500 frames at an awkward refresh rate, and is the same number for the same frame | automated — `tests/pace.test.ts` |
| **Pause freezes the sim** | zero ticks at any frame length, and the paused time is not banked — unpausing cannot dump a fast-forward into the colony | automated — `tests/pace.test.ts` |
| Device pixel ratio capped | `setPixelRatio(min(devicePixelRatio, preset))` — 1 / 1.5 / 2 by preset | `render/renderer.ts:66` |
| Quality presets | shadows, shadow map size, antialias and decorative geometry all scale with the preset | `render/renderer.ts:20` |
| Shader prewarm | `Viewport.prewarm()` compiles against both cameras before the first frame | `render/renderer.ts:99` |
| Pointer lock only in first person | the one `requestPointerLock` call is in `Input`, and `exitFps` releases it | `input/input.ts:120`; manual — PLAYTEST §4 |
| Versioned save in localStorage | envelope round-trips through `serialize`/`load`, carrying view mode and possessed id; a version mismatch is reported, never guessed | automated — `tests/sim-units.test.ts` |
| Procedural geometry only, no CDNs | no external `src`/`href` in the page, no runtime `fetch`/socket, and no image, model, font or audio file anywhere under `src/` | automated — `tests/architecture.test.ts` |
| The render-interpolation baseline is measured, not assumed | `tests/fps-trace.test.ts` drives `FpsController` plus a `PawnsView`-shaped prev/curr lerp through a scripted walk/run/turn/sleep-wake at 30, 60 and 144 fps and pins it as literals at named frames: the eye-ease transient is the same 14 frames at every rate but three different wall times (466.667 / 233.333 / 97.222 ms), because `app.ts:349` hardcodes `1/60` into `updateCamera` regardless of the real frame rate — the eye gap. The raw-bob staircase is counted per rate (79 changes of 119/239/575 frame-to-frame steps while walking), and today's lag-based render is checked against a dead-reckoning truth line — mean/max positional error, jitter, heading error — each with a tolerance, so a future interpolation candidate cannot pick its own metric. Nothing under `src/` changed this round; see ROUND_NOTES.md, "The eye gap" | automated — `tests/fps-trace.test.ts` |
| The bob no longer steps once per sim tick | `animPhase` is lerped between ticks by `PawnsView` exactly the way `x`/`y`/`f` already were, and `rig.update`/`updateCamera` read the interpolated phase instead of the raw one — so `settlerBob`, the one function the FPS eye and every pawn rig share, moves every rendered frame instead of the same 79-tick staircase `1a-feel-trace` measured. Two instruments, because they answer different questions. `tests/pawns-interp.test.ts` drives the real `PawnsView`: half way through a tick `interpolated` returns the midpoint phase, nine alphas across one tick give nine distinct climbing values, `sync` poses the leg off that midpoint rather than off `pawn.animPhase`, and feeding the interpolated phase to `updateCamera` moves `camera.position.y` by exactly `settlerBob(mid) - settlerBob(raw)` against the five-argument call that defaults to the raw one. Six of those seven cases were proven red against the mutant that restores the staircase (`(alpha < 0.5 ? 0 : 1)` in both production lerps). `tests/fps-trace.test.ts` then scores the whole scripted walk at three frame rates through its own `TraceView` stand-in, reading the change back off `controller.camera.position.y`: 119/119, 239/239 and 575/575 frame-to-frame steps changing at 30/60/144 fps, up from 79 of each, each rate under the per-frame delta its own constants allow (0.034 / 0.0214 / 0.0095 — analytic maxima, not smoothness bounds), and bit-exact against the raw phase at both lerp boundaries. See ROUND_NOTES.md, "The bob stops staircasing" | automated — `tests/pawns-interp.test.ts`, `tests/fps-trace.test.ts` |
| A teleport is shown at its destination, not swept through | This round also changed how *position and facing* render on a jump, which `PawnsView` had no handling for at all: any large move used to lerp, sweeping the body visibly across the gap over one tick. Past `SNAP_CELLS` (2) `onTick` now snaps `prev` to the new snapshot, so neither the body nor the gait phase it carries crosses the space between. The path is reachable — `src/sim/ice.ts`, `src/sim/holdings.ts` and `src/sim/jobs.ts` each write a pawn position directly, past `moveWithCollision`. `tests/pawns-interp.test.ts` pins all three sides: a five-cell jump reads as the destination at every alpha, a one-cell step still sweeps to its midpoint, and a two-cell step — the largest that is not a teleport — sweeps too, so the threshold is strictly greater. The jump case was proven red against `if (false && jump > SNAP_CELLS)`. See ROUND_NOTES.md, "The bob stops staircasing" | automated — `tests/pawns-interp.test.ts` |
| What the frame costs the card is measured, and the instrument names its method | The Cost line under the look frames used to carry only a wall-clock millisecond taken across rAF callbacks — the swap interval, which reads 17 ms for every frame that fits the budget and did not move when a round cut the colony frame from 189 draw calls to 123. `scripts/look/shot.mjs` now also stalls the pipeline (`gl.finish()`) around a hooked `viewport.render` and prints `gpu <median>/<max> ms (finish)`. **Corrected by `2b`:** the figure this row first carried, `gpu 3.0/3.8 ms (finish)` from r22, is not a constant — four readings of the same frame on the same box came back 1.6, 1.5, 1.6 and 1.8 ms, tight among themselves and half of it, with no file under `src/` changed between them. The 3.0 was a loaded box. The colony frame costs the card **about 1.6 ms**, and the reading is a *within-shoot* comparator: a round comparing against it takes its own before and after in one shoot on the same named frame rather than quoting a number out of an earlier round's note. `EXT_disjoint_timer_query_webgl2` is listed on this box with 64 counter bits and was adopted first, then measured against the stall by rendering one frame N times in one window: the stall came back linear (`1.7·N + 0.1` for N = 1,2,4) and the timer proportional to nothing (~8.7 ms a render at every N, and 7.40 then 5.06 ms for the identical frame), so it overstates by about five times and was removed rather than demoted — a wrong number that looks healthy sends a later round hunting a regression that never happened. `scripts/look/gpu.mjs` is a pure reducer that imports nothing: it refuses any reading whose method is not `finish`, a clock that never moved, and fewer than ten clean samples, printing `gpu n/a` rather than a bare number or a zero, and counts a frame the app did not draw (`renderer.info.render.calls === 0`) as `spoiled` instead of as a cheap frame. See ROUND_NOTES.md, "The card that was listed, answering, sixty-four bits wide, and wrong by five times" | automated — `tests/look-gpu.test.ts` (8 cases, no browser); frames — `.look/shots/r22/` |
| Where the frame's triangles are is measured, and the grass is pinned as a literal | The Cost line's total said the colony frame is 8.5 M triangles and nothing about which pool to open first, so `scripts/look/shot.mjs` now prints a census above it: the ten heaviest pools in the scene, each with its instance count, its geometry's own triangles, whether it casts, and its share. Measured on the colony frame: **the rock is the largest at 23.0 %** (`TerrainView.rocks`, `terrain.ts:598` — 8,414 instances of 234 triangles, and it casts), **the grass second at 18.7 %** (106,547 tufts of 15), seven building pools 29.0 % between them, the shroud 5.2 %. That corrects a premise a round could have acted on: `TUFTS_PER_CELL`'s comment says 5.7 %, which is right for the *increment* it describes (five tufts to seven) and not for the total — the comment is correct and is not edited. The grass is pinned in `tests/decor-view.test.ts` three ways, because they fail apart: the cost written as the product and then as the literal (`tufts.count × 15 === 3_870_720` on the standard meadow), one `InstancedMesh` draw for the whole map, and `castShadow` false. Both literals proven red by raising `TUFTS_PER_CELL` 7 → 8 and restoring (258,048 → 294,912 instances; 3,870,720 → 4,423,680 triangles); the blade's ≤ 16-triangle ceiling is unchanged. **The shadow pass is reported twice and neither way is the obvious one:** `renderer.info` excludes the shadow pass by construction — `WebGLRenderer.render` calls `shadowMap.render(...)` and only then `info.reset()` (`WebGLRenderer.js:1606`, `:1612` in 0.180) — so flipping `shadowMap.enabled` leaves the triangle total identical to the digit, which reads as a colony that casts nothing. What is printed instead is the census's `castShadow` column summed over the scene (**73.0 % of the frame's triangles are drawn again into the depth map**, one shadow light) and `2a`'s stall re-run with shadows off (**0.6 ms of a 1.6 ms frame**). No triangle was removed and no file under `src/` changed. See ROUND_NOTES.md, "A fifth of the frame is grass, and it is not the biggest thing in it" | automated — `tests/decor-view.test.ts`; frames — `.look/shots/r23/` |
| Objects touch the ground, and the frame has darks | `src/client/render/post.ts`: on high and medium the scene is drawn once into a half-float target, GTAO reads that target's depth at half resolution (it never redraws the colony for a G-buffer), and one final pass multiplies the occlusion in, applies ACESFilmic and sRGB, and grades with levels (black 0.12, white 0.92, gamma 1.35, a 0.35 toe). Low draws straight to the canvas as before. It was driven by r23's histogram, which showed compression rather than a missing black: the colony frame's p5–p95 was 119–214 with the median at 194. r27 reads 67–216 with the median at 178. The toe exists because r25 took the dusk grass to p1 3. Tried in r24 and removed: bloom (at any threshold that spares the white statue, the lamp heads never reach it) and three's tilt-shift (no band in focus, and its taps stipple). Cost read on this box: 12.4 ms (r24) → 3.2 ms (r26) of GPU time, via the Cost line's new `post X ms of it`. `renderer.info` still reports the scene draw alone (118 calls, 8.36 M triangles). Three 0.180's `GTAOPass` throws when handed a depth texture in its constructor, so it is built the default way and then given `setGBuffer`. A test walks construct/resize/dispose for that. Not done: the dusk grass blades still read near black (the grass shader, which predates this), and there is no per-hour grade. No file under `src/sim` changed | automated — `tests/post.test.ts`; frames — `.look/shots/r27/` against `r23/` |
| A settler has knees, elbows and a waist | `src/client/render/pawns.ts`: each limb is two, jointed halfway (`kneeOf`, `elbowOf`), and the torso, head, arms and load ride a `chest` group that leans and turns over the hips; a tunic hem hangs from the belt. The swing knee folds and the planted one stays straight, the forward arm's elbow curls, and the chest counter-rotates only when walking with empty hands. One writer, `poseSettler`, is used by the game and the bench. It fits inside the same 3,000 triangles (the trader with a rifle measures 2,988): the ears are cut, the limbs are ten and eight round, and the neck is twelve. The leg, arm and neck goldens and three settler bench-frame numbers in `tests/forge-stage.test.ts` were re-pinned deliberately, and the walking sole heights at 3/8 and 7/8 went from 36 mm to 64 mm — the straight leading leg, no longer hidden by a straight trailing one (see the ground row below). Not done: the joints read as a mannequin's (no skin over the seam), and the hip dip. No file under `src/sim` changed | automated — `tests/forge-recipes.test.ts` (joints, goldens, soles), `tests/lighting.test.ts` (chain lengths, budget); frames — `.look/shots/r28d/` against `r28-before/` |
| A settler has a face and a haircut | `src/client/render/face.ts` paints the face on the head's material in the fragment shader: eye whites, lids, brows, mouth and cheeks, and a beard for a quarter of the seeds. The hair gets strands, and the long and swept cuts get a parting. No triangles were added (the trader with a rifle is still 2,988). The eyes moved up to `EYE_Y`. The hair hem is cut into locks and clears the eyes, and there are four cuts on seed bits 12–13; bit 12 is still the length, so saves keep it. Every face shares one program, and so does every head of hair. Re-pinned deliberately: the `settler.hair` and `settler.hairLong` goldens (two new ones added). Restated to cover all four cuts: `head-read`'s outline, axis and hair-outside-skin checks and the fringe test in `lighting`. None was loosened. Not done: the face is only visible from in front, strands barely show on black hair at game zoom, and glTF export carries none of the paint (ASSETS.md). No file under `src/sim` changed | automated — `tests/face.test.ts` (the shader anchors land, one program each, the bit mapping, the parting per cut; mutation-checked), `tests/head-read.test.ts`, `tests/lighting.test.ts`, `tests/forge-recipes.test.ts`; frames — `.look/shots/r29/` (`e-*` headcam, `r29e-*` in game) against `r29-before/` |
| A settler has eyes, not buttons, and a mouth on every skin | `eyeMaterial` in `src/client/render/face.ts` paints an eyeball on each eye bead: iris with a darker rim, pupil, white, and an upper lid in the settler's skin with a lash line. The bead's geometry and position did not change. The iris is dealt from the seed by `irisOf` (five tones). Every eye shares one program. The lower lip is a warm mid-tone, so the mouth reads on dark skin in shadow. No triangles were added and nothing was re-pinned. Not done: at game pitch the beads still stick out below the fringe (now lid-coloured from above), and glTF export carries plain beads | automated — `tests/face.test.ts` (the eye anchor lands before lighting, one program for every iris, the iris is deterministic and every tone is dealt, every settler's eye wears its seed's iris), `tests/head-read.test.ts`, `tests/lighting.test.ts`, full suite; frames — `.look/shots/r30/` (`f-*`, `g-*`) against `r30-before/` |

## The anti-slop rules

| Rule | Standing |
|---|---|
| No stub `TODO` in a slice that claims to be done | held — automated; `TODO`, `FIXME`, `XXX` and `HACK` all fail `tests/architecture.test.ts` |
| No second simulation for the first-person view | held — automated, `tests/architecture.test.ts` |
| Collision matches the visuals | held — one `isSolid`, one `moveWithCollision`, both shared |
| Pause freezes the sim | held — automated, `tests/pace.test.ts` |
| The eval steward never plays the real game | held — automated; `client/` may not import `eval/`. The two have converged since this rule was written — the in-game foreman now builds turrets and takes up research projects on its own — but the eval one still deals with visiting caravans and plans its own tech order by hand, so letting it into a real game would hand the player charters they never earned |
| Winning does not switch the colony off | held — automated, `tests/victory.test.ts`. A founding sets `world.charter.won` and nothing else; `world.gameOver` still means only what `checkGameOver` means by it. Added after the two shared one flag: nine sim passes gate on `gameOver` and every one reads it as *everybody is dead*, so a founded colony stopped planning, trading, scouting and firing events while its generator burned the woodpile to zero |
| The review page never reaches a player | held — automated, `tests/kit-card.test.ts`. `src/review/` is a mirror for the look loop: it imports `client/` and `sim/`, and a walk of both directories asserts nothing imports it back. `review.html` is served by vite in dev and is deliberately absent from `vite.config.ts`, so it is never in the bundle |
| The forge bench never reaches a player | held — automated, `tests/forge-recipes.test.ts`. `src/forge/` is the shaping bench for the procedural models: it imports `client/` and `sim/`, and a walk of both directories asserts nothing imports it back. `forge.html` is served by vite in dev and is deliberately absent from `vite.config.ts`, so it is never in the bundle |
| A recipe's defaults are the geometry the colony already has | held — automated, `tests/forge-recipes.test.ts`. Seventy-three golden digests — `decor.stone`, `decor.tuft`, all nine tree pools, one stack of each of the eight carryable kinds, every buffer of the four herd species and the sixteen a settler is cut from — hash vertex positions to a micrometre plus vertex, index and box counts, so a refactor of the builders that moves anything fails. Positions only: occlusion writes vertex colours, and retuning a contact shadow must not read as a moved model. The eight stacks and the thirty-eight animal buffers are there for a second reason: no slider moves a vertex of them, so those lines are not guarding a refactor but are the first measurement `logs()`, `pelt()`, `makeMossback()` or `makeFenwolf()` have ever had |
| A recipe found on the bench reaches the game unchanged | held — automated, `tests/forge-recipes.test.ts`. The bench prints its recipe as real JSON, and six tests parse that printed block back and build from it: the digests of a rock and of a tree's trunk and all four skirts match what the sliders drew, and a tree rebuilt from its own query string matches too. The paste and the link are the two ways a shape leaves the bench, and both are the same shape it left |
| A knob the bench turns is a knob a test holds | held — automated, `tests/forge-recipes.test.ts`. The digests above are positions only, which leaves anything a recipe changes about colour or motion unguarded, and grass is nothing but colour and motion. Two more pins cover the gap: the tuft's root-to-tip ramp is written out as five exact numbers, one per blade, and the gust is read back out of the compiled vertex shader. Both were found by mutating a default and watching every test stay green, which is the risk [FORGING.md](FORGING.md) states in a line — parameterising a constant is a chance to change it by accident. The pile is the third case and the widest of them: it moves no vertex at all, only where a stack is put, so its ramp, its lift and its cap are each written out as an exact list. The animal is the fourth: its four numbers are a stride, a newborn's fraction, a collar's cut and a marker's air, and each is pinned at the function that reads it — `legSwing` at nought and at a quarter turn, `animalGrowth` at nought, a half and one, and `growAnimal` shown carrying the marker down with a shrinking body while keeping its air. The settler is the fifth and by far the largest: fourteen numbers, of which two cut the buffers and twelve do not. All eight poses are written out as the four limb angles each has always been, in literal numbers rather than off the constants they guard; the carry is shown outranking every one of them; the recoil is walked to its cap; `thumbLimit` is pinned at 0.12628 and shown moving the right way when the arm gets longer; and the sleeve's step is shown following the recipe rather than the colony's ten. Two of the fourteen also cut geometry — `leg` and `sleeve` — so the bench rebuilds the buffers rather than stretching a body round an unchanged thigh, and a test drags the leg to a metre and reads the thigh, the hip and the boot back off the model |
| The eight stacks agree with the height a pile steps by | **not held, and now measured.** `STACK_SHAPE` promises each of the eight "is built to top out at about `PILE_DEFAULT.step`" and `sync` takes it at its word, climbing a cell by `step × size × lift` whatever is standing there. Measured, the eight run from 0.26 m (raw food, 13 per cent under) to 0.344 m (hide, 15 per cent over), so a pile of hides overlaps itself by an eighth of a stack and a pile of raw food floats above its own base by 4 cm. `tests/forge-recipes.test.ts` writes out all eight heights and holds the spread inside ±15 per cent, which is where they already sit — a band that admits the gap rather than one that would be red the day it was written. Retuning eight shapes to the step is a look-loop round with frames, not a silent edit, and the brief is in the round log |
| The four species share one body space | **not held, and now measured.** `SpeciesModel` says every species is laid out "in body space, where a mossback is a unit tall at the withers, and the rig scales the whole thing by the species' `size`", which reads as a promise that `size` is the drawn height. Measured, the four withers run 0.666 to 0.95 before any scaling — a 43 per cent spread — and the mossback, the unit, is 0.95. A dunhare marked 0.45 stands 0.32 of a mossback; the brambletail and the fenwolf come up about a tenth short of their own numbers. `tests/forge-recipes.test.ts` writes out the four withers and the four drawn heights exactly and records the direction of the error. Putting the four into one body space is a look-loop judgement about how big they should look beside each other, and the bench's four-wide grid is the first frame that judgement can be made from, so the brief is in [FORGING.md](FORGING.md) |
| A forge frame gives its subject the same share of the picture every round | held — automated, `tests/forge-stage.test.ts`. `stage.ts` is the room every look-loop frame is taken in and was the one file on the bench nothing tested. Two rounds running the frames complained about it and neither could say how much, because nothing measured it. Now the fill of every family's grid frame is written out as an exact percentage — stone 28, grass 30, tree 32, stack 32, animal 34, settler 29 — so the next change to the stage has a number to move rather than an impression to argue with. Three of those moved a round later when the families got their own column counts: the piles gained the four points four was costing them, the wood held at 32 because its pitch is square and three-by-four frames the same as four-by-three, and the settlers gave up four on purpose, six being chosen against the fill because what is wrong with eight poses at four to a row is not their size but which of them is behind which. The fault behind the complaint was the pitch: `GAP` is documented as a fraction of the wider model and the code stepped both axes by the widest *dimension* of any model, so a herd that stands along z was spaced across by its own length. Four fenwolves 0.58 m through stood 2.32 m apart and got 23 per cent of the frame; they now stand 0.84 m apart and get 34 |
| No two models on a bench grid ever touch | held — automated, `tests/forge-stage.test.ts`. What `GAP` promises, held for the first time, and the one number to survive two rounds of looking for a metric behind the crowded bench frames. Every family clears at two, three, four and six, and at both ends past that — one to a row, and the whole family in one row — even the settlers, whose sleeping pose puts its box centre 0.834 m off its own origin. So a frame where a barrel lies across a crate is a frame where the barrel and the crate are metres apart and the camera stands on the line between them: every crowd on this bench is occlusion along the view ray and not contact, which is why a world-space box test calls every family clean and a screen-space one calls every family crowded. Dropped to zero, `GAP` turns ten of the twelve tests in the file red |
| Each family is photographed at the count its own frames were judged at | held — automated, `tests/forge-stage.test.ts`. `COLUMNS = 4` was the only count any forge frame had ever been taken at, argued in a comment and never checked. Twenty-four frames later three families carry their own: the wood and the piles at three, the eight settlers at six, and the stones, the grass and the herd left at four. The six counts are written out as literal numbers beside the shape each one actually makes — how many distinct columns and rows come back off the laid-out grid — so a count changed without frames behind it fails, and so does a count that stops reaching `placeGrid` while the table stays right. The settler is the one chosen against the frame-fill number and the cost is pinned rather than argued: six gives up four points of picture, because what is wrong with eight poses at four to a row is not their size but which of them is behind which |
| Every bench frame stands on the turf it is photographed against | held — automated, `tests/forge-stage.test.ts`, and read back off frames. It was not held: `stage.ts` laid a 200 m square under the subject and `fitDistance` stands the camera on the line out of the subject's centre, so a wood four metres tall at its middle rode the camera up with it while the pitch stayed 27 degrees down, and the two top corners of the frame landed 105 m from the origin against a turf that stopped at 100. A corner ray carries the horizontal half field as well as the vertical one and leaves along the diagonal, where a square plane's edge is nearest; the middle of that same top edge was still turf at 71 m, which is why the rim showed in the corners and nowhere else. The turf is 260 now, sized once rather than up to the wood: it clears the wood's 105 by a quarter again, clears the widest twelve-grid of anything the game actually has (a wood of `tree.b`, 86 m) and of the twenty-six buildings that have not reached the bench yet (a dozen doors, 50 m), and clears every family with every slider at the top of its range, the widest of those being the grass at 117 m. It does not clear the wood at the top of its sliders, which reaches 450 m and is past this camera's own 400 m far plane; the pin says so rather than stopping short of it quietly. Frames: the wood's picture had 743 pale sky pixels of 1.7 million, two wedges in the top corners eleven rows deep, and has none at all now, while the other five frames moved by at most a hundred pixels on a shadow edge |
| A bench frame's distance is lit for the same day as its sky | held — automated, `tests/lighting.test.ts` and `tests/forge-stage.test.ts`, and read back off frames. It was not held: `stage.ts` opens with the claim that nothing in it is a lighting decision, and fog was the one piece never wired. `Viewport`'s constructor sets `THREE.Fog(0x223040, 40, 130)` for whoever draws into the scene to overwrite; the world view overwrote it every frame from the sky it had just synced and the bench never did, so seven rounds of bench frames hazed toward a night-blue between 40 m and 130 m under a noon sky — the top of the wood's frame measured (36, 51, 65), which is 0x223040 within rounding. Both callers go through one `SkyView.applyFog(fog, world)` now: the bench world's sky settles at `b6a18f`, near 40, far 339.41, which is a clear day on a 192-cell map. What it was worth, family by family, is how far into the haze the far corner of each frame sits, measured from the eye rather than the origin because fog is depth from the camera: the grass, the piles and the herd never reach a 40 m near plane at all, the stones and the settlers graze it at 0.024 and 0.056, and the wood's far corner stands 138 m from the eye against a slate that stopped counting at 130 — so the top of that picture was raw night-blue with nothing of the ground left in it, and is 0.328 of the way into a warm horizon now. Frames: eight of the twelve canvases are pixel-identical between the sweeps, three more moved by no more than 6 of 255 in a band along the top, and the wood's twelve moved 726,323 pixels — 42 per cent of it — by up to 110 of 255 |
| What the forge bench covers is counted in models, not in benches | held — automated, `tests/forge-recipes.test.ts` and `tests/export-models.test.ts`, and read back off the contact sheet. It was not held: the sheet printed "`N` of 42 assemblies on the bench" with `N` the number of benches, and said 6 for four rounds. A bench is not a model — the wood is two crown variants, the stack is eight files and there is no ninth, the herd is four species — so six benches shape 16 of the 42 and the line understated by nearly three to one, in the cautious direction, which is why it stood. `Bench.covers` declares the manifest entries each bench shapes, the stack and the herd deriving theirs from the same lists their sliders index; the grass declares none and means it, because a tuft's sway is a vertex program glTF cannot hold and the exporter never writes one. The count is pinned in two places because neither can do it alone: the manifest is written by the export and `.gitignore` covers it, so the recipe suite pins the roster as literals and the export suite checks every claimed name against a real export in a temp directory — a bench claiming `stack.hides` passes the first and fails the second. What the honest number says is that the 26 left are ALL buildings, every one a bare undotted name, and the pin goes red two ways on purpose: a twenty-seventh building says the bench fell further behind, a fifth species or ninth resource says a family that has a bench grew past it. Frames: the sheet reads "6 of 6 shot, 16 of 42 assemblies on the bench", and eleven of the twelve canvases are pixel-identical to the sweep before it, the twelfth moving 5 pixels by 1 of 255 in the slider panel where the text rasteriser is a shade off run to run. The count closed the next round at 42 of 42, and the "26 left are all buildings" half of the pin is retired: what replaced it says nothing is left in EITHER direction, a shipped model no bench claims landing in `unbenched` and a claimed name the export does not write landing in `phantom`, because a count alone would let a bench drop one model and add another in the same round without a word |
| Every model the game ships can be looked at wearing its own colour | held — automated, `tests/forge-recipes.test.ts`, and read back off frames. It was not held: a building's colour is a hash of the cell it stands on, written onto a cloned material from the FIRST instance in the pool, so a pool with nothing in it this run kept the near-white it waits to be multiplied by — 17 of the 26 buildings came out of `prototypes` as `ffffff`. Not 26, because `benchWorld` lays a starter room and a bed, conduit, door, generator, lamp, prison door, stove, table and wall each already had an instance: 9 of them looked right by accident, which is why the pin is the list of the 17 names and not the number. `standBuildings(world)` stands one of every `BUILD_MENU` kind, powered, three cells apart — the exporter's strategy, not its code, since `populate()` imports `node:fs` and cannot reach a browser bundle. `main.ts` calls it BEFORE `prototypes` and the order is the whole fix, so a second pin holds the order of those two lines: dropping the call reddens it and nothing else, which is right, because `prototypes` is not where the decision lives. Frames: the mill and all 26 side by side, correctly coloured, and every one of the 12 canvases of the 6 shipped families pixel-identical to the sweep before |
| A coverage number on the contact sheet says only what it measures | held — automated, `tests/forge-recipes.test.ts`. The round before fixed a sheet that understated coverage by three to one; this one refuses to fix it by overstating. The building bench shows 26 models and shapes none of them — one field, which picks which building — so `42 of 42` alone would read as the recipe treatment being finished when it has reached 16. The sheet prints "42 of 42 assemblies on the bench, 16 with a recipe", and the split is derived from `Bench.recipe` returning null rather than declared beside it, so it cannot drift from the truth |
| A bench's Generate button shows the whole set it is stepping through | held — automated, `tests/forge-recipes.test.ts`. It was not held, and had not been since the settler bench shipped: `drawGrid` counted up from the seed in the box, which is right for a 1000-wide seed field and wrong for a field that indexes a list. The settler's default pose is `walking`, index 1 of 8, so its own Generate 8 asked for poses 1..8 and `SETTLER_POSES[k.pose!]!` handed the builder `undefined` — the exclamation mark is why nobody heard about it, and an undefined activity falls through to the same pose as `idle`, so the frames are pixel-identical either way and could not judge it. Surfaced only because the building bench throws by name and opens on index 16 of 26. `gridSeeds` wraps inside the seed field's own range: unchanged on a wide seed, the whole list on a list. The mutation drill caught the first pin being too weak — 8 distinct wrong values pass a size check — so it compares against the sorted range instead |
| A wrap that is meant to change nothing changes nothing | held — automated, `tests/forge-recipes.test.ts`, and found by frames. The first `gridSeeds` used the textbook positive remainder `((v % w) + w) % w`; the stone bench's default seed is 3.7 and `((3.7 % 1000) + 1000) % 1000` is 3.7000000000000455, because 1003.7 is not a float. A stone's shape is a hash of its seed, so 45 femtoseeds moved 113,697 pixels by up to 28 of 255 across the whole stone grid. The pin on that line said `toBeCloseTo(3.7, 6)` and went green; the frames went red. It is exact equality now, and the negative branch is taken only when needed. The sweep was shot twice with no change between to prove it deterministic before the moved pixels were attributed to an edit |
| A bench grid stands its tall models where they hide nothing | held — automated, `tests/forge-stage.test.ts`. It did not: `placeGrid` stepped by footprint and dealt cells in the order the seeds arrived, so of the eighty-two models in the seven benches' Generate frames, seventeen were more than half covered by a nearer neighbour — the statue 78 per cent gone, the battery 77, the bed 57, the mill 51. Cells are dealt by height now, tallest into the row furthest from the camera, and eleven are. The eleven left are in the four families whose models are all of a height or which stand in a single row, where no order helps and the answer is a footprint one |
| An arrangement is chosen against what it costs, not against one number | held — automated, `tests/forge-stage.test.ts`. Opening the rows far enough to clear a 2.60 m model at this camera's 27 degrees takes 3.26 times the pitch and 79 per cent of every model's apparent size; sorting takes none of it and gives two per cent back. Both were measured before either was photographed, and the test that records what each family gives up in points of picture carries the herd's one-point loss beside the animal it uncovers |
| A reason written in a comment is a reason that has been measured | **not held, and now corrected.** `fitDistance` fits a bounding sphere and its doc defended the choice with two properties, no aspect and no yaw. The aspect one is real and an earlier round priced it at a third of every grid frame and declined to bank it. The yaw one was never true: a sphere has no yaw, but the box it is measured from has one, and `Box3.setFromObject` re-measures a turned subject into a bigger box. Turned 45 degrees the seven families are framed 8 to 34 per cent further off, and fifteen degrees is worth seventeen on the stones. The old pin was titled "from any yaw and at any canvas shape" and turned the box 90 degrees, the one angle at which an axis-aligned box lands back on itself and any fit at all would pass. `tests/forge-stage.test.ts` now turns it to 30, 45 and 60 as well, turns the real families, and writes down the aspect below which the sphere crops rather than the word "any" |
| A recipe lifted out of literals moves nothing | held — automated, `tests/buildings-view.test.ts`. The first of the twenty-six buildings to be built from a recipe rather than from numbers typed into a `pool` call: the shell under the stove, the cooler, the heater, the generator and the battery bank, which were nine `rbox` calls written months apart with forty-odd literals between them. The frame put those five together — one footprint and one height band in the middle of a grid of twenty-one one-offs — and the suite had already named the same five `a machine` in a test about their feet, so the family was identified before the recipe existed. Two fields are findings: every lid overhangs its body by the same amount in width as in depth, so an overhang is one number and not two, and no body's centre was ever chosen, being half its own height above its plinth, which makes `stand` a field and `y` not one. The four `seat` values (+0.02, -0.01, 0.00, 0.00) stay a field rather than being derived away, because the cooler's two centimetres are filled by the gasket plate in `cooler.vent` and the heater's overlap is what keeps its joint from showing a seam. The derived numbers differ from the literals by at most 2.22e-16 and a vertex is a float32, so all nine buffers are byte-identical — proved with a throwaway probe BEFORE the lift was written, then pinned against the nine calls copied out by hand and frozen, since a recipe checked against the code that reads it agrees with itself whatever either says. The pin asserts equality and not closeness deliberately: a tolerance there would be the test giving up the claim the recipe makes. Four mutations red including the derivation alone with the table untouched, which is what says the pin guards the arithmetic. No frames: no vertex moved, so none could have. The census is unchanged and correctly so — it counts benches with a recipe, and the building bench still returns null because none of this is draggable yet |
| A lift that is exact at the top of a leg is not exact at its foot | held — automated, `tests/buildings-view.test.ts`. The second group out of its literals: the dining table and the games table, drawn eleven months apart and one object at two sizes. Every number that is a decision agrees across the two — 0.08 thick, eased at 0.035, square, legs 0.09 inside the top's edge — and only the width, the height and the taper differ, which is what makes them a family. `surface` is the field the rest hangs off because it is the one number that is not the modeller's: the dining table's 0.9 is `ITEM_REST`'s, where a hauled stack comes to rest on it. The finding is the leg height. It is the underside of the slab, and the obvious `surface - thickness` is 0.8200000000000001 in a double — one unit in the last place, which at the top of the leg is eight orders under what a float32 holds apart and moves nothing, and at the foot is not, because the foot sits at zero where a float32's steps are tiny. The vertices there come out 3.5762786065873797e-9 against 3.5762788286319847e-9: a lift that reasoned about precision only at the scale of the object would have shipped moved vertices believing it had not. A probe written BEFORE the lift caught it, and stepping down through the middle of the slab is exact for both tables. Pinned with `toBe` on the legs' bounding box, which is what catches anybody folding it back, plus both tops byte-identical to goldens built from the frozen calls. Four mutations red including the fold alone. No frames: no vertex moved, so none could have |
| A family the code had already named | held — automated, `tests/buildings-view.test.ts`. The timber wall and the stone wall, five `pool` calls, lifted into `WallRecipe`. The family was not deduced from the geometry first: the stone wall's own comment called it "the same silhouette as timber so a mixed perimeter still reads as one wall" long before a recipe existed, and the measurement agreed — both columns square in plan, both copings overhanging equally in width and depth, and both seated at exactly minus two centimetres, lapped into the top of the column rather than set on it so no joint opens at the height a wall meets the sky. The two agree on nothing else (0.06 of overhang against 0.16, one plinth and one none), which is what makes the shared two centimetres evidence rather than coincidence. `stand` does two jobs honestly: the stone wall's plinth is exactly the height its body is lifted by, and the timber wall stands at zero and draws nothing. Deliberately NOT `ShellRecipe` despite the near-identical shape, because a wall's body is a plain `box` and keeps the exact silhouette the sim collides with, and a primitive flag on the shell recipe would put a knob on the five machines that nothing should ever turn — the mutation that eases the wall body into an `rbox` is caught by the byte-identity pin alone, which is what that pin is for. All five buffers byte-identical, probed before the lift; the stone body's centre derives to 1.4400000000000002 and nothing on a wall is near the origin, so unlike the table leg's foot that last bit has nowhere to show. Four mutations red. No frames: no vertex moved |
| Trim that follows the body it sits on | held — automated, `tests/buildings-view.test.ts`. The games table's board, pieces and stools, lifted into `GameRecipe` as functions of the `TableRecipe` they stand on. The gap this closes is the one that had kept three earlier lifts from moving the bench any nearer a knob: every decorated building in the file places its trim in world coordinates that merely happen to line up with the body underneath (the stove's firebox door sits at z=0.44 because the body half-depth is 0.43, and nothing in the code says so), so dragging a width moves the body out from under its own trim. Measured, the chain was already in the numbers — board underside exactly the table's surface, a piece's underside exactly the board's top, a stool's centre exactly a centimetre outside the top's edge — and the six piece spots turned out to be exactly six tenths and two tenths of the board's half-width, exact both ways, so they are held as fractions and move with the board. The round needed a NEW KIND OF PIN and that is its lasting result: a golden says the parts are where they were, which is necessary and not sufficient, because a literal 0.825 and a derived surface+thickness/2 are the same number until something moves. So the parts are also asserted to still meet on a table that was never drawn, none of whose numbers appear in the trim. Proven distinct by mutation: reverting the board to its literal, or the spots to absolute, leaves every golden green and is caught by the new pin alone. Four mutations red. No frames: no vertex moved. Open brief, deliberately not acted on: whether the board should grow with the table is a look judgement, so 0.5 is pinned as it is |
| A pin that a bounding box cannot be | held — automated, `tests/buildings-view.test.ts`. The stove's feet, flue and hotplates, lifted into `StoveRecipe` as functions of the `ShellRecipe` they are bolted to. `SHELL_DEFAULT.stove` has had knobs since the shells got a recipe and nothing on the stove was listening: `stand` at 0.22 leaves the shell held up by eight centimetres of nothing, `height` buries a third of a metre of stovepipe inside the firebox and the hotplates outright, and every pin in the file was green through both. The stove's trim splits in two and this is the horizontal half — the legs and rails that stand under the shell's floor, the flue and plates that rise from its roof — leaving the firebox door and vents, which are proud of a vertical face and carry a four-link chain, to their own round. The round's lasting result is the FORM OF THE GOLDEN: a bounding box is not enough, because the feet are four legs and two rails and the rails live entirely inside the legs' span, so a rail can move a whole thickness without changing the box by a millimetre. The golden is instead the set of heights in the buffer, once each — three for the feet, which are the ground, the underside of the rails and the shell's floor — with a box kept alongside for the plan, which the heights cannot see. The flue's pin needs no number at all: its lowest word is the body's highest word, two things built and asked whether they touch, and it holds when the body is a different body. The feet cannot be asked that way and the reason is written down — the legs reach the floor out of `stand / 2` doubled and the body reaches it out of `stand + height / 2` less half its height, landing one float32 step apart — so that one is a stated tolerance, which still catches a leg out by eight centimetres. One derivation is inexact and was measured rather than argued both ways: `stand - railHeight / 2` is 0.11000000000000001 and no association fixes it, but the rail's vertices land at 0.08 and 0.14 where a float32 step is seven parts in a billion, and all three merged buffers came out byte for byte identical to the literals, 15,168 words with none differing. Four mutations red, and two of them are the evidence: pinning the flue's roof back to 1.04 and the legs back to 0.14 are each EXACTLY the state the code was in before this round, and each leaves every golden green and is caught by the knob pin alone; dropping the rails and sliding a hotplate are the reverse, invisible to the knob pins and caught by the goldens. No frames: no vertex moved. Open brief, deliberately not acted on: the plinth keeps its footprint while the shell changes width, so whether a wider stove should have a wider base is a look judgement and 0.3 is pinned as it is |
| A chain each link of which follows the one before it | held — automated, `tests/buildings-view.test.ts`. The other half of the stove: the firebox door and the air vents, lifted into `StoveDoor` and `StoveVents` as functions of the shell's face. This is the trim that stands proud of a vertical surface, and unlike the plinth its parts do not each answer to the shell — the surround is bedded into the shell, the leaf is lapped into the SURROUND'S front, the hinge knuckles stand on that same front, and the handle's stem begins on the LEAF'S front. Four links, only the first touching the shell, every join already exact in the literals and not one of the four knowing it. Turn `depth` to 1.06 and the whole door was six centimetres inside a solid box, invisible; turn `height` or `stand` and it hung at 0.58 whatever the shell's middle had become. The round's lasting result is the FORM OF THE CHAIN PIN: thicken the surround by 0.02 and its front moves out by 0.01, so the handle's tip three links downstream must move by exactly 0.01 — then lap the leaf 0.01 deeper and the opposite must hold, the leaf and handle coming back while the surround and hinges, upstream of the lap, do not move at all. Together they assert that each link follows the one before and only what is downstream moves, which no bounding-box golden can say. The box is blinder here than on the feet: the hinges, the leaf and the handle's bar are all inside the surround's span in every axis, so the golden asks for the four chain planes by name in the buffer's set of distinct z values. The float came out better than the previous round predicted: working `leafFront` out first rather than folding through the leaf's middle makes the whole z chain exact to the last bit, 0.46 and 0.5 and 0.555 on the nose — step through the surface two parts meet on, do not fold through a middle nothing touches. Three heights still drift (the door's middle is 0.5800000000000001 because 0.14 + 0.45 already is) and are kept, measured, and far from the origin; both merged buffers came out byte for byte identical to the literals, 10,116 words with none differing. Four mutations red, each one EXACTLY the pre-round state — surround at 0.44, door middle at 0.58, leaf at 0.475, louvre plate at 0.16 — and all four leave every golden green; restoring the leaf is the sharpest, since the default geometry is unchanged to the bit and all three chain-aware pins go red at once. Found while measuring and not fixed, because it is correct: the louvre assembly's lowest word is a tipped blade's back corner hanging below its own seat, not the plate, which is how the first draft of that pin failed and is why it now asks for the seat by the floor it is measured from. No frames: no vertex moved |
| A pin no golden in the file could be | held — automated, `tests/buildings-view.test.ts`. The louvre, lifted out of the four machines that each built their own copy: the stove under its firebox, the cooler and the generator on their fronts, the battery bank on both flanks. `LouvreRecipe`, `LOUVRE_DEFAULT` and one `louvreGeometry` replace four hand-built copies, which is the repo's extract-at-three rule biting at four. Measured against their own shells the four agreed on more than they let on — a plate bedded five millimetres into the face in three of them, blades standing exactly one centimetre proud of it in all four — and not one of the four knew it was the same number. The battery's is the same louvre turned a quarter onto a flank and, on the left, mirrored, so a panel is measured in the face's own axes (across it, up it, through it) and which world axis each of those is became the builder's business rather than the call site's. Five louvres came out byte for byte identical to the literals, 6,804 words with none differing, and three of the four pools are unchanged to the bit; the generator's is a PERMUTATION and not a copy, because its plate was the third part in the merge and its blades the last four, so lifting them together moves the plate three places — checked by sorting, the old pool and the new are the same multiset of 936 triangles, not one of them moved. The round's lasting result is a NEGATIVE one, found by the drill: turn the right flank's blades the way a naive lift would turn them and EVERY TEST PASSED. A blade is a symmetric box, so tilting it either way leaves its bounding box identical to the bit and its set of distinct coordinate values identical too — and that value-set golden is the strongest golden form this file has, won two rounds earlier. A rotation sign is simply not a thing a frozen position can pin. What does see it is the height of the corner that reaches furthest out of the face: tipping the outer end up swings the blade's outer-bottom corner forward and lifts it, so the furthest-out word ends up above the blade's own middle, and flipping the tilt puts it below. That is asked of all five louvres against an explicitly flipped twin, so it carries no number at all. Three sign errors were made on this one rotation — last round's comment said a negative tilt tips the front edge DOWN (it lifts the outer edge), the acceptance row and round note said the lowest word is a blade's FRONT corner (it is the back one), and the first draft of the new pin asserted the furthest-out corner is the LOW one — all three corrected against measurement, which is the argument for the pin. Four mutations red: the face pinned back to the constant 0.43 three of the four happened to be (three goldens green through it), the floor pinned back to the battery's 0.22 (the battery's golden green), the flank rotation (caught by nothing until the pin was strengthened, now caught by it alone), and the tilt reversed outright (still caught only by the two tilt pins). No frames: no triangle moved. Left deliberately: only the louvre came out of those pools, so the cooler's compressor, handle, pipe stubs and cable, the generator's stacks and the battery's terminals are still in world coordinates |
| A part inside another part's height is invisible to every box | held — automated, `tests/buildings-view.test.ts`. The cooler's lid furniture — a seal bridging the joint, a latch on the lid's front, a handle standing on its top, two pipe stubs at its back — lifted into `CoolerRecipe`. The first chain in this file whose anchor is itself derived: the lid is a function of the shell and all six pieces are functions of the lid, so turning `lid.height` used to leave the seal behind while the lid it seals climbed away from it. One inconsistency is kept deliberately and written into the recipe rather than tidied away — the stubs take their height from the lid and their depth from the BODY, because the pipes leave the machine at the back where the lid's overhang has nothing to do with anything — and the overhang is what pins it: widen it and the latch walks forward with the lid's front while the stubs do not move at all, which is exactly what the naive lift gets wrong. The round's lasting result is a THIRD KIND OF BLINDNESS, distinct from the two earlier rounds found and again turned up by the drill: freeze the handle's posts at the world coordinate they were drawn at and EVERY TEST PASSED. No golden can see it, because at the default shell the frozen literal and the derivation agree to the bit — which is the whole point of a lift. No differential can see it either, because every one of them is asked of a bounding box and the posts live wholly inside the bar's and the stubs' height, 1.41 to 1.47 against a bar from 1.45 to 1.50 and stubs from 1.375 to 1.445. A part interior in the axis a knob moves is invisible to every box in the block. What sees it is a window in z holding the handle and nothing else, and the lowest word in it: a post's foot, below the lid's top because a post that merely touched the lid would show daylight under it, asked to follow a thicker lid and a deeper seat with the bar staying the same distance above it. The seal's pin carries no number either — its far face is asked for as the reflection of its near one about the middle of the seat gap, which is the centring and the thickness in one line, and reached for by name rather than by picking the first word above the joint because the seal's corners are eased and several words sit between its two faces. All 10,848 words byte-identical to the literals, probed before the lift; the six pieces were contiguous in the merge so the pool is byte-identical too, not even a permutation. Six mutations red — the latch, seal and stubs each frozen back to exactly their pre-round world coordinates, the naive lift anchoring the stubs on the lid, the latch lifted above the lid's middle instead of dropped below it (golden alone), and the posts, caught by nothing until the handle-window pin existed. The first draft of the differential pins asked `toBeCloseTo(0.2, 12)` and failed: a vertex is a float32 and these sit at y around 1.4 where one unit in the last place is 1.2e-7, five orders looser than twelve digits. No frames: no vertex moved |
| Not every part of a machine answers to the machine | held — automated, `tests/buildings-view.test.ts`. The last of `cooler.vent` — a compressor bedded into the cooler's back face, three cooling fins across it, a cable down beside it and out along the ground — lifted into `CompressorRecipe`. The first trim in this file to hang off the face BEHIND a machine, every anchor before it having been a front or a flank, and the back turns out to want a different one. The compressor answers to the shell and the fins answer to the compressor, which is the firebox door's two-link chain again. The cable answers to NEITHER: both its runs are measured from the ground, because the ground is what they touch, so raising the plinth lifts the compressor and leaves the cable exactly where it was. That is correct and it is also the round's brief — a tall enough plinth parts them, since the cable is a fixed-length capsule whose top merely overlaps the compressor rather than meeting it at a face, measured at two millimetres of slack rather than assumed. Pinned as it is and written into the recipe's doc comment. The stove door's exactness lesson transfers to the opposite face and is worth recording as transferable: folding through the compressor's middle drifts (`-(0.86/2 + 0.1/2 - 0.03)` is -0.44999999999999996) and stepping through its front face — the surface actually buried in the shell's back plane — makes every plane behind the machine exact to the last bit. Three of the eight pins carry no number at all, and two of those needed a way to see a part no bounding box can: the fins are interior in z, the cable's ground run reaching further back and further forward than any of them, so the straddle is asked by building the body WITHOUT its fins and measuring how far past that back face the fins reach (exactly half their own thickness, in and out), and the centring over the band of heights behind that face and above everything the cable reaches. The bed is asked of a shell 1.3 deep that was never drawn. 2,736 words byte-identical to the literals, probed before the lift; the six pieces were the last six in the merge and contiguous, so the pool is byte-identical too — 7,344 position words, dumped from the old file and the new and compared rather than argued about. `cooler.vent` is now three recipes and nothing else, the first pool in the file built entirely out of them. Six mutations red, and three are the evidence: the compressor pinned back to -0.45/0.38, the fins to -0.5 and the cable's run to -0.43 are each EXACTLY the pre-round state and each leaves the golden green, caught by three relation pins, by the straddle alone and by the bed alone. The other three are a careless lift's mistakes — the cable hung off the shell's floor like everything else, the fins sat on the back face rather than across it, the fins pitched up from the middle instead of centred on it. No frames: no vertex moved |
| A recipe field nothing reads is worse than a literal | held — automated, `tests/buildings-view.test.ts`. `gen.trim`, the generator's exhaust stacks and its back-face outlet, lifted into `GenRecipe`. Three anchors on one machine out of one recipe, each asked for and each denied the other two: the stacks answer to the top of the lid chain (plinth, body, seat and lid height, all four) and to nothing about the plan; the outlet answers to the floor and the back face and to nothing about the roof, so a taller body or a thicker lid does not move it at all; and the lead answers to neither, because both its runs are measured from the ground they lie on. The back repeats the shape the cooler's compressor settled a round earlier and deliberately does NOT share its recipe — every number differs, there are no fins, and this ground run lies a centimetre in front of the shell's back plane where the cooler's lies exactly on it. Two is not three and this file extracts at three; the battery bank's terminals are the honest test. The round's lasting result is a NEW KIND OF PIN. Most pins in this file reach a recipe through the shell, which cannot see a field the shell has no opinion about: the stacks' own centre and spread place a pair off to the RIGHT of the roof rather than across its middle — held as drawn, not tidied — and freezing them back to 0.26 and 0.06 was invisible to every other test in the block. Every number the recipe exposes is now turned in turn and the buffer has to notice, because a field nothing reads tells the bench a number is adjustable and then ignores the adjustment. Writing that pin turned up that a segment count is a whole number the geometry rounds, so a fraction of one is not a turn of that knob but a test failing to turn it; integers move by one. It also records an arithmetic case the stove door's step-through-the-meeting-surface lesson cannot fix: -0.41 and 0.02 do not sum exactly in binary however the expression is associated, four tries all short, and the 4e-17 error is nine orders under the 3e-8 float32 step at that distance, so all 2,268 words came out identical to the literals anyway. And the interior-part blindness appeared again, two rounds running: raising the vertical lead with the plinth while leaving the ground run alone moves no extreme, because the lead tops out inside the outlet's own band of heights, and at the default shell that version is identical to the bit — every golden green and the dead-knob pin green too; its top is now reached for behind the outlet's back face and above everything lying on the floor. Seven mutations red, three leaving every golden green, one caught by the dead-knob pin alone and one by the new lead pin alone. `gen.trim` is byte-identical, 2,808 position words dumped from the old file and the new and compared, and is now three recipes and nothing else — the second such pool. No frames: no vertex moved |
| A field half an assembly reads is a field nothing reads | held — automated, `tests/buildings-view.test.ts`. `batt.trim`, the battery bank's terminals, straps and back, lifted into `BattRecipe` — and the back into a builder it now shares. This is the round the generator's note set up: three machines have a box bedded into their back plane with a lead down beside it and a run along the ground, and the extract-at-three rule would either bite here or be shown not to apply. IT BITES ON TWO OF THE THREE. The generator's builder reproduces the battery's back to the bit, so `GenOutlet` became `BackOutlet`, `BACK_OUTLET_DEFAULT` is a record keyed by machine in the shape `LOUVRE_DEFAULT` already had, and what was `GEN_DEFAULT` is now just its stacks. The cooler cannot join and the reason is pinned in prose so nobody tries: its box is a ROUNDED box with three fins straddling it, and a `RoundedBoxGeometry` is not a `BoxGeometry` with square corners but a different mesh with a different vertex count, so sharing would move vertices — a look judgement, not a lift. Three shapes, two builders. Every number in a `BackOutlet` is signed and all three machines use the signs differently: the cooler buries its face three centimetres into the back plane and lays its ground run exactly on it, the generator buries two and lays its run a centimetre in front, the battery buries NOTHING and lays its run a centimetre behind — so `bed: 0` is pinned as a measured zero rather than left looking like a default. The two shared backs land in the same band of depths, both front faces on -0.39, from a machine 0.82 deep burying 0.02 and one 0.78 deep burying nothing; that is a coincidence, pinned as one, and the proof no number is shared is that deepening either machine parts them. The round's lasting result is the sharper form of last round's dead-knob pin, again turned up by the drill: freeze the posts and collars at z = -0.22 and leave the BAR reading `terminals.back`, and EVERY TEST PASSES — the goldens because the literal and the field agree at the numbers it was drawn at, and the dead-knob pin because the bar on its own still moves the buffer. Half a field is read, the buffer notices, and nothing asks whether the three pieces are still on one axis. They are now, at two settings the machine was never drawn at, with the straps sent out of the way because they run the whole depth of the lid and are therefore inside every band the pin could otherwise have used. The interior-part blindness appeared a third round running and twice on one lid: the box over this assembly speaks for four faces out of fourteen, and the bar's underside is the first face in this file with no window in ANY axis, because a box has eight vertices and they are all at its corners — it is asked for by what it sits between, one face in the gap above the collars and below the posts' tops, where a bar floating clear of them puts nothing at all. The straps did have a window, being the only thing out past the collars' reach in x. One relation is derived — a strap over a lid runs the lid's full depth, flush at both ends, so it takes the shell's depth and the lid's overhang rather than a length of its own — and one coincidence is deliberately left alone: the bar's ends land exactly on the posts' outer edges at the drawn numbers, which is two literals agreeing rather than a relation, so moving the terminals apart parts them. Measured and logged as a brief, the same shape of gap the cooler's cable has. Twelve mutations red, three leaving every golden green, one caught by the dead-knob pin alone, one by the strap-bed pin alone and one by the new axis pin alone. Both pools byte-identical — 7,056 position words for the battery and 2,808 for the generator, dumped from the old file and the new and compared — and `batt.trim` is now four recipes and nothing else, the third such pool. No frames: no vertex moved |
| A shared builder moves the bug into the argument list | held — automated, `tests/buildings-view.test.ts`. `gen.fire`, `heat.glow` and `batt.band` — the lit plate on the front of the generator, the heater and the battery bank — lifted into one `FrontPlate` the three of them share. The bank's charge band had been lifted a round earlier and looked like the bank's own; the other two were still frozen `rbox` calls, and the bank's builder reproduced both of them to the bit: 972 position words apiece, nothing differing, against the back-outlet family's two builders out of three shapes. The louvre reached all four of its machines first, so this is not the first family every member could join — it is the first assembled backwards, a machine at a time and a round apart, with a one-machine type in between that turned out to be the family all along, and that order is how the finding below got in. The three agree on exactly one number, `seg: 1`, and by coincidence — the bank beds two centimetres and stands four proud, the generator three and five, the heater one and three — so all three are pinned as literals and there are three goldens here rather than one: freeze the half-depth at the bank's 0.39 and the bank stays green while the other two walk out through their own front planes. The transferable result is in the title. Eleven mutations, ten red on the first pass; the eleventh was handing the heater's pool the BANK's plate, and every pin in the block passed it — it is still a plate, it still stands proud of the heater's front, and it still glows the heater's own colour, because the material is wired separately from the geometry. Before the lift `heat.glow` was a literal and could not be wired to the wrong machine; after it there are two dictionaries keyed by machine and nothing said the two keys had to agree. So a family builder moves the bug out of the geometry and into the argument list, and a pool pin has to stop asking whether a pool looks right and ask it to equal its own machine's shell and its own machine's plate word for word. Written, and twelve of twelve are red. The same hazard is live and unpinned in the two families lifted before this round knew to ask — `LOUVRE_DEFAULT` is keyed by four machines and `BACK_OUTLET_DEFAULT` by two, and the louvre's pool pin asks only that each of the four pools has `max.y > 0`, which any of the other three machines' louvres would pass; logged as a brief rather than fixed here, since two of the three are adjacent code this round did not touch. Two fields are read twice inside the one call and both are pinned at settings no machine was drawn at: `thick` is the box's depth and, halved, its offset from the face it is buried in, and `height` is the box's height and, halved, the lift from its bottom edge to its middle — the third time after `rack.railHeight` and `band.thick`, and now stated as a rule rather than a finding: wherever a builder halves a field, the halving and the field are two readers, and the default is exactly where they agree. All three pools byte-identical, dumped from the old file and the new and compared. No frames: no vertex moved |
| A relation on one drawing is a number on the next | held — automated, `tests/buildings-view.test.ts`. `gen.skid`, the two cross members and two runners under the generator, lifted into `GenSkid`. It is the battery bank's rack a second time — same four members, same two anchors, the cross members taking their height from `s.stand` so the housing rests on them at whatever height it stands, the runners lying on the ground with a height of their own and daylight under the floor. And the one length the bank's rack DERIVES is exactly the one this machine does not hold: a battery rail laps to the runners' axes and takes that spread as its length, where a skid runner is a centimetre longer at each end and overhangs the members it crosses. Pinned at three cross-member spreads the skid was never built at, where a runner relaid on the bank's rule would follow and this one does not. The transferable result is in the title — the same assembly drawn twice can agree on every anchor and disagree about its one derived relation, so a relation that looks structural on one drawing is a number on the next and must be measured on each rather than carried across. `runnerLength` is held as a length of its own and logged as a brief. The extract-at-three question is asked and answered for a second family: two is not three, so the rule does not ask yet, but this round pins what the answer WOULD be, and it is no. The bank's cross members are plain boxes and this machine's are rounded, so the same four members cost 2,160 position words here against the bank's 432 — a shared builder would move vertices on one machine or the other, which is the reason the cooler could not join the back-outlet family, reached this time by COUNTING rather than by argument and written as a test so a later round that tries the merge is told why. One more coincidence is pinned as one: both machines leave exactly two centimetres between the ground member's top and the floor, out of a plinth of 0.12 and a runner of 0.10 here and a plinth of 0.10 and a rail of 0.08 there — four numbers, none shared, one gap, and neither machine moves when the other's numbers do. This is also the first round where the half-read field cost nothing: `rack.railHeight` and `band.thick` were each found by the drill, and `runnerHeight` is read the same two ways — as the runner's own thickness and, halved, as the middle it is drawn about — but the ground pin was written at heights the skid was never cut to BEFORE the drill ran, so the two mutations that would have been green were red on the first pass. A lesson two rounds old, applied without being rediscovered. 2,160 words byte-identical to the literals, probed before the lift and the probe deleted after; the pool byte-identical too, dumped from the old file and the new and compared. Ten mutations red, seven caught by exactly one pin each. No frames: no vertex moved |
| A cone and the cone turned over are the same size | held — automated, `tests/buildings-view.test.ts`. `batt.caps` and `batt.band`, the six cell caps bedded into the battery bank's lid and the charge readout bedded into its front plane, lifted into `BattCells` and `BattBand`. ALL SIX of the bank's pools are now recipe-built — the first machine in this file with no literal geometry left anywhere on it. The two pools finish a count the file had been building without saying it: five separate assemblies on this one machine sink a face into the surface they sit on rather than laying it across — collars 3 mm into the lid, straps and caps 2.5 mm into the same lid, the band 2 cm into the front plane, and the back outlet nothing at all. A face laid flat on another shows a line of daylight from twenty cells up, which is why `bed` is the most repeated idea here. The straps' 2.5 mm and the caps' 2.5 mm are TWO ASSEMBLIES AGREEING ON A NUMBER, not one number in two places: nothing in the code joins them, moving either leaves the other exactly where it was, and it is pinned as the coincidence it is rather than tidied into a shared field — the same shape as the generator's and the battery's backs landing on one plane from different depths. The round's title finding is a kind of blindness none of the earlier rounds turned up, and the drill had to find it: a cap is a truncated cone whose WIDE end is the one bedded into the lid, which is what makes it read as a cap screwed down rather than a peg standing up, and turning the taper over leaves the bounding box identical in all three axes AND the list of heights identical at two words, because a cone and the same cone inverted are the same size everywhere. Neither instrument this file had could see it. It is asked one ring at a time instead: the width at the underside is the foot's radius and the width at the top is the top's, both times a ten-gon's cos-18-degrees of them, since a cap reaches its full radius along z where a vertex sits on the axis and only 95 per cent of it along x where none does — which is also why the golden box is a tenth of a millimetre narrower than spread-plus-radius and not because anything moved. The second finding is `rack.railHeight` one round later on the other end of the machine: `band.thick` is read twice inside one call, as the box's own depth and, halved, as its offset from the face it is buried in, so at the six centimetres it was drawn at freezing either half moves nothing and the goldens, the depth pin and the dead-knob pin all stay green. Asked at thicknesses the band was never cut to. Two more relations are pinned as drawn rather than centred: the caps' grid sits forward of the machine's middle because the terminals have the back of the lid, and freezing that was invisible to everything else; and the band rides up on the plinth the way the back outlet's box does and the way its ground run deliberately does not. 2,160 words for the caps and 972 for the band byte-identical to the literals, probed before the lift and the probe deleted after; both pools byte-identical too, dumped from the old file and the new and compared. Eleven mutations red, five caught by exactly one pin each. No frames: no vertex moved |
| A field read twice at numbers that agree is read once | held — automated, `tests/buildings-view.test.ts`. `batt.rack`, the two cross runners and two side rails under the battery bank, lifted into `BattRack`. The first member in this file that answers to the GROUND rather than to a shell or a lid, and it turns out to answer to both — in two different ways, on one assembly, which is the whole of the round. The runners FILL the plinth: their height is `s.stand` and their middle is half of it, so the crate rests on them at whatever height it is standing, and freezing that at the drawn ten centimetres floats a taller machine off its own rack. The rails STAND ON the ground with a height of their own and stop two centimetres short of the floor. That is right for a rack member and it is also the cooler's cable lesson upside down: raise the plinth and the rails do not follow, they are left further below — and below a plinth of their own height they come up THROUGH the floor they were meant to lie under. Both ends measured, neither closed: whether a rack should grow with its machine is a frame question, so the two centimetres of daylight and the squat-crate limit are pinned as they are and logged as a brief. One length is derived — a rail runs from the front runner's axis to the back one's, so it is their spread doubled and not a number of its own, and a rack whose rails did not follow its runners would be a broken rack whatever the drawing meant. The round's lasting result is the half-read field from the battery's terminals turning up again immediately, on a NUMBER rather than an axis and harder to see for it: `railHeight` is read once as the rail's own thickness and once, halved, as the middle it is drawn about, and at the drawn eight centimetres those two agree to the bit — so freezing EITHER half leaves the goldens green, the lap pin green, the daylight pin green and the dead-knob pin green, because something still reads the name. Both halves were found by the drill and both are closed by one pin that asks the rails for the ground at heights the rack was never cut to. A dead-knob pin proves only that a field is read by SOMETHING; it says nothing about how many of its readers are left. The rails are interior in all three axes to the runners' box but unlike the battery's bar they do have a window, since a runner's only x values are the ends of a nine-tenths span and the rails sit inside it — that window is how both the lap and the ground are reached. Two measurements are recorded rather than tidied: the runners are a flat 0.9 against a crate 0.86 wide, four centimetres of proud that is two literals landing well and not a relation, so widening the shell parts them; and the golden carries FOUR heights and not three, because a centre minus half a height does not return to zero in float32 and the two undersides sit a sixth of a micron either side of the ground. 432 words byte-identical to the literals, probed before the lift and the probe deleted after; the pool is byte-identical too, 432 position words dumped from the old file and the new and compared. Ten mutations red, five caught by exactly one pin each. No frames: no vertex moved |
| A model's own bob does not decide where it stands | held — automated, `tests/forge-stage.test.ts`. A box is measured by subtracting its floor from its ceiling and that subtraction is lossy: a metre-tall slab lifted 35 mm measures 0.9999999999999999, so sorting on the raw height put the settler that bobs in front of the settler that does not. The sort key is rounded to a millimetre, pinned from four tenths under and six tenths over. Caught by a pin written a round earlier about something else |
| A walking settler's foot stays on the ground | **not held, and now measured.** `gait.ts` argues at length that a settler's foot must stay where it was put, and `footScrub` holds it there — horizontally. Nothing had ever asked the vertical question. Rotating a rigid leg about the hip lifts the sole through an arc and the body above it does not come down to meet it, so a walking settler is airborne for all but three instants of a stride: at full swing BOTH boots are 44 mm clear of the ground, and at the eighths they are 36 mm up. The bob makes it worse and exactly out of phase — it peaks at the eighths and is flat at the quarters, where the feet are highest, while a real walk lifts the hip over the planted foot at midstance and dips it at double support. `tests/forge-recipes.test.ts` writes the five sole heights and the five lifts out exactly and records that this is the state of it, not the wanted state. Which way to close it is a frame question — dropping the body by the sole's own rise plants the foot and dips the hip, and whether that reads as a walk or as a limp is what the look loop is for — so the brief is in [FORGING.md](FORGING.md) |
| The eye you look out of and the body you look at bob together | held — automated, `tests/fps-view.test.ts`. It was not: `FpsController` carried its own copy of the rig's bob with the absolute value dropped, under a comment claiming it was "the same phase, amplitude and two-rises-per-cycle the rig bobs on". It was one rise per cycle, and it sank the camera 35 mm BELOW standing height on every other step while the body it belongs to rose. Twenty-one tests already drove that controller and none had looked at the height of the thing they were driving. Both now call one `settlerBob`, and three tests fail if the absolute value is dropped again — one on the camera, one on the function, one on the sole table |
| No feature that only exists in its own tests | held — `npm run live` runs a real colony to day ninety and names anything the game promises but never does. Added after a social-balance change made the pairing threshold unreachable: the rule stayed correct, twenty-nine tests stayed green, and the feature quietly stopped happening, because every one of those tests set the bond it asserted on |
| A settler's name is never raw HTML | held — automated, `tests/hud.test.ts`. Every string sink in `hud.ts` ran through `escapeHtml` except `syncFps`'s first-person self panel, which interpolated `target.verb`, `p.name`, `p.weapon` and the carried/job label straight into `innerHTML` — and all four trace back to a name, which is not the player's data: `importColony` (`sim/transfer.ts`) hands a pasted colony code to `deserialize` (`sim/save.ts`) with no string validation, and `target.verb` can itself carry a second name (`Tend ${p.name}` on a downed ally, `sim/interact.ts`). The self panel is now `selfPanelHtml` and the interact prompt `promptHtml`, pure builders beside the file's other `xxxPanel` functions, because `syncFps` itself needs a live DOM this suite deliberately does not have and its escaping could not otherwise be asserted at all. All five sinks are covered, each proven red by taking its own `escapeHtml` call back out: a pawn named `<b>x</b>` prints as four characters rather than nesting a second `<b>` inside the one the template already wraps the name in; a carried stack whose `kind` is `<img src=x onerror=alert(1)>` — reachable because `deserialize` types `kind` as a `ResourceKind` without checking it is one — prints as text rather than building a real `img`; and `Tend <b>x</b>` in the prompt prints as text rather than a real `b`. The ordinary render is pinned too, the `who` row and the bottom `kv` row each as a whole literal string, so the carrying branch cannot go unasserted again the way it did in this round's first draft. **Not held: `escapeHtml` escaping `'`.** Asked for at the gate and reverted on measurement — `escapeHtml` is one shared function across roughly thirty call sites, one of which (`kitRow`) already escapes `EQUIP['medkit'].label`, `"doctor's bag"`, and `tests/kit-card.test.ts` (frozen) pins that string raw; every attribute in this file is double-quoted, so an unescaped `'` closes no hole any current sink opens. See ROUND_NOTES.md 2026-09-13 |

| The mood row never reads `nothing fun to do` on a settler who is not idle | **held.** `3e-measure-label` measured the branch and `3e-fix-label` closed it. The row chooses between `nothing fun to do` and `tired of working`, and it used to choose on `pawn.jobId === null` alone — which answers *are they holding work*, where the row needs *was the colony free to give them any*. Those come apart the moment the player takes hold of somebody: `setDrafted` (`src/sim/orders.ts:374-389`) cancels the job the instant you press T and `tick.ts:316` skips the whole job/idle pass for as long as `drafted` holds, so nothing ever sets `jobId` again, and a settler stood at the wall on watch read `nothing fun to do` in their own mood breakdown the entire time. Measured at **4,800 of 4,800 ticks** of a drafted day, seed `20260801`, while `isIdlePawn` (`src/eval/run.ts:403`, the predicate `3a-sim-pin-build-rate` pinned for the grid) called them not-idle on every one of them. `needs.ts:554` now asks `jobId === null && !drafted && !manual`, the two states `isIdlePawn` excludes first; `src/sim` cannot import from `src/eval`, so the pair is restated rather than shared, and it is deliberately narrower than `isIdlePawn` — sleeping and breaking settlers are left alone because nobody measured them, and `playerControlled` is left out because `isIdlePawn` does not exclude it either. The literal moved **4,800 → 0**. The row still fires all 4,800 of those ticks and the mood number is untouched: the recreation need is real, the amount never depended on the words, and a fix that silenced the row would have changed the settler's mood instead of the sentence. The fix is at the one place that chooses, so it reaches all three surfaces the label feeds — the card row (`hud.ts:4031`), `worstMoodFactor` (`needs.ts:615`), and the alert hint `MOOD_REMEDY` keyed on the label string (`alerts.ts:79`), which had been telling a drafted settler to build a table. Automated: `tests/mood-label.test.ts` drives both trips on a real colony tick by tick — the ordinary `ASSIGN_INTERVAL` gap (293 sightings, `isIdlePawn` agreeing every time, unchanged by the fix) and the drafted day. Manual: **PLAYTEST.md step 9vv** |

## What still wants a human

These are real and they are not automated, because they are about how the thing feels
rather than what it computes. Each is a numbered step in `PLAYTEST.md`:

- **§4** — step into a body, walk at a door, come back up. The switch has to feel like
  turning your head, not like loading a level.
- **§7** — pull the plug mid-raid: save, reload, and check the colony came back the same.
- **§9j** — leave the colony alone for four minutes and watch the foreman build. The same
  step now covers the third research tier: whether a bill under a project row reads as a
  price rather than as an error, and whether a bench that has worked something out and is
  waiting on a delivery reads as *waiting* rather than as broken, are the parts that need
  eyes. What it computes is pinned by `tests/research.test.ts` — all-or-nothing payment, the
  shortfall netted against the yard, and the project landing in the tick the crate does — and
  whether the foreman actually walks to the parts town is pinned by `tests/rings.test.ts`.
  Neither can tell you whether an amber chip saying `0 / 12 components` sends a player to the
  road or to the bug tracker. The step now runs one rung further than that, and the extra
  rung is worse: the last two projects bill machinery out of the far ring, so taking up
  `Instruments` buys a twenty-day silence. That the party turns around and walks it is pinned;
  whether twenty days of nothing reads as a price being paid or as a colony that has stopped
  is exactly the thing a test cannot be shown.
- **§9k** — send somebody over the ridge and get them home again.
- **§9l** — read the founding panel and understand, without help, what to do next.
- **§9jj** — read the three roads on the morning the colony is founded. `tests/roads.test.ts`
  pins every rung, every boundary and the save round trip, and the grid *asks* whether the
  three ladders disagree with each other — and currently answers no, twice over, since the
  unmanaged grid can move neither economy nor warfare; what none of them can be shown is
  whether a player who has
  just won the first act looks at that panel and sees three places to go rather than three
  progress bars. Nothing in the suite mounts the HUD — vitest runs `environment: 'node'` — so
  this row is the only thing that has ever seen the panel.
- **§9kk** — send three settlers out to take a holding. `tests/holdings.test.ts` pins all of
  it — that the refusal names the number it wanted, that the party leaves and comes home, that
  a garrison of two never gives the doorway away for free, that tribute arrives on its ring's
  own clock — but not one of those things is the question this step asks. A campaign takes
  three of seven hands off the map for six days on the near ring and twenty on the far one,
  and there is no undo. Whether the colony going short-handed for that long reads as a bet the
  player made or as a mistake they cannot back out of is the whole design of the feature, and
  it can only be found out by doing it. The second half of the step is the quieter one:
  a won campaign raises the next raid, and whether that lands as the cost of taking ground or
  as the game punishing you for playing it is not something a number can be shown.
- **§9ll** — commit to an ending and live the twelve days. `tests/endings.test.ts` pins every
  number on the card and every way the count can stop, and the grid says two colonies out of
  fifteen ever got to see it. What none of that can be shown is the only question the step is
  really asking: **is committing a decision, or is it a button that appears when you have
  won?** Everything about the design says it should be the first — the offer names a price, the
  count is twelve days long, and a bad fortnight costs the whole count and none of the goods —
  but a player who reaches a top rung with fifty days of slack and clicks the one card on the
  panel has made no decision at all, whatever the mechanism says. The second half is quieter and
  harder: **give it up** has no confirmation box, deliberately, because nothing it destroys is
  unrecoverable. Whether that reads as trust or as a trap is the sort of thing only a person who
  has just lost eleven days can report.
- **§9nn** — land an ending while standing in a body. `tests/overlays.test.ts` proves the rule
  over all sixteen states, but a rule about *who has the hands* is a feeling before it is a
  boolean: whether the pointer coming back on the frame the card opens reads as the game letting
  go, or as the game losing its grip, is not a thing sixteen assertions can say.
- **§9oo** — read the roll. `tests/manifest.test.ts` pins what each row is allowed to say and
  `tests/endings.test.ts` pins that it froze on the landing tick, and neither can answer the only
  question the step asks: **does a list of names at the end make the forty days feel like they
  happened to somebody?** The card is a tally with a roll under it, and if the roll reads as more
  data rather than as an ending, the ordering is wrong and no test will ever say so. The check
  worth doing twice is the quiet one — find a settler whose partner is buried and see whether
  *with <name>* under a name on a ship lands the way it is meant to, or reads as a bug.
- **§9pp** — watch a settler walk, then walk one yourself. The whole motion round argues from
  arithmetic: foot scrub is asserted at zero in cells, the possessed body's stride is asserted
  against the ground it covered, and the mutation the tests refuse to let back in is a measured
  0.441 of backwards slide per step. None of that is a claim about how it **looks**, and the two
  numbers the fix trades against each other pull opposite ways — a foot that plants is bought by
  halving the leg speed, and legs that are slow enough read as a moon-bounce rather than a walk.
  3.6 steps a second is right on paper for a body crossing 3.1 cells of it, and paper is where
  that ends. Stand next to a settler crossing the yard, then take a body and hold W into a wall:
  the legs should stop when the body does, which is the thing the manager camera used to
  contradict. **The animals want the harder look**: a wolf or a goat on its way somewhere was
  being fed 16.5 of stride per cell against the 7.5 its rig assumed, so their legs have just
  slowed to under half of what anybody has ever seen them run at. That is the correct number and
  it is the largest single change to how this game moves. Nobody has looked at any of it yet.
- **§9qq** — click on the dirt. `tests/select.test.ts` pins that every square answers, that a
  settler and a building still win over the ground they stand on, that a stack somebody is
  carrying is left out of the count, and that a drag moves the map without repainting the panel.
  What it cannot pin is the thing the complaint was actually about: a player clicked a rock, a
  woodpile and a furrow, got nothing back three times, and concluded the game had not modelled
  any of them. The panel now says something for all of it. Whether what it says is worth having
  read — whether four different kinds of square produce four *useful* answers rather than four
  paragraphs of terrain trivia — is the question, and no assertion about field names can reach it.
- **§9rr** — ask who is building your wall. `tests/board.test.ts` pins the contents and the
  order. The order it *shows* against the order you watch happen in the yard is the part that
  needs eyes, because the board re-sorts as jobs are claimed and a queue that reshuffles while
  you read it is worse than no queue.
- **§9ss** — put a fence in front of a raid. `tests/breach.test.ts` pins that a raider with no
  route takes apart what stands in its line, that it leaves alone the fence that is not in its
  way, and that the hole it makes is walkable. Whether it *reads* as a raid choosing a way in or
  as an animal chewing furniture is the whole difference between a defence layer and a nuisance,
  and it is not a thing three assertions can say.
- **§9tt** — build a wall across somebody's errand. `tests/repath.test.ts` pins both halves — the
  settler steps round new geometry, and a body that is genuinely wedged still gives up rather
  than re-pathing forever. The half worth watching is the one the numbers already argued: 145 of
  177 emergency feedings on one harsh seed used to end with the carrier upright, the meal in the
  world and the patient on the floor. The colony was never short of food or of hands; it kept
  putting the plate down, and it did so silently, which is why it took a probe to find. Whether
  the fixed version reads as a settler solving a problem, or as one milling about near a wall,
  is the part left.
- **§9m** — walk into the haze. Whether the edge of the known world reads as weather or as
  a missing chunk of the level is not a thing a test can be shown.
- **§9n** — read the map in the corner. Whether one pixel a cell is legible, and whether
  the viewport outline tracks the camera closely enough to steer by, are things only eyes
  settle.
- **§9o** — live through a winter. The arithmetic of the year is pinned by
  `tests/seasons.test.ts`, but whether the valley going gold reads as a warning or as a
  rendering fault, and whether winter lands as pressure rather than as punishment, are
  the parts that need somebody watching it happen. The same step now covers snow: what it
  costs is pinned by `tests/weather.test.ts` — no growth bonus, a quarter of rain's help
  against a fire, and the same front rolling from `Rain` to `Sleet` to `Blizzard` as the
  thermometer falls — but whether a flake reads as a flake rather than as white rain is
  something only eyes settle. Snow that *lies* is pinned the same way by
  `tests/snowpack.test.ts` — bare in summer on every seed, deep in most winters, gone by
  spring, never on a floor, and a settler wading measurably slower than one on paving —
  and needs eyes for the same reason: whether a white valley reads as a season you are
  living in, or as a terrain layer somebody switched on. The same file pins the *shape* of
  it too — the mesh never opening a crack between a lifted cell and the path beside it, the
  lift never growing into something a body could stand on, and A\* switching a settler onto
  the long paved way once the short bare one is under snow — but whether thirteen
  centimetres of lift reads as thickness or as a wobble in the ground is a question for a
  low camera and a person looking at it.
- **§9p** — find the lake. Everything structural about it is pinned by `tests/lake.test.ts`
  on twelve seeds — a basin of real size on every one, never in the yard, never touching
  rock, a sand ring the whole way round with no bare ground at the water's edge, every scout
  site and minable seam still walkable to, water the colony cannot walk into, a flat bottom
  with a sloping bank, and no crack anywhere in the mesh. What no test can settle is whether
  the bowl reads as water with a bottom or as a hole cut in the field, and whether standing
  at the shore in a body stops you where the shore looks like it is.
- **§9q** — walk on the lake. The arithmetic is pinned by `tests/ice.test.ts` on seven seeds
  — a surface midway through winter and gone midway through spring, a two-degree band where
  it holds what it has, no randomness spent on it, an old save reading as open water, and
  the bowl coming up level with the bank on the exact tick it starts bearing. So is the
  consequence: the frozen lake is a shortcut in winter and a wall the rest of the year, the
  same shortcut for a raider as for a settler, costed above paving and below the drifts,
  and never anywhere to build however hard it freezes. So is the thaw — a warning better
  than a thousand ticks before it can hurt anybody, a settler still out there put on the
  bank with a chill, and the leftovers washed ashore rather than swallowed. What no test
  can settle is whether the ice reads as ice rather than as pale water, whether it is
  visibly a different white from the snow beside it, and whether the six days it is open
  land as an opportunity you plan around rather than as a rule that changed overnight.
- **§9r** — fish it. `tests/fishing.test.ts` pins the stock and the consequence separately.
  The stock: an old save reads as a full lake, twenty-five catches empty it and further ones
  never take it below nothing, it comes back over four days and stops at full, the shut and
  reopen lines are two different numbers so the bad news lands once instead of on a loop,
  the catch thins with the lake but never comes up empty-handed, and none of it spends a
  single roll of randomness. Where a stage may stand: the water's edge and nowhere else,
  straight out rather than diagonally past a headland, and never fooled by a flat-array read
  wrapping onto the far side of the map. The consequence, end to end on the pinned seed: a
  colony with an empty pantry walks to the shore and comes back with food, a fed one leaves
  the lake alone, a hungry one fishes it flat and is told so, and a winter colony cuts
  through the ice for it — slower, and saying so. And both cameras reach the same board:
  pressing **E** on the deck queues the same `fish` job the work loop would have, not a
  private routine. What no test can settle is whether the stage reads as a plank deck over
  water from the manager camera, whether standing on it in first person feels like standing
  on a jetty rather than on the lake, and whether the lake running out lands as a resource
  you managed badly rather than as a system that stopped working.
- **§9s** — put the lake to work. `tests/watermill.test.ts` pins the watts, the wiring, and
  the latch. The watts: the same number at every hour of a day where a panel would swing
  from nothing to two hundred, full output a hair under the bearing threshold and exactly
  nothing at it, nothing under a flare, and not one roll of randomness spent on any of it.
  The wiring, which is the part that could have quietly gone wrong: a mill is a producer, a
  source, electrical, and conducting by the same predicates a generator answers, so a
  mill-fed network reads as fed — the regression is a foreman who would otherwise have run
  conduit across the map *away* from a working power source looking for one. A lamp beside a
  mill lights with no wire and no wood; the freeze drops it and says the grid is short rather
  than that it is unwired; a battery carries it through. The latch: one line when the lake
  sets and one when it goes out, three mills collapsing into one sentence rather than three,
  a mill built into an already-frozen lake latching silently but still reporting the thaw, a
  flare that is not a freeze, and a save that loads mid-winter without announcing a freeze
  that happened in January. End to end on the pinned seed: a colony runs a full day off the
  water with zero dark hours and zero wood burned, a generator on the same grid sits cold
  until the ice takes the wheel and then picks the load up, and an empty woodpile in January
  means the lamp goes out *and* the player is told why. What no test can settle is whether
  the turning wheel reads as a mill rather than as a crate with something wrong with it,
  whether two mills on one shore look like two machines instead of one drawn twice, and
  whether a stopped wheel in January lands as the lake taking your power rather than as the
  renderer having given up.
- **§9t** — cross the lake. `tests/bridge.test.ts` pins three things. Where a bridge may go:
  water and only water, refused on grass, dirt, stone, sand, rock and on a deck already laid,
  refused off the map, and — the clause the whole feature turns on — *allowed* on open lake
  four cells from any bank, which nothing else in the game permits. What a deck is once it is
  down: walkable in high summer where the water was a wall, walkable unchanged through the
  freeze and the thaw, exactly a plank road's speed and a plank road's path cost, cheaper to
  cross than the ice beside it so a colony keeps using its bridge in January, not soil and
  not tillable into soil, and surviving a save by name with every terrain that shipped before
  it still on its old index. And a regression that is older than this feature: with the ice
  bearing, `canFloor` refuses plank and paved on the lake. It used to allow them, because it
  asked whether somebody could stand there rather than what the ground was — one January
  afternoon bought a permanent steel causeway across open water. End to end, the claim that
  cannot be made any other way: a three-cell span painted into the lake finishes, and finishes
  in *order*, sampled every twenty ticks — the bank cell strictly before the middle one and
  the middle one strictly before the end, because until the near deck exists the far one has
  nowhere to stand. Nothing enforces that ordering directly; it falls out of one flag, and the
  test is what says the flag is still there. Then: a settler can path to a cell in the middle
  of the lake with the deck under it and cannot without it. What no test can settle is whether
  the deck reads as boards standing over water rather than as the lake having turned brown,
  whether the rails land on the right edges as a crossing curves, and whether watching a span
  grow outward from the bank feels like a bridge being built rather than like the game
  filling in cells.
- **§9u** — send a Picky. `tests/pickies.test.ts` pins three claims, and only the first is
  about goblins. That a Picky answers the *same* question a job asks: it walks the same
  `findPath`, `isWalkable` and `moveWithCollision` a settler does, stands *on* a cell it
  could stand on and *beside* one it could not, and reports unreachable exactly where a job
  would find no way — so a cell sealed behind eight walls comes back `nothing joins it` and
  a cell twelve squares off comes back reached, both by the sentence the player actually
  reads, and the failure names the building when there is one. That watching a colony does
  not change it, which is the assertion the whole feature rests on: a twin, the same seed
  run with six Pickies scampering over it and without, and every roll, every settler
  position, every stack, every stat and the whole fog array identical cell by cell —
  including `world.nextId`, because the id counter turned out to be a shared stream too
  (wildlife staggers its wandering by `(tick + id)`, so a Picky that spent one moved every
  deer born after it, and that is why Pickies number themselves negative). And that it
  always leaves: reachable, unreachable, or nothing anyone planned for, the field is empty
  inside `PICKY_PATIENCE + POOF_TICKS` — plus that a `rounds` itinerary is fixed at summon
  time, so the same colony and the same seed walk the same round twice, and that a Picky
  mid-errand survives a save on the same leg. The other three errands are pinned on what
  makes each of them different from `reach`: a *doors* Picky visits doors and only doors and
  is caught standing **on** one, which is the entire difference between trying a door and
  walking past it; a *fetch* Picky's two stops are the stack and then the nearest store that
  actually accepts that resource, and it refuses to set off at all when there is nowhere to
  put the thing; and a *surprise* Picky only ever draws an errand the colony can supply —
  stripped of buildings, items and zones it picks `reach` every time — and draws the same
  one twice from the same colony and seed. What no test can settle is whether a knee-high
  pink goblin reads as *not one of yours* at a glance, whether the pop-in and pop-out look
  like the same trick played in opposite directions, whether the ears lagging the bounce
  sells it as a live thing, and whether six of them at once read as a crowd rather than as
  one body drawn six times.
- **§9v** — the one you keep. `tests/pets.test.ts` pins the bond as a thing the sim keeps on
  its own rather than a label on a goat. That the handler keeps what they tame — the E2E
  runs a real taming to completion and the animal comes out belonging to whoever did the
  work — one apiece in both directions, refused for anything that is not a live tame animal
  or anyone who is not a live settler, named off a list nothing else in the colony answers
  to, and named *without spending the dice*: `world.rng` and `world.nextId` are both byte
  identical across a bonding, which is the Picky scar applied a second time (a name drawn
  from an rng or an id counter would have moved the weather every time a player tamed
  something). That it stops being livestock in every way that matters: the same animal in
  the same place has a pen target unbonded and none bonded, `markHuntPawn` refuses it and
  says whose it is from either door in, it is not counted against the pen's carrying
  capacity — a pen with room for three still calves with two head and a pet — and its body
  is not butchered where it falls, with an unbonded animal of the same species dropping meat
  in the same test as the control. That the follow is real: it routes rather than aims, so
  it closes thirteen cells of open ground and, the test that would have caught the obvious
  design error, comes through the cabin's one door to reach somebody standing inside it. And
  that the ending is charged once — grief, a headline naming both, a life-log line, the
  bonus cleared to zero rather than left negative; that the bond does not outlive the person;
  and that letting go gives the species name back, costs a pang, and frees the settler to
  take another. What no test can settle is whether the teal tag reads as *somebody's* at a
  glance, whether an animal at your heel in first person feels like company or like a mesh
  following you, and whether losing one lands.
- **§9w** — what comes for the herd. `tests/predators.test.ts` pins the fenwolf pack as the
  thing that puts a risk on keeping animals, and pins it by everything it refuses to be. That
  a predator is a field and not a species: `hunts` on the pawn, set from the table by the
  spawner, which is the whole reason `predators.ts` can be imported by the module that owns
  the table without the two pointing at each other. That it goes for animals and never for
  people — the prey scan skips every faction but `fauna`, a settler standing a cell away is
  passed over for a hare three cells further, and the E2E leaves somebody in the middle of a
  four-wolf pack for forty-five seconds of sim with their health bar untouched, which is the
  one promise the whole beat rests on. That it prefers the pen: a tame animal sixteen cells
  off beats a wild one at ten. That it stops when it is full and when it is leaving, and that
  it does not see across the map. That the bite is a struggle and not a subtraction — one per
  interval, three or more to bring a mossback down, and the chase is real arithmetic (the
  wolf loses the flee burst and wins the pursuit), with the kill resolved after every animal
  has moved so it is never decided from a cell the prey has already left. That it eats what
  it kills: the body is cleared without butchering and the colony's raw-food ledger is
  unchanged across a mauling, because a pack that left a pile of meat would be the best thing
  that ever happened to the colony. That the whole pack is fed off one kill. That the colony
  is *told* — a wolf in among the buildings or standing in a pen is marked for the hunters
  automatically, once and not once a tick, and a wolf on the far treeline is not an alert.
  That the pack goes home: the stay expires, the survivors take the nearest border and drop
  the hunt mark on the way out, and an animal with no clock at all is left alone. That it
  cannot be tamed from any door in. That the herd answers it — livestock walk four cells in
  sixty ticks with a wolf three cells off and none at all with a settler in exactly the same
  spot, which is the pen behaving like animals without breaking the slaughter job. And the
  full arrival, from `startPredatorPack` through two days of `stepWorld`: they come in off an
  edge more than twenty cells out, hungry, on a route rather than a wander, and by the end
  there is not a wolf left on the map and the colony is still alive. What no test can settle
  is whether you notice them before they reach the pen, whether the grey silhouette reads as
  *not one of mine* at manager zoom, and whether losing an animal to them feels like a thing
  you should have prevented rather than a tax.
- **§9x** — the pen that holds. `tests/doors.test.ts` pins the answer to the pack that is not
  a rifle: a door is a wall to anything that cannot work a latch. That the rule lives on the
  one solidity gate and nowhere else — `isSolid`, `isWalkable`, `canStep` (corners included),
  `findPath`, `penetration` and `moveWithCollision` all take the same `latch` and give the
  same answer, so what A\* refuses to route through, a pair of legs also refuses to walk
  through. That it is about doors and only doors: a wall, a rock, open ground and out-of-
  bounds answer identically either way, and a door *blueprint* is passable to everything,
  because settlers have to be able to stand where they build. That the rule knows who is
  asking — a settler yes, a raider yes, a tame animal yes, a wild one no — with the tame
  exemption pinned as a behaviour and not a flag: a bonded dunhare follows its person in
  through the gate, because a pet that lost its owner at a doorway would stand against it
  until it starved. That the door on screen agrees with the grid: it stays shut with a wolf
  standing on it and swings for the settler and for the goat. That deadfalls now fire on
  anything that came to take something — a fenwolf dies to one outright, `TRAP_DAMAGE_MIN`
  is pinned above a fenwolf's hit points so that stays true, a raider is still caught, a
  settler is still spared, and a grazing mossback, tame or wild, walks over the trigger. And
  the beat itself, three wolves against a walled and gated pen for forty-five seconds of sim:
  the goat is untouched, the pack is alive and still outside on open ground rather than
  having wandered off, and none of them gets within a cell and a half — against the control
  of the identical pen with one wall cell missing, where the goat dies. That control is what
  makes the rest of it mean anything; without it the whole file would pass just as well if
  wolves had quietly stopped hunting. And the regression the slice nearly shipped with: with
  every settler moved inside the cabin and no route to any of them that does not go through
  a door, the pack still arrives, and every cell of the route it is handed is standable by
  something that cannot work a latch — because an arrival aimed at a settler would have
  meant a colony stopped seeing wolves at exactly the point it got good enough to have beds.
  What no test can settle is whether the pack working
  along the fence line reads as the wall holding rather than as the wolves losing interest,
  and whether a night where nothing comes because you sealed the place feels earned or feels
  like the storyteller went quiet.

- **§9y** — it takes two, and they take time. `tests/livestock.test.ts` pins sex and age.
  That an animal's sex is an answer and not a roll: the same id gives the same sex every
  time it is asked, four thousand ids split within 43–57% either way, and — the one that
  matters — consecutive ids are the *same* sex about half the time, because ids are handed
  out in sequence and `id & 1` would have alternated, made every animal tamed after another
  one a breeding pair, and let the whole feature cost nobody anything. Sex is derived rather
  than stored or rolled for two reasons the tests stand in for: an `Rng` draw inside
  `spawnAnimal` would shift every seed in the game, and a stored field would be one more
  thing an old save has to be given on load. That growing up is a clock and not a flag:
  anything with no birthday is grown — which is every wild animal and every animal in a save
  written before this — a calf runs 0 → 1 over three game days, is grown *on* the tick and
  never more than grown, and is worth a quarter of a body at birth and a whole one after.
  That breeding needs one of each and both grown: two males in a pen with room never calve
  over ten breeding intervals, a mixed pair does, two species do not, and a pen holding one
  adult and one calf stays at two head until the calf's three days are up and then breeds —
  which is the property that keeps livestock the slow food loop instead of compound interest
  with a cap. That a barren pen says so: once after half a day, once a day after, naming
  which sex is missing, and stopping the instant the missing one is tamed in — a player who
  tames two males and is told nothing has been handed a bug, not a challenge. And that the
  carcass agrees: a day-old calf drops `round(meat × 0.25)` where its dam drops all of it,
  never zero, and the log says *calf* in the sentence. What no test can settle is whether a
  calf at 45% of its dam's length reads as young from the manager camera, and whether three
  days of watching one fill out is a herd growing up or a countdown you stop looking at.

- **§9z** — nothing here lives forever. `tests/lifecycle.test.ts` pins the length of a life.
  That every species has one measured in game years — forty days for a mossback, thirty for
  a fenwolf, twenty-two for a dunhare, against a twenty-day year. That an animal with no
  birthday reads as newly grown rather than newborn or ancient, which is the whole migration
  story for saves written before this: reading them as newborn would freeze a herd back into
  calves, and reading them as aged would kill a player's entire pen on the tick they loaded.
  That the three stages run in order and breeding covers only the middle one — grown *on*
  the tick, past it at three quarters of the span, still alive for the last quarter and
  unable to breed through any of it. That arrivals are never a calf and never about to drop:
  every spawn of every species is prime, spread across the first 45% of its life, and — the
  one that would have been invisible — ages are independent of sex, because sharing a hash
  would have made every male on the map the older one, a pattern a player notices long
  before anybody finds the bug. That old age costs the meat and only the meat: an animal
  that dies of itself in the pen leaves a hide, drops no raw food, says *old age takes* once
  and never the kill line reading "0 raw food", while the *same animal at the same age*
  slaughtered a moment earlier still feeds the colony in full — it is dying of itself that
  costs, not being old, or the correct play would be to kill everything at three days. That
  the moor stays a moor: a wild animal at the end of its years is simply gone, drops
  nothing, and does not fire the line that belongs to a herd walking off the map. That a
  companion gets one goodbye and not two. And that the pen has to be managed: a pair past
  their years never calve again, the colony says *past breeding* rather than blaming a sex
  neither of them has wrong, it names the missing half when only one of them is past it, and
  a herd that kept its calves outlives the pair that started it. What no test can settle is
  whether forty days is long enough to feel like an animal's life rather than a timer, and
  whether the first *old age takes* line lands as a colony's own carelessness or as the game
  taking something away.

- **§9aa** — the valley is 192 across. Four times the ground the game shipped with, in two
  goes — 96 to 128, then 128 to 192 — and almost none of it lands
  on the homestead: the cabin, the first ore, the trees and the walk to the water are all
  measured out from the middle and are exactly where they were, so what grows is the rim.
  `tests/lake.test.ts` pins that the water grew with it — the basin is a fraction of the map
  radius rather than a fixed ellipse, or a lake tuned on a 96-wide valley becomes a pond on a
  192-wide one — and that it still lands at all, which now takes `LAKE_TRIES` = 24 attempts
  rather than the six it began with,
  because more landmarks means more doorsteps a basin is turned away from. `tests/hunting.test.ts`
  pins the herd cap as a density (`populationCap`) rather than the flat fourteen it was, and
  the opening fauna scale with area, so a bigger valley carries a bigger population without
  the moor round the fence getting any busier. `findPath`'s budget is two thirds of the map
  rather than the flat 6000 that happened to be two thirds of the old one. The landmark
  count moved the same way and for the same reason: one site per 512 cells, so seventy-two
  of them rather than the eighteen a 96-wide valley carried.
  <br><br>
  The honest cost is the seed pin at `tests/hunting.test.ts:397`: worldgen draws its terrain
  from the same stream the settlers are rolled from, so a wider map is a different draw by
  construction and **every seed in the game is a different valley**. That is what the pin is
  for — it is the only check in the suite that fails when a new system quietly helps itself
  to the worldgen stream, which is a bug with no other symptom.
  <br><br>
  Two bugs that were always there surfaced when the map moved, and both are fixed at any map
  size. A herd's exit used to be a guess: project the map diagonal down the heading and clamp
  x and y back into bounds — which is not a point on the ray, so a heading leaving by the
  north edge aimed at the north-*west* corner, reliably a sealed pocket of rim rock, and two
  seeds in six staged nothing. It is a flood now (`furthestAlong`), which asks the map for the
  furthest ground down that line something door-blind can actually stand on, and costs less
  than the four A\* retries it replaced. And `arrivalSpot` used to verify that an arriving
  animal could reach the colony *with the doors open* — but a door is a wall to anything wild,
  and the settler it aimed at is usually asleep behind one, so it either staged wolves in a
  pocket they could never leave or declined every cell on the map. It asks about the yard now,
  door-blind, which is where a wolf or a mossback was ever going.
  <br><br>
  The test suite paid the rest of it, and the lesson is one line: a coordinate written down is
  an offset from a landmark that nobody wrote down. `(33,33)` was the steward's woodpile,
  `(31,20)` was a cell of yard, `(6,6)` was rim rock nobody could be handed — all true of a
  96-wide valley whose cabin sat at (48,48), all false the moment the cabin moved to the
  middle of a wider one, and each failed as something else: a Steward that plans once, a
  cooler that will not build, a door that swings for wolves. They are searched for now.
  `tests/balance.test.ts` widened the same way — the starved-floor recovery is asked of six
  colonies rather than one, because "the colony recovers" was always measuring "this colony
  recovered" and one hard map is entitled to falsify that. `tests/farming.test.ts` had the
  same disease and took the other cure: its twenty-day claim was a fat pantry — two days of
  eating per settler — which across six seeds now ranges from a day and a half to twenty.
  The thin end is a colony that grew from three settlers to seven out of the same six-by-two
  plot, which is the right answer to not painting more soil, so the number came down to one
  day and two claims went in beside it that a re-rolled map cannot move: something is still
  in the ground on day twenty, and more food came out of the valley than the colony landed
  with. A margin is a property of a seed; *still producing* is a property of the loop.
  <br><br>
  What no test can settle is whether the extra ground reads as a bigger valley or just as a
  longer walk — the far corners are genuinely far now, and a scout sent to the north rim is
  gone for a while.

- **§9bb** — something eats something. `tests/berries.test.ts` pins a three-link chain, and
  the reason it is a chain rather than a table of species is that each link is pinned by
  *removing* it and measuring the one above. Brambles first: they root only on walkable
  grass or dirt, never on a cell the colony has zoned, never within nine of the hearth, and
  in patches rather than singly — a bush against the cabin wall would make foraging one more
  thing that happens in the fifteen cells where everything already happens. They come off a
  stream derived from the seed, so a save written before brambles existed grows the same
  moor its seed always described rather than a new one; and painting a plot over a bush
  grubs it out, because a cell that is both furrow and bramble is a cell the farm board
  queues a sow and a forage on, forever, each undoing the other's reason to exist. The curve
  is most of a week of daylight to fruit, and all but stopped in winter — pinned as a ratio
  against high summer at the same hour rather than a hard zero, because the season curve is
  continuous and a tenth of a degree should not fail a test. Picking pays the forager and
  leaves the plant standing; an animal stripping it takes the same fruit and pays nobody;
  and a pick that finds the bush already bare costs the plant nothing, or two settlers
  racing for one bush would reset each other's six days.
  <br><br>
  Then the animal. A brambletail is three raw food and no hide against a mossback's thirty —
  deliberately not worth hunting, because the moment it is, it stops being a population the
  player watches and becomes one more thing to shoot. It browses, it starves without fruit,
  and it breeds while fed, which is the whole of the middle link: without starvation a
  cleared valley fills with animals that eat nothing and never die, and without breeding
  "the wolves keep them in check" is a claim about nothing, since there would be no growth
  for a wolf to check. The top link needed no code at all. `predators.ts` has never known
  the species table — a hunter is anything with `hunts`, and prey is anything wild that is
  not one — so the day a brambletail existed a fenwolf ate it.
  <br><br>
  The claim the file exists for is the two-line one at the end: the same seed run three
  times, with the browsers taken out of one and wolves put into another, ends with
  measurably more fruit on the moor where something was eating the browsers. That is what
  makes clearing every wolf off the map a decision with a cost rather than free safety.
  <br><br>
  The carrying capacity is emergent and is not written down anywhere. Roughly three hundred
  and thirty bushes on the 192-wide valley — 337, 323 and 345 on the three seeds it was
  counted on — three quarters of a day fed per bush and six days to regrow: a browser
  population in the tens,
  arrived at by arithmetic nobody performed. `browserCap` exists only as a runaway backstop
  — the fruit is the real limit, and a constant that set the population directly would have
  made the bushes scenery.
  <br><br>
  Foraging is the colony's end of it, and it is gated twice on purpose. It will not walk
  past 26 cells, and it only fires when the pantry is genuinely thin — under about four
  days a head, which is a far hungrier line than the one sowing answers to. Both gates are
  direct consequences of §9aa. The range cap is the obvious one: at a fixed bush density an
  uncapped search on a valley this wide always finds a ripe bush *somewhere* and would remove
  a settler from the colony for half a day to fetch two raw food.
  <br><br>
  The appetite gate is the one that had to be learned. Foraging shared the sowing ceiling to
  begin with — forty-five raw food a head, about seventeen days — on the reasoning that both
  are the farm board's idle work. They are not the same work. Sowing compounds; a bush is a
  walk out and a walk back for two food and then six days of nothing. And where every other
  entry on the board runs out, this one cannot: the moor always has another bush. Measured
  over one day on seed 21, foraging took 4 120 colonist-ticks against 708 for building —
  forty-four per cent of the colony's waking life. The Steward staked out a fence, four of
  eight posts went up, the board never cleared and it never marked another batch; a corpse
  lay in the yard unburied; the freezer thawed because nobody hauled wood to the generator;
  and seed 424242 starved a settler to nothing *while its settlers were out gathering food*.
  That is the shape of the bug and it is worth stating plainly, because the number never
  changed — the map did, and a gate tuned against a garnish on a 96-wide valley met the
  hundred and fifty bushes of a 128-wide one.
  An errand that never runs out will eat every finite job behind it unless its gate says
  *short*, not *not yet full*. What no test can settle is whether a bramble
  patch reads as a place worth walking to or as scenery the farmhands occasionally wander
  into, and whether watching the squirrel population rise and fall lands as a valley with a
  life of its own or as numbers moving in the background.
  <br><br>
  One thing this slice broke and then fixed, recorded because the failure was invisible in
  every screenshot: putting prey on the far side of the lake made A* fail, and a failed
  search leaves `path` null, which the next tick reads as "has not looked yet". A wolf whose
  brambletail was across the water re-ran a whole-map search twenty times a second. Five of
  them cost forty milliseconds a tick between them, against eight for the entire rest of the
  valley — a pack arriving was a pack arriving *and* the frame rate leaving, and nothing on
  screen said why. `routeTo` now remembers a refusal for fifteen ticks, the same way
  `chargeRaider` already remembered one; the trajectory is identical tick-for-tick and the
  same two days of wolves cost a tenth of what they did. Two tests pin it from both ends: a
  refused route is not re-asked next tick, and a reachable one is taken on the tick it is
  wanted, because "ask less often" would have fixed the cost by making every animal notice
  its dinner late.

- **§9cc** — watch someone fetch. `tests/hauling.test.ts` pins the two changes as
  arithmetic: a hauler gathers everything within two cells of the stack it stooped for and
  makes one trip of it, never reaching through a wall to do it (the region check, which is
  the bug this could have), and a settler supplying a queued wall carries enough for
  several frames and walks down the line rather than back to the pile. What a test cannot
  settle is the thing the change was made for — whether the base *looks* like it is going
  up faster. Half again as much building on the same three days is a number; a colony that
  reads as busy rather than as commuting is not.

- **§9dd** — run the moor with nobody in it. Not a browser check at all: `npm run eco`
  takes the colony out of a valley and runs the real tick for a thousand days. It is on
  this list rather than in the tables above because the pass condition is a shape, not a
  threshold — four columns that stay alive, and one of them, `ripe`, that is *supposed* to
  oscillate while the others hold. A drift too slow for a forty-five-day run to show is
  exactly what a human reading five hundred days of census rows catches and an assertion
  does not.

- **§9ee** — ask why nobody is building your wall. `tests/idle.test.ts` pins each line and,
  more importantly, pins the silences: a settler who is drafted, possessed, asleep, mid
  morale break or actually working gets no line, because the card already says those. The
  only bug this feature can have is a line that is not true, and truth is the one thing a
  human reading it against the board can check.

- **§9ff** — choose the valley you land in. `tests/difficulty.test.ts` pins the three
  settings as numbers and the balance grid pins that they are three different games — the
  cost of a run goes ×4.0 from settler to hard country. What wants a human is the card
  itself: whether a sentence per setting is enough for somebody who has never played to
  pick one, and whether a blank seed box reads as *optional* rather than as *broken*.

- **§9gg** — let two of them make a life. `tests/partners.test.ts` pins the two-line
  clock — 70 to start it, below 62 to stop it — and pins why it is two lines rather than
  one: the top bonds in a real colony wander about ten points over a month, so a
  single-line version was reset by the ordinary weather of the number it was watching, and
  three ninety-day colonies produced one pairing between them. What no test settles is
  whether ten days of `courting` in the bonds row reads as a story building or as a status
  that never resolves.

- **§9hh** — read the colony's own history. `tests/chronicle.test.ts` pins what gets copied
  into it — only a message raised as a headline, and `tests/headlines.test.ts` pins which
  messages those are — that it opens on the founding, that it outlives the eighty-line log
  underneath it, that it comes back out of a save, and that a save written before it existed
  loads rather than refusing. The judgement left over is editorial: whether the panel reads
  as *what happened to us* or as a second, longer log. One line of small talk in it is the
  whole failure, and only a reader can see it.

- **§9uu** — ask a body what it has on. `tests/kit-card.test.ts` pins that every number the
  gear rows print is the simulation's own — each one re-derived by putting the piece on a real
  settler with the game's own `equip` and asking the game's own accessors — and
  `tests/corpse-card.test.ts` pins that a click reaches a corpse, that it does not reach one at
  the cost of a living settler standing on the same square, and what the corpse card refuses to
  say: no mood, rest, recreation, hunger, skills or bonds row, and none of the three buttons
  only a living settler could obey. Two things are left for a human. The first is whether
  *40% armour · 92% work · −0.15 warmth* under `steel plate` reads as a trade or as a spec
  sheet — the numbers are right and that is not the same as legible. The second is the rot
  clock: *rots away in 4 days* is meant to send a player out to fetch the parka, and stripping
  a body is not built yet, so today it is information with no lever on the end of it. Whether
  that reads as a promise or as a tease is the note this step exists to collect. Both cards can
  be looked at without waiting for a raid — `npm run dev`, then `npm run look:review`.

- **§9ii** — walk the map open, one ring at a time. `tests/rings.test.ts` pins the structure
  (twelve places, four per ring, distances that only grow outward), each of the three gates
  alone with the other two satisfied, the exact standing at which a road opens, and that a
  colony left to itself walks outward rather than in a circle. The balance grid pins the
  promise across sixty days as `the-far-ring-is-earned`. What no test can settle is whether
  a locked road reads as *somewhere to work towards* or as *decoration*: the whole mechanism
  is eight headings that say what would lift them, and if a player reads those sentences and
  still cannot tell what to do next, the far country is a wall with a label on it. The
  second thing a human has to judge is the order the gates bind in — the vouch is supposed
  to be the interesting one, and headcount is supposed to be the last, because a far ring
  that is really a population counter would be a trade system wearing somebody else's coat.
