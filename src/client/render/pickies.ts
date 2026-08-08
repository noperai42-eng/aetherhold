/**
 * Pickies. Small pink goblins — big ears, bigger eyes, no shoulders to speak of.
 *
 * Read as *not one of yours* at a glance, which is the only thing this view has
 * to get right. A settler is a metre eight of cloth in a faction colour; a Picky
 * is knee-high, pink, and pops in and out of existence. Nobody should ever have
 * to click one to find out it is not a colonist.
 *
 * Same interpolation contract as `PawnsView`: the sim moves at 20 Hz, the frame
 * runs at whatever the monitor does, and the tween between the two lives here.
 * The model faces +Z, like every other body in the game.
 */

import * as THREE from 'three';

import { POOF_TICKS } from '../../sim/pickies';
import { standHeight } from '../../sim/grid';
import type { Picky, World } from '../../sim/types';

/** Knee-high: the whole rig is built at this fraction of a settler. */
const SCALE = 0.62;

interface Snapshot {
  x: number;
  y: number;
  f: number;
  /** 1 while it is working, falling to 0 as it vanishes. */
  solid: number;
}

/** One goblin. Eight small meshes; the ears and the eyes do all the work. */
class PickyRig {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly earL: THREE.Mesh;
  private readonly earR: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly mats: THREE.Material[] = [];

  constructor(picky: Picky, shared: SharedGeometry) {
    // Every Picky is unmistakably pink; the seed only decides which pink, so a
    // crowd of them reads as a crowd rather than as one body drawn six times.
    const skin = new THREE.Color().setHSL(
      0.92 + ((picky.colorSeed % 32) / 32) * 0.06,
      0.62,
      0.62 + ((picky.colorSeed >> 5) % 16) * 0.006,
    );
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.55 });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x1a1224,
      roughness: 0.25,
      emissive: 0x120a1c,
    });
    this.mats.push(skinMat, eyeMat);

    this.torso = new THREE.Mesh(shared.torso, skinMat);
    this.head = new THREE.Mesh(shared.head, skinMat);
    this.earL = new THREE.Mesh(shared.ear, skinMat);
    this.earR = new THREE.Mesh(shared.ear, skinMat);
    this.legL = new THREE.Mesh(shared.limb, skinMat);
    this.legR = new THREE.Mesh(shared.limb, skinMat);
    this.armL = new THREE.Mesh(shared.limb, skinMat);
    this.armR = new THREE.Mesh(shared.limb, skinMat);

    this.torso.position.y = 0.52;
    this.head.position.y = 0.86;
    this.legL.position.set(-0.1, 0.2, 0);
    this.legR.position.set(0.1, 0.2, 0);
    this.armL.position.set(-0.22, 0.6, 0);
    this.armR.position.set(0.22, 0.6, 0);

    // Ears out and back, the way a bat's are — the silhouette a player actually
    // sees from the isometric camera is the pair of triangles, not the face.
    for (const [ear, side] of [
      [this.earL, -1],
      [this.earR, 1],
    ] as const) {
      ear.position.set(side * 0.17, 0.98, -0.03);
      ear.rotation.z = side * 0.55;
      ear.rotation.x = -0.35;
    }

    for (const m of [
      this.torso,
      this.head,
      this.earL,
      this.earR,
      this.legL,
      this.legR,
      this.armL,
      this.armR,
    ]) {
      m.castShadow = true;
      this.body.add(m);
    }

    // Eyes ride the head so they turn with it. Big enough to read at any zoom the
    // manager camera allows, which is the whole reason they are separate meshes.
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(shared.eye, eyeMat);
      eye.position.set(side * 0.09, 0.02, 0.15);
      this.head.add(eye);
    }

    this.body.scale.setScalar(SCALE);
    this.group.add(this.body);
  }

  update(world: World, picky: Picky, x: number, z: number, facing: number, solid: number): void {
    const g = this.group;
    const floor = standHeight(world, Math.round(x), Math.round(z));
    g.position.set(x, floor, z);
    g.rotation.set(0, Math.PI / 2 - facing, 0);

    // Popping in and popping out are the same move played in opposite directions:
    // shrink to nothing while spinning and lifting off the ground. `solid` counts
    // the vanish down; the age counts the arrival up. Both ends of a Picky's life
    // should look like the same trick, because they are.
    const age = Math.min(1, (world.tick - picky.born) / POOF_TICKS);
    const k = Math.max(0.001, solid * (age * age * (3 - 2 * age)));
    this.body.scale.setScalar(SCALE * k);
    if (k < 0.999) {
      this.body.rotation.y = (1 - k) * 14;
      g.position.y = floor + (1 - k) * 0.55;
    } else {
      this.body.rotation.y = 0;
    }

    // Always trotting. A Picky is never idle — it exists for the length of one
    // errand and then it does not — so there is no second pose to switch to.
    const ph = picky.animPhase;
    const s = Math.sin(ph) * 0.8;
    this.legL.rotation.x = s;
    this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 1.1;
    this.armR.rotation.x = s * 1.1;
    this.body.position.y = Math.abs(Math.sin(ph * 2)) * 0.06;
    // The ears lag the bounce, which is most of what sells it as a live thing.
    const flap = Math.sin(ph * 2 - 0.8) * 0.22;
    this.earL.rotation.x = -0.35 + flap;
    this.earR.rotation.x = -0.35 + flap;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
  }
}

interface SharedGeometry {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  ear: THREE.BufferGeometry;
  eye: THREE.BufferGeometry;
  limb: THREE.BufferGeometry;
}

function makeShared(): SharedGeometry {
  return {
    torso: new THREE.BoxGeometry(0.44, 0.5, 0.34),
    head: new THREE.BoxGeometry(0.4, 0.36, 0.36),
    // A flattened cone, so it is a leaf-shaped ear rather than a spike.
    ear: new THREE.ConeGeometry(0.13, 0.4, 4).scale(1, 1, 0.4),
    eye: new THREE.SphereGeometry(0.07, 8, 6),
    limb: new THREE.BoxGeometry(0.12, 0.42, 0.12).translate(0, -0.16, 0),
  };
}

/**
 * Every Picky currently out. Built the same way `PawnsView` is, and deliberately
 * kept apart from it: a Picky is not a `Pawn`, and folding it into that view
 * would mean teaching every branch in there about a body with no faction, no
 * activity and no health.
 */
export class PickiesView {
  readonly group = new THREE.Group();
  private readonly shared = makeShared();
  private readonly rigs = new Map<number, PickyRig>();
  private readonly prev = new Map<number, Snapshot>();
  private readonly curr = new Map<number, Snapshot>();

  /** Call once per simulation tick, before any further stepping. */
  onTick(world: World): void {
    for (const p of world.pickies ?? []) {
      const shot: Snapshot = {
        x: p.x,
        y: p.y,
        f: p.facing,
        solid: p.poof === null ? 1 : Math.max(0, p.poof / POOF_TICKS),
      };
      const c = this.curr.get(p.id);
      if (c) {
        this.prev.set(p.id, { ...c });
        this.curr.set(p.id, shot);
      } else {
        this.curr.set(p.id, shot);
        this.prev.set(p.id, { ...shot });
      }
    }
  }

  /** `alpha` is the fraction of the way into the next sim tick. */
  sync(world: World, alpha: number): void {
    const live = new Set<number>();
    for (const p of world.pickies ?? []) {
      live.add(p.id);
      let rig = this.rigs.get(p.id);
      if (!rig) {
        rig = new PickyRig(p, this.shared);
        this.rigs.set(p.id, rig);
        this.group.add(rig.group);
      }
      const fallback: Snapshot = { x: p.x, y: p.y, f: p.facing, solid: 1 };
      const c = this.curr.get(p.id) ?? fallback;
      const pr = this.prev.get(p.id) ?? c;
      rig.update(
        world,
        p,
        pr.x + (c.x - pr.x) * alpha,
        pr.y + (c.y - pr.y) * alpha,
        pr.f + shortestAngle(pr.f, c.f) * alpha,
        pr.solid + (c.solid - pr.solid) * alpha,
      );
    }
    for (const [id, rig] of this.rigs) {
      if (live.has(id)) continue;
      this.group.remove(rig.group);
      rig.dispose();
      this.rigs.delete(id);
      this.prev.delete(id);
      this.curr.delete(id);
    }
  }

  dispose(): void {
    for (const rig of this.rigs.values()) rig.dispose();
    for (const g of Object.values(this.shared)) g.dispose();
  }
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
