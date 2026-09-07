/**
 * The contact shadows baked into the buildings.
 *
 * A shadow written into a vertex attribute is invisible to every other kind of
 * test in this repo: it does not change where a wall stands, how many triangles
 * a tree costs or what the sim thinks is solid, so nothing already here would
 * notice if it stopped happening, arrived upside down, or quietly turned the
 * colony black. These tests are what notices. The numbers in the experience
 * block are the ones the round was tuned against, so a later change that flattens
 * the shadows fails here, with an arithmetic reason, rather than six rounds later
 * in a screenshot nobody can diff.
 *
 * NOTE ON WHERE THIS LIVES: the natural home for the experience half is
 * `buildings-view.test.ts`, which already owns the view. It sits here instead
 * because a second lane was editing that file at the same moment this landed and
 * an append into a file someone else is rewriting is a merge conflict at best.
 * Fold it in when the tree is quiet.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { BuildingsView } from '../src/client/render/buildings';
import { AO_FLOOR, AO_STRENGTH, colorOf, occludeParts } from '../src/client/render/occlusion';
import { BUILDING_COLOR } from '../src/client/render/palette';

/** Every pool in the view that carries a key, which is all of them but the blueprint ghost. */
function pooled(view: BuildingsView): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (mesh.isInstancedMesh && mesh.geometry.name) out.push(mesh);
  });
  return out;
}

function poolOf(view: BuildingsView, key: string): THREE.InstancedMesh {
  const hit = pooled(view).find((m) => m.geometry.name === key);
  expect(hit, `no pool called ${key}`).toBeDefined();
  return hit!;
}

/** A view with every shadow already measured. Node schedules no idle time, so this is the only way. */
function baked(): BuildingsView {
  const view = new BuildingsView();
  expect(view.bakeOcclusion(), 'the default budget has to drain the whole queue').toBe(0);
  return view;
}

function colorsOf(g: THREE.BufferGeometry): Float32Array {
  const a = g.attributes.color as THREE.BufferAttribute | undefined;
  expect(a, `${g.name} has no colour attribute`).toBeDefined();
  return a!.array as Float32Array;
}

/**
 * The parts of one building, cloned out of a view before anything has been baked
 * into them, so a test can occlude them itself under whatever options it wants.
 */
function rawParts(view: BuildingsView, prefix: string): THREE.BufferGeometry[] {
  return pooled(view)
    .filter((m) => m.geometry.name.startsWith(prefix + '.'))
    .map((m) => m.geometry.clone());
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Functional: the bake itself                                                */
/* ────────────────────────────────────────────────────────────────────────── */

describe('the occlusion bake', () => {
  /**
   * Two colonies out of the same build have to be the same colony. There is no
   * random number anywhere in the pass — the hemisphere is a Hammersley
   * sequence and the basis is a closed-form construction — and that is on
   * purpose, because the alternative is a bed that is a shade darker on reload
   * and a look round whose before and after frames differ for no reason anyone
   * can name. Compared bit for bit rather than approximately: "close enough"
   * would pass a bake that had picked up a `Math.random`, which is exactly the
   * thing being ruled out.
   */
  it('gives the same answer twice', () => {
    const a = baked();
    const b = baked();
    for (const key of ['bed.frame', 'stove.body', 'lamp.globe', 'tree.lower']) {
      const first = colorsOf(poolOf(a, key).geometry);
      const second = colorsOf(poolOf(b, key).geometry);
      expect(second.length, key).toBe(first.length);
      let worst = 0;
      for (let i = 0; i < first.length; i++) worst = Math.max(worst, Math.abs(first[i]! - second[i]!));
      expect(worst, `${key} came out differently on the second bake`).toBe(0);
    }
    a.dispose();
    b.dispose();
  });

  /**
   * The uniform grid is an optimisation and nothing else. Brute force over every
   * triangle is the definition of the answer; the grid is that answer arrived at
   * by walking cells near to far, and it is nine times faster, which is the
   * difference between a bake that fits in idle slices and one that does not. So
   * the only defensible claim is that it changes nothing at all, and the only
   * test worth having is the exact one: a grid that is right is bit-identical,
   * and a grid that has an off-by-one in its cell span or a missing clip against
   * its own bounds is not.
   */
  it('takes the fast path to exactly the same place as the slow one', () => {
    const view = new BuildingsView();
    for (const prefix of ['stove', 'gen', 'lamp']) {
      const slow = rawParts(view, prefix);
      const fast = rawParts(view, prefix);
      occludeParts(slow, { ground: true, groundY: 0, mode: 'tri' });
      occludeParts(fast, { ground: true, groundY: 0, mode: 'grid' });
      for (let i = 0; i < slow.length; i++) {
        const a = colorsOf(slow[i]!);
        const b = colorsOf(fast[i]!);
        let worst = 0;
        for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k]! - b[k]!));
        expect(worst, `${slow[i]!.name}: the grid and brute force disagree`).toBe(0);
      }
      for (const g of [...slow, ...fast]) g.dispose();
    }
    view.dispose();
  });

  /**
   * The attribute the colony is shown with before its shadow has been measured
   * has to be an exact identity, because it is attached at construction — which
   * is what compiles the shader's USE_COLOR branch once, up front, instead of
   * recompiling it at whatever frame the shadow happens to arrive. One is the
   * identity of a multiply, so a geometry that had no colour gets ones and looks
   * exactly as it did; a geometry that already had one, like a log pile whose
   * pale cut ends live in its vertices, must be handed back untouched rather than
   * overwritten with ones, which would erase the dye.
   */
  it('attaches its attribute as an identity', () => {
    const bare = new THREE.BoxGeometry(1, 1, 1);
    const made = colorOf(bare);
    expect(made.count).toBe(bare.attributes.position.count);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of made.array as Float32Array) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect([lo, hi], 'a fresh colour attribute has to be all ones or it darkens the building').toEqual([1, 1]);

    const dyed = new THREE.BoxGeometry(1, 1, 1);
    const already = new THREE.BufferAttribute(new Float32Array(dyed.attributes.position.count * 3).fill(0.5), 3);
    dyed.setAttribute('color', already);
    expect(colorOf(dyed), 'colorOf replaced an attribute that was already there').toBe(already);
    for (const v of already.array as Float32Array) expect(v, 'an existing dye was overwritten').toBe(0.5);
    bare.dispose();
    dyed.dispose();
  });

  /**
   * A contact shadow only ever takes light away. The pass multiplies by a factor
   * that is at most one, so every component of every prototype after the drain
   * has to sit at or below where it was before it — and the pools do not all
   * start at one, because `dye` and `dyeEnds` have already written a plank's
   * grain and a log's cut ends into the same attribute. The second half is the
   * one that catches a bake that has quietly stopped happening: something,
   * somewhere, has to actually be darker.
   */
  it('only ever darkens, and only once it is asked to', () => {
    const before = new BuildingsView();
    const after = baked();
    let moved = 0;
    for (const mesh of pooled(after)) {
      const key = mesh.geometry.name;
      const was = colorsOf(poolOf(before, key).geometry);
      const now = colorsOf(mesh.geometry);
      for (let i = 0; i < now.length; i++) {
        expect(now[i]!, `${key} came out brighter than it was built`).toBeLessThanOrEqual(was[i]! + 1e-6);
        if (now[i]! < was[i]! - 1e-6) moved++;
      }
    }
    expect(moved, 'the drain reported itself finished without darkening a single vertex').toBeGreaterThan(1000);
    before.dispose();
    after.dispose();
  });

  /**
   * The asymmetry that makes this whole file necessary: a colour attribute with
   * no `vertexColors` flag is silently ignored, and a `vertexColors` flag with no
   * colour attribute renders BLACK. `MeshStandardMaterial` declares no
   * `defaultAttributeValues`, so the unbound generic attribute stands at the
   * WebGL initial (0, 0, 0, 1) and every fragment is multiplied by zero — a
   * building that is a silhouette, with no error anywhere and nothing in the
   * console. Nothing in a unit test renders, so the flag and the attribute are
   * checked against each other instead, which catches it at the only other place
   * it can be caught.
   */
  it('never flies the flag without the attribute under it', () => {
    const view = new BuildingsView();
    for (const mesh of pooled(view)) {
      const mat = mesh.material as THREE.Material;
      if (!mat.vertexColors) continue;
      expect(
        mesh.geometry.attributes.color,
        `${mesh.geometry.name} has vertexColors on and no colour attribute: it renders black`,
      ).toBeDefined();
      expect(mesh.geometry.attributes.color.count, `${mesh.geometry.name} has a short colour attribute`).toBe(
        mesh.geometry.attributes.position.count,
      );
    }
    view.dispose();
  });

  /**
   * A shadow darkens a colour; it does not repaint it. The proof is a log pile,
   * because `dyeEnds` has already written (1.75, 1.6, 1.35) into the cut ends
   * against a neutral (1, 1, 1) along the sides — the pale sawn face that makes a
   * woodpile read as cut timber rather than as a brown lump. Multiplying by one
   * scalar leaves those three channels in exactly the ratio they arrived in, so
   * after the bake every vertex in the pile is still either neutral or still
   * 1.75 : 1.6 : 1.35, and the ratio is what is asserted rather than the value.
   *
   * This is also the order test in disguise. `dyeEnds` calls `setAttribute` with
   * a fresh array, so a bake that ran before the dye would be erased by it and a
   * dye that ran after would leave every ratio at exactly its original value with
   * no darkening at all — which is why the second half insists that some cut end
   * has actually been shaded.
   */
  it('darkens a dyed cut end without repainting it', () => {
    const view = baked();
    const col = colorsOf(poolOf(view, 'stack.wood').geometry);
    let shaded = 0;
    let brightest = 0;
    for (let k = 0; k < col.length; k += 3) {
      const r = col[k]!;
      const g = col[k + 1]!;
      const b = col[k + 2]!;
      const cap = Math.abs(r / g - 1.75 / 1.6) < 1e-4 && Math.abs(r / b - 1.75 / 1.35) < 1e-4;
      const side = Math.abs(r - g) < 1e-5 && Math.abs(r - b) < 1e-5;
      expect(cap || side, `a log vertex came out at ${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)}`).toBe(true);
      if (cap) {
        brightest = Math.max(brightest, r);
        if (r < 1.75 - 1e-4) shaded++;
      }
    }
    expect(shaded, 'no cut end was shaded at all, so the bake ran before the dye or not at all').toBeGreaterThan(0);
    // And the floor is a floor on the shadow, not on the colour: the darkest a
    // cut end can get is 1.75 x AO_FLOOR, and it must still be the pale end.
    expect(brightest, 'the pale cut ends stopped being pale').toBeGreaterThan(1.75 * AO_FLOOR);
  });

  /**
   * How dark the bake is allowed to make anything, stated twice because the two
   * statements fail differently.
   *
   * First, against the whole set: the shadow is a multiply and its smallest
   * factor is `AO_FLOOR`, so no pooled vertex may come out below `AO_FLOOR` times
   * whatever it was before — including the dyed ones, where the floor lands under
   * a plank already at 0.95 and the product is legitimately 0.76.
   *
   * Then, against the one part that set the constant. `buildings-view.test.ts`
   * pins every kind's darkest lit luminance above 0.025, and a bed's timber frame
   * is the darkest thing in the colony at 0.03283, which is what forced
   * `AO_FLOOR` to 0.80 rather than the 0.76158 where the two meet. That test
   * cannot see this: it builds a view and reads the attribute before anything is
   * baked into it, so it would go on passing on a colony whose beds had gone
   * black. This is the same arithmetic on a view that has actually been baked.
   */
  it('holds the floor the palette test pins', () => {
    const before = new BuildingsView();
    const after = baked();
    for (const mesh of pooled(after)) {
      const key = mesh.geometry.name;
      const was = colorsOf(poolOf(before, key).geometry);
      const now = colorsOf(mesh.geometry);
      for (let i = 0; i < now.length; i++) {
        expect(
          now[i]!,
          `${key} vertex component ${i} fell from ${was[i]!.toFixed(4)} to ${now[i]!.toFixed(4)}, past the floor`,
        ).toBeGreaterThanOrEqual(was[i]! * AO_FLOOR - 1e-6);
      }
    }
    before.dispose();

    const frame = poolOf(after, 'bed.frame');
    const mat = frame.material as THREE.MeshStandardMaterial;
    const col = colorsOf(frame.geometry);
    const tint = new THREE.Color().setHex(BUILDING_COLOR.bed);
    let darkest = Infinity;
    for (let k = 0; k < col.length; k += 3) {
      const lit =
        (1 - mat.metalness) *
        (0.2126 * mat.color.r * tint.r * col[k]! +
          0.7152 * mat.color.g * tint.g * col[k + 1]! +
          0.0722 * mat.color.b * tint.b * col[k + 2]!);
      darkest = Math.min(darkest, lit);
    }
    expect(darkest, `a baked bed frame comes out at ${darkest.toFixed(5)}`).toBeGreaterThan(0.025);
    after.dispose();
  });

  /**
   * The bake outlives the frame it started on, which is the whole point of
   * deferring it and the whole danger. It holds references to every prototype's
   * position, normal and colour arrays, and a view is disposed when the player
   * leaves the colony — so an idle callback that fires after that would be
   * writing into geometries three has freed. `dispose` therefore cancels the
   * pending callback *and* empties the queue, because the drain reschedules
   * itself and cancelling one turn of it only postpones the problem.
   */
  it('abandons the queue when the view is disposed mid-drain', () => {
    const view = new BuildingsView();
    // One building's worth, which leaves the rest of the colony waiting: the
    // state a real dispose interrupts.
    const left = view.bakeOcclusion(0);
    expect(left, 'a zero budget still has to finish the job it started').toBeGreaterThan(0);
    view.dispose();
    expect(view.bakeOcclusion(), 'a disposed view went on baking into freed geometry').toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Experience: what the shadow does to a building                             */
/* ────────────────────────────────────────────────────────────────────────── */

/** The squared distance from a point to a triangle. Ericson, Real-Time Collision Detection 5.1.5. */
function distSqTri(px: number, py: number, pz: number, t: Float32Array, i: number): number {
  const ax = t[i]!;
  const ay = t[i + 1]!;
  const az = t[i + 2]!;
  const bx = t[i + 3]!;
  const by = t[i + 4]!;
  const bz = t[i + 5]!;
  const cx = t[i + 6]!;
  const cy = t[i + 7]!;
  const cz = t[i + 8]!;
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const near = (qx: number, qy: number, qz: number): number => (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  const d1 = abx * (px - ax) + aby * (py - ay) + abz * (pz - az);
  const d2 = acx * (px - ax) + acy * (py - ay) + acz * (pz - az);
  if (d1 <= 0 && d2 <= 0) return near(ax, ay, az);
  const d3 = abx * (px - bx) + aby * (py - by) + abz * (pz - bz);
  const d4 = acx * (px - bx) + acy * (py - by) + acz * (pz - bz);
  if (d3 >= 0 && d4 <= d3) return near(bx, by, bz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return near(ax + abx * v, ay + aby * v, az + abz * v);
  }
  const d5 = abx * (px - cx) + aby * (py - cy) + abz * (pz - cz);
  const d6 = acx * (px - cx) + acy * (py - cy) + acz * (pz - cz);
  if (d6 >= 0 && d5 <= d6) return near(cx, cy, cz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return near(ax + acx * w, ay + acy * w, az + acz * w);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return near(bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w);
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den;
  const w = vc * den;
  return near(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}

function triangles(g: THREE.BufferGeometry): Float32Array {
  const flat = g.index ? g.toNonIndexed() : g;
  const out = new Float32Array(flat.attributes.position.array as ArrayLike<number>);
  if (flat !== g) flat.dispose();
  return out;
}

/** Where the seam is and where the open face is, in metres from the nearest other part. */
const SEAM = 0.02;
const OPEN = 0.12;

/**
 * The mean shade of the vertices that touch another part of the same building
 * and of the vertices that are well clear of every other part, for one building.
 */
function seamAndOpen(view: BuildingsView, prefix: string): { seam: number; open: number; n: number } {
  const parts = pooled(view).filter((m) => m.geometry.name.startsWith(prefix + '.'));
  const tris = parts.map((m) => triangles(m.geometry));
  let seamSum = 0;
  let seamN = 0;
  let openSum = 0;
  let openN = 0;
  for (let i = 0; i < parts.length; i++) {
    const g = parts[i]!.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = g.attributes.color as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const px = pos.getX(k);
      const py = pos.getY(k);
      const pz = pos.getZ(k);
      let best = Infinity;
      for (let j = 0; j < tris.length; j++) {
        if (j === i) continue;
        const t = tris[j]!;
        for (let q = 0; q < t.length; q += 9) {
          const d = distSqTri(px, py, pz, t, q);
          if (d < best) best = d;
        }
      }
      const d = Math.sqrt(best);
      const ao = col.getX(k);
      if (d <= SEAM) {
        seamSum += ao;
        seamN++;
      } else if (d >= OPEN) {
        openSum += ao;
        openN++;
      }
    }
  }
  expect(seamN, `${prefix} has no seam vertices to measure`).toBeGreaterThan(100);
  expect(openN, `${prefix} has no open vertices to measure`).toBeGreaterThan(100);
  return { seam: seamSum / seamN, open: openSum / openN, n: seamN + openN };
}

/**
 * What a player is actually being shown.
 *
 * The complaint the round started from is that a stove reads as a housing with a
 * pipe near it rather than as a stove: every part is lit as though the others
 * were not there, so the flue meets the shell in a hard bright line and the feet
 * are as bright as the lid. The fix is a darker line where two parts meet, and
 * the measurable form of "a darker line where two parts meet" is that vertices
 * within two centimetres of another part come out meaningfully below vertices
 * more than twelve centimetres clear of everything.
 *
 * The thresholds below are the measured values with a little under a third taken
 * off, so ordinary drift does not fail the build but losing the effect does. The
 * measured gaps at the constants this round shipped are stove 0.0922, generator
 * 0.1244, bed 0.0575 and lamp 0.0490; a regression that halved the strength, or
 * dropped the ground plane, or went back to occluding one pool at a time, lands
 * well under every one of them.
 */
describe('a building with its own shadow on it', () => {
  const wanted: [string, number][] = [
    ['stove', 0.065],
    ['gen', 0.087],
    ['bed', 0.040],
    ['lamp', 0.034],
  ];

  it.each(wanted)('darkens where %s meets itself', (prefix, least) => {
    const view = baked();
    const { seam, open } = seamAndOpen(view, prefix);
    expect(
      open - seam,
      `${prefix} seams sit at ${seam.toFixed(4)} against open faces at ${open.toFixed(4)}: the contact shadow is gone`,
    ).toBeGreaterThan(least);
    // And the shadow has to be a shadow rather than a flat tint over the whole
    // building: some face has to still be catching the light. Half the strength
    // of the deepest possible shadow is the line — below that the building has
    // gone uniformly grey and the seam gap is measuring nothing.
    expect(open, `${prefix} has no lit face left at all`).toBeGreaterThan(1 - AO_STRENGTH * 0.5);
    view.dispose();
  });
});
