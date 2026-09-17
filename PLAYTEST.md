# Playtest — ten steps, and thirty-six side trips

```bash
npm install
npm run dev      # http://localhost:5063
```

Playing on another device on the wifi instead? Use the play server — `npm run play` on
port **5062** — so an edit on the dev box can't reload your game mid-run.

Press `/` or `F1` in game for the full key list. Each step below says what you should see;
if you see something else, that's a bug worth reporting.

**How to use this.** Steps **1 to 10** are the tour, in order — do those and you have
exercised the spine of the game. Everything with
a letter after it is a side trip into one subject, self-contained and skippable, and they
are grouped below rather than listed in the order they happen to sit in the file. Start
from the group that covers whatever you just changed.

*The other five documents:* [README.md](README.md) is what the game is and how each
system works, [ARCHITECTURE.md](ARCHITECTURE.md) is how the code is laid out and why,
[ACCEPTANCE.md](ACCEPTANCE.md) is what the build promised and which test holds each
promise down, [METHODOLOGY.md](METHODOLOGY.md) is the loop this tour is the last tier of
— including the `window.aetherhold` console recipes, which are faster than clicking —
and [ENDGAME.md](ENDGAME.md) is what is still missing at the far end of a run.

## Contents

**The tour** —
[1. Boot the colony](#1-boot-the-colony-20-seconds) ·
[2. Build something](#2-build-something) ·
[3. Decide who does what](#3-decide-who-does-what) ·
[4. Step inside a body](#4-step-inside-a-body) ·
[5. Check the books](#5-come-back-up-and-check-the-books) ·
[6. Watch a day pass](#6-watch-a-day-pass) ·
[7. Pull the plug](#7-pull-the-plug-1-minute) ·
[8. Take a hit](#8-take-a-hit) ·
[9. Get someone sick](#9-get-someone-sick) ·
[10. Save it, break it, load it](#10-save-it-break-it-load-it)

**Building, and taking it back down** —
[7b. Build a room and heat it](#7b-build-a-room-and-heat-it-2-minutes) ·
[7c. Lay a road](#7c-lay-a-road-1-minute) ·
[7d. Take it all back down](#7d-take-it-all-back-down-2-minutes) ·
[9ee. Why nobody is building your wall](#9ee-ask-why-nobody-is-building-your-wall-2-minutes)

**The colony talking back** —
[9c. Watch it tell on itself](#9c-watch-the-colony-tell-on-itself-1-minute) ·
[9d. Follow the Next steps panel](#9d-follow-the-next-steps-panel-1-minute) ·
[9cc. Watch someone fetch](#9cc-watch-someone-fetch-5-minutes) ·
[9hh. Read its own history](#9hh-read-the-colonys-own-history-2-minutes)

**The people** —
[9f. Watch a friendship form](#9f-watch-a-friendship-form-2-minutes) ·
[9g. Bury the dead](#9g-bury-the-dead-2-minutes) ·
[9h. Make the cabin worth living in](#9h-make-the-cabin-worth-living-in-3-minutes) ·
[9i. An evening off](#9i-an-evening-off-3-minutes) ·
[9gg. Let two of them make a life](#9gg-let-two-of-them-make-a-life-5-minutes)

**Trouble** —
[9b. Set the bunk room alight](#9b-set-the-bunk-room-alight-1-minute) ·
[9e. An undrafted settler shot at](#9e-let-an-undrafted-settler-get-shot-at-1-minute) ·
[9w. A night with wolves in it](#9w-a-night-with-wolves-in-it-6-minutes)

**The valley** —
[9k. Send somebody over the ridge](#9k-send-somebody-over-the-ridge-3-minutes) ·
[9ii. Walk the map open](#9ii-walk-the-map-open-one-ring-at-a-time-10-minutes-mostly-waiting) ·
[9l. Read the path to a win](#9l-read-the-path-to-a-win-1-minute) ·
[9jj. Read the roads on the morning you are founded](#9jj-read-the-roads-on-the-morning-you-are-founded-3-minutes-after-a-founding) ·
[9kk. Send a war party](#9kk-send-a-war-party-15-minutes-after-a-founding-on-a-colony-of-seven-or-more) ·
[9ll. Commit to an ending](#9ll-commit-to-an-ending-20-minutes-at-speed-after-a-road-tops-out) ·
[9mm. Land it, and keep playing](#9mm-land-it-and-keep-playing-3-minutes-once-a-countdown-runs-out) ·
[9nn. Take a card in a body](#9nn-take-a-card-in-a-body-2-minutes) ·
[9oo. Read the roll](#9oo-read-the-roll-4-minutes-on-the-card-from-9mm) ·
[9pp. Watch the walk](#9pp-watch-the-walk-4-minutes) ·
[9m. Walk into the haze](#9m-walk-into-the-haze-2-minutes) ·
[9n. Read the map in the corner](#9n-read-the-map-in-the-corner-2-minutes) ·
[9aa. Walk to the rim](#9aa-walk-to-the-rim-5-minutes) ·
[9ff. Choose the valley you land in](#9ff-choose-the-valley-you-land-in-4-minutes)

**Winter, and the lake** —
[9o. Live through a winter](#9o-live-through-a-winter-6-minutes) ·
[9p. Find the lake](#9p-find-the-lake-2-minutes) ·
[9q. Walk on the lake](#9q-walk-on-the-lake-4-minutes) ·
[9r. Fish it](#9r-fish-it-5-minutes) ·
[9s. Put the lake to work](#9s-put-the-lake-to-work-5-minutes) ·
[9t. Cross the lake](#9t-cross-the-lake-4-minutes)

**Things that are not settlers** —
[9u. Send a Picky](#9u-send-a-picky-4-minutes) ·
[9v. Tame something and keep it](#9v-tame-something-and-keep-it-5-minutes) ·
[9x. The pen that holds](#9x-the-pen-that-holds-5-minutes) ·
[9y. Breed a herd](#9y-breed-a-herd-6-minutes) ·
[9z. Let something get old](#9z-let-something-get-old-4-minutes-plus-a-long-run) ·
[9bb. Follow the food chain](#9bb-follow-the-food-chain-7-minutes)

**Leave it alone** —
[9j. Watch it build without you](#9j-leave-the-colony-alone-and-watch-it-build-4-minutes) ·
[9dd. Run the moor with nobody in it](#9dd-run-the-moor-with-nobody-in-it-1-minute-of-typing-then-go-and-have-a-coffee)

[Known edges](#known-edges)

## 1. Boot the colony (~20 seconds)

Open the page. Three settlers — Tibb, Mira and Sela — are standing in an open-topped cabin
in a 192×192 valley. The left panel lists them with Food / Rest / Recreation / Mood bars and
what each is doing right now. Top left is the clock and the day counter; bottom right is the
message log.

**Expect:** three named rows, live bars, and settlers already picking up work on their own.

## 2. Build something

Press `1` (Wall) and drag a short rectangle just outside the cabin, then release. Grey
blueprint ghosts appear. Watch the log and the settler rows.

**Expect:** somebody switches to `haulToBlueprint`, walks to the wood stack, carries it to
the ghost, then builds. The ghost becomes a real wall. Press `2` and place a door in the run
so you can get in later. Wrong spot? `Backspace` removes blueprints under the cursor.

Speed it up with the `2x` / `3x` buttons (or `9` / `0`) if you're impatient. `Space` pauses —
the world genuinely stops, the clock included.

## 3. Decide who does what

Press `P` for the work tab. Every settler has a priority per work type: haul, construct,
cook, mine, chop, doctor, firefight. Set someone's Construct to 1 and someone else's to 4,
then place another wall.

**Expect:** the settler you promoted takes the job. Priorities are honoured within a tick or
two of the job being posted, not on a timer.

## 4. Step inside a body

Click a settler, then press `V` (or `G` on a selection). You are now behind that settler's
eyes. Click once to capture the mouse. `WASD` walks, `Shift` runs.

Walk at the door you built. It swings open as you arrive — no key needed, the same way it
opens for settlers. Walk into a wall: you stop. Walk to a bed and press `E` when the
crosshair reads **Sleep**.

**Expect:** the interact prompt names the thing you're facing (bed, table, stove, blueprint,
tree, a downed friend). Sleeping in the bed raises that settler's Rest — the same number the
manager panel shows. Time controls are locked to 1x or paused while you're in a body.

## 5. Come back up and check the books

Press `V` again.

**Expect:** the camera returns to the colony view with your settler standing exactly where
you left them, still doing what you left them doing, with the needs you changed. Press `V`
once more and you're back in the *same* settler — possession is remembered.

## 6. Watch a day pass

From the manager, hit `3x` and watch the light. Dawn is long and orange, midday is white,
dusk goes blue, night is dark enough that lamps matter. Somewhere in the evening, press `V`.

**Expect:** the same time of day inside the body — same sun angle, same sky, same darkness.
One clock, two windows.

## 7. Pull the plug (~1 minute)

Your cabin starts wired: a generator in the north-west corner, a stub of conduit out to each
lamp. Click the generator. Its card says what it is making and roughly how many hours of wood
are in the firebox; the top bar carries a `power` reading next to the resources.

Now break it. Press `X`, click the generator, and let a settler take it apart.

**Expect:** within a tick the two lamps go dull in the colony view, a small amber mark appears
over each of them, the top-bar power reading turns red, and the log says the grid is short.
Step inside with `V` after dark and the cabin is genuinely dark. Build a new generator
(build bar, **Power** tab) anywhere touching a cabin wall — walls conduct — and everything comes
back on the tick it finishes.

Worth doing once with a cooler: build one, watch its card say `no — no power`, run conduit to
it, watch it say `running: yes · 99 cells` — the cell count is the room it is trying to chill,
which is the next step.

## 7b. Build a room and heat it (~2 minutes)

Click any settler and find the `warmth` row under their needs: the air where they are standing
and what it is doing to them. Click a wall or a bed and the card names the room instead —
`99 cells · 1 door` for the starter cabin.

Run the clock to after dark with `3x` and watch that number fall. Then build a **campfire**
(20 wood, no steel) inside the cabin and leave it alone.

**Expect:** the fire lights itself out of the woodpile once the room goes below 15 °C, its
card says `running: yes · 99 cells`, and the cabin temperature climbs over the next game hour
rather than jumping. Settler cards go from `cold` in red to `chilly` to `comfortable` as it
works. Step in with `V` — the fire is a real light source, and the room is lit by it.

Now the other half. Wall off a small room in the corner — five or six cells is plenty, with
one door — and put the cooler in that instead of in the open cabin.

**Expect:** the same cooler that only made the cabin chilly takes the small room to about
−5 °C, and its card says `running: yes · 6 cells`. Move your food stockpile inside and the
spoilage clock stops. Knock two more doorways into that room and watch it lose the fight:
doors leak whether or not anybody is using them.

Worth doing once, for the cruel version: possess a settler at night, walk them out into the
yard in a storm, and leave them there. Their card reads `freezing` in red, their mood drops
every hour, and within a few days the log says they have come down with the flu. Four walls
and a fire are the whole answer.

## 7c. Lay a road (~1 minute)

Press `I` and drag a strip of boards from the cabin door out to the woodpile — the cells fill
with a dim plank colour and the log says how many you marked and what they will cost. Three
wood a cell, so a ten-cell corridor wants thirty; if the yard is short of it the log says that
too, and the order waits rather than failing.

**Expect:** somebody on construction duty picks up boards, walks them to the far end of the
strip, kneels, and the cell turns to laid planks with a straight edge against the grass.
Settlers start routing *along* it instead of cutting the corner — the boards are cheaper to
walk than open ground, and A\* knows it. Possess one with `V` and walk the strip yourself: the
same speed bonus is under your feet, because it is the same table.

Then press `O` and pave a ring around the woodshed (2 steel a cell). Set a fire inside the
ring the cruel way — a campfire in the shed, or wait for the storyteller. **Expect:** the fire
eats the shed and stops at the paving. Fire crosses stone only to reach something that burns.

## 7d. Take it all back down (~2 minutes)

Everything you have put on the ground so far, you can now change your mind about. Press `X` —
that is the one tool for it, and what it removes is whatever is on top of the square you click.

Start with a building. Click the woodshed. **Expect:** an amber cross over it, somebody on
construction walks over, and it comes apart into half the stuff it was made of, lying on the
square where it stood. Trees and half-finished frames do not take the cross — fell a tree with
`C` and rub out a frame with the same `X` drag you would use to erase any other order.

Now click the *same square again*, on the road you laid in 7c. **Expect:** the cross goes on the
boards this time, a settler comes and lifts them, half the wood comes back, and the ground
underneath is the ground that was there before you floored it — the sand strip stays sand, the
dirt stays dirt. Not a green patch. Lay planks over paving and take the planks up: you get the
paving's original ground back, not the paving, because the note is written once for the cell and
not once per layer.

Drag `X` across a mixed strip — a shed sitting on a paved yard. **Expect:** one message that
counts both, in the shape of `2 buildings and 14 floor cells marked for removal`. The paving
under the shed itself is *not* in that count and does not come up: one cross takes one layer,
and while the shed is standing the shed is the layer. When it comes down the paving under it is
left, unmarked, for you to cross again if you want it gone — deliberately, because a floor you
meant to keep is expensive to get back and a second click is not.

Take up a **bridge** over the lake. **Expect:** water, immediately, and a settler standing on the
next plank along rather than on the one they are pulling — the same rule that built it out from
one end. If somebody is standing on the cell when it opens, they get shoved to the nearest dry
square, the same as a settler who gets walled in.

Then possess someone (`V`), or flip a settler to manual, and click a floored cell directly.
**Expect:** they walk over and lift it, but *only* if you had already marked it with `X` — an
unmarked floor is a place to walk to, not a job. That asymmetry is on purpose: clicking your own
corridor should send you down it, not tear it up.

## 8. Take a hit

The storyteller sends the first beat within the first day or so: two Ashbound raiders walk
out of the treeline, and the log says so.

Select your settlers and press `T` to draft each one (or use the Draft button in their row).
Drafted settlers shoot on their own. Right-click puts a drafted settler where you want them —
behind sandbags (`8`) is better than in the open.

Then possess one and fight from inside: `V`, click to capture the mouse, hold left click to
attack. You can only attack while drafted; the crosshair turns red when you are.

**Expect:** shots fly, raiders drop or flee, the log narrates it, and "The clearing is quiet
again" when it's over. Someone downed can be healed — a settler with Doctor priority will
come to them, or you can walk over and press `E` yourself.

### Line the approach before the next one

Open **Build → Defence** and take **Deadfall trap** (12 wood, no hotkey — it lives in the
group). Fence off everything but one gap in the treeline side of your yard, then lay four or
five traps in a row across that gap and let the colony build them.

**Expect:** they draw as flat dark plates with two raised jaws, and your own settlers walk
straight over them all day without a scratch. When the next raid comes through the gap, the
log says *"A deadfall catches …"* and the plate on that cell goes back to being a blueprint —
still a trap, still on your corridor, just wanting its twelve wood again. Leave someone on
Construction and it re-arms itself. This is the whole trick: you are not shooting at raiders,
you are deciding which ground they have to cross.

### Watch what the raid does about the turret

Once you have 30 steel, put a turret (`7`) on the approach with a generator near it and wood
in the stockpile, then wait for a raid — or send one with `aether.raid()` from the console.
Sit in the manager view and watch what they aim at.

**Expect:** raiders inside about thirteen cells of a *powered* turret shoot the turret rather
than walking past it to find a settler, unless a settler is nearer. Its health bar comes down.
It can die — and when it does, the log says so and a turret blueprint appears on the same cell
on the job board, wanting its 30 steel again. Cut the power (deconstruct the generator, or let
it run out of wood) and the same raiders ignore the turret completely and come for your people.

Now put a line of sandbags between a raider and whoever they are shooting at, and watch them
step *behind* it rather than standing in the open — the same cover rule your settlers get.
On bare ground with nothing to hide behind they stand and trade, which is the old behaviour.

## 9. Get someone sick

Three or four days in, the log will say somebody has come down with the flu — the storyteller
runs an outbreak on its own timer and picks whoever you have been working hardest.

Click them. Under their health bar there are now two more bars: **illness** climbing and
**immunity** chasing it, with `untended` or `tended` beside them. Their row in the colonist
list carries the same thing as a red tag.

**Expect:** they stop working, walk themselves to a bed and stay in it — that is bed rest, and
they will still get up for a raid. A settler with Doctor priority comes round with medicine
and the tag flips to `tended`; the log says so. Within a day or two the immunity bar wins and
the log says they have shaken it off.

Then do it the other way, because this is the part that has to be fair. Draft the sick settler
so they cannot go to bed, and let their food run down. **Expect:** the illness bar overtakes,
they collapse with a message on the log, and — if you still do nothing — they die most of a
day later. That gap is deliberate. Nobody in this game should die of a fever you were never
told about.

Build a **hospital bed** from the build bar (**Furniture** tab, next to the ordinary bed) and the sick will pick
it over a normal one — and the healthy will walk past it, so it is free on the night it is
needed. It is worth about 30% more immunity a day.

Worth doing once: eat raw. Let the meals run out and watch someone eat a raw turnip straight
off the pile — roughly one in nine gets food poisoning, which is fast, unpleasant and can
never put anyone down. That is the argument for the stove.

## 9b. Set the bunk room alight (~1 minute)

Fire is the one thing you cannot ask the storyteller for, so the dev build puts it on the
browser console. Open it (`⌥⌘I` on a Mac, `F12` otherwise), type `aether.help()` for the
list, and use these two:

```js
aether.burnBed()          // light the cell the first settler is standing or sleeping on
aether.burnBed('Wren')    // or name one — aether.who() lists them
```

Do it at night, with people in bed. **Expect:** *"Sorrel wakes with the bed alight"* and
that settler is up and running for clear ground before the flames take a second cell —
whatever their priority table says, because no column means "stand in the fire". Somebody
else with any Firefight priority starts beating the fire out.

Now the case this exists for. Wait for somebody to be **downed** — a raid, or draft a sick
settler and let them collapse — and burn the cell they are lying on. **Expect:** *"Wren runs
for Halle, who is down in the fire"*, one rescuer and not four, and Halle is carried out and
put down on clear ground: *"Wren pulls Halle clear of the fire."* Before this, four settlers
burned to death in their beds on seed 1337 without ever waking up.

The other hooks are `aether.raid()`, `aether.beasts()` and `aether.ill('name')`, which are
the same calls the storyteller makes. `aether` does not exist in a production build.

## 9c. Watch the colony tell on itself (~1 minute)

Bottom right is the alert strip, and on a healthy colony it is not there at all. Break
something and watch it turn up.

Press `X` and deconstruct both lamps' generator — within a tick, *"Grid short — 2 buildings
off"* in amber. Put a wall blueprint down somewhere with no steel left in the pantry and you
get *"1 blueprint waiting on steel"*, which is the thing that used to happen invisibly for
twenty days at a time. Light a fire with `aether.burnBed()` and *"Fire burning"* goes to the
top in red, above everything amber.

**Expect:** rows leave by themselves the moment you fix the thing — rebuild the generator and
the power line disappears on the tick it comes back on. Click a row that names a settler and
the camera goes to them and selects them. Six rows at most; the rest arrive as those clear.

**Expect not:** an alert for something you have already dealt with. Nothing here is
remembered — the list is recomputed from the world every frame.

## 9d. Follow the Next steps panel (~1 minute)

Top right, under the clock. On a fresh colony it reads *Widen the field to thirty squares*
(12/30), *Bank two hundred steel* (90/200) and *Lay ten sandbags across the approach* (0/10).
Each row names the tab the button is on, so you do not have to already know.

Do the third one — **Defence → Sandbag**, ten of them in a line across the way in. Let the
builders finish.

**Expect:** *"Milestone — there is a sandbag line to fight from"* in the log, the header
counter goes to `1/14`, the row disappears and *Drop your first raider* takes its place. The
bars on the two rows above move as the field and the stockpile grow.

**Expect not:** a milestone for something you did not decide. Nothing on this list is
something the settler AI does on its own — that is the whole design of it. Deconstruct the
sandbags again and the milestone stays earned; losing a thing is the alert panel's job.

## 9e. Let an undrafted settler get shot at (~1 minute)

Lay a short sandbag line, put an armed settler a couple of cells behind it, leave everyone
undrafted, and call a raid with `aether.raid()`.

**Expect:** the settler backs *to* the sandbags rather than straight away from the raider,
and fights from behind them. An unarmed settler in the same spot just runs — no gun, no
reason to hold ground.

**Expect not:** a **drafted** settler doing any of this. Draft them with `T` and they stand
exactly where you put them, which is the point of drafting.

## 9f. Watch a friendship form (~2 minutes)

Click any settler. The details panel now ends in two ruled sections — **skills**, then
**bonds** once they have an opinion about anybody. Note that the Next steps panel gets out
of the way while the details panel is up: they share that corner, and deselecting (`Escape`)
brings the checklist back.

On a fresh colony the bonds section is not there yet — nobody has met anybody. Run at 3×
for two or three game days with everyone working in the same half of the base.

**Expect:** *"X and Y have become friends"* in the log, once, on the day it happens — not
again the next day. Select either of them and the other is listed as `friend`, in green.
Somebody who has been unlucky reads `rival` in red.

**Expect not:** `inseparable` on anybody this week, or the whole colony reading the same
word. The top of the scale is deliberately expensive — an opinion climbs slower the higher
it already is, so `inseparable` belongs to a pair who genuinely spend their days together
and most settlers plateau somewhere in `friend`. If everybody is inseparable by day seven,
that is the bug this rule exists to prevent.

**Expect not:** two settlers separated by a wall forming any opinion at all, or anyone
befriending somebody asleep. Bonds need line of sight, two cells, and both parties awake.

Then take it apart: `aether.who()` for the ids, pick the settler with the strongest
friendship, and let them die (`aether.burnBed(<name>)` and leave it). The log names the
survivor — *"X has lost a friend"* — and their mood drops further than everybody else's.

## 9g. Bury the dead (~2 minutes)

Follows on from 9f, and it is the answer to the thing that section leaves lying in the
yard. Open the build menu, **Furniture** tab, and place a **Grave** somewhere clear near
the cabin. Four wood; a settler will dig it inside a minute.

Now look at the alert panel: **1 unburied body**, and the hint changes depending on
whether a grave is standing yet. Click the alert row — the camera goes to the body.

**Expect:** a settler with Haul priority picks it up unprompted, carries it on their
shoulder (watch from first person with **V** — it is the same carry the warden uses on a
prisoner), lays it in the grave, and the log says *"X has been laid to rest."* The alert
clears. Everybody's mood ticks back up.

Click the grave. The panel names who is in it.

**Expect not:** anyone starting the walk while raiders are still standing. Try it —
`aether.raid()` while a body is out — and the burial waits until the shooting stops.

If you leave a body out instead: four days later it is gone, with a line in the log. The
colony that never builds a grave is not punished forever, just constantly.

## 9h. Make the cabin worth living in (~3 minutes)

Click the starter bed. The panel has a **beauty** row under the room row — one number and
one word, and on a bare cabin it will say something like `+3 · tidy`. Click a settler
standing inside and the same room reads back on their panel as **surroundings**, right
under warmth. Walk them out the door and it says `outdoors`, which is the point: a field
is not somewhere you failed to decorate.

Now spend on it. Press **I** and drag a **plank floor** across the cabin, and put a
**Statue** (Furniture tab, 20 steel and 10 wood) in the middle of it.

**Expect:** the beauty row climbs as each thing finishes — `tidy` → `handsome` →
`beautiful`, and the number turns green. Mood ticks up for everybody standing in the room
and nobody else. It is a small lift on purpose: about a third of what a full stomach is
worth, so a handsome bunkhouse buys you a bad week, not a famine.

**Expect not:** the room row changing. A statue is head-height and solid — you walk round
it and it stops a bullet — but it is deliberately shorter than a wall, so a line of them
across the cabin leaves `99 cells · 1 door` exactly as it was. Build the row and watch.

Then make it worse, because that half matters more: drop a **Grave** indoors and watch the
row fall, or let a body lie on the floor and watch it fall much harder. That is the
cheapest lesson in the game about where the cemetery goes.

## 9i. An evening off (~3 minutes)

Open the **Comfort** tab on the build bar — it sits between Furniture and Climate, and it
holds the two things you build only because the people here are people. Place a **Games
table** (10 wood, 4 steel) somewhere inside, and a **Campfire** from the Climate tab
outside the door.

Now wait for the evening, or just watch the recreation bar on the settler panels. When one
of them gets bored, follow where they go:

- Two settlers should end up at the games table and no more — it seats two, and the third
  goes to the dining table rather than standing in the queue.
- The panel says what they are actually doing: **playing a game** at the board, **sitting
  by the fire** at the campfire, **relaxing** at the table.
- Let the campfire burn out (its fuel runs down; the panel shows it) while somebody is
  sitting at it. They should stand up and go back to work, not sit in the dark scoring
  full marks.

The thing to look for is the gathering. Light the fire in the evening and they arrive at it
one at a time instead of taking private turns at the same table — an hour with company
fills the bar nearly twice as fast, and their opinion of each other goes up while it does.

## 9j. Leave the colony alone and watch it build (~4 minutes)

The `Steward: on` button in the top bar is the colony's own foreman. This step is the one
where you do nothing on purpose.

Cancel everything you have queued (`Backspace` over any blueprint or painted cell — the
Steward will not propose anything while your own plan is on the board), then set the speed
to 3× and watch the yard for a few game days.

**Expect, roughly in this order:**

- If the woodpile is low, settlers walk *out* with axes before anything else gets marked —
  chop designations appear on the trees nearest the cabin, and the log says the stores are
  down. Nothing gets spent until the shed is back over eighty wood.
- A fence line stakes itself out around the yard, eight posts at a time, and once most of it
  is standing a **gate** is hung in it.
- A generator goes up outdoors, then a turret behind the fence line, then conduit out to it.
- A **workbench** appears indoors, and behind it a **research bench**. Within a pass of that
  bench being finished the log should say the colony has *taken up* something — open `L` and
  the bar is moving without you having chosen anything. This is the one thing the Steward
  does that is not a blueprint, and it exists because before it, an unattended colony
  finished ninety days having researched precisely nothing.
- Then the cabin floor goes to boards, a games table appears indoors, and after the colony's
  first raid, sandbags either side of the gate.

Two things to try to break it with:

- **Queue a wall of your own mid-fence.** The Steward should stop proposing entirely until
  your wall is up. It is waiting for a clear board, not racing you for the wood.
- **Spend down to nothing.** Whatever the colony's stock, `Backspace` and check the numbers:
  it will never take the last 40 wood or 30 steel. That float is what you build an emergency
  wall out of, and it is the reason the Steward can be left on.
- **Choose your own project.** Open `L`, pick something the Steward would not have picked,
  and leave the game running. It must still be there, with its progress, a game day later —
  the Steward only ever fills an empty bench. Queue a wall at the same time: everything else
  it does stops dead until your wall is up, but the bench keeps working, because choosing
  what to study costs nothing and takes nobody off your build.
- **Play past day forty and look at `L` again.** The tree used to run out here — on a quiet
  valley it was finished by about day 37, and the last three weeks of a sixty-day run were
  spent with a settler standing at a bench with nothing on it. Past `plateworks` there are now
  four more projects, and they are the reason to keep looking: each carries a **bill** under
  its row, in chips reading `12 / 180 steel`, green once that line is covered and amber while
  it is not. That is the third tier, and it is the first thing in the game that costs goods as
  well as time.
- **Take up `Foundry` with an empty yard and watch what the bench does.** Points still
  accumulate; the project does not land. At 100 % the strip at the top stops showing a
  percentage and reads **needs 12 parts, 74 steel** in amber, the project row says *Worked out,
  and waiting on the delivery*, and the settler walks away from the bench — there is nothing
  left there to do. The bill is netted against the yard, so the number you see is what is
  *missing*, not what it costs. Watch the rest of the top bar while it says so: the shortfall
  is a far longer string than the `100%` it replaced, and nothing else up there should move.
- **Now leave the Steward on and go and make tea.** The parts are not on your map. Components
  have no patch and no recipe; the middle ring is the only place that sells them, and a caravan
  is the only way any arrive. An unattended colony is supposed to work this out — watch `J`
  and the log, and the next trade party should set off for the parts town rather than for the
  best-paying neighbour it has been using all game. When the crate lands the bench goes back on
  the board — somebody has to walk over and fit the parts, so give it a minute — and then the
  project and the components go together. The foreman returns to its old route. If it keeps
  walking to the parts town after the bill is paid, that is worth reporting: the pull is keyed
  on the shortfall and is supposed to switch itself off.
- **Then take up `Instruments`, and watch where the party goes this time.** The last two rungs
  do not bill parts. They bill **machinery** — `8 / 200 steel` on Instruments, `12 / 260` on
  Waystations — and machinery is sold in the *far* ring and nowhere else, nine or ten days
  out. Same behaviour, longer road: the foreman should pass the parts town it has been using
  and set off for the works. Two things are worth watching on the way. The pantry has to cover
  forty meals for that road and four settlers have to stay home, so a small colony will simply
  refuse — `J` says which. And the strip at the top gains a **Rigs** count beside Parts once
  any arrive. A twenty-day round trip for eight units is the price of the top of the tree; if
  the party goes somewhere nearer while the bill is outstanding, report it.

Press `Steward: on` to turn it off at any point and the marking stops that second. Anything
already blueprinted stays — it is your colony's plan now, and it cancels like anything else.

## 9k. Send somebody over the ridge (~3 minutes)

Press `J`. Twelve neighbours in three rings — how far each is, what they are short of, what
they pay in, and how well they know you. Only the near four have packs under them on day
one; the other eight are headings with a sentence saying what would open that road. That is
9ii's business. For now pick a pack you can actually spare from the near ring — the
affordable rows are the bright ones — and send your best talker.

**Expect:**

- They walk to the edge of the map and *vanish*. Not a dot in the corner: they are gone
  from the colonist strip, gone from the map, and nothing can select or path to them. The
  road panel turns into one line — who is out, what they are carrying, and roughly how many
  days until they are back.
- Days later they walk back on at the same spot, drop the goods on the ground for a hauler
  to carry in, and the log says what they brought and what the neighbours now think of you.
  Their `social` skill has gone up, which shows in the inspector.
- Sometimes it goes wrong on the ridge. The pack is lost and they come home badly hurt —
  never dead. A better standing and a steadier hand both make that rarer.

Two things to try to break it with:

- **Send your last-but-one settler, then check the day counter.** A colony that is three
  settlers down does not end because one of them is four days out; the wipe check knows
  about the road.
- **Save while somebody is out and load it back.** They should still be out, on the same
  leg, with the same days left — and still come home.

## 9l. Read the path to a win (~1 minute)

Look at the **Next steps** panel. Under the tutorial goals there is a second heading, **The
founding**, with a charter count and the outstanding ones: eight settlers, twelve days of
food, two turrets, six research projects, and an ally over the ridge.

**Expect:** the counts move as the colony does — the food line in particular ticks up and
down through the day as meals are cooked and eaten. If you ever get all five at once, the
log says so and a green countdown replaces the list: three days to hold it together. Break
one (deconstruct a turret to prove it) and the log names the charter that went and the
count starts over.

Hold it and you get the founding card — the final tally, and two buttons. **Keep playing**
is the one to press: it dismisses the card and *the colony is still there*, unpaused, with
the Steward still planning and the road still open. Watch the clock for a day afterwards
and check that things still happen — a caravan arrives, the foreman puts something up, an
event fires. A colony that goes quiet the moment it wins is the bug this button exists to
make visible (see **Winning** in the README). The card does not come back once dismissed.

## 9m. Walk into the haze (~2 minutes)

Start a new colony and look at the map before you touch anything. The yard is drawn — the
cabin, the settlers, the trees they are about to be told to chop — and a dozen cells out it
ends in weather. That is not fog the weather put there: it is ground nobody has walked.

Draft somebody, point them at the dark, and follow them out.

**Expect:**

- The haze *lifts* as they walk and never closes back in behind them. Go back to the yard
  and the corner you just opened is still on the map. A base that vanished the moment
  nobody stood in it would be the bug, not the feature.
- Rock tops and pine crowns push up through the haze rather than being sliced off flat at
  the edge, so an unwalked ridge reads as a treeline in fog and not as a missing chunk of
  the level.
- It takes the sky's colour. Watch it through a dusk: the same haze goes blue at night and
  pale in a snowstorm, next to a scene that is doing the same thing.
- The first time a landmark comes into view the log says **"Something is standing out to
  the north-east"** and drops a pin — once, not every tick you can see it.
- Press `V` and walk out on foot. The wall of haze sits about where the weather already
  puts the far plane, and it retreats ahead of you at walking pace.

Two things to try to break it with:

- **Open the pinned landmark's panel.** Seeing a cairn is not reading it: the site is
  sighted but *not* found, so the scouting order is still there to give and the cache under
  it is still unknown. If sighting a thing surveys it, scouting has stopped meaning
  anything.
- **Load a colony you saved before today.** It has no record of where it has been, so it
  opens onto its own lit base and buildings with haze everywhere it has genuinely never
  been — and it must do that *silently*. Eight letters announcing cairns your settlers have
  been walking past since Tuesday is the failure.

## 9n. Read the map in the corner (~2 minutes)

Top left, under the bar, there is a 192-cell-square drawing of the valley — the whole world,
where the colony view only ever shows you about thirty cells of it.

**Expect:**

- **It is the same valley.** The ground is painted out of the palette the 3D view uses, so a
  gravel flat is grey here and grey there — and the map turns with the year along with the
  world, gold in autumn and pale in winter, while the stone stays stone. Only brighter: the
  world is sun-lit and a 200-pixel panel is not.
- **A white outline showing where you are looking.** Pan and it slides; zoom out and it
  grows; orbit and it *rotates* rather than staying square, because the ground you can see
  is a trapezoid at any angle that isn't a right one.
- **Click anywhere on it and the camera goes there.** Hold and drag to scrub the camera
  around the valley. Drag a thumb off the edge of the panel and it pins to the border rather
  than doing nothing.
- **Dots that say what matters.** Blue settlers, white for the body you are possessing, red
  for anything hostile, amber for an unread landmark and drab for one you have surveyed,
  orange for fire. A raider walking into the yard is a red pixel before it is a problem.
- **Press `V` and it stays.** Everything else on screen belongs to one view or the other;
  this belongs to both. Inside a body the white rectangle is replaced by a white line
  pointing where you are facing — which is the one time in the game you cannot see over the
  next ridge, and the one time a map is worth most.

The thing to try to break it with: **walk into the dark**. Nothing is drawn on ground the
colony has not seen — no terrain, no buildings, no bodies. A raider crossing unwalked ground
is invisible on the minimap for exactly as long as they are invisible in the world. If a dot
shows up out there, the map is telling you something the game is hiding, and every reason to
send anybody scouting goes with it.

## 9o. Live through a winter (~6 minutes)

The longest test in this file, and the only one that needs the fast-forward key. Start a new
colony, hold `3`, and watch the top bar next to the clock: `Day 1 · Summer 1/5`. You are
looking for day 11, which is `Winter 1/5`.

**Expect:**

- **The valley changes colour before anything tells you.** Around day 6 the grass and the
  trees start going gold, and they keep going — it never snaps over on a boundary, it slides.
  By day 9 the wood outside the cabin is amber. By day 12 the whole valley is washed pale.
  Nothing anybody built moves at all: the cabin walls, the plank floor and the stone are the
  same colour in midwinter as on day one, which is what makes the ground read as alive. **The
  map in the corner turns with it** — glance at it on day 12 and it is a different valley from
  the one you landed on.
- **The temperature falls with it.** The top bar reads about 13 °C on the first afternoon,
  climbs to the low twenties around day 3, and by day 12 the afternoon is single digits and
  the night is well under zero.
- **Around day 8 the alert strip says so**: `Winter in 3 days · N days of food`, and the hint
  tells you to build a fire *before* it tells you about food, if you have no fire. Build a
  campfire and cook the pantry full and the row leaves on its own.
- **The plots stop.** Sow a grow zone on day 1 and it ripens in three days. Sow one on day 11
  and the green bar does not move — not slowly, at all. Click a growing cell and its card
  agrees with the ground.
- **A heated room does not stop.** Wall a small room, put a heater in it, power it, and paint
  a grow zone on the dirt inside. It ripens in midwinter at very close to the summer rate. Do
  the same with no heater in it and it grows, but at about half speed — a roof is worth
  something and is not the answer.
- **Nobody freezes to death.** Cold does not take hit points. What it does is sit on mood
  every hour and hold the immune system down, so the winter you spend outdoors is the winter
  the flu goes round. Watch a settler's card: `warmth -4°C · freezing`.
- **The log says it once**, on the morning it turns: "Winter. Nothing will grow outdoors
  until spring." Once, not every tick.
- **The rain turns to snow.** Wait out a front in midwinter. The HUD reads `Snow`, or
  `Blizzard` if it is a storm, and the log says so too — "Snow starts falling over the
  clearing. It settles on the plots and does nothing for them." Look at it: the flakes come
  down at a walking pace instead of a streak, they wander sideways on the way, they are very
  nearly white, and they blow much further off vertical than rain does on the same wind. Sit
  through a front on the shoulder of the season — late autumn, or the thaw — and you should
  catch it saying **`Sleet`**, halfway between the two, because precipitation does not flip
  on a knife edge.
- **Snow is not rain with a new coat of paint.** Two things a downpour does for you are gone.
  A grow zone gets no rain bonus at all — click a growing cell in a blizzard and the rate is
  the same as it would be in clear air. And a fire is far worse news: light one (or wait for
  lightning) in a summer storm and the rain very nearly puts it out on its own; do it in a
  blizzard and it keeps eating, because falling snow smothers a flame at about a third the
  rate. **The winter fire is the one that takes the cabin.**
- **And the snow stays on the ground.** This is the one to watch for, because it is what
  makes the season a place rather than an effect. Sit through a blizzard in midwinter and
  the valley goes white *and stays white after the sky clears* — clear weather on day 14
  should still be a white map, in the 3D view and in the corner both. Then keep going: by
  the second week of spring the ground is bare again and the log says so once, "The thaw has
  taken the last of the snow off the ground."
- **Look at where it did not settle.** Your plank floor and any paving you laid are clear —
  snow lies on grass, soil, sand and stone, and on nothing anybody built. Walk it in first
  person (`V`) across a deep-snow day: crossing bare ground is visibly heavier going than
  crossing your own floor, and it is the same drag your haulers are fighting. **A colony
  that paved its yard in autumn keeps moving in February.**
- **It has thickness, not just colour.** This is the one to judge with your eyes rather
  than a number. Orbit low over a plank path in deep snow (`R`/`F` to tilt): the path should
  sit in a shallow *trench*, with the pack sloping down into it and a lit face on one side
  of the slope and a shaded one on the other. The snow should lap up the bottom of walls,
  crates and tree trunks, and settlers should be standing ankle-deep in it rather than on
  top of it. A pond stays a flat hole in the white. If any of that reads as a flat white
  repaint of the grass, the layer has failed at the only job it has.
- **And nothing tears.** Look along the seam where deep snow meets your floor, from inside a
  body, crouched. There must be no crack, no flicker and no slot showing through to nothing
  — the pack and the path are one surface that changes height, not two surfaces at different
  heights. Then let it thaw and check the ground is properly flat again.
- **Watch a settler change their mind.** Lay a paved path that goes the *long* way between
  two places — round two sides of a square rather than across it. In summer, order somebody
  across and they cut the corner over the grass. Do the same in deep midwinter and they
  should take the road, because the short way now costs more than the long one. That
  re-routing is the whole point of paving, and it happens without you touching anything.

The thing to try to break it with: **let it run to day 21**. It should say `Summer 1/5`
again, with the year rolled over, the valley green and the plots worth sowing. A year that
does not close is a year that drifts, and a colony on day 400 must be living in the same
climate as one on day 4.

## 9p. Find the lake (~2 minutes)

Every map has water on it now, out past the first ring of ore. Drag the manager camera in a
slow circle around the homestead until you find it — it should be obvious from a long way
off, and it should look like a lake rather than a blue tile someone painted on the field.

What to actually look at:

- **The bank.** Zoom in on the edge. The ground should slope down into the water over one
  cell, with the beach lit on one side of the bowl and shaded on the other, and the middle
  of the lake flat. If the whole lake is a dish with no flat bottom, or the edge is a sheer
  step, the corner averaging is wrong.
- **The colour.** Open water is darker than the shallows at the edge. That gradient is the
  only thing telling you the lake has a bottom rather than being a hole cut in the map.
- **The beach.** There should be sand the whole way round with no grass touching the water
  anywhere, and no trees standing on the sand.
- **Nothing floats.** Follow the shoreline all the way round looking for a cliff or boulder
  standing near the water. There should always be at least one cell of ground between the
  two, and you should never be able to see underneath a rock.
- **Go and stand at the edge.** Press **V** into a body and walk to the shore. You should be
  stopped at the water exactly where the shore looks like it is, not a cell early or a cell
  late, and you should be able to look down the bank into the water without any part of the
  ground tearing.
- **Send somebody the long way round.** Right-click a spot on the far side of the lake. The
  settler should walk round it without hesitating and without ever touching the water — and
  they should still be able to get *everywhere*, which is the part the generator checks for
  itself before it keeps a lake at all.

## 9q. Walk on the lake (~4 minutes)

The lake freezes. Six days a year — from the middle of winter to the middle of spring — the
one thing permanently in the way becomes the fastest road on the map. Then it goes out.

Get there fast: run the clock at 3× from a fresh colony and watch the log. On the day the
line **"The lake has frozen hard enough to walk on. So can anything else."** appears, stop
and look.

What to actually look at:

- **The bowl comes up level.** Before the freeze the lake sits in a dish below the bank. As
  the ice thickens the bottom rises, and on the tick it starts bearing weight it should be
  flat with the sand around it — one continuous surface, no lip, no step down. If you can
  see a rim at the shoreline the picture and the collision disagree and that is a bug.
- **The colour.** It should read as ice, not as pale water — a cold blue-white, and
  distinguishably *not* the same white as the snow lying on the bank beside it. Two whites
  that match is a flat picture; you should be able to see where the shore is.
- **Walk out onto it.** Press **V** into a body and walk into the lake. You should keep
  going. Yesterday the same step stopped you dead. Walking on it is slightly slower than
  the path but much faster than the drifts.
- **Send somebody across.** Right-click a spot on the far side. The settler should now go
  *over* the lake instead of round it — that is the same pathfinder that made them walk the
  long way in §9p, reading the same map.
- **So can anything else.** If a raid comes while the lake is hard, watch its approach. It
  will take the short way too. A turret line sited against the summer map has a hole in it
  for six days and nobody will tell you which six.
- **You cannot build on it.** Try to paint a stockpile or a pen out on the ice, and try to
  drop a wall blueprint there. All three should refuse. The ice is a road, never real
  estate — a stockpile out there is a pile of steel floating in a lake come April.
- **Then wait for it to go.** Around the middle of spring the log says **"The ice on the
  lake is creaking. Get anyone off it before it goes."** From that line you have about a
  minute and a half of real time. Leave somebody standing out there on purpose. When
  **"The ice has gone out on the lake"** lands they should be dumped on the nearest bank
  with a line of their own and a case of flu — and anything they were carrying, and
  anything left lying on the ice, should be back on the beach too, not at the bottom of
  the water where nobody can path to it.

## 9r. Fish it (~5 minutes)

The lake stopped being only an obstacle and a winter road. Now it is the third way the
colony eats — and the only one you can reach for *while* the emergency is happening.

- **Find where it will let you build.** Open the build menu, **Production**, and pick
  **Fishing stage** (`-`). Drag it around the map with the mouse held down. Everywhere
  except the water's edge should refuse. Walk it along the shoreline and watch it go legal
  the moment there is water directly beside the cell — not diagonally past a corner of the
  bank, straight out. Put one down. Twelve wood.
- **Then make them hungry.** Fishing only happens when the larder is thin, so a colony
  fresh off a good harvest will ignore the stage completely — that is correct, not a bug.
  The quickest way to see it work is a colony that has just eaten through its stores, or a
  spring where the plots are still bare. Somebody should walk out, stand **on** the deck —
  on it, not beside it — and after a while the log says **"… lands N fish."** The catch
  appears on the plank, and a hauler takes it home like any other food.
- **Watch the catch get smaller.** Leave them at it. Each catch takes a bite out of one
  stock shared by the whole lake, and the number in the log should shrink as it goes. Six
  stages on the shore will not fix that — they will just empty it six times as fast, which
  is the point.
- **Fish it flat.** Keep going and the log says **"The lake is fished out. Give it a few
  days."** — once, not on a loop. Now the stage should go quiet: press **E** on the deck in
  first person and you should be told *"The water here is fished out"* rather than handed a
  job that goes nowhere. Wait about four game days and **"The fish are back in the lake"**
  should land, once, with enough in it that the walk out there is worth making again.
- **Then do it in January.** Come back when the lake has frozen hard enough to walk on. The
  prompt on the deck changes from **"Cast a line"** to **"Cut a hole and fish"**, the catch
  takes most of twice as long, and the log says the fish came **up through the ice**. It
  should still work — slower is the price, not a refusal. The tell that these two systems
  are one system: the tick fishing gets hard is the exact tick the lake becomes walkable.

## 9s. Put the lake to work (~5 minutes)

The third thing the water is for. A watermill is the only power on the map that costs
nothing to run and the only one that can be taken away from you by the weather.

- **Unlock it, then find the shore again.** *Machining* has to be done. Build menu →
  **Power** → **Watermill** — it is the last tile in that row, after the solar panel. Drag
  it about: same rule as the fishing stage, water directly beside the cell, no diagonals.
  55 wood and 20 steel, and the site is going to be well away from the cabin, which is the
  real cost — you are paying in conduit.
- **Watch it turn.** Once it is up the paddle wheel should be visibly going round, slowly,
  out over the water, with the house and its little pitched roof up on the bank. Two mills
  side by side should *not* be in lockstep. Click it: the card says **150 W** and
  **wheel — turning**.
- **Run the colony off it.** Wire it home and pull the generator's fuel out, or just don't
  build one. Lamps stay on through the night with nothing burning. That is the whole selling
  point — a panel goes dark at dusk and a generator eats a log every forty-five seconds; the
  wheel does neither.
- **Then take it away from them.** Run the clock to deep winter, or watch for **"The ice has
  set"**. The tick the lake becomes walkable, the wheel should stop dead — not slow down —
  and the log says **"The lake has set solid — the watermill is stopped until the thaw."**
  once. The mill goes dull like any unpowered machine, the card reads **0 W** and **wheel —
  locked in the ice**, and anything downstream that has no battery behind it drops. Three
  mills should produce *one* line saying `3 watermills`, not three lines.
- **Check it doesn't cry wolf.** A solar flare should knock the mill's output to zero without
  ever claiming the lake froze. Save during winter and load: no freeze message on load, it
  was already frozen. Then wait for **"The ice has gone out — the watermill is turning
  again."** — the same tick the lake stops being walkable.
- **The lesson the winter teaches.** The correct build is not "mill instead of generator."
  It is a mill, a battery bank, and a generator with fuel in it that sits cold for three
  seasons. If a January freeze blacks out your heaters, that is the game working.

## 9t. Cross the lake (~4 minutes)

- **Paint a line out onto the water.** Press **U** (Build → Floors → Bridge, 6 wood a cell)
  and drag from a bank straight out into the lake — five or six cells, or the whole way over
  if you can see a neck. The preview should stay lit over water and grey out the instant it
  touches grass, sand or rock. Painting the far half of the crossing, where nobody can
  possibly stand, must be allowed.
- **Watch it build itself.** This is the thing to actually watch. The deck should appear
  **one cell at a time, outward from the bank** — never a plank in the middle of the lake
  with a gap behind it. A settler walks to the end of the finished boards, kneels facing the
  water, and the next cell appears. If the whole span sits marked and nothing happens, or a
  settler walks out and stands there doing nothing, that is the bug this step is for.
- **Look at it.** The deck should stand *above* the water, not replace it — the lake goes on
  being shaded and sunk underneath, and there should be a handrail on every edge that faces
  open water and none on the edges that meet the bank or the next deck. Two decks side by
  side should show a seam, not read as one slab.
- **Walk it.** Possess a colonist (**V**) and walk out to the end. You should be able to stand
  on it, and stepping off the side should be as impossible as walking into the lake anywhere
  else. Then walk the same distance over grass and compare — the bridge should feel like a
  plank road, not a sprint.
- **Winter it.** Run to deep winter. The lake freezes and everything becomes walkable, but
  settlers should still route over the boards rather than the ice beside them. The deck itself
  never becomes impassable, never disappears under the ice, and does not turn back into water
  in spring.
- **Try to cheat.** In midwinter, with the ice bearing, try to lay a **plank or paved** floor
  on the frozen lake. It must refuse. If it lets you, you have just built a permanent steel
  road across open water, and in April the lake will be gone from under it.
- **Save and load with a bridge on the map.** The crossing must come back as a crossing, not
  as water and not as a plank floor sitting on nothing.

## 9u. Send a Picky (~4 minutes)

- **Send one somewhere easy.** Press **`** (Check → Send a Picky) and click a patch of grass
  a dozen cells from the cabin. A knee-high pink goblin should *pop* into existence beside
  your settlers — spinning up out of nothing, not fading in — trot the whole way there on
  its own legs, and then say so: `A Picky reached (x, y) in Ns — the colony can get there`.
  Then it pops out the same way it arrived. Watch its ears; they should lag the bounce.
- **Check it is not one of yours.** Try to click it. It must not select, must not appear in
  the settler list, must not be given a job, and must never be somebody you can possess. If
  you cannot tell at a glance that it is not a colonist, that is the bug.
- **Now send one somewhere it cannot go.** Wall a single cell in completely — eight walls
  around one square of grass — and click the middle of it. This is the whole feature: the
  cell is walkable, in plain sight, on ground you have explored, and nothing can get to it.
  Expect `Cell (x, y) — nothing joins it to where the colony is standing. The Picky wails,
  and pops.` Click the message and the camera should jump to the sealed square.
- **Ask it about a building.** Seal a *door* off the same way and click the door itself. The
  refusal should name it — `The door at (x, y) — nothing joins it…` — not just give you two
  numbers to go hunting with.
- **Watch a door open for it.** Send one at something on the far side of a shut door, with
  every settler asleep or busy elsewhere. The door must swing for the goblin. If it walks
  through a closed door, stop and report it.
- **Run the rounds.** Press the **▸ Picky rounds** tile. One goblin picks six of your own
  buildings and walks to each in turn. It should say *nothing* between stops and report once
  at the end. Then wall off your own stockpile and run it again — sooner or later it should
  come back with the failure instead.
- **Try the doors.** Press **▸ Try the doors** and watch where the goblin puts its feet. It
  must stand *on* each door, not beside it — the door swings, it walks through the gap, and
  it moves on. Now brick a door in on both sides with walls and run it again: that door must
  come back as the one it could not reach.
- **Check hauling.** Drop something out in the field (chop a tree and leave the wood), then
  press **▸ Check hauling**. The goblin walks to the wood and then on to the store it would
  end up in. Now wall your stockpile in completely and press it again — the failure you get
  is the reason your haulers have been standing about.
- **Surprise me.** Press **▸ Surprise me** half a dozen times. Each goblin should announce
  what it decided to do *before* it goes, and it should never pick an errand the colony
  cannot supply — no door-trying in a colony with no doors. Early on, before you have built
  anything, every one of them should simply pick a cell and run at it.
- **Spam it.** Send seven. The seventh must refuse in a sentence — `6 Pickies is already too
  many Pickies` — rather than silently doing nothing. Six at once should read as a crowd,
  not as one goblin drawn six times: they are all pink, but not the *same* pink.
- **Send one at something hopeless and walk away.** Inside a minute it gives up out loud and
  pops anyway. No Picky is ever still standing there two minutes later.
- **Prove it changes nothing.** Save, send six Pickies, let them all pop, then load. The
  colony must come back exactly as you left it. And with one mid-errand: save while a goblin
  is walking, load, and it should still be walking, on the same errand.
- **Look at it in first person.** Press **V** while one is out. It should be there, at knee
  height, from inside a body — same goblin, same errand, no second version of it.

## 9v. Tame something and keep it (~5 minutes)

- **Tame one.** Paint a pen (`Y`), press `K`, click a grazing mossback and let a farmhand
  walk it round. The moment it comes in, the log should say it took to *somebody* by name —
  `Mossback takes to Wren — it is Biscuit now, and it follows them` — and the handler is
  whoever actually did the work, not whoever happens to be standing nearest.
- **Look at the two cards.** Click the handler: a **their animal** row with the pet's name in
  green and `mossback · at their heel` under it. Click the animal: the header is *Biscuit*,
  the sub-line reads `mossback · companion`, it says who it follows, and where the Slaughter
  button used to be there is **Let go**.
- **Walk away from it.** Possess the handler (`V`), run to the far side of the map, and look
  behind you. It should be coming — visibly running, not ambling — and it should close the
  gap rather than trail further and further back.
- **Take it indoors.** Walk into the cabin and shut the door behind you. The animal must come
  through the door. If it stands outside pressing its face at the wall, stop and report it.
- **Try to eat it.** Press `H` on your own pet. It must refuse in a sentence that names the
  settler it belongs to. Now drag the hunt tool across a yard with the pet and two penned
  goats in it: the goats get marked, the pet does not.
- **Check the pen still calves.** With a pet out following somebody, a pen with room should
  keep breeding on its usual clock. If bonding animals quietly stops your calves, that is
  the bug this step exists for.
- **Let one go.** Press **Let go** on the card. It goes back to the herd under its species
  name, the handler takes a small knock, and they are free to tame another one.
- **Then lose one.** Let a raid or a predator get it, or `H` it after letting it go. When a
  *bonded* one dies you should get a headline naming both of them, no meat and no hide on the
  ground, and the loss written into the settler's life story. Check their mood card
  afterwards: their animal should be gone from it, not showing as a penalty forever.
- **Save with one mid-follow.** Save while it is walking after somebody, load, and it should
  still be theirs, still named the same, still coming.

## 9w. A night with wolves in it (~6 minutes)

Open the dev console and call `aether.pack()` — otherwise you are waiting on the storyteller.

- **Read the arrival.** A headline naming how many came down and saying, in as many words,
  *they are after the animals, not you*. They should appear at the edge of the map, a long
  way off, not in your yard.
- **Watch them cross.** They walk in aimed at the colony rather than milling about in the
  treeline. Dark grey, low heads, small pricked ears — you should be able to tell one from a
  mossback at manager zoom without clicking it.
- **Do nothing and watch what it costs.** Leave them alone with a stocked pen. They should
  pick the pen over the woods, run an animal down after a real chase, and the log should say
  which one they got. Now look at the ground where it died: **no meat and no hide.** If there
  is a pile of raw food there, the whole feature is backwards and the correct play is to let
  them eat.
- **Check nobody got bitten.** Stand a settler in the middle of the pack and leave them
  there. Their health bar must not move. A wolf that attacks a person is a raid with a
  different mesh, and this is the one thing that must never happen.
- **Check you were told.** You should get a `threat` line the moment one comes in among the
  buildings or into a pen — without clicking anything — and the animal should already be
  marked for the hunters. Once, not once a second.
- **Try to tame one.** Press `K` on a wolf. It must refuse. If you can turn a pack into six
  pets, there is no problem left.
- **Answer it.** Send somebody with a rifle. A wounded wolf breaks off the chase and runs,
  the same as any hunted animal, and one that dies leaves meat and hide like anything else.
- **Then wait them out.** Around a day and a half after they arrived, the log should say the
  pack gives up and moves off, and they should actually walk off the edge — not stand around
  the map forever. Check the animal count afterwards: no wolves left.

## 9x. The pen that holds (~5 minutes)

The point of the wolves is that there is an answer which is not a rifle. This checks the
answer works and, just as importantly, that it is *visibly* working.

- **Build the pen.** Wall a square around your animals and leave one cell for a **door**.
  Finish it — a blueprint is not a wall, and a blueprint door is not a door.
- **Check your own side first.** A settler walks through the gate. A tame animal walks
  through the gate. If a goat is standing outside its own pen unable to get back in, stop:
  that costs two working systems to buy one.
- **Now call the pack** with `aether.pack()`. They should come down the hill and **stop at
  the fence** — working along it, nosing at the gate, not walking through it. Nobody inside
  should lose a hit point.
- **Watch the gate itself.** It must stay shut while a wolf stands on it, and swing for the
  next settler that walks up. A door that opens for a wolf is the feature lying to you.
- **Break it on purpose.** Deconstruct one wall cell and call `aether.pack()` again. They
  should find the hole and take an animal. If they do not, the pen was never the thing
  holding them out.
- **Trap the approach.** Line two deadfalls in front of the gate and call them again. A
  deadfall should kill a wolf outright. Walk a settler over the same traps first — nothing
  happens, as always. Let a mossback graze across them — nothing happens either.
- **Send everyone indoors** and call `aether.pack()`. They must still arrive. A pack that
  only happens when somebody is standing outside is a pack you would never see once you
  had a working colony — this is the exact thing that broke when doors became walls, so
  check it.
- **Let them leave empty-handed.** A day and a half later they should walk off with
  nothing taken. That night — wolves came, wolves failed — is the wall being paid for in
  front of you.

## 9y. Breed a herd (~6 minutes)

- **Read the sex before you spend the day.** Click any grazing animal. The sub-line carries a
  ♀ or a ♂ before `wild animal`. It must be the same symbol every time you click it — if it
  flickers, the sex is being rolled somewhere it should be derived.
- **Tame two of the same one on purpose.** Paint a pen with room for three, then `K` two
  males into it. Nothing should ever be born. Within half a game day the log must say so —
  *Every mossback in the pen is male — there will be no calves until a female joins them* —
  and then say it about once a day, not once a tick. A player who cannot find out why their
  pen is barren has been handed a bug, not a challenge.
- **Fix it.** Tame a female in. The message must stop immediately, and a calf should follow
  within a couple of days.
- **Watch it grow.** The calf arrives visibly smaller than its dam — under half her length —
  and fills out over three game days. Its card says `♀ livestock calf` with a **grown in**
  row counting down. Nothing else in the game has a size that changes, so if it snaps to
  full size the moment it is born, that is the thing to report.
- **Kill it too early.** `H` a day-old calf. It should drop about a quarter of the food an
  adult does and the log should say *calf* in the sentence. That is the pen charging you for
  impatience, and it is the whole reason breeding is slower than farming.
- **Try to breed the calf.** With one adult and one calf in a pen with room, nothing should
  be born until the calf is grown. If a pen of two animals can double every two days from a
  single tamed pair, livestock has stopped being the slow food loop.
- **Save mid-calf.** Save while one is half grown, reload, and it must still be half grown —
  the same size on screen and the same countdown on the card.

## 9z. Let something get old (~4 minutes, plus a long run)

- **Read an age.** Click any grown animal. Under health there is an **age** row in days. A
  wild one you have just met should read somewhere between one and about nine days for a
  mossback, never `1 day` on every animal you click — arrivals are meant to be spread
  across their years, and all-the-same-age is the thing to report.
- **Find an old one.** Keep clicking wild animals until one says *past breeding, dies in N
  days* in red. If the herd on the map at hour one contains one of these, that is a bug: a
  fresh arrival should never be past it.
- **Run a pen long.** Tame a pair, let it calve, then leave the game running at speed. When
  a founder's years run out, the log must say *Old age takes the mossback in the pen — a
  hide, and nothing anyone will eat*, and a hide must appear where it fell — with no raw
  food beside it and no second line about raw food. Old age paying out a full slaughter
  would make it free.
- **Then check the pen still works.** With the founders gone, the calves they left should
  keep breeding. If the herd stops for good the moment the original pair dies, the
  replacement loop is broken and livestock is a dead end rather than husbandry.
- **Let a pair grow old together.** With both animals past breeding, the log should say
  *Every mossback in the pen is past breeding — this herd will not grow again without new
  blood* — and it must not tell you they are all one sex, because they are not.
- **Lose a companion to time.** A bonded animal that dies of old age gets one goodbye — the
  named line about its person sitting with the body — never that plus the livestock line.
  Two notices for one death reads as a bug even when it isn't one.
- **Watch the moor.** Wild animals that reach the end simply are not there any more. You
  should never find a free carcass on the grass that nobody killed, and you should never
  see *The last of the herd passes out of the valley* while a herd is plainly still grazing.

## 9aa. Walk to the rim (~5 minutes)

The valley is 192 across now, up from 96 — four times the ground, almost all of it added
at the edges. The homestead is untouched, so this is only worth checking from the outside in.

- **Read the minimap.** The corner map should still be the whole valley, not a crop of it,
  and the fog should still be a border of unlit country rather than a solid black square
  with a lit dot in it. If your cabin sits dead centre with the map's edges cut off, the
  minimap is drawing at the old size.
- **Send somebody to a corner.** Draft a settler and order them to the far north-east.
  Expect a long walk — genuinely long, most of a day. What must not happen is the order
  bouncing, the settler standing still, or the path stopping halfway and giving up: the
  pathfinder's budget scales with the map, and a settler who refuses a corner they can
  plainly see is the bug this step is for.
- **Check the water grew with the map.** The lake should still read as a lake — a body you
  walk around, not a puddle. A pond you can throw a rock across means the basin did not
  scale and fishing has quietly become worthless.
- **Count the country.** Wildlife is a density now, not a fixed fourteen, so a bigger valley
  should hold noticeably more animals — but the moor immediately outside the fence should
  feel about as busy as it always did. Deer three deep in the yard means the cap is being
  read as a target.
- **Watch a herd migrate out.** Wait for a *herd is crossing the valley* line, then follow
  them at speed. They must actually leave. A herd that walks into a corner of rim rock and
  mills there forever is the old exit-point bug, and it is worth reporting with the seed.
- **Note the seed.** Every seed is a different valley now — the terrain is drawn from the
  same stream the settlers are, so a wider map re-rolls all of it. If you had a favourite
  seed, it is a new map. That is expected; it is not a corrupted save.

## 9bb. Follow the food chain (~7 minutes)

Three links now: brambles, the brambletails that eat them, and the fenwolves that eat those.
Most of this is watching rather than clicking, and the interesting part is what happens when
you interfere.

- **Find a bramble patch.** Walk out past the yard — they are never within nine cells of the
  hearth. Look for clusters of low round bushes, three to six together, dull green when
  they are bare and reddening as the fruit comes in. A single bush on its own is fine; a map
  where every bush stands alone means the patching broke.
- **Read one in first person.** Press **V**, walk up to a bush. Ripeness is size and colour
  together — a bare one is small and dull, a ripe one is noticeably fatter and red. If you
  cannot tell a ripe bush from a bare one at ten paces, say so; that is the whole readout.
- **Erase your plot and see what they do.** Rub out the growing zone behind the cabin and
  leave the farm priority on. Within a few days somebody should walk out to a patch and come
  back with raw food — the job reads *foraging*. What must not happen is a settler hiking
  clear across the valley for it: if you see somebody leave for a berry and not come back
  for half a day, that is the range cap failing and it is worth reporting.
- **Then check they stop.** This is the other half of the same gate and the easier one to
  miss, because nothing looks broken while it is happening. Fill the pantry — leave the plot
  alone and let a harvest or two come in — and watch the work board. Nobody should be
  foraging on a full larder. A colony that is still picking berries with a fortnight of food
  in the barn is a colony that is not building, not mining and not burying its dead, and the
  symptom you will actually notice is the second-order one: walls that stop going up, a
  woodpile that stops being restocked, a body left lying in the yard. If the first day of a
  new colony is mostly berry-picking, report it.
- **Watch the squirrels.** Brambletails are the small rust-brown ones with the bushy upright
  tail. They live on the fruit — follow one for a minute and it should walk to a ripe bush,
  strip it, and wander off fed. They are worth almost nothing to hunt (three raw food, no
  hide) and that is deliberate; if you find yourself hunting them for food, the balance is
  wrong.
- **Come back to the same patch a day later.** If the squirrels found it, it should be bare
  and slowly reddening again. A patch that is always full means nothing is eating it; a
  patch that is never anything but bare means too much is.
- **Then interfere.** Shoot every fenwolf you see for a few days and keep watching the same
  stretch of moor. The squirrel population should climb and the berries should get harder to
  find. That is the chain working, and it is the one thing here you can actually cause.
- **Let a winter arrive.** Foraging should quietly stop being worth anything — the bushes
  hold whatever they had and do not ripen. A colony that can live off wild fruit in January
  never needs a plot, so if berries keep coming through the snow, report it.
- **Play a month and then look for squirrels again.** This is the slowest check on the list
  and the one that caught the worst bug in the chain. Brambletails boom in the first week,
  overeat, and starve back down — that part is the ecology working, and you should see it: a
  moor stripped bare around day ten, then reddening again with nothing on it. What must
  happen next is that they come back. Somewhere around a fortnight in you should start
  finding them on the fruit again, three to five of them rather than eleven. A valley that
  reaches day thirty with brambles ripe as far as you can see and *not one squirrel on any of
  them* is the failure, and it is easy to miss because it looks like a beautiful map.
- **Watch a squirrel walk a long way for no visible reason.** This is the fix for that bug and
  it is visible if you follow one. A fed brambletail with no mate near it will set off across
  open ground in a straight-ish line, past fruit it does not stop for, until it finds another
  squirrel. A hungry one never does this — food always wins. If you see one crossing the moor
  with its belly empty and bushes going past, report it.
- **Find a wolf that nobody sent.** There are two or three pairs living out on the moor from
  the first minute of a new world, well away from the yard. Walk the rim in first person and
  you should eventually find one, or find what it left: a fenwolf is the only thing out there
  that kills a mossback and leaves nothing behind. They do not come to the pens unless the
  hunting has been bad, and unlike the pack in section 9w they never leave, because they live
  here.

## 9cc. Watch someone fetch (~5 minutes)

Hauling is over half of all the walking a settler does, and it used to be done a handful at a
time. Two changes were made to that and both are meant to be visible without opening a menu.

- **Fell three trees close together.** Chop order on a small clump, then leave the colony to
  it. When a hauler arrives to clear the wood up, watch what they leave behind. They should
  stoop, gather what is lying within about two cells of them, and set off once. Three separate
  trips to three piles that were touching each other is the old behaviour and worth reporting.
- **Check they do not reach through walls.** Drop wood on both sides of a cabin wall — build a
  stockpile outside, chop something inside — and watch a hauler pick up on one side. Nothing on
  the far side of the wall should move. If a pile inside the cabin shrinks while a settler is
  stood outside it, that is the region check failing and it is a real bug.
- **Queue a long wall.** Ten segments in a line, then watch one settler supply it. They should
  come out of the woodpile carrying enough for several segments and walk *down the line*,
  dropping wood at each frame in turn, rather than going back to the pile between each one. The
  whole point is that a ten-segment wall is one trip and not ten.
- **Then interrupt them.** Rub out the frames ahead of a settler who is mid-run. They should
  put the surplus down where they stand and pick up something else — not stand holding it, and
  not walk it back to the pile. Anything still welded to their hands a minute later is a bug.
- **What you should feel.** On the same three days and the same seed, the colony now finishes
  most of half again as much building. If the base is not visibly going up faster than it used
  to, the levers are not connected.

## 9dd. Run the moor with nobody in it (~1 minute of typing, then go and have a coffee)

Not a browser check — a terminal one, and the only test in this file that can catch a bug
nobody could see from inside the game.

```
npm run eco
```

That generates a valley, takes the entire colony out of it, and runs the real tick for a
thousand simulated days with nothing in the world but animals and hedges, printing a census
every fifty days. It takes about twenty minutes.

**Expect** four columns that all stay alive and none of which run away. Mossbacks sit around
thirty, hares around twenty-four, wolves between two and five, and the squirrels swing wildly —
three, then twenty, then thirty, then back to three — with `ripe` swinging the opposite way
behind them as the hedges get stripped and grow back. That last part looks like instability and
is the opposite: it is the only column that is *supposed* to oscillate, because it is the one
eating a resource that regrows.

**Report** any of: a column that reaches zero and stays there for more than a couple of samples;
`fenwo` at zero at all after the first fifty days; `ripe` pinned near its maximum for hundreds of
days (nothing is eating); `ripe` pinned near zero for hundreds of days (the hedges never
recover); or any species whose late-run average is wildly off its early-run average, which is a
slow drift and the one thing a short run can never show you.

`npm test` runs a forty-five-day version of the same thing plus the other half of the ask — a
valley settled for twenty-five days on its own, then the colonists dropped into the middle of it
— so if that file is red, start here.

## 9ee. Ask why nobody is building your wall (~2 minutes)

The question every colony sim gets asked out loud. Make it happen on purpose.

Open the **Work** tab and switch **building** off for one settler. Now put a wall blueprint
somewhere obvious and click that settler.

**Expect:** under the control stack, an amber-ruled line — *"1 blueprint is up, but building
is switched off for them."* Turn building back on for them and the line changes to whatever is
actually stopping the colony now. If you have no wood, it counts it for you: *"the blueprints
are short 5 wood."*

Then try the other two. Ring a blueprint with finished walls so nothing can stand next to it —
*"they cannot reach any of the blueprints from where they are standing."* Switch every kind of
work off for somebody — *"every kind of work is switched off in their Work tab."*

**Expect** it to shut up when it should. A settler you have drafted, taken over by hand, put to
bed, or driven to a morale break gets no line: the card already says those. Nor does a settler
with real work in their hands.

**Report** any line that is not true — that is the only bug this feature can have. A wrong
number, a wall you can plainly walk to, a switch that is on. Note that a settler sitting by the
fire still gets the line, on purpose: an empty board sends people to a seat, so "playing darts"
is what having nothing to do usually *looks* like.

## 9ff. Choose the valley you land in (~4 minutes)

The setting the game never had. Open **?** in the top bar, scroll to the bottom of the card,
and press **New colony…**.

**Expect** three stacked choices — *Quiet valley*, *Settler*, *Hard country* — each with a
sentence saying what it does, and a **Seed** box that says it can be left blank. Pick
**Quiet valley** and press **Land here**.

**Expect:** a fresh colony, and a log line naming the valley's number — *"A new colony lands.
Valley 481203955."* Write that number down. Now let it run at 3× and watch the log.

**Expect** a noticeably longer quiet than you are used to: the first *"Smoke on the ridge line"*
should be four or five days out rather than two and a half, and when the raid lands it is still
the single club-armed straggler — the opening lesson is the same on all three settings, on
purpose. Keep going and the difference is in the gaps: two or three days of unbothered building
between beats instead of one.

Now prove the seed does what it says. **New colony…** again, type the number you wrote down
into the **Seed** box, and pick **Hard country** this time.

**Expect the same valley** — the same lake in the same place, the same ore, the same three
settlers with the same names — and a different war. First smoke inside two days, and by the
third or fourth beat visibly more of them, carrying rifles sooner.

**Report** if the map differs between the two runs of that seed. Difficulty is meant to change
what comes out of the treeline and *nothing else*: same map, same ore, same settlers, same
hunger, same cold, same wounds. A seed you can hand to somebody else is only worth having if
their valley is your valley.

Two more things worth checking. **Esc** should close the setup card without touching the colony
behind it — that button throws a run away, so backing out has to be the easiest thing in the
game. And when a run does end, the **Final tally** now names the valley and the seed it was, so
you can take the same ground on harder terms or hand it to somebody who thinks they can do
better.

## 9gg. Let two of them make a life (~5 minutes)

Section 9f made two settlers friends. This is what happens when a friendship goes all the way.

First the state a courtship spends most of its life in. Run `aether.court()` — it takes the two
closest-to-hand settlers, puts a 95 between them and starts their clock now. Unpause for a minute
of game time, then select either of them: the **bonds** row reads `courting`.

**Expect not:** an announcement. Crossing the line is not the pairing; a bond has to *hold* for
ten days. This is deliberate and it is the whole reason the mechanic is not a coin flip. The line
itself is the same 70 the panel calls `inseparable`, so the precondition is a word you can read
rather than a hidden number.

There are actually **two** lines, and the second one was bought with a measurement. Reaching 70
starts the clock; only falling below **62** stops it. The single-line version — any dip cancels
it — sounded stricter and was in fact broken: the top bonds in a real colony wander about ten
points over a month, so the clock was being reset by the ordinary weather of the very number it
was watching. Three ninety-day colonies at that setting produced one pairing between them, with
the other two ending the run on bonds of 71 and 73 and a clock that had never survived ten
consecutive days. The clock is now allowed to run through a bad week — but the announcement is
still only allowed to land in a good one, because pairing also requires the bond to be at or
above 70 on the day it happens. Ten days of closeness *and* close right now.

Now skip the wait. `aether.pair()` does the same thing with the ten days already served. Unpause
and give it about a minute of game time at 3×.

**Expect:** a headline over the world — *"X and Y have made a life together"* — once, with a
marker you can click through to. Select either of them and the **bonds** row that used to read
`inseparable` now reads `partner`. Open the mood breakdown (hover the mood bar) and there is a
new row, **their partner**, worth about as much as a pleasant room.

**Expect not:** a second announcement on the next pass, a third settler pairing off in the same
minute, or the row appearing on anybody who is merely a friend. One pair per pass, on purpose —
three couples announcing themselves at once reads as a system firing rather than something that
happened.

Now hurt one of them. `aether.burnBed(<the partner's name>)` and pull them out before they die:
the other one's mood row drops to a smaller number but stays *positive*. A partner bleeding in a
medbed is a partner who is alive, and worrying about somebody must never be worse than having
had nobody.

Then let them go. Burn the bed and leave it. **Expect:** the survivor's mood takes the hardest
single hit in the game — straight to the floor of what any event can do — and the log names them
*"X has lost Y, who they had made a life with"*. Their memories gain a line.

The part worth waiting for is the week after. Run at 3× for six game days and keep checking that
survivor's mood breakdown: the row now reads **grieving**, small and negative, and it is still
there long after everybody else has climbed out of the burial. Around day six it goes, and they
are themselves again. That gap is the whole feature — the spike is the same one a close friend
gets, because the mood clamp flattens anything that large; the difference between losing a
colleague and losing your person is that one of them lasts a week.

**Expect not:** a grieving settler pairing off with somebody else while that row is still showing.

## 9hh. Read the colony's own history (~2 minutes)

Press `;` — the key beside `L`, or the **Story** button in the top bar. This is not the log in
the corner. The log holds the last eighty lines and throws the rest away, which is right for
"what is the crew doing this minute" and wrong for "what happened to us".

**Expect:** a panel, newest at the top, grouped under day headers, running back to
*"Three settlers reach the Aetherhold clearing"* on day 1. Only the things that mattered are in
it — raids, deaths, the pairing from 9gg, a research project landing, a harvest — because only a
message raised as a headline gets copied here. Click any line with a place attached and the
colony camera goes there.

**Expect not:** the small talk. If *"Wren is hauling steel"* is in this panel, something has been
raised as a headline that should not have been. And it should not be empty on a colony that has
been running for a week: the founding alone guarantees one entry, and a week guarantees more.

Then save and load (section 10) and open it again — the history comes back with the colony. A
save written before this panel existed loads with an empty one and starts keeping the story from
that moment, which is a real loss of one save's past, chosen deliberately over a save-version bump
that would have cost every player their colony.

## 9ii. Walk the map open, one ring at a time (~10 minutes, mostly waiting)

This is 9k's other half and it is the one that takes patience. Press `J` and read the eight
locked headings before you do anything: each says, in a sentence, exactly what is standing
between the colony and that road. Early on every one of them will say the same thing —
*"Nobody on this road will vouch for you yet — Bitterfold stands at 0 of 18."*

**Expect:** three refusals, each with its own sentence, and each liftable on its own.

- **The vouch.** Trade with one near-ring neighbour until the road panel shows their standing
  at 18 — three ordinary visits, or one answered letter. The moment it lands, all
  four middle-ring headings stop talking about vouching. This is the interesting gate and it
  is the one that should bind first. Then note what the middle ring costs: two visits, not
  three, because a visit out there is worth 10 rather than 6. That is deliberate — three
  middle-ring round trips is more calendar than most runs have, and a road most colonies
  only hear about is not a road.
- **The pantry.** Now look at a middle-ring road: *"20 meals feed that road there and back.
  The pantry holds 11."* Two meals a day, both ways, at the distance shown in the heading —
  the arithmetic should check out against the days on the same line. Cook until it clears.
- **The hands.** The far ring wants four settlers left holding the valley, which a colony
  founded with three cannot do with somebody on the road. Take in migrants until the
  sentence goes away. The near ring never asks this and the middle ring asks for two, so
  headcount should be the *last* thing to bind, not the first.

Then send one. **Expect:** four settlers' worth of pack on the far road where the near road
took one — a nine-day trip that carried a single settler's load would never be worth
walking. The mishap odds are worse out there too, and they should be: a lost pack that size
hurts.

Two things to try to break it with:

- **Do nothing but obey the Steward.** Leave it on its own with a surplus and watch which
  way it walks. It should go to the same near neighbour three times, then switch to a
  middle-ring one for two more, then stop wandering and settle back into whatever is
  actually most profitable. If it walks to the same one-day town thirty times running, the
  bonus that pays for opening a road has stopped working and the far country is unreachable
  in practice however open it says it is.

  **Do this on a thin surplus, not a fat one** — one pack, not a full barn. This is the
  test that was passed for a year by a colony that could not actually do it: the outer
  rings carry bigger packs, so a colony sitting on four packs' worth walks outward for
  reasons that have nothing to do with the gate, and a colony sitting on one — which is
  the normal state — was walking nowhere at all. If it goes out with the barn full and
  stays home with a crate spare, that is the same bug wearing a disguise.

  **Count arrivals, not departures.** A party robbed on the way turns back without ever
  reaching the household, so it earns no standing: two middle-ring trips open the road
  only if both of them get there, and about one in five does not. Three or four trips
  before the vouch lands is the road being a road. Ten of them is a bug.
- **Open the far ring, then eat the pantry down.** The road should shut again with the meals
  sentence, not the vouch sentence — standing is permanent, provisioning is not, and the
  panel should be clear about which one you have lost.

## 9jj. Read the roads on the morning you are founded (~3 minutes, after a founding)

You need a founded colony for this one, so do it at the end of a long run or load a save
that has one. The moment the founding card goes away, look at the goals panel.

**Expect:** the **The founding** section is gone — you passed that exam — and **The roads**
is in its place, three rows in the shape the charters had. Science, Economy, Warfare, each
with the rung you are standing on next to its name, a count in the corner, a bar, and one
line saying where the work is. Hover a row and it tells you what that road ends in.

Then check the three things that would make it a scoreboard rather than a road:

- **They should not agree.** On a normal founding you will read something like *Science —
  Schooled*, *Economy — Friend*, and Warfare blank. If all three rows show the same rung
  every time you look, on every colony, then they are one number printed three times and the
  choice of ending is a choice between synonyms. (The grid checks exactly this across
  fifteen colonies, but you can smell it in one.)
- **Warfare should be blank if you were never attacked.** A quiet valley that won on food
  and research has not walked the road that ends in taking the ground. If founding alone
  hands you a rung there, warfare is wired to something the first act gives away.
- **The bar should measure the leg, not the trip.** Standing on a rung reads as an empty
  bar, not a nearly-empty one — the count next to it tells you the boundary you are walking
  toward, and it is the *next* one, not the last.

Now play on and finish a project. **Expect:** the science count moves the same tick the
research panel does, with no lag and nothing to collect. Then save, reload the tab, and look
again: identical rungs. Nothing about the roads is written into the save — they are read off
the colony every frame — so a rung that survives a reload is doing so by being recomputed
correctly rather than by being remembered.

## 9kk. Send a war party (~15 minutes, after a founding, on a colony of seven or more)

Open the **Roads** tab. Under **The neighbours** is the trade road you already know; under
**The war road** are the three holdings, one behind each ring.

**Expect:** three rows, each naming the place, how many Ashbound are standing in it, and
what it would pay if you took it — 40 steel every six days at the doorway, up to 120 every
twenty at the far one. A row you cannot march on says why in a sentence rather than being
greyed out with no explanation: *seven on their feet before anyone marches* if you are short
of hands, *there are raiders in the yard* if a raid is live, *nobody has been out that far*
if you have not opened the ring. A row you can march on names the three who would go.

Click the near holding. **Expect:** a headline in the log — three settlers by name take up
arms and start for the place — and then those three drop whatever they were doing and walk
for the treeline. This is the bit worth watching: for the next few in-game hours the colony
is visibly short-handed with three people crossing the yard on an errand nobody can
interrupt.

Then they are gone. **Expect:** the colony count drops by three, the war row shows a phase
and a countdown, and nothing on the map can reach them — you cannot select, possess, feed or
draft anybody in the party. Run the clock. Six days later the fight resolves as a headline —
taken, or thrown back off the walls — and a few days after that the party walks back in.

Three things to check, in the order they would hurt:

- **Everybody comes home.** Count your settlers before and after. Win or lose, three went
  and three came back; nobody is buried out there. Losers arrive on a quarter health,
  starving and exhausted, and go straight to bed — that is the cost, not a funeral.
- **Nobody is on the map twice.** The party is genuinely lifted out of the world while it is
  away, so the failure to look for is a duplicate: the same name in the settler list twice
  after the homecoming, or a settler who comes back a stranger with no skills.
- **A taken holding pays without being asked.** Wait out one cadence after a win. A cart
  comes down off the moor with steel on it and lands beside the colony — no caravan, nobody
  sent, no job. Then check the Roads tab: warfare has moved up a rung.

Now try it during a raid. **Expect:** if a raid starts while the party is still crossing the
yard, the march is called off and every one of them is back on the map and available to
fight. A war party half-lifted off the map is the one state nothing else in the game knows
how to read, so if you ever see the countdown running with fewer than three people committed,
that is the bug worth reporting.

Finally, save mid-march — with the party out on the moor — and reload the tab. **Expect:**
the party is still out, still due home at the same moment, and still not on the map.

## 9ll. Commit to an ending (~20 minutes at speed, after a road tops out)

This one has a prerequisite you cannot rush: a road standing on its **top rung**. Warfare is
the one you are most likely to get there first — take all three holdings and keep them — so
if you are hunting for this, that is the road to walk. Until then the Roads tab looks exactly
as it did in 9jj and 9kk, and that is correct: **nothing about the far end appears before you
have earned the right to be offered it.** A panel that shows you a locked ending on day one
has told you the shape of the whole game before you have played any of it.

The moment a road tops out, look at the Roads tab. **Expect:** a new section at the very top,
**The far end**, sitting above **The road** where the commission has always been — a promotion
the commission has earned its way out of, because it was the one thing on that panel with a
clock on it right up until this appeared. One card for each ending you can now
commit to, each with its name, a line of what it is, and its bill. The hull and the fare are
both counted in **worth** and that is not a slip — they are the same ship priced two ways,
one built and one bought, off the one table every caravan quote in the game already uses. The
moor is counted in holdings, because ground is not for sale. What separates the first two is
the direction: *in the hull* is what you put in, *traded away* is what went out on the road
over the whole run. If the hull's number moves when a caravan comes home, that is the bug.

Click one. **Expect:** the offers are replaced by a single card of **the same shape** in the
same place, now reading a countdown — twelve days — and the bill as it stands. The choice
should not redraw into a different-looking thing the moment you make it. Under it, a quiet
**give it up** link, with no confirmation box in front of it.

Then run the clock and watch four things, in the order they would hurt:

- **The bill is paid by the day, not by the second.** On the ship, steel leaves the store in
  one instalment a day — a step you can see on the resource line, not a drain. If the store
  is emptying continuously, the terminal is being worked on the tick instead of on the day,
  and a twelve-day hull will cost you fifty times what it says.
- **Falling out costs the days and never the goods.** Break one of the five things the
  founding asked for — eating the pantry below twelve days of food is the easy one — and the
  card should turn and say so, in the founding's own words, not in a new vocabulary invented
  for this panel. What is already in the hull stays in the hull. Fix the food and the count
  starts again **from twelve**, not from where it stopped. That is the price of a bad
  fortnight and it is meant to sting.
- **The gate is still a gate.** On the dominion, lose a holding while the clock runs. The
  card should stall the same way — the road is no longer standing on its top rung, and an
  ending you were let out of the door with is not an ending you get to keep by having once
  qualified for it.
- **Giving up is walkable-back.** Press **give it up**. The card should return to the offer
  it came from, the days gone, the goods gone with them — and you should be able to commit
  again on the very next tick. That is why there is no confirmation box: nothing here is
  destroyed that a confirmation would have saved.

Finally, save mid-commitment and reload the tab. **Expect:** the same ending, the same days
left, and the same amount already paid. And one thing to check that is easy to miss: load a
save made **before** any of this existed. It should open with no ending in progress and the
Roads tab as it was — not with an error, and not with an ending you never chose.

## 9mm. Land it, and keep playing (~3 minutes, once a countdown runs out)

The step 9ll leads to, and the one that is easiest to get wrong by being tidy. Run a
committed terminal to the end of its twelve days with its bill paid.

**Expect,** on the tick it lands: a headline in the log naming the ending, and the ending card
over the map — the terminal's own name and its line, then **N settlers saw it through**, then
the final tally you already know from the founding card. Two things about that card are the
whole point of this step. It is **not** the *Aetherhold has fallen* card wearing a new title;
and its buttons are the ones a colony that is still standing gets, because the charters are met
or the ship is away, and neither of those is a wipe.

Now dismiss it and **keep going**. The game does not stop. That is deliberate and it is worth
sitting with for a minute: the ship leaving does not delete the valley, and whoever stayed is
still down there with winter coming. Run another week at speed and check the one thing that
would be quietly wrong if the card were re-read instead of remembered — **the numbers on that
card are the numbers from the day it landed.** Reopen it if the UI lets you. Days survived
should still read the landing day, not today; the settler count should still be who was
standing then, not who is standing now. Kill nobody and build nothing and you will see
nothing; that is why the check is *after a week of playing*.

Then the case that is easy to forget exists: **land an ending and then lose the colony.** Sail
the ship and let the ones who stayed starve. **Expect** the ordinary wipe — the game does end,
`gameOver` still means nobody is left — and the run's own record still says the ship sailed on
the day it sailed. An ending and a wipe are two different facts about the same colony and it
should be able to hold both.

## 9nn. Take a card in a body (~2 minutes)

The same landing as 9mm, from the other camera. Press **V** before the countdown runs out and
be standing in somebody — walking, ideally, with a hand on W — when the ending lands.

**Expect:** the card arrives over the first-person view the same way it arrives over the map,
and three things happen with it that did not before. The **mouse comes back** — the pointer
lock lets go on the frame the card opens, so there is a cursor to press *Keep playing* with.
The **settler stops**: the keyboard and the mouse both belong to the card while it is up, so
holding W walks nobody into a wall behind it and the mouse does not turn a head you cannot
see. And **Escape closes it**, exactly as it closes the key list. Dismiss it and the *Click to
look with the mouse* hint is waiting: one click on the world and you are back in, facing where
you were, still holding W.

The colony behind the card does not stop — that is 9mm's point and it survives this one. Let a
minute run at the card and the clock in the corner will have moved when you dismiss it.

Worth doing once for each of the other three cards too, since they follow the same rule: open
the key list with **/** in a body, open the colony-code box, open the new-colony card. Each
should hand back the mouse, freeze the settler, and give you Escape. The one exception is on
purpose — the *Aetherhold has fallen* card refuses Escape, because there is no colony behind it
to go back to and the only move left is the one it offers.

**Before this shipped:** the card opened, the mouse stayed locked away, there was no cursor to
click any button with, W kept walking, and the only way out was a browser Escape that gave back
a pointer and left the card exactly where it was. Pinned by `tests/overlays.test.ts` and the
wiring rule in `tests/architecture.test.ts`.

## 9oo. Read the roll (~4 minutes, on the card from 9mm)

Same card, further down it. Under **Final tally** the ending card now names everybody, and the
point of this step is that the names are the ones from the day it landed and not the ones alive
today.

**Expect** two headings, and only ever two. **Who left** — or **Who held it**, if the ending was
the moor, because that is the one you win by staying. Then **Who stayed in the valley**, which
is the dead: buried and unburied both, because the manifest's question is who came and a
headstone is not the difference. Each row is a name, then their three best trades as whole
levels, then one soft line with their traits, what they were carrying and wearing, who they were
paired with, and a word about their wounds if they took any worth mentioning. A settler who
arrived last week gets their name and nothing after it — that is right, not a gap.

Then the two checks that actually cost something:

**Somebody's partner is dead.** Get a pair — 9gg is how — and lose one of them before the ending
lands. **Expect** the survivor's row to still read *with <name>*. The inspector will tell you
that settler has nobody, and both are true: the inspector answers *do they have somebody now*
and the manifest answers *who did they come here with*. Somebody walking onto a ship alone who
did not board it alone is the one line on this card worth reading twice.

**Play a fortnight past the landing and reopen the card.** Get somebody shot, let somebody make
two levels, hand somebody a rifle. **Expect** none of it on the roll. This is 9mm's freeze one
level down and it is the failure the whole record exists to stop: a card about the day the ship
sailed printing the wounds of a settler who was shot two weeks later. Save and load in between
and it should still be the same list — a sequel reads this out of a save file or not at all.

One gap, named because it is deliberate rather than missed: somebody who died early and was
never buried is not on the roll. Their body left the valley at `ROT_TICKS` and the record reads
what the colony kept. Bury your dead and the manifest remembers them.

Pinned by `tests/endings.test.ts` (the roll) and `tests/manifest.test.ts` (what the card does
with it).

## 9pp. Watch the walk (~4 minutes)

Every claim in this step was arrived at by arithmetic and none of it has been looked at, which
is the whole reason it is a step.

**From the manager camera.** Zoom in on a settler crossing open ground and watch their feet
rather than their body. **Expect** the foot that is down to *stay* down — planted, while the
settler travels over it. The thing it replaces is unmistakable once you know to look for it: the
legs scissored better than twice as fast as the ground went by, so the contact foot slid
backwards about the length of the step it had just taken. If it still reads as skating, the
arithmetic is right and the geometry it assumes is not — check `SETTLER_LEG` in
`src/client/gait.ts` against where the rig actually hangs its legs.

**The other way this fails is the more likely one.** A planted foot is bought with leg speed,
and the cadence halved to pay for it. **Expect** a walk, not a moon-bounce. Three and a half
steps a second under a body covering three cells of ground is right on paper, and paper is not
this step. If it reads as slow motion, the swing amplitude wants to come *down* and the cadence
will follow it back up on its own — that is the one direction the module is built to make easy,
and it is a one-line change.

**Now take a body** (`V`) and walk. **Expect** the view to bob with your steps, stop bobbing the
instant you stop, and quicken when you hold Shift: it rides the stride, not a clock. Then **hold
W into a wall** and press `V` while still holding it. **Expect** the bob to stop, and expect to
find the settler you just left standing still with their legs down. That pairing is the point —
the body used to sprint on the spot for the manager camera while first person felt like walking
into stone, which is the one disagreement between the two views the player was guaranteed to
find.

**Then watch the animals, which is the part of this step to spend the time on.** A goat on its way
to a bush, a wolf on its way to the goat, a pet following its person: every one of them was being
handed 16.5 of stride per cell of ground while its legs were built for 7.5, so what you have
watched them do until now was a scissor at better than twice the ground. Their legs have just
slowed to under half of that. **Expect** a trot you could count, not a blur. This is the largest
single change to how the game moves and the one most likely to now be wrong in the other
direction — if a wolf mid-chase reads as gliding rather than running, the animal swing wants to
come up.

**And watch a calf beside its dam.** **Expect** the calf to take visibly more steps over the same
ground. Short legs, more steps; it falls out of the same rule rather than being animated
separately, and if the two of them look like they are running the same animation at the same rate
then the rule is not reaching the herd.

One thing deliberately left as it was: a Picky's legs. They end below the floor, so there is no
contact point to plant, and its body shrinks to nothing as it poofs out — a stride derived from
legs that short would spin them out while it vanished. It is wrong by about a fifth of what a
settler was wrong by, in the other direction, and it stays that way on purpose.

Pinned by `tests/gait.test.ts` (the arithmetic, and that only one place in the sim converts
distance into stride), `tests/sim-units.test.ts` (that a jammed body stops striding and a rescued
one is charged nothing), and `tests/fps-view.test.ts` (the body you drive). None of them can see.

## 9qq. Click on the dirt (~3 minutes)

This step exists because a player said the same thing twice — "I still can't select every square",
then "even items in the house are not selectable, or planted areas and such" — and both times the
answer was that the manager resolved a click to a settler or a building and to nothing else.

Click, in this order: **a rock face**, **a stack of wood on the floor of the house**, **a cell in
a growing zone**, and **a patch of open grass nobody has touched**. **Expect** a panel every time.
Not the same panel — expect the rock to name the terrain and, if somebody has marked it, the order
standing on it; expect the woodpile to name the kind and the count; expect the furrow to say
whether anything is sown and how far on it is; and expect the grass to say what it is and that it
is walkable. The old behaviour is unmistakable: the panel simply went away and stayed away.

**Then click a settler, and then the building they are standing in.** **Expect** those to still
win. Ground is the fallback, not the answer — a fix that let the grass shadow the two panels that
already worked would cost more than the bug it fixed.

**Then press and drag** on open ground and let go. **Expect** the map to move and **expect the
panel not to change**. Selection resolves on release with a few pixels of slop, so a pan is not
also an opinion about whatever square your hand started on.

What a square reports is pinned by `tests/select.test.ts`, including the stack somebody is
carrying being left out of the count — a hauler crossing the yard is not a yard with steel in it.
Whether the panel is *readable* is this step.

## 9rr. Ask who is building your wall (~3 minutes)

Lay down a dozen blueprints — a stretch of wall, a couple of beds, a bench — and then open the
build queue rather than watching the yard.

**Expect** the plans in the order the colony will actually take them, and **expect a name against
the ones somebody has picked up**. The thing this replaces is a player putting plans on the map
and watching them sit there with no way to tell the difference between *not yet* and *never*.

**Now pause and read it again.** **Expect** the same list. Then unpause, let one finish, and
**expect it to leave the queue** rather than lingering as a done row.

The queue's contents are pinned by `tests/board.test.ts`. Whether the order it shows matches the
order you *watch* happen in the yard is the part that needs eyes, and it is the part most likely
to be subtly wrong: the board re-sorts as jobs are claimed.

## 9ss. Put a fence in front of a raid (~6 minutes)

Ring a stretch of your yard in plain wooden fence — three wood a panel — and wait for a raid, or
bring one on from the debug bar if it is there.

**Expect them to break it.** A raider that cannot reach anybody now takes apart the piece of
geometry standing in the straight line to its target. Until this shipped, a fence was a mountain:
they routed round it, and if there was no round they stood in the field facing the rail until
their nerve went. Three wood bought a wall the colony never paid for, and a settler fenced in was
a settler no raid could reach.

**Then watch a raider walk *past* a fence that is not in its way** — the goat pen, if it is off to
one side. **Expect it to leave that one alone.** A raid that breaks every fence it passes is
vandalism, and it would turn every pen into a liability.

**And expect the hole to be a real hole**: once a panel is down, expect the raid to come through
the gap rather than resume standing in the field. A breach nobody walks through is scenery.

Pinned by `tests/breach.test.ts`. What no test can tell you is whether it *reads* as a raid
choosing a way in, or as an animal chewing furniture.

## 9tt. Build a wall across somebody's errand (~4 minutes)

Short, mean, and worth doing once. Find a settler walking a long way with something to do at the
end of it — hauling to a stockpile is easiest to spot — and drop a one-cell wall blueprint right
on the path in front of them, on open ground with plenty of room either side. Let somebody build
it while the first settler is still walking.

**Expect them to step round it and carry on.** What this replaces is the settler stopping, giving
up the errand entirely and wandering off to something else, which is what happened for as long as
this game has existed: a route cut by new geometry was reported to the work board as *blocked*,
and every job in the colony reads blocked as cancelled.

**The version of this that matters is the meal.** Get somebody down and starving with a full
larder — 9cc sets that up — and then build across the rescuer's route. **Expect the meal to
arrive.** On sixty harsh days of seed 99001, 145 emergency feedings used to end with the carrier
alive, upright, the meal still in the world and the patient still on the floor, against 32 that
reached a mouth. The colony was never short of food or of hands. It kept putting the plate down.

**Then check the other half of it**, which is the one this could plausibly break: wedge a settler
somewhere they genuinely cannot get out of and **expect them to give up** rather than re-path
forever. Twenty-five ticks of going nowhere still ends the errand, and it has to, or a stuck body
loops.

Pinned by `tests/repath.test.ts`.

## 9uu. Ask a body what it has on (~4 minutes)

Two things to look at, and the first one is free: open any settler and read the two gear rows.
**Expect each to say what it is doing** — *fur parka, 5% armour, +0.85 warmth* — rather than
just naming the thing. Put somebody in plate if the colony has any and check the row that costs
them something: plate is forty per cent armour bought at ninety-two per cent work and *minus*
warmth, and the card is only worth having if it says the second half as loudly as the first.

Then the part that needs a raid. Wait for one, or start one from the console, and let somebody
die — either side; a raider works. **Click the body.**

**Expect a short card**: their name, *dead*, what is still on them and what it is worth, where
they are lying, how long before there is nothing left, and their story. **Expect it not to be
the settler card** — no mood, no rest, no recreation bar, no errand line, and no Draft, Take
over or Possess. Before this, a corpse was the one thing on the map you could point at and get
silence from: the click resolved to the living only.

**Then click a body somebody is standing over.** A doctor kneeling on the same square as a
corpse must still get the click; the body is the thing you can no longer give an order to, so
it loses the tie.

The judgement is whether *rots away in 4 days* reads as a clock worth acting on — whether it
sends a player out to fetch the parka — or as trivia on a card about somebody they just lost.
Stripping the body is not built yet, so today the clock is information without a lever, and
whether that reads as a promise or as a tease is the thing to write down.

Pinned by `tests/corpse-card.test.ts` and `tests/kit-card.test.ts`. The two cards can be looked
at without a raid: `npm run dev`, then `npm run look:review`.

## 9vv. Draft somebody and ask what they are missing (~3 minutes)

Let a colony run until the settlers have been awake a while and the recreation bars are
off full — an hour of game time is plenty. Pick one who is visibly working, hauling or
building, and open their card. **Expect the recreation row under *why that mood* to read
`tired of working`** — they are holding a job and the table is the thing they never get
to.

Now press **T** and draft them. The job is cancelled the instant you do it, and for as
long as the draft holds the colony never offers them another one.

**Expect the row to keep reading `tired of working`.** It is the same sentence, and that
is the whole of the step: a drafted settler is not a settler with nothing to do, and the
card must not tell you they are. **Expect the mood number itself not to move** when you
press T — the penalty is the same either way, and only the words change.

Open the alerts panel while they are still drafted and find their morale line if one is
up. **Expect the hint to be about the hours, not the furniture** — *Nothing but work.
Build somewhere to sit, and leave them the hours to use it* — rather than the one that
tells you to build a table, which is advice for a settler who looked for a seat and could
not reach one. That settler is standing on the line with a rifle.

Undraft them, leave them alone, and let the colony hand them work again. The row is
unchanged through all of it; what you are checking is that it never once said `nothing
fun to do` while you had hold of them.

Pinned by `tests/mood-label.test.ts`, which drives both trips — the ordinary gap between
two jobs and the drafted day — tick by tick on seed `20260801`.

## 10. Save it, break it, load it

Press **Save** in the top bar. Now do something destructive and obvious — pause, mash a few
blueprints down, run the clock forward, possess someone else. Press **Load**.

**Expect:** the map, the buildings, the settlers with their needs and jobs, the clock, and
the view mode all come back to the saved moment. Save from inside a body and Load puts you
back inside that body. Reload the browser tab first if you want to prove it survives a page
load — the save lives in localStorage.

---

## Known edges

- Settlers will sleep on the ground if there is no free bed. That's intended; build beds.
- A sick settler in a bed will stay there past the point of being rested. Also intended —
  bed rest is how they win. They get up for raids and for an empty stomach.
- Recreation drops for every settler who is awake, at work or not — the card row reads
  `tired of working` for one holding a job and `nothing fun to do` for one who looked for
  a seat and found none. A drafted settler, or one you have taken manual hold of, reads
  `tired of working` too: the colony is not withholding a seat from them, it is not
  offering them anything at all, and step 9vv is that case. They only break off for a seat when the work board is empty or
  when they are properly bored, so build seats: one each plus a spare.
- Fires spread. Firefight priority matters more than it looks like it should.
- Quality preset (top bar) drops shadows and effects on slower machines. Try `low` if the
  frame rate is bad before assuming the sim is slow — the sim runs at a fixed 20 Hz either way.
