/**
 * The model export, and the two things it is allowed to get wrong quietly.
 *
 * `ASSETS.md` tells another project it can pick up `models/stove.glb` and have a
 * stove. Everything between that sentence and the truth is this exporter, and
 * every one of its failures is silent: a manifest that names a file nobody wrote,
 * a kind whose parts got credited to the kind before it, a model exported before
 * the ambient-occlusion bake so it arrives with no contact shadow in it, a
 * settler whose shirt came out white because the tint was never read. None of
 * these throws. All of them look fine in a shell that says "42 models".
 *
 * So the experience half here opens the files. It parses the glTF container by
 * hand — magic, chunk header, the JSON chunk — rather than loading them with
 * `GLTFLoader`, because a loader is a second thing that can be wrong and because
 * what is being checked is what is *in the file*: which nodes, which vertex
 * attributes, which colours. Anything a consumer can read, this reads the same
 * way.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assemblyOf, poolsOf, triangles } from '../src/tools/assemble';
import { exportModels, installFileReader, type Manifest } from '../src/tools/models';
import { BUILD_MENU } from '../src/sim/buildings';
import { RESOURCE_KINDS } from '../src/sim/types';

/** The JSON half of a .glb, read the way the format says to read it. */
function glbJson(path: string): {
  nodes: { name?: string; mesh?: number }[];
  meshes: { primitives: { attributes: Record<string, number>; material?: number }[] }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
} {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 'glTF', little-endian, at byte zero. A file that fails this is not a glb no
  // matter what its extension says.
  expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe('glTF');
  const len = view.getUint32(12, true);
  const type = view.getUint32(16, true);
  expect(type).toBe(0x4e4f534a); // 'JSON'
  const text = new TextDecoder().decode(bytes.subarray(20, 20 + len));
  return JSON.parse(text);
}

/** Every attribute name used by any primitive in a file. */
function attributesIn(path: string): Set<string> {
  const j = glbJson(path);
  const names = new Set<string>();
  for (const m of j.meshes) for (const p of m.primitives) for (const a of Object.keys(p.attributes)) names.add(a);
  return names;
}

// ---------------------------------------------------------------- functional

describe('which file a part belongs in', () => {
  it('keeps the two crown variants apart', () => {
    // They are alternatives — no tree wears both — so one file holding both is a
    // two-headed tree handed to whoever opens it.
    expect(assemblyOf('tree.lower')).toBe('tree');
    expect(assemblyOf('tree.lower.b')).toBe('tree.b');
    expect(assemblyOf('tree.trunk')).toBe('tree');
  });

  it('gives every resource pile its own file', () => {
    // Eight different objects that happen to share a prefix. Prefix grouping
    // would put a log pile and a medkit in one model called "stack".
    expect(assemblyOf('stack.wood')).toBe('stack.wood');
    expect(assemblyOf('stack.medicine')).toBe('stack.medicine');
  });

  it('gathers a building from its prefix, and leaves a bare name alone', () => {
    expect(assemblyOf('wall.body')).toBe('wall');
    expect(assemblyOf('wall.post')).toBe('wall');
    expect(assemblyOf('blueprint')).toBe('blueprint');
  });
});

describe('finding the prototypes', () => {
  it('takes named instanced meshes and nothing else', () => {
    const group = new THREE.Group();
    const named = new THREE.BufferGeometry();
    named.name = 'thing.body';
    group.add(new THREE.InstancedMesh(named, new THREE.MeshStandardMaterial(), 4));
    // An unnamed pool has no key to file itself under, and a plain mesh is not a
    // pool at all. Both are silently skipped, which is only safe if it is on
    // purpose — so it is asserted.
    group.add(new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial(), 4));
    const plain = new THREE.BufferGeometry();
    plain.name = 'thing.decoy';
    group.add(new THREE.Mesh(plain, new THREE.MeshStandardMaterial()));

    const found = poolsOf(group);
    expect([...found.keys()]).toEqual(['thing.body']);
  });
});

describe('counting triangles', () => {
  it('counts an indexed geometry by its index and a raw one by its vertices', () => {
    // The number a consumer budgets against, and the two geometries in this
    // repo differ by a factor of three if it is read off the wrong one.
    const indexed = new THREE.BoxGeometry(1, 1, 1);
    expect(triangles(new THREE.Mesh(indexed, new THREE.MeshStandardMaterial()))).toBe(12);
    expect(
      triangles(new THREE.Mesh(indexed.toNonIndexed(), new THREE.MeshStandardMaterial())),
    ).toBe(12);
  });
});

describe('the FileReader the exporter needs', () => {
  it('answers a callback that was not assigned until after the read began', async () => {
    // The exact shape of the hazard. `GLTFExporter` calls `readAsArrayBuffer`
    // and only then sets `onloadend`, so a shim that fires synchronously fires
    // into a null and the export hangs with no error and no output.
    installFileReader();
    const reader = new FileReader();
    const done = new Promise<ArrayBuffer>((resolve) => {
      reader.readAsArrayBuffer(new Blob([new Uint8Array([1, 2, 3])]));
      reader.onloadend = () => resolve(reader.result as ArrayBuffer);
    });
    expect(new Uint8Array(await done)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

// ---------------------------------------------------------------- experience

describe('a whole export, opened the way a consumer would open it', () => {
  let dir = '';
  let manifest: Manifest;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aetherhold-models-'));
    manifest = await exportModels(dir);
  }, 300_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes a real file for every model it claims', () => {
    expect(Object.keys(manifest.models).length).toBeGreaterThan(30);
    for (const [name, m] of Object.entries(manifest.models)) {
      const j = glbJson(join(dir, m.file));
      expect(j.nodes.length, name).toBeGreaterThan(0);
      expect(m.triangles, name).toBeGreaterThan(0);
      expect(m.bytes, name).toBeGreaterThan(0);
    }
  });

  it('can tell somebody which file every buildable thing is in', () => {
    // The manifest is the whole interface. A kind missing from it is a kind
    // nobody can find, and a kind pointing at a model that was never written is
    // worse — it is a broken link that reads as a working one.
    for (const kind of [...BUILD_MENU, ...RESOURCE_KINDS]) {
      const names = manifest.kinds[kind];
      expect(names, kind).toBeTruthy();
      expect(names!.length, kind).toBeGreaterThan(0);
      for (const n of names!) expect(manifest.models[n], `${kind} -> ${n}`).toBeTruthy();
    }
  });

  it('names each part after the pool it came from', () => {
    // Without this a consumer gets a bag of anonymous meshes and has to guess
    // which one is the door and which one is the handle.
    const j = glbJson(join(dir, manifest.models.wall!.file));
    const names = j.nodes.map((n) => n.name);
    expect(names).toContain('wall.body');
    expect(names).toContain('wall.cap');
  });

  it('carries the contact shadows out with the model', () => {
    // The bake lives in the vertex colours, and glTF carries those as COLOR_0.
    // Exporting before `bakeOcclusion()` drains produces a file that is valid,
    // loads fine, and is missing the thing four rounds of look work put in.
    const attrs = attributesIn(join(dir, manifest.models.stove!.file));
    expect(attrs).toContain('COLOR_0');
    expect(attrs).toContain('NORMAL');
  });

  it('exports a settler as a person rather than a lump', () => {
    const j = glbJson(join(dir, manifest.models.settler!.file));
    const names = j.nodes.map((n) => n.name);
    for (const part of ['head', 'torso', 'hair']) expect(names, part).toContain(part);
  });

  it('paints each model the colour the game paints it', () => {
    // The colours are read out of the live `instanceColor`, so the way this
    // fails is that the read stops happening and every material falls back to
    // its near-white pooled base. One tinted model that is still visibly
    // coloured catches that.
    const j = glbJson(join(dir, manifest.models.settler!.file));
    const factors = (j.materials ?? []).map((m) => m.pbrMetallicRoughness?.baseColorFactor ?? []);
    const coloured = factors.filter((f) => f.length === 4 && Math.max(f[0]!, f[1]!, f[2]!) > 0.02);
    expect(coloured.length).toBeGreaterThan(0);
    // Not a grey suit: some channel has to be well clear of the other two.
    const spread = coloured.map((f) => Math.max(f[0]!, f[1]!, f[2]!) - Math.min(f[0]!, f[1]!, f[2]!));
    expect(Math.max(...spread)).toBeGreaterThan(0.1);
  });

  it('says which parts wore a borrowed colour', () => {
    // A wall standing alone has no closers in it, so `wall.closer` is exported
    // wearing the wall's colour rather than its own. That is a compromise, and
    // the manifest has to admit to it or a consumer will read a guess as a fact.
    const all = Object.values(manifest.models).flatMap((m) => m.borrowed);
    for (const key of all) {
      expect(manifest.models[assemblyOf(key)]!.parts).toContain(key);
    }
  });
});
