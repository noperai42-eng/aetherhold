/**
 * The bench's back half: the fixture it stands things on, the renderer's own
 * prototypes, and one call that refuses to build a recipe it has complaints
 * about.
 *
 * Validation lives on this side rather than inside the geometry builders, which
 * is the shape Evergrow's forge has and it is worth saying why it is right. The
 * builders are called forty times a frame by the colony with numbers that came
 * out of `TREE_DEFAULT`, and a bounds check on every one of those is a cost paid
 * for a mistake that cannot happen. The bench is the only place a made-up number
 * arrives, so the bench is where the check belongs.
 */

import * as THREE from 'three';

import { BuildingsView } from '../client/render/buildings';
import { assemble } from '../tools/assemble';
import { createWorld } from '../sim/worldgen';
import { TICKS_PER_DAY, type World } from '../sim/types';
import type { Bench, Knobs, Prototypes } from './recipes';

/**
 * The colony the bench borrows its light and its materials from.
 *
 * The same seed the look harness and the `.glb` export use, so a bench tree is
 * the tree in the frames already on disk. The clock is set to noon and the
 * weather to a clear sky, both because a bench frame has to be the same frame
 * every load and because `scripts/look/zoo.mjs` photographs the wood at midday —
 * a forge frame and a zoo frame are meant to differ by the camera and the ground
 * they stand on, and nothing else.
 */
export function benchWorld(seed = 4242): World {
  const world = createWorld(seed);
  world.tick = Math.round(TICKS_PER_DAY * 0.5);
  world.weather = { kind: 'clear', ticksLeft: TICKS_PER_DAY, blend: 0, strikeTick: -1 };
  return world;
}

/**
 * Every pooled prototype the renderer built, keyed the way the renderer keys it.
 *
 * Found rather than listed: `assemble` walks the view for instanced meshes with
 * a named geometry and hands back the material the pool actually draws with,
 * multiplied by the tint the first instance was given. That is the whole reason
 * a bench tree is the right green — the green is not written down anywhere, it
 * is a hash of the cell a tree stands on, and this reads it off a real one.
 */
export function prototypes(world: World, view: BuildingsView): Prototypes {
  const out = new Map<string, THREE.Mesh>();
  view.sync(world);
  // Drained here for the reason the exporter drains it: there is no idle time
  // on a page that renders once, and an unbaked prototype is a model with no
  // contact shadow in it.
  view.bakeOcclusion();
  for (const a of assemble(view.group)) {
    for (const child of a.group.children) {
      const m = child as THREE.Mesh;
      if (m.isMesh) out.set(m.name, m);
    }
  }
  return out;
}

export interface Forged {
  /** Null when `problems` is not empty: a recipe with a fault is not built. */
  group: THREE.Group | null;
  problems: string[];
}

/** One model, or the list of reasons there is not one. */
export function forge(bench: Bench, k: Knobs, protos: Prototypes): Forged {
  const problems = bench.problems(k);
  if (problems.length) return { group: null, problems };
  return { group: bench.build(k, protos), problems };
}

/**
 * The same recipe under a run of seeds — twelve of them, on the button that
 * makes the bench worth having.
 *
 * One bad recipe is twelve identical complaints, so it is reported once: what a
 * seed changes is which lump you get, never whether the recipe is buildable.
 */
export function forgeSeeds(bench: Bench, k: Knobs, seeds: readonly number[], protos: Prototypes): Forged[] {
  const problems = bench.problems({ ...k, [bench.seedKey]: seeds[0] ?? 0 });
  if (problems.length) return [{ group: null, problems }];
  return seeds.map((s) => ({ group: bench.build({ ...k, [bench.seedKey]: s }, protos), problems: [] }));
}
