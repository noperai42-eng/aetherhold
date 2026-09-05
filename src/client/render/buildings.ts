/**
 * Buildings, blueprints and loose resource stacks.
 *
 * Every mesh here is derived from the same `BUILDING_DEFS` entry the simulation
 * uses for collision, so a wall you can see is a wall you cannot walk through in
 * either view. Heights come from `def.height`; nothing is eyeballed.
 *
 * Nothing here is flat-shaded. Every curved part carries enough segments to
 * read as round from a body's eye height, every box that a settler can put a
 * hand on has its edges eased, and the handful of parts that are honestly
 * faceted — a pyramid roof — get face normals baked into the geometry rather
 * than a material flag that would facet the whole pool.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { BUILDING_COLOR, RESOURCE_COLOR, seasonTint } from './palette';
import { InstancedPool } from './instanced';
import { defOf } from '../../sim/buildings';
import { treeGrowth } from '../../sim/forest';
import { buildingAt, dist } from '../../sim/grid';
import { BATTERY_CAPACITY, conducts, isElectrical } from '../../sim/power';
import { hostiles } from '../../sim/world';
import { yearPhase } from '../../sim/seasons';
import { terrainAt } from '../../sim/types';
import type { Building, BuildingKind, ResourceKind, World } from '../../sim/types';

const TURRET_RANGE = 14;
const BLACK = new THREE.Color(0x000000);
/**
 * Bark. The trunk is the one part of a tree that is not the tree's colour: it
 * used to take the building tint like everything else, which painted every
 * trunk in the forest the same green as the crown above it.
 */
const BARK = 0x5a4331;
/**
 * How much one tree may differ from the next: a size between these two, times
 * the growth scale, and a lean of up to this many radians (four degrees). The
 * base tree is built to `def.height`, so the biggest stands a fifth over it —
 * cosmetic, since nothing in the sim reads a tree's height off its mesh.
 */
const TREE_SIZE_MIN = 0.85;
const TREE_SIZE_MAX = 1.2;
const TREE_LEAN_MAX = 0.07;
/** The axis a tree leans about, in its own frame; the hashed yaw turns it. */
const LEAN_AXIS = new THREE.Vector3(1, 0, 0);

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** What a fence rail will reach out to: the other things that make a boundary. */
const FENCE_LINKS = new Set<BuildingKind>(['fence', 'wall', 'stonewall', 'door']);

/**
 * Where a dropped stack comes to rest on a cell that already has furniture on it.
 *
 * The simulation has no notion of "on a table" and does not need one — a stack's
 * cell is its address for hauling, for the room it is in and for the temperature
 * that rots it, and a table standing on that cell changes none of those. What it
 * does change is where the crate *looks* like it is, so this is a render lift and
 * nothing more. The numbers are the tops of the meshes below, and beds fall
 * through to `standHeight`, which is already the height a body lies at.
 */
const ITEM_REST: Partial<Record<BuildingKind, number>> = {
  table: 0.9,
  bench: 0.92,
};

/**
 * Where the top of a mattress is: the height the sim lays a sleeper at. Read
 * from the def rather than typed here, so the two cannot drift apart; the three
 * beds share the number because the three beds share a sleeper.
 */
const BED_TOP = defOf('bed').standHeight;

/** A box whose geometry has been shifted so instance matrices are plain placements. */
function box(w: number, h: number, d: number, y: number, x = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/**
 * A box with its edges eased off. The bevel is small — two to five centimetres —
 * because the point is not to make furniture look inflated but to give every
 * edge a highlight to catch: a sharp box has faces that are either lit or not,
 * and a bevelled one has a bright line along each edge that reads as solid from
 * both cameras. `seg` is the number of steps round the bevel; one is a chamfer,
 * two reads as a curve, and each step costs triangles on a part that may be
 * instanced by the hundred.
 */
function rbox(w: number, h: number, d: number, y: number, x = 0, z = 0, r = 0.03, seg = 2): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, seg, r);
  g.translate(x, y, z);
  return g;
}

/**
 * Which way a fishing stage faces: at the water beside it.
 *
 * Same sign convention as the turret's `aimYaw` — a yaw about the up axis turns
 * the geometry's +x toward −z, so a sim-space bearing has to be negated to get
 * there. Falls back to zero on a stage that has somehow ended up with no water
 * next to it, which `canPlace` will not allow but a save edited by hand can.
 */
function waterYaw(world: World, b: Building): number {
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = b.x + dx;
    const ny = b.y + dy;
    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
    if (terrainAt(world, nx, ny) === 'water') return -Math.atan2(dy, dx);
  }
  return 0;
}

/** Paddles on a watermill wheel. Eight is where the rim stops reading as a polygon. */
const PADDLES = 8;
/** Distance from the hub out to a paddle. */
const WHEEL_R = 0.55;
/** How far out over the water the hub sits, and how high. */
const HUB_OUT = 0.42;
const HUB_Y = 0.78;
/** Sim ticks per turn of the wheel. 52 ≈ two and a half seconds, unhurried. */
const WHEEL_TICKS = 52;
const TAU = Math.PI * 2;
/**
 * The wheel's axle in the mill's own frame: a shaft running out of the house
 * along +x, over the shore, with the wheel hung on the end of it. Everything
 * about the mill is built along that one line, so a single yaw aims the whole
 * machine at the water.
 */
const AXLE = new THREE.Vector3(1, 0, 0);

function cylinder(rTop: number, rBottom: number, h: number, y: number, seg = 20): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  g.translate(0, y, 0);
  return g;
}

function cone(r: number, h: number, y: number, seg = 20): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, y, 0);
  return g;
}

function sphere(r: number, y: number, x = 0, z = 0, ws = 20, hs = 14): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.translate(x, y, z);
  return g;
}

/**
 * A profile spun round the y axis: (radius, height) pairs from the bottom up.
 * This is how anything round-but-not-a-cylinder is made here — a trunk that
 * flares at the root, a tier of foliage, a torso — because a lathe is smooth by
 * construction and costs one ring of triangles per point in the profile.
 */
function lathe(profile: ReadonlyArray<readonly [number, number]>, seg = 16): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
}

/**
 * Several parts welded into one geometry so they draw as one instance. A bed
 * frame with its headboard, a wheel with its spokes, a ring of nine stones: one
 * pool each rather than nine, and the count of draw calls stays where it was
 * before the parts had any detail at all. Rounded boxes come out non-indexed
 * and everything else indexed, and a merge will not mix the two, so every part
 * is flattened first; the GPU counts triangles, and flattening changes none.
 */
function merge(...parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const g = mergeGeometries(flat, false);
  for (const p of parts) p.dispose();
  for (const p of flat) if (!parts.includes(p)) p.dispose();
  return g;
}

/**
 * A hard-edged part that must stay hard. A pyramid roof lit with smooth normals
 * is a cone pretending, so the few parts that are honestly faceted get face
 * normals baked into the geometry itself.
 */
function faceted(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

/**
 * Roughs up a lathe so it stops reading as turned on a machine. The nudge is a
 * sum of two-, three- and five-lobed waves round the ring, each twisting as it
 * climbs the profile, so a tier of foliage bulges out here and hangs low there
 * the way a real bough does, and the rim of one tier drops into the next rather
 * than sitting on it as a clean horizontal circle — which was the give-away
 * from the first-person camera, where a forest read as a row of stacked cones.
 * Low frequency matters: a per-vertex hash gives a rim that is jagged but still
 * round on average, and the eye reads the average. `phase` turns the lobes so
 * two tiers on the same tree do not bulge on the same side.
 *
 * The seam is matched by construction — the lathe keeps two copies of its
 * first meridian and every wave has a whole number of lobes, so both copies get
 * the same nudge. The bottom rim and the tip are left alone, so a tier still
 * sits where the profile says and still comes to its point.
 */
function rumple(g: THREE.LatheGeometry, amp: number, phase = 0): THREE.BufferGeometry {
  const { points, segments } = g.parameters;
  const P = points.length;
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const i = Math.floor(k / P) % segments;
    const j = k % P;
    if (j === 0 || j === P - 1) continue;
    const a = (i / segments) * TAU;
    const t = j / (P - 1);
    const f =
      0.55 * Math.sin(2 * a + phase + t * 2.2) +
      0.35 * Math.sin(3 * a - phase * 1.7 + t * 4.1) +
      0.2 * Math.sin(5 * a + phase * 0.6 + t * 1.3);
    const s = 1 + f * amp;
    pos.setXYZ(k, pos.getX(k) * s, pos.getY(k) + f * amp * 0.8, pos.getZ(k) * s);
  }
  g.computeVertexNormals();
  // The two copies of the seam meridian have different neighbours and so came
  // out with slightly different normals; average them or the seam shows as a
  // line of light down one side of every tree.
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let j = 0; j < P; j++) {
    const a = j;
    const b = segments * P + j;
    const x = nrm.getX(a) + nrm.getX(b);
    const y = nrm.getY(a) + nrm.getY(b);
    const z = nrm.getZ(a) + nrm.getZ(b);
    const len = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(a, x / len, y / len, z / len);
    nrm.setXYZ(b, x / len, y / len, z / len);
  }
  return g;
}

/**
 * Timber planking for a wall: a proud board every half metre on all four
 * faces, with a post up each corner. The boards sit a centimetre into the body
 * so the joint is never a coplanar face, and they are at the same heights on
 * every cell so a run of wall reads as continuous planking rather than as
 * cells. On a face that meets a neighbour they are buried inside it, which
 * costs nothing to draw and nothing to see.
 */
function planks(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const y = 0.27 + i * 0.48;
    parts.push(box(0.98, 0.42, 0.05, y, 0, 0.505));
    parts.push(box(0.98, 0.42, 0.05, y, 0, -0.505));
    parts.push(box(0.05, 0.42, 0.98, y, 0.505, 0));
    parts.push(box(0.05, 0.42, 0.98, y, -0.505, 0));
  }
  for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) parts.push(box(0.08, 2.44, 0.08, 1.22, x, z));
  return merge(...parts);
}

/**
 * Coursed stone for the stone wall: three proud courses with a joint in each,
 * the joints staggered from course to course the way a mason lays them. The
 * recessed courses between are the body itself, so one thin part gives the
 * whole face a bond pattern, and it stays inside the plinth and coping
 * footprint so the wall's outline is still the box the sim collides with.
 */
function courses(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const edge = 0.47;
  for (let c = 0; c < 3; c++) {
    const y = 0.69 + c * 0.7;
    const joint = c % 2 === 0 ? -0.15 : 0.15;
    const w1 = joint - 0.02 + edge;
    const w2 = edge - (joint + 0.02);
    for (const side of [1, -1]) {
      parts.push(box(w1, 0.36, 0.05, y, -edge + w1 / 2, side * 0.475));
      parts.push(box(w2, 0.36, 0.05, y, edge - w2 / 2, side * 0.475));
      parts.push(box(0.05, 0.36, w1, y, side * 0.475, -edge + w1 / 2));
      parts.push(box(0.05, 0.36, w2, y, side * 0.475, edge - w2 / 2));
    }
  }
  return merge(...parts);
}

/** The lamp's globe. Built twice — once lit, once not — so `globe()` rather than a const. */
function globe(): THREE.BufferGeometry {
  return sphere(0.18, 1.5);
}

function solidMat(rough: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: rough, metalness: 0.04 });
}

/**
 * A part with a colour of its own under the instance tint — dark iron on a
 * timber bench, linen on a bed frame. The colour multiplies the building's
 * palette entry rather than replacing it, so one entry still gives the whole
 * building its family and the parts their contrast within it.
 */
function tone(color: number, rough: number, metal = 0.04): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

/** The crate mesh's own height — the step from one stack in a pile to the next. */
const STACK_H = 0.3;
/** How far a pile may climb before further stacks just share the top crate's spot. */
const PILE_MAX = 0.75;

/** How high off the ground a loose stack sits on this cell. Zero in an empty yard. */
function itemRest(world: World, x: number, y: number): number {
  const b = buildingAt(world, Math.round(x), Math.round(y));
  if (!b || !b.built) return 0;
  return ITEM_REST[b.kind] ?? defOf(b.kind).standHeight;
}

/** Four legs on a rail, for anything that stands on a top: `pitch` is half the leg spacing. */
function legs(pitch: number, h: number, rTop: number, rBottom: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-pitch, pitch]) {
    for (const z of [-pitch, pitch]) parts.push(cylinder(rTop, rBottom, h, h / 2, 12).translate(x, 0, z));
  }
  const rail = h - 0.09;
  parts.push(box(pitch * 2, 0.06, 0.05, rail, 0, pitch));
  parts.push(box(pitch * 2, 0.06, 0.05, rail, 0, -pitch));
  parts.push(box(0.05, 0.06, pitch * 2, rail, pitch, 0));
  parts.push(box(0.05, 0.06, pitch * 2, rail, -pitch, 0));
  return merge(...parts);
}

/** A sandbag: a squashed capsule lying along x, at rest on `y`. */
function bag(y: number, x: number, z: number, alongZ: boolean): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(0.15, 0.36, 3, 10);
  g.rotateZ(Math.PI / 2);
  g.scale(1, 0.8, 1);
  if (alongZ) g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

export class BuildingsView {
  readonly group = new THREE.Group();
  private readonly pools = new Map<string, InstancedPool>();
  private readonly blueprints: InstancedPool;
  private readonly stacks = new Map<ResourceKind, InstancedPool>();
  /** Turret barrels track the nearest hostile. View-only, but shared by both views. */
  private readonly barrelYaw = new Map<number, number>();
  /**
   * Where each watermill's wheel had got to. Read only while the wheel is
   * stopped: a wheel that parked at whatever angle the formula happens to give
   * for the tick it froze on would jump a fifth of a turn as it stopped, which
   * is the one frame the player is looking at it.
   */
  private readonly wheelAngle = new Map<number, number>();

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private readonly hub = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly c = new THREE.Color();
  /** Cell -> the height the next stack dropped there rests at. Rebuilt every sync. */
  private readonly pile = new Map<number, number>();

  constructor() {
    // Walls read as a timber-framed plank wall with a stone coping line along the
    // top. The body keeps the exact box the sim collides with; the planking and
    // the coping are thin parts laid over it.
    this.pool('wall.body', box(1, 2.44, 1, 1.22), solidMat(0.92), 256);
    this.pool('wall.planks', planks(), tone(0xb9ad98, 0.9), 256);
    this.pool('wall.cap', rbox(1.06, 0.16, 1.06, 2.52, 0, 0, 0.04), solidMat(0.8), 256);

    // Stone wall: the same silhouette as timber so a mixed perimeter still reads as
    // one wall, but with a proud plinth at the base, coursed stone up the face and
    // a heavier coping. It is the colour that carries the difference — see
    // BUILDING_COLOR.stonewall.
    this.pool('stone.plinth', rbox(1.04, 0.34, 1.04, 0.17), solidMat(0.95), 256);
    this.pool('stone.body', box(0.94, 2.2, 0.94, 1.44), solidMat(0.95), 256);
    this.pool('stone.courses', courses(), tone(0xb4b4b0, 0.95), 256);
    this.pool('stone.cap', rbox(1.1, 0.2, 1.1, 2.62, 0, 0, 0.05), solidMat(0.85), 256);

    // Research bench: a desk with glassware on it and a small brass lamp over
    // it, so it reads as thinking-work rather than another workbench from across
    // the map. The flask is the part that carries it — nothing else in the colony
    // is made of glass.
    this.pool(
      'lab.desk',
      merge(
        rbox(0.98, 0.08, 0.7, 0.7),
        rbox(0.08, 0.66, 0.62, 0.33, -0.43, 0, 0.02, 1),
        rbox(0.08, 0.66, 0.62, 0.33, 0.43, 0, 0.02, 1),
        rbox(0.7, 0.36, 0.04, 0.36, 0, -0.29, 0.01, 1),
      ),
      solidMat(0.8),
      8,
    );
    this.pool(
      'lab.glass',
      merge(sphere(0.11, 0.85, 0.2, 0.1, 16, 12), cylinder(0.035, 0.04, 0.16, 0.99, 12).translate(0.2, 0, 0.1)),
      tone(0xe6f2f0, 0.15, 0.1),
      8,
    );
    this.pool(
      'lab.stand',
      merge(
        cylinder(0.05, 0.06, 0.03, 0.755, 12).translate(-0.24, 0, 0.12),
        cylinder(0.012, 0.012, 0.34, 0.92, 8).translate(-0.24, 0, 0.12),
        new THREE.TorusGeometry(0.06, 0.008, 6, 16).rotateX(Math.PI / 2).translate(-0.18, 1.0, 0.12),
      ),
      tone(0x3e3e42, 0.45, 0.5),
      8,
    );
    this.pool(
      'lab.lamp',
      merge(
        cylinder(0.015, 0.015, 0.34, 0.91, 8).translate(-0.3, 0, -0.22),
        cylinder(0.09, 0.04, 0.09, 1.1, 16).translate(-0.3, 0, -0.22),
      ),
      new THREE.MeshStandardMaterial({
        color: 0xc9a866,
        emissive: new THREE.Color(0x6a4a12),
        roughness: 0.35,
      }),
      8,
    );

    // Door: the panel's geometry is offset so its origin sits on the hinge edge,
    // which lets the sim's 0..1 `open` value drive a real swing. The handle is
    // built in the same hinge frame and pushed with the same matrix, so it goes
    // round with the panel rather than hanging in the air where the door was.
    this.pool(
      'door.panel',
      merge(
        rbox(0.88, 2.28, 0.12, 1.15, 0.45, 0, 0.02, 1),
        rbox(0.6, 0.8, 0.02, 1.6, 0.45, 0.065, 0.01, 1),
        rbox(0.6, 0.8, 0.02, 1.6, 0.45, -0.065, 0.01, 1),
        rbox(0.6, 0.7, 0.02, 0.62, 0.45, 0.065, 0.01, 1),
        rbox(0.6, 0.7, 0.02, 0.62, 0.45, -0.065, 0.01, 1),
      ),
      solidMat(0.7),
      32,
    );
    this.pool(
      'door.handle',
      merge(
        sphere(0.045, 1.05, 0.78, 0.09, 12, 8),
        sphere(0.045, 1.05, 0.78, -0.09, 12, 8),
        cylinder(0.02, 0.02, 0.2, 0, 10).rotateX(Math.PI / 2).translate(0.78, 1.05, 0),
      ),
      tone(0x4a4034, 0.4, 0.5),
      32,
    );
    this.pool(
      'door.frame',
      merge(
        rbox(0.1, 2.45, 0.24, 1.225, -0.5, 0, 0.02, 1),
        rbox(0.1, 2.45, 0.24, 1.225, 0.5, 0, 0.02, 1),
        rbox(1, 0.3, 0.5, 2.45, 0, 0, 0.04),
      ),
      solidMat(0.85),
      32,
    );

    this.bedSet('bed', 32, 0.36, tone(0x8c8c8c, 0.8), tone(0xf2ede4, 0.9), tone(0xa9b8a0, 0.95), tone(0xfaf6ee, 0.95));

    // Hospital bed: pale linen, a raised head end and a red cross on the blanket.
    // The cross is what carries it from the isometric camera — a white bed at
    // that distance is a bed with the lights on, but a bed with a red mark on it
    // is a sickbay, and a player scanning for somewhere to put a patient finds it
    // without clicking anything.
    this.bedSet('med', 8, 0.4, tone(0xb8b8b8, 0.6), solidMat(1.0), solidMat(1.0), solidMat(1.0));
    this.pool(
      'med.cross',
      merge(box(0.34, 0.04, 0.1, BED_TOP + 0.07, 0, 0.14), box(0.1, 0.04, 0.34, BED_TOP + 0.07, 0, 0.14)),
      tone(0xb2413c, 0.75),
      8,
    );

    // Prison bunk: the same bed, plus the thing that makes it a cell. The bars
    // are what carries the read from the isometric camera — a grey bed is just a
    // bed you cannot see the colour of, but a bed with a grille at the head of it
    // is unmistakably somewhere you put a person you do not trust. They stand
    // where the headboard would be, so this is the one bed built without one.
    this.bedSet('prison', 16, 0, tone(0x8a8a8a, 0.8), tone(0xd8d4cc, 0.95), tone(0x9a9a9a, 0.95), tone(0xe0dcd4, 0.95));
    this.pool(
      'prison.bars',
      (() => {
        const parts: THREE.BufferGeometry[] = [box(0.9, 0.04, 0.05, 0.22, 0, -0.46), box(0.9, 0.04, 0.05, 0.72, 0, -0.46)];
        for (let i = 0; i < 7; i++) parts.push(cylinder(0.015, 0.015, 0.62, 0.45, 8).translate(-0.39 + i * 0.13, 0, -0.46));
        return merge(...parts);
      })(),
      tone(0x4a4c50, 0.5, 0.4),
      16,
    );

    this.pool('table.top', rbox(0.98, 0.08, 0.98, 0.86), solidMat(0.7), 32);
    this.pool('table.legs', legs(0.4, 0.82, 0.035, 0.05), solidMat(0.8), 32);

    // A games table: a smaller top than the dining table, a dark board laid on
    // it with pale pieces standing on the board, and a stool either side. The
    // board is the whole point — from the manager camera the two tables are the
    // same silhouette, and the dark square on top is what tells you which one
    // your settlers are playing at. Its material multiplies under the palette
    // tint, the same trick the grave uses to get two tones from one entry.
    this.pool('game.top', rbox(0.74, 0.08, 0.74, 0.77), solidMat(0.7), 24);
    this.pool('game.legs', legs(0.28, 0.73, 0.03, 0.04), solidMat(0.8), 24);
    this.pool('game.board', rbox(0.5, 0.03, 0.5, 0.825, 0, 0, 0.01, 1), tone(0x4e6b46, 0.95), 24);
    this.pool(
      'game.pieces',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (const [x, z] of [
          [-0.15, -0.15],
          [0.05, -0.15],
          [0.15, 0.05],
          [-0.05, 0.05],
          [-0.15, 0.15],
          [0.15, -0.05],
        ]) {
          parts.push(cylinder(0.035, 0.035, 0.024, 0.852, 12).translate(x, 0, z));
        }
        return merge(...parts);
      })(),
      tone(0xf3ead6, 0.6),
      24,
    );
    this.pool(
      'game.stools',
      merge(cylinder(0.13, 0.11, 0.34, 0.17, 16).translate(-0.38, 0, 0), cylinder(0.13, 0.11, 0.34, 0.17, 16).translate(0.38, 0, 0)),
      solidMat(0.85),
      24,
    );

    // Stove: a rounded cast body with a firebox door on the front, two hobs on
    // the top and a flue up the back corner. The hobs glow; they are the part
    // the eye lands on from above, where the door is out of sight.
    this.pool('stove.body', rbox(0.88, 0.9, 0.86, 0.45, 0, 0, 0.04), solidMat(0.5), 16);
    this.pool(
      'stove.door',
      merge(rbox(0.5, 0.42, 0.05, 0.4, 0, 0.43, 0.015, 1), box(0.3, 0.03, 0.03, 0.4, 0, 0.47)),
      tone(0x2e2e33, 0.45, 0.3),
      16,
    );
    this.pool(
      'stove.flue',
      merge(cylinder(0.07, 0.07, 0.3, 0.95, 16).translate(-0.26, 0, -0.26), cylinder(0.09, 0.09, 0.05, 1.075, 16).translate(-0.26, 0, -0.26)),
      tone(0x3a3a3f, 0.6, 0.3),
      16,
    );
    this.pool(
      'stove.plate',
      merge(cylinder(0.14, 0.14, 0.025, 0.91, 20).translate(-0.2, 0, 0.1), cylinder(0.14, 0.14, 0.025, 0.91, 20).translate(0.2, 0, 0.1)),
      new THREE.MeshStandardMaterial({
        color: 0x3a3a40,
        emissive: new THREE.Color(0x2a0d05),
        roughness: 0.4,
      }),
      16,
    );

    // Workbench: a slatted plank top on a cabinet with two drawers, and a dark
    // steel vise clamped to the near edge so it reads as "things are made here"
    // from the isometric camera.
    this.pool(
      'bench.body',
      merge(rbox(0.86, 0.82, 0.56, 0.41), rbox(0.34, 0.22, 0.03, 0.5, -0.2, 0.29, 0.01, 1), rbox(0.34, 0.22, 0.03, 0.5, 0.2, 0.29, 0.01, 1)),
      solidMat(0.85),
      16,
    );
    this.pool(
      'bench.top',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 5; i++) parts.push(rbox(0.17, 0.1, 0.78, 0.87, -0.4 + i * 0.2, 0, 0.02, 1));
        return merge(...parts);
      })(),
      solidMat(0.75),
      16,
    );
    this.pool(
      'bench.vise',
      merge(
        rbox(0.22, 0.14, 0.2, 0.99, 0.3, 0.26, 0.02, 1),
        cylinder(0.015, 0.015, 0.3, 0, 10).rotateZ(Math.PI / 2).translate(0.3, 0.97, 0.4),
      ),
      tone(0x4a4d55, 0.45, 0.4),
      16,
    );

    // Fishing stage: a plank deck flush with the bank, a corner post, and a rod
    // leaning out over the water. The deck is the only building in the game a
    // settler stands *on* rather than beside, so its top has to land exactly on
    // the `standHeight` in the def — 0.14 — or a fisher's boots sink into their
    // own jetty. The rod and post are aimed at the lake at draw time; everything
    // else here is symmetric, so the stage reads the same from any camera angle.
    this.pool(
      'fish.deck',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 6; i++) parts.push(rbox(0.94, 0.14, 0.145, 0.07, 0, -0.39 + i * 0.156, 0.015, 1));
        return merge(...parts);
      })(),
      solidMat(0.8),
      12,
    );
    this.pool('fish.post', rbox(0.11, 0.52, 0.11, 0.4, -0.32, 0.32, 0.02, 1), solidMat(0.75), 12);
    this.pool(
      'fish.rod',
      (() => {
        // Built pointing down +x so the yaw at draw time swings it over the water.
        const g = cylinder(0.012, 0.024, 1.15, 0, 8);
        g.rotateZ(-Math.PI / 2);
        g.rotateZ(0.34);
        // Lands the butt of the rod against the post and the tip out past the
        // edge of the deck, so it reads as propped rather than floating.
        g.translate(0.2, 0.62, 0.32);
        return g;
      })(),
      tone(0xb9a274, 0.6),
      12,
    );
    // The pail is what makes it read as fishing rather than as a bare pontoon at
    // isometric distance: a rod is four pixels of stick, and a bright object on
    // the deck beside it is the thing the eye actually catches.
    this.pool(
      'fish.pail',
      // Off the centre of the deck: that is where the fisher's feet go.
      merge(cylinder(0.15, 0.12, 0.22, 0.25, 16).translate(0.26, 0, -0.28), cylinder(0.16, 0.16, 0.03, 0.355, 16).translate(0.26, 0, -0.28)),
      tone(0x557a86, 0.55, 0.2),
      12,
    );

    // Watermill: a timber house on the bank and a paddle wheel standing out over
    // the water. Everything is built pointing down local +x, which the water yaw
    // then swings at the lake — the same trick the fishing stage uses, and for
    // the same reason: a wheel that always faced east would be turning in the
    // grass three times out of four.
    this.pool('mill.house', rbox(0.62, 1.05, 0.78, 0.525, -0.3, 0, 0.03, 1), solidMat(0.85), 8);
    // The pitched cap. Not decoration — it is what stops the house reading as
    // another grey cabinet in the isometric distance, where the wheel behind it
    // is only a few pixels of moving edge. It is the one honestly faceted thing
    // here, and it keeps its facets.
    this.pool(
      'mill.roof',
      (() => {
        const g = cone(0.62, 0.34, 1.22, 4);
        g.rotateY(Math.PI / 4);
        g.translate(-0.3, 0, 0);
        return faceted(g);
      })(),
      tone(0x54402c, 0.8),
      8,
    );
    // The shaft out of the house to the hub, with the hub on the end of it. It
    // never spins in its own right — it is round — so it can be baked into place
    // and pushed with the plain yaw rather than carried through the wheel's
    // rotation.
    this.pool(
      'mill.axle',
      merge(
        cylinder(0.08, 0.08, HUB_OUT + 0.3, 0, 16)
          .rotateZ(Math.PI / 2)
          .translate((HUB_OUT - 0.15) / 2 + 0.05, HUB_Y, 0),
        cylinder(0.14, 0.14, 0.1, 0, 20).rotateZ(Math.PI / 2).translate(HUB_OUT, HUB_Y, 0),
      ),
      tone(0x4f4a42, 0.6),
      8,
    );
    // One paddle, drawn eight times per wheel at eight angles, each carrying its
    // own spoke and its eighth of the rim. A merged wheel would be one instance
    // instead of eight, but it would also be one rigid ring: this way the blades
    // catch the light at different angles as they come round, which is most of
    // what makes the thing read as turning at all. Built at the top of the wheel
    // and swept round the axle at draw time, so the geometry's own origin is the
    // hub.
    this.pool(
      'mill.paddle',
      merge(
        rbox(0.44, 0.07, 0.19, WHEEL_R, 0, 0, 0.015, 1),
        box(0.04, WHEEL_R - 0.11, 0.04, (WHEEL_R - 0.11) / 2 + 0.08),
        box(0.04, 0.05, 0.42, WHEEL_R - 0.055, 0.2, 0),
        box(0.04, 0.05, 0.42, WHEEL_R - 0.055, -0.2, 0),
      ),
      tone(0x7d6242, 0.75),
      64,
    );

    // Cooler: a rounded chest with a lid, a rime-frosted band round the middle
    // and a vent grille low on the front. The pale band is what carries it at
    // isometric distance — a plain grey box would read as another stove from
    // three cells away.
    //
    // The lid is what the manager camera sees, and a lid is a lid because of its
    // seam and its handle: a dark line where it meets the body, a bar across the
    // top to lift it by, hinge knuckles along the back edge, and a pane of rime
    // on top where the cold gets through. The compressor on the back face is
    // for the first-person view, where a chest with nothing driving it is a
    // trunk.
    this.pool('cooler.body', rbox(0.92, 1.1, 0.86, 0.55, 0, 0, 0.05), solidMat(0.55), 16);
    this.pool('cooler.lid', rbox(0.98, 0.2, 0.92, 1.22, 0, 0, 0.07), solidMat(0.45), 16);
    this.pool(
      'cooler.frost',
      merge(rbox(0.95, 0.24, 0.89, 0.74, 0, 0, 0.02, 1), rbox(0.68, 0.025, 0.6, 1.325, 0, -0.03, 0.01, 1)),
      tone(0xdaeef5, 0.35),
      16,
    );
    this.pool(
      'cooler.vent',
      merge(
        rbox(0.5, 0.16, 0.04, 0.32, 0, 0.44, 0.01, 1),
        box(0.16, 0.05, 0.04, 1.2, 0, 0.47),
        rbox(0.9, 0.05, 0.84, 1.11, 0, 0, 0.01, 1),
        rbox(0.44, 0.05, 0.07, 1.375, 0, 0.16, 0.02, 1),
        cylinder(0.025, 0.025, 0.06, 1.34, 12).translate(-0.18, 0, 0.16),
        cylinder(0.025, 0.025, 0.06, 1.34, 12).translate(0.18, 0, 0.16),
        cylinder(0.035, 0.035, 0.18, 0, 16).rotateZ(Math.PI / 2).translate(-0.26, 1.31, -0.44),
        cylinder(0.035, 0.035, 0.18, 0, 16).rotateZ(Math.PI / 2).translate(0.26, 1.31, -0.44),
        rbox(0.5, 0.32, 0.1, 0.28, 0, -0.45, 0.03, 1),
        box(0.42, 0.02, 0.04, 0.2, 0, -0.5),
        box(0.42, 0.02, 0.04, 0.28, 0, -0.5),
        box(0.42, 0.02, 0.04, 0.36, 0, -0.5),
      ),
      tone(0x4d5a60, 0.5, 0.3),
      16,
    );

    // Campfire: a ring of fieldstone round a bed of ash, logs laid across it,
    // and a flame that is only pushed while there is something in the firebox —
    // the same trick the generator uses, and for the same reason. A cold fire
    // pit and a lit one have to be different at a glance from the isometric
    // camera, because the whole point of a fire is knowing whether it is out.
    this.pool(
      'fire.ring',
      (() => {
        const parts: THREE.BufferGeometry[] = [cylinder(0.36, 0.38, 0.06, 0.03, 20)];
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU;
          const r = 0.11 + ((i * 7) % 3) * 0.015;
          const stone = sphere(r, 0, 0, 0, 8, 6);
          stone.scale(1.15, 0.72, 1);
          stone.rotateY(a * 1.7);
          stone.translate(Math.cos(a) * 0.4, r * 0.6, Math.sin(a) * 0.4);
          parts.push(stone);
        }
        return merge(...parts);
      })(),
      solidMat(0.95),
      32,
    );
    this.pool(
      'fire.logs',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (const [yaw, y] of [
          [0, 0.15],
          [Math.PI / 2.6, 0.22],
          [-Math.PI / 3.2, 0.29],
        ]) {
          const log = cylinder(0.075, 0.085, 0.6, 0, 12);
          log.rotateZ(Math.PI / 2);
          log.rotateY(yaw);
          log.translate(0, y, 0);
          parts.push(log);
        }
        return merge(...parts);
      })(),
      tone(0x5d4126, 0.9),
      32,
    );
    this.pool(
      'fire.flame',
      lathe([
        [0.02, 0.28],
        [0.2, 0.36],
        [0.26, 0.5],
        [0.18, 0.7],
        [0.08, 0.86],
        [0, 0.98],
      ]),
      new THREE.MeshStandardMaterial({ color: 0xffb658, emissive: new THREE.Color(0xe0620c), roughness: 0.4 }),
      32,
    );

    // Heater: a rounded upright casing with fins down its face and an element
    // behind them that glows when it has watts behind it. Read against the
    // cooler on purpose — same footprint, warm colour, fins instead of frost.
    this.pool('heat.body', rbox(0.78, 1.14, 0.64, 0.57, 0, 0, 0.05), solidMat(0.6), 24);
    this.pool('heat.cap', rbox(0.86, 0.12, 0.72, 1.19, 0, 0, 0.04), solidMat(0.5), 24);
    this.pool(
      'heat.grille',
      (() => {
        const parts: THREE.BufferGeometry[] = [box(0.6, 0.03, 0.06, 0.29, 0, 0.37), box(0.6, 0.03, 0.06, 0.81, 0, 0.37)];
        for (let i = 0; i < 6; i++) parts.push(box(0.035, 0.52, 0.06, 0.55, -0.25 + i * 0.1, 0.37));
        return merge(...parts);
      })(),
      tone(0x40332c, 0.7),
      24,
    );
    this.pool(
      'heat.glow',
      rbox(0.56, 0.46, 0.04, 0.55, 0, 0.33, 0.01, 1),
      new THREE.MeshStandardMaterial({ color: 0xff9b4d, emissive: new THREE.Color(0xd8500a), roughness: 0.4 }),
      24,
    );

    // Turret: a base that stays put, and a head with the barrel under it that
    // turns as one to face whatever the barrel is tracking.
    this.pool('turret.base', merge(cylinder(0.42, 0.48, 0.34, 0.17, 24), cylinder(0.16, 0.22, 0.5, 0.59, 20)), solidMat(0.6), 24);
    this.pool(
      'turret.head',
      merge(rbox(0.48, 0.34, 0.44, 1.0, 0, 0, 0.08), cylinder(0.02, 0.02, 0.2, 1.27, 8), sphere(0.04, 1.36, 0, 0, 10, 8)),
      solidMat(0.5),
      24,
    );
    this.pool(
      'turret.barrel',
      merge(
        cylinder(0.06, 0.07, 0.9, 0, 14).rotateZ(-Math.PI / 2).translate(0.6, 1.0, 0),
        cylinder(0.09, 0.09, 0.14, 0, 14).rotateZ(-Math.PI / 2).translate(1.02, 1.0, 0),
      ),
      solidMat(0.45),
      24,
    );

    // A deadfall reads from the isometric camera as a pale plate with two rows
    // of teeth standing up off it, and from inside a body as something you can
    // see over the top of — which it must, since the sim says it is neither
    // solid nor cover.
    this.pool('trap.plate', rbox(0.9, 0.06, 0.9, 0.03, 0, 0, 0.02, 1), solidMat(0.9), 128);
    this.pool(
      'trap.jaws',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (const z of [-0.36, 0.36]) {
          parts.push(box(0.88, 0.1, 0.08, 0.1, 0, z));
          for (let i = 0; i < 6; i++) parts.push(cone(0.03, 0.14, 0.22, 8).translate(-0.35 + i * 0.14, 0, z));
        }
        return merge(...parts);
      })(),
      solidMat(0.6),
      128,
    );
    this.pool('trap.trigger', rbox(0.26, 0.04, 0.26, 0.08, 0, 0, 0.01, 1), solidMat(0.5), 128);

    // Sandbags: three courses of bags, each course laid across the one below the
    // way a wall of them is actually built, so the stack reads as bags from a
    // body's eye height rather than as two boxes.
    this.pool('sandbag.lower', merge(bag(0.12, 0, -0.31, false), bag(0.12, 0, 0, false), bag(0.12, 0, 0.31, false)), solidMat(0.95), 64);
    this.pool(
      'sandbag.upper',
      merge(bag(0.36, -0.31, 0, true), bag(0.36, 0, 0, true), bag(0.36, 0.31, 0, true), bag(0.6, 0, -0.17, false), bag(0.6, 0, 0.17, false)),
      solidMat(0.95),
      64,
    );

    // A grave is a low mound of turned earth with a headstone standing at its
    // head. The mound's material is a multiplier under the instance tint rather
    // than a colour of its own, which is what gives one palette entry two tones:
    // dark soil for the plot, pale stone for the marker above it.
    //
    // The stone is deliberately the loud part, and it took a screenshot to learn
    // how loud. A knee-high 30 cm marker over a full-cell mound rendered at
    // manager range as four dark squares of dirt and nothing else — a graveyard
    // has to read as a row of uprights or it reads as a scorch mark. So the
    // marker is most of `def.height`, and the mound gives it a cell's width to
    // stand out of rather than covering the whole tile.
    this.pool(
      'grave.mound',
      (() => {
        const g = new THREE.SphereGeometry(0.42, 16, 8, 0, TAU, 0, Math.PI / 2);
        g.scale(1, 0.33, 1.1);
        return g;
      })(),
      tone(0x8a8078, 1.0),
      32,
    );
    this.pool(
      'grave.stone',
      merge(rbox(0.36, 0.6, 0.1, 0.34, 0, -0.3, 0.06), rbox(0.46, 0.08, 0.18, 0.06, 0, -0.3, 0.015, 1)),
      solidMat(0.8),
      32,
    );

    // A statue: a stepped pedestal and a figure on it, one arm raised. It is a
    // figure rather than an obelisk because the whole job of the thing is to be
    // worth looking at, and a person is the shape a person looks at. The
    // pedestal is darkened under the tint so the pale figure stands off it
    // instead of reading as one solid block from above.
    this.pool('statue.plinth', merge(rbox(0.7, 0.34, 0.7, 0.17), rbox(0.56, 0.1, 0.56, 0.39, 0, 0, 0.02, 1)), tone(0x9a968c, 0.9), 16);
    this.pool(
      'statue.figure',
      (() => {
        const body = lathe([
          [0.1, 0.44],
          [0.16, 0.5],
          [0.18, 0.9],
          [0.15, 1.05],
          [0.2, 1.35],
          [0.22, 1.45],
          [0.06, 1.52],
          [0.06, 1.58],
        ]);
        const left = new THREE.CapsuleGeometry(0.05, 0.5, 3, 10);
        left.rotateZ(-0.15);
        left.translate(-0.27, 1.12, 0);
        const right = new THREE.CapsuleGeometry(0.05, 0.5, 3, 10);
        right.rotateZ(-0.4);
        right.translate(0.32, 1.5, 0);
        return merge(body, sphere(0.15, 1.7, 0, 0, 16, 12), left, right);
      })(),
      solidMat(0.55),
      16,
    );

    // Fence: a post at the cell's centre and half-length rails that reach out only
    // towards neighbours that are also part of the line, so two cells of fence meet
    // as one rail and a lone one is a lone post rather than a cross of stubs. The
    // post is the full `def.height` — a fence is a thing you cannot walk through,
    // and it has to look like the barrier the sim says it is.
    this.pool('fence.post', rbox(0.18, 1.15, 0.18, 0.575, 0, 0, 0.03, 1), solidMat(0.88), 256);
    this.pool('fence.rail.hi', rbox(0.56, 0.1, 0.08, 0.92, 0.28, 0, 0.025, 1), solidMat(0.88), 256);
    this.pool('fence.rail.lo', rbox(0.56, 0.1, 0.08, 0.52, 0.28, 0, 0.025, 1), solidMat(0.88), 256);

    // Lamp: a tapered post on a foot, an iron bracket with four ribs caging the
    // globe, and the globe itself.
    this.pool('lamp.post', merge(cylinder(0.045, 0.07, 1.3, 0.65, 16), cylinder(0.13, 0.16, 0.06, 0.03, 20)), solidMat(0.6), 24);
    this.pool(
      'lamp.bracket',
      merge(
        cylinder(0.09, 0.07, 0.08, 1.34, 16),
        box(0.02, 0.36, 0.02, 1.5, 0.2, 0),
        box(0.02, 0.36, 0.02, 1.5, -0.2, 0),
        box(0.02, 0.36, 0.02, 1.5, 0, 0.2),
        box(0.02, 0.36, 0.02, 1.5, 0, -0.2),
        cone(0.1, 0.08, 1.66, 16),
      ),
      tone(0x3c3835, 0.5, 0.4),
      24,
    );
    this.pool(
      'lamp.globe',
      globe(),
      new THREE.MeshStandardMaterial({ color: 0xfff0c4, emissive: new THREE.Color(0xffca7a), roughness: 0.3 }),
      24,
    );
    // The same globe with the light taken out of it. A separate pool rather than a
    // tint, because emissive does not dim with instance colour — a lamp with no
    // watts behind it would otherwise glow just as brightly as one that is lit,
    // which is the exact thing the player is meant to be able to see at a glance.
    this.pool('lamp.dark', globe(), new THREE.MeshStandardMaterial({ color: 0x6b6552, roughness: 0.7 }), 24);

    // Generator: a rounded cast housing with a flywheel on its flank, vents on
    // the front, terminals on the hood and a stack over the firebox. The wheel
    // is what sells it from the isometric camera — a plain box reads as another
    // cabinet, a box with a wheel on it reads as an engine.
    this.pool('gen.body', rbox(0.9, 0.9, 0.82, 0.45, 0, 0, 0.05), solidMat(0.6), 16);
    this.pool('gen.hood', rbox(0.96, 0.16, 0.88, 0.98, 0, 0, 0.04), solidMat(0.5), 16);
    this.pool(
      'gen.wheel',
      merge(
        cylinder(0.28, 0.28, 0.1, 0, 24).rotateZ(Math.PI / 2).translate(0.48, 0.52, 0),
        cylinder(0.08, 0.08, 0.14, 0, 12).rotateZ(Math.PI / 2).translate(0.48, 0.52, 0),
      ),
      tone(0x50545c, 0.45, 0.4),
      16,
    );
    this.pool(
      'gen.stack',
      merge(cylinder(0.1, 0.13, 0.4, 1.25, 16).translate(-0.26, 0, -0.2), cylinder(0.13, 0.13, 0.05, 1.425, 16).translate(-0.26, 0, -0.2)),
      tone(0x3c3a38, 0.8),
      16,
    );
    this.pool(
      'gen.trim',
      (() => {
        const parts: THREE.BufferGeometry[] = [
          cylinder(0.04, 0.04, 0.1, 1.1, 10).translate(0.2, 0, 0.25),
          cylinder(0.04, 0.04, 0.1, 1.1, 10).translate(0.32, 0, 0.25),
        ];
        for (let i = 0; i < 5; i++) parts.push(box(0.4, 0.02, 0.04, 0.6 + i * 0.06, 0, 0.42));
        return merge(...parts);
      })(),
      tone(0x45484f, 0.45, 0.4),
      16,
    );
    // Only pushed while the firebox is actually burning, so "is it running" is a
    // thing you read off the machine rather than off a panel.
    this.pool(
      'gen.fire',
      rbox(0.4, 0.24, 0.08, 0.32, 0, 0.42, 0.02, 1),
      new THREE.MeshStandardMaterial({ color: 0xffb056, emissive: new THREE.Color(0xd45a10), roughness: 0.4 }),
      16,
    );

    // Conduit: a junction puck with cable reaching only towards the neighbours it
    // actually carries power to, the same trick the fence uses for its rails. A
    // run of wire therefore draws itself as one continuous line, and a conduit
    // going nowhere reads as the stub it is.
    this.pool('conduit.pad', cylinder(0.16, 0.18, 0.05, 0.025, 16), solidMat(0.55), 256);
    this.pool(
      'conduit.arm',
      new THREE.CapsuleGeometry(0.03, 0.5, 2, 10).rotateZ(Math.PI / 2).translate(0.28, 0.03, 0),
      solidMat(0.55),
      512,
    );

    // Battery bank: a crate of cells with terminals on the lid and a charge band
    // down the side. The band is pushed with a colour mixed from the actual
    // charge, so a bank you have run flat is a different colour from a full one
    // without opening anything.
    //
    // From the manager camera the whole bank is its lid, and a lid that is a
    // flat rounded slab with two studs on it is a crate. So the lid carries the
    // things a battery has on top: a row of cell caps, two rubber straps holding
    // the lid down, and the terminals with their bar, all standing proud enough
    // to throw a line of shadow from twenty cells up.
    this.pool('batt.body', rbox(0.86, 0.6, 0.78, 0.3, 0, 0, 0.05), solidMat(0.7), 16);
    this.pool('batt.lid', rbox(0.92, 0.12, 0.84, 0.66, 0, 0, 0.05), solidMat(0.6), 16);
    this.pool(
      'batt.trim',
      merge(
        cylinder(0.05, 0.05, 0.14, 0.79, 16).translate(-0.25, 0, -0.22),
        cylinder(0.05, 0.05, 0.14, 0.79, 16).translate(0.25, 0, -0.22),
        cylinder(0.08, 0.08, 0.03, 0.732, 20).translate(-0.25, 0, -0.22),
        cylinder(0.08, 0.08, 0.03, 0.732, 20).translate(0.25, 0, -0.22),
        box(0.6, 0.03, 0.04, 0.87, 0, -0.22),
        rbox(0.07, 0.025, 0.9, 0.73, -0.32, 0, 0.01, 1),
        rbox(0.07, 0.025, 0.9, 0.73, 0.32, 0, 0.01, 1),
        box(0.03, 0.3, 0.5, 0.3, 0.44, 0),
        box(0.03, 0.3, 0.5, 0.3, -0.44, 0),
      ),
      tone(0x45484f, 0.45, 0.4),
      16,
    );
    this.pool(
      'batt.caps',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (const x of [-0.16, 0, 0.16]) {
          for (const z of [0.08, 0.26]) parts.push(cylinder(0.055, 0.06, 0.035, 0.735, 12).translate(x, 0, z));
        }
        return merge(...parts);
      })(),
      tone(0xd9c78a, 0.5),
      16,
    );
    this.pool(
      'batt.band',
      rbox(0.5, 0.14, 0.06, 0.42, 0, 0.4, 0.01, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0x224422), roughness: 0.4 }),
      16,
    );

    // Solar panel: a tilted frame on a short pillar, with a grid of cells laid
    // into it. Tilted rather than flat so it catches the sun light and reads as
    // a panel from the low isometric angle instead of as a dark square on the
    // ground; the cells are low-roughness glass, so they catch it harder still.
    // The pillar runs up into the frame rather than stopping short of it: it
    // used to end at 0.6 under a panel whose underside is at 0.79, which from a
    // body's eye height was a panel hanging in the air over a post.
    this.pool('solar.pillar', merge(cylinder(0.07, 0.1, 0.82, 0.41, 16), cylinder(0.2, 0.22, 0.05, 0.025, 16)), solidMat(0.7), 16);
    this.pool(
      'solar.frame',
      (() => {
        const g = rbox(1.04, 0.06, 0.92, 0, 0, 0, 0.02, 1);
        g.rotateX(-0.36);
        g.translate(0, 0.82, 0);
        return g;
      })(),
      tone(0xd8d8d8, 0.4, 0.5),
      16,
    );
    this.pool(
      'solar.cells',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 3; j++) parts.push(box(0.22, 0.02, 0.26, 0.035, -0.375 + i * 0.25, -0.28 + j * 0.28));
        }
        const g = merge(...parts);
        g.rotateX(-0.36);
        g.translate(0, 0.82, 0);
        return g;
      })(),
      tone(0x99b0ff, 0.15, 0.3),
      16,
    );

    // A tree is a trunk that flares at the root and three tiers of foliage, each
    // a lathe roughed up so the edge of the crown is lobed rather than turned.
    // The tiers rather than one cone is what keeps it a conifer from overhead —
    // the steps between them are the silhouette — and the underside of each
    // tier is closed, because from inside a body you look up into it. The
    // shelves under each tier are eased over three profile points rather than
    // one, and the tips are rounded rather than brought to a mathematical point,
    // so no part of the crown has the hard rim that made it read as a cone with
    // another cone on top. Each tier is rumpled with its own phase, so the lobes
    // of one do not line up with the lobes of the next; the topmost is small and
    // hung off centre, which is what breaks the symmetry a lathe cannot help
    // having.
    this.pool(
      'tree.trunk',
      lathe(
        [
          [0.34, 0],
          [0.27, 0.1],
          [0.22, 0.3],
          [0.19, 0.8],
          [0.16, 1.5],
          [0.13, 2.2],
          [0.1, 2.9],
        ],
        20,
      ),
      solidMat(0.9),
      256,
    );
    this.pool(
      'tree.lower',
      rumple(
        lathe([
          [0.2, 1.0],
          [0.62, 1.02],
          [0.9, 1.1],
          [0.95, 1.3],
          [0.82, 1.75],
          [0.6, 2.3],
          [0.38, 2.75],
          [0.18, 3.05],
          [0.06, 3.18],
          [0, 3.22],
        ]),
        0.12,
        0.3,
      ),
      solidMat(0.85),
      256,
    );
    this.pool(
      'tree.upper',
      rumple(
        lathe([
          [0.15, 2.45],
          [0.45, 2.5],
          [0.62, 2.62],
          [0.6, 2.85],
          [0.46, 3.2],
          [0.3, 3.55],
          [0.15, 3.85],
          [0.05, 4.0],
          [0, 4.05],
        ]),
        0.12,
        2.1,
      ),
      solidMat(0.85),
      256,
    );
    this.pool(
      'tree.top',
      rumple(
        lathe([
          [0.1, 3.35],
          [0.3, 3.4],
          [0.4, 3.56],
          [0.33, 3.88],
          [0.2, 4.15],
          [0.08, 4.36],
          [0, 4.44],
        ]),
        0.1,
        4.4,
      ).translate(0.14, 0, -0.1),
      solidMat(0.85),
      256,
    );

    // Blueprints: one translucent box scaled to the real height of what is coming,
    // so you can see the shape of your plan from either view before it exists.
    this.blueprints = new InstancedPool(
      this.group,
      box(0.92, 1, 0.92, 0.5),
      new THREE.MeshStandardMaterial({
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        roughness: 0.4,
        emissive: new THREE.Color(0x2a4a66),
      }),
      64,
      { tinted: true, castShadow: false },
    );

    const kinds: ResourceKind[] = ['wood', 'steel', 'rawfood', 'meal', 'medicine', 'hide'];
    for (const k of kinds) {
      this.stacks.set(
        k,
        new InstancedPool(
          this.group,
          rbox(0.62, 0.3, 0.62, 0.15, 0, 0, 0.025, 1),
          new THREE.MeshStandardMaterial({ color: RESOURCE_COLOR[k], roughness: 0.85 }),
          48,
          { tinted: false },
        ),
      );
    }
  }

  private pool(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number): void {
    // The geometry carries the key rather than the mesh: a pool that fills up
    // replaces its mesh, and the geometry is the one thing that survives that.
    // It is how a test finds one part among sixty without the map being public.
    geo.name = key;
    this.pools.set(key, new InstancedPool(this.group, geo, mat, cap, { tinted: true }));
  }

  private get(key: string): InstancedPool {
    return this.pools.get(key)!;
  }

  /**
   * The three beds are one bed. A frame with a headboard, a mattress, a blanket
   * turned down over the foot end and a pillow at the head; what makes one a
   * sickbed and another a bunk in a cell is the material each part is given and
   * what is bolted on afterwards, not the carpentry. `head` is the headboard's
   * height above the frame, and zero means none.
   */
  private bedSet(
    prefix: string,
    cap: number,
    head: number,
    frame: THREE.Material,
    mattress: THREE.Material,
    blanket: THREE.Material,
    pillow: THREE.Material,
  ): void {
    const carcass = [rbox(0.9, 0.2, 0.98, 0.1)];
    if (head > 0) carcass.push(rbox(0.9, head, 0.06, 0.2 + head / 2, 0, -0.46));
    this.pool(`${prefix}.frame`, merge(...carcass), frame, cap);
    // The mattress top is the sim's `standHeight` for a bed — 0.34 — because
    // that is the height a sleeper is drawn lying at. Two centimetres over and
    // the body sinks into the ticking; two under and it floats on air. The sim
    // number is the one that is right, so the mesh is built down from it: the
    // blanket and pillow rest on that top, a few millimetres in so the joint is
    // never a coplanar face.
    const top = BED_TOP;
    this.pool(`${prefix}.mattress`, rbox(0.8, 0.16, 0.88, top - 0.08, 0, 0, 0.05), mattress, cap);
    this.pool(`${prefix}.blanket`, rbox(0.82, 0.06, 0.56, top + 0.025, 0, 0.14, 0.03), blanket, cap);
    this.pool(`${prefix}.pillow`, rbox(0.56, 0.12, 0.24, top + 0.06, 0, -0.3, 0.05), pillow, cap);
  }

  private pushBed(prefix: string, b: Building): void {
    this.flat(`${prefix}.frame`, b);
    this.flat(`${prefix}.mattress`, b);
    this.flat(`${prefix}.blanket`, b);
    this.flat(`${prefix}.pillow`, b);
  }

  sync(world: World): void {
    for (const p of this.pools.values()) p.begin();
    this.blueprints.begin();
    for (const p of this.stacks.values()) p.begin();

    for (const b of world.buildings) {
      if (!b.built) {
        this.pushBlueprint(b);
        continue;
      }
      this.pushBuilding(world, b);
    }

    // A cell can hold several stacks of different kinds — meals and raw food on
    // the same larder table is the ordinary case — and drawing them all at one
    // height hid every stack but the last behind the one in front. Pile them
    // instead, each on top of the last, capped so a busy stockpile cell does not
    // grow a tower taller than the settler hauling to it.
    this.pile.clear();
    for (const it of world.items) {
      if (it.carriedBy !== null) continue; // carried stacks ride the pawn's hand
      const pool = this.stacks.get(it.kind);
      if (!pool) continue;
      const lift = 1 + Math.min(2, Math.floor(it.amount / 25)) * 0.18;
      const cell = Math.round(it.y) * world.width + Math.round(it.x);
      const rest = itemRest(world, it.x, it.y);
      const base = this.pile.get(cell) ?? rest;
      this.pile.set(cell, Math.min(rest + PILE_MAX, base + STACK_H * lift));
      this.v.set(it.x, base, it.y);
      this.s.set(1, lift, 1);
      this.q.identity();
      this.m.compose(this.v, this.q, this.s);
      pool.push(this.m);
    }

    for (const p of this.pools.values()) p.end();
    this.blueprints.end();
    for (const p of this.stacks.values()) p.end();
  }

  private tint(b: Building, base = BUILDING_COLOR[b.kind]): THREE.Color {
    this.c.setHex(base);
    if (b.hp < b.maxHp) this.c.lerp(BLACK, 0.4 * (1 - b.hp / b.maxHp));
    // Anything on the grid that is not currently drawing goes dull. It is the same
    // signal for all of them — a cooler that has been shed, a turret with nothing
    // behind it, a generator sitting cold — and it has to be visible from the
    // isometric camera without clicking anything, because "the lights went out and
    // I could see why" is the whole point of the system.
    if (isElectrical(b.kind) && b.powered !== true) this.c.lerp(BLACK, 0.45);
    return this.c;
  }

  private flat(key: string, b: Building, yaw = 0): void {
    this.v.set(b.x, 0, b.y);
    this.q.setFromAxisAngle(UP, yaw);
    this.s.set(1, 1, 1);
    this.m.compose(this.v, this.q, this.s);
    this.get(key).push(this.m, this.tint(b));
  }

  private pushBuilding(world: World, b: Building): void {
    switch (b.kind) {
      case 'wall':
        this.flat('wall.body', b);
        this.flat('wall.planks', b);
        this.flat('wall.cap', b);
        break;
      case 'stonewall':
        this.flat('stone.plinth', b);
        this.flat('stone.body', b);
        this.flat('stone.courses', b);
        this.flat('stone.cap', b);
        break;
      case 'lab':
        this.flat('lab.desk', b);
        this.flat('lab.glass', b);
        this.flat('lab.stand', b);
        this.flat('lab.lamp', b);
        break;
      case 'door': {
        // The hinge swing is read straight from the sim, so a door standing open
        // in the manager view is standing open when you walk up to it in person.
        const open = b.open ?? 0;
        this.v.set(b.x - 0.45, 0, b.y);
        this.q.setFromAxisAngle(UP, -open * (Math.PI / 2));
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        this.get('door.panel').push(this.m, this.tint(b));
        this.get('door.handle').push(this.m, this.tint(b));
        this.flat('door.frame', b);
        break;
      }
      case 'bed':
        this.pushBed('bed', b);
        break;
      case 'medbed':
        this.pushBed('med', b);
        this.flat('med.cross', b);
        break;
      case 'prisonbed':
        this.pushBed('prison', b);
        this.flat('prison.bars', b);
        break;
      case 'table':
        this.flat('table.top', b);
        this.flat('table.legs', b);
        break;
      case 'gametable':
        this.flat('game.top', b);
        this.flat('game.legs', b);
        this.flat('game.board', b);
        this.flat('game.pieces', b);
        this.flat('game.stools', b);
        break;
      case 'stove':
        this.flat('stove.body', b);
        this.flat('stove.door', b);
        this.flat('stove.flue', b);
        this.flat('stove.plate', b);
        break;
      case 'cooler':
        this.flat('cooler.body', b);
        this.flat('cooler.lid', b);
        this.flat('cooler.frost', b);
        this.flat('cooler.vent', b);
        break;
      case 'campfire': {
        this.flat('fire.ring', b);
        this.flat('fire.logs', b);
        // The flame flickers on the clock rather than on a random, so both views
        // and every reload agree on what the fire is doing this instant.
        if ((b.fuel ?? 0) > 0) {
          const flick = 0.86 + Math.sin(world.tick * 0.31 + b.id) * 0.09 + Math.sin(world.tick * 0.13) * 0.05;
          this.v.set(b.x, 0, b.y);
          this.q.setFromAxisAngle(UP, world.tick * 0.04 + b.id);
          this.s.set(1, flick, 1);
          this.m.compose(this.v, this.q, this.s);
          this.get('fire.flame').push(this.m, this.tint(b));
        }
        break;
      }
      case 'heater':
        this.flat('heat.body', b);
        this.flat('heat.cap', b);
        this.flat('heat.grille', b);
        if (b.powered === true) this.flat('heat.glow', b);
        break;
      case 'bench':
        this.flat('bench.body', b);
        this.flat('bench.top', b);
        this.flat('bench.vise', b);
        break;
      case 'fishhole': {
        // The deck is square and goes down flat. Everything with a side to it —
        // the post, the rod slung over it, the pail set down out of the way — is
        // yawed at the water, so the line always hangs over the lake and the
        // pail always sits on the land half of the planks. Same trick the turret
        // barrel uses, for the same reason: a fixed-orientation part on a
        // building the player can put down in four different relationships to
        // the water is wrong three times out of four.
        this.flat('fish.deck', b);
        this.v.set(b.x, 0, b.y);
        this.q.setFromAxisAngle(UP, waterYaw(world, b));
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        this.get('fish.post').push(this.m, this.tint(b));
        this.get('fish.rod').push(this.m, this.tint(b));
        this.get('fish.pail').push(this.m, this.tint(b));
        break;
      }
      case 'turret': {
        this.flat('turret.base', b);
        const yaw = this.aimYaw(world, b);
        this.v.set(b.x, 0, b.y);
        this.q.setFromAxisAngle(UP, yaw);
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        this.get('turret.head').push(this.m, this.tint(b));
        this.get('turret.barrel').push(this.m, this.tint(b));
        break;
      }
      case 'sandbag':
        this.flat('sandbag.lower', b);
        this.flat('sandbag.upper', b);
        break;
      case 'grave':
        this.flat('grave.mound', b);
        this.flat('grave.stone', b);
        break;
      case 'statue':
        this.flat('statue.plinth', b);
        this.flat('statue.figure', b);
        break;
      case 'trap':
        this.flat('trap.plate', b);
        this.flat('trap.jaws', b);
        this.flat('trap.trigger', b);
        break;
      case 'fence':
        this.flat('fence.post', b);
        for (const [dx, dz] of NEIGHBOURS) {
          const n = buildingAt(world, b.x + dx, b.y + dz);
          if (!n || !n.built || !FENCE_LINKS.has(n.kind)) continue;
          // The rail geometry points along +x, so the yaw that swings it onto this
          // neighbour is the one that takes (1,0,0) to (dx,0,dz).
          this.v.set(b.x, 0, b.y);
          this.q.setFromAxisAngle(UP, Math.atan2(-dz, dx));
          this.s.set(1, 1, 1);
          this.m.compose(this.v, this.q, this.s);
          this.get('fence.rail.hi').push(this.m, this.tint(b));
          this.get('fence.rail.lo').push(this.m, this.tint(b));
        }
        break;
      case 'lamp':
        this.flat('lamp.post', b);
        this.flat('lamp.bracket', b);
        this.flat(b.powered === true ? 'lamp.globe' : 'lamp.dark', b);
        break;
      case 'generator':
        this.flat('gen.body', b);
        this.flat('gen.hood', b);
        this.flat('gen.wheel', b);
        this.flat('gen.stack', b);
        this.flat('gen.trim', b);
        if (b.powered === true) this.flat('gen.fire', b);
        break;
      case 'conduit':
        this.flat('conduit.pad', b);
        for (const [dx, dz] of NEIGHBOURS) {
          const n = buildingAt(world, b.x + dx, b.y + dz);
          if (!n || !n.built || !conducts(n.kind)) continue;
          this.v.set(b.x, 0, b.y);
          this.q.setFromAxisAngle(UP, Math.atan2(-dz, dx));
          this.s.set(1, 1, 1);
          this.m.compose(this.v, this.q, this.s);
          this.get('conduit.arm').push(this.m, this.tint(b));
        }
        break;
      case 'battery': {
        this.flat('batt.body', b);
        this.flat('batt.lid', b);
        this.flat('batt.trim', b);
        this.flat('batt.caps', b);
        // Red at empty through to green at full. The band is the only part that
        // moves, so the crate keeps its own colour and the charge reads clean.
        const level = Math.min(1, Math.max(0, (b.charge ?? 0) / BATTERY_CAPACITY));
        this.c.setHex(0xc4482e).lerp(new THREE.Color(0x63c766), level);
        this.v.set(b.x, 0, b.y);
        this.q.identity();
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        this.get('batt.band').push(this.m, this.c);
        break;
      }
      case 'solar':
        this.flat('solar.pillar', b);
        this.flat('solar.frame', b);
        this.flat('solar.cells', b);
        break;
      case 'watermill': {
        const yaw = waterYaw(world, b);
        this.flat('mill.house', b, yaw);
        this.flat('mill.roof', b, yaw);
        this.flat('mill.axle', b, yaw);
        // The wheel turns off the sim clock, not off the frame clock, so it is
        // the same wheel at the same angle in both cameras and on any machine —
        // and it stops dead when the lake sets, which is a hundred and fifty
        // watts of bad news the player can see from across the map without
        // reading the log. The offset by id keeps two mills on one lake from
        // turning in lockstep like one machine drawn twice.
        const phase = ((b.id % 5) / 5) * (TAU / PADDLES);
        let angle = this.wheelAngle.get(b.id) ?? phase;
        if (b.iced !== true) {
          angle = ((world.tick % WHEEL_TICKS) / WHEEL_TICKS) * TAU + phase;
          this.wheelAngle.set(b.id, angle);
        }
        this.hub.set(HUB_OUT, 0, 0).applyAxisAngle(UP, yaw);
        this.v.set(b.x + this.hub.x, HUB_Y, b.y + this.hub.z);
        this.s.set(1, 1, 1);
        const tint = this.tint(b);
        const pool = this.get('mill.paddle');
        for (let i = 0; i < PADDLES; i++) {
          this.spin.setFromAxisAngle(AXLE, angle + (i / PADDLES) * TAU);
          this.q.setFromAxisAngle(UP, yaw).multiply(this.spin);
          this.m.compose(this.v, this.q, this.s);
          pool.push(this.m, tint);
        }
        break;
      }
      case 'tree': {
        const hue = ((b.x * 7 + b.y * 13) % 9) * 0.012 - 0.05;
        // A young tree is smaller and greener, and the floor under both is the
        // point. It bottoms out at 0.55 rather than at the sim's growth number
        // because the cell is solid the whole way up — a seedling you cannot walk
        // through has to look like something you cannot walk through, or the
        // collision and the picture are telling the player different stories.
        // Half height is a young pine at about two and a half metres, which is
        // both visibly not timber and visibly in the way.
        const grow = treeGrowth(b);
        // No two trees in a wood are the same tree, and the eye knows it before
        // it knows anything else about a forest: a row of identical crowns at
        // identical heights reads as a plantation of cutouts however smooth each
        // one is. So each tree draws its own size, lean and shade out of where it
        // stands — a hash of the cell, so the same tree is the same tree on
        // reload and in both cameras. The size runs from a little under to a
        // fifth over the base tree, on top of the growth scale, and the lean is
        // a few degrees at most, about a hashed axis: enough to break the
        // parallel trunks in a first-person view of the treeline, not enough to
        // read as a tree about to fall.
        const size = TREE_SIZE_MIN + (TREE_SIZE_MAX - TREE_SIZE_MIN) * (((b.x * 11 + b.y * 5) % 7) / 6);
        const lean = TREE_LEAN_MAX * (((b.x * 3 + b.y * 17) % 5) / 4);
        const k = (0.55 + 0.45 * grow) * size;
        this.v.set(b.x, 0, b.y);
        // The lean is applied in the tree's own frame and the yaw after it, so
        // the hashed yaw that already turns each crown also picks which way the
        // trunk leans, for free.
        this.spin.setFromAxisAngle(LEAN_AXIS, lean);
        this.q.setFromAxisAngle(UP, (b.x * 1.7 + b.y * 0.9) % (Math.PI * 2)).multiply(this.spin);
        this.s.set(k, k, k);
        this.m.compose(this.v, this.q, this.s);
        this.get('tree.trunk').push(this.m, this.tint(b, BARK));
        // The per-tree hue jitter goes on first and the season over the top, so a
        // wood still reads as a wood of individual trees in October rather than
        // one flat gold cutout — the variation survives the tint.
        this.c.setHex(BUILDING_COLOR.tree).offsetHSL(hue * 0.5, hue * 0.6, hue);
        // New growth is lighter than old growth, and it is the only cue a player
        // gets from the top-down camera that a stand is coming back rather than
        // standing there.
        if (grow < 1) this.c.offsetHSL(0.02 * (1 - grow), 0.05 * (1 - grow), 0.09 * (1 - grow));
        seasonTint(this.c, yearPhase(world));
        this.get('tree.lower').push(this.m, this.c);
        this.get('tree.upper').push(this.m, this.c);
        this.get('tree.top').push(this.m, this.c);
        break;
      }
    }
  }

  /** Cosmetic barrel tracking, cached so an idle turret keeps its last bearing. */
  private aimYaw(world: World, b: Building): number {
    let best: number | null = null;
    let bestD = TURRET_RANGE;
    for (const h of hostiles(world)) {
      const d = dist(b.x, b.y, h.x, h.y);
      if (d < bestD) {
        bestD = d;
        best = Math.atan2(h.y - b.y, h.x - b.x);
      }
    }
    if (best !== null) {
      this.barrelYaw.set(b.id, best);
      return -best;
    }
    return -(this.barrelYaw.get(b.id) ?? 0);
  }

  private pushBlueprint(b: Building): void {
    const def = defOf(b.kind);
    const progress = blueprintProgress(b);
    this.c.setHex(0x4fa3d1).lerp(new THREE.Color(0xe0b25a), progress);
    this.v.set(b.x, 0, b.y);
    this.q.identity();
    this.s.set(1, Math.max(0.35, def.height), 1);
    this.m.compose(this.v, this.q, this.s);
    this.blueprints.push(this.m, this.c);
  }

  dispose(): void {
    for (const p of this.pools.values()) p.dispose();
    this.blueprints.dispose();
    for (const p of this.stacks.values()) p.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** 0 = nothing delivered, 1 = materials in and work finished. */
function blueprintProgress(b: Building): number {
  let need = 0;
  let have = 0;
  for (const k of Object.keys(b.needs) as ResourceKind[]) need += b.needs[k] ?? 0;
  for (const k of Object.keys(b.have) as ResourceKind[]) have += b.have[k] ?? 0;
  const mats = need + have === 0 ? 1 : have / (need + have);
  const work = b.workLeft <= 0 ? 1 : Math.min(1, b.work / b.workLeft);
  return mats * 0.6 + work * 0.4;
}
