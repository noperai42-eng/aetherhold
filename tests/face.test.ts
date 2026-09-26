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
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { IRIS_TONES, eyeMaterial, faceMaterial, hairMaterial, irisOf } from '../src/client/render/face';
import { HAIR_STYLES, PawnsView, hairStyleOf } from '../src/client/render/pawns';
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
    const shader = compiled(faceMaterial(new THREE.Color(0xd9a07a), new THREE.Color(0x3a2616), 0));
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

  it('gives every face one program, whatever its colours — a program per settler would compile forty times on load', () => {
    const a = faceMaterial(new THREE.Color(0xf1c9a5), new THREE.Color(0x111111), 0);
    const b = faceMaterial(new THREE.Color(0x5a3825), new THREE.Color(0xe0d0a0), 0.85);
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
    expect(a.customProgramCacheKey()).not.toBe(faceMaterial(new THREE.Color(), new THREE.Color(), 0).customProgramCacheKey());
  });

  it('deals the iris from the seed — the same settler keeps their eyes, and a colony has every tone', () => {
    expect(irisOf(8706)).toBe(irisOf(8706));
    const seen = new Set<number>();
    for (let seed = 0; seed < 4096; seed++) seen.add(irisOf(seed));
    expect(seen.size).toBe(new Set(IRIS_TONES).size);
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
