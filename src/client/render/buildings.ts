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
import { groundLiftAt } from './terrain';
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
/**
 * And how much thicker or thinner it is than that height would suggest. Height
 * alone is not variation: a wood scaled uniformly is one tree photographed at
 * several distances, which from the manager camera — where every crown is seen
 * from the same angle at the same range — is exactly the row of stamps it read
 * as. Girth goes on x and z only, so a tall thin spruce stands next to a squat
 * wide one and the two are different trees rather than the same tree twice.
 */
const TREE_GIRTH_MIN = 0.82;
const TREE_GIRTH_MAX = 1.12;
/**
 * The angle each skirt of boughs is turned past the one below it. The skirts
 * are lobed rather than round, so turning them relative to each other means a
 * tree's outline is built out of four different silhouettes stacked — and since
 * the turn is hashed per tree, no two trees stack theirs the same way. It costs
 * a quaternion per skirt and nothing on the GPU: the pools and their geometry
 * are untouched, only the matrices differ.
 */
const TREE_TWIST_MIN = 0.4;
const TREE_TWIST_MAX = 1.7;
/**
 * How deep a skirt's lobes cut, as a fraction of its radius. A quarter is what
 * it takes for the outline to read as boughs rather than as a rimmed disc from
 * directly overhead — at the seventh of it that round 6 shipped, a crown seen
 * from the manager camera was a circle with a wobble in it, and four of those
 * stacked were concentric rings. The leader takes a little less: a young shoot
 * has not put out boughs long enough to be ragged yet.
 */
const TREE_LOBE = 0.24;
/** The axis a tree leans about, in its own frame; the hashed yaw turns it. */
const LEAN_AXIS = new THREE.Vector3(1, 0, 0);
/** The skirts of a crown, bottom to top. Pushed in this order; the twist stacks. */
const TREE_SKIRTS = ['tree.lower', 'tree.mid', 'tree.upper', 'tree.top'] as const;

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** What a fence rail will reach out to: the other things that make a boundary. */
const FENCE_LINKS = new Set<BuildingKind>(['fence', 'wall', 'stonewall', 'door']);
/** What continues a wall: a corner post stands wherever a run of these stops. */
const WALL_LINKS = new Set<BuildingKind>(['wall', 'stonewall', 'door']);
/**
 * The four corners of a cell, as the sign of each axis, and the yaw that
 * turns a part built at the +x,+z corner onto each of them.
 */
const CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0],
  [1, -1, Math.PI / 2],
  [-1, -1, Math.PI],
  [-1, 1, -Math.PI / 2],
];

/**
 * The four sides of a cell, as the direction each faces and the yaw that turns
 * a part built for the +x side onto it. Same convention as `CORNERS`.
 */
const SIDES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [0, 1, -Math.PI / 2],
  [-1, 0, Math.PI],
  [0, -1, Math.PI / 2],
];

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
 * A box with the face that lies against something else left off. Boards on a
 * wall are buried a centimetre or so in the body behind them, so their back
 * face is never in front of anything, and a wall carries forty of them: leaving
 * it off is a sixth of the wall's triangles, which is what pays for the extra
 * courses. `BoxGeometry` lays its six faces down in the order +x, −x, +y, −y,
 * +z, −z, six vertices each once flattened, so the back face is simply the last
 * six and the trim is a slice.
 */
function board(w: number, h: number, d: number, y: number, x: number, z: number): THREE.BufferGeometry {
  const src = new THREE.BoxGeometry(w, h, d);
  const g = src.toNonIndexed();
  src.dispose();
  g.clearGroups();
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    g.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(0, 30 * a.itemSize), a.itemSize));
  }
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

/**
 * Which way a door faces: across the run of wall it is set in.
 *
 * Every part of a door — the frame's two jambs, the hinge the leaf swings on,
 * the handle on the far stile — is built along the x axis, and until now it was
 * drawn that way whatever it was hung in. A door in a wall running north to
 * south therefore stood broadside to it: jambs across the opening, a lintel
 * lying along the wall instead of over the gap, and a leaf that swung into the
 * masonry beside it. The wall either side is what a door is hung in, so the wall
 * either side is what picks the yaw, and a door standing on its own keeps the
 * default. Same sign convention as `CORNERS`.
 */
function doorYaw(world: World, b: Building): number {
  const linked = (dx: number, dz: number): boolean => {
    const n = buildingAt(world, b.x + dx, b.y + dz);
    return n !== null && n.built && WALL_LINKS.has(n.kind);
  };
  if (linked(1, 0) || linked(-1, 0)) return 0;
  if (linked(0, 1) || linked(0, -1)) return Math.PI / 2;
  return 0;
}

/** Paddles on a watermill wheel. Eight is where the rim stops reading as a polygon. */
const PADDLES = 8;
/** Distance from the hub out to the middle of a paddle; the blade straddles it. */
const WHEEL_R = 0.6;
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
  // A merge comes out non-indexed already; flattening it again is a copy
  // and a warning for nothing.
  const flat = g.index ? g.toNonIndexed() : g;
  flat.computeVertexNormals();
  if (flat !== g) g.dispose();
  return flat;
}

/**
 * A number in [0, 1) from an integer, and the same number every time. Anything
 * that has to be irregular but not random goes through here: a shape hashed out
 * of a seed is the same shape on reload, in both cameras and in a test.
 */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * How many lobes a skirt's outline is built out of. Two is the fattest — one
 * side of the tree heavier than the other — and six is the finest a sixteen
 * segment ring can carry without the wave landing between vertices and coming
 * back as noise.
 */
const LOBE_MIN = 2;
const LOBE_MAX = 6;
/**
 * The furthest one meridian may run from the mean, in multiples of the waves'
 * RMS. Without it a rare meridian where four lobes happen to line up would
 * pull the rim in past half its radius, which stops being a bough and starts
 * being a bite out of the crown.
 */
const LOBE_CLAMP = 1.4;

/**
 * Roughs up a lathe so it stops reading as turned on a machine. The nudge is a
 * sum of two- to six-lobed waves round the ring, each twisting as it climbs the
 * profile, so a skirt of foliage bulges out here and hangs low there the way a
 * real bough does, and the rim of one skirt drops into the next rather than
 * sitting on it as a clean horizontal circle. Low frequency matters: a
 * per-vertex hash gives a rim that is jagged but still round on average, and the
 * eye reads the average.
 *
 * The waves used to be one fixed mix — a half of two lobes, a third of three, a
 * fifth of five — with a phase per skirt. That is one outline turned four ways,
 * and turning an outline does not change it: from the manager camera, which
 * looks a tree square in the top, four copies of the same gentle oval stacked
 * are four concentric rings, which is exactly what round 6's frames showed. So
 * the amplitude *and* the phase of every lobe count are now drawn from the
 * skirt's own `seed`: one skirt is heavy on one side with a notch out of the
 * other, the skirt above it is three-cornered, and no two of them share a
 * silhouette to be concentric with. It costs nothing at runtime — the hash runs
 * once per skirt at construction — and the geometry is the size it was.
 *
 * The seam is matched by construction — the lathe keeps two copies of its
 * first meridian and every wave has a whole number of lobes, so both copies get
 * the same nudge. The bottom rim and the tip are left alone, so a skirt still
 * sits where the profile says and still comes to its point.
 */
function rumple(g: THREE.LatheGeometry, amp: number, seed: number): THREE.BufferGeometry {
  const { points, segments } = g.parameters;
  const P = points.length;
  // One gain, one phase and one twist per lobe count. The gain falls off with
  // the count because a tree's outline is carried by a few big boughs and only
  // notched by the small ones; the hash decides how much of each this skirt got.
  const gain: number[] = [];
  const phase: number[] = [];
  const twist: number[] = [];
  for (let n = LOBE_MIN; n <= LOBE_MAX; n++) {
    gain.push((0.3 + 0.7 * hash01(seed * 131 + n)) / (n - LOBE_MIN + 1.5));
    phase.push(hash01(seed * 977 + n * 29) * TAU);
    twist.push(1.2 + 3 * hash01(seed * 31 + n * 7));
  }
  // Scaled on the waves' root-mean-square rather than on the sum of their
  // gains. Five sines with hashed phases essentially never peak together, so
  // dividing by what they could in theory reach leaves every meridian a few
  // percent off the mean — which is a wobble, not a bough, and is the shape
  // round 6's crowns already had. Against the RMS a typical meridian is a whole
  // lobe out or in, and the clamp is what stops the deepest draw from cutting
  // the rim clean off the skirt.
  const rms = Math.hypot(...gain) / Math.SQRT2;
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const i = Math.floor(k / P) % segments;
    const j = k % P;
    if (j === 0 || j === P - 1) continue;
    const a = (i / segments) * TAU;
    const t = j / (P - 1);
    let f = 0;
    for (let n = LOBE_MIN; n <= LOBE_MAX; n++) {
      const c = n - LOBE_MIN;
      f += gain[c] * Math.sin(n * a + phase[c] + t * twist[c]);
    }
    f = Math.max(-LOBE_CLAMP, Math.min(LOBE_CLAMP, f / rms));
    const s = 1 + f * amp;
    // Down where the skirt runs out, up where it is tucked in: a long bough is
    // a heavy bough and it hangs. The old sign lifted the long ones instead,
    // which flattened the rim into the plane the lathe had already put it in.
    pos.setXYZ(k, pos.getX(k) * s, pos.getY(k) - f * amp * 0.45, pos.getZ(k) * s);
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
 * The bond of a plank wall, in the numbers everything else about it is derived
 * from. Seven courses over the same two and a half metres, not five: at five a
 * block was very nearly half a metre tall and the wall read as breeze block
 * rather than as the cabin's timber. The joint is the other half of that read —
 * a six-centimetre groove three deep is a black line at eye level, and the same
 * groove at three and a half by two is a shadow line, which is what a joint
 * between boards actually looks like.
 */
const PLANK_COURSES = 7;
const PLANK_FOOT = 0.04;
const PLANK_HEAD = 2.4;
const PLANK_JOINT = 0.036;
/** The outer face of a board, and how thick it is; the rest of it is inside the body. */
const PLANK_FACE = 0.52;
const PLANK_DEPTH = 0.035;
/** How much of a two-board course is carried by the closer at the cell's edge. */
const PLANK_CLOSE = 0.1;
const PLANK_PITCH = (PLANK_HEAD - PLANK_FOOT) / PLANK_COURSES;

/** The middle of course `c`. Every cell of wall puts its courses here, so a run lines up. */
function courseY(c: number): number {
  return PLANK_FOOT + PLANK_PITCH * (c + 0.5);
}

/**
 * How much lighter or darker than the wall's tint the `s`th board of course `c`
 * is: a twentieth either way, in five steps, hashed off the board's place in the
 * bond. Not decoration — a face of boards all at exactly one tone is one flat
 * brown from any distance, and a run of it is a painted plane. The hash reads
 * only the course and the board's place along it: the four faces of a cell are
 * one face turned, so a tone cannot depend on which face it lands on, and it
 * has no reason to — the eye is never on two faces of the same cell at once.
 */
function courseTone(c: number, s: number): number {
  return 0.95 + (((c * 7 + s * 3) % 5) / 4) * 0.1;
}

/** One board of a course, on the +z face, spanning `a`..`b` across the cell. */
function plank(a: number, b: number, c: number, s: number): THREE.BufferGeometry {
  const t = courseTone(c, s);
  return dye(
    board(b - a, PLANK_PITCH - PLANK_JOINT, PLANK_DEPTH, courseY(c), (a + b) / 2, PLANK_FACE - PLANK_DEPTH / 2),
    t,
    t,
    t,
  );
}

/**
 * Timber planking for a wall: seven courses of proud boards on all four faces,
 * the vertical joints of one course broken against the next the way a carpenter
 * lays boards. The even courses are one board a hair short of the cell, so
 * their joints fall at the cell's edges; the odd courses are two boards with
 * their joint in the middle of the cell and their ends stopped a tenth of a
 * metre back from each edge, for `closers` to carry the rest of the way. A run
 * of wall therefore reads as a half bond of boards rather than as cells, which
 * is what it read as when every course had its joints at the same edge and a
 * post up it: a row of filing cabinets.
 *
 * The boards sit a centimetre and a half into the body so the joint is never a
 * coplanar face, and they are at the same heights on every cell so the courses
 * run on through. On a face that meets a neighbour they are buried inside it,
 * which costs nothing to see; on an outside corner the small notch where two
 * faces' boards meet is under the corner post.
 */
function planks(): THREE.BufferGeometry {
  const face: THREE.BufferGeometry[] = [];
  for (let c = 0; c < PLANK_COURSES; c++) {
    const spans: ReadonlyArray<readonly [number, number]> =
      c % 2 === 0
        ? [[-0.5 + PLANK_JOINT / 2, 0.5 - PLANK_JOINT / 2]]
        : [
            [-0.5 + PLANK_CLOSE, -PLANK_JOINT / 2],
            [PLANK_JOINT / 2, 0.5 - PLANK_CLOSE],
          ];
    spans.forEach(([a, b], s) => face.push(plank(a, b, c, s)));
  }
  // Built once for the +z face and turned a quarter at a time onto the other
  // three, so the four faces cannot drift apart as the bond is tuned.
  const parts: THREE.BufferGeometry[] = [];
  for (let q = 0; q < 4; q++) for (const p of face) parts.push(p.clone().rotateY(q * (Math.PI / 2)));
  for (const p of face) p.dispose();
  return merge(...parts);
}

/**
 * The short board that closes a two-board course onto the cell next door,
 * pushed once for each side the run of wall actually continues along. It is
 * what makes the bond survive an opening.
 *
 * A course that simply ran flush to the cell's edge had nothing to say about
 * whether the wall went on past it, so where a run stopped — and a door is
 * where a run stops most often — every course stopped in the same place and the
 * vertical joints stacked into one unbroken column beside the jamb, which was
 * the one spot in a wall where the bond visibly broke down. Held back a tenth
 * of a metre and closed by a separate part instead, a course that continues is
 * unbroken as before, and a course that does not ends a tenth short of the
 * one-board course above it. The alternation goes right up to the opening.
 *
 * Two boards per course, one for each face that meets the side being closed;
 * the geometry is built for the +x side and turned onto the others at draw
 * time. The far end runs a couple of millimetres past the cell so it laps the
 * neighbour's closer rather than meeting it on a shared plane.
 */
function closers(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const a = 0.5 - PLANK_CLOSE + PLANK_JOINT;
  const b = 0.502;
  for (let c = 1; c < PLANK_COURSES; c += 2) {
    const near = plank(a, b, c, 2);
    // The same board on the −z face: turned to put its open back into the wall,
    // then carried back across to the +x side it belongs to.
    parts.push(near, near.clone().rotateY(Math.PI).translate(a + b, 0, 0));
  }
  return merge(...parts);
}

/**
 * One block of masonry, standing proud of a wall face with its outer face
 * drawn in a little so every edge is a bevel. It is a square frustum — a
 * four-sided cylinder with a smaller top than base, turned so its axis points
 * out of the wall — because that is the cheapest bevelled block there is:
 * sixteen triangles, where a rounded box is over a hundred, and a stone wall
 * is instanced by the hundred. `w` and `h` are the block's size across the
 * face, `proud` is how far its outer face stands off the plane it is set in,
 * and the geometry comes out with its base on y = 0 and its face at y =
 * `proud`, ready to be turned onto whichever face of the wall it belongs to.
 * Face normals are baked in at the merge: a block is honestly faceted.
 */
function block(w: number, h: number, proud: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(Math.SQRT2 * 0.8, Math.SQRT2, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  g.scale(w / 2, proud, h / 2);
  return g;
}

/** How far a wall face is from the cell's centre: the stone body's half-width, less a little so a block's base is buried. */
const STONE_FACE = 0.46;

/**
 * Coursed stone for the stone wall: five courses of bevelled blocks round all
 * four faces, each course's joint staggered against the one below the way a
 * mason breaks bond, and every block standing a slightly different distance
 * off the wall and sitting a hair above or below its neighbour. The recessed
 * joints between are the body itself. The offsets are the whole point — a
 * face of blocks at exactly one depth is a face with lines drawn on it, and a
 * face where each block catches its own edge of light is masonry — and they
 * come from a hash of the block's place on the wall, so every cell of wall is
 * the same wall, and a run reads as one bond rather than as cells.
 *
 * Built in two halves, `parity` picking the odd or the even courses, because
 * forty bevelled blocks are more triangles than a part instanced by the
 * hundred is allowed to spend, and twenty-four are not. Both halves stay
 * inside the plinth and coping footprint, so the wall's outline is still the
 * box the sim collides with.
 */
function masonry(parity: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const joints = [-0.12, 0.15, -0.04, 0.18, -0.16];
  for (let c = parity; c < 5; c += 2) {
    const y = 0.56 + c * 0.42;
    const joint = joints[c]!;
    const w1 = joint - 0.02 + STONE_FACE;
    const w2 = STONE_FACE - (joint + 0.02);
    for (let face = 0; face < 4; face++) {
      for (const [w, u] of [
        [w1, -STONE_FACE + w1 / 2],
        [w2, STONE_FACE - w2 / 2],
      ] as const) {
        const hash = (c * 31 + face * 7 + Math.round(u * 100)) % 5;
        const proud = 0.035 + hash * 0.006;
        const g = block(w, 0.34 + (hash % 3) * 0.02, proud);
        // Stand the block up — width across, height up, proud towards +z —
        // then turn it a quarter at a time round the wall: +z, +x, −z, −x.
        g.rotateX(Math.PI / 2);
        g.rotateY(face * (Math.PI / 2));
        const out = face % 2 === 0 ? 0 : 1;
        const sign = face < 2 ? 1 : -1;
        g.translate(out === 0 ? u : sign * STONE_FACE, y + (hash - 2) * 0.006, out === 0 ? sign * STONE_FACE : u);
        parts.push(g);
      }
    }
  }
  return faceted(merge(...parts));
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

/**
 * A part that has to come out *lighter* than its palette entry. The material
 * colour multiplies the instance tint, and nothing says the multiplier has to
 * stay under one: a watermill's palette entry is a dark timber, and a paddle
 * toned darker still under it multiplies down to three percent reflectance —
 * which is the near-black wheel that looked broken in every frame since the
 * mill was built. The three factors are per channel in linear light, so a
 * warm (r > b) lift also warms the part.
 */
function lifted(r: number, g: number, b: number, rough: number, metal = 0.04): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: rough, metalness: metal });
  m.color.setRGB(r, g, b);
  return m;
}

/**
 * Timber under the wall's tint. The planking and the closers are two pools and
 * so two materials, hence a function rather than a const; `vertexColors` is what
 * lets one pool of forty boards carry forty tones of the same timber.
 */
function plankMat(): THREE.MeshStandardMaterial {
  const m = tone(0xb9ad98, 0.9);
  m.vertexColors = true;
  return m;
}

/**
 * Paints every vertex of a part one colour. A pool has one material, and a
 * stack of anything is two colours at least — bark and the cut end of a log,
 * a white case and the red band round it — so the second colour goes into the
 * geometry as a vertex colour, which the material multiplies under its own.
 * The three factors are linear, like `lifted`: one leaves the pool's colour
 * alone, and a factor over one lightens, which is how the cut ends come out
 * paler than the bark under the same brown.
 */
function dye(g: THREE.BufferGeometry, r: number, gr: number, b: number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    col[k * 3] = r;
    col[k * 3 + 1] = gr;
    col[k * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * A cylinder with its caps one colour and its side another: a log's cut ends,
 * the turned-in face of a rolled pelt. Told apart by the normal — the caps
 * point straight along the axis and nothing on the side does — so it has to
 * be called before the part is turned to lie down.
 */
function dyeEnds(g: THREE.BufferGeometry, side: readonly [number, number, number], cap: readonly [number, number, number]): THREE.BufferGeometry {
  const nrm = g.attributes.normal;
  const n = nrm.count;
  const col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const c = Math.abs(nrm.getY(k)) > 0.9 ? cap : side;
    col[k * 3] = c[0];
    col[k * 3 + 1] = c[1];
    col[k * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A stack of wood: five short logs, three side by side and two laid across them, with pale cut ends. */
function logs(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const log = (len: number, r: number): THREE.BufferGeometry => dyeEnds(cylinder(r, r, len, 0, 12), [1, 1, 1], [1.75, 1.6, 1.35]);
  for (const [z, len, twist] of [
    [-0.19, 0.5, 0.05],
    [0, 0.54, -0.03],
    [0.19, 0.48, 0.06],
  ] as const) {
    const g = log(len, 0.088);
    g.rotateZ(Math.PI / 2);
    g.rotateY(twist);
    g.translate(0, 0.088, z);
    parts.push(g);
  }
  for (const [x, len, twist] of [
    [-0.13, 0.5, 0.04],
    [0.13, 0.46, -0.05],
  ] as const) {
    const g = log(len, 0.082);
    g.rotateZ(Math.PI / 2);
    g.rotateY(Math.PI / 2 + twist);
    g.translate(x, 0.255, 0);
    parts.push(g);
  }
  return merge(...parts);
}

/** A stack of steel: six ingots in a three-two-one pyramid, each row a shade brighter than the one under it. */
function ingots(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rows: ReadonlyArray<readonly [number, number, ReadonlyArray<number>]> = [
    [0.05, 1, [-0.17, 0, 0.17]],
    [0.15, 1.06, [-0.085, 0.085]],
    [0.25, 1.12, [0]],
  ];
  for (const [y, shade, zs] of rows) {
    for (const z of zs) parts.push(dye(rbox(0.46, 0.1, 0.14, y, 0, z, 0.03, 1), shade, shade, shade * 1.02));
  }
  const g = merge(...parts);
  g.rotateY(0.18);
  return g;
}

/**
 * A stack of raw food: a heaped mound with tubers lying on it and a couple of
 * leaves still on. The tubers are warmer than the heap and the leaves greener,
 * so the pile reads as dug-up things rather than as a green lump.
 */
function harvest(): THREE.BufferGeometry {
  const mound = new THREE.SphereGeometry(0.3, 16, 5, 0, TAU, 0, Math.PI / 2);
  mound.scale(1, 0.7, 1);
  const parts: THREE.BufferGeometry[] = [dye(mound, 1, 1, 1)];
  for (const [x, z, y, r] of [
    [0.1, 0.06, 0.2, 0.075],
    [-0.12, 0.05, 0.18, 0.07],
    [0.02, -0.13, 0.19, 0.08],
    [-0.05, 0.14, 0.17, 0.065],
  ] as const) {
    const t = new THREE.SphereGeometry(r, 8, 6);
    t.scale(1.35, 0.8, 1);
    t.rotateY(x * 7 + z * 3);
    t.translate(x, y, z);
    parts.push(dye(t, 1.3, 0.98, 0.72));
  }
  for (const [x, z, yaw] of [
    [0.15, -0.09, 0.6],
    [-0.13, -0.11, -1.1],
  ] as const) {
    const leaf = new THREE.SphereGeometry(0.11, 8, 5);
    leaf.scale(1.6, 0.18, 0.7);
    leaf.rotateY(yaw);
    leaf.translate(x, 0.2, z);
    parts.push(dye(leaf, 0.75, 1.15, 0.6));
  }
  return merge(...parts);
}

/**
 * A slatted crate: a darker box with pale slats standing off its faces, a
 * batten up each corner and a lid. `strapped` buckles a leather strap over
 * the lid — a crate of meals is packed and going somewhere — and `open` leaves
 * the lid off so what is inside can stand up out of it.
 */
function crate(strapped: boolean, open: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [dye(rbox(0.54, 0.22, 0.54, 0.12, 0, 0, 0.02, 1), 0.78, 0.78, 0.78)];
  for (const y of [0.06, 0.13, 0.2]) {
    parts.push(dye(box(0.56, 0.05, 0.02, y, 0, 0.28), 1.12, 1.1, 1.04));
    parts.push(dye(box(0.56, 0.05, 0.02, y, 0, -0.28), 1.12, 1.1, 1.04));
    parts.push(dye(box(0.02, 0.05, 0.56, y, 0.28, 0), 1.12, 1.1, 1.04));
    parts.push(dye(box(0.02, 0.05, 0.56, y, -0.28, 0), 1.12, 1.1, 1.04));
  }
  for (const x of [-0.27, 0.27]) for (const z of [-0.27, 0.27]) parts.push(dye(box(0.04, 0.24, 0.04, 0.12, x, z), 0.95, 0.93, 0.9));
  if (!open) parts.push(dye(rbox(0.6, 0.05, 0.6, 0.265, 0, 0, 0.015, 1), 1.08, 1.06, 1));
  if (strapped) {
    parts.push(dye(box(0.64, 0.025, 0.07, 0.3, 0, 0), 0.32, 0.26, 0.2));
    parts.push(dye(box(0.025, 0.3, 0.07, 0.15, 0.315, 0), 0.32, 0.26, 0.2));
    parts.push(dye(box(0.025, 0.3, 0.07, 0.15, -0.315, 0), 0.32, 0.26, 0.2));
    parts.push(dye(box(0.06, 0.035, 0.09, 0.305, 0.08, 0), 0.7, 0.7, 0.72));
  }
  return merge(...parts);
}

/**
 * A stack of medicine: a white case with a red band round it and a red cross
 * on the lid, a handle on top and a clasp either side. The band is the part
 * that carries it from the manager camera, where a white box is a white box.
 */
function medkit(): THREE.BufferGeometry {
  const red: readonly [number, number, number] = [1.05, 0.12, 0.1];
  const iron: readonly [number, number, number] = [0.3, 0.3, 0.32];
  return merge(
    dye(rbox(0.54, 0.26, 0.4, 0.13, 0, 0, 0.04), 1, 1, 1),
    dye(box(0.56, 0.07, 0.42, 0.13), ...red),
    dye(box(0.16, 0.012, 0.05, 0.264), ...red),
    dye(box(0.05, 0.012, 0.16, 0.264), ...red),
    dye(rbox(0.2, 0.035, 0.04, 0.3, 0, 0, 0.012, 1), ...iron),
    dye(box(0.03, 0.04, 0.04, 0.275, -0.085, 0), ...iron),
    dye(box(0.03, 0.04, 0.04, 0.275, 0.085, 0), ...iron),
    dye(box(0.05, 0.05, 0.02, 0.13, -0.14, 0.205), ...iron),
    dye(box(0.05, 0.05, 0.02, 0.13, 0.14, 0.205), ...iron),
  );
}

/**
 * A stack of hide: one pelt rolled up, fur out, with the outer wrap's edge
 * lying over the roll and a tie round each end. The ends of the roll and the
 * lip of the wrap are the pale flesh side, which is what says "skin" rather
 * than "log" from above.
 */
function pelt(): THREE.BufferGeometry {
  const R = 0.14;
  const flesh: readonly [number, number, number] = [1.22, 1.1, 0.96];
  const roll = dyeEnds(cylinder(R, R, 0.52, 0, 16), [1, 1, 1], flesh);
  roll.rotateZ(Math.PI / 2);
  roll.translate(0, R, 0);
  // An open arc a hair over the roll, from the front round over the top and
  // down the back, ending in a lip the pelt's own thickness.
  const wrap = new THREE.CylinderGeometry(R + 0.015, R + 0.015, 0.5, 16, 1, true, 0.3, 2.4);
  wrap.rotateZ(Math.PI / 2);
  wrap.translate(0, R, 0);
  const parts: THREE.BufferGeometry[] = [roll, dye(wrap, 0.92, 0.88, 0.84), dye(box(0.5, 0.025, 0.09, R + 0.055, 0, -0.145), ...flesh)];
  // The ties stand off the fur, so it is the ties the roll rests on: the
  // whole thing is lifted by their reach, or their undersides are in the turf.
  const tie = 0.02 + 0.012;
  for (const x of [-0.17, 0.17]) {
    const ring = new THREE.TorusGeometry(R + 0.02, 0.012, 5, 16);
    ring.rotateY(Math.PI / 2);
    ring.translate(x, R, 0);
    parts.push(dye(ring, 0.4, 0.32, 0.25));
  }
  const g = merge(...parts);
  g.rotateY(0.35);
  g.translate(0, tie, 0);
  return g;
}

/** A stack of components: an open crate with cogs standing up out of it and a rod laid across. */
function cogs(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [crate(false, true)];
  for (const [x, z] of [
    [-0.12, 0.08],
    [0.1, -0.1],
    [0.03, 0.15],
  ] as const) {
    parts.push(dye(cylinder(0.09, 0.09, 0.03, 0.255, 12).translate(x, 0, z), 1.2, 1.15, 1));
  }
  const rod = cylinder(0.02, 0.02, 0.44, 0, 8);
  rod.rotateZ(Math.PI / 2);
  rod.rotateY(0.5);
  rod.translate(0, 0.27, -0.06);
  parts.push(dye(rod, 0.5, 0.5, 0.52));
  return merge(...parts);
}

/** A stack of assemblies: a machine crated shut, strapped twice and seamed where the lid goes on. */
function bundle(): THREE.BufferGeometry {
  return merge(
    dye(rbox(0.56, 0.3, 0.5, 0.15, 0, 0, 0.03, 1), 1, 1, 1),
    dye(box(0.58, 0.31, 0.06, 0.155, 0, 0.14), 0.3, 0.28, 0.25),
    dye(box(0.58, 0.31, 0.06, 0.155, 0, -0.14), 0.3, 0.28, 0.25),
    dye(box(0.57, 0.012, 0.51, 0.24), 0.6, 0.58, 0.54),
  );
}

/**
 * The shape and finish of a stack of each kind. One geometry per kind's pool,
 * because five of the six used to be the same bevelled cube in different
 * colours, and a yard of cubes is a yard the player has to click to read. Each
 * is built to top out at about `STACK_H`, so a pile of mixed kinds still steps
 * up by the same amount. Steel is the only cold thing here and the only thing
 * with a metalness worth the name; medicine is the one smooth case.
 */
const STACK_SHAPE: Record<ResourceKind, { build: () => THREE.BufferGeometry; rough: number; metal: number }> = {
  wood: { build: logs, rough: 0.9, metal: 0.02 },
  steel: { build: ingots, rough: 0.45, metal: 0.35 },
  rawfood: { build: harvest, rough: 0.85, metal: 0.02 },
  meal: { build: () => crate(true, false), rough: 0.8, metal: 0.02 },
  medicine: { build: medkit, rough: 0.35, metal: 0.04 },
  hide: { build: pelt, rough: 0.95, metal: 0.02 },
  components: { build: cogs, rough: 0.55, metal: 0.25 },
  assemblies: { build: bundle, rough: 0.6, metal: 0.2 },
};

/** A stack's own height — the step from one stack in a pile to the next. */
const STACK_H = 0.3;
/** How far a pile may climb before further stacks just share the top stack's spot. */
const PILE_MAX = 0.75;
/** How big a handful is drawn, against a full load. */
const STACK_SMALL = 0.7;

/**
 * How big a stack is drawn for how much is in it: a handful at seven tenths,
 * growing to full size by ten and holding there. Above that the pile rises
 * instead (see `sync`) — the lift only started at twenty-five, which left a
 * single log and ten of them the same object on the ground.
 */
function stackSize(amount: number): number {
  if (amount <= 5) return STACK_SMALL;
  if (amount >= 10) return 1;
  return STACK_SMALL + (1 - STACK_SMALL) * ((amount - 5) / 5);
}

/**
 * How high off y = 0 a loose stack sits on this cell: on the furniture there,
 * or else on the drawn ground. The ground is not the plane — a snowpack lifts
 * it and a lake bed sinks it (`groundLiftAt`) — and a stack drawn at zero
 * under a full pack was a lid flush with the snow. It never follows the ground
 * down, though: the lift at a cell's centre is an average of its corners, and
 * on a bank one corner is always higher than that, so a stack that sat at the
 * average would have that corner of it under the turf. Resting at the plane
 * on a bank is a stack a little proud of the slope, which is what a stack on a
 * slope looks like.
 */
function itemRest(world: World, x: number, y: number): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const b = buildingAt(world, cx, cy);
  if (b && b.built) return ITEM_REST[b.kind] ?? defOf(b.kind).standHeight;
  return Math.max(0, groundLiftAt(world, cx, cy));
}

/**
 * Four legs under an apron, for anything that stands on a top: `pitch` is half
 * the leg spacing, and the legs taper from `rTop` at the apron down to
 * `rBottom` at the floor.
 *
 * The apron is the part that was missing. A top on four posts is a plate on
 * sticks from the manager camera — there is nothing between the underside of
 * the top and the floor but daylight, so the top reads as floating and the legs
 * as a shadow. A real table has a frame the legs are jointed into, immediately
 * under the top, and the band of timber it puts round the table at that height
 * is what closes the silhouette. It is set a centimetre inside the leg line
 * rather than flush with it, so the legs still stand out as legs and each one
 * catches its own highlight down the corner.
 */
function legs(pitch: number, h: number, rTop: number, rBottom: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-pitch, pitch]) {
    for (const z of [-pitch, pitch]) parts.push(cylinder(rTop, rBottom, h, h / 2, 12).translate(x, 0, z));
  }
  const inset = pitch - 0.012;
  const apron = h - 0.06;
  parts.push(rbox(pitch * 2, 0.12, 0.045, apron, 0, inset, 0.015, 1));
  parts.push(rbox(pitch * 2, 0.12, 0.045, apron, 0, -inset, 0.015, 1));
  parts.push(rbox(0.045, 0.12, pitch * 2, apron, inset, 0, 0.015, 1));
  parts.push(rbox(0.045, 0.12, pitch * 2, apron, -inset, 0, 0.015, 1));
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
  /** A tree's base rotation with one skirt's twist folded in; see the tree draw. */
  private readonly crown = new THREE.Quaternion();
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
    this.pool('wall.planks', planks(), plankMat(), 256);
    this.pool('wall.closer', closers(), plankMat(), 256);
    this.pool('wall.cap', rbox(1.06, 0.18, 1.06, 2.51, 0, 0, 0.06), solidMat(0.8), 256);
    // A square post standing proud at a corner of the wall — pushed once per
    // outside corner, which the draw works out from the neighbours, so a
    // cabin gets a post at each of its four corners and a run of wall gets
    // one pair at each end and none along its length. A corner is where the
    // eye checks whether a building is a building or a row of cubes, and a
    // post there is what a framed wall actually has. Built at the +x,+z
    // corner and turned onto the others at draw time; it sits a hair inside
    // the cell so the wall's reach stays what the collision says.
    this.pool('wall.post', rbox(0.16, 2.5, 0.16, 1.25, 0.47, 0.47, 0.03, 1), solidMat(0.85), 64);

    // Stone wall: the same silhouette as timber so a mixed perimeter still reads as
    // one wall, but with a proud plinth at the base, coursed stone up the face and
    // a heavier coping. It is the colour that carries the difference — see
    // BUILDING_COLOR.stonewall. The courses are two pools of one bond: see
    // `masonry` for why.
    this.pool('stone.plinth', rbox(1.04, 0.34, 1.04, 0.17), solidMat(0.95), 256);
    this.pool('stone.body', box(0.94, 2.2, 0.94, 1.44), solidMat(0.95), 256);
    this.pool('stone.courses', masonry(0), tone(0xb4b4b0, 0.9), 256);
    this.pool('stone.bond', masonry(1), tone(0xa8a8a4, 0.9), 256);
    this.pool('stone.cap', rbox(1.1, 0.2, 1.1, 2.62, 0, 0, 0.05), solidMat(0.85), 256);

    // Research bench: a desk with glassware on it and a small brass lamp over
    // it, so it reads as thinking-work rather than another workbench from across
    // the map. The flask is the part that carries it — nothing else in the colony
    // is made of glass.
    //
    // The gables stop ten centimetres short of the ground and stand on feet.
    // A cabinet whose sides run into the turf is a block; the daylight under it
    // is what makes it furniture, and it costs four short turnings. The top
    // stays exactly where it was — `def.height` is the lamp over it, and the
    // desk is not allowed to grow into that.
    this.pool(
      'lab.desk',
      (() => {
        const parts: THREE.BufferGeometry[] = [
          rbox(0.98, 0.08, 0.7, 0.7, 0, 0, 0.035),
          rbox(0.08, 0.56, 0.62, 0.38, -0.43, 0, 0.035, 1),
          rbox(0.08, 0.56, 0.62, 0.38, 0.43, 0, 0.035, 1),
          rbox(0.7, 0.36, 0.04, 0.36, 0, -0.29, 0.015, 1),
        ];
        for (const x of [-0.43, 0.43]) {
          for (const z of [-0.26, 0.26]) parts.push(cylinder(0.04, 0.055, 0.1, 0.05, 10).translate(x, 0, z));
        }
        return merge(...parts);
      })(),
      solidMat(0.8),
      8,
    );
    // The riser at the back of the desk is where the reading is done, so it is a
    // console rather than a painted board: a bezel round the screen, a rail of
    // three dials under it, and the screen itself in the same pale glass the
    // flask is made of, which is the one material in the colony that reads as
    // lit from any angle.
    this.pool(
      'lab.console',
      (() => {
        const parts: THREE.BufferGeometry[] = [rbox(0.36, 0.24, 0.025, 0.46, -0.1, -0.258, 0.01, 1)];
        for (const x of [0.13, 0.22, 0.31]) parts.push(cylinder(0.03, 0.03, 0.04, 0, 8).rotateX(Math.PI / 2).translate(x, 0.42, -0.25));
        parts.push(box(0.28, 0.04, 0.02, 0.29, 0.22, -0.258));
        return merge(...parts);
      })(),
      tone(0x3a3f46, 0.45, 0.35),
      8,
    );
    this.pool(
      'lab.glass',
      merge(
        sphere(0.11, 0.85, 0.2, 0.1, 16, 12),
        cylinder(0.035, 0.04, 0.16, 0.99, 12).translate(0.2, 0, 0.1),
        box(0.3, 0.18, 0.02, 0.46, -0.1, -0.248),
      ),
      tone(0xe6f2f0, 0.12, 0.1),
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
    // The handle is a lever on a backplate, either side of the panel, in dark
    // iron. It used to be a pair of knobs the size of a walnut, which from the
    // distance a settler sees a cabin at were two dark pixels; a lever the
    // length of a hand and a plate behind it are a door's furniture at that
    // range, and they are what tells a door from a wall with a lighter panel.
    this.pool(
      'door.handle',
      merge(
        rbox(0.09, 0.24, 0.02, 1.05, 0.8, 0.075, 0.008, 1),
        rbox(0.09, 0.24, 0.02, 1.05, 0.8, -0.075, 0.008, 1),
        cylinder(0.022, 0.022, 0.26, 0, 12).rotateX(Math.PI / 2).translate(0.8, 1.05, 0),
        cylinder(0.02, 0.024, 0.16, 0, 12).rotateZ(Math.PI / 2).translate(0.72, 1.05, 0.12),
        cylinder(0.02, 0.024, 0.16, 0, 12).rotateZ(Math.PI / 2).translate(0.72, 1.05, -0.12),
        sphere(0.03, 1.05, 0.64, 0.12, 12, 8),
        sphere(0.03, 1.05, 0.64, -0.12, 12, 8),
      ),
      tone(0x3a322a, 0.4, 0.5),
      32,
    );
    // The frame is a shade lighter than the panel under the same tint, so the
    // opening reads as an opening — jambs and a lintel round a darker leaf —
    // rather than as one slab of door-coloured wall.
    this.pool(
      'door.frame',
      merge(
        rbox(0.12, 2.45, 0.28, 1.225, -0.5, 0, 0.03, 1),
        rbox(0.12, 2.45, 0.28, 1.225, 0.5, 0, 0.03, 1),
        rbox(1, 0.3, 0.5, 2.45, 0, 0, 0.05),
      ),
      tone(0xd6cbb8, 0.85),
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
        // The grille starts above the bed's own end rail rather than inside it:
        // a cross-rail buried in the frame is a rail nobody sees and two faces a
        // millimetre apart for the depth buffer to argue over. The uprights run
        // down through the rail so the grille is still bolted to something.
        const parts: THREE.BufferGeometry[] = [box(0.9, 0.04, 0.05, 0.38, 0, -0.46), box(0.9, 0.04, 0.05, 0.86, 0, -0.46)];
        for (let i = 0; i < 7; i++) parts.push(cylinder(0.015, 0.015, 0.62, 0.57, 12).translate(-0.39 + i * 0.13, 0, -0.46));
        return merge(...parts);
      })(),
      tone(0x4a4c50, 0.5, 0.4),
      16,
    );

    // A dining table: a top with a properly eased edge on an apron and four
    // legs that taper toward the floor. The taper was the wrong way round —
    // thin at the top and thick at the foot, which is a stool leg, not a
    // table's — and reading the two numbers as "at the apron" and "at the
    // floor" is the whole fix. The top's height is fixed by `ITEM_REST`, which
    // is where a hauled stack comes to rest on it: 0.9, and the slab is built
    // down from that.
    this.pool('table.top', rbox(0.98, 0.08, 0.98, 0.86, 0, 0, 0.035), solidMat(0.7), 32);
    this.pool('table.legs', legs(0.4, 0.82, 0.055, 0.034), solidMat(0.8), 32);

    // A games table: a smaller top than the dining table, a dark board laid on
    // it with pale pieces standing on the board, and a stool either side. The
    // board is the whole point — from the manager camera the two tables are the
    // same silhouette, and the dark square on top is what tells you which one
    // your settlers are playing at. Its material multiplies under the palette
    // tint, the same trick the grave uses to get two tones from one entry.
    this.pool('game.top', rbox(0.74, 0.08, 0.74, 0.77, 0, 0, 0.035), solidMat(0.7), 24);
    this.pool('game.legs', legs(0.28, 0.73, 0.048, 0.03), solidMat(0.8), 24);
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
    //
    // The shells of the machines — this one, the cooler, the heater, the
    // generator, the battery — carry a six-centimetre bevel and a roughness
    // under a half. Both were smaller once, and at the manager camera's range
    // a three-centimetre bevel is a line too thin to see and a rough shell is
    // a shell with no highlight, which together is a box. The scene has an
    // environment map; a cast shell at 0.4 catches it along every eased edge.
    //
    // And it stands on feet. A machine whose shell goes straight into the turf
    // is a box someone dropped: the ground meets it in a hard line with no
    // shadow under it, which at manager zoom is the single thing that made the
    // stove, the cooler, the battery and the generator read as blocks with
    // decals rather than as objects standing in a colony. Fourteen centimetres
    // of cast foot under all four corners gives the shell a shadow to sit in
    // and a gap the grass shows through, and everything above is lifted by
    // exactly that.
    this.pool(
      'stove.feet',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (const x of [-0.3, 0.3]) {
          for (const z of [-0.3, 0.3]) parts.push(cylinder(0.06, 0.085, 0.14, 0.07, 12).translate(x, 0, z));
        }
        parts.push(box(0.78, 0.06, 0.1, 0.11, 0, -0.3));
        parts.push(box(0.78, 0.06, 0.1, 0.11, 0, 0.3));
        return merge(...parts);
      })(),
      tone(0x36363b, 0.55, 0.35),
      16,
    );
    this.pool('stove.body', rbox(0.88, 0.9, 0.86, 0.59, 0, 0, 0.06), solidMat(0.4), 16);
    // A firebox door, hung: a fixed surround proud of the shell, a leaf proud of
    // that, two hinge knuckles down one stile and a lever handle on the other.
    // It was a dark rectangle lying on the face with a bar across it, which is a
    // decal — the depth is what says "this opens", and it is two centimetres of
    // it either side of the joint.
    this.pool(
      'stove.door',
      merge(
        rbox(0.64, 0.5, 0.04, 0.58, 0, 0.44, 0.015, 1),
        rbox(0.5, 0.38, 0.05, 0.58, 0, 0.475, 0.015, 1),
        cylinder(0.032, 0.032, 0.09, 0.45, 12).translate(-0.27, 0, 0.46),
        cylinder(0.032, 0.032, 0.09, 0.71, 12).translate(-0.27, 0, 0.46),
        cylinder(0.018, 0.018, 0.055, 0, 10).rotateX(Math.PI / 2).translate(0.19, 0.58, 0.5275),
        box(0.1, 0.03, 0.03, 0.58, 0.19, 0.535),
      ),
      tone(0x2e2e33, 0.4, 0.3),
      16,
    );
    // The air intake under the firebox, as louvres rather than as a dark patch:
    // three blades tipped down out of a recessed plate, so the light gets under
    // each one and the shadow it throws is the vent. A flat rectangle in a
    // darker colour is the thing this replaces, and it never read as an opening
    // from any angle.
    this.pool(
      'stove.vents',
      (() => {
        const parts: THREE.BufferGeometry[] = [box(0.52, 0.16, 0.02, 0.24, 0, 0.425)];
        for (let i = 0; i < 3; i++) {
          const blade = box(0.44, 0.03, 0.07, 0, 0, 0);
          blade.rotateX(-0.6);
          blade.translate(0, 0.18 + i * 0.055, 0.44);
          parts.push(blade);
        }
        return merge(...parts);
      })(),
      tone(0x27272b, 0.6, 0.25),
      16,
    );
    // A stovepipe, not a stub. It used to stop thirty centimetres over the shell,
    // which from a body's eye height is a cap on a box; a flue leaves the roof of
    // the firebox, climbs half a metre with a collar where it passes the shell,
    // and finishes in a rain cap.
    this.pool(
      'stove.flue',
      merge(
        cylinder(0.07, 0.075, 0.5, 1.29, 16).translate(-0.26, 0, -0.26),
        cylinder(0.095, 0.095, 0.05, 1.1, 16).translate(-0.26, 0, -0.26),
        cylinder(0.095, 0.095, 0.04, 1.47, 16).translate(-0.26, 0, -0.26),
        cylinder(0.1, 0.085, 0.06, 1.56, 16).translate(-0.26, 0, -0.26),
      ),
      tone(0x3a3a3f, 0.6, 0.3),
      16,
    );
    this.pool(
      'stove.plate',
      merge(cylinder(0.14, 0.14, 0.025, 1.05, 20).translate(-0.2, 0, 0.1), cylinder(0.14, 0.14, 0.025, 1.05, 20).translate(0.2, 0, 0.1)),
      new THREE.MeshStandardMaterial({
        color: 0x3a3a40,
        emissive: new THREE.Color(0x2a0d05),
        roughness: 0.35,
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
        // Five boards at a fifth of a metre, each 0.15 wide: the five centimetres
        // between them is the point. At 0.17 the gap was three centimetres, which
        // at the manager camera's range is a seam the eased edges close up
        // entirely, and a slatted top with no visible slots is a plank. The top
        // still lands at 0.92 — `ITEM_REST` puts a hauled stack there.
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 5; i++) parts.push(rbox(0.15, 0.1, 0.78, 0.87, -0.4 + i * 0.2, 0, 0.02, 1));
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
    //
    // Every part of the mill is lifted over its palette entry, which is the
    // darkest timber in the palette: under it a white house came out as a
    // brown one and a brown paddle as a black one, and the wheel — the whole
    // point of the machine — was a black disc with no spokes in it from either
    // camera. The lifts are warm, so the mill reads as oak and rust rather
    // than as a grey building that happens to be on a lake.
    this.pool('mill.house', rbox(0.62, 1.05, 0.78, 0.525, -0.3, 0, 0.04, 1), lifted(1.8, 1.65, 1.5, 0.8), 8);
    // The pitched cap. Not decoration — it is what stops the house reading as
    // another grey cabinet in the isometric distance, where the wheel behind it
    // is only a few pixels of moving edge. It is the one honestly faceted thing
    // here, and it keeps its facets.
    //
    // A gable now rather than the hip pyramid it was. Straight down from twenty
    // cells up a hip is a diamond, and a diamond drawn on the top of a box is a
    // box with a lid on it, which is what the mill read as; a ridge running
    // across the machine is a roof from any angle the manager camera takes. It
    // is extruded from a triangle, so the two slopes are two planes and nothing
    // else, and it oversails the house by a hand's width all round: the shadow
    // an eaves throws down the wall is most of what says roof.
    this.pool(
      'mill.roof',
      (() => {
        const gable = new THREE.Shape();
        gable.moveTo(-0.47, 0);
        gable.lineTo(0.47, 0);
        gable.lineTo(0, 0.36);
        gable.closePath();
        const g = new THREE.ExtrudeGeometry(gable, { depth: 0.94, bevelEnabled: false, curveSegments: 1 });
        g.translate(-0.3, 1.05, -0.47);
        // A ridge board over the join, because the one line of the roof the
        // top-down camera always has square on is the ridge.
        return faceted(merge(g, box(0.09, 0.07, 0.98, 1.4, -0.3, 0)));
      })(),
      lifted(1.25, 1.1, 1.0, 0.8),
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
      lifted(2.2, 2.2, 2.4, 0.45, 0.4),
      8,
    );
    // One paddle, drawn eight times per wheel at eight angles, each carrying its
    // own spoke and its eighth of the rim. A merged wheel would be one instance
    // instead of eight, but it would also be one rigid ring: this way the blades
    // catch the light at different angles as they come round, which is most of
    // what makes the thing read as turning at all. Built at the top of the wheel
    // and swept round the axle at draw time, so the geometry's own origin is the
    // hub.
    //
    // The blade stands radially, a board a quarter of a metre deep straddling
    // the rim, the way an undershot wheel's do; it was a tread lying along the
    // rim, and from twenty cells up a wheel of treads is a disc. The blade is
    // the pale part and the spoke and rim behind it are dyed to a third of it
    // — one pool, two tones — because a wheel is read by the dark spokes
    // between the light blades, and a wheel all one colour at distance is the
    // same disc again.
    this.pool(
      'mill.paddle',
      merge(
        dye(rbox(0.5, 0.28, 0.05, WHEEL_R + 0.03, 0, 0, 0.012, 1), 1, 1, 1),
        dye(box(0.05, WHEEL_R - 0.1, 0.05, (WHEEL_R - 0.1) / 2 + 0.08), 0.36, 0.33, 0.3),
        dye(box(0.05, 0.06, 0.4, WHEEL_R - 0.06, 0.24, 0), 0.36, 0.33, 0.3),
        dye(box(0.05, 0.06, 0.4, WHEEL_R - 0.06, -0.24, 0), 0.36, 0.33, 0.3),
      ),
      (() => {
        const m = lifted(2.6, 2.3, 1.9, 0.65);
        m.vertexColors = true;
        return m;
      })(),
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
    // Same feet as the stove, and for the same reason: a chest sunk into the
    // turf has nothing under it for a shadow to live in.
    this.pool(
      'cooler.feet',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (const x of [-0.32, 0.32]) {
          for (const z of [-0.3, 0.3]) parts.push(cylinder(0.055, 0.075, 0.1, 0.05, 12).translate(x, 0, z));
        }
        parts.push(box(0.82, 0.05, 0.1, 0.075, 0, -0.3));
        parts.push(box(0.82, 0.05, 0.1, 0.075, 0, 0.3));
        return merge(...parts);
      })(),
      tone(0x3f4a50, 0.55, 0.35),
      16,
    );
    this.pool('cooler.body', rbox(0.92, 1.1, 0.86, 0.65, 0, 0, 0.06), solidMat(0.4), 16);
    this.pool('cooler.lid', rbox(0.98, 0.2, 0.92, 1.32, 0, 0, 0.07), solidMat(0.38), 16);
    // Rime is ice: glass-smooth, so the band and the pane throw the sky back.
    this.pool(
      'cooler.frost',
      merge(rbox(0.95, 0.24, 0.89, 0.84, 0, 0, 0.02, 1), rbox(0.68, 0.025, 0.6, 1.425, 0, -0.03, 0.01, 1)),
      tone(0xdaeef5, 0.2),
      16,
    );
    // The condenser grille is louvres now — four blades tipped down out of a
    // recessed plate — and the machine has a cable: down the back off the
    // compressor and out across the ground, which is what says the chest is
    // plugged into the same grid as everything else rather than a crate.
    this.pool(
      'cooler.vent',
      merge(
        box(0.54, 0.3, 0.02, 0.4, 0, 0.425),
        ...[0, 1, 2, 3].map((i) => {
          const blade = box(0.46, 0.03, 0.07, 0, 0, 0);
          blade.rotateX(-0.6);
          blade.translate(0, 0.29 + i * 0.075, 0.44);
          return blade;
        }),
        box(0.16, 0.05, 0.04, 1.3, 0, 0.47),
        rbox(0.9, 0.05, 0.84, 1.21, 0, 0, 0.01, 1),
        rbox(0.44, 0.05, 0.07, 1.475, 0, 0.16, 0.02, 1),
        cylinder(0.025, 0.025, 0.06, 1.44, 12).translate(-0.18, 0, 0.16),
        cylinder(0.025, 0.025, 0.06, 1.44, 12).translate(0.18, 0, 0.16),
        cylinder(0.035, 0.035, 0.18, 0, 16).rotateZ(Math.PI / 2).translate(-0.26, 1.41, -0.44),
        cylinder(0.035, 0.035, 0.18, 0, 16).rotateZ(Math.PI / 2).translate(0.26, 1.41, -0.44),
        rbox(0.5, 0.32, 0.1, 0.38, 0, -0.45, 0.03, 1),
        box(0.42, 0.02, 0.04, 0.3, 0, -0.5),
        box(0.42, 0.02, 0.04, 0.38, 0, -0.5),
        box(0.42, 0.02, 0.04, 0.46, 0, -0.5),
        new THREE.CapsuleGeometry(0.028, 0.22, 2, 8).translate(0.26, 0.17, -0.47),
        new THREE.CapsuleGeometry(0.026, 0.14, 2, 8).rotateX(Math.PI / 2).translate(0.26, 0.03, -0.43),
      ),
      tone(0x4d5a60, 0.5, 0.3),
      16,
    );

    // Campfire: a bed of ash, six logs laid in to the middle like the spokes
    // of a wheel with their inner ends charred and resting on the heap, a
    // core of embers in the middle of them, and a flame over that. The
    // embers and the flame are only pushed while there is something in the
    // firebox — the same trick the generator uses, and for the same reason. A
    // cold fire pit and a lit one have to be different at a glance from the
    // isometric camera, because the whole point of a fire is knowing whether
    // it is out; so a fire that is out gets the same heap in dead grey.
    //
    // It was a ring of nine stones round three crossed logs, and from above
    // the stones read as the petals of a flower with a stick in it. Logs laid
    // radially are the shape everyone knows a fire by.
    this.pool('fire.bed', cylinder(0.4, 0.42, 0.05, 0.025, 24), tone(0x6f6a64, 0.95), 32);
    this.pool(
      'fire.logs',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 6; i++) {
          // Built lying along +x with its inner end at the origin, tipped up
          // onto the heap, then swept round the fire; the small twist on each
          // keeps six of them from reading as one part stamped six times.
          const a = (i / 6) * TAU + (i % 2) * 0.12;
          const len = 0.42 + (i % 3) * 0.03;
          const log = cylinder(0.055, 0.065, len, 0, 12);
          log.rotateZ(Math.PI / 2);
          log.translate(len / 2 + 0.04, 0, 0);
          // Inner end up on the coals, outer end down on the ground.
          log.rotateZ(-0.2);
          log.translate(0, 0.17, 0);
          log.rotateY(-a);
          parts.push(log);
        }
        return merge(...parts);
      })(),
      tone(0x5d4126, 0.9),
      32,
    );
    this.pool(
      'fire.char',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + (i % 2) * 0.12;
          // A hair fatter than the log it sleeves, and a centimetre past its
          // end, so it is never a face on a face.
          const tip = cylinder(0.062, 0.064, 0.14, 0, 12);
          tip.rotateZ(Math.PI / 2);
          tip.translate(0.1, 0, 0);
          tip.rotateZ(-0.2);
          tip.translate(0, 0.17, 0);
          tip.rotateY(-a);
          parts.push(tip);
        }
        return merge(...parts);
      })(),
      tone(0x1c1816, 0.95),
      32,
    );
    // The core is one heap of coals, lit or dead: a low dome with a few lumps
    // on it. Two pools of the same heap because emissive does not dim with
    // instance colour — the lamp does the same with its globe.
    const embers = (): THREE.BufferGeometry => {
      const dome = new THREE.SphereGeometry(0.2, 16, 8, 0, TAU, 0, Math.PI / 2);
      dome.scale(1, 0.55, 1);
      return merge(
        dome,
        sphere(0.06, 0.1, 0.09, 0.05, 10, 8),
        sphere(0.05, 0.11, -0.07, 0.08, 10, 8),
        sphere(0.055, 0.09, -0.02, -0.1, 10, 8),
      );
    };
    this.pool(
      'fire.embers',
      embers(),
      new THREE.MeshStandardMaterial({
        color: 0x3a1408,
        emissive: new THREE.Color(0xff4a10),
        emissiveIntensity: 1.3,
        roughness: 0.5,
      }),
      32,
    );
    this.pool('fire.ash', embers(), tone(0x2e2a27, 1.0), 32);
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
    // It stands on feet like the rest of the machines, but it does not grow to
    // do it: `def.height` is 1.25 and the cap is already there, so the ten
    // centimetres come off the shell rather than going under the whole thing.
    this.pool(
      'heat.feet',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (const x of [-0.28, 0.28]) {
          for (const z of [-0.22, 0.22]) parts.push(cylinder(0.05, 0.07, 0.1, 0.05, 10).translate(x, 0, z));
        }
        parts.push(box(0.66, 0.05, 0.09, 0.075, 0, -0.22));
        parts.push(box(0.66, 0.05, 0.09, 0.075, 0, 0.22));
        return merge(...parts);
      })(),
      tone(0x3d3936, 0.6, 0.3),
      24,
    );
    this.pool('heat.body', rbox(0.78, 1.04, 0.64, 0.62, 0, 0, 0.06), solidMat(0.42), 24);
    this.pool('heat.cap', rbox(0.86, 0.12, 0.72, 1.19, 0, 0, 0.05), solidMat(0.38), 24);
    this.pool(
      'heat.grille',
      (() => {
        const parts: THREE.BufferGeometry[] = [box(0.6, 0.03, 0.06, 0.34, 0, 0.37), box(0.6, 0.03, 0.06, 0.86, 0, 0.37)];
        for (let i = 0; i < 6; i++) parts.push(box(0.035, 0.52, 0.06, 0.6, -0.25 + i * 0.1, 0.37));
        return merge(...parts);
      })(),
      tone(0x40332c, 0.7),
      24,
    );
    this.pool(
      'heat.glow',
      rbox(0.56, 0.46, 0.04, 0.6, 0, 0.33, 0.01, 1),
      new THREE.MeshStandardMaterial({ color: 0xff9b4d, emissive: new THREE.Color(0xd8500a), roughness: 0.4 }),
      24,
    );

    // Turret: a base that stays put, and a head with the barrel under it that
    // turns as one to face whatever the barrel is tracking.
    this.pool('turret.base', merge(cylinder(0.42, 0.48, 0.34, 0.17, 24), cylinder(0.16, 0.22, 0.5, 0.59, 20)), solidMat(0.6), 24);
    this.pool(
      'turret.head',
      merge(rbox(0.48, 0.34, 0.44, 1.0, 0, 0, 0.08), cylinder(0.02, 0.02, 0.2, 1.27, 8), sphere(0.04, 1.36, 0, 0, 10, 8)),
      solidMat(0.42),
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
    // A fence with nothing to reach out to is still a fence, not a post: a
    // stub of each rail either side, short of the cell's edge, so the first
    // cell of a line the player is laying reads as the thing they are laying.
    // One merged part, pushed only on a lone fence, so a run still meets as
    // one rail and a cell with a neighbour never gets a stub pointing the
    // other way.
    this.pool(
      'fence.stub',
      merge(
        rbox(0.5, 0.1, 0.08, 0.92, 0, 0, 0.025, 1),
        rbox(0.5, 0.1, 0.08, 0.52, 0, 0, 0.025, 1),
      ),
      solidMat(0.88),
      32,
    );

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
    // The lit globe glows warm and glows hard: the sky owns the point light
    // that spills onto the ground round a lamp, and the globe itself is what
    // has to look like the source of it, so its emissive is the same amber as
    // that light and pushed past white. Glass-smooth, so the unlit side still
    // catches the sky.
    this.pool(
      'lamp.globe',
      globe(),
      new THREE.MeshStandardMaterial({
        color: 0xfff0c4,
        emissive: new THREE.Color(0xffb765),
        emissiveIntensity: 1.6,
        roughness: 0.2,
      }),
      24,
    );
    // The same globe with the light taken out of it. A separate pool rather than a
    // tint, because emissive does not dim with instance colour — a lamp with no
    // watts behind it would otherwise glow just as brightly as one that is lit,
    // which is the exact thing the player is meant to be able to see at a glance.
    this.pool('lamp.dark', globe(), new THREE.MeshStandardMaterial({ color: 0x6b6552, roughness: 0.25 }), 24);

    // Generator: a rounded cast housing with a flywheel on its flank, vents on
    // the front, terminals on the hood and a stack over the firebox. The wheel
    // is what sells it from the isometric camera — a plain box reads as another
    // cabinet, a box with a wheel on it reads as an engine.
    //
    // An engine is bolted to a skid, and the skid is what it stands on: two
    // runners with a cross member at each end, twelve centimetres of it, so the
    // housing clears the grass and the whole machine has a base a shadow can go
    // under. Everything above is lifted by that.
    this.pool(
      'gen.skid',
      merge(
        rbox(0.94, 0.12, 0.14, 0.06, 0, -0.28, 0.03, 1),
        rbox(0.94, 0.12, 0.14, 0.06, 0, 0.28, 0.03, 1),
        box(0.14, 0.1, 0.58, 0.05, -0.36, 0),
        box(0.14, 0.1, 0.58, 0.05, 0.36, 0),
      ),
      tone(0x3a3d43, 0.6, 0.35),
      16,
    );
    this.pool('gen.body', rbox(0.9, 0.9, 0.82, 0.57, 0, 0, 0.06), solidMat(0.4), 16);
    this.pool('gen.hood', rbox(0.96, 0.16, 0.88, 1.1, 0, 0, 0.06), solidMat(0.38), 16);
    this.pool(
      'gen.wheel',
      merge(
        cylinder(0.28, 0.28, 0.1, 0, 24).rotateZ(Math.PI / 2).translate(0.48, 0.64, 0),
        cylinder(0.08, 0.08, 0.14, 0, 12).rotateZ(Math.PI / 2).translate(0.48, 0.64, 0),
      ),
      tone(0x50545c, 0.45, 0.4),
      16,
    );
    this.pool(
      'gen.stack',
      merge(cylinder(0.1, 0.13, 0.4, 1.37, 16).translate(-0.26, 0, -0.2), cylinder(0.13, 0.13, 0.05, 1.545, 16).translate(-0.26, 0, -0.2)),
      tone(0x3c3a38, 0.8),
      16,
    );
    // The cooling louvres over the firebox, the terminals on the hood, and the
    // cable that leaves the back of the housing and runs off across the ground.
    // The louvres were five flat bars lying on the face: the tell of a vent is
    // the shadow under each blade, so each is tipped down out of a recessed
    // plate and stands a centimetre and a half proud of it.
    this.pool(
      'gen.trim',
      (() => {
        const parts: THREE.BufferGeometry[] = [
          cylinder(0.04, 0.04, 0.1, 1.22, 10).translate(0.2, 0, 0.25),
          cylinder(0.04, 0.04, 0.1, 1.22, 10).translate(0.32, 0, 0.25),
          box(0.5, 0.34, 0.02, 0.83, 0, 0.405),
          box(0.14, 0.12, 0.06, 0.42, 0.28, -0.42),
          new THREE.CapsuleGeometry(0.03, 0.28, 2, 8).translate(0.28, 0.22, -0.44),
          new THREE.CapsuleGeometry(0.028, 0.16, 2, 8).rotateX(Math.PI / 2).translate(0.28, 0.04, -0.4),
        ];
        for (let i = 0; i < 4; i++) {
          const blade = box(0.42, 0.028, 0.07, 0, 0, 0);
          blade.rotateX(-0.6);
          blade.translate(0, 0.72 + i * 0.075, 0.42);
          parts.push(blade);
        }
        return merge(...parts);
      })(),
      tone(0x45484f, 0.45, 0.4),
      16,
    );
    // Only pushed while the firebox is actually burning, so "is it running" is a
    // thing you read off the machine rather than off a panel.
    this.pool(
      'gen.fire',
      rbox(0.4, 0.24, 0.08, 0.44, 0, 0.42, 0.02, 1),
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
    //
    // Cells are never stood on the ground — damp is what kills a bank — so the
    // crate sits on a rack of two runners, and the ten centimetres of daylight
    // under it is also what stops it reading as a slab laid on the grass.
    this.pool(
      'batt.rack',
      merge(
        box(0.9, 0.1, 0.12, 0.05, 0, -0.28),
        box(0.9, 0.1, 0.12, 0.05, 0, 0.28),
        box(0.12, 0.08, 0.56, 0.04, -0.33, 0),
        box(0.12, 0.08, 0.56, 0.04, 0.33, 0),
      ),
      tone(0x3f4247, 0.6, 0.35),
      16,
    );
    this.pool('batt.body', rbox(0.86, 0.6, 0.78, 0.4, 0, 0, 0.06), solidMat(0.45), 16);
    this.pool('batt.lid', rbox(0.92, 0.12, 0.84, 0.76, 0, 0, 0.05), solidMat(0.4), 16);
    // Terminals and their bar on the lid, two straps over it, a louvred flank
    // either side and the cable that leaves the back of the bank for the
    // ground. The flanks were a flat plate on each side and read as a painted
    // panel; cells vent, and a vent is blades with light under them.
    this.pool(
      'batt.trim',
      (() => {
        const parts: THREE.BufferGeometry[] = [
          cylinder(0.05, 0.05, 0.14, 0.89, 16).translate(-0.25, 0, -0.22),
          cylinder(0.05, 0.05, 0.14, 0.89, 16).translate(0.25, 0, -0.22),
          cylinder(0.08, 0.08, 0.03, 0.832, 20).translate(-0.25, 0, -0.22),
          cylinder(0.08, 0.08, 0.03, 0.832, 20).translate(0.25, 0, -0.22),
          box(0.6, 0.03, 0.04, 0.97, 0, -0.22),
          rbox(0.07, 0.025, 0.9, 0.83, -0.32, 0, 0.01, 1),
          rbox(0.07, 0.025, 0.9, 0.83, 0.32, 0, 0.01, 1),
          box(0.14, 0.1, 0.06, 0.62, 0.2, -0.42),
          new THREE.CapsuleGeometry(0.03, 0.48, 2, 8).translate(0.2, 0.33, -0.44),
          new THREE.CapsuleGeometry(0.028, 0.16, 2, 8).rotateX(Math.PI / 2).translate(0.2, 0.04, -0.4),
        ];
        for (const side of [-1, 1]) {
          parts.push(box(0.02, 0.36, 0.56, 0.4, side * 0.42, 0));
          for (let i = 0; i < 3; i++) {
            const blade = box(0.06, 0.028, 0.52, 0, 0, 0);
            blade.rotateZ(side * 0.6);
            blade.translate(side * 0.44, 0.3 + i * 0.09, 0);
            parts.push(blade);
          }
        }
        return merge(...parts);
      })(),
      tone(0x45484f, 0.45, 0.4),
      16,
    );
    this.pool(
      'batt.caps',
      (() => {
        const parts: THREE.BufferGeometry[] = [];
        for (const x of [-0.16, 0, 0.16]) {
          for (const z of [0.08, 0.26]) parts.push(cylinder(0.055, 0.06, 0.035, 0.835, 10).translate(x, 0, z));
        }
        return merge(...parts);
      })(),
      tone(0xd9c78a, 0.5),
      16,
    );
    this.pool(
      'batt.band',
      rbox(0.5, 0.14, 0.06, 0.52, 0, 0.4, 0.01, 1),
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
    //
    // And it is mounted, not floating. The panel used to be a single slab on a
    // post: a blue tile in the air with a stick under it, which is what it read
    // as from every angle. A panel is a rail frame with a backsheet in it, sat
    // in a yoke, braced back to the mast by a strut, with a junction box under
    // the low corner and a cable off it to the ground — and the foot is a bolted
    // plinth, because the one thing a mast cannot do is stand in soil on its own.
    this.pool(
      'solar.pillar',
      (() => {
        const parts: THREE.BufferGeometry[] = [cylinder(0.07, 0.1, 0.82, 0.41, 16), cylinder(0.24, 0.28, 0.07, 0.035, 20)];
        for (const [x, z] of CORNERS) parts.push(cylinder(0.022, 0.022, 0.04, 0.08, 8).translate(x * 0.17, 0, z * 0.17));
        return merge(...parts);
      })(),
      solidMat(0.7),
      16,
    );
    this.pool(
      'solar.mount',
      (() => {
        // A yoke across the mast head, a strut running up and forward to the
        // panel's underside, and the wiring. The strut's angle is the one the
        // geometry works out for itself: it spans the half metre from the mast
        // at 0.45 to the frame at 0.79, and the box below is what the cable
        // comes out of.
        const yoke = rbox(0.2, 0.06, 0.44, 0, 0, 0, 0.02, 1);
        yoke.rotateX(-0.36);
        yoke.translate(0, 0.76, 0);
        const strut = rbox(0.05, 0.53, 0.05, 0, 0, 0, 0.015, 1);
        strut.rotateX(0.624);
        strut.translate(0, 0.6625, 0.093);
        return merge(
          yoke,
          strut,
          rbox(0.18, 0.12, 0.12, 0.6, 0.13, -0.14, 0.03, 1),
          new THREE.CapsuleGeometry(0.028, 0.44, 2, 8).translate(0.13, 0.3, -0.16),
          new THREE.CapsuleGeometry(0.026, 0.18, 2, 8).rotateX(Math.PI / 2).translate(0.13, 0.03, -0.28),
        );
      })(),
      tone(0x4a4d55, 0.5, 0.35),
      16,
    );
    this.pool(
      'solar.frame',
      (() => {
        const parts: THREE.BufferGeometry[] = [
          rbox(1.04, 0.07, 0.08, 0, 0, -0.42, 0.02, 1),
          rbox(1.04, 0.07, 0.08, 0, 0, 0.42, 0.02, 1),
          rbox(0.08, 0.07, 0.92, 0, -0.48, 0, 0.02, 1),
          rbox(0.08, 0.07, 0.92, 0, 0.48, 0, 0.02, 1),
          box(0.96, 0.02, 0.8, -0.02, 0, 0),
          box(0.92, 0.05, 0.06, -0.05, 0, -0.2),
          box(0.92, 0.05, 0.06, -0.05, 0, 0.2),
        ];
        const g = merge(...parts);
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
          for (let j = 0; j < 3; j++) parts.push(box(0.2, 0.02, 0.22, 0.035, -0.33 + i * 0.22, -0.26 + j * 0.26));
        }
        const g = merge(...parts);
        g.rotateX(-0.36);
        g.translate(0, 0.82, 0);
        return g;
      })(),
      tone(0x99b0ff, 0.15, 0.3),
      16,
    );

    // A tree is a trunk that flares at the root and four skirts of boughs hung
    // off it, each a lathe roughed up so the edge of the crown is lobed rather
    // than turned.
    //
    // A skirt, not a tier. The tiers this replaces were bowls: each one's widest
    // point sat *above* where it met the trunk, so its underside sloped up and
    // out and the whole crown was three cones with their bases in the air. From
    // the manager camera, which sees the crown from above and slightly to one
    // side, that is a party hat, and three of them stacked is three party hats.
    // A conifer's boughs come out of the trunk and hang: the widest point of a
    // skirt is its rim, the rim is *below* the trunk joint, and the surface the
    // player sees from underneath is the one that droops. Each profile below
    // therefore runs out and down from the trunk to the rim, then back in and up
    // over the top to the leader — a closed shell whose lower half faces down,
    // which is what gives a stand of them the layered, shadowed edge a wood has
    // and a pile of cones does not.
    //
    // Radius and droop both fall off with height — 0.86 wide and 0.3 of droop at
    // the bottom, 0.36 and 0.18 at the leader — so the crown tapers by the shape
    // of its boughs rather than by scaling one bough four times. Each skirt is
    // rumpled with its own phase, and the draw turns each one a further hashed
    // angle about the trunk, so the lobes never line up and the outline is never
    // the circle a lathe wants to give.
    //
    // Better than a third of the tree is bare trunk, and the trunk is thick at
    // the foot: a 0.44 root flare against a 0.86 crown is a bole a quarter of the
    // crown's width, which is what makes it a tree rather than a cone with a
    // stick under it when the camera is looking down at it. The taper runs the
    // whole way to keep the flare a flare, and the trunk continues up inside the
    // crown so no skirt can show daylight under it.
    this.pool(
      'tree.trunk',
      lathe(
        [
          [0.44, 0],
          [0.3, 0.18],
          [0.24, 0.45],
          [0.2, 1.0],
          [0.17, 1.9],
          [0.14, 2.7],
          [0.1, 3.3],
          [0.06, 3.9],
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
          [0.17, 2.0],
          [0.48, 1.9],
          [0.75, 1.78],
          [0.86, 1.7],
          [0.78, 1.95],
          [0.57, 2.28],
          [0.3, 2.6],
          [0, 2.82],
        ]),
        TREE_LOBE,
        1,
      ),
      solidMat(0.85),
      256,
    );
    this.pool(
      'tree.mid',
      rumple(
        lathe([
          [0.15, 2.78],
          [0.42, 2.7],
          [0.64, 2.6],
          [0.74, 2.52],
          [0.66, 2.75],
          [0.48, 3.05],
          [0.26, 3.3],
          [0, 3.48],
        ]),
        TREE_LOBE,
        2,
      ),
      solidMat(0.85),
      256,
    );
    this.pool(
      'tree.upper',
      rumple(
        lathe([
          [0.12, 3.38],
          [0.32, 3.32],
          [0.47, 3.22],
          [0.55, 3.14],
          [0.48, 3.35],
          [0.34, 3.6],
          [0.18, 3.82],
          [0, 3.98],
        ]),
        TREE_LOBE,
        3,
      ),
      solidMat(0.85),
      256,
    );
    // The leader is small, droops least — a young shoot stands up — and is hung
    // off the axis, which is the one asymmetry a lathe cannot be talked into.
    // Its top is `def.height` exactly, so the tree is as tall as the sim says.
    this.pool(
      'tree.top',
      rumple(
        lathe([
          [0.1, 3.92],
          [0.22, 3.86],
          [0.31, 3.79],
          [0.36, 3.74],
          [0.3, 3.95],
          [0.2, 4.2],
          [0.1, 4.38],
          [0, 4.5],
        ]),
        TREE_LOBE * 0.9,
        4,
      ).translate(0.1, 0, -0.06),
      solidMat(0.85),
      256,
    );

    // Blueprints: a low translucent slab on each planned cell, with a lip
    // round its edge, so a plan reads as marked ground from either view. It
    // used to be a full-height box at a third opaque — the shape of what was
    // coming — and four of those in a row stacked into one cyan slab that hid
    // a third of the first-person frame. The lip is the same faint material
    // laid over the slab a second time: two layers of a one-in-seven ghost
    // are twice as dense, so each cell keeps its own outline and a row reads
    // as a row of cells rather than as a block, without a second pool or a
    // line material. `depthWrite` stays off so ghosts never cut into each
    // other or into the settlers walking over them.
    this.blueprints = new InstancedPool(
      this.group,
      merge(
        box(0.86, 0.22, 0.86, 0.11),
        box(0.92, 0.28, 0.05, 0.14, 0, 0.435),
        box(0.92, 0.28, 0.05, 0.14, 0, -0.435),
        box(0.05, 0.28, 0.92, 0.14, 0.435, 0),
        box(0.05, 0.28, 0.92, 0.14, -0.435, 0),
      ),
      new THREE.MeshStandardMaterial({
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        roughness: 0.4,
        emissive: new THREE.Color(0x2a4a66),
      }),
      64,
      { tinted: true, castShadow: false },
    );

    // One pool per kind, untinted: the kind's palette entry is the material's
    // colour and the second colour of each shape rides in its vertices. Named
    // like the building parts so a test can find a kind's shape without the
    // map being public.
    for (const k of Object.keys(STACK_SHAPE) as ResourceKind[]) {
      const { build, rough, metal } = STACK_SHAPE[k];
      const geo = build();
      geo.name = `stack.${k}`;
      this.stacks.set(
        k,
        new InstancedPool(
          this.group,
          geo,
          new THREE.MeshStandardMaterial({ color: RESOURCE_COLOR[k], roughness: rough, metalness: metal, vertexColors: true }),
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
   * The three beds are one bed. A frame on four legs with rails round it, a
   * mattress dropped inside those rails, a blanket folded across the foot and a
   * pillow at the head; what makes one a sickbed and another a bunk in a cell is
   * the material each part is given and what is bolted on afterwards, not the
   * carpentry. `head` is the headboard's height above the rails, and zero means
   * none.
   *
   * The carcass used to be one slab with a board on the end, which from the
   * manager camera was a brown tile with a paler tile on it — the reason a
   * dormitory read as a floor pattern rather than as furniture. What tells the
   * eye "bed" at that range is the *gap*: legs with daylight between them, a
   * rail line along the side, and a mattress whose eased edge stands proud of
   * that rail. So the frame is built the way a bed is built. The legs at the
   * head run on up past the rails to carry the headboard, because that is where
   * a bed's posts come from, and it costs nothing over standing separate ones.
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
    // Where the rails sit: a hand's width of timber whose top is under the
    // mattress top, so the mattress is visibly *in* the frame rather than on it.
    const rail = 0.235;
    const carcass: THREE.BufferGeometry[] = [];
    for (const x of [-0.42, 0.42]) {
      for (const z of [-0.43, 0.43]) {
        const h = z < 0 ? 0.3 + head : 0.3;
        carcass.push(cylinder(0.042, 0.055, h, h / 2, 12).translate(x, 0, z));
      }
    }
    carcass.push(rbox(0.06, 0.14, 0.98, rail, -0.44, 0, 0.02, 1));
    carcass.push(rbox(0.06, 0.14, 0.98, rail, 0.44, 0, 0.02, 1));
    carcass.push(rbox(0.86, 0.14, 0.06, rail, 0, -0.46, 0.02, 1));
    carcass.push(rbox(0.86, 0.14, 0.06, rail, 0, 0.46, 0.02, 1));
    if (head > 0) carcass.push(rbox(0.8, head * 0.8, 0.05, 0.3 + head * 0.5, 0, -0.45, 0.02, 1));
    this.pool(`${prefix}.frame`, merge(...carcass), frame, cap);
    // The mattress top is the sim's `standHeight` for a bed — 0.34 — because
    // that is the height a sleeper is drawn lying at. Two centimetres over and
    // the body sinks into the ticking; two under and it floats on air. The sim
    // number is the one that is right, so the mesh is built down from it: the
    // blanket and pillow rest on that top, a couple of centimetres in so the
    // joint is never a coplanar face and nothing appears to hover.
    const top = BED_TOP;
    this.pool(`${prefix}.mattress`, rbox(0.8, 0.16, 0.86, top - 0.08, 0, 0, 0.06), mattress, cap);
    // A blanket is folded down over the foot half and rolled at the fold. The
    // roll is what carries it from above: a flat slab of cloth on a flat slab of
    // ticking is one silhouette, and a bolster across the middle of the bed is
    // two. It laps three centimetres past the mattress on each side, so the
    // cloth reads as hanging over the edge rather than as inlaid into the top.
    this.pool(
      `${prefix}.blanket`,
      merge(
        rbox(0.86, 0.07, 0.52, top + 0.02, 0, 0.2, 0.03, 1),
        cylinder(0.055, 0.055, 0.84, 0, 12).rotateZ(Math.PI / 2).translate(0, top + 0.035, -0.06),
      ),
      blanket,
      cap,
    );
    // A pillow is nearly twice as wide as it is deep and thick enough to have a
    // shadow under its own edge. The old one was a quarter-metre strip the same
    // thickness as the blanket, which read as a second blanket at the head.
    this.pool(`${prefix}.pillow`, rbox(0.54, 0.14, 0.3, top + 0.05, 0, -0.28, 0.06), pillow, cap);
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
    // grow a tower taller than the settler hauling to it. A stack is scaled
    // for how much is in it — a handful is smaller all round, a big load is
    // taller — and the pile steps up by the height it is actually drawn at.
    this.pile.clear();
    for (const it of world.items) {
      if (it.carriedBy !== null) continue; // carried stacks ride the pawn's hand
      const pool = this.stacks.get(it.kind);
      if (!pool) continue;
      const size = stackSize(it.amount);
      const lift = 1 + Math.min(2, Math.floor(it.amount / 25)) * 0.18;
      const cell = Math.round(it.y) * world.width + Math.round(it.x);
      const rest = itemRest(world, it.x, it.y);
      const base = this.pile.get(cell) ?? rest;
      this.pile.set(cell, Math.min(rest + PILE_MAX, base + STACK_H * size * lift));
      this.v.set(it.x, base, it.y);
      this.s.set(size, size * lift, size);
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
        this.pushClosers(world, b);
        this.flat('wall.cap', b);
        this.pushCorners(world, b);
        break;
      case 'stonewall':
        this.flat('stone.plinth', b);
        this.flat('stone.body', b);
        this.flat('stone.courses', b);
        this.flat('stone.bond', b);
        this.flat('stone.cap', b);
        // The same post under the stone tint is a quoin: the dressed pillar a
        // mason builds a corner out of.
        this.pushCorners(world, b);
        break;
      case 'lab':
        this.flat('lab.desk', b);
        this.flat('lab.console', b);
        this.flat('lab.glass', b);
        this.flat('lab.stand', b);
        this.flat('lab.lamp', b);
        break;
      case 'door': {
        // The hinge swing is read straight from the sim, so a door standing open
        // in the manager view is standing open when you walk up to it in person.
        // The yaw is not: a door is hung in the run of wall it interrupts, and
        // the whole assembly turns onto it.
        const open = b.open ?? 0;
        const yaw = doorYaw(world, b);
        this.q.setFromAxisAngle(UP, yaw);
        // The hinge sits on one jamb, so its offset from the cell's centre turns
        // with the doorway; the swing is then composed after the yaw, which
        // makes it a swing in the door's own frame rather than in the world's.
        this.v.set(-0.45, 0, 0).applyQuaternion(this.q);
        this.v.set(b.x + this.v.x, 0, b.y + this.v.z);
        this.spin.setFromAxisAngle(UP, -open * (Math.PI / 2));
        this.q.multiply(this.spin);
        this.s.set(1, 1, 1);
        this.m.compose(this.v, this.q, this.s);
        this.get('door.panel').push(this.m, this.tint(b));
        this.get('door.handle').push(this.m, this.tint(b));
        this.flat('door.frame', b, yaw);
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
        this.flat('stove.feet', b);
        this.flat('stove.body', b);
        this.flat('stove.door', b);
        this.flat('stove.vents', b);
        this.flat('stove.flue', b);
        this.flat('stove.plate', b);
        break;
      case 'cooler':
        this.flat('cooler.feet', b);
        this.flat('cooler.body', b);
        this.flat('cooler.lid', b);
        this.flat('cooler.frost', b);
        this.flat('cooler.vent', b);
        break;
      case 'campfire': {
        this.flat('fire.bed', b);
        this.flat('fire.logs', b);
        this.flat('fire.char', b);
        const lit = (b.fuel ?? 0) > 0;
        this.flat(lit ? 'fire.embers' : 'fire.ash', b);
        // The flame flickers on the clock rather than on a random, so both views
        // and every reload agree on what the fire is doing this instant.
        if (lit) {
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
        this.flat('heat.feet', b);
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
      case 'fence': {
        this.flat('fence.post', b);
        let linked = false;
        for (const [dx, dz] of NEIGHBOURS) {
          const n = buildingAt(world, b.x + dx, b.y + dz);
          if (!n || !n.built || !FENCE_LINKS.has(n.kind)) continue;
          linked = true;
          // The rail geometry points along +x, so the yaw that swings it onto this
          // neighbour is the one that takes (1,0,0) to (dx,0,dz).
          this.v.set(b.x, 0, b.y);
          this.q.setFromAxisAngle(UP, Math.atan2(-dz, dx));
          this.s.set(1, 1, 1);
          this.m.compose(this.v, this.q, this.s);
          this.get('fence.rail.hi').push(this.m, this.tint(b));
          this.get('fence.rail.lo').push(this.m, this.tint(b));
        }
        if (!linked) this.flat('fence.stub', b);
        break;
      }
      case 'lamp':
        this.flat('lamp.post', b);
        this.flat('lamp.bracket', b);
        this.flat(b.powered === true ? 'lamp.globe' : 'lamp.dark', b);
        break;
      case 'generator':
        this.flat('gen.skid', b);
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
        this.flat('batt.rack', b);
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
        this.flat('solar.mount', b);
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
        const girth = TREE_GIRTH_MIN + (TREE_GIRTH_MAX - TREE_GIRTH_MIN) * (((b.x * 5 + b.y * 19) % 6) / 5);
        const lean = TREE_LEAN_MAX * (((b.x * 3 + b.y * 17) % 5) / 4);
        const k = (0.55 + 0.45 * grow) * size;
        this.v.set(b.x, 0, b.y);
        // The lean is applied in the tree's own frame and the yaw after it, so
        // the hashed yaw that already turns each crown also picks which way the
        // trunk leans, for free.
        this.spin.setFromAxisAngle(LEAN_AXIS, lean);
        this.q.setFromAxisAngle(UP, (b.x * 1.7 + b.y * 0.9) % TAU).multiply(this.spin);
        // Girth on the ground plane only: the growth scale and the size hash set
        // how tall the tree is, and this sets how heavy it is for that height.
        // The scale is axis-aligned and applied before the rotation, so a
        // leaning tree still leans by exactly `lean` — a basis vector through
        // `compose` picks up the scale as a length, not as a shear.
        this.s.set(k * girth, k, k * girth);
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
        // Each skirt is turned a further hashed angle about the trunk before the
        // lean and the yaw, so the four lobed outlines stack differently on
        // every tree in the wood. The turn goes on the inside of the product —
        // spun about its own axis first, then leaned, then yawed — because a
        // turn applied after the lean would swing each skirt off the trunk it is
        // supposed to be growing out of.
        const twist = TREE_TWIST_MIN + (TREE_TWIST_MAX - TREE_TWIST_MIN) * (((b.x * 13 + b.y * 3) % 6) / 5);
        for (let i = 0; i < TREE_SKIRTS.length; i++) {
          this.spin.setFromAxisAngle(UP, twist * (i + 1));
          this.crown.copy(this.q).multiply(this.spin);
          this.m.compose(this.v, this.crown, this.s);
          this.get(TREE_SKIRTS[i]).push(this.m, this.c);
        }
        break;
      }
    }
  }

  /**
   * A post at each outside corner of a wall cell: a corner of the cell is an
   * outside corner when the run does not continue past it on either axis.
   * The middle of a straight run has none, the end of one has a pair, an L
   * has one at its elbow and a lone cell has four — which is how a cabin
   * comes out with a post at each of its corners and nothing along its sides.
   */
  private pushCorners(world: World, b: Building): void {
    const linked = (dx: number, dz: number): boolean => {
      const n = buildingAt(world, b.x + dx, b.y + dz);
      return n !== null && n.built && WALL_LINKS.has(n.kind);
    };
    for (const [sx, sz, yaw] of CORNERS) {
      if (linked(sx, 0) || linked(0, sz)) continue;
      this.flat('wall.post', b, yaw);
    }
  }

  /**
   * A closer on each side the planking actually runs on into: another plank
   * wall, and nothing else. A stone wall is a different bond and a door is an
   * opening, so a course that meets either of them stops where it is — which is
   * the point of the part. See `closers` for what that does to the jamb.
   */
  private pushClosers(world: World, b: Building): void {
    for (const [dx, dz, yaw] of SIDES) {
      const n = buildingAt(world, b.x + dx, b.y + dz);
      if (n === null || !n.built || n.kind !== 'wall') continue;
      this.flat('wall.closer', b, yaw);
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
    // The ghost is the same low slab whatever is planned — the colour, cyan
    // going to amber as materials arrive and work gets done, is the progress
    // read, and the height of the building to come is not.
    const progress = blueprintProgress(b);
    this.c.setHex(0x4fa3d1).lerp(new THREE.Color(0xe0b25a), progress);
    this.v.set(b.x, 0, b.y);
    this.q.identity();
    this.s.set(1, 1, 1);
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
