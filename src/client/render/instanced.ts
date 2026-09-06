/**
 * A growable instanced-mesh pool. Walls, items, projectiles and fire all come and
 * go, and an InstancedMesh cannot be resized in place, so the pool reallocates at
 * double capacity when it fills.
 *
 * Pooled meshes used to set `frustumCulled = false`, on the grounds that a pool's
 * bounding sphere is the prototype geometry's, sitting at the origin, so a pool of
 * walls spread across a hundred cells would be culled the moment that origin left
 * the screen — the difference between "my walls vanish when I pan" and a working
 * game. That is true of a plain Mesh and it is not true of an InstancedMesh in
 * three r180: `Frustum.intersectsObject` prefers the object's own `boundingSphere`
 * over the geometry's, and `InstancedMesh` builds that one by unioning the
 * geometry sphere through every instance matrix. What it does not do is keep it
 * up to date. The sphere is computed lazily, once, the first time the object meets
 * the frustum, and nothing about `setMatrixAt` invalidates it — so a pool that
 * happened to be empty on that frame carries an empty sphere for the rest of the
 * session and vanishes permanently, which looks exactly like the bug the flag was
 * put there to hide and is a worse one. The flag was covering for a sphere going
 * stale; the fix is to stop it going stale. `end()` recomputes it after every
 * rebuild, and the views rebuild their pools from scratch every frame, so the
 * sphere is never older than the matrices it describes.
 *
 * That is worth the recompute because the alternative is the card transforming
 * every tree in the world for every frame, including the ones behind the camera.
 * `end()` also drops a pool with nothing in it out of the render list altogether:
 * an empty pool draws no pixels either way, but a visible one still pays a program
 * bind and a matrix upload in the colour pass and again in the shadow pass to do
 * it, and a colony out of season leaves a good many of them standing empty.
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
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    mesh.count = 0;
    // A pool is born empty and stays out of the render list until `end()` finds
    // something in it. That covers the replacement a `grow()` hands over too: it
    // joins the scene mid-`push()`, with the count still being counted.
    mesh.visible = false;
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
    // three unions the sphere over `mesh.count` instances, so this has to follow
    // the assignment above rather than precede it — a sphere measured against the
    // previous rebuild's population is the same stale sphere that made an
    // un-culled pool look like the only safe kind.
    this.mesh.computeBoundingSphere();
    this.mesh.visible = this.count > 0;
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
