/**
 * What a colony loses by never being told to build a sickbay or a cell.
 *
 * `medbed` and `prisonbed` are both fully wired: a medbed multiplies immunity
 * gain by 1.3 against a plain bunk's 1.0 (`immunityScale`), and one built
 * prisonbed is the single condition that opens the warden's capture path at all
 * (`jobs.ts:1591`). But no Steward ambition plans either, and worldgen places
 * neither — so on any colony nobody is clicking, both are dead code.
 *
 * Per seed: what got built, how many raiders lay on the ground alive and were
 * left there, and where the sick actually spent their illness — because that
 * last column is the size of the prize.
 *
 * `npx tsx scripts/probe-ward.ts [days] [seed...]`
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { livingColonists } from '../src/sim/world';
import { unhoused } from '../src/sim/quarters';
import { bedOf } from '../src/sim/health';
import { TICKS_PER_DAY } from '../src/sim/types';

const days = Number(process.argv[2] ?? 40);
const seeds = process.argv.slice(3).map(Number);

console.log('\nsickbay and cells · harsh · steward driving');
console.log('seed      medbed prisonbed  captives  ill-time: feet  floor   bunk medbed');

for (const seed of seeds) {
  const world = createWorld(seed, 'harsh');
  const streams = makeStreams(world);
  // Distinct raiders, not raider-ticks: the question is how many people the
  // colony could have taken, and one man on the ground for a day is one man.
  const layDown = new Set<number>();
  let feet = 0;
  let floor = 0;
  let bunk = 0;
  let ward = 0;
  for (let d = 0; d < days; d++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      stepWorld(world, streams);
      for (const p of world.pawns) {
        if (p.faction === 'raider' && p.downed && !p.dead) layDown.add(p.id);
      }
      for (const p of livingColonists(world)) {
        if (!(p.ailments ?? []).some((a) => a.severity > 0)) continue;
        const bed = p.activity === 'sleeping' || p.downed ? bedOf(world, p) : null;
        if (bed) bed.kind === 'medbed' ? ward++ : bunk++;
        else if (p.downed) floor++;
        else feet++;
      }
    }
    if (livingColonists(world).length === 0) break;
  }
  const built = (k: string) => world.buildings.filter((b) => b.kind === k && b.built).length;
  // Why the cell block never got walled, which is a different question from
  // whether it should have been. `cells` sits below `quarters` and wants a gun on
  // the wall first, so a colony that never raises a turret, or never houses
  // everybody, never reaches it at all.
  console.log(
    `          gates: turrets ${built('turret')}  unhoused ${unhoused(world).length}  ` +
      `beds ${built('bed') + built('medbed')}/${livingColonists(world).length}  wood ${world.items.filter((i) => i.kind === 'wood').reduce((n, i) => n + i.amount, 0)}`,
  );
  const total = Math.max(1, feet + floor + bunk + ward);
  const pct = (n: number) => `${Math.round((100 * n) / total)}%`.padStart(6);
  console.log(
    `${String(seed).padEnd(9)} ${String(built('medbed')).padStart(6)} ${String(built('prisonbed')).padStart(9)} ` +
      `${String(layDown.size).padStart(9)}            ${pct(feet)} ${pct(floor)} ${pct(bunk)} ${pct(ward)}`,
  );
}
