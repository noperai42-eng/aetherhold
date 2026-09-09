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
/** At most four to a row: past that a grid of twelve is a strip of stamps. */
const COLUMNS = 4;
/** Three-quarter: round to the left of the sun and up enough to see the ground. */
const AZIMUTH = Math.PI * 0.24;
const ELEVATION = Math.PI * 0.15;
/** Air left round the bounding sphere, so nothing is cropped by a lens change. */
const MARGIN = 1.22;

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
   * Stand these on the ground, spaced by the widest of them, and frame the lot.
   *
   * Every model already has its feet at y = 0 and its own middle over the
   * origin, so laying out a grid is a translation in x and z and nothing else.
   */
  show(models: readonly THREE.Object3D[]): void {
    for (const old of [...this.shown.children]) this.shown.remove(old);
    if (!models.length) return;

    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    let pitch = 0;
    for (const m of models) {
      box.setFromObject(m);
      box.getSize(size);
      pitch = Math.max(pitch, size.x, size.z);
    }
    pitch *= 1 + GAP;

    const cols = Math.min(COLUMNS, models.length);
    const rows = Math.ceil(models.length / cols);
    models.forEach((m, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      m.position.x += (col - (cols - 1) / 2) * pitch;
      m.position.z += (row - (rows - 1) / 2) * pitch;
      this.shown.add(m);
    });

    this.frame();
  }

  /** Pull the camera back until the whole of what is standing there is in shot. */
  private frame(): void {
    const box = new THREE.Box3().setFromObject(this.shown);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const fov = (this.camera.fov * Math.PI) / 180;
    // The vertical field is the one the lens quotes; the horizontal follows the
    // aspect, so a wide canvas is never the tighter of the two and this is safe.
    const dist = (radius / Math.sin(fov / 2)) * MARGIN;
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
