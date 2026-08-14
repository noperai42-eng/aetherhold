/**
 * Why does the dominion ending not land any more?
 *
 * `tests/endings.test.ts > takes the moor, holds it for twelve days` plays the
 * whole thing through the real loop and asserts `hasEnded(world)`. It now comes
 * back false, and the assertion cannot say why: `tickEndings` resets `since` to
 * null the moment anything stalls, so a colony that faltered on day nine and
 * recovered on day ten looks identical, at the end, to one that never started.
 *
 * The stall reason is right there in `endingProgress().stalled` — a charter
 * title, or the road having slipped a rung. So watch it at the cadence the sim
 * writes it (`tickEndings` fires every twentieth tick) and print every change:
 * when the clock started, every time it broke and what broke it, and where the
 * bill stood. One line per event rather than per day, because a colony that is
 * fine for twelve days should print almost nothing.
 *
 * The fixture is copied from the test rather than imported, which is the same
 * rule the test file states for itself: a fixture shared between two callers is
 * a fixture that gets tuned for one of them.
 *
 * What it found, and why the copy is now worth keeping: a stall at day 8.70
 * reading "an ally over the ridge", clear again at 11.32, and the bill at 3/3
 * the whole way. Nothing to do with the ending mechanism — a commission lapsed,
 * `commissions.ts` took four points of standing for it, and the fixture had
 * stood the colony on exactly `NEED_RELATIONS` with nothing to give. The test
 * now founds an allied colony with room to lose a letter; this script keeps the
 * old threshold on purpose, so it still prints the day the clock breaks.
 *
 * Not under `src/sim` or `src/eval`, so it does not move the fingerprint.
 *
 *   npx rolldown scripts/probe-ending.ts --format esm --platform node -d .eval/build
 *   node .eval/build/probe-ending.js
 */

import {
  ENDING_DAYS,
  ENDING_TICKS,
  commitEnding,
  endingProgress,
  endingsOpen,
  hasEnded,
} from '../src/sim/endings';
import { STANDING_BAND } from '../src/sim/events';
import { holdingsOf } from '../src/sim/holdings';
import { makePawn } from '../src/sim/pawn';
import { RESEARCH_ORDER } from '../src/sim/research';
import { Rng } from '../src/sim/rng';
import { ROAD_RUNGS, roadRungs } from '../src/sim/roads';
import { settlementsOf } from '../src/sim/settlements';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { TICKS_PER_DAY, type World } from '../src/sim/types';
import { HOLD_TICKS, NEED_PEOPLE, NEED_RELATIONS, NEED_RESEARCH, charters, hasWon } from '../src/sim/victory';
import { addBuilding, addItem, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

function founded(seed = 4242): World {
  const world = createWorld(seed);
  const rng = new Rng(99);
  while (livingColonists(world).length < NEED_PEOPLE) makePawn(world, rng, 'colony', 30, 30);
  addItem(world, 'meal', 900, 31, 34);
  for (const at of [
    { x: 24, y: 30 },
    { x: 24, y: 32 },
  ]) {
    let up = false;
    for (let r = 0; r < 12 && !up; r++) {
      for (let dy = -r; dy <= r && !up; dy++) {
        for (let dx = -r; dx <= r && !up; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          up = !!addBuilding(world, 'turret', at.x + dx, at.y + dy, true);
        }
      }
    }
    if (!up) throw new Error(`nowhere to stand a turret near ${at.x},${at.y}`);
  }
  world.research.done = RESEARCH_ORDER.slice(0, NEED_RESEARCH).slice();
  settlementsOf(world)[0]!.relations = NEED_RELATIONS;
  world.storyteller.nextThreat = TICKS_PER_DAY * 90;
  world.storyteller.nextScout = TICKS_PER_DAY * 90;
  world.storyteller.nextOutbreak = TICKS_PER_DAY * 90;
  const streams = makeStreams(world);
  for (let i = 0; i < HOLD_TICKS + TICKS_PER_DAY && !hasWon(world); i++) stepWorldN(world, streams, 1);
  if (!hasWon(world)) throw new Error('the fixture failed to found');
  return world;
}

const world = founded();
for (const h of holdingsOf(world)) h.held = true;
world.stats.raidersKilled = STANDING_BAND;

console.log(`open: ${endingsOpen(world).join(', ') || '(none)'}`);
console.log(`committed: ${commitEnding(world, 'dominion')}`);
console.log(`the hold is ${ENDING_DAYS} days · warfare at ${roadRungs(world).warfare}/${ROAD_RUNGS} rungs`);
console.log('day    event');

const streams = makeStreams(world);
const committedOn = world.ending!.committed;
let was: string | null | undefined;
const day = () => ((world.tick - committedOn) / TICKS_PER_DAY).toFixed(2).padStart(6);

for (let i = 0; i < ENDING_TICKS + TICKS_PER_DAY * 2 && !hasEnded(world); i += 20) {
  stepWorldN(world, streams, 20);
  const p = endingProgress(world)!;
  if (p.stalled !== was) {
    const unmet = charters(world)
      .filter((c) => !c.met)
      .map((c) => c.title)
      .join(', ');
    console.log(
      `${day()}  ${p.stalled ? `STALL — ${p.stalled}` : 'running'}` +
        ` · bill ${p.bill.at}/${p.bill.of} · ${p.daysLeft.toFixed(2)} days left` +
        ` · warfare ${roadRungs(world).warfare}/${ROAD_RUNGS}` +
        (unmet ? ` · unmet: ${unmet}` : ''),
    );
    was = p.stalled;
  }
}

const p = endingProgress(world)!;
console.log(`\nended: ${hasEnded(world)}`);
console.log(`bill ${p.bill.at}/${p.bill.of} · ${p.daysLeft.toFixed(2)} days left · stalled: ${p.stalled ?? 'no'}`);
console.log(`people ${livingColonists(world).length} · gameOver ${world.gameOver}`);
console.log(`unmet charters: ${charters(world).filter((c) => !c.met).map((c) => c.title).join(', ') || '(none)'}`);
