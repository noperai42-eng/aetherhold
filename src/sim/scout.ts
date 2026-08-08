/**
 * Scouting: the reason to leave the yard.
 *
 * A colony that never looks past its own fence is a colony playing on twelve
 * cells. Everything it needs on day one is within a stone's throw of the door,
 * the Steward designates rock it can already see, and the other three thousand
 * cells of the map are scenery that raiders walk in across. Scouting is the loop
 * that turns the map into a place: a settler with nothing left to do at home
 * walks out to a point of interest, surveys it, and comes back with a cache to
 * haul, a seam to mine, or somebody who was not going to make it on their own.
 *
 * The finds themselves are laid down by worldgen (`placeSites`), not rolled on
 * arrival. This module owns only the three runtime questions: may they go, where
 * to, and what happens when they get there.
 */

import { isSleepHours } from './clock';
import { dist, nearestWalkable } from './grid';
import { connected } from './regions';
import { surveyScale } from './research';
import { Rng } from './rng';
import type { Pawn, Site, World } from './types';
import { DESIG_HARVEST, TICKS_PER_DAY, packCell, terrainAt } from './types';
import { addItem, hostiles, msg } from './world';
import { makePawn } from './worldgen';
import { remember, rememberFirst } from './lifelog';

/**
 * Ticks of standing and searching once a settler reaches a site.
 *
 * Long enough to read as work rather than a touch-and-go — the walk out is most
 * of the cost, and a survey that resolved on arrival would make the whole trip
 * feel like a teleport.
 */
const SURVEY_TICKS = 110;

/**
 * How long a scout spends reading a site, in ticks.
 *
 * A function rather than the constant it used to be, because Cartography halves
 * it: the walk out is most of the cost of scouting, and the project is meant to
 * be felt as "we already know what is out there", not as a faster walk.
 */
export function surveyTicks(world: World): number {
  return SURVEY_TICKS * surveyScale(world);
}

/**
 * The quiet a scout needs before setting out.
 *
 * Half a day, which is comfortably more than the storyteller's warning lead, so
 * nobody starts a twenty-cell walk into ground that is about to have raiders on
 * it. They still turn back if something arrives early — see `tickJob`.
 */
const SAFE_LEAD = Math.round(TICKS_PER_DAY * 0.5);

/**
 * Reserves a scout leaves home with.
 *
 * Well above the hungry/tired thresholds the need system uses, because those
 * measure "should deal with this now" for somebody standing next to the pantry.
 * A scout is measuring "will I still be on my feet when I get back", and the
 * round trip is minutes. Colonies used to lose people to exactly this gap in the
 * hauling code: sent out at 40% food, downed on the walk home.
 */
const SCOUT_FOOD = 0.55;
const SCOUT_REST = 0.45;

/**
 * Quiet between expeditions, counted from the moment one pays out.
 *
 * See `StorytellerState.nextScout` for why there is one at all. Timed off the
 * *find* rather than the departure so a trip called off by a raid costs the
 * colony nothing but the walk.
 */
export const SCOUT_COOLDOWN = Math.round(TICKS_PER_DAY * 1.25);

/** How much rock around a lode gets marked for mining when it is found. */
const LODE_CELLS = 10;
const LODE_RADIUS = 3;

/**
 * How long the colony will put up with being free to go and not going.
 *
 * Counted only in ticks it *could* have gone — daylight, no fight, cooldown
 * spent — so a fortnight under siege never earns an itch. Roughly half a day of
 * genuinely quiet afternoons, which is long enough that a busy colony still does
 * its work first and short enough that a settled one always eventually looks up.
 */
const SCOUT_ITCH = Math.round(TICKS_PER_DAY * 0.5);

/**
 * Is the colony as a whole free to send somebody — everything in
 * `scoutingAllowed` that is not about the individual?
 *
 * Split out because the itch counter has to ask the same question once per tick
 * for the colony, not once per settler, and the two must not drift: an itch that
 * ticked up during a raid would fire an expedition into it the moment it ended.
 */
export function colonyMayScout(world: World): boolean {
  if (world.gameOver) return false;
  // Nobody wanders off in the dark, and nobody wanders off with a fight on or
  // one coming: a settler caught in the open is a settler fighting alone.
  if (isSleepHours(world)) return false;
  if (world.storyteller.raidActive || hostiles(world).length > 0) return false;
  if (world.storyteller.nextThreat < SAFE_LEAD) return false;
  if (world.fires.length > 0) return false;
  if (world.storyteller.nextScout > 0) return false;
  // One party at a time. Two settlers off the map at once is two settlers who
  // are not on the wall, and it burns two finds in one afternoon.
  return !world.jobs.some((j) => j.kind === 'scout');
}

/** May this settler go looking? */
export function scoutingAllowed(world: World, pawn: Pawn): boolean {
  if (!colonyMayScout(world)) return false;
  return pawn.needs.food > SCOUT_FOOD && pawn.needs.rest > SCOUT_REST;
}

/**
 * One tick of the colony wanting to know what is out there.
 *
 * Scouting sits at the bottom of the work board on purpose, and on a board that
 * long "bottom" turned out to mean "never": a colony that is building anything
 * at all has a crate on the floor every hour of every day, and hauling is one
 * slot above scouting. Sixteen days of a real colony produced ninety-four quiet
 * moments where somebody could have walked out — and not one of them did,
 * because there was always one more crate. The map stayed scenery.
 *
 * So the board's ordering is a default, not a life sentence. Go long enough
 * without looking and the itch outranks the crate exactly once, which is all it
 * ever needs: `scoutingAllowed` bars a second party while the first is out, and
 * the cooldown on the far side of a find spaces the next one.
 */
export function tickScoutItch(world: World): void {
  const st = world.storyteller;
  if (!colonyMayScout(world)) return;
  st.scoutItch = Math.min(SCOUT_ITCH, (st.scoutItch ?? 0) + 1);
}

/** Has the colony gone too long without looking? Then scouting jumps the board. */
export function scoutOverdue(world: World): boolean {
  return (world.storyteller.scoutItch ?? 0) >= SCOUT_ITCH;
}

/** Is anyone already on their way here? */
function claimed(world: World, site: Site): boolean {
  return world.jobs.some((j) => j.kind === 'scout' && j.tx === site.x && j.ty === site.y);
}

/**
 * The nearest unfound site this settler can actually walk to.
 *
 * Nearest rather than richest: the settler does not know what is out there —
 * that is the point of going — so the only thing they can sensibly optimise is
 * the length of the walk.
 */
export function findScoutSite(world: World, pawn: Pawn): Site | null {
  const sx = Math.round(pawn.x);
  const sy = Math.round(pawn.y);
  let best: Site | null = null;
  let bestD = Infinity;
  for (const s of world.sites) {
    if (s.found) continue;
    if (claimed(world, s)) continue;
    const d = dist(pawn.x, pawn.y, s.x, s.y);
    if (d >= bestD) continue;
    // The region index answers this exactly — its fill walks by `canStep`, the
    // pathfinder's own rule, so a component is precisely the set of cells A*
    // could have reached. Asking A* instead meant a full flood of the map per
    // site per settler per work-board scan, and a site across a river fails the
    // slowest way there is: by exploring every cell before admitting it.
    if (!connected(world, sx, sy, s.x, s.y)) continue;
    best = s;
    bestD = d;
  }
  return best;
}

export function siteAt(world: World, x: number, y: number): Site | null {
  return world.sites.find((s) => s.x === x && s.y === y) ?? null;
}

/** Mark the ore around a lode for mining, and report how many cells were marked. */
function openTheSeam(world: World, site: Site): number {
  const cells: Array<{ x: number; y: number; d: number }> = [];
  for (let dy = -LODE_RADIUS; dy <= LODE_RADIUS; dy++) {
    for (let dx = -LODE_RADIUS; dx <= LODE_RADIUS; dx++) {
      const x = site.x + dx;
      const y = site.y + dy;
      if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) continue;
      if (terrainAt(world, x, y) !== 'rock') continue;
      const i = packCell(world, x, y);
      if (world.cellDesig[i] !== 0) continue;
      cells.push({ x, y, d: Math.hypot(dx, dy) });
    }
  }
  // Nearest first: a settler standing at the site should be able to start on the
  // face in front of them rather than walk round the outcrop.
  cells.sort((a, b) => a.d - b.d);
  const marked = cells.slice(0, LODE_CELLS);
  for (const c of marked) world.cellDesig[packCell(world, c.x, c.y)] = DESIG_HARVEST;
  return marked.length;
}

/**
 * Pay out a site. Called once, the tick the survey finishes.
 *
 * Every payout is deliberately something the existing job system picks up on its
 * own: a cache becomes a stack the haulers fetch, a lode becomes designations
 * the miners work, a survivor becomes a settler who walks home and takes a job.
 * Nothing here needs a new behaviour bolted onto the colony to be worth having.
 */
export function resolveSite(world: World, pawn: Pawn, site: Site): void {
  site.found = true;
  world.stats.sitesScouted++;
  world.storyteller.nextScout = SCOUT_COOLDOWN;
  // Satisfied. The itch has to re-earn itself out of quiet afternoons, or one
  // find would leave the colony permanently overdue and scouting would stop
  // being the bottom of the board at all.
  world.storyteller.scoutItch = 0;

  if (site.kind === 'cache') {
    const kind = site.resource ?? 'steel';
    const amount = site.amount ?? 30;
    if (kind === 'rawfood') world.stats.rawGathered = (world.stats.rawGathered ?? 0) + amount;
    addItem(world, kind, amount, site.x, site.y);
    msg(
      world,
      `${pawn.name} turns up a cache out east of the ridge: ${amount} ${kind}. It needs hauling home.`,
      'good',
      { at: site, headline: true },
    );
    return;
  }

  if (site.kind === 'lode') {
    const marked = openTheSeam(world, site);
    if (marked > 0) {
      msg(world, `${pawn.name} finds an ore seam — ${marked} faces marked for mining.`, 'good', {
        at: site,
        headline: true,
      });
    } else {
      // The seam was already worked out or already designated. Say so rather
      // than staying silent: a trip that found nothing is still information.
      msg(world, `${pawn.name} works the ridge over and finds nothing new in it.`, 'info');
    }
    return;
  }

  // A survivor. Deliberately not subject to the storyteller's arrival cap: that
  // number paces the settlers who wander in for free, and somebody a scout
  // walked half the map to reach is not free.
  const spot = nearestWalkable(world, site.x, site.y, 6);
  if (!spot) {
    msg(world, `${pawn.name} finds a cold camp. Whoever was here is long gone.`, 'info');
    return;
  }
  // Seeded off the site, so the same map always yields the same person.
  const rng = new Rng((world.seed ^ (site.id * 0x9e3779b9)) >>> 0);
  const found = makePawn(world, rng, 'colony', spot.x, spot.y, { weapon: 'club' });
  // Rough, but with enough left in them to walk home and eat there — a rescue
  // that starves on the way back is a worse story than no rescue.
  found.hp = Math.round(found.maxHp * 0.55);
  found.needs.food = 0.45;
  found.needs.rest = 0.4;
  // Both halves of it. Every clause here is active and agrees with a plural
  // subject, because the eulogy prints them after "They " — see `lifelog.ts`.
  // The rescuer's is capped to the first one they ever bring in; the rescued
  // one's is their origin, and a settler with no origin has no eulogy at all.
  remember(world, found, `came back half-starved from a hollow with ${pawn.name}`);
  rememberFirst(world, pawn, 'carried ', `carried ${found.name} home out of a hollow`);
  msg(
    world,
    `${pawn.name} finds ${found.name} half-starved in a hollow. They are coming back with them.`,
    'good',
    { at: spot, headline: true },
  );
}
