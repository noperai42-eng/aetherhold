/**
 * The colony manager's camera: a high-oblique strategy view with a narrow FOV, so
 * the base reads almost isometric but still has real depth. Bounded pan, zoom and
 * orbit — you can never lose the colony off the edge of the world.
 */

import * as THREE from 'three';

import { LAYER_MANAGER } from '../render/renderer';
import type { CameraState } from '../../sim/save';
import type { World } from '../../sim/types';

export const MIN_DISTANCE = 9;
export const MIN_PITCH = 0.42;
export const MAX_PITCH = 1.45;

/**
 * How far out the camera may pull, given the map it is looking at.
 *
 * This was a flat 62 while every map was sixty-four cells square, which is the
 * same statement written as a number: at a 32-degree field of view, 62 shows
 * about thirty-five cells of ground, and a player could survey a good half of
 * their world in one look. The map is ninety-six cells now, and the constant
 * quietly turned into "you may see a third of it" — the colony fills the screen
 * and the frontier the scouts walk to is somewhere off the top.
 *
 * So it is derived instead. The floor keeps small maps feeling the way they did.
 */
export function maxDistanceFor(world: { width: number; height: number }): number {
  return Math.max(62, Math.max(world.width, world.height) * 1.1);
}

export class ManagerCamera {
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 500);
  state: CameraState;
  private readonly bounds: { w: number; h: number };
  private readonly maxDistance: number;

  constructor(world: World, state: CameraState) {
    this.state = { ...state };
    this.bounds = { w: world.width, h: world.height };
    this.maxDistance = maxDistanceFor(world);
    this.camera.layers.enable(LAYER_MANAGER);
    this.apply();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Pan in screen-relative directions: `right` and `forward` in world units. */
  pan(right: number, forward: number): void {
    const s = this.state;
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    // Forward is "away from the camera", which is what the arrow keys should feel like.
    s.targetX += -cos * forward + -sin * right;
    s.targetY += -sin * forward + cos * right;
    this.clamp();
    this.apply();
  }

  zoom(factor: number): void {
    this.state.distance = clampNum(this.state.distance * factor, MIN_DISTANCE, this.maxDistance);
    this.apply();
  }

  orbit(dYaw: number, dPitch: number): void {
    this.state.yaw += dYaw;
    this.state.pitch = clampNum(this.state.pitch + dPitch, MIN_PITCH, MAX_PITCH);
    this.apply();
  }

  setState(state: CameraState): void {
    this.state = { ...state };
    this.clamp();
    this.apply();
  }

  /** Centre on a point without changing the angle — used when possessing a pawn. */
  focusOn(x: number, y: number): void {
    this.state.targetX = x;
    this.state.targetY = y;
    this.clamp();
    this.apply();
  }

  get target(): { x: number; y: number } {
    return { x: this.state.targetX, y: this.state.targetY };
  }

  private clamp(): void {
    const s = this.state;
    s.targetX = clampNum(s.targetX, 1, this.bounds.w - 2);
    s.targetY = clampNum(s.targetY, 1, this.bounds.h - 2);
    s.distance = clampNum(s.distance, MIN_DISTANCE, this.maxDistance);
    s.pitch = clampNum(s.pitch, MIN_PITCH, MAX_PITCH);
  }

  private apply(): void {
    const s = this.state;
    const cp = Math.cos(s.pitch);
    this.camera.position.set(
      s.targetX + Math.cos(s.yaw) * cp * s.distance,
      Math.sin(s.pitch) * s.distance,
      s.targetY + Math.sin(s.yaw) * cp * s.distance,
    );
    this.camera.lookAt(s.targetX, 0, s.targetY);
    // `lookAt` sets the rotation but leaves the world matrix a frame behind it,
    // and every pick this class does — the player's click, the minimap's
    // viewport rectangle — unprojects through that matrix. The renderer used to
    // be the thing that happened to update it in time, which made picking depend
    // on being called after a draw. It does not have to be.
    this.camera.updateMatrixWorld();
  }

  /**
   * Screen point (normalised device coords) to the ground cell under it. The pick is
   * done against the y=0 plane and then resolved to a cell, which is the same space
   * the simulation reasons in — no chance of the click landing on a different tile
   * than the one the order applies to.
   */
  pickCell(ndcX: number, ndcY: number): { x: number; y: number; wx: number; wy: number } | null {
    const hit = this.groundAt(ndcX, ndcY);
    if (!hit) return null;
    const x = Math.round(hit.x);
    const y = Math.round(hit.y);
    if (x < 0 || y < 0 || x >= this.bounds.w || y >= this.bounds.h) return null;
    return { x, y, wx: hit.x, wy: hit.y };
  }

  /**
   * The same pick, but as the raw spot on the ground: no rounding, no bounds.
   *
   * `pickCell` answers "which tile did the player click", so refusing a point off
   * the edge of the map is exactly right for it. The minimap asks a different
   * question — where does the screen's own corner land — and that corner is
   * *routinely* past the edge when the camera is pulled out over a shoreline. A
   * clamped answer would draw the viewport rectangle smaller than the ground the
   * player can actually see, which is worse than drawing it hanging off the map.
   */
  groundAt(ndcX: number, ndcY: number): { x: number; y: number } | null {
    RAY.setFromCamera(SCREEN.set(ndcX, ndcY), this.camera);
    if (!RAY.ray.intersectPlane(GROUND, HIT)) return null;
    return { x: HIT.x, y: HIT.z };
  }

  /**
   * Where the four corners of the screen land on the ground, clockwise from the
   * top left. Null when any of them misses, which is the camera looking at the
   * horizon rather than at the valley — nothing sensible to draw, so draw nothing.
   *
   * A quad rather than a rectangle because the camera orbits: the visible ground
   * is a trapezoid at any yaw that is not a multiple of a right angle, and a
   * bounding box around it would claim the player can see corners they cannot.
   */
  viewQuad(): { x: number; y: number }[] | null {
    const out: { x: number; y: number }[] = [];
    for (const [nx, ny] of NDC_CORNERS) {
      const hit = this.groundAt(nx, ny);
      if (!hit) return null;
      out.push(hit);
    }
    return out;
  }
}

// Scratch, shared across every camera in the process: `setFromCamera` overwrites
// the ray completely and the hit is copied out before the next call, so there is
// nothing here to carry between uses — and the alternative is four raycasters of
// garbage per frame for the minimap's viewport outline.
const RAY = new THREE.Raycaster();
const SCREEN = new THREE.Vector2();
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const HIT = new THREE.Vector3();
const NDC_CORNERS: [number, number][] = [
  [-1, 1],
  [1, 1],
  [1, -1],
  [-1, -1],
];

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
