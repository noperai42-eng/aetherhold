/**
 * Ambient occlusion baked into a prototype's vertex colours.
 *
 * Everything in `buildings.ts` is an assembly: a stove is a shell with a door on
 * it, feet under it and a flue up its back, and each of those is lit as though
 * the others were not there. The flue meets the shell in a hard bright line, the
 * feet are as bright as the lid, and the whole thing reads as a housing with a
 * pipe near it. What is missing is the contact shadow, and a contact shadow does
 * not need a shadow map: it is a property of the shape, it never moves, and it
 * can be measured once at startup and written into the geometry.
 *
 * The vehicle is the colour attribute, because three multiplies rather than
 * replaces. In `color_vertex.glsl` the vertex colour lands first (`vColor *=
 * color`) and the instance tint lands on top of it (`vColor.xyz *=
 * instanceColor.xyz`), so a factor baked into the prototype survives every tint
 * `BuildingsView` pushes — damage, the dulling of an unpowered machine, the
 * blueprint's own progress colour. That is the same trick `dye()` already uses
 * for a log's cut ends and the same trick the terrain's rock skin already uses
 * for its own undersides (`lerp(ROCK_UNDER, 1, under)` in terrain.ts): this is
 * that idea with the geometry consulted instead of guessed at.
 *
 * Two rules govern every call site, and both were paid for rather than reasoned
 * out. The first is that `vertexColors` without a colour attribute renders
 * BLACK: `MeshStandardMaterial` carries no `defaultAttributeValues`, so the
 * declared-but-unbound attribute stands at the WebGL initial (0, 0, 0, 1) and
 * the diffuse colour is multiplied by zero. The asymmetry is the trap — an
 * attribute with no flag is silently ignored, a flag with no attribute is a
 * black building — so the attribute is written first, by `colorOf`, and the flag
 * flipped on that one material afterwards. The second is that the occlusion goes
 * LAST: `dye` and `dyeEnds` call `setAttribute` with a fresh array and so
 * destroy whatever was there, while everything here multiplies into what it
 * finds. Occlude then dye and the shadow is simply gone.
 */

import * as THREE from 'three';

/* ────────────────────────────────────────────────────────────────────────── */
/* The constants                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * How dark a fully-buried vertex is allowed to get. Nothing in the colony may
 * read as a hole in the ground at noon — `buildings-view.test.ts` pins the floor
 * at 0.025 linear luminance, and the darkest legitimate part in the set, a bed's
 * timber frame, sits at 0.03283. The frame is what sets this number: 0.025 /
 * 0.03283 = 0.76158, so any multiplier at or below that fails the test that
 * already exists. 0.78 clears it by 2.4 %, which is too fine a margin to hold
 * while the palette is still being tuned; 0.80 clears it by 5.0 % and costs a
 * fifth of a stop of depth. So 0.80, set by one timber part, and every painted
 * machine in the colony has far more room than it uses — the stove's feet would
 * survive a floor of 0.500 and the generator's skid 0.449, which is what the
 * per-call `floor` override is there for if a round ever wants it.
 */
export const AO_FLOOR = 0.8;

/**
 * How much of the measured occlusion to believe. The integral is physically
 * right and physically right is far too strong for a stylised colony seen from
 * two metres up: a vertex in a corner measures 0.6 blocked, and 0.6 of the way
 * to the floor is a black corner. The sweep flattens hard past here — the
 * stove's seam-to-open separation runs 0.1660 at 0.4, 0.1756 at 0.5, 0.1786 at
 * 0.6 and 0.1839 at 1.0 — so the last half of the strength buys under half a
 * percent of separation and buys it by crushing everything else. At 0.5 the
 * floor's binding point is 40 % occlusion, which leaves a light contact landing
 * at 0.925 rather than on the clamp.
 */
export const AO_STRENGTH = 0.5;

/**
 * How far a vertex looks for something in the way, in metres. A stove is
 * nine-tenths of a metre across, so a third of a metre is "the part next to me"
 * and not "the far side of the building" — which matters, because a hemisphere
 * that can see the whole assembly darkens every open face by the same amount
 * and that is a tint, not an occlusion.
 */
export const AO_RADIUS = 0.34;

/**
 * How far off its own surface a ray starts, in metres. Small enough not to
 * escape a real contact — the parts here overlap by one to two centimetres —
 * and large enough that a ray leaving a face never clips the coplanar triangles
 * of the face it left.
 */
export const AO_BIAS = 0.0015;

/**
 * How many rays make up one vertex's hemisphere. Measured against a converged
 * 512-ray reference rather than chosen: at 8 rays the worst vertex on the stove
 * is 0.128 away from the truth, which against a seam-to-open signal of 0.176 is
 * a bright speckle sitting on a smooth panel, and the six assemblies sampled ran
 * 0.096 to 0.129 worst-case. Sixteen holds the worst vertex to between 0.057 and
 * 0.086 and the mean error to 0.003–0.007, which is under a shade step once
 * `AO_STRENGTH` has halved it and is then averaged again by the interpolation
 * across each triangle. Thirty-two halves the error again and doubles the cost
 * for a difference nothing can show.
 */
export const AO_RAYS = 16;

/* ────────────────────────────────────────────────────────────────────────── */
/* The colour attribute                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The geometry's colour attribute, made if it is not there yet and filled with
 * ones so that making it changes nothing. A part that carries this and a
 * material that does not carry `vertexColors` renders exactly as it did before
 * either existed, which is what lets `BuildingsView` declare the attribute and
 * the flag at construction — where they are free and where the shader's
 * USE_COLOR branch is compiled once — and fill in the real numbers later.
 *
 * Every writer here multiplies into it, which is what lets an occlusion land on
 * a part `dye()` has already painted: the log keeps its pale cut ends and gains
 * a shadow where it lies on the log below it.
 */
export function colorOf(g: THREE.BufferGeometry): THREE.BufferAttribute {
  const have = g.attributes.color as THREE.BufferAttribute | undefined;
  if (have) return have;
  const col = new Float32Array(g.attributes.position.count * 3).fill(1);
  const a = new THREE.BufferAttribute(col, 3);
  g.setAttribute('color', a);
  return a;
}

/** Multiplies one scalar into a vertex's colour, all three channels alike. */
function shade(a: THREE.BufferAttribute, k: number, f: number): void {
  const arr = a.array as Float32Array;
  arr[k * 3] *= f;
  arr[k * 3 + 1] *= f;
  arr[k * 3 + 2] *= f;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The pass                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * What a ray is tested against. `grid` is what ships and `tri` is brute force —
 * the same triangles in the same order with none of the bookkeeping — kept
 * because it is the only thing that can say whether the grid is right. The two
 * agree to the last bit on every assembly measured, which is the strongest
 * statement available about a spatial index, and `occlusion.test.ts` holds them
 * to it.
 */
export type OccluderMode = 'tri' | 'grid';

export interface PartsOpts {
  /** How much of the measured occlusion to apply. Default `AO_STRENGTH`. */
  strength?: number;
  /** How dark a fully-buried vertex may get. Default `AO_FLOOR`. */
  floor?: number;
  /** How far a ray looks, in metres. Default `AO_RADIUS`. */
  radius?: number;
  /** Rays per vertex. Default `AO_RAYS`. */
  rays?: number;
  /** Ray start offset along the normal, in metres. Default `AO_BIAS`. */
  bias?: number;
  /** What a ray is tested against. Default `'grid'`. */
  mode?: OccluderMode;
  /**
   * Blockers that are not themselves shaded. This is what a part shared between
   * two assemblies needs: a tree's trunk stands inside either crown, and the
   * crown it is not being shaded with still has to cast on it.
   */
  occluders?: THREE.BufferGeometry[];
  /** Whether a part occludes itself. On, because a lathe shade's inside is its own shadow. */
  self?: boolean;
  /**
   * Put the ground in as a blocker, so that what a thing standing on the floor
   * loses to the floor comes out of the same integral as what it loses to its
   * own parts. Measured on the lowest six centimetres of each assembly, that is
   * the difference between a stove whose feet read at 0.9593 — brighter than
   * its own lid — and one that reads at 0.8003, which is a contact shadow.
   * Off by default: a thing on a shelf has no floor under it.
   */
  ground?: boolean;
  /** Where that ground is. Default: the foot of the parts' shared bounding box. */
  groundY?: number;
}

/** One part flattened to triangles, with the reject tests that come before them. */
interface Blocker {
  tri: Float32Array; // 9 floats per triangle
  count: number;
  cx: number;
  cy: number;
  cz: number;
  r: number; // bounding sphere
  lo: [number, number, number];
  hi: [number, number, number]; // AABB
}

function blockerOf(g: THREE.BufferGeometry): Blocker {
  const flat = g.index ? g.toNonIndexed() : g;
  const p = flat.attributes.position.array as Float32Array;
  const tri = p instanceof Float32Array ? p : new Float32Array(p);
  const count = tri.length / 9;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tri.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = tri[i + a]!;
      if (v < lo[a]!) lo[a] = v;
      if (v > hi[a]!) hi[a] = v;
    }
  }
  const cx = (lo[0]! + hi[0]!) / 2;
  const cy = (lo[1]! + hi[1]!) / 2;
  const cz = (lo[2]! + hi[2]!) / 2;
  let r = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const d = Math.hypot(tri[i]! - cx, tri[i + 1]! - cy, tri[i + 2]! - cz);
    if (d > r) r = d;
  }
  if (flat !== g) flat.dispose();
  return { tri, count, cx, cy, cz, r, lo, hi };
}

/**
 * A cosine-weighted hemisphere about +y, from a Hammersley sequence so that the
 * same assembly comes out the same on every reload and in every test — the same
 * promise `hash01` makes for the shapes themselves. Cosine-weighted is not a
 * refinement: the ambient integral carries a cos θ, so drawing directions with
 * that density turns the integral into a plain count of blocked rays and the
 * answer is the fraction, with no weights to keep.
 */
function hemisphere(n: number): Float32Array {
  const d = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let b = i;
    let f = 0.5;
    let radical = 0;
    while (b > 0) {
      radical += f * (b & 1);
      b >>= 1;
      f *= 0.5;
    }
    const u = (i + 0.5) / n;
    const r = Math.sqrt(u);
    const phi = 2 * Math.PI * radical;
    d[i * 3] = r * Math.cos(phi);
    d[i * 3 + 1] = Math.sqrt(Math.max(0, 1 - u));
    d[i * 3 + 2] = r * Math.sin(phi);
  }
  return d;
}

function hitsSphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number, b: Blocker): boolean {
  const mx = b.cx - ox;
  const my = b.cy - oy;
  const mz = b.cz - oz;
  // The closest point on the *segment* [0, far], not on the infinite line: a
  // sphere whose centre projects past the end of the ray can still be entered
  // before it, and clamping is the difference between a rejector and a bug.
  const t = Math.max(0, Math.min(far, mx * dx + my * dy + mz * dz));
  const px = mx - dx * t;
  const py = my - dy * t;
  const pz = mz - dz * t;
  return px * px + py * py + pz * pz <= b.r * b.r;
}

function hitsBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number, lo: readonly number[], hi: readonly number[]): boolean {
  let t0 = 0;
  let t1 = far;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    const inv = 1 / (d[a]! || 1e-20);
    let a0 = (lo[a]! - o[a]!) * inv;
    let a1 = (hi[a]! - o[a]!) * inv;
    if (a0 > a1) {
      const s = a0;
      a0 = a1;
      a1 = s;
    }
    if (a0 > t0) t0 = a0;
    if (a1 < t1) t1 = a1;
    if (t0 > t1) return false;
  }
  return true;
}

/** Möller–Trumbore, double-sided: a shell's back face blocks as well as its front. */
function hitsTri(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number, t: Float32Array, i: number): boolean {
  const ax = t[i]!;
  const ay = t[i + 1]!;
  const az = t[i + 2]!;
  const e1x = t[i + 3]! - ax;
  const e1y = t[i + 4]! - ay;
  const e1z = t[i + 5]! - az;
  const e2x = t[i + 6]! - ax;
  const e2y = t[i + 7]! - ay;
  const e2z = t[i + 8]! - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return false;
  const inv = 1 / det;
  const tx = ox - ax;
  const ty = oy - ay;
  const tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return dist > 0 && dist < far;
}

/* ── the grid ────────────────────────────────────────────────────────────── */

/**
 * Every blocking triangle in the assembly, bucketed by the cell of space it
 * sits in, so a ray walks the handful of cells in front of it instead of asking
 * every triangle whether it is there.
 *
 * Without this the pass is honest and slow: brute force over the four assemblies
 * the round was measured on takes 136 ms against the grid's 42, and the whole
 * building set would be several seconds, which is a load screen. The cells are
 * the whole difference, and the reason is not the arithmetic saved but the
 * order: a ray that is going to be blocked is nearly always blocked by something
 * very close, and walking near-to-far means it stops on the first cell rather
 * than after the last triangle.
 */
interface Grid {
  lo: [number, number, number];
  cell: number;
  n: [number, number, number];
  start: Int32Array;
  items: Int32Array;
  tri: Float32Array;
  /** Which part each triangle came from, so `self: false` can skip its own. */
  owner: Int32Array;
  /**
   * The march visits a triangle once per cell it straddles; the stamp is which
   * ray last looked at it, so the second visit is a compare instead of a
   * Möller–Trumbore.
   */
  stamp: Int32Array;
  epoch: number;
}

function buildGrid(blockers: Blocker[], far: number): Grid {
  let total = 0;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of blockers) {
    total += b.count;
    for (let a = 0; a < 3; a++) {
      if (b.lo[a]! < lo[a]!) lo[a] = b.lo[a]!;
      if (b.hi[a]! > hi[a]!) hi[a] = b.hi[a]!;
    }
  }
  const tri = new Float32Array(total * 9);
  const owner = new Int32Array(total);
  let o = 0;
  for (let bi = 0; bi < blockers.length; bi++) {
    const b = blockers[bi]!;
    tri.set(b.tri, o * 9);
    owner.fill(bi, o, o + b.count);
    o += b.count;
  }
  // Two or three triangles to a cell is the usual balance, and the cell must
  // not be so small that a ray a third of a metre long walks a hundred of them.
  const span = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!, 1e-3);
  let cell = Math.max(span / 48, far / 12, 4e-3);
  let n: [number, number, number] = [0, 0, 0];
  for (;;) {
    n = [
      Math.max(1, Math.ceil((hi[0]! - lo[0]! + 1e-6) / cell)),
      Math.max(1, Math.ceil((hi[1]! - lo[1]! + 1e-6) / cell)),
      Math.max(1, Math.ceil((hi[2]! - lo[2]! + 1e-6) / cell)),
    ];
    if (n[0]! * n[1]! * n[2]! <= 262144) break;
    cell *= 1.5;
  }
  const cells = n[0]! * n[1]! * n[2]!;
  const at = (x: number, y: number, z: number): number => (z * n[1]! + y) * n[0]! + x;
  const spanOf = (t: number): [number, number, number, number, number, number] => {
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let v = 0; v < 3; v++) {
      const px = tri[t * 9 + v * 3]!;
      const py = tri[t * 9 + v * 3 + 1]!;
      const pz = tri[t * 9 + v * 3 + 2]!;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      if (pz < z0) z0 = pz;
      if (pz > z1) z1 = pz;
    }
    return [
      Math.max(0, Math.min(n[0]! - 1, Math.floor((x0 - lo[0]!) / cell))),
      Math.max(0, Math.min(n[1]! - 1, Math.floor((y0 - lo[1]!) / cell))),
      Math.max(0, Math.min(n[2]! - 1, Math.floor((z0 - lo[2]!) / cell))),
      Math.max(0, Math.min(n[0]! - 1, Math.floor((x1 - lo[0]!) / cell))),
      Math.max(0, Math.min(n[1]! - 1, Math.floor((y1 - lo[1]!) / cell))),
      Math.max(0, Math.min(n[2]! - 1, Math.floor((z1 - lo[2]!) / cell))),
    ];
  };
  // A counting sort, because the alternative is a bucket array per cell and this
  // is one pass to size every bucket and one to fill it.
  const count = new Int32Array(cells);
  for (let t = 0; t < total; t++) {
    const [ax, ay, az, bx, by, bz] = spanOf(t);
    for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) count[at(x, y, z)]!++;
  }
  const start = new Int32Array(cells + 1);
  for (let i = 0; i < cells; i++) start[i + 1] = start[i]! + count[i]!;
  const items = new Int32Array(start[cells]!);
  const fill = new Int32Array(cells);
  for (let t = 0; t < total; t++) {
    const [ax, ay, az, bx, by, bz] = spanOf(t);
    for (let z = az; z <= bz; z++) {
      for (let y = ay; y <= by; y++) {
        for (let x = ax; x <= bx; x++) {
          const c = at(x, y, z);
          items[start[c]! + fill[c]!++] = t;
        }
      }
    }
  }
  return { lo, cell, n, start, items, tri, owner, stamp: new Int32Array(total), epoch: 0 };
}

/**
 * Amanatides & Woo: walk the cells the ray passes through, near to far, and
 * stop at the first triangle it actually meets. `skip` is the part the ray left,
 * when a part is not to occlude itself.
 */
function marchGrid(
  g: Grid,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  far: number,
  skip: number,
): boolean {
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  // Clip to the grid, so a ray that starts outside still enters it.
  let t0 = 0;
  let t1 = far;
  for (let a = 0; a < 3; a++) {
    const hi = g.lo[a]! + g.n[a]! * g.cell;
    if (Math.abs(d[a]!) < 1e-12) {
      if (o[a]! < g.lo[a]! || o[a]! > hi) return false;
      continue;
    }
    const inv = 1 / d[a]!;
    let a0 = (g.lo[a]! - o[a]!) * inv;
    let a1 = (hi - o[a]!) * inv;
    if (a0 > a1) {
      const s = a0;
      a0 = a1;
      a1 = s;
    }
    if (a0 > t0) t0 = a0;
    if (a1 < t1) t1 = a1;
    if (t0 > t1) return false;
  }
  const px = ox + dx * t0;
  const py = oy + dy * t0;
  const pz = oz + dz * t0;
  const c = [
    Math.max(0, Math.min(g.n[0]! - 1, Math.floor((px - g.lo[0]!) / g.cell))),
    Math.max(0, Math.min(g.n[1]! - 1, Math.floor((py - g.lo[1]!) / g.cell))),
    Math.max(0, Math.min(g.n[2]! - 1, Math.floor((pz - g.lo[2]!) / g.cell))),
  ];
  const step = [0, 0, 0];
  const tMax = [Infinity, Infinity, Infinity];
  const tDelta = [Infinity, Infinity, Infinity];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]!) < 1e-12) continue;
    step[a] = d[a]! > 0 ? 1 : -1;
    const edge = g.lo[a]! + (c[a]! + (d[a]! > 0 ? 1 : 0)) * g.cell;
    tMax[a] = t0 + (edge - (a === 0 ? px : a === 1 ? py : pz)) / d[a]!;
    tDelta[a] = g.cell / Math.abs(d[a]!);
  }
  const epoch = ++g.epoch;
  for (;;) {
    const ci = (c[2]! * g.n[1]! + c[1]!) * g.n[0]! + c[0]!;
    const s = g.start[ci]!;
    const e = g.start[ci + 1]!;
    for (let i = s; i < e; i++) {
      const t = g.items[i]!;
      if (g.stamp[t] === epoch) continue;
      g.stamp[t] = epoch;
      if (g.owner[t] === skip) continue;
      if (hitsTri(ox, oy, oz, dx, dy, dz, far, g.tri, t * 9)) return true;
    }
    const a = tMax[0]! < tMax[1]! ? (tMax[0]! < tMax[2]! ? 0 : 2) : tMax[1]! < tMax[2]! ? 1 : 2;
    if (tMax[a]! > t1) return false;
    c[a] = c[a]! + step[a]!;
    if (c[a]! < 0 || c[a]! >= g.n[a]!) return false;
    tMax[a] = tMax[a]! + tDelta[a]!;
  }
}

/** The lowest point of a set of parts: where the ground under them is. */
function footOf(parts: THREE.BufferGeometry[]): number {
  let y = Infinity;
  for (const g of parts) {
    g.computeBoundingBox();
    y = Math.min(y, g.boundingBox!.min.y);
  }
  return y;
}

/**
 * Bakes an assembly's own shadow into its parts. Every part is shaded by every
 * other part in the same call, and by anything in `opts.occluders` as well.
 *
 * Passing the whole building at once is the point rather than a convenience. A
 * pool occluded only against itself never sees its siblings, and thirteen of
 * thirty prototypes sampled get literally nothing from self-occlusion —
 * `stove.body` measures 0.0 % of its vertices touched alone against 16.0 % with
 * its siblings present, `bed.mattress` 0.0 against 100.0, `lamp.globe` 0.0
 * against 93.0. Self-only would put a shadow on the stove's door edge and none
 * on the shell around it, which reads as a bug rather than as a shadow.
 *
 * Nothing is moved and no vertex is added or split, so this is safe to run long
 * after the pools are built and drawing: it writes into the colour attribute
 * `colorOf` has already attached and marks it for re-upload.
 */
export function occludeParts(parts: THREE.BufferGeometry[], opts: PartsOpts = {}): THREE.BufferGeometry[] {
  const strength = opts.strength ?? AO_STRENGTH;
  const floor = opts.floor ?? AO_FLOOR;
  const far = opts.radius ?? AO_RADIUS;
  const rays = opts.rays ?? AO_RAYS;
  const bias = opts.bias ?? AO_BIAS;
  const mode = opts.mode ?? 'grid';
  const self = opts.self ?? true;
  const extra = opts.occluders ?? [];

  const blockers = [...parts, ...extra].map(blockerOf);
  // The ground is a plane, so it is two flops in the ray loop rather than two
  // triangles in the grid. It matters: a floor quad wide enough not to be missed
  // past its edge lands in every cell of the grid's bottom row, defeats the
  // traversal's whole purpose and cost 373 ms across the building set (791
  // against 418) for an answer this gets exactly.
  const groundY = (opts.ground ?? false) ? (opts.groundY ?? footOf(parts)) : null;
  const dirs = hemisphere(rays);
  const reach: Blocker[] = [];
  const grid = mode === 'grid' ? buildGrid(blockers, far) : null;

  for (let pi = 0; pi < parts.length; pi++) {
    const g = parts[pi]!;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    const col = colorOf(g);
    // Which blockers this *part* could possibly reach, decided once rather than
    // once per ray: a stove's feet and its rain cap are a metre and a half apart
    // and no ray from one has ever reached the other. Costs a box overlap per
    // pair and takes the generator's trim — ten scattered parts — from testing
    // sixteen blockers a ray to two or three.
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const near: Blocker[] = [];
    for (let bi = 0; bi < blockers.length; bi++) {
      if (bi === pi && !self) continue;
      const bl = blockers[bi]!;
      let apart = false;
      for (let a = 0; a < 3; a++) {
        const lo = a === 0 ? bb.min.x : a === 1 ? bb.min.y : bb.min.z;
        const hi = a === 0 ? bb.max.x : a === 1 ? bb.max.y : bb.max.z;
        if (bl.lo[a]! - far > hi || bl.hi[a]! + far < lo) apart = true;
      }
      if (apart) continue;
      near.push(bl);
    }
    for (let k = 0; k < pos.count; k++) {
      // Normalised, because a vertex normal in this codebase is not reliably a
      // unit vector. `THREE.LatheGeometry` builds its normals from the profile
      // rather than from the faces and does not scale them: twenty-one of the
      // lamp shade's hundred and forty-seven come out short, the worst at
      // 0.1235. The shader never notices — `normal_fragment_begin` normalises —
      // but everything on this side of it does: a short normal is a bias that
      // does not lift the ray off its own surface, and a basis built from it is
      // not orthonormal, so the directions come out longer than one and every
      // ray reaches further than `radius` claims.
      let nx = nrm.getX(k);
      let ny = nrm.getY(k);
      let nz = nrm.getZ(k);
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const ox = pos.getX(k) + nx * bias;
      const oy = pos.getY(k) + ny * bias;
      const oz = pos.getZ(k) + nz * bias;
      // An orthonormal basis about the normal: Duff et al.'s branchless build,
      // no square root and no special case at the pole. The paper writes it with
      // z as the pole; here the pole is y, so the two non-pole components are x
      // and z and the y and z rows swap with them. Getting that transpose wrong
      // is not a small error — it puts the second tangent back on top of the
      // normal, which flattens the hemisphere into a fan and leaves the
      // directions longer than one, so every ray reaches further than `radius`
      // says and the box prunes cut off blockers the rays could still reach.
      const sg = ny >= 0 ? 1 : -1;
      const a = -1 / (sg + ny);
      const b = nx * nz * a;
      const t1x = 1 + sg * nx * nx * a;
      const t1y = -sg * nx;
      const t1z = sg * b;
      const t2x = b;
      const t2y = -nz;
      const t2z = sg + nz * nz * a;
      // And which of those this *vertex* could reach. The whole reach of a ray
      // is a ball of radius `far` about the vertex, so a blocker whose box does
      // not meet that ball cannot be hit by any of the sixteen, and deciding
      // that once beats deciding it sixteen times.
      reach.length = 0;
      for (let ni = 0; ni < near.length; ni++) {
        const bl = near[ni]!;
        if (ox + far < bl.lo[0]! || ox - far > bl.hi[0]!) continue;
        if (oy + far < bl.lo[1]! || oy - far > bl.hi[1]!) continue;
        if (oz + far < bl.lo[2]! || oz - far > bl.hi[2]!) continue;
        reach.push(bl);
      }
      let blocked = 0;
      for (let r = 0; r < rays; r++) {
        const hx = dirs[r * 3]!;
        const hy = dirs[r * 3 + 1]!;
        const hz = dirs[r * 3 + 2]!;
        const dx = t1x * hx + nx * hy + t2x * hz;
        const dy = t1y * hx + ny * hy + t2y * hz;
        const dz = t1z * hx + nz * hy + t2z * hz;
        if (groundY !== null && dy < 0 && (groundY - oy) / dy < far) {
          blocked++;
          continue;
        }
        if (grid) {
          if (marchGrid(grid, ox, oy, oz, dx, dy, dz, far, self ? -1 : pi)) blocked++;
          continue;
        }
        let hit = false;
        for (let bi = 0; bi < reach.length && !hit; bi++) {
          const bl = reach[bi]!;
          if (!hitsSphere(ox, oy, oz, dx, dy, dz, far, bl)) continue;
          if (!hitsBox(ox, oy, oz, dx, dy, dz, far, bl.lo, bl.hi)) continue;
          const tri = bl.tri;
          for (let t = 0; t < tri.length; t += 9) {
            if (hitsTri(ox, oy, oz, dx, dy, dz, far, tri, t)) {
              hit = true;
              break;
            }
          }
        }
        if (hit) blocked++;
      }
      shade(col, k, Math.max(floor, 1 - strength * (blocked / rays)));
    }
    col.needsUpdate = true;
  }
  return parts;
}
