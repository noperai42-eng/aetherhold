/**
 * What actually kills a colony, taken from the colony's own log rather than guessed.
 *
 * The complaint is specific — colonies collapse with food in the larder — and the
 * three ways a settler can die are all distinguishable in `world.messages`:
 * `combat.ts` writes "is dead. (source)", `health.ts` writes "died of <illness>",
 * and `needs.ts` writes "has <cause> to death". Reading the sentence is exact
 * where reading the corpse is not: a settler who starves during a raid is down to
 * the last of three plausible causes and up to the first one if you only look at
 * `hostiles.length`.
 *
 * For every death it also records the thing the complaint is about — what was in
 * the larder, whether anybody was standing, and whether the settler was on the
 * floor at the time, because a settler on the floor cannot walk to a pantry.
 *
 * `npx tsx scripts/probe-collapse.ts [days] [seed...]`
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { countResource, livingColonists } from '../src/sim/world';
import { TICKS_PER_DAY, type Difficulty } from '../src/sim/types';

const days = Number(process.argv[2] ?? 60);
const seeds = process.argv.slice(3).map(Number);
const difficulty: Difficulty = 'harsh';

interface Death {
  day: number;
  name: string;
  how: string;
  downed: boolean;
  food: number;
  meals: number;
  raw: number;
  standing: number;
  crew: number;
}

/** Which of the three sentences this is, reduced to one word. */
function classify(text: string): string | null {
  const dead = /^(.+?) is dead\. \((.+)\)$/.exec(text);
  if (dead) return `killed:${dead[2]}`;
  const ill = /^(.+?) died of (.+)\.$/.exec(text);
  if (ill) return `illness:${ill[2]}`;
  const need = /^(.+?) has (.+) to death\.$/.exec(text);
  if (need) return `need:${need[2]}`;
  return null;
}

function who(text: string): string {
  return /^(.+?) (?:is dead|died of|has )/.exec(text)?.[1] ?? '?';
}

for (const seed of seeds) {
  const world = createWorld(seed, difficulty);
  const streams = makeStreams(world);
  const deaths: Death[] = [];
  let died = 0;
  let lastCrew = livingColonists(world).length;

  for (let d = 0; d < days; d++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      // Read the log *before* the state it describes moves on. A death message is
      // written in the same tick the settler stops existing, so the larder and the
      // number of people still on their feet have to be sampled here and not at
      // the end of the day.
      const alive = livingColonists(world);
      const standing = alive.filter((p) => !p.downed).length;
      const downedBy = new Map(alive.map((p) => [p.name, p.downed]));
      const at = world.tick;
      stepWorld(world, streams);
      // Read the log backwards by tick, never by a saved index. `msg` trims
      // `world.messages` to `LOG_KEEP`, so a cursor that only ever counts up
      // walks off the end the first time the log rotates — which is why the
      // first run of this probe reported two dead colonies and not one death.
      // The chronicle is no help either: a settler starving is not a headline.
      const fresh = [];
      for (let i = world.messages.length - 1; i >= 0; i--) {
        const m = world.messages[i]!;
        if (m.tick < at) break;
        fresh.push(m);
      }
      for (const m of fresh) {
        const how = classify(m.text);
        if (!how) continue;
        const name = who(m.text);
        // Raiders and beasts die by the same sentences. Only settlers the colony
        // had a moment ago count.
        if (!downedBy.has(name)) continue;
        if (deaths.some((x) => x.name === name)) continue;
        deaths.push({
          day: d,
          name,
          how,
          downed: downedBy.get(name) === true,
          food: 0,
          meals: countResource(world, 'meal'),
          raw: countResource(world, 'rawfood'),
          standing,
          crew: alive.length,
        });
      }
    }
    lastCrew = livingColonists(world).length;
    if (lastCrew === 0) {
      died = d;
      break;
    }
  }

  console.log(`\nseed ${seed} · ${difficulty} · ${days} days`);
  console.log(
    lastCrew === 0 ? `  COLONY DEAD on day ${died}` : `  survived with ${lastCrew}, ${deaths.length} lost on the way`,
  );
  for (const x of deaths) {
    console.log(
      `  day ${String(x.day).padStart(2)}  ${x.name.padEnd(16)} ${x.how.padEnd(26)} ` +
        `${x.downed ? 'on the floor' : 'on their feet'}  larder ${x.meals} meals ${x.raw} raw  ` +
        `${x.standing} of ${x.crew} still up`,
    );
  }
}
