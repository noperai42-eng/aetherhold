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
import { BUILD_MENU } from '../sim/buildings';
import { addBuilding } from '../sim/world';
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
 * One of every building the colony can put up, standing in the bench's world.
 *
 * The bench reads a model's colour off a real instance of it, because the
 * colour is not written down anywhere — it is a hash of the cell the thing
 * stands on. A pool with nothing in it this run never had a tint written, so a
 * building whose pool is empty comes out of `prototypes` wearing the near-white
 * its material waits to be multiplied by. `assemble` says the same thing about
 * the export and calls it a borrowed colour. The fix is the same one the
 * exporter uses: stand one of everything up before reading anything off it.
 *
 * Powered, for the exporter's reason as well — `tint` dulls an electrical
 * building that is not drawing, and a lamp on the bench at 55% of its colour
 * reads as a design decision rather than as a colony with no generator running.
 *
 * A lattice three cells apart, inset three from the edge, scanned in order, each
 * kind taking the first cell that will have it. Three apart because these are
 * drawn with contact shadows and a shadow is cast onto whatever is beside it;
 * inset because the occlusion bake reads a cell's neighbours and a cell on the
 * edge of the map has fewer of them than any cell the game will ever draw.
 *
 * Not the exporter's spiral, though it is the exporter's reasoning: `populate()`
 * lives in a file that imports `node:fs`, so a browser bundle cannot have it.
 *
 * `addBuilding` refuses a cell that is out of bounds or already occupied and
 * says so by returning null, so the scan simply moves on. It throws rather than
 * returning quietly if it runs out, because a bench that stood twenty-six of the
 * menu's twenty-seven kinds would draw the last one in a borrowed white and look
 * like a design decision. On the bench's 192-cell map the lattice has nearly
 * four thousand cells and there are twenty-seven things to put on it.
 */
export function standBuildings(world: World): void {
  const step = 3;
  const span = Math.floor((world.width - 2 * step) / step);
  const cells = span * Math.floor((world.height - 2 * step) / step);
  let at = 0;
  for (const kind of BUILD_MENU) {
    let stood = false;
    for (; at < cells && !stood; at++) {
      const x = step + (at % span) * step;
      const y = step + Math.floor(at / span) * step;
      const b = addBuilding(world, kind, x, y, true);
      if (b) {
        // Drawn as finished and drawing power, which is what a model of it is.
        b.powered = true;
        stood = true;
      }
    }
    if (!stood) throw new Error(`no open cell left to stand a ${kind} on`);
  }
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
 * Which seeds the grid button asks for, starting from the one in the box.
 *
 * It starts there and not at zero because the whole use of the grid is a before
 * and after: drag a slider, press it again, and the twelve in the second frame
 * have to be the same twelve as in the first. That was written for a seed field
 * a thousand wide, where counting up twelve from wherever you are is always
 * still a seed. Four of the seven benches do not have a field like that — the
 * stack's kind, the herd's species, the settler's pose and the building's kind
 * are each an index into a list, and counting up off the end of a list is not a
 * seed, it is a hole.
 *
 * It had been one, for as long as the settler bench has existed: its default
 * pose is `walking`, which is index 1 of eight, so its own Generate 8 asked for
 * poses 1 through 8 and there is no pose 8. `SETTLER_POSES[k.pose!]!` handed the
 * builder `undefined` and the exclamation mark is what kept anyone from hearing
 * about it — every settler sheet in the round notes has one body in it posed by
 * a value that is not in the list. The buildings only made a noise about it
 * because their bench throws by name instead of asserting.
 *
 * So the run wraps inside the field's own range. On a thousand-wide seed that is
 * the same run it always was; on a list it is the whole list, from wherever you
 * happen to be standing in it.
 */
export function gridSeeds(bench: Bench, first: number): number[] {
  const f = bench.fields.find((f) => f.key === bench.seedKey);
  const n = bench.grid ?? 12;
  const run = Array.from({ length: n }, (_, i) => first + i * bench.seedStep);
  if (!f) return run;
  // Inclusive of both ends, so a field 0..7 stepping by one has eight values in
  // it and not seven. Modular on the value rather than on a lattice index,
  // because a seed does not have to sit on the lattice: the stone bench's
  // default is 3.7 and its run is 3.7 to 14.7, which this has to leave alone.
  //
  // The negative branch is taken only when it is needed, and that is not
  // fastidiousness. The usual way to write a positive remainder is
  // `((v % w) + w) % w`, and it is wrong here: `((3.7 % 1000) + 1000) % 1000` is
  // 3.7000000000000455, because 1003.7 is not a float. Forty-five femtoseeds is
  // nothing until it goes through a hash, and the stone bench's twelve are
  // twelve draws from one — the first sweep with this in it came back with a
  // whole grid of stones subtly reshaded, which is how this was found.
  const width = f.max - f.min + bench.seedStep;
  return run.map((v) => {
    const m = (v - f.min) % width;
    return f.min + (m < 0 ? m + width : m);
  });
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
