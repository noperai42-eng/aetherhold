/**
 * Floors — the ground the colony lays for itself.
 *
 * A floor is *terrain*, not a building, and that one decision is what the rest
 * of this file follows from. A cell holds at most one building, so boards under
 * a bed would have to be a second one; and a floor that is terrain saves, loads,
 * renders, paths and burns through machinery that already exists.
 *
 * The cost of the decision used to be that a floor could not be taken up again:
 * laying terrain over terrain destroys what was there, so the only way to change
 * your mind was to lay something else on top. That is now paid for rather than
 * lived with — `layFloor` writes down what it covered in `world.floorUnder`, and
 * `removeFloor` puts it back. One note per floored cell, which is a few hundred
 * entries in a colony that has paved its whole yard.
 *
 * A bridge needs no note. It is the one floor that may only ever be laid on
 * water, so what is underneath it is not remembered, it is known.
 */

import { CROP_NONE, cropAt } from './farming';
import { buildingAt, isSolid } from './grid';
import type { FloorKind, ResourceKind, Terrain, World } from './types';
import {
  DESIG_FLOOR_BRIDGE,
  DESIG_FLOOR_PAVED,
  DESIG_FLOOR_PLANK,
  TERRAIN_LIST,
  inBounds,
  isFloor,
  packCell,
  terrainAt,
  setTerrain,
} from './types';

/**
 * The two floors a colony can lay, as terrain kinds.
 *
 * Declared in `types.ts` because a `Job` carries one, and re-exported here so
 * everything else can go on importing it from the module that owns floors. Two
 * identical declarations is one declaration that can drift.
 */
export type { FloorKind };

/** What one cell of each floor costs and how long it takes to lay. */
export const FLOOR_DEFS: Record<FloorKind, { cost: ResourceKind; amount: number; work: number; label: string }> = {
  // Boards are the floor you can afford on day two: wood the colony already
  // fells, and quick enough that a settler lays a corridor between other jobs.
  plank: { cost: 'wood', amount: 3, work: 55, label: 'plank floor' },
  // Paving is the one you build once there is a mine going — twice the walking
  // speed of bare grass, and it does not take fire.
  paved: { cost: 'steel', amount: 2, work: 80, label: 'paved floor' },
  // Twice the boards and twice the work of a plank floor, for the same walking
  // speed. All of that is the water: you are paying for the piles under it and
  // for the fact that this is the only ground in the game that has to be built
  // out from one end, a cell at a time, with a settler standing on the last one.
  // Priced so that decking a whole lake is absurd and reaching across a neck of
  // it is a morning's work — the bridge is a shortcut, not a land reclamation.
  bridge: { cost: 'wood', amount: 6, work: 120, label: 'bridge' },
};

/** Which floor a painted designation asks for, or null if it is not a floor order. */
export function floorForDesig(desig: number): FloorKind | null {
  if (desig === DESIG_FLOOR_PLANK) return 'plank';
  if (desig === DESIG_FLOOR_PAVED) return 'paved';
  if (desig === DESIG_FLOOR_BRIDGE) return 'bridge';
  return null;
}

export function desigForFloor(kind: FloorKind): number {
  if (kind === 'plank') return DESIG_FLOOR_PLANK;
  if (kind === 'paved') return DESIG_FLOOR_PAVED;
  return DESIG_FLOOR_BRIDGE;
}

/**
 * Can this floor be laid here?
 *
 * Floors go over open ground and under anything already standing on it that a
 * settler can walk through — you floor a bedroom without dragging the bed out.
 * What they cannot cover is what the ground *is*: rock, water, a sown crop, or
 * a floor of the same kind that is already down.
 *
 * A bridge inverts every clause of that: it covers water, only water, and it is
 * the one order in the game that is legal on a cell nobody can reach yet.
 */
export function canFloor(world: World, x: number, y: number, kind: FloorKind): boolean {
  if (!inBounds(world, x, y)) return false;
  const here = terrainAt(world, x, y);
  if (kind === 'bridge') {
    // Water and only water. A bridge over dry land is a plank floor with an
    // extra three wood in it, and the deck is drawn standing over a hole — put
    // one on the grass and it is a boardwalk hovering above the field.
    //
    // Nothing else is checked, and in particular not `isSolid`: the whole point
    // is to build across what a settler cannot stand on. Reachability is the
    // job system's problem and it solves it the right way round — a painted
    // line out into the lake gets laid one cell at a time from the bank,
    // because until the near cell is decked the far one has nowhere to stand.
    return here === 'water';
  }
  // Not `isSolid`, which answers *today*: for four months of the year the lake
  // bears weight and a floor tool that trusted it would let a player pave the
  // ice in January and own a permanent steel causeway in April, with the water
  // gone from under it for good. What a floor can cover is what the ground is,
  // and the lake is water whether or not you can currently stand on it.
  //
  // A laid bridge is refused for the mirror of the same reason: paving over the
  // deck would leave a paved floor with a lake underneath it that nothing in the
  // game remembers is there.
  if (here === 'water' || here === 'rock' || here === 'bridge') return false;
  if (isSolid(world, x, y)) return false;
  if (here === kind) return false;
  // Boards over a growing crop would kill it silently. Refuse instead: the
  // player can clear the zone first if that is really what they meant. Note the
  // sentinel — an empty cell is CROP_NONE, not zero, and zero is a seed that was
  // sown this tick.
  if (cropAt(world, x, y) !== CROP_NONE) return false;
  return true;
}

/**
 * Lay the floor. The one place terrain becomes a floor.
 *
 * And the one place the ground under it is written down. Only when it is
 * *ground*: swapping paving in over a plank corridor must not record the boards,
 * or taking the paving up later would leave planks behind that nobody laid and
 * the grass under them would be lost for good. First floor down wins the note,
 * and every floor after that inherits it.
 *
 * A bridge writes nothing, because `canFloor` has already refused every cell
 * that is not water.
 */
export function layFloor(world: World, x: number, y: number, kind: FloorKind): void {
  const here = terrainAt(world, x, y);
  if (kind !== 'bridge' && !isFloor(here)) {
    (world.floorUnder ??= {})[packCell(world, x, y)] = TERRAIN_LIST.indexOf(here);
  }
  setTerrain(world, x, y, kind as Terrain);
}

/** The floor laid on a cell, or null if the ground there is the ground it came with. */
export function floorAt(world: World, x: number, y: number): FloorKind | null {
  if (!inBounds(world, x, y)) return null;
  const t = terrainAt(world, x, y);
  return isFloor(t) ? (t as FloorKind) : null;
}

/**
 * Can this floor be taken up again?
 *
 * A floor, and nothing standing on it. The second clause is not a safety rule so
 * much as a reading of what the player just clicked: the deconstruct tool takes
 * the topmost thing off a cell, so a bed on floorboards is a bed first and boards
 * second, and the same square clicked twice gives you back the bed and then the
 * grass. It also happens to be the only thing keeping a bed on a bridge from
 * ending up afloat, since a blueprint counts as standing there too.
 */
export function canRemoveFloor(world: World, x: number, y: number): boolean {
  if (floorAt(world, x, y) === null) return false;
  return buildingAt(world, x, y) === null;
}

/**
 * Take the floor up, putting back whatever it covered.
 *
 * A bridge always goes back to water — the only ground it was ever allowed on —
 * and the deck vanishing under somebody standing on it is safe by an accident
 * that is worth naming: `moveBody` already shoves a pawn to the nearest walkable
 * cell when it finds one standing in something solid, because a wall can be
 * built on top of a sleeper. A lake opening under a settler is the same event.
 *
 * Everything else goes back to the note `layFloor` left, and to grass if there
 * is no note — a colony saved before any of this existed has floors nobody wrote
 * down, and grass is both the commonest ground on the map and the one answer
 * that cannot strand anybody.
 */
export function removeFloor(world: World, x: number, y: number): void {
  const kind = floorAt(world, x, y);
  if (kind === null) return;
  const idx = packCell(world, x, y);
  if (kind === 'bridge') {
    setTerrain(world, x, y, 'water');
    return;
  }
  const under = TERRAIN_LIST[world.floorUnder?.[idx] ?? -1];
  // Guarded rather than trusted. The note is written once and never rewritten,
  // so a floor on top of a floor cannot get in there — but a save file is an
  // input, and putting rock or a lake back under a settler's feet on the word of
  // one is a worse bug than forgetting what the grass looked like.
  const safe = under !== undefined && !isFloor(under) && under !== 'water' && under !== 'rock';
  setTerrain(world, x, y, safe ? under : 'grass');
  if (world.floorUnder) delete world.floorUnder[idx];
}
