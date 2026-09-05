/**
 * Bake many placed boxes into one mesh per material role.
 *
 * A cottage is eight boxes. A mill is twenty. Drawn one-by-one they would eat
 * the draw-call budget before the bowl was dressed. The kit therefore records
 * placements and emits one Mesh per role.
 */

import * as THREE from 'three';

import type { MaterialRole } from './materials';

export interface Placement {
  role: MaterialRole;
  geom: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

const _pos = new THREE.Vector3();
const _nor = new THREE.Vector3();
const _nmat = new THREE.Matrix3();

export function placement(
  role: MaterialRole,
  geom: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
  rotY = 0,
  rotX = 0,
  rotZ = 0,
): Placement {
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'XYZ'));
  matrix.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return { role, geom, matrix };
}

export function mergePlacements(parts: Placement[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const g = part.geom;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const idx = g.getIndex();
    const base = positions.length / 3;
    _nmat.getNormalMatrix(part.matrix);
    for (let i = 0; i < pos.count; i++) {
      _pos.fromBufferAttribute(pos, i).applyMatrix4(part.matrix);
      positions.push(_pos.x, _pos.y, _pos.z);
      if (nor) {
        _nor.fromBufferAttribute(nor, i).applyMatrix3(_nmat).normalize();
        normals.push(_nor.x, _nor.y, _nor.z);
      } else {
        normals.push(0, 1, 0);
      }
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + base);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(base + i);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setIndex(indices);
  return out;
}

export function triangleCount(geom: THREE.BufferGeometry): number {
  const idx = geom.getIndex();
  if (idx) return idx.count / 3;
  const pos = geom.getAttribute('position');
  return pos ? pos.count / 3 : 0;
}

export function countKitBudget(root: THREE.Object3D): {
  draws: number;
  tris: number;
  materials: number;
} {
  const mats = new Set<THREE.Material>();
  let draws = 0;
  let tris = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const geom = mesh.geometry;
    if (!geom) return;
    draws += 1;
    tris += triangleCount(geom);
    const m = mesh.material;
    if (Array.isArray(m)) for (const one of m) mats.add(one);
    else if (m) mats.add(m);
  });
  return { draws, tris, materials: mats.size };
}

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
export const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
export const UNIT_CONE = new THREE.ConeGeometry(0.5, 1, 7);
export const UNIT_SPHERE = new THREE.SphereGeometry(0.5, 8, 6);
