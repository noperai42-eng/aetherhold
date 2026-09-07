/**
 * Does the colony ever get a workbench, and if not, what is standing in front of it?
 *
 * Medicine is the only thing that stops a wound turning into an infection, and the
 * only two ways to get any are a trader and the bench. `probe-collapse` found seed
 * 1312 at `med 0` from day two to the day the last settler died, with the larder
 * full the whole way — so the question is not whether the colony could afford
 * medicine, it is whether anything ever told it to make some.
 *
 * Prints, per day: the bench, the medicine on the shelf, and which ambition the
 * Steward marked — because `knowhow` is what plans a bench and it sits below
 * `quarters` in the list.
 */
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { countResource, livingColonists } from '../src/sim/world';
import { CRAFT_DEFS } from '../src/sim/crafting';
import { AMBITIONS } from '../src/sim/steward';
import { unhoused } from '../src/sim/quarters';
import { TICKS_PER_DAY, type World } from '../src/sim/types';

const days = Number(process.argv[2] ?? 40);
const seeds = process.argv.slice(3).map(Number);

const built = (world: World, kind: string): number =>
  world.buildings.filter((b) => b.built && b.kind === kind).length;

/**
 * The raw food nobody has claimed, as heaps rather than a total — because a heap
 * is what a recipe actually spends.
 *
 * `benchRecipe` asks `freeStack` for a *single* stack holding the whole cost, so
 * twelve raw food in twelve heaps of one buys no balm at all. The colony's own
 * comment on that function already names the trap for rifles ("ninety steel in
 * three heaps of thirty"); this column asks whether medicine is falling into it.
 */
function heaps(world: World): { big: number; total: number; most: number } {
  const cost = CRAFT_DEFS.balm.input.cost;
  let big = 0;
  let total = 0;
  let most = 0;
  for (const s of world.items) {
    if (s.kind !== 'rawfood' || s.carriedBy !== null || s.reservedBy !== null) continue;
    total += s.amount;
    most = Math.max(most, s.amount);
    if (s.amount >= cost) big++;
  }
  return { big, total, most };
}

for (const seed of seeds) {
  const world = createWorld(seed, 'harsh');
  const streams = makeStreams(world);
  console.log(`\nseed ${seed}`);
  for (let d = 0; d < days; d++) {
    // Which ambition is holding the line, asked the way `tickSteward` asks it:
    // the first one whose `mark` returns above zero ends the pass, so everything
    // below it never runs. Asked once a day on a copy of the board is close
    // enough to name the blocker without changing what the run does — `mark`
    // plans blueprints, so this is read on the last tick of the day and the
    // colony then lives with whatever it planned.
    // Off by default, and that default is the point. `mark` is not a read: it
    // plans blueprints, so asking every ambition what it wants *changes what the
    // colony builds*. Naming the blocker is worth that; measuring when the bench
    // lands is not, and the first run of this probe did both at once. `WHY=1`
    // asks, plain runs only watch.
    let holding = AMBITIONS.length > 0 && process.env.WHY ? '?' : 'n/a';
    for (let t = 0; t < TICKS_PER_DAY; t++) stepWorld(world, streams);
    if (process.env.WHY) for (const a of AMBITIONS) {
      if (a.mark(world) > 0) {
        holding = a.id;
        break;
      }
    }
    if (holding === '?') holding = '-';
    const alive = livingColonists(world);
    const h = heaps(world);
    console.log(
      `day ${String(d).padStart(2)}  crew ${alive.length}  bench ${built(world, 'bench')}  ` +
        `med ${countResource(world, 'medicine')}  raw ${countResource(world, 'rawfood')}  ` +
        `free ${h.total} in heaps, biggest ${h.most}, usable ${h.big}  ` +
        `unhoused ${unhoused(world).length}  steward ${holding}`,
    );
    if (alive.length === 0) break;
  }
}
