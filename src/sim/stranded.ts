/**
 * Work nobody can get to.
 *
 * A blueprint is only ever picked up by a settler who can walk to it, which is
 * the right rule and has a hole in it: a plan on the far side of a lake is not
 * refused, it is skipped, for ever. Nothing tells the player, nothing cleans it
 * up, and the colony's own foreman — which waits for a clear board before it
 * proposes anything — never speaks again. On seed 7 that was two fence posts in a
 * pocket of rock on day eight; the colony banked three hundred wood and three
 * hundred steel and built nothing at all for the remaining twenty-two days.
 *
 * So the colony notices. Anything marked that no living settler can reach is
 * called off through the same door the cancel tool uses, with the materials
 * already hauled into it handed back, and the player is told once.
 *
 * Three things keep it from eating work that was fine:
 *
 *   - **It asks everybody.** One settler shut in a room is not a stranded plan;
 *     the whole colony being unable to reach it is.
 *   - **It asks about the map the colony is going to have.** See `reachWhenDone`
 *     below — this is the part that is easy to get wrong and expensive when you
 *     do.
 *   - **It asks twice.** A plan has to still be unreachable on the next pass,
 *     which is a quarter-minute later, before anything is cancelled. Reachability
 *     is structural rather than momentary, so this rarely changes the answer —
 *     but the one time it does is a wall the player wanted, and giving that back
 *     is worth a pass of patience.
 */

import { defOf } from './buildings';
import { wouldSealColony } from './connectivity';
import { NEIGHBOURS_8, adjacentStandCells, canStep, isWalkable } from './grid';
import { cancelAt, placeBlueprint } from './orders';
import { hostiles, livingColonists, msg } from './world';
import { DESIG_NONE, inBounds, type BuildingKind, type World } from './types';

/** How often the colony looks over what it has marked. Slow: this is tidying. */
export const STRANDED_INTERVAL = 300;

/**
 * Everywhere the colony could stand if it finished what it has already marked.
 *
 * The obvious question — "can somebody walk there right now" — is the wrong one,
 * and answering it wrecked seed 99001's kitchen. Marked work *changes the map*: a
 * five-deep mining shaft is four cells the colony cannot reach until it has dug
 * the first, and when the walls close round the stove the connectivity watchdog
 * opens a way by marking the wall for demolition — cells that are, by definition,
 * on the far side of the wall. Reaping by present reachability cancels both, the
 * watchdog re-marks them the next time it looks, and the two spend the rest of
 * the game undoing each other while the colony stops eating.
 *
 * So the flood treats a marked cell as passable. A plan is stranded only when the
 * colony could not get to it *even after doing everything else it has planned*,
 * which is the honest reading of "nobody can reach this" and is stable under the
 * watchdog: whatever it marks is by construction a way through.
 */
function reachWhenDone(world: World): Uint8Array {
  const w = world.width;
  const seen = new Uint8Array(w * world.height);
  const stack: number[] = [];

  for (const p of livingColonists(world)) {
    if (p.downed) continue;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (!inBounds(world, x, y)) continue;
    const i = y * w + x;
    if (seen[i]) continue;
    seen[i] = 1;
    stack.push(i);
  }

  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of NEIGHBOURS_8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(world, nx, ny)) continue;
      const j = ny * w + nx;
      if (seen[j]) continue;
      const open = isWalkable(world, nx, ny);
      if (!open && world.cellDesig[j] === DESIG_NONE) continue;
      // Looser than `canStep` only where the looseness is earned. Stepping into
      // marked work is a guess about a map that does not exist yet, and the guess
      // is deliberately generous. Stepping between two cells the colony can
      // already walk is not a guess at all, and the pathfinder's answer is the
      // only correct one: it refuses to cut the corner between two walls, so a
      // diagonal gap that looks open from above is not a route.
      //
      // Being generous here is not the safe direction it reads as. Seed 7 marked
      // two fence posts in a pocket whose only link to the yard was one such
      // corner; the fill walked straight through it, the posts were never even
      // suspected, and the colony banked three hundred steel and built nothing
      // for the remaining twenty-two days. A plan left alone for ever is the
      // exact failure this module exists to prevent.
      if (open && isWalkable(world, x, y) && !canStep(world, x, y, nx, ny)) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }

  return seen;
}

/**
 * Can a settler get to this square to work on it?
 *
 * Returns a predicate rather than an answer because the flood behind it costs one
 * pass over the map: ask it once, then ask the predicate about every cell you are
 * considering. Reachable, or workable from somewhere reachable —
 * `adjacentStandCells` is where the job system keeps that rule, corner rule and
 * all, and asking it rather than the eight raw neighbours matters: a square
 * touching the yard only across a blocked diagonal is a square no settler can
 * work from.
 *
 * With nobody left standing there is no honest answer, so it says yes. A colony
 * flat on its back during a raid should come round to the plans it had, not to a
 * board wiped clean because the flood had nowhere to start.
 */
export function workReach(world: World): (x: number, y: number) => boolean {
  if (livingColonists(world).every((p) => p.downed)) return () => true;
  const seen = reachWhenDone(world);
  return (x, y) => {
    if (!inBounds(world, x, y)) return false;
    if (seen[y * world.width + x]) return true;
    return adjacentStandCells(world, x, y).some((c) => seen[c.y * world.width + c.x] === 1);
  };
}

/**
 * `placeBlueprint` for the colony's own planners, which are not the player.
 *
 * A player may plan a wall across the lake and mean it; the reaper gives them two
 * sweeps and a sentence before it tidies up. A planner that does the same thing is
 * not expressing intent, it is proposing work nobody can do — and it will propose
 * it again the moment the reaper takes it away. Seed 20260729 spent twenty days
 * that way, a fence post and a sandbag placed and called off seventy-four times
 * between them, while the Steward's one-project-at-a-time rule meant nothing else
 * was ever proposed at all.
 *
 * So the planners ask the same question the reaper asks. Nothing is lost by
 * asking: anything this refuses is something the reaper would have taken back two
 * sweeps later regardless.
 *
 * And one question the reaper cannot ask, because by the time it could the wall is
 * already up: does this shut us in? A planner has no business building the last
 * segment of a box around its own colony, and unlike the wall across the lake
 * there is no reading of it that was intended.
 */
export function planBlueprint(world: World, kind: BuildingKind, x: number, y: number): boolean {
  if (!workReach(world)(x, y)) return false;
  if (defOf(kind).solid && wouldSealColony(world, x, y)) return false;
  return placeBlueprint(world, kind, x, y);
}

/**
 * One sweep.
 *
 * `world.stranded` carries the previous sweep's suspects between passes — packed
 * cells, so a blueprint and a designation on the same square are the same
 * suspect, which is what the player sees anyway. It is left on the world rather
 * than kept module-side because two colonies in one process must not share it,
 * and because a save reloaded mid-suspicion should start the count again rather
 * than reap on its first pass.
 */
export function tickStranded(world: World): void {
  if (world.gameOver) return;
  if (world.tick % STRANDED_INTERVAL !== 0) return;
  // Nobody left to be stranded from, and no sense reaping a colony's plans while
  // it is being overrun: the settlers are wherever the fight put them and the
  // walls are moving, which is the one time the answer really is momentary.
  if (livingColonists(world).length === 0) return;
  if (hostiles(world).length > 0) return;

  // The same question the planners ask before they propose anything, which is
  // what keeps the two from undoing each other. It also answers "yes" when every
  // settler is down: a colony that cannot stand up is not a colony whose plans
  // are unreachable, and reaping the entire board while it lies there would be a
  // strange way to say so.
  const canGet = workReach(world);
  const suspects: number[] = [];
  const prev = world.stranded ?? [];
  let reaped = 0;
  let where: { x: number; y: number } | null = null;

  const consider = (x: number, y: number): void => {
    if (canGet(x, y)) return;
    const cell = y * world.width + x;
    if (prev.includes(cell)) {
      if (cancelAt(world, x, y)) {
        reaped++;
        where ??= { x, y };
      }
      return;
    }
    suspects.push(cell);
  };

  // A copy, because reaping removes from the list being walked — and a filtered
  // one, because the list is mostly trees and none of them are plans.
  for (const b of world.buildings.filter((b) => !b.built)) consider(b.x, b.y);
  for (let i = 0; i < world.cellDesig.length; i++) {
    if (world.cellDesig[i] === DESIG_NONE) continue;
    const x = i % world.width;
    consider(x, (i - x) / world.width);
  }

  world.stranded = suspects;
  if (reaped > 0 && where) {
    // A card rather than a line in the log, and a card carrying the spot, which
    // makes it a button that flies the camera there. This is the colony undoing
    // something the player asked for: seven lines of rolling log is exactly how
    // that gets missed and comes back as "the game deleted my wall". Rare enough
    // to afford the card — the planners no longer propose work they cannot reach,
    // so what is left here is nearly all somebody's own plan. The first one reaped
    // is the one worth landing on; they are all in the same pocket, because that
    // is what being unreachable together means.
    msg(
      world,
      reaped === 1
        ? 'A plan nobody can reach is called off.'
        : `${reaped} plans nobody can reach are called off.`,
      'info',
      { at: where, headline: true },
    );
  }
}
