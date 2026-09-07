/**
 * Shared material roles for the mortal village kit.
 *
 * One MeshStandardMaterial per role, shared across every mesh that plays that
 * part — that is how a pocket stays inside the unique-material budget without
 * a catalogue of near-duplicates. Muted earth, wet wood, cold mountain light.
 * No emissive qi.
 */

import * as THREE from 'three';

export const MATERIAL_ROLES = [
  'wood',
  'wetWood',
  'thatch',
  'stone',
  'plaster',
  'water',
  'cloth',
  'ground',
  'mountain',
  'foliage',
] as const;

export type MaterialRole = (typeof MATERIAL_ROLES)[number];

export const ROLE_COUNT = MATERIAL_ROLES.length;

export function makeVillageMaterials(): Record<MaterialRole, THREE.MeshStandardMaterial> {
  const mat = (
    color: number,
    roughness: number,
    metalness = 0.02,
    extras: THREE.MeshStandardMaterialParameters = {},
  ): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extras });

  return {
    wood: mat(0x6b5340, 0.86),
    wetWood: mat(0x3d3228, 0.55, 0.08),
    thatch: mat(0x8a7a4e, 0.95, 0, { flatShading: true }),
    stone: mat(0x6e6a62, 0.92, 0.04),
    plaster: mat(0xa89b86, 0.9),
    water: mat(0x3a5360, 0.22, 0.18, { transparent: true, opacity: 0.78 }),
    cloth: mat(0x6a5a4a, 0.88),
    ground: mat(0x5a4e3c, 0.96, 0),
    mountain: mat(0x6d7380, 0.9, 0.05),
    foliage: mat(0x3d4a38, 0.94, 0, { flatShading: true }),
  };
}

export function disposeMaterials(mats: Record<MaterialRole, THREE.MeshStandardMaterial>): void {
  for (const role of MATERIAL_ROLES) mats[role].dispose();
}
