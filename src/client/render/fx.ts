/**
 * Everything transient or informational: bullets, fire, zone paint, designation
 * marks, the selection ring and the build cursor.
 *
 * Overlays that exist to explain the game rather than to be part of it live on
 * LAYER_MANAGER, so first person never sees floor paint floating in the air. Fire
 * and projectiles are real sim objects and are drawn in both views.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { bladeGeometry } from './decor';
import { BUILDING_COLOR, TERRAIN_COLOR } from './palette';
import {
  DESIG_DECONSTRUCT,
  DESIG_HARVEST,
  DESIG_TILL,
  terrainAt,
  unpackX,
  unpackY,
} from '../../sim/types';
import { floorForDesig } from '../../sim/floors';
import { CROP_NONE, growingCells } from '../../sim/farming';
import { InstancedPool } from './instanced';
import { LAYER_MANAGER } from './renderer';
import { groundLiftAt, rockTopAt } from './terrain';
import { defOf } from '../../sim/buildings';
import { DRAW } from '../../sim/power';
import type { BuildingKind, World } from '../../sim/types';

const FIRE_PARTICLES = 7;
const MAX_FIRE_PARTICLES = 420;
/**
 * How far above the ground a zone's paint, a designation mark, the selection
 * ring and a drag-preview quad ride.
 *
 * Stacked, so a harvest mark on a growing zone is drawn over the green and not
 * through it, the ring over the paint, and the preview over all of them. "Above
 * the ground" and not "above y = 0": the terrain lifts under snow and sinks into
 * the lake (`groundLiftAt`), by more than any of these clearances, and an overlay
 * measured from the plane instead of the surface spends every winter buried.
 */
const ZONE_LIFT = 0.02;
const RING_LIFT = 0.04;
const MARK_LIFT = 0.05;
const PREVIEW_LIFT = 0.06;
/**
 * How far a mark on a rock rides above the block's flat top.
 *
 * A centimetre, not the ground clearance: the rock's skin is dented *down* from
 * that plane and never up (`terrain.ts` clamps its jitter inside the crate), so
 * anything above the plane is clear of the surface, and a mark five centimetres
 * over a boulder is a mark floating over a boulder from inside a body.
 */
const ROCK_MARK_LIFT = 0.012;
/**
 * How much a preview quad shrinks on a rock cell.
 *
 * The block's top is flat only inside its shoulder — the bevel starts eight
 * hundredths of the footprint in from each edge — and the block is turned up to
 * `ROCK_TILT` off the grid. A ninety-centimetre quad's corner, swung by that yaw,
 * lands on the shoulder where the surface has already dropped, and pokes out of
 * the rock. Eight-tenths keeps the swung corner inside the flat, with room for
 * the dents that shrink it.
 */
const ROCK_MARK_INSET = 0.8 / 0.9;

/** Is this cell a rock block, whose marks ride its top rather than the ground? */
function onRock(world: World, x: number, y: number): boolean {
  return terrainAt(world, x, y) === 'rock';
}

/**
 * How high a cell's overlay mark has to ride.
 *
 * Rock is a solid instanced block, so a ground-level overlay quad sits entirely
 * inside it and never reaches the camera. Anything marking a rock cell rides on
 * top instead — including the drag preview, without which dragging the mine tool
 * across a cliff face looks like it did nothing at all. Blocks are not all the
 * same height, so the mark asks its own cell rather than assuming. `lift` is
 * the mark's own clearance over open ground — over the ground as drawn, which
 * under a snowpack is not where it was in summer.
 */
export function markHeight(world: World, x: number, y: number, lift: number): number {
  return onRock(world, x, y) ? rockTopAt(x, y) + ROCK_MARK_LIFT : groundLiftAt(world, x, y) + lift;
}

/** A ripe crop's colour. Squared blend so it stays green until it is nearly ready. */
const RIPE_COLOR = new THREE.Color(0xe3c451);

export class FxView {
  readonly group = new THREE.Group();
  private readonly bullets: InstancedPool;
  private readonly crops: InstancedPool;
  private readonly bushes: InstancedPool;
  private readonly zonePaint: InstancedPool;
  private readonly designations: InstancedPool;
  private readonly previewPool: InstancedPool;
  private readonly unpowered: InstancedPool;
  private readonly fire: THREE.Points;
  private readonly firePos: Float32Array;
  private readonly ring: THREE.Mesh;
  private readonly cursor: THREE.Mesh;
  private readonly cursorMat: THREE.MeshBasicMaterial;
  private readonly fireTex: THREE.Texture;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly c = new THREE.Color();
  private decor = true;

  constructor() {
    const bulletGeo = new THREE.BoxGeometry(0.34, 0.06, 0.06);
    this.bullets = new InstancedPool(
      this.group,
      bulletGeo,
      new THREE.MeshBasicMaterial({ color: 0xffe6a8 }),
      64,
      { tinted: true, castShadow: false },
    );

    // Plants are part of the world, not an explanation of it, so they stay on the
    // default layer: the possessed colonist walks past the same shoots the manager
    // watches ripen. Height and colour both track growth, which makes "is it ready"
    // readable from either camera without a label.
    // Two-sided because the leaves are sheets with no back face of their own.
    this.crops = new InstancedPool(
      this.group,
      cropPlantGeometry(),
      new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      512,
      { tinted: true, castShadow: false, receiveShadow: false },
    );

    // Wild brambles. A smooth dome, squashed rather than round, so a bush never
    // gets mistaken for a boulder from the manager camera — the stones are lumps
    // and this is a cushion — and on the default layer with the crops, because
    // the possessed colonist has to be able to walk up to one and see the fruit
    // on it. Colour carries ripeness exactly as it does on a sown cell, which is
    // the point of doing it the same way: the player learns "green means wait"
    // once and it holds everywhere.
    const bushGeo = new THREE.IcosahedronGeometry(0.36, 2);
    bushGeo.scale(1, 0.72, 1);
    bushGeo.translate(0, 0.28, 0);
    this.bushes = new InstancedPool(
      this.group,
      bushGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      512,
      { tinted: true, castShadow: false },
    );

    // Flat at y = 0 like the marks below it, and lifted per instance: the paint
    // has to follow the ground it is painted on, and the ground moves.
    const quad = new THREE.PlaneGeometry(0.96, 0.96);
    quad.rotateX(-Math.PI / 2);
    this.zonePaint = new InstancedPool(
      this.group,
      quad,
      new THREE.MeshBasicMaterial({ color: 0x63b6e0, transparent: true, opacity: 0.22, depthWrite: false }),
      256,
      { tinted: true, castShadow: false, layer: LAYER_MANAGER },
    );

    // Marks and preview quads are built flat at y = 0 and lifted per instance,
    // because how far they ride depends on what they are marking (`markHeight`).
    const mark = new THREE.RingGeometry(0.24, 0.42, 4);
    mark.rotateX(-Math.PI / 2);
    this.designations = new InstancedPool(
      this.group,
      mark,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
      64,
      { tinted: true, castShadow: false, layer: LAYER_MANAGER },
    );

    // A dark machine gets a mark hovering over it, the same shape the designation
    // marks use so it reads as part of the same alphabet. Manager-only: standing
    // in front of an unlit lamp in first person, the unlit lamp is the notice.
    const bolt = new THREE.RingGeometry(0.1, 0.22, 4);
    bolt.rotateX(-Math.PI / 2);
    this.unpowered = new InstancedPool(
      this.group,
      bolt,
      new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.9, depthWrite: false }),
      64,
      { tinted: false, castShadow: false, layer: LAYER_MANAGER },
    );

    const previewQuad = new THREE.PlaneGeometry(0.9, 0.9);
    previewQuad.rotateX(-Math.PI / 2);
    this.previewPool = new InstancedPool(
      this.group,
      previewQuad,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }),
      256,
      { tinted: true, castShadow: false, layer: LAYER_MANAGER },
    );

    this.fireTex = radialTexture();
    this.firePos = new Float32Array(MAX_FIRE_PARTICLES * 3);
    const fireGeo = new THREE.BufferGeometry();
    fireGeo.setAttribute('position', new THREE.BufferAttribute(this.firePos, 3));
    fireGeo.setDrawRange(0, 0);
    this.fire = new THREE.Points(
      fireGeo,
      new THREE.PointsMaterial({
        color: 0xff9436,
        size: 0.85,
        map: this.fireTex,
        alphaMap: this.fireTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        fog: false,
      }),
    );
    this.fire.frustumCulled = false;
    this.group.add(this.fire);

    const ringGeo = new THREE.RingGeometry(0.42, 0.52, 28);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xf2e6b0, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.ring.layers.set(LAYER_MANAGER);
    this.ring.visible = false;
    this.group.add(this.ring);

    this.cursorMat = new THREE.MeshBasicMaterial({
      color: 0x8ddc9a,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.cursor = new THREE.Mesh(new THREE.BoxGeometry(0.94, 1, 0.94), this.cursorMat);
    this.cursor.geometry.translate(0, 0.5, 0);
    this.cursor.layers.set(LAYER_MANAGER);
    this.cursor.visible = false;
    this.group.add(this.cursor);
  }

  setDecor(on: boolean): void {
    this.decor = on;
  }

  /** `t` is tick + interpolation alpha: smooth, and identical in both views. */
  sync(world: World, t: number, alpha: number): void {
    this.bullets.begin();
    for (const p of world.projectiles) {
      const x = p.x + p.vx * alpha;
      const y = p.y + p.vy * alpha;
      this.v.set(x, p.z, y);
      this.q.setFromAxisAngle(UP, -Math.atan2(p.vy, p.vx));
      this.s.set(1, 1, 1);
      this.m.compose(this.v, this.q, this.s);
      this.c.setHex(p.faction === 'colony' ? 0xffe6a8 : 0xffb0a0);
      if (p.spent) this.c.multiplyScalar(0.4);
      this.bullets.push(this.m, this.c);
    }
    this.bullets.end();

    this.syncCrops(world);
    this.syncBushes(world);
    this.syncFire(world, t);
    this.syncOverlays(world);
    // The ring is placed by `setSelection`, which is not handed the world; the
    // ground under it is re-read here so a selection made in autumn is still on
    // the surface once the snow has come. Rounded to the cell, because a settler
    // stands between cells and the lattice is asked per cell.
    if (this.ring.visible) {
      this.ring.position.y =
        groundLiftAt(world, Math.round(this.ring.position.x), Math.round(this.ring.position.z)) + RING_LIFT;
    }
  }

  private syncCrops(world: World): void {
    this.crops.begin();
    for (const cell of growingCells(world)) {
      const g = world.crops[cell] ?? CROP_NONE;
      if (g < 0) continue;
      const h = 0.22 + g * 0.62;
      this.v.set(unpackX(world, cell), 0, unpackY(world, cell));
      this.q.identity();
      this.s.set(0.55 + g * 0.45, h, 0.55 + g * 0.45);
      this.m.compose(this.v, this.q, this.s);
      this.c.setHex(0x6f9c3e).lerp(RIPE_COLOR, g * g);
      this.crops.push(this.m, this.c);
    }
    this.crops.end();
  }

  /**
   * The wild bushes. Read straight off `world.bushes` rather than through
   * `ensureBushes`, because a renderer must never be the thing that decides a
   * save gets its brambles — the sim does that on its first tick, and drawing an
   * empty moor for one frame is a much smaller lie than a view with a side effect.
   */
  private syncBushes(world: World): void {
    this.bushes.begin();
    for (const b of world.bushes ?? []) {
      // A stripped bush is still a bush — smaller and grey-green, never gone.
      // Removing it would tell the player the plant died when what happened is
      // that something ate the fruit, and the whole reason to walk past one again
      // in four days is knowing it is still standing there.
      const g = Math.min(1, Math.max(0, b.ripe));
      const size = 0.62 + g * 0.38;
      this.v.set(unpackX(world, b.c), 0, unpackY(world, b.c));
      this.q.identity();
      this.s.set(size, size, size);
      this.m.compose(this.v, this.q, this.s);
      // Dull green through to the same ripe colour the crops reach, but only in
      // the last stretch — `g` cubed, so a bush looks unpicked until it nearly is,
      // and a player scanning the moor for red is scanning for food that is
      // actually there rather than food that will be on Thursday.
      this.c.setHex(0x4d6b34).lerp(RIPE_COLOR, g * g * g);
      this.bushes.push(this.m, this.c);
    }
    this.bushes.end();
  }

  private syncFire(world: World, t: number): void {
    let n = 0;
    const per = this.decor ? FIRE_PARTICLES : 3;
    for (const f of world.fires) {
      for (let i = 0; i < per && n < MAX_FIRE_PARTICLES; i++) {
        // Deterministic per-flame wobble: the same tick draws the same flame.
        const seed = f.id * 7.13 + i * 2.71;
        const rise = ((t * 0.05 + i * 0.37 + f.id * 0.11) % 1);
        const spread = 0.32 * f.size;
        this.firePos[n * 3] = f.x + Math.sin(seed + t * 0.09) * spread;
        this.firePos[n * 3 + 1] = 0.18 + rise * (0.5 + f.size * 1.5);
        this.firePos[n * 3 + 2] = f.y + Math.cos(seed * 1.7 + t * 0.08) * spread;
        n++;
      }
    }
    this.fire.geometry.setDrawRange(0, n);
    (this.fire.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.fire.visible = n > 0;
  }

  private syncOverlays(world: World): void {
    this.zonePaint.begin();
    for (const z of world.zones) {
      // Blue hauling, green growing, straw-gold pen — three zones that are never
      // confusable at a glance from the isometric camera, which is the whole job
      // this colour has to do.
      this.c.setHex(z.kind === 'stockpile' ? 0x63b6e0 : z.kind === 'pen' ? 0xd8b45a : 0x8fd06a);
      for (const cell of z.cells) {
        const x = unpackX(world, cell);
        const y = unpackY(world, cell);
        this.v.set(x, markHeight(world, x, y, ZONE_LIFT), y);
        this.q.identity();
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        this.zonePaint.push(this.m, this.c);
      }
    }
    // A floor order is drawn as the floor it will be, dimmed — a ring mark would
    // say "something happens here", and what the player needs to see is the shape
    // of the corridor before anybody has carried a board to it.
    for (let i = 0; i < world.cellDesig.length; i++) {
      const kind = floorForDesig(world.cellDesig[i]!);
      if (!kind) continue;
      this.c.setHex(TERRAIN_COLOR[kind]);
      const x = unpackX(world, i);
      const y = unpackY(world, i);
      this.v.set(x, markHeight(world, x, y, ZONE_LIFT), y);
      this.q.identity();
      this.s.set(1, 1, 1);
      this.m.compose(this.v, this.q, this.s);
      this.zonePaint.push(this.m, this.c);
    }
    this.zonePaint.end();

    this.designations.begin();
    for (let i = 0; i < world.cellDesig.length; i++) {
      const d = world.cellDesig[i]!;
      if (d === 0 || floorForDesig(d)) continue;
      this.c.setHex(
        d === DESIG_HARVEST
          ? 0xd8e07a
          : d === DESIG_DECONSTRUCT
            ? 0xe08a6a
            : d === DESIG_TILL
              ? 0xb08a5a
              : 0xffffff,
      );
      const x = unpackX(world, i);
      const y = unpackY(world, i);
      this.v.set(x, markHeight(world, x, y, MARK_LIFT), y);
      this.q.setFromAxisAngle(UP, Math.PI / 4);
      this.s.set(1, 1, 1);
      this.m.compose(this.v, this.q, this.s);
      this.designations.push(this.m, this.c);
    }
    this.designations.end();

    // Everything that wants watts and is not getting any. Producers are left out:
    // a generator sitting idle because the grid is already fed is not a problem,
    // and marking it would teach the player to ignore the mark.
    this.unpowered.begin();
    for (const b of world.buildings) {
      if (!b.built || DRAW[b.kind] === undefined || b.powered === true) continue;
      this.v.set(b.x, defOf(b.kind).height + 0.34, b.y);
      this.q.identity();
      this.s.set(1, 1, 1);
      this.m.compose(this.v, this.q, this.s);
      this.unpowered.push(this.m);
    }
    this.unpowered.end();
  }

  /** The cells a pending drag would affect: green where the tool can act, red where not. */
  setPreview(world: World, cells: { x: number; y: number; valid: boolean }[]): void {
    this.previewPool.begin();
    for (const c of cells) {
      this.c.setHex(c.valid ? 0x8ddc9a : 0xd85a4a);
      this.v.set(c.x, markHeight(world, c.x, c.y, PREVIEW_LIFT), c.y);
      this.q.identity();
      const inset = onRock(world, c.x, c.y) ? ROCK_MARK_INSET : 1;
      this.s.set(inset, 1, inset);
      this.m.compose(this.v, this.q, this.s);
      this.previewPool.push(this.m, this.c);
    }
    this.previewPool.end();
  }

  /** Manager selection marker. Pass null to clear it. */
  setSelection(pos: { x: number; y: number; radius?: number } | null): void {
    if (!pos) {
      this.ring.visible = false;
      return;
    }
    this.ring.visible = true;
    // Placed at the summer height; `sync` lifts it onto the ground as drawn.
    this.ring.position.set(pos.x, RING_LIFT, pos.y);
    const r = pos.radius ?? 1;
    this.ring.scale.set(r, 1, r);
  }

  /** The build ghost under the mouse: green where it can go, red where it cannot. */
  setCursor(kind: BuildingKind | null, x: number, y: number, valid: boolean): void {
    if (!kind) {
      this.cursor.visible = false;
      return;
    }
    this.cursor.visible = true;
    this.cursor.position.set(x, 0, y);
    this.cursor.scale.set(1, Math.max(0.4, defOf(kind).height), 1);
    this.cursorMat.color.setHex(valid ? BUILDING_COLOR[kind] : 0xd85a4a);
    this.cursorMat.opacity = valid ? 0.45 : 0.35;
  }

  dispose(): void {
    this.bullets.dispose();
    this.crops.dispose();
    this.bushes.dispose();
    this.zonePaint.dispose();
    this.designations.dispose();
    this.previewPool.dispose();
    this.unpowered.dispose();
    this.fire.geometry.dispose();
    (this.fire.material as THREE.Material).dispose();
    this.fireTex.dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.cursor.geometry.dispose();
    this.cursorMat.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A sown plant: one upright shoot with a ring of leaves fanning out and bowing
 * away from it, welded into a single geometry so a field is still one draw call.
 *
 * Everything is in "one plant tall" units with the roots at the origin, the same
 * contract the cone kept, so `syncCrops` goes on scaling y to growth and x/z to
 * girth. The lean and bow are picked so a fully grown plant reaches about 0.45
 * of a cell from its stem: neighbours in a field just touch, and nothing pokes
 * across a path.
 */
function cropPlantGeometry(): THREE.BufferGeometry {
  const leaves = 5;
  const parts: THREE.BufferGeometry[] = [bladeGeometry(0.3, 4, 0.15)];
  for (let i = 0; i < leaves; i++) {
    const leaf = bladeGeometry(0.42, 4, 0.25);
    leaf.scale(1, 0.7, 1);
    leaf.rotateX(0.3);
    leaf.rotateY((i / leaves) * Math.PI * 2);
    parts.push(leaf);
  }
  const geo = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return geo;
}

/** A soft round sprite, drawn in code so the build ships no image files. */
function radialTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
