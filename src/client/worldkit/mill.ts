/**
 * Mortal mill: timber house, thatch, a wheel over a race, debris in the throat.
 *
 * The wheel is a separate group so it can turn once the jam is cleared. The
 * debris is a separate group so it can leave. Everything else bakes into the
 * shared role meshes.
 */

import * as THREE from 'three';

import { HOLLOW } from '../scene/hollow-loop';
import { UNIT_BOX, UNIT_CYL, mergePlacements, placement, type Placement } from './bake';
import type { MaterialRole } from './materials';

const PADDLES = 8;

export interface MillBuild {
  staticParts: Placement[];
  wheel: THREE.Group;
  debris: THREE.Group;
}

export function buildMill(mats: Record<MaterialRole, THREE.MeshStandardMaterial>): MillBuild {
  const house = HOLLOW.millHouse;
  const staticParts: Placement[] = [];

  // Plinth and walls. Half-extents in the loop are the collision; the mesh
  // sits inside them so a shoulder against the timber meets timber.
  staticParts.push(placement('stone', UNIT_BOX, house.x, 0.16, house.z, house.hx * 2.05, 0.32, house.hz * 2.05));
  staticParts.push(placement('wood', UNIT_BOX, house.x, 1.15, house.z, house.hx * 1.92, 1.7, house.hz * 1.92));
  staticParts.push(
    placement('thatch', UNIT_BOX, house.x, 2.28, house.z, house.hx * 2.2, 0.42, house.hz * 2.2, 0, 0, 0.18),
  );
  // Door on the village side.
  staticParts.push(placement('wetWood', UNIT_BOX, house.x - house.hx + 0.02, 0.85, house.z - 0.15, 0.08, 1.35, 0.62));
  // Race boards along the water — wet timber, not the house's dry oak.
  staticParts.push(placement('wetWood', UNIT_BOX, 4.1, 0.22, -1.75, 8.4, 0.1, 0.22));
  staticParts.push(placement('wetWood', UNIT_BOX, 4.1, 0.22, -2.35, 8.4, 0.1, 0.22));
  // Gate-lever post on the bank: the mortal control. Not a glowing rune.
  staticParts.push(placement('wood', UNIT_CYL, 4.55, 0.7, -0.85, 0.12, 1.2, 0.12));
  staticParts.push(placement('wetWood', UNIT_BOX, 4.55, 1.28, -0.55, 0.08, 0.08, 0.7));

  const wheel = new THREE.Group();
  wheel.position.set(7.55, 0.95, -1.75);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.55, 8), mats.wetWood);
  hub.rotation.x = Math.PI / 2;
  hub.castShadow = true;
  wheel.add(hub);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.07, 6, 14), mats.wetWood);
  rim.rotation.y = Math.PI / 2;
  rim.castShadow = true;
  wheel.add(rim);
  for (let i = 0; i < PADDLES; i++) {
    const a = (i / PADDLES) * Math.PI * 2;
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.55), mats.wetWood);
    paddle.position.set(0, Math.sin(a) * 0.78, Math.cos(a) * 0.78);
    paddle.rotation.x = a;
    paddle.castShadow = true;
    wheel.add(paddle);
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.35, 6), mats.wood);
  axle.rotation.x = Math.PI / 2;
  axle.position.set(-0.55, 0, 0);
  axle.castShadow = true;
  wheel.add(axle);

  const debris = new THREE.Group();
  debris.position.set(HOLLOW.jam.x, 0.22, HOLLOW.jam.z);
  const logA = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.55, 7), mats.wetWood);
  logA.rotation.z = 1.15;
  logA.rotation.y = 0.4;
  logA.castShadow = true;
  const logB = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.2, 7), mats.wood);
  logB.position.set(0.25, 0.12, 0.15);
  logB.rotation.z = -0.9;
  logB.rotation.y = -0.3;
  logB.castShadow = true;
  const stone = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.3), mats.stone);
  stone.position.set(-0.15, 0.02, -0.12);
  stone.rotation.y = 0.5;
  stone.castShadow = true;
  debris.add(logA, logB, stone);

  return { staticParts, wheel, debris };
}

export function bakeStatic(parts: Placement[], mats: Record<MaterialRole, THREE.MeshStandardMaterial>): THREE.Group {
  const group = new THREE.Group();
  const byRole = new Map<MaterialRole, Placement[]>();
  for (const p of parts) {
    const list = byRole.get(p.role) ?? [];
    list.push(p);
    byRole.set(p.role, list);
  }
  for (const [role, list] of byRole) {
    const geom = mergePlacements(list);
    const mesh = new THREE.Mesh(geom, mats[role]);
    mesh.castShadow = role !== 'ground' && role !== 'water';
    mesh.receiveShadow = true;
    mesh.name = `kit:${role}`;
    group.add(mesh);
  }
  return group;
}
