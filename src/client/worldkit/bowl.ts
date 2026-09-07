/**
 * The hollow's terrain bowl: packed earth floor, cold rim, a thread of water.
 *
 * A lathe-of-sorts from a ring height field — not a heightmap asset. The mill
 * race is a straight cut so the wheel has somewhere honest to stand.
 *
 * Every face below is wound counter-clockwise seen from above, and that is
 * load-bearing rather than housekeeping: none of these geometries ships normals,
 * so `computeVertexNormals` derives them from the winding alone, and the village
 * materials are all `FrontSide`. Wound the other way — which is how all three
 * were written — the floor, the rim and the water get normals pointing into the
 * earth and are back-face culled entire. That is not a subtle darkening. It is
 * the ground gone: the player arrives in a grey void with three cottages
 * floating in it, still drawn because a box is wound the same from either end.
 * It shipped like that, and the slice's own seven tests passed on it, which is
 * why `tests/hollow-pocket.test.ts` now counts which way the normals point.
 */

import * as THREE from 'three';

import { HOLLOW } from '../scene/hollow-loop';
import { triangleCount } from './bake';
import type { MaterialRole } from './materials';

const SEG = 36;
const RADIAL = 18;

export interface BowlBuild {
  meshes: { role: MaterialRole; mesh: THREE.Mesh }[];
  tris: number;
}

export function buildBowl(mats: Record<MaterialRole, THREE.MeshStandardMaterial>): BowlBuild {
  const ground = bowlGeometry((r) => {
    if (r < 0.78) return 0.02 + r * r * 0.18;
    const t = (r - 0.78) / 0.22;
    return 0.12 + t * t * 4.6;
  });
  const mountain = rimGeometry();
  const water = raceAndPool();

  const gMesh = new THREE.Mesh(ground, mats.ground);
  gMesh.receiveShadow = true;
  const mMesh = new THREE.Mesh(mountain, mats.mountain);
  mMesh.receiveShadow = true;
  mMesh.castShadow = true;
  const wMesh = new THREE.Mesh(water, mats.water);
  wMesh.receiveShadow = true;

  return {
    meshes: [
      { role: 'ground', mesh: gMesh },
      { role: 'mountain', mesh: mMesh },
      { role: 'water', mesh: wMesh },
    ],
    tris: triangleCount(ground) + triangleCount(mountain) + triangleCount(water),
  };
}

function bowlGeometry(heightAt: (r01: number) => number): THREE.BufferGeometry {
  const outer = HOLLOW.walkRadius + 4.2;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= RADIAL; j++) {
    const r01 = j / RADIAL;
    const r = r01 * outer;
    const y = heightAt(r01);
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  const stride = SEG + 1;
  for (let j = 0; j < RADIAL; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rimGeometry(): THREE.BufferGeometry {
  // A low collar of rock outside the walkable floor, so the bowl reads as a
  // mountain pocket rather than a disc sitting on a void.
  const inner = HOLLOW.walkRadius + 0.4;
  const outer = HOLLOW.walkRadius + 5.8;
  const segs = 40;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= 4; j++) {
    const t = j / 4;
    const r = inner + (outer - inner) * t;
    const y = 0.4 + t * 5.2 + (t > 0.6 ? (t - 0.6) * 3.5 : 0);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const wobble = 1 + 0.06 * Math.sin(a * 5 + j);
      pos.push(Math.cos(a) * r * wobble, y, Math.sin(a) * r * wobble);
    }
  }
  const stride = segs + 1;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * stride + i;
      idx.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function raceAndPool(): THREE.BufferGeometry {
  // One surface: a small spring pool west of the mill, then a straight race
  // under the wheel. Two planes welded so water is one draw and one material.
  const pos: number[] = [];
  const idx: number[] = [];
  let base = 0;
  const addQuad = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number, y: number) => {
    pos.push(ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz);
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    base += 4;
  };
  // Pool near the well, shallow.
  addQuad(-6.4, 2.0, -2.8, 2.0, -2.8, 4.4, -6.4, 4.4, 0.04);
  // Race toward the mill, then past the wheel.
  addQuad(-2.8, -2.45, 10.4, -2.45, 10.4, -1.05, -2.8, -1.05, 0.03);
  // Tail leaving the bowl.
  addQuad(10.4, -2.45, 13.2, -3.2, 13.2, -0.4, 10.4, -1.05, 0.02);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
