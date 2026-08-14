/**
 * What the colony has outstanding, and who is on it.
 *
 * The complaint this answers is that a player who plans half a dozen buildings
 * and paints a field gets no confirmation that any of it was heard: the
 * blueprints sit there as translucent frames and the plot is twelve green cells
 * with cones on them, and nothing on screen names either. Every part of it was
 * already running — worldgen lays a garden on the first tick and the crops ripen
 * in three days, measured — which is exactly the failure worth fixing, because a
 * simulation the player cannot see is worth the same as one that is not there.
 *
 * Facts only. No words: `RESOURCE_LABEL` and every sentence the player reads live
 * in `hud.ts`, and a second copy of the vocabulary down here is how the panel and
 * the inspector end up calling the same thing two different things. Read-only
 * over the world, and no three.js — this is a readout, and the moment it starts
 * deciding anything it stops being one.
 *
 * The one thing it must not do is invent an order. Construction is dispatched
 * nearest-first per settler, filtered by whether the materials for that frame
 * exist on the map (`jobs.ts`, `case 'construct'`), so there is no queue in the
 * sim to print. What there is instead is a *standing* per frame — somebody is on
 * it, it is ready and waiting for hands, it is short of something, or the colony
 * cannot supply it at all — and that is the thing a player can act on. Rows are
 * grouped by it and ordered by id within the group, which is the order the player
 * placed them.
 */

import { defOf } from '../../sim/buildings';
import { CROP_NONE, growingCells, seasonScale, soilScale } from '../../sim/farming';
import { missingResource } from '../../sim/jobs';
import { countResource, findPawn } from '../../sim/world';
import { growthMultiplier } from '../../sim/weather';
import { unpackX, unpackY, type ResourceKind, type World } from '../../sim/types';

/**
 * Why a frame is not finished yet, in the order the rows are printed.
 *
 * It runs from "this is fine" to "this needs you": a frame somebody is standing
 * at needs nothing, a frame short of steel the colony has needs only patience,
 * and a frame short of steel the colony does not have is a decision.
 */
export type Standing = 'working' | 'fetching' | 'ready' | 'short' | 'stranded';

export interface QueueRow {
  buildingId: number;
  /** The building's own name — `Wall`, `Cook stove`. */
  label: string;
  x: number;
  y: number;
  standing: Standing;
  /** The settler on it, or null when nobody has picked it up. */
  who: string | null;
  /** What it is short of. Null unless the standing is `short` or `stranded`. */
  missing: { kind: ResourceKind; amount: number; inStore: number } | null;
  /** What the settler on it is carrying to it. Null unless `fetching`. */
  fetching: ResourceKind | null;
  /** Work done, 0..1. A frame nobody has touched is 0 and still worth a bar. */
  progress: number;
}

const STANDING_ORDER: Standing[] = ['working', 'fetching', 'ready', 'short', 'stranded'];

/**
 * Every blueprint on the map, with the settler on it and what it is waiting for.
 *
 * `stranded` is the row worth the extra work: a frame short of steel reads
 * identically to a frame short of steel *nobody can supply*, and only the second
 * one is the player's problem. It is decided on the colony's stock rather than on
 * reachability, because a settler is dispatched to a frame only when there is a
 * stack of the missing resource it can walk to — so "there is none at all" is the
 * honest, cheap version of the same question, and the expensive version would be
 * a pathfind per frame per frame of video.
 */
export function buildQueue(world: World): QueueRow[] {
  const rows: QueueRow[] = [];
  for (const b of world.buildings) {
    if (b.built) continue;
    const job = world.jobs.find(
      (j) => j.buildingId === b.id && (j.kind === 'build' || j.kind === 'haulToBlueprint'),
    );
    const who = job ? (findPawn(world, job.pawnId)?.name ?? null) : null;
    const missing = missingResource(b);
    // `workLeft` is the total, not the remainder — see `Building`. Guarded
    // because a zero-work building would put the bar at NaN rather than at full.
    const progress = b.workLeft > 0 ? Math.max(0, Math.min(1, b.work / b.workLeft)) : 1;

    let standing: Standing = 'ready';
    if (job) standing = job.kind === 'build' ? 'working' : 'fetching';
    else if (missing) standing = countResource(world, missing.kind) > 0 ? 'short' : 'stranded';

    rows.push({
      buildingId: b.id,
      label: defOf(b.kind).label,
      x: b.x,
      y: b.y,
      standing,
      who,
      missing:
        missing && (standing === 'short' || standing === 'stranded')
          ? { ...missing, inStore: countResource(world, missing.kind) }
          : null,
      fetching: standing === 'fetching' ? (job?.resource ?? null) : null,
      progress,
    });
  }
  rows.sort(
    (a, b) =>
      STANDING_ORDER.indexOf(a.standing) - STANDING_ORDER.indexOf(b.standing) ||
      a.buildingId - b.buildingId,
  );
  return rows;
}

export interface PlotStatus {
  /** Cells inside a growing zone. */
  cells: number;
  /** Of those, how many have something planted in them. */
  sown: number;
  /** Of those, how many are ready to pull. */
  ripe: number;
  /** The fullest crop on the plot, 0..1 — what the next harvest is waiting on. */
  best: number;
  /** Live sowing and harvesting jobs. */
  hands: number;
  /**
   * How fast the plot is growing right now against its own best, 0..1.
   *
   * Soil times season times weather, averaged over the sown cells. Zero is the
   * reading that matters: a winter plot does not creep along, it stops, and a
   * player staring at a field that has not moved in a week is owed the reason.
   */
  rate: number;
  /**
   * The season's own share of that rate, averaged the same way.
   *
   * Broken out because it is the term that goes to zero — measured, not
   * assumed: `seasonScale` falls from 1 to 0 across two days around the frost
   * and stays there for a week — and "it is winter" is a different sentence to
   * the player than "it is growing slowly". Which one they get is the panel's
   * call, so the number has to survive the trip.
   */
  season: number;
  /**
   * The middle of the plot, rounded to a cell.
   *
   * Here because the complaint that started this panel was that the field could
   * not be found on the map, and a panel that names a field the player still
   * cannot find has answered half the question. The centroid rather than the
   * first cell: an L-shaped plot's first cell is one of its ends.
   */
  x: number;
  y: number;
}

/**
 * The plot, or null when the colony has no growing zone at all.
 *
 * Null and "twelve cells, nothing sown" are different problems — the first is a
 * field the player has to paint, the second is a field nobody has got to yet — so
 * the panel is handed the difference rather than a zero it would have to guess at.
 */
export function plotStatus(world: World): PlotStatus | null {
  const cells = growingCells(world);
  if (cells.length === 0) return null;
  let sown = 0;
  let ripe = 0;
  let best = 0;
  let rateSum = 0;
  let seasonSum = 0;
  let midX = 0;
  let midY = 0;
  const weather = growthMultiplier(world);
  for (const c of cells) {
    midX += unpackX(world, c);
    midY += unpackY(world, c);
    const g = world.crops[c] ?? CROP_NONE;
    if (g < 0) continue;
    sown++;
    if (g >= 1) ripe++;
    if (g > best) best = g;
    const x = unpackX(world, c);
    const y = unpackY(world, c);
    const season = seasonScale(world, x, y);
    seasonSum += season;
    rateSum += soilScale(world, x, y) * season * weather;
  }
  const hands = world.jobs.filter((j) => j.kind === 'sow' || j.kind === 'harvestCrop').length;
  return {
    cells: cells.length,
    sown,
    ripe,
    best,
    hands,
    rate: sown === 0 ? 0 : Math.min(1, rateSum / sown),
    season: sown === 0 ? seasonScale(world, unpackX(world, cells[0]!), unpackY(world, cells[0]!)) : seasonSum / sown,
    x: Math.round(midX / cells.length),
    y: Math.round(midY / cells.length),
  };
}

/**
 * What the whole queue is short of that the colony cannot cover, biggest first.
 *
 * Summed across every frame rather than reported per frame, because the decision
 * it feeds is a colony-wide one — send somebody to chop, or take a blueprint back
 * down — and six rows each saying "needs wood" do not add up to that on their own.
 */
export function shortfall(world: World): { kind: ResourceKind; amount: number }[] {
  const want = new Map<ResourceKind, number>();
  for (const b of world.buildings) {
    if (b.built) continue;
    for (const key of Object.keys(b.needs) as ResourceKind[]) {
      const need = (b.needs[key] ?? 0) - (b.have[key] ?? 0);
      if (need > 0) want.set(key, (want.get(key) ?? 0) + need);
    }
  }
  const out: { kind: ResourceKind; amount: number }[] = [];
  for (const [kind, amount] of want) {
    const gap = amount - countResource(world, kind);
    if (gap > 0) out.push({ kind, amount: gap });
  }
  out.sort((a, b) => b.amount - a.amount);
  return out;
}
