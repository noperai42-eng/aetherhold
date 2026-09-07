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

/**
 * Where the limbs hang from, in body space — the numbers the trot is tuned to.
 *
 * A leg is `LEG_LENGTH` long and hangs from its hip, so the hip sits exactly
 * one leg above the floor: the sole rests on the ground with the leg straight,
 * and lifts as it swings. The hip used to sit at 0.2 with the same leg, which
 * put every Picky's feet a tenth of a metre into the ground.
 */
const LEG_LENGTH = 0.42;
const HIP_Y = LEG_LENGTH;
const SHOULDER_Y = 0.6;
const ARM_LENGTH = 0.37;

/** How far back the ears lie at rest; the trot flaps them about this. */
const EAR_REST = -0.35;

interface Snapshot {
  x: number;
  y: number;
  f: number;
  /** 1 while it is working, falling to 0 as it vanishes. */
  solid: number;
}

/**
 * One goblin. A capsule of a body, a round head with a snout pushed onto the
 * front of it, and a pair of leaf ears — the ears and the eyes still do all
 * the work; the rest is there so nothing on it has a corner. Every part is
 * named, so a test can find a hip without being handed the rig's insides.
 */
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
  private readonly tail: THREE.Mesh;
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
    // The glint is unlit on purpose: a wet eye catches light from anywhere, and
    // a dot that went dark under a shaded wall would read as a dead one.
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mats.push(skinMat, eyeMat, glintMat);

    this.torso = new THREE.Mesh(shared.torso, skinMat);
    this.head = new THREE.Mesh(shared.head, skinMat);
    this.earL = new THREE.Mesh(shared.ear, skinMat);
    this.earR = new THREE.Mesh(shared.ear, skinMat);
    this.legL = new THREE.Mesh(shared.leg, skinMat);
    this.legR = new THREE.Mesh(shared.leg, skinMat);
    this.armL = new THREE.Mesh(shared.arm, skinMat);
    this.armR = new THREE.Mesh(shared.arm, skinMat);
    this.tail = new THREE.Mesh(shared.tail, skinMat);
    this.torso.name = 'torso';
    this.head.name = 'head';
    this.earL.name = this.earR.name = 'ear';
    this.legL.name = this.legR.name = 'leg';
    this.armL.name = this.armR.name = 'arm';
    this.tail.name = 'tail';

    this.torso.position.y = 0.52;
    this.head.position.y = 0.86;
    this.legL.position.set(-0.1, HIP_Y, 0);
    this.legR.position.set(0.1, HIP_Y, 0);
    this.armL.position.set(-0.22, SHOULDER_Y, 0);
    this.armR.position.set(0.22, SHOULDER_Y, 0);

    // Rooted in the small of the back and carried up and out behind it. The
    // pitch is applied after the wag (three's XYZ order), so a roll about Z
    // reads as the tip swinging side to side rather than the tail spinning.
    this.tail.position.set(0, 0.4, -0.16);
    this.tail.rotation.x = -1.25;

    // Ears out and back, the way a bat's are — the silhouette a player actually
    // sees from the isometric camera is the pair of leaves, not the face. The
    // roll is *against* the side: a leaf's tip is its +Y, and rolling the left
    // ear by a negative angle would carry that tip across the crown to meet the
    // other one, with both roots hanging off the sides of the head. The seed
    // decides how big they are, which is the second thing it was minted for.
    const earSize = 0.85 + (((picky.colorSeed >> 9) % 8) / 8) * 0.3;
    for (const [ear, side] of [
      [this.earL, -1],
      [this.earR, 1],
    ] as const) {
      ear.position.set(side * 0.17, 0.98, -0.03);
      ear.rotation.z = -side * 0.55;
      ear.rotation.x = EAR_REST;
      ear.scale.setScalar(earSize);
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
      this.tail,
    ]) {
      m.castShadow = true;
      this.body.add(m);
    }

    // The face rides the head so it turns with it. Snout and nose first, so the
    // eyes sit above and behind the muzzle the way they do on anything with one.
    const snout = new THREE.Mesh(shared.snout, skinMat);
    snout.name = 'snout';
    snout.position.set(0, -0.05, 0.165);
    snout.castShadow = true;
    this.head.add(snout);
    const nose = new THREE.Mesh(shared.nose, eyeMat);
    nose.name = 'nose';
    nose.position.set(0, -0.03, 0.245);
    this.head.add(nose);

    // Big enough to read at any zoom the manager camera allows, which is the
    // whole reason they are separate meshes. The glint sits on the same upper-
    // outer quarter of both eyes — one light source, not one per eye.
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(shared.eye, eyeMat);
      eye.name = 'eye';
      eye.position.set(side * 0.085, 0.045, 0.16);
      const glint = new THREE.Mesh(shared.glint, glintMat);
      glint.name = 'glint';
      glint.position.set(0.02, 0.022, 0.055);
      eye.add(glint);
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
    this.earL.rotation.x = EAR_REST + flap;
    this.earR.rotation.x = EAR_REST + flap;
    // The tail wags at the stride, not the bounce: once per step, with the legs.
    this.tail.rotation.z = Math.sin(ph) * 0.35;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
  }
}

interface SharedGeometry {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  snout: THREE.BufferGeometry;
  nose: THREE.BufferGeometry;
  ear: THREE.BufferGeometry;
  eye: THREE.BufferGeometry;
  glint: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
}

/**
 * A limb: a capsule of this radius, reaching exactly `length` below its pivot.
 *
 * Origin at the joint so `rotation.x` reads as a hip or shoulder swing — the
 * same contract the boxes it replaced kept — with the joint end left a little
 * proud *above* the pivot so the swing never opens a gap at the torso. The
 * proud part is extra, not borrowed: the first capsules took it out of the
 * reach instead, and with the hip set one leg above the floor that left every
 * sole hanging three centimetres in the air, which at knee height is the whole
 * foot.
 */
function limb(radius: number, length: number, radial: number): THREE.BufferGeometry {
  const proud = radius * 0.8;
  const total = length + proud;
  return new THREE.CapsuleGeometry(radius, total - radius * 2, 2, radial).translate(
    0,
    proud - total / 2,
    0,
  );
}

/**
 * Everything is a sphere or a capsule scaled into shape — three keeps the
 * normals honest through `scale`, so nothing here needs recomputing. Segment
 * counts are the smallest that still read as round at the first-person camera:
 * one Picky is under twelve hundred triangles, and there are at most six.
 */
function makeShared(): SharedGeometry {
  return {
    torso: new THREE.CapsuleGeometry(0.2, 0.16, 3, 12).scale(1.1, 1, 0.88),
    head: new THREE.SphereGeometry(0.2, 12, 9).scale(1.05, 0.9, 1),
    snout: new THREE.SphereGeometry(0.075, 8, 6).scale(1.4, 0.8, 1),
    nose: new THREE.SphereGeometry(0.03, 6, 4),
    // A sphere squashed into a leaf, centred like the cone it replaced so the
    // ear still turns about the same point on the side of the head.
    ear: new THREE.SphereGeometry(0.13, 8, 6).scale(0.8, 1.55, 0.35),
    eye: new THREE.SphereGeometry(0.065, 8, 6),
    glint: new THREE.SphereGeometry(0.016, 5, 3),
    leg: limb(0.065, LEG_LENGTH, 7),
    arm: limb(0.055, ARM_LENGTH, 7),
    // Hung from its root rather than its top: the tail is the one limb that
    // points away from where it is pinned.
    tail: new THREE.CapsuleGeometry(0.04, 0.16, 2, 5).translate(0, 0.1, 0),
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
