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

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

import { BuildingsView } from '../src/client/render/buildings';
import { QUALITY } from '../src/client/render/renderer';
import { SkyView } from '../src/client/render/sky';
import { assemble } from '../src/tools/assemble';
import { benchWorld, forgeSeeds, prototypes } from '../src/forge/forge';
import {
  BENCHES,
  benchByName,
  type Bench,
  type Knobs,
  type Prototypes,
} from '../src/forge/recipes';
import { AZIMUTH, ELEVATION, GROUND, fitDistance, gridPitch, placeGrid } from '../src/forge/stage';

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

/**
 * For each child of `shown`, how much of it something nearer the camera covers.
 *
 * A bounding-box proxy and not a rasterisation: a model becomes the rectangle its
 * eight box corners project into, and it counts as covered where a rectangle
 * whose nearest corner is nearer than its own overlaps it. Boxes are fatter than
 * silhouettes, so this reads high — it is a floor on how much of a model can be
 * seen and not a claim about pixels. What it is for is comparing two arrangements
 * of the same models under the same lens, and for that a consistent over-read is
 * worth more than an exact one that needs a GPU to take.
 */
function hiddenBehind(shown: THREE.Object3D, dist: number, aspect = ASPECT): number[] {
  const box = new THREE.Box3().setFromObject(shown);
  const centre = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(
    Math.cos(ELEVATION) * Math.cos(AZIMUTH),
    Math.sin(ELEVATION),
    Math.cos(ELEVATION) * Math.sin(AZIMUTH),
  );
  const eye = centre.clone().add(dir.clone().multiplyScalar(dist));
  const fwd = dir.clone().negate().normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const tanY = Math.tan(FOV / 2);
  const tanX = tanY * aspect;
  const rects = shown.children.map((m) => {
    const b = new THREE.Box3().setFromObject(m);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let near = Infinity;
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y])
        for (const z of [b.min.z, b.max.z]) {
          const v = new THREE.Vector3(x, y, z).sub(eye);
          const d = v.dot(fwd);
          near = Math.min(near, d);
          const px = v.dot(right) / (d * tanX);
          const py = v.dot(up) / (d * tanY);
          x0 = Math.min(x0, px);
          x1 = Math.max(x1, px);
          y0 = Math.min(y0, py);
          y1 = Math.max(y1, py);
        }
    return { x0, x1, y0, y1, near };
  });
  // A fixed lattice over each rectangle rather than exact rectangle algebra: the
  // covering rectangles overlap each other, and adding their areas up would
  // double-count every overlap. Two hundred a side is a fortieth of a per cent.
  const N = 200;
  return rects.map((r, i) => {
    let hit = 0;
    for (let a = 0; a < N; a++) {
      const px = r.x0 + ((a + 0.5) / N) * (r.x1 - r.x0);
      for (let b = 0; b < N; b++) {
        const py = r.y0 + ((b + 0.5) / N) * (r.y1 - r.y0);
        for (let j = 0; j < rects.length; j++) {
          const o = rects[j]!;
          if (j === i || o.near >= r.near) continue;
          if (px >= o.x0 && px <= o.x1 && py >= o.y0 && py <= o.y1) {
            hit++;
            break;
          }
        }
      }
    }
    return hit / (N * N);
  });
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

/**
 * Where the frame's own corners land on the turf: how far from the origin, and
 * how far from the camera.
 *
 * The four corners and not the middle of the top edge, which is what the round
 * that found this looked at first and why it read the wood as safe: a corner ray
 * carries the horizontal half field as well as the vertical one and leaves along
 * the diagonal, where a square plane's edge is nearest. The wood's top edge is
 * turf at its middle, 71 m out, and off the end of the world at both corners.
 *
 * Two numbers because two things ask. Whether a plane is wide enough is asked
 * from the origin, which is where the plane is centred. How deep into the fog a
 * picture goes is asked from the camera, which stands `dist` back from a subject
 * that is itself standing on the origin — so the two differ by roughly that
 * whole distance: the stones' twelve reach 35 m from the middle of the turf and
 * 47 m from the eye looking at them, which is the difference between sitting
 * inside a 40 m near plane and crossing it.
 *
 * `Infinity` for a ray at or above the horizon, which no plane of any size
 * catches.
 */
function reach(shown: THREE.Object3D, dist: number): { ground: number; eye: number } {
  const box = new THREE.Box3().setFromObject(shown);
  const centre = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(
    Math.cos(ELEVATION) * Math.cos(AZIMUTH),
    Math.sin(ELEVATION),
    Math.cos(ELEVATION) * Math.sin(AZIMUTH),
  );
  const eye = centre.clone().add(dir.clone().multiplyScalar(dist));
  const fwd = dir.clone().negate().normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const tanY = Math.tan(FOV / 2);
  let ground = 0;
  let seen = 0;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const ray = fwd
        .clone()
        .add(right.clone().multiplyScalar(sx * tanY * ASPECT))
        .add(up.clone().multiplyScalar(sy * tanY))
        .normalize();
      if (ray.y >= 0) return { ground: Infinity, eye: Infinity };
      const along = -eye.y / ray.y;
      const hit = eye.clone().add(ray.clone().multiplyScalar(along));
      ground = Math.max(ground, Math.abs(hit.x), Math.abs(hit.z));
      seen = Math.max(seen, along);
    }
  return { ground, eye: seen };
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

  it('lays out at the count it is handed, and at the stage default when it is handed none', () => {
    // The seam the arrangement sweep is shot through. `Stage.show` cannot be
    // called here — it wants a WebGL canvas — so this holds the function under
    // it, which is the part the count travels through.
    const six = () => Array.from({ length: 6 }, () => slab(1, 1, 1));
    const at3 = six();
    placeGrid(at3, 3);
    // Three to a row is two rows: two distinct z, three distinct x.
    expect(new Set(at3.map((m) => Math.round(m.position.z * 1e6))).size).toBe(2);
    expect(new Set(at3.map((m) => Math.round(m.position.x * 1e6))).size).toBe(3);
    const byDefault = six();
    placeGrid(byDefault);
    // Four is the stage's own, so six models make two rows of four and two.
    expect(new Set(byDefault.map((m) => Math.round(m.position.z * 1e6))).size).toBe(2);
    expect(new Set(byDefault.map((m) => Math.round(m.position.x * 1e6))).size).toBe(4);
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

  it('deals the cells by height, tallest into the row furthest from the camera', () => {
    // Handed shortest-first, so an unsorted grid would come out in this order and
    // a sorted one has to come out reversed. Same footprint on all four, so the
    // pitch is one number and the only thing being read is who got which cell.
    const models = [slab(1, 0.2, 1), slab(1, 0.5, 1), slab(1, 1, 1), slab(1, 2, 1)];
    const pitch = placeGrid(models, 2);
    const cell = (m: THREE.Object3D) => [
      Math.round((m.position.x / pitch.x) * 100) / 100,
      Math.round((m.position.z / pitch.z) * 100) / 100,
    ];
    // Row -0.5 is the far row: the camera stands off toward +z. The 2 m slab and
    // the 1 m slab are in it, the two short ones are in front. Read down the
    // column, this is the array handed in — shortest first — so the 0.2 m slab
    // is the near-right cell and the 2 m slab is the far-left one.
    expect(models.map(cell)).toEqual([
      [0.5, 0.5],
      [-0.5, 0.5],
      [0.5, -0.5],
      [-0.5, -0.5],
    ]);
  });

  it('leaves a family that is all one height in the order it arrived, lift and all', () => {
    // The bug this was written off. A box is measured by subtracting its floor
    // from its ceiling, and for a metre-tall slab standing 35 mm off the turf
    // that subtraction returns 0.9999999999999999 rather than 1. Sorted on the
    // raw number, `a` reads as the shorter of two identical slabs and is dealt
    // the near cell — the model's own bob decides where it stands, which is not
    // a decision a bob is entitled to make.
    const a = slab(1, 1, 1);
    const b = slab(1, 1, 1);
    a.position.y = 0.035;
    expect(new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3()).y).not.toBe(1);
    placeGrid([a, b], 2);
    expect(a.position.x).toBeCloseTo(-1.45 / 2, 6);
    expect(b.position.x).toBeCloseTo(1.45 / 2, 6);
  });

  it('is deaf under a millimetre and hears the millimetre', () => {
    // Where the rounding sits, from both sides, because a tolerance nobody has
    // measured the edges of is a tolerance that quietly becomes zero or infinity.
    const under = [slab(1, 1, 1), slab(1, 1.0004, 1)];
    placeGrid(under, 2);
    expect(under[0]!.position.x).toBeCloseTo(-1.45 / 2, 6);

    const over = [slab(1, 1, 1), slab(1, 1.0006, 1)];
    placeGrid(over, 2);
    // Six tenths of a millimetre is a millimetre once rounded, so it goes first.
    // The pitch does not move with it: `gridPitch` reads x and z and not height,
    // which is the whole reason a grid of one footprint and many heights was
    // being dealt cells with no regard to who would be standing behind whom.
    expect(over[1]!.position.x).toBeCloseTo(-1.45 / 2, 6);
  });

  it('holds the whole box, and holds it still at ninety degrees and nowhere else', () => {
    // This pin was called 'from any yaw and at any canvas shape' and the line
    // under it called that the property the sphere is chosen for. Neither half
    // is true, and the yaw half is not true by a third. A sphere has no yaw, but
    // `Box3.setFromObject` has one: it re-measures a turned subject into a box
    // wide enough to hold its corners where they now reach, and the sphere is
    // measured from that box. What is left of the claim is pinned here as it is.
    const box = new THREE.Box3(new THREE.Vector3(-3, 0, -1), new THREE.Vector3(3, 2, 1));
    const dist = fitDistance(box, FOV);
    expect(dist).toBeCloseTo(12.4284, 4);
    // Ninety degrees is the angle the old pin turned, and the only one it could
    // have turned and still passed: an axis-aligned box lands back on itself. It
    // is a property of the box, so every fit that reads one has it, which is why
    // it was never evidence about spheres.
    const turned = new THREE.Box3(new THREE.Vector3(-1, 0, -3), new THREE.Vector3(1, 2, 3));
    expect(fitDistance(turned, FOV)).toBeCloseTo(dist, 6);

    // The same footprint at the angles nobody turned it to, re-measured the way
    // a re-measure actually works: a 6 by 2 rectangle turned by t reaches
    // 3|cos t| + |sin t| across and 3|sin t| + |cos t| through.
    const at = (deg: number) => {
      const t = (deg * Math.PI) / 180;
      const x = 3 * Math.abs(Math.cos(t)) + Math.abs(Math.sin(t));
      const z = 3 * Math.abs(Math.sin(t)) + Math.abs(Math.cos(t));
      return fitDistance(new THREE.Box3(new THREE.Vector3(-x, 0, -z), new THREE.Vector3(x, 2, z)), FOV);
    };
    expect([30, 45, 60].map((d) => Math.round((at(d) / dist - 1) * 1000) / 10)).toEqual([21.3, 24.3, 21.3]);
    expect(at(90) / dist).toBeCloseTo(1, 12);

    // And the whole of the box is inside the vertical field with the stated air
    // round it: half the diagonal, over the distance, against the half-angle.
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    expect(Math.asin(radius / dist)).toBeLessThan(FOV / 2);
    expect(dist / (radius / Math.sin(FOV / 2))).toBeCloseTo(1.22, 6);

    // The canvas half of the old title is the half that nearly holds, and it is
    // worth having the edge of it written down rather than the word 'any'. The
    // sphere is fitted to the vertical field and the horizontal follows the
    // aspect, so anything wider than this is safe with room over; anything
    // narrower crops the subject. The loop shoots at 1.2 and a phone held
    // upright is 0.46, which is the shape this does not cover.
    const narrowest = Math.tan(Math.asin(Math.sin(FOV / 2) / 1.22)) / Math.tan(FOV / 2);
    expect(narrowest).toBeCloseTo(0.804, 3);
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
   * `columns` left off is the shipped arrangement — the bench's own count where
   * it has one and the stage's where it has not — so the numbers below move if
   * either does, which is what makes them a pin on the frame rather than on an
   * argument this file chose. Handed a count, it is the sweep instead; handed
   * knobs, it is whatever a slider can be dragged to rather than what ships.
   */
  function grid(
    bench: Bench,
    columns?: number,
    knobs: Knobs = bench.defaults,
  ): { shown: THREE.Group; dist: number } {
    const n = bench.grid ?? 12;
    const seeds = Array.from({ length: n }, (_, i) => i * bench.seedStep);
    const models = forgeSeeds(bench, knobs, seeds, protos).map((m) => m.group!);
    expect(models).toHaveLength(n);
    placeGrid(models, columns ?? bench.columns);
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
      ['stack', 32],
      ['animal', 34],
      ['settler', 29],
      ['building', 30],
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
      ['grass', 30, 42],
      ['tree', 32, 43],
      ['stack', 32, 42],
      ['animal', 34, 38],
      ['settler', 29, 40],
      ['building', 30, 43],
    ]);
    // And where the third comes from, which is the reason it is not being taken
    // here: `fitDistance` takes a box and a lens and nothing else, so twelve
    // trees stand at one distance in any window. An exact box fit is worth two
    // thirds of a metre in a square one and pulls nearly five metres closer as
    // the window widens — so the gain in the column above is mostly not the
    // sphere being loose, it is the canvas being wider than it is tall, and
    // banking it would make every frame a function of the window it was taken
    // in. The wood is three to a row now, which makes its grid deeper than it
    // is wide and hands the square canvas more to gain than the four-wide one
    // gave it: sixty-seven centimetres where it was forty-two. Forty-two, and not
    // the four the line here used to say — 34.44 against 34.02 is 0.42 m, and
    // the round that wrote it dropped a decimal. The four and a half metres in
    // the same sentence was right and is now nearly five.
    const { shown, dist } = grid(benchByName('tree')!);
    expect(Math.round(dist * 100) / 100).toBe(34.47);
    expect(Math.round(boxDistance(shown, 1) * 100) / 100).toBe(33.8);
    expect(Math.round(boxDistance(shown, 16 / 9) * 100) / 100).toBe(29.6);
  });

  it('frames a turned subject further off, which is what the sphere was said to prevent', () => {
    // The other half of the trade in the test above, measured, because the doc
    // claimed it and a claim in a comment is not a measurement. Turning a family
    // on the spot is supposed to leave the frame alone. Forty-five degrees, per
    // cent further off:
    const turnedBy = (b: Bench, deg: number) => {
      const { shown } = grid(b);
      shown.rotation.y = (deg * Math.PI) / 180;
      shown.updateMatrixWorld(true);
      return fitDistance(new THREE.Box3().setFromObject(shown), FOV);
    };
    const rows = BENCHES.map((b) => [b.name, Math.round((turnedBy(b, 45) / turnedBy(b, 0) - 1) * 100)]);
    expect(rows).toEqual([
      ['stone', 34],
      ['grass', 34],
      ['tree', 26],
      ['stack', 26],
      ['animal', 8],
      ['settler', 11],
      ['building', 28],
    ]);
    // The two that move least are the two whose grids are longest and thinnest —
    // the herd at 1.81 to 1 and the settlers at 2 to 1, against 1.08 to 1.45 for
    // the rest — which is the shape a turn has least room to swell. Written as
    // the ordering it is and not as a formula: a box turned on paper swells by
    // 36 to 41 per cent for every family here, and the geometry inside the box
    // swells by less than that and by a different amount each time.
    for (const b of BENCHES) expect(turnedBy(b, 90) / turnedBy(b, 0)).toBeCloseTo(1, 9);
  });

  it('stands each family at the count its own frames were judged at', () => {
    // The counts as literal numbers, and the shape each one actually makes.
    // Three of them were moved off the stage's four by twenty-four frames of the
    // same six families at two, three, four and six, so a count arriving without
    // frames behind it has to come through here. The second and third columns
    // are why this is not just the table restated: they are read back off the
    // laid-out grid, so a count that stopped reaching `placeGrid` would fail
    // even with the table untouched.
    //
    // The buildings are the row that has not been through that: their 4 is the
    // stage's default and no frame chose it. Seven rows deep is a shape none of
    // the other six make — the next-deepest is the wood at four — and whether
    // twenty-six things want to be seen four to a row is a question for their
    // own sweep. The row is here saying 4 is what ships, not that 4 was judged.
    const rows = BENCHES.map((b) => {
      const { shown } = grid(b);
      const at = shown.children.map((m) => m.position);
      return [
        b.name,
        b.columns ?? 4,
        new Set(at.map((v) => Math.round(v.x * 1e6))).size,
        new Set(at.map((v) => Math.round(v.z * 1e6))).size,
      ];
    });
    expect(rows).toEqual([
      ['stone', 4, 4, 3],
      ['grass', 4, 4, 3],
      ['tree', 3, 3, 4],
      ['stack', 3, 3, 3],
      ['animal', 4, 4, 1],
      ['settler', 6, 6, 2],
      ['building', 4, 4, 7],
    ]);
  });

  it('leaves eleven of the eighty-two more than half hidden, where seventeen were', () => {
    // What the arrangement round was written off, per family, as it is. The first
    // column is how many of that family's grid are more than half covered by
    // something nearer the camera; the second is the mean over the family, in
    // points of the model's own screen rectangle.
    //
    // Dealt in index order, which is what `placeGrid` did before it sorted, the
    // same seven read: 2 and 29, 1 and 25, 6 and 47, 3 and 34, 1 and 31, 0 and 22,
    // 4 and 21. Seventeen of the eighty-two more than half hidden against eleven
    // here, and the buildings' four against none.
    //
    // Two rows are a point worse in the mean and are written that way rather than
    // explained away: the stone goes 29 to 31 while shedding one of its two, and
    // the wood 47 to 48. Both are families of one height, where the sort has
    // nothing to sort and moves models only by narrowing the grid's box.
    //
    // Ten of the eleven left are in those two and the stacks — 1.19 to 1, 1.00 to
    // 1 and 1.10 to 1 in height — where no order helps, because what covers them
    // is footprint against pitch. The eleventh is one of the four animals, and it
    // is a different reason again: four to a row is one row, and a row is all one
    // depth, so the only thing left to hide behind is a neighbour along it. Both
    // are footprint questions and both are a different round from this one.
    const rows = BENCHES.map((b) => {
      const { shown, dist } = grid(b);
      const each = hiddenBehind(shown, dist);
      return [
        b.name,
        each.filter((h) => h > 0.5).length,
        Math.round((each.reduce((t, h) => t + h, 0) / each.length) * 100),
      ];
    });
    expect(rows).toEqual([
      ['stone', 1, 31],
      ['grass', 0, 11],
      ['tree', 6, 48],
      ['stack', 3, 34],
      ['animal', 1, 17],
      ['settler', 0, 22],
      ['building', 0, 14],
    ]);
    expect(rows.reduce((t, r) => t + (r[1] as number), 0)).toBe(11);
    expect(BENCHES.reduce((t, b) => t + (b.grid ?? 12), 0)).toBe(82);
  });

  it('gives up fill only where the frames said fill was the wrong judge', () => {
    // What each family ships at, against what fitting the frame would choose,
    // in points of picture. `COLUMNS = 4` was argued in a comment — "past that
    // a grid of twelve is a strip of stamps" — and never measured; measured, it
    // was within a point for five of six and cost the piles four. The piles now
    // ship at three and that four is recovered. The settlers are the one family
    // shipped against this number, and the cost is written here rather than
    // argued: six gives up four points, because what is wrong with eight poses
    // at four to a row is not their size but which of them is behind which, and
    // no amount of frame-filling fixes an arm through a body.
    //
    // The herd's point is the same coin from the other side, and it was not paid
    // by a column count. `placeGrid` stands the tall ones at the back now, which
    // moves a family's widest models off the edges of its grid and narrows the
    // box a little; for four animals of three very different heights that is
    // enough to make three to a row the fuller frame and to cost the shipped four
    // a point. Bought with it: of the four, one used to be more than half hidden
    // behind a nearer neighbour and none is. A point of picture for a whole
    // animal is the trade this column exists to write down.
    //
    // The buildings give up nothing, which is the one thing the arrangement
    // question for them could be answered on without frames: of the twenty-six
    // column counts a twenty-six-model grid could take, the stage's default is
    // already the one that fills the most picture. That held — their sweep moved
    // them off nothing, because what was wrong with twenty-six buildings at four
    // to a row was never the four. It was that a door 2.60 m tall and a conduit
    // 0.055 m tall were dealt cells in alphabetical order.
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
      const shipped = grid(b);
      return [b.name, at, pct(best) - pct(frameFill(shipped.shown, shipped.dist))];
    });
    expect(rows).toEqual([
      ['stone', 3, 1],
      ['grass', 4, 0],
      ['tree', 3, 0],
      ['stack', 3, 0],
      ['animal', 3, 1],
      ['settler', 4, 4],
      ['building', 4, 0],
    ]);
  });

  it('stands every frame on its own turf, the wood by a quarter of the plane', () => {
    // The round before found this by looking, and overstated it: it called the
    // top of the wood's frame a third sky, when the measurement behind that
    // number could not tell sky from turf gone dark. The sky was 743 pixels of
    // 1.7 million, two wedges in the top corners eleven rows deep, and the rest
    // of that dark band is turf under the bench's fog. Small, and still the far
    // edge of the world in shot. The cause is height, not arrangement:
    // `fitDistance` puts the camera on the line out of the box's centre, so a
    // wood four metres tall at its middle rides the camera up while the pitch
    // stays 27 degrees down, and the frame's two top corners cleared the far
    // side of the 200 m plane the bench used to lay. The turf is 260 now, and
    // the same frame has no sky in it at all.
    //
    // Metres from the origin against a half-extent of 130. The wood is the
    // reason for the number and it is the only family anywhere near the edge:
    // the next-widest frame is the settlers' at 43, which is a third of the way
    // out. Written as it is: these six move when the recipes move, and the third
    // column is the only one that has to stay true.
    const rows = BENCHES.map((b) => {
      const { shown, dist } = grid(b);
      const far = reach(shown, dist).ground;
      return [b.name, Math.round(far), far <= GROUND / 2];
    });
    expect(rows).toEqual([
      ['stone', 35, true],
      ['grass', 11, true],
      ['tree', 105, true],
      ['stack', 21, true],
      ['animal', 25, true],
      ['settler', 43, true],
      ['building', 74, true],
    ]);
  });

  it('is wide enough for the whole census and for the sliders at the top of their range', () => {
    // Why 260 and not 220, which would also have covered the wood. A plane large
    // enough to swallow twenty-six buildings is worth sizing once against the
    // family that had not arrived rather than twice, so the number was chosen
    // against three things this measures and one it cannot. The family has since
    // arrived and stands at 75 m in the row below, which is what sizing against
    // a guess bought: nothing had to move when the guess came true.
    //
    // First: everything the game actually has, twelve to a grid, whether or not
    // it has a recipe on this bench yet. That is the whole census — the
    // twenty-six buildings included — and the widest of them is a wood of the
    // second tree at 86 m, which is a smaller wood than the bench's own.
    const view = new BuildingsView();
    view.sync(benchWorld());
    view.bakeOcclusion();
    const census = assemble(view.group)
      .map((a) => {
        const twelve = Array.from({ length: 12 }, () => a.group.clone());
        placeGrid(twelve);
        const shown = new THREE.Group();
        for (const m of twelve) shown.add(m);
        const box = new THREE.Box3().setFromObject(shown);
        return { name: a.name, far: box.isEmpty() ? 0 : reach(shown, fitDistance(box, FOV)).ground };
      })
      .sort((a, b) => b.far - a.far);
    expect(census.length).toBe(37);
    expect([census[0].name, Math.round(census[0].far)]).toEqual(['tree.b', 86]);
    expect(census.every((c) => c.far <= GROUND / 2)).toBe(true);

    // Second: every bench with every slider dragged to the top of its range,
    // which is a frame a person can actually take and the look loop never does.
    // Five of the six still stand on turf there, the widest being the grass at
    // 117 m — which is what the extra thirty metres over the wood's 105 is for.
    //
    // Third, the one this plane cannot cover: the wood at the top of its sliders
    // is eleven metres tall and reaches 450 m, and no plane fixes that, because
    // 450 is past this camera's own 400 m far plane. The row says so rather than
    // the number quietly stopping short of it.
    const maxed = BENCHES.map((b) => {
      const top: Record<string, number> = { ...b.defaults };
      for (const f of b.fields) if (f.key !== b.seedKey) top[f.key] = f.max;
      expect(b.problems(top)).toEqual([]);
      const { shown, dist } = grid(b, undefined, top);
      const far = reach(shown, dist).ground;
      return [b.name, Math.round(far), far <= GROUND / 2];
    });
    expect(maxed).toEqual([
      ['stone', 62, true],
      ['grass', 117, true],
      ['tree', 447, false],
      ['stack', 36, true],
      ['animal', 30, true],
      ['settler', 85, true],
      ['building', 74, true],
    ]);
    // The buildings are the row where maxing changes nothing, and the reason is
    // worth a line rather than a shrug: their only field is the one that picks
    // which building, and the loop above skips a bench's seed key because
    // dragging a seed is not a slider being tested. A bench with no other knob
    // therefore measures the same here as it does two tests up. When the recipe
    // treatment reaches this family the row will start moving, and if it never
    // does, the recipe treatment never reached this family.
  });

  it('hazes what the turf is wide enough to show with the bench world own sky', () => {
    // The round that widened the turf left a dark band across the top of the
    // wood's frame that it could not account for, and it was not sky: it was
    // turf, under the fog `Viewport`'s constructor leaves in every scene for
    // whoever draws into it to overwrite. The world view overwrites it every
    // frame from the sky it just synced. This bench never did, so a bench frame
    // at noon faded into a slate blue that belongs to no hour of the game's day
    // and no weather in it.
    //
    // What that cost, family by family. The third column is the slate, the
    // second is the sky, and both are how far into the haze the far corner of
    // that family's frame sits — the same corner the turf is sized against, but
    // measured from the eye rather than from the origin, because fog is depth
    // from the camera and the camera stands a frame's whole distance back.
    //
    // These six predict the sweep either side of this change, canvas by canvas.
    // The three at zero are pixel-identical between the two. The stones and the
    // settlers moved in a band along the top by no more than six of 255, which
    // is a fifth and a twentieth of the way into a haze that is nearly the
    // colour of the turf already. And the wood — the one frame on this bench
    // with real distance in it — was *entirely* fogged before: its far corner
    // stands 138 m from the eye and `Viewport`'s slate stops counting at 130,
    // so the top of that picture was the raw night-blue rather than anything
    // mixed with turf. That is the 110-of-255 band the frames show, and it is
    // the whole visible difference between the two sweeps.
    const world = benchWorld();
    const sky = new SkyView(world, QUALITY.high);
    sky.sync(world, 0, 0);
    const fog = new THREE.Fog(0x223040, 40, 130);
    sky.applyFog(fog, world);
    const slate = new THREE.Fog(0x223040, 40, 130);
    const depth = (d: number, f: THREE.Fog): number =>
      Math.round(1000 * Math.min(1, Math.max(0, (d - f.near) / (f.far - f.near)))) / 1000;
    const rows = BENCHES.map((b) => {
      const { shown, dist } = grid(b);
      const far = reach(shown, dist).eye;
      return [b.name, Math.round(far), depth(far, fog), depth(far, slate)];
    });
    expect([fog.color.getHexString(), fog.near, Math.round(fog.far * 100) / 100]).toEqual(['b6a18f', 40, 339.41]);
    expect(rows).toEqual([
      ['stone', 47, 0.023, 0.078],
      ['grass', 14, 0, 0],
      ['tree', 138, 0.329, 1],
      ['stack', 27, 0, 0],
      ['animal', 32, 0, 0],
      ['settler', 57, 0.055, 0.184],
      ['building', 98, 0.194, 0.647],
    ]);
  });

  it('asks the sky for that haze rather than keeping a second copy of it', () => {
    // What the test above cannot see, because it calls `applyFog` itself: that
    // the bench calls it at all. The bug it is standing in for was never a wrong
    // number, it was four lines the world view had and this file did not, so the
    // pin that matters is the one that fails when they go missing again — or
    // when they come back as a copy. A second copy is a second lighting
    // decision, and `stage.ts` opens by saying it makes none.
    const hand: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(path);
        else if (e.name.endsWith('.ts') && !path.endsWith('/sky.ts')) {
          const text = readFileSync(path, 'utf8');
          if (/fog\.(near|far)\s*=|fog\.color\.copy\(/.test(text)) hand.push(path.split('/src/')[1]!);
        }
      }
    };
    for (const dir of ['client/render', 'forge']) {
      walk(fileURLToPath(new URL(`../src/${dir}`, import.meta.url)));
    }
    expect(hand).toEqual([]);
    const stage = readFileSync(fileURLToPath(new URL('../src/forge/stage.ts', import.meta.url)), 'utf8');
    expect(/this\.sky\.applyFog\(/.test(stage)).toBe(true);
  });

  it('never lets two models touch, in any family, at any count', () => {
    // What `GAP` promises, held for the first time. Two rounds went looking for
    // a number behind the crowded frames and threw out two of them; this is the
    // one that survived, and it says the crowding is not here. Every family
    // clears at every count the arrangement sweep was shot at, and at both
    // ends past it — one to a row and the whole family in one row — which means
    // a frame where a barrel lies across a crate is a frame where the barrel
    // and the crate are metres apart and the camera is standing on the line
    // between them. Occlusion, not contact — so the next person to see a
    // crowded bench frame can stop looking for a spacing bug and go and move
    // the camera.
    const touching: string[] = [];
    for (const b of BENCHES) {
      const n = b.grid ?? 12;
      if (n <= 1) continue;
      for (const columns of [1, 2, 3, 4, 6, n]) {
        const { shown } = grid(b, columns);
        const boxes = shown.children.map((m) => new THREE.Box3().setFromObject(m));
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            if (boxes[i].intersectsBox(boxes[j])) touching.push(`${b.name}@${columns}:${i}/${j}`);
          }
        }
      }
    }
    expect(touching).toEqual([]);
  });
});
