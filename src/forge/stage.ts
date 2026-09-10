/**
 * The room a bench model stands in: one ground plane, the game's own light rig,
 * and a camera that frames whatever it is handed.
 *
 * Nothing here is a lighting decision. `SkyView` is the same class the colony is
 * lit by and `Viewport` is the same renderer, tone mapping, exposure and shadow
 * filter — which is the whole point, because a bench with its own three-point
 * rig would answer "does this rock look good" about a rock nobody will ever see
 * under that light. What the bench does own is the camera and the ground, and
 * those are the two things a forge frame is allowed to differ from a game frame
 * by.
 *
 * There is no loop. The world is fixed at noon on a clear day, so a frame is a
 * function of what is standing in it and renders once when that changes.
 */

import * as THREE from 'three';

import { TERRAIN_COLOR } from '../client/render/palette';
import { QUALITY, Viewport } from '../client/render/renderer';
import { SkyView } from '../client/render/sky';
import type { World } from '../sim/types';

/**
 * How far apart two models in a grid stand, as a fraction of the wider one.
 *
 * A fraction and not a distance, and the first small model on the bench is what
 * settled it. Written as a flat 0.45 m, the gap was half a stone and a fifth of
 * a tree — and then five times a grass tuft, so a grid of twelve tufts came back
 * as twelve specks in an acre of empty turf while the same grid of twelve stones
 * filled the frame. A bench that has to hold forty-two models between a pebble
 * and a longhouse cannot space them in metres.
 */
const GAP = 0.45;
/**
 * At most four to a row: past that a grid of twelve is a strip of stamps.
 *
 * Measured after the fact rather than argued: at the fit this stage actually
 * uses, four is within a point of the best column count for five of the six
 * families on the bench, and costs the piles four. See `tests/forge-stage.test.ts`.
 */
const COLUMNS = 4;
/**
 * Three-quarter: round to the left of the sun and up enough to see the ground.
 *
 * Exported because a test that measures what a frame shows has to project onto
 * the axes this camera actually uses. A test carrying its own copy of 27 degrees
 * still passes when this line changes, which makes it a decoration rather than
 * a pin.
 */
export const AZIMUTH = Math.PI * 0.24;
export const ELEVATION = Math.PI * 0.15;
/** Air left round the bounding sphere, so nothing is cropped by a lens change. */
const MARGIN = 1.22;

/**
 * The footprint a grid steps by, one number per axis.
 *
 * Per axis and not one number for both, which is what `GAP`'s own wording asks
 * for and what the code did not do: it took the widest *dimension* of any model
 * and stepped by that on x and on z alike, so a family whose models are long and
 * thin paid its own length as the gap between columns that are a third as wide.
 * The herd stands along z: four fenwolves 0.58 m through the shoulder were
 * spaced 2.32 m apart across, in the frame that was supposed to let a mossback
 * be compared with a dunhare. A footprint has two numbers and this reads both.
 *
 * Still the widest model rather than each model's own, because a grid with a
 * ragged pitch is a grid nothing can be measured against.
 */
export function gridPitch(models: readonly THREE.Object3D[]): { x: number; z: number } {
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  let x = 0;
  let z = 0;
  for (const m of models) {
    box.setFromObject(m);
    box.getSize(size);
    x = Math.max(x, size.x);
    z = Math.max(z, size.z);
  }
  return { x: x * (1 + GAP), z: z * (1 + GAP) };
}

/**
 * Lay these out in rows of `columns`, centred on the origin. Mutates positions.
 *
 * Returns the pitch it used, because the pitch is the thing a test can hold and
 * the arrangement is the thing a frame shows.
 */
export function placeGrid(
  models: readonly THREE.Object3D[],
  columns: number = COLUMNS,
): { x: number; z: number } {
  const pitch = gridPitch(models);
  const cols = Math.min(columns, models.length);
  const rows = Math.ceil(models.length / cols);
  models.forEach((m, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    m.position.x += (col - (cols - 1) / 2) * pitch.x;
    m.position.z += (row - (rows - 1) / 2) * pitch.z;
  });
  return pitch;
}

/**
 * How far back a camera with this vertical field must stand to hold the box.
 *
 * A sphere round the box, deliberately. What it buys is that the framing is a
 * function of what is standing there and of nothing else: a sphere has no aspect
 * and no yaw, so the same recipe photographed in a tall window and a wide one
 * comes back the same size, and two rounds of the look loop are comparable.
 *
 * What it costs is a third of the subject: fitting the box itself against both
 * fields takes every family on the bench from about 28 per cent of the frame to
 * about 40. Measured, that gain is almost none of it the sphere being loose —
 * on a square canvas an exact fit is four centimetres tighter over thirty-four
 * metres — and almost all of it the canvas being wider than it is tall. Banking
 * it means every frame becomes a function of the window it was taken in, which
 * is the one thing the rest of this file is arranged not to be. See
 * `tests/forge-stage.test.ts`, which measures both.
 *
 * The vertical field is the one the lens quotes; the horizontal follows the
 * aspect, so a wide canvas is never the tighter of the two and this is safe.
 */
export function fitDistance(box: THREE.Box3, fov: number): number {
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  return (radius / Math.sin(fov / 2)) * MARGIN;
}

export class Stage {
  readonly viewport: Viewport;
  readonly camera: THREE.PerspectiveCamera;
  private readonly sky: SkyView;
  private readonly shown = new THREE.Group();
  private readonly world: World;

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.world = world;
    // Fixed at high rather than guessed from the machine: a bench frame that
    // gains a shadow when it is opened on a different laptop is not a frame two
    // rounds can be compared across.
    this.viewport = new Viewport(canvas, 'high');
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 400);

    this.sky = new SkyView(world, QUALITY.high);
    this.viewport.scene.add(this.sky.group);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      // The colour the map's grass is drawn in, before the season and the snow
      // the terrain mesh mixes over it. Flat on purpose: the ground is here to
      // catch the model's shadow and to say which way is down, and a bench
      // whose turf changes with the month is a bench that moves under the loop.
      new THREE.MeshStandardMaterial({ color: TERRAIN_COLOR.grass, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.viewport.scene.add(ground);
    this.viewport.scene.add(this.shown);
  }

  /**
   * Stand these on the ground, spaced by the widest footprint among them, and
   * frame the lot.
   *
   * Every model is built with its own middle over the origin, so laying out a
   * grid is a translation in x and z and nothing else — and an addition rather
   * than an assignment, because a model may carry a lift of its own (a walking
   * settler bobs, a sleeping one is rolled onto its side and raised off the
   * turf) and the grid has no business flattening it.
   *
   * `columns` left off is the stage's own default, which is what every frame
   * the look loop judges is taken at. It is an argument at all because the
   * frames of the round that wrote this doc could not settle how many a family
   * should stand in a row, and the only way to settle it is to photograph the
   * same family at several and look.
   */
  show(models: readonly THREE.Object3D[], columns?: number): void {
    for (const old of [...this.shown.children]) this.shown.remove(old);
    if (!models.length) return;

    placeGrid(models, columns);
    for (const m of models) this.shown.add(m);

    this.frame();
  }

  /** Pull the camera back until the whole of what is standing there is in shot. */
  private frame(): void {
    const box = new THREE.Box3().setFromObject(this.shown);
    const centre = box.getCenter(new THREE.Vector3());
    const dist = fitDistance(box, (this.camera.fov * Math.PI) / 180);
    const dir = new THREE.Vector3(
      Math.cos(ELEVATION) * Math.cos(AZIMUTH),
      Math.sin(ELEVATION),
      Math.cos(ELEVATION) * Math.sin(AZIMUTH),
    );
    this.camera.position.copy(centre).addScaledVector(dir, dist);
    this.camera.lookAt(centre);
    this.camera.updateProjectionMatrix();
    // The sun's shadow frustum and the sky dome follow whoever is looking, so
    // the focus is what is being photographed rather than the middle of a map
    // no part of which is on screen.
    this.sky.sync(this.world, centre.x, centre.z);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.viewport.resize(width, height);
  }

  render(): void {
    this.viewport.render(this.camera);
  }
}
