# Methodology

How this game gets changed. Not what it is or how it is built — those are
[README.md](README.md) and [ARCHITECTURE.md](ARCHITECTURE.md) — but the loop a
round actually runs, and which instrument answers which question.

*The other six documents:* [README.md](README.md) is what the game is and how each
system works, [ARCHITECTURE.md](ARCHITECTURE.md) is how the code is laid out and why,
[PLAYTEST.md](PLAYTEST.md) is the hands-on browser script, [ACCEPTANCE.md](ACCEPTANCE.md)
is what has been checked and by whom, [ENDGAME.md](ENDGAME.md) is the plan for after the
founding, and [ROUND_NOTES.md](ROUND_NOTES.md) is the log of rounds this file describes
the shape of. [LOOK.md](LOOK.md) is how the rendered game is looked at, round by round,
and the harness that photographs it.

## Contents

- [One round, one measured gap, one fix](#one-round-one-measured-gap-one-fix)
- [The ladder of instruments](#the-ladder-of-instruments)
- [The commands](#the-commands)
- [The fingerprint contract](#the-fingerprint-contract)
- [Probes](#probes)
- [Looking at it](#looking-at-it)
- [What the headless harness cannot see](#what-the-headless-harness-cannot-see)
- [Ports](#ports)
- [How a round is written down](#how-a-round-is-written-down)

## One round, one measured gap, one fix

The unit of work is a **round**, and [ROUND_NOTES.md](ROUND_NOTES.md) is the log of
them, newest first. A round is not "a feature" and not "a sprint". It is one gap that
an instrument measured, and the change that closes it.

The discipline that makes the log worth keeping is that the gap is **measured before
the fix is chosen**. The failure mode this exists to prevent is on the record: a round
shipped two sim changes under one sixty-day grid, the grid came back worse across
fifteen unmanaged runs — survivors 141 → 110, buried 28 → 40 — and naming a culprit
from that aggregate was a guess. It had already been guessed once, generalising "the
sim got better" from a single seed while the aggregate said otherwise.

So: **one measured change per grid, or an instrument that can tell two changes apart.**
Where a round genuinely carries two, they are labelled **Track A** and **Track B** in
the notes and each one is attributed separately, or the round says plainly that it
cannot attribute them.

## The ladder of instruments

Five tiers. Each one exists because the tier below it structurally cannot see the
failure — that is the only justification for adding one, and it is worth stating out
loud when a new instrument is written.

| Tier | Instrument | Answers | Cost |
|---|---|---|---|
| 1 | `npm test` — the vitest suite | Does this unit do what it is supposed to? | ~15 min |
| 2 | `npm run eval` — one colony, real world | Does a colony boot, tick, and survive? | minutes |
| 3 | `npm run measure -- --days 60 --past-founding` + `npm run balance` — the sixty-day grid | Is the *game* good, across seeds and difficulties? | ~90 min |
| 4 | `scripts/probe-*.ts` — one colony, one tick at a time | *Why* did the grid say that? | ~2 min |
| 5 | The browser — [PLAYTEST.md](PLAYTEST.md) | Does it feel like anything? | a human |

The two that get skipped and should not be:

**Tier 4 is the one that pays.** The grid reports only endings, so it can say a
principle broke and never say which change did it. A probe plays one seed under one
tree for sixty days in about two minutes, against an hour and a half for a grid that
would still only report the ending. When the grid goes red, the next thing to run is
almost never another grid.

**Tier 5 catches what no assertion is looking at.** The standing example is a social
change that made a pairing threshold unreachable: the rule stayed correct, twenty-nine
tests stayed green, and the feature quietly stopped happening — because every one of
those tests set the bond it asserted. `npm run live` was added for exactly that class,
and it runs a real colony to day ninety and names anything the game promises but never
does.

## The commands

```bash
npm run dev        # http://localhost:5063 — HMR, for whoever is editing
npm run play       # http://localhost:5062, and the same on your LAN IP — built, no HMR
npm run build      # tsc --noEmit && vite build
npm run typecheck  # tsc --noEmit alone

npm test           # the whole vitest suite
npm run eval       # tests/colony-eval.test.ts — one colony, played
npm run live       # LIVE=1 — a real colony to day ninety, naming unkept promises
npm run eco        # ECO=1 — the moor with nobody in it, census each night
npm run sweep      # SWEEP=1 — the survival sweep
npm run pool       # POOL=1 — the eval pool

npm run measure -- --days 60 --past-founding   # the pinned grid → .eval/measurements.json
npm run balance    # BALANCE=1 — judges that file against the principles
```

**Those two flags are not optional.** `measure`'s own defaults are thirty days, stopping
at founding; the grid pinned in `measurements.json` is sixty days played past founding.
A bare `npm run measure` therefore finishes, writes a perfectly valid file, and moves
every number in the repo — not because the sim changed but because a different sweep was
played. It is not a failure you can see in the output: the run succeeds, the fingerprint
check goes green, and only a diff against the committed grid shows `days: 60 -> 30` at
the top of seven hundred changed leaves. Always pass both, and diff `sweep.days` and
`sweep.playPastFounding` before trusting a re-measure. `--serial` plays the same specs on
one thread when a worker pool would confuse a measurement, and `--steward` is opt-in,
which matters more than it looks — see below.

**The default arm is unmanaged.** `runColony` opens `opts.steward ?? true`, but
`measurements.json` records `steward: false` for every cell, because `npm run measure`
does not pass it. Every starvation principle is drawn from the *unmanaged* runs. A probe
that wants to reproduce a grid finding must say `steward: false` out loud, and the
shipped probes do.

## The fingerprint contract

The grid is split into a slow **measure** step and a fast **judge** step, which is what
makes sixty days affordable: the colonies get played once on every core, and then every
principle is scored against the same JSON in milliseconds.

That split has exactly one new way to be wrong, and it is a bad one — **judging
yesterday's numbers against today's sim and printing green.** So `measurements.json`
carries a 32-bit FNV-1a fingerprint of every source file that decides what a colony
does, and `npm run balance` recomputes it and refuses to score a mismatch. A stale grid
is not a failing grid and must not read as one: it is a run that did not happen.

Three consequences worth knowing before you touch anything:

- **Everything under `src/sim` and `src/eval` is fingerprinted by default.** The
  `NOT_THE_SIM` list is what to *skip*, not what to include, so a new system added to
  the sim invalidates old measurements without anyone remembering to update a list.
- **`principles.ts` is deliberately not fingerprinted.** It is the judge. Fingerprinting
  it would undo the reason the grid was split — moving one bar would cost a fresh
  thirty-six minutes before you could see whether the move was right.
- **Touching one sim constant costs a grid re-run.** That is the real price of a
  one-line change here, and rounds are planned around it. The fingerprint moving is
  recorded in the round notes as `old → new`.

To judge a grid that is *not* the file on disk — the previous one, so a regression can
be attributed instead of guessed at — use `scripts/NOT_THE_SIM_judgefile.ts`. It reads a
file by path and never looks at the fingerprint, which is exactly why it lives outside
`src/eval`.

## Probes

A probe is a throwaway instrument that answers one question the grid cannot. They live
in `scripts/`, they are kept after the round that needed them, and their file header is
the real documentation — it says which finding provoked it and what the output means.

Two conventions, both load-bearing:

**They live outside `src/sim` and `src/eval`, so they do not move the fingerprint.** A
probe written to explain a grid must not invalidate the grid it is explaining.

**They are built and run, not interpreted** — there is no `tsx` dependency:

```bash
npx rolldown scripts/probe-bench.ts --format esm --platform node -d .eval/build
node .eval/build/probe-bench.js <label> [difficulty/seed ...]
```

A/B probes build the tree twice with one constant changed and run both — the worktree a
probe is built in *is* the variant, so the probe itself takes no flags for it. Those
throwaway bundles go to `.eval/build-nohunt/`, `.eval/build-fix0/` and friends, which
`.gitignore` covers: they are a question being asked, not an artefact worth keeping.

The two rules a probe has to obey to be worth trusting, both learned the hard way:

- **Sample every tick, not once a day.** A once-a-day sample reads reserved items as
  absent and sends you after the wrong bug. Aetherhold's day boundary is 07:12, so every
  daily snapshot lands on the same hour — awake, unfed, not yet departed — and that hour
  is not representative of anything.
- **Vary what reality varies.** A probe that pins an input is blind to bugs living in
  it, and it comes back clean and confident.

## Looking at it

The app exposes itself on `window.aetherhold` — the live `App`. Nothing in the game
reads it; `src/main.ts` sets it for exactly this. That handle is the whole browser
methodology, and it is far faster than clicking.

The second handle is `window.aether` — `src/client/devtools.ts` — which is the one a
script drives: `look(x, y)` moves the manager camera, `build(kind, x, y)` stands a
building without a builder, and the scenario triggers (`fire`, `raid`, `herd`, `pack`,
`refugee`, `ill`…) put the colony into a state a screenshot needs. The harness in
[LOOK.md](LOOK.md) uses nothing else.

Everything on it is reachable, including the parts declared `private`: TypeScript's
`private` is a compile-time check and not a runtime one, so `world`, `viewport`, `hud`,
`canvas`, `mode`, `speed`, `frameCount` and `fpsShown` all answer from the console. This
is the one place in the project where reaching past an access modifier is the intended
use — it is a debugging handle, and the alternative is widening the real API for the
console's benefit.

Read the state of a running colony:

```js
const a = window.aetherhold, w = a.world;
({ tick: w.tick, day: Math.floor(w.tick / 4800) + 1, speed: a.speed, mode: a.mode,
   alive: w.pawns.filter(p => p.faction === 'colony' && !p.dead).length,
   buildings: w.buildings.length })
```

Ask the sim a question about the world it is actually in — the dev server serves the
real modules, so a rule can be interrogated directly rather than reasoned about:

```js
const orders = await import('/src/sim/orders.ts');
const needs  = await import('/src/sim/needs.ts');
({ canPlace: orders.canPlace(window.aetherhold.world, 'sandbag', 47, 51), hungry: needs.HUNGRY })
```

Measure a frame budget by patching the renderer, rather than trusting the FPS readout:

```js
const r = window.aetherhold.viewport.renderer;
window.__probe = { n: 0, sum: 0, worst: 0, last: 0 };
const orig = r.render.bind(r);
r.render = (s, c) => { const t = performance.now(); const p = window.__probe;
  if (p.last) { const d = t - p.last; if (d < 200) { p.n++; p.sum += d; p.worst = Math.max(p.worst, d); } }
  p.last = t; orig(s, c); };
```

And the HUD can be driven directly — `hud.update(app)` re-renders it, and a panel's
`innerHTML` can be replaced with a made-up row to check a layout without playing the
colony into the state that would produce it. Put it back afterwards.

## What the headless harness cannot see

**The rendered game cannot be validated headlessly on this box.** The gstack/browse
harness runs Chrome on SwiftShader, which fails to bind a WebGL2 context — the game
correctly shows its "This build needs WebGL2" panel and never constructs `App`, so
`window.aetherhold` is undefined and every recipe above is unavailable.

This is a property of the harness, not a bug in the game, and the distinction matters
because the failure looks identical to a broken build. Confirm which one you have by
reading the console: `THREE.WebGLRenderer: Error creating WebGL context` is the harness;
anything else is yours.

So the split is:

- **The simulation** validates headlessly and completely — tiers 1 to 4 never open a
  browser, and they are where the real assurance comes from.
- **The rendered view, input, and feel** need a real browser with a real GPU. That is
  [PLAYTEST.md](PLAYTEST.md), and it is a human on `:5062`.

A round that changed only sim code can ship on the headless tiers. A round that touched
`src/client` has not been checked until somebody looked at it.

**Corrected 2026-09-06.** The paragraph above was true of gstack/browse, and it stays
true of any harness that lands on SwiftShader. It is no longer true of the box:
`puppeteer-core` driving Chrome for Testing with `--ignore-gpu-blocklist
--use-angle=metal` renders the game on the Apple GPU at 16 ms a frame, the sim ticks,
and the same frames can be photographed round after round. That harness, and the loop
built on it, is [LOOK.md](LOOK.md). The split survives in a weaker form: a headless
frame can be *looked at*, by a person or a model, but it still cannot say what the game
feels like in the hand, and the scars listed there are the ways it lies.

## Ports

This project owns **5062** and **5063**, fixed in `vite.config.ts` with `strictPort`,
both bound to `0.0.0.0` with `allowedHosts: ['.local']`.

- **5063 is dev** — HMR, for whoever is editing.
- **5062 is play** — the built bundle. Use this for another device on the wifi, so an
  edit on the dev box cannot reload somebody's game mid-run. It stays 5062 on purpose:
  saves live in `localStorage`, which is keyed by origin, and a moving port loses them.

Test servers bind `:0`, never a fixed port. The box-wide map is
`~/Code/DanLoom/PORTS.md` and the convention behind it is `~/Code/loom/PORTS.md`; read
the owner before killing any port, and only ever kill one in your own lane.

## How a round is written down

When the round lands, three files move, and which one gets what is not arbitrary:

- **[ROUND_NOTES.md](ROUND_NOTES.md)** — the round itself, newest first: the measured
  gap, the arithmetic that named it, the fix, and the numbers before and after. Any
  fingerprint change is recorded here as `old → new` with the colony count and wall
  clock. This is the file that makes a later round able to attribute a regression.
- **[ACCEPTANCE.md](ACCEPTANCE.md)** — a promise, and the test that now holds it down.
  Rows are **automated** (the suite fails if it stops being true) or **manual** (it
  lives as a numbered step in `PLAYTEST.md`). A promise with no row is not held.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — only when the *shape* changed: a new seam, a
  new dependency direction, a constant that turned out to mean something.

A look round — one that changed what the game looks like rather than what a grid
measures — is written down the same way, with the frames it compared standing in for
the numbers; the shape of that entry is in [LOOK.md](LOOK.md).

Corrections stay visible rather than being edited away. The record of having measured
two populations and written the wrong one down is worth more than a clean document,
because the next person to read that column is about to make the same mistake.
