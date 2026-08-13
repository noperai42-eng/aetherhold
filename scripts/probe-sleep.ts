/**
 * The settler who sleeps through starving.
 *
 * `scripts/probe-upright.ts` on harsh/424242 puts 27 524 of the on-their-feet
 * starving ticks under one reason — `is asleep` — with free food standing
 * reachable the whole time, and one settler holding a single unbroken spell of
 * 102.1 h that is still running when the run ends. That is the grid's whole
 * on-their-feet column, in one settler, asleep.
 *
 * Two ways a settler sleeps, and only one of them can be woken by an empty
 * stomach. The `sleep` job checks `food < 0.12 && rest > 0.5` every tick and gets
 * them up. Sleeping *rough* — `tryNeedJob` sets `activity = 'sleeping'` with no
 * job when there is nowhere to lie down — is ticked by `tickGroundSleep`, which
 * only ever wakes them at `rest > 0.9` and has never heard of food. Worse,
 * `tick.ts:312` sends a jobless sleeper straight there and `continue`s, so the
 * need pass never runs on them at all.
 *
 * And `tickGroundSleep` returns early for a settler lying on a bed cell, on the
 * grounds that the sleep job has them — which is true unless they have no job, in
 * which case *nothing* has them: rest never climbs, the 0.9 wake never fires, and
 * they are asleep for good.
 *
 * This walks the run and, on every tick a settler is asleep with no job, records
 * whether they are on a bed, what their rest is doing, and how long it lasts.
 *
 * Not in the build, not under `src/sim` or `src/eval`, so it does not move the
 * fingerprint. Reads the world and writes nothing.
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { TICKS_PER_DAY, type Difficulty } from '../src/sim/types';
import { isBed } from '../src/sim/buildings';
import { buildingAt } from '../src/sim/grid';

const seed = Number(process.argv[2] ?? 424242);
const difficulty = (process.argv[3] ?? 'harsh') as Difficulty;
const days = Number(process.argv[4] ?? 60);

const world = createWorld(seed, difficulty);
const streams = makeStreams(world);

interface Spell {
  id: number;
  name: string;
  from: number;
  ticks: number;
  onBed: number;
  restFrom: number;
  restTo: number;
  foodTo: number;
  hungryTicks: number;
}

const open = new Map<number, Spell>();
const done: Spell[] = [];

for (let day = 1; day <= days; day++) {
  for (let i = 0; i < TICKS_PER_DAY; i++) {
    stepWorld(world, streams);

    const asleep = new Set<number>();
    for (const p of world.pawns) {
      if (p.dead || p.downed || p.faction !== 'colony') continue;
      if (p.activity !== 'sleeping' || p.jobId !== null) continue;
      asleep.add(p.id);
      let s = open.get(p.id);
      if (!s) {
        s = {
          id: p.id,
          name: p.name,
          from: world.tick,
          ticks: 0,
          onBed: 0,
          restFrom: p.needs.rest,
          restTo: p.needs.rest,
          foodTo: p.needs.food,
          hungryTicks: 0,
        };
        open.set(p.id, s);
      }
      s.ticks++;
      s.restTo = p.needs.rest;
      s.foodTo = p.needs.food;
      const bed = buildingAt(world, Math.round(p.x), Math.round(p.y));
      if (bed && isBed(bed.kind)) s.onBed++;
      if (p.needs.food <= 0.02) s.hungryTicks++;
    }
    for (const [id, s] of open) {
      if (!asleep.has(id)) {
        done.push(s);
        open.delete(id);
      }
    }
  }
}
for (const s of open.values()) done.push(s);

const hours = (t: number): string => ((t / TICKS_PER_DAY) * 24).toFixed(1);
console.log(`${difficulty}/${seed}, ${days} days, no steward`);
console.log(`  ${done.length} spells of sleeping rough (asleep, no job)`);
console.log(`  ${hours(done.reduce((a, s) => a + s.ticks, 0))} h of it in total`);
console.log(`  ${hours(done.reduce((a, s) => a + s.hungryTicks, 0))} h of that at or below zero food`);
console.log('  longest, worst first:');
for (const s of done.sort((a, b) => b.ticks - a.ticks).slice(0, 8)) {
  console.log(
    `    ${s.name.padEnd(18)} #${String(s.id).padEnd(6)} ${hours(s.ticks).padStart(7)} h` +
      ` from day ${String(Math.ceil(s.from / TICKS_PER_DAY)).padStart(2)}` +
      `, rest ${s.restFrom.toFixed(2)} -> ${s.restTo.toFixed(2)}` +
      `, food ended ${s.foodTo.toFixed(2)}` +
      `, ${((s.onBed / s.ticks) * 100).toFixed(0)}% of it lying on a bed`,
  );
}
