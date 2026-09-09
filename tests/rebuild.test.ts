/**
 * Putting back what the colony loses.
 *
 * The bug this exists to stop: on a twenty-four day headless run of seed 1337 the
 * wood generator caught fire on day four and simply ceased to exist. Nothing in
 * the log, nothing on the ground, and no settler ever went near the spot again.
 * The colony ran the remaining twenty days without power — no cooler, no turrets,
 * no lamps — and every downstream system read that as normal.
 *
 * So these assertions come in two halves, and both halves matter. The first is
 * that damage forms an intent to rebuild. The second is the one that is easy to
 * get wrong and expensive to get wrong: an intent must *not* become a blueprint
 * while the cell is still on fire or still being shot at, and an intent must
 * never be formed for something the player took down on purpose.
 */

import { describe, expect, it } from 'vitest';

import { damageBuilding } from '../src/sim/combat';
import { cancelAt, placeBlueprint } from '../src/sim/orders';
import { forgetRebuild, planRebuild, rebuildPlans, tickRebuild } from '../src/sim/rebuild';
import { igniteFire } from '../src/sim/events';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { Rng } from '../src/sim/rng';
import { addBuilding, addItem, removeBuilding } from '../src/sim/world';
import { buildingAt } from '../src/sim/grid';
import { playerClear } from '../src/sim/steward';
import { terrainAt, type Building, type World } from '../src/sim/types';
import { createWorld, makePawn } from '../src/sim/worldgen';

/** Open ground, three cells clear in every direction, well away from the cabin. */
function clearing(world: World): { x: number; y: number } {
  for (let y = 8; y < world.height - 8; y++) {
    for (let x = 8; x < world.width - 8; x++) {
      let clear = true;
      for (let dy = -3; dy <= 3 && clear; dy++) {
        for (let dx = -3; dx <= 3 && clear; dx++) {
          if (buildingAt(world, x + dx, y + dy)) clear = false;
          else if (terrainAt(world, x + dx, y + dy) === 'rock') clear = false;
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('no clearing on this map');
}

/** Knock a building down the way a raider or a fire would. */
function destroy(world: World, b: Building): void {
  damageBuilding(world, b.id, b.maxHp * 10);
}

function game(seed = 1337) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

/** A building-shaped record for the cap test — never enters the world. */
function fakeWall(x: number): Building {
  return {
    id: 900000 + x,
    kind: 'wall',
    x,
    y: 0,
    built: true,
    work: 0,
    workLeft: 0,
    needs: {},
    have: {},
    hp: 0,
    maxHp: 100,
    seed: x,
  };
}

describe('forming the intent', () => {
  it('plans a rebuild when a finished building is destroyed by damage', () => {
    const { world } = game();
    const spot = clearing(world);
    const gen = addBuilding(world, 'generator', spot.x, spot.y, true)!;
    destroy(world, gen);

    expect(buildingAt(world, spot.x, spot.y)).toBeNull();
    expect(rebuildPlans(world)).toEqual([
      { kind: 'generator', x: spot.x, y: spot.y, tick: world.tick },
    ]);
  });

  it('tells the player, in words, that it is gone', () => {
    const { world } = game();
    const spot = clearing(world);
    destroy(world, addBuilding(world, 'generator', spot.x, spot.y, true)!);

    const last = world.messages[world.messages.length - 1]!;
    // Losing the grid silently is the whole bug. The line has to name the thing
    // and it has to say the colony is on it, or the player goes looking.
    expect(last.text).toContain('Wood generator');
    expect(last.text).toContain('rebuilt');
    expect(last.kind).toBe('bad');
  });

  it('folds a row of walls collapsing together into one line', () => {
    const { world } = game();
    const spot = clearing(world);
    const before = world.messages.length;
    for (let i = 0; i < 5; i++) {
      destroy(world, addBuilding(world, 'wall', spot.x + i, spot.y, true)!);
    }
    // Five walls, five plans, one message: a burning wall row is one event to a
    // player, and five identical lines would push everything else off the log.
    expect(rebuildPlans(world)).toHaveLength(5);
    expect(world.messages.length - before).toBe(1);
  });

  it('starts a new line when a different thing is lost', () => {
    const { world } = game();
    const spot = clearing(world);
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, true)!);
    destroy(world, addBuilding(world, 'generator', spot.x + 2, spot.y, true)!);
    const texts = world.messages.slice(-2).map((m) => m.text);
    expect(texts[0]).toContain('Wall');
    expect(texts[1]).toContain('Wood generator');
  });

  it('does not plan a rebuild for a destroyed blueprint', () => {
    const { world } = game();
    const spot = clearing(world);
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, false)!);
    // This is the loop-breaker. A blueprint dropped on a burning cell is
    // destroyed within a tick or two; if that re-planned, the colony would spend
    // the whole fire feeding blueprints into it.
    expect(rebuildPlans(world)).toEqual([]);
  });

  it('does not plan a rebuild for a tree', () => {
    const { world } = game();
    const tree = world.buildings.find((b) => b.kind === 'tree');
    expect(tree).toBeDefined();
    destroy(world, tree!);
    expect(rebuildPlans(world)).toEqual([]);
  });

  it('never plans two rebuilds for the same cell', () => {
    const { world } = game();
    const spot = clearing(world);
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, true)!);
    // The player rebuilds by hand, it burns again: still one intent, not two.
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, true)!);
    expect(rebuildPlans(world)).toHaveLength(1);
  });

  it('caps how much intent it will hold', () => {
    const { world } = game();
    for (let i = 0; i < 400; i++) planRebuild(world, fakeWall(i));
    // A firestorm through a large colony must not leave a thousand blueprints
    // nobody will ever haul to. The most recent losses win.
    expect(rebuildPlans(world).length).toBeLessThanOrEqual(150);
    expect(rebuildPlans(world).at(-1)!.x).toBe(399);
  });
});

describe('what the player takes down stays down', () => {
  it('forms no intent when a building is removed rather than damaged', () => {
    const { world, streams } = game();
    const spot = clearing(world);
    const bed = addBuilding(world, 'bed', spot.x, spot.y, true)!;
    // The deconstruct job and the cancel tool both go straight to
    // `removeBuilding`. That is the only thing separating "a raider knocked my
    // wall down" from "I asked for that wall to go", so it is pinned here.
    removeBuilding(world, bed);
    stepWorld(world, streams);
    expect(rebuildPlans(world)).toEqual([]);
    expect(buildingAt(world, spot.x, spot.y)).toBeNull();
  });

  it('lets the cancel tool wave off a rebuild that has not landed yet', () => {
    const { world } = game();
    const spot = clearing(world);
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, true)!);
    igniteFire(world, spot.x, spot.y);

    expect(cancelAt(world, spot.x, spot.y)).toBe(true);
    expect(rebuildPlans(world)).toEqual([]);
  });

  it('lets the cancel tool wave off a rebuild that already landed', () => {
    const { world, streams } = game();
    const spot = clearing(world);
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, true)!);
    stepWorld(world, streams);
    expect(buildingAt(world, spot.x, spot.y)!.built).toBe(false);

    cancelAt(world, spot.x, spot.y);
    stepWorldN(world, streams, 5);
    // Cancelling the blueprint has to cancel the intent behind it, or the next
    // tick lays exactly the same blueprint down again and the tool does nothing.
    expect(buildingAt(world, spot.x, spot.y)).toBeNull();
    expect(rebuildPlans(world)).toEqual([]);
  });

  it('forgetRebuild reports whether there was anything to forget', () => {
    const { world } = game();
    expect(forgetRebuild(world, 3, 3)).toBe(false);
  });
});

describe('waiting for it to be safe', () => {
  it('does not lay a blueprint on a cell that is still burning', () => {
    const { world } = game();
    const spot = clearing(world);
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, true)!);
    igniteFire(world, spot.x, spot.y);

    tickRebuild(world);
    expect(buildingAt(world, spot.x, spot.y)).toBeNull();
    expect(rebuildPlans(world)).toHaveLength(1);

    world.fires.length = 0;
    tickRebuild(world);
    const back = buildingAt(world, spot.x, spot.y);
    expect(back).not.toBeNull();
    expect(back!.built).toBe(false);
    expect(rebuildPlans(world)).toEqual([]);
  });

  it('does not send a carpenter into the breach while a raider is standing in it', () => {
    const { world } = game();
    const spot = clearing(world);
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, true)!);

    const raider = makePawn(world, new Rng(7), 'raider', spot.x + 2, spot.y, { name: 'Raider' });
    tickRebuild(world);
    expect(buildingAt(world, spot.x, spot.y)).toBeNull();

    // Once the fight has moved on, the gap gets patched.
    raider.x = spot.x + 30;
    tickRebuild(world);
    expect(buildingAt(world, spot.x, spot.y)).not.toBeNull();
  });

  it('a downed raider is not a reason to leave the wall open', () => {
    const { world } = game();
    const spot = clearing(world);
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, true)!);

    const raider = makePawn(world, new Rng(7), 'raider', spot.x + 1, spot.y, { name: 'Raider' });
    raider.downed = true;
    tickRebuild(world);
    expect(buildingAt(world, spot.x, spot.y)).not.toBeNull();
  });

  it('drops the intent when the player puts something else on the cell', () => {
    const { world } = game();
    const spot = clearing(world);
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, true)!);
    // Same cell, different building, placed by hand: the colony's old intent is
    // stale and must not fight the player for the square.
    expect(placeBlueprint(world, 'bed', spot.x, spot.y)).toBe(true);

    tickRebuild(world);
    expect(rebuildPlans(world)).toEqual([]);
    expect(buildingAt(world, spot.x, spot.y)!.kind).toBe('bed');
  });
});

describe('the colony actually gets its generator back', () => {
  it('rebuilds a burnt generator, unattended, and puts it back where it stood', () => {
    const { world, streams } = game();
    const gen = world.buildings.find((b) => b.kind === 'generator');
    expect(gen).toBeDefined();
    const at = { x: gen!.x, y: gen!.y };
    // Materials on the doorstep: this test is about whether the colony forms and
    // finishes the intent, not about whether it can find wood on day one.
    addItem(world, 'wood', 60, at.x + 1, at.y + 1);
    addItem(world, 'steel', 40, at.x + 1, at.y + 1);

    destroy(world, gen!);
    expect(world.buildings.some((b) => b.kind === 'generator')).toBe(false);

    // By the cell, not by the kind. The Steward reaches `power` on a colony
    // this size and orders a second generator of its own — the grid at worldgen
    // is under-provisioned and that is the whole point of the ambition — so
    // "is there a generator standing" stopped being the same question as "did
    // the colony put back the one it lost", and it is the second one that is
    // being asked here.
    let rebuilt: Building | undefined;
    for (let i = 0; i < 4000 && !rebuilt; i++) {
      stepWorld(world, streams);
      const b = buildingAt(world, at.x, at.y);
      rebuilt = b && b.built && b.kind === 'generator' ? b : undefined;
    }
    // Four thousand ticks is a little under a day. A colony that cannot put its
    // own generator back in a day is not rebuilding, it is idling.
    expect(rebuilt, 'the colony never rebuilt its generator').toBeDefined();
    expect(rebuilt!.x).toBe(at.x);
    expect(rebuilt!.y).toBe(at.y);
  });

  it('waits out the fire standing in the gap, then plans it back', () => {
    const { world, streams } = game();
    const spot = clearing(world);
    // A wall goes down and the cell it stood on is alight — the state a burnt
    // wall is actually in, and the one that would have fed blueprints into a
    // fire if the intent were acted on the moment it was formed.
    destroy(world, addBuilding(world, 'wall', spot.x, spot.y, true)!);
    igniteFire(world, spot.x, spot.y);

    let patched = false;
    for (let i = 0; i < 3000 && !patched; i++) {
      stepWorld(world, streams);
      const onFire = world.fires.some((f) => f.x === spot.x && f.y === spot.y);
      const b = buildingAt(world, spot.x, spot.y);
      expect(!(onFire && b), 'a blueprint was laid onto a burning cell').toBe(true);
      patched = b !== null;
    }
    // The colony's own firefighters put it out; nobody had to be told to.
    expect(patched, 'the hole in the wall was never planned back').toBe(true);
    expect(world.fires.some((f) => f.x === spot.x && f.y === spot.y)).toBe(false);
  });
});

describe('the frame it puts back is the colony\'s own work', () => {
  it('stamps a rebuilt frame as the colony\'s, not as something the player queued', () => {
    const { world } = game();
    const spot = clearing(world);
    const wall = addBuilding(world, 'wall', spot.x, spot.y, true)!;
    expect(playerClear(world)).toBe(true);

    destroy(world, wall);
    tickRebuild(world);

    // Nobody ordered this frame. The wall stood, something took it out, and the
    // colony decided by itself to put it back — which is the one thing the mark
    // is for. Leave it off and the Steward reads the gap in its own wall as the
    // player's floor plan and stands down: not for a day, but for as long as the
    // frame is there, which is until somebody hauls the wood to it. A colony
    // that has just been raided is exactly the colony that will not.
    const frame = buildingAt(world, spot.x, spot.y);
    expect(frame, 'the wall was never planned back').not.toBeNull();
    expect(frame!.built).toBe(false);
    expect(frame!.bySteward).toBe(true);
    expect(playerClear(world)).toBe(true);
  });

  it('does not put the mark on a blueprint the player laid by hand', () => {
    const { world } = game();
    const spot = clearing(world);
    // The same pass, over a board that has a plan of the player's on it. Nothing
    // here was destroyed, so nothing here is the colony's to claim.
    expect(placeBlueprint(world, 'wall', spot.x, spot.y)).toBeTruthy();
    tickRebuild(world);

    const frame = buildingAt(world, spot.x, spot.y)!;
    expect(frame.built).toBe(false);
    expect(frame.bySteward).toBeUndefined();
    expect(playerClear(world)).toBe(false);
  });
});
