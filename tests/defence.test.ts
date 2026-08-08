/**
 * Fortifications have to actually fortify.
 *
 * Every rule here was written against a measured wipe. The 30-day sweeps showed
 * colonies that won every raid on the exchange and still ended each one with all
 * five settlers unconscious in their own gateway — a colony that had spent 120
 * steel on turrets and 32 on a sandbag gate for no measurable return. Three
 * separate defects, each invisible on its own:
 *
 *  - a turret's height put it above the sight line, so the first step of every
 *    round it fired was inside its own emplacement and the round was deleted;
 *  - sandbags were below the sight line, so bullets flew straight over them and
 *    "hard cover" cost steel and did nothing;
 *  - the Steward rallied the whole colony onto one cell, where six raiders shot
 *    the pile down one settler at a time.
 *
 * These tests pin all three.
 */

import { describe, expect, it } from 'vitest';

import { TURRET_STATS, fireWeapon, tickCombat } from '../src/sim/combat';
import { stewardTick } from '../src/eval/steward';
import { blocksSight, isWalkable } from '../src/sim/grid';
import { tickPower } from '../src/sim/power';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { TICKS_PER_DAY, type Pawn, type World } from '../src/sim/types';
import { addBuilding, livingColonists } from '../src/sim/world';
import { createWorld, makePawn } from '../src/sim/worldgen';

/** A patch of open ground well clear of worldgen's cabin, rocks and trees. */
function clearing(world: World, w: number, h: number): { x: number; y: number } | null {
  for (let y = 4; y < world.height - h - 4; y++) {
    for (let x = 4; x < world.width - w - 4; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) {
        for (let dx = 0; dx < w && ok; dx++) {
          if (!isWalkable(world, x + dx, y + dy)) ok = false;
        }
      }
      if (ok) return { x, y };
    }
  }
  return null;
}

describe('a turret', () => {
  it('does not block the line of fire it shoots along', () => {
    const world = createWorld(4242);
    const spot = clearing(world, 1, 1)!;
    addBuilding(world, 'turret', spot.x, spot.y, true);
    // A turret is chest-high cover, not a wall. If it reads as a sight blocker
    // its own rounds die on the tile they spawn on and it never lands a shot.
    expect(blocksSight(world, spot.x, spot.y)).toBe(false);
  });

  it('kills a raider standing in its field of fire', () => {
    const world = createWorld(4242);
    // Two cells wide: the gun in the first column, the generator that runs it in
    // the second. A turret with nothing feeding it is a steel box, and wiring it
    // here rather than setting the flag by hand keeps this a test of a gun a
    // player could actually have built.
    const spot = clearing(world, 2, 8)!;
    addBuilding(world, 'turret', spot.x, spot.y, true);
    expect(addBuilding(world, 'generator', spot.x + 1, spot.y, true)).not.toBeNull();
    tickPower(world);
    const rng = new Rng(9);
    const raider = makePawn(world, rng, 'raider', spot.x, spot.y + 6, {
      name: 'Target',
      weapon: 'club',
    });
    const before = raider.hp;
    // Held on their mark. Left to their own AI a lone raider walks off towards
    // the cabin looking for someone to hit and leaves the turret's 13.5 cells
    // before it lands a round — which measures the raider's pathing, not the
    // turret's fire. Pinning them is what makes this a test of the gun.
    const mark = { x: raider.x, y: raider.y };
    for (let t = 0; t < 200; t++) {
      raider.x = mark.x;
      raider.y = mark.y;
      tickCombat(world, rng, null);
    }
    expect(raider.hp).toBeLessThan(before);
  });
});

describe('hard cover', () => {
  /** Fire `shots` at `victim` from `(fx, fy)` and report how much got through. */
  function volley(world: World, victim: Pawn, fx: number, fy: number, shots: number): number {
    const rng = new Rng(11);
    const shooter = { id: 90001, faction: 'raider' as const, x: fx, y: fy };
    const before = victim.hp;
    for (let i = 0; i < shots; i++) {
      fireWeapon(world, shooter, victim.x - fx, victim.y - fy, TURRET_STATS, rng, 20);
      for (let t = 0; t < 40; t++) tickCombat(world, rng, null);
    }
    return before - victim.hp;
  }

  it('absorbs some of the fire aimed through it, and wears out doing so', () => {
    const world = createWorld(4242);
    const spot = clearing(world, 1, 10)!;
    const bag = addBuilding(world, 'sandbag', spot.x, spot.y + 1, true)!;
    const bagHp = bag.hp;
    const rng = new Rng(3);
    const pawn = makePawn(world, rng, 'colony', spot.x, spot.y, { name: 'Behind', weapon: 'none' });
    pawn.maxHp = 10_000;
    pawn.hp = 10_000;

    const through = volley(world, pawn, spot.x, spot.y + 8, 40);
    const bare = createWorld(4242);
    const bareRng = new Rng(3);
    const exposed = makePawn(bare, bareRng, 'colony', spot.x, spot.y, {
      name: 'Exposed',
      weapon: 'none',
    });
    exposed.maxHp = 10_000;
    exposed.hp = 10_000;
    const unblocked = volley(bare, exposed, spot.x, spot.y + 8, 40);

    expect(through).toBeLessThan(unblocked);
    // The wall pays for itself without making anyone immune behind it.
    expect(through).toBeGreaterThan(0);
    expect(bag.hp).toBeLessThan(bagHp);
  });

  it('is no help against fire that comes round the end of it', () => {
    const world = createWorld(4242);
    const spot = clearing(world, 10, 10)!;
    const px = spot.x + 5;
    const py = spot.y + 5;
    addBuilding(world, 'sandbag', px, py + 1, true);
    const rng = new Rng(3);
    const pawn = makePawn(world, rng, 'colony', px, py, { name: 'Flanked', weapon: 'none' });
    pawn.maxHp = 10_000;
    pawn.hp = 10_000;
    // Same sandbag, same volley, ninety degrees round: cover is directional, so
    // a flanking shooter should get the full damage through.
    const through = volley(world, pawn, px + 8, py, 40);
    expect(through).toBeGreaterThan(0);
    const cover = volley(world, pawn, px, py + 8, 40);
    expect(cover).toBeLessThan(through);
  });
});

describe('the Steward under attack', () => {
  it('gives every drafted settler their own firing position', () => {
    const world = createWorld(20260729);
    const streams = makeStreams(world);
    const posts = new Set<string>();
    let drafted = 0;
    // Runs until the first raid puts two settlers on the line, rather than
    // warming up a fixed fortnight first. What this test is about happens the
    // moment the Steward drafts anybody — on this seed, day three, half a second
    // in. The twenty-two day version this replaced spent the other twenty-one
    // days re-simulating a colony that had already answered the question, and
    // once prisoners started swelling the population past fifteen it went over
    // the suite's timeout for reasons that had nothing to do with firing posts.
    for (let t = 0; t < TICKS_PER_DAY * 10; t++) {
      stepWorldN(world, streams, 1);
      stewardTick(world, world.tick);
      const fighting = livingColonists(world).filter((p) => p.drafted && !p.downed);
      if (fighting.length < 2) continue;
      drafted = Math.max(drafted, fighting.length);
      for (const p of fighting) {
        if (p.orderX === null || p.orderY === null) continue;
        posts.add(`${p.orderX},${p.orderY}`);
      }
      if (posts.size >= fighting.length) break;
    }
    expect(drafted).toBeGreaterThan(1);
    // One post each. Stacking the colony on a single tile is how six raiders
    // shot five settlers down without having to aim at more than one cell.
    expect(posts.size).toBeGreaterThan(1);
  });
});
