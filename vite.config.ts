import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  //
  // Two servers, on purpose.
  //
  // 5062 is this project's lane primary (see ~/Code/DanLoom/PORTS.md): 5173 and
  // the 5180s belong to other apps on this box. Not 5060/5061 — Chrome blocks
  // those as SIP ports and refuses to load the page at all. strictPort on both,
  // so a collision is loud rather than silently landing somewhere else.
  //
  // 5062 is now the *play* server — `npm run play`, which serves the built
  // snapshot in dist/ and never reloads anybody's game because a source file
  // changed. It keeps the port it has always had for one reason that matters:
  // saves live in localStorage, which is keyed by origin, so moving the players'
  // URL would throw their colonies away.
  //
  // 5063 is the dev server with HMR, for whoever is actually editing. A new
  // build only reaches the players when somebody runs `npm run ship`, and even
  // then only on their next reload.
  // allowedHosts: Vite 8 answers requests by IP but 403s an unknown Host header,
  // which is right on the open internet and wrong here — it means the players'
  // URL has to be a DHCP lease that moves. `.local` is the mDNS namespace, so
  // this permits exactly `NoperAI.local` and its neighbours on the LAN and
  // nothing routable. That buys a *stable origin*: localStorage is keyed by
  // origin, so every time this box's lease moved, every colony saved at the old
  // address became unreachable. A name that follows the machine ends that.
  server: { host: '0.0.0.0', port: 5063, strictPort: true, allowedHosts: ['.local'] },
  preview: { host: '0.0.0.0', port: 5062, strictPort: true, allowedHosts: ['.local'] },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Vitest's 5s default is sized for unit tests. Half this suite plays whole
    // colonies forward for weeks of game time — the defence test alone runs
    // 22 simulated days — so the default turns "the sim got a little busier"
    // into a red build that says nothing about correctness.
    //
    // 300s, not 30s, because of a handful of long evals — the 21-day colony run
    // above all. Every feature that makes the colony *better* makes that run
    // *longer*: livestock took it from 12 surviving settlers to 16, and the
    // Steward's restocking ambition sent those settlers out to fell trees, which
    // is more pathfinding, more jobs and more combat every tick for three
    // simulated weeks. It has walked 35s → 88s → 112s → 190s on that alone, and
    // each step was the colony getting healthier: the last one was the hauling
    // levers (`tests/hauling.test.ts`), which roughly doubled how much a colony
    // gets built, and a colony with twice the base has twice as much to price
    // every tick.
    //
    // The number to sanity-check this against is not the wall clock, it is the
    // ratio: those runs step ~500 ticks a second, and the game needs 20. A test
    // that has to be slow to be honest is fine at 25× real time; what the ceiling
    // is here to catch is a tick loop that has stopped advancing at all, and five
    // minutes catches that just as well as ninety seconds did.
    testTimeout: 300_000,
    // Bounded concurrency, because this machine's cores are not interchangeable.
    //
    // Vitest defaults its worker count to `availableParallelism() - 1`, which on this
    // box is nine. That is the right default on a symmetric CPU and the wrong one
    // here: this is an Apple M5 with four performance cores and six efficiency
    // ones (`sysctl hw.perflevel0.logicalcpu hw.perflevel1.logicalcpu` → 4, 6), so
    // nine forks means at least five test files are running on a core where the
    // identical work takes three to four times as long.
    //
    // That turned the suite into a coin flip. Six files timed out in one run and
    // every one of them passed on its own — not because anything was slow, but
    // because of which core the scheduler happened to hand them. A ceiling that
    // fires based on that is not measuring the simulation, and a suite that goes
    // red for reasons the diff cannot explain stops being read.
    //
    // Six trades throughput for a number that means something. It is roughly a
    // fifth slower in aggregate — four forks on the fast cores and two on slow
    // ones, against nine spread thin — and in exchange a file's wall clock stops
    // depending on how many of its neighbours happened to start at the same time.
    // Deliberately not four: idle forks waiting on the slowest file would give the
    // efficiency cores nothing to do, and they are worth about a third of a core
    // each rather than nothing.
    maxWorkers: 6,
  },
});
