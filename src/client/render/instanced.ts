/**
 * A growable instanced-mesh pool. Walls, items, projectiles and fire all come and
 * go, and an InstancedMesh cannot be resized in place, so the pool reallocates at
 * double capacity when it fills.
 *
 * Pooled meshes set `frustumCulled = false`: the bounding sphere is computed from
 * the prototype geometry at the origin, so an un-culled pool is the difference
 * between "my walls vanish when I pan" and a working game.
 */

import * as THREE from 'three';

export class InstancedPool {
  mesh: THREE.InstancedMesh;
  private capacity: number;
  private count = 0;
  private readonly parent: THREE.Object3D;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.Material;
  private readonly tinted: boolean;
  private readonly castShadow: boolean;
  private readonly receiveShadow: boolean;
  private readonly layer: number;

  constructor(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    opts: { tinted?: boolean; castShadow?: boolean; receiveShadow?: boolean; layer?: number } = {},
  ) {
    this.parent = parent;
    this.geometry = geometry;
    this.material = material;
    this.capacity = Math.max(1, capacity);
    this.tinted = opts.tinted ?? false;
    this.castShadow = opts.castShadow ?? true;
    this.receiveShadow = opts.receiveShadow ?? true;
    this.layer = opts.layer ?? 0;
    this.mesh = this.make(this.capacity);
  }

  private make(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.frustumCulled = false;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    mesh.count = 0;
    if (this.layer !== 0) {
      mesh.layers.set(this.layer);
    }
    if (this.tinted) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    }
    this.parent.add(mesh);
    return mesh;
  }

  begin(): void {
    this.count = 0;
  }

  push(matrix: THREE.Matrix4, color?: THREE.Color): void {
    if (this.count >= this.capacity) this.grow();
    this.mesh.setMatrixAt(this.count, matrix);
    if (this.tinted && color) this.mesh.setColorAt(this.count, color);
    this.count++;
  }

  private grow(): void {
    const old = this.mesh;
    const next = this.make(this.capacity * 2);
    // The matrices and colours both live in flat typed arrays, so the pool
    // carries them across in one copy each rather than a matrix at a time.
    next.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, this.count * 16));
    if (this.tinted && old.instanceColor && next.instanceColor) {
      next.instanceColor.array.set(old.instanceColor.array.subarray(0, this.count * 3));
    }
    this.parent.remove(old);
    old.dispose();
    this.mesh = next;
    this.capacity *= 2;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get length(): number {
    return this.count;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
