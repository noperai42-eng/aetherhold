# Acceptance

What the build promised, and where each promise is actually held down. Rows marked
**automated** fail the suite if they stop being true; rows marked **manual** need a
browser and live as a numbered step in [PLAYTEST.md](PLAYTEST.md).

*The other four documents:* [README.md](README.md) is what the game is and how each
system works, [ARCHITECTURE.md](ARCHITECTURE.md) is how the code is laid out and why,
[PLAYTEST.md](PLAYTEST.md) is the browser tour these manual rows point into, and
[ENDGAME.md](ENDGAME.md) is what is still missing at the far end of a run.

Four sections: [the killer feature](#the-killer-feature),
[the engine constraints](#the-engine-constraints), [the anti-slop rules](#the-anti-slop-rules),
and [what still wants a human](#what-still-wants-a-human) — which is the long one, and is
ordered to match `PLAYTEST.md` rather than by importance.

Last run — 2026-08-12, the motion round. The grid is the overlay round's and has not been re-run:
this round is client-only, and the fingerprint `.eval/measurements.json` is keyed on has not
moved.

- `npx tsc --noEmit` clean.
- `npm test` — **96 of 98 files, 1836 tests green**, 13 skipped, in 850 s.
  **Fourteen** of those are the newest and they are the walk.
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
  bug. The load-bearing one is none of those: it reads `src/sim/movement.ts` **as text** and fails
  if the literal there stops matching the copy here. The copy exists because exporting the real
  one would edit `src/sim/**` and cost a sixty-day grid re-run to say what the grid already says,
  and a copy is only safe while something breaks when it drifts.
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
  **39 colonies in 2,847 s**. **Twenty-nine** principles are scored, one more than last time:
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
- `npm run build` — 919.61 kB JS (263.15 kB gzip), 23.76 kB CSS (5.15 kB gzip). The gait module
  cost **0.16 kB and no CSS**, which is what a page of arithmetic that deletes two fields on its
  way in should cost. The build also caught the round's only type error — a `URL` handed to a
  `readFileSync` the hand-written `node.d.ts` had declared as `string`-only — which is the gate
  doing its job rather than confirming a green that was already there.
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
| One gait, whichever camera is watching | limbs come off `animPhase`, which is *distance travelled after collision* — the possessed body advances it by the ground it actually covered, so a body held against a wall stops striding in both views instead of sprinting on the spot for the manager camera. There is no animation clock left anywhere in the client, and each rig derives its stride from its own legs | automated — `tests/gait.test.ts`, `tests/fps-view.test.ts`; manual — PLAYTEST §9pp |
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

## The anti-slop rules

| Rule | Standing |
|---|---|
| No stub `TODO` in a slice that claims to be done | held — automated; `TODO`, `FIXME`, `XXX` and `HACK` all fail `tests/architecture.test.ts` |
| No second simulation for the first-person view | held — automated, `tests/architecture.test.ts` |
| Collision matches the visuals | held — one `isSolid`, one `moveWithCollision`, both shared |
| Pause freezes the sim | held — automated, `tests/pace.test.ts` |
| The eval steward never plays the real game | held — automated; `client/` may not import `eval/`. The two have converged since this rule was written — the in-game foreman now builds turrets and takes up research projects on its own — but the eval one still deals with visiting caravans and plans its own tech order by hand, so letting it into a real game would hand the player charters they never earned |
| Winning does not switch the colony off | held — automated, `tests/victory.test.ts`. A founding sets `world.charter.won` and nothing else; `world.gameOver` still means only what `checkGameOver` means by it. Added after the two shared one flag: nine sim passes gate on `gameOver` and every one reads it as *everybody is dead*, so a founded colony stopped planning, trading, scouting and firing events while its generator burned the woodpile to zero |
| No feature that only exists in its own tests | held — `npm run live` runs a real colony to day ninety and names anything the game promises but never does. Added after a social-balance change made the pairing threshold unreachable: the rule stayed correct, twenty-nine tests stayed green, and the feature quietly stopped happening, because every one of those tests set the bond it asserted on |

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
  contradict. Nobody has looked at any of this yet.
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
