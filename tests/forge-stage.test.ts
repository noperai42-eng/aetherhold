/**
 * The room every forge frame is taken in, and how much of the picture the
 * subject actually gets.
 *
 * `stage.ts` is the one file on the bench that no test had ever touched, and it
 * is the file every frame the look loop judges goes through. Two rounds running,
 * the frames complained about it in the same words — the piles round wrote that
 * "the pitch is a function of footprint and nothing else", and the animals round
 * sharpened it to "two thirds of that frame is grass" and could not judge the
 * four species' sizes because of it. Neither round could say how much, because
 * nothing measured it.
 *
 * The functional half is the arrangement in isolation: what the pitch is on each
 * axis, where a model lands, and that a model carrying a lift of its own keeps
 * it. The experience half stands a real bench grid on the stage and works out
 * what fraction of the frame its subject fills, which is the number the two
 * briefs were reaching for and the only one that says whether a change to this
 * file helped.
 */

import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

import { BuildingsView } from '../src/client/render/buildings';
import { benchWorld, forgeSeeds, prototypes } from '../src/forge/forge';
import { BENCHES, benchByName, type Bench, type Prototypes } from '../src/forge/recipes';
import { AZIMUTH, ELEVATION, fitDistance, gridPitch, placeGrid } from '../src/forge/stage';

/** A box of exactly these dimensions, its middle over the origin, feet on the turf. */
function slab(w: number, h: number, d: number): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return new THREE.Mesh(g);
}

/**
 * The lens the bench looks through, and the canvas the look loop shoots at.
 *
 * The two angles come from `stage.ts` rather than being written out again here:
 * every number below is a projection onto them, so a copy would go on passing
 * after the camera moved.
 */
const FOV = (38 * Math.PI) / 180;
/** 1280x800 with the slider panel taking a quarter of the width; see `scripts/look/forge.mjs`. */
const ASPECT = 960 / 800;

/**
 * What fraction of the frame the subject's own extent covers, at `dist`.
 *
 * Screen-space and not world-space: the models lie flat on the ground and the
 * camera looks down at them from 27 degrees, so a grid that is wide and shallow
 * in metres is wide and *short* in the picture, and metres cannot say that.
 */
function frameFill(shown: THREE.Object3D, dist: number, aspect = ASPECT): number {
  const box = new THREE.Box3().setFromObject(shown);
  const centre = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(
    Math.cos(ELEVATION) * Math.cos(AZIMUTH),
    Math.sin(ELEVATION),
    Math.cos(ELEVATION) * Math.sin(AZIMUTH),
  );
  const fwd = dir.clone().negate().normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const tanY = Math.tan(FOV / 2);
  const tanX = tanY * aspect;
  let halfW = 0;
  let halfH = 0;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const v = new THREE.Vector3(x, y, z).sub(centre);
        halfW = Math.max(halfW, Math.abs(v.dot(right)));
        halfH = Math.max(halfH, Math.abs(v.dot(up)));
      }
  return (halfW / (dist * tanX)) * (halfH / (dist * tanY));
}

/** The distance an exact fit of the box against both fields would need. */
function boxDistance(shown: THREE.Object3D, aspect = ASPECT): number {
  const box = new THREE.Box3().setFromObject(shown);
  const centre = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(
    Math.cos(ELEVATION) * Math.cos(AZIMUTH),
    Math.sin(ELEVATION),
    Math.cos(ELEVATION) * Math.sin(AZIMUTH),
  );
  const fwd = dir.clone().negate().normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const tanY = Math.tan(FOV / 2);
  const tanX = tanY * aspect;
  let need = 0;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const v = new THREE.Vector3(x, y, z).sub(centre);
        need = Math.max(
          need,
          -v.dot(fwd) + Math.max(Math.abs(v.dot(up)) / tanY, Math.abs(v.dot(right)) / tanX),
        );
      }
  // The same air `fitDistance` leaves, so the two numbers differ by the fit and
  // by nothing else.
  return need * 1.22;
}

describe('how a grid is spaced and where a model lands', () => {
  it('steps each axis by that axis, so a long model does not push its neighbours sideways', () => {
    // A fenwolf's proportions: 1.6 m nose to tail, 0.5 m through the shoulder.
    const pitch = gridPitch([slab(1.6, 0.9, 0.5), slab(1.4, 0.8, 0.45)]);
    expect(pitch.x).toBeCloseTo(1.6 * 1.45, 6);
    expect(pitch.z).toBeCloseTo(0.5 * 1.45, 6);
    // The fault this replaced: one pitch off the widest dimension of either axis,
    // which would have stepped z by 2.32 m across a body half a metre through.
    expect(pitch.z).toBeLessThan(pitch.x / 3);
  });

  it('takes each axis from the widest model on that axis, not from one model', () => {
    // Neither of these is the widest on both, so a pitch that read one model
    // would be short on one axis whichever it read.
    const pitch = gridPitch([slab(2, 1, 0.4), slab(0.6, 1, 1.5)]);
    expect(pitch.x).toBeCloseTo(2 * 1.45, 6);
    expect(pitch.z).toBeCloseTo(1.5 * 1.45, 6);
  });

  it('centres the grid on the origin and fills rows before columns', () => {
    const models = Array.from({ length: 6 }, () => slab(1, 1, 1));
    const pitch = placeGrid(models, 4);
    expect(pitch).toEqual({ x: 1.45, z: 1.45 });
    // Four across, then two: the first row spans -1.5 to +1.5 pitches, and the
    // two rows sit half a pitch either side of the origin.
    const at = models.map((m) => [
      Math.round((m.position.x / pitch.x) * 100) / 100,
      Math.round((m.position.z / pitch.z) * 100) / 100,
    ]);
    expect(at).toEqual([
      [-1.5, -0.5],
      [-0.5, -0.5],
      [0.5, -0.5],
      [1.5, -0.5],
      [-1.5, 0.5],
      [-0.5, 0.5],
    ]);
  });

  it('narrows to the models it has rather than leaving an empty column', () => {
    const models = Array.from({ length: 3 }, () => slab(1, 1, 1));
    placeGrid(models, 4);
    // Three models, three columns, one row — not three of four with a hole.
    expect(models.map((m) => Math.round(m.position.z * 1e6))).toEqual([0, 0, 0]);
    expect(models.map((m) => Math.round((m.position.x / 1.45) * 100) / 100)).toEqual([-1, 0, 1]);
  });

  it('adds to a model that carries a lift of its own instead of overwriting it', () => {
    // A walking settler bobs and a sleeping one is rolled onto its side and
    // raised; a grid that assigned positions would put both flat on the turf.
    const a = slab(1, 1, 1);
    const b = slab(1, 1, 1);
    a.position.set(0.2, 0.035, -0.1);
    placeGrid([a, b], 2);
    expect(a.position.y).toBeCloseTo(0.035, 6);
    expect(a.position.x).toBeCloseTo(0.2 - 1.45 / 2, 6);
    expect(a.position.z).toBeCloseTo(-0.1, 6);
  });

  it('holds the whole box, from any yaw and at any canvas shape', () => {
    // The property the sphere is chosen for: turn the subject on the spot and
    // the distance does not move, so a frame is a function of what is standing
    // in it and not of which way round it happens to be.
    const box = new THREE.Box3(new THREE.Vector3(-3, 0, -1), new THREE.Vector3(3, 2, 1));
    const dist = fitDistance(box, FOV);
    expect(dist).toBeCloseTo(12.4284, 4);
    const turned = new THREE.Box3(new THREE.Vector3(-1, 0, -3), new THREE.Vector3(1, 2, 3));
    expect(fitDistance(turned, FOV)).toBeCloseTo(dist, 6);
    // And the whole of the box is inside the vertical field with the stated air
    // round it: half the diagonal, over the distance, against the half-angle.
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    expect(Math.asin(radius / dist)).toBeLessThan(FOV / 2);
    expect(dist / (radius / Math.sin(FOV / 2))).toBeCloseTo(1.22, 6);
  });
});

describe('how much of a bench frame the subject gets', () => {
  let protos: Prototypes;

  beforeAll(() => {
    protos = prototypes(benchWorld(), new BuildingsView());
  });

  /**
   * The grid the bench's own `Generate` button builds, laid out and framed.
   *
   * `columns` left off on purpose where the shipped arrangement is what is being
   * measured: `placeGrid` carries the stage's own default, so the numbers below
   * move if `COLUMNS` does, which is what makes them a pin on the frame rather
   * than on an argument this file chose.
   */
  function grid(bench: Bench, columns?: number): { shown: THREE.Group; dist: number } {
    const n = bench.grid ?? 12;
    const seeds = Array.from({ length: n }, (_, i) => i * bench.seedStep);
    const models = forgeSeeds(bench, bench.defaults, seeds, protos).map((m) => m.group!);
    expect(models).toHaveLength(n);
    placeGrid(models, columns);
    const shown = new THREE.Group();
    for (const m of models) shown.add(m);
    return { shown, dist: fitDistance(new THREE.Box3().setFromObject(shown), FOV) };
  }

  const pct = (v: number) => Math.round(v * 100);

  it('gives every family between a quarter and a third of the picture', () => {
    // Written as it is and not as it should be. A third is not a good number —
    // it is what a flat grid seen from 27 degrees, framed by a sphere that has
    // no aspect, comes to. The value of the row is that the next change to this
    // file has something to move.
    const got = BENCHES.filter((b) => (b.grid ?? 12) > 1).map((b) => {
      const { shown, dist } = grid(b);
      return [b.name, pct(frameFill(shown, dist))];
    });
    expect(got).toEqual([
      ['stone', 28],
      ['grass', 30],
      ['tree', 32],
      ['stack', 28],
      ['animal', 34],
      ['settler', 33],
    ]);
  });

  it('gave the herd a quarter of the frame before the pitch read both axes', () => {
    // The animals are the family the fault was worst for: they are the only one
    // whose models are nearly three times longer than they are wide, and they
    // stand along z, so the old single pitch stepped the row *across* by their
    // length. Four fenwolves 0.58 m through stood 2.32 m apart.
    const animal = benchByName('animal')!;
    const seeds = Array.from({ length: animal.grid! }, (_, i) => i * animal.seedStep);
    const models = () => forgeSeeds(animal, animal.defaults, seeds, protos).map((m) => m.group!);
    const pitch = gridPitch(models());
    expect(Math.round(pitch.x * 100) / 100).toBe(0.84);
    expect(Math.round(pitch.z * 100) / 100).toBe(2.32);

    /** Four in a row, stepped by `step`, framed. */
    const rowAt = (step: number) => {
      const shown = new THREE.Group();
      models().forEach((m, i) => {
        m.position.x += (i - 1.5) * step;
        shown.add(m);
      });
      return pct(frameFill(shown, fitDistance(new THREE.Box3().setFromObject(shown), FOV)));
    };
    // The old pitch was the larger of the two on both axes; the new one is the
    // axis's own. It is the whole of the difference between the two frames.
    expect(rowAt(pitch.z)).toBe(23);
    expect(rowAt(pitch.x)).toBe(34);
  });

  it('leaves a third of the picture on the table to be the same picture in any window', () => {
    // The trade the sphere makes, in numbers, because the doc claims it and a
    // claim in a comment is not a measurement. Fitting the box itself against
    // both fields is worth a third more subject in every frame.
    const rows = BENCHES.filter((b) => (b.grid ?? 12) > 1).map((b) => {
      const { shown, dist } = grid(b);
      return [b.name, pct(frameFill(shown, dist)), pct(frameFill(shown, boxDistance(shown)))];
    });
    expect(rows).toEqual([
      ['stone', 28, 39],
      ['grass', 30, 43],
      ['tree', 32, 42],
      ['stack', 28, 39],
      ['animal', 34, 38],
      ['settler', 33, 41],
    ]);
    // And where the third comes from, which is the reason it is not being taken
    // here: `fitDistance` takes a box and a lens and nothing else, so twelve
    // trees stand at one distance in any window. An exact box fit is worth four
    // centimetres in a square one and pulls four and a half metres closer as the
    // window widens — so the gain in the column above is not the sphere being
    // loose, it is the canvas being wider than it is tall, and banking it would
    // make every frame a function of the window it was taken in.
    const { shown, dist } = grid(benchByName('tree')!);
    expect(Math.round(dist * 100) / 100).toBe(34.44);
    expect(Math.round(boxDistance(shown, 1) * 100) / 100).toBe(34.02);
    expect(Math.round(boxDistance(shown, 16 / 9) * 100) / 100).toBe(29.84);
  });

  it('is right to stop at four to a row, which nothing had checked', () => {
    // `COLUMNS` is argued in a comment — "past that a grid of twelve is a strip
    // of stamps" — and never measured. Four is within a point of the best
    // column count for five of the six families and costs the piles four, so
    // the comment is right and the piles are the one frame worth a brief.
    const rows = BENCHES.filter((b) => (b.grid ?? 12) > 1).map((b) => {
      const n = b.grid ?? 12;
      let best = 0;
      let at = 0;
      for (let c = 1; c <= n; c++) {
        // Skip a column count that would leave a whole row empty.
        if (c * (Math.ceil(n / c) - 1) >= n) continue;
        const { shown, dist } = grid(b, c);
        const f = frameFill(shown, dist);
        if (f > best) {
          best = f;
          at = c;
        }
      }
      const four = grid(b);
      return [b.name, at, pct(best) - pct(frameFill(four.shown, four.dist))];
    });
    expect(rows).toEqual([
      ['stone', 3, 1],
      ['grass', 4, 0],
      ['tree', 3, 0],
      ['stack', 3, 4],
      ['animal', 4, 0],
      ['settler', 4, 0],
    ]);
  });
});
