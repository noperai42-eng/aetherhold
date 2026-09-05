/**
 * Cameras and dressing for the hollow pocket. The loop owns verbs; this file
 * only aims two cameras at the same kit.
 */

import * as THREE from 'three';

import { LAYER_FPS, LAYER_MANAGER } from '../render/renderer';
import type { Input } from '../input/input';
import { buildHollowKit, disposeHollowKit, type HollowKit } from '../worldkit/kit';
import {
  HOLLOW_EYE,
  type HollowState,
  hollowLook,
  hollowWalk,
} from './hollow-loop';

const LOOK = 0.0024;
const TURN = 2.5;
const PITCH_RATE = 1.6;
const WHEEL_SPEED = 1.15;
const ORBIT = 0.007;
const MIN_DIST = 10;
const MAX_DIST = 42;

export interface HollowCam {
  targetX: number;
  targetZ: number;
  distance: number;
  yaw: number;
  pitch: number;
}

export class HollowView {
  readonly kit: HollowKit;
  readonly inhabit = new THREE.PerspectiveCamera(72, 1, 0.08, 180);
  readonly manager = new THREE.PerspectiveCamera(36, 1, 0.4, 220);
  cam: HollowCam = { targetX: 1.2, targetZ: 1.4, distance: 26, yaw: 0.55, pitch: 0.92 };
  private readonly look = new THREE.Vector3();
  private readonly savedBg: THREE.Scene['background'];
  private readonly savedFog: THREE.Scene['fog'];
  private readonly scene: THREE.Scene;
  private mounted = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.kit = buildHollowKit();
    this.inhabit.rotation.order = 'YXZ';
    this.inhabit.layers.enable(LAYER_FPS);
    this.manager.layers.enable(LAYER_MANAGER);
    this.savedBg = scene.background;
    this.savedFog = scene.fog;
  }

  mount(): void {
    if (this.mounted) return;
    this.scene.add(this.kit.group);
    this.scene.background = new THREE.Color(0x6d7a86);
    this.scene.fog = new THREE.Fog(0x6d7a86, 18, 70);
    this.mounted = true;
  }

  unmount(): void {
    if (!this.mounted) return;
    this.scene.remove(this.kit.group);
    this.scene.background = this.savedBg;
    this.scene.fog = this.savedFog;
    this.mounted = false;
  }

  resize(aspect: number): void {
    this.inhabit.aspect = aspect;
    this.manager.aspect = aspect;
    this.inhabit.updateProjectionMatrix();
    this.manager.updateProjectionMatrix();
  }

  camera(state: HollowState): THREE.PerspectiveCamera {
    return state.view === 'inhabit' ? this.inhabit : this.manager;
  }

  sync(state: HollowState, dt: number): void {
    this.kit.debris.visible = state.jammed;
    if (state.cleared) this.kit.wheel.rotation.z += dt * WHEEL_SPEED;
    this.kit.walker.position.set(state.x, 0, state.z);
    this.kit.walker.rotation.y = -state.yaw;
    this.kit.walker.visible = state.view === 'manager';
    this.applyInhabit(state);
    this.applyManager();
  }

  drive(state: HollowState, input: Input, dt: number): HollowState {
    let next = state;
    if (state.view === 'inhabit') {
      next = this.driveInhabit(next, input, dt);
    } else {
      next = this.driveManager(next, input, dt);
    }
    return next;
  }

  private driveInhabit(s: HollowState, input: Input, dt: number): HollowState {
    let next = s;
    if (input.locked || input.mouseButtons.has(0) || input.dragging) {
      next = hollowLook(next, input.moveX * LOOK, -input.moveY * LOOK);
    }
    let dyaw = 0;
    let dpitch = 0;
    if (input.held('ArrowRight')) dyaw += 1;
    if (input.held('ArrowLeft')) dyaw -= 1;
    if (input.held('ArrowUp')) dpitch += 1;
    if (input.held('ArrowDown')) dpitch -= 1;
    if (dyaw || dpitch) next = hollowLook(next, dyaw * TURN * dt, dpitch * PITCH_RATE * dt);

    const wish = keysXZ(input, next.yaw);
    return hollowWalk(next, wish.x, wish.z, dt, input.held('ShiftLeft') || input.held('ShiftRight'));
  }

  private driveManager(s: HollowState, input: Input, dt: number): HollowState {
    if (input.mouseButtons.has(2) || (input.mouseButtons.has(0) && input.held('ShiftLeft'))) {
      this.cam.yaw += input.moveX * ORBIT;
      this.cam.pitch = clamp(this.cam.pitch + input.moveY * ORBIT, 0.4, 1.35);
    }
    if (input.held('KeyQ')) this.cam.yaw -= 0.9 * dt;
    if (input.held('Comma')) this.cam.yaw += 0.9 * dt;
    if (input.held('KeyR')) this.cam.pitch = clamp(this.cam.pitch - 0.7 * dt, 0.4, 1.35);
    if (input.held('KeyF')) this.cam.pitch = clamp(this.cam.pitch + 0.7 * dt, 0.4, 1.35);
    if (input.wheel) {
      this.cam.distance = clamp(this.cam.distance * (1 + input.wheel * 0.0012), MIN_DIST, MAX_DIST);
    }
    // Camera sits on (sin yaw, cos yaw); look dir is the opposite. Offset the
    // walk heading a quarter turn so W walks into the picture, not sideways.
    const wish = keysXZ(input, this.cam.yaw + Math.PI / 2);
    return hollowWalk(s, wish.x, wish.z, dt, input.held('ShiftLeft') || input.held('ShiftRight'));
  }

  private applyInhabit(s: HollowState): void {
    this.inhabit.position.set(s.x, HOLLOW_EYE, s.z);
    this.inhabit.rotation.set(s.pitch, -s.yaw + Math.PI / 2, 0);
  }

  private applyManager(): void {
    const { targetX, targetZ, distance, yaw, pitch } = this.cam;
    const cp = Math.cos(pitch);
    const x = targetX + Math.sin(yaw) * cp * distance;
    const y = Math.sin(pitch) * distance;
    const z = targetZ + Math.cos(yaw) * cp * distance;
    this.manager.position.set(x, y, z);
    this.look.set(targetX, 0.4, targetZ);
    this.manager.lookAt(this.look);
  }

  dispose(): void {
    this.unmount();
    disposeHollowKit(this.kit);
  }
}

function keysXZ(input: Input, yaw: number): { x: number; z: number } {
  let f = 0;
  let r = 0;
  if (input.held('KeyW')) f += 1;
  if (input.held('KeyS')) f -= 1;
  if (input.held('KeyD')) r += 1;
  if (input.held('KeyA')) r -= 1;
  if (f === 0 && r === 0) return { x: 0, z: 0 };
  // yaw 0 faces +X. W walks that way; D is the right-hand perpendicular.
  const fx = Math.cos(yaw);
  const fz = Math.sin(yaw);
  const rx = -Math.sin(yaw);
  const rz = Math.cos(yaw);
  return { x: f * fx + r * rx, z: f * fz + r * rz };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
