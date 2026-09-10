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
      ['tree', 32, 43],
      ['stack', 32, 42],
      ['animal', 34, 38],
      ['settler', 29, 40],
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
    // gave it: sixty-six centimetres where it was forty-two. Forty-two, and not
    // the four the line here used to say — 34.44 against 34.02 is 0.42 m, and
    // the round that wrote it dropped a decimal. The four and a half metres in
    // the same sentence was right and is now nearly five.
    const { shown, dist } = grid(benchByName('tree')!);
    expect(Math.round(dist * 100) / 100).toBe(34.43);
    expect(Math.round(boxDistance(shown, 1) * 100) / 100).toBe(33.77);
    expect(Math.round(boxDistance(shown, 16 / 9) * 100) / 100).toBe(29.56);
  });

  it('stands each family at the count its own frames were judged at', () => {
    // The six counts as literal numbers, and the shape each one actually makes.
    // Three of them were moved off the stage's four by twenty-four frames of the
    // same six families at two, three, four and six, so a seventh count arriving
    // without frames behind it should have to come through here. The second and
    // third columns are why this is not just the table restated: they are read
    // back off the laid-out grid, so a count that stopped reaching `placeGrid`
    // would fail even with the table untouched.
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
    ]);
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
      ['animal', 4, 0],
      ['settler', 4, 4],
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
    ]);
  });

  it('is wide enough for the families that have not arrived and the sliders that have', () => {
    // Why 260 and not 220, which would also have covered the wood. A plane large
    // enough to swallow twenty-seven buildings is worth sizing once against the
    // family that has not arrived rather than twice, so the number was chosen
    // against three things this measures and one it cannot.
    //
    // First: everything the game actually has, twelve to a grid, whether or not
    // it has a recipe on this bench yet. That is the whole census — the
    // twenty-seven buildings included — and the widest of them is a wood of the
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
      ['tree', 450, false],
      ['stack', 36, true],
      ['animal', 30, true],
      ['settler', 86, true],
    ]);
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
      ['stone', 47, 0.024, 0.08],
      ['grass', 14, 0, 0],
      ['tree', 138, 0.328, 1],
      ['stack', 27, 0, 0],
      ['animal', 32, 0, 0],
      ['settler', 57, 0.056, 0.186],
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
