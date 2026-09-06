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

import { bladeGeometry, lumpyGeometry } from './decor';
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

/**
 * The leaf colour a sown plant is tinted, from its first sprouts to the day it
 * is ready. Green at every stage and only deepening as the plant fills out: the
 * yellow-olive a crop used to ripen *into* made a finished field read as a dead
 * one, and a player scanning for food was scanning for the colour of drought.
 * What turns gold is the produce and nothing else.
 */
const LEAF_YOUNG = new THREE.Color(0x8cbb57);
const LEAF_RIPE = new THREE.Color(0x63903a);
/**
 * A ripe grain's colour. Straw gold, not lemon: the brighter yellow this used to
 * be lit a ripe plot up like a warning light, and a field of wheat is warm
 * rather than neon.
 */
const RIPE_GRAIN = new THREE.Color(0xc9a445);
/**
 * The head's vertex colour — a multiplier on the plant's tint, like every other
 * part (see `paint`), so it is written as the ratio that turns the one into the
 * other rather than as three numbers that would silently stop meaning "gold" the
 * next time the leaves changed. Componentwise, and in whatever space three is
 * holding these colours in, because that is the space the shader multiplies them
 * in too. It is a large number in red because the green it has to overcome has
 * almost none; over the lighter tint of a plant that has only just headed the
 * same ratio gives a paler gold, which is what a head still filling should be.
 */
const HEAD_GOLD = new THREE.Vector3(
  RIPE_GRAIN.r / LEAF_RIPE.r,
  RIPE_GRAIN.g / LEAF_RIPE.g,
  RIPE_GRAIN.b / LEAF_RIPE.b,
);
/**
 * Growth at which a sown cell stops being sprouts and becomes a leafy plant,
 * and at which the plant puts up heads. Three shapes, not three sizes: a
 * seedling scaled up is still a seedling, and "is it ready" has to be readable
 * from twenty cells up, where size is the one thing the eye cannot judge.
 */
const CROP_LEAFY_AT = 0.3;
const CROP_HEADED_AT = 0.7;
/**
 * Ripeness at which a bush's berries start to show. Below it the fruit is too
 * green and too small to be anything but the bush's own colour; from here it
 * reddens, so a player scanning the moor for food is scanning for red.
 */
const BERRIES_AT = 0.35;
const BERRY_GREEN = new THREE.Color(0x5f7a3a);
const BERRY_RIPE = new THREE.Color(0x8c1e3c);
/** A bush in full leaf. Deeper than the lawn, so the thicket stands off the turf. */
const BUSH_GREEN = new THREE.Color(0x3f6a2e);
/**
 * A bush that has just been picked over. Grey-green rather than the near-black
 * olive it was: the crown carries this colour and the base half of it (the
 * shading baked into `bushGeometry`), and half of a dark olive is a boulder —
 * a stripped bush sat in the frame looking exactly like the loose stones. Paler
 * and greyer than `BUSH_GREEN` so "picked" still reads at a glance, but plainly
 * foliage; that it is also the smaller of the two is what `syncBushes` scales.
 */
const BUSH_STRIPPED = new THREE.Color(0x84986a);

export class FxView {
  readonly group = new THREE.Group();
  private readonly bullets: InstancedPool;
  /** One pool per growth stage, `CROP_STAGES` long. */
  private readonly crops: InstancedPool[];
  private readonly bushes: InstancedPool;
  private readonly berries: InstancedPool;
  private readonly soil: InstancedPool;
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
    // watches ripen. Shape, height and colour all track growth, which makes "is
    // it ready" readable from either camera without a label: sprouts, then a
    // leafy plant, then stalks with heads on them. One pool per stage — a field
    // is three draw calls rather than one, and each cell is in exactly one.
    // Two-sided because the leaves are sheets with no back face of their own,
    // and vertex-coloured so a head can be a warmer gold than the straw under it
    // while the whole plant still takes the one tint growth gives it.
    const cropMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, vertexColors: true });
    this.crops = CROP_STAGES.map(
      (stage) =>
        new InstancedPool(this.group, cropGeometry(stage), cropMat, 256, {
          tinted: true,
          castShadow: false,
          receiveShadow: false,
        }),
    );

    // Wild brambles. A clump of overlapping lobes, darker in at the base where
    // the light does not reach, so a bush is a thicket and never a boulder from
    // the manager camera — the stones are single lumps and this is several
    // grown together. On the default layer with the crops, because the possessed
    // colonist has to be able to walk up to one and see the fruit on it. The
    // fruit is the ripeness signal: berries in a second pool that show once the
    // bush is well along and redden as it ripens, rather than the whole bush
    // changing colour — a yellow bush is a dying bush, not a laden one.
    this.bushes = new InstancedPool(
      this.group,
      bushGeometry(),
      new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
      512,
      { tinted: true, castShadow: false },
    );
    this.berries = new InstancedPool(
      this.group,
      berryClusterGeometry(),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      512,
      { tinted: true, castShadow: false, receiveShadow: false },
    );

    // A growing zone is painted as the tilled earth it stands for — furrows,
    // brown — rather than a tint of green over green, which from twenty cells up
    // is a plot the player cannot find. Still an overlay on the manager layer:
    // the ground itself is whatever the settlers broke, and this says "sown
    // here" over it. Lifted like the other paint, and under the marks.
    this.soil = new InstancedPool(
      this.group,
      tilledSoilGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x7a5a3c,
        vertexColors: true,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      }),
      256,
      { tinted: false, castShadow: false, layer: LAYER_MANAGER },
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
    for (const pool of this.crops) pool.begin();
    for (const cell of growingCells(world)) {
      const g = world.crops[cell] ?? CROP_NONE;
      if (g < 0) continue;
      // Height and girth run on through a stage change, so the plant that just
      // put up leaves is the size the sprouts had reached, not a fresh start.
      // A sown cell starts at a quarter of a grown plant and not a sixth: at the
      // old floor a fresh seedling was a few centimetres of leaf on bare brown,
      // and a plot nobody can tell from unsown soil is a plot the player forgets
      // they made. The girth floor moves with it, since what is missing from
      // overhead is leaf area rather than height.
      const h = 0.22 + g * 0.7;
      const girth = 0.62 + g * 0.38;
      this.v.set(unpackX(world, cell), 0, unpackY(world, cell));
      this.q.identity();
      this.s.set(girth, h, girth);
      this.m.compose(this.v, this.q, this.s);
      // Green the whole way, deepening as the plant matures. Ripeness is told by
      // the gold of the heads and by a plant standing half as tall again as a
      // mid one — never by the leaves going yellow, which is a failed crop.
      this.c.copy(LEAF_YOUNG).lerp(LEAF_RIPE, g);
      this.crops[cropStage(g)]!.push(this.m, this.c);
    }
    for (const pool of this.crops) pool.end();
  }

  /**
   * The wild bushes. Read straight off `world.bushes` rather than through
   * `ensureBushes`, because a renderer must never be the thing that decides a
   * save gets its brambles — the sim does that on its first tick, and drawing an
   * empty moor for one frame is a much smaller lie than a view with a side effect.
   */
  private syncBushes(world: World): void {
    this.bushes.begin();
    this.berries.begin();
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
      // Grey-green when it has just been picked over, filling back to a full
      // green as it recovers. Never yellow: the fruit says when it is ready.
      this.c.copy(BUSH_STRIPPED).lerp(BUSH_GREEN, g);
      this.bushes.push(this.m, this.c);
      if (g < BERRIES_AT) continue;
      // The cluster is built on the bush's own lobes in the bush's own units, so
      // it takes the bush's matrix as it is and sits on the surface at every
      // size; what ripening changes is the fruit's colour — green, then dark
      // red. Squared, so a bush looks unpicked until it nearly is, and a player
      // scanning the moor for red is scanning for food that is actually there
      // rather than food that will be on Thursday.
      const ripe = (g - BERRIES_AT) / (1 - BERRIES_AT);
      this.c.copy(BERRY_GREEN).lerp(BERRY_RIPE, ripe * ripe);
      this.berries.push(this.m, this.c);
    }
    this.bushes.end();
    this.berries.end();
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
    this.soil.begin();
    for (const z of world.zones) {
      // Blue hauling, brown furrows growing, straw-gold pen — three zones that
      // are never confusable at a glance from the isometric camera, which is
      // the whole job this colour has to do. The furrows are their own pool with
      // their own material, since tilled earth is opaque where paint is a tint.
      const pool = z.kind === 'growing' ? this.soil : this.zonePaint;
      this.c.setHex(z.kind === 'stockpile' ? 0x63b6e0 : 0xd8b45a);
      for (const cell of z.cells) {
        const x = unpackX(world, cell);
        const y = unpackY(world, cell);
        this.v.set(x, markHeight(world, x, y, ZONE_LIFT), y);
        this.q.identity();
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        pool.push(this.m, this.c);
      }
    }
    this.soil.end();
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
    for (const pool of this.crops) pool.dispose();
    this.bushes.dispose();
    this.berries.dispose();
    this.soil.dispose();
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

/** The three shapes a sown cell passes through, in the order it passes through them. */
export const CROP_STAGES = ['seedling', 'leafy', 'headed'] as const;
export type CropStage = (typeof CROP_STAGES)[number];

/** Which of the three shapes a cell at growth `g` is drawn as, as an index into `CROP_STAGES`. */
export function cropStage(g: number): number {
  return g >= CROP_HEADED_AT ? 2 : g >= CROP_LEAFY_AT ? 1 : 0;
}

/**
 * Give a part a flat vertex colour, so it can be merged with parts of another
 * colour into one geometry and still be told apart under the one instance tint.
 * The colour is a multiplier on that tint, not a colour of its own: `1, 1, 1`
 * is "the plant's colour", and a head at `1.1, 0.9, 0.55` is that colour pushed
 * warm. Any uv is dropped on the way — nothing here is textured, and every part
 * has to carry the same attributes for the merge to accept it.
 */
function paint(geo: THREE.BufferGeometry, r: number, g: number, b: number): THREE.BufferGeometry {
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** Merge and free the parts, so every builder below is one expression at the end. */
function weld(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geo = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return geo;
}

/**
 * A sown plant at one stage of its growth, welded into a single geometry so a
 * field is three draw calls however many cells it covers.
 *
 * Everything is in "one plant tall" units with the roots at the origin, the same
 * contract the cone kept, so `syncCrops` goes on scaling y to growth and x/z to
 * girth. The leans and bows are picked so a fully grown plant reaches under
 * 0.45 of a cell from its stem: neighbours in a field just touch, and nothing
 * pokes across a path.
 *
 * Three shapes rather than one scaled: a seedling is a low rosette of first
 * leaves; the leafy plant is a stalk with two tiers of broad leaves bowing off
 * it; the headed plant is three taller stalks each carrying a cluster of grains,
 * with the leaves left low. Each stage tops out higher than the one it takes
 * over from, at the growth where it takes over, so a plant never shrinks as it
 * crosses a boundary. The grains are the one part with a vertex colour of their
 * own — `HEAD_GOLD`, which turns the plant's green into straw where and only
 * where the crop is — so from overhead a ripe plot is green leaves carrying
 * gold, which is what a field ready to cut looks like, and never a field of
 * yellow stars.
 */
export function cropGeometry(stage: CropStage): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (stage === 'seedling') {
    // Four broad leaves splayed out low, not three thin sprouts standing on
    // end. A sprout held upright shows the manager camera its edge and
    // disappears: a sown cell read as bare brown soil, and the player could not
    // tell a plot that was coming up from one nobody had got to yet. The first
    // leaf stays nearly upright so the stage still has a height; the rest fall
    // further out as they get shorter, which is what a seedling does with its
    // first leaves, and what puts leaf area under an overhead eye.
    const leaves = [
      { len: 0.92, lean: 0.14 },
      { len: 0.64, lean: 0.46 },
      { len: 0.58, lean: 0.58 },
      { len: 0.5, lean: 0.68 },
    ];
    for (const [i, leaf] of leaves.entries()) {
      const sprout = bladeGeometry(0.2, 3, 0.12);
      sprout.scale(1, leaf.len, 1);
      sprout.rotateX(leaf.lean);
      sprout.translate(0, 0, 0.03);
      sprout.rotateY(i * 2.1 + 0.4);
      parts.push(paint(sprout, 1, 1, 1));
    }
    return weld(parts);
  }

  if (stage === 'leafy') {
    // The stalk stops just above the upper leaves rather than at the top of the
    // unit. The spare length was a bare stick standing out of the rosette from
    // overhead, and leaving it out is also what gives the headed plant below the
    // room to read as taller rather than merely wider.
    const stalk = new THREE.CylinderGeometry(0.02, 0.04, 0.9, 5, 1, true);
    stalk.translate(0, 0.45, 0);
    parts.push(paint(stalk, 0.92, 0.96, 0.78));
    // Two tiers, the lower one broader and bowing further, so the plant fills
    // its cell from the ground up rather than being a rosette on a stick.
    const tiers = [
      { n: 5, y: 0.1, len: 0.5, width: 0.3, bow: 0.5, turn: 0 },
      { n: 4, y: 0.52, len: 0.44, width: 0.26, bow: 0.42, turn: 0.7 },
    ];
    for (const tier of tiers) {
      for (let i = 0; i < tier.n; i++) {
        const leaf = bladeGeometry(tier.width, 4, 0.2);
        leaf.scale(1, tier.len, 1);
        leaf.rotateX(tier.bow);
        leaf.translate(0, tier.y, 0.02);
        leaf.rotateY((i / tier.n) * Math.PI * 2 + tier.turn);
        parts.push(paint(leaf, 1, 1, 1));
      }
    }
    return weld(parts);
  }

  // Headed. The stalks stand taller than the leafy plant's and lean a little
  // apart so the clusters do not merge into one blob from overhead. Each cluster
  // sits on the tip of its own stalk, and that tip is (0, stalkLen, bend): the
  // stalk is a blade bowing `bend` forward at y = 1, scaled in height alone, so
  // the bow does not scale with it — which is the centimetre and a half the head
  // used to sit behind the end of its stalk by.
  const bend = 0.1;
  const stalkLen = 0.88;
  for (let i = 0; i < 3; i++) {
    const stalk = bladeGeometry(0.05, 3, bend);
    stalk.scale(1, stalkLen, 1);
    const ear = [paint(stalk, 0.92, 0.96, 0.78)];
    // Four grains packed round the tip, rather than one bead stretched into an
    // ear. What says "ready" from twenty cells up is the weight of gold on the
    // plant, and one bead per stalk is three dots on a green plant. Each grain
    // is the cheapest solid knocked out of true and welded smooth — a centimetre
    // across, so what it needs is a highlight and not a silhouette — and each
    // takes its own seed, so a head is four grains and not one repeated.
    for (const grain of CROP_GRAINS) {
      const bead = lumpyGeometry(new THREE.IcosahedronGeometry(grain.r, 0), 0.15, 13 + i * 3 + grain.s);
      bead.translate(grain.x, stalkLen + grain.y, bend + grain.z);
      ear.push(paint(bead, HEAD_GOLD.x, HEAD_GOLD.y, HEAD_GOLD.z));
    }
    const whole = weld(ear);
    whole.rotateX(0.12 + i * 0.03);
    whole.translate(0, 0, 0.05);
    whole.rotateY((i / 3) * Math.PI * 2 + 0.5);
    parts.push(whole);
  }
  for (let i = 0; i < 4; i++) {
    const leaf = bladeGeometry(0.22, 4, 0.2);
    leaf.scale(1, 0.45, 1);
    leaf.rotateX(0.55);
    leaf.translate(0, 0.05, 0.02);
    leaf.rotateY((i / 4) * Math.PI * 2 + 0.3);
    parts.push(paint(leaf, 1, 1, 1));
  }
  return weld(parts);
}

/**
 * Where the grains of one head sit, in the stalk's own units with the origin at
 * the tip of the stalk. Stacked up the last ten centimetres and nudged off the
 * axis by turns, so a head is an ear of grain rather than a column of beads —
 * and short enough that the topmost of them, leaning with its stalk, stays
 * inside the one unit a plant is allowed.
 */
const CROP_GRAINS = [
  { x: 0, y: 0, z: 0, r: 0.055, s: 0 },
  { x: 0.035, y: 0.055, z: 0.012, r: 0.05, s: 1 },
  { x: -0.032, y: 0.052, z: -0.014, r: 0.05, s: 2 },
  { x: 0.004, y: 0.098, z: 0.004, r: 0.042, s: 3 },
] as const;

/**
 * A wild bush: five lobes grown into one another, the three big ones welded
 * smooth and the two small ones filling the gaps at the sides, in world units
 * with the roots at the origin and everything inside a cell. Vertex colour runs
 * dark at the base to full at the crown — the inside of a thicket is in its own
 * shade — and is a multiplier on the instance tint like the crops'.
 */
export function bushGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [i, lobe] of BUSH_LOBES.entries()) {
    const geo = lumpyGeometry(new THREE.IcosahedronGeometry(lobe.r, lobe.detail), 0.08, 5.3 + i);
    geo.scale(1, 0.86, 1);
    geo.translate(lobe.x, lobe.y, lobe.z);
    parts.push(geo);
  }
  const geo = weld(parts);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const shade = 0.5 + 0.5 * THREE.MathUtils.clamp(p.getY(i) / BUSH_CROWN, 0, 1);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/**
 * Where a bush's lobes sit. The big three are smoothed spheres (detail 1, so
 * the welded lump has enough vertices to be round); the two side lobes are the
 * cheaper solid so the whole thicket stays inside the budget a tree gets. Each
 * lobe is squashed to 0.86 of its radius in height, so its bottom is a little
 * under `y - 0.86 r`: with these numbers nothing dips below the ground.
 */
const BUSH_LOBES = [
  { x: 0, y: 0.3, z: 0, r: 0.3, detail: 1 },
  { x: 0.2, y: 0.24, z: 0.1, r: 0.24, detail: 1 },
  { x: -0.18, y: 0.22, z: -0.12, r: 0.22, detail: 1 },
  { x: 0.05, y: 0.16, z: -0.24, r: 0.16, detail: 0 },
  { x: -0.1, y: 0.16, z: 0.22, r: 0.16, detail: 0 },
] as const;
/** The height the base shading has finished lightening by: the top of the main lobe. */
const BUSH_CROWN = 0.3 + 0.3 * 0.86;

/**
 * The fruit on a bush: a dozen berries sitting on the upper skin of the lobes,
 * in the bush's own units so the bush's matrix places them. Each one is the
 * cheapest solid welded smooth — a berry is a centimetre or two across, and
 * what it needs is a highlight, not a silhouette. Positions come from the same
 * hash the stones use, so the fruit is in the same place on every bush of a
 * given ripeness in every session.
 */
export function berryClusterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const dir = new THREE.Vector3();
  for (let i = 0; i < 12; i++) {
    const lobe = BUSH_LOBES[i % 3]!;
    // A bearing round the lobe and a height on its upper half, from a hash so
    // the spread is irregular without being different from one session to the next.
    const a = fract(Math.sin(i * 12.9898 + 4.1414) * 43758.5453) * Math.PI * 2;
    const up = 0.15 + 0.7 * fract(Math.sin(i * 78.233 + 1.7) * 43758.5453);
    const flat = Math.sqrt(1 - up * up);
    dir.set(Math.cos(a) * flat, up * 0.86, Math.sin(a) * flat).multiplyScalar(lobe.r * 0.98);
    const berry = lumpyGeometry(new THREE.IcosahedronGeometry(0.03, 0), 0, 0);
    berry.translate(lobe.x + dir.x, lobe.y + dir.y, lobe.z + dir.z);
    parts.push(berry);
  }
  return weld(parts);
}

function fract(n: number): number {
  return n - Math.floor(n);
}

/**
 * A tilled cell for the growing-zone overlay: eight strips across the cell,
 * ridge and furrow by turns, flat at y = 0 and lifted per instance like the
 * other paint. The stripes are vertex colour on one geometry rather than a
 * second pool, and they never overlap, so there is nothing to z-fight.
 */
export function tilledSoilGeometry(): THREE.BufferGeometry {
  const rows = 8;
  const size = 0.96;
  const pitch = size / rows;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < rows; i++) {
    const strip = new THREE.PlaneGeometry(size, pitch);
    strip.rotateX(-Math.PI / 2);
    strip.translate(0, 0, -size / 2 + pitch * (i + 0.5));
    const shade = i % 2 === 0 ? 1 : 0.66;
    parts.push(paint(strip, shade, shade, shade));
  }
  return weld(parts);
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
