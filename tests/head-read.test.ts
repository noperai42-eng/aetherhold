/**
 * Whether a head says which way it is pointed, measured from the camera the
 * game is actually played at.
 *
 * Round twelve gave the head a neck and then reported that the turn did not
 * survive the manager camera. It blamed a sphere whose silhouette barely
 * changes as it rotates, which was half right. The measurement here is the
 * other half: at yaw 45 degrees and pitch 0.92 -- `defaultCamera`, not a number
 * chosen for a test -- between 94 and 100 per cent of a head's projected area
 * was one material, and its outline was a circle to within six per cent, whose
 * principal axis therefore wandered at random. There was nothing on a head to
 * rotate. Both of these are about what a camera at that angle can see, so both
 * are measured by casting rays down it rather than by reading the geometry.
 *
 * These are not tests of a hairstyle. They are tests that the head has a long
 * axis and that the long axis is the one the body is facing, which is the whole
 * of what makes `head-aim.ts` visible in a frame.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { PawnsView } from '../src/client/render/pawns';
import { createWorld } from '../src/sim/worldgen';
import type { PawnsView as View } from '../src/client/render/pawns';

const SEED = 20260907;
/** `defaultCamera` in `sim/save.ts`. The read is judged from where a player sits. */
const CAM_YAW = Math.PI * 0.25;
const CAM_PITCH = 0.92;

function viewDir(): THREE.Vector3 {
  const cp = Math.cos(CAM_PITCH);
  return new THREE.Vector3(Math.cos(CAM_YAW) * cp, Math.sin(CAM_PITCH), Math.sin(CAM_YAW) * cp).normalize();
}

/** The screen basis the outline is measured in: right is level, up completes it. */
function screenBasis(): { right: THREE.Vector3; up: THREE.Vector3; v: THREE.Vector3 } {
  const v = viewDir();
  const right = new THREE.Vector3(0, 1, 0).cross(v).normalize();
  return { right, up: v.clone().cross(right).normalize(), v };
}

/**
 * The four cuts, by the two seed bits `hairStyleOf` reads: bit 12 is the
 * length it always was, bit 13 the second axis r29 added. Until r29 this was a
 * `long` flag setting bit 12 alone, which after the change photographed
 * whichever two of the four cuts the valley's first settler happened to carry.
 */
const CUTS = [0, 1, 2, 3];

/** One settler on a real map, pointed a given way, with the head left straight. */
function facing(rad: number, cut: number): View {
  const world = createWorld(SEED);
  const pawn = world.pawns.find((p) => !p.animal)!;
  world.pawns = [pawn];
  world.jobs = [];
  pawn.jobId = null;
  pawn.targetPawnId = null;
  pawn.carryingItemId = null;
  pawn.carryingPawnId = null;
  pawn.dead = false;
  pawn.downed = false;
  pawn.facing = rad;
  pawn.colorSeed = (pawn.colorSeed & ~0x3000) | ((cut & 1) << 12) | ((cut >> 1) << 13);
  const view = new PawnsView();
  view.onTick(world);
  view.sync(world, 1, null, 1 / 60);
  view.group.updateMatrixWorld(true);
  return view;
}

function headMeshes(view: View): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  view.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.name === 'head' || m.name === 'hair' || m.name === 'eye')) out.push(m);
  });
  return out;
}

/**
 * What the manager camera sees of a head: every ray that lands on it, in the
 * screen plane, with the material it landed on.
 */
function survey(view: View, n = 64): { pts: Array<[number, number]>; byName: Map<string, number> } {
  const meshes = headMeshes(view);
  const box = new THREE.Box3();
  for (const m of meshes) box.expandByObject(m);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
  const { right, up, v } = screenBasis();

  const rc = new THREE.Raycaster();
  rc.far = radius * 6;
  const pts: Array<[number, number]> = [];
  const byName = new Map<string, number>();
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const a = ((ix + 0.5) / n - 0.5) * 2 * radius;
      const b = ((iy + 0.5) / n - 0.5) * 2 * radius;
      const origin = centre.clone()
        .add(right.clone().multiplyScalar(a))
        .add(up.clone().multiplyScalar(b))
        .add(v.clone().multiplyScalar(radius * 2));
      rc.set(origin, v.clone().negate());
      const hit = rc.intersectObjects(meshes, false)[0];
      if (!hit) continue;
      pts.push([a, b]);
      byName.set(hit.object.name, (byName.get(hit.object.name) ?? 0) + 1);
    }
  }
  return { pts, byName };
}

/** A mesh's half-extents in its own geometry's frame, free of the body's yaw. */
function semiAxes(m: THREE.Mesh): THREE.Vector3 {
  m.geometry.computeBoundingBox();
  return m.geometry.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(0.5);
}

/** The outline's aspect ratio and the screen angle of its long axis. */
function outline(pts: Array<[number, number]>): { aspect: number; angle: number } {
  let mx = 0, my = 0;
  for (const [a, b] of pts) { mx += a; my += b; }
  mx /= pts.length; my /= pts.length;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const [a, b] of pts) { const u = a - mx, w = b - my; cxx += u * u; cyy += w * w; cxy += u * w; }
  cxx /= pts.length; cyy /= pts.length; cxy /= pts.length;
  const tr = cxx + cyy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (cxx * cyy - cxy * cxy)));
  return {
    angle: 0.5 * Math.atan2(2 * cxy, cxx - cyy),
    aspect: Math.sqrt((tr / 2 + disc) / Math.max(1e-12, tr / 2 - disc)),
  };
}

/** Where the body's forward lands on screen. Render forward is (cos f, 0, sin f). */
function forwardAngle(rad: number): number {
  const { right, up } = screenBasis();
  const fwd = new THREE.Vector3(Math.cos(rad), 0, Math.sin(rad));
  return Math.atan2(fwd.dot(up), fwd.dot(right));
}

/** Two undirected screen axes, compared: an ellipse has no front, only a line. */
function axisGap(a: number, b: number): number {
  const d = (((((a - b) * 180) / Math.PI) % 180) + 270) % 180 - 90;
  return Math.abs(d);
}

const COMPASS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4);

describe('a head under the manager camera', () => {
  // --- functional

  it('is not a circle from any eighth of the compass', () => {
    // A sphere measures 1.00 and the old head measured 1.006 to 1.059, which is
    // a circle with sampling noise on it. The floor is set below the worst
    // facing rather than at it: the head's long axis lies along the camera's own
    // azimuth twice in a turn, and there it foreshortens by the sine of the
    // pitch however long the skull is. That is projection, not a flat head.
    for (const cut of CUTS) {
      for (const rad of COMPASS) {
        const { aspect } = outline(survey(facing(rad, cut)).pts);
        expect(aspect, `facing ${rad}, cut ${cut}`).toBeGreaterThan(1.1);
      }
    }
  });

  it('lies along the way the body is facing', () => {
    // The claim the round is actually making. An ellipsoid has an axis and not
    // a direction, so this compares undirected lines: the head names which way
    // the body is pointed to within a few degrees, and it is the same answer
    // from in front and from behind.
    for (const cut of CUTS) {
      for (const rad of COMPASS) {
        const { angle } = outline(survey(facing(rad, cut)).pts);
        expect(axisGap(angle, forwardAngle(rad)), `facing ${rad}, cut ${cut}`).toBeLessThan(10);
      }
    }
  });

  it('was measured with an instrument that can tell a circle from an egg', () => {
    // The guard on the other two. A metric that reads every shape as elongated
    // proves nothing about the head, so it is shown failing on a sphere of the
    // head's own size, at the same sampling.
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 10));
    ball.name = 'head';
    const group = new THREE.Group();
    group.add(ball);
    group.updateMatrixWorld(true);
    const fake = { group } as unknown as View;
    const { aspect } = outline(survey(fake).pts);
    expect(aspect).toBeLessThan(1.05);
  });

  it('keeps the hair outside the skin at every vertex', () => {
    // `makeHair` claims every vertex of the shell is outside the skull so that
    // nothing is coplanar with the skin. The skull and the shell are now two
    // ellipsoids rather than two spheres, and two ellipsoids can be scaled apart
    // on one axis and into each other on another without anyone noticing until a
    // frame shows a scalp flickering through a fringe.
    let worst = 0;
    for (const cut of CUTS) {
      const view = facing(0, cut);
      const meshes = headMeshes(view);
      const s = semiAxes(meshes.find((m) => m.name === 'head')!);
      const hair = meshes.find((m) => m.name === 'hair')!;
      const hp = hair.geometry.getAttribute('position');
      const local = new THREE.Vector3();
      for (let i = 0; i < hp.count; i += 1) {
        local.fromBufferAttribute(hp, i);
        // Both sit at the head's own origin and in its own frame, so a shell
        // vertex is outside the skin exactly when it is outside the ellipsoid.
        // Measured in that frame and not in the world's: the group carries the
        // body's yaw, and a rotated box is not a set of semi-axes.
        const q = (local.x / s.x) ** 2 + (local.y / s.y) ** 2 + (local.z / s.z) ** 2;
        worst = Math.max(worst, 1 - q);
      }
    }
    expect(worst).toBeLessThanOrEqual(0);
  });

  it('leaves the eye set in the face rather than standing off it', () => {
    // The file tuned this by hand once already: at 0.022 of radius the bead
    // stood 26 mm proud and a head read as a face pressed against glass, and
    // 0.016 was chosen because it stands 20. Moving the eye forward to follow a
    // longer skull is exactly the change that can quietly undo that.
    const view = facing(0, 0);
    const meshes = headMeshes(view);
    const s = semiAxes(meshes.find((m) => m.name === 'head')!);
    const eye = meshes.find((m) => m.name === 'eye')!;
    const c = eye.position;
    const r = semiAxes(eye).x;
    // How far the outermost point of the bead stands off the skin: the length
    // of its centre, less where the skull's surface is along that same
    // direction, plus its own radius.
    const len = c.length();
    const u = c.clone().divideScalar(len);
    const t = 1 / Math.sqrt((u.x / s.x) ** 2 + (u.y / s.y) ** 2 + (u.z / s.z) ** 2);
    expect(len - t + r).toBeGreaterThan(0.015);
    expect(len - t + r).toBeLessThan(0.025);
  });
});
