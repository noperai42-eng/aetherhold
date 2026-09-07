/**
 * The ground scatter.
 *
 * It is decoration, so the bar is not "does it look nice" — it is "does it stay
 * off everything that matters": no grass through a stove, no stones on a sown
 * plot, and the same blade in the same place every session, in both views.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  DecorView,
  bladeGeometry,
  foldedBladeGeometry,
  scatterChecksum,
} from '../src/client/render/decor';
import { TERRAIN_COLOR, seasonTint } from '../src/client/render/palette';
import { createWorld } from '../src/sim/worldgen';
import { DAYS_PER_YEAR, SEASONS } from '../src/sim/seasons';
import { TERRAIN_LIST, TICKS_PER_DAY, packCell, terrainAt } from '../src/sim/types';
import type { Terrain, World } from '../src/sim/types';

const SEED = 20260729;
/** Not exported from `seasons.ts`, and it is the two numbers that are. */
const TICKS_PER_YEAR = DAYS_PER_YEAR * TICKS_PER_DAY;
/**
 * The tuft's tip colour, restated here on purpose.
 *
 * `decor.ts` keeps it private, and the tests below check that the season reaches a
 * blade as a *ratio* against exactly this entry. Importing it would let the two
 * move together and the assertion would pass through a change that repainted every
 * tuft on the map; written out, a change to the palette entry has to come here and
 * be argued for.
 */
const GRASS_TIP = 0x7fb050;

function setTerrain(world: World, x: number, y: number, kind: Terrain): void {
  world.terrain[packCell(world, x, y)] = TERRAIN_LIST.indexOf(kind);
}

/** Every live instance of a mesh, as the cell it sits on. */
function occupiedCells(mesh: THREE.InstancedMesh): { x: number; y: number }[] {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    pos.setFromMatrixPosition(m);
    out.push({ x: Math.round(pos.x), y: Math.round(pos.z) });
  }
  return out;
}

function meshes(view: DecorView): { tufts: THREE.InstancedMesh; stones: THREE.InstancedMesh } {
  return {
    tufts: view.group.children[0] as THREE.InstancedMesh,
    stones: view.group.children[1] as THREE.InstancedMesh,
  };
}

/** Flat grass with nothing on it — the simplest map to count against. */
function meadow(): World {
  const world = createWorld(SEED);
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) setTerrain(world, x, y, 'grass');
  }
  world.cellBuilding.fill(-1);
  world.zones.length = 0;
  return world;
}

describe('what the scatter notices changing', () => {
  it('changes when the ground is mined out', () => {
    const world = createWorld(SEED);
    const before = scatterChecksum(world);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (terrainAt(world, x, y) === 'rock') {
          setTerrain(world, x, y, 'stone');
          break;
        }
      }
    }
    expect(scatterChecksum(world)).not.toBe(before);
  });

  it('changes when something is built on a cell', () => {
    const world = meadow();
    const before = scatterChecksum(world);
    world.cellBuilding[packCell(world, 30, 30)] = 7;
    expect(scatterChecksum(world)).not.toBe(before);
  });

  it('changes when a plot is sown', () => {
    const world = meadow();
    const before = scatterChecksum(world);
    world.zones.push({ id: 1, kind: 'growing', cells: [packCell(world, 12, 12)], accepts: [] });
    expect(scatterChecksum(world)).not.toBe(before);
  });

  it('changes when the year moves on, with the map untouched', () => {
    // The bug this is the fence around: a tuft's colour is written once, at
    // rebuild time, and the only thing that asks for a rebuild is this number. So
    // for as long as it was a function of the map alone, the valley could go gold
    // and then white around nine thousand blades of high-summer green, and every
    // line of tinting code in the module would have been dead. A day in each
    // season, one world, nothing touched but the clock.
    const world = meadow();
    const seen = new Set<number>();
    for (let i = 0; i < SEASONS.length; i++) {
      world.tick = Math.round(((i + 0.5) / SEASONS.length) * TICKS_PER_YEAR);
      seen.add(scatterChecksum(world));
    }
    expect(seen.size).toBe(SEASONS.length);
  });

  it('says nothing changed when nothing did', () => {
    const world = createWorld(SEED);
    expect(scatterChecksum(world)).toBe(scatterChecksum(world));
  });

  it('does not repaint on every tick of a season it cannot see', () => {
    // The other half of the same contract, and the reason the year arrives as
    // whole steps rather than as a raw phase: a checksum that moved with every
    // tick would rebuild forty-five thousand tufts on every frame of the game for
    // a colour difference measured in thousandths. One tick apart has to read as
    // no change at all.
    const world = meadow();
    world.tick = Math.round(0.5 * TICKS_PER_YEAR);
    const before = scatterChecksum(world);
    world.tick += 1;
    expect(scatterChecksum(world)).toBe(before);
  });
});

describe('where the scatter lands', () => {
  it('puts seven clumps on every clear patch of turf', () => {
    // Seven, and each rise in this number has been a decision rather than a
    // discovery. Round 9 respent the tuft's triangles on five slim blades and
    // went from three clumps to five to pay for the coverage that cost; round
    // 10 found the same tufts still reading as scattered marks from the manager
    // camera, where the eye is not resolving a blade at all and is only asking
    // whether the ground is covered. Five roots a cell stand 0.447 m apart on
    // average and seven stand 0.378 m apart, which is the gap closing by about
    // a sixth. What this assertion is actually for is unchanged — every clear
    // cell of turf gets the same number of clumps, so nothing on the map is
    // quietly bald — and it is written against the pool's own sizing, so a
    // count raised here without raising the pool would overflow rather than pass.
    const world = meadow();
    const { tufts } = meshes(new DecorView(world));
    expect(tufts.count).toBe(world.width * world.height * 7);
  });

  it('leaves no bare gap between clumps at the range the map is played from', () => {
    // The experience test for round 10's grass. Close up the tufts were already
    // right; the defect only exists at manager zoom, where a blade is a couple
    // of pixels and the eye is not reading blades at all — it is asking whether
    // the ground is covered. What it saw instead was scattered pale marks with
    // turf showing between them, which is what "bird tracks" has meant every
    // time it has come back. So the thing to measure is not a tuft. It is the
    // hole: stand on every point of a ten-metre square of open turf and ask how
    // far the nearest clump is.
    //
    // Uniform random placement is the trap here, and it is why round 9's fix did
    // not carry. Independent points clump and leave holes, and the holes shrink
    // with the square root of the count, so buying coverage with density alone
    // is ruinous. Measured at this sampling: five a cell dropped uniformly, the
    // old scheme, leaves a worst hole of 0.629 m; seven a cell dropped uniformly
    // still leaves 0.544 m; seven placed one per stratum of a low-discrepancy
    // sequence leaves 0.436 m on the pinned world. The ceiling below sits under
    // both of the first two on purpose — this test is here to fail if the
    // placement ever goes back to independent hashes, however many tufts are
    // bought to cover for it.
    const world = meadow();
    const view = new DecorView(world);
    const { tufts } = meshes(view);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const roots: { x: number; z: number }[] = [];
    for (let i = 0; i < tufts.count; i++) {
      tufts.getMatrixAt(i, m);
      pos.setFromMatrixPosition(m);
      // A margin either side of the square, so a point on its edge is judged
      // against the clumps outside it too and the frame is not its own hole.
      if (pos.x > 38 && pos.x < 52 && pos.z > 38 && pos.z < 52) roots.push({ x: pos.x, z: pos.z });
    }
    let worst = 0;
    for (let gx = 40; gx <= 50; gx += 0.2) {
      for (let gz = 40; gz <= 50; gz += 0.2) {
        let nearest = Infinity;
        for (const r of roots) nearest = Math.min(nearest, Math.hypot(r.x - gx, r.z - gz));
        worst = Math.max(worst, nearest);
      }
    }
    expect(worst).toBeLessThan(0.5);
    view.dispose();
  });

  it('keeps grass out of buildings and off sown plots', () => {
    const world = meadow();
    const built = packCell(world, 30, 30);
    const sown = packCell(world, 12, 12);
    world.cellBuilding[built] = 7;
    world.zones.push({ id: 1, kind: 'growing', cells: [sown], accepts: [] });

    const view = new DecorView(world);
    const cells = occupiedCells(meshes(view).tufts);
    expect(cells.some((c) => c.x === 30 && c.y === 30)).toBe(false);
    expect(cells.some((c) => c.x === 12 && c.y === 12)).toBe(false);
    expect(cells.some((c) => c.x === 31 && c.y === 30)).toBe(true);
    view.dispose();
  });

  it('never puts a blade of grass on rock, water or bare stone', () => {
    const world = createWorld(SEED);
    const view = new DecorView(world);
    for (const c of occupiedCells(meshes(view).tufts)) {
      expect(terrainAt(world, c.x, c.y)).toBe('grass');
    }
    view.dispose();
  });

  it('scatters stones only on the bare ground that would have them', () => {
    const world = createWorld(SEED);
    const view = new DecorView(world);
    const stones = occupiedCells(meshes(view).stones);
    expect(stones.length).toBeGreaterThan(0);
    for (const c of stones) {
      expect(['dirt', 'stone', 'sand']).toContain(terrainAt(world, c.x, c.y));
    }
    view.dispose();
  });

  it('stands every blade above ground and under knee height', () => {
    const world = meadow();
    const { tufts } = meshes(new DecorView(world));
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let i = 0; i < Math.min(tufts.count, 500); i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(pos, new THREE.Quaternion(), scale);
      expect(pos.y).toBeCloseTo(0, 6);
      expect(scale.y).toBeGreaterThan(0.2);
      expect(scale.y).toBeLessThan(0.6);
    }
  });

  it('keeps every blade below the knee, never up at the waist', () => {
    // The looser cap above is what "knee height" tolerates; this is what the
    // first-person camera needs. At 1.6 m off the ground a blade over forty
    // centimetres fills the lower third of the frame and makes the settler
    // beside it look a metre tall. Every tuft on the map, not a sample — the
    // one outlier is the one the player walks past.
    const world = meadow();
    const { tufts } = meshes(new DecorView(world));
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    let tallest = 0;
    for (let i = 0; i < tufts.count; i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      tallest = Math.max(tallest, scale.y);
    }
    expect(tallest).toBeLessThanOrEqual(0.4);
  });

  it('gives every tuft on a cell its own height, bearing and tone', () => {
    // Seven tufts a cell drawn at one height, one bearing and one green is one
    // stamp printed seven times, and a map of that reads as a texture laid over
    // the ground rather than as ground. The seven on a cell have to differ in
    // all three, and the map as a whole has to take many values of each — a
    // handful of them would be a pattern the eye finds in a second. The count
    // here follows the tufts-per-cell number on purpose: the first run of
    // instances is one cell's worth, and a cell that repeated itself is exactly
    // what this is watching for.
    const world = meadow();
    const { tufts } = meshes(new DecorView(world));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const c = new THREE.Color();
    const heights = new Set<string>();
    const bearings = new Set<string>();
    // Read as three floats rather than as a hex: the instance colour is a
    // multiplier over the baked ramp and the season pushes it past 1 for half
    // the year, where `getHex` clamps every bright tuft to the same white and
    // the tones look identical when the tufts are not. Nothing in the shader
    // clamps, so nothing here should either.
    const tones = new Set<string>();
    const tone = (): string => `${c.r.toFixed(6)},${c.g.toFixed(6)},${c.b.toFixed(6)}`;
    for (let i = 0; i < 7; i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), q, scale);
      heights.add(scale.y.toFixed(4));
      bearings.add(`${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)}`);
      tufts.getColorAt(i, c);
      tones.add(tone());
    }
    expect(heights.size).toBe(7);
    expect(bearings.size).toBe(7);
    expect(tones.size).toBe(7);
    for (let i = 0; i < 300; i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), q, scale);
      heights.add(scale.y.toFixed(4));
      tufts.getColorAt(i, c);
      tones.add(tone());
    }
    expect(heights.size).toBeGreaterThan(100);
    expect(tones.size).toBeGreaterThan(100);
  });

  it('tips every tuft off the vertical without ever laying one down', () => {
    // The lean is the cheap half of why a lawn reads as cover rather than as a
    // scatter of identical marks: a tuft that stands straight shows the manager
    // camera the same chevron its neighbour does, however the two are turned.
    // It is also the one thing here that can be overdone — a clump tipped a long
    // way over is trodden grass, and its instance scale stops being its height,
    // which is the number every knee-height check in this file reads.
    const world = meadow();
    const { tufts } = meshes(new DecorView(world));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3();
    let leaning = 0;
    for (let i = 0; i < tufts.count; i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      up.set(0, 1, 0).applyQuaternion(q);
      expect(up.y).toBeGreaterThan(0.76);
      if (up.y < 0.999) leaning++;
    }
    expect(leaning).toBeGreaterThan(tufts.count * 0.9);
  });

  it('thins the grass where the ground around it has gone bare', () => {
    // Turf does not stop at a line. Grass drawn at full height right up to the
    // edge of a trampled yard was the tell that it was a texture and not a
    // place — so a tuft with cleared ground around it stands lower, and the
    // later tufts on that cell nearly not at all. What must *not* change is how
    // many there are: the pool is sized at seven a cell and so is every count
    // in this file, and bare ground is meant to read as bare because almost
    // nothing is standing on it.
    const world = meadow();
    for (let y = 20; y < 24; y++) {
      for (let x = 20; x < 24; x++) world.cellBuilding[packCell(world, x, y)] = 1;
    }
    const { tufts } = meshes(new DecorView(world));
    expect(tufts.count).toBe((world.width * world.height - 16) * 7);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    let yard = 0;
    let yardN = 0;
    let open = 0;
    let openN = 0;
    for (let i = 0; i < tufts.count; i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(pos, new THREE.Quaternion(), scale);
      const d = Math.max(Math.abs(pos.x - 21.5), Math.abs(pos.z - 21.5));
      if (d < 3) {
        yard += scale.y;
        yardN++;
      } else if (d > 8) {
        open += scale.y;
        openN++;
      }
    }
    expect(yardN).toBeGreaterThan(0);
    expect(yard / yardN).toBeLessThan((open / openN) * 0.9);
  });

  it('leaves the last tuft on the barest cell standing, not growing downwards', () => {
    // The ceiling on the thinning, pinned as behaviour rather than as arithmetic.
    // `left` multiplies the instance's y scale, and the cost is paid per tuft, so
    // the seventh one on a fully-worn cell pays 0.3 + 6 x 0.075 of itself. That
    // sum is 0.75 today and every term in it is a number somebody may reasonably
    // change: raise the tufts-per-cell count without lowering the per-tuft step
    // and the last tuft's scale goes through zero into negative, which is a clump
    // drawn upside down through the turf it stands on. Nothing else here would
    // notice. The yard-versus-open test above compares averages, and a negative
    // height makes an average *smaller* — it would go green while the grass grew
    // into the ground.
    const world = meadow();
    // Worn as far as the sim can wear it: all eight neighbours bare, which is the
    // only input to the wear fraction and puts it at 1.
    const x = 20;
    const y = 20;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        setTerrain(world, x + dx, y + dy, 'dirt');
      }
    }

    const { tufts } = meshes(new DecorView(world));
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const heights: number[] = [];
    for (let i = 0; i < tufts.count; i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(pos, new THREE.Quaternion(), scale);
      if (Math.round(pos.x) === x && Math.round(pos.z) === y) heights.push(scale.y);
    }

    // The cell keeps all seven: thinning is a change of height, not a cull, and a
    // cull would be a hole in the R2 set that the placement work exists to avoid.
    expect(heights.length).toBe(7);
    for (const h of heights) expect(h).toBeGreaterThan(0);
    // And the bare cell is genuinely bare-looking, so this is not passing on a
    // world where the wear never reached the cell at all.
    expect(Math.min(...heights)).toBeLessThan(0.2);
  });

  it('puts the same blades in the same places every time', () => {
    const a = occupiedCells(meshes(new DecorView(meadow())).tufts);
    const b = occupiedCells(meshes(new DecorView(meadow())).tufts);
    expect(a).toEqual(b);
  });
});

describe('what a blade and a stone are made of', () => {
  it('keeps a blade cheap, rooted at the origin and one unit tall', () => {
    // The blade is instanced once per tuft across the whole map, so a few extra
    // triangles here is tens of thousands on screen. And the instance matrix
    // scales y straight to the blade's height: a geometry whose roots drifted
    // off the origin or whose tip was not at y = 1 would plant every tuft in the
    // wrong place and lie to the knee-height check above.
    const view = new DecorView(meadow());
    const geo = meshes(view).tufts.geometry;
    expect(triangles(geo)).toBeLessThanOrEqual(16);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(1, 6);
    expect(Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z)).toBeLessThan(1);
    view.dispose();
  });

  it('lights a blade as a curved sheet, seen from either side', () => {
    // A blade is a sheet with no back, so it has to draw from both sides or it
    // vanishes for half a turn in first person; and it is welded and smooth
    // because a blade caught mid-bow wants the light to run along it. Break it
    // into facets and the waist takes a hard step, which is a folded strip of
    // tin and not grass.
    const view = new DecorView(meadow());
    const grass = meshes(view).tufts.material as THREE.MeshLambertMaterial;
    expect(grass.flatShading).toBe(false);
    expect(grass.side).toBe(THREE.DoubleSide);
    view.dispose();
  });

  it('breaks a stone into flat faces instead of rounding it into an egg', () => {
    // This reverses what this file asserted for ten rounds, and the frames are
    // the argument rather than a preference. Round 10 caught the outcrop and the
    // scatter two metres apart in one shot: the outcrop steps in value from one
    // face to the next and reads as rock, and the pebbles beside it carry a
    // single highlight sliding over a smooth ovoid and read as eggs lying in the
    // dirt — worst in the dusk frame, where the low sun lays a warm rim round
    // each one. A smooth lump *is* an egg, so the welded, indexed, one-normal-
    // per-vertex stone the old assertion pinned was pinning the defect itself.
    // What replaces it is the opposite property, asserted as directly: every
    // triangle owns its three vertices, all three carry the same normal, and
    // neighbours disagree by an angle the eye can see. The old assertion is not
    // relaxed into this one — it is contradicted by it, on purpose.
    //
    // The triangle ceiling stays where it was. This is instanced a few thousand
    // times a frame and the shape is worth twenty triangles, not two hundred.
    const view = new DecorView(meadow());
    const geo = meshes(view).stones.geometry;
    expect(geo.index).toBeNull();
    expect(geo.getAttribute('position').count).toBe(triangles(geo) * 3);
    expect(triangles(geo)).toBeLessThanOrEqual(200);

    const n = geo.getAttribute('normal');
    const p = geo.getAttribute('position');
    const faces = p.count / 3;
    const normals: THREE.Vector3[] = [];
    const corners: string[][] = [];
    for (let f = 0; f < faces; f++) {
      const first = new THREE.Vector3().fromBufferAttribute(n, f * 3);
      const three: string[] = [];
      for (let k = 0; k < 3; k++) {
        // One normal per facet is what "flat" means here. The material never
        // says `flatShading`, so if this ever welded again the stones would go
        // smooth silently and nothing else in the file would notice.
        expect(first.dot(new THREE.Vector3().fromBufferAttribute(n, f * 3 + k))).toBeGreaterThan(0.999);
        three.push(
          `${p.getX(f * 3 + k).toFixed(5)},${p.getY(f * 3 + k).toFixed(5)},${p.getZ(f * 3 + k).toFixed(5)}`,
        );
      }
      normals.push(first);
      corners.push(three);
    }

    // Two faces sharing an edge are two corners in common. Twenty faces knocked
    // out of true give thirty such pairs, and the angle across each of those
    // edges is the step in brightness a player sees. Measured: 14.0° at the
    // shallowest, 40.4° at the median, 68.2° at the sharpest. The floor is set
    // under the shallowest and the median floor under the median, so a shape
    // that quietly relaxed back towards a ball would fail here before it ever
    // reached a frame.
    const angles: number[] = [];
    for (let a = 0; a < faces; a++) {
      for (let b = a + 1; b < faces; b++) {
        if (corners[a]!.filter((k) => corners[b]!.includes(k)).length !== 2) continue;
        angles.push((Math.acos(Math.min(1, Math.max(-1, normals[a]!.dot(normals[b]!)))) * 180) / Math.PI);
      }
    }
    angles.sort((a, b) => a - b);
    expect(angles.length).toBeGreaterThanOrEqual(faces);
    expect(angles[0]).toBeGreaterThan(10);
    expect(angles[Math.floor(angles.length / 2)]).toBeGreaterThan(30);
    view.dispose();
  });

  it('gives one stone its own light and dark faces before any sun reaches it', () => {
    // Faceting alone gives a stone a lit side and a shaded side, and that is the
    // sun's doing: it goes flat in the shadow of a wall and nearly flat under
    // the low sun of the dusk frame, which is where the eggs were worst. A tone
    // baked per face survives both, and it is what says one break is fresh and
    // another weathered. Constant across a triangle, or it is a gradient and the
    // facet stops reading as a facet. Measured spread: 0.862 to 1.122, a ratio
    // of 1.30 between the palest face and the darkest.
    const view = new DecorView(meadow());
    const geo = meshes(view).stones.geometry;
    const col = geo.getAttribute('color');
    expect(col).toBeTruthy();
    // The order matters and is the trap `occlusion.ts` documents: a material
    // with `vertexColors` and no colour attribute renders every stone black.
    expect((meshes(view).stones.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    const faces = col.count / 3;
    const tones = new Set<string>();
    let lo = Infinity;
    let hi = 0;
    for (let f = 0; f < faces; f++) {
      const v = col.getX(f * 3);
      for (let k = 1; k < 3; k++) expect(col.getX(f * 3 + k)).toBeCloseTo(v, 6);
      tones.add(v.toFixed(5));
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(tones.size).toBeGreaterThan(faces * 0.8);
    expect(hi / lo).toBeGreaterThan(1.2);
    // And it must stay a multiplier over the per-instance tint rather than a
    // replacement for it, or every stone on the map takes the same twenty
    // tones and the field goes back to being one object stamped out.
    expect(hi).toBeLessThan(1.3);
    expect(lo).toBeGreaterThan(0.75);
    view.dispose();
  });

  it('plants a clump of slim blades on one root, not a single shard', () => {
    // From the manager camera one blade is a chevron; three leaning out of the
    // same root are grass. Every root vertex sits at y = 0 and within a blade's
    // width of the origin, which is what "sharing one root" means — and the
    // count of them is the count of blades, since a strip has two.
    const view = new DecorView(meadow());
    const p = meshes(view).tufts.geometry.getAttribute('position');
    let roots = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i)) > 1e-6) continue;
      roots++;
      expect(Math.hypot(p.getX(i), p.getZ(i))).toBeLessThan(0.3);
    }
    expect(roots).toBeGreaterThanOrEqual(6);
    view.dispose();
  });

  it('gives a tuft a footprint from straight overhead, not just from the side', () => {
    // The manager camera looks almost straight down, and a clump of upright
    // blades seen from there is three lines meeting at a point: no matter how
    // the tuft is turned, the cell under it reads as bare. The blades have to
    // fall away from the root on bearings far apart, so that whichever third of
    // the compass the eye comes from, something is spread out under it. Read as
    // the furthest any vertex gets from the root in each third of the circle.
    const view = new DecorView(meadow());
    const p = meshes(view).tufts.geometry.getAttribute('position');
    const reach = [0, 0, 0];
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const third = Math.min(2, Math.floor((a + Math.PI) / ((Math.PI * 2) / 3)));
      reach[third] = Math.max(reach[third]!, Math.hypot(p.getX(i), p.getZ(i)));
    }
    for (const r of reach) expect(r).toBeGreaterThan(0.3);
    view.dispose();
  });

  it('lights a blade from turf-green at the root to a paler tip', () => {
    // Blades darker than the lawn they stand on peppered every overhead frame
    // with black shards. The gradient is baked into the geometry — the shader
    // multiplies it with the per-tuft tint — so it has to be there, the root
    // must be no darker than the ground's own green, and the tip lighter still
    // so the top of a tuft catches light instead of going black.
    const view = new DecorView(meadow());
    const { tufts } = meshes(view);
    expect((tufts.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    const geo = tufts.geometry;
    const p = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    expect(col).toBeDefined();
    // Lightness is judged in sRGB — the space the palette is written in —
    // since three keeps every colour linear-light once it is set.
    const hsl = { h: 0, s: 0, l: 0 };
    const turf = new THREE.Color(TERRAIN_COLOR.grass).getHSL(hsl, THREE.SRGBColorSpace).l;
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const l = c.fromBufferAttribute(col, i).getHSL(hsl, THREE.SRGBColorSpace).l;
      if (Math.abs(p.getY(i)) < 1e-6) expect(l).toBeGreaterThanOrEqual(turf);
      if (Math.abs(p.getY(i) - 1) < 1e-6) expect(l).toBeGreaterThan(turf + 0.1);
    }
    view.dispose();
  });

  it('keeps the tip of a blade green, not straw', () => {
    // A yellow-green tip caught the light, and nine thousand of them turned the
    // wide frames the colour of hay. The tip has to stay in the green band —
    // paler than the root, but the same leaf. Hue is read in sRGB like the
    // lightness test above; the band is 83° to 130°, yellow-green through to
    // blue-green, with straw (below 75°) outside it.
    const view = new DecorView(meadow());
    const geo = meshes(view).tufts.geometry;
    const p = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    const c = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    let tips = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i) - 1) > 1e-6) continue;
      tips++;
      const { h } = c.fromBufferAttribute(col, i).getHSL(hsl, THREE.SRGBColorSpace);
      expect(h).toBeGreaterThan(0.23);
      expect(h).toBeLessThan(0.36);
    }
    expect(tips).toBeGreaterThan(0);
    view.dispose();
  });

  it('creases a blade down its middle, so its two halves cannot take one light', () => {
    // A flat strip has one plane and so one normal, and from the manager camera
    // looking straight down that is what made a tuft read as folded paper: the
    // light could not tell one half of a leaf from the other. The crease is what
    // gives a blade a cross-section — the midline has to stand off the chord
    // between its own edges, and the two halves have to lean opposite ways, or
    // the geometry is a strip with extra vertices in it.
    const geo = foldedBladeGeometry(0.5, 0.34, 0.8);
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    let left = -1;
    let right = -1;
    let mid = -1;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) <= 0 || p.getY(i) >= 1) continue;
      if (Math.abs(p.getX(i)) < 1e-6) mid = i;
      else if (p.getX(i) < 0) left = i;
      else right = i;
    }
    expect(Math.min(left, right, mid)).toBeGreaterThanOrEqual(0);
    // Both edges of the crease sit at one height, so "off the chord" is the one
    // number: how far the midline is pushed out of their plane.
    expect(p.getY(left)).toBeCloseTo(p.getY(right), 6);
    expect(p.getZ(mid) - p.getZ(left)).toBeGreaterThan(Math.abs(p.getX(left)) * 0.25);
    expect(n.getX(left)).toBeGreaterThan(0.2);
    expect(n.getX(right)).toBeLessThan(-0.2);
    geo.dispose();
  });

  it('spends the tuft budget on five thin blades and not three fat ones', () => {
    // The grass is instanced tens of thousands of times, so how the sixteen
    // triangles a tuft may cost get divided is a decision and not an accident.
    // Three creased blades took five triangles each; five plain ones take three
    // each and land on the same fifteen — the swap that stopped a tuft reading
    // as a three-pointed star with a notch in the middle. A sixth blade, or a
    // fourth row of vertices in one of these five, would still merge and still
    // draw; what it would stop doing is fitting, and this is where that shows.
    const view = new DecorView(meadow());
    const geo = meshes(view).tufts.geometry;
    expect(triangles(geo)).toBe(15);
    // Five strips of five vertices, none shared: two roots, two at the waist
    // and a tip, times the five blades.
    expect(geo.getAttribute('position').count).toBe(25);
    view.dispose();
  });

  it('leans a tuft into a sheaf rather than opening it into a star', () => {
    // Round 9 spread the five blades evenly round the root — 72° apart, all
    // reaching about as far — because that was the cure for the three-pointed
    // star. From the manager camera it turned into a different glyph: a small
    // symmetrical rosette, and a field of rosettes reads as marks pressed into
    // the turf rather than as grass, which is what the round-10 colony frame
    // shows. Real grass grows in a sheaf: a few long blades going the same way
    // and shorter ones falling away behind, so the clump has a front and a back
    // and neighbouring clumps interlock instead of tiling.
    //
    // Measured on the table this is built from — tip bearings 18.3°, 28.4°,
    // 58.9°, −62.7° and −164.4°, at heights 1.00, 0.82, 0.63, 0.47 and 0.36.
    // Every number below is a property an even star would fail: its neighbours
    // sit exactly 72° apart, so it has no arc under 45° holding the long
    // blades, no gap over 120° behind them, and no pair closer than 20°.
    const view = new DecorView(meadow());
    const p = meshes(view).tufts.geometry.getAttribute('position');
    const blades = p.count / 5;
    expect(blades).toBe(5);
    const tips: { bearing: number; height: number }[] = [];
    for (let b = 0; b < blades; b++) {
      let top = b * 5;
      for (let k = 1; k < 5; k++) if (p.getY(b * 5 + k) > p.getY(top)) top = b * 5 + k;
      tips.push({
        bearing: (Math.atan2(p.getZ(top), p.getX(top)) * 180) / Math.PI,
        height: p.getY(top),
      });
    }

    // Stepped, not five spikes of a height: each blade shorter than the last by
    // a real margin, so the clump has a silhouette instead of an outline.
    const byHeight = [...tips].sort((a, b) => b.height - a.height);
    for (let i = 1; i < byHeight.length; i++) {
      expect(byHeight[i]!.height).toBeLessThan(byHeight[i - 1]!.height * 0.9);
    }

    // The three that carry the clump's mass go one way.
    const lead = byHeight.slice(0, 3).map((t) => t.bearing).sort((a, b) => a - b);
    expect(lead[2]! - lead[0]!).toBeLessThan(45);

    const bearings = tips.map((t) => t.bearing).sort((a, b) => a - b);
    const gaps = bearings.map((b, i) => ((bearings[(i + 1) % 5]! - b + 360) % 360)).sort((a, b) => a - b);
    // A back to the clump...
    expect(gaps[4]).toBeGreaterThan(120);
    // ...and blades that overlap at the front rather than fanning out from it.
    expect(gaps[0]).toBeLessThan(20);
    view.dispose();
  });

  it('still keeps a creased blade to five triangles, for the leaves built out of it', () => {
    // The tuft stopped using this shape, but `fx.ts` did not: a stripped bush's
    // leaves are folded blades, and they are instanced across the moor. The
    // crease costs a row of vertices, and one row is all it may ever cost.
    const blade = foldedBladeGeometry(0.5, 0.34, 0.8);
    expect(triangles(blade)).toBe(5);
    blade.dispose();
  });

  it('brings each blade up out of its own patch of ground, not one shared point', () => {
    // Five blades striking the turf at one place is a hard notch, and a field of
    // notches photographed as bird tracks pressed into the grass — the single
    // biggest thing wrong with the old three-blade tuft. Each blade's root edge
    // has its own midpoint on y = 0, far enough from the others that the junction
    // is a patch of stems rather than a point. Read as the midpoint of each pair
    // of root vertices, which is how the geometry is built.
    const view = new DecorView(meadow());
    const p = meshes(view).tufts.geometry.getAttribute('position');
    const roots: { x: number; z: number }[] = [];
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i)) < 1e-6) roots.push({ x: p.getX(i), z: p.getZ(i) });
    }
    expect(roots.length).toBe(10);
    const mids = [];
    for (let i = 0; i + 1 < roots.length; i += 2) {
      mids.push({ x: (roots[i]!.x + roots[i + 1]!.x) / 2, z: (roots[i]!.z + roots[i + 1]!.z) / 2 });
    }
    expect(mids.length).toBe(5);
    for (let i = 0; i < mids.length; i++) {
      for (let j = i + 1; j < mids.length; j++) {
        expect(Math.hypot(mids[i]!.x - mids[j]!.x, mids[i]!.z - mids[j]!.z)).toBeGreaterThan(0.06);
      }
    }
    view.dispose();
  });

  it('makes a blade rise and bow over rather than radiate flat along the ground', () => {
    // What gave the old tuft its footprint from overhead was the lean, and a
    // blade leaned far enough to matter is a blade lying on the turf: three of
    // those from one point is an arrowhead, not grass. The footprint now comes
    // from the bow, so anything that reaches out from the root has to still be
    // standing off the ground when it gets there. Measured as the lowest vertex
    // among those more than a third of a tuft-height out from the root.
    const view = new DecorView(meadow());
    const p = meshes(view).tufts.geometry.getAttribute('position');
    let lowestOut = Infinity;
    let out = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.hypot(p.getX(i), p.getZ(i)) <= 0.3) continue;
      out++;
      lowestOut = Math.min(lowestOut, p.getY(i));
    }
    expect(out).toBeGreaterThan(3);
    expect(lowestOut).toBeGreaterThan(0.1);
    view.dispose();
  });

  it('scales a short blade whole, so its bow shrinks with its length', () => {
    // The bow is an offset at the tip measured in the blade's own units, so a
    // blade scaled in height alone keeps the reach of a full-length one: the
    // shortest leaf of the tuft came out a quarter of a tuft-height tall and
    // two and a half times that far out along the turf. From the manager camera
    // a leaf lying broadside like that is a long bright streak, and a pair of
    // them either side of an upright one is the bird the whole shape was
    // rewritten to stop being. Nothing may reach out much further than it
    // stands up.
    const view = new DecorView(meadow());
    const p = meshes(view).tufts.geometry.getAttribute('position');
    let widest = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (r <= 0.3) continue;
      widest = Math.max(widest, r / p.getY(i));
    }
    expect(widest).toBeLessThan(1.8);
    view.dispose();
  });

  it('keeps a blade slimmer than a third of the tuft it stands in', () => {
    // A blade as wide as it is long is not a blade, it is a dart, and the tuft
    // was three darts. The root edge is where a blade is widest — it tapers
    // from there — so its length against the tuft's own height is the one number
    // that says "slim". The tuft is one unit tall by construction.
    const view = new DecorView(meadow());
    const p = meshes(view).tufts.geometry.getAttribute('position');
    const roots: { x: number; z: number }[] = [];
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i)) < 1e-6) roots.push({ x: p.getX(i), z: p.getZ(i) });
    }
    for (let i = 0; i + 1 < roots.length; i += 2) {
      expect(Math.hypot(roots[i]!.x - roots[i + 1]!.x, roots[i]!.z - roots[i + 1]!.z)).toBeLessThanOrEqual(0.32);
    }
    view.dispose();
  });

  it('lights a stone off the sky as well as the sun', () => {
    // Lambert takes the sun and nothing else, and a pebble nearly the colour of
    // the dirt it lies on is then a flat disc. A standard material reads the
    // scene's environment map and puts a rim along the lump's upper edge, which
    // is the one cue that says "this is a thing sitting on the ground". Rough
    // enough to stay stone and not wet plastic.
    const view = new DecorView(meadow());
    const rock = meshes(view).stones.material as THREE.MeshStandardMaterial;
    expect(rock.isMeshStandardMaterial).toBe(true);
    expect(rock.roughness).toBeGreaterThanOrEqual(0.7);
    expect(rock.roughness).toBeLessThanOrEqual(0.9);
    view.dispose();
  });

  it('colours every stone a mid tone, and no two fields of them alike', () => {
    // A loose stone in the cliff's navy grey came out as a black dot on lit
    // dirt from overhead. Every instance has to stay in the middle of the range
    // — never near black, never blown out — and they must not all be the one
    // colour, or the scatter reads as a stamp.
    const world = createWorld(SEED);
    const view = new DecorView(world);
    const { stones } = meshes(view);
    expect(stones.count).toBeGreaterThan(1);
    const c = new THREE.Color();
    const seen = new Set<number>();
    for (let i = 0; i < stones.count; i++) {
      stones.getColorAt(i, c);
      const { l } = c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
      expect(l).toBeGreaterThan(0.38);
      expect(l).toBeLessThan(0.62);
      seen.add(c.getHex());
    }
    expect(seen.size).toBeGreaterThan(1);
    view.dispose();
  });

  it('keeps every stone a grey, never a colour', () => {
    // The lightness band above is one half of "this is rock"; this is the other,
    // and it is the half a round actually broke. Widening the per-instance tone
    // to match the new faceting took the hue a sixth of a turn either way off a
    // mid-grey that only carries a tenth of a saturation to begin with, and
    // added a quarter of saturation on top: at the bottom of that range a stone
    // comes out at hue 0.026 with saturation 0.21, which is a pink. Round 11
    // photographed five of them lying in the yard and a dozen across the field
    // at dusk, where the low sun pushes what is already pink further.
    //
    // Nothing in the suite could see it. The lightness test passes a pink
    // happily — a pink of the right lightness is a pink — and the variety test
    // below is *satisfied* by it, because a pink stone is certainly not the same
    // colour as its neighbour. So the band is written here as the two numbers a
    // grey is: a saturation that stays under a fifth, and a hue that stays
    // inside the brown wedge the palette entry sits in. Read in sRGB rather than
    // the linear working space, because the question is what the frame looked
    // like and not what the buffer held.
    const view = new DecorView(createWorld(SEED));
    const { stones } = meshes(view);
    expect(stones.count).toBeGreaterThan(1);
    const c = new THREE.Color();
    for (let i = 0; i < stones.count; i++) {
      stones.getColorAt(i, c);
      const { h, s } = c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
      expect(s).toBeLessThan(0.18);
      expect(h).toBeGreaterThan(0.05);
      expect(h).toBeLessThan(0.13);
    }
    view.dispose();
  });

  it('scatters stones at different sizes, ways up and proportions', () => {
    // The egg was not only smooth. In the round-10 closeup the scatter is also
    // uniform: near enough one size, one tone, and every lump sitting the same
    // way up with its long axis flat to the ground, which is what makes a field
    // of them read as laid rather than dropped. The fix is twelve independent
    // hashes where there were two, and this is the measurement of it — the
    // numbers are what the scatter now produces on the pinned world, and each
    // floor sits under the measured value with room but not much.
    //
    // Way up is the one that matters most and was worst: the old rotation was a
    // spin about Y alone, so every stone showed its top to the sun. Now the
    // tilt off vertical runs 1.4° to 98.6° with a median of 35.2°, and better
    // than a tenth of them are past 60° — lying on a side, showing a face that
    // was underneath.
    const world = createWorld(SEED);
    const view = new DecorView(world);
    const { stones } = meshes(view);
    const n = Math.min(600, stones.count);
    expect(n).toBeGreaterThan(100);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3();
    const c = new THREE.Color();
    const tilts: number[] = [];
    const aspects: number[] = [];
    const hues = new Set<string>();
    let smallest = Infinity;
    let largest = 0;
    for (let i = 0; i < n; i++) {
      stones.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), q, scale);
      up.set(0, 1, 0).applyQuaternion(q);
      tilts.push((Math.acos(Math.min(1, Math.max(-1, up.y))) * 180) / Math.PI);
      // Height against width: a stone that is always the same shape is a bead,
      // whatever size it is drawn at.
      aspects.push(scale.y / scale.x);
      smallest = Math.min(smallest, scale.x, scale.y, scale.z);
      largest = Math.max(largest, scale.x, scale.y, scale.z);
      stones.getColorAt(i, c);
      hues.add(c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).h.toFixed(4));
    }
    tilts.sort((a, b) => a - b);
    aspects.sort((a, b) => a - b);
    expect(tilts[Math.floor(n / 2)]).toBeGreaterThan(20);
    expect(tilts.filter((t) => t > 60).length).toBeGreaterThan(n * 0.05);
    // And not all knocked over either — some still sit close to the way they
    // were dropped, or the tilt reads as a second stamp rather than as chance.
    expect(tilts[0]).toBeLessThan(10);
    expect(aspects[n - 1]! / aspects[0]!).toBeGreaterThan(2);
    expect(largest / smallest).toBeGreaterThan(3);
    expect(hues.size).toBeGreaterThan(n * 0.5);
    view.dispose();
  });

  it('beds every stone into the ground and buries none of it', () => {
    // A stone drawn on the ground plane floats: its underside is a hard ellipse
    // of shadow with daylight under it, and from the manager camera that is a
    // sticker. So it is sunk, and the depth has to hold for every rotation the
    // hashes can produce — the narrowest a lump can be through any axis is
    // about 0.28 of its radius, which is what the sink is set under. Measured
    // over every instance on the pinned world: the shallowest sits 0.020 m into
    // the dirt and the lowest crown stands 0.040 m clear of it. Both signs
    // matter — one is floating, the other is a stone buried out of sight and
    // paid for anyway.
    const world = createWorld(SEED);
    const view = new DecorView(world);
    const { stones } = meshes(view);
    const p = stones.geometry.getAttribute('position');
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    let shallowest = Infinity;
    let lowestCrown = Infinity;
    for (let i = 0; i < stones.count; i++) {
      stones.getMatrixAt(i, m);
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p as THREE.BufferAttribute, k).applyMatrix4(m);
        lo = Math.min(lo, v.y);
        hi = Math.max(hi, v.y);
      }
      shallowest = Math.min(shallowest, -lo);
      lowestCrown = Math.min(lowestCrown, hi);
    }
    expect(shallowest).toBeGreaterThan(0.005);
    expect(lowestCrown).toBeGreaterThan(0.02);
    view.dispose();
  });

  it('shows no two stones in one frame as the same object', () => {
    // The experience test for the egg field. A player never inspects one stone;
    // they look at a yard of them and either see rubble or see a pattern. So
    // this asks the question the frame asks: take the busiest twenty metres of
    // ground the map has — about what fills the colony shot — and count how
    // many of the stones in it are distinguishable from each other by the three
    // things the eye actually reads at that range: how big, how light, and
    // which way up. Buckets are deliberately coarse, roughly the finest
    // difference that survives the tone map at manager zoom.
    //
    // Measured on the pinned world: 45 stones in the densest twenty-metre
    // window, 42 of them distinct — 14 size buckets, 7 tone buckets, 8 tilt
    // buckets. Before this round the size came off one hash and the way up off
    // that same hash, so every stone of a size sat identically and the whole
    // window collapsed towards a handful of shapes.
    const world = createWorld(SEED);
    const view = new DecorView(world);
    const { stones } = meshes(view);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const at: { x: number; z: number; i: number }[] = [];
    for (let i = 0; i < stones.count; i++) {
      stones.getMatrixAt(i, m);
      pos.setFromMatrixPosition(m);
      at.push({ x: pos.x, z: pos.z, i });
    }
    let best: typeof at = [];
    for (let x = 0; x < world.width - 20; x += 10) {
      for (let z = 0; z < world.height - 20; z += 10) {
        const win = at.filter((s) => s.x >= x && s.x < x + 20 && s.z >= z && s.z < z + 20);
        if (win.length > best.length) best = win;
      }
    }
    expect(best.length).toBeGreaterThan(20);
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3();
    const c = new THREE.Color();
    const kinds = new Set<string>();
    const sizes = new Set<number>();
    const tilts = new Set<number>();
    for (const s of best) {
      stones.getMatrixAt(s.i, m);
      m.decompose(new THREE.Vector3(), q, scale);
      up.set(0, 1, 0).applyQuaternion(q);
      stones.getColorAt(s.i, c);
      const size = Math.floor(scale.y * 40);
      const tone = Math.floor(c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l * 40);
      const tilt = Math.floor((Math.acos(Math.min(1, Math.max(-1, up.y))) * 180) / Math.PI / 10);
      kinds.add(`${size}/${tone}/${tilt}`);
      sizes.add(size);
      tilts.add(tilt);
    }
    expect(kinds.size).toBeGreaterThan(best.length * 0.8);
    expect(sizes.size).toBeGreaterThanOrEqual(8);
    expect(tilts.size).toBeGreaterThanOrEqual(5);
    view.dispose();
  });

  it('ends a blade in one tip, at the height and the bow the callers hang things on', () => {
    // The blade is not only grass: the crops in `fx.ts` build their leaves,
    // sprouts and stalks out of it, and a headed plant hangs a cluster of grain
    // on the *tip* of a stalk. That caller has to be able to say where the tip
    // is without reading this geometry, and the answer is (0, 1, bend) — one
    // vertex, at full height, carrying the whole of the forward bow. A head
    // placed on a tip that had quietly moved floats off the end of its stalk.
    const bend = 0.3;
    const geo = bladeGeometry(0.2, 3, bend);
    const p = geo.getAttribute('position');
    let tips = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i) - 1) > 1e-6) continue;
      tips++;
      expect(p.getX(i)).toBeCloseTo(0, 6);
      expect(p.getZ(i)).toBeCloseTo(bend, 6);
    }
    expect(tips).toBe(1);
    geo.dispose();
  });
});

function triangles(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
}

describe('the scatter keeping up with the colony', () => {
  it('clears the turf under a wall the moment it goes up', () => {
    const world = meadow();
    const view = new DecorView(world);
    const before = meshes(view).tufts.count;

    world.cellBuilding[packCell(world, 30, 30)] = 7;
    view.sync(world, 100);

    const { tufts } = meshes(view);
    expect(tufts.count).toBe(before - 7);
    expect(occupiedCells(tufts).some((c) => c.x === 30 && c.y === 30)).toBe(false);
    view.dispose();
  });

  it('does no work at all when nothing has moved', () => {
    const world = meadow();
    const view = new DecorView(world);
    const { tufts } = meshes(view);
    view.sync(world, 20);
    const version = tufts.instanceMatrix.version;
    view.sync(world, 40);
    expect(tufts.instanceMatrix.version).toBe(version);
    view.dispose();
  });

  it('leaves the whole scatter hidden on low quality', () => {
    const world = meadow();
    const view = new DecorView(world);
    view.setDecor(false);
    expect(view.group.visible).toBe(false);
    view.setDecor(true);
    expect(view.group.visible).toBe(true);
    view.dispose();
  });
});


/** Rec. 709 luminance of a linear colour — the same weights the tone map uses. */
function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** The tint the first tuft is painted with on a meadow parked at a phase of the year. */
function tintAt(phase: number): THREE.Color {
  const world = meadow();
  world.tick = Math.round(phase * TICKS_PER_YEAR);
  const view = new DecorView(world);
  const c = new THREE.Color();
  meshes(view).tufts.getColorAt(0, c);
  view.dispose();
  return c;
}

describe('the year reaching a blade of grass', () => {
  it('gives every season its own green', () => {
    // The ground under the grass has turned with the year since the season
    // landed; the grass standing on it did not, and a winter frame showed white
    // ground with high-summer tufts growing out of it. Four seasons, four
    // colours, and none of them repeated.
    const seen = new Set<string>();
    for (let i = 0; i < SEASONS.length; i++) {
      const c = tintAt((i + 0.5) / SEASONS.length);
      seen.add(`${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)}`);
    }
    expect(seen.size).toBe(SEASONS.length);
  });

  it('lands each season on what that season does to the tip colour', () => {
    // The instance colour is a multiplier over a baked root-to-tip ramp, so it
    // cannot be a season's colour — it has to be a season's *ratio* against the
    // palette entry the ramp was baked from. Read against high summer, every
    // channel of every season must come out at exactly the ratio the palette
    // would apply to `GRASS_TIP`, which is what makes the tip of a winter blade
    // sit on `seasonTint(GRASS_TIP)` and not somewhere near it.
    const peak = seasonTint(new THREE.Color(GRASS_TIP), 0.125);
    const summer = tintAt(0.125);
    for (let i = 0; i < SEASONS.length; i++) {
      const phase = (i + 0.5) / SEASONS.length;
      const want = seasonTint(new THREE.Color(GRASS_TIP), phase);
      const got = tintAt(phase);
      expect(got.r / summer.r).toBeCloseTo(want.r / peak.r, 4);
      expect(got.g / summer.g).toBeCloseTo(want.g / peak.g, 4);
      expect(got.b / summer.b).toBeCloseTo(want.b / peak.b, 4);
    }
  });

  it('keeps the root darker than the tip in every season', () => {
    // The failure this is here to catch is the cheap fix: paint the instance the
    // season's colour outright. That flattens a blade to one flat tone, because
    // the instance colour multiplies the baked ramp rather than replacing it —
    // the clump stops reading as grass and starts reading as a green chip. As a
    // ratio the ramp survives the turn: summer is 1.79 to 1 root against tip and
    // deep winter, the flattest the year gets, is still 1.83 to 1.
    const world = meadow();
    const view = new DecorView(world);
    const col = meshes(view).tufts.geometry.getAttribute('color');
    const c = new THREE.Color();
    let root = new THREE.Color(1, 1, 1);
    let tip = new THREE.Color(0, 0, 0);
    for (let i = 0; i < col.count; i++) {
      c.fromBufferAttribute(col, i);
      if (luminance(c) < luminance(root)) root = c.clone();
      if (luminance(c) > luminance(tip)) tip = c.clone();
    }
    view.dispose();

    for (let i = 0; i < SEASONS.length; i++) {
      const t = tintAt((i + 0.5) / SEASONS.length);
      const lit = luminance(new THREE.Color(tip.r * t.r, tip.g * t.g, tip.b * t.b));
      const dark = luminance(new THREE.Color(root.r * t.r, root.g * t.g, root.b * t.b));
      expect(lit / dark).toBeGreaterThan(1.5);
    }
  });
});
