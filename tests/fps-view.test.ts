/**
 * Experience tests for the body you possess. These drive `FpsController` exactly as
 * the render loop does — same sim, same collision, same combat call — with a stand-in
 * `Input` so the trigger can be pulled without a browser. Pointer lock is not grantable
 * in headless Chrome (`WrongDocumentError`), so this is where click-to-fire is proven.
 */

import { describe, expect, it } from 'vitest';

import { BODY_RADIUS, penetration } from '../src/sim/movement';
import { PHASE_PER_CELL } from '../src/client/gait';
import { FpsController } from '../src/client/fps/controller';
import { describeTarget, interact } from '../src/sim/interact';
import { isWalkable } from '../src/sim/grid';
import { possess, setDrafted } from '../src/sim/orders';
import { Rng } from '../src/sim/rng';
import { addBuilding } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import type { Input } from '../src/client/input/input';
import type { Building, Pawn, World } from '../src/sim/types';

/** Only the fields the controller reads. Cast, so a real Input change breaks this. */
function fakeInput(
  opts: {
    held?: string[];
    locked?: boolean;
    buttons?: number[];
    moveX?: number;
    moveY?: number;
  } = {},
): Input {
  const down = new Set(opts.held ?? []);
  return {
    down,
    mouseButtons: new Set(opts.buttons ?? []),
    locked: opts.locked ?? false,
    moveX: opts.moveX ?? 0,
    moveY: opts.moveY ?? 0,
    held: (code: string) => down.has(code),
  } as unknown as Input;
}

function bodyIn(world: World): Pawn {
  const pawn = world.pawns[0]!;
  possess(world, pawn.id);
  return pawn;
}

/** A cell that is clear, whose +X neighbour is also clear — room to walk one step east. */
function clearRun(world: World): { x: number; y: number } {
  for (let y = 2; y < world.height - 2; y++) {
    for (let x = 2; x < world.width - 3; x++) {
      if (isWalkable(world, x, y) && isWalkable(world, x + 1, y) && isWalkable(world, x + 2, y)) {
        return { x, y };
      }
    }
  }
  throw new Error('worldgen produced no open ground');
}

describe('pulling the trigger in first person', () => {
  it('fires the possessed settler’s weapon on a held click while drafted', () => {
    const world = createWorld(77);
    const streams = makeStreams(world);
    const pawn = bodyIn(world);
    pawn.weapon = 'rifle';
    pawn.attackCooldown = 0;
    setDrafted(world, pawn.id, true);

    const fps = new FpsController();
    fps.attach(pawn);
    fps.yaw = 0;
    fps.applyTick(world, pawn, fakeInput({ locked: true, buttons: [0] }), new Rng(9));

    const mine = world.projectiles.filter((p) => p.ownerId === pawn.id);
    expect(mine.length).toBe(1);
    expect(pawn.attackCooldown).toBeGreaterThan(0);
    // The bullet is a normal sim projectile: it travels and expires like any other.
    stepWorld(world, streams);
    expect(mine[0]!.x).not.toBe(pawn.x);
  });

  it('shoots nothing while undrafted, so an exploring settler cannot fire by accident', () => {
    const world = createWorld(77);
    const pawn = bodyIn(world);
    pawn.weapon = 'rifle';
    pawn.attackCooldown = 0;
    setDrafted(world, pawn.id, false);

    new FpsController().applyTick(world, pawn, fakeInput({ locked: true, buttons: [0] }), new Rng(9));

    expect(world.projectiles.length).toBe(0);
  });

  it('shoots nothing until the pointer is captured, so the click that grabs the mouse is not a shot', () => {
    const world = createWorld(77);
    const pawn = bodyIn(world);
    pawn.weapon = 'rifle';
    pawn.attackCooldown = 0;
    setDrafted(world, pawn.id, true);

    new FpsController().applyTick(world, pawn, fakeInput({ locked: false, buttons: [0] }), new Rng(9));

    expect(world.projectiles.length).toBe(0);
  });

  it('cannot fire faster than the weapon’s cooldown', () => {
    const world = createWorld(77);
    const streams = makeStreams(world);
    const pawn = bodyIn(world);
    pawn.weapon = 'rifle';
    pawn.attackCooldown = 0;
    setDrafted(world, pawn.id, true);

    const fps = new FpsController();
    const input = fakeInput({ locked: true, buttons: [0] });
    for (let t = 0; t < 4; t++) {
      fps.applyTick(world, pawn, input, new Rng(t));
      stepWorld(world, streams);
    }

    expect(pawn.attackCooldown).toBeGreaterThan(0);
    expect(world.projectiles.filter((p) => p.ownerId === pawn.id).length).toBeLessThanOrEqual(1);
  });
});

/** Stand the body on a clear cell beside `b`, looking at it, as a player would. */
function standFacing(world: World, pawn: Pawn, fps: FpsController, b: Building): void {
  const spot = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([dx, dy]) => ({ x: b.x + dx!, y: b.y + dy! }))
    .find((c) => isWalkable(world, c.x, c.y));
  if (!spot) throw new Error(`nothing to stand on beside the ${b.kind}`);
  pawn.x = spot.x;
  pawn.y = spot.y;
  fps.attach(pawn);
  fps.yaw = Math.atan2(b.y - pawn.y, b.x - pawn.x);
  fps.applyTick(world, pawn, fakeInput({ locked: true }), new Rng(1));
}

describe('sleeping in a real bed in first person', () => {
  it('puts the body in the bed and rest climbs — E is not just a message', () => {
    const world = createWorld(77);
    const streams = makeStreams(world);
    const pawn = bodyIn(world);
    const bed = world.buildings.find((b) => b.kind === 'bed' && b.built);
    expect(bed, 'worldgen should hand the colony beds').toBeDefined();
    pawn.needs.rest = 0.4; // tired enough that the job will not finish on arrival
    pawn.needs.food = 0.6;

    const fps = new FpsController();
    standFacing(world, pawn, fps, bed!);
    expect(describeTarget(world, pawn)?.verb).toBe('Sleep');
    expect(interact(world, pawn)).toBe('Lying down.');
    expect(pawn.jobId).not.toBeNull();

    // Hands off the keys from here: the body walks itself onto the mattress.
    const idle = fakeInput({ locked: true });
    let slept = false;
    for (let t = 0; t < 200 && !slept; t++) {
      fps.applyTick(world, pawn, idle, new Rng(t));
      stepWorld(world, streams);
      slept = pawn.activity === 'sleeping';
    }

    expect(slept, `activity was ${pawn.activity}, job ${pawn.jobId}`).toBe(true);
    expect(pawn.x).toBe(bed!.x);
    expect(pawn.y).toBe(bed!.y);
    expect(bed!.occupant).toBe(pawn.id);
    const restAsleep = pawn.needs.rest;
    for (let t = 0; t < 20; t++) {
      fps.applyTick(world, pawn, idle, new Rng(t));
      stepWorld(world, streams);
    }
    expect(pawn.needs.rest).toBeGreaterThan(restAsleep);
  });

  it('works from a spot tucked against the bedroom wall, where the body overlaps stone', () => {
    // The regression that made E-on-a-bed a no-op in the browser: standing this close
    // to the wall put the body inside the wall's collision radius, movement refused
    // every step, and the sleep job died on the stuck counter instead of the mattress.
    const world = createWorld(77);
    const streams = makeStreams(world);
    const pawn = bodyIn(world);
    const bed = world.buildings.find((b) => b.kind === 'bed' && b.built)!;
    pawn.needs.rest = 0.4;
    pawn.needs.food = 0.6;
    const fps = new FpsController();
    pawn.x = bed.x - 1.4;
    pawn.y = bed.y;
    expect(isWalkable(world, Math.round(pawn.x), pawn.y), 'the body stands on open floor').toBe(true);
    expect(penetration(world, pawn.x, pawn.y, BODY_RADIUS), 'but overlaps the wall').toBeGreaterThan(0);
    fps.attach(pawn);
    fps.yaw = Math.atan2(bed.y - pawn.y, bed.x - pawn.x);
    fps.applyTick(world, pawn, fakeInput({ locked: true }), new Rng(1));

    expect(describeTarget(world, pawn)?.verb).toBe('Sleep');
    interact(world, pawn);
    const idle = fakeInput({ locked: true });
    for (let t = 0; t < 100 && pawn.activity !== 'sleeping'; t++) {
      fps.applyTick(world, pawn, idle, new Rng(t));
      stepWorld(world, streams);
    }

    expect(pawn.activity, `job ${pawn.jobId}, body at ${pawn.x},${pawn.y}`).toBe('sleeping');
  });

  it('getting up is one keypress: walking cancels the sleep and clears the bed', () => {
    const world = createWorld(77);
    const streams = makeStreams(world);
    const pawn = bodyIn(world);
    const bed = world.buildings.find((b) => b.kind === 'bed' && b.built)!;
    pawn.needs.rest = 0.4;
    pawn.needs.food = 0.6;

    const fps = new FpsController();
    standFacing(world, pawn, fps, bed);
    interact(world, pawn);
    const idle = fakeInput({ locked: true });
    for (let t = 0; t < 200 && pawn.activity !== 'sleeping'; t++) {
      fps.applyTick(world, pawn, idle, new Rng(t));
      stepWorld(world, streams);
    }
    expect(pawn.activity).toBe('sleeping');

    fps.applyTick(world, pawn, fakeInput({ held: ['KeyW'], locked: true }), new Rng(1));
    stepWorld(world, streams);

    expect(pawn.activity).toBe('walking');
    expect(pawn.jobId).toBeNull();
    expect(bed.occupant).toBeNull();
  });
});

describe('walking a possessed body', () => {
  it('stops at a wall instead of walking through it', () => {
    const world = createWorld(77);
    const spot = clearRun(world);
    const pawn = bodyIn(world);
    pawn.x = spot.x;
    pawn.y = spot.y;
    const wallX = spot.x + 2;
    expect(addBuilding(world, 'wall', wallX, spot.y, true)).not.toBeNull();

    const fps = new FpsController();
    fps.attach(pawn);
    fps.yaw = 0; // due +X, straight at the wall
    const input = fakeInput({ held: ['KeyW'], locked: true });
    for (let t = 0; t < 60; t++) fps.applyTick(world, pawn, input, new Rng(1));

    expect(pawn.x).toBeGreaterThan(spot.x); // it did walk
    expect(pawn.x).toBeLessThanOrEqual(wallX - 0.5 - BODY_RADIUS + 1e-6); // and it stopped
  });

  it('stops striding when the wall stops the body', () => {
    // The dual-view law, at the one place the player is guaranteed to be
    // looking. The possessed body used to advance its stride by a flat number
    // every tick it *intended* to move, so holding W against stone left the
    // manager camera watching a settler sprint on the spot while its feet stayed
    // where they were. Twenty ticks of that was eight and a half cells of phase.
    const world = createWorld(77);
    const spot = clearRun(world);
    const pawn = bodyIn(world);
    pawn.x = spot.x;
    pawn.y = spot.y;
    expect(addBuilding(world, 'wall', spot.x + 2, spot.y, true)).not.toBeNull();

    const fps = new FpsController();
    fps.attach(pawn);
    fps.yaw = 0;
    const input = fakeInput({ held: ['KeyW'], locked: true });
    for (let t = 0; t < 60; t++) fps.applyTick(world, pawn, input, new Rng(1));

    const stuckAt = pawn.x;
    const stuckPhase = pawn.animPhase;
    for (let t = 0; t < 20; t++) fps.applyTick(world, pawn, input, new Rng(1));

    expect(pawn.x - stuckAt).toBeLessThan(1e-9);
    expect(pawn.animPhase - stuckPhase).toBeLessThan(1e-9);
    expect(pawn.activity).toBe('walking'); // still trying, which is a different thing
  });

  it('advances the stride by ground covered, the rule every other body walks by', () => {
    const world = createWorld(77);
    const spot = clearRun(world);
    const pawn = bodyIn(world);
    pawn.x = spot.x;
    pawn.y = spot.y;

    const fps = new FpsController();
    fps.attach(pawn);
    fps.yaw = 0;
    const from = { x: pawn.x, y: pawn.y, phase: pawn.animPhase };
    fps.applyTick(world, pawn, fakeInput({ held: ['KeyW'], locked: true }), new Rng(1));

    const moved = Math.hypot(pawn.x - from.x, pawn.y - from.y);
    expect(moved).toBeGreaterThan(0);
    // The same arithmetic `followPath` does for a free settler, so a possessed
    // body and the one walking beside it on the same paving keep the same gait.
    expect(pawn.animPhase - from.phase).toBeCloseTo(moved * PHASE_PER_CELL, 10);
  });

  it('takes one stride per cell whether it walks or runs', () => {
    // Two flat constants used to sit here — 0.42 and 0.62 — so breaking into a
    // run changed how far the body went *and*, separately, how fast its legs
    // went, and the two did not agree with each other or with the ground.
    const strideRate = (running: boolean): number => {
      const world = createWorld(77);
      const spot = clearRun(world);
      const pawn = bodyIn(world);
      pawn.x = spot.x;
      pawn.y = spot.y;
      const fps = new FpsController();
      fps.attach(pawn);
      fps.yaw = 0;
      const held = running ? ['KeyW', 'ShiftLeft'] : ['KeyW'];
      const from = { x: pawn.x, y: pawn.y, phase: pawn.animPhase };
      fps.applyTick(world, pawn, fakeInput({ held, locked: true }), new Rng(1));
      return (pawn.animPhase - from.phase) / Math.hypot(pawn.x - from.x, pawn.y - from.y);
    };

    expect(strideRate(true)).toBeCloseTo(strideRate(false), 10);
    expect(strideRate(false)).toBeCloseTo(PHASE_PER_CELL, 10);
  });

  it('takes the wheel: moving yourself cancels the job the manager queued', () => {
    const world = createWorld(4242);
    const streams = makeStreams(world);
    const pawn = world.pawns[0]!;
    let jobId: number | null = null;
    for (let t = 0; t < 600 && jobId === null; t++) {
      stepWorld(world, streams);
      jobId = pawn.jobId;
    }
    expect(jobId).not.toBeNull();

    possess(world, pawn.id);
    const fps = new FpsController();
    fps.attach(pawn);
    fps.applyTick(world, pawn, fakeInput({ held: ['KeyW'], locked: true }), new Rng(1));

    expect(pawn.jobId).toBeNull();
    expect(world.jobs.find((j) => j.id === jobId)).toBeUndefined();
    expect(pawn.activity).toBe('walking');
  });

  it('steps sideways on A and D without turning the head', () => {
    // The first tester's report, pinned: A and D strafe. That is correct for a
    // player holding the mouse and useless for one who is not, which is why the
    // arrow keys exist — see the turning tests below.
    const world = createWorld(77);
    const spot = clearRun(world);
    const pawn = bodyIn(world);
    pawn.x = spot.x;
    pawn.y = spot.y;
    const fps = new FpsController();
    fps.attach(pawn);
    fps.yaw = 0; // facing +X
    const input = fakeInput({ held: ['KeyD'], locked: true });
    for (let t = 0; t < 20; t++) fps.applyTick(world, pawn, input, new Rng(1));

    expect(fps.yaw).toBe(0);
    expect(pawn.facing).toBe(0);
    expect(pawn.y).toBeGreaterThan(spot.y); // moved across their own line of sight
    expect(pawn.x).toBeCloseTo(spot.x, 5); // and not along it
  });

  it('keeps the manager view honest: the body you see is turned the way you looked', () => {
    const world = createWorld(77);
    const pawn = bodyIn(world);
    const fps = new FpsController();
    fps.attach(pawn);
    fps.look(500, 0);
    fps.applyTick(world, pawn, fakeInput({ locked: true }), new Rng(1));

    expect(pawn.facing).toBeCloseTo(fps.yaw, 6);
    expect(fps.yaw).not.toBe(0);
  });
});

/**
 * Turning without the mouse.
 *
 * The first tester never grabbed the pointer, so A and D were the only lateral
 * control they had — the body slid sideways and never turned round, which reads
 * as broken controls rather than as an un-clicked mouse. Every one of these is a
 * way to turn that needs no pointer lock at all.
 */
describe('turning the body', () => {
  it('turns right on the right arrow and left on the left', () => {
    const world = createWorld(77);
    const pawn = bodyIn(world);
    const fps = new FpsController();
    fps.attach(pawn);
    fps.yaw = 0;

    fps.applyLook(fakeInput({ held: ['ArrowRight'] }), 0.5);
    const right = fps.yaw;
    expect(right).toBeGreaterThan(0);

    fps.applyLook(fakeInput({ held: ['ArrowLeft'] }), 1.0);
    expect(fps.yaw).toBeLessThan(0);
  });

  it('carries the turn into the body, so the manager view agrees', () => {
    const world = createWorld(77);
    const pawn = bodyIn(world);
    const fps = new FpsController();
    fps.attach(pawn);
    fps.yaw = 0;

    fps.applyLook(fakeInput({ held: ['ArrowRight'] }), 0.4);
    fps.applyTick(world, pawn, fakeInput({}), new Rng(1));

    expect(pawn.facing).toBeCloseTo(fps.yaw, 6);
    expect(pawn.facing).not.toBe(0);
  });

  it('turns at the same rate on a fast machine as a slow one', () => {
    // Rate times dt, not a fixed step per frame — otherwise the same key press
    // spins twice as far at 120 fps as at 60, and the game plays differently on
    // every machine it is opened on.
    const slow = new FpsController();
    const fast = new FpsController();
    const key = fakeInput({ held: ['ArrowRight'] });
    slow.applyLook(key, 0.5);
    for (let f = 0; f < 30; f++) fast.applyLook(key, 0.5 / 30);

    expect(fast.yaw).toBeCloseTo(slow.yaw, 6);
  });

  it('looks up and down, and cannot bend the neck backwards', () => {
    const fps = new FpsController();
    fps.applyLook(fakeInput({ held: ['ArrowUp'] }), 0.3);
    expect(fps.pitch).toBeGreaterThan(0);

    for (let f = 0; f < 200; f++) fps.applyLook(fakeInput({ held: ['ArrowUp'] }), 0.1);
    expect(fps.pitch).toBeLessThanOrEqual(1.4);
    for (let f = 0; f < 400; f++) fps.applyLook(fakeInput({ held: ['ArrowDown'] }), 0.1);
    expect(fps.pitch).toBeGreaterThanOrEqual(-1.4);
  });

  it('ignores a loose mouse, so crossing the HUD does not spin the camera', () => {
    const fps = new FpsController();
    fps.applyLook(fakeInput({ locked: false, moveX: 400, moveY: 200 }), 1 / 60);
    expect(fps.yaw).toBe(0);
    expect(fps.pitch).toBe(0);
  });

  it('lets an unlocked player drag to look, for when the browser refuses the lock', () => {
    const fps = new FpsController();
    fps.applyLook(fakeInput({ locked: false, buttons: [0], moveX: 400, moveY: 0 }), 1 / 60);
    expect(fps.yaw).toBeGreaterThan(0);
  });

  it('still takes mouse look once the pointer is captured', () => {
    const fps = new FpsController();
    fps.applyLook(fakeInput({ locked: true, moveX: 400, moveY: -100 }), 1 / 60);
    expect(fps.yaw).toBeGreaterThan(0);
    expect(fps.pitch).toBeGreaterThan(0);
  });
});
