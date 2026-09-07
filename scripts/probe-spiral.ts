/**
 * Why a colony that is not short of anything dies anyway.
 *
 * Seed 7 loses four settlers by day three with a fence standing that already has
 * its wood, and seed 99001 ends day forty with six of seven on the floor and one
 * nurse walking between them. Neither is short of food or timber, so the money is
 * on the sickbay: every carer is also a patient, and there is nobody left standing
 * to tend the people who could still be saved.
 *
 * Per day and per seed: who is standing, who is down, what is wrong with them, how
 * recently they were tended and how well, and what the colony had to treat them
 * with. `npx tsx scripts/probe-spiral.ts [days] [seed...]`.
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { countResource, hostiles, livingColonists } from '../src/sim/world';
import { COLD_BELOW } from '../src/sim/health';
import { skillOf } from '../src/sim/skills';
import { TICKS_PER_DAY, type SkillName, type World } from '../src/sim/types';

const days = Number(process.argv[2] ?? 40);
const seeds = process.argv.slice(3).map(Number);

/** The best any living settler has in a skill — the level a craft gate is asked of. */
function best(world: World, skill: SkillName): number {
  let n = 0;
  for (const p of livingColonists(world)) n = Math.max(n, skillOf(p, skill));
  return n;
}

/** What is wrong with the colony, worst first, as `kind severity×count`. */
function sickness(world: World): string {
  const by = new Map<string, { n: number; worst: number; tended: number }>();
  for (const p of livingColonists(world)) {
    for (const a of p.ailments ?? []) {
      const e = by.get(a.kind) ?? { n: 0, worst: 0, tended: 0 };
      e.n++;
      e.worst = Math.max(e.worst, a.severity);
      if (a.tendedUntil > world.tick) e.tended++;
      by.set(a.kind, e);
    }
  }
  return [...by.entries()]
    .sort((a, b) => b[1].worst - a[1].worst)
    .map(([k, e]) => `${k} ${e.n}@${e.worst.toFixed(2)} tended ${e.tended}`)
    .join('  ');
}

for (const seed of seeds) {
  const world = createWorld(seed, 'harsh');
  const streams = makeStreams(world);
  console.log(`\nseed ${seed}`);
  const wasDown = new Map<number, boolean>();
  for (let d = 0; d < days; d++) {
    // Accumulated across the day, not read off the end of it. A once-a-day
    // reading lands on the same hour every time — here it was dawn, when the
    // colony is coldest and hungriest — so it reported six settlers on the floor
    // with nobody ill and forty meals in the larder, and the same six upright
    // twenty-four hours later. What matters is how much of the day was spent
    // down, who went down and why, and whether anybody was left standing to
    // tend them, so all four are counted tick by tick.
    let downTicks = 0;
    let pawnTicks = 0;
    let noCarerTicks = 0;
    let worst = 1;
    const collapses = new Map<string, number>();
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      stepWorld(world, streams);
      const alive = livingColonists(world);
      pawnTicks += alive.length;
      let up = 0;
      for (const p of alive) {
        if (p.downed) downTicks++;
        else up++;
        worst = Math.min(worst, p.hp / p.maxHp);
        const before = wasDown.get(p.id) ?? false;
        if (p.downed && !before) {
          // "hurt or starved" was doing too much work: six settlers hitting the
          // floor on the same afternoon with thirty meals in the larder is not
          // six people forgetting to eat. Ask the three things that can put them
          // there, in the order that rules each other out.
          const ill = (p.ailments ?? []).find((a) => a.severity >= 0.62);
          const why = ill
            ? ill.kind
            : hostiles(world).length > 0
              ? 'raid'
              : p.needs.food < 0.15
                ? 'starved'
                : (p.comfort ?? 0) < COLD_BELOW
                  ? 'cold'
                  : 'hurt';
          collapses.set(why, (collapses.get(why) ?? 0) + 1);
        }
        wasDown.set(p.id, p.downed);
      }
      if (up === 0 && alive.length > 0) noCarerTicks++;
    }
    const alive = livingColonists(world);
    const dead = world.pawns.filter((p) => p.kind === 'colonist' && p.dead).length;
    const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, pawnTicks))}%`;
    const why = [...collapses.entries()].map(([k, n]) => `${k}×${n}`).join(' ') || '-';
    console.log(
      `day ${String(d).padStart(2)}  crew ${alive.length}  dead ${dead}  ` +
        `down ${pct(downTicks)}  nobody-up ${Math.round((100 * noCarerTicks) / TICKS_PER_DAY)}%  ` +
        `worst hp ${worst.toFixed(2)}  med ${countResource(world, 'medicine')}  ` +
        `meal ${countResource(world, 'meal')}  raw ${countResource(world, 'rawfood')}  ` +
        `plants ${best(world, 'plants').toFixed(1)}  doc ${best(world, 'medicine').toFixed(1)}  ` +
        `| collapses ${why}  | ${sickness(world) || 'nobody ill'}`,
    );
    if (alive.length === 0) break;
  }
}
