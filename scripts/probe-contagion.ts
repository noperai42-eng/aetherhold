/** What contagion costs a colony left alone. Not a test — a probe. */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { livingColonists } from '../src/sim/world';
import { hasAilment } from '../src/sim/health';

const DAYS = Number(process.argv[2] ?? 20);
for (const seed of [99001, 1234, 4242, 7, 20260729]) {
  const w = createWorld(seed);
  const streams = makeStreams(w);
  let peakIll = 0;
  let illDays = 0;
  for (let d = 0; d < DAYS; d++) {
    stepWorldN(w, streams, 2400);
    const ill = livingColonists(w).filter((p) => hasAilment(p, 'flu')).length;
    if (ill > peakIll) peakIll = ill;
    illDays += ill;
  }
  const alive = livingColonists(w);
  console.log(
    `seed ${String(seed).padStart(8)}  alive ${alive.length}  down ${alive.filter((p) => p.downed).length}` +
      `  ill now ${alive.filter((p) => hasAilment(p, 'flu')).length}  peak ill ${peakIll}` +
      `  settler-days ill ${illDays}  meals ${w.stats.mealsCooked}`,
  );
}
