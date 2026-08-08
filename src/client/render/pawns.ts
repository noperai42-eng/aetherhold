/**
 * Procedural humanoids. Seven boxes each, animated entirely from `pawn.animPhase`
 * and `pawn.activity`, both of which the simulation advances — so a settler mid-
 * stride in the manager view is mid-stride when you switch into first person.
 *
 * The model faces +Z, so the sim's facing angle maps to yaw = PI/2 - facing.
 */

import * as THREE from 'three';

import { ANIMAL_COLOR, FACTION_COLOR, SKIN_TONES, pawnTint } from './palette';
import { ANIMALS } from '../../sim/wildlife';
import { isRipe } from '../../sim/husbandry';
import { maturity } from '../../sim/livestock';
import { LAYER_ALL, LAYER_MANAGER } from './renderer';
import { standHeight } from '../../sim/grid';
import type { Pawn, World } from '../../sim/types';

const LIMB_SWING = 0.62;

/**
 * How big a newborn is beside its dam, as a fraction of her linear size.
 *
 * Not the quarter that its carcass is worth — that is a volume and this is a
 * length, and a body a quarter as long would be a toy standing in the grass.
 * Just under half reads as young at a glance from the manager camera and is
 * still a thing you can click.
 */
const CALF_SCALE = 0.45;

/**
 * What `PawnsView` needs from a body, whichever body plan it has. Settlers are
 * two-legged and carry things; the herds are four-legged and do not. Keeping one
 * interface means interpolation, layer assignment and cleanup are written once.
 */
interface Rig {
  readonly group: THREE.Group;
  setLayer(layer: number): void;
  update(world: World, pawn: Pawn, x: number, z: number, facing: number): void;
  dispose(): void;
}

/** One settler's body. Parts are plain meshes so limbs can swing independently. */
class PawnRig implements Rig {
  readonly group = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly hair: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private weapon: THREE.Mesh | null = null;
  /** The caravan's freight, on the ground. Null for everybody who is not a trader. */
  private freight: THREE.Group | null = null;
  private readonly mats: THREE.Material[] = [];
  private layer = LAYER_ALL;

  constructor(pawn: Pawn, shared: SharedGeometry) {
    const cloth = pawnTint(FACTION_COLOR[pawn.faction], pawn.colorSeed);
    const skin = new THREE.Color(SKIN_TONES[pawn.colorSeed % SKIN_TONES.length]!);
    const hairCol = new THREE.Color(0x2b2119).offsetHSL(0, 0, ((pawn.colorSeed >> 4) % 5) * 0.05);

    const clothMat = new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.78 });
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.9 });
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.5, metalness: 0.3 });
    this.mats.push(clothMat, skinMat, hairMat, gearMat);

    this.torso = new THREE.Mesh(shared.torso, clothMat);
    this.head = new THREE.Mesh(shared.head, skinMat);
    this.hair = new THREE.Mesh(shared.hair, hairMat);
    this.legL = new THREE.Mesh(shared.leg, clothMat);
    this.legR = new THREE.Mesh(shared.leg, clothMat);
    this.armL = new THREE.Mesh(shared.arm, skinMat);
    this.armR = new THREE.Mesh(shared.arm, skinMat);

    this.torso.position.y = 1.02;
    this.head.position.y = 1.5;
    this.hair.position.y = 1.5;
    this.legL.position.set(-0.11, 0.74, 0);
    this.legR.position.set(0.11, 0.74, 0);
    this.armL.position.set(-0.26, 1.28, 0);
    this.armR.position.set(0.26, 1.28, 0);

    for (const m of [this.torso, this.head, this.hair, this.legL, this.legR, this.armL, this.armR]) {
      m.castShadow = true;
      this.group.add(m);
    }

    if (pawn.weapon !== 'none') {
      const geo = pawn.weapon === 'rifle' ? shared.rifle : shared.club;
      this.weapon = new THREE.Mesh(geo, gearMat);
      this.weapon.castShadow = true;
      this.armR.add(this.weapon); // rides the hand, so it swings with the arm
    }

    // The caravan. Everything else the player learns about a pawn comes from its
    // silhouette, and until now a trader was a settler in a different shade of
    // cloth — a distinction you have to be told about rather than one you see.
    // A bundle on the back and crates trailing behind read as freight from the
    // isometric camera at any zoom the game allows.
    if (pawn.faction === 'trader') {
      const canvasMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3e, roughness: 0.88 });
      const strapMat = new THREE.MeshStandardMaterial({ color: 0x5d4526, roughness: 0.8 });
      this.mats.push(canvasMat, strapMat);

      const bundle = new THREE.Mesh(shared.pack, canvasMat);
      bundle.position.set(0, 0.06, -0.22); // the torso's back; the model faces +Z
      bundle.castShadow = true;
      this.torso.add(bundle); // rides the body, so it leans when the trader does

      // Trailing the merchant rather than pinned to the ground: the load belongs
      // to the pack train, and a train that walks off leaving its crates behind
      // would be a worse lie than the one this fixes.
      this.freight = new THREE.Group();
      const set: [number, number, number][] = [
        [-0.42, 0.15, -0.62],
        [0.38, 0.15, -0.78],
        [-0.1, 0.44, -0.66],
      ];
      for (const [cx, cy, cz] of set) {
        const crate = new THREE.Mesh(shared.crate, cy > 0.2 ? strapMat : canvasMat);
        crate.position.set(cx, cy, cz);
        crate.rotation.y = cx * 0.9; // hand-stacked, not surveyed in
        crate.castShadow = true;
        this.freight.add(crate);
      }
      this.group.add(this.freight);
    }
  }

  setLayer(layer: number): void {
    if (this.layer === layer) return;
    this.layer = layer;
    this.group.traverse((o) => o.layers.set(layer));
  }

  update(world: World, pawn: Pawn, x: number, z: number, facing: number): void {
    const g = this.group;
    const prone = pawn.dead || pawn.downed || pawn.activity === 'sleeping';
    const floor = standHeight(world, Math.round(x), Math.round(z));

    g.position.set(x, floor, z);
    g.rotation.set(0, Math.PI / 2 - facing, 0);

    // Freight stays upright or not at all: tipping the whole rig over would bury
    // half the crates in the ground and stand the rest on end.
    if (this.freight) this.freight.visible = !prone;

    if (prone) {
      // Lying down: tip the whole body over and drop it onto whatever it lies on.
      g.rotation.x = -Math.PI / 2;
      g.position.y = floor + 0.16;
      this.setPose(0, 0, 0.15, -0.15);
      this.head.rotation.x = 0;
      return;
    }

    const ph = pawn.animPhase;
    switch (pawn.activity) {
      case 'walking': {
        const s = Math.sin(ph) * LIMB_SWING;
        this.setPose(s, -s, -s * 0.75, s * 0.75);
        g.position.y = floor + Math.abs(Math.sin(ph * 2)) * 0.035;
        break;
      }
      case 'working': {
        const s = Math.sin(ph * 0.8) * 0.3;
        this.setPose(0.05, -0.05, -1.15 + s, -1.05 - s);
        break;
      }
      case 'fighting': {
        const recoil = Math.min(0.35, pawn.attackCooldown * 0.02);
        this.setPose(0.12, -0.12, -1.42 + recoil, -1.42 + recoil);
        break;
      }
      case 'eating': {
        const s = Math.sin(ph * 0.5) * 0.2;
        this.setPose(0.35, -0.35, -1.5 + s, -0.6);
        break;
      }
      case 'relaxing':
        this.setPose(0.3, -0.3, -0.5, -0.5);
        break;
      // Arms hanging, a slow trudge. Readable from the isometric camera at a
      // glance, which is the only place the player will notice it.
      case 'breaking': {
        const drag = Math.sin(ph * 0.14) * 0.16;
        this.setPose(drag, -drag, 0.42 + drag * 0.3, 0.42 - drag * 0.3);
        break;
      }
      default: {
        const idle = Math.sin(ph * 0.25) * 0.06;
        this.setPose(idle, -idle, 0.08 + idle, 0.08 - idle);
        break;
      }
    }
    this.head.rotation.x = pawn.activity === 'working' ? 0.3 : 0;
    this.hair.rotation.x = this.head.rotation.x;
  }

  private setPose(legL: number, legR: number, armL: number, armR: number): void {
    this.legL.rotation.x = legL;
    this.legR.rotation.x = legR;
    this.armL.rotation.x = armL;
    this.armR.rotation.x = armR;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
  }
}

/**
 * A grazing animal: body, neck, head, four legs, and a crown that says which
 * species it is at a glance — antlers on a mossback, long ears on a dunhare.
 *
 * The whole rig is scaled by the species' `size`, so one set of geometry covers
 * something the size of a deer and something the size of a hare. Legs swing off
 * the same `animPhase` the settlers use, which the *simulation* advances — so a
 * running animal is mid-stride in both views, and freezes on pause with everyone
 * else.
 */
class AnimalRig implements Rig {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly legs: THREE.Mesh[] = [];
  /** Floats over anything the player has marked, so a hunt order is visible. */
  private readonly mark: THREE.Mesh;
  private readonly collar: THREE.Mesh;
  /** Hangs off the collar on a bonded animal, and on nothing else. */
  private readonly tag: THREE.Mesh;
  /** Last collar state pushed to the material, so the colour is set on change only. */
  private ripe = false;
  private readonly mats: THREE.Material[] = [];
  private layer = LAYER_ALL;
  private readonly size: number;
  /** Last growth factor pushed to the body scale, so it is set on change only. */
  private grown = -1;

  constructor(pawn: Pawn, shared: SharedGeometry) {
    const kind = pawn.animal ?? 'dunhare';
    const def = ANIMALS[kind];
    this.size = def.size;

    const hide = pawnTint(ANIMAL_COLOR[kind], pawn.colorSeed);
    const hideMat = new THREE.MeshStandardMaterial({ color: hide, roughness: 0.9 });
    const trimMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(hide).offsetHSL(0, -0.05, -0.12),
      roughness: 0.85,
    });
    this.mats.push(hideMat, trimMat);

    const barrel = new THREE.Mesh(shared.animalBody, hideMat);
    barrel.position.y = 0.62;
    const neck = new THREE.Mesh(shared.animalNeck, hideMat);
    neck.position.set(0, 0.82, 0.3);
    neck.rotation.x = -0.5;
    this.head = new THREE.Mesh(shared.animalHead, hideMat);
    this.head.position.set(0, 1.02, 0.5);
    const tail = new THREE.Mesh(shared.animalTail, trimMat);
    tail.position.set(0, 0.72, -0.42);

    // The brambletail is named after the one part of it anybody can see. At three
    // tenths the size of a mossback it is a smudge on the grass from the manager
    // camera, and the tail up behind it is what turns the smudge into an animal —
    // a vertical stroke where every other silhouette on the map is horizontal.
    if (def.browses) {
      tail.scale.set(1.6, 2.4, 1.6);
      tail.rotation.x = 0.9;
      tail.position.set(0, 0.94, -0.34);
    }

    for (const m of [barrel, neck, this.head, tail]) {
      m.castShadow = true;
      this.body.add(m);
    }

    // A hunter carries its head low and forward, which is most of why a wolf
    // reads as a wolf at any distance — the silhouette is a horizontal line
    // where a grazer's is a vertical one. Cheaper and clearer than a new mesh.
    if (def.hunts) {
      this.head.position.set(0, 0.86, 0.62);
      neck.rotation.x = -1.0;
    }

    // Antlers on a mossback, long ears on a dunhare, small pricked ears on a
    // fenwolf and a brambletail — the same two prongs every time, with different
    // splay, stretch and rake. They ride the head, so they dip when it grazes.
    const crown = kind === 'mossback' ? 'antler' : kind === 'dunhare' ? 'ear' : 'prick';
    for (const side of [-1, 1] as const) {
      const prong = new THREE.Mesh(shared.animalProng, trimMat);
      const back = crown === 'antler' ? -0.02 : crown === 'ear' ? -0.08 : -0.05;
      prong.position.set(side * (crown === 'prick' ? 0.09 : 0.07), 0.1, back);
      prong.rotation.z = side * (crown === 'antler' ? -0.55 : crown === 'ear' ? -0.28 : -0.12);
      prong.rotation.x = crown === 'antler' ? -0.25 : crown === 'ear' ? -0.15 : 0.05;
      if (crown === 'ear') prong.scale.set(0.7, 1.5, 0.7);
      if (crown === 'prick') prong.scale.set(0.8, 0.75, 0.8);
      prong.castShadow = true;
      this.head.add(prong);
    }

    for (const [lx, lz] of [
      [-0.16, 0.26],
      [0.16, 0.26],
      [-0.16, -0.26],
      [0.16, -0.26],
    ] as const) {
      const leg = new THREE.Mesh(shared.animalLeg, trimMat);
      leg.position.set(lx, 0.56, lz);
      leg.castShadow = true;
      this.legs.push(leg);
      this.body.add(leg);
    }

    this.body.scale.setScalar(def.size);
    this.group.add(this.body);

    const markMat = new THREE.MeshBasicMaterial({ color: 0xd8563f });
    this.mats.push(markMat);
    this.mark = new THREE.Mesh(shared.huntMark, markMat);
    this.mark.position.y = 0.55 + def.size * 0.9;
    this.mark.visible = false;
    this.group.add(this.mark);

    const collarMat = new THREE.MeshLambertMaterial({ color: 0xc9553a });
    this.mats.push(collarMat);
    this.collar = new THREE.Mesh(shared.animalCollar, collarMat);
    // On the neck, tilted with it, so it sits right whether the head is up or
    // down to graze.
    this.collar.position.set(0, 0.16, 0.02);
    this.collar.rotation.x = 0.5;
    this.collar.visible = false;
    neck.add(this.collar);

    const tagMat = new THREE.MeshLambertMaterial({ color: 0x4fd1c5 });
    this.mats.push(tagMat);
    this.tag = new THREE.Mesh(shared.petTag, tagMat);
    // Hung under the ring and parented to it, so it swings with the neck when the
    // head goes down to graze instead of floating where the neck used to be.
    this.tag.position.set(0, -0.15, 0);
    this.tag.visible = false;
    this.collar.add(this.tag);
  }

  setLayer(layer: number): void {
    if (this.layer === layer) return;
    this.layer = layer;
    this.group.traverse((o) => o.layers.set(layer));
  }

  update(world: World, pawn: Pawn, x: number, z: number, facing: number): void {
    const floor = standHeight(world, Math.round(x), Math.round(z));
    this.group.position.set(x, floor, z);
    this.group.rotation.set(0, Math.PI / 2 - facing, 0);
    // A calf is small and grows into the animal it will be. Three game days is a
    // long time to wait on a number in a panel — the pen has no building to look
    // at, so the herd growing up has to be the thing you can see from across the
    // yard. Everything born outside the pen has no birthday and lands on 1 here,
    // which is every wild animal on the map.
    const grow = CALF_SCALE + (1 - CALF_SCALE) * maturity(world, pawn);
    if (grow !== this.grown) {
      this.grown = grow;
      this.body.scale.setScalar(this.size * grow);
      this.mark.position.y = 0.55 + this.size * grow * 0.9;
    }
    this.mark.visible = !!pawn.hunted && !pawn.dead;
    this.collar.visible = pawn.tame === true;
    this.tag.visible = pawn.bondedTo !== undefined && !pawn.dead;
    // The collar goes pale gold when there is something to collect. The pen is
    // the one part of the colony with no building to look at — a player who has
    // to click each animal in turn to find out whether the round is worth
    // walking will simply stop walking it.
    if (this.collar.visible) {
      const ripe = isRipe(world, pawn);
      if (ripe !== this.ripe) {
        this.ripe = ripe;
        (this.collar.material as THREE.MeshLambertMaterial).color.setHex(
          ripe ? 0xe8c25a : 0xc9553a,
        );
      }
    }
    // Counter-rotate so the marker keeps its shape whichever way the animal faces.
    this.mark.rotation.y = facing;

    if (pawn.dead) {
      // On its side, which is the only cue a player gets in the half-second
      // before the carcass is swept and the meat appears.
      this.group.rotation.z = Math.PI / 2;
      this.group.position.y = floor + 0.2 * this.size * this.grown;
      return;
    }
    this.group.rotation.z = 0;

    const ph = pawn.animPhase;
    if (pawn.activity === 'walking') {
      const s = Math.sin(ph) * 0.55;
      // Diagonal pairs, the way a four-legged animal actually moves.
      this.legs[0]!.rotation.x = s;
      this.legs[3]!.rotation.x = s;
      this.legs[1]!.rotation.x = -s;
      this.legs[2]!.rotation.x = -s;
      this.head.rotation.x = 0;
      this.group.position.y = floor + Math.abs(Math.sin(ph * 2)) * 0.03 * this.size * this.grown;
    } else {
      // Standing: head down in the grass, up every few seconds to look around.
      for (const l of this.legs) l.rotation.x = 0;
      const graze = (Math.sin(ph * 0.12) + 1) * 0.5;
      this.head.rotation.x = 0.35 + graze * 0.75;
    }
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
  }
}

/** Geometry is shared across every body; only materials are per-pawn. */
interface SharedGeometry {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  rifle: THREE.BufferGeometry;
  club: THREE.BufferGeometry;
  animalBody: THREE.BufferGeometry;
  animalNeck: THREE.BufferGeometry;
  animalHead: THREE.BufferGeometry;
  animalTail: THREE.BufferGeometry;
  animalLeg: THREE.BufferGeometry;
  animalProng: THREE.BufferGeometry;
  animalCollar: THREE.BufferGeometry;
  petTag: THREE.BufferGeometry;
  huntMark: THREE.BufferGeometry;
  pack: THREE.BufferGeometry;
  crate: THREE.BufferGeometry;
}

function pivoted(w: number, h: number, d: number, z = 0): THREE.BufferGeometry {
  // Origin at the top of the limb so rotation.x reads as a hip or shoulder swing.
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, -h / 2, z);
  return g;
}

function makeShared(): SharedGeometry {
  const head = new THREE.BoxGeometry(0.25, 0.26, 0.25);
  const hair = new THREE.BoxGeometry(0.27, 0.1, 0.27);
  hair.translate(0, 0.15, -0.015);
  const rifle = new THREE.BoxGeometry(0.07, 0.07, 0.72);
  rifle.translate(0, -0.5, 0.26);
  const club = new THREE.BoxGeometry(0.08, 0.34, 0.08);
  club.translate(0, -0.62, 0.06);
  // Grows upward from its origin, so an antler or an ear rotates about its root.
  const prong = new THREE.BoxGeometry(0.045, 0.3, 0.045);
  prong.translate(0, 0.15, 0);
  return {
    torso: new THREE.BoxGeometry(0.44, 0.58, 0.26),
    head,
    hair,
    leg: pivoted(0.15, 0.74, 0.17),
    arm: pivoted(0.12, 0.6, 0.13),
    rifle,
    club,
    animalBody: new THREE.BoxGeometry(0.42, 0.36, 0.86),
    animalNeck: new THREE.BoxGeometry(0.2, 0.44, 0.2),
    animalHead: new THREE.BoxGeometry(0.22, 0.22, 0.32),
    animalTail: new THREE.BoxGeometry(0.1, 0.16, 0.1),
    animalLeg: pivoted(0.1, 0.56, 0.1),
    animalProng: prong,
    // A band round the neck. The only thing on the map that separates a tamed
    // mossback from the wild one grazing beside it, so it is a ring of solid
    // colour rather than a tint the isometric camera would lose in shadow.
    animalCollar: new THREE.TorusGeometry(0.15, 0.035, 4, 8).rotateX(Math.PI / 2),
    // A little diamond hung off the collar: the tell that this one is somebody's
    // rather than the colony's. A shape rather than a second collar colour,
    // because the collar already says something — pale gold when there is
    // something to collect — and two meanings on one surface is one meaning lost.
    petTag: new THREE.OctahedronGeometry(0.075),
    // A downward chevron, the universal "this one" marker in a colony sim.
    huntMark: new THREE.ConeGeometry(0.16, 0.28, 4).rotateX(Math.PI),
    // The caravan's load: one bundle high on the back and a few crates set down
    // in the grass. A trader who is just a differently-tinted settler is a thing
    // the player has to be told about; a pile of freight is a thing they see.
    pack: new THREE.BoxGeometry(0.38, 0.4, 0.22),
    crate: new THREE.BoxGeometry(0.36, 0.3, 0.36),
  };
}

export class PawnsView {
  readonly group = new THREE.Group();
  private readonly shared = makeShared();
  private readonly rigs = new Map<number, Rig>();
  /** Sim-tick snapshots, so rendering can interpolate between 20 Hz updates. */
  private readonly prev = new Map<number, { x: number; y: number; f: number }>();
  private readonly curr = new Map<number, { x: number; y: number; f: number }>();

  /** Call once per simulation tick, before any further stepping. */
  onTick(world: World): void {
    for (const p of world.pawns) {
      const c = this.curr.get(p.id);
      if (c) {
        const pr = this.prev.get(p.id) ?? { x: c.x, y: c.y, f: c.f };
        pr.x = c.x;
        pr.y = c.y;
        pr.f = c.f;
        this.prev.set(p.id, pr);
        c.x = p.x;
        c.y = p.y;
        c.f = p.facing;
      } else {
        this.curr.set(p.id, { x: p.x, y: p.y, f: p.facing });
        this.prev.set(p.id, { x: p.x, y: p.y, f: p.facing });
      }
    }
  }

  /** `alpha` is the fraction of the way into the next sim tick. */
  sync(world: World, alpha: number, hiddenPawnId: number | null): void {
    const live = new Set<number>();
    for (const p of world.pawns) {
      // Buried people stay in the world so their grave can name them, but they
      // are not bodies any more. Leaving them out of `live` is enough: the sweep
      // below disposes the rig on this same pass, and the marker is what stands
      // there instead.
      if (p.buried) continue;
      live.add(p.id);
      let rig = this.rigs.get(p.id);
      if (!rig) {
        rig = p.animal ? new AnimalRig(p, this.shared) : new PawnRig(p, this.shared);
        this.rigs.set(p.id, rig);
        this.group.add(rig.group);
      }
      const c = this.curr.get(p.id) ?? { x: p.x, y: p.y, f: p.facing };
      const pr = this.prev.get(p.id) ?? c;
      const x = pr.x + (c.x - pr.x) * alpha;
      const y = pr.y + (c.y - pr.y) * alpha;
      const f = pr.f + shortestAngle(pr.f, c.f) * alpha;
      rig.setLayer(p.id === hiddenPawnId ? LAYER_MANAGER : LAYER_ALL);
      rig.update(world, p, x, y, f);
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

  /** Interpolated position, so the FPS camera sits exactly where the body renders. */
  interpolated(id: number, alpha: number): { x: number; y: number; f: number } | null {
    const c = this.curr.get(id);
    if (!c) return null;
    const pr = this.prev.get(id) ?? c;
    return {
      x: pr.x + (c.x - pr.x) * alpha,
      y: pr.y + (c.y - pr.y) * alpha,
      f: pr.f + shortestAngle(pr.f, c.f) * alpha,
    };
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
