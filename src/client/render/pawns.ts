/**
 * Procedural humanoids. A dozen rounded parts each, animated entirely from
 * `pawn.animPhase` and `pawn.activity`, both of which the simulation advances —
 * so a settler mid-stride in the manager view is mid-stride when you switch into
 * first person.
 *
 * The bodies were seven boxes once, which read at eleven cells up and fell apart
 * at eye level, where a settler is a stack of crates with a crate for a head.
 * Everything here is now a capsule, a sphere, a lathe or a rounded box, with
 * enough segments that no edge shows at arm's length, and the joints have not
 * moved: every limb still hangs from the same pivot at the same height, so the
 * walk, the hip and shoulder swing and the pose table in `update()` are
 * untouched.
 *
 * The model faces +Z, so the sim's facing angle maps to yaw = PI/2 - facing.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { ANIMAL_COLOR, FACTION_COLOR, SKIN_TONES, pawnTint } from './palette';
import { SETTLER_LEG, SETTLER_PHASE, SETTLER_SWING, phaseScale } from '../gait';
import { ANIMALS } from '../../sim/wildlife';
import { isRipe } from '../../sim/husbandry';
import { maturity } from '../../sim/livestock';
import { LAYER_ALL, LAYER_MANAGER } from './renderer';
import { standHeight } from '../../sim/grid';
import type { Pawn, World } from '../../sim/types';

/** The same two numbers for a four-legged body, whose legs are shorter. */
const ANIMAL_LEG_LENGTH = 0.56;
const ANIMAL_SWING = 0.55;

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

/**
 * The heights every settler part hangs from. The legs' is the gait's own
 * constant, because the soles have to land on the floor; the rest are laid out
 * from it so the body stacks without a gap or an overlap you can see.
 */
const TORSO_Y = 1.02;
const SHOULDER_Y = 1.28;
const HEAD_Y = 1.51;

/**
 * Hair, black through silver. Read off `colorSeed` like the skin and the cloth
 * are, from bits neither of those looks at, so a colony is not six people in
 * the same dark brown and the hair does not follow the coat. Nothing here is a
 * sim field; the seed is the only cosmetic the record carries.
 *
 * Every tone sits in a gap between the skin tones in lightness — CIE L*, the
 * scale on which two greys look a step apart. The blond that used to be here
 * was within two steps of the middle tan, and a settler wearing both was one
 * pale sphere from the manager camera, hair and face indistinguishable: bald.
 * The skins fall at L* 24, 33, 45, 61, 73 and 83, so the hair goes below 24
 * (two blacks), into the 45–61 gap (chestnut, auburn and a dark blond that
 * differ from each other by hue) and above 83 (silver). Nothing is a dark or
 * mid brown, which is where every gap is too narrow to keep a clear margin.
 * `lighting.test.ts` holds the margin at seven.
 */
export const HAIR_TONES = [0x1d1714, 0x2b2119, 0xa67546, 0xc26545, 0x9e7a2c, 0xe9e6e2];

/**
 * Trousers, in tones that are nobody's colours. The shirt and sleeves carry
 * the faction tint and are most of what the manager camera sees; the legs
 * carry the person, in a dun, a charcoal, an olive or a tan-brown that is
 * distinct in hue from the blue, the red and the gold above them — so the
 * figure breaks at the belt into two garments instead of being one column
 * of cloth with a head on it.
 */
const TROUSER_TONES = [0x5b4d3f, 0x46474b, 0x585b3c, 0x6b5747];

/** One settler's body. Parts are plain meshes so limbs can swing independently. */
class PawnRig implements Rig {
  readonly group = new THREE.Group();
  private readonly torso: THREE.Mesh;
  /** Carries the hair and the eyes, so a nod takes the whole face with it. */
  private readonly head: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  /** Stock and action, or a club, riding the right hand. Null when unarmed. */
  private weapon: THREE.Group | null = null;
  /** The caravan's freight, on the ground. Null for everybody who is not a trader. */
  private freight: THREE.Group | null = null;
  private readonly mats: THREE.Material[] = [];
  private layer = LAYER_ALL;

  constructor(pawn: Pawn, shared: SharedGeometry) {
    const cloth = pawnTint(FACTION_COLOR[pawn.faction], pawn.colorSeed);
    const skin = new THREE.Color(SKIN_TONES[pawn.colorSeed % SKIN_TONES.length]!);
    const hairCol = new THREE.Color(HAIR_TONES[(pawn.colorSeed >> 8) % HAIR_TONES.length]!);

    const clothMat = new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.78 });
    const trouserMat = new THREE.MeshStandardMaterial({
      color: TROUSER_TONES[(pawn.colorSeed >> 14) % TROUSER_TONES.length]!,
      roughness: 0.82,
    });
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.9 });
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.5, metalness: 0.3 });
    // The belt is a dark strap and the boots are darker still, each in its own
    // leather rather than a shade of the cloth: a band that is the shirt again,
    // only dimmer, is a fold, and a band in another material is a belt.
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x4a3323, roughness: 0.62 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x2c221c, roughness: 0.55 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 0.35 });
    this.mats.push(clothMat, trouserMat, skinMat, hairMat, gearMat, leatherMat, bootMat, eyeMat);

    this.torso = new THREE.Mesh(shared.torso, clothMat);
    this.head = new THREE.Mesh(shared.head, skinMat);
    // Cropped or to the jaw, on one more bit of the same seed.
    const hair = new THREE.Mesh((pawn.colorSeed >> 12) & 1 ? shared.hairLong : shared.hair, hairMat);
    const neck = new THREE.Mesh(shared.neck, skinMat);
    this.torso.name = 'torso';
    this.head.name = 'head';
    hair.name = 'hair';
    neck.name = 'neck';
    const belt = new THREE.Mesh(shared.belt, leatherMat);
    belt.name = 'belt';
    this.legL = new THREE.Mesh(shared.leg, trouserMat);
    this.legR = new THREE.Mesh(shared.leg, trouserMat);
    this.legL.name = 'leg';
    this.legR.name = 'leg';
    this.armL = new THREE.Mesh(shared.arm, clothMat);
    this.armR = new THREE.Mesh(shared.arm, clothMat);

    this.torso.position.y = TORSO_Y;
    this.head.position.y = HEAD_Y;
    // The neck rises from the torso's rounded top and flares up into the skull,
    // and the belt sits where the lathe pinches in, so both are placed off the
    // torso rather than by eye.
    neck.position.y = TORSO_Y + 0.29;
    belt.position.y = TORSO_Y - 0.15;
    this.legL.position.set(-0.11, SETTLER_LEG, 0);
    this.legR.position.set(0.11, SETTLER_LEG, 0);
    this.armL.position.set(-0.27, SHOULDER_Y, 0);
    this.armR.position.set(0.27, SHOULDER_Y, 0);

    // Hair and eyes ride the head, so `head.rotation.x` is the whole nod. The
    // hair used to be a second mesh rotated to match by hand, which worked only
    // because both were centred on the same point.
    hair.castShadow = true;
    this.head.add(hair);
    // Set low on the face, a third of the way up from the chin. The fringe
    // comes down to the brow and the eyes have to clear it, and a forehead
    // with hair over it is what makes the hairline show from overhead.
    for (const side of [-1, 1] as const) {
      const eye = new THREE.Mesh(shared.eye, eyeMat);
      eye.name = 'eye';
      eye.position.set(side * 0.05, -0.05, 0.115);
      this.head.add(eye);
    }

    // Hands and boots ride their limbs, so they swing from the same pivot.
    for (const arm of [this.armL, this.armR]) {
      const hand = new THREE.Mesh(shared.hand, skinMat);
      hand.position.y = -0.57;
      hand.castShadow = true;
      arm.add(hand);
    }
    for (const leg of [this.legL, this.legR]) {
      const boot = new THREE.Mesh(shared.boot, bootMat);
      boot.name = 'boot';
      boot.position.set(0, -SETTLER_LEG + 0.049, 0.025); // toe forward, sole on the floor
      boot.castShadow = true;
      leg.add(boot);
    }

    for (const m of [this.torso, neck, belt, this.head, this.legL, this.legR, this.armL, this.armR]) {
      m.castShadow = true;
      this.group.add(m);
    }

    if (pawn.weapon !== 'none') {
      // Wood for the stock and the club, steel for the action: a rifle in one
      // grey was a rod from the manager camera, and the two-tone split is what
      // reads as a weapon at that zoom.
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4626, roughness: 0.72 });
      this.mats.push(woodMat);
      this.weapon = new THREE.Group();
      const parts =
        pawn.weapon === 'rifle'
          ? [new THREE.Mesh(shared.rifleStock, woodMat), new THREE.Mesh(shared.rifleAction, gearMat)]
          : [new THREE.Mesh(shared.club, woodMat)];
      for (const part of parts) {
        part.castShadow = true;
        this.weapon.add(part);
      }
      this.weapon.children[0]!.name = pawn.weapon === 'rifle' ? 'stock' : 'club';
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
        // `ph` is distance travelled, not time elapsed, so the stride reads off
        // the ground rather than off the clock and the foot stays where it was
        // put. The bob rides the same phase: two rises per cycle, one per step.
        const w = ph * SETTLER_PHASE;
        const s = Math.sin(w) * SETTLER_SWING;
        this.setPose(s, -s, -s * 0.75, s * 0.75);
        g.position.y = floor + Math.abs(Math.sin(w * 2)) * 0.035;
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
  /**
   * Stride phase per unit of `animPhase`, recomputed whenever the body changes
   * size. A calf's legs are shorter than its dam's, so it has to take more steps
   * over the same ground — and does, without either of them scrubbing a foot.
   */
  private walkPhase = 0;

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
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 0.35 });
    this.mats.push(hideMat, trimMat, eyeMat);

    const barrel = new THREE.Mesh(shared.animalBody, hideMat);
    barrel.position.y = 0.62;
    const neck = new THREE.Mesh(shared.animalNeck, hideMat);
    neck.position.set(0, 0.81, 0.34);
    // Leans forward into the skull. It leaned the other way for a long time —
    // a negative pitch carries the top of a limb toward -Z, so the neck rose
    // from the chest and reached back over the shoulders, its top hanging in
    // the air a hand's width behind the head it was meant to hold up. At
    // eleven cells up that read as withers; at eye level it read as a mistake.
    neck.rotation.x = 0.55;
    this.head = new THREE.Mesh(shared.animalHead, hideMat);
    this.head.position.set(0, 1.02, 0.5);
    this.head.name = 'head';
    neck.name = 'neck';
    const tail = new THREE.Mesh(shared.animalTail, trimMat);
    tail.position.set(0, 0.72, -0.4);

    // The brambletail is named after the one part of it anybody can see. At three
    // tenths the size of a mossback it is a smudge on the grass from the manager
    // camera, and the tail up behind it is what turns the smudge into an animal —
    // a vertical stroke where every other silhouette on the map is horizontal.
    // The tail grows backwards along its own -Z, so it is lengthened along that
    // axis and then raked up, rather than stretched in Y like the old block.
    if (def.browses) {
      tail.scale.set(1.7, 1.7, 2.2);
      tail.rotation.x = 1.1;
      tail.position.set(0, 0.86, -0.36);
    }

    for (const side of [-1, 1] as const) {
      const eye = new THREE.Mesh(shared.animalEye, eyeMat);
      eye.position.set(side * 0.08, 0.04, 0.085);
      this.head.add(eye);
    }

    for (const m of [barrel, neck, this.head, tail]) {
      m.castShadow = true;
      this.body.add(m);
    }

    // A hunter carries its head low and forward, which is most of why a wolf
    // reads as a wolf at any distance — the silhouette is a horizontal line
    // where a grazer's is a vertical one. Cheaper and clearer than a new mesh.
    // The neck comes down with it: pitched flatter from where it stood, its top
    // cleared the back of the lowered skull and hung in the air behind the ears,
    // the withers mistake again in the other species.
    if (def.hunts) {
      this.head.position.set(0, 0.86, 0.62);
      neck.position.set(0, 0.745, 0.395);
      neck.rotation.x = 1.05;
    }

    // Antlers on a mossback, long ears on a dunhare, small pricked ears on a
    // fenwolf and a brambletail — two prongs every time, with different splay,
    // stretch and rake. Antlers are a forked beam; ears are one prong squashed
    // flat front-to-back, which is what makes them ears and not horns. They
    // ride the head, so they dip when it grazes.
    const crown = kind === 'mossback' ? 'antler' : kind === 'dunhare' ? 'ear' : 'prick';
    for (const side of [-1, 1] as const) {
      const prong = new THREE.Mesh(crown === 'antler' ? shared.animalAntler : shared.animalEar, trimMat);
      const back = crown === 'antler' ? -0.02 : crown === 'ear' ? -0.06 : -0.04;
      // Rooted just under the skull's surface, so no prong stands on air.
      prong.position.set(side * (crown === 'prick' ? 0.08 : 0.07), 0.06, back);
      prong.rotation.z = side * (crown === 'antler' ? -0.55 : crown === 'ear' ? -0.28 : -0.12);
      prong.rotation.x = crown === 'antler' ? -0.25 : crown === 'ear' ? -0.15 : 0.05;
      // The antler's tine branches outward; mirror it so the pair is symmetric.
      if (crown === 'antler') prong.scale.x = side;
      if (crown === 'ear') prong.scale.set(1, 1.5, 1);
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
      leg.position.set(lx, ANIMAL_LEG_LENGTH, lz);
      leg.castShadow = true;
      this.legs.push(leg);
      this.body.add(leg);
    }

    this.body.scale.setScalar(def.size);
    this.group.add(this.body);

    const markMat = new THREE.MeshBasicMaterial({ color: 0xd8563f });
    this.mats.push(markMat);
    this.mark = new THREE.Mesh(shared.huntMark, markMat);
    this.mark.name = 'mark';
    this.mark.position.y = 0.55 + def.size * 0.9;
    this.mark.visible = false;
    this.group.add(this.mark);

    const collarMat = new THREE.MeshLambertMaterial({ color: 0xc9553a });
    this.mats.push(collarMat);
    this.collar = new THREE.Mesh(shared.animalCollar, collarMat);
    this.collar.name = 'collar';
    // On the neck, square to it, so it rings the neck the way a collar does
    // rather than lying level across a sloping one.
    this.collar.position.set(0, 0.16, 0);
    this.collar.visible = false;
    neck.add(this.collar);

    const tagMat = new THREE.MeshLambertMaterial({ color: 0x4fd1c5 });
    this.mats.push(tagMat);
    this.tag = new THREE.Mesh(shared.petTag, tagMat);
    this.tag.name = 'tag';
    // Hung off the front of the ring and parented to it, so it lies against
    // the throat below the collar rather than floating where the neck used to be.
    this.tag.position.set(0, -0.04, 0.13);
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
      this.walkPhase = phaseScale(ANIMAL_LEG_LENGTH * this.size * grow, ANIMAL_SWING);
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
      const w = ph * this.walkPhase;
      const s = Math.sin(w) * ANIMAL_SWING;
      // Diagonal pairs, the way a four-legged animal actually moves.
      this.legs[0]!.rotation.x = s;
      this.legs[3]!.rotation.x = s;
      this.legs[1]!.rotation.x = -s;
      this.legs[2]!.rotation.x = -s;
      this.head.rotation.x = 0;
      this.group.position.y = floor + Math.abs(Math.sin(w * 2)) * 0.03 * this.size * this.grown;
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
  belt: THREE.BufferGeometry;
  neck: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  hairLong: THREE.BufferGeometry;
  eye: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  boot: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  hand: THREE.BufferGeometry;
  rifleStock: THREE.BufferGeometry;
  rifleAction: THREE.BufferGeometry;
  club: THREE.BufferGeometry;
  animalBody: THREE.BufferGeometry;
  animalNeck: THREE.BufferGeometry;
  animalHead: THREE.BufferGeometry;
  animalEye: THREE.BufferGeometry;
  animalTail: THREE.BufferGeometry;
  animalLeg: THREE.BufferGeometry;
  animalAntler: THREE.BufferGeometry;
  animalEar: THREE.BufferGeometry;
  animalCollar: THREE.BufferGeometry;
  petTag: THREE.BufferGeometry;
  huntMark: THREE.BufferGeometry;
  pack: THREE.BufferGeometry;
  crate: THREE.BufferGeometry;
}

/**
 * A limb: a capsule of this radius and total length, hung from its top.
 *
 * Origin at the top of the limb so rotation.x reads as a hip or shoulder swing,
 * exactly where the box it replaces pivoted — the gait constants and the pose
 * table were tuned against that point and must not notice the change of shape.
 */
function limb(radius: number, length: number, radial: number, caps = 4): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, length - 2 * radius, caps, radial);
  g.translate(0, -length / 2, 0);
  return g;
}

/**
 * Several pieces welded into one geometry, so a rifle or a forked antler is
 * a single mesh with a single material and a single draw. The merge refuses a
 * mix of indexed and unindexed parts, and `RoundedBoxGeometry` is the one
 * primitive here that comes unindexed, so every part is flattened first — the
 * normals survive that, so nothing turns faceted. The parts are disposed on the
 * way out: the merged copy is the only one anybody keeps.
 */
function weld(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const merged = mergeGeometries(flat, false);
  if (!merged) throw new Error('pawn geometry: parts do not share an attribute layout');
  for (const p of parts) p.dispose();
  for (const p of flat) if (!parts.includes(p)) p.dispose();
  return merged;
}

/**
 * The settler's torso: a lathe with hips, a waist and shoulders, then squashed
 * front-to-back so it is a chest and not a barrel. Scaling the geometry rather
 * than the mesh keeps the trader's bundle, which rides the torso, at its own
 * proportions.
 */
function makeTorso(): THREE.BufferGeometry {
  const profile = [
    [0, -0.29],
    [0.15, -0.29],
    [0.21, -0.25],
    [0.2, -0.1],
    [0.225, 0.08],
    [0.235, 0.2],
    [0.2, 0.27],
    [0.1, 0.29],
    [0, 0.29],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(profile, 20);
  g.scale(1, 1, 0.62);
  return g;
}

/**
 * A patch of the unit sphere whose lower edge wanders: `hem(phi)` is the polar
 * angle the patch ends at on each meridian, so one indexed grid is a skull cap
 * that dips into a fringe over one temple and a nape down the back, with no
 * seam between them. Same parametrisation and winding as `SphereGeometry`, so
 * phi runs from -X through +Z (the face) to +X to -Z and the outside faces
 * out. The caller scales it to the head it wraps and the normals are then
 * recomputed, all but the crown's, which are pinned straight up: the pole row
 * is one point stored once per meridian, and each copy would otherwise take
 * the normal of its own single triangle and put a faint star on the crown.
 */
function skullPatch(hem: (phi: number) => number, cols: number, rows: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const phi = (j / cols) * Math.PI * 2;
      const theta = (i / rows) * hem(phi);
      pos.push(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    }
  }
  const at = (i: number, j: number): number => i * (cols + 1) + j;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = at(i, j + 1);
      const b = at(i, j);
      const c = at(i + 1, j);
      const d = at(i + 1, j + 1);
      if (i !== 0) idx.push(a, b, d); // the top row is the pole: one triangle per cell, not two
      idx.push(b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * The hem of a cap as a few turning points round the head — (phi, theta) in
 * turns of PI — eased between, so the edge curves rather than kinks. The first
 * and last points are the same meridian and must agree.
 */
function hemOf(keys: [number, number][]): (phi: number) => number {
  return (phi) => {
    const t = phi / Math.PI;
    for (let k = 0; k < keys.length - 1; k++) {
      const [p0, t0] = keys[k]!;
      const [p1, t1] = keys[k + 1]!;
      if (t < p0 || t > p1) continue;
      const u = 0.5 - 0.5 * Math.cos(((t - p0) / (p1 - p0)) * Math.PI);
      return (t0 + (t1 - t0) * u) * Math.PI;
    }
    return keys[keys.length - 1]![1] * Math.PI;
  };
}

/**
 * The hair: a shell a little larger than the skull all round, so nothing here
 * is coplanar with the skin, whose hem is what makes it hair. At the front it
 * hangs to the brow in a fringe that is deeper over one temple than the other,
 * a swept wedge with a visible edge, and stays clear of the eyes; at the back
 * it is a nape. Round the head with a straight rim it was a skull cap, and
 * from the manager camera a skull cap over a face is a bald head in a second
 * colour — the colour has to change along a line that looks like a hairline.
 *
 * Cropped, the nape stops at the collar and the ears show; long, it carries on
 * down the sides and back to the jaw. Two shapes on one seed bit is the
 * cheapest thing that keeps a crew from being the same silhouette six times.
 */
function makeHair(long: boolean): THREE.BufferGeometry {
  const hem = long
    ? hemOf([
        [0, 0.66],
        [0.18, 0.56],
        [0.32, 0.55],
        [0.5, 0.52],
        [0.64, 0.49],
        [0.78, 0.6],
        [1, 0.66],
        [1.25, 0.78],
        [1.5, 0.8],
        [1.75, 0.78],
        [2, 0.66],
      ])
    : hemOf([
        [0, 0.48],
        [0.2, 0.48],
        [0.32, 0.55],
        [0.5, 0.52],
        [0.64, 0.49],
        [0.76, 0.47],
        [1, 0.48],
        [1.2, 0.6],
        [1.5, 0.63],
        [1.8, 0.6],
        [2, 0.48],
      ]);
  // The skull is 0.13 round and 6% taller; the shell is that plus a finger's
  // width, so every vertex is outside the skin and the crown has some volume.
  const g = skullPatch(hem, 24, 7).scale(0.148, 0.158, 0.148);
  g.computeVertexNormals();
  const n = g.attributes.normal!;
  for (let j = 0; j <= 24; j++) n.setXYZ(j, 0, 1, 0);
  return g;
}

/**
 * The settler's neck: a throat that narrows a little above the collar and then
 * flares up into the underside of the skull. A straight cylinder met the sphere
 * where the sphere was still nearly flat, and at arm's length the head sat on
 * the neck with a shelf between them; the flare fills that crease and ends a
 * few millimetres inside the skull, so its rim never shows. The rim stays
 * inside through the working nod, which is the only pitch the head takes. Both
 * ends are open — one is inside the torso, the other inside the head.
 */
function makeNeck(): THREE.BufferGeometry {
  const profile = [
    [0.08, -0.08],
    [0.066, -0.03],
    [0.062, 0.02],
    [0.068, 0.06],
    [0.082, 0.09],
    [0.1, 0.12],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(profile, 16);
}

/**
 * The animal's neck: tapered from the chest to the skull and domed at the top.
 * The head pitches through more than a radian when it grazes, and no straight
 * tube can keep its top rim inside a skull that swings that far; what pokes out
 * of the nape at the bottom of a graze is now a rounded end of neck, which reads
 * as the nape, rather than a flat disc, which read as a cut.
 */
function makeAnimalNeck(): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [new THREE.Vector2(0.11, -0.22), new THREE.Vector2(0.078, 0.13)];
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    profile.push(new THREE.Vector2(0.078 * Math.cos(a), 0.13 + 0.078 * Math.sin(a)));
  }
  return new THREE.LatheGeometry(profile, 12);
}

/**
 * The wood of a rifle, held at the hand and pointing +Z: a butt that drops
 * behind the grip and a forend under the barrel. Its own geometry so it can be
 * its own material — the stock in wood and the action in steel is the whole
 * difference between a rifle and a grey rod at manager zoom. The two share
 * the hand's origin with `makeRifleAction`, so the parts line up by the same
 * numbers rather than by a second offset.
 */
function makeRifleStock(): THREE.BufferGeometry {
  const butt = new RoundedBoxGeometry(0.048, 0.1, 0.2, 1, 0.014);
  butt.translate(0, -0.03, 0);
  const forend = new RoundedBoxGeometry(0.044, 0.04, 0.26, 1, 0.012);
  forend.translate(0, -0.015, 0.35);
  const g = weld([butt, forend]);
  g.translate(0, -0.55, 0);
  return g;
}

/** The steel of a rifle: receiver, barrel and a sight, seated on the stock. */
function makeRifleAction(): THREE.BufferGeometry {
  const receiver = new THREE.BoxGeometry(0.05, 0.06, 0.2);
  receiver.translate(0, 0.005, 0.2);
  const barrel = new THREE.CylinderGeometry(0.016, 0.018, 0.44, 12);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(0, 0.012, 0.5);
  const sight = new THREE.BoxGeometry(0.02, 0.03, 0.03);
  sight.translate(0, 0.05, 0.28);
  const g = weld([receiver, barrel, sight]);
  g.translate(0, -0.55, 0);
  return g;
}

/** A club: a shaft that thickens toward a rounded head, gripped at the hand. */
function makeClub(): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(0.028, 0.045, 0.34, 12);
  const knob = new THREE.SphereGeometry(0.052, 12, 8);
  knob.translate(0, -0.17, 0);
  const g = weld([shaft, knob]);
  g.translate(0, -0.7, 0.06);
  return g;
}

/**
 * The mossback's antler: a beam with one tine branching off it, both growing
 * up from the root so the whole thing rakes about the skull. The tine leans to
 * +X; the rig mirrors it for the other side.
 */
function makeAntler(): THREE.BufferGeometry {
  const beam = new THREE.CapsuleGeometry(0.022, 0.26, 2, 8);
  beam.translate(0, 0.15, 0);
  const tine = new THREE.CapsuleGeometry(0.017, 0.13, 2, 8);
  tine.translate(0, 0.085, 0);
  tine.rotateZ(-0.7);
  tine.translate(0, 0.15, 0);
  return weld([beam, tine]);
}

/**
 * A tail that curves: back from the rump and up in a shallow flag, with a
 * rounded tip so the tube does not end in a hole. The root sits at the origin,
 * so the brambletail's rake lifts it about the rump.
 */
function makeTail(): THREE.BufferGeometry {
  const path = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0.02),
    new THREE.Vector3(0, -0.01, -0.12),
    new THREE.Vector3(0, 0.07, -0.19),
  );
  const tube = new THREE.TubeGeometry(path, 6, 0.035, 8, false);
  const tip = new THREE.SphereGeometry(0.035, 8, 4);
  tip.translate(0, 0.07, -0.19);
  return weld([tube, tip]);
}

/**
 * The animal's head: an egg of a skull, longer than it is wide, with a shorter
 * and narrower muzzle pushed out of the front of it. Eyes and prongs are seated
 * on the skull's surface by the rig, so its radii are the numbers to move
 * together if the shape ever changes.
 */
function makeAnimalHead(): THREE.BufferGeometry {
  const skull = new THREE.SphereGeometry(1, 16, 10).scale(0.11, 0.1, 0.13);
  const muzzle = new THREE.CapsuleGeometry(0.06, 0.08, 2, 8);
  muzzle.rotateX(Math.PI / 2);
  muzzle.scale(1.05, 0.85, 1);
  muzzle.translate(0, -0.035, 0.14);
  return weld([skull, muzzle]);
}

function makeShared(): SharedGeometry {
  // The belt is an open band a hair wider than the waist of the lathe, squashed
  // the same way, so it hugs the cloth instead of cutting through it.
  const belt = new THREE.CylinderGeometry(0.215, 0.22, 0.06, 20, 1, true);
  belt.scale(1, 1, 0.62);
  // A boot is a capsule lying along the foot, pressed flat: a rounded toe and
  // heel from the manager camera, and no seam anywhere at eye level.
  const boot = new THREE.CapsuleGeometry(0.072, 0.1, 2, 10);
  boot.rotateX(Math.PI / 2);
  boot.scale(1.05, 0.68, 1);
  const animalBody = new THREE.CapsuleGeometry(0.19, 0.5, 5, 16);
  animalBody.rotateX(Math.PI / 2);
  animalBody.scale(1.08, 0.95, 1);
  // The ear is one prong flattened front-to-back; it grows upward from its
  // origin, so an ear rotates about its root.
  const ear = new THREE.CapsuleGeometry(0.03, 0.2, 2, 8);
  ear.translate(0, 0.14, 0);
  ear.scale(1, 1, 0.45);
  return {
    torso: makeTorso(),
    belt,
    neck: makeNeck(),
    // A sphere drawn a touch tall. A rounded box with a radius this generous is
    // the same shape for six times the triangles, which is where the first cut
    // of this rig spent most of its budget.
    head: new THREE.SphereGeometry(0.13, 20, 12).scale(1, 1.06, 1),
    hair: makeHair(false),
    hairLong: makeHair(true),
    eye: new THREE.SphereGeometry(0.022, 8, 6),
    // Three rings on the caps: the top of a leg is inside the torso and the
    // bottom inside a boot, so the fourth was paid for and never seen.
    leg: limb(0.075, SETTLER_LEG, 12, 3),
    boot,
    arm: limb(0.065, 0.6, 12, 3),
    hand: new THREE.SphereGeometry(0.07, 8, 6),
    rifleStock: makeRifleStock(),
    rifleAction: makeRifleAction(),
    club: makeClub(),
    animalBody,
    animalNeck: makeAnimalNeck(),
    animalHead: makeAnimalHead(),
    // A bead a fifth the size of a settler's eye on a body that is drawn at
    // most a cell across; the settler's eight-by-six would be forty per cent
    // more triangles for a dot.
    animalEye: new THREE.SphereGeometry(0.022, 6, 4),
    animalTail: makeTail(),
    animalLeg: limb(0.05, ANIMAL_LEG_LENGTH, 10, 2),
    animalAntler: makeAntler(),
    animalEar: ear,
    // A band round the neck. The only thing on the map that separates a tamed
    // mossback from the wild one grazing beside it, so it is a ring of solid
    // colour rather than a tint the isometric camera would lose in shadow.
    // Ten round the tube and twenty-four round the ring: sixteen by thirty-two
    // was a thousand triangles on a strap, and with the tag hung off it a
    // bonded mossback stood seven hundred over the animal budget.
    animalCollar: new THREE.TorusGeometry(0.15, 0.035, 10, 24).rotateX(Math.PI / 2),
    // A little lozenge hung off the collar: the tell that this one is somebody's
    // rather than the colony's. A shape rather than a second collar colour,
    // because the collar already says something — pale gold when there is
    // something to collect — and two meanings on one surface is one meaning lost.
    petTag: new THREE.SphereGeometry(0.07, 10, 6).scale(0.8, 1.2, 0.45),
    // A downward cone, the universal "this one" marker in a colony sim.
    huntMark: new THREE.ConeGeometry(0.16, 0.28, 24).rotateX(Math.PI),
    // The caravan's load: one bundle high on the back and a few crates set down
    // in the grass. A trader who is just a differently-tinted settler is a thing
    // the player has to be told about; a pile of freight is a thing they see.
    pack: new RoundedBoxGeometry(0.38, 0.4, 0.22, 2, 0.06),
    crate: new RoundedBoxGeometry(0.36, 0.3, 0.36, 1, 0.03),
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
