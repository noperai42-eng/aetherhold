/**
 * World generation. Hand-shaped where it counts and proportional everywhere else:
 * a clearing with a rock ridge, woods, and a starter cabin you can walk into on
 * the first frame.
 *
 * The map used to be 64×64 with the cabin nailed to cells 25–37, which meant the
 * size was a constant in name only — raising it would have left the colony sitting
 * in a corner with its beds, stove, stockpile and settlers all still clustered
 * around cell 32. Everything hand-placed now hangs off `HOME_X`/`HOME_Y`, and
 * everything scattered scales with the area, so the size really is one number.
 *
 * A gorgeous small base still beats a huge empty map, so growth is spent on
 * distance rather than dilution: the yard, the garden and the first ring of ore
 * are exactly where they were, and the new ground goes underneath the far ore and
 * the far sites — the stuff you have to actually walk to.
 */

import { Rng } from './rng';
import { scatterBushes } from './berries';
import { CROP_NONE } from './farming';
import { DIFFICULTIES } from './difficulty';
import { buildingAt, isWalkable } from './grid';
import { findPath } from './path';
import { makeWeather } from './weather';
import { makeResearch } from './research';
import type { Difficulty, ResourceKind, Site, SiteKind, SkillName, Terrain, World } from './types';
import { SAVE_VERSION, TERRAIN_LIST, TICKS_PER_DAY, packCell } from './types';
import { FAMILY_NAMES, GIVEN_NAMES, makePawn } from './pawn';
import { remember } from './lifelog';
import { spawnInitialFauna } from './wildlife';
import { addBuilding, addCellToZone, addItem, addZone, msg, nextId, removeBuilding } from './world';

// Re-exported: `makePawn` lived here for most of the project's life and half the
// tests and spawners still ask worldgen for it.
export { makePawn } from './pawn';

/**
 * The valley, in cells. 64 once, then 96, then 128, now 192 — thirty-seven
 * thousand cells, and the first size chosen for the animals rather than the
 * settlers.
 *
 * Everything hand-placed in this file is an offset from the hearth and everything
 * generated is a fraction of `MAP_R`, so growing this number adds frontier at the
 * rim rather than moving the homestead's furniture: the near ore ring is still six
 * seams at a fourteen-cell walk, the cabin is still the cabin. What the extra
 * ground buys is distance — somewhere to send a scout that is genuinely away, and
 * room for a food chain to have parts of it you are not standing in. `wildlife.ts`
 * reads its carrying capacity off the area, so this is also the line that says how
 * many animals the moor holds: fifty-six here against twenty-five at 128, and
 * three hundred and thirty-eight bramblebushes against a hundred and thirty-nine.
 *
 * Not free, and it used to be much less free. Every per-cell sweep — regions,
 * rooms, connectivity, the fog — is 2.25× the work it was at 128, and `path.ts`
 * scales its expansion budget off this. Two things had to be fixed before this
 * number could move at all: A* now refuses a search the region index already
 * knows is hopeless (`worthSearching`), and the region and room indexes rebuild
 * when the ground changes rather than once a second whether it did or not
 * (`terrainRev`). Between them a valley this size costs less per day than the old
 * one did. Raising it again is still a performance decision as much as a design
 * one — measure `src/eval/ecosystem.ts` before and after.
 */
export const MAP_W = 192;
export const MAP_H = 192;

/**
 * Where the colony sits. Every hand-placed cell in this file is an offset from
 * here, so the map can grow around the homestead instead of stranding it.
 *
 * Exported because tests need it for the same reason worldgen does. A test that
 * says `addItem(world, 'steel', 20, 36, 35)` is really saying "just outside the
 * stockpile", and it only reads as a stockpile cell while the map is 64 wide —
 * thirty of them broke the first time this number moved. `HOME_X + 4` says the
 * thing the test actually means, and survives the next map that grows.
 */
export const HOME_X = Math.floor(MAP_W / 2);
export const HOME_Y = Math.floor(MAP_H / 2);

/** The map's own radius, in cells, from the hearth to the nearest border. */
const MAP_R = Math.min(MAP_W, MAP_H) / 2;

/** How much of the map is kept clear of noise-generated rock. 54 cells at 192×192. */
const OPEN_RADIUS = MAP_R * 0.5625;

function terrainIdx(t: Terrain): number {
  return TERRAIN_LIST.indexOf(t);
}

/** Cheap value-noise: smooth enough for terrain blotches, no dependencies. */
function noise2(rng: Rng, w: number, h: number, scale: number): Float32Array {
  const gw = Math.ceil(w / scale) + 2;
  const gh = Math.ceil(h / scale) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const out = new Float32Array(w * h);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / scale;
      const gy = y / scale;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      const a = grid[y0 * gw + x0]!;
      const b = grid[y0 * gw + x0 + 1]!;
      const c = grid[(y0 + 1) * gw + x0]!;
      const d = grid[(y0 + 1) * gw + x0 + 1]!;
      out[y * w + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

/**
 * Fill from the hearth and mark everything the colony can walk to.
 *
 * Four-way on purpose. The pathfinder takes diagonals, so this undercounts what
 * is really reachable — but it undercounts identically before and after, and
 * erring towards "that looks stranded" only ever costs the lake a retry.
 *
 * It starts from the first open ground *beside* the hearth rather than on it: by
 * the time this runs the cabin is built, and the middle of the cabin is as likely
 * to be a stove as it is to be floor.
 */
function reachableCells(world: World, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(MAP_W * MAP_H);
  const stack: number[] = [];
  for (let r = 0; r < 8 && stack.length === 0; r++) {
    for (let dy = -r; dy <= r && stack.length === 0; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H || !isWalkable(world, x, y)) continue;
        seen[y * MAP_W + x] = 1;
        stack.push(y * MAP_W + x);
        break;
      }
    }
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % MAP_W;
    const y = (i - x) / MAP_W;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const j = ny * MAP_W + nx;
      if (seen[j] === 1 || !isWalkable(world, nx, ny)) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

/**
 * The dry ground the colony can no longer walk to.
 *
 * Cells that went under water are not in the list — those did not get cut off,
 * they got drowned, and you can see they are a lake. A count would have been
 * shorter than a cell-by-cell sweep and would have been wrong: the lake fells
 * the woods it floods, and a felled tree *adds* reachable cells, so the
 * arithmetic of "before minus drowned" stops holding the moment the axe comes
 * out. Sweeping holds either way.
 *
 * This used to answer yes/no. It hands back the cells instead because the
 * caller has something to do with them — see `carveLake`, which fills them in.
 */
function strandedBy(world: World, before: Uint8Array, after: Uint8Array): number[] {
  const lost: number[] = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === 1 && after[i] !== 1 && TERRAIN_LIST[world.terrain[i]!] !== 'water') lost.push(i);
  }
  return lost;
}

/**
 * How much ground a lake is allowed to strand before it counts as a border.
 *
 * A hundred and twenty cells is a third of a percent of the moor: a bay behind
 * a headland, a shelf the water went round. Past that it is not a pocket, it is
 * a quarter of the map with a lake between you and it, and no amount of filling
 * makes that a good place to land a colony.
 */
const MAROON_MAX = 120;

/**
 * Rock in any of the eight neighbours.
 *
 * The diagonals count, and that is the whole reason this function exists rather
 * than being an inline orthogonal check. Two cells that touch only at a corner
 * still *share* that corner in the terrain mesh, and the renderer sinks the lake
 * bed by averaging the cells around each corner — so a cliff diagonally touching
 * open water would stand on a corner pulled down under its own base, and you
 * would see daylight beneath a boulder. Keeping one cell of ground between the
 * water and every rock costs the lake nothing and means the renderer never has
 * to special-case a shoreline.
 */
function nearRock(world: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (TERRAIN_LIST[world.terrain[ny * MAP_W + nx]!] === 'rock') return true;
    }
  }
  return false;
}

/**
 * Sand where the ground meets the water.
 *
 * A beach ring is the cheapest cue there is that the blue gets shallow at the
 * edge, and it costs the map nothing that was not already true: sand is walkable,
 * it is already dearer to cross than grass, and it already refuses to grow trees
 * — so the lake gets an open margin nobody had to write a rule for.
 */
function shoreline(world: World, painted: number[]): number[] {
  const sand = terrainIdx('sand');
  const beach: number[] = [];
  for (const i of painted) {
    const x = i % MAP_W;
    const y = (i - x) / MAP_W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= MAP_W - 1 || ny >= MAP_H - 1) continue;
        const j = ny * MAP_W + nx;
        const t = TERRAIN_LIST[world.terrain[j]!];
        if (t !== 'grass' && t !== 'dirt') continue;
        world.terrain[j] = sand;
        beach.push(j);
      }
    }
  }
  return beach;
}

/** Take down a tree standing where the lake now is, if one is. */
function clearTree(world: World, i: number): void {
  const x = i % MAP_W;
  const y = (i - x) / MAP_W;
  const b = buildingAt(world, x, y);
  if (b !== null && b.kind === 'tree') removeBuilding(world, b);
}

/**
 * A lake, and why the map went this long without one.
 *
 * `water` has been a terrain kind since the first commit — solid, unbuildable,
 * cleared out of the way by the ore lanes, declined by snow, refused by the
 * steward — and nothing ever painted a single cell of it. Every consumer was
 * already written for it, which is the only reason this is a page of worldgen
 * rather than a change to the sim.
 *
 * Three decisions worth stating.
 *
 * **Its own stream, and last in the queue.** The lake draws from an `Rng` seeded
 * off the map seed rather than from the shared `rng` this file spends everywhere
 * else — but that alone was not enough, and finding out why is the interesting
 * part. Run in the middle of the file, the lake spent no rolls of the shared
 * stream and still moved every seed in the game: it turns grass into water, the
 * tree pass rolls `chance(0.5)` once *per grass cell*, so a few hundred fewer
 * grass cells is a few hundred fewer draws and every decision after it lands
 * somewhere else. A private stream stops a pass taking rolls; it does nothing
 * about a pass changing how many rolls somebody downstream takes. So the lake
 * runs after the last consumer of `rng` instead, and now the claim really holds:
 * every tree, ore blob, site and settler on every seed is exactly where it was,
 * and the only thing that moved is the ground the lake covers.
 *
 * **It arrives after the map is furnished, so it has to clean up.** Running last
 * means running into standing woods and finished errands. Trees under the water
 * and on the new beach are felled — sand grows nothing, and a trunk in the lake
 * is the kind of thing you only see in a screenshot. Anything built, and the
 * ground around every scout site, is refused outright rather than cleared: those
 * are places the player is meant to walk to.
 *
 * **It has to prove it costs nothing.** A blob of solid terrain dropped on a map
 * can pin a bay against the rim and quietly strand whatever was inside it, and
 * that failure surfaces days later as a settler who cannot reach the far ore. So
 * the lake is checked rather than trusted: flood-fill from the hearth before,
 * fill again after, and unless the only cells lost are the ones now underwater,
 * the lake is drained and the next site tried. `LAKE_TRIES` attempts, and then
 * the map simply has no lake — which is a fine map, and better than a broken one.
 */
/**
 * How much bigger the lake is than the one tuned on the 96-wide valley.
 *
 * The ellipse radii below are the numbers the lake was balanced with when the
 * map was 96 across, and left flat they would have made the water a pond: the
 * valley nearly doubled and the lake would not have. Scaling by the map radius
 * keeps it the same *fraction* of the ground, which is what "a lake" means from
 * the manager camera — a feature you route around, not a puddle in the corner.
 */
const LAKE_SCALE = MAP_R / 48;

/**
 * Attempts before the map is allowed to have no lake.
 *
 * Six on the 96 map, ten on the 128, twenty-four now — and the order those two
 * numbers moved in matters more than either of them. At 192 one seed in three
 * shipped with no water at all; tripling the tries to thirty took that to one in
 * five, and reading the rejections showed why so little moved: on a dry seed
 * *every* attempt was failing, all thirty, and always on the same check. A knob
 * that turns three times and buys that little is the wrong knob. The fix was in
 * the check (`carveLake` now fills the pockets it strands), and only once a
 * single attempt usually succeeded was the try count worth anything — at which
 * point it is doing its actual job, which is covering the tail. Ten leaves two
 * seeds in two hundred dry. Twenty-four leaves none, and costs 40ms a map.
 */
const LAKE_TRIES = 24;

function carveLake(
  world: World,
  rng: Rng,
  lanes: Set<number>,
  inYard: (x: number, y: number) => boolean,
  homeX: number,
  homeY: number,
): number {
  const wet = terrainIdx('water');
  const before = reachableCells(world, homeX, homeY);

  // The scout sites are the long errands, and each one has to be stood next to
  // to be worked. Keep the water off them and off their doorstep.
  const spoken = new Set<number>();
  for (const site of world.sites) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = site.x + dx;
        const y = site.y + dy;
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
        spoken.add(y * MAP_W + x);
      }
    }
  }

  for (let attempt = 0; attempt < LAKE_TRIES; attempt++) {
    // Out past the yard and the first ring of ore, in past the ridge.
    const angle = rng.next() * Math.PI * 2;
    const away = rng.range(MAP_R * 0.34, MAP_R * 0.52);
    const lx = Math.round(homeX + Math.cos(angle) * away);
    const ly = Math.round(homeY + Math.sin(angle) * away);
    const ex = rng.range(5.5, 9) * LAKE_SCALE;
    const ey = rng.range(5.5, 9) * LAKE_SCALE;
    const wob = noise2(rng, MAP_W, MAP_H, 7);

    const painted: number[] = [];
    const was: number[] = [];
    for (let y = 2; y < MAP_H - 2; y++) {
      for (let x = 2; x < MAP_W - 2; x++) {
        const i = y * MAP_W + x;
        if (lanes.has(i) || inYard(x, y) || spoken.has(i)) continue;
        if (Math.hypot((x - lx) / ex, (y - ly) / ey) > 0.62 + wob[i]! * 0.5) continue;
        if (nearRock(world, x, y)) continue;
        const standing = buildingAt(world, x, y);
        if (standing !== null && standing.kind !== 'tree') continue;
        painted.push(i);
        was.push(world.terrain[i]!);
        world.terrain[i] = wet;
      }
    }

    // The reachability check runs with the woods still standing, which is both the
    // conservative order and the cheap one: felling a tree only ever opens ground,
    // so a lake that costs nothing through a wood costs nothing through a clearing
    // — and an attempt that gets thrown away has nothing to replant.
    const after = reachableCells(world, homeX, homeY);
    const cut = strandedBy(world, before, after);

    // The lake fills the holes it makes.
    //
    // Almost every cell in `cut` is one the lake was *forbidden* to paint — a
    // scout site's doorstep, a mining lane — that the water then flowed around
    // and left as an island. Rejecting the whole attempt over that was the old
    // rule, and on the 192 map it rejected every attempt on one seed in five,
    // because there are seventy-two of those keep-outs and a lake big enough to
    // read as a lake will always brush one. So: drown the pocket instead. The
    // hole was only being kept dry so somebody could stand in it, and nobody can
    // stand somewhere they cannot walk to.
    //
    // What still rejects the attempt is a pocket that costs the colony
    // something it cannot replace — a scout site cut off, a whole quarter of the
    // moor severed. That is the check `onlyLostToWater` was reaching for; it
    // just could not tell a bay from a border.
    let ruined = cut.length > MAROON_MAX;
    for (const site of world.sites) {
      if (after[site.y * MAP_W + site.x] !== 1) ruined = true;
    }
    for (const i of cut) {
      const x = i % MAP_W;
      const y = (i - x) / MAP_W;
      const standing = buildingAt(world, x, y);
      if (standing !== null && standing.kind !== 'tree') ruined = true;
      // A stranded cell touching a cliff cannot be filled and cannot be left.
      // Filling it puts water on a rock's corner, which is the one thing
      // `nearRock` exists to prevent; leaving it dry puts a strip of grass at
      // the water's edge that nobody can ever walk to, and `tests/ice.test.ts`
      // will duly pick it as a bank and find no route to it. Neither is a map
      // worth shipping, so the attempt is spent instead. It costs tries, not
      // lakes: forty seeds still get one.
      if (nearRock(world, x, y)) ruined = true;
    }

    // The reachability check runs with the woods still standing, which is both the
    // conservative order and the cheap one: felling a tree only ever opens ground,
    // so a lake that costs nothing through a wood costs nothing through a clearing
    // — and an attempt that gets thrown away has nothing to replant.
    //
    // Forty-five cells is the floor for reading as a lake from the manager camera
    // rather than as a puddle somebody spilled, and it is also what rejects a
    // centre that landed in the rocks and only found a few open cells to fill.
    if (!ruined && painted.length >= 45) {
      for (const i of cut) {
        world.terrain[i] = wet;
        painted.push(i);
      }
      for (const i of painted) clearTree(world, i);
      for (const i of shoreline(world, painted)) clearTree(world, i);
      return painted.length;
    }
    for (let k = 0; k < painted.length; k++) world.terrain[painted[k]!] = was[k]!;
  }
  return 0;
}

export interface CabinLayout {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  doorX: number;
  doorY: number;
}

/**
 * The starter cabin: outer wall ring, a south door, beds, table, stove, lamp,
 * stockpile. Offsets from the hearth, not absolute cells — on a 64-wide map these
 * are the exact numbers the cabin has always had (25/26 → 37/36), so the room the
 * player wakes up in is unchanged by the map growing around it.
 */
export const CABIN: CabinLayout = {
  x0: HOME_X - 7,
  y0: HOME_Y - 6,
  x1: HOME_X + 5,
  y1: HOME_Y + 4,
  doorX: HOME_X - 1,
  doorY: HOME_Y + 4,
};

/**
 * The kitchen garden: twelve cells behind the cabin, on the opposite side from
 * the door. Raiders path to the nearest settler and the only way in is the south
 * door, so the plot sits where a fight is least likely to trample it. It ships
 * already sown, at staggered growth, because a food loop nobody notices is a food
 * loop nobody uses — the first harvest lands on day one and teaches itself.
 * Exported so the Steward works this plot rather than inventing a second one.
 */
export const GARDEN = { x0: HOME_X - 4, y0: HOME_Y - 9, x1: HOME_X + 1, y1: HOME_Y - 8 };

/**
 * How far out a point of interest has to sit to be worth the walk (cells).
 *
 * The near edge is fixed and the far edge scales. That asymmetry is the whole
 * point of a bigger map: the first expedition a colony ever runs should still be
 * seventeen cells and one afternoon, but the last one should be a genuine haul
 * across country, and there should be enough ground out there to hold both.
 */
export const SITE_MIN_RANGE = 17;
const SITE_MAX_RANGE = Math.round(MAP_R * 0.94);
/** Two sites closer together than this would read as one trip, not two. */
const SITE_SPACING = 9;
/**
 * What the map holds, drawn in a repeating cycle. Weighted towards caches
 * because a haul home is the payoff that always lands — a lode needs somebody
 * free to mine it and a survivor needs feeding, but a crate of steel is a crate
 * of steel.
 */
const SITE_CYCLE: SiteKind[] = ['cache', 'lode', 'survivor', 'cache', 'lode', 'cache', 'survivor', 'cache'];
/**
 * One site per ~512 cells, which is the density the 64×64 map shipped with (eight
 * of them). Held constant so a bigger map means more places to go rather than the
 * same eight sites spread thinner — the failure mode of every map that grew
 * without its contents growing too.
 */
const SITE_COUNT = Math.max(SITE_CYCLE.length, Math.round((MAP_W * MAP_H) / 512));

/**
 * Scatter the points of interest a scout can go and find.
 *
 * Placement is picky on purpose. A site has to be walkable, far enough out that
 * reaching it is a trip rather than an errand, reachable on foot from the cabin
 * — worldgen fences parts of the map off in rock, and a cache inside one of
 * those pockets is a promise the game cannot keep — and far enough from the
 * other sites that each one is a separate journey. Lodes additionally have to
 * sit against real rock, because "a seam worth mining" that designates nothing
 * is exactly the kind of empty reward that teaches a player to ignore a system.
 */
function placeSites(world: World, rng: Rng, homeX: number, homeY: number): void {
  const rockNear = (x: number, y: number): number => {
    let n = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= MAP_W - 1 || ny >= MAP_H - 1) continue;
        if (TERRAIN_LIST[world.terrain[ny * MAP_W + nx]!] === 'rock') n++;
      }
    }
    return n;
  };

  const open: Array<{ x: number; y: number; rock: number }> = [];
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      const d = Math.hypot(x - homeX, y - homeY);
      if (d < SITE_MIN_RANGE || d > SITE_MAX_RANGE) continue;
      if (!isWalkable(world, x, y)) continue;
      if (world.cellBuilding[y * MAP_W + x]! >= 0) continue;
      open.push({ x, y, rock: rockNear(x, y) });
    }
  }
  if (open.length === 0) return;

  const taken: Site[] = [];
  const spacedOk = (x: number, y: number) =>
    taken.every((s) => Math.hypot(s.x - x, s.y - y) >= SITE_SPACING);

  for (let n = 0; n < SITE_COUNT; n++) {
    const kind = SITE_CYCLE[n % SITE_CYCLE.length]!;
    // A lode wants ore under it; everything else only wants somewhere to stand.
    const pool = kind === 'lode' ? open.filter((c) => c.rock >= 6) : open;
    if (pool.length === 0) continue;
    for (let attempt = 0; attempt < 40; attempt++) {
      const c = pool[rng.int(pool.length)]!;
      if (!spacedOk(c.x, c.y)) continue;
      if (findPath(world, homeX, homeY, c.x, c.y) === null) continue;
      const site: Site = { id: nextId(world), kind, x: c.x, y: c.y, found: false };
      if (kind === 'cache') {
        const [res, lo, hi] = rng.pick<[ResourceKind, number, number]>([
          ['steel', 35, 70],
          ['wood', 45, 90],
          ['rawfood', 25, 50],
          ['medicine', 3, 7],
        ]);
        site.resource = res;
        site.amount = lo + rng.int(hi - lo + 1);
      }
      taken.push(site);
      world.sites.push(site);
      break;
    }
  }
}

/**
 * Build a valley.
 *
 * The difficulty is taken here rather than set afterwards because it moves the
 * clock on the first raid, and a colony that had already been ticking when the
 * setting arrived would have spent its grace at the wrong rate. Nothing else in
 * worldgen reads it: the map, the ore, the neighbours and the settlers are a
 * property of the seed alone, so the same number is the same valley on all three
 * settings and a player can hand a friend a seed without also handing them a
 * difficulty.
 */
export function createWorld(seed = 20260729, difficulty: Difficulty = 'settler'): World {
  const rng = new Rng(seed);
  const hardness = DIFFICULTIES[difficulty];
  const world: World = {
    version: SAVE_VERSION,
    seed,
    difficulty,
    tick: Math.floor(TICKS_PER_DAY * 0.3), // start mid-morning
    width: MAP_W,
    height: MAP_H,
    terrain: new Array(MAP_W * MAP_H).fill(terrainIdx('grass')),
    cellBuilding: new Array(MAP_W * MAP_H).fill(-1),
    cellZone: new Array(MAP_W * MAP_H).fill(-1),
    cellDesig: new Array(MAP_W * MAP_H).fill(0),
    crops: new Array(MAP_W * MAP_H).fill(CROP_NONE),
    buildings: [],
    items: [],
    zones: [],
    sites: [],
    jobs: [],
    pawns: [],
    projectiles: [],
    fires: [],
    messages: [],
    // Its own stream, deliberately: drawing the opening sky from `rng` would
    // shift every number after it and quietly regenerate every map in the game.
    weather: makeWeather(new Rng(seed ^ 0x5bf03635)),
    // Two and a half days before the first raid. Long enough to mine, cook,
    // build a bed and read the work tab — short enough that the quiet reads as
    // calm before something rather than as an empty game. The quiet valley gets
    // most of a week; hard country gets a day and a half.
    storyteller: {
      nextThreat: Math.round(TICKS_PER_DAY * 2.5 * hardness.grace),
      nextArrival: Math.round(TICKS_PER_DAY * 5),
      // Zero: the first idle afternoon is allowed to become the first expedition.
      // A mechanic nobody meets on day one is a mechanic nobody meets.
      nextScout: 0,
      // Late enough that a colony has a stove, a doctor and somewhere to put a
      // patient before the first fever arrives.
      nextOutbreak: Math.round(TICKS_PER_DAY * 4.5),
      threatsFired: 0,
      raidActive: false,
    },
    research: makeResearch(),
    nextId: 1,
    rng: { main: seed ^ 0x9e3779b9, combat: seed ^ 0x85ebca6b, story: seed ^ 0xc2b2ae35 },
    gameOver: false,
    stats: { built: 0, mealsCooked: 0, raidersKilled: 0, colonistsLost: 0, sitesScouted: 0 },
  };

  // --- terrain ---------------------------------------------------------------
  const rock = noise2(rng, MAP_W, MAP_H, 11);
  const dirt = noise2(rng, MAP_W, MAP_H, 7);
  const cx = MAP_W / 2;
  const cy = MAP_H / 2;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
      const distC = Math.hypot(x - cx, y - cy);
      // Keep the middle of the map open and buildable; push rock to the rim. The
      // open disc is a fraction of the map rather than a fixed 18 cells, so a
      // bigger map gets a proportionally bigger clearing instead of a homestead
      // pressed up against the first ridge.
      const rockBias = rock[i]! + Math.max(0, (OPEN_RADIUS - distC) / OPEN_RADIUS) * -0.5 + (edge < 3 ? 0.35 : 0);
      if (rockBias > 0.72) {
        world.terrain[i] = terrainIdx('rock');
      } else if (dirt[i]! > 0.66) {
        world.terrain[i] = terrainIdx('dirt');
      } else if (dirt[i]! < 0.24) {
        world.terrain[i] = terrainIdx('sand');
      }
    }
  }
  // A hard rock border so nothing walks off the world.
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) {
        world.terrain[y * MAP_W + x] = terrainIdx('rock');
      }
    }
  }
  // Clear the cabin footprint + a generous yard.
  for (let y = CABIN.y0 - 4; y <= CABIN.y1 + 5; y++) {
    for (let x = CABIN.x0 - 4; x <= CABIN.x1 + 4; x++) {
      if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) continue;
      const i = y * MAP_W + x;
      if (world.terrain[i] === terrainIdx('rock')) world.terrain[i] = terrainIdx('grass');
    }
  }

  // --- guaranteed ore outcrops ----------------------------------------------
  // Mined rock is the only source of steel, so a map with no reachable rock
  // near the cabin is a map where nothing can be built. Noise cannot promise
  // that — the pass above deliberately pushes rock to the rim — so lay a ring
  // of outcrops down by hand and carve a lane to each. The lanes are kept clear
  // of trees; `tests/colony-eval.test.ts` asserts every seed still has minable
  // rock a settler can actually walk to.
  const openLanes = new Set<number>();
  const homeX = Math.round((CABIN.x0 + CABIN.x1) / 2);
  const homeY = Math.round((CABIN.y0 + CABIN.y1) / 2);
  const inYard = (x: number, y: number) =>
    x >= CABIN.x0 - 4 && x <= CABIN.x1 + 4 && y >= CABIN.y0 - 4 && y <= CABIN.y1 + 5;
  // Two rings of them. The near ring is the first day's mining and does not move
  // when the map grows — six seams at a fourteen-cell walk, the same six the
  // 64×64 map shipped with. The far ring only exists on a map with room for it,
  // and it is what the extra ground is *for*: ore that costs an expedition rather
  // than an errand. Phase-shifted off the near ring so the lanes fan out into
  // separate trails instead of doubling up on six spokes.
  const ORE_RINGS: Array<{ count: number; min: number; max: number; phase: number }> = [
    { count: 6, min: 14, max: 19, phase: 0 },
  ];
  const farCount = Math.round((MAP_R - 32) / 4);
  if (farCount > 0) {
    ORE_RINGS.push({ count: farCount, min: MAP_R * 0.6, max: MAP_R * 0.86, phase: Math.PI / farCount });
  }

  for (const ring of ORE_RINGS) {
    for (let k = 0; k < ring.count; k++) {
      const angle = (k / ring.count) * Math.PI * 2 + ring.phase + rng.range(-0.35, 0.35);
      const radius = rng.range(ring.min, ring.max);
      const ax = Math.round(homeX + Math.cos(angle) * radius);
      const ay = Math.round(homeY + Math.sin(angle) * radius);

      const blob: number[] = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.hypot(dx, dy) > 1.9) continue;
          const x = ax + dx;
          const y = ay + dy;
          if (x <= 1 || y <= 1 || x >= MAP_W - 2 || y >= MAP_H - 2) continue;
          if (inYard(x, y)) continue;
          if (!rng.chance(0.82)) continue;
          const i = y * MAP_W + x;
          world.terrain[i] = terrainIdx('rock');
          blob.push(i);
        }
      }
      if (blob.length === 0) continue;

      // A straight lane home, so the outcrop is connected to the colony rather
      // than sitting behind whatever the noise pass happened to draw.
      const steps = Math.ceil(radius) + 2;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const x = Math.round(homeX + (ax - homeX) * t);
        const y = Math.round(homeY + (ay - homeY) * t);
        if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) break;
        const i = y * MAP_W + x;
        if (blob.includes(i)) break;
        const t0 = TERRAIN_LIST[world.terrain[i]!];
        if (t0 === 'rock' || t0 === 'water') world.terrain[i] = terrainIdx('grass');
        openLanes.add(i);
      }

      // Whichever blob cell is nearest home gets a cleared cell beside it, so
      // there is somewhere to stand and swing regardless of how the lane rounded.
      let near = blob[0]!;
      const distHome = (i: number) => Math.hypot((i % MAP_W) - homeX, Math.floor(i / MAP_W) - homeY);
      for (const c of blob) if (distHome(c) < distHome(near)) near = c;
      const nx = near % MAP_W;
      const ny = Math.floor(near / MAP_W);
      const stepX = Math.abs(homeX - nx) >= Math.abs(homeY - ny) ? Math.sign(homeX - nx) : 0;
      const stepY = stepX === 0 ? Math.sign(homeY - ny) : 0;
      const sx = nx + stepX;
      const sy = ny + stepY;
      if (sx > 0 && sy > 0 && sx < MAP_W - 1 && sy < MAP_H - 1) {
        world.terrain[sy * MAP_W + sx] = terrainIdx('grass');
        openLanes.add(sy * MAP_W + sx);
      }
    }
  }

  // --- trees -----------------------------------------------------------------
  const treeNoise = noise2(rng, MAP_W, MAP_H, 5);
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      const i = y * MAP_W + x;
      if (openLanes.has(i)) continue;
      if (TERRAIN_LIST[world.terrain[i]!] !== 'grass') continue;
      const insideYard =
        x >= CABIN.x0 - 3 && x <= CABIN.x1 + 3 && y >= CABIN.y0 - 3 && y <= CABIN.y1 + 4;
      if (insideYard) continue;
      if (treeNoise[i]! > 0.63 && rng.chance(0.5)) addBuilding(world, 'tree', x, y, true);
    }
  }

  // --- starter cabin ---------------------------------------------------------
  for (let x = CABIN.x0; x <= CABIN.x1; x++) {
    addBuilding(world, 'wall', x, CABIN.y0, true);
    if (!(x === CABIN.doorX && CABIN.doorY === CABIN.y1)) addBuilding(world, 'wall', x, CABIN.y1, true);
  }
  for (let y = CABIN.y0 + 1; y < CABIN.y1; y++) {
    addBuilding(world, 'wall', CABIN.x0, y, true);
    addBuilding(world, 'wall', CABIN.x1, y, true);
  }
  addBuilding(world, 'door', CABIN.doorX, CABIN.doorY, true);

  // The furnished room, laid out around the hearth: beds along the north wall,
  // the table in the middle where people eat together, the stove in the far
  // corner away from the pillows.
  addBuilding(world, 'bed', HOME_X - 5, HOME_Y - 4, true);
  addBuilding(world, 'bed', HOME_X - 3, HOME_Y - 4, true);
  addBuilding(world, 'bed', HOME_X - 1, HOME_Y - 4, true);
  addBuilding(world, 'table', HOME_X - 2, HOME_Y, true);
  addBuilding(world, 'table', HOME_X - 1, HOME_Y, true);
  addBuilding(world, 'stove', HOME_X + 3, HOME_Y - 4, true);
  addBuilding(world, 'lamp', HOME_X - 4, HOME_Y, true);
  addBuilding(world, 'lamp', HOME_X + 2, HOME_Y + 1, true);

  // --- stockpile + starting supplies ----------------------------------------
  const stock = addZone(world, 'stockpile', ['wood', 'steel', 'rawfood', 'meal', 'medicine']);
  const STOCK_X = HOME_X + 1;
  const STOCK_Y = HOME_Y + 1;
  for (let y = STOCK_Y; y <= STOCK_Y + 2; y++) {
    for (let x = STOCK_X; x <= STOCK_X + 3; x++) addCellToZone(world, stock, x, y);
  }
  // What the last lot left behind, scaled by the setting. This is the only place
  // difficulty touches supply, and it is stores rather than map on purpose: the
  // ore, the woods and the soil are identical on all three, so a seed is still a
  // place and two settings can be compared on one valley. `larder` is 1 on
  // Settler, so these are the numbers they have always been.
  //
  // Rounded up rather than down, and floored at one: a setting that erased the
  // medicine entirely would not be "harder", it would be a different tutorial —
  // the first bandage has to exist for the first raid to teach what it teaches.
  const scaled = (n: number) => Math.max(1, Math.ceil(n * hardness.larder));
  const drops: Array<[ResourceKind, number]> = [
    ['wood', scaled(150)],
    ['steel', scaled(90)],
    ['rawfood', scaled(45)],
    ['meal', scaled(12)],
    ['medicine', scaled(6)],
  ];
  let di = 0;
  for (const [kind, amount] of drops) {
    addItem(world, kind, amount, STOCK_X + (di % 4), STOCK_Y + Math.floor(di / 4));
    di++;
  }
  // A couple of loose piles outside so there is something to haul on turn one.
  addItem(world, 'wood', scaled(32), HOME_X - 8, HOME_Y + 7);
  addItem(world, 'rawfood', scaled(14), HOME_X + 8, HOME_Y - 2);

  // --- kitchen garden --------------------------------------------------------
  const garden = addZone(world, 'growing', []);
  let planted = 0;
  for (let y = GARDEN.y0; y <= GARDEN.y1; y++) {
    for (let x = GARDEN.x0; x <= GARDEN.x1; x++) {
      addCellToZone(world, garden, x, y);
      // The settlers who raised the cabin broke this ground before the player
      // arrived. It has to be laid down explicitly: whatever terrain generated
      // here was cosmetic until soil started driving growth, and leaving it to
      // the seed would mean the starter plot ran at full speed on one map and at
      // half speed on the next, which is seed luck the player cannot see or fix.
      world.terrain[packCell(world, x, y)] = terrainIdx('dirt');
      // Staggered so harvests arrive in a trickle instead of one glut a player
      // has nowhere to store.
      world.crops[packCell(world, x, y)] = Math.max(0, 0.7 - planted * 0.05);
      planted++;
    }
  }

  // --- settlers --------------------------------------------------------------
  // The fourth column is what this one was here *for*, in the founder's own life
  // log. All three arrived on the same morning, so a shared "was here at the
  // founding" would make the three cards identical in the one place they should
  // not be — and the skill they were sent out with is exactly the thing that
  // says which of them they were. See `lifelog.ts`.
  const spawns: Array<[number, number, SkillName, string]> = [
    [HOME_X - 3, HOME_Y + 2, 'construction', 'came out here to raise the first wall'],
    [HOME_X - 1, HOME_Y + 2, 'cooking', 'came out here to light the first fire'],
    [HOME_X + 1, HOME_Y - 1, 'mining', 'came out here to break the first stone'],
  ];
  const used = new Set<string>();
  for (const [x, y, bias, origin] of spawns) {
    let name = `${rng.pick(GIVEN_NAMES)} ${rng.pick(FAMILY_NAMES)}`;
    let guard = 0;
    while (used.has(name) && guard++ < 20) name = `${rng.pick(GIVEN_NAMES)} ${rng.pick(FAMILY_NAMES)}`;
    used.add(name);
    remember(world, makePawn(world, rng, 'colony', x, y, { name, skillBias: bias }), origin);
  }
  world.pawns[0]!.weapon = 'rifle';
  world.pawns[1]!.weapon = 'club';
  world.pawns[2]!.weapon = 'rifle';

  // Last, so it sees the finished map: walls placed, trees grown, lanes cut.
  placeSites(world, rng, homeX, homeY);

  // --- the lake --------------------------------------------------------------
  // Dead last of everything that touches the ground, and that position is the
  // whole reason the seeds still match: water where grass was is one fewer roll
  // in the tree pass, so a lake carved any earlier quietly re-rolls the rest of
  // the map. See `carveLake` — it now has the woods and the sites to work around
  // in exchange, which is the trade that keeps every existing seed intact.
  carveLake(world, new Rng(seed ^ 0x1a4e5d3b), openLanes, inYard, homeX, homeY);

  // Brambles before the fauna, and both on their own derived streams for the same
  // reason the lake has one: spending even a single roll of the worldgen stream
  // here would have shifted every terrain, tree and site decision on every
  // existing seed in the game. The order between these two does not matter —
  // separate streams do not interleave — but the brambles go first because the
  // brambletails that come off `spawnInitialFauna` eat them.
  scatterBushes(world, new Rng(seed ^ 0x2b7f19c5));
  spawnInitialFauna(world, new Rng(seed ^ 0x51ed2701));

  // The starting grid.
  //
  // It is here to be read: a generator in the north-west corner and a wire along
  // the skirting to each lamp. Nothing teaches "run conduit to the thing you want
  // lit" as fast as walking into a cabin that already has it — and the
  // alternative, two dark lamps on the first morning, is the same lesson
  // delivered as a bug.
  //
  // Every cell here hugs a wall. The first draft ran the wire straight down the
  // spine of the room, which cost the player the one clear stretch of floor they
  // had and put a building on the exact cell three tests use as "somewhere
  // indoors". Walls conduct, so a machine in a corner needs no wire at all and a
  // lamp needs only a stub out to the nearest wall.
  //
  // Placed after the settlers because ids are part of the seed contract: a
  // settler's traits are rolled from their own id, so buildings inserted before
  // `makePawn` runs re-roll the character of every colony in the game. Two
  // balance tests flipped on the spot when this block sat up beside the lamps.
  // Outside the north wall, not in the north-west corner of the living room where
  // it used to sit. An engine burning wood in a sealed cabin fills it with
  // exhaust — see `fumes.ts` — and the starting layout is the game teaching the
  // player how to build, so it must not be the first thing to teach them wrong.
  // A wall conducts, so hugging the outside of the shell powers exactly the same
  // grid the inside corner did, for the same zero conduit.
  addBuilding(world, 'generator', HOME_X - 6, CABIN.y0 - 1, true);
  addBuilding(world, 'conduit', HOME_X - 6, HOME_Y, true);
  addBuilding(world, 'conduit', HOME_X - 5, HOME_Y, true);
  for (let x = HOME_X + 2; x <= HOME_X + 4; x++) addBuilding(world, 'conduit', x, HOME_Y, true);

  world.rng.main = rng.state;
  // A headline, so it is the first line of the chronicle. Everything else that
  // ends up in that panel is a raid or a death or a harvest; a history whose
  // earliest entry is the day somebody first got shot at, with no record of the
  // colony having arrived at all, starts in the wrong place.
  msg(world, 'Three settlers reach the Aetherhold clearing. The cabin still stands.', 'good', {
    headline: true,
    at: { x: HOME_X, y: HOME_Y },
  });
  msg(world, 'Press V to step into a settler. Tab for the work board.', 'info');
  msg(world, 'The garden behind the cabin is already sown — B paints more of it.', 'info');
  return world;
}
