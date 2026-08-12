# The end game

> Status: **stages 0 to 4 shipped, and 5a and 5b with them; 5c is still a plan.**
> Written 2026-08-06 against the measurements in [ARCHITECTURE.md](ARCHITECTURE.md)
> § *What the grid found*, revised 2026-08-08 against the sixty-day grid it asked
> for, and again 2026-08-12 against the grid that first reached an ending. What is
> in `src/` is the harness, the far country in rings, the third tier of the tree,
> the three visible roads, the war road out to the holdings, the terminal at
> the top of each road — commit, pay, land — and the ending itself: the record it
> writes, the card it shows, and the fourth verdict the instrument reads it by. What
> is not built is the *manifest*: who actually left, by name.
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
  four balance findings still open

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
six. And, added after the first grid caught the difference, `the-long-road-is-walked`
— most colonies below Hard country actually send parties past the near ring, twice,
which is what a vouch costs. The first measures permission and the second measures
traffic, and they are two principles rather than one clause because the grid found
them disagreeing. And the existing no-arbitrage invariant survives the new places
untouched; that test does not get to be relaxed.

*Shipped, and holding.* Measured on the sixty-day grid: the far ring is shut for all
fifteen runs through day 7, and 5 of the 10 runs below Hard country have it open by
day 42 — the earliest on day 17, and a sixth on day 44. Unreachable in week one,
reachable by week six, which is exactly the promise. Hard country is excluded from
the second half of the check because a colony fighting for its life is not owed a
trade route.

It was 3 of 10 when the stage first shipped, and getting it to half took two fixes
and one retracted theory. The rest of this section is that, because the shape of the
mistake is more use than the numbers.

*The traffic fix, and what it did and did not buy.* Raising `GATE_BONUS` from two
to five doubled middle-ring traffic: mean trips by ring went from about 9.4/1.5/0.1
to 5.2/2.9/0.1 below Hard country, and `the-long-road-is-walked` went from a
would-be 5 of 10 to 10 of 10. Every gentle colony now walks the middle road twice.
And `the-far-ring-is-earned` did not move at all — still 3 of 10 by day 42.

That is not a failed fix, it is a second bug the first one was hiding. The colony now
walks the middle road, and the middle road robbed it. `mishapChance` was
`0.06 × days`, floored at 1% and capped at 30%, and the cap is the whole story: a
five-day road computes 0.30 and a six-day one 0.36, so **both middle-ring roads sit
exactly at the cap, and so does every far-ring road.** Distance stops pricing risk at
precisely the distance where the ring structure begins. The cap was written for the
far country — "capped so the worst one is still worth considering" — and it caught
the middle country by accident.

A robbed party turns back on the outbound leg with `take = null` and earns no
standing, and `tripsByRing` counts departures. So a trip is not a visit. Against a
capped 30% less a point or two for the traveller's shooting, two middle-ring trips
both arriving is about 0.72², a hair over half — and a vouch costs two. That is a
better model of the grid than anything about routing: the five runs that sent two
parties opened the far country once, the five that sent three or four opened it four
times, `settler/99001` being the one that sent four and was unlucky four times.

Which also disposes of the first theory, which was that the trips scattered across
different towns and no household ever reached eighteen. A five-seed walk with the
cargo rotating between four goods says otherwise: every seed sent every trip to the
same near town and then the same middle town. The gate bonus concentrates by itself.

The next number, then, is not a bigger bonus and not a stickier foreman. It is that
three rings should be three risks: `0.06` per day became `0.035`, which puts the near
country at 4 to 10 per cent, the middle at 18 to 21, and leaves the far ring pinned
to the cap — where the cap was always meant to bind and nowhere else. A test in
`tests/settlements.test.ts` now asserts the three rings are three strictly increasing
risks and that only the far one reaches 0.3, so nothing can quietly flatten them back
together.

That moved it: 3 of 10 to 5 of 10 by day 42, six of ten opening at all, and the
runs that still miss are exactly the cohort the model says should — every one of them
sent two parties past the near ring, and two arrivals against a fifth is 0.64. The
three fixes are worth reading as one lesson each. `GATE_BONUS` was a number sized
against a regime the game is hardly ever in. `mishapChance` was a cap written for one
ring that silently swallowed another. And the scatter theory was a story that fit the
data and was false, which cost a probe to find out and would have cost a mechanism to
believe.

*What is left, and why it stops here.* Half is not most, and the remaining three runs
are not unlucky in a way another constant fixes. Each sent eleven, seven and four
parties to the near ring and two to the middle, and at roughly two days a near round
trip and twelve a middle one that is forty-odd days of a sixty-day run already spent
walking. The colony is not refusing the long road, it is out of calendar. Making that
better means a second party on the road at once, or a foreman that stops running
near-ring errands once the vouch is the only thing worth having — both of which are
mechanisms, not numbers, and neither is stage one's promise. Recorded here so stage 2
knows the ceiling it is building against.

*What the longer road turned out to be.* Twelve settlements in three rings of
four, one per quarter of the
compass, each ring turned a little against the one inside it so the far country
reads as being behind the near country rather than hidden under it. The near ring
is one to three days out and sells whatever it is sitting on; the middle ring is
five or six days out and sells what somebody made; the far ring is nine or ten
days out and deals only in steel and medicine, the two things dense enough to be
worth carrying that far — which is exactly the reason nobody walked out there, and
`assemblies` joins them in stage 2 below. `withinRange` is the entire gate, and it refuses in
sentences rather than booleans: somebody one ring in has to vouch for you
(`PASSAGE_RELATIONS = 18`, which is three near-ring visits or two middle-ring
ones — standing scales with the length of the road that earned it, `RING_STANDING
= [6, 10, 14]`), the pantry has to hold the
meals the road eats there and back, and enough settlers have to stay behind to
hold the valley. `ringOpen` is what the principle reads, latched once per day in
`run.ts`.

*What "pure data and existing code paths" turned out to cost.* Three numbers that
are not data. `RING_PACK = [1, 2, 4]` scales the pack with the ring, because a
nine-day road carrying a near-ring pack is a fortnight spent to move one crate and
no player would ever walk it twice; `PACK_CEILING` follows from it, so the foreman
measures what it can spare against the biggest pack on the board rather than the
smallest. `RING_STANDING = [6, 10, 14]` scales what a visit is worth the same way
and for the same reason, which is what puts the middle ring's vouch inside two
trips rather than three — at three it is thirty-odd days of walking against a
window with forty-two in it. And `GATE_BONUS = 5` in `pickDestination` makes a trip
that is also what opens the ring behind it outrank an ordinary errand while the
vouch is still owed — a cliff, not a slope, so the moment a place vouches the
reason to keep walking there is gone.

*And why that last one is five and not two.* This is the stage's real lesson and
it is a lesson about measurement, not about trade. Two was derived honestly, from
throughput: the near ring turns a pack round about twice as fast as the middle one.
That is true, and it is true only when both roads are carrying a full load. They
almost never are. `carried` is `min(spare, packLimit)`, so a colony has to be
sitting on more than one whole near-ring pack — roughly six hundred and forty meals
against a reserve of a hundred and forty — before the middle ring's double pack is
anything but decoration. Below that both roads carry the same crate, the load falls
out of the comparison entirely, and what is left is bare distance: one day against
five, a factor of three that a bonus of two cannot close.

So the foreman stopped walking outward and no test went red, because the test that
proves it walks outward hands it `PACK_CEILING` — four packs, a fortune. It tested
the rich regime; the game is played in the poor one. What found it was giving the
grid a column for the thing itself: `tripsByRing` counts trade parties by where
they actually went, latched on the tick one leaves, and `spareDays` counts the days
the colony had a crate to spare at all. The first grid to carry them said calm
colonies send eight to fourteen parties over sixty days, sit on spare goods two
days in three, and hand all but about two of those parties to the near ring. Not
too poor to trade and not short of hands — near-sighted.

Five is derived from the constants rather than from feel: a near town at its best
quotes a shade under 0.9 one day out, so about 0.45; a middle-ring town the colony
has never met quotes 0.74 at five days, so it needs 0.74/6 × bonus to clear that,
which wants a little over three and a half. Four is an eleven per cent edge, and
eleven per cent is inside the noise of which good happens to be spare that morning
— which is exactly the mistake that came before it, a change that was directionally
right and moved one run in ten. The cliff is what keeps a number this size from
distorting anything: it can only ever buy the two trips that open the road, and it
is gone the moment they are made. `tests/rings.test.ts` now walks the same forward
play at one ordinary pack, and that test fails at a bonus of two — the far ring
never opens in forty trips.

*The measurement lesson, stated plainly, because it will recur.* `ringOpenedOn`
measures permission and reads like traffic. The middle ring came into range on day
five of ten runs out of ten and went almost entirely unvisited, and nothing on the
grid could tell the difference between a road that was open and a road that was
walked. A principle asserted on the first is not a promise about the second.

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

*Both principles are written and both read broken, which is the point of writing
them first.* They went in ahead of the feature so the number the third tier has to
beat was set before anybody knew what it would be, and they are `open` rather than
enforced because a red suite over a feature that does not exist teaches everyone to
ignore a red suite. They become enforced the day the grid says they hold. The grid
they read is the same sixty-day one, with four columns added: `tech` and
`emptyTreeDays` — days spent at a bench with nothing left on it — and `endSteel`
and `steelDrawdown`, the largest the pile ever fell from a high-water mark.

*What they measured, first time out.* **Eleven of the fourteen colonies that played
a full sixty days finished the entire research tree**, and nine of those did it with
a fortnight or more still to play: every quiet-valley map, idle for 21 to 26 days,
and four of the five settler maps, idle for 15 to 17. Hard country is the only
setting where the tree is still a tree at day sixty, and only because three of its
five maps never got a settler to the bench for long enough. The second tier is
about five weeks of content on a map that can afford to research, and the grid
has now said so in a column rather than in a paragraph.

The steel column says something narrower than it first looks, and the difference
matters for what the fix has to be. Four of the ten runs that ended rich never
spent the pile down by the quarter the check asks for — but the reason is not that
nothing buys steel. **The largest fall is roughly constant at 183 to 362 whatever
the pile is**, on maps ending between 369 and 1,337. Something does spend steel,
in one spree, once: a defensive build-out is about three hundred. What is missing
is not a buyer, it is a buyer whose appetite grows with the stock. The share test
duly passes the calm maps that happened to have their spree late and fails the ones
that had it early, which is the check being conservative rather than wrong — the
honest reading of the row is that all ten rich runs end holding a pile nothing
wants, and the threshold was set before the data arrived and is staying where it is.

*Constraint, from the long runs:* the material cost cannot be a constant. Hard
country reaches day sixty holding 66 to 210 steel on four of five maps while the
quiet valley holds 888 to 1,337, so any fixed gate is a sink on one setting and a
wall on another — a factor of twenty between the poorest full run and the richest.
Either it is denominated in something that scales with the setting, or the third
tier is proved on all three before it ships. This is the one place in the plan
where the difficulty work already done is load-bearing rather than merely adjacent.

*How the bill answers that constraint.* Four projects — `foundry`, `freighting`,
`instruments`, `waystations` — at 34,000 to 52,000 points each, taking the tree
from fifteen projects and 249,000 points to nineteen and 421,000. Each is billed
in two currencies at once, and the two answer the constraint in different ways.

The steel half (180, 220, 200, 260 — 860 across the tier) *is* a constant, and
deliberately so, because **the thing that scales with the setting is not the
number, it is who is ever shown the number.** The bill is gated behind the points
first: no colony sees a material cost until it has already spent 249,000 points
clearing the two tiers below. On the sixty-day grid that set is not a sample of
the three settings — it is *precisely* the eleven colonies that ran out of tree,
which is to say precisely the ones ending rich. Hard country does not hit a steel
wall at the third tier because hard country never arrives at it; it runs out of
research points nine tiers earlier, and that is the difficulty axis doing its own
job rather than this one borrowing it. A poor colony that *does* arrive has, by
arriving, proved it can afford to.

The components half (12, 18, 22, 28) is not denominated in a stock at all.
Components have no resource patch, no recipe and no bench — the only supply on
the map is a road, and only the middle ring sells them. That half
costs a caravan, and a caravan costs whatever the colony can spare, which is by
definition scaled to what it has. It is the first material in the game whose
price is a *journey*.

The claim that this is not a wall is falsifiable rather than asserted, which is
why the grid grew a fifth new column, `wait`: days the bench spent worked-out and
short. A stalled bench and an empty bench are indistinguishable from `tech` alone,
so without it the grid would happily report the tree fixed while every colony on
it stood still for the opposite reason. It is reported in the detail line of
`the-tree-is-not-empty-at-day-sixty` and asserted on by nothing — a few stalled
days is a colony organising a road trip, which is the tier working as designed.
A run that spends a fortnight short is the wall, and it will say so by name.

*And it did, on the first grid with the tier in it.* Three colonies stood at a
worked-out bench for 13, 18 and 22 days, and three of the five quiet-valley maps
finished at fifteen projects of nineteen having never bought a single component.
The column was written to catch exactly this and caught it on its first outing,
which is the argument for writing the check before the feature in one line.

The cause was arithmetic rather than pace, and it was in this document's own
reasoning. `VALUE.components` was set from a middle-ring road's *limit* — a pack
of three hundred steel, five hundred and seventy of worth, four hundred and
twenty after the quote — and every step of that is true about `packLimit` and
none of it is true about the load. The foreman does not ship a road's limit. He
ships `spareGoods`, which is what is left after `SURPLUS` and then six tenths of
what remains, and a colony arrives at this tier holding about three hundred and
twenty steel. So fifty walks out of the gate, not three hundred. Seventy of
worth, not four hundred and twenty. **Five components against a bill of twelve**,
on a twelve-day round trip, with twenty days left on the clock — sixteen trips
where the design said two. A per-tick probe put it beyond argument: `d40 STALL
needs componentsx12` · `d41 DEPART sells=components give=steelx50` · `d53 PARTS
0 -> 5`. The number was measured against a pack the colony owns at day sixty and
billed against a day it has to pay at day forty.

Re-derived from the load instead of the limit — 5.5, with the pack size restruck
to sixteen to hold the ninety-of-worth rule the table is built on — the same
fifty steel comes home as fifteen parts, and the same probe now reads `d53 PARTS
0 -> 15` · `d53 UNSTALL` · `d53 DONE 16 (foundry)`. One trip, one rung, which is
the pace the tier was written for. What the grid says, run by run:

| run | tree | waiting | end steel | biggest fall |
|---|---|---|---|---|
| calm/20260729 | 17 → 17 | 12 → 12 | 888 → **738** | 374 → **390** |
| calm/7 | 15 → **16** | 17 → **13** | 854 → 1,064 | 228 → **436** |
| calm/99001 | 16 → **18** | 13 → **7** | 1,006 → **468** | 204 → **359** |
| settler/20260729 | 16 → **17** | 9 → **5** | 949 → **512** | 340 → **479** |
| settler/7 | 15 → **16** | 9 → **3** | 433 → **199** | 155 → **297** |

Days waiting on a delivery fell from 8.1 a run to 6.6, the furthest anybody got
went from seventeen projects to eighteen of nineteen, and *the surplus finds a
buyer* came down from three rich runs in ten to two in nine. Both halves of that
last number moved for the right reason rather than by rounding: calm/99001 went
from spending 204 of a 1,006 pile to spending 359 of 468, and settler/7 spent
433 down to 199 — far enough that it is no longer a run that ended rich at all.
That is the pile finding a buyer in the most literal sense the check has.

**Every hard-country row is byte-identical across the two grids**, which is the
constraint at the top of this section answered in data rather than in argument.
A change to what parts cost cannot reach a setting that never arrives at parts.

*What is left, and it is not the price.* Three runs — calm/1312, calm/424242 and
settler/1312 — came back byte-identical too, and a byte-identical row is a proof
of its own: any purchase at all would now resolve to a different number, so those
colonies **never got a delivery home inside sixty days**. They stalled 18, 22 and
13 days on a road, not on a bill. A middle-ring round trip is twelve days, the
tier opens around day forty, and a robbery costs the whole tier because there is
no calendar left for a second attempt. Two of the three are the same seed, and
seed 1312 is also both of the runs still failing the surplus check — one map's
road, not three separate problems.

There is a bootstrap in that worth naming before the next slice starts, because
it is the kind of thing that reads as a balance number until somebody draws the
graph: **`waystations` is the project that lowers the mishap chance on every
road, and it is the last rung of the tier that is gated behind the road.** The
fix for the robberies is sitting on the far side of the robberies.

*What the four projects buy.* An industrial base has to industrialise something,
so each project pays back into a system the colony already runs rather than
adding a fifth one. `foundry` stacks with `machining` to take every recipe to
0.45 of its original input cost — the second multiplier on the same number, so
the tier compounds with the tier below instead of sitting beside it.
`freighting` widens every pack on every road by half again. `instruments` runs
the bench itself half again as fast, which is the project that pays for the rest
of the tier. `waystations` lowers the mishap chance on every road by a flat nine
points, which finally unpins the far ring from the 0.30 it had been fixed at
since the ring work shipped — the answer to the ceiling stage 1 recorded and
could not fix from inside itself.

*How the colony finds the parts.* Left alone, the foreman scored a destination on
`worth / (days + 1)` and nothing else, so an unattended colony would have sold
steel to the best-paying neighbour forever while the last four projects sat at
100% and waited. The first answer was a term in that scoring — a town selling
something the bench is short of scores ×3 — and the arithmetic will not carry it.
Scores go as `worth / (days + 1)`, so a five-day parts town needs a bonus of more
than three just to draw level with a one-day neighbour, and the tie only holds
while the pack is big: `RING_PACK` doubles what a middle-ring road carries, which
is how distance is meant to pay for itself, and a pack sized by a letter is under
the near town's limit too, so the multiplier cancels and the near town wins
outright.

So the errand is not a trade and is not ranked as one. `shoppingRun` picks its
own destination — nearest road that ends at what the bench is short of, price
only as a tiebreak between equals — because a project studied to the last point
is not a good deal to be weighed against other good deals; it is the rest of the
game, stopped, and the only thing that restarts it is a crate from a particular
town. The ×3 survives in `pickDestination` as what it always actually was: a
tiebreak on ordinary trade runs, keyed on the *shortfall*, switching itself off
the moment the crates land and sitting at ×1 for every town on every run that
never reaches the third tier — which is what keeps every sixty-day number
measured before it comparable to the ones after.

Two rules sit under that one. The colony refuses an open letter to make the trip,
which costs standing at a neighbour and is the point: the letter will be posted
again and the tier will not. And the shopping list is the shortfall *minus what
the colony can make for itself*, because a third-tier bill reads a hundred and
eighty steel and twelve components and those are not the same kind of number —
the steel is a week of somebody swinging a pick and the parts are a workshop five
days out. Before that filter, calm/424242 spent days forty and forty-two on two
one-day steel runs while its own mine carried it from a hundred and twenty-nine
steel to four hundred and fifty-five unaided. The filter is a priority and not a
ban: a colony with no ore under it still buys steel, once parts are no longer
outstanding.

*What the guarantee cost, before it was made cheap.* A per-town roll leaves
better than three maps in ten — (3/4)⁴, about 32% — with no parts anywhere on
them, and a colony that walked two vouches out to the workshops only to find four
towns all selling steel has been shut out of the last tier by a coin, with no way
of knowing that is what happened. The obvious fix was to stop rolling the middle
ring and start *dealing* it: a bag holding every kind, shuffled, one to each of
the four. Guaranteed, elegant, and it moved every die after it.

Measured on the sixty-day grid, that cost eight foundings out of fifteen down to
four, and the far gate open on seven maps in ten down to three. A third arm with
the deal on and the need bonus off returned the same four and the same three,
which is what exonerated the bonus and left the deal holding the bill. Nothing
about dealing is worse than rolling — but a different draw order is a different
world, and the fourteen maps in twenty that *already had* a parts town were
re-rolled for nothing. Two thirds of the grid paid a bearing-and-names shuffle to
fix the other third.

So the draw is untouched and only the maps that need it are repaired.
`ensureParts` runs after a ring is drawn, converts the *second* seller of
whatever that ring has most of — with four towns drawing four kinds, a ring
missing components must be doubled up somewhere, which is what keeps it from
taking away the middle country's only medicine — and consumes no randomness at
all. Every seed that could already reach the third tier keeps the exact world it
had; the third of maps that could not get a parts town instead of a shrug. The
same lesson as the near ring's, arrived at from the other side: *the cheapest
guarantee is the one that spends no dice.*

The deal left one thing behind it that outlives it. Halving the foundings was a
regression on the most important number in the first act, and **the whole board
of principles reported HOLDS while it happened** — because
`the-game-does-not-end-at-the-founding` asks only whether the colonies that
founded played on afterwards, never whether anybody founds. A first act half the
colonies never finish is a different game and it was invisible, so
`the-first-act-is-finishable` now measures the rate: at least half the runs below
hard country, floored under a measured seven in ten. Hard country is deliberately
outside it — not founding there is the setting working, and averaging it in would
let a real fall on the kind settings hide behind a number that was always going
to be low. It costs nothing to check, it reads a grid that was already being
measured, and it exists because a promise nothing measures is not a promise.

*The road problem, made legible.* The second slice opened on the failure the
first one uncovered, and the first thing it had to fix was the instrument. `wait`
counts the days a finished bench stood short of materials; it cannot tell
*nobody was sent* from *sent, and robbed*, and the two want opposite fixes. That
mattered immediately, because `the-bench-does-not-wait-on-an-errand` promises the
colony **decides** — "standing still is allowed to cost a road; it is not allowed
to cost a decision nobody made" — and the column it read was charging the road to
the colony's account. calm/424242 chose the foundry on day thirty-six, had a
party out on the fortieth, was robbed, sent it again, and finished on the
fifty-seventh: seventeen stalled days, every one of them somebody walking, and
the check called that a broken promise.

So the column split. `unsent` counts only the days with nobody on the road,
answered by a predicate exported from `settlements.ts` beside the rule it mirrors
so the measure asks the sim rather than reimplementing it, and the bench
principle now reads that against a two-day threshold — a decision, not a journey.
`wait` stays beside it and is reported on every verdict, because the two together
say something neither says alone: a big gap between them is a road problem, and
no gap at all is a decision problem.

The predicate was wrong the first time and the grid said so within one run. It
asked whether the party on the road was out *for the bench*, which is the
question the principle's name suggests and not the one it means. calm/99001
failed on it — four unsent days of seven waiting — and a per-tick probe said why.
A day-boundary sample is no good for this: `caravanAllowed` opens and shuts
several times a day, sleep alone closing it for a third of one, so the probe
counted every tick and blamed the first gate that tripped. Days fifty-four and
fifty-five were shut all day and day fifty-six for nine tenths of it, all for the
same reason — the colony's one spare settler had left on day forty-six for a
ring-1 town, eight days before the bill existed, carrying thirty meals on an
errand that was correct when it was chosen. The column was still charging a road
to the colony's account. It had only stopped charging the bench's.

So the predicate widened to `partyCommitted`: any party the colony has committed,
wherever it went, and both states of a departure rather than one. `world.caravan`
holds a party that has left the map, and before that the settler spends the
better part of an hour walking to the road head with a `caravan` job in hand —
about a sixth of a day in which a colony that has already decided still reads as
undecided, and a day-boundary sample can land in it. `caravanAllowed` refuses on
either for the same reason, which is the argument for the predicate living in
`settlements.ts` beside it rather than in the eval half-knowing a rule the sim
owns.

Widening a measure until a red goes green is how a grid gets talked into lying,
so the case for this one is that the excluded case is provably not the fault
named. A party that walks past an available parts run to sell somewhere else *is*
the fault — and that is forbidden in `jobs.ts` and pinned by nine unit tests in
`tests/rings.test.ts`. What is left, a party sent on a good errand before the
bill existed, is not the colony ignoring the bench; it is the colony having one
settler. And the check still fails things: the day calm/99001 was home, free and
sent nobody is counted and always was, and a colony that sits at home for a week
still reads seven.

It reads two against a threshold of two. That is a pass with no margin, which is
worth writing down rather than smoothing over, along with the fact that the
threshold was not raised to buy room. What the check can no longer say is the
more interesting cost: a party already out is now *invisible* to it rather than
slack against it. That is exactly right while a colony can field one party and
stops being right the moment it can field two — which is the next slice, and the
wording of the principle changes with it.

What `wait` was really seeing then got its own promise, written open and before
the feature that will satisfy it, the same way the tree principle was a tier
early. `one-robbery-does-not-end-the-tier`: a colony that reaches the top of the
free tree and walks for the parts finishes at least one project that costs it.
Six of nine on the grid it was written against — calm/1312, settler/1312 and
harsh/7 all stopped dead on the fifteenth project, the last one the tree gives
away, and the two that were instrumented were both robbed on the first attempt
and never got a second in. Neither hesitated. A ring-1 parts town is five days
out at about one in six, so a colony that could absorb a setback should fail
perhaps one time in thirty; three in nine is not a calendar edge.

The third of those three is not this claim's failure, and the same probe caught
it. harsh/7 reached the top of the free tree on day fifty-eight of sixty, and all
seven of its trips went to the near ring: it never opened a road to a parts town
at all. It did not lose the tier to a robbery — it arrived with two days left and
nowhere to buy. Zero waiting days is what that looks like from outside, and it is
a denominator problem rather than a road one; the claim wants scoping to the
colonies that could actually have bought something. It is left uncorrected on
purpose until the road answer lands, so that the before and the after are read
off the same rule.

*The answer to that came next, and `assemblies` and the far-ring top of the tier
come after it* — in that order, because adding a *longer* road on top of an
unanswered road problem makes it worse before it makes it better. The middle ring
sells the parts; the far ring is still selling nothing that only it sells, which
was the reason stage 1 left the autonomous far-ring walk on the table, and the
shopping run above is the mechanism it will reuse rather than a second one
written for it. Of the three candidates — a second party, a standing order, a
shorter first rung — the last two undo the thing `components` exists to be, the
first material whose supply is a road rather than a patch of map. The second
party is the one that matches the measured failure, which is not "the road is too
long" but "the tier is bought one round trip at a time".

The probe found one thing that party has to be designed around. `stepCaravan`
seeds its own generator from the town's identity and its visit count and then
increments the count, so a town's road luck is a pre-drawn deck and the visit
number is the index into it. A second party does not buy a second chance at a bad
card; it buys draws per day. That is the right thing to buy — the measured
failure is the round-trip rate, not the robbery rate — but nothing about the
robbery rate improves, and a design that quietly expected it to would be
disappointed by a grid saying exactly what it says now.

*Shipped.* The promise first, as the sequencing rule requires:
`the-road-keeps-up-with-the-bench` — no colony that reaches the third tier stands
at a stalled bench for more than **twelve days**. Twelve is two worst-case
near-ring round trips at six days each: one trip that went wrong and one that
went right. It is derived from `RINGS[0].days` rather than fitted to the runs it
would be scored against, and it read **BROKEN on arrival** off the grid that
shipped the slice before it — calm/1312 at 18 stalled days, calm/424242 at 17,
calm/7 at 13, settler/1312 at 13 — which is the whole point of writing the bar
before the feature. A promise that first appears in the same commit as the code
that satisfies it has not been tested by anything.

The colony can field two parties now, on one rule: a road per four settlers,
counting the ones already walking, capped at two. That last clause is not a dial
to grow with the colony — the deck finding above says extra parties buy trips per
day and nothing against robbery, so a third road would be more of a thing that
already works rather than an answer to anything measured.

The rule got there the hard way, and it is the most useful thing this slice
produced. The first cut kept the old shape — a cap of two, plus a headcount floor
charged *per departure* against the people still at home — and both halves looked
obviously safe. `tests/hunting.test.ts` disagreed. Nothing in that file is about
trade; it went red because a colony of five satisfied "four others at home" twice
in a row, on the way from five to four and again from four to three. A per-tick
probe on seed 20260729 confirmed it: two parties on the road by day seven with
three settlers holding the valley, and a colony that spent the following week
hunting to stay fed. The doc comment beside the original rule had predicted that
exact state and called it acceptable. It was not, and no amount of reading the
comment would have found it — an unrelated test did, because the grid measures
day sixty and this fault lived on day one and a half.

The repair is one division where there were two gates
(`min(CARAVAN_PARTIES_MAX, floor(colonySize / CAN_SPARE_ONE))`), and it is
provably identical to the old rule for a colony's *first* road, so nothing about
the readings above stops being comparable. Two costs are owed rather than
claimed: `unsent` gets stricter in the same commit that makes the road faster, so
a rise in it is not evidence the road got worse; and
`the-bench-does-not-wait-on-an-errand` passed its last grid at exactly its
threshold with no margin, on a rule that has now moved underneath it. Both were
written down before the grid ran.

What the road bought, measured: mean trips by ring went from 3.6/3.4/0.1 to
**5.9/4.5/0.4**, `the-first-act-is-finishable` from 6 of 10 foundings to **9 of
10**, and calm/7's stalled wait from 13 days to 7.

*Both owed costs came due on the next grid, and neither in the shape it was
written down.* Two enforced principles went red, and the useful part is that they
went red for opposite reasons — one was the colony's fault and one was the
ruler's.

`the-bench-does-not-wait-on-an-errand` was the ruler. `unsent` was a field on the
daily snapshot, the snapshot fires at the day boundary, and a world starts its
clock at **07:12** — so every reading that column has produced in the history of
this repo was taken at 07:12, which is the one gap in a settler's day: awake, not
yet fed, not yet departed. Attributing settler/1312's twelve samples: nine had
every road already walking, two had a best talker too hungry for `caravanAllowed`
to let out the gate, one was a genuinely idle morning. Permission runs flat zero
from eight to six, because by eight the party has gone. Three days charged where
sixty days of ticks say **0.09** — a thirty-fold overstatement in the same
direction on every seed, which is the signature of a broken instrument rather
than of noise. It now counts ticks and asks `caravanAllowed` itself rather than a
proxy that never asked about food. `A_DECISION` stays at two on purpose: leaving
the threshold still while the instrument under it is replaced is the only honest
way to learn what the old one was worth, and it leaves the principle a regression
guard rather than a live constraint. What the still threshold bought: the same
grid that read up to three days now reads a longest gap of **0.63 days** on
settler/424242 and a mean of **0.09** across the ten runs that reached the tier.
That is the size of the error, read off the principle rather than off a probe.

`the-road-keeps-up-with-the-bench` was the ruler's fault too, and worse, because
the number is in the promise. Twelve days was derived as two ring-0 round trips —
but **ring 0 does not sell components**; the middle ring is the only place in the
world that does, and it is five or six days out, so a parts round trip is ten to
twelve days. Twelve is one trip, not two. The two runs that stayed red spent sixty
days with a road free for 0.05 and 0.01 days respectively: both roads full,
continuously. They were walking, not deciding. So the principle goes
`enforced: false` with the number kept as a yardstick, and the re-derivation is
owed to the slice that changes where parts come from. Re-deriving to twenty-four
now was rejected outright — twenty-four would have been green *before* the second
party as well, and a bar that passes the code it was written to fail has nothing
left to say.

*Shipped: `assemblies`, and the top of the tier moves one ring out.* The promise
first, and this one cost nothing to write, because the columns it reads had been
shipping for three grids and nobody had asked them the question:
`the-far-country-is-walked` — a colony below hard country that opens the far road
with a round trip still on the clock goes out there. Seven runs qualified on the
grid that shipped the slice before this one. **Two walked** — calm/20260729 and
settler/99001, two trips each. Broken on arrival, off measurements that were
already on disk.

It is `the-long-road-is-walked` one ring out, and the difference between them is
the whole diagnosis. The middle ring's traffic problem was permission: the colony
had one party and could not spare it. The far ring's is not. Ten maps in ten
opened that road and nothing was stopping anybody. There was simply **nothing out
there that could not be bought four days nearer** — `RINGS[2].sells` was steel and
medicine, both on offer in the middle ring — so `pickDestination`, which divides
what a pack is worth by how far it has to go, ranked the far country last every
time it was asked, and `shoppingRun`, which takes the nearest road selling what
the bench wants, never had a reason to look past the workshops. The far country
was open, and it was not the answer to any question the colony was asking.

So the fix is a trade good and not a bonus. A far-ring multiplier, a standing
order, a shorter first rung — each would send colonies out there for things they
could get nearer, which is a colony being managed by its scoring function rather
than by its economy. `assemblies` is the one thing the middle country does not
have. `VALUE.assemblies` is **10**, derived the way `components`' 5.5 was and not
fitted: a colony at the top of the tier is sitting on two to three hundred steel,
`spareGoods` ships about a hundred of worth, a quote of roughly 0.8 brings eighty
home, and eighty buys eight units — the `instruments` bill exactly. One load, one
rung.

No new projects. Stage 2 above already says the tier costs *"components, then
assemblies"*, and the literal reading is the surgical one: the top two rungs stop
asking for parts and start asking for machinery. `instruments` is 200 steel and 8
assemblies, `waystations` 260 and 12. An invented fourth tier priced in points was
drafted and thrown away — it would have been unreachable inside sixty days, and a
feature the grid cannot see is a feature that ships unmeasured.

The far ring gets the parts town's guarantee, one ring out: `ensureParts` is now
`ensureSold(ring, kind)`, and ring 2 is repaired the same dice-free way ring 1 is
— convert the *second* seller of whatever the ring has most of. It matters more
out here, not less: three kinds over four towns leaves (2/3)⁴, better than **one
map in five**, with nowhere at all to buy the top of the tree. And because
`settlementsOf` draws the rings outward, ring 2's draw is the seed's last, so
adding a third good to the far ring moves no die in the near or middle country.
That is not a convenience; it is the reason the readings above are still
comparable to the ones below.

One consequence is worth naming rather than discovering: **`waystations` — the
project that makes long roads safer — is now bought with two trips down a long
road.** That is the shape of the whole stage and not an accident of this slice,
but it does mean the last rung is the one a colony is least likely to reach.

This slice also owed the re-derivation the road slice deferred, and it is the same
mistake twice if it is done carelessly. `TWO_ROUND_TRIPS = 12` is gone; the bar is
now `deliveryBar(ring) = roundTripDays(ring) + A_DECISION` — **8, 14, 22** days for
a bill payable in the near, middle and far country. One round trip and a decision,
not two trips: the colony fields two parties now, so the second attempt does not
queue behind the first. The test any re-derivation had to pass is the one the
repo wrote down when it rejected twenty-four — it must still fail the one-party
build — and it does: calm/1312 waited 18 days and calm/424242 17, both on ring-1
bills, against a bar of 14. The grid reads the ring off a new column,
`errandRing`, sampled daily beside `stalled` and folded into `stallRing`; the
`wait` column now says `18@1` rather than `18`. The *instrument* deliberately does
not move in the same slice: `stalledDays` is still the day-sampled total, and the
per-delivery longest stall is owed to the next one. Changing the bar and the ruler
in the same commit is how the `unsent` overstatement stayed invisible for three
grids.

And the denominator fix the earlier block left uncorrected on purpose is now in,
the road answer having landed: `one-robbery-does-not-end-the-tier` counts only the
colonies that were actually asked for something — harsh/7 reached the top of the
free tree on day fifty-eight with nowhere to buy and no bill outstanding, and
scoring that as a colony the tier defeated was always the check blaming the road
for the calendar.

*What it bought, measured.* A fresh sixty-day grid moved
`the-far-country-is-walked` from **2 of 7 to 3 of 7** — still short of the half it
asks for, so the principle stays broken, and the honest thing is to say what the
extra run cost and what it did not fix. What it bought is a clean causal reading,
because the three runs that walked are *exactly* the three whose `stallRing` read
2: calm/20260729 waited twelve days on a machinery bill, calm/7 nine, calm/99001
eight, and each of the three sent two parties past the middle ring. Every colony
that was ever billed machinery went. No colony that was not, went. So the road is
not being refused and the ranking in `pickDestination` is not the problem — what
is short is the number of colonies that climb far enough to be asked. Three of the
four that stayed home never cleared the parts rung at all and finished on 15 of 19
projects; the fourth reached 17 without finishing the study on `instruments`, so
its bill never came due. The remaining gap is upstream of the road, which is a
different slice's problem and now a named one.

The re-derivation is worth reporting the same way. It **changed no verdict on this
grid** — under the old flat bar of 12 the broken set would have been the same two
runs, calm/1312 and calm/424242 — so its value here is correctness rather than a
score. What it changed is what a verdict means: the three colonies waiting 12, 9
and 8 days for machinery are now inside a 22-day bar instead of being counted as
near-misses against a road they were not walking. A bar that had produced a
different set of failures would have been a bar that had been wrong for three
grids; a bar that produces the same set and stops mis-scoring three waits is the
better outcome to have found.

Two more readings, both predicted. `the-tree-is-not-empty-at-day-sixty` holds with
new headroom — the furthest anybody got is now **17 of 19** projects where a grid
ago calm/20260729 finished all nineteen — which is this slice working as intended
rather than a regression: the top two rungs cost a twenty-day road now. And the
escalation ladder went back to a peak of rung 3 of 4 after touching 4 last grid on
a slice that did not go near it, which is the second time that peak has moved on
seed luck and the reason `ACCEPTANCE.md` predicted it would not repeat.

**3 — The three roads get ladders the player can see.** A visible tally per road,
built on `objectives.ts` and `alerts.ts`, which already do this kind of work. No
new simulation; this is the stage that makes the previous two legible.

*Shipped: three ladders of four rungs, read and never stored.* Two promises
first, both written against a `roads.ts` that did not exist yet, and both scored
on the first grid that could see them.
`the-three-roads-are-three-roads` — for every *pair* of roads the grid holds a
colony that is ahead on one and behind on the other. `no-road-is-already-finished`
— a colony that plays its whole sixty days still has road left on all three.

The first of those is the one the stage exists to defend. Three tallies that rise
together are one measurement wearing three hats, and a choice between three
endings whose ladders never disagree is a choice between synonyms. Correlation
would have been the wrong test — colonies that are doing well are doing well at
several things at once — so the check asks for *inversion*, which nothing but
genuinely separate accounting can produce.

The rung is what makes the question askable at all. The three roads count
projects, places and raiders, and no arithmetic across those units means
anything; the rung number is the only comparable quantity the ladders produce.
Its boundaries are derived rather than picked — science steps at `NEED_RESEARCH`,
at the free tree, at the foundry branch, at the whole tree; economy at one place,
`PER_RING`, two rings, `NEIGHBOUR_COUNT`; warfare at `STANDING_BAND` compounding
by `CLEAN_PER_STEP`, which is the storyteller's own patience. (Stage 4 rewired
that last one to count ground held instead; the compounding kill count was the
best reading available in a game where war only happened in the yard, and it
stopped being the best reading the day there was somewhere to march to.) Four
constants had to be exported to make that possible, which is the right price: a
ladder with hand-picked numbers in it is a fourth thing to balance, and it goes
stale silently the first time the tree or the map grows.

The stage's own rule was **no new simulation**, and it held literally: nothing in
the tick changed, nothing was added to the world, and nothing went into the save
envelope. `roads.ts` is two pure functions over state the colony was already
keeping, so a colony saved before the file existed reads its three rungs
correctly the first time it is opened. The obvious build — a `roadProgress`
record the tick advances — was rejected for the reason `alerts.ts` was built the
same way: a stored copy of a derived number is a number that can drift, and
nothing on screen will say which of the two is lying.

The panel is the founding's own panel. Once `hasWon`, `syncGoals` puts the three
roads where the charter checklist was — same rows, same bar, same hint line, with
the ending each road leads to on the row's hover — so a player who learned to
read that corner during the first act does not have to learn a second one for the
second. The warfare road read raiders put down and nothing else — stage 4 puts
ground held above that first rung — which is why a colony that won its founding
without ever being attacked stands at rung 0 on it either way: the road that ends
in taking the ground must not be handed to anybody for surviving quietly.

*What it bought, measured.* One promise held and one broke on arrival, which is
the split the sequencing rule is for. `no-road-is-already-finished` **holds**: of
the fourteen colonies that played a full sixty days, none stood on a top rung and
the furthest anybody got was **rung 3 of 4** — calm/20260729 on science, harsh/7
on warfare. It would have failed the grid before this one, when calm/20260729
emptied the research tree, and it is a promise the next two stages have to keep
paying.

`the-three-roads-are-three-roads` reads **1 of 3 pairs never disagree across 14
runs: economy/warfare never inverts (economy only ever behind)**. Science
disagrees with both of the others and disagrees hard — the per-difficulty means
are calm **2.6/1.0/1.2**, settler **2.2/1.0/2.0**, harsh **0.8/0.6/2.0**, so
science falls and warfare rises as the country gets harder and the difficulty
axis is already sorting colonies onto different roads. The flat pair is the
economy one, and the number underneath it says why: economy stood on **rung 1 in
twelve of the fourteen** runs and rung 0 in the two hardest. Its second rung is
four neighbours at charter standing, the founding asks for exactly one, and
**nothing in the valley asks for a second**. Warfare, meanwhile, is never behind
because raiders arrive whether or not the colony wants a war.

So the broken pair is not a ladder wired to the wrong number; it is the ladder
reporting that one of the three roads does not exist yet. The fix that suggests
itself — re-derive economy's second rung down to two places, so a founded colony
climbs it — is the fitted-bar mistake this file has now rejected twice, and it
would turn a true reading into a green one without a single colony doing anything
differently. The road is supposed to come from stage 4's held holdings and stage
5's bought passage, which means this principle is a **standing bill against the
next two stages** rather than a defect in this one. (Stage 4 part-paid it and moved
both road promises onto a family that can actually climb warfare, so the figures in
this entry are the unmanaged grid's last word on the roads rather than the current
reading. The end of stage 4 has the new one, and it is worse.)

Everything else on the grid is unchanged, and that is this slice's other result.
Fifteen enforced principles hold, the five open failures read exactly the numbers
they read a grid ago — 6 of 15, rung 3 of 4, 3 of 7, 2 of 11, 6 of 9 — and every
column that was there before prints the same figure on the same seed. "No new
simulation" was meant literally, and a grid that moved nothing but the two
columns added to it is the proof.

**4 — Warfare becomes a road.** Off-map campaigning: a war party sent to a
hostile holding, resolved, then held. Held holdings feed the colony. Most new
machinery of anything here, which is why it comes last of the three — it needs
the world layer to be solid underneath it.

*Shipped: three holdings, a party of three, and a road that counts ground.* The
promises first, as the sequencing rule requires, and there are two because the
stage can fail in two unrelated ways.

`no-holding-falls-for-free` — ground is bought with people: every colony that took
a holding paid at least `WAR_PARTY * roundTripDays(0)` pawn-days for it. That is
the cheapest legal war in the game — the smallest party, walking to the nearest
ring, and home again — and it is a *floor* rather than a window, because a
campaign that lost walks the same days and takes nothing. It is counted in
pawn-days and not in campaigns for the reason the instrument keeps learning: a
campaign that resolved on the tick it was ordered, or one that lifted a single
settler out and called them an army, would report one campaign and one holding
and look perfect.

`the-war-is-a-choice` — of the colonies that had the hands, some went and some
stayed home. It breaks in both directions, and the quieter direction is the one
worth the principle: a road every able colony walks is not a road, it is the game.
That is the same shape as `the-three-roads-are-three-roads`, and deliberately so —
the standing bill stage 3 left is not paid by holdings existing, only by colonies
disagreeing about whether to go.

The machinery is one file, `holdings.ts`, and every number in it is bought from a
number that already existed. **How many:** one holding behind each ring,
`NEIGHBOUR_COUNT / PER_RING` — the far country is already three deep and the depth
is already earned, so holdings ride on that map instead of laying a second,
disagreeing one over the top. **How far:** `roundTripDays(ring) / 2` each way, the
caravan's own walk; a war party is not faster than a merchant. **How many go:**
`CAN_SPARE_ONE - 1`, one fewer than the colony must keep at home, so seven on
their feet is the price of admission and the headcount is read off the map rather
than off `colonySize` — what has to be true is that four remain *here*. **What is
waiting:** `garrisonSize(ring)` men rolled out of `raiderBand` at the moment of the
fight, so a garrison scales with difficulty and with the escalation ladder without
this file knowing either exists. **What it pays:** `PACK_MIN * (ring + 1)` of steel
every `roundTripDays(ring)` days, which is about the same steel per day whichever
holding it is. The far one is not richer. What the far one buys is the rung.

The fight is a pure function of the fighters and the dice, and the caller writes
the outcome down. Both sides fire into the man in front with no spillover, which
is what stops three rifles evaporating a garrison of four in one exchange, and the
garrison gets the opening volley because the party is the side crossing open
ground. That volley is most of what makes a holding a hard thing rather than an
arithmetic comparison of two totals — it is also why the near garrison is
deliberately *two* against a party of three: level numbers plus a free volley is a
holding nobody takes, and the first rung of a road has to be reachable.

The warfare ladder was rewired to read ground. It stepped at `STANDING_BAND`
compounding by `CLEAN_PER_STEP` when stage 3 shipped, which was the best available
reading of "how much war has this colony done" in a game where war only happened
in the yard. Now the valley is one rung — the standing band, put down at home —
and each holding is one more, so `ROAD_RUNGS` and `1 + HOLDING_COUNT` are the same
number and a test holds them to it. A colony can kill the Ashbound for sixty days
and stand on rung 1 for all of them: the road that ends in taking the world is
walked by taking some of it.

Two departures, both on purpose and both written into the file.

**Nobody dies off-screen.** `settlements.ts` states the rule and a war is exactly
where a reader expects the exception. A beaten party comes home wrecked — floored
at a quarter of their health, just above `combat.ts`'s downed line, so nobody
arrives already on the floor — and not buried. A settler killed by dice the player
could not watch, on a map they cannot look at, is a story the game has no way to
tell; three settlers ruined for a week is a story it can, and the escalation a win
buys is the rest of the bill. The day there is a screen to watch a battle on, this
is the first rule to revisit.

**The Ashbound do not take a holding back.** Held is held, in this cut. A garrison
that re-forms is a second system — a threat clock, a second front, and a tribute
line that stops without the player being anywhere near it — and it belongs to the
stage that can afford to test it rather than smuggled in under this one.

The muster is the part with the states. `orderCampaign` is the only entry point;
nothing plans a campaign for the player, which is the difference between this road
and the trade road and is what makes `the-war-is-a-choice` a question worth asking
at all. Three settlers walk to the treeline as ordinary jobs, and every way that
can go wrong — a raid, a settler the player takes over, a road out that is blocked,
a muster that never fills inside a day — goes through one exit that puts everybody
back on the map, because a party half-lifted off it is the one state nothing else
in the sim knows how to read. The bill is booked at the muster and not at the
homecoming: the colony is short those three for the whole walk the moment it says
go, and a count that waited would read a holding as free for every day between
taking it and standing down.

*What it bought, measured.* The first sixty-day grid after this stage shipped read
`campaigns 0` on all fifteen colonies, on every setting, without a single exception.
That is what a road nobody can afford looks like, and it took a per-tick probe on
settler/1312 to establish that it was not one: it was a grid with nobody at the
wheel. Handed to a Steward, that same seed sends three parties, keeps three
holdings, and orders the first on day 12. The grid runs `steward: false` — *nobody manages the colony*, the floor the
sim must clear alone — and `orderCampaign` is the one errand in the game that the
colony's own foreman never picks up, because `types.ts` says a war is the player's
decision every time. Fifteen colonies agreeing exactly is not a finding. It is a
constant, and a constant is usually the instrument.

The fix is a second family rather than a flag: the same fifteen seed-and-setting
colonies replayed with a player at the wheel, judged only by the two war promises,
which keeps the other twenty-four denominated in the unmanaged floor they were
calibrated against. Thirty-nine colonies now, 2,176 s.

`no-holding-falls-for-free` **holds**. Fourteen of the fifteen played colonies took
ground — twenty-three holdings between them — and every one paid at least 18.0
pawn-days a holding, the cheapest legal war. The thinnest is settler/1312 at 38.0,
better than twice the floor, so the margin is not a rounding artefact.

`the-war-is-a-choice` **breaks, in the direction that was always the risk**: fifteen
of the fifteen colonies with seven hands sent a party. Two readings are available
and only one of them is about the game. The played family has exactly one player in
it, and a deterministic policy that marches whenever the gates open has no
alternative to offer — a choice cannot be measured across colonies that were all
played by the same decision. What the grid *does* establish is the half that does
not depend on the policy: **nothing in the game ever says no.** The tell is
harsh/99001, which sent **ten** parties, took **nothing**, and spent 180 pawn-days
finding out; harsh/424242 sent ten for one holding and 234 pawn-days. Ten defeats
did not make staying home right, because losing costs a week of walking and three
settlers in bed for a few days after it, and nothing that is still true a fortnight
later. Until there is a price for a war that fails — not a funeral, which this stage
rules out on purpose, but something a colony can be worse off for having spent —
the promise has nothing to catch. That is the standing bill, and it is stage 5's
before it is anyone's.

One more thing the ladder rewiring did, and it is the same fault wearing different
clothes. Warfare now reads ground, so on the unmanaged grid it is **rung 1 on all
fourteen** full-clock runs — the standing band put down at home, and never anything
else, because a colony with nobody at the wheel never marches. Both road promises
were being read off that grid. `the-three-roads-are-three-roads` was scoring two of
its three pairs against a constant, and `no-road-is-already-finished` was answering
**holds** for the reason a pinned ladder always answers holds: rung 1 of 4 has three
rungs left in it for ever.

Both now read the played family, and the answer there is worse and truer.
`the-three-roads-are-three-roads` reads **3 of 3 pairs never disagree across 15
runs**: the order is warfare ≥ science ≥ economy on every one of the fifteen, so
nothing inverts anywhere. And `no-road-is-already-finished` **breaks** — calm/1312
and settler/1312 stand on warfare **rung 4 of 4**, three holdings apiece, the road
walked to its end inside sixty days, which is exactly the failure that promise
exists to catch and could not see from the floor. Economy, at the other end, never
climbs past rung 1 and on five of the fifteen never reaches it.

What the war family cannot say is whether that flatness belongs to the game or to
the steward: fifteen colonies played by one deterministic policy make a flat pair
evidence and an inverting pair only the absence of it. Both promises stay
`enforced: false`, and both now bill stage 5 rather than the grid — a road that can
be finished in sixty days needs an ending at the top of it, and a road that never
leaves its first rung needs something in the valley to ask for its second. The
general lesson
is cheaper than either: when a stage changes what a column counts, re-ask which
family every promise reading that column is denominated in. The second of these two
was found that way rather than by being bitten.

**5 — The three endings.** Ship, passage, dominion. Each is a long and expensive
terminal that reads one road's tally, and each writes a real ending.

*Planned, not built. Expanded from two lines to a spec on 2026-08-11, once stages 3
and 4 had put real numbers under it.* The three fictions are already fixed in
[The three roads](#the-three-roads) and are not reopened here; what follows is the
mechanism, and it is written down first because the mechanism is where an ending
goes wrong.

**An ending is a commitment, not a threshold.** The founding is the precedent and it
is the right one: the tense part of it was never meeting the five charters, it was
holding them together for three days while the valley tried to take one back.
`victory.ts` rejected by name the version where a win lands on the tick a number
ticks over — *"the most dramatic moment in the run is a number quietly ticking
over"* — and an ending that fires when a rung is reached would be that same mistake
one act later and three times over. So each ending is something the colony **commits
to, pays for, and then has to survive**: it takes days, the colony still has to be a
colony while it runs, and a colony that falls apart underneath it loses it.

**The gate is the top rung of its own road**, which is what "reads one road's tally"
means and why the ladders had to be derived rather than picked. The ship needs
Machinists, the berths need House, dominion needs Warlords. When a fourth ring or a
fourth tier grows a ladder, the gate moves with it and nobody edits a second file.

**Three bills in three different units**, for the same reason there are three
ladders at all — three endings that all cost steel would be one ending printed three
times, which is the failure `the-three-roads-are-three-roads` was written to catch,
one layer up:

| Ending | What it costs | Why that unit |
| --- | --- | --- |
| **Ship** | Every materials line in the research tree, summed — the whole foundry's output made once more *(shipped as `SHIP_BILL`; the plan said "a large multiple of the third tier's own bill", and deriving it from the tree instead means growing the tree grows the ship with no number typed)* | The science road's currency is the top of the crafting chain. You leave on something you made, so you have to have made it. |
| **Berths** | A very large sum handed *out* through the caravans, over many trips, priced at the `VALUE` table the quotes already use | The economy road's currency is trade, and the point of this ending is that somebody else built the ship. Paid, not built. There is no money in `ResourceKind` and this ending does not add one: `settlements.ts` already prices every good in one table, and the bill is a running total of what was given away at that price. |
| **Dominion** | Nothing bought — every holding still yours after a long stretch of days | The warfare road's currency is ground, and ground is kept rather than spent. The bill is that nobody takes any of it back. |

**What stage 5 cannot decide on its own: the clock.** The played sixty-day grid
reaches warfare **rung 4 twice** (calm/1312 and settler/1312), science **rung 3** at
best, and economy **rung 1**. Read against the gates above that says exactly one of
the three endings is reachable inside the clock the grid currently runs, and the
other two are not — so either the grid's clock grows, or two of the three roads have
top rungs the game as it stands cannot deliver. Both answers are defensible and they
cost different things: a hundred-and-twenty-day grid is twice 2,139 s every time
anything under `src/sim` moves, and shortening a ladder to fit a clock is the
fitted-bar mistake this file keeps rejecting by name. It is named here rather
than settled in passing, because settling it in passing is how a balance document
becomes a balance opinion. *It was answered by the grid that shipped 5a, and the answer
was that it is two questions — see the shipped note under 5a below.*

Three slices, in this order:

- **5a — the terminal.** `endings.ts`: three endings, each gated on its road's top
  rung, each with its bill and its days; commit, work, abandon. Two promises.
  *No ending is free* — every ending that lands was paid for out of something the
  colony had to go and get. *Every ending is reachable* — each of the three is
  reached by somebody on the grid, which on the day it is written will be **broken**,
  and that is the point of writing it: it is the clock question above, in a form the
  instrument reports every run instead of a paragraph nobody re-reads.

  *Shipped: `endings.ts`, the far end panel, and the first two colonies ever to reach an
  ending.* Both promises read on the sixty-day grid of 2026-08-12. *No ending is free*
  **holds** — 2 landed, neither in under 12 days — with the caveat that the one ending
  anybody reached is the one that buys nothing, so it cannot yet tell *paid for* from
  *waited out*. *Every ending is reachable* is **broken at 1 of 3**, as written, and the
  first thing it did was **split the clock question this file posed as one**:

  > 1 of 3 endings reached in 60 days — unreached: ship (best rung 3 of 4), berths (best
  > rung 1 of 4)

  **The ship is a clock question and the berths are not.** Rung 3 of 4 with the tree at 17
  of 19 and the bench never idle is a colony walking at the right pace and running out of
  days; a longer grid settles it, and costs twice 2,003 s every time anything under
  `src/sim` moves. Rung **1 of 4** is not that. The economy ladder's top rung is every
  neighbour at standing, five of the fifteen never reach even the first, and *the far
  country is walked* reads 3 of 7 — the road is not too long, it is not being walked.
  Sixty more days buys a reachability tick and teaches nothing about why the road is
  empty. So the question this file refused to settle in passing has one answer and one
  refusal, and neither of them is a number to move: **the grid's clock is a live option
  for the ship alone, and the berths are a stage-6 question about why nobody walks the
  economy road.** That is a bill, and it is not stage 5's.
- **5b — the ending itself.** The record, the card, and the run's verdict. `gameOver`
  is *not* the field this writes to — it means "nobody is left" and nine passes read
  it that way, which is the bug `victory.ts` documents at length. An ending is its
  own field, and `run.ts` learns a fourth verdict beside thriving, holding and
  collapsed.

  *Shipped: `EndingRecord`, the terminal card, the `landed` verdict, and one promise
  that reads them.* The decision that shaped the slice was whether the run **stops**
  when an ending lands. It does not. Stopping is the tidier fiction — the ship leaves,
  roll credits — but every other promise on the grid filters on `daysLived >= days`, so
  a run that broke on day forty-nine would fall out of `every-ending-is-reachable` on
  its way to being counted by it, and *1 of 3* would read *0 of 3* for reasons that are
  entirely plumbing. The colony plays its clock out, which is what makes the frozen
  record load-bearing: the card and the verdict describe the tick the ending landed on,
  not a world that has moved eleven days past it. It also makes **landed, then wiped
  out** a real case rather than an impossible one, and `judge` takes the ending first
  and names the empty valley in the same sentence.

  The verdict is `landed` — the word the mechanism already uses, covering all three
  terminals, and deliberately not a fourth grade of *how is it doing*. The other three
  are that question asked on the last day; this one says the question stopped applying.
  The new promise, *an ending is the last word*, checks the reporting rather than the
  balance: every run holding a record is filed as `landed`, no ending landed on a day
  its run never reached, and when it holds it prints how long the colony played on
  afterwards. It **holds** on its first sixty-day grid: two landed endings, both filed
  as `landed`, neither on a day its run never reached, and the colony played on for up
  to eleven days after the record froze.

  It also closed the bill 5a left open. *No road is already finished* had outlived its
  own claim — calm/1312 and settler/1312 stood on a top rung it called a dead end and
  then walked through the door behind it — and it was left open and red rather than
  quietly re-worded, because until an ending had a verdict there was nothing to read.
  Now there is, and the rewrite is the narrow one: a top rung is forgiven only when
  **that road's own ending landed**, not when any ending did and not when one was merely
  committed to. That reads green now too: across fifteen colonies no run ended its clock
  on a top rung it had not walked off, and the furthest anybody got was rung four of four.
- **5c — the manifest.** [The one thing to build now for the
  sequel](#the-one-thing-to-build-now-for-the-sequel), which is cheap the moment 5b
  exists and expensive to reconstruct afterward.

The save needs no migration for any of it: `world.ending` is optional and the
envelope serialises the world whole, so a colony saved today opens tomorrow with no
ending in progress — which is the truth about it.

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
  closed by a fingerprint over `src/sim` and the half of `src/eval` that plays
  colonies, taken before the first colony and re-checked after the last, refused
  rather than saved on a mismatch. The judge itself is deliberately outside it —
  it was inside for four stages, which meant moving one bar cost a fresh grid
  before you could see whether the move was right, and that is the very loop the
  split exists to abolish.
  See `ARCHITECTURE.md` → "Measured once, judged in milliseconds".
- **Four known-broken principles are still open**, and two of them are stage 2's
  own, described where the stage is. `nobody-starves-beside-a-full-pantry`
  hit 6 of 15 runs on the thirty-day grid and 6 of 15 on the first sixty-day one;
  on the grid the trade work has left behind it is **8 of 15**, and the shape got
  worse rather than merely commoner. Every one of the eight now bottoms out at
  exactly 0.00 — a settler at nothing, not a settler running low — and every one
  of them did it while the colony held between twelve and twenty-two days of food.
  One calm map (7, at 0.00 on twelve days in store), three settler maps (1312 on
  twenty-one, 99001 on fifteen, 424242 on twenty) and four of the five harsh ones.
  The fifth harsh map is not on the list for the worst possible reason:
  20260729 is the colony that collapsed on day 52, and a settler who starves beside
  an *empty* larder is a different failure that this principle correctly declines to
  count. It moved from six to eight across the two trade fixes and nothing else,
  which suggests — and does not show — that a colony with a settler away on a
  six-day road has one fewer pair of hands to carry a meal to the person who needs
  it. Nobody has tested that, and the last theory of this kind on this project was
  wrong; it is written here as the first thing to check and not as the answer.
  Stage 2 has since given the foreman a *reason* to walk further and more often —
  parts can only be bought — so if the road-hands theory is right this number
  should get worse on the next grid, and it is the only place in the plan where a
  principle getting worse would be evidence rather than a regression. If it moves,
  check the hands before checking the tier.

  **It moved, and it moved the other way.** The prediction above is written down
  because a theory that cannot be wrong is not worth writing down, and this one
  was wrong. Two grids later — with a fourth trade good, a far ring that is now
  actually walked, and parties out on the road 8.1 days a run — the count went
  **8 of 15 back to 6 of 15**, and the calm map came off the list entirely: two
  settler maps (99001 at 0.00 on 19 days of food, 424242 on 18) and four of the
  five harsh ones. More roads, fewer starvations. The road-hands theory predicted
  the opposite and is now the *least* likely explanation on the table, so the next
  slice to look at this should look at hauling priority under raid recovery
  instead, and not at the caravan.

  What that leaves is a principle whose own claim has stopped being supported by
  its own evidence. It says the failure "happens on the kind one" — and on this
  grid it does not happen on calm at all. Six of six are settler or harsh, which
  is what a difficulty gradient looks like rather than what a feeding bug looks
  like. The mechanism argument still stands on its own feet — a settler at exactly
  0.00 beside eighteen days of meals is not a colony that ran out of food — but
  the *distribution* argument is now spent, and the principle should either be
  re-written to drop the "on the kind one" clause or be shown a calm map that
  starves. Recorded here rather than quietly re-scoped: a principle edited to
  match the grid it failed is a principle that has stopped measuring anything.
  `the-escalation-ladder-is-climbable-to-the-top`
  is settled by the full sixty-day grid, and not in its favour: the highest rung
  reached anywhere was 3 of 4, on one calm map.

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
