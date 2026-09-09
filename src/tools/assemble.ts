/**
 * What the colony's models *are*, lifted off the renderer and standing on their own.
 *
 * Split out of `models.ts` when the forge arrived, and split along a line worth
 * naming: this file reads the views and hands back plain Three objects, and
 * nothing in it touches the filesystem. That is the whole reason it exists.
 * `models.ts` writes `.glb` and so imports `node:fs`, which a browser bundle
 * cannot resolve — so the bench in `src/forge/` could not have reused a line of
 * it without a second copy of the gathering logic, and a second copy is exactly
 * what the doc comment over there spends four paragraphs refusing to have.
 *
 * The principle both consumers inherit: this *drives* the renderer rather than
 * re-listing what the renderer knows. Shapes come out of the pools themselves,
 * found by walking `view.group`; colours are read off `instanceColor` at
 * instance zero, which is the true tint straight off the real draw path. A
 * prototype the renderer stopped building is a prototype that stops appearing
 * here, with no list to remember to edit.
 */

import * as THREE from 'three';

import type { PawnsView } from '../client/render/pawns';
import type { World } from '../sim/types';

/**
 * The same seed the look harness photographs, so a model exported here is the
 * model in the frames on disk and a colour argument can be settled by opening
 * one of them.
 */
export const SEED = 4242;

/**
 * Which file a pool belongs in. This mirrors the grouping `queueOcclusion` uses,
 * and it mirrors it for the same reason: the two crown variants are alternatives
 * that no single tree ever wears, so putting them in one file would hand a
 * consumer a tree with two heads; and the eight resource piles are eight
 * different objects that happen to share a prefix.
 */
export function assemblyOf(key: string): string {
  if (key.startsWith('stack.')) return key;
  if (key.startsWith('tree.')) return key.endsWith('.b') ? 'tree.b' : 'tree';
  const dot = key.indexOf('.');
  return dot < 0 ? key : key.slice(0, dot);
}

/** Every pooled prototype currently hanging off a view, keyed by geometry name. */
export function poolsOf(group: THREE.Object3D): Map<string, THREE.InstancedMesh> {
  const found = new Map<string, THREE.InstancedMesh>();
  group.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isInstancedMesh) return;
    const name = m.geometry.name;
    if (name) found.set(name, m);
  });
  return found;
}

/** The tint the renderer actually wrote for the first instance, if it wrote one. */
function firstTint(mesh: THREE.InstancedMesh): THREE.Color | null {
  const a = mesh.instanceColor;
  if (!a || mesh.count === 0) return null;
  return new THREE.Color(a.getX(0), a.getY(0), a.getZ(0));
}

export interface Assembly {
  /** The file this becomes, without the extension. */
  name: string;
  /** Pool keys, in the order the renderer declares them. */
  parts: string[];
  /**
   * Parts whose colour is the family's rather than their own, because nothing
   * was standing in that pool at export time. A wall on its own has no closers
   * in it, so `wall.closer` comes out the colour of the wall around it. Named
   * here rather than left as a surprise.
   */
  borrowed: string[];
  group: THREE.Group;
}

/**
 * A view's pools, gathered into one flat group per assembly, each mesh sitting at
 * the origin.
 *
 * The prototypes already are at the origin: the renderer composes a translation
 * per instance and the geometry itself is authored around zero at the right
 * height above the ground, so a plain `Mesh` of the pool's geometry is the model
 * without anything having to be undone.
 */
export function assemble(group: THREE.Object3D): Assembly[] {
  const byName = new Map<string, Assembly>();
  const tints = new Map<string, THREE.Color>();
  for (const [key, mesh] of poolsOf(group)) {
    const name = assemblyOf(key);
    let a = byName.get(name);
    if (!a) {
      a = { name, parts: [], borrowed: [], group: new THREE.Group() };
      a.group.name = name;
      byName.set(name, a);
    }
    const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
    const tint = firstTint(mesh);
    // A pool with nothing in it this run never had a tint written, and a tinted
    // pool's own material is a near-white waiting to be multiplied — so exporting
    // it raw would hand over a white door handle. Borrowing the assembly's tint is
    // wrong in the small (a handle is not the door) and right in the large: it is
    // the family's colour rather than no colour at all, and the manifest says
    // which parts were guessed at so a consumer can go and look.
    if (tint) tints.set(name, tint);
    const use = tint ?? tints.get(name) ?? null;
    if (use) mat.color.multiply(use);
    if (!tint && mesh.instanceColor) a.borrowed.push(key);
    mat.name = key;
    const proto = new THREE.Mesh(mesh.geometry, mat);
    proto.name = key;
    proto.castShadow = mesh.castShadow;
    proto.receiveShadow = mesh.receiveShadow;
    a.group.add(proto);
    a.parts.push(key);
  }
  return [...byName.values()].sort((p, q) => p.name.localeCompare(q.name));
}

/** Triangles in an assembly, which is the number a consumer budgets against. */
export function triangles(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
  });
  return Math.round(n);
}

/** Each pawn's rig, lifted off the map and named for what it is. */
export function pawnAssemblies(world: World, view: PawnsView): Assembly[] {
  const shown = world.pawns.filter((p) => !p.buried);
  const kids = view.group.children;
  if (kids.length !== shown.length) {
    throw new Error(
      `the pawn view holds ${kids.length} rigs for ${shown.length} bodies — the order these are named by is no longer the order they were made in`,
    );
  }
  const out: Assembly[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < shown.length; i++) {
    const p = shown[i]!;
    const name = p.animal ? `animal.${p.animal}` : 'settler';
    // One of each. Eight identical settlers with different shirts is eight copies
    // of one model, and the shirt is a colour a consumer sets anyway.
    if (seen.has(name)) continue;
    seen.add(name);
    const g = kids[i]!.clone(true) as THREE.Group;
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    // Stood on the floor, so that "every model's feet are at y = 0" is a promise
    // the whole set keeps rather than a thing that happens to be true. A rig is
    // cloned mid-stride: the legs swing, the body bobs, and the frame this was
    // taken on decides whether the boot is a few millimetres under the ground or
    // a few above it. Measured on the export that wrote this comment, a settler
    // was 3 mm out. Small, and small is the problem — it is the sort of gap that
    // is invisible until a consumer puts the model on a reflective floor. Only
    // the root moves: every part keeps its own local transform, so a consumer can
    // still swing the arm it is named after.
    g.updateMatrixWorld(true);
    g.position.y = -new THREE.Box3().setFromObject(g).min.y;
    const parts: string[] = [];
    g.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.name) parts.push(c.name);
    });
    // The wrapper is not decoration. `GLTFExporter` treats whatever it is handed
    // as the scene and drops that object's own transform on the floor, so the
    // lift above would be computed, written to the group, and then silently not
    // exported. One node further down, it survives.
    const wrap = new THREE.Group();
    wrap.name = name;
    wrap.add(g);
    out.push({ name, parts, borrowed: [], group: wrap });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
