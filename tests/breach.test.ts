/**
 * A raid goes through the fence, not round it.
 *
 * A fence is three wood and seventy hit points. Until now a raider treated one
 * exactly as it treated a mountain: route round it, and if there was no round,
 * stand in the field facing the rail until its nerve went. That made the
 * cheapest item on the build bar into a wall the colony never had to pay for —
 * ring the yard in timber and the raid solved itself.
 *
 * Ranked by what it costs to get wrong. Worst is the closed pen: a settler
 * fenced in was a settler no raid could reach, which is the whole defence layer
 * broken with three wood. Next is the detour — a raider that breaks *every*
 * fence it passes is vandalism rather than a raid, and it would make the goat
 * pen a liability instead of a pen. Last is the one that says the hole is a real
 * hole and the raid comes through it, because a breach nobody can walk through
 * is scenery.
 */

import { describe, expect, it } from 'vitest';

import { WEAPONS, tickCombat } from '../src/sim/combat';
import { dist, isWalkable } from '../src/sim/grid';
import { findPath } from '../src/sim/path';
import { Rng } from '../src/sim/rng';
import type { Building, Pawn, World } from '../src/sim/types';
import { addBuilding } from '../src/sim/world';
import { createWorld, makePawn } from '../src/sim/worldgen';

/** Open ground, clear of worldgen's cabin, its rocks and its trees. */
function clearing(world: World, w: number, h: number): { x: number; y: number } {
  for (let y = 4; y < world.height - h - 4; y++) {
    for (let x = 4; x < world.width - w - 4; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) {
        for (let dx = 0; dx < w && ok; dx++) {
          if (!isWalkable(world, x + dx, y + dy)) ok = false;
          if (world.cellBuilding[(y + dy) * world.width + x + dx]! >= 0) ok = false;
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error(`no ${w}x${h} clearing on this seed`);
}

/**
 * Send the starter settlers to the far corner, so the only colonist that counts
 * as the raid's nearest problem is the one this file put there.
 */
function banish(world: World): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    p.x = world.width - 3;
    p.y = world.height - 3;
    p.path = null;
  }
}

/**
 * A settler who stays where they were put and cannot be killed.
 *
 * The subject here is the fence, not the funeral: a colonist who runs, or who
 * dies and stops being a target, turns every measurement below into a race.
 */
function bait(world: World, rng: Rng, x: number, y: number): { pawn: Pawn; hold: () => void } {
  const pawn = makePawn(world, rng, 'colony', x, y, { name: 'Bait', weapon: 'none' });
  pawn.maxHp = 10_000;
  pawn.hp = 10_000;
  return {
    pawn,
    hold: () => {
      pawn.x = x;
      pawn.y = y;
      pawn.path = null;
    },
  };
}

/**
 * A raider with a club.
 *
 * Deliberately not a rifle: a fence is under `SHOOT_OVER_HEIGHT`, so a rifleman
 * shoots across one and never has to solve it. The raider who has to get at you
 * is the one that makes a fence mean anything, and it is the one being tested.
 */
function brawler(world: World, rng: Rng, x: number, y: number): Pawn {
  const pawn = makePawn(world, rng, 'raider', x, y, { name: 'Vek', weapon: 'club' });
  pawn.maxHp = 10_000;
  pawn.hp = 10_000;
  expect(WEAPONS[pawn.weapon].melee).toBe(true);
  return pawn;
}

/**
 * A square of fence `r` cells out from the middle, optionally with one rail left
 * out on the east side as a gate.
 */
function pen(world: World, cx: number, cy: number, r: number, gate = false): Building[] {
  const rails: Building[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (gate && dx === r && dy === 0) continue;
      const b = addBuilding(world, 'fence', cx + dx, cy + dy, true);
      expect(b).not.toBeNull();
      rails.push(b!);
    }
  }
  return rails;
}

/** Run the fight, holding the bait still, and hand back the tick it ended on. */
function fight(world: World, rng: Rng, hold: () => void, ticks: number, done: () => boolean): number {
  for (let t = 0; t < ticks; t++) {
    hold();
    tickCombat(world, rng, null);
    world.tick++;
    if (done()) return t;
  }
  return ticks;
}

describe('a raider and a fence in the way', () => {
  it('breaks into a pen with no gate rather than standing outside it', () => {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 13, 13);
    const cx = c.x + 6;
    const cy = c.y + 6;
    const held = bait(world, new Rng(3), cx, cy);
    const rails = pen(world, cx, cy, 3);
    // A closed ring: no route exists, which is exactly the case the old code
    // answered by doing nothing at all.
    expect(rails.every((b) => !isWalkable(world, b.x, b.y))).toBe(true);

    const rng = new Rng(11);
    const raider = brawler(world, rng, cx - 9, cy);
    const standing = () => rails.filter((b) => world.buildings.some((q) => q.id === b.id)).length;
    const before = standing();

    fight(world, rng, held.hold, 1200, () => standing() < before);
    expect(standing()).toBeLessThan(before);
    // And it is a hole in the near side, walked to on purpose — not a rail that
    // happened to be under the raider's nose where it spawned.
    const gone = rails.find((b) => !world.buildings.some((q) => q.id === b.id))!;
    expect(dist(gone.x, gone.y, raider.x, raider.y)).toBeLessThan(3);
  });

  it('goes through the near rail rather than all the way round to the gate', () => {
    // The case the player actually built: a fenced yard with a way in, on the
    // far side. A route exists, so nothing here is forced — the raider prices
    // the walk against the timber and picks the timber, which is the whole
    // behaviour the fence was silently missing.
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 13, 13);
    const cx = c.x + 6;
    const cy = c.y + 6;
    const held = bait(world, new Rng(3), cx, cy);
    const rails = pen(world, cx, cy, 3, true);

    const rng = new Rng(11);
    const raider = brawler(world, rng, cx - 9, cy);
    // There genuinely is a way in without breaking anything. Without this the
    // test would pass on the closed-pen path and prove nothing new.
    expect(findPath(world, Math.round(raider.x), Math.round(raider.y), cx, cy)).not.toBeNull();

    const standing = () => rails.filter((b) => world.buildings.some((q) => q.id === b.id)).length;
    const before = standing();
    fight(world, rng, held.hold, 1200, () => standing() < before);
    expect(standing()).toBeLessThan(before);
    // And it went through the side it was already on, not round to the gate and
    // then through a rail for no reason.
    const gone = rails.find((b) => !world.buildings.some((q) => q.id === b.id))!;
    expect(gone.x).toBeLessThan(cx);
  });

  it('walks round a rail that is barely in the way, and leaves it standing', () => {
    // The other half of the rule. A raid that chews through every fence it
    // passes turns the goat pen into a liability and reads as vandalism; the
    // question is whether the detour costs more than the timber, and three
    // cells of rail across open ground does not.
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 15, 11);
    const held = bait(world, new Rng(3), c.x + 12, c.y + 5);
    const stub: Building[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      const b = addBuilding(world, 'fence', c.x + 6, c.y + 5 + dy, true);
      expect(b).not.toBeNull();
      stub.push(b!);
    }
    const hp = stub.map((b) => b.hp);

    const rng = new Rng(11);
    const raider = brawler(world, rng, c.x + 1, c.y + 5);
    fight(world, rng, held.hold, 900, () => dist(raider.x, raider.y, held.pawn.x, held.pawn.y) < 2);

    expect(stub.map((b) => b.hp)).toEqual(hp);
    // It got there anyway, which is what makes the untouched rail a choice
    // rather than a raider that could not find the settler in the first place.
    expect(dist(raider.x, raider.y, held.pawn.x, held.pawn.y)).toBeLessThan(3);
  });
});

describe('the raid the player watches', () => {
  it('comes through the hole it made and reaches the settler behind the fence', () => {
    // The experience half: no assertions about ids or hit points, just the
    // thing the player sees. Fence your colony in with timber and the raid
    // still arrives — later, and three wood poorer, which is the trade a fence
    // is supposed to be.
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 13, 13);
    const cx = c.x + 6;
    const cy = c.y + 6;
    const held = bait(world, new Rng(3), cx, cy);
    pen(world, cx, cy, 3);

    const rng = new Rng(11);
    const raider = brawler(world, rng, cx - 9, cy);
    const inside = () => Math.max(Math.abs(raider.x - cx), Math.abs(raider.y - cy)) < 3;
    expect(fight(world, rng, held.hold, 2400, inside)).toBeLessThan(2400);
    // Through the rail is not the point on its own — the point is that the raid
    // arrives. Keep ticking from the moment it is over the line.
    fight(world, rng, held.hold, 600, () => held.pawn.hp < held.pawn.maxHp);
    expect(held.pawn.hp).toBeLessThan(held.pawn.maxHp);
  });
});
