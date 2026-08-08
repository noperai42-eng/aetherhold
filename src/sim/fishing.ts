/**
 * The lake is food.
 *
 * Worldgen has always put a body of water on the map, and until now the only
 * things it did were get in the way and, for six days a year, stop getting in the
 * way. This is the third thing it does: a plank stage on the shore, somebody
 * standing on it with a line, and raw food coming out of the water in a month
 * when nothing is coming out of the ground.
 *
 * That is the whole reason it is here. Winter in this valley is a food problem —
 * the crops stop, the stores run down, and the only answers were "have hunted
 * enough in autumn" and "have built a freezer". Both of those are decisions made
 * in a different season by a player who already knew what was coming. Fishing is
 * an answer you can reach for *during* the emergency, which is what makes a hard
 * winter survivable rather than merely lost in advance.
 *
 * Three things keep it from being a food printer.
 *
 * **The lake runs out.** One stock for the whole body of water, 1 full to 0
 * emptied, drawn down by every catch and growing back slowly. Six stages on the
 * shore do not make six lakes; they make one lake emptied six times as fast. The
 * stock is the reason a player cannot simply pave the shoreline and stop farming
 * — and because it recovers, over-fishing is a mistake you can come back from
 * rather than a map you have ruined.
 *
 * **It only happens when it is needed.** Settlers fish when the larder is thin,
 * the same way they cook when it is empty. A colony with a full pantry leaves the
 * lake alone, which is what lets the stock recover, and means the fish are there
 * on the day it actually matters.
 *
 * **Winter charges for it.** Once the ice bears weight there is a foot of it in
 * the way, and a catch takes most of twice as long. The lake is still the answer
 * in January — it is just a slower one than it was in September, which is the
 * right shape for a thing you fall back on. That number is the same `iceBears`
 * the pathfinder asks, so the day the crossing opens is the day fishing gets
 * hard, and a player only has to learn one fact about the lake.
 *
 * No randomness is drawn here. The same seed fishes the same lake.
 */

import { iceBears } from './ice';
import { type World, terrainAt } from './types';
import { msg } from './world';

/** How much of the lake one catch takes. Twenty-five catches empty it. */
const CATCH_COST = 1 / 25;

/**
 * How long an emptied lake takes to come back: four game days, which is most of a
 * season. Long enough that a player who fished it flat in autumn feels it in
 * winter, and short enough that the mistake is survivable rather than permanent.
 */
const REFILL_TICKS = 4 * 4800;

/**
 * Below this the stage stops offering work, and above this it starts again.
 *
 * Two thresholds rather than one, because a single line would have the colony
 * pick up the rods on the tick the stock crossed it and put them down again on
 * the tick the catch took it back under — a settler walking to the shore and back
 * forever, and a log full of the lake changing its mind. The gap is a hysteresis
 * band and it is the same trick the ice uses between freezing and thawing.
 */
const FISHED_OUT = 0.16;
const FISH_BACK = 0.34;

/** Work in a catch on open water, before the ice and before the skill. */
export const CATCH_WORK = 190;

/**
 * What the ice costs you.
 *
 * Not a refusal: a hole through the ice is a real way to fish and the whole point
 * of the lake in winter is that it still feeds you. It is just that you have to
 * cut the hole first, and the fish under a lid are harder to find.
 */
export const ICE_WORK_SCALE = 1.85;

/** Raw food in one catch on a full lake, before the fisher's skill. */
const CATCH_YIELD = 6;

/** How much fish is in the lake, 1 full to 0 emptied. An old save has a full one. */
export function fishStock(world: World): number {
  return world.fish ?? 1;
}

/**
 * Is there anything in the lake worth walking to the shore for?
 *
 * The latch is what makes the band a band. Asking the stock alone would reopen
 * the lake the instant it crept back over the low line, where one catch costs
 * more than half a day of regrowth — so the colony would fish it under again on
 * the same trip and the player would get the bad news over and over, forever, at
 * a trickle. Shut at the low line, open at the high one, and the lake is a thing
 * that runs out and comes back rather than a thing that nags.
 */
export function lakeHasFish(world: World): boolean {
  if (world.fishOut === true) return false;
  return fishStock(world) >= FISHED_OUT;
}

/** Ticks of work in one catch for this settler, right now. */
export function catchWork(world: World): number {
  return iceBears(world) ? CATCH_WORK * ICE_WORK_SCALE : CATCH_WORK;
}

/**
 * What a catch is worth, and what it costs the lake.
 *
 * Yield falls with the stock rather than stopping at a wall, so a lake that has
 * been leaned on gives thinner and thinner returns and the player can *see* the
 * consequence in the size of the catch before the stage goes quiet. Never below
 * one: a settler who walked to the shore and worked for a minute goes home with
 * something, because a job that can complete with nothing to show for it is a job
 * the player will read as broken.
 */
export function catchYield(world: World, plants: number): number {
  const scaled = (CATCH_YIELD + plants * 0.28) * fishStock(world);
  return Math.max(1, Math.round(scaled));
}

/** Take a catch out of the lake. Called when the fish is actually landed. */
export function takeFish(world: World): void {
  const after = Math.max(0, fishStock(world) - CATCH_COST);
  world.fish = after;
  if (after < FISHED_OUT && world.fishOut !== true) {
    world.fishOut = true;
    msg(world, 'The lake is fished out. Give it a few days.', 'bad');
  }
}

/**
 * One tick of the lake growing its fish back.
 *
 * Flat rate rather than the logistic curve a real fishery has, for the same
 * reason the ice is one number: the player has to be able to hold the rule in
 * their head, and "it comes back in about four days" is a rule. A curve would be
 * more correct and would tell a player nothing they could plan with.
 */
export function tickFishing(world: World): void {
  const stock = Math.min(1, fishStock(world) + 1 / REFILL_TICKS);
  world.fish = stock;
  if (stock >= FISH_BACK && world.fishOut === true) {
    world.fishOut = false;
    msg(world, 'The fish are back in the lake.', 'good');
  }
}

/**
 * Is this cell somewhere a fishing stage could stand?
 *
 * Orthogonal neighbours only. A stage that reached diagonally past the corner of
 * a headland would be a settler casting a line over dry land, which reads as a
 * bug from any camera angle — and the four-way test is the same one the shoreline
 * sand ring is built with, so the two agree about where the water's edge is.
 */
export function onShore(world: World, x: number, y: number): boolean {
  // The column guard is not decoration. `terrainAt` indexes a flat array without
  // bounds-checking, so asking for x − 1 in column 0 answers with the last cell of
  // the row above — a stage on the west edge of the map would read the water on
  // the *east* edge as its own shoreline and let a settler fish out of a field.
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
    if (terrainAt(world, nx, ny) === 'water') return true;
  }
  return false;
}
