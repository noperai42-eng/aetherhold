# Round notes

One round, one measured gap, one fix. Newest first.

---

## 2026-08-13 — The settler who slept through starving

**Track A: a measured fix.** One deleted early return in `src/sim/jobs.ts`. In `src/sim/**`, so the
fingerprint moved and the sixty-day grid was re-run.

### It was not a population

Last round handed this one its target: 102.1 h in the **on their feet** starvation column, four days
of somebody upright at zero food, printed by every verdict and judged by nothing. The obvious read is
a colony-wide walk-home problem. It is not. Sorted by run, the grid's upright column is 102.1 h in
one place and **7.92 h** in second place. One run, harsh/424242, and inside it very nearly one
settler.

`scripts/probe-upright.ts` — outside `src/sim` and `src/eval`, so it does not move the fingerprint —
walks the run tick by tick and asks of every upright settler at or below zero food *what is the first
thing stopping them eating*, in the order the sim would check. 27 524 settler-ticks came back under a
single answer: **`is asleep`**, with reachable food the whole time and a larder averaging 187 units.

### The false lead, kept

The first reading of that probe reported a 154.5 h spell against only 20.3 h of ticks in trouble,
which is arithmetically impossible unless the latch is leaking. I had a mechanism ready —
`settlements.ts` and `holdings.ts` both lift pawns off `world.pawns` for caravans and campaigns, and
a latch keyed on "still starving" never clears for somebody who is no longer on the list — and it was
wrong. `scripts/probe-absent.ts` ran the shipped latch and a corrected one that clears on absence
over the same world: **both read 102.1 h**. No leak.

The bug was in my probe. It called `stewardTick`, and the fifteen sweep runs the grid measures are
**unmanaged** — `measurements.json` keeps `steward` and `sweep` as separate top-level keys. A probe
that runs the steward is measuring a different colony living a different sixty days. The steward is
now opt-in in `probe-upright.ts` with the reason in its doc comment, and the negative result stays in
`probe-absent.ts` so nobody re-derives it.

### The defect

Two ways to sleep, one of them deaf to hunger. The `sleep` **job** ticks rest and checks
`food < 0.12 && rest > 0.5` every tick. `tryNeedJob`'s last resort — past `rest < 0.12` with every
bunk taken, drop where you stand, no job — is ticked by `tickGroundSleep`, which opened with

```ts
if (bed && isBed(bed.kind)) return; // handled by the sleep job
```

true of a settler in a sleep job, and false of every settler that function is ever called with: both
`tick.ts` call sites are reached only with `jobId === null`. A settler who collapsed onto somebody
else's bunk was therefore ticked by **nothing** — rest never climbed, the `rest > 0.9` wake never
fired, and `tick.ts` sends a jobless sleeper there and `continue`s, so the need pass never saw them.

`scripts/probe-sleep.ts`, same seed, before:

| settler | spell | rest | food at end | on a bed |
|---|---|---|---|---|
| Sela Ashdown | 126.7 h from day 56 | 0.00 → 0.00 | 0.00 | 100 % |
| Ivet Stonehearth | 57.2 h from day 58 | 0.03 → 0.03 | 0.00 | 100 % |
| Sela Ashdown | 13.6 h from day 46 | 0.12 → 0.12 | 0.29 | 100 % |

197.5 h of sleeping rough, 137.6 h of it at or below zero food, all of it on a bed. Sela was asleep
when the run ended.

### The change

Delete the guard. Sleeping rough now gains `REST_GAIN_GROUND` wherever it happens, and wakes on
`rest > 0.9` **or** `food < 0.12 && rest > 0.5` — the sleep job's own rule, so both ways of sleeping
answer an empty stomach the same way. The `rest > 0.5` half is load-bearing: waking somebody at zero
rest sends them straight back down, and a settler yo-yoing between bunk and pantry gets neither. The
rough-night mood hit moved from per-tick to the wake, so it is one charge for one night rather than a
penalty that deepens the longer they manage to sleep.

### The same probes, after

Same seed, unmanaged. A sim change re-rolls the history, so this is a different sixty days and the
totals are not subtractable — but the shape is unambiguous:

| | before | after |
|---|---|---|
| sleeping rough | 197.5 h | 13.4 h |
| of that, at or below zero food | 137.6 h | **0.0 h** |
| longest upright-at-zero spell | 102.1 h | 7.2 h |
| `is asleep` as a blocking reason | 27 524 ticks | **gone** |

The one surviving spell reads `rest 0.12 -> 0.90`: somebody sleeping, and then getting up. What is
left in the upright column on that seed is 3820 ticks of a meal already walking and 3585 ticks of a
hunter out on the moor — both of them a settler doing something, which is a different question.

### The grid handed over a paired sample

Fingerprint `2edb0102` → `ce4d9a8f`, 39 colonies in 2157 s — and **fourteen of the fifteen sweep runs
came back byte-identical**. Every column, every seed, every difficulty. Only harsh/424242 moved:

| run | upright at zero | on the floor | stranded |
|---|---|---|---|
| harsh/424242, before | **102.12 h** | 27.86 h | 3.60 h |
| harsh/424242, after | **7.23 h** | 27.86 h | 6.68 h |
| every other run | unchanged | unchanged | unchanged |

Three rounds running I have had to argue that a summed column moving a few per cent across re-rolled
sixty-day histories is noise wearing a number's clothes. This one is a paired sample by accident: the
deleted guard could only fire for a settler sleeping rough *on a bed cell*, and in sixty days across
fifteen colonies that happened on exactly one of them. The bug was as rare as it was total.

The stranded column on that run went the other way, 3.60 h → 6.68 h. That is the honest cost of the
divergence rather than a regression — Sela gets up on day 56 now, and what she does with the rest of
the run is a history the old grid never had. The grid-wide worst upright spell is now **7.92 h**, on
settler/99001, a run that did not change at all.

### The column is judged now

`on-their-feet-at-zero-is-a-walk-home`, in the fingerprint-exempt `principles.ts`, so it went in
after the grid and `npm run balance` re-ran alone. Twelve in-game hours, and the bar comes off the
map rather than off the grid: `WALK_SPEED` is 0.155 cells a tick, nothing in `TERRAIN_SPEED` is
slower than bare grass, so the widest crossing on a 192-cell map is 6.2 h at a dead walk and twelve is
that twice with the detours. A settler upright and empty for longer than it takes to cross the whole
valley and come back is not walking anywhere.

**Enforced**, against the file's usual convention of leaving a new bar open for one grid. That
convention is for bars around genuinely unsettled design questions; this is a pin on a defect that
has been found, measured and closed, and its whole job is to go red if that settler ever lies down
again. It reads `holds — longest anywhere: 7.9 h — settler/99001`.

### Verified

- `npx tsc --noEmit` — clean.
- Sixty-day grid, `2edb0102` → `ce4d9a8f`, 39 colonies in 2157 s. **22 principles hold, 8 break** —
  the new one is the twenty-second and the broken eight are unchanged in membership.
- `tests/sleep.test.ts` — eight new tests. Seven waking-rule assertions, one each so a failure names
  which rule moved, and one experience test: a settler dropped on somebody's bunk at zero rest and
  zero food, a meal two cells away, half a day of `stepWorld` with nothing touched — they wake and
  they eat. Run against the pre-fix `jobs.ts` and `tick.ts` it fails on the first assertion,
  `still asleep half a day later`, which is the difference between a test and a decoration.
- `tests/balance-principles.test.ts` — two more, because that file is hand-written cases rather than
  one per principle, and a new check shipped with none at all is a check nobody has seen fire: one
  that the bar catches 102.1 h, one that it lets a 7.9 h walk home alone and prints it anyway.
- `npm test` — **1862 tests green**, 13 skipped, 98 of 100 files, in 935 s. Run twice: once on the
  fresh grid and again after the principle and its two cases went in.
- `npm run build` — clean.

### Next

The 45.5 h stranded column, split. The pass fires at 0.14 food and the eval latches at 0.02, so some
of that is a meal legitimately walking over — the probe put that slice at 31.0 h of a pre-fix
reading, the largest non-wipe one. A column that excluded ticks with a `feedPatient` job already
targeting the patient would name dispatch alone, and only then is there a number worth enforcing.

Carried forward unchanged: `starveHours` counts a **drafted** settler as upright, and
`sendSomebodyToFeed` skips drafted settlers on purpose. Harmless on the fifteen unmanaged sweep runs —
nothing drafts anybody without a player or a steward — but worth excluding when either column is next
touched.

---

## 2026-08-12 — Somebody drops what they are doing and carries the meal over

**Track A: a measured fix.** In `src/sim/**`, so the fingerprint moved and the sixty-day grid was
re-run. This one is meant to move a column, and the column it is meant to move is `floorH`.

### The correction that started it

The round below shipped a sentence I had not measured: **"nothing in the sim carries food to a
downed settler."** It is false. `jobs.ts` has had `tryFeedPatient` the whole time, wired into the
`doctor` work case and into an emergency lane that sits *above* the work board in both assignment
entry points, with a comment naming this exact failure. The probe found the population; I supplied
the cause from the shape of the reading, wrote it into the principle, the architecture note, the
round notes and the commit message, and it took writing the fix to notice.

Everything measured in that round stands — the two disjoint populations, the durations, the
recruits eliminated, the pantry stocked throughout. One causal sentence was invented, and the
correction is left in place under the original rather than quietly edited out.

### The measurement

`scripts/probe-feed.ts` — outside `src/sim` and `src/eval`, so it does not move the fingerprint —
asks the question the first probe did not: not *is there a door* but *which gate is shut, and for
how long*. On every tick where a downed settler sits at zero, it asks every other settler why they
are not the one carrying a meal, taking the **first** blocking reason in the order the sim checks
them, so the tally reads as "what would have to change" rather than "what was also true".

Seed 1312, sixty days, before the fix — 88.2 h with a settler starving on the floor:

| slice | hours | what it is |
|---|---|---|
| the whole colony on the floor | 49.6 | nobody conscious to carry anything |
| a meal already on its way | 31.0 | the system working, slowly |
| every settler on their feet was mid-job | **7.2** | the defect |
| somebody standing free, no meal moving | 0.3 | the assignment cadence |

Four slices, one of them a decision the colony got wrong. Both entry points return early on
`pawn.jobId !== null`, so **from the floor, a colony that is merely busy is indistinguishable from a
colony that is unconscious.** Across all three harsh seeds the tallies agree: tens of thousands of
`is downed themselves`, then `is mid-job` in the hundreds to low thousands, and `is asleep` never
once — which is why the fix does not wake anybody.

### The change

`sendSomebodyToFeed(world)`, in `jobs.ts`, called from `stepWorld` right after the fire pass. It is
`firesafety.ts`'s `sendSomebody` with the fire swapped for hunger — colony-level, because "who goes"
is one decision with one answer, and the precedent for cancelling a working settler's job to save a
life is already in the codebase and it is a fire. After the fire pass rather than before, because a
settler running out of the flames is not the one to send for a meal, and a live `flee` can only be
skipped once it has been formed.

What it will not do is the load-bearing half:

- never wakes a sleeper — the probe found not one tick in three seeds where the only hands available
  were in bed, and `firesafety.ts` wakes people because the bed is on fire;
- never touches `flee`, `rescue`, `feedPatient`, `caravan` or `campaign`;
- skips anybody the player has spoken for — drafted, manual, possessed, doctoring off — and anybody
  running on empty themselves, or two die instead of one;
- looks for the food **before** it cancels anything, so an empty larder does not also cost the
  colony a half-built wall.

### The same probe, after

Re-run on the same seed, with one extra tally: on every tick that still reads "the only hands up
were all mid-job", *why did the interrupt decline*. The colony's history diverges the moment the
first meal is carried differently, so this is a different sixty days and the totals are not
subtractable — 92.6 h on the floor rather than 88.2, 49.3 h of it a fully floored colony.

The busy-hands slice reads **4.3 h**, and the breakdown of it is the part worth keeping:

| why the pass declined | settler-ticks |
|---|---|
| is hungry themselves | 1018 |
| is on a job nobody is pulled off (`feedPatient`) | 96 |
| **nothing — the pass should have sent them** | **0** |

Zero. What is left of that slice is a colony where everybody still standing is themselves under the
hunger line — a famine, not a dispatch failure — plus a settler already carrying a meal to a
*different* patient. Neither is something to fix by sending somebody anyway.

### The grid disagreed, and it was right about the instrument

The sixty-day grid came back with `nobody-starves-beside-a-full-pantry` broken on **nine** runs of
fifteen, up from seven, and the floor column up rather than down: 186.4 h summed across the fifteen
unmanaged colonies before, 197.4 h after; worst single run 35.9 h → 58.4 h. The round's headline,
measured against the round's own column, failed.

Two things are true at once and it took some care to keep them apart. The fix is right — the probe's
busy-hands slice reads zero settler-ticks, and the twenty-day run pinned in `colony-eval` lost its
floor spell entirely. And a sim change re-rolls every colony's history, so post-fix runs on the same
seeds are **not paired samples**; a column moving six per cent across fifteen re-rolled sixty-day
histories is noise wearing a number's clothes. The health columns say the same thing from the other
side — survivors 9.33 → 9.27 per colony, mean food 0.56 → 0.57, days of food in store 17.0 → 17.6,
buried 1.4 → 1.9 — a fix that cancels working settlers' jobs cost the colony nothing measurable, and
bought nothing measurable on the column it was aimed at.

The count going up is the finding, and it is about the column. `floorStarveHours` counts hours at
zero on the floor *including the hours when the entire colony is on the floor* — 49.3 of seed 1312's
92.6, on the probe. Nothing on the work board reaches a settlement with nobody conscious in it. The
column scores a wipe as a hauling failure, so it can never be tuned to zero, so it cannot tell the
next round anything.

So the instrument grew a third spell rather than the second being stretched, and the promise moved
onto it:

| column | at zero, and | what a fix could do |
|---|---|---|
| `starveHours` | on their feet | walk home sooner — still unmeasured, printed and unjudged |
| `floorStarveHours` | on the floor | nothing, if nobody is standing |
| `strandedStarveHours` | on the floor, **with somebody standing** | carry the meal over |

Same shape as [the wait column learning to tell a decision from a road](ARCHITECTURE.md#a-bar-derived-off-the-wrong-ring):
the promise was unreadable because its column mixed something the player can change with something
they cannot. The other two hours ride in the detail line on every verdict, passing ones included.

The re-run is a clean paired comparison, which is the one thing the previous grid could not be: no
`src/sim` file moved, so every colony lived the exact same sixty days and only the instrument
changed. Nine runs, same histories, both columns:

| run | on the floor | with hands free |
|---|---|---|
| settler/20260729 | 5.3 | 1.6 |
| settler/7 | 15.5 | 4.2 |
| settler/99001 | 21.6 | 6.6 |
| settler/424242 | 12.9 | 3.9 |
| harsh/20260729 | 58.4 | **10.5** |
| harsh/7 | 18.9 | 7.3 |
| harsh/1312 | 20.1 | 3.1 |
| harsh/99001 | 16.7 | 4.7 |
| harsh/424242 | 27.9 | 3.6 |
| **sum** | **197.3** | **45.5** |

**Three-quarters of the hours the old column counted were hours with nobody conscious to carry
anything.** The worst run in the grid drops from 58.4 h to 10.5 h; the promise still breaks on the
same nine runs, because the bar is one hour and every one of them clears it — but it now names a
quantity somebody could go and reduce instead of a quantity that includes the colony dying.

What is left in that 45.5 h is not yet split, and next round is where that happens: the pass fires at
0.14 food and the eval latches at 0.02, so some of it is a meal legitimately in transit — the probe
put that slice at 31.0 h of the pre-fix reading, the largest non-wipe one. A column that excluded
ticks with a `feedPatient` job already targeting the patient would name dispatch alone.

That also cost the `colony-eval` pin its run: harsh/424242 over twenty days no longer has a floor
spell at all, which is the pin doing its job — it failed the day the defect under it was fixed.
Re-pointed off `scripts/probe-starve-pin.ts`, which walks the short grid a unit test can afford and
prints all three columns per candidate.

### Verified

- `npx tsc --noEmit` — clean.
- Sixty-day grid, fingerprint `4952c293` → `2edb0102`, 39 colonies in 2218 s. **21 principles hold,
  8 break**, unchanged in membership from the round before — this round moved a number inside a
  broken principle rather than closing one.
- `tests/feeding.test.ts` — eight new tests. Seven gate assertions, one each so a failure names
  which gate moved, and one experience test: three settlers all mid-job, one on the floor at zero,
  nothing touched by the test, and the patient eats. That last one was run with the call to
  `sendSomebodyToFeed` commented out first — it fails with the patient still at 0.00, so it is
  load-bearing rather than decorative.
- `npm test` — **1852 tests green**, 13 skipped, 97 of 99 files, in 865 s. Run *after* the grid
  rather than beside it: last round's three timeouts were the grid stealing the machine, and on a
  quiet one the same three files finish in a quarter of the wall clock and pass.
- `npm run build` — clean, 920 kB bundle.

### Next

The settlers who are **on their feet** and starving. The grid reads 102.1 h in that column — better
than four days of somebody upright at zero food — and no principle fires on it at all, because the
one that watches food is now pointed at the floor. It is the same shape of gap this round started
from: a number the build prints and nobody judges.

One known softness to carry in with it: `upright` counts a **drafted** settler, and
`sendSomebodyToFeed` skips drafted settlers on purpose. On the fifteen sweep runs that is harmless —
`p.drafted = on` has exactly one writer, `orders.ts`, and nothing drafts anybody without a player or
a steward — but a managed run mid-raid can book an hour of "hands free" that no rule was ever going
to spend. Worth excluding when the column is next touched, not worth invalidating a finished grid
for.

---

## 2026-08-12 — Nobody starves beside a full pantry, and it took a duration to say who

**Track A: the instrument.** No game code changed — the client bundle comes out byte-identical.
`src/eval/**` changed, so the fingerprint moved and the sixty-day grid was re-run.

### The gap

`nobody-starves-beside-a-full-pantry` had reported `broken` on six of fifteen colonies for four
rounds, naming runs and no cause. Its own comment listed three live explanations — a downed settler
nobody carried a meal to, a recruit who joined starving, a hauling reservation holding the last
meal — and said honestly that it did not claim between them.

It could not. The check read `worstFood`, which is a **level**: how low did anybody get. A level
cannot tell a settler walking home from the far end of the valley, who bottoms out on the way and
eats on arrival, from one who is not going to be fed at all. Both read 0.00 and the detail line
could only ever say `hit 0.00 on 19 days of food`.

### The measurement

`scripts/probe-food.ts` — outside `src/sim` and `src/eval` so it does not move the fingerprint —
replays a named run and logs every unbroken spell at or below the starving line: how long, how much
of it on the floor, and whether the colony had food at the time. Every tick, not once a day: this
world's day boundary lands at 07:12 every time, so a daily sample of a hunger curve reads one fixed
phase of it, and forty minutes at zero looks exactly like a week at zero.

Two populations in the two runs it replayed, and they do not overlap:

| | length | on the floor | pantry stocked | ends in |
|---|---|---|---|---|
| walking home | 0.03–0.24 d | 0% | 100% | `eating` |
| on the floor | 0.39–1.05 d | 89–100% | 100% | getting up, or not |

Recruits are out: every settler who joined mid-run arrived at 0.45 food or better, so nobody walked
in already starving. The reservation theory is not needed either — the pantry was stocked for the
whole of every spell in both columns. What is left is the plain one. **Nothing in the sim carries
food to a downed settler.** They lie at zero next to weeks of meals until they get up or die.

> **Correction, one round later.** That last sentence is false and was never measured — the probe
> found the population, and I supplied the cause. `jobs.ts` has had `tryFeedPatient` and an
> emergency feeding lane the whole time. The round above measures which gate was shut. Everything
> else in this entry stands; the sentence is left in place with this note under it rather than
> quietly edited out.

### The change

Feeding is not fixed this round, deliberately. Fix it first and the principle still reads `broken`
— the walkers are still walking — and nothing in the grid shows the repair landing. So the round
buys the instrument that can see it, the way "the wait column learns to tell a decision from a
road" did two rounds ago.

- `starveHours` and `floorStarveHours` on every run: the longest unbroken spell at or below the
  line **on their feet**, and the longest **on the floor**. Disjoint by state, not nested — one is
  a walk to dinner, the other is a settler who is not getting one. Latched per tick inside the run
  loop, next to what upkeep already does.
- The check is `floorStarveHours >= 1 && endFoodDays >= 5`. The walkers are printed alongside
  rather than counted as failures, on every verdict — a number that only shows up on a failure is a
  number nobody tunes.
- `floorH` joins the grid table.

### The grid

- Fingerprint `4e7e7e91` → `4952c293`. 39 colonies, 3037 s.
- **Every pre-existing column is identical on all 15 sweep runs.** The new latches read the world
  and write nothing, and the grid says so rather than me.
- The one principle that moved is the one this round touched. All eight others return their
  previous verdict and detail line to the character.
- It moved in the direction I did not predict: six runs to **seven**. Every run the old check named
  did have a real unfed casualty, so on this grid the level was not over-firing — it was *missing*
  one. `settler/20260729` left a settler down and unfed for 6.7 h and never quite touched 0.00, and
  a bar drawn at the bottom of the scale read that colony as fine.
- And it put a number on the upright population for the first time: **26.3 h** at zero on their
  feet, against the under-six the probe's two runs showed. That is not a walk home. The check does
  not fire on it, on purpose — there is no measurement of what those settlers were doing, and the
  reason this principle spent four rounds saying nothing useful is that a bar once got drawn around
  a story instead of a reading. It is printed, in the open, waiting for a probe.

### Verified

- `npx tsc --noEmit` — clean.
- `npm test` — **96 of 98 files, 1843 tests green**, 13 skipped, in 2248 s (run alongside the grid,
  hence the wall clock). Three new: two on the principle's ability to tell the two columns apart,
  one on a named run that pins both columns nonzero and unequal — a new metric wired to nothing
  stays zero and passes every assertion about its shape.
- `npm run build` — 919.45 kB, **byte-identical bundle hash** to the round below. Nothing shipped
  to the player this round, and that is checkable rather than asserted.
- `npm run balance` — eight principles open, seven of them unchanged.

### Next

Carry food to a downed settler, with `floorStarveHours` as the number that has to fall.

---

## 2026-08-12 — One stride, and the four rates it was being fed at

**Track A: a measured fix.** In `src/sim/**`, so the fingerprint moved and the sixty-day grid was
re-run. The whole point of the re-run is that it should have changed nothing — see below.

### The gap

Found while checking the round below this one, which is the right way to find it and a bad look
for the round below this one. That round derived every rig's stride from `PHASE_PER_CELL = 7.5`
and stated that the sim advances `animPhase` by ground covered. Neither half survived reading the
sim.

`animPhase` had **four** writers converting distance into stride, at three rates, and two of them
stacked:

| where | what it added | per cell |
|---|---|---|
| `followPath` | `step * 7.5` — the step it *intended*, before collision refused any of it | 7.5 |
| a wolf chasing, a pet heeling, an animal browsing or courting | `speed * 9` **on top of** `followPath` | **16.5** |
| an animal walking home to its pen | nothing on top | 7.5 |
| an animal wandering | `hypot(dx, dy) * 9`, on the delta it asked for | 9 |
| a settler retreating from a threat, off-path | `step * 8` | 8 |

So a goat trotting to a berry bush ran its legs at **2.2×** the ground it covered — worse than the
settler defect the previous round spent itself on, on more bodies, and it was *introduced into the
render* by that round rather than found by it. The same animal walking home to its pen ran
correctly, because that one branch happened not to have the extra line. Two animals side by side,
one pathing and one strayed, disagreed with each other about how legs work.

And "after collision" was not true even for settlers. `followPath` charged the intended step, so a
free settler jammed against a wall kept striding for the twenty-five ticks it takes the stuck
counter to give up the path — the exact bug the previous round fixed in the possessed body while
claiming it was matching `followPath`.

### The fix

**One writer.** `moveWithCollision` advances the stride itself, by `hypot(moved) * PHASE_PER_CELL`,
and it is now the only place in the sim that touches `animPhase` by distance. Every walking thing
in the game already goes through that function — settler, wolf, pet, Picky, the body the player is
driving — so no caller has to remember, and the four call sites that used to remember are deleted.

- The advance is taken **before the unstick**, which can teleport a body up to six cells out of a
  wall raised on top of it. That is a rescue, not a step, and paying stride for it would spin a
  settler's legs the moment somebody finished a roof over their head.
- `PHASE_PER_CELL` is now **exported and imported**, and the mirror in `src/client/gait.ts` is
  gone. Last round justified the copy as sparing a grid re-run; that was the wrong saving, since
  the value it copied was one of four the sim was actually using.
- `fps/controller.ts` stopped advancing the phase by hand. It calls `moveWithCollision`, so it
  already had it.
- The flat per-tick advances in `jobs.ts` **stay**. A settler at a bench covers no ground and still
  has to move; that is a working cadence, a different quantity honestly sharing a field, and the
  renderer reads it under a different activity. A test pins that they are still flat rather than
  that they still exist.

### The grid

`animPhase` is never read by sim logic, so this edit cannot change what a colony does — which is a
claim, and the fingerprint is what turns it into a measurement. Sixty days, past founding, same
sweep as before.

- Fingerprint `4fc79614` → `4e7e7e91`. 39 colonies, 2470s.
- `steward` and `sweep` are **identical to the byte** against the pre-round baseline. Not one
  digit moved: same endings reached, same deaths, same stalls, same day counts.
- Which is the result the round wanted and the only one it would have accepted. Forty-one minutes
  to be told nothing happened is what the difference between *believing* a field is cosmetic and
  *knowing* it costs.

### Before / after

| | before | after |
|---|---|---|
| Rates converting distance to stride | **4 sites, 3 rates, 2 of them stacked** | 1 site, 1 rate |
| Animal pathing to food, a mate, or prey | 16.5 per cell — legs at **2.2×** the ground | 7.5, planted |
| Animal wandering | 9 per cell, on a delta collision had not agreed to | 7.5, on ground covered |
| Settler retreating from a threat | 8 per cell, on intent | 7.5, planted |
| Free settler jammed against a wall | strides on for ~25 ticks | stops with the body |
| `PHASE_PER_CELL` | one literal in the sim, one copy in the client, two other rates ignoring both | exported once, imported everywhere |

### Verified

- `npx tsc --noEmit` clean.
- `npm test` — 1840 passed, 13 skipped, 1184 s. Four new: two in `tests/sim-units.test.ts` that
  drive a body into a wall and assert the stride stops with it, and against the unstick that a
  body lifted out of a wall pays exactly zero; two in `tests/gait.test.ts` that scan every `.ts`
  under `src/sim` and fail if anywhere but `moveWithCollision` turns a distance into a stride.
- `npm run build` — 919.45 kB JS (263.12 kB gzip), 23.76 kB CSS (5.15 kB gzip). Five lines
  deleted and one added, so the bundle came back 0.16 kB smaller than the round before.
- `npm run balance` re-judged the identical grid and returned the identical eight open
  principles, which is what "identical to the byte" has to mean downstream to be worth saying.

### Next target

- **Look at it**, which was the last round's next target too and is now overdue by two rounds.
  Animals in particular: their legs just slowed by more than half, and no eye has been on that.
- The grid clock — sixty days reaches one ending of three — is still the player's call.

---

## 2026-08-12 — The body that kept walking after it had stopped

**Track B: L5 Motion.** Client only. `src/sim/**` is untouched, so the fingerprint keying
`.eval/measurements.json` is intact and the grid still stands.

> **Corrected by the round above it, the same day.** Two sentences below are wrong and they are
> left standing rather than quietly edited. *"the same arithmetic `followPath` does"* was not:
> `followPath` advanced the phase by the step it **intended**, not the ground it got, so a free
> settler jammed against a wall went on striding for up to twenty-five ticks while the possessed
> one correctly stopped. And *"neither of them scrubs"*, of the calf and its dam, was true only
> of the rate this round assumed — the sim was feeding animals at **9 per cell, and 16.5 when
> pathing**, so a wolf's legs came out of this round running at better than twice its ground.
> Both are fixed above; the wrong claims stay here because a round note that edits itself is
> not a record.

### The gap

Every body on the map animates off `Pawn.animPhase`, which the sim advances by the distance a
body *actually travelled after collision* — `followPath` adds `step * 7.5`. That half has always
been honest, and it is the half that makes one settler look the same from both cameras.

Nobody had checked the other half: what the renderer does with that distance. It did not use it.
A rig swung its legs about the hip by a fixed amplitude and the body translated on its own, so
the two agreed only by accident, and they did not agree. A settler's foot reaches
`0.74 · sin(0.62)` = **0.43 cells** either side of the hip, 0.86 across a step, while the body
covers `π / 7.5` = **0.42** over the same half-cycle. The planted foot slid backwards over the
ground by 0.44 cells per step — about the length of the step it had just taken. Eleven cells up
that is invisible. At eye level it is skating, and eye level is half of what this game is.

Two sharper ones turned up underneath it, both in the body the player is *guaranteed* to be
looking at:

- **The possessed settler did not use the sim's rule at all.** `controller.ts` added a flat
  `0.42` per tick — `0.62` running — and added it *after* `moveWithCollision`, on intent rather
  than on ground. Hold W against a wall and the body stood still while its legs sprinted, which
  the manager camera showed as a settler running on the spot. That is not a cosmetic gap, it is
  the one law: **one world, two cameras, never disagree.** The flat number also matched neither
  the walk speed nor the paving bonus, so a possessed settler and a free one on the same stone
  walked at different cadences.
- **The eye bobbed on a wall clock.** `bob += dt * 9`, gated on keys held, so the same wall left
  the view bobbing over a body that was not moving — at a rate that never changed between a walk
  and a run.

### The fix

`src/client/gait.ts`, pure and three.js-free, so it is testable under `environment: 'node'` — the
fourth module to earn that treatment after `pace`, `overlays` and `manifest`. It is one equation:
**a foot stays put when a full swing carries the body exactly as far as the foot reaches.**
`strideCells = 4 · leg · sin(swing)`, and `phaseScale = 2π / (stride · PHASE_PER_CELL)`.

- Both rigs convert distance into their own gait from their own legs. The settler's swing is
  **unchanged** — the amplitude was the readable part and was never the problem; the cadence was.
  So the walk looks the same and the legs run at half the speed, 7.4 steps a second down to 3.6.
- A calf gets a bigger scale than its dam out of the same formula — half the leg, twice the steps
  — and neither of them scrubs. That falls out; it was not written for.
- The possessed body advances its phase by `hypot(moved) * PHASE_PER_CELL`, measured after
  collision. It is now the same arithmetic `followPath` does, so the body you drive and the body
  walking beside it keep one gait.
- The eye bobs on the pawn's own phase, at the rig's amplitude and its two rises per cycle. It
  stops dead when the body is blocked and quickens into a run for nothing. `FpsController.bob`
  and `.moving` are both gone — the state that replaced them already belonged to the pawn.

`PHASE_PER_CELL` is **mirrored, not imported**. The literal is inline in `followPath`, and adding
an `export` to it would edit `src/sim/**`, change the fingerprint and spend a sixty-day grid
re-run to say exactly what the grid already says. A copy is only safe while something fails when
it drifts, so `tests/gait.test.ts` reads `movement.ts` as text and asserts the two still match.

Reading it cost one word elsewhere: `readFileSync` in `src/eval/node.d.ts` was declared as taking a
`string`, and the test hands it a `URL`. Widened to `string | URL`, which is what Node actually
accepts and what `existsSync` two lines below already said. That file is on the fingerprint's
`NOT_THE_SIM` list, so the grid is untouched by it.

### Left alone, deliberately

**The Picky.** Same defect, and it stays. Its legs already end below the floor — pivot 0.124 up,
leg 0.229 long — so there is no contact point to plant; its error is the opposite sign and a
quarter the size (0.09 cells against the settler's 0.44); and its body scale animates to near
zero as it poofs out, so a phase derived from its legs would spin them out while it vanished.

### Before / after

| | before | after |
|---|---|---|
| Settler foot scrub, per step | **0.441 cells** | **0** |
| Settler cadence at walking speed | 7.4 steps/s | 3.6 steps/s |
| Possessed body, phase per cell | 2.5 walking, 2.3 running, less again on paving | 7.5, whatever the ground |
| Possessed body held against a wall | legs sprint, body still | both stop |
| Eye bob | wall clock, gated on keys held | the body's own stride |

### Verified

- `npx tsc --noEmit` — clean, once the `URL` overload above was declared. It was not before: the
  round's first `npm run build` failed on that single line, which is the build gate earning its
  place on this list rather than rubber-stamping it.
- `tests/gait.test.ts` — **11 passed**, new.
- `tests/fps-view.test.ts` — **21 passed** (was 18).
- `npm test` — **1836 passed**, 13 skipped, 96 of 98 files, 850 s. Fourteen of those are new and
  the other 1822 are the ones that had to still be true.
- `npm run build` — exit 0. 919.61 kB JS (263.15 kB gzip), 23.76 kB CSS (5.15 kB gzip). The gait
  module cost **0.16 kB** shipped, and deleted two fields to do it.

**The honest caveat:** this is derived from the rig's geometry and pinned in cells, not looked at.
No browser has been attached this session, so *"it now reads as walking"* is still an inference —
a much better grounded one than the guess it replaces, but the eyes have not been on it. §9pp in
`ACCEPTANCE.md` is that step.

### Next target

- **Look at it.** The whole round argues from arithmetic. One pass at `:5062`, standing in a body
  and walking a settler past, would either confirm it or find the thing the numbers cannot say.
- The grid clock — whether to grow it past sixty days to chase the ship and berths endings — is
  still the player's call and still not a code change.

---

## 2026-08-12 — Two promises that had only ever printed one verdict

**Track A.** Tests only; no behaviour changed and none was meant to.

### The gap

Three round notes in a row have closed with the same line: `every-ending-is-reachable` and
`no-ending-is-free` have no unit tests. Both are `enforced: false`, and on every grid ever run
they report `broken` or `untested` — which is the honest state of the game rather than a fault
in either check. Sixty days reaches one ending of three, and until one lands there is nothing
for the second promise to read.

That is exactly what made them worth testing and easy to keep not testing. **A check that has
only ever printed one verdict has never had its other branch executed.** The `holds` branch of
both, the detail line that names which roads came up short, the floor that separates a colony
which never fell out of the running from one that skipped the whole commitment — none of it had
ever run, anywhere, once. The day the grid's clock grows or a road gets faster is the day both
are read for the first time, in a report nobody is standing over.

### The fix

Eleven cases in `tests/balance-principles.test.ts`, building the grids the sim has not managed
to produce yet.

- **Every road going somewhere** (6) — a thirty-day grid is `untested` and not `broken`, because
  a promise that reported three unreached endings there would be describing the clock and calling
  it the game; a full-length grid whose colonies all died first is `untested` too, and that is
  the failure that looks most like the real one; the three endings **spread across three
  colonies** hold, which is the only shape that can keep this promise, since committing to one
  ending shuts the other two; the broken detail names the unreached roads with the rung anybody
  got furthest to, because *best rung 3 of 4* and *best rung 1 of 4* are two different problems
  wearing the same sentence; a commitment still paying when the clock stopped is not an arrival;
  and it reads `sweep.war` and not `sweep.runs`.
- **An ending costing what it says** (5) — `untested` on a grid with no landing; the slowest
  printed rather than the average, because the interesting colony is the one that lost days in
  the middle; **exactly `ENDING_DAYS` holds**, since a floor is a floor and a `<=` would call the
  best possible run the breach; a landing on the commitment day breaks and is named down to the
  colony; and a landing whose commitment day was never written down is skipped rather than scored
  from day nought — pinned because it is a *silence*, and treating the missing day as zero would
  read as a pass on exactly the records that lost data.

The last point is the one worth arguing with later. Skipping means a promise about endings goes
quiet on a damaged record. The alternative reads worse: the comfortable default is the one that
passes.

### Before / after

Both checks were mutated to prove the cases are load-bearing rather than agreeable:

- `<` → `<=` on the ending's floor — **3 of the 5 fail**, including the boundary case written
  for it.
- `s.war` → `s.runs` on the reachability check — **4 of the 6 fail**, including the one whose
  whole subject is which family gets read.

`src/eval/principles.ts` was restored to `HEAD` after each and verified with `git diff --stat`;
the fingerprint the grid reads is untouched, so `.eval/measurements.json` is still valid.

### Verified

- `npx tsc --noEmit` — clean. Two errors on the way there, both mine and both caught by it
  rather than by the suite: `EndingId` lives in `sim/endings.ts` and not `sim/types.ts`, and the
  eval `Verdict` for a dead colony is `collapsed`, not `wiped`.
- `tests/balance-principles.test.ts` — **75 passed** (was 64).
- `npm test` — **95 of 97 files, 1,822 passed, 13 skipped**, 911.01 s.
- `npm run build` — exit 0, and **byte-identical** to the last round: 919.45 kB JS, 23.76 kB CSS,
  down to the content hash in the filename. That is the result this round wanted. A tests-only
  round that moved the bundle would mean something had been changed that was not meant to be.
- Dual-view honesty: nothing outside `tests/` changed.

### Next target

- **Track B, and it is overdue: L5 Motion.** It is the widest gap between the two cameras and it
  has been named as next in three round notes without being picked up. A settler crossing the
  yard reads fine from above and reads as a slide from eye level.
- The grid clock is still the open product question — sixty days reaches one ending of three.
  Growing it to ~120 is the user's call, and the two promises above are now instrumented well
  enough that the day it changes, the report says so on its own.

---

## 2026-08-12 — The card knew how many, and not who

**Track A.** Stage 5c, the last piece of the endgame plan.

### The gap

`ENDGAME.md` has carried the same paragraph since it was written, under a heading that says
*the one thing to build now for the sequel*: when a colony reaches an ending, write out who
left — names, skills, traits, gear, injuries, who was married to whom, who is buried back in
the valley and did not come. **It is cheap to emit at stage 5 and expensive to reconstruct
afterward from a save that never recorded it.**

Nothing was emitting it. `EndingRecord` froze the day, the standing count and a copy of
`world.stats` — how many settlers saw it through, and not one of their names. That is a
one-way door and it was standing open: `world.pawns` drops an unburied corpse at `ROT_TICKS`,
skills move every day the colony works, and a settler shot a fortnight after the ship sails
looks in a save exactly like a settler who boarded wounded. A save written today and read by
anything later can answer *eight* and can never answer *which eight*.

### The fix

`takeManifest` runs on the landing tick, beside the tally, and freezes with it.

- `src/sim/types.ts` — `EndingRecord.manifest?: ManifestEntry[]`, **beside** `stats` and not
  inside it, because a test pins that tally as a bag of numbers and a shallow copy is only
  honest while it stays flat. `ManifestEntry` is every settler the colony still had a body for:
  `id`, name, fate, every skill they had a level in, traits, weapon, apparel, gear, how much of
  them was missing, and the partner they came here with.
- `src/sim/endings.ts` — `takeRecord` split into `takeTally` and `takeManifest`. Three fates:
  `left` (the ship and the berths take the colony off the map), `held` (the dominion is the one
  you win by staying), `lost` (everyone the colony buried and everyone it never got to bury).
  Skills are floored, because a level is what a level means everywhere else in the game and
  `4.83` would put settlers on the roll at *cooking 0*.
- **New** `src/client/manifest.ts` — the record is complete on purpose and a card is not, so
  the trimming is a decision with an opinion in it: two headings, three skills, one soft line.
  It returns rows rather than HTML; `hud.ts` gets the tags and the escaping and nothing else.
  Its own module for the reason `pace.ts` and `overlays.ts` are theirs.
- `src/client/ui/hud.ts` + `ui/style.css` — the roll under the final tally, name over trade
  over notes, on a card that already scrolls.

Two decisions worth naming because a later reader will want to undo them:

**A record written before the manifest existed reports a tally and no roll, and
`endingRecord` refuses to fill it in.** The fallback for a stale *number* is fine — a number
has drifted. A roll read twenty days late is a *different list of people*: settlers on it who
walked in after the ship sailed, missing the ones who were on board. There is no honest way to
answer *who left* out of a world that has moved, so it does not answer.

**The partner is read off `world.partners` raw, not through `partnerOf`.** That function
answers *do they have somebody now* and so returns null for the one who is left — right for the
inspector, wrong here. Somebody walking onto a ship alone who did not board it alone is the one
line on this card worth reading twice.

### Before / after

- **PLAYTEST 9oo — "Read the roll"** (new, follows 9nn). Before: the ending card ended at
  *Settlers lost: 2*. After: two headings and every name under them, and two checks that cost
  something — a settler whose partner is buried, and a fortnight of play after the landing that
  must not move a single row.
- **`tests/endings.test.ts`** (+10, 24 → 34) — the roll holds the dead and drops the
  prisoners; ship and moor file their people differently; a buried partner is still named;
  whole levels only, best first; frozen on the landing tick; copies and not a window onto the
  pawns; through a save and back; and a record written without a roll does not grow one.
- **`tests/manifest.test.ts`** (new, 10) — what the card is allowed to say. The dead in their
  own list under the living, the fate in the heading rather than in every row, three skills and
  the rest left in the record, an empty line for somebody with no trade rather than an invented
  judgement, wounds on the living and silence on the dead, and a trait a later build no longer
  has costing that settler one word instead of the card.
- **`tests/architecture.test.ts`** — one new rule, *"asks one module who goes on the ending
  card"*: `hud.ts` imports `../manifest`, calls `manifestSections`, and never reads
  `.manifest?.` itself.

### Verified

- `npx tsc --noEmit` — clean.
- `npm test` — **95 of 97 files, 1,811 passed, 13 skipped**, 818.31 s. Twenty-one of those are
  this round's, and the run was taken after the last edit and not beside it: an earlier pass was
  killed mid-flight when the de-gendering sweep was still going, because a suite that predates a
  line is not evidence about it.
- `npm run build` — exit 0. 919.45 kB JS (263.04 kB gzip), 23.76 kB CSS (5.15 kB gzip). The
  manifest cost **1.60 kB of JS and 0.35 kB of CSS**. Almost all of that JS is `endings.ts`: the
  card's half is one `map` over rows, and the sim's half is the part that has to walk every pawn
  and copy them.
- Dual-view honesty: the sim half writes a plain-JSON list and imports nothing new; the client
  half is a pure function over that list. Neither camera can show a different roll, because
  there is one roll and it stopped moving on the tick it was written.

### Next target

- Track B, still unclaimed: **L5 Motion** is the layer with the widest gap between the two
  cameras. A settler crossing the yard reads fine from above and reads as a slide from eye
  level.
- Still open from stage 5a: `every-ending-is-reachable` and `no-ending-is-free` have no unit
  tests in `tests/balance-principles.test.ts`, while the three road promises and 5b's do.
- The grid still only reaches one ending of three. That is a clock question as much as a
  balance one — sixty days gets the tree to 17 projects of 19 — and growing it to ~120 is the
  user's call, not a code change.

## 2026-08-12 — An overlay in first person was a trap

**Track A.** No Track B this round; the measured gap was not visual mush.

### The gap

The HUD's four overlays — key list, colony-code box, new-colony card, ending — live in one DOM
tree over both views. First person holds the pointer lock. A locked pointer is *no cursor at
all*, so any of the four landing on a possessed body was unanswerable, and one of them lands
without being asked for: the ending card opens on the tick a colony is founded or a ship sails,
whichever camera the player happens to be behind.

Three things were wrong at once, and all three were provable from the source rather than
guessed at:

- `Input` binds `keydown` and `mousemove` to `window`, not to the canvas. `App.step()` had no
  gate on either `fpsFrame()` or `fps.applyTick()`, so **W kept walking the settler and the
  mouse kept turning a head the player could not see**, behind the card.
- `input.releaseLock()` had exactly one caller in the whole client — `exitFps()`
  (`grep -rn releaseLock src/client/`). Nothing handed the pointer back when a card opened, so
  **there was no cursor to press any button with**.
- `globalKeys()` had Escape routes for help, backup and setup, and **none for the ending card**
  — which is the one card the player did not open. The HUD exposed no accessor for it either.

Escape was not a way out on its own: Chrome consumes the keypress that exits a pointer lock, so
the page never sees that keydown. A locked player pressing Escape got a cursor back and the
card stayed exactly where it was.

### The fix

One rule: **while an overlay is up, the body reads no input and the pointer goes back.**

- **New** `src/client/overlays.ts` — `anyOverlayUp`, `bodyMayAct`, `pointerMustBeFree`, and the
  `Overlays` shape. Its own module, importing only a type from `sim/save`, for the reason
  `pace.ts` is its own module: `app.ts` cannot be loaded outside a browser, and a rule about
  who is allowed to move should be provable rather than asserted in a comment.
- `app.ts` — `overlays()` reads the four HUD flags; `step()` gates the per-frame `fpsFrame()`
  and the per-tick `applyTick()` on the same `bodyMayAct` answer and calls `releaseLock()` when
  `pointerMustBeFree`; `globalKeys()` gains an Escape route for the ending card and then stops
  at a guard, so pause, the view swap and every panel key belong to the card while it is up.
  (That last one also fixes a smaller thing nobody had written down: a `p` typed into the
  colony-code box used to open the work tab underneath it.)
- `ui/hud.ts` — `endingOpen` and `closeEnding()`, matching the existing `helpOpen` /
  `backupOpen` / `setupOpen` shape, plus `endingDismissible`. The wipe card refuses to close:
  it has no dismiss button either, because there is no colony behind it to go back to.

The world keeps ticking behind the card. That is deliberate and it is stage 5b's promise — an
ending that stopped the colony would contradict the card that says *keep playing*.

### Before / after

- **PLAYTEST 9nn — "Take a card in a body"** (new, follows 9mm). Land an ending while walking
  in first person. Before: locked mouse, no cursor, W still walking, no Escape. After: the
  pointer comes back on the frame the card opens, the settler stands still, Escape closes it,
  and the *Click to look with the mouse* hint is waiting when it goes.
- **`tests/overlays.test.ts`** (new, 9 tests) — the rule over all sixteen combinations of the
  four overlays: the body has its controls only on an uncovered screen, loses them to any one
  of the four, has none to lose at the desk, and the pointer is handed back on exactly the
  frames the body is not driving.
- **`tests/architecture.test.ts`** — one new rule, *"asks one module who has the hands while a
  card is up"*: `app.ts` imports `./overlays` and mentions both decisions. Pins the wiring,
  which is the half a refactor drops silently.

### Verified

- `npx tsc --noEmit` — clean.
- `npm test` — **94 of 96 files, 1,790 passed, 13 skipped**, 1,477 s. Ten of those are this
  round's, and the run was taken *after* the last edit rather than beside it: an earlier pass
  that started before the `syncHud` change was discarded as the record even though it was green,
  because a suite that predates a line is not evidence about it. ACCEPTANCE.md carries the
  breakdown.
- `npm run build` — exit 0. 917.85 kB JS (262.44 kB gzip), 23.41 kB CSS. The rule cost 1.26 kB
  of JS and nothing at all in CSS, which is the right price for a thing that only decides who
  reads the keyboard.
- `npm run measure -- --days 60 --past-founding` then `npm run balance` — 39 colonies in
  2,847 s, 4 green. Not this round's work, but it is the first grid that could read stage 5b's
  two promises and both came back green, so the docs stopped deferring them.
- Dual-view honesty: nothing in `sim/` was touched. The rule reads `ViewMode` and two booleans;
  it cannot desync a view from the world because it never looks at the world.

### Next target

- **Stage 5c, the manifest** — who actually left, by name. `EndingRecord` is the hook, and the
  ending card is the place it belongs.
- Track B, when a round is free for it: **L5 Motion** is the layer with the widest gap between
  the two cameras. A settler crossing the yard reads fine from above and reads as a slide from
  eye level.
- Still open from stage 5a: `every-ending-is-reachable` and `no-ending-is-free` have no unit
  tests in `tests/balance-principles.test.ts`, while the three road promises and 5b's do.
