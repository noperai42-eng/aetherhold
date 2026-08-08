/**
 * The connectivity watchdog — nobody gets walled in.
 *
 * A colony sim that lets you build walls is a colony sim that lets you build a
 * wall in the wrong place, and the failure does not look like a pathing bug. It
 * looks like starvation. On seed 99001 a sandbag went up outside the cabin's
 * only door on day eighteen; two settlers were indoors with the stove, the beds
 * and forty meals, six were out in the yard, and for the remaining twelve days
 * the six ate scraps off the ground and broke down one after another while the
 * pantry sat eight metres away behind a wall. Every subsystem behaved correctly.
 * The cooks would not cook because the colony's meal count was satisfied. The
 * builders would not build because the frames were on the far side. Nothing
 * anywhere was in a position to say the obvious thing, which is that the map had
 * come apart.
 *
 * `wouldBlockDoorway` stops the specific mistake that caused it. This is the
 * general answer: whatever the cause — a player's wall, a burnt-out ruin, a rock
 * face mined into a dead end — if the settlers end up in more than one place,
 * something gets taken down until they are back in one. It is a repair, not a
 * restriction: the colony may still wall itself in as thoroughly as it likes, so
 * long as it stays on one side of the wall.
 *
 * Cheap enough to run often, because it does no searching of its own — the
 * region index is already maintained for the job assignment pass, so "are these
 * two settlers in the same world" is two array reads.
 */

import { defOf, isBed } from './buildings';
import { NEIGHBOURS_4, NEIGHBOURS_8, adjacentStandCells, buildingAt, canStep } from './grid';
import { regionAt, regionIndex } from './regions';
import type { Building, Pawn, World } from './types';
import { DESIG_DECONSTRUCT, DESIG_HARVEST, DESIG_NONE, inBounds, packCell, terrainAt } from './types';
import { hostiles, livingColonists, msg } from './world';

/**
 * Ticks between checks — twenty seconds of game time.
 *
 * Long enough that the scan is free even on a bad frame, short enough that a
 * settler shut in by a stray wall is on the wrong side of it for one message and
 * not for a day. The repair itself takes as long as it takes: a settler still has
 * to walk over and pull the wall down.
 */
export const CONNECTIVITY_INTERVAL = 200;

/** Everyone the colony would have to leave behind, grouped by where they are. */
function groupByRegion(world: World): Map<number, Pawn[]> {
  const groups = new Map<number, Pawn[]>();
  for (const p of livingColonists(world)) {
    const r = regionAt(world, Math.round(p.x), Math.round(p.y));
    // -1 means the settler is standing somewhere nothing can stand — mid-spawn,
    // or a wall just went up under them. The build pass shoves them clear on the
    // same tick, so there is nothing to diagnose here.
    if (r < 0) continue;
    const list = groups.get(r);
    if (list) list.push(p);
    else groups.set(r, [p]);
  }
  return groups;
}

/** Can a settler take this apart, and what do you call the order? */
function removalDesig(world: World, x: number, y: number): number {
  const b = buildingAt(world, x, y);
  if (b && b.built) {
    if (!defOf(b.kind).solid) return DESIG_NONE;
    // Trees are chopped, not deconstructed — same result, different verb, and
    // `designate` refuses the wrong one.
    return b.kind === 'tree' ? DESIG_HARVEST : DESIG_DECONSTRUCT;
  }
  if (b) return DESIG_NONE;
  return terrainAt(world, x, y) === 'rock' ? DESIG_HARVEST : DESIG_NONE;
}

/**
 * Mark one thing for removal that gets the two halves closer to each other.
 *
 * Preference goes to anything touching both sides at once, because taking that
 * down finishes the job in a single order. Failing that — a wall two courses
 * thick, a mined-out rock face — take the piece of the boundary nearest to the
 * people on the other side and let the next pass, twenty seconds from now, take
 * the next one. It digs through in layers rather than solving it in one go, which
 * is both simpler than a weighted search and closer to what it looks like from
 * the outside: settlers working at a wall until it opens.
 */
function openTheWay(world: World, stranded: number, main: number, toward: Pawn): boolean {
  const index = regionIndex(world);
  const w = world.width;
  let bestJoin: { x: number; y: number; d: number } | null = null;
  let bestEdge: { x: number; y: number; d: number } | null = null;

  for (let i = 0; i < index.cellRegion.length; i++) {
    if (index.cellRegion[i] !== stranded) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of NEIGHBOURS_4) {
      const bx = x + dx;
      const by = y + dy;
      if (!inBounds(world, bx, by)) continue;
      if (world.cellDesig[packCell(world, bx, by)] !== DESIG_NONE) continue;
      if (removalDesig(world, bx, by) === DESIG_NONE) continue;
      const d = (bx - toward.x) ** 2 + (by - toward.y) ** 2;
      // Does the far side start on the other face of this one obstacle?
      let joins = false;
      for (const [ex, ey] of NEIGHBOURS_4) {
        const nx = bx + ex;
        const ny = by + ey;
        if (!inBounds(world, nx, ny)) continue;
        if (index.cellRegion[ny * w + nx] === main) joins = true;
      }
      if (joins) {
        if (!bestJoin || d < bestJoin.d) bestJoin = { x: bx, y: by, d };
      } else if (!bestEdge || d < bestEdge.d) {
        bestEdge = { x: bx, y: by, d };
      }
    }
  }

  const pick = bestJoin ?? bestEdge;
  if (!pick) return false;
  world.cellDesig[packCell(world, pick.x, pick.y)] = removalDesig(world, pick.x, pick.y);
  return true;
}

/** Where a settler has to stand to use this — the region a job would path to. */
function accessRegion(world: World, b: Building): number {
  for (const c of adjacentStandCells(world, b.x, b.y)) {
    const r = regionAt(world, c.x, c.y);
    if (r >= 0) return r;
  }
  return -1;
}

/**
 * The other half of the same bug: everybody together, and the stove behind the
 * wall.
 *
 * The settlers being in one piece is not the same as the colony being whole. On
 * seed 99001 the split was two people from six; the shape that costs a run just
 * as reliably is all eight of them outside with the cooking and the beds sealed
 * in. Nothing complains, because every subsystem is behaving: there is simply no
 * reachable stove, so no cook job is ever offered, so the colony quietly stops
 * eating hot food and sleeping indoors and nobody is told why.
 *
 * The rule is per *category*, not per building, which is what keeps it from
 * knocking walls down over nothing. One bed stranded in a half-finished wing is
 * the player's business — they have four others. Every bed on the far side of a
 * wall is an emergency, and so is every stove.
 */
function keepEssentialsReachable(world: World, main: number, toward: Pawn): void {
  const kinds: Array<{ label: string; has: (b: Building) => boolean }> = [
    { label: 'The stove is', has: (b) => b.kind === 'stove' },
    { label: 'The beds are', has: (b) => isBed(b.kind) },
  ];
  for (const { label, has } of kinds) {
    let stranded: Building | null = null;
    let strandedRegion = -1;
    let reachable = false;
    for (const b of world.buildings) {
      if (!b.built || !has(b)) continue;
      const r = accessRegion(world, b);
      if (r === main) {
        reachable = true;
        break;
      }
      // Nearest to the colony, so the hole gets punched at the short crossing.
      if (r < 0) continue;
      const d = (b.x - toward.x) ** 2 + (b.y - toward.y) ** 2;
      if (!stranded || d < (stranded.x - toward.x) ** 2 + (stranded.y - toward.y) ** 2) {
        stranded = b;
        strandedRegion = r;
      }
    }
    if (reachable || !stranded) continue;
    if (!openTheWay(world, strandedRegion, main, toward)) continue;
    msg(world, `${label} walled off from the colony — opening a way through.`, 'bad');
  }
}

/**
 * The colony has to end up on the big side of its own walls.
 *
 * The third shape of the same bug, and the one the two rules above cannot see. On
 * seed 424242 all five settlers were together, with the stove, the beds and a
 * fortnight of food — and a fence ring around the lot of them with no way out.
 * Everybody was fine. Everybody was also in a two-hundred-cell box while the
 * steel, the woodpile, the farm and seven thousand cells of map sat outside it.
 * The colony cooked, researched, ate its stores and built nothing at all for
 * nineteen days, and every check in this file said it was healthy, because by the
 * only questions being asked it was.
 *
 * So there is a third question: is what the colony can walk most of what there is
 * to walk? A wall that costs the settlers more than half their world is not a
 * wall anybody meant to build.
 *
 * Not while there are hostiles on the map. Shutting the gate and sitting behind it
 * is a real answer to a raid, and knocking a hole in your own wall halfway through
 * one is the last thing the colony wants help with.
 */
function keepColonyOnTheMap(world: World, main: number, toward: Pawn): void {
  if (hostiles(world).length > 0) return;
  const index = regionIndex(world);
  const here = index.sizes[main] ?? 0;
  if (here * 2 >= index.walkable) return;

  let out = -1;
  let outSize = 0;
  for (let r = 0; r < index.sizes.length; r++) {
    const n = index.sizes[r] ?? 0;
    if (r !== main && n > outSize) {
      out = r;
      outSize = n;
    }
  }
  if (out < 0) return;
  if (!openTheWay(world, main, out, toward)) return;
  msg(world, 'The colony is sealed in — opening a way out.', 'bad');
}

/**
 * Would putting something solid here shut the colony in?
 *
 * The general form of `wouldBlockDoorway`, for callers that can afford it. That
 * one is a cell test because the build tool's drag preview runs it four hundred
 * times a frame; it can only see the mistake when there is a door to hang it on,
 * and on seed 424242 there was not — the fence ring was laid with three-cell
 * gates in it, the defence planner put its sandbag line one row further out, and
 * every way through a gate became a diagonal between a fence and a sandbag, which
 * the pathfinder refuses to cut. Two sensible builds, no door anywhere near
 * either, and the colony was in a box.
 *
 * This asks the real question instead: flood the map from the settlers with the
 * new cell counted as solid, and see how much of their world is left. It costs one
 * pass over the grid, which is why it is not on the preview path — the colony's own
 * planners place a handful of things a minute and can well afford it.
 */
export function wouldSealColony(world: World, x: number, y: number): boolean {
  const standing = livingColonists(world).filter((p) => !p.downed);
  if (standing.length === 0) return false;

  const index = regionIndex(world);
  const homes = new Set<number>();
  for (const p of standing) {
    const r = regionAt(world, Math.round(p.x), Math.round(p.y));
    if (r >= 0) homes.add(r);
  }
  if (homes.size === 0) return false;
  let before = 0;
  for (const r of homes) before += index.sizes[r] ?? 0;

  const w = world.width;
  const seen = new Uint8Array(index.cellRegion.length);
  const stack: number[] = [];
  for (const p of standing) {
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (!inBounds(world, px, py)) continue;
    if (px === x && py === y) continue;
    const i = py * w + px;
    if (seen[i] || index.cellRegion[i]! < 0) continue;
    seen[i] = 1;
    stack.push(i);
  }

  let after = 0;
  while (stack.length > 0) {
    const i = stack.pop()!;
    after++;
    const cx = i % w;
    const cy = (i - cx) / w;
    for (const [dx, dy] of NEIGHBOURS_8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(world, nx, ny)) continue;
      const j = ny * w + nx;
      if (seen[j]) continue;
      if (nx === x && ny === y) continue;
      if (!canStep(world, cx, cy, nx, ny)) continue;
      // The corner rule once more, counting the cell that does not exist yet: a
      // diagonal past the new wall is exactly the step the fence-and-sandbag gate
      // lost, and missing it here would miss the whole bug.
      if (dx !== 0 && dy !== 0 && ((cx + dx === x && cy === y) || (cx === x && cy + dy === y))) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }

  return after * 2 < before;
}

/**
 * Are the settlers all in one place, and if not, start opening a way through.
 *
 * The biggest group is treated as the colony and everyone else as cut off, which
 * is right for the case that matters — two people shut in a cabin, six outside —
 * and harmless for the case that does not, since the repair is symmetrical: the
 * wall comes down either way.
 */
export function tickConnectivity(world: World): void {
  if (world.tick % CONNECTIVITY_INTERVAL !== 0) return;
  const groups = groupByRegion(world);
  if (groups.size === 0) return;

  let main = -1;
  let mainSize = 0;
  for (const [region, pawns] of groups) {
    if (pawns.length > mainSize) {
      main = region;
      mainSize = pawns.length;
    }
  }

  keepEssentialsReachable(world, main, groups.get(main)![0]!);
  if (groups.size < 2) {
    // Only once they are in one piece. While the colony is in two, "is the colony
    // on the big side of the map" has no well-posed answer — `main` is just the
    // larger pocket — and the repair below may reconnect the lot anyway. Two walls
    // coming down at once for what is one problem helps nobody.
    keepColonyOnTheMap(world, main, groups.get(main)![0]!);
    return;
  }

  for (const [region, pawns] of groups) {
    if (region === main) continue;
    // Toward the nearest of the people they have been separated from, so the
    // hole gets punched where the two groups are closest rather than wherever
    // the cell scan happened to reach first.
    const here = pawns[0]!;
    let toward = groups.get(main)![0]!;
    for (const p of groups.get(main)!) {
      if ((p.x - here.x) ** 2 + (p.y - here.y) ** 2 < (toward.x - here.x) ** 2 + (toward.y - here.y) ** 2) {
        toward = p;
      }
    }
    if (!openTheWay(world, region, main, toward)) continue;
    const who = pawns.length === 1 ? pawns[0]!.name : `${pawns.length} settlers`;
    msg(world, `${who} walled off from the colony — opening a way through.`, 'bad');
  }
}
