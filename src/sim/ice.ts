/**
 * The lake freezes.
 *
 * The lake is the one piece of the map that is permanently in the way: solid
 * ground you cannot build on, cannot cross, and have to walk round for the whole
 * year. This is the six days of the year — midway through winter to midway
 * through spring — when it stops being that and becomes the fastest road on the
 * map, and then the morning it stops being *that*, with whatever the colony left
 * out there still standing on it.
 *
 * Three things make it worth its hundred lines.
 *
 * **It is one number, like the snow.** A per-cell ice field would let one end of
 * the lake bear and the other not, which is more physics than anybody asked for
 * and a second copy of the snowpack's argument. One number covers the whole
 * effect and costs one optional field on the save.
 *
 * **It is a road for everyone.** Frozen water goes through `isSolid`, which is
 * the one gate the planner, a settler's legs, the first-person collision capsule
 * and every raider's approach all ask. So the shortcut is not a settler perk: a
 * raid that would have come round the long way in July walks straight over the
 * lake in January, and a colony that sited its turrets against the summer map
 * finds out in the worst way. Nothing had to be written for that. It falls out of
 * there being one answer to "can something be here".
 *
 * **It has a deadline, and it says so.** Going through the ice gives you the flu,
 * which is an illness this game can kill you with — so the thaw announces itself
 * a good half-day before it can hurt anybody, and again the moment it goes. A
 * hazard with no warning is a trap; a hazard with a warning is a decision about
 * whether that haul is worth the trip.
 *
 * Driven off the *season mean* rather than the thermometer, for the reason a lake
 * is not a puddle: three cold hours before dawn in September do not freeze a body
 * of water, and reading the instantaneous air temperature here would have the
 * lake skinning over and opening again every night of autumn. The month's average
 * is the closest thing this sim has to the temperature of a large cold object,
 * and it moves at the speed ice actually moves at.
 *
 * Plain arithmetic. No randomness is drawn here — the same seed has the same
 * winter, on the water as on the land.
 */

import { seasonMeanTemp } from './temperature';
import { type World, terrainAt } from './types';
import { afflict } from './health';
import { msg } from './world';

/**
 * How thick the ice has to be before it will take a person.
 *
 * Below this the lake is what it is the rest of the year — a wall. Above it the
 * lake is ground. There is deliberately no middle state where it half-works: a
 * surface that sometimes holds is a surface a player cannot plan around, and the
 * pathfinder would have to be taught a probability it has no way to express.
 *
 * The number itself is chosen against the renderer, which lifts the lake bed by
 * exactly this fraction of its depth. The bowl is level with the bank at the
 * instant the ice starts bearing, so a settler steps onto a flat white surface
 * rather than out over a hole — the picture and the collision reach the same
 * conclusion on the same tick, which is the rule this whole project runs on.
 */
export const BEARING = 0.62;

/**
 * Where the warning goes off, on the way down.
 *
 * Far enough above `BEARING` to be a bit over a third of a game day of thaw at
 * the rate the spring mean pulls it off — measured at 1,756 ticks, about a
 * minute and a half of play, which is time to notice the line in the log, find
 * whoever is out there and walk them in from anywhere on the map. The window is
 * the point: the flu at the bottom of the lake is only fair if the colony was
 * told first.
 */
const CREAKING = BEARING + 0.2;

/** Season mean below which the lake starts making ice, and above which it loses it. */
const FREEZE_BELOW = 1;
const THAW_ABOVE = 3;

/**
 * Ticks to go from open water to bearing weight at ten degrees under the freezing
 * line, and the same for the thaw.
 *
 * The valley's mean bottoms out around −2.3, so the real freeze runs at about a
 * third of this rate and takes the first day and a half of winter to make a
 * surface — which is what puts the crossing in the middle of the season rather
 * than handing it over the moment the calendar turns.
 */
const FREEZE_TICKS_AT_TEN = 2400;
const THAW_TICKS_AT_TEN = 2400;

/** How thick the ice is, 0 open water to 1 solid. Absent on an old save reads as open. */
export function iceDepth(world: World): number {
  return world.ice ?? 0;
}

/** Will the lake hold somebody up right now? The one place that decides. */
export function iceBears(world: World): boolean {
  return iceDepth(world) >= BEARING;
}

/**
 * One tick of ice.
 *
 * Both terms every tick and clamp, same as the snowpack, and for the same reason
 * — except here the two thresholds do not overlap, so the two-degree band between
 * them is a deliberate hold: a lake sitting at the turn of the season keeps what
 * it has instead of flickering between road and wall for a whole day.
 */
export function tickIce(world: World): void {
  const before = iceDepth(world);
  const mean = seasonMeanTemp(world);
  const freeze = Math.max(0, FREEZE_BELOW - mean) / 10 / FREEZE_TICKS_AT_TEN;
  const thaw = Math.max(0, mean - THAW_ABOVE) / 10 / THAW_TICKS_AT_TEN;
  const after = Math.max(0, Math.min(1, before + freeze - thaw));
  world.ice = after;

  if (before < BEARING && after >= BEARING) {
    msg(world, 'The lake has frozen hard enough to walk on. So can anything else.', 'info');
  } else if (before >= CREAKING && after < CREAKING) {
    msg(world, 'The ice on the lake is creaking. Get anyone off it before it goes.', 'bad');
  } else if (before >= BEARING && after < BEARING) {
    msg(world, 'The ice has gone out on the lake.', 'info');
  }

  if (after < BEARING) clearTheIce(world);
}

/**
 * Nothing is left standing on open water.
 *
 * One rule for everything the lake could be carrying — settlers, corpses, and
 * loose stacks — and the rule is that the bank gets it back. The alternative was
 * to let the lake keep whatever was on it, which is better drama and a worse
 * game: a corpse under the water is a burial job nobody can path to, and a pile
 * of steel out there is a haul job that is retried forever. A hazard that leaves
 * the world in a state the AI cannot resolve is a bug wearing a hazard's coat.
 * What is left is hazard enough — a settler who goes through comes out ill, and
 * whatever they were doing is cancelled where they stand.
 *
 * Run every tick the lake is not bearing rather than only on the tick it breaks,
 * because "standing on water" has more ways of happening than the thaw: a save
 * made mid-crossing and loaded a week later is the obvious one, and a body the
 * player is driving is under no obligation to be sensible. Ten pawns, a handful
 * of stacks and a terrain lookup is not a cost worth being clever about.
 */
function clearTheIce(world: World): void {
  for (const pawn of world.pawns) {
    // `round`, not `floor`: a cell is centred on its integer coordinate and runs
    // half a unit either side of it, which is the convention the collision capsule
    // and the terrain mesh both use. Flooring reads a body standing at 41.6 — the
    // dry side of the shore, in cell 42 — as being in cell 41, and hauls a settler
    // out of a perfectly good beach into the lake it is standing beside.
    const x = Math.round(pawn.x);
    const y = Math.round(pawn.y);
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    if (terrainAt(world, x, y) !== 'water') continue;
    const bank = nearestBank(world, x, y);
    if (!bank) continue;
    pawn.x = bank.x;
    pawn.y = bank.y;
    pawn.path = null;
    // A body washes up and is buried from the beach; only the living get the
    // rest of it.
    if (pawn.dead) continue;
    // A soaking in a lake that was ice an hour ago is not a scratch, and the flu
    // is the illness this game already has for being cold and wet. `afflict`
    // declines quietly for a raider, which is the right answer too: they came a
    // long way to be here and going through the ice is its own punishment. Told
    // not to announce itself, because the line below says where the flu came
    // from and "someone has come down with flu" on its own does not.
    afflict(world, pawn, 'flu', false);
    // Only the colony's own get a line. A hare that grazed out onto the lake in
    // January and goes in at the thaw is a thing that happens, and a herd of them
    // is six identical lines about animals the player has never met. The log is
    // where a colony's decisions live, not a nature documentary.
    if (pawn.faction !== 'colony' && pawn.tame !== true) continue;
    msg(world, `${pawn.name} goes through the ice and scrambles for the bank.`, 'bad');
  }

  for (const stack of world.items) {
    if (stack.carriedBy !== null) continue;
    if (stack.x < 0 || stack.y < 0 || stack.x >= world.width || stack.y >= world.height) continue;
    if (terrainAt(world, stack.x, stack.y) !== 'water') continue;
    const bank = nearestBank(world, stack.x, stack.y);
    if (!bank) continue;
    stack.x = bank.x;
    stack.y = bank.y;
  }
}

/**
 * The closest dry, empty cell to somewhere in the lake.
 *
 * Terrain and the building index only — no `grid` import, and that is on purpose:
 * `grid` asks *this* module whether the water is solid today, and a cycle between
 * the two would be a genuine one rather than a tidy-up. Skipping every cell with
 * anything built on it is stricter than `isSolid` and cannot be wrong: the worst
 * it does is walk somebody one cell further onto the beach.
 */
function nearestBank(world: World, sx: number, sy: number): { x: number; y: number } | null {
  for (let r = 1; r < 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
        const t = terrainAt(world, x, y);
        if (t === 'water' || t === 'rock') continue;
        if (world.cellBuilding[y * world.width + x]! >= 0) continue;
        return { x, y };
      }
    }
  }
  return null;
}
