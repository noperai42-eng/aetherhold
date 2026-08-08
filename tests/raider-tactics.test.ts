/**
 * Raiders answer the gun, and take the ground seriously.
 *
 * Two defects sat under every fight in the game, and both of them made the
 * defence tests above look better than the game was:
 *
 *  - **A turret could not be destroyed.** Raider AI only ever swung at a
 *    building when it had no route to a colonist at all, and a bullet only ever
 *    checked for bodies — a turret is 1.4 high, under `SHOOT_OVER_HEIGHT`, so
 *    rounds flew straight over the cell it stood on. One 30-steel emplacement
 *    therefore won every raid for the rest of the game, unaided, forever, which
 *    is not a defence so much as an ending.
 *  - **Cover was a colony-only mechanic.** A rifle raider stopped the moment
 *    they were comfortably in range, wherever that put them, and it usually put
 *    them in the open. Two settlers behind sandbags beat any number of them
 *    without the raid ever trying to solve the sandbags.
 *
 * So a raider now shoots the nearer of (the settler, the live turret), a round
 * aimed at a machine stops on that machine, and a rifleman with somewhere to
 * hide walks two paces to get behind it. These tests pin each of those, and the
 * last one plays the whole thing out through the real tick.
 */

import { describe, expect, it } from 'vitest';

import { TURRET_STATS, fireWeapon, tickCombat } from '../src/sim/combat';
import { buildingAt, dist, isWalkable } from '../src/sim/grid';
import { tickPower } from '../src/sim/power';
import { rebuildPlans } from '../src/sim/rebuild';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import type { Building, Pawn, World } from '../src/sim/types';
import { addBuilding, addItem, findBuilding } from '../src/sim/world';
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
 * Send the starter settlers to the far corner.
 *
 * They are not what any of this is about, and `nearestEnemy` searches the whole
 * map: left where worldgen put them, whether a raider's nearest problem is the
 * gun in front of them or a cook three rooms away becomes a property of the
 * seed. Out of the way, every distance in this file is one the test set.
 */
function banish(world: World): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    p.x = world.width - 3;
    p.y = world.height - 3;
    p.path = null;
  }
}

/** A turret, and — if it is meant to work — the firebox that runs it. */
function emplacement(world: World, x: number, y: number, live: boolean): Building {
  const turret = addBuilding(world, 'turret', x, y, true);
  expect(turret).not.toBeNull();
  if (live) {
    expect(addBuilding(world, 'generator', x + 1, y, true)).not.toBeNull();
    // Fuel it properly rather than setting the flag by hand: an unpowered turret
    // is the subject of one of the tests below, so "powered" has to mean the
    // same thing here as it does in a game.
    addItem(world, 'wood', 60, x + 3, y + 3);
    tickPower(world);
    expect(turret!.powered).toBe(true);
  }
  return turret!;
}

/**
 * A settler who stays where they were put.
 *
 * Left alone an unarmed colonist under fire runs, which is right, and which
 * would turn every distance below into a moving target. Call the returned
 * function each tick.
 */
function pinned(world: World, rng: Rng, x: number, y: number): { pawn: Pawn; hold: () => void } {
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

/** A raider who is here to be studied, not to die of the answer. */
function attacker(world: World, rng: Rng, x: number, y: number): Pawn {
  const pawn = makePawn(world, rng, 'raider', x, y, { name: 'Vek', weapon: 'rifle' });
  pawn.maxHp = 10_000;
  pawn.hp = 10_000;
  return pawn;
}

describe('a raider facing an emplacement', () => {
  it('shoots the gun that is shooting at them', () => {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 10, 10);
    const turret = emplacement(world, c.x + 1, c.y + 1, true);
    const rng = new Rng(7);
    const raider = attacker(world, rng, c.x + 1, c.y + 6);
    // The gun is five cells away and the nearest settler is most of the map
    // away. Whatever else a raider does, it should not be walking past this.
    expect(dist(raider.x, raider.y, turret.x, turret.y)).toBeLessThan(
      Math.min(...world.pawns.filter((p) => p.faction === 'colony').map((p) => dist(raider.x, raider.y, p.x, p.y))),
    );

    const before = turret.hp;
    for (let t = 0; t < 400; t++) tickCombat(world, rng, null);
    expect(turret.hp).toBeLessThan(before);
  });

  it('can take one down, and the colony books the rebuild', () => {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 10, 10);
    const turret = emplacement(world, c.x + 1, c.y + 1, true);
    const id = turret.id;
    const rng = new Rng(7);
    attacker(world, rng, c.x + 1, c.y + 6);

    let gone = false;
    for (let t = 0; t < 4000 && !gone; t++) {
      tickCombat(world, rng, null);
      gone = findBuilding(world, id) === null;
    }
    // This is the whole point of the slice. Steel spent on a turret buys a fight
    // the colony wins more easily, not a fight it cannot lose.
    expect(gone).toBe(true);
    expect(rebuildPlans(world).some((p) => p.kind === 'turret' && p.x === c.x + 1 && p.y === c.y + 1)).toBe(true);
  });

  it('ignores a turret with no power on it', () => {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 10, 10);
    const turret = emplacement(world, c.x + 1, c.y + 1, false);
    const rng = new Rng(7);
    const raider = attacker(world, rng, c.x + 1, c.y + 5);
    const bait = pinned(world, rng, c.x + 7, c.y + 5);
    // Four cells to the dead turret, six to the cook: nearest is the turret, and
    // a raider who stopped to demolish it would be a raider the brownout just
    // bought the colony ten free seconds from.
    expect(dist(raider.x, raider.y, turret.x, turret.y)).toBeLessThan(dist(raider.x, raider.y, bait.pawn.x, bait.pawn.y));

    const before = turret.hp;
    for (let t = 0; t < 600; t++) {
      bait.hold();
      tickCombat(world, rng, null);
    }
    expect(turret.hp).toBe(before);
    // And they were fighting, not standing about: the assertion above proves
    // nothing on its own if the raider never fired at anything.
    expect(bait.pawn.hp).toBeLessThan(bait.pawn.maxHp);
  });

  it('answers whichever of the gun and the settler is nearer', () => {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 10, 10);
    const turret = emplacement(world, c.x + 1, c.y + 1, true);
    const rng = new Rng(7);
    const raider = attacker(world, rng, c.x + 1, c.y + 8);
    const bait = pinned(world, rng, c.x + 5, c.y + 8);
    // Live turret at seven, a settler at four. The turret is a real threat and
    // is firing back — it is still not the closer problem.
    expect(dist(raider.x, raider.y, bait.pawn.x, bait.pawn.y)).toBeLessThan(
      dist(raider.x, raider.y, turret.x, turret.y),
    );

    const before = turret.hp;
    for (let t = 0; t < 600; t++) {
      bait.hold();
      tickCombat(world, rng, null);
    }
    expect(bait.pawn.hp).toBeLessThan(bait.pawn.maxHp);
    expect(turret.hp).toBe(before);
  });
});

describe('a round aimed at a machine', () => {
  /** Fire `shots` deliberately-aimed rounds at `b` from `(fx, fy)`. */
  function volley(world: World, b: Building, fx: number, fy: number, shots: number): void {
    const rng = new Rng(11);
    const shooter = { id: 90001, faction: 'raider' as const, x: fx, y: fy };
    for (let i = 0; i < shots; i++) {
      const p = fireWeapon(world, shooter, b.x - fx, b.y - fy, TURRET_STATS, rng, 20);
      p.targetBuildingId = b.id;
      for (let t = 0; t < 40; t++) tickCombat(world, rng, null);
    }
  }

  it('stops on the building it was aimed at', () => {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 10, 10);
    const turret = emplacement(world, c.x + 1, c.y + 1, false);
    const before = turret.hp;
    volley(world, turret, c.x + 1, c.y + 8, 12);
    // Without `targetBuildingId` every one of these passes clean over the cell:
    // the turret is under the shoot-over height, so nothing stops it.
    expect(turret.hp).toBeLessThan(before);
    expect(world.projectiles.length).toBe(0);
  });

  it('still hits whoever walks in front of it', () => {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 10, 10);
    const turret = emplacement(world, c.x + 1, c.y + 1, false);
    const rng = new Rng(5);
    const guard = pinned(world, rng, c.x + 1, c.y + 4);
    volley(world, turret, c.x + 1, c.y + 8, 12);
    // Bodies are checked before the aimed-at building, deliberately: standing in
    // front of the turret you are defending is a real mistake and the sim should
    // let you make it.
    expect(guard.pawn.hp).toBeLessThan(guard.pawn.maxHp);
  });
});

describe('a rifleman with somewhere to hide', () => {
  it('moves behind hard cover instead of trading in the open', () => {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 10, 10);
    const rng = new Rng(13);
    const bait = pinned(world, rng, c.x + 2, c.y + 1);
    const raider = attacker(world, rng, c.x + 2, c.y + 7);
    // One line of sandbags between the two of them. The cell just south of it is
    // the only spot within a few paces that both has a shot and has something
    // solid between it and the incoming fire.
    expect(addBuilding(world, 'sandbag', c.x + 2, c.y + 4, true)).not.toBeNull();

    for (let t = 0; t < 300; t++) {
      bait.hold();
      tickCombat(world, rng, null);
    }
    expect(Math.round(raider.x)).toBe(c.x + 2);
    expect(Math.round(raider.y)).toBe(c.y + 5);
  });

  it('holds ground when there is nothing to get behind', () => {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 10, 10);
    const rng = new Rng(13);
    const bait = pinned(world, rng, c.x + 2, c.y + 1);
    const raider = attacker(world, rng, c.x + 2, c.y + 7);
    const start = { x: raider.x, y: raider.y };

    for (let t = 0; t < 300; t++) {
      bait.hold();
      tickCombat(world, rng, null);
    }
    // Same fight, bare ground: a raider who wandered off looking for cover that
    // does not exist would read as a raid that has lost interest.
    expect(dist(raider.x, raider.y, start.x, start.y)).toBeLessThan(1);
  });
});

/**
 * The other half of the same rule.
 *
 * Cover is a property of the ground, not of the faction standing on it, so the
 * moment raiders started using it a colony that stood in the open through every
 * ambush read as broken. These pin the shape of the answer: a settler nobody has
 * drafted backs *to* something, a settler you drafted stands exactly where you
 * put them, and a settler with no gun still runs.
 */
describe('a settler under fire that nobody has drafted', () => {
  /** Raider, sandbag line, settler — in that order, four cells apart. */
  function ambush(seed: number, weapon: 'rifle' | 'none') {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 10, 10);
    const rng = new Rng(seed);
    const raider = attacker(world, rng, c.x + 2, c.y + 3);
    for (let x = c.x; x <= c.x + 6; x++) {
      expect(addBuilding(world, 'sandbag', x, c.y + 5, true)).not.toBeNull();
    }
    const settler = makePawn(world, rng, 'colony', c.x + 2, c.y + 7, { name: 'Ward', weapon });
    settler.maxHp = 10_000;
    settler.hp = 10_000;
    // The raider is scenery here: left to its own devices it goes looking for its
    // own cover and the settler's distances stop being ones this test set.
    const hold = () => {
      raider.x = c.x + 2;
      raider.y = c.y + 3;
      raider.path = null;
    };
    return { world, c, rng, raider, settler, hold };
  }

  it('backs to the near side of the sandbags rather than straight away', () => {
    const { world, c, rng, settler, hold } = ambush(7, 'rifle');
    for (let t = 0; t < 300; t++) {
      hold();
      tickCombat(world, rng, null);
    }
    expect(Math.round(settler.x)).toBe(c.x + 2);
    expect(Math.round(settler.y)).toBe(c.y + 6);
    // Said the way it matters: whatever cell they chose, there is something solid
    // between them and the muzzle.
    const between = buildingAt(world, Math.round(settler.x), Math.round(settler.y) - 1);
    expect(between?.kind).toBe('sandbag');
  });

  it('stands where you put them once you have drafted them', () => {
    const { world, rng, settler, hold } = ambush(7, 'rifle');
    settler.drafted = true;
    const start = { x: settler.x, y: settler.y };
    for (let t = 0; t < 300; t++) {
      hold();
      tickCombat(world, rng, null);
    }
    // Drafting means you own the position. A drafted settler who wandered two
    // cells to a spot they liked better would take a killbox apart from inside.
    expect(dist(settler.x, settler.y, start.x, start.y)).toBeLessThan(0.05);
  });

  it('still just runs when there is nothing to shoot back with', () => {
    const { world, rng, raider, settler, hold } = ambush(7, 'none');
    const before = dist(settler.x, settler.y, raider.x, raider.y);
    for (let t = 0; t < 300; t++) {
      hold();
      tickCombat(world, rng, null);
    }
    expect(dist(settler.x, settler.y, raider.x, raider.y)).toBeGreaterThan(before + 3);
  });
});

describe('a raid on a lone turret, played out', () => {
  it('costs the colony the gun and leaves a rebuild waiting', () => {
    const world = createWorld(4242);
    banish(world);
    const c = clearing(world, 10, 10);
    const turret = emplacement(world, c.x + 1, c.y + 1, true);
    const id = turret.id;
    const rng = new Rng(21);
    // Three of them, spread across the approach, at a range the turret can
    // answer. Nobody is given extra hit points here: this is the trade as a
    // player would see it, run through the real tick — power, jobs, rebuild
    // planning and all — rather than through `tickCombat` alone.
    for (let i = 0; i < 3; i++) {
      makePawn(world, rng, 'raider', c.x + i * 3 + 1, c.y + 8, { name: `Raider ${i}`, weapon: 'rifle' });
    }

    const streams = makeStreams(world);
    let gone = false;
    for (let t = 0; t < 2400 && !gone; t++) {
      stepWorldN(world, streams, 1);
      gone = findBuilding(world, id) === null;
    }
    expect(gone).toBe(true);
    expect(rebuildPlans(world).some((p) => p.kind === 'turret' && p.x === c.x + 1 && p.y === c.y + 1)).toBe(true);
    // The gun did not go quietly — at least one of them paid for it.
    const raiders = world.pawns.filter((p) => p.faction === 'raider');
    expect(raiders.some((p) => p.downed || p.hp < p.maxHp)).toBe(true);
  });
});
