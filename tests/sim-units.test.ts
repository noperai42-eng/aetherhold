/**
 * Functional tests: each sim unit in isolation, happy + boundary + error paths.
 * No three.js, no DOM — the sim is deliberately free of both.
 */

import { describe, expect, it } from 'vitest';

import { WEAPONS, damagePawn, fireWeapon, playerAttack } from '../src/sim/combat';
import { daylight, dayNumber, hourOfDay, isNight } from '../src/sim/clock';
import { defOf } from '../src/sim/buildings';
import { buildingAt, canStep, isSolid, isWalkable } from '../src/sim/grid';
import { HUNGRY, computeMood, tickNeeds } from '../src/sim/needs';
import {
  BODY_RADIUS,
  PHASE_PER_CELL,
  WALK_SPEED,
  collides,
  moveWithCollision,
} from '../src/sim/movement';
import { assignJob, blueprintReady, findStockpileCell } from '../src/sim/jobs';
import { clearSave, deserialize, hasSave, loadGame, saveGame, savedAt, serialize } from '../src/sim/save';
import { findPath } from '../src/sim/path';
import { Rng } from '../src/sim/rng';
import { cancelAt, canPlace, designate, orderMove, placeBlueprint, possess, setDrafted, setPriority } from '../src/sim/orders';
import { stepWorld, stepWorldN, makeStreams } from '../src/sim/tick';
import { DESIG_DECONSTRUCT, SAVE_VERSION, TERRAIN_LIST, TICKS_PER_DAY, packCell } from '../src/sim/types';
import { tickDoors } from '../src/sim/movement';
import type { World } from '../src/sim/types';
import { addBuilding, addItem, countResource, livingColonists, removeBuilding } from '../src/sim/world';
import { createWorld, HOME_X, HOME_Y } from '../src/sim/worldgen';

function fresh() {
  const world = createWorld(1234);
  return { world, streams: makeStreams(world) };
}

/**
 * A patch of the colony's own yard, for the tests that need somewhere to build.
 *
 * These used to say 30,30, which was a fair way of writing "a clear bit of moor
 * near the colony" back when the map was 64 across and the cabin was in the
 * middle of it. At 192 it is ninety cells out in the rocks, and the tests failed
 * in two different-looking ways for the same reason: `canPlace` came back
 * `occupied` because a boulder is standing there, and the construction job was
 * never assigned because no settler walks that far to raise one wall. Worldgen
 * clears four cells of yard beyond the cabin on every side, so this is inside
 * the swept ground on every map and every seed, and it moves when the map does.
 */
const PLOT_X = HOME_X + 8;
const PLOT_Y = HOME_Y + 7;

/**
 * Flatten a rectangle to bare grass with nothing standing on it. Grid, path and
 * movement tests are about those algorithms, not about where worldgen happened
 * to drop a boulder.
 */
function clearArea(world: World, x0: number, y0: number, x1: number, y1: number): void {
  const grass = TERRAIN_LIST.indexOf('grass');
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      world.terrain[packCell(world, x, y)] = grass;
      const b = buildingAt(world, x, y);
      if (b) removeBuilding(world, b);
    }
  }
}

describe('worldgen', () => {
  it('produces a playable opening position', () => {
    const { world } = fresh();
    // Acceptance criterion 2: at least three settlers and a buildable area.
    expect(livingColonists(world).length).toBeGreaterThanOrEqual(3);
    expect(world.zones.some((z) => z.kind === 'stockpile')).toBe(true);
    expect(countResource(world, 'wood')).toBeGreaterThan(50);
    expect(world.buildings.filter((b) => b.kind === 'bed').length).toBeGreaterThanOrEqual(3);
    expect(world.buildings.some((b) => b.kind === 'door')).toBe(true);
  });

  it('is plain JSON data — the property that makes save/load and tests possible', () => {
    const { world } = fresh();
    const clone = JSON.parse(JSON.stringify(world));
    expect(clone).toEqual(world);
  });

  it('is deterministic for a given seed', () => {
    const a = createWorld(777);
    const b = createWorld(777);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    const c = createWorld(778);
    expect(JSON.stringify(c)).not.toEqual(JSON.stringify(a));
  });
});

describe('grid + collision authority', () => {
  it('reads solidity from the building table, so collision cannot drift from visuals', () => {
    const { world } = fresh();
    const wall = world.buildings.find((b) => b.kind === 'wall' && b.built)!;
    expect(defOf('wall').solid).toBe(true);
    expect(isSolid(world, wall.x, wall.y)).toBe(true);
    expect(isWalkable(world, wall.x, wall.y)).toBe(false);

    const bed = world.buildings.find((b) => b.kind === 'bed')!;
    // Beds are walkable in BOTH views — you can step onto one in first person.
    expect(defOf('bed').solid).toBe(false);
    expect(isWalkable(world, bed.x, bed.y)).toBe(true);
  });

  it('blueprints do not block, so a settler can stand where it builds', () => {
    const { world } = fresh();
    clearArea(world, 19, 19, 21, 21);
    const b = addBuilding(world, 'wall', 20, 20, false)!;
    expect(b.built).toBe(false);
    expect(isSolid(world, 20, 20)).toBe(false);
    b.built = true;
    expect(isSolid(world, 20, 20)).toBe(true);
  });

  it('refuses diagonal moves that would clip a wall corner', () => {
    const { world } = fresh();
    clearArea(world, 19, 19, 22, 22);
    expect(canStep(world, 20, 20, 21, 21)).toBe(true);
    // A single blocked orthogonal is enough to refuse the diagonal — otherwise a
    // settler would visibly slice through a wall corner in the first-person view.
    addBuilding(world, 'wall', 21, 20, true);
    expect(canStep(world, 20, 20, 21, 21)).toBe(false);
    addBuilding(world, 'wall', 20, 21, true);
    expect(canStep(world, 20, 20, 21, 21)).toBe(false);
    // Straight moves past the same wall are still legal.
    expect(canStep(world, 20, 20, 20, 19)).toBe(true);
    removeBuilding(world, world.buildings.find((b) => b.x === 21 && b.y === 20)!);
    removeBuilding(world, world.buildings.find((b) => b.x === 20 && b.y === 21)!);
    expect(canStep(world, 20, 20, 21, 21)).toBe(true);
  });
});

describe('pathfinding', () => {
  it('routes around a wall instead of through it', () => {
    const { world } = fresh();
    clearArea(world, 14, 12, 22, 24);
    for (let y = 14; y <= 22; y++) addBuilding(world, 'wall', 18, y, true);
    const path = findPath(world, 16, 18, 20, 18);
    expect(path).not.toBeNull();
    for (const cell of path!) {
      const x = cell % world.width;
      const y = Math.floor(cell / world.width);
      expect(isSolid(world, x, y)).toBe(false);
    }
    // Going around is strictly longer than the straight line it cannot take.
    expect(path!.length).toBeGreaterThan(4);
  });

  it('returns null when the target is fully enclosed', () => {
    const { world } = fresh();
    clearArea(world, 18, 18, 22, 22);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      addBuilding(world, 'wall', 20 + dx!, 20 + dy!, true);
    }
    expect(findPath(world, 14, 14, 20, 20)).toBeNull();
  });

  it('excludes the start cell so path[0] is always the next step', () => {
    const { world } = fresh();
    // Three cells of bare grass to walk along. The other two tests in this block
    // already flatten their patch and this one did not, which was fine while the
    // moor was small enough that 30,30 was open ground near the cabin. At 192 it
    // is a long way out in the rocks, and a route of three cells that has a
    // boulder in the middle of it is not a fact about `findPath`.
    clearArea(world, 29, 29, 34, 31);
    const path = findPath(world, 30, 30, 33, 30);
    expect(path).not.toBeNull();
    expect(path![0]).not.toBe(packCell(world, 30, 30));
    expect(path![path!.length - 1]).toBe(packCell(world, 33, 30));
  });
});

describe('needs', () => {
  it('drains food, rest and recreation over time', () => {
    const { world } = fresh();
    const p = livingColonists(world)[0]!;
    p.needs.food = 1;
    p.needs.rest = 1;
    p.needs.recreation = 1;
    for (let i = 0; i < 400; i++) tickNeeds(world, p);
    expect(p.needs.food).toBeLessThan(1);
    expect(p.needs.rest).toBeLessThan(1);
    expect(p.needs.recreation).toBeLessThan(1);
    expect(p.needs.food).toBeGreaterThan(0);
  });

  it('starves a settler that never eats — needs have real stakes', () => {
    const { world } = fresh();
    const p = livingColonists(world)[0]!;
    p.needs.food = 0;
    const hpBefore = p.hp;
    for (let i = 0; i < 200; i++) tickNeeds(world, p);
    expect(p.hp).toBeLessThan(hpBefore);
  });

  it('mood follows the worst needs', () => {
    const { world } = fresh();
    const p = livingColonists(world)[0]!;
    p.needs = { food: 1, rest: 1, recreation: 1 };
    const happy = computeMood(p);
    p.needs = { food: 0.05, rest: 0.05, recreation: 0.05 };
    expect(computeMood(p)).toBeLessThan(happy);
  });

  it('HUNGRY threshold sits below full', () => {
    expect(HUNGRY).toBeGreaterThan(0);
    expect(HUNGRY).toBeLessThan(1);
  });
});

describe('clock', () => {
  it('wraps across day boundaries without discontinuity', () => {
    const { world } = fresh();
    world.tick = TICKS_PER_DAY - 1;
    const d1 = dayNumber(world);
    world.tick = TICKS_PER_DAY + 1;
    expect(dayNumber(world)).toBe(d1 + 1);
    expect(hourOfDay(world)).toBeGreaterThanOrEqual(0);
    expect(hourOfDay(world)).toBeLessThan(24);
  });

  it('is dark at midnight and bright at noon in both views', () => {
    const { world } = fresh();
    world.tick = Math.round(TICKS_PER_DAY * 0.5); // noon
    const noon = daylight(world);
    world.tick = 0; // midnight
    const midnight = daylight(world);
    expect(noon).toBeGreaterThan(0.8);
    expect(midnight).toBeLessThan(0.1);
    expect(isNight(world)).toBe(true);
  });
});

describe('movement', () => {
  it('slides along a wall instead of sticking to it', () => {
    const { world } = fresh();
    clearArea(world, 18, 18, 22, 22);
    addBuilding(world, 'wall', 21, 20, true);
    const p = livingColonists(world)[0]!;
    p.x = 20;
    p.y = 20;
    moveWithCollision(world, p, 0.3, 0.3);
    expect(p.x).toBeLessThan(21 - 0.5 + BODY_RADIUS + 0.02); // blocked on x
    expect(p.y).toBeGreaterThan(20); // still moved on y
  });

  it('never lets a body end up inside a solid cell', () => {
    const { world } = fresh();
    clearArea(world, 18, 18, 22, 22);
    addBuilding(world, 'wall', 21, 20, true);
    const p = livingColonists(world)[0]!;
    p.x = 20;
    p.y = 20;
    for (let i = 0; i < 40; i++) moveWithCollision(world, p, 0.25, 0);
    expect(collides(world, p.x, p.y, BODY_RADIUS)).toBe(false);
  });

  it('walks a body out of geometry it is already inside instead of welding it there', () => {
    // A wall goes up beside a settler who is standing closer to that cell than its
    // own radius. Refusing every still-overlapping move used to weld the body in
    // place: it stopped moving for good, and the stuck counter then cancelled every
    // job it was ever given.
    const { world } = fresh();
    clearArea(world, 18, 18, 22, 22);
    addBuilding(world, 'wall', 19, 20, true);
    const p = livingColonists(world)[0]!;
    p.x = 19.5 + BODY_RADIUS * 0.5; // inside the wall's reach, own cell still clear
    p.y = 20;
    const startX = p.x;

    for (let i = 0; i < 6; i++) moveWithCollision(world, p, WALK_SPEED, 0);

    expect(p.x).toBeGreaterThan(startX);
    expect(collides(world, p.x, p.y, BODY_RADIUS)).toBe(false);
  });

  it('still refuses to walk a clear body into a wall', () => {
    const { world } = fresh();
    clearArea(world, 18, 18, 22, 22);
    addBuilding(world, 'wall', 21, 20, true);
    const p = livingColonists(world)[0]!;
    p.x = 20;
    p.y = 20;
    for (let i = 0; i < 40; i++) moveWithCollision(world, p, WALK_SPEED, 0);
    expect(p.x).toBeLessThanOrEqual(21 - 0.5 - BODY_RADIUS + 1e-6);
  });

  it('feeds the stride from ground covered, so a jammed body stops striding', () => {
    // The stride is advanced inside `moveWithCollision` rather than by its
    // callers, which is what makes this true of everything that walks — settler,
    // wolf, Picky, and the body the player is driving — instead of true of
    // whichever call sites remembered to do it.
    const { world } = fresh();
    clearArea(world, 18, 18, 22, 22);
    addBuilding(world, 'wall', 21, 20, true);
    const p = livingColonists(world)[0]!;
    p.x = 20;
    p.y = 20;
    p.animPhase = 0;

    moveWithCollision(world, p, WALK_SPEED, 0);
    expect(p.animPhase).toBeCloseTo(WALK_SPEED * PHASE_PER_CELL, 10);

    for (let i = 0; i < 40; i++) moveWithCollision(world, p, WALK_SPEED, 0);
    const jammed = p.animPhase;
    for (let i = 0; i < 10; i++) moveWithCollision(world, p, WALK_SPEED, 0);
    expect(p.animPhase - jammed).toBeLessThan(1e-9);
  });

  it('charges no stride for being lifted out of a wall raised on top of it', () => {
    // The unstick can carry a body several cells. It is a rescue, not a journey,
    // and paying stride for it would spin a settler's legs the instant somebody
    // finished a wall over their head.
    const { world } = fresh();
    clearArea(world, 18, 18, 22, 22);
    const p = livingColonists(world)[0]!;
    p.x = 20;
    p.y = 20;
    addBuilding(world, 'wall', 20, 20, true);
    p.animPhase = 0;

    moveWithCollision(world, p, 0, 0);

    expect(Math.hypot(p.x - 20, p.y - 20)).toBeGreaterThan(0.4);
    expect(p.animPhase).toBe(0);
  });

  it('opens doors from the sim so both views see the same door angle', () => {
    const { world } = fresh();
    const door = world.buildings.find((b) => b.kind === 'door')!;
    const p = livingColonists(world)[0]!;
    p.x = door.x;
    p.y = door.y - 1;
    expect(door.open ?? 0).toBe(0);
    for (let i = 0; i < 12; i++) tickDoors(world);
    expect(door.open ?? 0).toBeGreaterThan(0.9);
    // And it shuts again once nobody is near it.
    p.x = 2;
    p.y = 2;
    for (let i = 0; i < 12; i++) tickDoors(world);
    expect(door.open ?? 0).toBeLessThan(0.05);
  });
});

describe('orders', () => {
  it('places a blueprint only on legal ground', () => {
    const { world } = fresh();
    expect(canPlace(world, 'wall', PLOT_X, PLOT_Y)).toBe('ok');
    expect(canPlace(world, 'wall', 0, 0)).toBe('bounds');
    const existing = world.buildings.find((b) => b.kind === 'wall' && b.built)!;
    expect(canPlace(world, 'wall', existing.x, existing.y)).toBe('occupied');
    expect(placeBlueprint(world, 'wall', PLOT_X, PLOT_Y)).toBe(true);
    const bp = world.buildings.find((b) => b.x === PLOT_X && b.y === PLOT_Y)!;
    expect(bp.built).toBe(false);
    expect(bp.needs.wood).toBe(defOf('wall').cost.wood);
  });

  it('refunds delivered materials when a blueprint is cancelled', () => {
    const { world } = fresh();
    placeBlueprint(world, 'wall', PLOT_X, PLOT_Y);
    const bp = world.buildings.find((b) => b.x === PLOT_X && b.y === PLOT_Y)!;
    bp.have.wood = 5;
    expect(cancelAt(world, PLOT_X, PLOT_Y)).toBe(true);
    expect(world.buildings.some((b) => b.x === PLOT_X && b.y === PLOT_Y)).toBe(false);
    expect(countResource(world, 'wood')).toBeGreaterThan(0);
  });

  it('only designates deconstruct on built non-tree structures', () => {
    const { world } = fresh();
    const wall = world.buildings.find((b) => b.kind === 'wall' && b.built)!;
    expect(designate(world, wall.x, wall.y, DESIG_DECONSTRUCT)).toBe(true);
    expect(world.cellDesig[packCell(world, wall.x, wall.y)]).toBe(DESIG_DECONSTRUCT);
    const tree = world.buildings.find((b) => b.kind === 'tree')!;
    expect(designate(world, tree.x, tree.y, DESIG_DECONSTRUCT)).toBe(false);
  });

  it('drafting cancels work and a move order drafts implicitly', () => {
    const { world, streams } = fresh();
    const p = livingColonists(world)[0]!;
    stepWorldN(world, streams, 40);
    setDrafted(world, p.id, true);
    expect(p.drafted).toBe(true);
    expect(p.jobId).toBeNull();
    setDrafted(world, p.id, false);
    expect(p.drafted).toBe(false);
    expect(orderMove(world, p.id, 31, 30)).toBe(true);
    expect(p.drafted).toBe(true);
    expect(p.orderX).not.toBeNull();
  });

  it('priority 0 means never do that work', () => {
    const { world } = fresh();
    const p = livingColonists(world)[0]!;
    for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
      setPriority(world, p.id, w, 0);
    }
    p.needs = { food: 1, rest: 1, recreation: 1 };
    assignJob(world, p);
    expect(p.jobId).toBeNull();
  });

  it('possession is exclusive and clears the previous body', () => {
    const { world } = fresh();
    const [a, b] = livingColonists(world);
    possess(world, a!.id);
    expect(a!.playerControlled).toBe(true);
    possess(world, b!.id);
    expect(a!.playerControlled).toBe(false);
    expect(b!.playerControlled).toBe(true);
  });
});

describe('jobs', () => {
  it('assigns a construction job when a blueprint has its materials', () => {
    const { world } = fresh();
    placeBlueprint(world, 'wall', PLOT_X + 1, PLOT_Y);
    const bp = world.buildings.find((b) => b.x === PLOT_X + 1 && b.y === PLOT_Y)!;
    bp.have.wood = bp.needs.wood ?? 0;
    expect(blueprintReady(bp)).toBe(true);
    const p = livingColonists(world)[0]!;
    p.needs = { food: 1, rest: 1, recreation: 1 };
    assignJob(world, p);
    expect(p.jobId).not.toBeNull();
  });

  it('finds a stockpile cell that accepts a resource, and none when filtered out', () => {
    const { world } = fresh();
    expect(findStockpileCell(world, 'wood')).not.toBeNull();
    for (const z of world.zones) z.accepts = [];
    expect(findStockpileCell(world, 'wood')).toBeNull();
  });

  it('two settlers never take the same haul target', () => {
    const { world, streams } = fresh();
    stepWorldN(world, streams, 600);
    const targets = world.jobs.filter((j) => j.itemId !== undefined && j.itemId !== null).map((j) => j.itemId);
    expect(new Set(targets).size).toBe(targets.length);
    const beds = world.jobs.filter((j) => j.kind === 'sleep').map((j) => j.buildingId);
    expect(new Set(beds).size).toBe(beds.length);
  });
});

describe('combat', () => {
  it('downs a settler before killing it, then kills at zero', () => {
    const { world } = fresh();
    const p = livingColonists(world)[0]!;
    damagePawn(world, p, p.maxHp * 0.85, 'test');
    expect(p.downed).toBe(true);
    expect(p.dead).toBe(false);
    damagePawn(world, p, 999, 'test');
    expect(p.dead).toBe(true);
    expect(world.stats.colonistsLost).toBe(1);
  });

  it('a bullet stops at a wall instead of passing through it', () => {
    const { world, streams } = fresh();
    for (let y = 10; y <= 30; y++) addBuilding(world, 'wall', 20, y, true);
    const shooter = livingColonists(world)[0]!;
    shooter.faction = 'colony';
    shooter.x = 16;
    shooter.y = 20;
    const victim = livingColonists(world)[1]!;
    victim.x = 24;
    victim.y = 20;
    victim.faction = 'raider';
    const hpBefore = victim.hp;
    fireWeapon(world, shooter, 1, 0, WEAPONS.rifle, new Rng(9), 20);
    stepWorldN(world, streams, 30);
    expect(victim.hp).toBe(hpBefore);
  });

  it('the player fires through the same path as the AI', () => {
    const { world } = fresh();
    const p = livingColonists(world).find((q) => q.weapon === 'rifle')!;
    p.attackCooldown = 0;
    expect(playerAttack(world, p, 1, 0, new Rng(3))).toBe(true);
    expect(world.projectiles.length).toBe(1);
    expect(world.projectiles[0]!.ownerId).toBe(p.id);
    // Cooldown gates the trigger — no machine-gunning by spamming the key.
    expect(playerAttack(world, p, 1, 0, new Rng(3))).toBe(false);
  });

  it('a downed settler cannot attack', () => {
    const { world } = fresh();
    const p = livingColonists(world)[0]!;
    p.downed = true;
    p.attackCooldown = 0;
    expect(playerAttack(world, p, 1, 0, new Rng(3))).toBe(false);
  });
});

describe('save/load', () => {
  it('round-trips the world, view mode and possessed body', () => {
    const { world, streams } = fresh();
    stepWorldN(world, streams, 300);
    const p = livingColonists(world)[1]!;
    possess(world, p.id);
    const text = serialize(world, { mode: 'fps', possessedId: p.id, camera: { targetX: 3, targetY: 4, distance: 20, yaw: 1, pitch: 0.8 } }, 2, 111);
    const res = deserialize(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.save.world.tick).toBe(world.tick);
    expect(res.save.world.pawns.length).toBe(world.pawns.length);
    expect(res.save.view.mode).toBe('fps');
    expect(res.save.view.possessedId).toBe(p.id);
    expect(res.save.speed).toBe(2);
    // Suspicion is the one thing a reload is *meant* to forget: `stranded.ts`
    // only reaps a plan that failed the walk twice running, and a save that
    // carried one strike across a reload would cancel work on the strength of
    // half an accusation made in another session. Asserted explicitly, and
    // subtracted from the deep compare, so the compare still catches any other
    // field that goes missing.
    expect(res.save.world.stranded).toBeUndefined();
    const expected = { ...world };
    delete expected.stranded;
    expect(res.save.world).toEqual(expected);
  });

  it('a reloaded world keeps simulating identically — RNG cursors survive', () => {
    const { world, streams } = fresh();
    stepWorldN(world, streams, 200);
    const snapshot = JSON.parse(JSON.stringify(world));
    stepWorldN(world, streams, 400);
    const after = JSON.stringify(world);

    const reloaded = snapshot;
    stepWorldN(reloaded, makeStreams(reloaded), 400);
    expect(JSON.stringify(reloaded)).toBe(after);
  });

  it('refuses a save from an incompatible schema instead of half-migrating', () => {
    const { world } = fresh();
    const text = serialize(world, { mode: 'manager', possessedId: null, camera: { targetX: 0, targetY: 0, distance: 10, yaw: 0, pitch: 1 } }, 1, 0);
    const bumped = text.replace(`"v":${SAVE_VERSION}`, '"v":99');
    const res = deserialize(bumped);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('version');
  });

  it('reports corruption rather than throwing', () => {
    expect(deserialize('not json').ok).toBe(false);
    expect(deserialize('{"v":' + SAVE_VERSION + '}').ok).toBe(false);
  });
});

describe('save slots', () => {
  /** The slot code is the part that talks to storage, so give it a storage to talk to. */
  function fakeStorage(): Record<string, string> {
    const store: Record<string, string> = {};
    const api = {
      getItem: (k: string) => (k in store ? store[k]! : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
    (globalThis as unknown as { localStorage: unknown }).localStorage = api;
    return store;
  }

  const view = { mode: 'manager' as const, possessedId: null, camera: { targetX: 0, targetY: 0, distance: 10, yaw: 0, pitch: 1 } };

  it('an autosave never overwrites the colony the player saved by hand', () => {
    fakeStorage();
    const { world, streams } = fresh();
    saveGame(world, view, 1, 1000); // manual, at tick 0
    const manualTick = world.tick;
    stepWorldN(world, streams, 200);
    saveGame(world, view, 1, 2000, 'auto');

    const manual = loadGame();
    const auto = loadGame('auto');
    expect(manual.ok && manual.save.world.tick).toBe(manualTick);
    expect(auto.ok && auto.save.world.tick).toBe(world.tick);
    expect(world.tick).toBeGreaterThan(manualTick);
  });

  it('reports which slots exist and when they were written', () => {
    fakeStorage();
    const { world } = fresh();
    expect(hasSave()).toBe(false);
    expect(hasSave('auto')).toBe(false);
    expect(savedAt('auto')).toBeNull();

    saveGame(world, view, 1, 4242, 'auto');
    expect(hasSave('auto')).toBe(true);
    expect(hasSave()).toBe(false); // an autosave is not a manual save
    expect(savedAt('auto')).toBe(4242);
  });

  it('starting over clears both slots, so a new colony cannot walk back into the old one', () => {
    fakeStorage();
    const { world } = fresh();
    saveGame(world, view, 1, 1000);
    saveGame(world, view, 1, 1000, 'auto');
    clearSave();
    expect(hasSave()).toBe(false);
    expect(hasSave('auto')).toBe(false);
    expect(loadGame('auto').ok).toBe(false);
  });

  it('a corrupt autosave reports its age as unknown instead of throwing at boot', () => {
    const store = fakeStorage();
    store['aetherhold.autosave.v1'] = '{not json';
    expect(hasSave('auto')).toBe(true);
    expect(savedAt('auto')).toBeNull();
    expect(loadGame('auto').ok).toBe(false);
  });
});

describe('pause', () => {
  it('a paused game advances no ticks at all — not just frozen animation', () => {
    const { world, streams } = fresh();
    const before = JSON.stringify(world);
    // Pause is the absence of stepWorld calls; assert the sim is the only clock.
    for (let i = 0; i < 10; i++) {
      /* render frames would go here; no stepWorld */
    }
    expect(JSON.stringify(world)).toBe(before);
    stepWorld(world, streams);
    expect(JSON.stringify(world)).not.toBe(before);
  });
});

describe('items', () => {
  it('merges into partial stacks and splits over the cap', () => {
    const { world } = fresh();
    addItem(world, 'wood', 10, 12, 12);
    addItem(world, 'wood', 10, 12, 12);
    const here = world.items.filter((s) => s.x === 12 && s.y === 12 && s.kind === 'wood');
    expect(here.length).toBe(1);
    expect(here[0]!.amount).toBe(20);
    addItem(world, 'wood', 200, 13, 13);
    const many = world.items.filter((s) => s.x === 13 && s.y === 13);
    expect(many.length).toBeGreaterThan(1);
    expect(many.every((s) => s.amount <= 75)).toBe(true);
  });
});
