/**
 * The settler as an FFXI Hume, r35.
 *
 * What the round claims about the body, held as numbers so a later tweak that
 * slides back to the old stubby figure fails here rather than a round later in
 * the frames: seven heads tall, shoulders over a narrower waist, limbs that
 * taper from thigh to ankle and upper arm to wrist, and a bandolier that lies
 * on the tunic rather than inside it. Then the kit on the colony: every
 * settler the game builds wears the whole of it.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { HEAD_SCALE, PawnsView, assembleSettler, settlerGeometry } from '../src/client/render/pawns';
import { createWorld } from '../src/sim/worldgen';

const SEED = 20260907;

/** Widest |x| on each ring of a lathe, keyed by the ring's height. */
function ringWidths(g: THREE.BufferGeometry): [number, number][] {
  const pos = g.getAttribute('position');
  const rings = new Map<number, number>();
  for (let i = 0; i < pos.count; i++) {
    const y = Math.round(pos.getY(i) * 1000) / 1000;
    rings.set(y, Math.max(rings.get(y) ?? 0, Math.abs(pos.getX(i))));
  }
  return [...rings].sort((a, b) => a[0] - b[0]);
}

/** The widest ring between fractions a and b of the way down a limb (0 the top, 1 the far end). */
function widest(g: THREE.BufferGeometry, a: number, b: number): number {
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const at = (t: number) => box.max.y + (box.min.y - box.max.y) * t;
  return Math.max(...ringWidths(g).filter(([y]) => y <= at(a) && y >= at(b)).map(([, w]) => w));
}

describe('the settler as a Hume', () => {
  const geo = settlerGeometry();

  it('stands about seven heads tall — the Hume’s proportion; a bigger head or shorter legs is the stubby figure again', () => {
    const parts = assembleSettler('colony', 0, 'none', geo);
    parts.group.updateMatrixWorld(true);
    const body = new THREE.Box3().setFromObject(parts.group, true);
    geo.head.computeBoundingBox();
    const skull = geo.head.boundingBox!;
    const heads = body.max.y / ((skull.max.y - skull.min.y) * HEAD_SCALE);
    expect(body.min.y).toBeCloseTo(0, 3);
    expect(heads).toBeGreaterThan(6.6);
    expect(heads).toBeLessThan(7.3);
  });

  it('carries its shoulders over a narrower waist', () => {
    const rings = ringWidths(geo.torso);
    const top = rings.slice(Math.floor(rings.length * 0.7));
    const middle = rings.slice(Math.floor(rings.length * 0.2), Math.floor(rings.length * 0.6));
    const shoulders = Math.max(...top.map(([, w]) => w));
    const waist = Math.min(...middle.map(([, w]) => w));
    expect(shoulders / waist).toBeGreaterThan(1.25);
  });

  it('tapers every limb toward its far end — a straight tube was the stubby figure', () => {
    // Thigh at the hip is broader than the knee; the calf swells and the ankle
    // narrows; the upper arm is broader than the wrist. The spans stop short of
    // the round caps, whose rings close to nothing.
    expect(widest(geo.leg, 0.05, 0.35)).toBeGreaterThan(widest(geo.leg, 0.8, 0.9) * 1.2);
    expect(widest(geo.shin, 0.1, 0.4)).toBeGreaterThan(widest(geo.shin, 0.8, 0.9) * 1.2);
    expect(widest(geo.arm, 0.05, 0.35)).toBeGreaterThan(widest(geo.arm, 0.8, 0.9) * 1.1);
    expect(widest(geo.forearm, 0.1, 0.4)).toBeGreaterThan(widest(geo.forearm, 0.8, 0.9) * 1.1);
    // And the thigh is the heaviest of them.
    expect(widest(geo.leg, 0.05, 0.35)).toBeGreaterThan(widest(geo.shin, 0.1, 0.4));
    expect(widest(geo.leg, 0.05, 0.35)).toBeGreaterThan(widest(geo.arm, 0.05, 0.35));
  });

  it('lays the bandolier on the tunic, never inside it — the chest swell broke through it once', () => {
    const torso = new THREE.Mesh(geo.torso, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    torso.updateMatrixWorld(true);
    const pos = geo.strap.getAttribute('position');
    const ray = new THREE.Raycaster();
    const v = new THREE.Vector3();
    let inside = 0;
    let checked = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const out = new THREE.Vector3(v.x, 0, v.z);
      const reach = out.length();
      if (reach < 1e-3) continue;
      ray.set(new THREE.Vector3(0, v.y, 0), out.normalize());
      const hit = ray.intersectObject(torso)[0];
      if (!hit) continue;
      checked++;
      if (hit.distance > reach - 0.002) inside++;
    }
    expect(checked).toBeGreaterThan(pos.count / 2);
    expect(inside).toBe(0);
  });

  it('dresses every settler in the colony in the whole kit', () => {
    const world = createWorld(SEED);
    const view = new PawnsView();
    view.onTick(world);
    view.sync(world, 0, null, 0);
    const want: Record<string, number> = { pauldron: 2, bracer: 2, bootShaft: 2, collar: 1, hemTrim: 1, buckle: 1, pouch: 1, strap: 1 };
    let settlers = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal) continue;
      settlers++;
      const count: Record<string, number> = {};
      rig.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name in want && o.visible) count[o.name] = (count[o.name] ?? 0) + 1;
      });
      expect(count, `settler ${pawn.id}`).toEqual(want);
    }
    expect(settlers).toBeGreaterThan(0);
    view.dispose();
  });
});
