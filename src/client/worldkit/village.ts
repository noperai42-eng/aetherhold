/**
 * Cottages, a well, a headman, a few rim pines. Mortal furniture.
 */

import * as THREE from 'three';

import { HOLLOW } from '../scene/hollow-loop';
import { UNIT_BOX, UNIT_CONE, UNIT_CYL, UNIT_SPHERE, placement, type Placement } from './bake';
import type { MaterialRole } from './materials';

export function villagePlacements(): Placement[] {
  const parts: Placement[] = [];
  for (const c of HOLLOW.cottages) {
    cottage(parts, c.x, c.z, c.hx, c.hz);
  }
  const w = HOLLOW.well;
  parts.push(placement('stone', UNIT_CYL, w.x, 0.28, w.z, 1.05, 0.55, 1.05));
  parts.push(placement('wood', UNIT_BOX, w.x, 1.15, w.z, 0.08, 1.1, 0.08));
  parts.push(placement('wood', UNIT_BOX, w.x, 1.72, w.z, 1.15, 0.08, 0.08));

  // Packed path from spawn toward the mill — same ground role, a shade lower
  // is not a new material; the dip in the bowl already carries the walk.
  parts.push(placement('ground', UNIT_BOX, -0.4, 0.03, 2.4, 11.5, 0.04, 1.6, 0.35));

  pines(parts);
  return parts;
}

function cottage(parts: Placement[], x: number, z: number, hx: number, hz: number): void {
  parts.push(placement('stone', UNIT_BOX, x, 0.14, z, hx * 2.08, 0.28, hz * 2.08));
  parts.push(placement('plaster', UNIT_BOX, x, 0.95, z, hx * 1.92, 1.35, hz * 1.92));
  parts.push(placement('thatch', UNIT_BOX, x, 1.85, z, hx * 2.25, 0.55, hz * 2.2, 0, 0, 0.22));
  parts.push(placement('wood', UNIT_BOX, x + hx * 0.15, 0.72, z + hz - 0.02, 0.55, 1.05, 0.08));
}

function pines(parts: Placement[]): void {
  const spots: [number, number, number][] = [
    [-11.4, -4.2, 1.15],
    [-10.2, 8.6, 1.0],
    [3.2, 10.4, 1.25],
    [11.2, 6.1, 0.95],
    [10.8, -8.4, 1.2],
    [-2.4, -11.0, 1.05],
    [8.6, 9.5, 0.88],
    [-12.2, 2.8, 1.1],
  ];
  for (const [x, z, s] of spots) {
    parts.push(placement('wood', UNIT_CYL, x, 0.7 * s, z, 0.28 * s, 1.4 * s, 0.28 * s));
    parts.push(placement('foliage', UNIT_CONE, x, 2.15 * s, z, 1.7 * s, 2.4 * s, 1.7 * s));
    parts.push(placement('foliage', UNIT_CONE, x, 3.15 * s, z, 1.15 * s, 1.7 * s, 1.15 * s));
  }
}

export function buildHeadman(mats: Record<MaterialRole, THREE.MeshStandardMaterial>): THREE.Group {
  const g = new THREE.Group();
  g.position.set(HOLLOW.headman.x, 0, HOLLOW.headman.z);
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.15, 8), mats.cloth);
  robe.position.y = 0.72;
  robe.castShadow = true;
  const head = new THREE.Mesh(UNIT_SPHERE, mats.cloth);
  head.position.y = 1.48;
  head.scale.set(0.34, 0.38, 0.32);
  head.castShadow = true;
  const staff = new THREE.Mesh(UNIT_CYL, mats.wood);
  staff.position.set(0.28, 0.85, 0.05);
  staff.scale.set(0.07, 1.55, 0.07);
  staff.castShadow = true;
  g.add(robe, head, staff);
  return g;
}

export function buildWalker(mats: Record<MaterialRole, THREE.MeshStandardMaterial>): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.2, 8), mats.cloth);
  body.position.y = 0.75;
  body.castShadow = true;
  const head = new THREE.Mesh(UNIT_SPHERE, mats.plaster);
  head.position.y = 1.48;
  head.scale.set(0.32, 0.36, 0.3);
  head.castShadow = true;
  g.add(body, head);
  return g;
}
