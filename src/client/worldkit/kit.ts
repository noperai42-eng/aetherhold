/**
 * One village pocket, assembled. The factories stay small; this file only
 * parents them and reports the budget the brief asked for.
 */

import * as THREE from 'three';

import { UNIT_BOX, UNIT_CONE, UNIT_CYL, UNIT_SPHERE, countKitBudget } from './bake';
import { buildBowl } from './bowl';
import { disposeMaterials, makeVillageMaterials, ROLE_COUNT, type MaterialRole } from './materials';
import { bakeStatic, buildMill } from './mill';
import { buildHeadman, buildWalker, villagePlacements } from './village';

export interface HollowKit {
  group: THREE.Group;
  wheel: THREE.Group;
  debris: THREE.Group;
  walker: THREE.Group;
  headman: THREE.Group;
  materials: Record<MaterialRole, THREE.MeshStandardMaterial>;
  budget: { draws: number; tris: number; materials: number; roles: number };
}

export const BUDGET = { draws: 60, tris: 120_000, materials: 12 };

export function kitBudgetOk(budget: HollowKit['budget']): boolean {
  return budget.draws <= BUDGET.draws && budget.tris <= BUDGET.tris && budget.materials <= BUDGET.materials;
}

export function buildHollowKit(): HollowKit {
  const materials = makeVillageMaterials();
  const group = new THREE.Group();
  group.name = 'hollow-kit';

  const bowl = buildBowl(materials);
  for (const { mesh } of bowl.meshes) group.add(mesh);

  const mill = buildMill(materials);
  const village = villagePlacements();
  const baked = bakeStatic([...mill.staticParts, ...village], materials);
  group.add(baked, mill.wheel, mill.debris);

  const headman = buildHeadman(materials);
  const walker = buildWalker(materials);
  group.add(headman, walker);

  const lights = pocketLights();
  group.add(lights);

  const counted = countKitBudget(group);
  return {
    group,
    wheel: mill.wheel,
    debris: mill.debris,
    walker,
    headman,
    materials,
    budget: { ...counted, roles: ROLE_COUNT },
  };
}

function pocketLights(): THREE.Group {
  const g = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xb7c4d4, 0x3d3428, 0.72);
  const sun = new THREE.DirectionalLight(0xe8e2d4, 0.85);
  sun.position.set(-10, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16;
  sun.shadow.camera.bottom = -16;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 40;
  g.add(hemi, sun);
  return g;
}

const SHARED_GEOM = new Set<THREE.BufferGeometry>([UNIT_BOX, UNIT_CYL, UNIT_CONE, UNIT_SPHERE]);

export function disposeHollowKit(kit: HollowKit): void {
  kit.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && !SHARED_GEOM.has(mesh.geometry)) {
      mesh.geometry.dispose();
    }
  });
  disposeMaterials(kit.materials);
}
