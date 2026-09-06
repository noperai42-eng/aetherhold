/**
 * The colony's models, written out as glTF for anything that is not this game.
 *
 * `npm run export:models` stands one of everything on a seeded valley, runs the
 * real views over it, and writes `models/` — one `.glb` per assembly plus a
 * `manifest.json` that says which building kind lives in which file. The whole
 * point is that another project can pick up a stove or a mossback without
 * pulling in the sim, the palette, the season code or the four hundred lines of
 * geometry helpers that shaped them.
 *
 * It *drives* the game rather than reading it, and that is the one decision here
 * worth defending. Every alternative — re-listing the prototypes, re-deriving
 * their colours from `palette.ts`, hand-writing a kind-to-file table — is a
 * second copy of something the renderer already knows, and a second copy is a
 * thing that goes quietly out of date on the afternoon somebody renames a pool.
 * So:
 *
 * - **Shapes** come from the pools themselves, found by walking `view.group`.
 *   A prototype the renderer stopped building is a prototype that stops being
 *   exported, with no list to remember to edit.
 * - **Colours** are read out of `instanceColor` at instance zero, which is the
 *   true tint straight off the real draw path. Half of them are not in the
 *   palette to be re-derived: a trunk's brown is a module-private constant in
 *   `buildings.ts`, and a tree skirt's is a palette entry through a hue jitter
 *   and a season tint. Reading the answer is both shorter and correct.
 * - **Which kind is in which file** is measured, not declared. Kinds go down one
 *   at a time and the pools that grew belong to the kind that just landed, so a
 *   renamed pool cannot silently mislabel the manifest — it moves in it.
 * - **Contact shadows** ride along, because `bakeOcclusion()` is drained before
 *   anything is written and the bake lives in the vertex colours, which glTF
 *   carries as COLOR_0.
 *
 * What is deliberately not here: grass, and everything else whose life is in a
 * shader. A tuft's sway is a vertex program injected through `onBeforeCompile`,
 * and glTF has nowhere to put a vertex program — exporting the blade would ship
 * a consumer a stiff green dart and call it the grass. `ASSETS.md` says so out
 * loud rather than leaving somebody to discover it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { BuildingsView } from '../client/render/buildings';
import { PawnsView } from '../client/render/pawns';
import { BUILD_MENU } from '../sim/buildings';
import { RESOURCE_KINDS, type World } from '../sim/types';
import { addBuilding, addItem } from '../sim/world';
import { createWorld } from '../sim/worldgen';

/**
 * The same seed the look harness photographs, so a model exported here is the
 * model in the frames on disk and a colour argument can be settled by opening
 * one of them.
 */
export const SEED = 4242;

/**
 * `GLTFExporter` reaches for `FileReader` on the binary path — it packs the
 * buffer into a `Blob` and reads it back — and Node has `Blob` but no reader for
 * one. The shim is four lines and it has to be careful about exactly one thing:
 * the exporter calls `readAsArrayBuffer` *before* it assigns `onloadend`, so a
 * synchronous implementation fires the callback into a null and the export hangs
 * forever with no error. Going through the promise puts the callback after the
 * assignment, which is what the browser does too.
 */
export function installFileReader(): void {
  const host = globalThis as unknown as { FileReader?: unknown };
  if (typeof host.FileReader !== 'undefined') return;
  host.FileReader = class {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  };
}

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

/**
 * Empty cells, walking a lattice out from the middle of the map.
 *
 * Three apart rather than shoulder to shoulder because walls, fences and
 * conduits look at their neighbours: a solid block of them would make one long
 * run whose ends are the only place the closers and corner posts appear, and the
 * measurement below would credit those parts to whichever kind happened to be at
 * the end. Spaced out, every kind is its own island and the growth it causes is
 * entirely its own.
 */
function* openCells(world: World): Generator<{ x: number; y: number }> {
  const cx = Math.floor(world.width / 2);
  const cy = Math.floor(world.height / 2);
  const far = Math.floor(Math.min(world.width, world.height) / 2) - 3;
  for (let r = 3; r < far; r += 3) {
    for (let dx = -r; dx <= r; dx += 3) {
      for (let dy = -r; dy <= r; dy += 3) yield { x: cx + dx, y: cy + dy };
    }
  }
}

/** Counts per pool, so two of these can be diffed. */
function counts(view: BuildingsView): Map<string, number> {
  const n = new Map<string, number>();
  for (const [key, mesh] of poolsOf(view.group)) n.set(key, mesh.count);
  return n;
}

/** The pools that gained an instance between two counts — what the last kind drew. */
function grew(before: Map<string, number>, after: Map<string, number>): string[] {
  const keys: string[] = [];
  for (const [key, n] of after) if (n > (before.get(key) ?? 0)) keys.push(key);
  return keys.sort();
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

/**
 * Stands one of every buildable thing, one at a time, and records what each one
 * drew.
 *
 * Trees are already all over the valley and are the reason this is a diff rather
 * than a snapshot: their pools are full before the first wall goes down, so the
 * only honest way to say "these parts are a wall" is to watch the wall arrive.
 */
export function populate(world: World, view: BuildingsView): Map<string, string[]> {
  const drew = new Map<string, string[]>();
  const cells = openCells(world);
  // `next()` rather than `for...of`, and this is not a style preference: breaking
  // out of a `for...of` calls `return()` on the generator, which closes it. The
  // first kind would find its cell, the loop would shut the lattice behind it, and
  // every kind after it would be told the map was full — on a map with thirty
  // thousand empty cells left.
  const place = (fn: (x: number, y: number) => unknown): boolean => {
    for (let c = cells.next(); !c.done; c = cells.next()) {
      if (fn(c.value.x, c.value.y)) return true;
    }
    return false;
  };
  view.sync(world);
  let before = counts(view);
  for (const kind of BUILD_MENU) {
    // Powered on purpose. `tint` dulls any electrical building that is not
    // drawing, and a lamp exported at 55% of its colour would look like a design
    // decision to whoever opened the file rather than like a colony with no
    // generator running.
    if (!place((x, y) => addBuilding(world, kind, x, y, true))) {
      throw new Error(`no open cell left to stand a ${kind} on — the map is full`);
    }
    const b = world.buildings[world.buildings.length - 1]!;
    b.powered = true;
    view.sync(world);
    const after = counts(view);
    drew.set(kind, grew(before, after));
    before = after;
  }
  for (const kind of RESOURCE_KINDS) {
    if (!place((x, y) => addItem(world, kind, 20, x, y))) {
      throw new Error(`no open cell left to drop ${kind} on — the map is full`);
    }
    view.sync(world);
    const after = counts(view);
    drew.set(kind, grew(before, after));
    before = after;
  }
  return drew;
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

/** One `.glb`, written. Returns its size so the manifest can carry it. */
export async function writeGlb(dir: string, a: Assembly): Promise<number> {
  const buf = (await new GLTFExporter().parseAsync(a.group, { binary: true })) as ArrayBuffer;
  const bytes = new Uint8Array(buf);
  writeFileSync(join(dir, `${a.name}.glb`), bytes);
  return bytes.length;
}

export interface Manifest {
  seed: number;
  /** Assembly name to file, parts, triangles and bytes. */
  models: Record<
    string,
    { file: string; parts: string[]; borrowed: string[]; triangles: number; bytes: number }
  >;
  /** Building kind or resource kind to the assemblies it draws. */
  kinds: Record<string, string[]>;
}

/** The whole job, so a test can run it into a scratch directory. */
export async function exportModels(dir: string): Promise<Manifest> {
  installFileReader();
  mkdirSync(dir, { recursive: true });

  const world = createWorld(SEED);
  const buildings = new BuildingsView();
  const drew = populate(world, buildings);
  // Drained here rather than left to the idle callback that the game uses: there
  // is no idle in a script, and an unbaked export is a model with no contact
  // shadow in it that looks fine until it is next to one that has.
  buildings.bakeOcclusion();

  const pawns = new PawnsView();
  pawns.onTick(world);
  pawns.sync(world, 1, null);

  const all = [...assemble(buildings.group), ...pawnAssemblies(world, pawns)];
  const models: Manifest['models'] = {};
  for (const a of all) {
    const bytes = await writeGlb(dir, a);
    models[a.name] = {
      file: `${a.name}.glb`,
      parts: a.parts,
      borrowed: a.borrowed,
      triangles: triangles(a.group),
      bytes,
    };
  }

  const kinds: Manifest['kinds'] = {};
  for (const [kind, keys] of drew) {
    kinds[kind] = [...new Set(keys.map(assemblyOf))].sort();
  }
  const manifest: Manifest = { seed: SEED, models, kinds };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  buildings.dispose();
  pawns.dispose();
  return manifest;
}
