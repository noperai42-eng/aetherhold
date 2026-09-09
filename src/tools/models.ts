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
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { BuildingsView } from '../client/render/buildings';
import { PawnsView } from '../client/render/pawns';
import { SEED, assemble, assemblyOf, pawnAssemblies, poolsOf, triangles, type Assembly } from './assemble';
import { BUILD_MENU } from '../sim/buildings';
import { RESOURCE_KINDS, type World } from '../sim/types';
import { addBuilding, addItem } from '../sim/world';
import { createWorld } from '../sim/worldgen';

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
  // No frame time, so every head is left looking straight ahead. An exported
  // model is a body, not a moment: a settler frozen mid-glance is a settler
  // whose head is on crooked in whatever imports it.
  pawns.sync(world, 1, null, 0);

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
