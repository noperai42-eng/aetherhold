/**
 * What is on one square of ground.
 *
 * The complaint this answers is short and exact: "I still can't select every
 * square", and then "even items in the house are not selectable, or planted
 * areas and such". Until now the manager's click resolved to a settler or a
 * building and to nothing else, so a woodpile on the floor, a furrow with wheat
 * coming up in it, a rock somebody has marked to mine and the bare yard all
 * reported the same thing — an empty panel. Every one of those is a fact the
 * sim already holds; none of them had a way out to the player.
 *
 * Facts only, on the same terms as `board.ts`: the words live in `hud.ts`, so
 * the ground comes back as a `Terrain` and a standing order comes back as its
 * `DESIG_*` number rather than as a sentence. One vocabulary, in one file.
 *
 * Deliberately says nothing about the building on the cell. A cell with a
 * building on it is selected *as* that building — the inspector has had a panel
 * for those since the beginning, and a second one describing the ground under a
 * bed would be two answers to one click.
 */

import { CROP_NONE, canSow, cropAt, seasonScale, soilScale } from '../../sim/farming';
import { isWalkable } from '../../sim/grid';
import { growthMultiplier } from '../../sim/weather';
import { itemsAt, zoneAt } from '../../sim/world';
import {
  inBounds,
  isFloor,
  packCell,
  terrainAt,
  type ResourceKind,
  type Terrain,
  type World,
  type ZoneKind,
} from '../../sim/types';

export interface CellFacts {
  x: number;
  y: number;
  terrain: Terrain;
  /** Ground the colony laid, rather than ground it found. */
  laid: boolean;
  walkable: boolean;
  /** The standing order painted here, as a `DESIG_*` constant. `DESIG_NONE` for none. */
  desig: number;
  /** The zone this cell belongs to, with the size of it — a furrow is not a field. */
  zone: { kind: ZoneKind; cells: number } | null;
  /** Growth, 0 just sown to 1 ripe. Null where nothing is planted. */
  crop: number | null;
  /**
   * Whether a seed would take here at all.
   *
   * The distinction that matters on an empty furrow: ground nobody has got to
   * yet is a matter of patience, and ground with boards over it or a wall on it
   * is a mistake the player wants told about now rather than in three days when
   * the rest of the plot comes up and this cell does not.
   */
  sowable: boolean;
  /**
   * How fast anything grows here against its best, 0..1 — the soil, the season
   * and the weather multiplied together, which is the same number the work
   * board prints for the plot as a whole. One furrow rather than the average of
   * twelve: the shaded corner of a field really does ripen last.
   */
  rate: number;
  /**
   * The season's own share of that rate, 0..1.
   *
   * Separate because it is the one term that goes to zero, and a cell that has
   * not moved in a week has a reason the player can plan around — winter — that
   * a single blended number would bury.
   */
  season: number;
  /**
   * Stacks lying here, biggest first. Never what somebody is carrying: a hauler
   * walking over the square is not a square with wood on it.
   */
  items: { kind: ResourceKind; amount: number; rot: number }[];
}

/** Everything the colony knows about one square, or null if there is no such square. */
export function cellFacts(world: World, x: number, y: number): CellFacts | null {
  if (!inBounds(world, x, y)) return null;
  const terrain = terrainAt(world, x, y);
  const zone = zoneAt(world, x, y);
  const g = cropAt(world, x, y);
  const season = seasonScale(world, x, y);
  return {
    x,
    y,
    terrain,
    laid: isFloor(terrain),
    walkable: isWalkable(world, x, y),
    desig: world.cellDesig[packCell(world, x, y)] ?? 0,
    zone: zone ? { kind: zone.kind, cells: zone.cells.length } : null,
    crop: g === CROP_NONE ? null : g,
    sowable: canSow(world, x, y),
    rate: Math.min(1, soilScale(world, x, y) * season * growthMultiplier(world)),
    season,
    items: itemsAt(world, x, y)
      .filter((s) => s.amount > 0)
      .map((s) => ({ kind: s.kind, amount: s.amount, rot: s.rot ?? 0 }))
      .sort((a, b) => b.amount - a.amount),
  };
}
