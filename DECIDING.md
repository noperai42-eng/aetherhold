# What the player decides with

> Status, 2026-09-09: **stages 0 and 1 are built, and half of stage 2 is.** Each
> section below carries an *as built* note saying what actually landed and where
> it departed from the spec. Stages 3, 4 and 5 are untouched. Written against a
> reading of `src/client/ui/hud.ts`, `src/sim/gear.ts`, `src/sim/research.ts` and
> `src/client/manager/controller.ts`, and against Evergrow
> (`~/Code/Evergrow`, cloned 2026-09-09) — a browser action RPG whose systems are
> not this game's, but whose presentation layer answers a question this game
> currently does not.
>
> The problem below is **a code-surface reading and a comparison, not a measured
> grid.** No colony was run to produce it. Every other forward document in this
> repo argues from measurements and this one does not yet, so each section names
> the instrument that would settle it, and none of the thresholds here are
> pinned. Counts, timings and orderings are a starting hypothesis in the sense
> [METHODOLOGY.md](METHODOLOGY.md) means it: they exist to be measured against,
> not to be defended.

*The other six documents:* [README.md](README.md) is what the game is and how each
system works, [ARCHITECTURE.md](ARCHITECTURE.md) is how the code is laid out and
why, [ENDGAME.md](ENDGAME.md) is what is missing at the far end of a run,
[ACCEPTANCE.md](ACCEPTANCE.md) is what the build promised and which test holds each
promise down, [METHODOLOGY.md](METHODOLOGY.md) is how a change is measured, and
[LOOK.md](LOOK.md) is the loop that judges anything a player sees.

## Contents

- [The problem, in what is on the screen now](#the-problem-in-what-is-on-the-screen-now)
- [Stage 0 — the room where you can look at one thing](#stage-0--the-room-where-you-can-look-at-one-thing)
- [Stage 1 — the card that compares](#stage-1--the-card-that-compares)
- [Stage 2 — the body on the ground](#stage-2--the-body-on-the-ground)
- [Stage 3 — what killed them](#stage-3--what-killed-them)
- [Stage 4 — the tree you can search](#stage-4--the-tree-you-can-search)
- [Stage 5 — the odds you are offered](#stage-5--the-odds-you-are-offered)
- [The order of work](#the-order-of-work)
- [Costs and risks, stated plainly](#costs-and-risks-stated-plainly)
- [What was deliberately not taken](#what-was-deliberately-not-taken)

## The problem, in what is on the screen now

There are five wearable things in this game. `src/sim/gear.ts` defines all of
them, across two slots and four axes:

| kind | slot | armour | insulation | work | treatment |
| --- | --- | ---: | ---: | ---: | ---: |
| leather jerkin | apparel | 0.15 | 0.20 | — | — |
| fur parka | apparel | 0.05 | 0.85 | — | — |
| steel plate | apparel | 0.40 | −0.15 | 0.92 | — |
| toolbelt | gear | — | — | 1.15 | — |
| doctor's bag | gear | — | — | — | 1.40 |

Three of those cells are the whole game. A parka is most of a winter night and
stops nothing. Plate is the only real armour and charges eight per cent of
everything that settler will ever do, for life, plus a cold penalty that makes
the wearer worse at the season the parka exists for. A toolbelt is fifteen per
cent more colony and stacks with all of it because it sits in the other slot.

The settler card renders that as two lines of text. `src/client/ui/hud.ts:1584`:

```
wearing    steel plate
carrying   toolbelt
```

A name. Not the forty per cent, not the eight per cent tax, not the cold. The
player is asked to choose between five items whose entire interest is a set of
tradeoffs the interface never mentions, and there is no tooltip module anywhere
in `src/client` — `grep -rl tooltip src/client` returns nothing.

The sim is not missing the knowledge. `gear.ts:224` already has
`isUpgrade(pawn, kind)`. But it answers a narrower question than the player's:
it picks a single axis with `wantsArmour(pawn)` and compares one number. The
player never sees the axis, never sees that a choice was made on their behalf,
and cannot disagree with it.

This is the shape of the whole document. In each case the simulation already
knows the answer and the surface does not carry it:

- A corpse cannot be clicked at all. `src/client/manager/controller.ts:698`
  reads `if (p.dead) continue;`, so the settler who just died is the one thing
  on the map with nothing to say.
- A death produces a grave and a grief spike (`src/sim/graves.ts`) and no
  account of itself. The colony learns nothing from losing somebody.
- `available(world)` in `src/sim/research.ts` returns what can be started now,
  and the interface offers it as a list rather than as a place with a route
  through it.

Evergrow is worth reading precisely because it is not this game. It has 2,113
skill nodes and procedural affixes and none of that belongs here. What it has
that does belong is a rule it states out loud in `docs/reward-presentation.md`:

> Simulation credits XP and gold immediately and persists the exact values.
> Presentation never awards, spends, moves or deletes actual rewards.

That is the same seam this repo already calls *how the two views stay honest*,
carried one layer further out — into the part of the screen that makes a number
feel like something. Every stage below is on the presentation side of it. **No
stage in this document may change a simulation number.** A stage that finds
itself wanting to has found a different piece of work and should stop and say so.

## Stage 0 — the room where you can look at one thing

**What it is.** A second Vite entry point, `review.html`, that mounts one named
scene from a query string and nothing else: `?scene=gear-card`, `?scene=death`,
`?scene=corpse`. Each scene builds a fixture world in memory, draws the real
panel through the real HUD code, and stops. It never steps the simulation, never
reads or writes a save, and never touches `localStorage`.

**Why it is first.** [LOOK.md](LOOK.md) judges a change by photographing the same
frames before and after, and that works when the frame is one the game reliably
produces. The frames stages 1 to 3 are about are not: a good comparison card
needs a settler wearing plate standing next to a better parka in a cold snap, and
a death recap needs somebody to have just died of something specific. Waiting for
a colony to produce that frame is why those panels have never been looked at.
Evergrow builds 36 of these pages — `rewards.html`, `deaths.html`, `loot.html`,
`services.html` — against 41 review and study modules, which is close to one per
system, and it is the reason its presentation layer is the strongest thing in the
repo.

**The rule.** A scene is a pure function from a seed to a staged `World`. Two
loads of the same scene at the same viewport must produce the same frame, or the
look loop cannot compare anything. Scenes live in `src/review/`, import from
`src/client/ui/` and `src/sim/`, and nothing in `src/client/` or `src/sim/` may
import from `src/review/` — the dependency runs one way, as
[ARCHITECTURE.md](ARCHITECTURE.md) requires of every other seam.

**Held down by.** *Functional:* a test that loads each registered scene, asserts
it builds a world and renders without throwing, and asserts the scene registry
and the `?scene=` values agree, so a renamed scene fails the suite rather than
404ing quietly. *Experience:* a capture of every registered scene at 1280×800
added to the look loop's sweep, so a scene that stops drawing is caught by the
same instrument that catches everything else a player sees.

**Instrument.** This one needs no measurement to justify — it is a harness, and
its value is that stages 1 to 3 become reviewable at all.

**As built, 2026-09-09.** `review.html` plus `src/review/{main,scenes,review.css}.ts`,
ten scenes, one seed. `npm run look:review` shoots all of them, reading the list
off the page's own index so a new scene needs no edit to the script. Two things
came out differently. `review.html` needed no `vite.config.ts` entry at all —
vite serves any root `.html` in dev — which is better than the spec asked for,
because the page cannot end up in the players' bundle by accident. And it is
**one panel a page** rather than several: forty-five stylesheet rules hang off
`#inspector` and an id appears once in a document, so to compare two variants you
load the scene twice. The one-way dependency is a test that walks `src/client`
and `src/sim` and asserts nothing imports `src/review/`.

## Stage 1 — the card that compares

**What it is.** Hovering or selecting a wearable thing — on a settler, on a
shelf, on the ground, on a body — shows what it does, what it would replace, and
the difference between those two, for *that settler*.

**The card.** Three blocks, in this order, because the third is the one the
player came for:

```
steel plate                          apparel

armour                                  40%
insulation                             −0.15
work                                   ×0.92

On Corwin Emberly
armour                          15%  →  40%     +25
insulation                     0.20  → −0.15    −0.35
work                          ×1.00  → ×0.92    −8%

Replaces her leather jerkin
```

The middle block is the item. The third block is the decision, and it is the
whole feature: the same three axes resolved against what this settler has on,
with the direction shown. Evergrow's item panel does exactly this under the
heading *On equip*, closing with `Replaces Mournful Crown Helm`, and naming the
displaced item is what turns an abstract comparison into a swap the player can
picture.

**The rules.**

- Only axes where either side is non-zero appear. A doctor's bag against an
  empty gear slot is one row, not four.
- A regression is shown, never hidden. The eight per cent work tax on plate is
  the most useful number on the card and the one a card written to sell the item
  would omit.
- The card names the settler. `isUpgrade` is already per-pawn and the answer
  genuinely differs between a rifleman and a herbalist; a card that says "better"
  without saying *for whom* is worse than no card.
- Presentation only. The card computes its rows from `EQUIP` and the pawn; it
  calls no `equip()`, mutates nothing, and is safe to render for a settler who
  is asleep, drafted, downed or dead.

**What it must not become.** Rarity tiers, affixes, procedural names, item
levels. There are five items. The problem is not that there are too few things
to compare, it is that the four numbers behind them have never been shown; adding
a sixth axis of randomness to a five-item table would make the table less legible,
not more. This is the point in the document where Evergrow stops being a model.

**Held down by.** *Functional:* a test over every ordered pair in `EQUIP_ORDER`
asserting the card's rows agree with `EQUIP` arithmetic, that a worse axis renders
as a decrease, that the `Replaces` line names the currently worn item, and that
rendering a card mutates neither pawn nor world (deep-compare before and after).
*Experience:* a `?scene=gear-card` frame per interesting pair — plate over jerkin,
parka over plate, bag into an empty slot — read back by eye in a look round.

**Instrument.** The claim to test is that the card changes what players equip.
The cheap version is a probe over a staged colony counting how many settlers end
a run in the apparel `isUpgrade` would have chosen; the honest version is
[PLAYTEST.md](PLAYTEST.md), because the question is whether a person can see the
tradeoff, and no grid answers that.

**As built, 2026-09-09.** Split in two, because grepping `src/client/` while
building it proved the premise wrong: **the player never chooses gear.** Recipes
read *Cut yourself a jerkin*, settlers craft for themselves, and `equip` is not
called from client code anywhere. There is no shelf, no ground-item and no body
UI, so a "would you like to wear this" card has nothing in the game to hover
over. Shipping it into a menu nobody can reach would have been a feature that
only exists in its own tests, which this repo has a rule against.

So the half that had a surface shipped: `kitRows` puts what each worn piece is
doing under its name on the settler card, one axis a line so it cannot wrap at
any width. And the half that has not shipped is **built, tested and
photographed** rather than deferred — `kitPanel` draws the three-block card
above, `tests/kit-card.test.ts` (21) re-derives every number it prints by putting
the piece on a real settler with the game's own `equip`, and four review scenes
photograph it. It is waiting for a surface, and stage 2 is where one arrives.

The arithmetic rule turned out stricter than the spec worded it. The card does
not compute *from* `EQUIP` and the pawn: `kitFacts` shallow-clones the settler,
calls the simulation's own `equip`, and reads the simulation's own accessors on
both copies. A presentation layer doing the arithmetic itself is a second
implementation of the rules, and `equip` writes two scalar fields, so a shallow
clone is exact.

## Stage 2 — the body on the ground

**What it is.** A dead settler can be clicked, says who they were and what they
were doing, and their gear can be taken off them.

**Why it belongs here.** It is the first place the stage 1 card is worth more
than a curiosity: a body in the yard is wearing something, somebody standing over
it is wearing something worse, and the comparison is the entire content of the
moment. Built the other way round — stripping without the card — it is an
inventory chore.

**The rules.**

- `controller.ts:698` stops skipping the dead for picking. Selection of a corpse
  is a distinct state from selection of a settler: the card shows a name, the
  work they were on when they died, and what they still have on, and it offers no
  orders.
- Taking gear off a body is **a job, not a click.** A settler walks to it and
  spends time, the way hauling and burying already work. A click that teleports
  a parka across the map is the kind of thing that makes the rest of the
  simulation feel arbitrary, and this repo has spent whole rounds on the opposite
  instinct.
- Stripping and burying compete for the same body, and stripping wins if both are
  ordered, because a buried corpse is out of the count and its gear would go with
  it. `graves.ts` says `buried` takes it out of the renderer's hands; the
  stripping job must therefore complete or be cancelled before burial claims it.
- Gear off a body enters the world as items on the ground at the body's cell, so
  the existing hauling and stockpile rules carry it from there. No new transfer
  path, no direct body-to-settler equip.
- A raider's body is a raider's body. If the Ashbound wear anything, this is the
  same feature and it should not be special-cased.

**The open question, and it is the user's to answer.** The five `EquipKind`s are
worn state on a pawn, not items — there is no `rawfood`-shaped stack for a parka.
Stripping therefore needs either a new item kind per equippable, or a direct
body-to-settler transfer that skips the ground entirely. The first is more code
and keeps one rule for how things move; the second is less code and introduces a
second way for gear to travel. **This document assumes the first** because it
preserves the hauling rules everything else obeys, and flags it as the one
decision in the stage that is not mine to make.

**Held down by.** *Functional:* a test that a dead pawn is selectable, that a
strip job moves the gear from `pawn.apparel` to a ground item at the body's cell,
that a body with nothing on offers no job, and that burial and stripping cannot
both consume the same body. *Experience:* a `?scene=corpse` frame, plus a
`PLAYTEST.md` step — a raid, a casualty, click the body, strip the plate, see a
settler wearing it two days later.

**As built, 2026-09-09.** The half with no open fork: `pawnAt` no longer skips
the dead and ranks the living ahead of them on a tie, so a doctor kneeling on a
body's square still gets the click; `corpsePanel` in `hud.ts` gives a corpse its
own card, reached by a `p.dead` branch placed where the animal branch already
returns, so not one row of the settler card is computed for somebody who is dead.
It prints who they were, what is still on them and what it is worth, where they
lie, the rot clock and their story. `tests/corpse-card.test.ts` (22) pins it, and
two review scenes photograph it.

Two departures from the spec above, both recorded rather than quietly dropped.
The card does **not** say what work they were on when they died: `damagePawn`
sets `activity` to `dead` and cancels the job in hand, so the fact is gone by the
time anything could read it — that is stage 3's territory, not a row this panel
could honestly print. And the rot clock is a row the spec did not ask for: four
days, in days while there are days and in hours once there are not. It earns its
place because it is the only thing on the card that makes it a decision, and
because it is the row stripping will hang off.

**Still not built:** stripping itself, which is the fork below and is the user's
to settle. The clock is therefore currently information with no lever on the end
of it, which is exactly the state `PLAYTEST.md` §9uu was written to collect a
judgement about.

## Stage 3 — what killed them

**What it is.** A short account, on the body and on the grave, of how a settler
died: the cause, the last few things that damaged them, and how long they were
down first.

**Why.** A colony sim's losses are its most instructive events and this one
currently reports them as a name in a list and a grief spike. Evergrow states the
intent better than I can — record the cause of death and the last significant
damage sources, as *a learning aid rather than an obligation to study a combat
log.* The starvation columns in `tests/colony-eval.test.ts` exist because four
different causes of the same death were indistinguishable to the instrument; this
is the same problem for the player.

**The rules.**

- A small ring buffer per pawn — the last four damage events, each a source
  string and an amount, plus the tick. `damagePawn` already takes a `source`
  parameter, so the data exists and is being discarded.
- Fixed capacity, overwritten in place, so a settler who spends forty days being
  bitten by things costs four slots and not forty. Bounded memory is not an
  optimisation here, it is the reason the feature is safe to ship.
- It reads as prose, not a table. *"Bled to death eight hours after a thornback
  opened her arm; she was on the floor for six of them and nobody came."* The
  time-on-the-floor clause is the one that teaches something, and it is exactly
  the quantity the eval columns already track.
- Presentation only, again: the recap reads the buffer and writes nothing.

**Held down by.** *Functional:* a test that the buffer keeps the last four events
and drops the fifth, that a settler killed by one hit reports that hit, and that
a settler who starved reports starvation rather than the mandible that grazed
them on day two. *Experience:* a `?scene=death` frame per cause — raider, animal,
starvation, illness, fire — read back in a look round for whether the sentence is
a sentence.

**Instrument.** None needed to justify it; the eval harness already proves the
four causes are distinguishable in principle, because it distinguishes them.

## Stage 4 — the tree you can search

**What it is.** Research stops being a list and becomes a place: a search box
over names *and* effects, a filter that collapses the tree to what is reachable
now, and a node panel that states its requirement and whether the colony
currently meets it.

**Why.** `RESEARCH_ORDER` is a flat order and `available(world)` returns what can
be started this minute. A player who wants rifling does not want to know what is
available this minute; they want to know how far away rifling is, what it costs
on the way, and what is stopping them. Evergrow makes a 2,113-node tree navigable
with four mechanisms and three of them are free here: search over effects, a
*Reachable* filter, and a requirement line that reports its own satisfaction
(`Requires Melee weapon — matching equipment ready`). The fourth, semantic zoom,
is for a graph two orders of magnitude larger than this one and is not proposed.

**The rules.**

- Search matches the effect, not only the name. A player types "warmth" and finds
  the project whose description mentions it, because nobody knows this tree's
  vocabulary on their first run.
- **Pin a destination.** Choosing a distant project shows the route to it, the
  total cost of that route, and what the colony is missing. `researchNeeds` and
  `researchStalled` already compute the two halves of this for the current
  project; the route is those functions applied along a path.
- The panel says why a node is unavailable in the node's own terms — a missing
  building, a missing resource, an unfinished prerequisite — rather than omitting
  it. An unavailable node the player can see and understand is a goal; an
  unavailable node that is hidden is a tree that seems smaller than it is.
- One honest addition to the content, and only one: **a keystone is a project
  that changes a rule and states its cost.** Everything in `RESEARCH` today is an
  unlock or a multiplier. A project the player refuses on purpose is a different
  kind of decision from a project they have not got to yet, and one or two of
  them would do more for this tree than ten more multipliers. This is content
  design and wants a round of its own; it is named here so it is not mistaken for
  part of the interface work.

**Held down by.** *Functional:* a test that search matches on description text,
that the reachable filter's set equals `available(world)`, that a pinned route's
cost is the sum of its nodes, and that an unavailable node reports the specific
reason it is unavailable. *Experience:* a `PLAYTEST.md` step — open research on
day one, type "warmth", pin the result, and read what the colony is missing.

## Stage 5 — the odds you are offered

**What it is.** The two numbers a caravan decision turns on that the stall does
not currently say out loud: the chance the party comes to grief on the road, and
how much they can actually carry.

**Why it is small, and why it is last.** I drafted this stage as a save-scum fix
— Evergrow pins shop stock to an epoch so that *returning, reopening, waiting,
reloading or unloading a town never refreshes stock*, and I assumed this game had
the problem that rule solves. It does not. A town's `sells` is drawn once in the
settlement loop at `settlements.ts:414`, during worldgen, so a shelf cannot be
rerolled by looking at it again. There is no currency, no shop inventory and no
buyback to build, because trade here is straight goods-for-goods on a rate that
`tests/trade.test.ts` already proves has no loop in it. The stage as first written
was solving somebody else's game and is recorded that way rather than deleted,
because the next person to read Evergrow's services documentation will have the
same idea.

What survives is worth doing anyway. The trade surface is the **counter-example**
to this whole document: `hud.ts:2430-2515` already calls `quote`, `rateReasons`
and `roundTripDays`, and shows the player the rate, the reasons behind it and the
days it costs. It is the one place in this game that does what stage 1 is asking
for everywhere else, which means stage 1 has a model to copy from inside this
codebase and does not need to invent a house style for it.

Two functions are computed and never shown, and both are made of decisions the
player is already making blind. `mishapChance` at `settlements.ts:621` is four
terms — the days on the road, the town's standing, **the escort's shooting
skill**, and the waystations built along it — and the last two are things the
colony chose. `packLimit` at `settlements.ts:731` scales with Freighting, so a
research project the player finished silently made every cart bigger and nothing
said so.

**The rules.**

- The stall shows the mishap chance before the commit, in the sentence register
  `rateReasons` already established two hundred lines above it, and names the
  terms that move it. A player who has been told the escort's shooting matters
  can send the shot; one who has not is choosing a name off a list.
- Pack limit is a ceiling on the amount selector rather than a failure after the
  fact, and says what raised it when Freighting has.
- Presentation only. Neither number changes; both are already authoritative.

**Held down by.** *Functional:* a test that the displayed chance equals
`mishapChance` for the same settlement, pawn and world, and that the selector
cannot be pushed past `packLimit`. *Experience:* a `PLAYTEST.md` step — open the
stall, read the odds, swap the escort for the better shot, watch them move.

## The order of work

Stage 0 first, because stages 1 to 3 are unreviewable without it and this repo
judges anything a player sees by looking at it.

Then 1, then 2, then 3 — that order and not another. Stage 2 without stage 1 is a
chore, and stage 3 shares stage 2's click target, so building it third means the
corpse card is built once. Stages 4 and 5 are independent of all of them and of
each other, and 5 is small enough to ride along with whichever round is nearest
the trade stall.

Each stage lands the way [METHODOLOGY.md](METHODOLOGY.md) says a round lands:
its numbers and frames in [ROUND_NOTES.md](ROUND_NOTES.md), its promise and the
test holding it down in [ACCEPTANCE.md](ACCEPTANCE.md), and a line in
[ARCHITECTURE.md](ARCHITECTURE.md) only if the shape changed — which it does
exactly twice, for `src/review/` in stage 0 and for the damage ring buffer in
stage 3.

## Costs and risks, stated plainly

**The document argues from a reading, not a grid.** Every other forward plan in
this repo starts from measured colonies. This one starts from what is on the
screen and from a comparison with another project, and that is a weaker footing.
The mitigation is that stages 1 to 3 cannot change a simulation number, so being
wrong about them costs interface work and not a balance regression. Stage 4's
keystone proposal is the one item here that *can* change outcomes, and it should
not be built until it has had a round of its own. Stage 5 was drafted from
exactly this weakness — a premise borrowed from another game, believed, checked
afterwards, and wrong. That is the failure mode of the method, caught once here
and left visible rather than edited away.

**Stage 0 is a second entry point to keep alive.** Thirty-six of them is how
Evergrow ends up with a maintenance surface as large as the game. The rule that
keeps it honest is that a scene which stops rendering fails the suite; the rule
that keeps it small is that a scene exists to stage a frame the running game
cannot reliably produce, and no other reason.

**Stage 2 has a real fork in it** — new item kinds versus a direct transfer — and
this document picked one without the authority to. If the answer is the other
one, the stage is smaller and the hauling rules gain an exception.

**Stage 3 adds per-pawn state.** Four events times every pawn, forever, including
raiders and fauna. Fixed capacity makes it bounded, but it lands in the save
format, and a save-compatibility decision belongs in the round that ships it.

**None of this makes a colony survive longer**, and it should not be sold as
though it will. It makes the reasons a colony did what it did visible to the
person running it. That is a different axis from difficulty and the ending
conditions in [ENDGAME.md](ENDGAME.md) are unaffected.

## What was deliberately not taken

Evergrow is an action RPG with infinite tiers, procedural affixes, five rarity
bands and a 2,113-node tree, and those are its retention machinery. This game's
hold is a colony a player can understand end to end; the failure mode of
importing that scale is a colony sim nobody can reason about, which is the exact
thing the starvation columns in `tests/colony-eval.test.ts` were built to notice.

Specifically rejected: rarity tiers and affixes on a five-item gear table;
procedural item names; an item-level axis; enhancement levels; twitch-timing
combat, where Evergrow's 100 ms input buffer and 120–220 ms attack commitment
belong to a genre this game is not in. What was taken is the presentation
discipline underneath all of it, which is portable, and the observation that a
tradeoff the player cannot see is not a tradeoff.
