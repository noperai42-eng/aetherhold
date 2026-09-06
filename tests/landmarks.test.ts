/**
 * The finds on the map, as things you can see.
 *
 * The bar here is that the picture and the simulation never disagree about what
 * the colony knows. A marker over a site somebody already surveyed is a to-do
 * the player cannot clear; a site with nothing on it at all is the bug this
 * whole module exists to fix — eighteen buried caches and ore seams that the map
 * never once mentioned.
 *
 * The other half is that it stays cheap and stays put: four draw calls for the
 * whole set however many finds a map holds, and a cairn that does not move when
 * something across the map changes.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { LandmarkView } from '../src/client/render/landmarks';
import { TERRAIN_COLOR } from '../src/client/render/palette';
import { createWorld } from '../src/sim/worldgen';
import type { World } from '../src/sim/types';

const SEED = 20260729;

/** Every drawn instance of a mesh, as a world position. */
function placed(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push(new THREE.Vector3().setFromMatrixPosition(m));
  }
  return out;
}

/** The four instanced meshes, in the order the view adds them. */
function meshes(view: LandmarkView): THREE.InstancedMesh[] {
  return view.group.children.filter(
    (c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh === true,
  );
}

function pins(view: LandmarkView): THREE.InstancedMesh {
  const all = meshes(view);
  return all[all.length - 1]!;
}

/** Ground pieces — everything except the markers. */
function ground(view: LandmarkView): THREE.Vector3[] {
  const all = meshes(view);
  return all.slice(0, -1).flatMap(placed);
}

/** Rec. 709 luminance of a linear colour — the space these vertex colours are in. */
function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** How far a colour is from grey, before any judgement about how bright it is. */
function chroma(c: THREE.Color): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
}

function view(world: World): LandmarkView {
  const v = new LandmarkView(world);
  v.sync(world, world.tick);
  return v;
}

describe('what the map shows about what is out there', () => {
  it('marks every site nobody has been to yet', () => {
    const world = createWorld(SEED);
    expect(world.sites.length).toBeGreaterThan(0);
    const v = view(world);
    expect(pins(v).count).toBe(world.sites.length);
    v.dispose();
  });

  it('puts each marker over its own site', () => {
    const world = createWorld(SEED);
    const v = view(world);
    const at = placed(pins(v)).map((p) => `${Math.round(p.x)},${Math.round(p.z)}`).sort();
    const want = world.sites.map((s) => `${s.x},${s.y}`).sort();
    expect(at).toEqual(want);
    v.dispose();
  });

  it('floats the marker clear of the ground it stands on', () => {
    // Not decoration and not an obstacle: it hangs where nothing in the world
    // hangs, which is the only thing telling the player it is a marker and not a
    // post they are meant to walk round. Nothing here is collidable.
    const world = createWorld(SEED);
    const v = view(world);
    for (const p of placed(pins(v))) expect(p.y).toBeGreaterThan(1.5);
    // The ground pieces are the opposite promise: knee high at the very most, so
    // walking through one in first person is not a thing you notice.
    for (const g of ground(v)) expect(g.y).toBeLessThan(0.8);
    v.dispose();
  });

  it('takes the marker down once a settler has read the site', () => {
    const world = createWorld(SEED);
    const v = view(world);
    const before = pins(v).count;
    world.sites[0]!.found = true;
    v.sync(world, world.tick + 1);
    // A marker still standing over a surveyed site is a to-do the player cannot
    // clear — the one failure that would make the whole map read as noise.
    expect(pins(v).count).toBe(before - 1);
    const near = placed(pins(v)).some(
      (p) => Math.round(p.x) === world.sites[0]!.x && Math.round(p.z) === world.sites[0]!.y,
    );
    expect(near).toBe(false);
    v.dispose();
  });

  it('leaves the find itself behind where the marker was', () => {
    const world = createWorld(SEED);
    const site = world.sites[0]!;
    const v = view(world);
    site.found = true;
    v.sync(world, world.tick + 1);
    // Whatever kind it was, something is standing on that cell afterwards: the
    // crate, the split seam or the cold camp. Where the colony has been is meant
    // to stay legible a week later.
    const here = ground(v).filter(
      (p) => Math.abs(p.x - site.x) < 1.5 && Math.abs(p.z - site.y) < 1.5,
    );
    expect(here.length).toBeGreaterThan(0);
    v.dispose();
  });

  it('draws every find on the map in four calls', () => {
    // One mesh per primitive rather than one per rock. Eighteen sites of loose
    // stones and sticks would otherwise add more draw calls than the entire
    // rest of the colony has.
    const world = createWorld(SEED);
    const v = view(world);
    expect(meshes(v).length).toBe(4);
    expect(v.group.children.length).toBe(4);
    v.dispose();
  });

  it('does not move a cairn when something unrelated is surveyed', () => {
    const world = createWorld(SEED);
    const v = view(world);
    const before = placed(pins(v))
      .map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`)
      .sort();
    world.sites[world.sites.length - 1]!.found = true;
    v.sync(world, world.tick + 1);
    const after = placed(pins(v))
      .map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`)
      .sort();
    // Placement is seeded off the site's own id, so the rest of the map holds
    // still while one find resolves.
    expect(after).toEqual(before.filter((s) => after.includes(s)));
    expect(after.length).toBe(before.length - 1);
    v.dispose();
  });

  it('bobs the marker on the sim clock, so a paused game holds still', () => {
    const world = createWorld(SEED);
    const v = view(world);
    const still = placed(pins(v))[0]!.y;
    v.sync(world, world.tick);
    expect(placed(pins(v))[0]!.y).toBe(still);
    v.sync(world, world.tick + 30);
    expect(placed(pins(v))[0]!.y).not.toBe(still);
    v.dispose();
  });

  it('rounds every ground piece off without letting it grow or go flat', () => {
    // The pieces are placed by radius — a cairn stone bites into the one below
    // because their centres are less than two radii apart, a crate lid leans off
    // a crate edge. A rounded shape that had swelled past its unit would float
    // those overlaps apart; one lit flat would be back to the die it replaced.
    // And they draw once per rock across the map, so each stays under budget.
    const world = createWorld(SEED);
    const v = view(world);
    for (const mesh of meshes(v).slice(0, -1)) {
      const mat = mesh.material as THREE.MeshLambertMaterial;
      expect(mat.flatShading).toBe(false);
      const geo = mesh.geometry;
      const tris = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
      expect(tris).toBeLessThanOrEqual(200);
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(box.min[axis]).toBeGreaterThanOrEqual(-0.56);
        expect(box.max[axis]).toBeLessThanOrEqual(0.56);
      }
    }
    v.dispose();
  });

  it('welds every lump so it lights as one skin and not as facets', () => {
    // The stones and ore chunks are subdivided polyhedra, which three hands
    // over as unshared triangles: nudge those and the faces tear, light those
    // and every facet carries its own normal. Welded, each vertex is shared —
    // fewer vertices than three per triangle — and the smooth material has a
    // smooth surface to shade. The planks are a rounded box that arrives with
    // its own analytic normals, so the weld is only owed by the two lumps.
    const world = createWorld(SEED);
    const v = view(world);
    const [stones, , shards] = meshes(v);
    for (const mesh of [stones!, shards!]) {
      const geo = mesh.geometry;
      expect(geo.index).not.toBeNull();
      expect(geo.getAttribute('normal')).toBeDefined();
      expect(geo.getAttribute('position').count).toBeLessThan(geo.index!.count);
    }
    v.dispose();
  });

  it('builds its cairns and fire rings from the stone that lies loose on the ground', () => {
    // Two families of pebble on one map — the scatter warm and grey-brown, the
    // cairns in the cliff's navy — read as two games. A frame from the manager
    // camera showed the cairns as near-black pucks in the mid-ground while the
    // loose stones beside them had already gone warm. Every stone here, cairn
    // or ring or crate spill, has to be the same warm mid grey; and the ore
    // chunks may be darker than that but never near-black.
    const world = createWorld(SEED);
    // Survey a few sites so the crate spills, camps and ore faces are drawn too.
    for (const site of world.sites.slice(0, 6)) site.found = true;
    const v = view(world);
    const [stones, , shards] = meshes(v);
    expect(stones!.count).toBeGreaterThan(0);
    const c = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    for (let i = 0; i < stones!.count; i++) {
      stones!.getColorAt(i, c);
      const { h, l } = c.getHSL(hsl, THREE.SRGBColorSpace);
      expect(h).toBeLessThan(0.2);
      expect(l).toBeGreaterThan(0.3);
      expect(l).toBeLessThan(0.65);
    }
    for (let i = 0; i < shards!.count; i++) {
      shards!.getColorAt(i, c);
      expect(c.getHSL(hsl, THREE.SRGBColorSpace).l).toBeGreaterThan(0.28);
    }
    v.dispose();
  });

  it('gives the marker a body, since nothing else is going to light it', () => {
    // The marker takes no light on purpose — it must not dim at dusk with the
    // rest of the colony — and an unlit solid with one colour on every face is
    // its own silhouette and nothing more. That is exactly how the old
    // octahedron reached a frame: a flat gold disc, magnified by hanging two
    // metres closer to the camera than the ground, lying among the grass beside
    // its own cairn. So the shading is baked in, and it has to actually vary:
    // a lit top and a shaded underside, on a shape with depth in all three axes.
    const world = createWorld(SEED);
    const v = view(world);
    const geo = pins(v).geometry;
    const col = geo.getAttribute('color');
    expect(col).toBeDefined();
    const c = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    let lightest = 0;
    let darkest = 1;
    for (let i = 0; i < col.count; i++) {
      const { l } = c.fromBufferAttribute(col, i).getHSL(hsl, THREE.SRGBColorSpace);
      lightest = Math.max(lightest, l);
      darkest = Math.min(darkest, l);
    }
    expect(lightest - darkest).toBeGreaterThan(0.1);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(box.max[axis] - box.min[axis]).toBeGreaterThan(0.2);
    }
    v.dispose();
  });

  it('shades the bead from a lit crown down to an underside in shadow', () => {
    // The previous test asks only that two vertices differ. That passed while
    // the marker was photographing as dough: the ramp was there but it was
    // 2.2:1 in linear luminance, and at manager zoom a forty-pixel bead with a
    // 2.2:1 range is one tone with a hint of another at the rim. Reading the top
    // half of the silhouette against the bottom half is the number that survives
    // the pin bobbing and precessing, since half of every ring is turned away
    // from the sun whatever the azimuth; the built bead measures 1.81:1 there,
    // and 4.80:1 between its brightest and darkest vertex. The floor is set
    // below both and well above what the flat bead managed, so the failure it
    // catches is a return to that flatness and not a tenth of a stop of drift.
    const world = createWorld(SEED);
    const v = view(world);
    const geo = pins(v).geometry;
    const col = geo.getAttribute('color');
    const pos = geo.getAttribute('position');
    geo.computeBoundingBox();
    const mid = (geo.boundingBox!.min.y + geo.boundingBox!.max.y) / 2;
    const c = new THREE.Color();
    let top = 0;
    let topN = 0;
    let bottom = 0;
    let bottomN = 0;
    let brightest = 0;
    let darkest = Infinity;
    for (let i = 0; i < col.count; i++) {
      const l = luminance(c.fromBufferAttribute(col, i));
      brightest = Math.max(brightest, l);
      darkest = Math.min(darkest, l);
      if (pos.getY(i) >= mid) {
        top += l;
        topN++;
      } else {
        bottom += l;
        bottomN++;
      }
    }
    expect(topN).toBeGreaterThan(0);
    expect(bottomN).toBeGreaterThan(0);
    expect(top / topN / (bottom / bottomN)).toBeGreaterThan(1.7);
    expect(brightest / darkest).toBeGreaterThan(4);
    // The ramp is only affordable because it is baked: one unlit material, one
    // geometry, one draw call for every marker on the map, and a bead that costs
    // about what the ground pieces beside it do.
    const mat = pins(v).material as THREE.Material;
    expect((mat as THREE.MeshBasicMaterial).isMeshBasicMaterial).toBe(true);
    expect((mat as THREE.MeshBasicMaterial).vertexColors).toBe(true);
    const tris = (geo.index ? geo.index.count : pos.count) / 3;
    expect(tris).toBeLessThanOrEqual(200);
    v.dispose();
  });

  it('stands the marker off the pale ground it most often sits on', () => {
    // A marker is only a marker if the eye finds it without being told where to
    // look, and the ground it has to beat is sand: the dig sites and the buried
    // caches cluster on the open pale stuff, and that is where the old bead
    // vanished. It vanished by being *brighter* than the sand and barely more
    // coloured than it — 1.85× the luminance at 1.97× the chroma per unit of it,
    // which through a tone map at exposure 1.3 is two washed creams side by side.
    // So the separation asked for here is colour and not brightness: at least
    // twice the sand's chroma for the light it carries, while staying inside a
    // luminance band that rules out solving it by turning the marker into a lamp.
    // The built bead measures 2.42× the chroma and 1.47× the luminance.
    const world = createWorld(SEED);
    const v = view(world);
    const col = pins(v).geometry.getAttribute('color');
    const c = new THREE.Color();
    const mean = new THREE.Color(0, 0, 0);
    for (let i = 0; i < col.count; i++) {
      c.fromBufferAttribute(col, i);
      mean.r += c.r / col.count;
      mean.g += c.g / col.count;
      mean.b += c.b / col.count;
    }
    const sand = new THREE.Color(TERRAIN_COLOR.sand);
    const perLight = (x: THREE.Color): number => chroma(x) / luminance(x);
    expect(perLight(mean) / perLight(sand)).toBeGreaterThan(2);
    expect(luminance(mean) / luminance(sand)).toBeGreaterThan(1.2);
    expect(luminance(mean) / luminance(sand)).toBeLessThan(1.7);
    v.dispose();
  });

  it('copes with a map that has no finds on it at all', () => {
    const world = createWorld(SEED);
    world.sites.length = 0;
    const v = view(world);
    expect(pins(v).count).toBe(0);
    expect(ground(v).length).toBe(0);
    v.dispose();
  });
});
