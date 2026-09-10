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
 * How many to a row for a family that does not name its own.
 *
 * Measured after the fact rather than argued, and then measured again against
 * frames. At the fit this stage uses, four is within a point of the best column
 * count for five of the six families and cost the piles four — but filling the
 * frame is not the whole of reading a family, and twenty-four frames at two,
 * three, four and six moved three benches off this number. `Bench.columns`
 * carries those; this is what is left, which is the stones, the grass and the
 * herd. See `tests/forge-stage.test.ts`.
 */
const COLUMNS = 4;
/**
 * How wide the turf is, in metres, square and centred under the subject.
 *
 * Exported for the same reason the two camera angles are: a test that asks what
 * a frame shows has to ask it of this number rather than of its own copy.
 *
 * It was 200 and it was five metres short. `fitDistance` stands the camera on
 * the line out of the subject's centre, so a wood four metres tall at its middle
 * rides the camera up with it while the pitch stays 27 degrees down, and the
 * frame's two top corners land 105 m out — a corner ray carrying the horizontal
 * half field as well as the vertical one, leaving along the diagonal where a
 * square plane's edge is nearest. The middle of that top edge is still turf at
 * 71 m, which is why the rim showed in the corners and nowhere else.
 *
 * 260 is sized once rather than up to the wood. It clears the wood's 105 by a
 * quarter again; it clears the widest twelve-grid of anything the game actually
 * has, which is a wood of `tree.b` at 86 m; it clears the twenty-seven buildings
 * that have not reached this bench yet, the widest of which is a dozen doors at
 * 50 m; and it clears every family on the bench with every slider at the top of
 * its range, the widest of those being the grass at 117 m. The one thing it does
 * not clear is the wood with every slider at the top, which reaches 450 m — and
 * that one is not a plane to widen, it is past this camera's own 400 m far
 * plane. Widening costs two triangles: the sun's shadow frustum and the sky dome
 * follow the subject's centre, not this. See `tests/forge-stage.test.ts`.
 */
export const GROUND = 260;
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
 * on a square canvas an exact fit is forty-two centimetres tighter over
 * thirty-four metres — and almost all of it the canvas being wider than it is
 * tall. Banking it means every frame becomes a function of the window it was
 * taken in, which is the one thing the rest of this file is arranged not to be.
 * See `tests/forge-stage.test.ts`, which measures both.
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
      new THREE.PlaneGeometry(GROUND, GROUND),
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
    // And the fog off the same sky, which is what `world-view.ts` does every
    // frame and this file did not do at all. `Viewport`'s constructor leaves a
    // `THREE.Fog(0x223040, 40, 130)` in the scene for the game to overwrite, so
    // a bench that never overwrote it photographed every model at noon against
    // a distance hazing toward night-blue — the top of a wood's frame measured
    // (36, 51, 65), which is that colour. The file's first paragraph says
    // nothing in it is a lighting decision, and fog is one. After `sync`,
    // because the colour is what that call just worked out.
    this.sky.applyFog(this.viewport.scene.fog as THREE.Fog, this.world);
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
