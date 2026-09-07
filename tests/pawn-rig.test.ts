/**
 * The settler rig, driven the way `App` drives it.
 *
 * `pawns.ts` is two thousand lines and had no test file at all, which is how a
 * field the simulation has always carried — `carryingItemId` — could go from the
 * first colonist to now without anything ever drawing it. These go through
 * `PawnsView` rather than at the rig class, because `PawnsView` is what the game
 * holds and the rig is private to it: a test that reached past it could pass
 * while the view never built the body at all.
 */

import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import { PawnsView } from '../src/client/render/pawns';
import { SETTLER_NECK } from '../src/client/render/head-aim';
import { createWorld } from '../src/sim/worldgen';
import type { Job, Pawn, World } from '../src/sim/types';

const SEED = 20260907;

/** One colonist on a real map, so `standHeight` has ground to answer with. */
function solo(): { world: World; pawn: Pawn; view: PawnsView } {
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
  return { world, pawn, view: new PawnsView() };
}

/** Advance the view the way a frame does: one tick, then `frames` of wall time. */
function run(view: PawnsView, world: World, frames = 1, dt = 1 / 60): void {
  view.onTick(world);
  for (let i = 0; i < frames; i += 1) view.sync(world, 1, null, dt);
  view.group.updateMatrixWorld(true);
}

function named(view: PawnsView, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  view.group.traverse((o) => {
    if (o.name === name) out.push(o as THREE.Mesh);
  });
  return out;
}

/** The four swinging limbs, told apart by which side of the body they hang on. */
function limbs(view: PawnsView): { legL: THREE.Mesh; legR: THREE.Mesh; armL: THREE.Mesh; armR: THREE.Mesh } {
  const legs = named(view, 'leg');
  const arms = named(view, 'arm');
  return {
    armL: arms.find((m) => m.position.x < 0)!,
    armR: arms.find((m) => m.position.x > 0)!,
    legL: legs.find((m) => m.position.x < 0)!,
    legR: legs.find((m) => m.position.x > 0)!,
  };
}

function head(view: PawnsView): THREE.Mesh {
  return named(view, 'head')[0]!;
}

/**
 * Whether a part actually reaches the frame. A weapon is a group parented to
 * the arm, so hiding it leaves the child mesh's own flag true and only the
 * walk up the parents tells the truth about what is drawn.
 */
function shown(o: THREE.Object3D | null): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return o !== null;
}

/** How far off a direction is from pointing at a target, in radians. */
function offBy(from: THREE.Vector3, dir: THREE.Vector3, target: THREE.Vector3): number {
  return dir.angleTo(target.clone().sub(from).normalize());
}

let rig: ReturnType<typeof solo>;
beforeEach(() => {
  rig = solo();
});

// --- functional

describe('the two layers a settler is posed in', () => {
  it('keeps every pose it had before the legs and arms were split apart', () => {
    // The refactor's whole promise. These are the numbers the single pose table
    // wrote, restated here rather than derived, so that moving one in `pawns.ts`
    // fails this instead of quietly changing how the colony looks.
    const { world, pawn, view } = rig;

    pawn.activity = 'working';
    pawn.animPhase = 0;
    run(view, world);
    expect(limbs(view).legL.rotation.x).toBeCloseTo(0.05, 6);
    expect(limbs(view).legR.rotation.x).toBeCloseTo(-0.05, 6);

    pawn.activity = 'relaxing';
    run(view, world);
    expect(limbs(view).legL.rotation.x).toBeCloseTo(0.3, 6);
    expect(limbs(view).armL.rotation.x).toBeCloseTo(-0.5, 6);
    expect(limbs(view).armR.rotation.x).toBeCloseTo(-0.5, 6);

    pawn.activity = 'eating';
    pawn.animPhase = 0;
    run(view, world);
    expect(limbs(view).legL.rotation.x).toBeCloseTo(0.35, 6);
    // The two arms differ: one hand is bringing food up, the other is not.
    expect(limbs(view).armL.rotation.x).toBeCloseTo(-1.5, 6);
    expect(limbs(view).armR.rotation.x).toBeCloseTo(-0.6, 6);

    pawn.activity = 'fighting';
    pawn.attackCooldown = 0;
    run(view, world);
    expect(limbs(view).legL.rotation.x).toBeCloseTo(0.12, 6);
    expect(limbs(view).armL.rotation.x).toBeCloseTo(-1.42, 6);
  });

  it('swings the arms against the legs at three quarters, when the hands are free', () => {
    // The relationship rather than the number, because it is the relationship
    // that makes a walk read as a walk: arms and legs on opposite diagonals.
    const { world, pawn, view } = rig;
    pawn.activity = 'walking';
    pawn.animPhase = 1.7;
    run(view, world);
    const l = limbs(view);
    expect(l.legR.rotation.x).toBeCloseTo(-l.legL.rotation.x, 6);
    expect(l.armL.rotation.x).toBeCloseTo(-l.legL.rotation.x * 0.75, 6);
    expect(l.armR.rotation.x).toBeCloseTo(-l.armL.rotation.x, 6);
    expect(Math.abs(l.legL.rotation.x)).toBeGreaterThan(0.01);
  });
});

describe('a settler with their hands full', () => {
  it('shows the load, which nothing had ever drawn', () => {
    // `carryingItemId` is as old as the pawn and this is the first thing to read
    // it. Empty-handed first, so the assertion cannot pass on a mesh that is
    // simply always visible.
    const { world, pawn, view } = rig;
    run(view, world);
    expect(named(view, 'load')[0]!.visible).toBe(false);

    pawn.carryingItemId = 7;
    run(view, world);
    expect(named(view, 'load')[0]!.visible).toBe(true);
  });

  it('walks and carries at the same time, which it could not do before', () => {
    // The composition the split exists for. The legs must still be walking —
    // two phases apart give two different strides — while both arms hold the
    // load instead of counter-swinging.
    const { world, pawn, view } = rig;
    pawn.activity = 'walking';
    pawn.carryingItemId = 7;

    pawn.animPhase = 1.7;
    run(view, world);
    const first = limbs(view).legL.rotation.x;
    const armsA = [limbs(view).armL.rotation.x, limbs(view).armR.rotation.x];

    pawn.animPhase = 3.4;
    run(view, world);
    const second = limbs(view).legL.rotation.x;

    expect(first, 'the legs stopped walking when the hands filled').not.toBeCloseTo(second, 3);
    expect(armsA[0]).toBeCloseTo(armsA[1]!, 6);
    expect(armsA[0]).toBeLessThan(-1);
  });

  it('does not raise empty arms around a settler being carried', () => {
    // A rescuer holds a body the way a hauler holds a crate, and the first
    // version posed them alike. The frames refused it: with no body mesh to
    // hand the arms, a colonist crossing the map with both arms up around
    // nothing reads as surrender, which is a worse thing to say than the
    // ordinary walk it replaced. Neither a crate -- that would be a lie about
    // what is being carried off the field -- nor an empty hold.
    const { world, pawn, view } = rig;
    pawn.carryingPawnId = 42;
    pawn.activity = 'walking';
    pawn.animPhase = 1.7;
    run(view, world);
    expect(named(view, 'load')[0]!.visible).toBe(false);
    expect(limbs(view).armL.rotation.x).toBeGreaterThan(-1);
  });

  it('takes the rifle out of the hands that are holding a crate', () => {
    // The weapon rides the right hand, so the carry pose raised it too: the
    // first frames of this change had a shotgun standing vertically out of the
    // fist of a settler holding a crate to their chest.
    const { world, pawn, view } = rig;
    pawn.weapon = 'rifle';
    pawn.carryingItemId = 11;
    run(view, world);
    expect(named(view, 'stock').length, 'fixture pawn must actually be armed').toBe(1);
    expect(shown(named(view, 'stock')[0]!)).toBe(false);
  });

  it('gives the rifle back when the hands come free', () => {
    const { world, pawn, view } = rig;
    pawn.weapon = 'rifle';
    pawn.carryingItemId = 11;
    run(view, world);
    pawn.carryingItemId = null;
    world.tick += 1;
    run(view, world);
    expect(shown(named(view, 'stock')[0]!)).toBe(true);
  });

  it('gives the rifle back to a carrier who is knocked down', () => {
    // Down means the arms drop to the sides, so the reason to hide the weapon
    // is gone even though the pawn is still flagged as carrying.
    const { world, pawn, view } = rig;
    pawn.weapon = 'rifle';
    pawn.carryingItemId = 11;
    run(view, world);
    pawn.downed = true;
    world.tick += 1;
    run(view, world);
    expect(shown(named(view, 'load')[0]!)).toBe(false);
    expect(shown(named(view, 'stock')[0]!)).toBe(true);
  });

  it('drops the load when the body goes down', () => {
    const { world, pawn, view } = rig;
    pawn.carryingItemId = 7;
    pawn.downed = true;
    run(view, world);
    expect(named(view, 'load')[0]!.visible).toBe(false);
  });
});

// --- experience

describe('a settler looking at what they are doing', () => {
  function jobAt(world: World, pawn: Pawn, tx: number, ty: number): void {
    const job: Job = { age: 0, id: 1, kind: 'build', pawnId: pawn.id, progress: 0, stage: 'work', tx, ty };
    world.jobs = [job];
    pawn.jobId = 1;
    world.tick += 1;
  }

  it('turns its head toward the job, not just its body', () => {
    // The whole point, measured the way a player would see it: is the face
    // pointed more at the work than the shoulders are? Comparing the head's own
    // direction against the body's says that without knowing which axis or
    // which sign carries it.
    const { world, pawn, view } = rig;
    pawn.activity = 'idle';
    pawn.facing = 0;
    jobAt(world, pawn, Math.round(pawn.x) + 3, Math.round(pawn.y) + 2);
    run(view, world, 60);

    const h = head(view);
    const from = h.getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(world.jobs[0]!.tx, from.y, world.jobs[0]!.ty);
    const bodyDir = view.group.children[0]!.getWorldDirection(new THREE.Vector3());
    const headDir = h.getWorldDirection(new THREE.Vector3());

    expect(offBy(from, headDir, target)).toBeLessThan(offBy(from, bodyDir, target));
  });

  it('gets there over several frames rather than snapping round', () => {
    // A head that arrives in one frame is a turret. One sixtieth of a second
    // has to leave it visibly on the way.
    const { world, pawn, view } = rig;
    pawn.activity = 'idle';
    pawn.facing = 0;
    jobAt(world, pawn, Math.round(pawn.x) + 3, Math.round(pawn.y) + 2);

    run(view, world, 1);
    const early = Math.abs(head(view).rotation.y);
    run(view, world, 60);
    const settled = Math.abs(head(view).rotation.y);

    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(settled * 0.8);
  });

  it('will not look behind itself for something its neck cannot reach', () => {
    // Dropped rather than clamped: a head held hard against its stop, pointing
    // as near as it can get to something at its back, reads as a broken model.
    const { world, pawn, view } = rig;
    pawn.activity = 'idle';
    pawn.facing = 0;
    // `facing` 0 is +X, so a job well behind on -X is outside the neck entirely.
    jobAt(world, pawn, Math.round(pawn.x) - 6, Math.round(pawn.y));
    run(view, world, 60);
    expect(Math.abs(head(view).rotation.y)).toBeLessThan(0.05);
  });

  it('never turns further than a neck goes, whatever it is given', () => {
    const { world, pawn, view } = rig;
    pawn.activity = 'idle';
    pawn.facing = 0;
    // Three of these four are inside the neck and one is not, so the loop
    // covers both the clamp and the drop. The running maximum is what stops
    // this passing on a head that never moved: an upper bound alone is happiest
    // when nothing happens at all.
    let furthest = 0;
    for (const [dx, dy] of [[3, 2], [3, -2], [1, 4], [4, 4]]) {
      jobAt(world, pawn, Math.round(pawn.x) + dx!, Math.round(pawn.y) + dy!);
      run(view, world, 120);
      const turn = Math.abs(head(view).rotation.y);
      expect(turn, `target ${dx},${dy} pushed the neck past its stop`).toBeLessThanOrEqual(
        SETTLER_NECK.yaw + 1e-6,
      );
      furthest = Math.max(furthest, turn);
    }
    expect(furthest, 'no target in this set moved the head at all').toBeGreaterThan(0.3);
  });

  it('faces front again once the job is done', () => {
    // Not frozen at the last angle it was given. A settler who finishes a job
    // and keeps staring at the empty cell has a neck that has seized.
    const { world, pawn, view } = rig;
    pawn.activity = 'idle';
    pawn.facing = 0;
    jobAt(world, pawn, Math.round(pawn.x) + 3, Math.round(pawn.y) + 2);
    run(view, world, 60);
    const turned = Math.abs(head(view).rotation.y);
    expect(turned).toBeGreaterThan(0.1);

    world.jobs = [];
    pawn.jobId = null;
    world.tick += 1;
    run(view, world, 60);
    expect(Math.abs(head(view).rotation.y)).toBeLessThan(0.02);
  });

  it('stops watching a foe who is dead, instead of standing over the body', () => {
    // `targetPawnId` outlives the fight. Without the check this is a colonist
    // transfixed by a corpse until the simulation gets round to clearing it.
    const { world, pawn, view } = rig;
    const foe = { ...pawn, id: pawn.id + 900, x: pawn.x + 3, y: pawn.y + 2, dead: false } as Pawn;
    world.pawns = [pawn, foe];
    pawn.activity = 'idle';
    pawn.facing = 0;
    pawn.targetPawnId = foe.id;
    world.tick += 1;
    run(view, world, 60);
    expect(Math.abs(head(view).rotation.y)).toBeGreaterThan(0.1);

    foe.dead = true;
    world.tick += 1;
    run(view, world, 60);
    expect(Math.abs(head(view).rotation.y)).toBeLessThan(0.02);
  });

  it('lays a fallen settler down with their head straight', () => {
    const { world, pawn, view } = rig;
    pawn.activity = 'idle';
    pawn.facing = 0;
    jobAt(world, pawn, Math.round(pawn.x) + 3, Math.round(pawn.y) + 2);
    run(view, world, 60);
    expect(Math.abs(head(view).rotation.y)).toBeGreaterThan(0.1);

    pawn.dead = true;
    run(view, world, 1);
    expect(head(view).rotation.y).toBe(0);
    expect(head(view).rotation.x).toBe(0);
  });
});
