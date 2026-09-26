/**
 * The face and the hair, r29.
 *
 * Both are painted in the fragment shader rather than modelled, because the
 * settler rig has twelve triangles of its three-thousand budget left. That
 * makes them fragile in a way geometry is not: the paint goes in by string
 * replacement on three.js's own shader source, and if a chunk it anchors on is
 * renamed in an upgrade, the replacement finds nothing, the shader still
 * compiles, and every settler is quietly a plain egg again. Nothing else in the
 * suite would notice; the frames would, a round later. So the first thing held
 * here is that every anchor is present and every patch lands.
 *
 * The rest is what the round claims: the cut is dealt by two seed bits and the
 * old one keeps the length a save already has, a thousand faces share one
 * program, and the parted cuts draw a parting and the others do not.
 *
 * r30 paints the eye bead too — iris, pupil, white and lid — so the same holds
 * for it: the patch lands, one program serves every eye, and the iris is dealt
 * from the seed so a colony has more than one eye colour.
 *
 * r31 gives the skull a jaw and a chin, and a settler their own marks — a
 * moustache or stubble, freckles, the lines of age — dealt so that nobody who
 * had a beard loses it, and so that age goes with grey hair and nothing else.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { IRIS_TONES, eyeMaterial, faceMaterial, faceTraitsOf, hairMaterial, irisOf } from '../src/client/render/face';
import { HAIR_STYLES, HAIR_TONES, PawnsView, hairStyleOf, settlerGeometry } from '../src/client/render/pawns';
import type { HairStyle } from '../src/client/render/pawns';
import { createWorld } from '../src/sim/worldgen';

const SEED = 20260907;

/** Runs a material's patch over the real standard shader source, as the renderer would. */
function compiled(mat: THREE.Material): THREE.WebGLProgramParametersWithUniforms {
  const lib = THREE.ShaderLib.standard;
  const shader = {
    uniforms: THREE.UniformsUtils.clone(lib.uniforms),
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
  return shader;
}

function part(root: THREE.Object3D, name: string): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!found && o instanceof THREE.Mesh && o.name === name) found = o;
  });
  expect(found, `${name} on the rig`).not.toBeNull();
  return found!;
}

describe('a settler’s face and hair', () => {
  // --- functional

  it('patches the face into the standard shader — a missing anchor would leave a plain egg and compile clean', () => {
    const shader = compiled(faceMaterial(new THREE.Color(0xd9a07a), new THREE.Color(0x3a2616)));
    expect(shader.vertexShader).toContain('vFacePos = position;');
    expect(shader.fragmentShader).toContain('uniform vec3 uHair;');
    // The face block itself, after the colour is read and before lighting uses it.
    const face = shader.fragmentShader.indexOf('vec3 p = vFacePos');
    expect(face).toBeGreaterThan(shader.fragmentShader.indexOf('#include <color_fragment>'));
    expect(face).toBeLessThan(shader.fragmentShader.indexOf('#include <lights_fragment_begin>'));
    expect(shader.uniforms.uHair).toBeDefined();
  });

  it('patches the strands and the parting into the standard shader', () => {
    const shader = compiled(hairMaterial(new THREE.Color(0x3a2616), 1, 0.05));
    expect(shader.vertexShader).toContain('vHairPos = position;');
    expect(shader.fragmentShader).toContain('uniform vec2 uPart;');
    expect(shader.fragmentShader).toContain('float parting');
    expect(shader.uniforms.uPart).toBeDefined();
  });

  it('raises the strands in relief after the normal is known — before it, the tilt would be overwritten; after lighting, it would light nothing', () => {
    const f = compiled(hairMaterial(new THREE.Color(0x3a2616), 0, null)).fragmentShader;
    const declared = f.indexOf('float hairH = 0.0;');
    const set = f.indexOf('hairH = (');
    const bump = f.indexOf('dFdx(hairH)');
    expect(declared).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(declared);
    expect(bump).toBeGreaterThan(f.indexOf('#include <normal_fragment_maps>'));
    expect(bump).toBeLessThan(f.indexOf('#include <lights_fragment_begin>'));
  });

  it('gives each strand and each lock its own shade, wrapped so the seam at the back of the head draws nothing', () => {
    const f = compiled(hairMaterial(new THREE.Color(0x3a2616), 0, null)).fragmentShader;
    // 48 strands in four-strand locks: the ids wrap at the same count the
    // angle multiplies by, so the strand either side of the seam is one strand.
    expect(f).toContain('a * 48.0');
    expect(f).toContain('mod(floor(s / 6.2832), 48.0)');
    expect(f).toContain('mod(floor(c), 12.0)');
  });

  it('gives every face one program, whatever its colours — a program per settler would compile forty times on load', () => {
    const a = faceMaterial(new THREE.Color(0xf1c9a5), new THREE.Color(0x111111));
    const b = faceMaterial(new THREE.Color(0x5a3825), new THREE.Color(0xe0d0a0), { beard: 0.85, moustache: 0, stubble: 0, freckles: 1, age: 1 });
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    const h = hairMaterial(new THREE.Color(0x111111), 0, null);
    const k = hairMaterial(new THREE.Color(0xe0d0a0), 1, 0);
    expect(h.customProgramCacheKey()).toBe(k.customProgramCacheKey());
    expect(h.customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
  });

  it('patches the eyeball into the standard shader, before lighting reads the colour', () => {
    const c = new THREE.Color(0x5b3a22);
    const shader = compiled(eyeMaterial(new THREE.Vector3(0.0152, 0.016, 0.0132), c, c, c));
    expect(shader.vertexShader).toContain('vEyePos = position;');
    expect(shader.fragmentShader).toContain('uniform vec3 uIris;');
    const eye = shader.fragmentShader.indexOf('vec3 n = vEyePos / uEyeSize');
    expect(eye).toBeGreaterThan(shader.fragmentShader.indexOf('#include <color_fragment>'));
    expect(eye).toBeLessThan(shader.fragmentShader.indexOf('#include <lights_fragment_begin>'));
    expect(shader.uniforms.uEyeSize).toBeDefined();
  });

  it('gives every eye one program, whatever its iris', () => {
    const size = new THREE.Vector3(0.0152, 0.016, 0.0132);
    const a = eyeMaterial(size, new THREE.Color(0x5b3a22), new THREE.Color(0xd9a07a), new THREE.Color(0x111111));
    const b = eyeMaterial(size, new THREE.Color(0x4d6440), new THREE.Color(0x5a3422), new THREE.Color(0x221100));
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).not.toBe(faceMaterial(new THREE.Color(), new THREE.Color()).customProgramCacheKey());
  });

  it('deals the iris from the seed — the same settler keeps their eyes, and a colony has every tone', () => {
    expect(irisOf(8706)).toBe(irisOf(8706));
    const seen = new Set<number>();
    for (let seed = 0; seed < 4096; seed++) seen.add(irisOf(seed));
    expect(seen.size).toBe(new Set(IRIS_TONES).size);
  });

  it('deals the marks so the bearded keep their beards and nobody has two kinds of facial hair', () => {
    let moustache = 0;
    let stubble = 0;
    let freckles = 0;
    const N = 1 << 20;
    for (let seed = 0; seed < N; seed += 7) {
      const t = faceTraitsOf(seed, false);
      expect(t.beard > 0, 'the beard is bits 16–17 as it was').toBe(((seed >> 16) & 3) === 1);
      expect((t.beard > 0 ? 1 : 0) + t.moustache + t.stubble).toBeLessThanOrEqual(1);
      expect(t.age).toBe(0);
      moustache += t.moustache;
      stubble += t.stubble;
      freckles += t.freckles;
    }
    const n = Math.ceil(N / 7);
    expect(moustache / n).toBeCloseTo(1 / 8, 2);
    expect(stubble / n).toBeCloseTo(1 / 8, 2);
    expect(freckles / n).toBeCloseTo(1 / 5, 2);
    expect(faceTraitsOf(1234, true).age).toBe(1);
  });

  it('gives the skull a chin under the mouth and leaves the face above it where it was', () => {
    const head = settlerGeometry().head;
    const plain = new THREE.SphereGeometry(0.13, 20, 10).scale(1, 1.06, 1.28);
    const a = head.attributes.position!;
    const b = plain.attributes.position!;
    expect(a.count).toBe(b.count);
    let chin = 0;
    for (let i = 0; i < a.count; i++) {
      // Everything from a little below the eyes up is the egg it was, so the
      // eye beads and the nose sit in the skin as they did.
      if (b.getY(i) > -0.03) {
        expect(a.getX(i)).toBeCloseTo(b.getX(i), 6);
        expect(a.getZ(i)).toBeCloseTo(b.getZ(i), 6);
      }
      // Under the mouth, at the front: forward of where the egg ran round.
      if (b.getY(i) < -0.1 && b.getZ(i) > 0.08) chin = Math.max(chin, a.getZ(i) - b.getZ(i));
    }
    expect(chin, 'the chin comes forward by at least a centimetre').toBeGreaterThan(0.01);
  });

  it('keeps the length a save already has — bit twelve is still short or long', () => {
    // Bit twelve chose between two cuts before r29, one short and one to the
    // jaw. A settler loaded from an old save keeps that length and may only
    // gain a second cut of it.
    const short = new Set<HairStyle>(['crop', 'swept']);
    for (let s = 0; s < 1 << 16; s += 97) {
      expect(short.has(hairStyleOf(s)), `seed ${s}`).toBe(((s >> 12) & 1) === 0);
    }
  });

  it('deals all four cuts, on bits twelve and thirteen and nothing else', () => {
    expect([0, 0x1000, 0x2000, 0x3000].map(hairStyleOf)).toEqual(['crop', 'long', 'swept', 'shaggy']);
    for (const style of HAIR_STYLES) {
      const base = HAIR_STYLES.indexOf(style);
      const seed = ((base & 1) << 12) | ((base >> 1) << 13);
      expect(hairStyleOf(seed | 0xc0fff | (0x5a << 16))).toBe(style);
    }
  });

  // --- experience

  it('puts the face on every settler’s head and the parting only on the parted cuts', () => {
    // The whole rig, built the way the game builds it, round the four cuts.
    const seen = new Set<HairStyle>();
    for (const shift of [0, 2]) {
      const world = createWorld(SEED);
      const people = world.pawns.filter((p) => !p.animal);
      people.forEach((p, n) => {
        const i = n + shift;
        p.colorSeed = (p.colorSeed & ~0x3000) | ((i & 1) << 12) | (((i >> 1) & 1) << 13);
      });
      const view = new PawnsView();
      view.onTick(world);
      view.sync(world, 0, null, 0);
      for (const rig of view.group.children) {
        const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
        if (pawn.animal) continue;
        const style = hairStyleOf(pawn.colorSeed);
        seen.add(style);
        const head = part(rig, 'head').material as THREE.MeshStandardMaterial;
        expect(head.userData.face, 'the head wears the face').toBeDefined();
        const eye = part(rig, 'eye').material as THREE.MeshStandardMaterial;
        expect(eye.userData.eye.uIris.value.getHex(), 'the eye wears its iris').toBe(irisOf(pawn.colorSeed));
        const grey = HAIR_TONES[(pawn.colorSeed >> 8) % HAIR_TONES.length] === 0xe9e6e2;
        const marks = faceTraitsOf(pawn.colorSeed, grey);
        expect(head.userData.face.traits.value.toArray(), 'the face wears its marks').toEqual([marks.moustache, marks.stubble, marks.freckles, marks.age]);
        expect(head.userData.face.beard.value).toBe(marks.beard);
        const hair = part(rig, 'hair').material as THREE.MeshStandardMaterial;
        const parted = hair.userData.hair.part.value.y === 1;
        expect(parted, style).toBe(style === 'long' || style === 'swept');
        expect(hair.userData.hair.sweep.value, style).toBe(style === 'swept' ? 1 : 0);
      }
      view.dispose();
    }
    expect(seen.size).toBe(4);
  });
});
