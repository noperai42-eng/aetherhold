import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { countResource, hostiles, livingColonists } from '../src/sim/world';
import { isSleepHours } from '../src/sim/clock';
import { boardClear, heart, boundsOf, AMBITIONS, HARVEST_RADIUS, WOOD_FLOOR } from '../src/sim/steward';
import { isTimber } from '../src/sim/forest';
import { regionAt } from '../src/sim/regions';
import { adjacentStandCells, dist } from '../src/sim/grid';
import { TICKS_PER_DAY } from '../src/sim/types';

const w = createWorld(99001, 'harsh');
const streams = makeStreams(w);
stepWorldN(w, streams, TICKS_PER_DAY * 40);
const room = heart(w);
console.log('boardClear', boardClear(w), 'heart', room ? 'yes' : 'NO', 'hostiles', hostiles(w).length, 'night', isSleepHours(w), 'alive', livingColonists(w).length);
console.log('wood', countResource(w, 'wood'), 'floor', WOOD_FLOOR);
if (room) {
  const b = boundsOf(w, room);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const home = regionAt(w, Math.round(cx), Math.round(cy));
  const timber = w.buildings.filter((t) => t.built && isTimber(t));
  const trees = w.buildings.filter((t) => t.built && t.kind === 'tree');
  console.log('home region', home, 'trees', trees.length, 'timber', timber.length);
  for (const reach of [HARVEST_RADIUS, HARVEST_RADIUS * 2, 999]) {
    const near = timber.filter((t) => dist(t.x, t.y, cx, cy) < reach);
    const reachable = near.filter((t) => adjacentStandCells(w, t.x, t.y).some((c) => regionAt(w, c.x, c.y) === home));
    console.log(`reach ${reach}: timber ${near.length} reachable ${reachable.length}`);
  }
  const stores = AMBITIONS.find((a) => a.id === 'stores')!;
  console.log('stores.mark ->', stores.mark(w));
  const sizes = new Map<number, number>();
  for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) {
    const r = regionAt(w, x, y);
    if (r >= 0) sizes.set(r, (sizes.get(r) ?? 0) + 1);
  }
  console.log('centre', Math.round(cx), Math.round(cy), 'region', home, 'size', sizes.get(home));
  console.log('regions on the map', sizes.size, 'biggest', [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r}:${n}`).join(' '));
  console.log('settlers', livingColonists(w).map((p) => `${p.name}@${Math.round(p.x)},${Math.round(p.y)} r${regionAt(w, Math.round(p.x), Math.round(p.y))}`).join('  '));
  const frames = w.buildings.filter((b) => !b.built);
  console.log('frames by region', frames.map((b) => regionAt(w, b.x, b.y)).join(','));
}
