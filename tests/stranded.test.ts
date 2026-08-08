/**
 * Work nobody can get to.
 *
 * The functional half pins the reaper's three promises: it waits for a second
 * opinion, it hands back what was already hauled in, and it keeps its hands off
 * anything a settler could actually walk to.
 *
 * The experience half is the bug that made it exist. A colony with two fence
 * posts marked in a pocket of rock has a foreman who never speaks again — the
 * Steward waits for a clear board, and that board is never clear. Seed 7 spent
 * twenty-two days that way with three hundred wood banked. What a player should
 * see instead is the colony noticing, saying so, and getting back to work.
 */

import { describe, expect, it } from 'vitest';

import { STRANDED_INTERVAL, planBlueprint, tickStranded } from '../src/sim/stranded';
import { placeBlueprint } from '../src/sim/orders';
import { boardClear, tickSteward } from '../src/sim/steward';
import { defaultCamera, deserialize, serialize } from '../src/sim/save';
import { createWorld } from '../src/sim/worldgen';
import { addBuilding, livingColonists } from '../src/sim/world';
import { isWalkable } from '../src/sim/grid';
import { regionAt } from '../src/sim/regions';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { DESIG_DECONSTRUCT, DESIG_HARVEST, DESIG_NONE, packCell, type World } from '../src/sim/types';

const NEIGHBOURS_8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Wall off one open cell so the whole colony is on the outside of it.
 *
 * The map's own geography makes these by accident — a gap in a boulder field, a
 * spit of grass across a lake — but hunting for one is a test that depends on
 * the seed's terrain. Building the pocket is the same situation stated outright.
 */
function pocket(world: World): { x: number; y: number } {
  const home = livingColonists(world)[0]!;
  for (let y = 2; y < world.height - 2; y++) {
    for (let x = 2; x < world.width - 2; x++) {
      if (Math.abs(x - home.x) + Math.abs(y - home.y) < 12) continue;
      if (!isWalkable(world, x, y)) continue;
      if (!NEIGHBOURS_8.every(([dx, dy]) => isWalkable(world, x + dx!, y + dy!))) continue;
      if (!NEIGHBOURS_8.every(([dx, dy]) => world.cellBuilding[packCell(world, x + dx!, y + dy!)] === -1))
        continue;
      for (const [dx, dy] of NEIGHBOURS_8) {
        expect(addBuilding(world, 'wall', x + dx!, y + dy!, true)).not.toBeNull();
      }
      // The point of the exercise, stated so a change to what counts as solid
      // fails here rather than three assertions later as "nothing was reaped".
      expect(regionAt(world, x, y)).not.toBe(regionAt(world, Math.round(home.x), Math.round(home.y)));
      return { x, y };
    }
  }
  throw new Error('no open ground to wall off');
}

/**
 * The same pocket with one corner left open — and a corner is not a door.
 *
 * Seven walls and a diagonal gap whose two orthogonal partners are both walled.
 * Seen from above that looks like a way in; asked of the pathfinder it is not one,
 * because `canStep` refuses to cut between two walls. This is the shape seed 7
 * built out of a boulder field, and the shape a flood that walks all eight
 * neighbours without asking will happily stroll through.
 */
function cornerPocket(world: World): { cell: { x: number; y: number }; gap: { x: number; y: number } } {
  const home = livingColonists(world)[0]!;
  const outside = regionAt(world, Math.round(home.x), Math.round(home.y));
  for (let y = 2; y < world.height - 2; y++) {
    for (let x = 2; x < world.width - 2; x++) {
      if (Math.abs(x - home.x) + Math.abs(y - home.y) < 12) continue;
      if (regionAt(world, x, y) !== outside) continue;
      if (!NEIGHBOURS_8.every(([dx, dy]) => isWalkable(world, x + dx!, y + dy!))) continue;
      if (!NEIGHBOURS_8.every(([dx, dy]) => world.cellBuilding[packCell(world, x + dx!, y + dy!)] === -1))
        continue;

      const gap = { x: x + 1, y: y + 1 };
      for (const [dx, dy] of NEIGHBOURS_8) {
        if (x + dx! === gap.x && y + dy! === gap.y) continue;
        expect(addBuilding(world, 'wall', x + dx!, y + dy!, true)).not.toBeNull();
      }

      // Both halves stated outright: the gap is the colony's own ground, and the
      // cell behind the corner still is not the colony's. If a change to the
      // corner rule ever joins them, this fails here rather than downstream as
      // the far more confusing "the reaper ate a wall somebody wanted".
      expect(regionAt(world, gap.x, gap.y)).toBe(outside);
      expect(regionAt(world, x, y)).not.toBe(outside);
      return { cell: { x, y }, gap };
    }
  }
  throw new Error('no open ground to wall off');
}

/**
 * The one wall of a pocket worth demolishing — the one with the colony's own
 * ground on the far side of it. This is what the connectivity watchdog picks, and
 * picking it by hand keeps the test off whichever side of the pocket happens to
 * face the map border.
 */
function wayThrough(world: World, cell: { x: number; y: number }): { x: number; y: number } {
  const home = livingColonists(world)[0]!;
  const outside = regionAt(world, Math.round(home.x), Math.round(home.y));
  for (const [dx, dy] of NEIGHBOURS_8) {
    const wx = cell.x + dx!;
    const wy = cell.y + dy!;
    if (NEIGHBOURS_8.some(([ox, oy]) => regionAt(world, wx + ox!, wy + oy!) === outside)) {
      return { x: wx, y: wy };
    }
  }
  throw new Error('the pocket has no wall the colony could break through');
}

/**
 * Run the sweep `n` times, landing exactly on its cadence each time.
 *
 * Forward to the next multiple rather than by one interval: a new world starts
 * partway into its first morning, not at tick zero, so adding 300 to 1440 lands
 * on 1740 and the sweep politely does nothing at all.
 */
function sweep(world: World, n: number): void {
  for (let i = 0; i < n; i++) {
    world.tick += STRANDED_INTERVAL - (world.tick % STRANDED_INTERVAL);
    tickStranded(world);
  }
}

function game(seed = 90210) {
  const world = createWorld(seed);
  // Every test here starts from "the colony has nothing outstanding", which is
  // also the premise the Steward needs. Stated rather than assumed: a worldgen
  // that started leaving a blueprint behind would otherwise turn these into
  // tests of something else entirely.
  expect(boardClear(world)).toBe(true);
  return world;
}

describe('stranded work', () => {
  it('gives a plan a second chance before calling it off', () => {
    const world = game();
    const cell = pocket(world);
    addBuilding(world, 'fence', cell.x, cell.y, false);

    sweep(world, 1);
    expect(world.buildings.some((b) => b.x === cell.x && b.y === cell.y && !b.built)).toBe(true);

    sweep(world, 1);
    expect(world.buildings.some((b) => b.x === cell.x && b.y === cell.y && !b.built)).toBe(false);
  });

  it('hands back the materials already hauled into it', () => {
    const world = game();
    const cell = pocket(world);
    const bp = addBuilding(world, 'fence', cell.x, cell.y, false)!;
    bp.have.wood = 3;

    sweep(world, 2);

    const back = world.items.find((s) => s.kind === 'wood' && s.x === cell.x && s.y === cell.y);
    expect(back?.amount).toBe(3);
  });

  it('clears a designation nobody can reach', () => {
    const world = game();
    const cell = pocket(world);
    world.cellDesig[packCell(world, cell.x, cell.y)] = DESIG_HARVEST;

    sweep(world, 2);

    expect(world.cellDesig[packCell(world, cell.x, cell.y)]).toBe(DESIG_NONE);
  });

  it('calls off a plan reachable only across a blocked corner', () => {
    const world = game();
    const { cell } = cornerPocket(world);
    addBuilding(world, 'fence', cell.x, cell.y, false);

    sweep(world, 2);

    expect(world.buildings.some((b) => b.x === cell.x && b.y === cell.y)).toBe(false);
  });

  it('will not work a square it can only touch across a blocked corner', () => {
    // The other half of the same rule. A settler mining a rock stands beside it
    // rather than on it, and "beside" means what `adjacentStandCells` means: the
    // gap cell touches this square diagonally, and both ways round are walled.
    const world = game();
    const { cell, gap } = cornerPocket(world);
    world.cellDesig[packCell(world, cell.x, cell.y)] = DESIG_HARVEST;
    expect(isWalkable(world, gap.x, gap.y)).toBe(true);

    sweep(world, 2);

    expect(world.cellDesig[packCell(world, cell.x, cell.y)]).toBe(DESIG_NONE);
  });

  it('says where, on a card, when it calls something off', () => {
    const world = game();
    const cell = pocket(world);
    addBuilding(world, 'fence', cell.x, cell.y, false);

    sweep(world, 2);

    const said = world.messages.filter((m) => m.text.includes('nobody can reach'));
    expect(said).toHaveLength(1);
    // Both halves matter: a card is what the player actually sees, and the spot
    // is what turns it into a button that shows them the pocket. Without them
    // this reads to a player as the game deleting their wall.
    expect(said[0]!.headline).toBe(true);
    expect(said[0]!.at).toEqual({ x: cell.x, y: cell.y });
  });

  it('does not propose work its own settlers cannot reach', () => {
    // The other side of the same rule. Before this, the Steward re-placed what
    // the reaper had just taken away and the two spent the game undoing each
    // other — seed 20260729 lost a fence post and a sandbag seventy-four times in
    // twenty days, and the Steward's one-project-at-a-time rule meant nothing
    // else was proposed while they argued.
    const world = game();
    const cell = pocket(world);
    expect(planBlueprint(world, 'fence', cell.x, cell.y)).toBe(false);
    expect(world.buildings.some((b) => b.x === cell.x && b.y === cell.y)).toBe(false);

    // And the player's own tools are untouched: a wall across the lake is a plan
    // somebody may well mean, and the reaper is what answers it.
    expect(placeBlueprint(world, 'fence', cell.x, cell.y)).toBe(true);
  });

  it('keeps proposing while the colony is flat on its back', () => {
    // With nobody standing there is no honest answer to "can we get there", and
    // answering no would wipe the board of a colony that is about to come round.
    const world = game();
    const home = livingColonists(world)[0]!;
    const x = Math.round(home.x) + 1;
    const y = Math.round(home.y);
    for (const p of livingColonists(world)) p.downed = true;

    expect(planBlueprint(world, 'fence', x, y)).toBe(true);
    sweep(world, 3);
    expect(world.buildings.some((b) => b.x === x && b.y === y)).toBe(true);
  });

  it('leaves alone anything a settler could walk to', () => {
    const world = game();
    const home = livingColonists(world)[0]!;
    // Beside somebody standing in the cabin, which is as reachable as the map
    // gets. Ten sweeps is well past the two it takes to reap something.
    const x = Math.round(home.x) + 1;
    const y = Math.round(home.y);
    const bp = addBuilding(world, 'fence', x, y, false);
    expect(bp).not.toBeNull();

    sweep(world, 10);

    expect(world.buildings.some((b) => b.id === bp!.id)).toBe(true);
  });

  it('leaves alone a plan the colony has already marked a way through to', () => {
    // Marked work changes the map, so "can somebody walk there" is the wrong
    // question: the far end of a mining shaft is unreachable until the near end
    // is dug, and when the walls close round the stove the connectivity watchdog
    // opens a way by marking the wall itself — cells on the far side, by
    // definition. Reaping either one puts the reaper and the watchdog in a fight
    // they both keep losing. Seed 99001 stopped cooking on day fourteen of it.
    const world = game();
    const cell = pocket(world);
    addBuilding(world, 'fence', cell.x, cell.y, false);
    const way = wayThrough(world, cell);
    world.cellDesig[packCell(world, way.x, way.y)] = DESIG_DECONSTRUCT;

    sweep(world, 3);

    expect(world.buildings.some((b) => b.x === cell.x && b.y === cell.y)).toBe(true);
    expect(world.cellDesig[packCell(world, way.x, way.y)]).toBe(DESIG_DECONSTRUCT);
  });

  it('starts its count again when the colony is reopened', () => {
    const world = game();
    const cell = pocket(world);
    addBuilding(world, 'fence', cell.x, cell.y, false);
    sweep(world, 1);
    expect(world.stranded).toHaveLength(1);

    const text = serialize(
      world,
      { mode: 'manager', possessedId: null, camera: defaultCamera(world) },
      1,
      0,
    );
    const back = deserialize(text);
    expect(back.ok).toBe(true);
    const reopened = (back as { ok: true; save: { world: World } }).save.world;

    // One sweep after a reload is one look, not two: the plan is suspected again
    // and survives, exactly as it would have on a fresh morning.
    expect(reopened.stranded).toBeUndefined();
    sweep(reopened, 1);
    expect(reopened.buildings.some((b) => b.x === cell.x && b.y === cell.y)).toBe(true);
    sweep(reopened, 1);
    expect(reopened.buildings.some((b) => b.x === cell.x && b.y === cell.y)).toBe(false);
  });

  it('does not tidy up in the middle of a raid', () => {
    const world = game();
    const cell = pocket(world);
    addBuilding(world, 'fence', cell.x, cell.y, false);
    // Settlers are wherever the fight put them and the walls are moving; a plan
    // that looks unreachable now is the one moment the answer is momentary.
    const raider = { ...livingColonists(world)[0]!, id: 99001, faction: 'raider' as const };
    world.pawns.push(raider);

    sweep(world, 5);

    expect(world.buildings.some((b) => b.x === cell.x && b.y === cell.y)).toBe(true);
  });

  it('gives the colony its foreman back', () => {
    const world = game();
    const streams = makeStreams(world);
    const cell = pocket(world);
    addBuilding(world, 'fence', cell.x, cell.y, false);
    expect(boardClear(world)).toBe(false);

    // The Steward alone cannot get past this: a board that is never clear is a
    // foreman that never proposes anything, for the rest of the game. Run it
    // through a morning's worth of its own cadence from where the world starts —
    // which is mid-morning, and has to be, since it will not plan in the dark.
    for (let i = 0; i < 240; i++) {
      world.tick++;
      tickSteward(world);
    }
    expect(world.stewardLast).toBeUndefined();

    // Two sweeps and a morning is all it takes with the reaper in the loop.
    stepWorldN(world, streams, STRANDED_INTERVAL * 3);
    expect(world.buildings.some((b) => b.x === cell.x && b.y === cell.y)).toBe(false);
    expect(world.stewardLast).toBeDefined();
  });
});
