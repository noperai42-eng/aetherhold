/**
 * Ground and rock. One non-indexed quad per cell, coloured at its corners rather
 * than its middle so neighbouring ground bleeds together instead of tiling, plus
 * instanced blocks for rock — which is solid terrain, so it has to look like
 * something you cannot walk through, because you cannot.
 */

import * as THREE from 'three';

import { ICE_STEPS, SEASON_STEPS, SNOW_STEPS, TERRAIN_COLOR, groundColor } from './palette';
import { yearPhase } from '../../sim/seasons';
import { holdsSnow, snowDepth } from '../../sim/snowpack';
import { BEARING, iceDepth } from '../../sim/ice';
import { TERRAIN_LIST, isFloor, packCell, terrainAt } from '../../sim/types';
import type { Terrain, World } from '../../sim/types';

/**
 * How far a full pack lifts the ground it is lying on.
 *
 * Thirteen centimetres on a one-metre cell, which is the number that makes snow
 * read as a *layer* rather than as a repaint. Colour alone cannot do it: a white
 * field and a white floor are the same white, and the eye has nothing to tell it
 * which one has depth. Thirteen centimetres does three things at once. It catches
 * the light on the slope where the pack runs down to a path, so a plank walk in
 * deep snow sits in a visible trench. It laps up the foot of every wall, crate
 * and tree, because those are drawn from the ground plane and do not move. And it
 * puts a settler's boots *in* it — ankle deep on a 1.7 m body, which is what
 * makes the yard look cold rather than bleached.
 *
 * Deliberately far too shallow to stand on. Nothing in the sim knows this number
 * and nothing should: the snow that matters is one field on `World`, and this is
 * the renderer's opinion about how to draw it. Collision never consults it, so
 * there is nothing here for the visuals and the collision to disagree about.
 */
const SNOW_LIFT = 0.13;

/**
 * How far the lake bed drops below the bank it sits in.
 *
 * The same corner lattice that lifts snow sinks water, and it is the averaging
 * that does the work: a corner in open water is surrounded by four wet cells and
 * takes the full drop, while a corner on the shore is only half wet and takes
 * half of it. So the middle of the lake comes out flat at the bottom of the
 * bowl, and the one-cell ring around it is a bank sloping down into the water,
 * without a single line about shorelines anywhere in the mesh.
 *
 * Forty-two centimetres is chosen against `ROCK_SINK`, not against anything about
 * water: a boulder only sinks fifteen, so a cliff standing on a corner this deep
 * would show daylight under its own base. Worldgen keeps a cell of dry ground
 * between the lake and every rock precisely so that corner never exists — which
 * is why this number is allowed to be big enough to see.
 */
const WATER_SINK = 0.42;

/** How much darker open water is than the shallows at its edge. */
const WATER_SHADE = 0.22;

/** The tallest a rock block gets. Anything that must clear every rock uses this. */
export const ROCK_HEIGHT = 2.45;
const ROCK_MIN_HEIGHT = 1.55;
/** How far a block sinks into the ground, so no cliff floats above its own seam. */
const ROCK_SINK = 0.15;
/** Yaw range in radians. Small, because a block still has to cover its own cell. */
const ROCK_TILT = 0.07;
/** How much a corner darkens per touching rock cell — the shadow a cliff casts on its own foot. */
const AO_PER_ROCK = 0.12;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * How high a bridge deck stands over the bank it leaves, and how thick it is.
 *
 * Six centimetres is a step up onto boards, not a climb: high enough that the deck
 * has a lit edge against the water it crosses, low enough that a settler walking
 * out onto it does not appear to levitate. Nothing in the sim reads either number —
 * a bridge cell is walkable at ground height like every other floor, and this is
 * only the renderer's account of what that looks like.
 */
const DECK_Y = 0.06;
const DECK_H = 0.12;
/** Handrail height above the deck, and how thick a rail is. */
const RAIL_H = 0.26;
const RAIL_T = 0.08;

/** One rock block's deterministic deviation from a plain unit crate. */
export interface RockShape {
  height: number;
  /** Yaw in radians. */
  rot: number;
  /** Horizontal scale. Never less than the tilt costs. */
  scale: number;
  /** Lightness offset, so a cliff face is not one flat grey. */
  shade: number;
}

/**
 * The shape of the rock on a given cell.
 *
 * Pure and position-seeded: the same cell is the same block every session, and
 * mining one neighbour never reshuffles the cliff around it.
 */
export function rockShapeAt(x: number, y: number): RockShape {
  const a = hash(x, y, 3.71);
  const b = hash(x, y, 9.13);
  const c = hash(x, y, 17.29);
  const rot = (b - 0.5) * 2 * ROCK_TILT;
  return {
    height: ROCK_MIN_HEIGHT + a * (ROCK_HEIGHT - ROCK_MIN_HEIGHT),
    rot,
    // A square turned by `rot` needs cos+sin of that angle just to cover the
    // ground it started on. Anything less opens a seam you can see through and
    // still cannot walk through — so the tilt pays for itself before the extra.
    scale: Math.cos(rot) + Math.abs(Math.sin(rot)) + c * 0.05,
    shade: (c - 0.5) * 0.11,
  };
}

/** Top surface of the rock block on this cell, in world units. */
export function rockTopAt(x: number, y: number): number {
  return rockShapeAt(x, y).height - ROCK_SINK;
}

export class TerrainView {
  readonly group = new THREE.Group();
  private readonly colors: Float32Array;
  private readonly positions: Float32Array;
  /** Corner colours on a (w+1)×(h+1) lattice — each one shared by up to four cells. */
  private readonly corners: Float32Array;
  /** Snow height on the same lattice, so neighbouring cells cannot open a crack. */
  private readonly cornerLift: Float32Array;
  private readonly cornerStride: number;
  private readonly ground: THREE.Mesh;
  private readonly rocks: THREE.InstancedMesh;
  private readonly rockCapacity: number;
  /** Bridge decks: one slab per bridge cell, standing over the water it covers. */
  private readonly decks: THREE.InstancedMesh;
  /** Handrails: up to two per deck cell, on whichever sides face open water. */
  private readonly rails: THREE.InstancedMesh;
  private readonly deckCapacity: number;
  private checksum = -1;

  constructor(world: World) {
    const { width, height } = world;
    const cells = width * height;
    const positions = new Float32Array(cells * 18);
    this.positions = positions;
    this.colors = new Float32Array(cells * 18);
    this.cornerStride = width + 1;
    this.corners = new Float32Array(this.cornerStride * (height + 1) * 3);
    this.cornerLift = new Float32Array(this.cornerStride * (height + 1));

    let p = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x0 = x - 0.5;
        const x1 = x + 0.5;
        const y0 = y - 0.5;
        const y1 = y + 0.5;
        // Two triangles, wound counter-clockwise when seen from above.
        const quad = [x0, 0, y0, x0, 0, y1, x1, 0, y1, x0, 0, y0, x1, 0, y1, x1, 0, y0];
        for (let i = 0; i < 18; i++) positions[p + i] = quad[i]!;
        p += 18;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.group.add(this.ground);

    this.rockCapacity = Math.max(1, countRock(world));
    this.rocks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      // White, because the real colour rides per instance — a cliff of one hex
      // reads as a wall of crates however well it is lit.
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
      this.rockCapacity,
    );
    this.rocks.castShadow = true;
    this.rocks.receiveShadow = true;
    this.rocks.frustumCulled = false;
    this.group.add(this.rocks);

    // A deck is drawn rather than painted on, because the cell under it stays
    // lake: the bed goes on sinking, the water goes on shading dark, and when
    // winter comes the ice closes in under the boards. A bridge that were only a
    // colour on the ground would have filled the hole in instead, and the lake
    // would have healed over wherever anybody crossed it.
    this.deckCapacity = Math.max(1, countWater(world));
    this.decks = new THREE.InstancedMesh(
      // A shade under a full cell, so two decks laid side by side show a seam
      // and a causeway reads as boards rather than as one long slab.
      new THREE.BoxGeometry(0.96, DECK_H, 0.96),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
      this.deckCapacity,
    );
    this.decks.castShadow = true;
    this.decks.receiveShadow = true;
    this.decks.frustumCulled = false;
    this.group.add(this.decks);

    // Rails are what make it a bridge and not a raft. At manager range the deck
    // is a brown line on blue and could be anything; two rails give it sides, and
    // the sides are what say "you can walk here" from three screens away.
    this.rails = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, RAIL_H, RAIL_T),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }),
      this.deckCapacity * 2,
    );
    this.rails.castShadow = true;
    this.rails.receiveShadow = false;
    this.rails.frustumCulled = false;
    this.group.add(this.rails);

    this.rebuild(world);
  }

  /**
   * Cheap change detector: mining is the only thing that edits terrain — and the
   * year, which repaints the same terrain a different colour, and the snow lying
   * on top of both.
   *
   * The season is folded in at 64 steps a year rather than continuously, because
   * a continuous read would rebuild thirty-seven thousand cells on every frame for a
   * colour change too small to see. Sixty-four steps is a repaint about every
   * seventy-five seconds of play and a gradient nobody can find the stairs in.
   * The pack gets its own coarser quantum for the same reason and a different
   * clock — see `SNOW_STEPS`.
   */
  sync(world: World): void {
    const step = Math.floor(yearPhase(world) * SEASON_STEPS);
    let sum =
      step * 7919 +
      Math.floor(snowDepth(world) * SNOW_STEPS) * 104729 +
      Math.floor(iceDepth(world) * ICE_STEPS) * 15485863;
    const t = world.terrain;
    for (let i = 0; i < t.length; i++) sum = (sum + t[i]! * (i + 1)) | 0;
    if (sum === this.checksum) return;
    this.checksum = sum;
    this.rebuild(world);
  }

  private rebuild(world: World): void {
    this.rebuildCorners(world);

    const { width, height } = world;
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let rockCount = 0;
    let deckCount = 0;
    let railCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Corner (cx, cy) sits at world (cx - 0.5, cy - 0.5); this order has to
        // match the quad wound in the constructor, vertex for vertex.
        const base = packCell(world, x, y) * 18;
        const here = terrainAt(world, x, y);
        // A bridge is the one floor that does not take the flat-floor branch: its
        // cell is still lake, and it wants the corner average — the dark of the
        // deep, the lift as the ice comes in — exactly as if the boards were not
        // there. The boards are a separate mesh standing over the top.
        if (isFloor(here) && here !== 'bridge') {
          // A laid floor is the one ground a person made, so it is the one ground
          // that does not bleed into its neighbours: all four corners take the
          // same colour, which gives the boards a straight edge against the grass
          // and makes a half-finished corridor read as half-finished.
          col.setHex(TERRAIN_COLOR[here]).offsetHSL(0, 0, floorShade(here, x, y));
          for (let i = 0; i < 18; i += 3) {
            this.colors[base + i] = col.r;
            this.colors[base + i + 1] = col.g;
            this.colors[base + i + 2] = col.b;
          }
        } else {
          this.writeCorner(base, x, y);
          this.writeCorner(base + 3, x, y + 1);
          this.writeCorner(base + 6, x + 1, y + 1);
          this.writeCorner(base + 9, x, y);
          this.writeCorner(base + 12, x + 1, y + 1);
          this.writeCorner(base + 15, x + 1, y);
        }

        // Height comes off the same lattice for *every* cell, floors included.
        // That is not a detail: two neighbouring cells are separate triangles
        // with no shared vertices, so they only stay welded because they read
        // the same corner and land on the same number. Lift a snowy cell without
        // lifting the path beside it and you open a slot straight through the
        // world, which from inside a body is a hole in the floor.
        this.writeLift(base, x, y);
        this.writeLift(base + 3, x, y + 1);
        this.writeLift(base + 6, x + 1, y + 1);
        this.writeLift(base + 9, x, y);
        this.writeLift(base + 12, x + 1, y + 1);
        this.writeLift(base + 15, x + 1, y);

        if (here === 'bridge' && deckCount < this.deckCapacity) {
          // The deck sits at a fixed height whatever the lattice under it is
          // doing. That is the point of drawing it separately: the corner beneath
          // is halfway down a bowl in July and level with the bank in January, and
          // a deck that followed it would sag into the lake in summer and lie flat
          // on the ice in winter. A bridge is a rigid thing on piles; it stays put
          // and the water moves around it.
          v.set(x, DECK_Y, y);
          q.identity();
          s.set(1, 1, 1);
          m.compose(v, q, s);
          this.decks.setMatrixAt(deckCount, m);
          // Board-to-board variation, position-seeded like everything else here,
          // so a long causeway is planks of slightly different timber rather than
          // one extruded ribbon.
          col.setHex(TERRAIN_COLOR.bridge).offsetHSL(0, 0, (hash(x, y, 61.3) - 0.5) * 0.09);
          this.decks.setColorAt(deckCount, col);
          deckCount++;

          // One rail per side that faces open water. A deck between two other
          // decks gets none, so the rails run down the flanks of a causeway and
          // stop where it meets the bank — which is also where you want to be
          // able to step off it.
          const sides: [number, number, number][] = [
            [0, -1, 0],
            [0, 1, 0],
            [-1, 0, Math.PI / 2],
            [1, 0, Math.PI / 2],
          ];
          col.setHex(TERRAIN_COLOR.bridge).offsetHSL(0, 0, 0.06);
          for (const [dx, dy, rot] of sides) {
            if (railCount >= this.deckCapacity * 2) break;
            if (!openWaterAt(world, x + dx, y + dy)) continue;
            v.set(x + dx * 0.46, DECK_Y + DECK_H / 2 + RAIL_H / 2, y + dy * 0.46);
            q.setFromAxisAngle(UP, rot);
            s.set(1, 1, 1);
            m.compose(v, q, s);
            this.rails.setMatrixAt(railCount, m);
            this.rails.setColorAt(railCount, col);
            railCount++;
          }
        }

        if (here === 'rock' && rockCount < this.rockCapacity) {
          const sh = rockShapeAt(x, y);
          v.set(x, sh.height / 2 - ROCK_SINK, y);
          q.setFromAxisAngle(UP, sh.rot);
          s.set(sh.scale, sh.height, sh.scale);
          m.compose(v, q, s);
          this.rocks.setMatrixAt(rockCount, m);
          col.setHex(TERRAIN_COLOR.rock).offsetHSL(0, 0, sh.shade);
          this.rocks.setColorAt(rockCount, col);
          rockCount++;
        }
      }
    }
    // Park unused instances at zero scale rather than leaving stale rocks behind.
    m.makeScale(0, 0, 0);
    for (let i = rockCount; i < this.rockCapacity; i++) this.rocks.setMatrixAt(i, m);
    this.rocks.count = this.rockCapacity;
    this.rocks.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
    // Decks and rails, same treatment and for a sharper reason: a bridge is the
    // one thing here that gets *built* mid-game, so the tail of this pool is
    // whatever the last rebuild left in it.
    for (let i = deckCount; i < this.deckCapacity; i++) this.decks.setMatrixAt(i, m);
    for (let i = railCount; i < this.deckCapacity * 2; i++) this.rails.setMatrixAt(i, m);
    this.decks.count = this.deckCapacity;
    this.rails.count = this.deckCapacity * 2;
    this.decks.instanceMatrix.needsUpdate = true;
    this.rails.instanceMatrix.needsUpdate = true;
    if (this.decks.instanceColor) this.decks.instanceColor.needsUpdate = true;
    if (this.rails.instanceColor) this.rails.instanceColor.needsUpdate = true;
    (this.ground.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.ground.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    // The whole reason the lift is worth having: normals off the new surface, so
    // the sun finds the slope where the pack runs down into a path and the drift
    // has a lit face and a shaded one. Flat per-triangle, because the geometry is
    // non-indexed — which suits a valley whose cliffs are already flat-shaded.
    this.ground.geometry.computeVertexNormals();

    // Deep snow is a slightly less matte surface than wet grass. One number on
    // one material, and it is what stops a white field reading as paper.
    const depth = snowDepth(world);
    (this.ground.material as THREE.MeshStandardMaterial).roughness = 0.95 - depth * 0.2;
  }

  /**
   * Every lattice corner, once.
   *
   * A corner is the average of the up-to-four cells that meet there, so grass
   * fades into sand the way ground does instead of stopping at a tile edge, and
   * it darkens for each rock cell touching it — a free contact shadow at the foot
   * of every cliff, with no second light and no shadow map.
   */
  private rebuildCorners(world: World): void {
    const c = new THREE.Color();
    const phase = yearPhase(world);
    const depth = snowDepth(world);
    /**
     * How much of the lake bed's drop is still a drop.
     *
     * One over `BEARING` rather than one over one, so the surface comes up level
     * with the bank at the exact thickness the sim starts letting people walk on
     * it — not a moment before, when there would be a shelf of ice standing over
     * open water nobody can cross, and not a moment after, when a settler would be
     * standing in mid-air over a hole. The picture and the collision reach the same
     * conclusion on the same tick because they are reading the same number.
     */
    const submerged = Math.max(0, 1 - iceDepth(world) / BEARING);
    const { width, height } = world;
    for (let cy = 0; cy <= height; cy++) {
      for (let cx = 0; cx <= width; cx++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        let rock = 0;
        let lying = 0;
        let wet = 0;
        let open = 0;
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const kind = terrainAt(world, x, y);
            if (kind === 'rock') {
              rock++;
            } else {
              // Rock is left out of the height entirely rather than counted as
              // bare, so the pack runs up to the foot of a cliff at full depth
              // instead of dipping into it — which is where drifts actually
              // pile, and the blocks sink further into the ground than the snow
              // ever lifts, so nothing floats. Water and laid floor do count,
              // as zero: the pond stays a flat hole in the white, and a path is
              // a trench with the snow sloping down into it.
              if (holdsSnow(kind)) lying++;
              // A decked cell counts as wet, because it is: the boards are held up
              // over the lake, not laid on a filled-in one. Count it dry and the
              // bed would rise into a hump under every bridge and the water would
              // pale out around it, as though crossing the lake had drained it.
              if (kind === 'water' || kind === 'bridge') wet++;
              open++;
            }
            groundColor(c, kind, phase, depth, iceDepth(world));
            r += c.r;
            g += c.g;
            b += c.b;
            n++;
          }
        }
        const i = (cy * this.cornerStride + cx) * 3;
        if (n === 0) continue;
        // A little deterministic mottling so the whole map does not read as lino, and
        // a darkening with depth so the lake reads as something with a bottom
        // rather than as blue paint. The shading is free: the same count that
        // sinks the bed shades it, so the dark and the deep can never disagree —
        // and when the ice comes in, the one factor that raises the bowl is the
        // one that lifts the gloom out of it, so a frozen lake cannot come out
        // flat and still shadowed like a hole.
        const deep = (open === 0 ? 0 : wet / open) * submerged;
        const k = Math.max(0.15, 1 - rock * AO_PER_ROCK - deep * WATER_SHADE + jitter(cx, cy));
        this.corners[i] = (r / n) * k;
        this.corners[i + 1] = (g / n) * k;
        this.corners[i + 2] = (b / n) * k;
        this.cornerLift[cy * this.cornerStride + cx] =
          open === 0 ? 0 : depth * SNOW_LIFT * (lying / open) - WATER_SINK * deep;
      }
    }
  }

  private writeCorner(dst: number, cx: number, cy: number): void {
    const i = (cy * this.cornerStride + cx) * 3;
    this.colors[dst] = this.corners[i]!;
    this.colors[dst + 1] = this.corners[i + 1]!;
    this.colors[dst + 2] = this.corners[i + 2]!;
  }

  private writeLift(dst: number, cx: number, cy: number): void {
    this.positions[dst + 1] = this.cornerLift[cy * this.cornerStride + cx]!;
  }

  dispose(): void {
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.rocks.geometry.dispose();
    (this.rocks.material as THREE.Material).dispose();
    this.decks.geometry.dispose();
    (this.decks.material as THREE.Material).dispose();
    this.rails.geometry.dispose();
    (this.rails.material as THREE.Material).dispose();
  }
}

/**
 * Grain on a laid floor.
 *
 * Boards run one way and are cut to slightly different tones; paving is laid in
 * a chequer. Both are position-seeded, so the pattern is stable while the colony
 * grows over it instead of shuffling every time a cell is added.
 */
function floorShade(kind: Terrain, x: number, y: number): number {
  const grain = (hash(x, y, kind === 'plank' ? 5.17 : 23.4) - 0.5) * 0.05;
  if (kind === 'plank') return (y % 2 === 0 ? 0.035 : -0.035) + grain;
  return ((x + y) % 2 === 0 ? 0.03 : -0.03) + grain;
}

function jitter(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (n - Math.floor(n) - 0.5) * 0.09;
}

function hash(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt) * 43758.5453;
  return n - Math.floor(n);
}

function countRock(world: World): number {
  const rockIdx = TERRAIN_LIST.indexOf('rock' as Terrain);
  let n = 0;
  for (const t of world.terrain) if (t === rockIdx) n++;
  return n;
}

/**
 * How many decks this map could ever need.
 *
 * Water at worldgen, counted once. Rock only ever gets mined away, so its pool can
 * be sized from what is standing; bridges only ever go *up*, so theirs has to be
 * sized from what they could cover — and a bridge can only be laid on water, which
 * nothing in the game ever creates. So this is a real ceiling rather than a guess,
 * and a lake nobody bridges costs a few hundred parked instances and no draw time.
 */
function countWater(world: World): number {
  const waterIdx = TERRAIN_LIST.indexOf('water' as Terrain);
  const bridgeIdx = TERRAIN_LIST.indexOf('bridge' as Terrain);
  let n = 0;
  for (const t of world.terrain) if (t === waterIdx || t === bridgeIdx) n++;
  return n;
}

/**
 * Is the cell beside a deck open water — i.e. does this edge of the boards need a
 * rail?
 *
 * Bounds are checked here rather than trusted to `terrainAt`, which indexes a flat
 * array without them: one cell off the left edge is the far end of the row above,
 * and a lake there would hang a rail down the wrong side of a bridge on the other
 * side of the map.
 */
function openWaterAt(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  return terrainAt(world, x, y) === 'water';
}
