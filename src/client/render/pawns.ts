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
import type { AnimalKind, Pawn, World } from '../../sim/types';

/**
 * How far a four-legged body swings a leg. The leg's length is the species'
 * own — a hare crouches on legs a third as long as a mossback's — and lives in
 * its `SpeciesModel`, so the stride is worked out from the leg that is drawn.
 */
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
 * A hide's variation within a herd: a shade lighter or darker, a touch richer
 * or greyer, and the hue held. `pawnTint` is for cloth and turns a colour up to
 * a fifth of the way round the wheel on the seed, which is fine for dye and
 * wrong for fur: run through it the fenwolf's cold grey came out lavender, the
 * mossback's olive came out green and a pen of one species was a paintbox.
 * Each animal keeps its species' hue to within a couple of degrees, and what
 * varies is what varies in a real herd.
 */
export function hideTint(base: number, seed: number): THREE.Color {
  const c = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    hsl.h + ((seed % 7) - 3) * 0.004,
    hsl.s + (((seed >> 3) % 5) - 2) * 0.02,
    Math.max(0.15, Math.min(0.8, hsl.l + (((seed >> 6) % 7) - 3) * 0.025)),
  );
  return c;
}

/** The four colours an animal is painted in, named so a model can ask for one. */
type Tone = 'hide' | 'dark' | 'pale' | 'horn';
type Vec3 = readonly [number, number, number];

/** Something rooted on the skull — an antler or an ear — one side, mirrored for the other. */
interface Crown {
  geometry: THREE.BufferGeometry;
  at: Vec3;
  /** Lean outward from the skull's midline, in radians; the far side leans the other way. */
  roll: number;
  /** Rake back over the skull. */
  pitch: number;
  tone: Tone;
  /** Antlers branch to one side and are mirrored across; ears are symmetric already. */
  mirrored: boolean;
}

/**
 * One species' body: its geometry, shared across every animal of the kind, and
 * the places the rig hangs the parts that move. Everything is laid out in body
 * space, where a mossback is a unit tall at the withers, and the rig scales
 * the whole thing by the species' `size` — so a hare is a hare-sized version
 * of these numbers, not a different set.
 *
 * Only the neck, the head and the legs are their own meshes, because only they
 * move. Everything else in the coat's colour — a hump, a ruff, the haunches,
 * a tail — is welded into `body`, and the patches in another tone sit still
 * in `markings`.
 */
interface SpeciesModel {
  body: THREE.BufferGeometry;
  /** A dorsal stripe, a pale belly, a white scut: still, and not the coat's colour. */
  markings: { geometry: THREE.BufferGeometry; tone: Tone }[];
  neck: THREE.BufferGeometry;
  neckAt: Vec3;
  neckPitch: number;
  /** Where along the neck the collar rings it, in the neck's own frame. */
  collarAt: number;
  /**
   * Where the hunt marker's point hovers, in body space: a hand's width over the
   * back, clear of whatever the species carries up there. One height for all four
   * put the point half a body above a hare and among a mossback's antlers.
   */
  markAt: number;
  head: THREE.BufferGeometry;
  headAt: Vec3;
  /** On the skull's surface, one side; mirrored for the other. */
  eyeAt: Vec3;
  noseAt: Vec3;
  crowns: Crown[];
  leg: THREE.BufferGeometry;
  hoof: THREE.BufferGeometry;
  legLength: number;
  /** Fore left, fore right, hind left, hind right — `update()` pairs them diagonally by index. */
  legsAt: readonly (readonly [number, number])[];
}

/** Every buffer a species owns, for the teardown. */
function speciesGeometries(m: SpeciesModel): THREE.BufferGeometry[] {
  return [
    m.body,
    ...m.markings.map((k) => k.geometry),
    m.neck,
    m.head,
    ...m.crowns.map((c) => c.geometry),
    m.leg,
    m.hoof,
  ];
}

/**
 * An animal: a body in its species' shape, a neck, a head, four legs, and a
 * collar, a tag and a hunt mark that show when the sim says so.
 *
 * Four species used to share one silhouette at four scales — a capsule, four
 * tubes, a round head and two prongs — and from the manager camera every one of
 * them was a blob with legs that only size told apart. Each now has its own
 * `SpeciesModel`: a mossback is a hump, a long muzzle and branching antlers; a
 * dunhare is a crouched egg under ears taller than its head; a brambletail is
 * low and long behind a brush of a tail; a fenwolf carries its head low over a
 * ruff. The rig is the same code for all of them, reading the model for what
 * to hang where.
 *
 * The whole body is scaled by the species' `size`, so one set of numbers covers
 * something the size of a deer and something the size of a hare. Legs swing
 * off the same `animPhase` the settlers use, which the *simulation* advances —
 * so a running animal is mid-stride in both views, and freezes on pause with
 * everyone else.
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
  private readonly legLength: number;
  /** The species' own marker height, in body space, so a calf's marker comes down with it. */
  private readonly markAt: number;
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
    const model = shared.animals[kind];
    this.size = def.size;
    this.legLength = model.legLength;
    this.markAt = model.markAt;

    const hide = hideTint(ANIMAL_COLOR[kind], pawn.colorSeed);
    const hideMat = new THREE.MeshStandardMaterial({ color: hide, roughness: 0.9 });
    // Hooves, ears, a stripe down the spine: the coat's own colour gone darker,
    // which is how those parts differ on the animal and not a second dye.
    const darkMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(hide).offsetHSL(0, -0.05, -0.14),
      roughness: 0.85,
    });
    // The belly, the chest, the scut: lighter and greyer, the way an underside
    // is. Kept a step short of white so the hare stays a hare and not a lamp.
    const paleMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(hide).offsetHSL(0, -0.15, 0.26),
      roughness: 0.92,
    });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x8f7e62, roughness: 0.7 });
    // Low roughness on the eye and the nose, so both take a highlight from the
    // sun: the glint is what makes a bead read as an eye rather than a dot.
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 0.35 });
    this.mats.push(hideMat, darkMat, paleMat, hornMat, eyeMat);
    const tone = (t: Tone): THREE.Material =>
      t === 'hide' ? hideMat : t === 'dark' ? darkMat : t === 'pale' ? paleMat : hornMat;

    const barrel = new THREE.Mesh(model.body, hideMat);
    barrel.name = 'body';
    const neck = new THREE.Mesh(model.neck, hideMat);
    neck.name = 'neck';
    neck.position.set(...model.neckAt);
    // A positive pitch carries the top of the neck toward +Z, into the skull.
    // It leaned the other way for a long time and its top hung in the air a
    // hand's width behind the head it was meant to hold up.
    neck.rotation.x = model.neckPitch;
    this.head = new THREE.Mesh(model.head, hideMat);
    this.head.name = 'head';
    this.head.position.set(...model.headAt);

    for (const side of [-1, 1] as const) {
      const eye = new THREE.Mesh(shared.animalEye, eyeMat);
      eye.position.set(side * model.eyeAt[0], model.eyeAt[1], model.eyeAt[2]);
      this.head.add(eye);
    }
    const nose = new THREE.Mesh(shared.animalNose, eyeMat);
    nose.position.set(...model.noseAt);
    this.head.add(nose);

    // Antlers and ears ride the head, so they dip when it grazes.
    for (const crown of model.crowns) {
      for (const side of [-1, 1] as const) {
        const prong = new THREE.Mesh(crown.geometry, tone(crown.tone));
        prong.position.set(side * crown.at[0], crown.at[1], crown.at[2]);
        prong.rotation.set(crown.pitch, 0, side * -crown.roll);
        if (crown.mirrored) prong.scale.x = side;
        prong.castShadow = true;
        this.head.add(prong);
      }
    }

    for (const m of [barrel, neck, this.head]) {
      m.castShadow = true;
      this.body.add(m);
    }
    for (const marking of model.markings) {
      const patch = new THREE.Mesh(marking.geometry, tone(marking.tone));
      patch.castShadow = true;
      this.body.add(patch);
    }

    for (const [lx, lz] of model.legsAt) {
      const leg = new THREE.Mesh(model.leg, hideMat);
      leg.name = 'leg';
      leg.position.set(lx, model.legLength, lz);
      leg.castShadow = true;
      // The hoof rides the leg, so it swings from the hip with it. Its
      // geometry stands on its own origin, so it is set at the leg's foot and
      // its sole is the leg's sole.
      const hoof = new THREE.Mesh(model.hoof, darkMat);
      hoof.name = 'hoof';
      hoof.position.y = -model.legLength;
      hoof.castShadow = true;
      leg.add(hoof);
      this.legs.push(leg);
      this.body.add(leg);
    }

    this.body.scale.setScalar(def.size);
    this.group.add(this.body);

    // Drawn on both sides: the marker is a hollow funnel, and half of what the
    // camera sees of it at any moment is its inner wall.
    const markMat = new THREE.MeshBasicMaterial({ color: 0xd8563f, side: THREE.DoubleSide });
    this.mats.push(markMat);
    this.mark = new THREE.Mesh(shared.huntMark, markMat);
    this.mark.name = 'mark';
    // The geometry's point is its origin, so this is where the point hangs: over
    // the species' own back, and lower on a small animal than on a large one.
    this.mark.position.y = this.markAt * def.size;
    this.mark.visible = false;
    this.group.add(this.mark);

    const collarMat = new THREE.MeshLambertMaterial({ color: 0xc9553a });
    this.mats.push(collarMat);
    this.collar = new THREE.Mesh(shared.animalCollar, collarMat);
    this.collar.name = 'collar';
    // On the neck, square to it, so it rings the neck the way a collar does
    // rather than lying level across a sloping one.
    this.collar.position.set(0, model.collarAt, 0);
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
      this.mark.position.y = this.markAt * this.size * grow;
      this.walkPhase = phaseScale(this.legLength * this.size * grow, ANIMAL_SWING);
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
  /** Each species' body and where its moving parts hang, built once. */
  animals: Record<AnimalKind, SpeciesModel>;
  animalEye: THREE.BufferGeometry;
  animalNose: THREE.BufferGeometry;
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
 * An animal's neck: tapered from the chest to the skull, centred on its own
 * length and domed at the top, so its top centre sits at `length / 2 + topR`
 * along +Y — the number the rig places the head against. The head pitches
 * through more than a radian when it grazes, and no straight tube can keep its
 * top rim inside a skull that swings that far; what pokes out of the nape at
 * the bottom of a graze is a rounded end of neck, which reads as the nape,
 * rather than a flat disc, which read as a cut.
 */
function makeAnimalNeck(baseR: number, topR: number, length: number): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [new THREE.Vector2(baseR, -length / 2), new THREE.Vector2(topR, length / 2)];
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    profile.push(new THREE.Vector2(topR * Math.cos(a), length / 2 + topR * Math.sin(a)));
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
 * The mossback's antler: a beam with three tines branching off it, all growing
 * up from the root so the whole thing rakes about the skull. One tine was a
 * fork, and a fork on a head that size read as a second pair of ears; three,
 * each leaning out a little less than the one below it and spread fore and
 * aft, is the branching that says antler at eleven cells up. The tines lean
 * to +X; the rig mirrors the whole thing for the other side.
 */
function makeAntler(): THREE.BufferGeometry {
  const beam = new THREE.CapsuleGeometry(0.02, 0.24, 1, 7);
  beam.translate(0, 0.14, 0);
  const tines: THREE.BufferGeometry[] = [];
  for (const [height, lean, spread] of [
    [0.09, -1.0, 0.3],
    [0.16, -0.8, -0.25],
    [0.23, -0.6, 0.1],
  ] as const) {
    const tine = new THREE.CapsuleGeometry(0.013, 0.08, 1, 6);
    tine.translate(0, 0.053, 0);
    tine.rotateZ(lean);
    tine.rotateX(spread);
    tine.translate(0, height, 0);
    tines.push(tine);
  }
  return weld([beam, ...tines]);
}

/**
 * An ear that stands up: a capsule flattened front-to-back, rooted at its
 * origin so it rotates about where it meets the skull. The hare's, at more
 * than three times the length of its skull, is what makes it a hare.
 */
function makeEar(radius: number, length: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, length - 2 * radius, 1, 7);
  g.translate(0, length / 2, 0);
  g.scale(1, 1, 0.45);
  return g;
}

/**
 * A pricked ear: a cone flattened front-to-back, rooted at its origin. The
 * point is the whole difference between a fox's ear and a hare's.
 */
function makePrickEar(radius: number, height: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, 7);
  g.translate(0, height / 2, 0);
  g.scale(1, 1, 0.45);
  return g;
}

/**
 * A bushy tail: an ellipsoid with its root at the origin, growing back along
 * -Z, so the rig can rake it up over a brambletail's rump or hang it low off a
 * wolf's. The thin tube it replaces was a stick, and a stick behind a body the
 * size of a brambletail's was nothing at all from the manager camera.
 */
function makeBrush(radius: number, length: number): THREE.BufferGeometry {
  const half = length / 2;
  return new THREE.SphereGeometry(1, 10, 7).scale(radius, radius, half).translate(0, 0, -half * 0.8);
}

/**
 * A muzzle pushed out of the front of a skull along +Z: a lathe that tapers
 * from `baseR`, buried in the skull, to `tipR` at the nose, with a domed end.
 * Long and blunt on a grazer, short and pointed on a hunter — the taper is
 * most of what says which from the side.
 */
function makeMuzzle(baseR: number, tipR: number, length: number): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(baseR, 0),
    new THREE.Vector2((baseR + tipR) * 0.52, length * 0.5),
    new THREE.Vector2(tipR, length),
  ];
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    profile.push(new THREE.Vector2(tipR * Math.cos(a), length + tipR * Math.sin(a)));
  }
  return new THREE.LatheGeometry(profile, 10).rotateX(Math.PI / 2);
}

/**
 * An animal's head: an egg of a skull with the given half-extents and a muzzle
 * out of the front of it, set `drop` below the skull's centre line. Eyes and
 * crowns are seated on the skull's surface by the species model, so its radii
 * are the numbers to move together if the shape ever changes.
 */
function makeAnimalHead(
  skull: Vec3,
  muzzle: { baseR: number; tipR: number; length: number; drop: number },
): THREE.BufferGeometry {
  const egg = new THREE.SphereGeometry(1, 14, 9).scale(...skull);
  const snout = makeMuzzle(muzzle.baseR, muzzle.tipR, muzzle.length);
  snout.translate(0, -muzzle.drop, skull[2] * 0.55);
  return weld([egg, snout]);
}

/**
 * A hoof or a paw: a flattened sphere that stands on its own origin, so it is
 * set at the foot of a leg and its sole is the leg's sole. Wider than the leg
 * it caps, which is what makes it a foot rather than the leg's end.
 */
function makeHoof(radius: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(radius, 7, 4).scale(1.15, 0.55, 1.25).translate(0, radius * 0.55, 0);
}

/** A barrel lying along Z: the trunk of every four-legged body here. */
function makeBarrel(radius: number, length: number, caps: number, radial: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(radius, length, caps, radial).rotateX(Math.PI / 2);
}

/** An ellipsoid with the given half-extents, set down at a point. */
function blob(radii: Vec3, at: Vec3, widthSegs = 10, heightSegs = 7): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, widthSegs, heightSegs).scale(...radii).translate(...at);
}

/**
 * The mossback: think elk. A heavy barrel with a hump at the withers, a thick
 * short neck holding a long blunt muzzle up high, antlers branching three
 * tines a side, a flag of a tail, and a darker stripe down the spine — the
 * stripe rides just proud of the back, a ridge of coarser hair, from rump to
 * hump. Its legs are the longest and the thickest here, and end in hooves.
 */
function makeMossback(): SpeciesModel {
  const barrel = makeBarrel(0.22, 0.46, 4, 14).scale(1.05, 0.95, 1).translate(0, 0.66, 0);
  const hump = blob([0.2, 0.17, 0.24], [0, 0.78, 0.18]);
  const spine = new THREE.TubeGeometry(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0.8, -0.42),
      new THREE.Vector3(0, 1.02, 0.1),
      new THREE.Vector3(0, 0.92, 0.36),
    ),
    7,
    0.04,
    5,
    false,
  ).scale(1.5, 1, 1);
  // Short and hanging, rooted just under the rump's skin.
  const flag = new THREE.CapsuleGeometry(0.035, 0.03, 1, 7).translate(0, -0.05, 0).rotateX(0.6).translate(0, 0.77, -0.4);
  return {
    body: weld([barrel, hump]),
    markings: [
      { geometry: spine, tone: 'dark' },
      { geometry: flag, tone: 'dark' },
    ],
    neck: makeAnimalNeck(0.16, 0.12, 0.3),
    neckAt: [0, 0.84, 0.36],
    neckPitch: 0.7,
    collarAt: 0.08,
    // Over the hump, which is the highest the back gets; the antlers are higher
    // still but they are a body-length forward of where the marker hangs.
    markAt: 1.18,
    head: makeAnimalHead([0.12, 0.11, 0.14], { baseR: 0.085, tipR: 0.05, length: 0.22, drop: 0.03 }),
    headAt: [0, 1.06, 0.56],
    eyeAt: [0.085, 0.035, 0.09],
    noseAt: [0, -0.015, 0.325],
    crowns: [
      { geometry: makeAntler(), at: [0.06, 0.09, -0.02], roll: 0.5, pitch: -0.35, tone: 'horn', mirrored: true },
      // Out sideways under the antlers, the way an elk's are.
      { geometry: makeEar(0.028, 0.11), at: [0.09, 0.06, -0.03], roll: 0.95, pitch: -0.1, tone: 'dark', mirrored: false },
    ],
    leg: limb(0.062, 0.6, 9, 1),
    hoof: makeHoof(0.07),
    legLength: 0.6,
    legsAt: [
      [-0.15, 0.3],
      [0.15, 0.3],
      [-0.15, -0.3],
      [0.15, -0.3],
    ],
  };
}

/**
 * The dunhare: a crouched egg, tipped so the rump stands higher than the
 * shoulders, on legs a third the length of a mossback's, with the hind pair
 * folded into a haunch on each side; ears taller than the head; a white scut;
 * a pale belly. It read as a small white dog when it was the shared body at
 * half size — the body was level, the ears were sticks and the coat had been
 * tinted to nothing — and the crouch is the first thing that fixes that.
 */
function makeDunhare(): SpeciesModel {
  // Rotated about X before it is set down: a positive pitch lifts the -Z end.
  const egg = new THREE.SphereGeometry(1, 12, 9).scale(0.22, 0.24, 0.3).rotateX(0.3).translate(0, 0.42, 0);
  const haunchL = blob([0.1, 0.13, 0.15], [-0.16, 0.3, -0.17]);
  const haunchR = blob([0.1, 0.13, 0.15], [0.16, 0.3, -0.17]);
  // The same egg, a shade smaller and set a shade higher, so only the crown of
  // it clears the coat: a dark saddle from the shoulders back over the rump.
  // The manager camera sees the top of an animal and nothing else, and a sand
  // hare on sand grass at that angle was a pale lump with ears — the darker
  // back is the one surface that camera can read, and it is the coat's own
  // colour gone deeper, which is what a hare's back actually is.
  const saddle = new THREE.SphereGeometry(1, 12, 9).scale(0.205, 0.235, 0.285).rotateX(0.3).translate(0, 0.465, 0);
  return {
    body: weld([egg, haunchL, haunchR]),
    markings: [
      { geometry: saddle, tone: 'dark' },
      { geometry: blob([0.2, 0.16, 0.26], [0, 0.33, 0.04]), tone: 'pale' },
      { geometry: new THREE.SphereGeometry(0.065, 8, 6).translate(0, 0.55, -0.31), tone: 'pale' },
    ],
    neck: makeAnimalNeck(0.09, 0.075, 0.14),
    neckAt: [0, 0.5, 0.26],
    neckPitch: 0.6,
    collarAt: 0,
    // Low: a hare stands a third of a mossback, and a marker hung at a mossback's
    // height over one floated half a body clear of it with nothing in between.
    markAt: 0.88,
    head: makeAnimalHead([0.1, 0.1, 0.12], { baseR: 0.07, tipR: 0.045, length: 0.1, drop: 0.02 }),
    headAt: [0, 0.62, 0.36],
    eyeAt: [0.075, 0.03, 0.075],
    noseAt: [0, -0.01, 0.19],
    crowns: [
      // Dark, and leaned further back and out than they stood. Straight up, an
      // ear this thin is edge-on to the manager camera and disappears — which
      // took the hare's one unmistakable feature away in the view the player
      // spends their time in. Raked, each ear lays a dark stroke beside the
      // skull that reads from directly overhead.
      { geometry: makeEar(0.03, 0.34), at: [0.05, 0.07, -0.03], roll: 0.42, pitch: -0.42, tone: 'dark', mirrored: false },
    ],
    leg: limb(0.04, 0.34, 9, 1),
    hoof: makeHoof(0.045),
    legLength: 0.34,
    legsAt: [
      [-0.12, 0.2],
      [0.12, 0.2],
      [-0.15, -0.16],
      [0.15, -0.16],
    ],
  };
}

/**
 * The brambletail: think fox. A low, long barrel; a pointed muzzle under
 * pricked ears; a pale chest; and the brush it is named for, raked up over
 * the rump with a pale tip — a vertical stroke where every other silhouette
 * on the map is horizontal, which at three tenths of a mossback is the whole
 * reason anyone can pick it out of the grass.
 */
function makeBrambletail(): SpeciesModel {
  const barrel = makeBarrel(0.14, 0.62, 3, 12).translate(0, 0.45, 0);
  const brush = makeBrush(0.09, 0.48).rotateX(1.0).translate(0, 0.5, -0.42);
  return {
    body: weld([barrel, brush]),
    markings: [
      { geometry: blob([0.11, 0.1, 0.14], [0, 0.38, 0.3]), tone: 'pale' },
      { geometry: new THREE.SphereGeometry(0.055, 8, 5).translate(0, 0.836, -0.636), tone: 'pale' },
    ],
    neck: makeAnimalNeck(0.09, 0.07, 0.14),
    neckAt: [0, 0.56, 0.42],
    neckPitch: 0.7,
    collarAt: 0.02,
    // Just over the brush, which stands higher than this animal's back does.
    markAt: 0.95,
    head: makeAnimalHead([0.095, 0.09, 0.11], { baseR: 0.065, tipR: 0.028, length: 0.15, drop: 0.02 }),
    headAt: [0, 0.68, 0.53],
    eyeAt: [0.07, 0.03, 0.07],
    noseAt: [0, -0.01, 0.227],
    crowns: [
      { geometry: makePrickEar(0.042, 0.11), at: [0.06, 0.07, -0.02], roll: 0.35, pitch: -0.1, tone: 'dark', mirrored: false },
    ],
    leg: limb(0.04, 0.45, 9, 1),
    hoof: makeHoof(0.045),
    legLength: 0.45,
    legsAt: [
      [-0.1, 0.27],
      [0.1, 0.27],
      [-0.1, -0.27],
      [0.1, -0.27],
    ],
  };
}

/**
 * The fenwolf: the hunter. It carries its head low and forward, which is most
 * of why a wolf reads as a wolf at any distance — the silhouette is a
 * horizontal line where a grazer's is a vertical one — out of a thick ruff at
 * the base of the neck; a pointed muzzle under pricked ears; a bushy tail held
 * low; a paler belly under a grey-brown coat.
 */
function makeFenwolf(): SpeciesModel {
  const barrel = makeBarrel(0.18, 0.5, 4, 14).scale(1, 0.95, 1).translate(0, 0.6, 0);
  const ruff = blob([0.22, 0.2, 0.18], [0, 0.66, 0.3], 12, 8);
  const brush = makeBrush(0.075, 0.48).rotateX(-0.5).translate(0, 0.6, -0.4);
  return {
    body: weld([barrel, ruff, brush]),
    markings: [
      { geometry: blob([0.15, 0.13, 0.3], [0, 0.5, 0.02]), tone: 'pale' },
      { geometry: new THREE.SphereGeometry(0.05, 8, 5).translate(0, 0.408, -0.752), tone: 'dark' },
    ],
    neck: makeAnimalNeck(0.13, 0.1, 0.24),
    // Pitched nearly flat, so the neck comes down with the head: pitched
    // steeper from the same root, its top cleared the back of the lowered
    // skull and hung in the air behind the ears.
    neckAt: [0, 0.61, 0.464],
    neckPitch: 1.1,
    collarAt: 0.06,
    // Over the ruff, the highest point on a wolf that carries its head low.
    markAt: 1,
    head: makeAnimalHead([0.11, 0.1, 0.13], { baseR: 0.075, tipR: 0.035, length: 0.17, drop: 0.025 }),
    headAt: [0, 0.72, 0.68],
    eyeAt: [0.08, 0.03, 0.085],
    noseAt: [0, -0.012, 0.26],
    crowns: [
      { geometry: makePrickEar(0.045, 0.12), at: [0.07, 0.07, -0.03], roll: 0.3, pitch: -0.15, tone: 'dark', mirrored: false },
    ],
    leg: limb(0.05, 0.58, 9, 1),
    hoof: makeHoof(0.055),
    legLength: 0.58,
    legsAt: [
      [-0.13, 0.28],
      [0.13, 0.28],
      [-0.13, -0.28],
      [0.13, -0.28],
    ],
  };
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
    animals: {
      mossback: makeMossback(),
      dunhare: makeDunhare(),
      brambletail: makeBrambletail(),
      fenwolf: makeFenwolf(),
    },
    // A bead a fifth the size of a settler's eye on a body that is drawn at
    // most a cell across; the settler's eight-by-six would be forty per cent
    // more triangles for a dot.
    animalEye: new THREE.SphereGeometry(0.022, 6, 4),
    // A dark bead on the end of the muzzle, in the eye's material so it takes
    // the same glint. It is the one thing that marks which end of a lowered
    // head is the front from the manager camera.
    animalNose: new THREE.SphereGeometry(0.03, 6, 4),
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
    // A downward chevron, the universal "this one" marker in a colony sim: a
    // narrow open funnel with its point at its own origin, so the rig hangs the
    // point over the back and the marker grows upward from there.
    //
    // It was a capped cone a third of a cell across floating a body-length over
    // the animal, and both halves of that were wrong. From the manager camera the
    // cap was a solid red disc wider than the hare under it; in first person, at
    // the range a settler actually stands from a marked animal, it filled the
    // middle of the screen while the animal itself sat below the frame. Open, and
    // a third narrower, it reads as an arrowhead pointing at something rather
    // than a lid over it — and the whole marker now costs twenty triangles where
    // the cap alone cost twenty-four.
    huntMark: new THREE.ConeGeometry(0.11, 0.26, 20, 1, true).rotateX(Math.PI).translate(0, 0.13, 0),
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
    const { animals, ...single } = this.shared;
    for (const g of Object.values(single)) g.dispose();
    for (const model of Object.values(animals)) for (const g of speciesGeometries(model)) g.dispose();
  }
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
