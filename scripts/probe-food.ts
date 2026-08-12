/**
 * Who starves beside a full pantry, and what they were doing at the time.
 *
 * `nobody-starves-beside-a-full-pantry` has been reporting `broken` on six of
 * fifteen colonies for several rounds without a cause. Its own comment lists
 * three live explanations — a downed settler nobody carried a meal to, a recruit
 * who joined starving, and a hauling reservation — and says, correctly, that it
 * does not claim between them. This probe is what claims between them.
 *
 * Not part of the build and not under `src/eval`, so it does not move the
 * fingerprint keying `.eval/measurements.json`. It reads the sim and writes
 * nothing.
 *
 * Sampled **every tick**, not once a day. The grid's day boundary lands at the
 * same hour every time — awake, unfed, not yet departed — so a daily sample of a
 * hunger curve reads one phase of it and calls that the day. A settler who is at
 * zero for forty minutes and a settler who is at zero for a week look identical
 * at one sample a day, and those are not the same bug.
 */

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { countResource, livingColonists } from '../src/sim/world';
import { TICKS_PER_DAY, type Difficulty } from '../src/sim/types';
import { stewardTick } from '../src/eval/steward';

/** One settler's spell at or near zero food, from the tick it began. */
interface Spell {
  who: number;
  name: string;
  fromTick: number;
  toTick: number;
  /** Lowest food reached in the spell. */
  low: number;
  /** Ticks of the spell the settler spent on the floor. */
  downedTicks: number;
  /** Ticks of the spell with at least one meal or raw food in the colony's stock. */
  fedableTicks: number;
  /** What the settler was doing, counted by activity. */
  doing: Record<string, number>;
  /** Their food the first tick we ever saw them, to catch a recruit who joined starving. */
  foodOnArrival: number;
  /** The tick we first saw them at all. */
  firstSeen: number;
}

const seed = Number(process.argv[2] ?? 424242);
const difficulty = (process.argv[3] ?? 'harsh') as Difficulty;
const days = Number(process.argv[4] ?? 60);

const world = createWorld(seed, difficulty);
const streams = makeStreams(world);

/** Open spell per pawn id, closed when they climb back over the threshold. */
const open = new Map<number, Spell>();
const closed: Spell[] = [];
/** First tick each pawn was seen, and their food at that moment. */
const arrival = new Map<number, { tick: number; food: number }>();

/** The verdict's own line: 0.02 is what the run report already calls starving. */
const STARVING = 0.02;

for (let day = 1; day <= days; day++) {
  for (let i = 0; i < TICKS_PER_DAY; i++) {
    stepWorld(world, streams);
    stewardTick(world, world.tick);

    const meals = countResource(world, 'meal');
    const raw = countResource(world, 'rawfood');
    const stocked = meals + raw > 0;

    const here = new Set<number>();
    for (const p of livingColonists(world)) {
      here.add(p.id);
      if (!arrival.has(p.id)) arrival.set(p.id, { tick: world.tick, food: p.needs.food });

      if (p.needs.food <= STARVING) {
        let spell = open.get(p.id);
        if (!spell) {
          const first = arrival.get(p.id)!;
          spell = {
            who: p.id,
            name: p.name,
            fromTick: world.tick,
            toTick: world.tick,
            low: p.needs.food,
            downedTicks: 0,
            fedableTicks: 0,
            doing: {},
            foodOnArrival: first.food,
            firstSeen: first.tick,
          };
          open.set(p.id, spell);
        }
        spell.toTick = world.tick;
        spell.low = Math.min(spell.low, p.needs.food);
        if (p.downed) spell.downedTicks++;
        if (stocked) spell.fedableTicks++;
        spell.doing[p.activity] = (spell.doing[p.activity] ?? 0) + 1;
      } else {
        const spell = open.get(p.id);
        if (spell) {
          closed.push(spell);
          open.delete(p.id);
        }
      }
    }
    // Somebody who stopped being a living colonist mid-spell — died, or was
    // taken. Close it rather than lose it: a spell that ends in a death is the
    // most interesting kind and dropping it would flatter the report.
    for (const [id, spell] of open) {
      if (!here.has(id)) {
        closed.push(spell);
        open.delete(id);
      }
    }
  }
}
for (const spell of open.values()) closed.push(spell);

const d = (t: number): string => (t / TICKS_PER_DAY).toFixed(2);
const top = (doing: Record<string, number>): string =>
  Object.entries(doing)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

console.log(`${difficulty}/${seed}, ${days} days — ${closed.length} spells at or below ${STARVING}`);
console.log('');
closed.sort((a, b) => b.toTick - b.fromTick - (a.toTick - a.fromTick));
for (const s of closed) {
  const len = s.toTick - s.fromTick + 1;
  console.log(
    `  #${s.who} ${s.name.padEnd(14)} day ${d(s.fromTick)}→${d(s.toTick)} (${(len / TICKS_PER_DAY).toFixed(2)}d)` +
      `  low ${s.low.toFixed(3)}  downed ${((s.downedTicks / len) * 100).toFixed(0)}%` +
      `  stocked ${((s.fedableTicks / len) * 100).toFixed(0)}%` +
      `  joined day ${d(s.firstSeen)} at food ${s.foodOnArrival.toFixed(2)}`,
  );
  console.log(`      doing: ${top(s.doing)}`);
}
