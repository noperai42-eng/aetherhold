/**
 * Buildings you can see.
 *
 * The sim decides what is solid; this view decides what is on screen. When those
 * two disagree the player walks into an empty cell and calls it a bug — which is
 * exactly what a fence did until this file existed: real cost, real collision, no
 * mesh. So the bar here is mechanical rather than aesthetic — every kind the build
 * menu offers has to put geometry on the ground where the sim says it stands.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { BuildingsView } from '../src/client/render/buildings';
import { BUILD_MENU, defOf } from '../src/sim/buildings';
import { addBuilding } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import type { BuildingKind, World } from '../src/sim/types';

const SEED = 20260729;

/** Every live instance in the view, as the cell its matrix sits on. */
function instancesAt(view: BuildingsView, x: number, y: number): number {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  let n = 0;
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      pos.setFromMatrixPosition(m);
      if (Math.round(pos.x) === x && Math.round(pos.z) === y) n++;
    }
  });
  return n;
}

/** The tallest point of any instance standing on a cell. */
function heightAt(view: BuildingsView, x: number, y: number): number {
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  let top = 0;
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      if (Math.round(pos.x) !== x || Math.round(pos.z) !== y) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(m);
      top = Math.max(top, box.max.y);
    }
  });
  return top;
}

/** How far any instance on a cell reaches from the cell's centre, on the ground plane. */
function reachAt(view: BuildingsView, x: number, y: number): number {
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  let reach = 0;
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      if (Math.round(pos.x) !== x || Math.round(pos.z) !== y) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(m);
      reach = Math.max(reach, box.max.x - x, x - box.min.x, box.max.z - y, y - box.min.z);
    }
  });
  return reach;
}

/** Triangles in a geometry, indexed or not — what the GPU actually draws per instance. */
function triangles(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

/** A cell nothing already stands on — worldgen scatters trees over most of the map. */
function clearCell(world: World): { x: number; y: number } {
  for (let y = 2; y < world.height - 2; y++) {
    for (let x = 2; x < world.width - 2; x++) {
      if (world.cellBuilding[y * world.width + x] === -1) return { x, y };
    }
  }
  throw new Error('no clear cell');
}

function place(world: World, kind: BuildingKind, x: number, y: number): void {
  const b = addBuilding(world, kind, x, y, true);
  expect(b, `${kind} could not be placed at ${x},${y}`).not.toBeNull();
}

describe('the buildings view', () => {
  it('draws something for every kind the build menu offers', () => {
    for (const kind of BUILD_MENU) {
      const world = createWorld(SEED);
      const view = new BuildingsView();
      const { x, y } = clearCell(world);
      view.sync(world);
      const before = instancesAt(view, x, y);
      place(world, kind, x, y);
      view.sync(world);
      expect(instancesAt(view, x, y), `${kind} draws nothing`).toBeGreaterThan(before);
      view.dispose();
    }
  });

  it('draws a blueprint for every kind before it is built', () => {
    for (const kind of BUILD_MENU) {
      const world = createWorld(SEED);
      const view = new BuildingsView();
      const { x, y } = clearCell(world);
      addBuilding(world, kind, x, y, false);
      view.sync(world);
      expect(instancesAt(view, x, y), `${kind} has no blueprint`).toBeGreaterThan(0);
      view.dispose();
    }
  });

  it('stands each building as tall as the sim says it is', () => {
    // The one number a player checks without meaning to: a wall they cannot see
    // over and a fence they can are different buildings, and the difference is
    // `def.height`. Sandbags are the deliberate exception — the sim treats the
    // stack as low cover and the mesh is two courses of bags, not a slab.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    for (const kind of ['wall', 'stonewall', 'fence', 'door'] as const) {
      const { x, y } = clearCell(world);
      place(world, kind, x, y);
      view.sync(world);
      const top = heightAt(view, x, y);
      const want = defOf(kind).height;
      expect(Math.abs(top - want), `${kind} is ${top} tall, sim says ${want}`).toBeLessThan(0.25);
    }
    view.dispose();
  });

  it('shades nothing flat, because a faceted cylinder is a polygon with a light on it', () => {
    // Smoothness is a property of the materials and the segment counts, not of
    // the camera, so it can be checked without one. A single pool left with
    // `flatShading` on would put one faceted thing in a colony of smooth ones,
    // and the eye finds the odd one out before it finds anything else.
    const view = new BuildingsView();
    view.group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.flatShading, `${mesh.geometry.type} pool is flat-shaded`).toBe(false);
    });
    view.dispose();
  });

  it('keeps the parts drawn by the hundred cheap', () => {
    // Walls, fences, conduits and trees are what a colony is mostly made of, and
    // each of their parts is instanced a few hundred times. Detail on those is
    // paid for on every cell of the perimeter and every tree in the wood, so a
    // pool sized for that many instances has a triangle ceiling per part, and
    // the ceiling is what lets the furniture spend more.
    const view = new BuildingsView();
    view.group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const capacity = mesh.instanceMatrix.count;
      if (capacity < 256) return;
      expect(triangles(mesh.geometry), `a ${capacity}-instance pool draws ${triangles(mesh.geometry)} triangles`).toBeLessThanOrEqual(400);
    });
    view.dispose();
  });

  it('keeps furniture inside its own cell', () => {
    // A bed that pokes into the next cell is a bed a settler walks through, and
    // a stove whose flue stands in the corridor is a stove you cannot get past
    // in first person. Only the things built to reach out are exempt: a fence's
    // rails, a conduit's arms, a turret's barrel, the rod and the wheel that
    // hang over the water, the door on its swing and the crown of a tree.
    const reaching = new Set<BuildingKind>(['fence', 'conduit', 'turret', 'fishhole', 'watermill', 'door', 'tree']);
    const world = createWorld(SEED);
    const view = new BuildingsView();
    for (const kind of BUILD_MENU) {
      if (reaching.has(kind)) continue;
      const { x, y } = clearCell(world);
      place(world, kind, x, y);
      view.sync(world);
      expect(reachAt(view, x, y), `${kind} reaches ${reachAt(view, x, y)} from its centre`).toBeLessThanOrEqual(0.56);
    }
    view.dispose();
  });
});

/** One part of one building, by the key the view built it under. */
function partGeometry(view: BuildingsView, key: string): THREE.BufferGeometry {
  let found: THREE.BufferGeometry | null = null;
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (mesh.isInstancedMesh && mesh.geometry.name === key) found = mesh.geometry;
  });
  expect(found, `no pool called ${key}`).not.toBeNull();
  return found!;
}

/** Every live instance matrix in one pool. */
function matricesOf(view: BuildingsView, key: string): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.geometry.name !== key) return;
    for (let i = 0; i < mesh.count; i++) {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(i, m);
      out.push(m);
    }
  });
  return out;
}

describe('a bed', () => {
  it('has its mattress top at the height the sim lays a sleeper', () => {
    // `standHeight` is where the pawn view draws a body lying in this bed. The
    // sim owns that number; the mesh is built down from it. A mattress two
    // centimetres too high buries the sleeper's shoulders in the ticking, and
    // two centimetres too low leaves them lying on air, and both were true of
    // a bed drawn to a height someone eyeballed. Three beds, one sleeper.
    const view = new BuildingsView();
    for (const [kind, prefix] of [
      ['bed', 'bed'],
      ['medbed', 'med'],
      ['prisonbed', 'prison'],
    ] as const) {
      const g = partGeometry(view, `${prefix}.mattress`);
      g.computeBoundingBox();
      const top = g.boundingBox!.max.y;
      const want = defOf(kind).standHeight;
      expect(Math.abs(top - want), `${kind} mattress tops out at ${top}, sleeper lies at ${want}`).toBeLessThan(0.005);
    }
    view.dispose();
  });
});

describe('a wood', () => {
  it('has crowns with a lobed rim, not a circle turned on a lathe', () => {
    // The tell of a stacked-cone tree is the rim of each tier: a clean
    // horizontal circle where the profile is widest, with every vertex on it
    // at the same radius and the same height. A crown that has been rumpled
    // with low-frequency lobes has only a few vertices out at its full reach
    // and the rest tucked in, and the rim rises and falls as it goes round. So
    // the vertices within a few percent of the maximum radius must be fewer
    // than a full ring — sixteen segments plus the seam copy — and the widest
    // point of each sector round the crown must sit at its own height rather
    // than all of them lying in one plane.
    const view = new BuildingsView();
    const SECTORS = 16;
    for (const key of ['tree.lower', 'tree.upper', 'tree.top']) {
      const pos = partGeometry(view, key).attributes.position;
      let rMax = 0;
      let onRim = 0;
      const widest = new Array<number>(SECTORS).fill(0);
      const rimY = new Array<number>(SECTORS).fill(0);
      for (let k = 0; k < pos.count; k++) rMax = Math.max(rMax, Math.hypot(pos.getX(k), pos.getZ(k)));
      for (let k = 0; k < pos.count; k++) {
        const r = Math.hypot(pos.getX(k), pos.getZ(k));
        if (r >= rMax * 0.96) onRim++;
        const sector = Math.floor(((Math.atan2(pos.getZ(k), pos.getX(k)) + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS;
        if (r > widest[sector]) {
          widest[sector] = r;
          rimY[sector] = pos.getY(k);
        }
      }
      expect(onRim, `${key} has a full ring of ${onRim} vertices at its widest`).toBeLessThan(17);
      expect(Math.max(...rimY) - Math.min(...rimY), `${key}'s rim is a horizontal circle`).toBeGreaterThan(0.05);
    }
    view.dispose();
  });

  it('is not a row of clones', () => {
    // Worldgen scatters a few hundred trees, and from inside a body a treeline
    // of identical, vertical, equal-height crowns reads as a plantation of
    // cutouts however smooth each one is. Each tree draws its own size and lean
    // out of the cell it stands on, so a sample of the wood must show several
    // sizes and at least one trunk off the vertical — and none leaning further
    // than a tree that is still standing up.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    view.sync(world);
    const trunks = matricesOf(view, 'tree.trunk');
    expect(trunks.length).toBeGreaterThan(20);
    const sizes = new Set<number>();
    const up = new THREE.Vector3();
    let leaning = 0;
    for (const m of trunks) {
      const s = new THREE.Vector3().setFromMatrixScale(m);
      sizes.add(Math.round(s.x * 1000));
      up.set(0, 1, 0).transformDirection(m);
      const lean = Math.acos(Math.min(1, up.y));
      expect(lean, `a tree leans ${lean} rad`).toBeLessThan(0.08);
      if (lean > 0.008) leaning++;
    }
    expect(sizes.size, `only ${sizes.size} tree sizes in the wood`).toBeGreaterThanOrEqual(4);
    expect(leaning, 'every tree in the wood stands dead vertical').toBeGreaterThan(0);
    view.dispose();
  });
});

describe('a blueprint', () => {
  it('marks the cell rather than standing a glass block on it', () => {
    // Four planned walls in a row used to be four full-height boxes at a third
    // opaque, and from inside a body they stacked into one cyan slab across a
    // third of the frame. A ghost is a mark on the ground: knee-high at most,
    // faint, and never written into the depth buffer — so a row of them stays
    // a row of cells, and a settler walking over one is drawn over it rather
    // than cut off at the shin.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    addBuilding(world, 'wall', x, y, false);
    view.sync(world);
    expect(heightAt(view, x, y), 'the ghost of a wall stands as tall as the wall').toBeLessThanOrEqual(0.3);
    let ghosts = 0;
    view.group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat.transparent) return;
      ghosts++;
      expect(mat.opacity, 'a ghost dense enough to hide what is behind it').toBeLessThanOrEqual(0.15);
      expect(mat.depthWrite, 'a ghost that cuts into the settlers walking over it').toBe(false);
    });
    expect(ghosts, 'no translucent pool to draw a blueprint with').toBe(1);
    view.dispose();
  });
});

/** How many instances of one part stand on a cell. */
function partsAt(view: BuildingsView, key: string, x: number, y: number): number {
  const pos = new THREE.Vector3();
  let n = 0;
  for (const m of matricesOf(view, key)) {
    pos.setFromMatrixPosition(m);
    if (Math.round(pos.x) === x && Math.round(pos.z) === y) n++;
  }
  return n;
}

describe('a wall', () => {
  it('posts its outside corners and not its length', () => {
    // A corner is where the eye decides whether a building is a building or a
    // row of cubes, and a framed wall has a post there. The middle of a run
    // has no outside corner, so a post there would chop the run back into
    // cells; the end of a run has two; a lone cell, four. The count is what
    // the draw works out from the neighbours, so it is the count that is
    // checked.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    place(world, 'wall', x, y);
    view.sync(world);
    expect(partsAt(view, 'wall.post', x, y), 'a lone wall has a post at each corner').toBe(4);

    place(world, 'wall', x + 1, y);
    place(world, 'wall', x + 2, y);
    view.sync(world);
    expect(partsAt(view, 'wall.post', x + 1, y), 'a post in the middle of a run').toBe(0);
    expect(partsAt(view, 'wall.post', x, y), 'the end of a run has a pair of posts').toBe(2);
    expect(partsAt(view, 'wall.post', x + 2, y), 'the end of a run has a pair of posts').toBe(2);
    view.dispose();
  });
});

describe('a stone wall', () => {
  it('lays its masonry between the plinth and the coping, and not at one depth', () => {
    // The blocks stand proud of the body but inside the coping's footprint,
    // and between the top of the plinth and the underside of the cap, so the
    // wall's outline is still the box the sim collides with. And they stand
    // proud by different amounts: a face of blocks all at one depth is a face
    // with lines drawn on it, and the per-block offset is what makes it stone.
    const view = new BuildingsView();
    const plinth = partGeometry(view, 'stone.plinth');
    const cap = partGeometry(view, 'stone.cap');
    plinth.computeBoundingBox();
    cap.computeBoundingBox();
    for (const key of ['stone.courses', 'stone.bond']) {
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.y, `${key} sinks into the plinth`).toBeGreaterThanOrEqual(plinth.boundingBox!.max.y);
      expect(b.max.y, `${key} rises into the coping`).toBeLessThanOrEqual(cap.boundingBox!.min.y);
      expect(Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z), `${key} stands out past the coping`).toBeLessThanOrEqual(cap.boundingBox!.max.x);
      const depths = new Set<number>();
      const pos = g.attributes.position;
      for (let k = 0; k < pos.count; k++) if (pos.getZ(k) > 0.47) depths.add(Math.round(pos.getZ(k) * 1000));
      expect(depths.size, `${key} has every block on its +z face at the same depth`).toBeGreaterThanOrEqual(3);
    }
    view.dispose();
  });
});

describe('a fence line', () => {
  it('rails towards its neighbours and not into open ground', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    place(world, 'fence', x, y);
    view.sync(world);
    const alone = instancesAt(view, x, y);

    place(world, 'fence', x + 1, y);
    place(world, 'fence', x + 2, y);
    view.sync(world);
    const middle = instancesAt(view, x + 1, y);
    const end = instancesAt(view, x, y);

    // A lone fence is a lone post. The middle of a run reaches both ways, the end
    // reaches once — which is what makes three cells read as one rail rather than
    // three crosses.
    expect(middle).toBeGreaterThan(end);
    expect(end).toBeGreaterThan(alone);
  });

  it('joins onto a wall, because a gate in a paddock is still the paddock', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    place(world, 'fence', x, y);
    view.sync(world);
    const alone = instancesAt(view, x, y);

    place(world, 'wall', x + 1, y);
    view.sync(world);
    expect(instancesAt(view, x, y)).toBeGreaterThan(alone);
  });

  it('ignores a blueprint next door until it is actually built', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    place(world, 'fence', x, y);
    addBuilding(world, 'fence', x + 1, y, false);
    view.sync(world);
    const withGhost = instancesAt(view, x, y);

    const world2 = createWorld(SEED);
    const view2 = new BuildingsView();
    place(world2, 'fence', x, y);
    view2.sync(world2);
    expect(withGhost).toBe(instancesAt(view2, x, y));
  });
});
