# Aetherhold

A browser colony sim with two views onto **one** simulation. Run the settlement from
above like a manager, or press **V** and step inside any settler — walk the base, open
doors, haul crates by hand, and shoot back when the treeline moves. Switching is
instant and the world never disagrees with itself.

Original setting and art (all geometry is generated in code). No third-party assets.

**The other four documents.** This file is what the game *is* and why each system earns its
place. [ARCHITECTURE.md](ARCHITECTURE.md) is how it is built.
[PLAYTEST.md](PLAYTEST.md) is the hands-on script — fifty numbered things to go and try.
[ACCEPTANCE.md](ACCEPTANCE.md) is what has been checked, by a machine or by a human.
[ENDGAME.md](ENDGAME.md) is the plan for what the game becomes after the founding.

## Contents

**Playing it** — [Run it](#run-it) · [Controls](#controls) · [The screen](#the-screen) ·
[What to do next](#what-to-do-next) · [The Steward](#the-steward) ·
[Winning](#winning) · [The three roads](#the-three-roads) · [The far end](#the-far-end) ·
[Pickies](#pickies)

**Building and keeping a place** — [Breaking ground](#breaking-ground) ·
[Laying a floor](#laying-a-floor) · [Warmth](#warmth) · [Power](#power) ·
[Somewhere worth living](#somewhere-worth-living) ·
[Rebuilding what you lose](#rebuilding-what-you-lose) ·
[Standing problems](#standing-problems) ·
[Where a hauler puts it down](#where-a-hauler-puts-it-down) · [Fetching](#fetching)

**Feeding it** — [Food goes off](#food-goes-off) · [The lake feeds you](#the-lake-feeds-you) ·
[The moor eats before you do](#the-moor-eats-before-you-do) ·
[The wood grows back](#the-wood-grows-back) · [Keeping animals](#keeping-animals) ·
[The one you keep](#the-one-you-keep) · [What comes for the herd](#what-comes-for-the-herd) ·
[The pen that holds](#the-pen-that-holds)

**The valley itself** — [The year](#the-year) · [The lake](#the-lake) ·
[The lake freezes](#the-lake-freezes) ·
[The third floor goes over the water](#the-third-floor-goes-over-the-water) ·
[The ground you make expensive](#the-ground-you-make-expensive) ·
[The dark part of the map](#the-dark-part-of-the-map) ·
[The moor without you in it](#the-moor-without-you-in-it)

**Trouble** — [What the raid does about your defences](#what-the-raid-does-about-your-defences) ·
[The Ashbound learn](#the-ashbound-learn) ·
[When the fire reaches you](#when-the-fire-reaches-you) · [Falling ill](#falling-ill) ·
[Prisoners](#prisoners)

**The people** — [Morale](#morale) · [Who your settlers are](#who-your-settlers-are) ·
[Who they get on with](#who-they-get-on-with) · [An evening off](#an-evening-off) ·
[Burying them](#burying-them)

**Getting ahead** — [Research](#research) · [The industrial base](#the-industrial-base) ·
[Trade](#trade) · [The road](#the-road)

**How it is kept honest** — [Does the game ever actually do this?](#does-the-game-ever-actually-do-this) ·
[How the two views stay honest](#how-the-two-views-stay-honest) ·
[What is in the box](#what-is-in-the-box)

## Run it

```bash
npm install
npm run dev      # http://localhost:5063 — HMR, for whoever is editing
```

If somebody is *playing* while you edit, run the second server too:

```bash
npm run build    # once, to fill dist/
npm run play     # http://localhost:5062, and the same on your LAN IP
```

`play` serves the built snapshot in `dist/`, so a source edit never reloads a game in
progress. `npm run ship` rebuilds; players get the new build on their next reload, not
mid-session. 5062 stays 5062 on purpose — saves live in `localStorage`, which is keyed by
origin, so changing the players' URL would throw their colonies away.

Other scripts: `npm run build` (typecheck + production bundle), `npm test` (1,585 tests),
`npm run icons` (redraw the home-screen icons). The opt-in gates — `sweep`, `balance`,
`eco`, `live`, `pool` — are described under
[Does the game ever actually do this?](#does-the-game-ever-actually-do-this)

Saves live in `localStorage`, which the browser files under the exact origin they were
made at — so a colony does not follow you to a different port, host or device. The
**Backup** button in the top bar packs the whole colony into ~18 kB of text you can copy,
download or paste back in anywhere. See `src/sim/transfer.ts`.

Needs a WebGL2 browser. Nothing is fetched from a CDN — Three.js and Vite are local.

The dev build puts `aether` on the browser console — `aether.help()` lists it. It sends the
raids, fires and fevers you would otherwise have to wait for, by making the same calls the
storyteller makes, and it is not in a production build. `PLAYTEST.md` uses it.

## Controls

### Colony view (manager)

| Key | Does |
| --- | --- |
| `WASD` / arrows | pan · `wheel` zoom · `Q`/`E` rotate · `R`/`F` tilt |
| Left click | select a settler or a building |
| Right click | order the selected settler to move there (drafts them) |
| `1`–`9`, `0` | pick a blueprint — click, or drag a rectangle, to place it (the bar opens the right category for you) |
| `Z` / `B` | stockpile zone · growing zone (hold `Shift` while dragging to erase) |
| `Y` | animal pen — six cells per head of livestock |
| `N` | mark ground to be broken into soil — crops ripen faster on it |
| `U` / `I` / `O` | lay bridge · plank floor · paved floor — quicker underfoot, fire will not cross paving, and a bridge is the only one that goes over water |
| `C` / `X` | designate chop/mine · designate deconstruct |
| `H` | mark grazing animals for hunting (drag over a herd; `Shift` calls it off) |
| `K` | mark a wild animal to be tamed into the pen (`Shift` calls it off) |
| `Backspace` | cancel tool: removes blueprints and designations |
| `Escape` | back out of the current tool, then clear the selection |
| `T` | draft / undraft the selected settler |
| `Tab` | cycle settlers · `P` work priorities · `L` research |
| `M` | trade — only while a caravan is standing in the yard |
| `J` | the road — send a settler over the ridge to a neighbouring settlement |
| `;` | the story — everything that has happened to this colony, by day |
| `Space` | pause · `-` / `=` slow down / speed up (or the speed buttons) |
| `G` | possess the selected settler |
| `V` | step inside |
| `/` or `F1` | the whole key list, in game (Save / Load / quality live in the top bar) |

### First person

| Key | Does |
| --- | --- |
| `WASD` | walk — `W`/`S` forward and back, `A`/`D` step sideways · `Shift` run |
| Mouse | look (click once to capture the pointer; `Escape` releases it) |
| `← →` `↑ ↓` | turn and look, for when you would rather not capture the pointer |
| — | doors swing open as you walk up to them, for you and for settlers alike |
| `E` | interact — beds, food, tables, stove, blueprints, trees, fires, wounded settlers |
| Click | attack, **only while drafted** — an aimed shot can take a deer, too |
| `T` | draft / undraft yourself |
| `Space` | pause |
| `V` | back to the colony view |

Time controls belong to the manager. In a body you get 1× or paused.

## The screen

The **build bar** along the bottom is a row of categories — Structure, Furniture, Production,
Climate, Defence, Power, then Zones and Orders — with one row of tiles open at a time. Click a
category to open it; press a building's digit and the bar opens the category that building
lives in and lights the tile, so the keys work whether or not you know where a thing is filed.
It wraps rather than overflowing, so nothing is ever laid out past the edge of the window.

The **alert strip** sits bottom right and is empty — genuinely not there — while the colony is
fine. Everything on it is a thing that is *still true*: a fire burning, somebody down, four
days of food left, blueprints waiting on steel that does not exist. Each row says what is wrong
and what to do about it, and most of them can be clicked to select whoever it is about and put
the camera on them. Rows leave on their own when the problem does. See
[Standing problems](#standing-problems).

The **map** sits top left: the whole valley at one pixel a cell, drawn out of
the same palette as the 3D view so a gravel flat is the same grey in both. A white outline
shows where the colony camera is looking — it slides when you pan, grows when you zoom out and
*rotates* when you orbit, because the ground on screen is a trapezoid at any angle that is not
a right one. Click or drag on it to send the camera there. Settlers are blue, the body you are
possessing is white, anything hostile is red, an unread landmark is amber, fire is orange.

Nothing is drawn on ground the colony has not walked — no terrain, no buildings, no bodies —
because the haze in the world hides a raider completely and a dot here would be the interface
overruling the game. It is the one panel that belongs to neither view: press `V` and it stays,
with the viewport rectangle replaced by a line pointing where the body you are wearing is
facing. See [The dark part of the map](#the-dark-part-of-the-map).

The **log** in the corner is a work log and behaves like one: the last eighty lines, oldest
dropped. That is the right length for glancing at what the crew is doing this minute and the
wrong length for the only record of the fact that Wren died in the spring — so there is a second
list. Press `;` (or **Story** in the top bar) for the **chronicle**: everything that has happened
to this colony, newest first, under day headers, back to the day the three of you walked into the
clearing. Only messages raised as headlines are copied into it — raids, deaths, pairings, a
research project landing, a harvest — and it keeps five hundred of them, which is several in-game
years. Lines with a place attached are clickable, same as the alerts.

A window and a history are different data structures, and serving both from one bounded array
means the shorter requirement wins silently. So: two lists.

The **settler strip**, the **details panel**, the **alert strip**, the **map** and the **log**
carry a ⠿ grip in their top-right corner. Drag it to move the panel, click it to fold the panel down to a name
tag, and drag the bottom-right corner of the log, the alerts or the details panel to resize it.
Where you put them is remembered between sessions; **Reset panels** in the help card (`/` or
`F1`) puts everything back.

## Research

Build a research bench (`0`), then press `L` and pick a project. Any settler with the
research work type will sit down at the bench and grind out points; the top bar carries a
progress pip so you can watch it move without opening the panel. Switching project throws
away the progress on the old one.

Nineteen projects, 421,000 points end to end. The last four also cost goods; that half of
the tree is [its own section](#the-industrial-base) below.

| Project | Costs | Needs | Gives |
| --- | --- | --- | --- |
| Toolmaking | 6000 | — | Half again as much wood per tree and steel per rock face |
| Tanning | 7000 | — | Turns hides into leather — jerkins, toolbelts and a doctor's bag |
| Field medicine | 9000 | — | Wounds close far faster and medicine goes further |
| Preserved rations | 11000 | — | A cooked meal fills a settler up by a third more, and keeps twice as long |
| Stonecutting | 13000 | Toolmaking | Unlocks the stone wall — three times the punishment of timber, and it will not burn |
| Apprenticeship | 14000 | Toolmaking | Everybody here learns a third faster, at everything |
| Raised soil beds | 15000 | Toolmaking | The plot ripens half again as fast |
| Furriery | 15000 | Tanning | Unlocks the fur parka, which is most of a winter night |
| Rifling | 16000 | Toolmaking | Your settlers shoot like veterans without the years |
| Cartography | 17000 | Toolmaking | Scouts read a site in half the time |
| Machining | 22000 | Stonecutting | A rifle or a course of medicine costs a third less |
| Autoloaders | 24000 | Rifling | Nearly twice the rate of fire from a turret |
| Plateworks | 24000 | Machining | Unlocks steel plate: two of every five hits stopped outright |
| Solar cells | 26000 | Machining | Unlocks the solar panel: 200 W of daylight for no wood at all |
| Composite plating | 30000 | Autoloaders | Everything you build takes a third less punishment |
| Foundry | 34000 | Composite plating | Every recipe costs less again — with Machining, 0.45 of what it once did |
| Freighting | 40000 | Foundry | Half again as much in every pack, on every road |
| Instruments | 46000 | Freighting | The research bench itself runs half again as fast |
| Waystations | 52000 | Instruments | Nine points off the mishap chance on every road, near ring to far |

A colony that can spare somebody finds about four to five thousand points in a day, so the
first project lands in the opening week and the last is a month's work. Nothing you can
already do is gated behind the tree — the stone wall, the solar panel and the steel plate
are the only things it holds back, and each appears in the build bar or the bench the moment
its project lands, with no reload. Plating is applied where the damage lands rather than to
the blueprint, so walls that were already standing when it finished get the benefit too.

Two of them are worth taking early or not at all. **Apprenticeship** makes everyone
learn faster, which on day five is most of a second doctor by the end of the month and on
day forty is nothing whatsoever — it is deliberately the one project whose value is entirely
in *when* you take it. **Tanning** sits at the root with no prerequisite for the opposite
reason: it is the only line on the tree that makes a *settler* better off rather than the
colony, and a place that has hunted anything at all should be able to get its people into
coats without first inventing the pickaxe.

### The industrial base

The four projects past **Composite plating** are billed in two currencies at once. Points as
usual — and, under each row in `L`, a line of goods: `12 / 180 steel`, green once you have
covered it and amber while you have not. The bill is netted against what is in the yard, so
what you are looking at is the shortfall, not the sticker price.

Nothing is taken until the whole bill can be paid. A settler will grind a third-tier project
all the way to 100 % on credit and it will simply *sit* there, worked out and waiting; the pip
at the top of the screen stops showing a percentage and starts naming what is missing, and the
settler gets up and finds other work, because there is nothing left to do at that bench. Once
the last crate is unloaded the bench goes back on the board, somebody walks over and fits the
parts, and the project and the goods leave the store in the same tick. It is
all-or-nothing on purpose: a bench that nibbled at a part-delivery would leave
you unable to tell a project that is nearly paid for from one that has quietly eaten a hundred
steel and stopped.

Steel you can dig. **Components you cannot.** There is no patch of them on the map, no recipe
at the workbench and no bench that makes them — the middle ring is the only place in the
world that sells them, and a caravan is the only way any arrive in your yard. That is the point of the tier:
the first four projects of the game are paid for with your valley, and the last four are paid
for with the road. A colony that never opened the middle ring has a research tree it can see
the end of and cannot reach.

And the last two rungs are paid for on a *longer* road. **Instruments** and **Waystations**
bill **assemblies** — machinery, listed in the strip at the top as *Rigs* — which no middle-ring
town sells either: the far ring is the only place in the world that has it, nine or ten days
out. So the tier is two roads rather than one, and each is opened by the trade the ring before
it paid for. The last rung is the plainest statement of that shape in the game: `Waystations`
takes nine points off the mishap chance on every road, and it is bought with two trips down
the longest road there is.

Left to itself the colony works this out. The Steward's trade party normally walks to whoever
pays best; a town selling something the bench is short of outbids that, and stops outbidding it
the moment the shortfall is covered. It will not, however, choose a road that is still shut for
you — opening the next ring still outranks fetching parts, because parts cannot be fetched from
behind a gate.

## Morale

The mood bar is the fifth pip on a settler's card, and it is not decoration. Work rate is
multiplied by morale, so a miserable colony builds, cooks, mines and researches about a
third slower than a contented one — and because it multiplies the whole rate rather than
adding to the skill, your best carpenter is the one who loses the most to a bad week.

Mood is full marks minus what the settler is going without: hunger costs the most, then
rest and recreation, with extra penalties for actually hitting empty, being badly hurt, or
being downed. On top of that sits a memory of things that happened, which fades over about
a day:

| Lifts | Sinks |
| --- | --- |
| A cooked meal instead of raw ingredients | Eating raw |
| Eating sat at a table | Sleeping on the ground |
| A research project landing (the whole colony) | A death in the colony (everyone but the deceased) |

Push a settler far enough down and they down tools: the log says so, the card gets a red
**BREAK** tag, the job label reads `stopped working`, and they wander the colony with their
arms hanging until they feel better. A break is survivable by design — they still eat,
sleep and take recreation while it runs, which is precisely what ends it, and it times out
on its own so a colony in real trouble always gets a window to answer. Settlers you are
possessing never break; the first-person view never takes the controls away from you.

The practical version: build the table and the stove early, put real beds under everybody,
and a research bench pays a morale dividend on top of its points. A colony that does those
things never sees a break. One whose pantry runs dry sees several, and gets back to work
about a day after the food does.

## Breaking ground

A growing zone can be painted over anything a settler can walk on, but the ground under it
is not all worth the same. Broken soil grows a crop at full speed; grass runs at four
fifths of that, sand at a little over half, a mined-out quarry floor at two fifths. `N`
marks a cell to be broken — a farmhand walks out with a shovel, spends about half a mining
job on it, and leaves dirt behind.

| Ground | Growth |
| --- | --- |
| dirt (broken soil) | 1.00 |
| grass | 0.80 |
| sand | 0.55 |
| stone | 0.40 |

Soil is the anchor at 1.00 rather than the reward above it, and worldgen lays the kitchen
garden on dirt on every seed. That is deliberate: tilling never makes the plot you started
with better, it brings poor ground *up* to the ground the colony already farms. If it were
the other way round, adding the shovel would have quietly re-tuned every food number in the
game — and differently on each map, since terrain is scattered by seed.

Three things that follow from where the job sits:

- **It is the farm's idle work.** A settler on farm duty harvests first, sows second, and
  only digs when there is nothing ripe and nothing to plant. A shovel order can never be
  the reason a ripe cell went unpicked.
- **The scale is read per cell, not per plot.** A half-broken zone really does ripen in two
  waves, which is the visible reward for having done the digging.
- **You can till under a standing crop.** A farmhand works the beds around the rows.
  Refusing it would deadlock the whole thing, because a bare plot cell is always sown before
  anyone gets round to breaking it.

Ground that is already dirt previews red — there is nothing left there to break. The
Steward digs its own plot too, six cells at a time, so a hands-off colony converges on
full soil within a day or two of widening its garden.

## Laying a floor

`I` marks ground for **plank floor** (3 wood a cell), `O` for **paved floor** (2 steel). A
settler on construction duty carries the material out, kneels on the cell and lays it. Floor
work sits last in the construct queue on purpose: it is the only building job with no
deadline, so a road can never be the reason a wall went up late.

| Ground | Walk speed | What a router pays to cross it |
| --- | --- | --- |
| grass, dirt, stone | 1.00 | 1.00 |
| plank | 1.25 | 0.72 |
| paved | 1.45 | 0.60 |
| bridge | 1.25 | 0.72 |
| frozen lake | 1.00 | 1.15 |

The two columns are not the same number twice. Walk speed is what the boards give back; the
path cost is what A\* is willing to detour for, and it is deliberately the steeper discount —
otherwise settlers cut the diagonal across the grass and the road you paid for goes unused.
The bonus is read from the cell being *left*, and from the same table for a settler on a job
and for your own legs when you are inside a body.

Paving buys one thing boards do not: **fire will not cross it.** A flame on paved ground
spreads only into something that burns, so a paved ring around the woodshed is a firebreak
you can build rather than a disaster you watch. That is the reason to pay steel for ground
that walks barely faster.

A floor is terrain, not furniture, which is why you can lay one under a bed without moving
the bed, why floors save and load with the map, and why crops refuse to grow on one. It also
means there is no un-laying: paving over your planks is how you change your mind.

### The third floor goes over the water

`U` marks a **bridge** — 6 wood a cell, boards on piles, and the only floor in the game that
covers something you cannot stand on. It walks exactly like a plank road, costs twice the
wood and twice the work, and takes water and nothing else: paint it on the grass and the
preview greys out, because a bridge over a field is a plank floor you overpaid for.

The interesting part is how it gets built. Every other order in the game needs somebody able
to reach the cell; a bridge is legal on open lake four cells from any bank, which nobody can
reach at all. So a painted line **builds itself outward from the shore**, one cell at a time
— a settler stands on the last finished deck and leans out over the next — and the reason is
one flag rather than a special case: a bridge cell is worked from *beside* it, and finishing
it is what makes the following cell workable. Paint the whole crossing at once and then watch
it grow across the water.

Two things fall out of that and both are the point. A deck is walkable in July, when the lake
is a wall, so a bridge is the only way to put the far shore inside your colony for good. And
in January, when the ice bears and everything is walkable, settlers still take the bridge —
swept boards beat a lake you pick your way across, so the crossing you built in summer is
still the road home in winter instead of a thing everyone wanders off the side of.

You cannot pave the ice, either, and that is deliberate: the floor tool asks what the ground
*is*, not whether you can currently stand on it. Otherwise a January afternoon would buy you
a permanent steel causeway across open water come April.

## Food goes off

Every stack of raw food and every cooked meal carries a freshness clock, and the clock
runs at the temperature of the cell it is sitting on. Raw food keeps ten days at 20 °C,
meals six — meals go first, on purpose, so cooking the whole pantry the moment it lands
is not simply the right answer. At freezing the clock stops dead.

The top bar shows the outdoor temperature next to the weather. It swings about eleven
degrees either side of the day's mean, and rain, fog and storms pull it down further. That
mean is where [the year](#the-year) comes in: thirteen on the day you land, twenty-two in
midsummer and about minus two in midwinter, so a sack of raw food left in the yard rots in
a fortnight in July and very nearly stops going off in January. Click any building and its
card tells you the temperature of the cell it stands on.

Standing inside four walls damps that swing rather than removing it, which is enough to
keep a week's food and not enough to keep a month's. The answer to a month's is the
**cooler** — 28 steel and 12 wood, and the only building in the game that does nothing at
all outdoors. It chills the room it stands in, all of it, however far the far corner is —
and it chills a small room much harder than a big one, because it has the same heat to
shift either way. The same cooler is a −5 °C freezer in a nine-cell larder and a draught
in the cabin. Its card says `running: yes · 9 cells` once the walls are closed over it,
`no — needs a walled room` when they are not, and `no — no power` when it is walled in
but not wired (see **Power** below — a cooler draws 90 W and is the hungriest thing most
colonies own). Wall off a small room, put the cooler and the stockpile in it, and the
food simply stops ageing.

Two details that stop the system being gamed or being cruel:

- **Merging averages by amount.** Tip a fresh harvest onto an old pile and the pile gets
  younger by exactly the share of it that just arrived — you cannot launder a fortnight-old
  heap by dropping one turnip on it, and a hauler making twenty trips does not reset the
  clock twenty times.
- **Cooks and eaters work oldest-first.** The kitchen reaches for the sack nearest going
  off, and a hungry settler prefers the stack that will not last, so a colony eating what
  it grows never sees a spoil message at all. The rule punishes hoarding, not eating.

**Preserved rations** on the research bench doubles how long meals keep on top of its
nutrition bonus — the project's name finally means something. It deliberately does nothing
for raw food: the answer to a sack of turnips is a cold room, not a recipe.

## Where a hauler puts it down

A stockpile is cells, not a container, and every armful lands on one of them. Which one is
decided in this order:

- **Anything that rots goes below freezing**, however far the walk is. That is the whole
  payoff of the cold room, and it happens without you saying so.
- **Otherwise it tops up a pile that is already there**, as long as the pile is within
  about a stockpile's width of the nearest free cell — and of the piles in reach it feeds
  the fullest one first.
- **Failing both, the nearest free cell wins.**

That middle rule looks like tidiness and is not. Stacks only ever merge inside one cell,
and a bench recipe spends a *single* stack: a rifle is 35 steel out of one pile, not 35
steel out of five. On seed 1337 the colony reached the day-twenty raid holding 101 steel
in piles of 16, 32, 14, 9 and 30 — every miner had dropped on whichever cell was nearest
the vein they came from — with a bench built, every settler on craft priority 3, and its
best shot standing there with no weapon at all. Nothing in the log said why. It now arms
everybody by day thirteen and lives through the raid.

The same run turned up the other half of it: the bench used to pick what the colony most
wanted and stop there, so an impossible rifle sat in front of the medicine it could have
been making all along. It now tries each thing it wants in turn and starts the first one it
can actually make.

## Standing problems

Both of those defects were *silent*. The colony was starving for weapons for twenty days and
the only place it showed was in the body count. The log could not have caught either one: a
log is a history, it says a thing happened once and then scrolls it away.

So there is a second readout, bottom right, that says what is **still true**. It is empty when
nothing is wrong, and it is the only panel that appears and disappears on its own.

Red — somebody could die of this today:

- a fire burning, and where
- hostiles on the map, and how many
- a settler down
- under a day and a half of food
- an illness nobody has treated
- a settler who has stopped working

Amber — this is why people die later:

- a settler close to breaking
- no medicine in the colony
- more settlers than beds
- settlers with nothing to fight with
- the grid short, and how many buildings are dark because of it
- blueprints waiting on a resource the colony does not have

Click a row and it selects whoever it is about and moves the camera to them; an alert you
cannot find is barely an alert. Six show at once — a colony in real trouble can raise a dozen,
and a wall of red reads the same as no alert at all. The rest arrive as the ones above them
clear.

None of it is remembered state. The list is worked out from the world each frame, which is
why an alert can never get stuck on after you have fixed the thing.

## What to do next

"2 settlers unarmed" is a useful sentence if you already know a workbench turns steel into
rifles. If you do not, it is a complaint with no instruction attached. So the alert panel has
a counterpart top right — **Next steps** — that says what to *go and do*, three at a time,
each with the tab the button is on.

Two things make it a curriculum rather than a second alert list:

- **A milestone is sticky.** Alerts vanish with the state that caused them, which is right
  for a nag and wrong for a lesson: a fire that takes the beds should put "beds" back in the
  *alert* panel, not un-teach you what a bed is. Once earned, a milestone stays earned, and
  it lands in the log the moment it does.
- **Three show at once.** Fourteen goals is a wall, and a wall reads the same as nothing.
  The next one appears as the one above it clears.

The fourteen were chosen by measurement, not taste, and the first draft was wrong in an
instructive way. It asked for beds, four days of food, a sown field, ten meals and a weapon
in every hand — and a colony that nobody touched at all ticked **seven of them off inside
the first game day**, because the settler AI does all of that unprompted. That panel was not
teaching the player anything; it was narrating the AI.

So every goal now measures a decision only the player can make — a blueprint, a zone, a
designation, a research project — against the numbers a fresh colony actually starts with:
widen the twelve-square field to thirty, get steel from ninety to two hundred, lay ten
sandbags, drop your first raider, bank a battery, build a cold store, put up a turret,
finish two projects, pave twenty squares, search a ruin, pen an animal, trade, put up a
solar panel, and reach day twenty. `tests/objectives.test.ts` pins the rule from both sides:
a colony left alone for a week earns none of the building goals, and one that lays the
sandbags earns that goal on the tick it finishes them.

That test is also the tripwire on the section below. The paving goal used to count *any*
floor, forty squares of it — and the day the Steward learnt to board the cabin out of the
colony's own wood, an untouched colony started ticking it off unaided and the test went red
on exactly the rule it exists to protect. The fix was to move the goal past the Steward
rather than to teach the test to accept it: boards are the colony's own housekeeping now,
paving is still yours.

### And then seven more, once you have founded the place

The curriculum ends at day twenty, and the research tree used to run dry not long after —
measured across the long runs, the last of the *first fifteen* projects lands on day 37, 43,
45 or 56 depending on the seed, with the rest of a hundred-day charter still to play. A colony
that played well therefore arrived at an empty panel at the exact moment it finally had the
settlers and the steel to be ambitious. The [industrial base](#the-industrial-base) is what now
sits past that day, and it is deliberately priced in the surplus that colony is standing on.

So there is a second half, and it unlocks on the founding: rebuild in stone, a rifle in every
hand, a hundred meals laid in, a hundred squares paved, the whole research tree, a call paid
on all twelve neighbours out to the far ring, and a hundred days. It is gated rather than simply
appended because a list of twenty-one on day one would put "pave a hundred squares" on screen
next to "pave twenty", and because everything in the first half is something a colony that
skips it might *die* of, while nothing in the second half will kill anybody. Those are two
different kinds of list and showing them as one would say they were the same.

None of the late goals send anything back. The three that do fire inside a colony's first
fortnight, where a beat a week is a rhythm; these are weeks apart each, and an encounter that
arrives once a fortnight because of a checklist is not a rhythm, it is a coincidence.

## The Steward

Your settlers will chop, cook, mine, doctor, fight and bury each other on their own
initiative — and then stand in a bare yard for twenty days, because nobody drew a fence.
The **Steward** is the missing half: the colony's own foreman, marking out the next
improvement to the place it lives. It is on by default and there is a `Steward: on` button
in the top bar, because a player who does not want their yard rearranged should find the
off switch in the same second they notice it happening.

Four rules keep it a help rather than a hijack:

- **It only marks.** Nothing in it builds anything. What it produces is exactly what your
  own build bar produces — blueprints and painted designations — hauled and raised by the
  same settlers doing the same work types, and `Backspace` cancels it like anything else.
  There is no second building path to keep in step with the first. The one exception is
  the research bench, below.
- **It waits for a clear board.** Queue *anything* — one blueprint, one painted floor — and
  the Steward proposes nothing until it is standing. Your plan always comes first, and the
  colony never bids against you for materials.
- **It keeps a reserve.** 40 wood and 30 steel, about two walls and a door of each, are
  never spent. A fence can never be the reason you cannot afford the wall you were saving
  for.
- **It is one thing at a time.** One ambition per pass, and the next only once the last is
  up, so you can always tell from the yard what the colony is currently up to.

The order of its ambitions is the design, and it starts with the one that costs nothing:

| | Ambition | When |
| --- | --- | --- |
| 1 | Fell nearby trees, or open a rock face | wood under 80, or steel under 50 |
| 2 | Dig a grave | there is a body in the yard and nowhere to put it |
| 3 | Another bed | somebody is sleeping on the floor |
| 4 | Break ground for the kitchen garden | the plot is smaller than the colony eats, up to 64 cells |
| 5 | Stake out the yard fence | there is a fence line left to lay |
| 6 | Hang a gate in it | the line is 80% up |
| 7 | Build out the grid | more is plugged in than the generators can carry, plus 90 W over |
| 8 | A generator, then a turret | fewer guns than one per three settlers, four at most |
| 9 | Run conduit | something electrical is off the grid |
| 10 | A workbench, then a research bench | it has neither |
| 11 | Board the cabin floor | there are bare cells in the heart room |
| 12 | Somewhere to spend an evening | fewer seats than settlers, plus one |
| 13 | A statue | steel to spare over the float, two at most |
| 14 | Sandbags either side of the gate | something has already come at the colony once |

Restocking is first because a foreman that only knows how to *spend* will hand a colony a
handsome fence and no fuel: the generator burns wood, the cooler runs off the generator, and
the food is in the cooler. A colony that finishes its wall and then eats spoiled meals in the
dark has been managed badly. So before any ambition that costs something, the Steward checks
the shed — and if it is low, the only thing it does that pass is send people out with axes,
within 22 tiles of the cabin and only to trees and faces the region index says they can
actually walk to. `tests/steward.test.ts` plays that out: a colony started below the floor
ends a game day above it, with visibly fewer trees standing than a fresh map of the same
seed.

The boundary comes before the floors on purpose. Boarding a ninety-cell cabin eight tiles at
a time is a fortnight of work that changes nothing you can see from the manager camera; a
fence going up around the yard is the colony visibly becoming a place.

The grid comes before the guns for the same reason the fence comes before the floors: it is
the ambition whose absence you only notice through something else failing. A turret is
visible and a missing watt is not, so left to a simpler ordering the colony buys guns until
the night the freezer goes off — which is precisely what it did, on every seed, until this
sat above `defence`. The shed order in `power.ts` sacrifices the cooler before the turret,
which is the right order to lose things in and the wrong situation to be in.

### The one thing it does that is not a blueprint

The Steward also puts a project on the research bench, and that needs saying out loud
because it is the only line in the module that changes something other than the build board.

It is there because of a measurement. `setProject` — the function that chooses what the
colony is studying — had exactly two callers in the whole game: the eval harness, and a
human clicking the Research panel. Nothing in the simulation itself ever chose one. So a
colony left to run finished ninety days on three separate seeds with `research done 0`,
`current null`, and no bench to have done it at anyway — and with it, everything gated
behind the tree: stone walls, solar panels, the water mill, every crafting recipe, every
yield and growth and treatment bonus in `research.ts`. A whole third of the game was
unreachable unless you happened to find the `L` panel.

It only ever fills a hole. If you have chosen a project, the Steward leaves it alone —
including the progress on it. When one finishes it takes up the next one in the tree's own
order. If you want the bench idle, the `Steward: on` switch is the same switch that stops
it marking fences. And unlike everything else here it is *not* gated on a clear board:
choosing what to study spends nothing and competes with your plan for nobody's time, so a
colony with a fortnight of building queued still gets better at things while it hammers.

## The lake

Somewhere out past the first ring of ore, every map now has water in it.

`water` had been a terrain kind since the first commit and nothing had ever painted a
single cell of it — the build orders refused it, the Steward refused it, the pathfinder
walked round it and the snow declined to lie on it, all for a thing that did not exist. So
the whole feature is a page of worldgen: a rough ellipse of sixty to a hundred and thirty
cells, a ring of sand beach where it meets the ground, and one cell of dry margin kept
between the water and every rock.

That margin is not tidiness. The renderer sinks the lake bed by taking the average of the
cells around each corner of the terrain lattice — the same lattice the snow rides up on —
so a corner in open water drops the full forty-two centimetres and a corner on the shore,
half wet, drops half of it. The middle of the lake comes out flat and the ring around it
comes out as a bank sloping down into the water, and not one line of the mesh knows what a
shoreline is. But a boulder is only buried fifteen centimetres, so a cliff standing on a
corner shared with open water would show daylight under its own base. Keeping the water a
cell clear of rock is what makes that corner impossible to build, which is why
`tests/lake.test.ts` asserts it on every seed rather than leaving it to the eye.

Two more things worth knowing about how it is generated:

- **It draws from its own random stream, and it goes last.** Combat rolls have had their
  own stream since early on for exactly this reason: a new draw from a shared stream is a
  new map. The stream turned out to be only half of it. Carved in the middle of worldgen
  the lake spent no shared rolls and still moved every seed in the game, because it turns
  grass into water and the tree pass rolls once *per grass cell* — a few hundred fewer
  cells is a few hundred fewer rolls, and everything downstream lands somewhere else. A
  private stream stops a pass from taking rolls; it does nothing about a pass changing how
  many rolls somebody else takes. So the lake runs after the last thing that touches the
  shared stream, and in exchange it has to arrive into a furnished map: trees under the
  water and on the new beach are felled, and anything built — and the ground around every
  scout site — is refused rather than cleared. Every tree, ore blob, scout site and settler
  on every seed is exactly where it was before there was any water.
- **It has to prove it costs nothing.** A blob of solid ground dropped on a map can pin a
  bay against the rim and strand whatever was inside it, and you would find out days later
  as a settler who cannot reach the far ore. So the generator flood-fills from the hearth
  before and after, and unless the only cells lost are the ones now underwater, it drains
  the lake and tries somewhere else. Six tries, and then the map simply has no lake — which
  is a fine map, and better than a broken one.

## The year

Twenty days is a year: five each of summer, autumn, winter and spring. The top bar carries
it next to the clock — `Day 7 · Autumn 2/5` — and the season name turns pale blue when it
is winter, because that is the one you need to see from across the room.

You land on the first morning of summer, which is the whole of the design. Ten days of
weather that forgives while you learn the game, five days of visible warning, and then
winter, which is not something the storyteller decided to send you. It has been coming
since the first minute and it arrives on a day you can count to.

What actually moves is one number: the outdoor mean, nine degrees either side of the
annual average. That sounds mild next to the eleven-degree day/night swing it rides on
top of, and it is not, because they compound. Midsummer runs about 22 °C. Midwinter runs
about −2 °C mean, which puts the night at −13 and the warmest hour of the afternoon at
+9. Every system in the two sections below was already reading that number. Nothing new
was added to make winter dangerous; the year just moves the dial they were all wired to.

Three things follow. Crops grow on a temperature band — full speed at 10 °C and above,
nothing at all below 4 °C — so a summer plot runs at exactly the rate it always did, an
autumn plot visibly slows, and **an outdoor plot in winter does not creep along, it
stops**. Food left in the yard nearly stops going off, because cold is what a cold store
is. And a settler outdoors at night in January is in the range that holds their immune
system down, so winter is when the flu goes round.

The answer is a **greenhouse**: a sealed room with a heater in it grows at full speed in
February. Four walls with no fire in them get you about half, which is worth building and
is deliberately not enough — a roof buys you part of a season and the fire buys the rest.
The other answer is a pantry you fill in autumn, and three days before it turns the alert
strip says so, in the shape `Winter in 3 days · 5.2 days of food`. That warning only
appears if something is actually missing: a colony that has a fire and enough food to eat
its way out the far side is told nothing, because it has already answered the question.

You can see it without reading anything. The grass and the leaves carry the year — green
through summer, gold through autumn, washed pale toward frost in midwinter, fresh again
in spring — and it moves continuously rather than snapping over on the day, so the valley
going gold *is* the warning, several days before the strip puts it in words. Nothing
anybody built changes colour: stone, planks and walls sit the same all year, which is
what makes the ground around them read as alive. The map in the corner turns with the
valley — it draws out of the same palette, so it is the same year in both pictures.

And the sky turns with it. A front does not know what month it is — the thermometer
decides what falls out of it, so the same low that sweeps rain across the clearing in July
arrives in January as **snow**, and somewhere in between as sleet. That is not a repaint.
Rain is the only thing in the game that ripens a plot faster and very nearly the only
thing that puts a fire out for you; snow does neither. It waters nothing, and it smothers
a fire at about a third the rate, so **a blaze in a winter storm is a genuinely worse
emergency than the same blaze in a summer one** — the weather you were relying on has
turned into the weather you are fighting through. The HUD says `Snow` or `Blizzard`
rather than `Rain` or `Storm`, and the message log names what is actually coming down.
The flakes fall at a sixth the speed of rain, barely streak, wander on the way, and blow
much further sideways on the same wind; it costs the same one draw call, because it is the
same buffer with five uniforms moved.

**And it lies.** Falling snow is weather and it is gone when the front moves on; snow on
the ground is a state the valley is in. It builds over about half a day of unbroken
blizzard, it stays there for days after the sky clears, and it goes only when the thaw
comes — so the map turning white is not a storm, it is *the month*, and you can read what
time of year it is off the valley without looking at the clock. The corner map turns with
it for the same reason it turns gold in autumn: one palette, two pictures.

It costs you a third of your walking speed at its deepest, and there is exactly one ground
it does not settle on — **the ground somebody built**. Boards and paving stay clear.
That turns a floor from a small speed bonus into the answer to a season: a colony that
spent its autumn paving the run between the cabin, the stove and the woodpile keeps working
through February while its neighbour wades. The pathfinder is told the same thing the legs
are — the snow cost A\* pays is the walking penalty rearranged, not a second opinion about
it — so a settler *reroutes* onto your road when the short way goes under, and the paving
you laid in autumn changes where people walk without anybody re-planning anything. The
settlers and the body you are possessing ask one function for how fast the ground is, so
the drift that slows your haulers slows you, on the same cell. One global depth rather than
thirty-seven thousand floats, which is why it costs nothing in the save file and nothing per
tick.

And it has depth you can see. The pack lifts the ground it lies on by about thirteen
centimetres — far too shallow to stand on, and enough to change everything about how the
valley reads. It catches the light on the slope where it runs down into a path, so a plank
walk in deep snow sits in a visible trench. It laps up the foot of every wall, crate and
tree. It puts a settler's boots *in* it, ankle deep, which is what makes the yard look cold
rather than bleached. The lift rides the same corner lattice as the colour, so neighbouring
cells cannot open a crack between them, and it goes flat again with the thaw.

## The lake freezes

The lake is the one piece of the map that is permanently in the way — ground you cannot
build on, cannot cross, and walk round all year. For six days a year it stops being that.

It thickens off the **season mean**, not the thermometer, for the reason a lake is not a
puddle: three cold hours before dawn in September do not freeze a body of water, and reading
the instantaneous air temperature would have the surface skinning over and opening again
every night of autumn. The month's average is the closest thing this sim has to the
temperature of a large cold object, and it moves at the speed ice actually moves at. That
puts the crossing open from the middle of winter to the middle of spring, every seed, every
time. Between one degree and three there is a deliberate hold where the lake keeps whatever
it has, so a surface sitting at the turn of the season does not flicker between road and
wall for a whole day. It is one number for the whole lake — a per-cell ice field would let
one end bear and the other not, which is more physics than anybody asked for — so it costs
one optional field in the save and nothing per tick.

**It is a road for everyone.** Frozen water goes through `isSolid`, which is the one gate
the planner, a settler's legs, the first-person collision capsule and every raider's
approach all ask. So the shortcut is not a settler perk: a raid that would have come the
long way in July walks straight over the lake in January, and a colony that sited its
turrets against the summer map finds out the hard way. None of that was written. It falls
out of there being one answer to "can something be here". Crossing costs a little above
paving and a long way below the drifts, so it is picked *across* rather than strolled over.

**It is a road and never real estate.** A stockpile or a pen painted out on the ice is a
pile of steel floating in a lake come April, so both painters refuse water outright, the
same way blueprints always have.

**It has a deadline, and it says so.** The thaw announces itself in the log a good while
before it can hurt anybody — measured at 1,756 ticks, about a minute and a half of play,
which is time to notice the line, find whoever is out there and walk them in from anywhere
on the map. Then it goes. Anyone still standing on the water is put on the nearest bank
with a case of flu, which is an illness this game can kill you with. So are the corpses, and
so is anything left lying out there — because a body under the water is a burial job nobody
can path to and a pile of steel out there is a haul job retried forever, and a hazard that
leaves the world in a state the AI cannot resolve is a bug wearing a hazard's coat.

The picture and the collision reach the same conclusion on the same tick, which is the rule
this whole project runs on: the renderer lifts the lake bed by exactly the fraction of its
depth that the ice has made, so the bowl comes up level with the sand on the exact tick the
surface starts bearing weight. A settler steps onto a flat white plain rather than out over
a hole. The colour lifts with it — a cold blue-white that is deliberately not the same white
as the snow lying on the bank, so you can still see where the shore is.

## The lake feeds you

Winter in this valley is a food problem. The crops stop, the stores run down, and until now
the only two answers were "hunted enough in autumn" and "built a freezer" — both decisions
made in a different season by a player who already knew what was coming. Fishing is an
answer you can reach for *during* the emergency, which is the difference between a hard
winter and one that was lost three weeks ago.

Twelve wood buys a **fishing stage**: a plank deck out over the shore, in the Production
group at the end, because it is the one building that cannot go just anywhere. It has to
have water orthogonally beside it. The drag preview greys out the entire map except the
shoreline, and it does that without the UI knowing anything about lakes — the rule lives in
the same `canPlace` gate the research locks and the doorway check go through, so every
route to a blueprint enforces it for free.

The deck is walkable, not solid. The fisher stands **on** it rather than beside it, which
is why the catch lands on the plank where a hauler can reach it instead of in the water.
What comes up is plain `rawfood` — no new resource, no new save field — so it spoils, gets
hauled, and gets cooked by the machinery that was already there.

Three things stop it being a food printer.

**The lake runs out.** One stock for the whole body of water, full to empty, drawn down by
every catch. Six stages on the shore do not make six lakes; they make one lake emptied six
times as fast. Twenty-five catches flatten it, and the yield thins as it goes — so you can
*see* the consequence in the size of each catch before the stage goes quiet. It grows back
over about four days, which makes over-fishing a mistake you can come back from rather than
a map you have ruined. Shutting and reopening are two different lines, deliberately: one
line would put the colony back on the shore the moment the stock crept a hair over it, where
a single catch costs more than half a day of regrowth, and the player would be told the bad
news every few seconds for the rest of the game.

**It only happens when it is needed.** Settlers fish when the larder is thin, the same way
they cook when it is empty — a colony with a full pantry leaves the lake alone, which is
what lets the stock recover, and what puts the fish there on the day it actually matters. It
sits at the bottom of the **hunt** work column rather than getting a column of its own,
because it is the same instinct — go and get food that is not on the farm — and a marked
animal outranks it, since that is a standing order the player typed and the lake is the
colony's own idea.

**Winter charges for it.** Once the ice bears weight there is a foot of it in the way and a
catch takes most of twice as long. Still an answer, just a slower one, which is the right
shape for a thing you fall back on. That threshold is the same `iceBears` the pathfinder
asks, so the day the crossing opens is the day fishing gets hard — the player has one fact
to learn about the lake, not two.

## Warmth

A **room** is any run of floor the game can walk around without stepping over a wall — the
cabin is one, a larder you wall off out of its corner is another, and the yard is not a
room at all. Click anything and its card names the room it stands in: `99 cells · 1 door`.
That line is the number every climate machine in the game is divided by.

Each room holds its own air, and it holds it *slowly*. Light a fire and you watch the
number climb over the next game-hour; leave a freezer door in a wall and you pay for it all
afternoon. Two things set where a room ends up:

- **How well it seals.** Every wall edge holds heat in and every door edge leaks about
  three walls' worth, open or shut — that is the draught, not the swing, so settlers coming
  and going all day do not make the temperature flap. The starter cabin has 39 walls and
  one door and rides out an ordinary night without a fire. Knock three more doorways in it
  and you will feel it.
- **How big it is.** A machine has the same heat to give whatever room it is in, so it is
  spread over as many cells as you built. A cooler in a nine-cell larder is a freezer; the
  same cooler in the 99-cell cabin makes the cabin chilly.

Two things push the other way. A **campfire** is 20 wood and no steel, because it is the
answer to a cold night on day one, before there is a grid to plug anything into. It feeds
itself from the loose woodpile one log at a time and only lights when its room has actually
gone cold, so a fire in high summer costs nothing — and it lights the room while it burns,
which is a lamp you did not have to wire. A **heater** is 22 steel, 8 wood and 60 W, holds
its room at 22 °C, and never asks anybody to carry anything.

What the cold actually does to a settler is on their card, next to the mood: `warmth
4°C · cold`. Nobody takes damage from ordinary weather — an invisible frost drain is the
least readable thing a colony sim can do to you — but being cold sits on your mood every
hour it lasts, and it holds your immune system down while it does. A settler who spends a
storm night in the open catches the flu inside a few days; the same settler by a fire does
not. That is the point of the whole system: **a cold night is how you catch something, not
a die roll**, and four walls and a fire are the answer you can see working.

The worst air in the game is usually the air you built: a −5 °C larder is the bottom of
the scale, so a hauler who lives in the cold store is as miserable and as catchable as one
left out in a storm. The card says `freezing` in red either way.

## Power

Four things in this colony run on electricity: the lamps, the cooler, the turrets and —
the moment you build one — anything else that plugs in. None of them run on nothing.

**A wood generator** (30 wood, 10 steel) makes 240 W and eats a log every forty-five
seconds it is actually lit. It only lights when the grid is short, so a generator on a
quiet afternoon costs you nothing; a generator carrying a cooler through the night costs
you a tree a day. That is the whole economy of the system — power is wood, spent slowly.

**Power flows through walls, doors and conduit, and not through fences.** A machine standing
with its back to a wall is already wired. A machine out in the yard needs **conduit** — one
steel a cell, flat enough to walk over, and it is the only thing on the build bar you will
ever want a dozen of. Your starting cabin ships with a generator in the north-west corner
and a short run of wire along the skirting to each lamp, so the first thing you see is a
grid that already works and a pattern worth copying.

**A battery bank** (25 steel, 8 wood) stores the surplus and pays it back when the grid comes
up short — the difference between a cooler that rides out a lull and one that thaws.
**A solar panel** (40 steel, needs *Solar cells*) makes up to 200 W of free daylight and
exactly nothing after dark, which is what the battery is for.

**A watermill** (55 wood, 20 steel, needs *Machining*) makes 150 W and keeps making it at
four in the morning in the rain, with nobody hauling anything to it. It is the flattest
line on the grid: less than a generator at full tilt, less than a panel at noon, and more
than either of them averaged over a week. Two things are the price. The first is that it
has to stand **on the shore** — the same rule the fishing stage goes through, so the drag
preview greys out the whole map except the water's edge — and the wire back to the cabin
is your problem. The second is winter.

**When the lake sets, the wheel stops.** Not slowly and not partly: the mill reads the same
ice the pathfinder does, so the tick a settler can walk across the lake is the tick 150 W
leaves your grid. The log says so once, the wheel visibly stops turning, and the machine's
card reads `wheel — locked in the ice` rather than a bare `0 W`, because a mill waiting for
spring and a mill that is broken want different answers out of you. It comes back on the
thaw, and says that too.

That is the shape of the decision: a mill is the cheapest power you will ever run and it
goes away for exactly the six weeks your heaters need it most. Build one, keep the
generator, and put a battery between them.

When demand outruns supply the grid does not fail all at once. It sheds, in this order:

1. **Lamps** — the thing a colony can live without.
2. **Heaters** — a cold room is miserable, but a warm room with no food in it is worse.
3. **Coolers** — newest first, because you built the older one for a reason.
4. **Turrets** — last, always. A gun going quiet is how colonies die.

The top bar grows a `power` reading the moment anything electrical exists — made, drawn,
and what the batteries are holding — and turns red the tick something switches itself off.
Anything unpowered goes visibly dull in the colony view with a small amber mark floating
over it, and the log tells you once, plainly, that the grid is short. Click any machine and
its card says what it draws and whether it is getting it; click a generator and it tells you
roughly how many hours of wood are left in the firebox.

The failure you will actually meet is not a blackout. It is a woodpile that ran out at 3am
while a generator was carrying a full cold store — so the fix is usually more wood, not more
generator.

## The ground you make expensive

A turret costs steel you do not have on day one, and steel is on the far side of a mining
job that takes a settler off the food supply. A **deadfall trap** costs twelve wood. That is
the whole point of it: it is the defence a colony can build on its first afternoon, out of
the material it is already standing in a forest of.

A trap is not solid and is not cover. It changes nothing about the grid — a raider walks
over one because it is the shortest way to your people, not because anything herded them
onto it. So a trap on its own does very little, and a trap in the one gap in your fence
does a great deal. **You are not buying a weapon, you are buying the right to decide where
an attack has to walk.** Fence off three sides of the yard, leave one gate, and line the
approach.

Two rules, and they are both deliberate:

- **Only hostiles spring one.** Your own haulers walk their own killbox all day and nothing
  happens — they built the things and know where they are. The alternative is a chance to
  maim your own carpenter on a route the pathfinder chose, which is a failure you cannot
  see coming and cannot plan around, in exchange for no decision you would make
  differently.
- **A sprung trap is a blueprint again, not a wreck.** It costs its twelve wood a second
  time and somebody has to walk out and re-arm it, but the cell never stops being a trap.
  A corridor you drew once is a corridor you drew, and you never re-draw it after a raid.

The price is real: twelve wood, a hundred and ten work, it burns like everything else made
of timber, and it fires exactly once for fifty-five to eighty-five damage — enough to put a
raider on the ground, short of reliably killing one. Two settlers with rifles behind
sandbags will beat a raid more cleanly. A trap is what you have instead, and what you put
in front of the sandbags once you have them.

`tests/traps.test.ts` runs the whole thing end to end: a club raider walking at a pinned
colonist across open ground is caught, the colony re-arms the trap by itself given wood,
and a settler crossing that same armed trap on an errand arrives unhurt with it still armed.

## What the raid does about your defences

A raid used to walk past everything. It picked the nearest living settler and headed for
them, and anything the colony had built was scenery on the way — which meant a single
powered turret won every raid in the game, unaided, for the rest of the game, and the only
question a defence ever asked was "have you got thirty steel yet".

Raiders now do two things a person would.

**They answer the gun.** Whichever is nearer — the settler or a live turret with a line to
them — is the thing they shoot. A round aimed at a machine stops on that machine, which is
new: a turret is chest-high, so ordinary fire flies straight over the cell it stands on, and
that is exactly right for a shot aimed at the cook and exactly wrong for a shot aimed at the
turret. Two consequences follow, and both are the point:

- **A turret is a consumable now.** 160 hit points against a rifle is about eleven landed
  rounds. It will win you the fight, then be a smoking cell and a 30-steel rebuild on the
  job board. Emplacements are how you spend steel to buy a raid, not how you stop needing to
  think about raids.
- **An unpowered turret is invisible to them.** They walk past it, because a brownout should
  cost you the gun's fire and not also hand you ten free seconds of raiders demolishing a
  box. You find out your grid is short from the log, or from the raiders.

**They take cover.** A rifleman who is comfortably in range no longer stands wherever that
happened to leave them. If there is something solid within a few paces with a firing
position behind it, they walk to it and shoot from there — the same directional hard-cover
rule your own settlers get, so a sandbag line only helps against the fire it actually faces.
Flanking works on them and works on you. With nothing to get behind they stand and trade,
which is the old behaviour and still the right one on bare ground.

The practical upshot for the player: a killbox is no longer a fixed cost you pay once.
Sandbags in front of your firing line are worth more than sandbags around your turret, a
second turret matters because the first one dies, and the ground either side of your gate is
now ground the raid can use too.

**And so do your settlers, when you have not drafted them.** Cover is a property of the
ground, not of the faction standing on it, so the moment raiders started using it a colony
that stood in the open through every ambush read as broken. An undrafted settler with a gun
now gives ground *to* something: the steps cost the same and half the incoming fire stops at
the sandbag. One with nothing to shoot back with still just runs, which is the correct
answer for an unarmed cook.

A **drafted** settler does not do this. They hold exactly where you put them. Drafting means
you own the position, and a drafted pawn that drifted two cells to somewhere it liked better
would dismantle a killbox from the inside.

`tests/raider-tactics.test.ts` pins all of it — twelve tests, ending with three raiders and
one turret run through the real tick until the gun is gone and the rebuild is booked.

## The Ashbound learn

For the first stretch of a game the raids scale off a clock. Beat one is a single
club-armed straggler — a lesson, not an execution — and every beat after it is a little
bigger and a little better armed, until the tenth, where the band tops out at six and the
raider stat line tops out with it. Nothing after that ever moves again.

That was measured, not guessed. A hundred days of seed 20260729, played by the Steward:
fifty beats fired, and across the whole run the colony took **three trips to a sick bed and
buried nobody** — none at all before day fifty. It finished with twenty-two settlers, twelve
rifles and four turrets, meeting on day ninety exactly what it had met on day twenty.

So the Ashbound started paying attention. Win a fight without a single settler hitting the
ground and they take note; do it three times running and the next band comes harder — more
of them, tougher, more of them carrying rifles. Four rungs, and the top one is ten raiders
rather than six. It counts every fight, not only raids: a colony that puts a predator pack
down without a scratch is a colony word gets round about.

Anybody going down resets the streak to nothing, and so does a funeral. That is the whole
balancing mechanism, and it is deliberately the opposite of scaling on what the colony owns.
Wealth scaling punishes you for building the things the first thirty days spent teaching you
to build, and every player who works that out starts playing poor. The only way to keep this
ladder short is to keep taking casualties — which is not a strategy, it is the losing
condition arriving slowly.

Every rung announces itself. A rider watching the yard from the ridge, war-bands massing on
the moor, a price on the colony: if the raids got harder, the game said so first. A
difficulty curve the player cannot see is one they experience as the game cheating.

## Rebuilding what you lose

Anything the colony finished building and then lost to fire or gunfire is put back. The log
says so once — *"Wood generator destroyed — it will be rebuilt"* — and a blueprint appears on
the cell it stood on. From there it is an ordinary blueprint: it costs the same materials
again, somebody has to haul them and stand there working, and `Backspace` on the cell waves
it off if you would rather leave the gap.

The blueprint waits for the cell to be worth standing on. It will not appear while that cell
is still burning, and it will not appear within eight cells of a raider who is still on their
feet — a settler goes to the nearest blueprint and works in the open, so patching a breach
mid-firefight is how you lose a carpenter. The intent is held until the fire is out and the
shooting has moved on, then the wall goes back up.

**What you took down on purpose stays down.** Deconstruction and the cancel tool never form
an intent, so tearing out your own wall is not undone a second later. Only damage does.

This is the difference between a colony you can leave alone and one you cannot. On seed 1337
the generator caught fire on day four; before this, that colony ran the remaining twenty days
in the dark with a cooler full of rotting meat. It now loses power for about fourteen hours.

## When the fire reaches you

Sleeping through danger was already handled — a settler in bed wakes if a hostile comes
within twelve cells. Fire was simply not counted as danger, and on seed 1337 a storm-lit
blaze reached the bunk room after midnight on day twenty-one and burned four settlers where
they lay, two of them flu patients in the sickbay. None of them woke up. The colony went
from six to three in under a minute.

Standing in a fire now interrupts whatever you were doing, and there are two versions of it:

- **You can walk.** You wake up, drop the job, and run for the nearest ground that is not
  alight — *"Sela wakes with the bed alight."* This outranks the priority table: no column
  means "stand in the fire". A drafted settler gets a move order instead of a job, so they
  keep shooting on the way out.
- **You cannot.** A downed settler has no way out on their own — this is exactly what the
  sickbay put two people in. The nearest pair of free hands with any firefight priority at
  all comes and carries them clear: *"Wren runs for Halle, who is down in the fire."* One
  rescuer goes, not four, and a doctor who was walking over to treat them where they lay is
  called off first — first aid on a burning patient is not first aid.

The one settler nobody steers is the one you are standing in. In first person you can see
the flames yourself, and taking the controls away would be a worse bug than the one this
fixed.

## Keeping animals

Mossbacks and dunhares graze the map from the first minute, and `H` over a herd has always
been the fastest food in the game — but it is food you *spend*. Every animal shot is one
fewer on the map, and the map only refills them on a slow respawn clock. A pen is the other
half of that trade: coax one in instead of shooting it and the supply starts growing back.

Paint a pen with `Y` — anywhere a settler can walk — then press `K` and click a grazing
animal. A farmhand walks out, spends about four times a sowing job talking it round, and
from then on it lives in the pen. Two rules carry the whole feature:

- **The pen is the zone, not the fence.** Tame animals wander their pen and get walked back
  when they stray out of it. `fence` (3 wood a rail) is a real building you can raise around
  the zone and it will stop a raider's body — it just is not what holds the goats in. If
  containment were the rails, every pen would need a gate the herd could walk straight
  through, and a pen would be a pathfinding trick instead of an order.
- **A pen feeds what it has room for.** Six cells per head. A pair with room breeds about
  every two days; a full pen stops. The pen card and the message on painting both tell you
  the capacity, so growing the herd is a decision you make with a paintbrush.

### It takes two, and they take time

Every animal in the world is a ♀ or a ♂ — the inspect panel says which before you spend a
farmhand's day on it. A pen wants one of each of the same species; two males is a pen that
will never pay, and rather than leave you to work that out over a barren week the colony
says so out loud after half a day and once a day after that.

A calf is born small and grows for three game days. You can watch it happen — it comes into
the pen at under half the size of its dam and fills out — and until it is grown it is worth
a quarter of a body on the ground and cannot be half of the next pair. That is the whole
reason to keep the pen rather than farm it: three days to grow against two days to breed
means the herd you have this week is the one you tamed, and the one you bred is next
week's. Slaughtering the calf the afternoon it arrives is a decision the game will let you
make and then charge you for.

### Nothing here lives forever

A mossback lives about forty days, a fenwolf thirty, a dunhare twenty-two — a game year is
twenty days, so that is two years, eighteen months, and a bit over one. The inspect panel
gives an animal's age in days, and once it is three quarters of the way through, it says
*past breeding* and how long it has left.

An animal that dies of old age in the pen leaves a hide and nothing anybody will eat, and
the colony says so. That is the entire cost of leaving it too long, and it is the reason a
pen is husbandry rather than a machine: the pair you tamed will stop, so the herd only
carries on if you kept a calf back instead of eating it. If every animal of a species in
the pen is past it, the colony tells you that too — the fix is new blood, not more pen.

Out on the moor old age is quieter. A wild animal that reaches the end of its years simply
is not there the next time you look; there is no carcass on the grass. A valley that left a
free meal lying about every time a hare turned three would be a pantry you could walk out
and find, which is the opposite of what hunting is for. Every animal that walks onto the map
is somewhere between newly grown and middle-aged, never a calf and never about to drop, so
the herd you meet in your first hour behaves exactly as it always did.

Slaughter is the hunt tool: `H` on your own animal butchers it where it stands rather than
sending anyone stalking, because a penned animal does not need stalking. That is also why a
tame animal marked for the table stops being walked home — a butcher chasing a beast that is
being leashed away from him at nearly his own pace turns a slaughter into a week's walk.

Set against a crop, livestock is slower and dearer and it does not care about the weather.
A mossback is 34 raw food, near a fortnight of one settler's eating, for a day of one
farmhand's life and no water, no soil and no season. The Steward keeps three head once the
colony is four strong and has a hundred and fifty food banked, culls everything above a
breeding pair, and in a famine eats the pair as well — a colony with no next month has no
use for breeding stock.

## The one you keep

The first animal a settler tames is theirs. Not a roll — theirs, every time, because hiding
a delight behind a 45% chance makes it something that happens *to* you instead of something
you can go and do. It gets a name off the colony's own list, a small teal tag on its collar,
and a line on the settler's card: *their animal — Biscuit, mossback, at their heel*.

A bonded animal stops being livestock in every way that matters:

- **It follows its person, not a pen.** It routes rather than aims, so it comes through the
  door after you, up the stairs of your base and out across the map — and it trots, because
  both species graze slower than a settler walks and a pet that got left behind on the first
  walk would be a pet nobody kept. Lose it in a crowd and it breaks into a run to catch up.
- **Nobody eats it.** `H` on somebody's animal is refused out loud and names whose it is —
  from the inspector or from a drag of the hunt tool across a full yard, because both go
  through the same door. When it dies, no meat and no hide: that is the cost, and you paid
  it on the day you tamed it. It also does not count against the pen's carrying capacity,
  since it is never standing in the pen.
- **It is felt when it goes.** A headline in the log naming both of them, real grief on the
  settler's mood, and a line in their life story they keep for the rest of the game.

Having one alive is worth a little mood every day it lives. Losing one is charged once, as
grief, and never as a permanent deficit — a settler who lost an animal is not worse off
forever than one who never had the chance. If you bonded the wrong animal, **Let go** on its
card gives it back to the herd and costs a pang; the settler is then free to take another.

## What comes for the herd

A pen used to be a number that only went up: paint the zone, tame a mossback, wait. The
fenwolves are the other side of that. Every so often three to six of them come down off the
moor, and the message says exactly what they are — *they are after the animals, not you*.

They are deliberately not a raid, and everything about them is that refusal:

- **They do not come for your settlers.** A wolf walks straight past somebody and keeps
  going, because what it wants is standing out in the yard. Drafting everybody into the
  doorway answers nothing. What answers it is somebody with a rifle who is free to walk out
  there — which makes "who is not busy right now" your actual defence.
- **They cannot be tamed.** Marking one is refused. There is no bag of feed that turns the
  problem into six more pets.
- **They eat what they kill.** No meat and no hide on the ground where a wolf brought
  something down. If they left a pile of food, leaving them to it would be the correct play.
- **They move on.** About a day and a half of hunting and the survivors walk off the map.
  What they took in that time is the price of not having noticed.

The pack is the *visit*. It is not the only wolf in the valley — there are two or three pairs
living out on the moor from the day the world is made, hunting deer and squirrels and each other's
territory whether or not you ever see them ([The moor without you in it](#the-moor-without-you-in-it)).
Those ones do not leave, because they are not visiting. If you build your pens out near the rim
you are building them in somebody's larder.

You are told without having to be looking at the right corner: a wolf that comes in among
the buildings, or stands in a pen, is marked for the hunters on its own. It prefers the pen
to the woods, it is faster than a winded mossback and slower than a fresh one — so a kill is
a real chase with an ending — and yes, it can take the animal that had a name.

## The pen that holds

There is an answer that is not a rifle, and it is the one you were already building: **a
door is a wall to anything that cannot work a latch.**

Wall a pen, hang a gate, and the pack has no way in. Your people walk through it all day.
So do your goats and your dog — anything the colony is answerable for keeps the run of the
place, or a handler would be shut out of the pen they had just walked their animal into.
Only what came in off the moor is stopped, and it is stopped everywhere at once: a wolf
finds no route through a gate, and if you push it against one it does not slide through
anyway. That equality is the point. What you watch instead is the pack working its way
along the fence line looking for the gap, which is both the truth and the best possible
advertisement for the wall you just paid for.

Three things follow, and all three are things you can plan around:

- **One missing wall cell is the whole difference.** They will find it. A pen is only shut
  when it is actually shut, and the run they take through the hole is the same run they
  would have taken through the open field.
- **They still come — they just get nothing.** The pack is not called off by a wall. It
  walks in, aims at the yard, and ends the night at the fence with nothing to show for it.
  A night where the wolves came and left empty is the wall being paid for in front of you,
  which is worth more than a night where nothing happened.
- **Deadfalls fire on wolves.** They always spared your own people and always caught
  raiders; now they catch anything that came to take something from you, and a deadfall is
  55 damage against a fenwolf's 44. They still ignore a grazing mossback, so a trap line
  across the approach is not a thing you have to disarm before the map is allowed to have
  deer on it. A gate with two deadfalls in front of it is a complete answer to a pack, for
  the price of some wood.

Doors also stopped swinging open for wildlife, which is the same rule seen from the
outside: a door that opened for a fenwolf would be showing you the opposite of what the
grid is about to tell it.

## The wood grows back

Everything else in this valley renews. Brambles fruit again six days after they are picked,
a fished-out shallow refills, a crop comes round with the year. The forest did not: two and
a half thousand trees were laid down when the map was drawn and that was the entire supply
for the rest of the game.

Which is fine for a week and is a slow disaster over a season. An unattended colony on the
opening seed cut every tree inside the Steward's reach by **day eighty-five** and finished
the run sitting at zero wood with fifteen settlers and three hundred buildings — not
starving, not raided, just quietly unable to put up another wall for the rest of its life.

So a gap next to a wood grows a tree, under three rules that are all *local*:

- **Seed rain.** Nothing sprouts unless a grown tree is standing within three paces. Seed
  falls near the parent, so a wood creeps out from its own edge instead of appearing in the
  middle of a meadow — and a seedling cannot seed, or one sapling would fill the map.
- **Crowding.** Eight trees already inside two cells and it is a wood, not a gap. Eight is
  measured off the generator, not chosen: a fresh valley carries a mean of 7.8 trees in the
  twenty-five cells around each of its own, so a gap that fills to eight has filled back to
  the density the map was drawn at.
- **Clearance.** Nothing roots within four cells of anything you built, finished or still a
  blueprint. A pine coming up through the kitchen floor is not ecology, it is a chore.

Between them those need no global decision about where the colony is: the cells that qualify
are exactly the holes you cut, so the regrowth finds your logged ring on its own. The one
valley-wide number is a ceiling, set at the density the generator draws at — which makes
this **replacement rather than growth**. An untouched valley is already full and grows
nothing at all. Every tree that comes back is one that was taken.

A seedling is not a windfall. It is visibly small, it is solid ground you cannot walk
through, and felling it pays a seedling's worth of wood — about one log against a grown
tree's twenty-four. Without that last part the whole thing is free money: you chop the
sapling the morning after it sprouts, bank the full load, and the valley is exactly as
exhaustible as it was before with one more step in the loop. It takes about a fortnight of
ordinary weather to become timber, and none of that fortnight happens in winter.

Fourteen days is a long time to wait for a wall, and that is the other half of the answer.
The Steward now marks its logs in **widening rings** — twenty-two cells, then thirty-two,
then forty-four — trying each only when the one inside it came back empty. A near wood
still keeps the colony compact, because a ring that finds trees never widens. But the first
ring running out is no longer the foreman concluding that the valley is empty.

## The moor eats before you do

The bramblebushes your foragers pick are not put there for you. They are the bottom of a
chain that runs without asking, and the animals on the map are reading it long before you
get round to it.

- **Brambletails live on the fruit.** The squirrels do not graze grass like the deer and
  the hares; they walk to a ripe bush, eat it back to bare wood, and go and find another.
  Their numbers are a reading of how much fruit the valley is carrying, not a number the
  game holds steady — roughly one squirrel for every ten bushes standing.
- **Fenwolves live on them.** A pack that comes down off the moor will take a brambletail
  as readily as a mossback, and mostly does, because the squirrels are the ones out in the
  open on the fruit.
- **You are the fourth thing at the table.** Every bush you strip is one a squirrel does
  not get. Foraging a patch flat in autumn is a decision about how many brambletails are
  alive in winter, whether or not you meant it to be.

So the moor moves. Play the opening fortnight and watch it: eleven squirrels at landfall,
fourteen or fifteen by the end of the first week because the fruit is good, then a moor
stripped bare around day ten and the numbers falling with it. That part is the chain
working. Boom, overshoot, starve back — you are meant to see it.

What has to happen next is that they come back, and for a long time they did not. A valley
would reach day forty with the brambles ripe as far as you could see and **one squirrel** on
the whole map, standing in the middle of more food than it could eat, unable to pair with
anything. It looked like a beautiful map. It was a species that had quietly ended.

They come back now. On the opening seed, day forty used to be one brambletail and a hundred
and twenty-one untouched bushes; it is now eight brambletails and a moor you can see has
been grazed. If they are ever down to a single animal on ground that could still feed a
few, one walks in off the map edge — and only then, and only while there is fruit standing
for it. Strip the moor bare and nothing arrives, because their numbers are supposed to be a
reading of the valley's fruit and not of a clock.

## The moor without you in it

Here is a way to find out whether a food chain is real: take the colony out of the world and
see whether anything is still alive in three years.

`npm run eco` does exactly that. It generates a valley, lifts the entire landing party out of
it — settlers, cabin, stockpiles, the lot, keeping the trees because trees are terrain as far as
a deer is concerned — and then runs the same twenty-hertz tick the browser runs, for a thousand
days, counting the animals every night. Nothing is modelled or approximated: it is the game,
with nobody in it.

The first time it ran, it failed twice.

**The squirrels were on life support.** Brambletails sat between two and six for a thousand
days against fruit that would carry thirty-four, with ninety per cent of the moor's berries
standing untouched. Not starvation — loneliness. A brambletail looks for a mate within twenty
cells, which on the old ninety-six-cell map was a decent chunk of the world and on this one is
three per cent of it. They were dying of old age at sixteen days having never met another
squirrel, and every animal alive on day five hundred had walked in on the immigration trickle.
Now a fed adult with no mate nearby will *go and look* — up to ninety cells, and only when it is
not hungry, because eating always wins. Brambletails went from a flat five to a real cycle: three
animals, then thirty-four, then the hedges stripped bare and back down to three.

**And the top of the chain was not in the world.** Fenwolves only ever existed as the pack that
comes down at your pens and goes home afterwards — which meant a valley with no colony in it had
no predation in it at all, and a valley with one had predators only when the storyteller
remembered. There are wolves living out there now. They breed off what they kill, they starve
without it, and how many the moor carries is worked out in *meat* rather than in heads, because a
three-kilo squirrel is not a thirty-four-kilo mossback and a ceiling that pretends otherwise
rises and falls with squirrel booms. A full moor carries about five.

A thousand days later the valley looks like this: mossbacks around thirty, hares around
twenty-four, wolves between two and five, and squirrels swinging between three and thirty-odd
as they eat the hedges flat and let them grow back. Nobody goes extinct. Nothing runs away.

Then the settlers land in the middle of it, and they are the disruption — which is the point.
`tests/ecosystem.test.ts` settles a valley for twenty-five days with nobody in it, drops the
landing party in exactly where worldgen put them, and keeps counting: the moor has to end up
visibly disturbed and still standing. Every bush your foragers strip, every mossback your
hunters drop and every fence you run across a game trail is a change to something that was
already working before you got there.

## Does the game ever actually do this?

There is a kind of bug that no ordinary test can see, and it cost this project a whole
feature before anyone noticed.

Two settlers pair off when their opinion of each other crosses a line and holds. Twenty-nine
tests cover it — the line, the clock, the widowing, the mourning — and every one of them sets
the opinion itself, because that is how you test a rule. Then the social model learned
diminishing returns, and the highest opinion an ordinary colony could reach fell below the
line. The rule was still perfectly correct. The state it described had simply stopped
occurring. Ninety days of three colonies produced **zero** pairings on every seed, and the
suite stayed entirely green, because a test that constructs the state it asserts on cannot
tell you whether the game ever produces that state.

`npm run live` is the other half. It runs a real colony — no orders, no mocks, `createWorld`
to day ninety through the same twenty-hertz tick the browser calls — and takes a census of
what actually happened: the day the first friendship formed, the first pair, the first
research project, the first milestone, the first raid, the first scouted site. Anything the
game promises and never delivered is named in the failure. Anything that only started
happening in the back half of the run fails too, because a feature that first fires on day
eighty-eight is one balance change away from never firing, and nothing else would notice.

Four more gates run the same way — off by default, each behind its own environment
variable, because none of them finishes fast enough to sit in `npm test`. `npm run sweep`
plays thirty days on every seed and difficulty and asks whether the colony was still
standing. `npm run eco` plays a thousand days of empty moor with nobody in it, which is
the only way to catch a forest that quietly eats itself or a herd that never recovers.
`npm run balance` judges the grid against named principles — *nobody starves beside a full
pantry*, *the escalation ladder is climbable to the top* — using numbers that `npm run
measure` wrote earlier, and refuses to score them if the sim has changed underneath.
`npm run pool` checks that the worker-thread grid gives the same answer as the serial one,
which is the property that makes the fast path trustworthy. See
[ACCEPTANCE.md](ACCEPTANCE.md) for the last run of each.

## Trade

Every five days or so a pedlar walks out of the treeline with a string of pack-beasts,
stands in the yard for about half a day, and puts four or five straight swaps on the
board. A **Trade** button appears in the top bar while they are there — that button
showing up *is* the notification — and `M` opens the stall. They will not walk in during
a raid, nobody will shoot at them, and they leave on their own with a warning first.

The deals are goods for goods: steel for medicine, wood for meals, food for timber, and
one standing offer of a hired hand for 150 steel while the colony is still under eight
people. Take a deal and the goods land on the ground at the trader's feet — your own
haulers carry them in, because a trade should not need a new behaviour bolted onto
anybody.

Two things are true of every price on that board:

- **The margins are wide, in one direction.** Hauling your own ore is always cheaper than
  buying it. Trade is for the thing you cannot make fast enough, not for the thing you can.
- **There is no loop.** A caravan is bigger or smaller from week to week, but that scales
  both halves of a deal together — the *rate* never moves. No sequence of swaps, across
  any number of visits, turns steel into more steel. `tests/trade.test.ts` samples forty
  caravans and runs a max-product search over every exchange rate any of them ever offered
  to prove it.

The reason it exists: a colony that has emptied the research tree — somewhere between day 37
and day 56 on the measured runs — and built every turret it wants ends up sitting on five
hundred steel with nothing on the board that wants it. A game with nothing left to decide is over whether or not the settlers are still
walking about. Trade turns a surplus back into a choice — medicine before the next raid,
another pair of hands, or a winter's food you did not have to grow.

## The road

Twelve settlements sit off the edge of the map, in three rings of four — one per quarter of
the compass, each ring turned a little against the one inside it so the far country reads as
being *behind* the near country rather than hidden under it. The near ring is one to three
days out and sells whatever it is sitting on. The middle ring is five or six days out and is
where the workshops are: it sells what somebody made rather than what somebody dug up. The
far ring is nine or ten days out and deals in steel, medicine and **machinery** — the things
dense enough to be worth carrying that far, and the last of them is worth carrying because
nowhere nearer has any. Every map has at least one works out there, for the same reason every
map has a parts town: the top of the research tree is billed in machinery, and a colony that
walked nine days on a vouch it spent a fortnight earning should not find four steel merchants.

`J` opens the road panel: each neighbour, how far, what they are short of, what they pay
in, and how well they know you. Pick a settler, pick a pack, and they walk to the edge of
the map and are *gone* — lifted off the world entirely, not a dot walking a long path.
They come back days later with goods, a level in social, and a colony that has been a
settler short the whole time.

Five rules make it a decision rather than a button:

- **They are genuinely away.** The traveller is taken out of `world.pawns` and stored in
  the caravan record, so nothing can path to them, shoot at them, feed them or count on
  them. Sending your only doctor two days before a raid is a mistake you get to make. The
  wipe check knows about it — a colony whose last settler is on the road has not fallen.
- **Distance is the price.** A day out is a day back, plus the mishap roll on the way:
  bandits on the ridge cost the pack and most of the traveller's blood, never their life.
  Standing and a steady hand both bring the odds down. Each ring is its own risk — a few
  per cent to the near country, a fifth to the middle, and the far roads sit at the worst
  the road ever gets. A robbed party turns back before it arrives, so it earns no standing
  either: the long road costs you the trip as well as the pack.
- **Standing compounds, and the long road compounds it faster.** A near-ring visit is +6, a
  middle-ring one +10, a far one +14 — a longer road is a bigger commitment and the people
  at the end of it know that. A better rate follows, as does the colony's `social` skill,
  which pays again in the prison and at the stall.
- **Depth is earned, not unlocked.** Nothing past the near ring is reachable on day one and
  no counter ticks up on its own. A ring opens when somebody one ring in will vouch for you
  — standing 18, so three ordinary visits to the near ring or two to the middle — *and* the pantry holds the meals that road eats
  there and back, *and* there are enough settlers left to hold the valley while the party is
  gone. So reaching the far ring means having dealt with the middle ring until they know your
  face, which cannot happen until the middle ring is open: the depth is walked rather than
  waited out. Every refusal says in a sentence what would lift it, because a locked road that
  will not say why has taught the player the far country is decoration. And a colony left to
  its own devices walks it: while a vouch is still owed, the foreman ranks the trip that
  would open the next ring five times an ordinary errand, and stops the moment the vouch
  lands. Without that it is a throughput machine, and a throughput machine never leaves the
  first valley — which is not a theory, it is what the grid measured before the number was
  right.
- **There is still no loop.** The road and the pedlar price off one value vector, and the
  road's best possible rate is 0.98. `tests/settlements.test.ts` holds both books together
  and searches every rate either system can ever offer, at every standing and every skill
  level, to prove no cycle across the two of them turns steel into more steel. The eight new
  places changed none of that: a party going three weeks out goes with four settlers' worth
  of handcarts, and multiplying both sides of *worth × a rate below 0.98* does not make steel
  out of steel. `tests/rings.test.ts` re-runs the same search over all twelve.

The Steward will send caravans on its own once the colony can spare somebody — four
settlers alive, nobody hungry, no raid, daylight, and the best talker free — and a second
party once there are eight, because the colony earns one road per four bodies and the ones
already walking still count as yours. Two is the ceiling. It always
takes the trip from the surplus, never from the reserve. Left to plain worth-over-distance
it would walk to the nearest gate forever — a one-day road turns a pack around five times
while a nine-day road turns it once — and since standing is only bought by showing up, a
colony that never went anywhere could never earn the vouch that opens the map. So a trip
that is also what opens the next ring counts double while the vouch is still owed, and
counts normally the moment it lands. The colony pays to open roads, then goes back to
trading efficiently.

## Winning

There is a way for the run to *land* that is not everybody dying. Five **charters**, on
five different axes, and then three days of holding them all at once:

| Charter | What it takes |
| --- | --- |
| Eight settlers | Wanderers, prisoners talked round, hired hands |
| Twelve days of food | A wide field, a stove, and a cooler so half of it does not rot |
| Two turrets | Steel and power — the Steward never builds one of these for you |
| Six projects | A research bench and somebody on it |
| An ally over the ridge | Five caravans to the same neighbour |

The charters are deliberately not five flavours of one thing: a colony can brute-force any
single one and still be nowhere near the others. They show up under **Next steps** in the
goals panel from the first day, so the path is visible long before it is walkable.

The last one is the clock and it is the whole design. The moment all five are true the
founding starts, and it has to *keep* being true for three days — lose a settler, lose a
turret, let the pantry run down, and the log says which one went and the count starts
again. Without the hold, victory lands on the tick a wanderer wanders in and the most
dramatic moment in the run is a number quietly ticking over. With it, the last three days
are the tensest in the game.

Nothing new gets built for it: no capstone structure, no victory resource. Everything the
win asks for is already on the map — it asks you to get all of it right at the same time.

**And then the colony carries on.** The founding is a headline, a card and a final tally
with a **Keep playing** button on it; it is not a shutdown. This is worth saying plainly
because it used to be the other way round, and it was a real bug rather than a taste
call: a win set the same `world.gameOver` flag a wipe sets, and nine other sim passes read
that flag as *everybody is dead*. So the prize for founding Aetherhold was that the
Steward stopped planning, the events stopped firing, the caravans stopped coming, nobody
scouted and nobody wandered in — while the generator went on burning wood. Measured on
seed 20260729: founded around day thirty with 445 steel and 320 wood in the yard, and by
day sixty the wood was at zero with thirty-two reachable trees still standing inside the
harvest radius. Nothing was broken; the foreman had been switched off as a reward. A wipe
is `world.gameOver`, a founding is `world.charter.won`, and they are different flags.

`tests/victory.test.ts` pins the three things that matter: a colony short of one charter
never wins however long it is left running, a founding survives a save, and a founded
colony is still a running colony a fortnight later.

### The three roads

On the founding, the goals panel stops showing the exam you have passed and starts showing
the three ways out of the valley. Each is a ladder of four rungs, each rung is a thing the
colony did, and they are read straight off the colony — there is nothing to collect and
nothing to switch on.

| | The rungs | What it ends in |
|---|---|---|
| **Science** | Schooled, Toolmakers, Foundrymen, Machinists | Build the ship, and leave on something you made |
| **Economy** | Friend, Circuit, Reach, House | Buy the berths — somebody else's ship, your passage, paid for |
| **Warfare** | Blooded, Doorway, Marchers, Warlords | Take the ground; you never leave, you become the ones who launch |

Science counts finished projects and steps at the joints of the tree — the founding's own
six, the free tree done, the foundry branch, everything. Economy counts *places* that deal
with you at charter standing rather than standing summed, so walking the same near
neighbour twenty times gets you one friend and no further: the road asks for breadth, and
the last rung is every town on the map. Warfare counts **ground**: the valley is the first
rung, earned by putting a band of Ashbound down at home, and every rung above it is a
holding out on the moor that your people went and took. A colony can fight raiders in its
yard for sixty days and stand on **Blooded** for all sixty — the road that ends in taking
the world is walked by taking some of it.

### The far end

Reach a road's top rung and a new section appears above the commission: **The far end**, with
the ending that road leads to and what it would cost. Nothing about it is on the panel before
then — a locked ending shown on day one would tell you the shape of the whole game before you
had played any of it.

An ending is a **commitment, not a threshold**. Nothing lands because a number ticked over.
You commit, and then you have **twelve days** to pay a bill and still be a colony at the end
of them — which is the founding's own three-day hold asked once for every rung you climbed.
The three bills are in three different currencies, because three endings that all cost steel
would be one ending printed three times: the ship is **built** and takes a bite out of the
yard every day until the hull is whole; the berths are **bought**, and the fare is what your
caravans handed out over the entire run, so it was mostly paid before you ever committed; the
dominion buys nothing at all, and its bill is simply that every holding is still yours on the
last day.

Fall out and it costs the days, never the goods. There are two ways to fall out and both are
things the game already had words for — the road slipped below the rung that opened the door,
or one of the five things the founding asked for stopped being true. Fix it and the count
starts again from twelve. What is in the hull stays in the hull. **Give it up** is right
there on the card with no confirmation box, because nothing it destroys is anything a
confirmation would have saved: you lose the days you spent and you can commit again on the
next tick.

Two of the grid's principles keep the roads honest and two more keep the endings honest. The
roads have to *disagree* somewhere across a grid of colonies, or they are one number printed
three times; no colony playing its whole clock should stand on a top rung with nowhere left
to go; every ending that lands must have been committed to and survived; and each of the
three has to be reachable by somebody.

Three of those four are currently broken, and the fourth holds thinly — which is the useful
part, because it says exactly where the game is thin. Across sixty days a colony walks a fair
way up science or warfare, but economy stops at **Friend** on almost every map: the founding
needs one neighbour who takes your calls and nothing in the valley yet asks for a second.
On the last grid, two colonies of fifteen reached an ending and **both reached the same one**
— the dominion, on the strength of three holdings held. Nobody finished the ship (the tree
gets to 17 projects of 19 and runs out of days) and nobody came close to the berths (one town
of four at standing). One of those is a clock that is too short and the other is a road
nobody walks, and telling them apart is the whole reason the grid prints the rung beside the
failure.

### The war road

Behind each ring of neighbours sits a **holding** — a place the Ashbound hold, and the
doorway the raids come through. There are three, one per ring, and they are on the same
panel as the trade road: what is out there, what it is worth, who would go, and what is
standing in it.

Sending a war party is the most expensive thing a colony can do, and it is priced the way
everything else here is priced — in people. **Three settlers go and four must stay**, so you
need seven on their feet before the game will let anybody out of the gate, and it counts
who is standing in the valley rather than who is on the books: a settler on the floor is not
a settler holding a wall. The three walk to the treeline as an ordinary errand, and then
they are gone — off the map for the whole round trip, which is the same walk a caravan takes
to that ring. Six days to the near holding, twenty to the far one. Nothing can path to them,
feed them or shoot them while they are away, and the colony works short-handed for every day
of it.

What is waiting is two men at the doorway, three a ring out, four at the far one — rolled at
the difficulty you are playing and at whatever rung the Ashbound have escalated to, so a
garrison gets harder as the rest of the game does. They shoot first, because your people are
the ones crossing open ground, and that opening volley is most of what makes a holding a
hard thing rather than a headcount. Rifles matter enormously; a party sent out with clubs is
paying for the walk and coming home with nothing.

Win and the ground is yours. It stays yours — the Ashbound do not come and take it back, in
this cut — and a cart comes down off the moor on its own clock with steel on it: forty from
the near holding every six days, eighty from the middle one every twelve, a hundred and
twenty from the far one every twenty. About the same steel a day whichever it is. The far
one is not richer; what the far one buys is the rung.

Lose and your three come home wrecked and alive. **Nobody dies off-screen** — a settler
killed by dice you could not watch, on a map you cannot look at, is not a story the game has
any way to tell you, so a beaten party arrives at a quarter of their health, off whatever
they were doing, hungry and exhausted and out of the rota for days. You can go back. The
place remembers how many times you have tried it and does not deal you the same afternoon
twice.

There is one more bill, and it is quiet: a won campaign counts as a clean run on the same
streak the storyteller uses to decide what comes over the treeline next. Taking ground makes
the next raid worse. That is the price of the third road, and it is the only price that
follows you home.

## Who your settlers are

Everybody with a name has one or two **traits**, shown as chips at the top of the
inspector with the explanation on hover. Skills already made settlers unequal, but along
one axis the player mostly reads as a number going up — nobody remembers that somebody had
mining 9. They remember the one who kept working through a bad week, and the glutton who
ate the winter stores.

| | |
|---|---|
| **Hardworking / Slothful** | Gets through work 15% faster, or 15% slower — everywhere, from the woodpile to the research bench |
| **Tough / Frail** | A body 30% bigger, or 25% smaller |
| **Optimist / Pessimist** | Sits a tenth of the mood scale above or below everyone else in the same circumstances |
| **Iron stomach / Glutton** | Eats a quarter less, or a third more |
| **Crackshot** | Shoots as though six levels better than they are — a tighter cone, a steadier swing |
| **Kindhearted** | Talks a prisoner round twice as fast, whatever sort of week they are having |

Every trait moves exactly one number some system already reads, and the opposed pairs
cancel: a colony of eight averages out to the colony you had before traits existed, and
the interest is in *which* eight you got. A settler from a save written before the table
existed is given traits on load, rolled from their own id — the same person every time
that file is opened, rather than a blank where the player's favourite colonist was.

## Who they get on with

Traits made a settler *someone*. Bonds make the colony a *place*. Nobody remembers that a
colony survived twelve raids; they remember that Sorrel and Pell had been inseparable
since the spring, and that Sorrel was the one still standing when the raid was over.

Two settlers who spend time within a couple of cells of each other, in line of sight,
awake, form an **opinion** — one number from −100 to +100. There is no social job, no new
activity and no branch in the job loop: settlers form opinions of whoever happens to be
near them while they do the work they were already doing. Sharing a meal or an evening off
counts for nearly twice as much as passing each other with an armful of steel, and an
opinion nobody keeps up fades by about eight percent a day until it is forgotten. Optimists
and the kindhearted are easier to get along with; pessimists are not.

**Getting closer gets harder.** The last ten points of an opinion cost roughly a hundred
times what the first ten did, so where a pair end up is decided by how much of the day they
genuinely spend together: two settlers who cross the yard twice settle somewhere around
*friend* and stay there, and only a pair who share most meals and most evenings ever reach
*inseparable*. Falling out is undamped and runs at full speed in the other direction — it is
becoming somebody's closest friend that is meant to be difficult, not ceasing to be one.
Without that, the arithmetic ran the other way entirely: this check happens a hundred and
sixty times a game day, so everybody hit the ceiling inside a week and the whole vocabulary
collapsed into one word.

The bottom of the details panel lists the three people a settler has the strongest
feelings about, in words — *inseparable*, *friend*, *wary*, *rival*, *cannot stand* — and
the log says so once, on the day a friendship or a feud crosses the line.

It does exactly two things to the sim, and both were already there:

- **Mood.** Every friend in the colony is worth at most six points of mood between them,
  about a third of what going hungry costs. A colony of people who hate each other is a
  colony that breaks a little sooner under the same pressure, not one that starves. That
  ceiling is a hard clamp, and `tests/social.test.ts` pins it from both directions.
- **Grief.** A death used to cost everybody the same. Now it is scaled by what the dead
  settler was to each of them — up to double for a close friend, half for somebody they
  could not stand — and the log names the one person the colony should worry about
  tonight rather than reporting a death as something that happened equally to everyone.

The details panel and the Next steps panel share the top-right corner, and only one of
them can have it: selecting anybody stands the checklist down until you deselect. Drag the
goals panel somewhere of your own and you keep both — the default position is the only one
that collides, so it is the only one that yields.

## Burying them

Grief is an event: it lands the day somebody dies and it fades. The body does not fade.
It lies in the yard where it fell, and every settler who walks past it is reminded, and
there was nothing you could *do* about that — which is the difference between a hard game
and a sad one.

Build a **grave**. Four wood, Furniture tab, and it is the cheapest thing in the game on
purpose: the answer to "we could not afford to bury her" must never be a real sentence.

- Every unburied body costs the whole colony a little mood, continuously, for as long as
  it lies there — and more to the people who were close to them. That part is capped at
  about a third of what it takes to break somebody, so six dead raiders after a bad night
  cannot by themselves finish off the colony that survived them.
- The alert panel says **N unburied bodies**, and clicking it takes the camera there. It
  tells you which of the two problems you have: no grave to put them in, or a grave and
  nobody free to do the carrying.
- Burial is ordinary **haul** work. A settler shoulders the body — really shoulders it,
  the same carry the warden uses on a prisoner, visible in both views — walks it to an
  empty grave, and lays them in. Not during a fight; the dead will keep for a minute, and
  a settler who walks into gunfire to fetch a body is about to become one.
- Click the grave afterwards and it tells you who is in it. That is the whole reason to
  build one rather than let the ground take them.
- A colony that never learns any of this is not punished forever. A body nobody comes for
  in four days is gone, with a line in the log saying so — which is also what stops a long
  game accumulating corpses without bound.

`tests/graves.test.ts` runs it end to end, including the one that matters most: a grave is
knee-high and non-solid, so a row of headstones is never quietly a free wall.

## Somewhere worth living

Every other building in this game earns its place by doing something. A bed restores rest,
a stove cooks, a wall stops a bullet — which means the only reason to lay a plank floor is
that it is quicker underfoot, and a colony that is *working* and a colony that is
*pleasant* are the same colony. **Beauty** is the second reason.

Click anything indoors and the panel now reads a **beauty** line: a number and a word,
from *grim* through *plain* to *beautiful*. Click a settler and the same room appears on
their panel as **surroundings**, right under the temperature — the two halves of the same
question, which is what it is like to be standing here.

- Furniture and a laid floor lift a room. Machinery, prison bunks, indoor defences and
  graves drag it down. A body left lying on the floor drags it down hardest of all, which
  is the second reason to build the grave.
- It is an **average over the room's floor**, not a total. One statue is a grand gesture
  in a bunkhouse and a decoration in a hall, and decorating a bigger space costs
  proportionally more. Otherwise the winning move would be one enormous room with forty
  lamps in it.
- The **outdoors scores nothing at all** — not badly, nothing. A settler who walks into a
  field is not charged for the field being undecorated.
- A room they like is worth a small, steady mood bonus: about a third of what going hungry
  costs at its worst, and the same size as the friends they have. A beautiful colony holds
  together a little longer under the same pressure. It does not survive a famine.

For the one thing whose entire job is this, build a **statue**: 20 steel and 10 wood in
the Comfort tab, worth more than every other furnishing put together. It is solid — you
walk round it and it stops a shot — but deliberately shorter than a wall, so a line of
them down a hall can never quietly become two rooms with two temperatures.
`tests/beauty.test.ts` proves that one by building the row and checking the room is still
one room.

## An evening off

A settler who works all day and never stops working stops being any use: the recreation
bar falls, mood goes with it, and eventually somebody walks off the job. The colony needs
somewhere to spend an evening, and where that is turns out to matter more than that it
exists at all.

Three places count, and they are scored against each other every time somebody gets bored:

| Spot | Worth | Seats | Notes |
| --- | --- | --- | --- |
| Table | the baseline | 4 | You already have two. Somewhere to sit and talk. |
| Campfire | a quarter more | 6 | Only while it is *burning* — a cold fire pit is a ring of stones. |
| Games table | half again more | 2 | 10 wood and 4 steel in the Comfort tab. The best hour in the game. |

The part that makes a colony out of three people is the **company** term. A spot with
somebody already at it is worth more than the same spot empty, both to walk to and to sit
at — an hour spent with two other people fills the bar nearly twice as fast as an hour
spent alone, and `social.ts` is raising their opinion of each other at the same time. So
the settlers converge. Light a fire in the evening and you will watch them arrive at it one
by one instead of each taking a private turn at the table.

It is deliberately not a stampede:

- **Company beats a small upgrade, not a big one.** Somebody at the table will pull a
  settler off the slightly better campfire. Nobody ignores the games table they just built
  because a colleague sat down to dinner.
- **Company never beats the walk.** The distance term is worth about a cabin's width per
  point of quality, so nobody crosses the base to be sociable.
- **Full means full.** The games table seats two, and the count includes the people still
  walking towards it — three bored settlers and one board sends the third somewhere else
  rather than stacking them on one cell.

The panel says which of the three they are at: *sitting by the fire*, *playing a game*,
*relaxing*. If the fire goes out under them, the job cancels and they go back to work.

## Prisoners

A raider who goes down in your yard used to have two futures: bleed out, or heal up and
start shooting again. Build a **prison bunk** and there is a third one.

With a bunk free and the shooting stopped, a settler with the **warden** work type
shoulders the nearest downed raider — you can watch them carry the body, and in first
person you can be the one carrying it — and lays them in it. From that moment they are
their own faction: nothing in the colony will shoot at them, turrets included, and they
have no AI at all. They lie there getting hungry.

What happens next is up to the colony:

- **The doctor treats them**, on the same rounds as everyone else. A prisoner cannot be
  talked round while they are unconscious, so patching them up is the first step, not a
  kindness.
- **A warden brings them meals** out of the same pantry the settlers eat from. Skip it and
  they starve in the bunk, and you will be told about it every half day until they die.
- **A warden sits with them**, a little over half a day between sittings. Each sitting
  knocks their resistance down by one — two if the warden is in a good mood themselves,
  because somebody miserable is not going to make a convincing case for staying. Resistance
  starts somewhere between five and ten, so a soft raider worked by a cheerful warden joins
  in about two days and a stubborn one facing a miserable warden takes six.

Then they throw in with the colony, and the whole colony gets a mood lift out of it. Their
weapon does not come with them into the bunk — that is the only loot a capture yields,
which is what keeps killing and capturing genuinely different decisions rather than the
same decision with a delay.

The bill is deliberate. A bunk costs wood and steel before the raid arrives, a prisoner
eats and does no work while you wait, and intake is capped by how many bunks you built.
Capturing more people than you can feed is a way to lose a colony, and it should be.

> Pacing note, because it went wrong first: the original build had no gap between
> sittings, so a warden just sat there talking and a raider joined up inside an afternoon.
> Over twenty-one days the eval colony went from four settlers to eighteen on captures
> alone and every other way of getting people stopped mattering. The gap is the whole of
> the balance, and `tests/prison.test.ts` pins it so it cannot quietly come back.

## Falling ill

Every illness in this game is the same object: two numbers climbing towards 1. **Severity**
is how badly it is going; **immunity** is how close the body is to beating it. Whichever
gets there first decides what happens — immunity wins and they shrug it off, severity wins
and they die. Click a sick settler and you can watch both bars race.

Three things start that race:

- **Infection**, from a wound nobody washed. A settler below 55% health who is left lying
  there has a real chance every hour of going septic — and none at all once a doctor has
  put a dressing on it. This is the one you bring on yourself.
- **The flu**, which arrives on its own every three to six days and takes whichever settler
  you have been running into the ground hardest. It is not a die roll across the roster: it
  is the bill for the settler you never let sleep. It is also what a cold night hands you —
  anyone properly cold rather than merely chilly is rolling for it every hour they stay
  that way, which is roughly a one-in-four night if they are out in a storm (see
  **Warmth**).
- **Food poisoning**, from eating raw. Roughly one meal in nine. It is fast, it is
  miserable, and it caps below the threshold that puts anyone down — it can cost you an
  afternoon and never a settler. It is the game's argument for owning a stove.

What you do about it:

- **Bed rest is the real answer.** On their feet a settler builds immunity at half rate; in
  a bed, at full rate; in a **hospital bed** (20 wood, 12 steel), at 1.3×. A sick settler
  takes to a bed on their own once severity passes a quarter, and stays in it after they
  are rested — that is what bed rest *is*. They still get up for a raid or an empty stomach.
- **Feed them.** A settler below 30% food builds immunity at less than half rate. Starving
  and sick is how the race is actually lost, and it is almost always what killed the
  settler you lost.
- **Warm the room they are lying in.** A body spending everything it has on staying warm
  builds immunity at 0.7×, so a cold bed is barely better than no bed. That is what makes a
  campfire a medical building.
- **A doctor changes the arithmetic.** Tending does not cure anything; it slows severity to
  about a third and adds immunity, and it lasts half a day before the dressing needs
  changing. A doctor who keeps coming back turns a losing race into a winning one. Doctors
  now round on fevers as well as bullet holes, so a sick settler at full health is no longer
  invisible to the colony.

Past 62% severity they collapse, and stay down until the fever breaks — closed skin is not
the same as a broken fever, so healing them will not stand them back up. That collapse is
deliberate: it is the colony's last, loud chance to do something.

The rates are set so **nobody dies of bad luck.** A fed settler in a bed beats everything in
the game with no medicine at all. The settler who dies is the one who was kept working,
hungry, with nobody looking at them — for two days, with a warning on the log the whole
time. `tests/health.test.ts` runs both of those races end to end and asserts on who wins,
because that promise is the kind of thing a plausible balance tweak breaks silently.

## The dark part of the map

The valley is 192×192 — thirty-seven thousand cells — and the colony lands on about eighty of them. The rest starts
under haze, and the only thing that lifts it is somebody walking there. Settlers see nine
cells; the yard and every standing building keep their own surroundings drawn, so you open
on the trees you are about to be told to chop rather than groping out of your own front
door.

It was 96 across, then 128, and it is 192 now — four times the ground it started with. Almost
none of that lands on the homestead. The cabin, the first ore, the first trees and the walk to
the water are all measured out from the middle and are exactly where they were; what grows is
the rim. There are more landmarks out there — one site per 512 cells, held constant as the map
grew, so seventy-two of them rather than the eighteen the 96-wide valley had — more deep-ore
country past the near ring, and more animals: the herd cap is a
density now rather than a flat fourteen, so a bigger valley carries a bigger population without
the moor round the fence getting any busier. The point of the extra ground is that the far
corners are genuinely far: a scout sent to the north rim is gone for a while, and that is the
whole trade.

The other point is that a moor this size has room for something to happen in it that you are
not standing in the middle of. See [The moor without you in it](#the-moor-without-you-in-it).

Three rules, and the first is the one that matters:

- **Ground is never re-hidden.** Walk to the north ridge and come home and the ridge is
  still on the map. This is a colony's map of a place it lives in, not a radar sweep — a
  base that vanished the moment nobody stood in it would be broken rather than tense.
- **Seeing is not knowing.** The first time a landmark comes into view the log says
  *"Something is standing out to the north-east"* and pins it. That is all it says. What is
  buried under the cairn stays buried until a scout walks out and reads it, so the pin is a
  reason to go rather than a substitute for going. `Site.sighted` and `Site.found` are
  different flags on purpose.
- **Both views end at the same edge.** `sim/explore.ts` owns the flags and nothing else has
  an opinion. The manager sees haze on a cell exactly when the body standing in it does.

The haze is a volume rather than a dark tile, and it is translucent rather than black. Both
are deliberate: a flat tile leaves lit rock tops and pine crowns floating over a black
field, which reads as a rendering fault, and opaque black would delete the site pins that
are the only thing telling a new player there is any reason to leave the yard. It
takes most of its colour from the sky, so the edge of the known world and the edge of the
weather look like the same kind of thing.

None of it draws a random number. Exploration runs on every tick of every seed, and one
draw from a shared stream would re-roll every balance test in the suite.

## Pickies

Press `` ` `` and click anywhere. A knee-high pink goblin pops into existence beside your
settlers, scampers off toward the cell you pointed at, and then tells you what happened —
`A Picky reached (61, 34) in 9s — the colony can get there`, or `The door at (48, 51) —
nothing joins it to where the colony is standing`. Then it vanishes. It cannot carry,
build, fight or be recruited. It is a question with legs, and it exists for exactly as
long as the question does.

It is there for the failure that has no error message. A settler stops going somewhere and
the log says nothing, because from the work board's side of it there is simply no job to
hand out: maybe the last door got walled up, maybe the bridge is one cell short, maybe the
bed is fine and the *stockpile* is the thing nobody can reach. The only way to tell those
apart used to be to draft somebody and walk them there yourself. Now you ask.

The **Check** tab has four errands that need no target, so they are a tile you press once:

- **Picky rounds** — six of your own buildings, in turn. The sweep to run after a big wall,
  when you want to know that everything you own is still joined to everything else.
- **Try the doors** — six doors, and it stands *on* each one rather than beside it, because
  standing next to a door proves nothing about whether it opens. A door that has been
  walled in on both sides is the quietest failure the colony has: it looks built, it looks
  fine, and nothing will ever use it again.
- **Check hauling** — something lying on the ground, then the nearest store that would take
  it. This is the failure the work board cannot report, because a haul job that could never
  be finished is simply a job that never gets handed out.
- **Surprise me** — the goblin picks its own errand. It only rolls errands the colony can
  actually supply (no "try the doors" in a colony with no doors), and when it rolls *reach*
  it aims at any walkable cell on the map, including ground you have never seen. The point
  of this one is that you are not asking about somewhere you already suspect.

Each reports only at the end, or the moment it hits something it cannot get to. Six lines
of good news is not news.

Two rules are what make the answer worth anything:

- It walks the **same** pathfinder and the **same** collision a settler does — the
  `Walker` interface in `movement.ts`, which `Pawn` already satisfied. It stands *on* a
  cell it could stand on and *beside* one it could not, which is the same distinction
  every job makes. A tester with its own movement code answers a question about the
  tester. Doors swing open for a Picky too, for the same reason: it must never walk
  through something that visibly is not open.
- It **changes nothing**. Every Picky carries its own seed, so it draws no dice from the
  weather, the raids or the crops. It never lifts the haze — what it walks past does not
  become somewhere the colony has been. It does not even spend the id counter, which is
  not the pedantry it sounds like: wildlife staggers its wandering by `(tick + id)`, so a
  Picky that took an id would move every deer born after it. Watching a colony must not
  change it, and the test for that is a twin — the same seed run with six Pickies
  scampering over it and without, every roll, every settler and every lit cell identical.

At most six out at once, on purpose. The cap is not about cost — six more bodies is
nothing — it is that twenty goblins shouting at once is noise, and the whole point is one
clear sentence about one cell. Any Picky that has not managed its errand inside a minute
gives up, says so, and pops anyway. A Picky mid-errand survives a save.

## Fetching

Most of what a settler does all day is walk. Bucket three days of a new colony by what
each of them is actually doing and it reads six ticks walking to every one worked, and over
half of that walking is hauling — carrying things, which books no work at all. So the two
rules about carrying are worth knowing, because between them they are worth more to the
colony than any skill in the game.

**They pick up an armful, not a handful.** A settler sent out to clear one heap of wood
gathers whatever else of the same kind is lying within a couple of paces before setting
off. Three felled trees side by side is one trip, not three. They will not take something
another settler has already been sent for, they will not take from a stockpile that is
already the right home for it, and they cannot reach over a wall — the reach is counted in
steps a person could take, not in distance across a map.

**They supply a whole run of frames, not one.** Order a ten-segment wall and the settler who
goes for wood brings enough for the run, then walks down the line dropping it at each frame
in turn. Rub the frames out while they are mid-run and they put the surplus down where they
stand rather than carrying it about.

On the opening seed, the same three days that used to end with thirty-seven buildings
standing now end with sixty-six.

## How the two views stay honest

- One `World` object, one 20 Hz clock, one pathfinder, one collision test. The cameras
  are views and input adapters; neither owns state.
- Collision comes from the same `isSolid()` the pathfinder uses, which reads the same
  building list the meshes are drawn from. There are no walls you can walk through and
  no invisible ones.
- An order placed in the manager becomes a job. Your body executes that job unless you
  take the wheel — moving yourself cancels it, deliberately.
- Possession is remembered. `V` back into the base puts you in the same settler; while
  you are upstairs that settler goes back to work.
- Getting downed or killed hands you the clipboard with a message, and you can possess
  someone else.

## What is in the box

**The valley.** A 192×192 map — thirty-seven thousand cells — of grass, soil, sand,
stone, rock, forest and one lake, generated from a seed and identical every time that
seed is used. It starts under haze and is drawn as the colony walks it, with a minimap
of the whole valley that carries across both views. Seventy-two landmarks are scattered
through it, one per five hundred cells, for scouts to walk out to. A twenty-day year of
four seasons colours it as it turns, stops an outdoor plot dead through winter, and makes
a heated room worth building; snow lies for a quarter of it and comes off the ground only
where somebody laid a floor.

**The people.** Three settlers to start, with food, rest, recreation and mood, eight
skills that improve by doing, fourteen work types on a per-settler priority grid, and
friendships and feuds formed with whoever they work beside — and grieved accordingly.
Morale scales how fast everyone works and can stop a settler dead until you fix what is
wrong. They can be drafted, and fight at range or in reach.

**Building.** Twenty-seven blueprints — wall, stone wall, fence, door, bed, hospital bed,
prison bunk, table, games table, statue, grave, cook stove, workbench, research bench,
fishing stage, cooler, campfire, heater, lamp, turret, sandbags, deadfall trap, wood
generator, watermill, solar panel, power conduit and battery bank — plus three floors
(plank, paving and a bridge that decks across open water). Rooms know how well they seal
and hold their own air; a power grid runs through your walls and sheds the lamps before
it ever sheds a turret.

**Feeding it.** Ground you break into soil and sow, berries picked off wild bushes,
herds of mossbacks and dunhares that graze, bolt when they are shot at, and become raw
food when a rifleman is sent after them, pens you paint and livestock you tame, breed and
butcher instead of hunting, fish taken off a stage on the shore, and cooking that turns
any of it into meals. Food ages at the temperature of the cell it sits on, and a cold
store stops it.

**Trouble.** A storyteller that sends raids, wildlife and fires on three difficulties, on
a curve that reads what the colony can take. Weather that actually does something — rain
ripens crops and drowns fires, fog and storms spoil everyone's aim, lightning starts
fires, and a storm holds the raiders off. Cold that costs a settler their mood and their
immune system rather than their hit points, illness that has to be doctored, and a colony
that puts back what fire and raiders take off it.

**Getting ahead.** A nineteen-project research tree, 421,000 points end to end, whose top
tier is bought with goods off the road as well as with points. Scouting
parties that walk out to the edges of the map and come back with salvage. Caravans that
turn a surplus back into a choice.

**Getting out.** On the founding the goals panel turns into three roads out of the valley —
science, economy and warfare, four rungs each, read straight off the colony. The warfare one
counts ground: three holdings sit behind the rings, and taking one costs three settlers off
the map for the whole round trip and pays a cart of steel on its own clock ever after. Reach
a road's top rung and its ending opens: commit to it, pay a bill in that road's own currency,
and hold the colony together for twelve days. What is still missing is what happens on the
day one lands — the record it writes and the card it shows.

**The frame.** A fixed twenty-tick second and a two-hundred-and-forty-second day. A
day/night cycle that lights both views, an ambient bed that follows the weather and the
hour, save/load to `localStorage` with a text backup you can carry anywhere, and three
quality presets.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the layout, [PLAYTEST.md](PLAYTEST.md) for the
tour, [ACCEPTANCE.md](ACCEPTANCE.md) for what the build promised and which test holds each
promise down, and [ENDGAME.md](ENDGAME.md) for what is still missing at the far end of a
run.
