/**
 * What the colony has actually laid eyes on.
 *
 * The map is 192×192 — thirty-seven thousand cells — and the colony lands on about
 * eighty of them. Every one of the rest was fully drawn from the first frame, which
 * quietly cost the game two things. The obvious one is a reason to walk: the
 * scouting loop in `scout.ts` sends settlers out to sites that were already
 * visible as pins, so the walk paid in resources and never in *knowing*
 * anything. The subtler one is scale. A map you can read at a glance is a board;
 * a map that ends in haze a dozen cells past the fence is a place you are
 * standing in, and the difference is most of what makes the far corners worth
 * anything.
 *
 * So: `world.seen` is one flag per cell, and it only ever goes up. Nothing here
 * re-hides ground. A shroud that closes back in behind a settler would be
 * correct for a real-time-strategy fog and wrong for this game — the manager
 * view is a map of a place the colony lives in, not a radar sweep, and a base
 * that vanished the moment nobody stood in it would be unplayable rather than
 * tense.
 *
 * The rule this obeys is the one the whole build runs on: what you can see is
 * what is there. So this decides *visibility only*. It never touches whether a
 * site has been surveyed (`Site.found`, which a scout has to earn by walking
 * onto it and reading it), it never restricts pathing, and it never gates the
 * colony's own work board. Sight and knowledge are different things, and the
 * cache buried under a cairn stays buried until somebody digs it up, however
 * clearly the cairn can be seen from the wall.
 *
 * Not one function here draws a random number. That is deliberate and it is a
 * contract: this pass runs on every tick of every seed, and a single draw from a
 * shared stream would re-roll every seed-tuned balance test in the suite.
 */

import { msg } from './world';
import { inBounds, packCell } from './types';
import type { World } from './types';

/**
 * How far a settler sees, in cells.
 *
 * Nine rather than the five or six that would read as "an arm's length" for one
 * reason: the first-person camera stands inside this radius. At six the haze is
 * a wall you keep walking into; at nine it sits about where the weather fog
 * already puts the far plane, so the two agree and the edge of the known world
 * looks like weather rather than like a missing chunk of level.
 */
export const SIGHT = 9;

/**
 * What the colony can see from its own yard on the morning it lands.
 *
 * Wider than a settler's own sight on purpose. A colony that has to grope its
 * way out of its own front door starts the game unable to see the trees it is
 * about to be told to chop, and the opening minutes are the worst possible
 * place to spend a player's patience.
 */
const HOME_SIGHT = 16;

/** A standing structure keeps its own surroundings on the map. */
const BUILDING_SIGHT = 5;

/**
 * The seen flags, made on first use.
 *
 * Lazy rather than built at worldgen, because that is what makes this land on a
 * colony that is already in progress. A save written before any of this existed
 * has no flags at all; it gets them here, on its first tick after loading, lit
 * around exactly the settlers and buildings it already has — so somebody who
 * has played five days opens the game to their own base on the map and haze
 * where they have genuinely never been, rather than to a black screen or to a
 * fully-drawn map that never darkens.
 */
export function ensureSeen(world: World): number[] {
  const cells = world.width * world.height;
  const existing = world.seen;
  if (existing && existing.length === cells) return existing;

  const seen = new Array<number>(cells).fill(0);
  world.seen = seen;
  for (const p of world.pawns) {
    if (p.dead || p.faction !== 'colony') continue;
    mark(world, seen, p.x, p.y, HOME_SIGHT);
  }
  for (const b of world.buildings) {
    // `built && not a tree` is this codebase's phrase for "something the colony
    // put there" — trees are buildings too, and every one of the several hundred
    // scattered across the valley would otherwise light its own clearing and
    // hand over the entire map before the first tick.
    if (!b.built || b.kind === 'tree') continue;
    mark(world, seen, b.x, b.y, BUILDING_SIGHT);
  }
  world.stats.explored = count(seen);
  // Everything already in the open is marked here, silently. This is the one
  // place that can tell "the colony can see it" from "the colony has just found
  // it", because it is the only pass that knows the map was dark a moment ago
  // for bookkeeping reasons rather than because nobody had walked there. Without
  // it, a five-day-old save would open with eight letters announcing the cairns
  // its settlers have been walking past since Tuesday.
  for (const site of world.sites) {
    if (seen[packCell(world, site.x, site.y)] === 1) site.sighted = true;
  }
  return seen;
}

/** Has the colony ever had eyes on this cell? Out of bounds reads as unseen. */
export function isSeen(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return false;
  const seen = world.seen;
  if (!seen) return false;
  return seen[packCell(world, x, y)] === 1;
}

/** Cells on the map, seen or not. */
export function exploredCells(world: World): number {
  return world.stats.explored ?? 0;
}

/** 0..1. What the HUD shows and what a milestone could be measured against. */
export function exploredFraction(world: World): number {
  const cells = world.width * world.height;
  return cells === 0 ? 0 : exploredCells(world) / cells;
}

/**
 * Put a disc of ground on the map. Returns how many cells were new, so a caller
 * can tell "walked somewhere" apart from "walked somewhere for the first time".
 */
export function revealAround(world: World, x: number, y: number, radius: number): number {
  const seen = ensureSeen(world);
  const found = mark(world, seen, x, y, radius);
  if (found > 0) {
    world.stats.explored = (world.stats.explored ?? 0) + found;
    announceSites(world);
  }
  return found;
}

/**
 * One tick of looking around.
 *
 * Every person in the colony counts — settlers, the possessed body, the drafted
 * and the downed. Livestock deliberately do not: a penned goat is still `fauna`
 * rather than `colony` (see `Pawn.tame`), and a herd that lit its own patch of
 * map would hand the player ground nobody walked to. The cost is a disc per
 * person per tick, a couple of thousand byte writes on a full colony, which is
 * cheaper than the bookkeeping it would take to avoid it.
 *
 * The counter is only touched when a cell actually flips, which is what lets the
 * renderer treat `stats.explored` as a change signal and skip the shroud
 * entirely on the overwhelming majority of frames, when nobody has discovered
 * anything.
 */
export function tickExplore(world: World): void {
  const seen = ensureSeen(world);
  let found = 0;
  for (const p of world.pawns) {
    if (p.dead || p.faction !== 'colony') continue;
    found += mark(world, seen, p.x, p.y, SIGHT);
  }
  if (found === 0) return;
  world.stats.explored = (world.stats.explored ?? 0) + found;
  announceSites(world);
}

/**
 * A line in the log the first time a landmark comes into view.
 *
 * Called from both of the places that put ground on the map, and gated on the
 * site's own flag rather than on who revealed it, so a landmark uncovered by a
 * new watchpost announces itself exactly like one a settler walked up to.
 *
 * This is the payoff for walking, and it is deliberately about *seeing* rather
 * than about finding: the message says a thing is standing out there and where,
 * and the scout still has to go and read it. Whatever was already in the open
 * was marked silently by `ensureSeen`, so everything that reaches here is
 * genuinely news.
 */
function announceSites(world: World): void {
  for (const site of world.sites) {
    if (site.sighted) continue;
    if (!isSeen(world, site.x, site.y)) continue;
    site.sighted = true;
    msg(world, `Something is standing out ${bearing(world, site.x, site.y)}.`, 'info', {
      at: { x: site.x, y: site.y },
    });
  }
}

/** Compass words, from the middle of the map — where the colony always lands. */
function bearing(world: World, x: number, y: number): string {
  const dx = x - world.width / 2;
  const dy = y - world.height / 2;
  // A cell counts as "north" rather than "north-east" when it is well off the
  // diagonal; the threshold is a fraction of the longer leg so it holds at any
  // distance from home.
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const ns = dy < 0 ? 'north' : 'south';
  const ew = dx < 0 ? 'west' : 'east';
  if (ay > ax * 2.5) return `to the ${ns}`;
  if (ax > ay * 2.5) return `to the ${ew}`;
  return `to the ${ns}-${ew}`;
}

/** Flags a disc and returns how many of its cells had never been seen. */
function mark(world: World, seen: number[], cx: number, cy: number, radius: number): number {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(world.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(world.height - 1, Math.ceil(cy + radius));
  const rr = radius * radius;
  let found = 0;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy > rr) continue;
      const i = y * world.width + x;
      if (seen[i] === 1) continue;
      seen[i] = 1;
      found++;
    }
  }
  return found;
}

function count(seen: number[]): number {
  let n = 0;
  for (let i = 0; i < seen.length; i++) if (seen[i] === 1) n++;
  return n;
}
