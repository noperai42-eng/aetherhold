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
 * The radius the one shared collar buffer is cut to — a mossback's throat, the
 * widest neck on the map. Every other species wears the same buffer scaled by
 * its own `collarR` over this, so the ring is a strap on the neck rather than
 * a hoop around it.
 */
const COLLAR_R = 0.15;

/**
 * How far over the top of an animal the hunt marker's point hangs — in world
 * units, which is the whole of the fix.
 *
 * The height was a number in the animal's own body space, multiplied by the
 * species' size on the way out, so the air under the marker shrank with the
 * animal: a mossback got twenty-three centimetres of it and a brambletail got
 * under three. On the small species the marker did not hover over the hide, it
 * lay on it — and a red-orange shape lying on a grey shoulder is not an order
 * the player gave, it is a wound the animal took. The clearance is the same for
 * every species now, and for a calf too: the marker is drawn for the player and
 * not for the world, so it is sized and hung in the player's units.
 *
 * What it is measured from moved as well. It used to be a height each species
 * declared, and all four declared the crown of the barrel — which on the
 * mossback leaves the antlers, the ears and the whole head above it, so 0.24 of
 * air over the back put the marker's point at 1.19 and the mossback's own
 * silhouette reaches 1.36. The marker sat on the neck and read as a collar. The
 * rig measures the animal it has just built instead, so a species that grows a
 * taller crown gets the right clearance without anyone remembering to retype a
 * number; 0.16 is what that leaves as air, close enough that the eye joins the
 * marker to the animal and clear of every head on the map.
 */
const MARK_CLEARANCE = 0.16;

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
 * Where the sleeve ends and where the hand hangs below it.
 *
 * The arm was one 0.6 tube with the hand set three centimetres short of its
 * tip, and the palm was narrower across than the sleeve: the whole hand lived
 * inside the cloth and all that came out of the end was the last centimetre of
 * a sphere. From the close overhead camera — the nearest look the game takes at
 * a colonist — a settler's free arm was a plain blue tube ending bluntly at the
 * wrist. So the cloth stops at the wrist and the hand hangs below it: the arm
 * ends in skin, in silhouette as well as in colour, and the hand is deeper
 * front to back than the sleeve so it also breaks the outline.
 */
const SLEEVE = 0.53;
const WRIST_Y = -0.575;

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
    this.armL.name = 'arm';
    this.armR.name = 'arm';

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

    // Hands and boots ride their limbs, so they swing from the same pivot. The
    // hand is cut with its thumb toward -X, which is the midline for the right
    // arm; the left wears the same buffer mirrored, so both thumbs face in.
    for (const [side, arm] of [
      [-1, this.armL],
      [1, this.armR],
    ] as const) {
      const hand = new THREE.Mesh(shared.hand, skinMat);
      hand.name = 'hand';
      hand.position.y = WRIST_Y;
      hand.scale.x = side;
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
      if (this.weapon.children[1]) this.weapon.children[1].name = 'action';
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
 *
 * The colour space is named because it has to be. `ColorManagement` is on and
 * the working space is linear-sRGB, so `getHSL` and `setHSL` with no space
 * argument read and write HSL over linear channels — a scale on which the
 * lightness of a mid brown is about a tenth rather than about a third. Every
 * number below was picked by eye against an sRGB swatch, and read in the
 * working space they meant something else entirely: the 0.15 guard, put here
 * so no hide could go to mud, sat above five of the mossback's seven lightness
 * steps and six of the fenwolf's and clamped them all to one value, so a herd
 * of mossbacks was a herd of one colour and the darkest coat on the map was
 * lighter than the mid one. Named sRGB, the guard is what it was written to be
 * — a floor nothing reaches — and the seven steps come back. Across every seed
 * the mossback's hide now runs 0.064 to 0.187 of linear luminance and the
 * fenwolf's 0.057 to 0.157, both close to three to one, and the seven lightness
 * steps taken with the other bits held stand 2.1 to 2.8 points of L* apart on
 * all four species — where the clamp had held five of the mossback's seven and
 * six of the fenwolf's at the identical colour, 0.00 apart.
 */
export function hideTint(base: number, seed: number): THREE.Color {
  const c = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(
    hsl.h + ((seed % 7) - 3) * 0.004,
    hsl.s + (((seed >> 3) % 5) - 2) * 0.02,
    Math.max(0.15, Math.min(0.8, hsl.l + (((seed >> 6) % 7) - 3) * 0.025)),
    THREE.SRGBColorSpace,
  );
  return c;
}

/**
 * A hide moved off its own colour without moving its hue, in the space the
 * colour was picked in. `Color.offsetHSL` cannot be told a space and so does
 * this arithmetic over linear channels, which is the same bug `hideTint` had
 * and had it worse: an offset of -0.14 in lightness is a step on a dark coat in
 * sRGB and a fall off the bottom of it in linear, and that is what painted a
 * mossback's four hooves as solid black caps with no form in them.
 */
function toneShift(base: THREE.Color, ds: number, dl: number): THREE.Color {
  const c = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  return c.setHSL(
    hsl.h,
    THREE.MathUtils.clamp(hsl.s + ds, 0, 1),
    THREE.MathUtils.clamp(hsl.l + dl, 0, 1),
    THREE.SRGBColorSpace,
  );
}

/** Rec. 709 luminance: the light a colour returns, which is what its value is. */
function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The luminance at which a surface stops being a colour and starts being a
 * hole in the world — the same floor the building materials are held to. Below
 * it the sun, the sky and the ground bounce all land in the same few codes and
 * nothing about the shape survives.
 */
const SILHOUETTE = 0.025;

/** CIE L*, on the branch that applies above the floor: equal steps look equal. */
const lstar = (y: number): number => 116 * Math.cbrt(y) - 16;

/**
 * The coat taken a fixed share of the way down from itself to the floor, in the
 * scale on which a step is a step.
 *
 * A fixed offset cannot do this job. The four species are two and a half stops
 * apart before the seed touches them, and a pale hare has forty-six points of
 * L* between its coat and the floor where the darkest fenwolf has nine and a
 * half of it. Take the same eight points off both and the hare's saddle is a shallow
 * suggestion while the wolf's hocks are through the floor — which, measured
 * over every seed, is exactly what the old offsets did: `dark` bottomed out at
 * 0.0065 of luminance, a quarter of the floor, on all four kinds.
 *
 * Sharing out the room each coat actually has fixes both ends at once and needs
 * no per-species tuning, so a fifth species gets it right for free. A scalar on
 * the linear channels is what moves a colour along that scale without touching
 * its hue or its saturation, and the scalar is the ratio of the two luminances.
 * Measured over all four species and all 4096 seeds, at the shares below:
 * `dark` never falls under 0.0295 and `shade` never under 0.0457 — both clear
 * of the floor — while `shade` stays at least 5.6 points of L* above `dark` and
 * at least 3.1 below the coat, which is the ladder a marking and a hoof need.
 */
function deepen(hide: THREE.Color, share: number): THREE.Color {
  const y = luminance(hide);
  // A coat already on the floor has no room to give and is left where it is,
  // which also keeps the L* arithmetic on the branch it is written for.
  if (y <= SILHOUETTE) return new THREE.Color(hide);
  const fallen = lstar(y) - share * (lstar(y) - lstar(SILHOUETTE));
  return new THREE.Color(hide).multiplyScalar(((fallen + 16) / 116) ** 3 / y);
}

/**
 * The five colours an animal is painted in, named so a model can ask for one.
 *
 * `dark` and `shade` are both the coat gone deeper and they are not the same
 * thing: `dark` is for the parts of an animal that are another substance — a
 * hoof, the back of an ear, the tip of a tail — and `shade` is for a marking in
 * the hide itself, which is the coat and has to look like the coat.
 */
type Tone = 'hide' | 'dark' | 'shade' | 'pale' | 'horn';
type Vec3 = readonly [number, number, number];

/** Something rooted on the skull — an antler or an ear — one side, mirrored for the other. */
interface Crown {
  geometry: THREE.BufferGeometry;
  /**
   * A second surface riding the first in a lighter tone: the inside of an ear.
   * Parented to the prong rather than to the skull, so it rakes and dips with
   * the ear it lines, and so the head still carries exactly one mesh per ear.
   */
  lining?: { geometry: THREE.BufferGeometry; tone: Tone };
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
  /**
   * A saddle over the back, a pale belly, a white scut: still, and not the
   * coat's colour. Each is named for what it is rather than for the tone it is
   * painted in — a mossback's tail and its withers are both deeper than the
   * hide and nothing else about them is alike.
   */
  markings: { geometry: THREE.BufferGeometry; tone: Tone; name: string }[];
  neck: THREE.BufferGeometry;
  neckAt: Vec3;
  neckPitch: number;
  /** Where along the neck the collar rings it, in the neck's own frame. */
  collarAt: number;
  /**
   * How wide that ring is — the neck's own radius where the strap crosses it.
   *
   * One shared torus wide enough for a mossback's throat used to ring all four,
   * and on the three narrower species it was a hoop hanging clear of the neck
   * with daylight all the way round: a hare wore a collar half again the width
   * of the animal's head, touching nothing. The buffer is still shared and the
   * mesh is scaled to this, which thins the strap on a small animal too, the
   * way a small animal's collar actually is.
   */
  collarR: number;
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
    ...m.crowns.flatMap((c) => (c.lining ? [c.lining.geometry] : [])),
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
  /** The top of this animal's silhouette in body space, so a calf's marker comes down with it. */
  private readonly crest: number;
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

    const hide = hideTint(ANIMAL_COLOR[kind], pawn.colorSeed);
    const hideMat = new THREE.MeshStandardMaterial({ color: hide, roughness: 0.9 });
    // Hooves, the backs of ears, the flag of a tail: the coat's own colour gone
    // darker, which is how those parts differ on the animal and not a second dye.
    // Most of the way down to the floor, because these are the deepest thing on
    // the animal and have to read as another substance — but not through it. The
    // four hooves under a mossback come out between 0.030 and 0.040 of luminance
    // depending on the seed, where the old offset ran 0.010 to 0.045 and put
    // eighty-six per cent of its seeds under the floor outright — a scanline
    // across the fenwolf's darkest ear read 13,13,13 out of 255.
    const darkMat = new THREE.MeshStandardMaterial({
      color: deepen(hide, 0.82),
      roughness: 0.85,
    });
    // The markings on the back, which are hide and nothing else: one step deeper
    // than the coat and a touch richer, never greyer. Painted in `darkMat` — the
    // tone a hoof is — the mossback's back marking read at a settler's eye
    // height as a hole burnt through the shoulder rather than as markings, and
    // half of that was the value: a patch four times darker than the hide around
    // it is a thing missing from the animal, not a thing on it. Under a third of
    // the room down, so it stays plainly the coat: 3.1 to 13.8 points of L*
    // under it across every species and seed, deep on a pale hare where there is
    // room for depth and shallow on a dark wolf where there is not.
    const shadeMat = new THREE.MeshStandardMaterial({
      color: toneShift(deepen(hide, 0.3), 0.02, 0),
      roughness: 0.9,
    });
    // The belly, the chest, the scut: lighter and greyer, the way an underside
    // is. Kept a step short of white so the hare stays a hare and not a lamp.
    // This one goes up, so it needs no floor — only the sRGB space its numbers
    // were chosen in, which is the whole of what changed here.
    const paleMat = new THREE.MeshStandardMaterial({
      color: toneShift(hide, -0.15, 0.26),
      roughness: 0.92,
    });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x8f7e62, roughness: 0.7 });
    // Low roughness on the eye and the nose, so both take a highlight from the
    // sun: the glint is what makes a bead read as an eye rather than a dot.
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 0.35 });
    this.mats.push(hideMat, darkMat, shadeMat, paleMat, hornMat, eyeMat);
    const coat: Record<Tone, THREE.Material> = {
      hide: hideMat,
      dark: darkMat,
      shade: shadeMat,
      pale: paleMat,
      horn: hornMat,
    };
    const tone = (t: Tone): THREE.Material => coat[t];

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
        // The pale inside of an ear, seated on the blade's own origin so it
        // needs no second set of angles and cannot drift off the ear it lines.
        if (crown.lining) {
          const inner = new THREE.Mesh(crown.lining.geometry, tone(crown.lining.tone));
          inner.castShadow = true;
          prong.add(inner);
        }
        this.head.add(prong);
      }
    }

    for (const m of [barrel, neck, this.head]) {
      m.castShadow = true;
      this.body.add(m);
    }
    for (const marking of model.markings) {
      const patch = new THREE.Mesh(marking.geometry, tone(marking.tone));
      patch.name = marking.name;
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

    // The top of everything this animal carries, taken off the rig that was
    // just built and before it is scaled, so the number is in body space and a
    // calf's shrinks with it. Measured rather than declared: the species used to
    // name its own marker height and every one of them named the crown of the
    // barrel, which on a mossback is forty-one centimetres below the tips of its
    // antlers — so the marker hung inside the head and read as a red collar.
    // Nothing here is hidden yet; the collar and its tag are hung on the neck
    // below, after this, because `Box3` measures invisible children too.
    this.crest = new THREE.Box3().setFromObject(this.body).max.y;
    this.body.scale.setScalar(def.size);
    this.group.add(this.body);

    // The marker is a hollow funnel and the camera sees both of its walls at
    // once. Drawn double-sided in one flat colour that was fifteen thousand
    // pixels of one value at eye level — the inside and the outside of a cone
    // lit identically is not a cone, it is a hole cut in the frame. Two shells
    // on the one buffer instead: the outer wall in the order's own red and the
    // inner wall, which is what the eye sees down the throat of it, a good deal
    // deeper. Nothing here is lit, so the two values have to be painted.
    const markMat = new THREE.MeshBasicMaterial({ color: 0xd8563f, side: THREE.FrontSide });
    const markInnerMat = new THREE.MeshBasicMaterial({ color: 0x7c2a1c, side: THREE.BackSide });
    this.mats.push(markMat, markInnerMat);
    this.mark = new THREE.Mesh(shared.huntMark, markMat);
    this.mark.name = 'mark';
    const markInner = new THREE.Mesh(shared.huntMark, markInnerMat);
    markInner.name = 'mark-inner';
    this.mark.add(markInner);
    // The geometry's point is its origin, so this is where the point hangs: over
    // the top of the animal's own silhouette, scaled to it, and the same air
    // above that whatever the animal is.
    this.mark.position.y = this.crest * def.size + MARK_CLEARANCE;
    this.mark.visible = false;
    this.group.add(this.mark);

    const collarMat = new THREE.MeshLambertMaterial({ color: 0xc9553a });
    this.mats.push(collarMat);
    this.collar = new THREE.Mesh(shared.animalCollar, collarMat);
    this.collar.name = 'collar';
    // On the neck, square to it, so it rings the neck the way a collar does
    // rather than lying level across a sloping one.
    this.collar.position.set(0, model.collarAt, 0);
    // The buffer is cut to a mossback's throat, so every narrower species wears
    // it scaled down to its own. The tag rides the ring and scales with it,
    // which is what a hare's tag should do anyway.
    this.collar.scale.setScalar(model.collarR / COLLAR_R);
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
      this.mark.position.y = this.crest * this.size * grow + MARK_CLEARANCE;
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
 *
 * The throat is drawn in four rings, not five. The old profile put two of them
 * below the torso's top pole, where the cloth is a fifth of a metre wider than
 * the neck on every meridian, so one of the two was a ring of vertices nothing
 * could ever see; the thirty-two triangles it cost went into rounding the
 * rifle's receiver, which sits in the open under the manager camera.
 */
function makeNeck(): THREE.BufferGeometry {
  const profile = [
    [0.076, -0.07],
    [0.062, 0.02],
    [0.068, 0.06],
    [0.082, 0.09],
    [0.1, 0.12],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(profile, 16);
}

/**
 * A hand: a mitten. A palm narrow across the body and deep front to back, with
 * a thumb standing out of its inner edge and raked forward.
 *
 * It was a sphere, and from the close overhead camera — the one the player
 * frames a settler in — a pale ball on the end of a sleeve is a blob. Nothing
 * at this size can have fingers; what a hand needs is the outline a hand has,
 * and that outline is the thumb. It is cut for the right hand, thumb toward
 * -X, and the rig mirrors it for the left, the way an antler is mirrored: on a
 * body whose arms hang at its sides, both thumbs point at the midline.
 *
 * The palm is a sixth larger than that first one and hangs clear of the cuff
 * (see `SLEEVE`), which is the half of the fix the thumb could not do on its
 * own: a hand the sleeve swallows has no outline to give. Ten meridians rather
 * than eight, because what the sleeve used to hide is now the last thing on the
 * arm and the manager camera looks straight down the length of it — a
 * hexagonal palm on the end of a round sleeve reads as a nut on a bolt.
 */
function makeHand(): THREE.BufferGeometry {
  const palm = new THREE.SphereGeometry(0.072, 10, 6).scale(0.76, 1.14, 1.08);
  // Rooted a fifth of the way into the palm, so no rim of it shows where the
  // two meet, and rolled far enough over that most of its length is width: a
  // thumb held against the hand is a knuckle, and the outline is the point.
  // It grew less than the palm did: it reaches in toward the trouser at rest,
  // and a longer one would spend the idle pose buried in the thigh.
  const thumb = new THREE.CapsuleGeometry(0.021, 0.058, 1, 6)
    .rotateZ(1.05)
    .rotateX(0.3)
    .translate(-0.03, -0.016, 0.02);
  return weld([palm, thumb]);
}

/**
 * A boot: a capsule lying along the foot, pressed flat, then narrowed at the
 * heel and drawn out at the toe — because a foot is not symmetric front to
 * back and the overhead camera looks straight down at the one part of a settler
 * that is. The widest point lands at the ball, a fifth of the way forward of
 * the ankle, which is where a boot's is.
 *
 * The normals three built are kept. They are out by five degrees at the worst
 * of the taper, which nothing can see; `computeVertexNormals` would be exact at
 * the faces and wrong at the vertices, because a capsule stores its seam and
 * its two poles as several copies of one point, and each copy would average
 * only the faces on its own side — a shading crease down the length of the boot
 * and a star on each end, in exchange for five degrees.
 */
function makeBoot(): THREE.BufferGeometry {
  // Twelve round the capsule, not ten. The boot is the darkest thing a settler
  // wears and the smallest thing the manager camera looks straight down on, so
  // it is the one part of the body whose facets show as a polygon against the
  // grass rather than as a shaded curve. Twelve is forty triangles for the pair
  // and the rig has the room.
  const g = new THREE.CapsuleGeometry(0.072, 0.1, 2, 12);
  g.rotateX(Math.PI / 2);
  g.scale(1.05, 0.68, 1);
  const pos = g.attributes.position!;
  const reach = 0.122; // the capsule's own half-length along the foot
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const u = z / reach;
    pos.setX(i, pos.getX(i) * (0.86 + 0.14 * u));
    // Quadratic ahead of the ankle and flat behind it, so the stretch starts
    // at the same slope the heel ends on and leaves no crease at the arch.
    pos.setZ(i, z * (1 + 0.12 * Math.max(0, u)));
  }
  return g;
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
  for (let i = 1; i <= 3; i++) {
    const a = (i / 3) * (Math.PI / 2);
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
  // The forend is a tube, not a slab. It is four centimetres of wood pinned
  // under a barrel that is nearly as wide, so of the rounded box it used to be
  // the camera could only ever see the bottom third — a hundred and eight
  // triangles for a strip a settler's own hand covers. A capsule is rounder
  // than the box was for less than half the cost, and the difference is most of
  // what the receiver above needed.
  const forend = new THREE.CapsuleGeometry(0.022, 0.22, 1, 10);
  forend.rotateX(Math.PI / 2);
  forend.translate(0, -0.016, 0.35);
  const g = weld([butt, forend]);
  g.translate(0, -0.55, 0);
  return g;
}

/**
 * The steel of a rifle: receiver, barrel and a sight, seated on the stock.
 *
 * The receiver and the sight were the last two square-cornered boxes on a
 * settler, and they sit where the manager camera looks hardest — at a colonist's
 * waist, held out from the body against the grass, with the sight standing
 * proud on the skyline. A box catches the sun on three flats at once and its
 * corners stay sharp at every zoom, which is exactly the read this whole rig
 * was rebuilt to lose. So the receiver is a rounded box on the stock's own
 * radius, and the sight is a post: at nine millimetres across there is no
 * shape to a sight but its outline, and a capsule's outline is a bead.
 */
function makeRifleAction(): THREE.BufferGeometry {
  const receiver = new RoundedBoxGeometry(0.05, 0.06, 0.2, 1, 0.016);
  receiver.translate(0, 0.005, 0.2);
  const barrel = new THREE.CylinderGeometry(0.016, 0.018, 0.44, 12);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(0, 0.012, 0.5);
  const sight = new THREE.CapsuleGeometry(0.009, 0.016, 1, 6);
  sight.translate(0, 0.052, 0.28);
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
    const tine = new THREE.CapsuleGeometry(0.013, 0.08, 1, 5);
    tine.translate(0, 0.053, 0);
    tine.rotateZ(lean);
    tine.rotateX(spread);
    tine.translate(0, height, 0);
    tines.push(tine);
  }
  return weld([beam, ...tines]);
}

/** An ear's proportions, in body space: the numbers a species picks between. */
interface Blade {
  /** Half the ear's width at its widest, a third of the way up. */
  halfWidth: number;
  length: number;
  /** Half its thickness front-to-back. */
  halfDepth: number;
  /** 0 for a hare's round tip, 1 for a fox's point. */
  point: number;
}

/**
 * An ear: a tapered blade rooted at its origin and standing up +Y, widest a
 * third of the way along and thinning to a tip.
 *
 * It was a capsule squashed to under half its width front to back, which at
 * eleven cells up laid the dark stroke beside the skull that the manager camera
 * needs and did its job. At a metre and a half it did not: a pair that thin,
 * that dark and that nearly coplanar read as one stick driven through the head,
 * not as two ears. A blade has a width you can see from the front, a thickness
 * you can see from the side, and a tip whose roundness is the difference
 * between a hare and a fox — and with `makeEarLining` down the front of it, an
 * inside lighter than its back, which is the cue that says ear at all.
 *
 * Eight segments round the lathe rather than the twelve the rest of the animal
 * uses: the section is an ellipse squashed to a third, so the two long faces
 * are nearly flat and the segments that would round them are spent on nothing.
 */
function makeEarBlade(blade: Blade): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(bladeProfile(blade), 8);
  g.scale(1, 1, blade.halfDepth / blade.halfWidth);
  g.computeVertexNormals();
  return g;
}

/** The outline both faces of an ear are turned from, in the blade's own units. */
function bladeProfile({ halfWidth, length, point }: Blade): THREE.Vector2[] {
  const keys: [number, number][] = [
    [0, -0.05],
    [0.68, 0.02],
    [1, 0.4],
    [0.85 - 0.42 * point, 0.72],
    [0.46 - 0.34 * point, 0.92],
    [0, 1],
  ];
  return keys.map(([r, t]) => new THREE.Vector2(r * halfWidth, t * length));
}

/**
 * The inside of an ear: the same outline, but only the front half of the turn,
 * narrowed across the ear and swelled through it — so it stands a tenth proud
 * of the blade's front down the middle of the ear and sinks back inside it
 * towards either edge. What a settler in front of the animal sees is a pale cup
 * inside a dark rim, which is what the inside of an ear looks like; from behind
 * there is nothing to see, because the shell's rim is buried in the blade and
 * the blade is closed and opaque. Nothing is coplanar with anything, so there
 * is no surface for the two to fight over.
 */
function makeEarLining(blade: Blade): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(bladeProfile(blade), 6, -Math.PI / 2, Math.PI);
  g.scale(0.86, 0.97, (blade.halfDepth / blade.halfWidth) * 1.14);
  g.computeVertexNormals();
  return g;
}

/**
 * One ear, ready to hang on a skull: the blade in the coat's darker tone with
 * its lining in the pale one. Both sides of the head share these two buffers —
 * an ear is symmetric about its own axis, so the rig only mirrors its angles.
 */
function ear(blade: Blade, at: Vec3, roll: number, pitch: number): Crown {
  return {
    geometry: makeEarBlade(blade),
    lining: { geometry: makeEarLining(blade), tone: 'pale' },
    at,
    roll,
    pitch,
    tone: 'dark',
    mirrored: false,
  };
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
 * A tail: a tube swept back and down along a curve, narrowing as it goes and
 * turned round at the end. Its root ring is left open, because the root belongs
 * inside the rump.
 *
 * What it replaces was a capsule stub cut with nine sides and one ring in each
 * cap, painted the tone a hoof is. The colony camera holds an animal at its
 * back end more often than at any other angle, and from there that cap is a
 * flat near-black polygon set into the rump — which reads as a hole punched in
 * the animal rather than as anything growing out of it. Round 6 rebuilt the
 * stripe beside it for exactly that reason and left this alone; this is the
 * same fix, a round late.
 *
 * So nothing here is end-on to anybody. The rings stand square to a curve that
 * leaves the body level and is hanging by the time it ends, the tip is a dome
 * rather than a cut, and the tone the rig paints it in is the coat's own gone
 * one step deeper rather than the bottom of the palette.
 */
function makeTail(rootR: number, tipR: number, reach: number, drop: number): THREE.BufferGeometry {
  const radial = 8;
  const shaft = 4;
  const dome = 2;
  const centre: THREE.Vector3[] = [];
  const radius: number[] = [];
  for (let i = 0; i <= shaft; i++) {
    const t = i / shaft;
    // Back at an even rate and down at a quickening one: a tail that left the
    // rump already falling reads as a rope tied on, and one that never falls
    // is the stub this replaces.
    centre.push(new THREE.Vector3(0, -drop * t * t, -reach * t));
    radius.push(rootR + (tipR - rootR) * t);
  }
  // The tip, turned about the end of the shaft along the direction it is
  // travelling, so the last thing anybody sees of the tail is a dome.
  const tip = centre[shaft]!.clone().sub(centre[shaft - 1]!).normalize();
  for (let i = 1; i <= dome; i++) {
    const a = (i / dome) * (Math.PI / 2);
    centre.push(centre[shaft]!.clone().addScaledVector(tip, tipR * Math.sin(a)));
    radius.push(tipR * Math.cos(a));
  }

  const pos: number[] = [];
  const idx: number[] = [];
  const step = new THREE.Vector3();
  for (let i = 0; i < centre.length; i++) {
    // Each ring stands square to the curve: across the animal in X, and in the
    // sagittal plane along the tangent turned a quarter turn. The tangent is
    // read across the ring rather than ahead of it, so the bend has no corner.
    step
      .subVectors(centre[Math.min(i + 1, centre.length - 1)]!, centre[Math.max(i - 1, 0)]!)
      .normalize();
    const c = centre[i]!;
    const r = radius[i]!;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(Math.cos(a) * r, c.y + Math.sin(a) * r * step.z, c.z - Math.sin(a) * r * step.y);
    }
  }
  for (let i = 0; i < centre.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const jn = (j + 1) % radial;
      const a = i * radial + j;
      const b = i * radial + jn;
      const c = (i + 1) * radial + jn;
      const d = (i + 1) * radial + j;
      idx.push(a, b, c);
      // The last ring is the tip and has no width, so its half of the cell
      // would be a triangle with no area: one triangle per cell there, the way
      // `skullPatch` treats its pole.
      if (i < centre.length - 2) idx.push(a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // The tip is one point stored once per meridian, and each copy would take the
  // normal of its own lone triangle: a star on the end of the tail. Pinned
  // along the curve, the way the hair's crown is pinned up.
  const n = g.attributes.normal!;
  const last = (centre.length - 1) * radial;
  for (let j = 0; j < radial; j++) n.setXYZ(last + j, 0, tip.y, tip.z);
  return g;
}

/**
 * A marking on a hide: a patch of the ellipsoid the body is already made of,
 * a finger's width outside it, cut to a hem that wanders round the animal.
 *
 * The point of building it this way is the shading. A marking laid *on* a back
 * as a shape of its own — the tube that used to arch along a mossback's spine —
 * meets the hide at a tangent, so the sliver of it that clears the coat is lit
 * as if it faced sideways while the hide either side of it faces the sky. At
 * eleven cells up that is a dark line and it did its job; at a settler's eye
 * height it is a hole burnt in the shoulder. A shell of the body's own surface
 * has the body's own normals, so it takes exactly the light the coat takes and
 * the only thing that changes at its edge is the colour.
 *
 * The offset has to clear more than the gap between the two surfaces: both are
 * polygons, and the flat of a face sits inside the curve its corners are on.
 * Cut the patch on the same meridians as the body under it (`cols` matching the
 * body sphere's width segments) and that error cancels round the animal; what
 * is left is the patch's own sag between rows, which a finger's width covers.
 *
 * The hem is the marking's edge and it is meant to be seen, so it is where the
 * shape comes from: `hemOf` eases between a handful of turning points, and one
 * flank set deeper than the other is the difference between markings and a
 * decal. Where the hem sinks below some other part of the body — a barrel
 * behind a hump, a haunch under a rump — it simply disappears into the coat,
 * which is the softest edge available and costs nothing.
 */
function makeSaddle(
  radii: Vec3,
  hem: (phi: number) => number,
  cols: number,
  rows: number,
): THREE.BufferGeometry {
  const g = skullPatch(hem, cols, rows).scale(...radii);
  g.computeVertexNormals();
  // The crown is one point stored once per meridian, and each copy would take
  // the normal of its own lone triangle: pinned up, the way the hair's is.
  const n = g.attributes.normal!;
  for (let j = 0; j <= cols; j++) n.setXYZ(j, 0, 1, 0);
  return g;
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
  for (let i = 1; i <= 3; i++) {
    const a = (i / 3) * (Math.PI / 2);
    profile.push(new THREE.Vector2(tipR * Math.cos(a), length + tipR * Math.sin(a)));
  }
  return new THREE.LatheGeometry(profile, 12).rotateX(Math.PI / 2);
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
 * tines a side, a flag of a tail, and a cape of coarser hair over the withers
 * a shade deeper than the coat — which is what the manager camera, looking at
 * the top of the animal, has to tell it apart by. Its legs are the longest and
 * the thickest here, and end in hooves.
 */
function makeMossback(): SpeciesModel {
  const barrel = makeBarrel(0.22, 0.46, 4, 14).scale(1.05, 0.95, 1).translate(0, 0.66, 0);
  const hump = blob([0.2, 0.17, 0.24], [0, 0.78, 0.18]);
  // The withers, in the coat one step deeper: a cape of coarser hair over the
  // hump, which is the highest thing on the animal and the part both cameras
  // see most of. It was an arched tube from the rump to the hump, and what that
  // read as at eye level is written up on `makeSaddle`. Cut on the hump's own
  // ten meridians, so the two surfaces bend together; deeper down the near
  // shoulder than the far one and shallower at the chest, so the edge is a
  // marking's edge; and stopped short at the back, where it drops inside the
  // barrel and the cape ends without an edge at all.
  const saddle = makeSaddle(
    [0.222, 0.192, 0.262],
    hemOf([
      [0, 0.42],
      [0.25, 0.48],
      [0.5, 0.38],
      [0.75, 0.44],
      [1, 0.36],
      [1.25, 0.44],
      [1.5, 0.45],
      [1.75, 0.44],
      [2, 0.42],
    ]),
    10,
    4,
  ).translate(0, 0.78, 0.18);
  // The flag: rooted a finger inside the rump's skin, out along the body's own
  // axis and then down, so it clears the haunches and hangs behind them. In the
  // coat gone one step deeper — a tail is hair, not horn, and the tone a hoof
  // is put a black shape on a lit rump where the animal's outline should be.
  const flag = makeTail(0.05, 0.016, 0.15, 0.19).translate(0, 0.74, -0.38);
  return {
    body: weld([barrel, hump]),
    markings: [
      { geometry: saddle, tone: 'shade', name: 'saddle' },
      { geometry: flag, tone: 'shade', name: 'tail' },
    ],
    neck: makeAnimalNeck(0.16, 0.12, 0.3),
    neckAt: [0, 0.84, 0.36],
    neckPitch: 0.7,
    collarAt: 0.08,
    collarR: 0.13,
    head: makeAnimalHead([0.12, 0.11, 0.14], { baseR: 0.085, tipR: 0.05, length: 0.22, drop: 0.03 }),
    headAt: [0, 1.06, 0.56],
    eyeAt: [0.085, 0.035, 0.09],
    noseAt: [0, -0.015, 0.325],
    crowns: [
      { geometry: makeAntler(), at: [0.06, 0.09, -0.02], roll: 0.5, pitch: -0.35, tone: 'horn', mirrored: true },
      // Out sideways under the antlers, the way an elk's are.
      ear({ halfWidth: 0.05, length: 0.14, halfDepth: 0.019, point: 0.3 }, [0.098, 0.055, -0.03], 1.0, -0.1),
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
  // The saddle: the egg's own surface, a finger's width outside it, from the
  // shoulders back over the rump. The manager camera sees the top of an animal
  // and nothing else, and a sand hare on sand grass at that angle was a pale
  // lump with ears — the deeper back is the one surface that camera can read,
  // and it is the coat's own colour gone deeper, which is what a hare's back
  // actually is.
  //
  // It was a second egg set higher and sunk inside the first, and only the
  // crown of it cleared the coat. That put the marking's edge wherever two
  // ellipsoids happened to cross, which is a clean ellipse laid across the
  // animal — the one shape no hide has ever grown. The hem is drawn now
  // instead: deeper over the rump, shallow at the shoulders, and one flank
  // lower than the other.
  const saddle = makeSaddle(
    [0.242, 0.262, 0.322],
    hemOf([
      [0, 0.46],
      [0.25, 0.4],
      [0.5, 0.34],
      [0.75, 0.42],
      [1, 0.5],
      [1.25, 0.48],
      [1.5, 0.54],
      [1.75, 0.5],
      [2, 0.46],
    ]),
    12,
    4,
  )
    .rotateX(0.3)
    .translate(0, 0.42, 0);
  return {
    body: weld([egg, haunchL, haunchR]),
    markings: [
      { geometry: saddle, tone: 'shade', name: 'saddle' },
      { geometry: blob([0.2, 0.16, 0.26], [0, 0.33, 0.04], 9, 6), tone: 'pale', name: 'belly' },
      // The scut. A hare's tail is the one pale thing on its back end and the
      // last of it a settler sees as it bolts, so it is a ball with a bit of
      // size to it rather than the bead it was.
      {
        geometry: new THREE.SphereGeometry(0.078, 9, 7).translate(0, 0.552, -0.312),
        tone: 'pale',
        name: 'scut',
      },
    ],
    neck: makeAnimalNeck(0.09, 0.075, 0.14),
    neckAt: [0, 0.5, 0.26],
    neckPitch: 0.6,
    collarAt: 0,
    collarR: 0.085,
    head: makeAnimalHead([0.1, 0.1, 0.12], { baseR: 0.076, tipR: 0.052, length: 0.13, drop: 0.02 }),
    headAt: [0, 0.62, 0.36],
    eyeAt: [0.075, 0.03, 0.075],
    noseAt: [0, -0.014, 0.222],
    crowns: [
      // Dark, and leaned back and out rather than standing straight up: an ear
      // that thin held vertical is edge-on to the manager camera and
      // disappears, which took the hare's one unmistakable feature away in the
      // view the player spends their time in. Raked, each lays a dark stroke
      // beside the skull that reads from directly overhead.
      //
      // The roots then sit nearly two ear-widths apart and the rake carries the
      // tips further out again, which is the other half of the fix: at a metre
      // and a half a pair rooted a finger apart and squashed to a third of their
      // width read as a single stick through the head, not as ears.
      ear({ halfWidth: 0.055, length: 0.34, halfDepth: 0.021, point: 0.2 }, [0.066, 0.072, -0.028], 0.38, -0.4),
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
      { geometry: blob([0.11, 0.1, 0.14], [0, 0.38, 0.3], 9, 6), tone: 'pale', name: 'chest' },
      {
        geometry: new THREE.SphereGeometry(0.062, 9, 7).translate(0, 0.838, -0.641),
        tone: 'pale',
        name: 'brush-tip',
      },
    ],
    neck: makeAnimalNeck(0.09, 0.07, 0.14),
    neckAt: [0, 0.56, 0.42],
    neckPitch: 0.7,
    collarAt: 0.02,
    collarR: 0.081,
    head: makeAnimalHead([0.095, 0.09, 0.11], { baseR: 0.065, tipR: 0.028, length: 0.15, drop: 0.02 }),
    headAt: [0, 0.68, 0.53],
    eyeAt: [0.07, 0.03, 0.07],
    noseAt: [0, -0.01, 0.227],
    crowns: [
      ear({ halfWidth: 0.068, length: 0.17, halfDepth: 0.024, point: 0.85 }, [0.076, 0.068, -0.02], 0.36, -0.12),
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
      { geometry: blob([0.15, 0.13, 0.3], [0, 0.5, 0.02], 9, 6), tone: 'pale', name: 'belly' },
      {
        geometry: new THREE.SphereGeometry(0.057, 9, 7).translate(0, 0.406, -0.757),
        tone: 'dark',
        name: 'brush-tip',
      },
    ],
    neck: makeAnimalNeck(0.13, 0.1, 0.24),
    // Pitched nearly flat, so the neck comes down with the head: pitched
    // steeper from the same root, its top cleared the back of the lowered
    // skull and hung in the air behind the ears.
    neckAt: [0, 0.61, 0.464],
    neckPitch: 1.1,
    collarAt: 0.06,
    collarR: 0.111,
    head: makeAnimalHead([0.11, 0.1, 0.13], { baseR: 0.075, tipR: 0.035, length: 0.17, drop: 0.025 }),
    headAt: [0, 0.72, 0.68],
    eyeAt: [0.08, 0.03, 0.085],
    noseAt: [0, -0.012, 0.26],
    crowns: [
      ear({ halfWidth: 0.058, length: 0.15, halfDepth: 0.022, point: 0.8 }, [0.078, 0.068, -0.03], 0.32, -0.15),
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

/**
 * A downward chevron, the universal "this one" marker in a colony sim: an
 * arrowhead with its point at its own origin, so the rig hangs the point over
 * the back and the marker grows upward from there.
 *
 * It was a capped cone a third of a cell across floating a body-length over the
 * animal, then an open funnel a third narrower at the same width. Both were
 * still the largest flat colour in the frame whenever a marked animal came near
 * the camera, because the marker is drawn unlit — a hunt order has to read the
 * same at three in the morning as at noon — and an unlit surface has no shading
 * to tell the eye how big the thing is. So what shrinks is the surface itself:
 * a hair over half the area it had, hung at the same height over the same back.
 *
 * The rim is where the rest of the answer is. The funnel ended on a hard circle
 * at its widest point, which is the outline of a decal; this one carries on
 * past its widest and rolls back inward and up, so the top edge is a turned lip
 * with a curve to it. Against a flat fill the outline is the only thing that
 * can say a marker has thickness, and now it does.
 *
 * And the point is a mouth, not a point. Rounded and swollen at the top,
 * tapering to a sharp tip at the bottom, filled with one flat red-orange and
 * hung where it grazed the hide, the marker was the exact silhouette of a drop
 * of blood — on the grey fenwolf it read as an injury rather than as an order
 * somebody gave. That silhouette is the tip. Opening it into a ring the width
 * of a thumbnail costs nothing, shows a coin of ground or hide straight through
 * the middle of it, and leaves a funnel: a thing pointing at an animal rather
 * than a thing running down one. `MARK_CLEARANCE` does the other half.
 */
function makeHuntMark(): THREE.BufferGeometry {
  const profile = [
    [0.038, 0],
    [0.062, 0.09],
    [0.078, 0.166],
    [0.07, 0.192],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(profile, 14);
}

function makeShared(): SharedGeometry {
  // The belt is an open band a hair wider than the waist of the lathe, squashed
  // the same way, so it hugs the cloth instead of cutting through it.
  const belt = new THREE.CylinderGeometry(0.215, 0.22, 0.06, 20, 1, true);
  belt.scale(1, 1, 0.62);
  return {
    torso: makeTorso(),
    belt,
    neck: makeNeck(),
    // A sphere drawn a touch tall. A rounded box with a radius this generous is
    // the same shape for six times the triangles, which is where the first cut
    // of this rig spent most of its budget.
    //
    // Twenty round and ten up. It was twenty by twelve, and two of those rings
    // sat within a few degrees of the poles — the crown of the skull, which the
    // hair covers, and the underside of the jaw, which nothing looks at from a
    // camera eleven cells up. Eighty triangles for a curve no player is ever in
    // a position to see, on the part of the rig that already spent the most.
    head: new THREE.SphereGeometry(0.13, 20, 10).scale(1, 1.06, 1),
    hair: makeHair(false),
    hairLong: makeHair(true),
    // The one bead on a settler's face, and it was standing off it. At 0.022 of
    // radius, seated where it is on a skull of 0.13, the outermost point of the
    // eye stood 26 millimetres proud of the skin — a fifth of the head's own
    // radius — so from the manager camera the silhouette of a head had two
    // bumps on the front of it and read as a face pressed against glass. At
    // 0.016 it stands 20, which is under the skin's own curvature at that angle
    // and reads as an eye set in a face. Six by five is a bead this size: the
    // count that stops being visible once the sphere stops sticking out.
    eye: new THREE.SphereGeometry(0.016, 6, 5),
    // Three rings on the caps: the top of a leg is inside the torso and the
    // bottom inside a boot, so the fourth was paid for and never seen.
    leg: limb(0.075, SETTLER_LEG, 12, 3),
    boot: makeBoot(),
    arm: limb(0.065, SLEEVE, 12, 3),
    hand: makeHand(),
    rifleStock: makeRifleStock(),
    rifleAction: makeRifleAction(),
    club: makeClub(),
    animals: {
      mossback: makeMossback(),
      dunhare: makeDunhare(),
      brambletail: makeBrambletail(),
      fenwolf: makeFenwolf(),
    },
    // A bead on a body drawn at most a cell across. Six by four was a
    // twelve-sided lump: from eleven cells up that is a dot and reads as an
    // eye, but a settler standing at a hare's head sees a chipped bead with a
    // flat facet catching the sun where the highlight should be round. Eight
    // round is what keeps the highlight round, and it is the ring count that
    // matters here rather than the stack count — the eye is a bead seen from
    // the side, so the ring above the equator and the ring below it are the
    // ones the eye reads, and the sixth was between them and the pole.
    animalEye: new THREE.SphereGeometry(0.027, 8, 5),
    // A dark nose on the end of the muzzle, in the eye's material so it takes
    // the same glint. It is the one thing that marks which end of a lowered
    // head is the front from the manager camera, and at arm's length it is the
    // one thing that says the muzzle ends rather than stops: drawn a little
    // wide and a little flat, the way a nose sits across a snout.
    animalNose: new THREE.SphereGeometry(0.032, 7, 5).scale(1.15, 0.85, 0.9),
    // A band round the neck. The only thing on the map that separates a tamed
    // mossback from the wild one grazing beside it, so it is a ring of solid
    // colour rather than a tint the isometric camera would lose in shadow.
    //
    // Four round the tube and twenty round the ring. Sixteen by thirty-two was
    // a thousand triangles on a strap and put a bonded mossback seven hundred
    // over the animal budget; six by twenty-two was still two hundred and
    // sixty-four, a tenth of an animal spent rounding a section that is thirty
    // millimetres across on the largest species and nine on the smallest. A
    // collar is a flat strap of leather with edges, and four is the section a
    // strap actually has — the twenty that stayed are the ones the eye reads,
    // because what shows at any distance is the ring's own curve and not the
    // shape of the leather's edge. The hundred triangles that buys go into the
    // mossback's tail, which every animal on the map wears and which no player
    // has to tame anything to see.
    animalCollar: new THREE.TorusGeometry(COLLAR_R, 0.034, 4, 20).rotateX(Math.PI / 2),
    // A little lozenge hung off the collar: the tell that this one is somebody's
    // rather than the colony's. A shape rather than a second collar colour,
    // because the collar already says something — pale gold when there is
    // something to collect — and two meanings on one surface is one meaning lost.
    // Squashed to under a third of its depth, so half of those rings were drawn
    // flat against each other: ten by six spent a hundred triangles on a
    // lozenge thirty-two millimetres tall on the largest species and fourteen
    // on the smallest, and it is a silhouette at both.
    petTag: new THREE.SphereGeometry(0.07, 8, 5).scale(0.8, 1.2, 0.45),
    huntMark: makeHuntMark(),
    // The caravan's load: one bundle high on the back and a few crates set down
    // in the grass. A trader who is just a differently-tinted settler is a thing
    // the player has to be told about; a pile of freight is a thing they see.
    //
    // Both were rounded and both were rounded past what shows. The bundle's
    // second segment buys a smoother fillet on a 60-millimetre radius seen from
    // eleven cells up and cost 192 triangles, more than a settler's whole head;
    // the crates' 30-millimetre bevel cost 96 apiece and a crate is a box. A
    // trader carrying all four drew 3,568 against a settler's budget of 3,000,
    // and no test could see it because no trader stands on the map on turn one.
    pack: new RoundedBoxGeometry(0.38, 0.4, 0.22, 1, 0.06),
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
