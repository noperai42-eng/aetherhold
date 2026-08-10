# The end game

> Status: **stage 0 shipped; stages 1 to 5 are still a plan.** Written 2026-08-06
> against the measurements in [ARCHITECTURE.md](ARCHITECTURE.md) § *What the grid
> found*, and revised 2026-08-08 against the sixty-day grid it asked for. What is
> in `src/` is stage 0 and nothing beyond it — the harness plays past the founding
> and the grid measures a second act. Nothing in stages 1 to 5 is built.
>
> Numbers below come from two different grids and are labelled where they differ.
> The forty-five-day and thirty-day figures are kept where they are the reason a
> decision was made; the sixty-day grid in
> [Costs and risks](#costs-and-risks-stated-plainly) is the current reading and
> wins any disagreement.

*The other four documents:* [README.md](README.md) is what the game is and how each
system works, [ARCHITECTURE.md](ARCHITECTURE.md) is how the code is laid out and why,
[PLAYTEST.md](PLAYTEST.md) is the browser tour, and [ACCEPTANCE.md](ACCEPTANCE.md) is what
the build promised and which test holds each promise down.

## Contents

- [The problem, in numbers](#the-problem-in-numbers) — why a run is over on day
  twenty-five, and what the measurements say is missing
- [What the founding becomes](#what-the-founding-becomes) — the charter as Act One
  rather than the end
- [The three roads](#the-three-roads) — economy, science, warfare
- [The substrate: the world beyond the valley](#the-substrate-the-world-beyond-the-valley)
  — what all three roads need underneath them
- [The order of work](#the-order-of-work) — six stages, each with the principle that
  proves it
- [The one thing to build now for the sequel](#the-one-thing-to-build-now-for-the-sequel)
- [Costs and risks, stated plainly](#costs-and-risks-stated-plainly) — including the
  two balance principles still open

## The problem, in numbers

The game is over about twenty-five days in, and it is over for a duller reason
than losing.

The research tree holds fifteen projects worth 249,000 points, and the pedlar in
`trade.ts` exists because a colony runs out of them. Played out to sixty days,
the last project lands on **day 37** on the quiet valley, and on day 43, 45 or 56
on the seeds that take longer. The founding lands well before it — day 23 to 40
across the five quiet-valley maps of the unattended sixty-day grid, day 23, 26
and 29 on the three settler maps that get there at all.
And it lands with enormous headroom.
Sampling every twenty ticks across a forty-five-day run, the colony peaks at
9–15 research against a bar of 6, 26–41 days of food against a bar of 12, three
or four turrets against a bar of 2. Four of the five charters are cleared
without the player ever having aimed at them.

Only one of them ever actually resists: `ally`, thirty points of standing with a
neighbour. Across nine **forty-five-day** runs — three per setting, the sample
this brief was written from — the quiet valley
founded three times out of three, settler twice out of three, and hard country
never. Of the four failures, **`ally` was the missing charter in three**, and in
two of those it was stuck on exactly 24 out of 30. (The sixty-day grid moves the
counts and not the diagnosis: see
[Costs and risks](#costs-and-risks-stated-plainly).)

Twenty-four is not a coincidence. `RELATIONS_PER_VISIT` is 6, so 24 is *four
round trips*, and the bar sits just past it. What actually decides a founding, on
the settings where a founding is in doubt, is whether the colony could afford to
have a settler away on the road a fifth time — and hard country, which needs every
pair of hands on the wall, cannot. Not a knowledge problem, not a food problem: a
question about the road.

That is the charter that decides the game, and it is the only one that reaches off
the map.

That is the whole design brief sitting in the data. **The parts of this game that
are still a question on day twenty-five are the parts that are not in the
valley.** Everything inside the fence — the wall, the kitchen, the bench, the
turrets — is a solved problem by then.

And the flatline that follows is measurable rather than a matter of taste — but it
is not the same flatline on every setting, and that turns out to be the most
important thing the long runs have to say. Four colonies played the full sixty
days, past the founding rather than stopping at it. This is the **probe that
argued for stage 0**, run before the grid could play past a founding at all — its
last three columns are the only place any of them are measured, and they are why
this document exists. Its founding column has since been superseded: the
unattended sixty-day grid in
[Costs and risks](#costs-and-risks-stated-plainly) is the current reading and
disagrees with it on every row.

| run | founding | tree emptied | days with nothing to choose | steel at d40 → d60 |
| --- | --- | --- | --- | --- |
| calm / 20260729 | day 25 | day 37 | 23 | 1033 → **1367** |
| settler / 20260729 | day 57 | day 43 | 17 | 700 → 687 |
| settler / 1312 | day 28 | day 45 | 15 | 355 → **243** |
| harsh / 20260729 | day 51 | day 56 | 4 | **0** → **0** |

Three findings, and two of them contradict what the thirty-day grid appeared to
say.

**The game is winnable on every setting; thirty days was just too short to see
it.** The thirty-day grid reported hard country founding zero times out of five
and that reads like a difficulty wall. It is a clock. Given sixty days, harsh
founds — on one seed of five, on day 49, with the settler seed that failed at
forty-five getting there too. Both were
blocked the whole time on `ally`, and both eventually walked enough caravans
to clear it. Hard country is not unwinnable. It is *slow*, which is a different
problem with a different fix — and one seed in five is slow enough that the
[Costs and risks](#costs-and-risks-stated-plainly) section calls it a problem in
its own right rather than a milder version of this one.

**The empty tree is a quiet-valley problem.** Twenty-three dead days on calm,
fifteen to seventeen on settler, and four on harsh — where the colony is too busy
being attacked to research quickly and the tree lasts nearly the whole run. The
content hole is real, and it is deepest exactly where the game is gentlest.

**The idle surplus is a quiet-valley problem too, and this one is a trap.** On
calm, steel climbs monotonically to 1,367 — a fivefold pile no decision consumes,
which is the observation this plan was reaching for. On settler it peaks and comes
back down. On hard country it hits **zero at day forty and zero again at day
sixty**. There is no surplus on harsh; there is a shortage.

That last one is a design constraint discovered before it could do damage. Stage 2
below wants to gate a third research tier on materials, on the reasoning that this
is where the idle steel goes. **On hard country there is no idle steel, so a
fixed material gate would be a pleasant sink on calm and an impassable wall on
harsh** — the exact failure the difficulty harness exists to catch. Any material
cost in the end game has to be denominated in something that scales with the
setting, or measured on all three before it ships.

So the end game is not a harder wave. It is what happens when the colony stops
being a survival problem and becomes something that acts on a world.

## What the founding becomes

The five charters stay exactly as they are, and stop being the ending. They
become the end of the first act: the moment the colony is *established* — fed,
walled, literate, and known to somebody over the ridge — and the moment three
long roads open that were not available to a settlement still worried about
winter.

This is nearly free to do, because `victory.ts` already refuses to set
`world.gameOver` when the founding lands — winning is "a headline, a card and a
tally, and then the colony carries on being a colony". The fiction is already
right. What is wrong is that there is nothing on the other side of it, and that
the evaluation harness stops looking: `run.ts` breaks its loop on `hasWon` and
reports `thriving`, so every measurement this project has ever taken is blind
past day twenty-five. Nothing else here can be proved until that changes, which
is why it is the first thing built.

## The three roads

Three ways to spend the next fifty days, three endings, and — deliberately — only
two of them are about leaving.

| Road | What it accumulates | The ending it buys |
| --- | --- | --- |
| **Science** | Knowledge, then an industrial base, then aerospace | **You build the ship.** The colony leaves the planet on something it made. |
| **Economy** | Wealth and standing, across the whole world and not just the near ridge | **You buy the berths.** Somebody else's ship, your passage, paid for. |
| **Warfare** | Territory — holdings taken and held | **You put others in space.** You never leave. You became the civilization that launches. |

The third ending is the one worth protecting in review, because it is the only
one where the colony stays, and three endings that are all "and then you left"
would be one ending printed three times. It is also the one that makes "take over
the whole world" mean something other than a longer raid.

None of the three can be reached from inside the valley, and that is the point.

## The substrate: the world beyond the valley

The thing that makes all three roads possible mostly exists already, and it is
not the map.

`settlements.ts` gives four named places, each with a bearing out of the yard, a
distance measured in days of walking, a surplus, a shortage, a craft they are
known for, and a standing from −100 to +100. A caravan is a settler genuinely
lifted off the map — taking no jobs, eating no meals, gone for days — carrying a
pack out and a pack back. `commissions.ts` lets those places write and ask for
something. Every quote in both systems prices off one table below a rate cap, so
no sequence of deals anywhere makes steel out of steel.

It is also already built to grow. There are eight names in `NEIGHBOUR_NAMES` and
`NEIGHBOUR_COUNT` draws four of them; `DISTANCES` is the flat list `[1, 2, 2, 3]`;
and `craftFor` hands a place a workshop automatically when a new recipe appears in
`crafting.ts`, so the neighbours learn trades without anybody editing that file.
Most importantly `RATE_CRAFT_OUTPUT` already pays a premium for bringing a town
something it cannot make for itself — the existing, tested reason to put somebody
on a bench rather than sell the raw material. That is the crafting hook the end
game needs, and it is load-bearing today.

So: four places wide, everything one to three days out. Everything the end game
needs is what happens when that becomes twelve places arranged in depth.

**Distance is already the cost model, so distance becomes the gate.** Arrange the
world in rings: today's four are the near ring, one to three days out, selling
what a valley sells. A middle ring around five days out holds the workshops. A far
ring nine days out holds the things a spaceship is made of, and cannot be reached
at all by a colony that cannot keep a party alive on the road that long. Reaching
the far ring is a capability the player builds toward — provisions, escorts,
standing with a nearer place to pass through — not a number that ticks up.

And that is how this game gets "other maps" without a second renderer: **the road
is the other map.** A party eight days out is eight days of raids the colony
takes short-handed, and "who do we send, with what, and what do we do while they
are gone" is a strategic question the valley has never once asked.

Staged, that is:

- **A. More places, in rings, with the far ones locked behind range.** Pure data
  and existing code paths. No new rendering at all.
- **B. A world screen that draws them.** The data is already polar — bearing plus
  days is a position — so this is a view over state that exists, not a new
  simulation.
- **C. Landing the party on a playable second map.** *Deferred, and possibly
  forever.* This is where projects like this one die: a second renderer, second
  pathing, second save format, doubling the surface area while proving nothing
  about whether the end game is any good. A and B deliver the feeling; C is a
  sequel's problem.

## The order of work

Each stage ships on its own and each is proved by a principle the balance grid
enforces, in the same way the difficulty axes were. The principle is written
before the feature, because a promise nothing measures is not a promise.

**0 — The founding becomes Act One.** Stop `run.ts` breaking its loop on
`hasWon`; let the harness play past the founding. Announce what opens rather than
what ended.
*Principle:* `the-game-does-not-end-at-the-founding` — a sixty-day run reaches
day sixty and the last thirty days are not all identical.

*Shipped, and holding.* `runColony` takes `playPastFounding`, records
`foundedOn`, and stops only for the clock or a wipe; `npm run measure --
--past-founding` plays the grid that way and the principle reads it. Off by
default, because a run that plays on is a different run and every difficulty
number was calibrated on grids that stopped. Measured on a sixty-day grid: nine
of fifteen runs founded, earliest on day 23, and every one of them played its
full sixty days.

*What the second act turned out to contain.* Between day 30 and day 60 the
quiet-valley and settler colonies roughly double — seven or eight settlers become
twelve to fourteen — and the fighting quadruples. So the days after the charter
were never empty; nothing was looking at them. The exception is the escalation
ladder, below.

*Deferred, not dropped:* the second half — *the last thirty days are not all
identical*. The principle can only see `RunMeasure`, which is end-of-run scalars,
so it can prove the days were played but not that anything happened in them. That
needs per-day columns carried out of the run, and the honest place to add them is
stage 2, when there is finally something for a late day to differ by. Until then
the check is the weaker one, and it says so.

**1 — The road gets longer.** Four settlements become roughly twelve across three
rings. Tiered goods, range as a real constraint, the far ring genuinely out of
reach at the start.
*Principle:* `the-far-ring-is-earned` — unreachable in week one, reachable by week
six. And the existing no-arbitrage invariant survives the new places untouched;
that test does not get to be relaxed.

*Shipped, and holding.* Measured on the same sixty-day grid: the far ring was shut
for all fifteen runs through day 7, and 3 of the 10 runs below Hard country had it
open by day 42 — the earliest on day 17. Unreachable in week one, reachable by week
six, which is exactly the promise. It is also a pass with no room in it: seven of
those ten never got there, and Hard country is excluded from the second half of the
check because a colony fighting for its life is not owed a trade route. If the
third tier of the tree is going to want far-ring goods, that seven wants to come
down first — otherwise stage 2 gates content behind a road most runs never walk.

*What the longer road turned out to be.* Twelve settlements in three rings of
four, one per quarter of the
compass, each ring turned a little against the one inside it so the far country
reads as being behind the near country rather than hidden under it. The near ring
is one to three days out and sells whatever it is sitting on; the middle ring is
five or six days out and sells what somebody made; the far ring is nine or ten
days out and deals only in steel and medicine, the two things dense enough to be
worth carrying that far. `withinRange` is the entire gate, and it refuses in
sentences rather than booleans: somebody one ring in has to vouch for you
(`PASSAGE_RELATIONS = 18`, which is three visits), the pantry has to hold the
meals the road eats there and back, and enough settlers have to stay behind to
hold the valley. `ringOpen` is what the principle reads, latched once per day in
`run.ts`.

*What "pure data and existing code paths" turned out to cost.* Two numbers that
are not data. `RING_PACK = [1, 2, 4]` scales the pack with the ring, because a
nine-day road carrying a near-ring pack is a fortnight spent to move one crate and
no player would ever walk it twice; `PACK_CEILING` follows from it, so the foreman
measures what it can spare against the biggest pack on the board rather than the
smallest. And `GATE_BONUS = 2` in `pickDestination` makes a trip that is also what
opens the ring behind it count double while the vouch is still owed — a cliff, not
a slope, so the moment a place vouches the reason to keep walking there is gone.
Without it the near ring's throughput advantage runs to a little under two and the
colony never once walks outward on its own.

*And two livelocks, both found by writing the test.* A commission is worth three
visits' standing and outranks an ordinary surplus run, which is right — but a
letter from a place the colony cannot reach would then hold the one commission
slot for its whole fortnight while the foreman declined to trade at all. So
`pickRequest` will not write from an unreachable place, and — separately, because
a letter runs a fortnight and that is long enough for the pantry to fall or the
escort to be buried — a letter that has *gone* stale falls through to the ordinary
surplus run and lapses, which is what `answerable` already promised for a letter
the colony merely could not afford. A colony that answers being asked a favour by
refusing to trade for two weeks has been made poorer by having been asked.

*Not there yet:* the autonomous foreman does not choose a far-ring destination
even once the map is open. Near-ring throughput genuinely wins, at four packs and
at the gate bonus both. The far ring is reachable, player-selectable and
commission-eligible, which is what this stage promised; a foreman that walks it
unprompted is a scoring change rather than a gate change, and it belongs with
stage 2, when there is finally something out there that only the far ring sells.

**2 — The tree grows a third tier: the industrial base.** Projects past
`plateworks` that cost *materials* as well as points — components, then
assemblies — gated on goods only the middle and far rings sell. On the quiet
valley this is where the idle steel goes.
*Principle:* `the-tree-is-not-empty-at-day-sixty`, and `the-surplus-finds-a-buyer`
— the steel stock stops climbing monotonically forever.
*Constraint, from the long runs:* the material cost cannot be a constant. Hard
country reaches day sixty holding zero steel while the quiet valley holds 1,367,
so any fixed gate is a sink on one setting and a wall on another. Either it is
denominated in something that scales with the setting, or the third tier is
proved on all three before it ships. This is the one place in the plan where the
difficulty work already done is load-bearing rather than merely adjacent.

**3 — The three roads get ladders the player can see.** A visible tally per road,
built on `objectives.ts` and `alerts.ts`, which already do this kind of work. No
new simulation; this is the stage that makes the previous two legible.

**4 — Warfare becomes a road.** Off-map campaigning: a war party sent to a
hostile holding, resolved, then held. Held holdings feed the colony. Most new
machinery of anything here, which is why it comes last of the three — it needs
the world layer to be solid underneath it.

**5 — The three endings.** Ship, passage, dominion. Each is a long and expensive
terminal that reads one road's tally, and each writes a real ending.

## The one thing to build now for the sequel

If there is ever a second game that takes these colonists into space, the single
piece worth building today is the **manifest**: when a colony reaches an ending,
write out who left — names, skills, traits, gear, injuries, who was married to
whom, who is buried back in the valley and did not come.

It is cheap to emit at stage 5 and expensive to reconstruct afterward from a save
that never recorded it. Everything else about that game is that game's problem.

## Costs and risks, stated plainly

- ~~**The grid gets slower.**~~ **Solved before anything else, because it gated
  everything else.** The grid was split into a slow half and a fast one:
  `npm run measure` plays the colonies across worker threads and writes
  `.eval/measurements.json`, `npm run balance` judges that file in nine
  milliseconds. The thirty-day grid went from roughly thirty-five minutes to
  **585 seconds** on eight workers, and — the part that actually matters — the
  judging left the slow path entirely, so tuning a threshold no longer costs a
  colony. Sixty-day colonies are now about twenty minutes rather than ninety.
  The speed came only from playing the same ticks at once; nothing about the sim
  was made cheaper, because a faster grid that measures a different game is not
  a grid. The one new failure mode — judging old numbers against new code — is
  closed by a fingerprint over `src/sim` and `src/eval` taken before the first
  colony and re-checked after the last, refused rather than saved on a mismatch.
  See `ARCHITECTURE.md` → "Measured once, judged in milliseconds".
- **Two known-broken principles are still open.** `nobody-starves-beside-a-full-pantry`
  hits 6 of 15 runs on the thirty-day grid and the same 6 of 15 on the sixty-day
  one, and twice the clock does not make it worse. On the sixty-day grid those six
  are one calm map (1312, bottoming out at 0.02 with nineteen days of food in
  store), one settler map (424242, at 0.00 with sixteen days), and four of the five
  harsh maps. The fifth harsh map is not on the list for the worst possible reason:
  20260729 is the colony that collapsed on day 52, and a settler who starves beside
  an *empty* larder is a different failure that this principle correctly declines to
  count. `the-escalation-ladder-is-climbable-to-the-top` is settled by the full
  sixty-day grid, and not in its favour: the highest rung reached anywhere was 3
  of 4, on one calm map.

  The mechanism, which is more useful than the number. `escalation()` is
  `floor(unbloodied / 3)` capped at 4, and `unbloodied` resets to zero when a raid
  leaves anyone *hurt* — not killed, hurt. The top rung therefore costs twelve
  consecutive raids in which nobody takes a scratch, and difficulty squeezes that
  from both ends at once: the quiet valley only fires about fifteen threats in
  sixty days, so the streak cannot accrue fast enough, while hard country takes
  109 trips to a sick bed and resets almost every fight. **Harsh reads rung 0 on
  all five maps for all sixty days** — the setting that most needs a reason to
  keep playing is the one shown none of the escalation prose. Rungs 3 and 4 are
  not "hard to reach"; on this evidence the ladder is a road only the easy
  settings can walk, and it is the natural place a longer game would have got its
  late-game escalation from.
- **Hard country does not reach the second act at all, which is worse than being
  slow.** On the sixty-day grid, unattended: the quiet valley founds on all five
  maps (day 23 to 40), settler on three of five (day 23, 26, 29), and hard country
  on **one of five, on day 49** — the other four are still in the first act when
  the clock runs out, and the fifth colony is dead by day 52. So the hardest
  setting spends its whole run before the charter. Whatever the end game turns out
  to be, hard country will reach it last and with the least, so it is the setting
  that decides whether the second half is actually playable — and the one most
  likely to be measured last and discovered broken.
- **Scope.** This is five or six substantial segments, each comparable to the
  whole difficulty system. It is a second half of a game, and it should be
  planned as one rather than discovered halfway through.
