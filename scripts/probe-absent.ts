/**
 * Does the starvation clock keep running while the settler is off the map?
 *
 * `scripts/probe-upright.ts` came back with an impossibility: harsh/424242 spends
 * 20.3 h all told with an upright settler at zero, and reports a single unbroken
 * spell of 154.5 h. A spell cannot be longer than the sum of the ticks it is made
 * of unless the ticks in the middle were never looked at.
 *
 * The shape of the bug was there to find. `run.ts` latches a settler by walking
 * `world.pawns` and deletes the latch in the `else` of that walk — so a settler
 * **lifted off the map** is neither latched nor cleared. `settlements.ts:883`
 * lifts a trade party's traveller off by design ("they take no jobs, eat no
 * meals") and `holdings.ts:366` does the same for a campaign, so walking out at
 * zero and back in a week later would book the journey as one spell.
 *
 * **It does not happen.** This runs the latch twice on the same world — once
 * exactly as `run.ts` writes it, once dropping any latch whose settler is not on
 * the map this tick — and on harsh/424242 both read 102.1 h, because neither
 * traveller ever left at zero food. The 154.5 h was the *probe's* artefact: it
 * ran the steward, which the fifteen sweep runs do not, so it measured a
 * different colony and cleared its own latch off a list absent settlers are not
 * on. Kept because a negative result that took two runs to get is worth the
 * forty lines, and because the next person to see a long spell will have the
 * same idea.
 *
 * No steward, which is what makes it reproduce the sweep exactly.
 *
 * Not in the build, not under `src/sim` or `src/eval`, so it does not move the
 * fingerprint. Reads the world and writes nothing.
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { TICKS_PER_DAY, type Difficulty } from '../src/sim/types';

const seed = Number(process.argv[2] ?? 424242);
const difficulty = (process.argv[3] ?? 'harsh') as Difficulty;
const days = Number(process.argv[4] ?? 60);

/** The line `run.ts` and the starvation principle both call starving. */
const STARVING = 0.02;

const world = createWorld(seed, difficulty);
const streams = makeStreams(world);

/** The latch as `run.ts` writes it today. */
const asShipped = new Map<number, number>();
let longestShipped = 0;
/** The same latch, cleared for anybody not standing in the world this tick. */
const onMapOnly = new Map<number, number>();
let longestOnMap = 0;

/** Ticks a colony settler was absent from `world.pawns` entirely. */
const absentTicks = new Map<number, number>();
/** Ticks they were absent *while their last sighting had them at zero food*. */
const absentHungry = new Map<number, number>();
/** Last seen food level, so an absence can be attributed. */
const lastFood = new Map<number, number>();
/** Names, for the report — the pawn object is gone while they are away. */
const names = new Map<number, string>();

for (let day = 1; day <= days; day++) {
  for (let i = 0; i < TICKS_PER_DAY; i++) {
    stepWorld(world, streams);

    const here = new Set<number>();
    for (const p of world.pawns) {
      if (p.dead || p.faction !== 'colony') continue;
      here.add(p.id);
      names.set(p.id, p.name);
      lastFood.set(p.id, p.needs.food);
      const hungry = p.needs.food <= STARVING && !p.downed;
      if (hungry) {
        const a = asShipped.get(p.id) ?? world.tick;
        asShipped.set(p.id, a);
        longestShipped = Math.max(longestShipped, world.tick - a + 1);
        const b = onMapOnly.get(p.id) ?? world.tick;
        onMapOnly.set(p.id, b);
        longestOnMap = Math.max(longestOnMap, world.tick - b + 1);
      } else {
        asShipped.delete(p.id);
        onMapOnly.delete(p.id);
      }
    }
    // The one line the shipped latch is missing.
    for (const id of onMapOnly.keys()) if (!here.has(id)) onMapOnly.delete(id);

    for (const id of names.keys()) {
      if (here.has(id)) continue;
      absentTicks.set(id, (absentTicks.get(id) ?? 0) + 1);
      if ((lastFood.get(id) ?? 1) <= STARVING) {
        absentHungry.set(id, (absentHungry.get(id) ?? 0) + 1);
      }
    }
  }
}

const hours = (t: number): string => ((t / TICKS_PER_DAY) * 24).toFixed(1);
console.log(`${difficulty}/${seed}, ${days} days, no steward`);
console.log(`  starveHours as shipped:            ${hours(longestShipped)} h`);
console.log(`  starveHours counting on-map ticks: ${hours(longestOnMap)} h`);
console.log('  settlers who left the map at all:');
for (const [id, n] of [...absentTicks.entries()].sort((a, b) => b[1] - a[1])) {
  const hungryAway = absentHungry.get(id) ?? 0;
  console.log(
    `    ${(names.get(id) ?? '?').padEnd(18)} #${String(id).padEnd(6)} away ${hours(n).padStart(7)} h` +
      (hungryAway > 0 ? `, ${hours(hungryAway)} h of it having walked out at zero` : ''),
  );
}
