/**
 * You cannot bury the woodpile.
 *
 * A stack is lifted by standing on top of it, so the instant a solid building
 * finishes over one, that stack leaves the game — except for `countResource`,
 * which still counts it. That is the difference between losing wood and being
 * trapped by it: the colony believes it is holding forty-nine planks, so it never
 * sends anybody out for more, and every frame on the map waits for wood that is
 * under a wall.
 *
 * Measured on seed 1312 before this rule existed: four buried piles by day
 * twenty-four, and then sixteen days of eight healthy, fed, unbroken settlers
 * standing idle in front of twenty frames they could not start. `boardClear`
 * froze the Steward on top of it, so the colony could not even order the trees
 * cut that would have freed it.
 *
 * The functional half pins the rule and its two edges — solid buildings only,
 * and nowhere-to-put-it leaves the stack alone. The experience half raises a wall
 * over a woodpile in a running colony and asks the job board the only question
 * that matters: can somebody still go and get that wood.
 */

import { describe, expect, it } from 'vitest';

import { addBuilding, addItem, countResource, itemsAt, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import { findStack, shoveItemsClear } from '../src/sim/jobs';
import { buildingAt, isWalkable } from '../src/sim/grid';
import type { World } from '../src/sim/types';

function world(): World {
  return createWorld(4242);
}

/** A cell out in the open yard, with room around it, and what is standing there. */
function clearing(w: World): { x: number; y: number } {
  for (let y = 6; y < w.height - 6; y++) {
    for (let x = 6; x < w.width - 6; x++) {
      let open = true;
      for (let dy = -1; dy <= 1 && open; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!isWalkable(w, x + dx, y + dy) || buildingAt(w, x + dx, y + dy)) {
            open = false;
            break;
          }
        }
      }
      if (open) return { x, y };
    }
  }
  throw new Error('no open ground on this map');
}

describe('a wall over a woodpile (functional)', () => {
  it('pushes the stack out from under a wall that has just gone up', () => {
    const w = world();
    const { x, y } = clearing(w);
    addItem(w, 'wood', 20, x, y);
    const before = countResource(w, 'wood');
    const wall = addBuilding(w, 'wall', x, y, true)!;
    shoveItemsClear(w, wall);
    expect(itemsAt(w, x, y), 'nothing may be left under the wall').toHaveLength(0);
    expect(countResource(w, 'wood'), 'and the wood is moved, not destroyed').toBe(before);
  });

  it('puts it down next door rather than across the map', () => {
    const w = world();
    const { x, y } = clearing(w);
    addItem(w, 'wood', 20, x, y);
    const wall = addBuilding(w, 'wall', x, y, true)!;
    shoveItemsClear(w, wall);
    const moved = w.items.find((s) => s.kind === 'wood' && s.amount === 20)!;
    expect(Math.abs(moved.x - x) <= 1 && Math.abs(moved.y - y) <= 1, 'it goes one square over').toBe(true);
    expect(isWalkable(w, moved.x, moved.y), 'and somewhere somebody can stand').toBe(true);
  });

  it('leaves a stack alone under something you can walk on', () => {
    const w = world();
    const { x, y } = clearing(w);
    addItem(w, 'wood', 20, x, y);
    // A lamp over a sack buries nothing: somebody can still stand there and lift
    // it, so moving it would be the colony tidying for no reason.
    const lamp = addBuilding(w, 'lamp', x, y, true)!;
    shoveItemsClear(w, lamp);
    expect(itemsAt(w, x, y), 'the stack stays put').toHaveLength(1);
  });

  it('keeps the claim on a stack somebody is already walking to', () => {
    const w = world();
    const { x, y } = clearing(w);
    addItem(w, 'wood', 20, x, y);
    const stack = w.items.find((s) => s.kind === 'wood' && s.amount === 20)!;
    stack.reservedBy = 99;
    shoveItemsClear(w, addBuilding(w, 'wall', x, y, true)!);
    expect(stack.reservedBy, 'dropping the claim would start a race for it').toBe(99);
  });

  it('leaves it where it is when there is nowhere to put it down', () => {
    const w = world();
    const { x, y } = clearing(w);
    addItem(w, 'wood', 20, x, y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      addBuilding(w, 'wall', x + dx, y + dy, true);
    }
    shoveItemsClear(w, addBuilding(w, 'wall', x, y, true)!);
    expect(itemsAt(w, x, y), 'teleporting it across the map would be worse').toHaveLength(1);
  });
});

describe('a wall over a woodpile (experience)', () => {
  it('leaves the wood something a settler can still be sent for', () => {
    const w = world();
    const pawn = livingColonists(w)[0]!;
    const { x, y } = clearing(w);
    addItem(w, 'wood', 20, x, y);
    expect(findStack(w, pawn, 'wood'), 'the pile is there to be fetched').not.toBeNull();

    // The colony raises a wall on exactly that square — which is an ordinary
    // thing for it to do, and used to be the end of that wood.
    shoveItemsClear(w, addBuilding(w, 'wall', x, y, true)!);

    const stack = findStack(w, pawn, 'wood');
    expect(stack, 'and it is still there to be fetched afterwards').not.toBeNull();
    expect(isWalkable(w, stack!.x, stack!.y), 'somebody can stand on it to pick it up').toBe(true);
  });
});
