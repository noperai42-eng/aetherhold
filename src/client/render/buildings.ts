/**
 * Buildings, blueprints and loose resource stacks.
 *
 * Every mesh here is derived from the same `BUILDING_DEFS` entry the simulation
 * uses for collision, so a wall you can see is a wall you cannot walk through in
 * either view. Heights come from `def.height`; nothing is eyeballed.
 */

import * as THREE from 'three';

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
  bench: 0.875,
};

/** A box whose geometry has been shifted so instance matrices are plain placements. */
function box(w: number, h: number, d: number, y: number, x = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
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

function cylinder(rTop: number, rBottom: number, h: number, y: number, seg = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  g.translate(0, y, 0);
  return g;
}

function cone(r: number, h: number, y: number, seg = 8): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, y, 0);
  return g;
}

/** The lamp's bulb. Built twice — once lit, once not — so `globe()` rather than a const. */
function globe(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.17, 10, 8);
  g.translate(0, 1.6, 0);
  return g;
}

function solidMat(rough: number, flat: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: rough, metalness: 0.04, flatShading: flat });
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
    // Walls read as rammed earth with a stone coping line along the top.
    this.pool('wall.body', box(1, 2.44, 1, 1.22), solidMat(0.92, true), 256);
    this.pool('wall.cap', box(1.06, 0.16, 1.06, 2.52), solidMat(0.8, true), 256);

    // Stone wall: the same silhouette as timber so a mixed perimeter still reads as
    // one wall, but with a proud plinth at the base and a heavier coping. It is the
    // colour that carries the difference — see BUILDING_COLOR.stonewall.
    this.pool('stone.plinth', box(1.04, 0.34, 1.04, 0.17), solidMat(0.95, true), 256);
    this.pool('stone.body', box(0.94, 2.2, 0.94, 1.44), solidMat(0.95, true), 256);
    this.pool('stone.cap', box(1.1, 0.2, 1.1, 2.62), solidMat(0.85, true), 256);

    // Research bench: a sloped drafting surface with a small brass lamp over it, so
    // it reads as thinking-work rather than another workbench from across the map.
    this.pool('lab.body', box(0.92, 0.62, 0.72, 0.31), solidMat(0.85, false), 8);
    this.pool(
      'lab.slope',
      (() => {
        const g = box(1, 0.1, 0.86, 0.72);
        g.rotateX(-0.28);
        return g;
      })(),
      solidMat(0.6, false),
      8,
    );
    this.pool(
      'lab.lamp',
      box(0.2, 0.09, 0.2, 1.06, -0.3, -0.22),
      new THREE.MeshStandardMaterial({
        color: 0xc9a866,
        emissive: new THREE.Color(0x6a4a12),
        roughness: 0.35,
      }),
      8,
    );

    // Door: the panel's geometry is offset so its origin sits on the hinge edge,
    // which lets the sim's 0..1 `open` value drive a real swing.
    this.pool('door.panel', box(0.94, 2.3, 0.14, 1.15, 0.47), solidMat(0.7, false), 32);
    this.pool('door.lintel', box(1, 0.3, 0.5, 2.45), solidMat(0.85, true), 32);

    this.pool('bed.frame', box(0.86, 0.28, 0.94, 0.2), solidMat(0.8, false), 32);
    this.pool('bed.pillow', box(0.68, 0.14, 0.26, 0.41, 0, -0.31), solidMat(0.9, false), 32);

    // Hospital bed: pale linen, a raised head end and a red cross on the blanket.
    // The cross is what carries it from the isometric camera — a white bed at
    // that distance is a bed with the lights on, but a bed with a red mark on it
    // is a sickbay, and a player scanning for somewhere to put a patient finds it
    // without clicking anything.
    this.pool('med.frame', box(0.86, 0.3, 0.94, 0.21), solidMat(0.85, false), 8);
    this.pool('med.pillow', box(0.68, 0.2, 0.26, 0.46, 0, -0.32), solidMat(1.0, false), 8);
    this.pool(
      'med.crossA',
      box(0.34, 0.04, 0.1, 0.38, 0, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xb2413c, roughness: 0.75, flatShading: true }),
      8,
    );
    this.pool(
      'med.crossB',
      box(0.1, 0.04, 0.34, 0.38, 0, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xb2413c, roughness: 0.75, flatShading: true }),
      8,
    );

    // Prison bunk: the same bed, plus the thing that makes it a cell. The bars
    // are what carries the read from the isometric camera — a grey bed is just a
    // bed you cannot see the colour of, but a bed with a grille at the head of it
    // is unmistakably somewhere you put a person you do not trust.
    this.pool('prison.frame', box(0.86, 0.26, 0.94, 0.19), solidMat(0.8, false), 16);
    this.pool('prison.pillow', box(0.6, 0.12, 0.24, 0.38, 0, -0.31), solidMat(0.9, false), 16);
    this.pool(
      'prison.bars',
      box(0.9, 0.72, 0.08, 0.36, 0, -0.46),
      new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.5, flatShading: true }),
      16,
    );

    this.pool('table.top', box(0.98, 0.1, 0.98, 0.85), solidMat(0.7, false), 32);
    this.pool('table.leg', box(0.32, 0.85, 0.32, 0.42), solidMat(0.8, false), 32);

    // A games table: a smaller top than the dining table, a dark board laid on
    // it, and a stool either side. The board is the whole point — from the
    // manager camera the two tables are the same silhouette, and the dark square
    // on top is what tells you which one your settlers are playing at. Its
    // material multiplies under the palette tint, the same trick the grave uses
    // to get two tones from one entry.
    this.pool('game.top', box(0.74, 0.09, 0.74, 0.72), solidMat(0.7, false), 24);
    this.pool('game.leg', box(0.26, 0.72, 0.26, 0.36), solidMat(0.8, false), 24);
    this.pool(
      'game.board',
      box(0.5, 0.04, 0.5, 0.785),
      new THREE.MeshStandardMaterial({ color: 0x4e6b46, roughness: 0.95, flatShading: true }),
      24,
    );
    this.pool('game.stool.l', box(0.22, 0.34, 0.22, 0.17, -0.36), solidMat(0.85, true), 24);
    this.pool('game.stool.r', box(0.22, 0.34, 0.22, 0.17, 0.36), solidMat(0.85, true), 24);

    this.pool('stove.body', box(0.9, 0.92, 0.9, 0.46), solidMat(0.5, false), 16);
    this.pool(
      'stove.plate',
      box(0.72, 0.07, 0.72, 0.96),
      new THREE.MeshStandardMaterial({
        color: 0x3a3a40,
        emissive: new THREE.Color(0x2a0d05),
        roughness: 0.4,
      }),
      16,
    );

    // Workbench: a heavy plank top on a cabinet, with a dark steel vise clamped to
    // the near edge so it reads as "things are made here" from the isometric camera.
    this.pool('bench.body', box(0.9, 0.74, 0.6, 0.37), solidMat(0.85, false), 16);
    this.pool('bench.top', box(1, 0.13, 0.78, 0.81), solidMat(0.75, false), 16);
    this.pool(
      'bench.vise',
      box(0.24, 0.2, 0.24, 0.98, 0.3, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.45, flatShading: true }),
      16,
    );

    // Fishing stage: a plank deck flush with the bank, a corner post, and a rod
    // leaning out over the water. The deck is the only building in the game a
    // settler stands *on* rather than beside, so its top has to land exactly on
    // the `standHeight` in the def — 0.14 — or a fisher's boots sink into their
    // own jetty. The rod and post are aimed at the lake at draw time; everything
    // else here is symmetric, so the stage reads the same from any camera angle.
    this.pool('fish.deck', box(0.94, 0.14, 0.94, 0.07), solidMat(0.8, false), 12);
    this.pool('fish.post', box(0.11, 0.52, 0.11, 0.4, -0.32, 0.32), solidMat(0.75, false), 12);
    this.pool(
      'fish.rod',
      (() => {
        // Built pointing down +x so the yaw at draw time swings it over the water.
        const g = box(1.15, 0.05, 0.05, 0);
        g.rotateZ(0.34);
        // Lands the butt of the rod against the post and the tip out past the
        // edge of the deck, so it reads as propped rather than floating.
        g.translate(0.2, 0.62, 0.32);
        return g;
      })(),
      new THREE.MeshStandardMaterial({ color: 0xb9a274, roughness: 0.6, flatShading: true }),
      12,
    );
    // The pail is what makes it read as fishing rather than as a bare pontoon at
    // isometric distance: a rod is four pixels of stick, and a bright object on
    // the deck beside it is the thing the eye actually catches.
    this.pool(
      'fish.pail',
      (() => {
        // Off the centre of the deck: that is where the fisher's feet go.
        const g = cylinder(0.15, 0.12, 0.22, 0.25, 8);
        g.translate(0.26, 0, -0.28);
        return g;
      })(),
      new THREE.MeshStandardMaterial({ color: 0x557a86, roughness: 0.55, flatShading: true }),
      12,
    );

    // Watermill: a timber house on the bank and a paddle wheel standing out over
    // the water. Everything is built pointing down local +x, which the water yaw
    // then swings at the lake — the same trick the fishing stage uses, and for
    // the same reason: a wheel that always faced east would be turning in the
    // grass three times out of four.
    this.pool(
      'mill.house',
      box(0.62, 1.05, 0.78, 0.525, -0.3, 0),
      solidMat(0.85, true),
      8,
    );
    // The pitched cap. Not decoration — it is what stops the house reading as
    // another grey cabinet in the isometric distance, where the wheel behind it
    // is only a few pixels of moving edge.
    this.pool(
      'mill.roof',
      (() => {
        const g = cone(0.62, 0.34, 1.22, 4);
        g.rotateY(Math.PI / 4);
        g.translate(-0.3, 0, 0);
        return g;
      })(),
      new THREE.MeshStandardMaterial({ color: 0x54402c, roughness: 0.8, flatShading: true }),
      8,
    );
    // The shaft out of the house to the hub. It never spins in its own right —
    // it is round — so it can be baked into place and pushed with the plain yaw
    // rather than carried through the wheel's rotation.
    this.pool(
      'mill.axle',
      (() => {
        const g = cylinder(0.08, 0.08, HUB_OUT + 0.3, 0, 8);
        g.rotateZ(Math.PI / 2);
        g.translate((HUB_OUT - 0.15) / 2 + 0.05, HUB_Y, 0);
        return g;
      })(),
      new THREE.MeshStandardMaterial({ color: 0x4f4a42, roughness: 0.6, flatShading: true }),
      8,
    );
    // One paddle, drawn eight times per wheel at eight angles. A merged rim would
    // be one instance instead of eight, but it would also be one rigid ring: this
    // way the blades catch the light at different angles as they come round,
    // which is most of what makes the thing read as turning at all. Built at the
    // top of the wheel and swept round the axle at draw time, so the geometry's
    // own origin is the hub.
    this.pool(
      'mill.paddle',
      box(0.44, 0.07, 0.19, WHEEL_R),
      new THREE.MeshStandardMaterial({ color: 0x7d6242, roughness: 0.75, flatShading: true }),
      64,
    );

    // Cooler: a cabinet with a vent grille on top and a rime-frosted door panel.
    // The pale band is what carries it at isometric distance — a plain grey box
    // would read as another stove from three cells away.
    this.pool('cooler.body', box(0.92, 1.12, 0.86, 0.56), solidMat(0.55, false), 16);
    this.pool(
      'cooler.frost',
      box(0.96, 0.3, 0.9, 0.72),
      new THREE.MeshStandardMaterial({ color: 0xdaeef5, roughness: 0.35, flatShading: true }),
      16,
    );
    this.pool(
      'cooler.vent',
      box(0.62, 0.14, 0.62, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x4d5a60, roughness: 0.5, flatShading: true }),
      16,
    );

    // Campfire: a ring of fieldstone with logs stacked in it, and a flame that is
    // only pushed while there is something in the firebox — the same trick the
    // generator uses, and for the same reason. A cold fire pit and a lit one have
    // to be different at a glance from the isometric camera, because the whole
    // point of a fire is knowing whether it is out.
    this.pool('fire.ring', cylinder(0.44, 0.5, 0.26, 0.13, 9), solidMat(0.95, true), 32);
    this.pool(
      'fire.logs',
      (() => {
        const g = new THREE.CylinderGeometry(0.09, 0.09, 0.62, 6);
        g.rotateZ(Math.PI / 2);
        g.translate(0, 0.24, 0);
        return g;
      })(),
      new THREE.MeshStandardMaterial({ color: 0x5d4126, roughness: 0.9, flatShading: true }),
      32,
    );
    this.pool(
      'fire.logs2',
      (() => {
        const g = new THREE.CylinderGeometry(0.09, 0.09, 0.62, 6);
        g.rotateZ(Math.PI / 2);
        g.rotateY(Math.PI / 2.6);
        g.translate(0, 0.3, 0);
        return g;
      })(),
      new THREE.MeshStandardMaterial({ color: 0x4c3520, roughness: 0.9, flatShading: true }),
      32,
    );
    this.pool(
      'fire.flame',
      cone(0.26, 0.62, 0.62, 6),
      new THREE.MeshStandardMaterial({ color: 0xffb658, emissive: new THREE.Color(0xe0620c), roughness: 0.4 }),
      32,
    );

    // Heater: an upright casing with fins down its face and a grille that glows
    // when it has watts behind it. Read against the cooler on purpose — same
    // footprint, warm colour, fins instead of frost.
    this.pool('heat.body', box(0.8, 1.0, 0.66, 0.5), solidMat(0.6, false), 24);
    this.pool('heat.cap', box(0.88, 0.14, 0.74, 1.07), solidMat(0.5, true), 24);
    this.pool(
      'heat.grille',
      box(0.56, 0.5, 0.06, 0.55, 0, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x40332c, roughness: 0.7, flatShading: true }),
      24,
    );
    this.pool(
      'heat.glow',
      box(0.5, 0.42, 0.05, 0.55, 0, 0.37),
      new THREE.MeshStandardMaterial({ color: 0xff9b4d, emissive: new THREE.Color(0xd8500a), roughness: 0.4 }),
      24,
    );

    this.pool('turret.base', cylinder(0.38, 0.44, 0.5, 0.25), solidMat(0.6, false), 24);
    this.pool('turret.barrel', box(1.05, 0.16, 0.16, 0.78, 0.42), solidMat(0.45, false), 24);

    // A deadfall reads from the isometric camera as a pale plate with two raised
    // jaws, and from inside a body as something you can see over the top of —
    // which it must, since the sim says it is neither solid nor cover.
    this.pool('trap.plate', box(0.9, 0.07, 0.9, 0.035), solidMat(0.9, true), 128);
    this.pool('trap.jaw.n', box(0.88, 0.24, 0.1, 0.19, 0, -0.36), solidMat(0.7, true), 128);
    this.pool('trap.jaw.s', box(0.88, 0.24, 0.1, 0.19, 0, 0.36), solidMat(0.7, true), 128);
    this.pool('trap.trigger', box(0.28, 0.05, 0.28, 0.1), solidMat(0.5, false), 128);

    this.pool('sandbag.lower', box(0.96, 0.55, 0.96, 0.27), solidMat(0.95, true), 64);
    this.pool('sandbag.upper', box(0.78, 0.28, 0.78, 0.69), solidMat(0.95, true), 64);

    // A grave is a low mound of turned earth with a marker standing at its head.
    // The mound's material is a multiplier under the instance tint rather than a
    // colour of its own, which is what gives one palette entry two tones: dark
    // soil for the plot, pale timber for the cross above it.
    //
    // The cross is deliberately the loud part, and it took a screenshot to learn
    // how loud. A knee-high 30 cm marker over a full-cell mound rendered at
    // manager range as four dark squares of dirt and nothing else — a graveyard
    // has to read as a row of uprights or it reads as a scorch mark. So the
    // marker is now most of `def.height`, and the mound gives it a cell's width
    // to stand out of rather than covering the whole tile.
    this.pool(
      'grave.mound',
      box(0.76, 0.12, 0.76, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x8a8078, roughness: 1.0, flatShading: true }),
      32,
    );
    this.pool('grave.post', box(0.1, 0.62, 0.1, 0.31, 0, -0.24), solidMat(0.8, true), 32);
    this.pool('grave.bar', box(0.36, 0.1, 0.1, 0.5, 0, -0.24), solidMat(0.8, true), 32);

    // A statue: plinth, body, head, and two arms lifted a little away from the
    // sides. It is a figure rather than an obelisk because the whole job of the
    // thing is to be worth looking at, and a person is the shape a person looks
    // at. The plinth is darkened under the tint so the pale figure stands off it
    // instead of reading as one solid block from above.
    this.pool(
      'statue.plinth',
      box(0.7, 0.34, 0.7, 0.17),
      new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.9, flatShading: true }),
      16,
    );
    this.pool('statue.body', box(0.3, 0.86, 0.24, 0.77), solidMat(0.55, true), 16);
    this.pool('statue.head', box(0.2, 0.22, 0.2, 1.31), solidMat(0.55, true), 16);
    this.pool('statue.arm.l', box(0.09, 0.6, 0.09, 0.86, -0.22), solidMat(0.55, true), 16);
    this.pool('statue.arm.r', box(0.09, 0.6, 0.09, 0.86, 0.22), solidMat(0.55, true), 16);

    // Fence: a post at the cell's centre and half-length rails that reach out only
    // towards neighbours that are also part of the line, so two cells of fence meet
    // as one rail and a lone one is a lone post rather than a cross of stubs. The
    // post is the full `def.height` — a fence is a thing you cannot walk through,
    // and it has to look like the barrier the sim says it is.
    this.pool('fence.post', box(0.19, 1.15, 0.19, 0.575), solidMat(0.88, true), 256);
    this.pool('fence.rail.hi', box(0.56, 0.11, 0.09, 0.92, 0.28), solidMat(0.88, true), 256);
    this.pool('fence.rail.lo', box(0.56, 0.11, 0.09, 0.52, 0.28), solidMat(0.88, true), 256);

    this.pool('lamp.post', cylinder(0.06, 0.09, 1.45, 0.72, 6), solidMat(0.6, false), 24);
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

    // Generator: a cast housing with a flywheel on its flank and a stack over the
    // firebox. The wheel is what sells it from the isometric camera — a plain box
    // reads as another cabinet, a box with a wheel on it reads as an engine.
    this.pool('gen.body', box(0.9, 0.92, 0.82, 0.46), solidMat(0.6, false), 16);
    this.pool('gen.hood', box(0.96, 0.18, 0.88, 1.0), solidMat(0.5, true), 16);
    this.pool(
      'gen.wheel',
      (() => {
        const g = new THREE.CylinderGeometry(0.28, 0.28, 0.12, 12);
        g.rotateZ(Math.PI / 2);
        g.translate(0.5, 0.52, 0);
        return g;
      })(),
      new THREE.MeshStandardMaterial({ color: 0x50545c, roughness: 0.45, flatShading: true }),
      16,
    );
    this.pool(
      'gen.stack',
      (() => {
        const g = new THREE.CylinderGeometry(0.1, 0.13, 0.42, 8);
        g.translate(-0.26, 1.28, -0.2);
        return g;
      })(),
      new THREE.MeshStandardMaterial({ color: 0x3c3a38, roughness: 0.8, flatShading: true }),
      16,
    );
    // Only pushed while the firebox is actually burning, so "is it running" is a
    // thing you read off the machine rather than off a panel.
    this.pool(
      'gen.fire',
      box(0.4, 0.24, 0.1, 0.36, 0, 0.42),
      new THREE.MeshStandardMaterial({ color: 0xffb056, emissive: new THREE.Color(0xd45a10), roughness: 0.4 }),
      16,
    );

    // Conduit: a floor strip with arms reaching only towards the neighbours it
    // actually carries power to, the same trick the fence uses for its rails. A run
    // of wire therefore draws itself as one continuous line, and a conduit going
    // nowhere reads as the stub it is.
    this.pool('conduit.pad', box(0.34, 0.05, 0.34, 0.025), solidMat(0.55, true), 256);
    this.pool('conduit.arm', box(0.56, 0.045, 0.14, 0.022, 0.28), solidMat(0.55, true), 512);

    // Battery bank: a crate of cells with a charge band down the side. The band is
    // pushed with a colour mixed from the actual charge, so a bank you have run
    // flat is a different colour from a full one without opening anything.
    this.pool('batt.body', box(0.86, 0.6, 0.78, 0.3), solidMat(0.7, false), 16);
    this.pool('batt.lid', box(0.92, 0.12, 0.84, 0.66), solidMat(0.6, true), 16);
    this.pool(
      'batt.band',
      box(0.5, 0.14, 0.06, 0.42, 0, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0x224422), roughness: 0.4 }),
      16,
    );

    // Solar panel: one tilted plate on a short pillar. Tilted rather than flat so
    // it catches the sun light and reads as a panel from the low isometric angle
    // instead of as a dark square on the ground.
    this.pool('solar.pillar', box(0.18, 0.6, 0.18, 0.3), solidMat(0.7, false), 16);
    this.pool(
      'solar.panel',
      (() => {
        const g = box(1.02, 0.07, 0.9, 0.82);
        g.rotateX(-0.36);
        return g;
      })(),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.2, flatShading: true }),
      16,
    );

    this.pool('tree.trunk', cylinder(0.15, 0.22, 1.7, 0.85, 7), solidMat(0.9, false), 256);
    this.pool('tree.lower', cone(0.95, 2.2, 2.1, 8), solidMat(0.85, true), 256);
    this.pool('tree.upper', cone(0.62, 1.5, 3.3, 8), solidMat(0.85, true), 256);

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
          box(0.62, 0.3, 0.62, 0.15),
          new THREE.MeshStandardMaterial({ color: RESOURCE_COLOR[k], roughness: 0.85, flatShading: true }),
          48,
          { tinted: false },
        ),
      );
    }
  }

  private pool(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number): void {
    this.pools.set(key, new InstancedPool(this.group, geo, mat, cap, { tinted: true }));
  }

  private get(key: string): InstancedPool {
    return this.pools.get(key)!;
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

  private tint(b: Building): THREE.Color {
    this.c.setHex(BUILDING_COLOR[b.kind]);
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
        this.flat('wall.cap', b);
        break;
      case 'stonewall':
        this.flat('stone.plinth', b);
        this.flat('stone.body', b);
        this.flat('stone.cap', b);
        break;
      case 'lab':
        this.flat('lab.body', b);
        this.flat('lab.slope', b);
        this.flat('lab.lamp', b);
        break;
      case 'door': {
        // The hinge swing is read straight from the sim, so a door standing open
        // in the manager view is standing open when you walk up to it in person.
        const open = b.open ?? 0;
        this.v.set(b.x - 0.47, 0, b.y);
        this.q.setFromAxisAngle(UP, -open * (Math.PI / 2));
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        this.get('door.panel').push(this.m, this.tint(b));
        this.flat('door.lintel', b);
        break;
      }
      case 'bed':
        this.flat('bed.frame', b);
        this.flat('bed.pillow', b);
        break;
      case 'medbed':
        this.flat('med.frame', b);
        this.flat('med.pillow', b);
        this.flat('med.crossA', b);
        this.flat('med.crossB', b);
        break;
      case 'prisonbed':
        this.flat('prison.frame', b);
        this.flat('prison.pillow', b);
        this.flat('prison.bars', b);
        break;
      case 'table':
        this.flat('table.top', b);
        this.flat('table.leg', b);
        break;
      case 'gametable':
        this.flat('game.top', b);
        this.flat('game.leg', b);
        this.flat('game.board', b);
        this.flat('game.stool.l', b);
        this.flat('game.stool.r', b);
        break;
      case 'stove':
        this.flat('stove.body', b);
        this.flat('stove.plate', b);
        break;
      case 'cooler':
        this.flat('cooler.body', b);
        this.flat('cooler.frost', b);
        this.flat('cooler.vent', b);
        break;
      case 'campfire': {
        this.flat('fire.ring', b);
        this.flat('fire.logs', b);
        this.flat('fire.logs2', b);
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
        this.get('turret.barrel').push(this.m, this.tint(b));
        break;
      }
      case 'sandbag':
        this.flat('sandbag.lower', b);
        this.flat('sandbag.upper', b);
        break;
      case 'grave':
        this.flat('grave.mound', b);
        this.flat('grave.post', b);
        this.flat('grave.bar', b);
        break;
      case 'statue':
        this.flat('statue.plinth', b);
        this.flat('statue.body', b);
        this.flat('statue.head', b);
        this.flat('statue.arm.l', b);
        this.flat('statue.arm.r', b);
        break;
      case 'trap':
        this.flat('trap.plate', b);
        this.flat('trap.jaw.n', b);
        this.flat('trap.jaw.s', b);
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
        this.flat(b.powered === true ? 'lamp.globe' : 'lamp.dark', b);
        break;
      case 'generator':
        this.flat('gen.body', b);
        this.flat('gen.hood', b);
        this.flat('gen.wheel', b);
        this.flat('gen.stack', b);
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
        this.flat('solar.panel', b);
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
        const k = 0.55 + 0.45 * grow;
        this.v.set(b.x, 0, b.y);
        this.q.setFromAxisAngle(UP, (b.x * 1.7 + b.y * 0.9) % (Math.PI * 2));
        this.s.set(k, k, k);
        this.m.compose(this.v, this.q, this.s);
        this.get('tree.trunk').push(this.m, this.tint(b));
        // The per-tree hue jitter goes on first and the season over the top, so a
        // wood still reads as a wood of individual trees in October rather than
        // one flat gold cutout — the variation survives the tint.
        this.c.setHex(BUILDING_COLOR.tree).offsetHSL(hue * 0.4, 0, hue);
        // New growth is lighter than old growth, and it is the only cue a player
        // gets from the top-down camera that a stand is coming back rather than
        // standing there.
        if (grow < 1) this.c.offsetHSL(0.02 * (1 - grow), 0.05 * (1 - grow), 0.09 * (1 - grow));
        seasonTint(this.c, yearPhase(world));
        this.get('tree.lower').push(this.m, this.c);
        this.get('tree.upper').push(this.m, this.c);
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
