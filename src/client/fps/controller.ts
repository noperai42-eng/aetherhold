/**
 * First person. The camera is bolted to a real pawn: it reads that pawn's
 * interpolated position, and every action it takes goes through the same sim
 * functions the manager uses. Walking calls `moveWithCollision`, so the walls you
 * bump into are the walls the pathfinder respects.
 *
 * Mouse look writes back into `pawn.facing`, which is why the body you see in the
 * manager view is turned the way you were looking when you left.
 */

import * as THREE from 'three';

import { BODY_RADIUS, PLAYER_RUN, PLAYER_WALK, moveWithCollision } from '../../sim/movement';
import { PHASE_PER_CELL, SETTLER_PHASE } from '../gait';
import { LAYER_FPS } from '../render/renderer';
import { cancelJob } from '../../sim/world';
import { playerAttack } from '../../sim/combat';
import { standHeight } from '../../sim/grid';
import type { Input } from '../input/input';
import type { Pawn, World } from '../../sim/types';
import { groundSpeed } from '../../sim/snowpack';
import type { Rng } from '../../sim/rng';

const EYE_HEIGHT = 1.62;
const PRONE_EYE = 0.42;
const LOOK_SENSITIVITY = 0.0024;
const MAX_PITCH = 1.4;

/**
 * Keyboard turning, radians per second.
 *
 * A and D strafe, which is right for a mouse-looking player and useless for one
 * who has not grabbed the mouse — the first tester could slide sideways but not
 * turn round, so the body walked like a crab. The arrow keys turn the head
 * instead, which makes the whole view playable off the keyboard alone. Half a
 * turn in about a second and a quarter: fast enough to spin on a noise behind
 * you, slow enough to aim with.
 */
const TURN_RATE = 2.5;
const PITCH_RATE = 1.6;

export class FpsController {
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.05, 400);
  /** Sim-space facing angle, 0 = +X. Shared with the pawn every tick. */
  yaw = 0;
  pitch = 0;
  private eye = EYE_HEIGHT;

  constructor() {
    this.camera.rotation.order = 'YXZ';
    this.camera.layers.enable(LAYER_FPS);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Take over a body: inherit where it was already looking. */
  attach(pawn: Pawn): void {
    this.yaw = pawn.facing;
    this.pitch = 0;
  }

  /** Mouse look runs per frame, so turning is never limited by the 20 Hz sim. */
  look(dx: number, dy: number): void {
    this.turn(dx * LOOK_SENSITIVITY, -dy * LOOK_SENSITIVITY);
  }

  /** Turn by an angle rather than by a mouse delta. Radians, + is right / up. */
  turn(dyaw: number, dpitch: number): void {
    this.yaw += dyaw;
    this.pitch = clamp(this.pitch + dpitch, -MAX_PITCH, MAX_PITCH);
    while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /**
   * Every way of looking around, resolved once per frame.
   *
   * Four of them, because there are four ways to end up unable to turn: the
   * mouse was never grabbed, Escape gave it back, the browser refused the lock,
   * or there is no mouse at all. With the mouse held, a drag turns the view; with
   * nothing held, the arrow keys do; on glass, a finger dragged across the world
   * does. Only the locked path uses raw deltas without a gate — free pointer
   * movement must not turn the camera, or wandering across the HUD would spin it.
   */
  applyLook(input: Input, dt: number): void {
    if (input.locked || input.mouseButtons.has(0) || input.dragging) {
      this.look(input.moveX, input.moveY);
    }

    let dyaw = 0;
    let dpitch = 0;
    if (input.held('ArrowRight')) dyaw += 1;
    if (input.held('ArrowLeft')) dyaw -= 1;
    if (input.held('ArrowUp')) dpitch += 1;
    if (input.held('ArrowDown')) dpitch -= 1;
    if (dyaw !== 0 || dpitch !== 0) this.turn(dyaw * TURN_RATE * dt, dpitch * PITCH_RATE * dt);
  }

  /**
   * One simulation tick of player intent. Movement speed is in cells per tick, the
   * same units the AI uses, so a possessed settler is exactly as fast as a free one.
   */
  applyTick(world: World, pawn: Pawn, input: Input, combatRng: Rng): void {
    pawn.facing = this.yaw;
    if (pawn.dead || pawn.downed) return;

    let f = 0;
    let r = 0;
    if (input.held('KeyW')) f += 1;
    if (input.held('KeyS')) f -= 1;
    if (input.held('KeyD')) r += 1;
    if (input.held('KeyA')) r -= 1;

    const running = input.held('ShiftLeft') || input.held('ShiftRight');
    const moving = f !== 0 || r !== 0;

    if (moving) {
      // Taking the wheel cancels whatever the settler was doing. That is the
      // spec's manual override, and it is deliberately impossible to do by accident.
      if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
      pawn.path = null;
      if (pawn.activity === 'sleeping') pawn.activity = 'idle';

      const len = Math.hypot(f, r);
      // Same ground bonus a settler gets, from the same table: walking your own
      // paving has to feel quicker from inside the body or the floor is a lie
      // the manager view tells.
      const ground = groundSpeed(world, Math.round(pawn.x), Math.round(pawn.y));
      const speed = ((running ? PLAYER_RUN : PLAYER_WALK) * ground) / len;
      const cos = Math.cos(this.yaw);
      const sin = Math.sin(this.yaw);
      const dx = (cos * f - sin * r) * speed;
      const dy = (sin * f + cos * r) * speed;
      // The stride is fed by ground actually covered, which is the rule
      // `followPath` applies to every other body on the map. A flat per-tick
      // number was the one place the possessed settler disagreed with the
      // manager camera: hold W against a wall and the body stood still while
      // its legs ran on the spot, at a cadence that matched neither its own
      // speed nor the settler walking past it on the same paving.
      const fromX = pawn.x;
      const fromY = pawn.y;
      moveWithCollision(world, pawn, dx, dy);
      pawn.animPhase += Math.hypot(pawn.x - fromX, pawn.y - fromY) * PHASE_PER_CELL;
      pawn.activity = 'walking';
    } else if (pawn.activity === 'walking') {
      pawn.activity = 'idle';
    }

    // Firing is only possible while drafted, exactly as in the manager view.
    // Pointer lock is required so the click that grabs the mouse — or a click on a
    // HUD button — is never also a shot. A tablet cannot lock the pointer at all,
    // so it gets an explicit trigger instead of a relaxed rule: nothing else on
    // the glass can set that flag.
    if (pawn.drafted && ((input.locked && input.mouseButtons.has(0)) || input.virtualFire)) {
      playerAttack(world, pawn, Math.cos(this.yaw), Math.sin(this.yaw), combatRng);
    }
  }

  /** Per-frame camera placement from the interpolated body position. */
  updateCamera(world: World, pawn: Pawn, x: number, y: number, dt: number): void {
    const prone = pawn.dead || pawn.downed || pawn.activity === 'sleeping';
    const floor = standHeight(world, Math.round(x), Math.round(y));
    const wanted = floor + (prone ? PRONE_EYE : EYE_HEIGHT);
    // Ease the eye height so lying down and standing up are not teleports.
    this.eye += (wanted - this.eye) * Math.min(1, dt * 9);

    // The eye rides the body's own stride instead of a wall clock: it stops the
    // instant the body is blocked, quickens when the settler runs, and is the
    // same phase, amplitude and two-rises-per-cycle the rig bobs on — so the
    // head you watch from outside and the head you look out of move together.
    const bobY =
      !prone && pawn.activity === 'walking'
        ? Math.sin(pawn.animPhase * SETTLER_PHASE * 2) * 0.035
        : 0;

    this.camera.position.set(x, this.eye + bobY, y);
    this.camera.rotation.y = -this.yaw - Math.PI / 2;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }

  /** Where the crosshair is pointing, in sim space — used for the interact prompt. */
  aimCell(pawn: Pawn): { x: number; y: number } {
    return {
      x: Math.round(pawn.x + Math.cos(this.yaw) * (BODY_RADIUS + 0.6)),
      y: Math.round(pawn.y + Math.sin(this.yaw) * (BODY_RADIUS + 0.6)),
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
