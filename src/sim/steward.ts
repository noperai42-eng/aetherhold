/**
 * The Steward: the colony building itself out.
 *
 * Everything the base is made of has, until now, been marked by the player. That
 * is right for the first hour and wrong for the tenth: a colony whose settlers
 * will chop, cook, mine, doctor, fight and bury the dead on their own initiative,
 * but who will stand in a bare yard for twenty days because nobody drew a fence,
 * is a colony that only half exists. The Steward is the missing half — the
 * colony's own foreman, marking out the next improvement to the place it lives.
 *
 * Four rules keep it a help rather than a hijack:
 *
 *  - **It only ever marks blueprints and designations.** Nothing here builds
 *    anything. What it produces is exactly what the player's own build bar
 *    produces, hauled and raised by the same settlers doing the same work types,
 *    and `Backspace` cancels it like anything else. There is no second building
 *    path to keep in step with the first. The one thing it does that is not a
 *    blueprint is put a project on the research bench — see `pickProject`, which
 *    exists because without it nothing in the shipped game ever chose one.
 *  - **It waits for a clear board.** If the player has queued *anything* — one
 *    blueprint, one painted floor — the Steward proposes nothing. The player's
 *    plan always comes first, and the colony never fights them for materials.
 *  - **It keeps a reserve.** Every ambition leaves a float of wood and steel
 *    untouched, so the colony can always afford the thing the player wants next
 *    and a fence never eats the wall they were saving for.
 *  - **It is one thing at a time.** One ambition per pass, and the next only once
 *    the last is standing. A player watching the yard sees the base grow a piece
 *    at a time, and can always tell what the colony is currently up to.
 *
 * Ambitions are ordered by what a colony actually needs: somewhere to sleep, dry
 * floors, a boundary, something to look at, cover at the door. The order is the
 * design — see `AMBITIONS`.
 */

import { defOf, isBed } from './buildings';
import { isSleepHours } from './clock';
import { canSow, growingCells } from './farming';
import { canFloor } from './floors';
import { isTimber } from './forest';
import { buriableDead, freeGraves } from './graves';
import { adjacentStandCells, buildingAt, dist, isWalkable } from './grid';
import { canPlace, designate } from './orders';
import { missingResource } from './jobs';
import { planBlueprint } from './stranded';
import { DRAW, GENERATOR_OUTPUT, conducts, isElectrical, isSource, powerNetworks } from './power';
import { BUNK_DEEP, planBunkhouse, planPartition } from './annex';
import { QUARTERS_MAX_CELLS, sharedBunks, unhoused } from './quarters';
import { regionAt } from './regions';
import { indoors, roomIndex, type Room } from './rooms';
import { REC_SPOTS } from './recreation';
import { foodDays } from './alerts';
import { COLD_BELOW } from './health';
import { RESEARCH, available, buildingUnlocked, setProject, type ResearchId } from './research';
import { addCellToZone, addZone, livingColonists, countResource, msg, removeBuilding, hostiles } from './world';
import {
  DESIG_FLOOR_PLANK,
  DESIG_HARVEST,
  DESIG_NONE,
  inBounds,
  packCell,
  terrainAt,
  unpackX,
  unpackY,
  type Building,
  type BuildingKind,
  type ResourceKind,
  type World,
} from './types';

/** How often the Steward looks up from its work. Slow on purpose: this is planning. */
export const STEWARD_INTERVAL = 60;

/**
 * What the colony will not spend.
 *
 * The float exists so the Steward can never be the reason a player cannot afford
 * a wall. It is deliberately about two walls and a door of each, which is what a
 * colony reaches for in an emergency.
 */
export const RESERVE: Record<ResourceKind, number> = {
  wood: 40,
  steel: 30,
  rawfood: 0,
  meal: 0,
  medicine: 0,
  // Nothing the Steward builds is made of hide, so there is nothing to protect
  // it from. Components likewise: they are spent at the bench and nowhere else,
  // and the bench is not something the Steward can outbid.
  hide: 0,
  components: 0,
  assemblies: 0,
};

/**
 * The stock level below which the colony goes and gets more.
 *
 * Above the float, not equal to it: a colony that only tops up once it is already
 * at its reserve has no reserve, it has a target. Eighty wood is a fence batch and
 * a fortnight of generator fuel on top of the float, which is the gap a colony
 * needs to be able to both build and keep the lights on.
 */
export const WOOD_FLOOR = 80;
export const STEEL_FLOOR = 50;

/** How far from the cabin the colony will go for a log or a rock face. */
export const HARVEST_RADIUS = 22;

/**
 * And how far it will go when there is nothing left inside that.
 *
 * A single radius is a promise that the ground inside it is inexhaustible, and
 * ninety days of measurement says it is not: on seed 20260729 the colony had cut
 * every tree within twenty-two cells by day eighty-five and then sat at zero
 * wood for the rest of the run — fifteen settlers, three hundred buildings, two
 * thousand trees still standing on the map, and a foreman that had decided the
 * valley was empty because the first ring was.
 *
 * Rings rather than one big number, because the first ring is what makes a
 * colony compact. A settler will walk forty cells for a log when forty cells is
 * what it takes; a settler who walks forty cells for the *first* log while there
 * is a wood behind the cabin is a colony that spends its whole day on the road.
 * So the near ring is tried first and always, and the wider ones are only ever
 * reached for on a pass that came back with nothing — which is exactly the pass
 * that used to give up.
 */
export const HARVEST_REACHES = [HARVEST_RADIUS, 32, 44];

/** Cells out from the cabin's edge that the yard fence is drawn at. */
export const YARD_MARGIN = 4;

/**
 * The largest kitchen garden the colony will lay out for itself.
 *
 * Sixty-four cells feeds sixteen at the ration the `fields` ambition works to,
 * which is well past any population this map produces. The cap is not about food
 * — it is about a plot big enough to sow being a plot big enough to spend every
 * daylight hour walking across. Past this the answer is a second settlement, not
 * a bigger square, and the player can always paint more themselves.
 */
export const MAX_PLOT = 64;

/**
 * Watts of spare capacity the foreman keeps on the grid.
 *
 * A cooler's worth, because the cooler is the dearest single thing a player ever
 * plugs in and therefore the machine the headroom is most often spent on. Sizing
 * the grid to exactly what is already drawing means the next machine — anyone's,
 * the player's or the colony's own — is the one that browns it out, and the
 * shed order then puts the freezer out to keep the guns lit. That is the correct
 * order to sacrifice things in and the wrong situation to be in.
 *
 * The margin is free in fuel, which is what makes it affordable to insist on: a
 * generator only lights while the grid is still short, so the spare firebox sits
 * cold until the night it is needed. It costs thirty wood and ten steel once.
 */
export const GRID_HEADROOM = 90;

/**
 * How far the foreman will build the grid out, per kind.
 *
 * Four generators is 960 W, which is every turret, lamp, cooler and heater this
 * colony can reach with room over. The caps are not a balance figure so much as a
 * promise: the Steward is a foreman, not a utility company, and a player who
 * comes back to find their yard is a power station has been robbed of a decision.
 * Past these numbers the grid is the player's problem, which is the right place
 * for it — they can see the meter.
 */
export const MAX_GENERATORS = 4;
export const MAX_PANELS = 4;
export const MAX_BANKS = 2;

/** Blueprints one ambition may mark in a single pass. Keeps a fence growing in stages. */
const BATCH = 8;

/** Is the colony's own plan clear enough for the Steward to add to it? */
export function boardClear(world: World): boolean {
  for (const b of world.buildings) if (!b.built) return false;
  for (let i = 0; i < world.cellDesig.length; i++) {
    if (world.cellDesig[i] !== DESIG_NONE) return false;
  }
  return true;
}

/** Can the colony spend this without dipping into the float? */
function affords(world: World, kind: ResourceKind, amount: number): boolean {
  return countResource(world, kind) - amount >= RESERVE[kind];
}

/** Can the colony afford one of these buildings and still keep its float? */
function affordsBuilding(world: World, kind: Building['kind']): boolean {
  const cost = defOf(kind).cost;
  for (const k of Object.keys(cost) as ResourceKind[]) {
    if (!affords(world, k, cost[k] ?? 0)) return false;
  }
  return true;
}

function builtCount(world: World, kind: Building['kind']): number {
  let n = 0;
  for (const b of world.buildings) if (b.built && b.kind === kind) n++;
  return n;
}

/**
 * The room the colony lives in, and the yard around it.
 *
 * Everything the Steward does is placed relative to this rather than to the map,
 * because the cabin is the one thing a player recognises as "here". Biggest
 * enclosed room wins, which is the cabin on day one and stays the cabin unless
 * the player builds themselves a hall — in which case the hall is where the
 * colony's attention should be anyway.
 *
 * Biggest *of the rooms somebody built something in*, which is the whole of the
 * difference between a colony and a stalled one. `rooms.ts` counts natural rock
 * as enclosing, quite deliberately — a mined-out cave is a room you can live in —
 * and the moor is generated with rock in it, so a horseshoe of cliff that happens
 * to close on itself is a room too. On the 128 map the biggest of those was never
 * bigger than the 99-cell cabin. At 192 there is one of 227 cells eighty paces
 * north of the hearth, and the Steward duly went and hung a door on it: one
 * blueprint, at the far end of the map, that nobody was ever going to walk to.
 *
 * That is worse than it sounds, because `boardClear` will not let the Steward
 * plan anything while a blueprint is outstanding. One door in a cave stopped the
 * colony dead — three days in it had raised thirteen buildings where it used to
 * raise sixty-six, and the fence, the beds and the store never got ordered at
 * all. Nothing about it looked like a room bug; it looked like the Steward had
 * stopped working.
 *
 * A cave has nothing in it. A cabin has beds and a stove in it, and a hall a
 * player raises has a lamp in it by the time it is worth calling the heart of
 * anything. So: a room counts once the colony has put something in it, and the
 * fallback is the old rule, for the one tick during worldgen before the furniture
 * lands.
 */
export function heart(world: World): Room | null {
  const idx = roomIndex(world);
  const lived = new Set<number>();
  for (const b of world.buildings) {
    if (!b.built || !defOf(b.kind).buildable) continue;
    const id = idx.cellRoom[b.y * world.width + b.x];
    if (id !== undefined && id >= 0) lived.add(id);
  }
  let best: Room | null = null;
  let bare: Room | null = null;
  for (const room of idx.rooms.values()) {
    if (!bare || room.size > bare.size) bare = room;
    if (!lived.has(room.id)) continue;
    if (!best || room.size > best.size) best = room;
  }
  return best ?? bare;
}

/** A room's bounding box in map coordinates. */
export function boundsOf(world: World, room: Room): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const packed of room.cells) {
    const x = packed % world.width;
    const y = (packed - x) / world.width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Room cells with nothing standing on them, ordered outward from the middle. */
function freeCells(world: World, room: Room): { x: number; y: number }[] {
  const b = boundsOf(world, room);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const out: { x: number; y: number }[] = [];
  for (const packed of room.cells) {
    const x = packed % world.width;
    const y = (packed - x) / world.width;
    if (world.cellBuilding[packed]! >= 0) continue;
    if (!isWalkable(world, x, y)) continue;
    out.push({ x, y });
  }
  out.sort((p, q) => dist(p.x, p.y, cx, cy) - dist(q.x, q.y, cx, cy));
  return out;
}

/**
 * The ring of cells the yard fence would run along, clockwise from the top-left.
 *
 * The line is the room's box plus a margin, pushed out wherever it would
 * otherwise be drawn straight through a growing zone. A fence post is solid, and
 * solid ground cannot be sown — so a boundary that clips the plot does not fence
 * the farm, it deletes the row it crosses, silently and permanently. The starter
 * garden sits exactly four cells behind the cabin, which is exactly where the
 * default margin puts the north line, so this was not a corner case: every game
 * fenced over half its own kitchen garden on about day two and then wondered why
 * it was hungry.
 *
 * Only plots near the house pull the line — a field the player paints across the
 * valley is theirs to fence, and dragging the yard out to swallow it would cost
 * hundreds of planks for a boundary nobody asked for.
 */
export function yardRing(world: World, room: Room): { x: number; y: number }[] {
  const b = boundsOf(world, room);
  let x0 = b.x0 - YARD_MARGIN;
  let x1 = b.x1 + YARD_MARGIN;
  let y0 = b.y0 - YARD_MARGIN;
  let y1 = b.y1 + YARD_MARGIN;
  const reach = YARD_MARGIN * 2;
  for (const packed of growingCells(world)) {
    const x = unpackX(world, packed);
    const y = unpackY(world, packed);
    if (x < b.x0 - reach || x > b.x1 + reach) continue;
    if (y < b.y0 - reach || y > b.y1 + reach) continue;
    // One clear cell beyond the furthest bed, so the line never sits *on* soil.
    if (x <= x0) x0 = x - 1;
    if (x >= x1) x1 = x + 1;
    if (y <= y0) y0 = y - 1;
    if (y >= y1) y1 = y + 1;
  }
  const out: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x++) {
    out.push({ x, y: y0 });
    out.push({ x, y: y1 });
  }
  for (let y = y0 + 1; y < y1; y++) {
    out.push({ x: x0, y });
    out.push({ x: x1, y });
  }
  return out.filter((c) => c.x > 0 && c.y > 0 && c.x < world.width - 1 && c.y < world.height - 1);
}

/**
 * Is this ring cell already dealt with?
 *
 * A boundary does not have to be all fence. Rock, water, the cabin's own wall and
 * a tree that has not been felled all stop somebody walking through, and marking
 * a fence blueprint on top of them is how you get a colony that spends a week
 * fencing a lake.
 */
function ringDone(world: World, x: number, y: number): boolean {
  const t = terrainAt(world, x, y);
  if (t === 'water' || t === 'rock') return true;
  const b = buildingAt(world, x, y);
  if (b) return true;
  return false;
}

/** Can current get through this cell — either already, or once a conduit is on it? */
function canWire(world: World, x: number, y: number): boolean {
  const b = buildingAt(world, x, y);
  if (b) return conducts(b.kind);
  return canPlace(world, 'conduit', x, y) === 'ok';
}

const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * How far a cable is allowed to look for the grid.
 *
 * Four thousand cells, expanded four ways, is a circle about thirty-five cells
 * across — the whole yard and then some, and the only thing further out than
 * that is a machine the player put there themselves. The cap is not really about
 * cost (this runs once every three seconds, and only when something is dark) but
 * about the failure case: with no cap, a turret stranded behind a lake would
 * flood-fill the entire map every pass, forever, to find out what it already
 * found out last time.
 */
const WIRE_SEARCH = 4000;

/**
 * The shortest run of cells that would carry current from a stranded machine to
 * the live grid — or null when there is not one.
 *
 * This gets its own search rather than borrowing the settlers'. Twice now the
 * cable has been routed by something that was not thinking about cable, and both
 * times three of the colony's four turrets stood dark for a forty-day run:
 *
 *   - A plain L walks into the yard fence and stops. A fence does not conduct,
 *     on purpose — a paddock rail that silently powered a turret would be a rule
 *     nobody could see — and a fence is a *ring*, so there is no straight line
 *     out of one at all.
 *   - `findPathAdjacent` gets through the gate, because a door conducts and the
 *     haulers walk that way anyway. But a footpath cuts corners and current does
 *     not: squaring up a diagonal needs one of its two corner cells to be free,
 *     and a route that squeezes diagonally between two walls has neither. One
 *     such squeeze anywhere on a forty-cell run and the whole run is unlayable.
 *
 * Both of those are the same mistake, which is asking a question about walking
 * and using the answer for wiring. What conduit actually wants is: four
 * neighbours, no diagonals, and every cell either already conducting or free to
 * take a conduit. That is a plain breadth-first flood, it is nine lines, and it
 * goes *through* the cabin wall — walls conduct — which is both correct and
 * shorter than going around to the door.
 */
function wireRoute(world: World, from: Building, live: ReadonlySet<number>): { x: number; y: number }[] | null {
  const start = packCell(world, from.x, from.y);
  const prev = new Map<number, number>([[start, -1]]);
  const queue: number[] = [start];
  let goal = -1;
  for (let head = 0; head < queue.length && head < WIRE_SEARCH && goal < 0; head++) {
    const cur = queue[head]!;
    const cx = unpackX(world, cur);
    const cy = unpackY(world, cur);
    for (const [dx, dy] of ORTHOGONAL) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(world, x, y)) continue;
      const idx = packCell(world, x, y);
      if (prev.has(idx)) continue;
      const b = buildingAt(world, x, y);
      // Touching anything on a live network *is* the connection — there is
      // nothing to build on this cell and nothing further to walk.
      if (b && live.has(b.id)) {
        prev.set(idx, cur);
        goal = idx;
        break;
      }
      if (!canWire(world, x, y)) continue;
      prev.set(idx, cur);
      queue.push(idx);
    }
  }
  if (goal < 0) return null;

  const out: { x: number; y: number }[] = [];
  for (let at = prev.get(goal)!; at !== start; at = prev.get(at)!) {
    out.push({ x: unpackX(world, at), y: unpackY(world, at) });
  }
  out.reverse();
  return out;
}

/**
 * Where a new machine goes: in the yard, out of the house, touching the wires.
 *
 * Outdoors is not a preference. A firebox in a one-room cabin fills it with
 * exhaust — `fumes.ts` exists because that is the mistake players actually make —
 * and a panel under a roof is forty steel of decoration. So the search is the
 * yard: the box the fence encloses, minus everything inside the walls.
 *
 * Wired beats near, by a margin nothing can close. A generator set down out of
 * reach of anything conducting is not a power station, it is a second network
 * with nothing on it: the colony would have to notice, and then run cable to its
 * own generator, before a single lamp came back on. One cell further from the
 * door costs a settler four seconds; one cell off the grid costs a week.
 */
function gridSpot(world: World, kind: BuildingKind): { x: number; y: number } | null {
  const room = heart(world);
  if (!room) return null;
  const b = boundsOf(world, room);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let y = b.y0 - YARD_MARGIN; y <= b.y1 + YARD_MARGIN; y++) {
    for (let x = b.x0 - YARD_MARGIN; x <= b.x1 + YARD_MARGIN; x++) {
      // First, because it is the check that knows about the map edge — every
      // array read below this line is inside the world.
      if (canPlace(world, kind, x, y) !== 'ok') continue;
      if (indoors(world, x, y)) continue;
      const idx = packCell(world, x, y);
      if (world.cellZone[idx]! >= 0) continue;
      if (world.cellDesig[idx] !== DESIG_NONE) continue;
      const wired = ORTHOGONAL.some(([dx, dy]) => {
        const n = buildingAt(world, x + dx, y + dy);
        return n !== null && n.built && conducts(n.kind);
      });
      const score = (wired ? 0 : 1000) + dist(x, y, cx, cy);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * A room the colony has walled and not yet furnished.
 *
 * Small, enclosed, not the hall, and with no bed in it. That is a bedroom
 * waiting to happen, and it is also — deliberately — a shell the *player* walled
 * off and left empty. The Steward finishing somebody else's room is the same
 * behaviour as it finishing its own, and there is no reason to tell them apart.
 *
 * Blueprints cannot be standing in one of these: `boardClear` is what let this
 * pass run at all, so anything here is built.
 */
function bedlessRooms(world: World): Room[] {
  const idx = roomIndex(world);
  const h = heart(world);
  const out: Room[] = [];
  for (const room of idx.rooms.values()) {
    if (h && room.id === h.id) continue;
    if (room.size > QUARTERS_MAX_CELLS) continue;
    let taken = false;
    for (const b of world.buildings) {
      // A prison bunk counts, and it has to. `isBed` says no — a prisonbed is
      // not somewhere a settler sleeps — but this list is "rooms nobody has
      // claimed", and without the extra clause the cell block the Steward has
      // just walled reads as empty and `quarters` puts a colonist's bunk in it
      // next to the raider.
      if (!b.built || !(isBed(b.kind) || b.kind === 'prisonbed')) continue;
      if (idx.cellRoom[b.y * world.width + b.x] === room.id) {
        taken = true;
        break;
      }
    }
    if (!taken) out.push(room);
  }
  return out;
}

/**
 * Walls the next room could lean on, in the order they should be tried.
 *
 * Three filters, and every one of them was bought:
 *
 *  - **Inside the yard.** The first cut took every enclosed room on the map
 *    under `QUARTERS_MAX_CELLS`. This map generates caves, a cave is a small
 *    enclosed room, and so the Steward spent seed 4242 walling bedrooms onto
 *    rock formations out in the wilderness: forty days, no private rooms, and a
 *    room lost on day 13 to the connectivity watchdog cleaning up after it.
 *  - **Not inside the hall.** A partitioned corner is a small enclosed room too,
 *    and hanging the next room off *it* is carving the hall again — with none of
 *    `planPartition`'s `HALL_FLOOR_LEFT` guard, because this code does not know
 *    it is standing in the shared room. The bunkhouse is a thing in the yard.
 *  - **Nearest first.** Growing away from the hall takes care of itself: each
 *    room is hung off the last, so the row walks outward whether or not anybody
 *    sorts for it. Sorting furthest-first only picked the wildest cave.
 *
 * The hall stays on the list, at the end, because it is where the first room in
 * the yard has to come from — there is nothing else standing to lean on yet.
 */
function bunkhouseHosts(world: World, h: Room): Room[] {
  const idx = roomIndex(world);
  let hx0 = Infinity;
  let hy0 = Infinity;
  let hx1 = -Infinity;
  let hy1 = -Infinity;
  for (const packed of h.cells) {
    const x = packed % world.width;
    const y = (packed - x) / world.width;
    if (x < hx0) hx0 = x;
    if (x > hx1) hx1 = x;
    if (y < hy0) hy0 = y;
    if (y > hy1) hy1 = y;
  }
  const cx = (hx0 + hx1) / 2;
  const cy = (hy0 + hy1) / 2;
  // The fence ring plus the depth of one room: a host further out than this
  // could not have a room hung off it without crossing the boundary anyway.
  const reach = (hx1 - hx0 + hy1 - hy0) / 2 + YARD_MARGIN + BUNK_DEEP + 2;
  const small: { room: Room; d: number }[] = [];
  for (const room of idx.rooms.values()) {
    if (room.id === h.id) continue;
    if (room.size > QUARTERS_MAX_CELLS) continue;
    const c = room.cells[0]!;
    const x = c % world.width;
    const y = (c - x) / world.width;
    if (x >= hx0 && x <= hx1 && y >= hy0 && y <= hy1) continue;
    const d = dist(cx, cy, x, y);
    if (d > reach) continue;
    small.push({ room, d });
  }
  small.sort((a, b) => a.d - b.d || a.room.id - b.room.id);
  return [...small.map((s) => s.room), h];
}

/**
 * One pass of growing the compound a room at a time.
 *
 * Furnishing comes before building, always. A colony that raised four shells and
 * then went looking for a fifth would have four rooms nobody can sleep in and a
 * woodpile spent; putting the bed in first means every plank the colony lays
 * turns into somewhere a settler can actually live before the next one is
 * started. It is also what makes the whole thing resumable — a shell is
 * recognised by being empty, not by being remembered.
 *
 * The lamp goes in with the bed rather than waiting for its own ambition,
 * because `wiring` will chase it and run conduit out to it on a later pass. That
 * is the colony running power to its rooms, and it costs nothing here.
 */
function growQuarters(world: World): number {
  // A spare bunk in the hall is a bed this colony already owns, and the settlers
  // will carry it next door themselves — see `moveBedJob` in jobs.ts. Marking a
  // blueprint on top of that would have the colony fell twenty planks for a
  // second bed and then leave the first one standing in the hall with nobody in
  // it, which is how a barracks becomes a furniture warehouse.
  const spare = sharedBunks(world).length > 0;
  for (const room of bedlessRooms(world)) {
    let n = 0;
    if (!spare) {
      if (!affordsBuilding(world, 'bed')) break;
      const cells = freeCells(world, room);
      // Against a wall, like the hall's own beds, so the doorway stays walkable.
      for (const cell of cells.reverse()) {
        if (planBlueprint(world, 'bed', cell.x, cell.y)) {
          n++;
          break;
        }
      }
      if (n === 0) continue;
    }
    if (buildingUnlocked(world, 'lamp') && affordsBuilding(world, 'lamp')) {
      for (const cell of freeCells(world, room)) {
        if (planBlueprint(world, 'lamp', cell.x, cell.y)) {
          n++;
          break;
        }
      }
    }
    // Nothing marked and nothing to mark: an empty room waiting on a bunk being
    // carried to it is not work for the Steward, it is work already under way.
    if (n === 0) continue;
    return n;
  }

  return carveRoom(world);
}

/**
 * Wall out one more small room, wherever the next one will fit.
 *
 * Split off from `growQuarters` when the cell block needed the same thing: a
 * prison is a room with a bunk in it and a door that shuts, which is a bedroom
 * with a different occupant. Every hard-won rule below is about *how* to cut a
 * room without breaking the hall, and none of it is about who ends up in it.
 */
function carveRoom(world: World): number {
  const h = heart(world);
  if (!h) return 0;
  if (!affordsBuilding(world, 'wall')) return 0;
  // Inside first, outside second — see `planPartition`, and do not swap these.
  // Tried the other way round on seed 4242: the yard annex is the shape that
  // *usually does not fit*, so leading with it meant the colony spent its passes
  // failing to place a room outside while the corner it could always have had
  // went uncut, and finished forty days with none instead of two.
  //
  // What is new is what happens when the hall has given up all the floor it can
  // spare. `planPartition` stops at `HALL_FLOOR_LEFT` — measured at two or three
  // bedrooms and then nothing for the rest of the run — and a colony of eight
  // that can only ever house three is not housing anybody, it is running a
  // lottery. A bunkhouse room leans on the last bunkhouse room, so past that
  // ceiling every room the colony finishes is somewhere the next one can go.
  const plan = planPartition(world, h) ?? planBunkhouse(world, bunkhouseHosts(world, h));
  if (!plan) return 0;

  // The door goes in **first**, and it is not a stylistic choice.
  //
  // An annex shell is eight walls, which is exactly `BATCH`, so marking walls
  // first used to fill the batch and push the door to the next pass. The walls
  // went up, and for a day the colony owned a sealed six-cell pocket with no way
  // into it — which is precisely what `connectivity.ts` exists to repair. The
  // watchdog did its job and deconstructed the cabin's own north wall to reach
  // the pocket, the hall stopped being a room, `heart` fell through to a
  // three-cell cave, and every ambition that measures from the heart quietly
  // stopped working for the rest of the run. Measured on seed 4242: the hall went
  // from 99 cells to 3 on day 12 and never came back.
  //
  // A doorway is walkable whether or not the door is hung yet, so marking it
  // first means the room is reachable at every moment of its construction and the
  // watchdog never has anything to fix.
  // The door is marked **alone**, and the walls only once it is standing.
  //
  // Marking it first in the same batch was not enough. The Steward controls what
  // is marked; it does not control what gets built, and `construct` takes frames
  // nearest-first — so the walls went up around a corner whose door was still a
  // blueprint, and for as long as that lasted the colony owned a sealed pocket.
  // That is exactly the damage `connectivity.ts` exists to repair, and it repairs
  // it by deconstructing whatever is nearest: the hall's own wall. Measured on
  // seed 4242 twice, once through an outside annex and once through an inside
  // partition — the hall stopped being a room, `heart` fell through to the
  // six-cell bedroom the colony had just finished, and every ambition that
  // measures from the heart was working off a broom cupboard from then on.
  //
  // One extra pass per room buys an invariant worth having: at no instant is
  // there a wall of ours standing that a doorway does not already lead through.
  const standing = buildingAt(world, plan.door.x, plan.door.y);
  if (!standing) return planBlueprint(world, 'door', plan.door.x, plan.door.y) ? 1 : 0;
  if (!standing.built) return 0;

  let n = 0;
  for (const c of plan.walls) {
    if (n >= BATCH) break;
    // Already standing — a wall from an earlier batch, or the cabin's own corner.
    if (buildingAt(world, c.x, c.y)) continue;
    if (planBlueprint(world, 'wall', c.x, c.y)) n++;
  }
  return n;
}

interface Ambition {
  id: string;
  /** Present tense, for the line in the log the moment the colony starts it. */
  says: string;
  /** Mark up to `BATCH` things. Returns how many were marked; 0 means "not now". */
  mark(world: World): number;
}

/**
 * What the colony wants, in the order it wants it.
 *
 * Read top to bottom as a colony's own priorities: stores in the yard, then
 * anybody lying out in it put in the ground, then everybody in a bed, then a
 * boundary with a gate in it, then dry floors, then
 * somewhere to spend an evening and something to look at, and finally cover at the
 * gate once something has come through it. Each one is checked in turn and the
 * first that marks anything ends the pass.
 *
 * Restocking is first because everything below it spends. A Steward that only
 * knew how to build would mark a fence, spend the woodpile down to the float, and
 * leave the generator to burn the last of it — the colony's freezer would go out
 * in the third week of a game nobody was doing anything wrong in. A colony that
 * fells its own trees is also the plainer reading of "the settlers look after the
 * place": standing in a clearing full of timber waiting to be told to pick it up
 * is the behaviour this whole module exists to end.
 *
 * The grid comes before the guns for the same reason the fence comes before the
 * floors: it is the ambition whose absence you only notice through something
 * else failing. A turret is visible and a missing watt is not, so left to a
 * simple ordering the colony buys guns until the night the freezer goes off.
 *
 * The boundary comes before the floors on purpose. Boarding a ninety-cell cabin
 * eight tiles at a time is a fortnight of work that changes nothing a player can
 * see from the manager camera; a fence going up around the yard is the colony
 * visibly becoming a place. Comfort is last of the useful things because a
 * colony that spends its steel on a statue before it has a gate deserves what
 * arrives.
 */
export const AMBITIONS: Ambition[] = [
  {
    id: 'stores',
    says: 'The colony sends people out for timber and stone — the stores are down.',
    mark(world) {
      const room = heart(world);
      if (!room) return 0;
      const b = boundsOf(world, room);
      let cx = (b.x0 + b.x1) / 2;
      let cy = (b.y0 + b.y1) / 2;
      // Where the colony is standing, so a tree on the far side of a lake is not
      // an errand. This is what the reachability index is for: asking it about
      // forty trees costs one array read each.
      let home = regionAt(world, Math.round(cx), Math.round(cy));

      // Unless nobody lives there. `heart` wants the biggest enclosed room with
      // something built in it, and takes the biggest room on the map if no room
      // qualifies — which is the right answer for laying out a yard and the wrong
      // one for sending somebody out with an axe, because a raid that opens the
      // cabin roof stops it being a room at all. Measured on seed 99001 at forty
      // days: the heart was a three-cell pocket at (108,45), all six settlers and
      // all thirty-five frames were in region 0 around (98,95), and so every one
      // of the two thousand four hundred and seventy-one trees on the map failed
      // the reachability test against a cupboard nobody was standing in.
      //
      // Fetching is about where the people are, not where the house was. Only the
      // fetching: the yard, the fence and the rest still measure from the heart,
      // which is what they are about.
      const crew = livingColonists(world);
      if (crew.length > 0 && !crew.some((p) => regionAt(world, Math.round(p.x), Math.round(p.y)) === home)) {
        const mx = crew.reduce((n, p) => n + p.x, 0) / crew.length;
        const my = crew.reduce((n, p) => n + p.y, 0) / crew.length;
        // The middle of the crew can be a wall or a lake, so stand on whoever is
        // nearest to it rather than on the average itself.
        const near = crew.reduce((a, p) => (dist(p.x, p.y, mx, my) < dist(a.x, a.y, mx, my) ? p : a), crew[0]!);
        cx = near.x;
        cy = near.y;
        home = regionAt(world, Math.round(cx), Math.round(cy));
      }

      let n = 0;
      const reachableFrom = (x: number, y: number): boolean => {
        if (home < 0) return true;
        for (const c of adjacentStandCells(world, x, y)) {
          if (regionAt(world, c.x, c.y) === home) return true;
        }
        return false;
      };

      if (countResource(world, 'wood') < WOOD_FLOOR) {
        for (const reach of HARVEST_REACHES) {
          // Timber, not trees. A sapling cut at a twentieth of its size pays a
          // twentieth of the wood, so a colony that marks every green thing it
          // can see is eating the woodlot that was about to feed it — and the
          // valley only grows back into gaps it can still seed. See `isTimber`.
          const trees = world.buildings
            .filter((t) => t.built && isTimber(t) && dist(t.x, t.y, cx, cy) < reach)
            .sort((p, q) => dist(p.x, p.y, cx, cy) - dist(q.x, q.y, cx, cy));
          for (const t of trees) {
            if (n >= BATCH) break;
            if (!reachableFrom(t.x, t.y)) continue;
            if (designate(world, t.x, t.y, DESIG_HARVEST)) n++;
          }
          if (n > 0) break;
        }
      }
      if (n === 0 && countResource(world, 'steel') < STEEL_FLOOR) {
        for (const reach of HARVEST_REACHES) {
          const faces: { x: number; y: number; d: number }[] = [];
          for (let y = 1; y < world.height - 1; y++) {
            for (let x = 1; x < world.width - 1; x++) {
              if (terrainAt(world, x, y) !== 'rock') continue;
              const d = dist(x, y, cx, cy);
              if (d >= reach) continue;
              // Only a face somebody can swing at. The middle of a boulder field is
              // a designation nobody can start, which reads to a player as mining
              // being broken.
              if (!reachableFrom(x, y)) continue;
              faces.push({ x, y, d });
            }
          }
          faces.sort((p, q) => p.d - q.d);
          for (const f of faces) {
            if (n >= BATCH) break;
            if (designate(world, f.x, f.y, DESIG_HARVEST)) n++;
          }
          // The same widening the timber does, and for the same reason: rock does
          // not grow back at all, so a mined-out first ring is permanent and a
          // foreman that only knows about it is permanently done mining.
          if (n > 0) break;
        }
      }
      return n;
    },
  },
  {
    id: 'graves',
    says: 'The colony digs graves for the dead lying out in the yard.',
    mark(world) {
      // Second only to the stores, and the only ambition on this list with a
      // clock on it. A body left out costs every settler mood until it rots away
      // four days later, and burial is the one thing that stops it — a colony
      // with nowhere to put its dead simply waits out the penalty, every time,
      // for ever. Seed 4242 finished a raid on day six and spent the rest of the
      // week at the corpse ceiling with four raiders face-down by the fence,
      // which is a mood problem the player can see the cause of and the colony
      // could not act on. Everything below this is furniture.
      const need = buriableDead(world).length - freeGraves(world).length;
      if (need <= 0) return 0;
      if (!affordsBuilding(world, 'grave')) return 0;
      const room = heart(world);
      if (!room) return 0;
      const b = boundsOf(world, room);
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;

      // In the yard, as far out in it as the fence allows: a graveyard belongs at
      // the bottom of the garden, not against the kitchen wall. Sorting outward
      // puts the whole row in one corner rather than scattering markers around
      // the house, and keeps it inside the boundary where a hauler carrying a
      // body does not need the gate to be open.
      const spots: { x: number; y: number }[] = [];
      for (let y = b.y0 - YARD_MARGIN + 1; y <= b.y1 + YARD_MARGIN - 1; y++) {
        for (let x = b.x0 - YARD_MARGIN + 1; x <= b.x1 + YARD_MARGIN - 1; x++) {
          if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) continue; // the cabin
          if (canPlace(world, 'grave', x, y) !== 'ok') continue;
          spots.push({ x, y });
        }
      }
      spots.sort((p, q) => dist(q.x, q.y, cx, cy) - dist(p.x, p.y, cx, cy));

      let n = 0;
      for (const s of spots) {
        if (n >= need || n >= BATCH) break;
        if (planBlueprint(world, 'grave', s.x, s.y)) n++;
      }
      return n;
    },
  },
  {
    id: 'beds',
    says: 'The colony marks out another bed — nobody should be sleeping on the floor.',
    mark(world) {
      const people = livingColonists(world).length;
      const beds = builtCount(world, 'bed') + builtCount(world, 'medbed');
      if (beds >= people) return 0;
      if (!affordsBuilding(world, 'bed')) return 0;
      const room = heart(world);
      if (!room) return 0;
      // Against a wall rather than in the middle of the floor: a bed dropped in
      // the doorway of a one-room cabin is technically a bed and practically a
      // barricade. The outermost free cells are the wall line.
      for (const cell of freeCells(world, room).reverse()) {
        if (planBlueprint(world, 'bed', cell.x, cell.y)) return 1;
      }
      return 0;
    },
  },
  {
    id: 'shelter',
    says: 'The colony puts up another room — there are people sleeping in the open.',
    mark(world) {
      // Immediately below `beds`, and reached only when `beds` marked nothing:
      // the hall has run out of wall to put a bunk against. That is the moment a
      // growing colony starts leaving people outdoors, and a night outdoors is
      // the flu — see `tickGroundSleep`. Everything below this on the list is
      // something a colony with everybody under a roof can afford to want.
      const people = livingColonists(world).length;
      if (builtCount(world, 'bed') + builtCount(world, 'medbed') >= people) return 0;
      return growQuarters(world);
    },
  },
  {
    id: 'fields',
    says: 'The colony breaks more ground — the plot has stopped feeding everybody.',
    mark(world) {
      const people = livingColonists(world).length;
      const room = heart(world);
      if (!room) return 0;
      // Four cells a head. A cell ripens in three days and gives four raw, so it
      // runs at about 1.3 food a day; a colonist burns about 2.7. Two cells each
      // is therefore break-even in high summer and starvation in every other
      // season — crops stop entirely below 4 °C and winter is a quarter of the
      // year. Four is that break-even doubled, which is what a colony that has to
      // *store* five days of winter actually needs. Hunting and foraging stay a
      // surplus on top rather than the thing keeping everyone alive.
      const target = Math.min(people * 4, MAX_PLOT);
      // Counted on what will actually grow, not on what is painted. A cell with a
      // fence post on it is in the zone and produces nothing, and counting it is
      // how a colony convinces itself it has a farm while it starves.
      const sowable = growingCells(world).filter((c) => canSow(world, unpackX(world, c), unpackY(world, c)));
      if (sowable.length >= target) return 0;

      let plot = world.zones.find((z) => z.kind === 'growing' && z.cells.length > 0) ?? null;
      const b = boundsOf(world, room);
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      // Grow outward from the plot that exists; only a colony with no plot at all
      // gets a new one, laid behind the house like the starter garden.
      let fx = cx;
      let fy = b.y0 - YARD_MARGIN - 2;
      if (plot) {
        let sx = 0;
        let sy = 0;
        for (const c of plot.cells) {
          sx += unpackX(world, c);
          sy += unpackY(world, c);
        }
        fx = sx / plot.cells.length;
        fy = sy / plot.cells.length;
      }

      const ring = new Set(yardRing(world, room).map((c) => packCell(world, c.x, c.y)));
      const reach = HARVEST_RADIUS;
      const cand: { x: number; y: number; d: number }[] = [];
      for (let y = Math.round(fy) - reach; y <= Math.round(fy) + reach; y++) {
        for (let x = Math.round(fx) - reach; x <= Math.round(fx) + reach; x++) {
          const packed = packCell(world, x, y);
          if (!canSow(world, x, y)) continue;
          if (world.cellZone[packed]! >= 0) continue;
          // Never onto the fence line. The yard learned to go around a plot this
          // pass; painting a plot onto the yard would just start the same fight
          // from the other side.
          if (ring.has(packed)) continue;
          // Nor indoors: a bed of wheat across the cabin floor is not a farm, it
          // is the one room everybody has to walk through.
          if (indoors(world, x, y)) continue;
          if (dist(x, y, cx, cy) > HARVEST_RADIUS) continue;
          cand.push({ x, y, d: dist(x, y, fx, fy) });
        }
      }
      if (cand.length === 0) return 0;
      // Tight to the plot, so the field grows as a field rather than as a scatter
      // of squares somebody has to walk between.
      cand.sort((p, q) => p.d - q.d);

      if (!plot) plot = addZone(world, 'growing', []);
      let n = 0;
      for (const c of cand) {
        if (n >= BATCH || sowable.length + n >= target) break;
        addCellToZone(world, plot, c.x, c.y);
        n++;
      }
      return n;
    },
  },
  // Above `yard`, and that placement is the whole of the fix.
  //
  // A gate only makes sense once the line is nearly a line, and `mark` returns 0
  // until the ring is eighty per cent walled — so standing above `yard` costs
  // nothing while the fence is going up. Standing *below* it cost everything:
  // `yard` returns a number for as long as it has posts left to lay, so the gate
  // was only ever considered after the ring was closed, which is one tick too
  // late. Measured on seed 1312: on day 38 the last post went in and all seven
  // settlers spent three days inside a sixty-four cell pocket with fifty-four
  // walls and thirteen posts around it and not one door, unable to reach the
  // twenty-seven thousand cells of map they had been working that morning.
  //
  // Running twice over is not a risk: `tickSteward` will not reach any ambition
  // while a blueprint stands, so the door this plans blocks the next pass until
  // somebody hangs it.
  {
    id: 'gate',
    says: 'The colony hangs a gate in the yard fence.',
    mark(world) {
      const room = heart(world);
      if (!room) return 0;
      if (!affordsBuilding(world, 'door')) return 0;
      const ring = yardRing(world, room);
      // Only once the line is actually a line. A gate in a fence with three posts
      // in it is a door standing in a field.
      const walled = ring.filter((c) => ringDone(world, c.x, c.y)).length;
      if (walled < ring.length * 0.8) return 0;
      for (const c of ring) {
        const b = buildingAt(world, c.x, c.y);
        if (b && b.built && b.kind === 'door') return 0;
      }
      // The nearest fence post to the cabin door is where the path already wants
      // to go, so that is where the gate goes.
      const doors = world.buildings.filter((b) => b.built && b.kind === 'door');
      const from = doors[0] ?? { x: (boundsOf(world, room).x0 + boundsOf(world, room).x1) / 2, y: boundsOf(world, room).y0 };
      let best: Building | null = null;
      let bestD = Infinity;
      for (const c of ring) {
        const b = buildingAt(world, c.x, c.y);
        if (!b || !b.built || b.kind !== 'fence') continue;
        const d = dist(from.x, from.y, c.x, c.y);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (!best) return 0;
      const { x, y } = best;
      // Take the post out and put a gate in its place. Removal is deliberate and
      // local: this is the colony changing its own mind about one cell of its own
      // fence, not the deconstruct tool, so nothing the player marked is touched.
      removeBuilding(world, best);
      return planBlueprint(world, 'door', x, y) ? 1 : 0;
    },
  },
  {
    id: 'yard',
    says: 'The colony stakes out a fence line around the yard.',
    mark(world) {
      const room = heart(world);
      if (!room) return 0;
      const ring = yardRing(world, room);
      // Before adding to the line, take out anything left standing in the soil.
      // A post on a growing cell that the line no longer runs through is holding
      // nothing and costing a row of crops, and colonies that were already going
      // when the ring learned to go around a plot have six of them across the
      // kitchen garden. Bounded to posts *off* the line so a fence the player
      // deliberately painted a zone over is left alone.
      const online = new Set(ring.map((c) => packCell(world, c.x, c.y)));
      for (const packed of growingCells(world)) {
        if (online.has(packed)) continue;
        const b = buildingAt(world, unpackX(world, packed), unpackY(world, packed));
        if (!b || !b.built || b.kind !== 'fence') continue;
        removeBuilding(world, b);
        msg(world, 'A fence post is pulled out of the garden — that row can be sown again.');
        return 1;
      }
      if (!affords(world, 'wood', (defOf('fence').cost.wood ?? 0) * BATCH)) return 0;
      let n = 0;
      for (const cell of ring) {
        if (n >= BATCH) break;
        if (ringDone(world, cell.x, cell.y)) continue;
        if (canPlace(world, 'fence', cell.x, cell.y) !== 'ok') continue;
        if (planBlueprint(world, 'fence', cell.x, cell.y)) n++;
      }
      return n;
    },
  },
  {
    id: 'power',
    says: 'The colony builds out the grid — there is more plugged in than it can carry.',
    mark(world) {
      // Above `defence` because the guns are the biggest load on the list and the
      // shed order puts them last: a colony that buys its fourth turret before its
      // second generator has not defended itself, it has switched its own freezer
      // off to pay for the gun. Below the gate because a dark colony inside a
      // fence is safer than a lit one outside it.
      //
      // Measured over forty unattended days on three seeds before this existed:
      // one generator, every time, on every seed, for the whole run — the one
      // worldgen puts down. The foreman would build four turrets, a cooler's
      // worth of lamps and never once ask where the watts were coming from, and
      // on seed 4242 the colony's larder duly thawed on day twenty-eight.
      let demand = 0;
      for (const b of world.buildings) {
        if (!b.built) continue;
        demand += DRAW[b.kind] ?? 0;
      }
      if (demand === 0) return 0;

      const gens = builtCount(world, 'generator');
      // Only generators count towards carrying it. A panel is dark at night and a
      // mill is dead under ice, so a grid sized on either is a grid that fails on
      // exactly the nights it is least affordable to fail on. Both are worth
      // building — they are what stops the firebox eating a tree a day — but
      // neither is what the floor is measured in.
      const want = Math.min(MAX_GENERATORS, Math.ceil((demand + GRID_HEADROOM) / GENERATOR_OUTPUT));

      let kind: BuildingKind | null = null;
      if (gens < want) kind = 'generator';
      else if (buildingUnlocked(world, 'solar') && builtCount(world, 'solar') < Math.min(MAX_PANELS, gens)) {
        kind = 'solar';
      } else if (
        // A bank is not capacity, it is a bridge — the twenty minutes between the
        // sun going and the firebox catching. So it waits until the colony owns
        // something on the grid that must not go out in those twenty minutes.
        // Before there is a cooler or a heater, the worst a gap costs is a dark
        // room, and twenty-five steel is a turret.
        world.buildings.some((b) => b.built && (b.kind === 'cooler' || b.kind === 'heater')) &&
        builtCount(world, 'battery') < Math.min(MAX_BANKS, gens)
      ) {
        kind = 'battery';
      }
      if (!kind) return 0;
      if (!affordsBuilding(world, kind)) return 0;

      const spot = gridSpot(world, kind);
      if (!spot) return 0;
      return planBlueprint(world, kind, spot.x, spot.y) ? 1 : 0;
    },
  },
  {
    id: 'defence',
    says: 'The colony sets a turret to watch the approach.',
    mark(world) {
      const room = heart(world);
      if (!room) return 0;
      // One turret, then one for every three settlers, and never more than four.
      // A turret is thirty steel and forty-five watts standing still; the point of
      // the ladder is that a colony of three does not spend its whole steel bar on
      // guns it has nobody to stand behind, and a colony of nine is not defended
      // by the same single emplacement it built on day four.
      const want = Math.min(4, 1 + Math.floor(livingColonists(world).length / 3));
      if (builtCount(world, 'turret') >= want) return 0;

      const b = boundsOf(world, room);
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      // One cell inside the fence line: covered by the boundary, close enough to
      // the house that a settler can get behind it, and out of the doorway.
      const inner = yardRing(world, room).map((c) => ({
        x: c.x + Math.sign(cx - c.x),
        y: c.y + Math.sign(cy - c.y),
      }));

      // A gun with no current is thirty steel of scenery, and `wiring` will only
      // run cable to a network that already has something feeding it — so the
      // colony buys the generator before it buys the first turret. Outdoors,
      // always: a firebox in a one-room cabin is a smoke-filled room and a fire
      // waiting for a windy night.
      const powered = world.buildings.some((p) => p.built && isSource(p.kind));
      if (!powered) {
        if (!affordsBuilding(world, 'generator')) return 0;
        for (const c of inner) {
          if (indoors(world, c.x, c.y)) continue;
          if (world.cellZone[packCell(world, c.x, c.y)]! >= 0) continue;
          if (canPlace(world, 'generator', c.x, c.y) !== 'ok') continue;
          if (planBlueprint(world, 'generator', c.x, c.y)) return 1;
        }
        return 0;
      }

      if (!affordsBuilding(world, 'turret')) return 0;
      const guns = world.buildings.filter((p) => p.kind === 'turret');
      let best: { x: number; y: number } | null = null;
      let bestScore = -Infinity;
      for (const c of inner) {
        if (world.cellZone[packCell(world, c.x, c.y)]! >= 0) continue;
        if (canPlace(world, 'turret', c.x, c.y) !== 'ok') continue;
        // Spread first, gate second. Two turrets on the same corner cover one
        // approach twice and the other three not at all; the tie-break pulls the
        // first one toward the way in, which is where anything hostile arrives.
        const spread = guns.length === 0 ? 0 : Math.min(...guns.map((g) => dist(g.x, g.y, c.x, c.y)));
        const gate = world.buildings.find((p) => p.built && p.kind === 'door' && dist(p.x, p.y, cx, cy) > YARD_MARGIN);
        const score = spread * 4 - (gate ? dist(gate.x, gate.y, c.x, c.y) : 0);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (!best) return 0;
      return planBlueprint(world, 'turret', best.x, best.y) ? 1 : 0;
    },
  },
  {
    id: 'sickbay',
    says: 'The colony builds a bed for the sick to get better in.',
    mark(world) {
      // Everything a sickbay needs was already here. `immunityScale` gives a
      // medbed 1.3 against a plain bunk's 1.0, and `findFreeBed` already pulls an
      // ill settler towards one and a well settler away from it (`SICKBAY_PULL`).
      // The only missing piece was somebody to order one: no ambition planned a
      // `medbed`, worldgen places none, so on a colony nobody is clicking the
      // whole ward was dead code. Measured on seed 7 over forty days: zero
      // medbeds ever built, and of all the time settlers spent ill, none of it
      // was spent anywhere better than a bunk.
      //
      // Below `defence`, and that is a steel decision rather than a medical one.
      // A medbed is twelve steel and a turret is forty; a colony that spends the
      // ward's steel first is a colony nursing the wounds it would not have taken.
      //
      // Above `quarters` because a bed the sick get better in is not a comfort
      // and a room of one's own is.
      const people = livingColonists(world).length;
      // Only once everybody has somewhere to sleep at all. A ward built while
      // settlers are on the floor is a bed the healthy will end up in, which is
      // the one thing `SICKBAY_PULL` exists to prevent.
      if (builtCount(world, 'bed') + builtCount(world, 'medbed') < people) return 0;
      // One ward bed per four settlers, and never more than two. A third is
      // twenty wood and twelve steel standing empty for the ninety per cent of
      // the time nobody is ill, and this colony has walls to pay for.
      const want = Math.min(2, Math.ceil(people / 4));
      // Counting only what stands is safe here for the reason it is safe in
      // `beds`: `boardClear` stops the whole list while any blueprint is up, so
      // there is never an unbuilt medbed for this to double up on.
      if (builtCount(world, 'medbed') >= want) return 0;
      if (!affordsBuilding(world, 'medbed')) return 0;
      const room = heart(world);
      if (!room) return 0;
      // Against a wall, for the reason the hall's own bunks are: see `beds`.
      for (const cell of freeCells(world, room).reverse()) {
        if (planBlueprint(world, 'medbed', cell.x, cell.y)) return 1;
      }
      return 0;
    },
  },
  {
    id: 'cells',
    says: 'The colony walls off a cell, so the next raider it drops can be taken alive.',
    mark(world) {
      // One built prisonbed is the entire condition on the warden's capture path
      // (`jobs.ts`, the `warden` work type): with none standing, a downed raider
      // is not a prisoner, they are a body waiting to bleed out. No ambition ever
      // planned one, so on a colony nobody is clicking the prison — capture,
      // feeding, recruitment, the resistance clock, all of it — was code that
      // could not run. Measured on seed 7 over forty days: eighteen raiders lay
      // on the ground alive and every one of them was left there.
      //
      // Above `quarters`, with the fairness written out below rather than
      // implied by the order — and that swap is the whole of the second fix here.
      //
      // It sat *below* `quarters` first, on the reasoning that settlers should
      // get rooms of their own before the colony builds one for somebody who came
      // to kill them, and that `quarters` returns 0 the moment nobody is
      // unhoused. The second half of that is true and useless: `quarters` never
      // gets there. Measured over forty harsh days, seed 7 ended with three
      // settlers still without a room and 99001 with four — a colony gains people
      // faster than `growQuarters` walls corners for them — so `cells` was never
      // reached on any seed and not one prisonbed was ever built. That is the
      // trap the note on `quarters` describes: a want the list can never get to
      // is not a low priority, it is a feature that does not exist.
      //
      // So the policy is stated as a condition instead of a position: somebody
      // must already have a room of their own. The colony has to have proved it
      // can carve a room and given the first one away before it walls one for a
      // prisoner.
      if (!buildingUnlocked(world, 'prisonbed')) return 0;
      // And only once there is a gun on the wall. A cell is an invitation to hold
      // somebody who wants out; a colony that cannot win the fight it is already
      // in has no business starting a second one indoors.
      if (builtCount(world, 'turret') === 0) return 0;
      if (livingColonists(world).length - unhoused(world).length < 1) return 0;
      if (builtCount(world, 'prisonbed') >= 1) return 0;

      // A room with a door, not a bunk in the corner of the hall. The isolation
      // is the point — it is the same reason the sick and the well sleep apart —
      // and `bedlessRooms` now counts a prison bunk as claiming its room, so
      // `quarters` will not follow this in and put a settler next to the raider.
      // Every empty room gets asked, not just the first one — the same loop
      // `growQuarters` runs, for the same reason. This map generates caves, a
      // cave is a small enclosed room, and `bedlessRooms` returns them in index
      // order: taking `[0]` handed the bunk to a hole in the rock, failed to
      // place it there, and reported "no cell block today" forever while a
      // finished room stood empty three cells from the door.
      if (affordsBuilding(world, 'prisonbed')) {
        for (const room of bedlessRooms(world)) {
          // Against a wall, like every other bunk this colony lays: see `beds`.
          for (const cell of freeCells(world, room).reverse()) {
            if (planBlueprint(world, 'prisonbed', cell.x, cell.y)) return 1;
          }
        }
      }
      return carveRoom(world);
    },
  },
  {
    id: 'quarters',
    says: 'The colony walls off a room of somebody’s own.',
    mark(world) {
      // Below the guns and above everything decorative, which is the line
      // between a colony that is safe and a colony that is somewhere to live.
      //
      // It sat under `comfort` first and measured at never: twenty days on seed
      // 4242 and the Steward was still on the fence — `yard` marked something on
      // eighteen of them — so not one ambition below the gate was reached at all
      // and no colony was ever going to see a bedroom. A want the list can never
      // get to is not a low priority, it is a feature that does not exist.
      //
      // Above `wiring` on purpose: a room with a lamp in it is what gives wiring
      // something to chase, so building the room first is what puts the grid in
      // the bedrooms rather than only in the yard.
      if (unhoused(world).length === 0) return 0;
      return growQuarters(world);
    },
  },
  {
    id: 'wiring',
    says: 'The colony runs conduit out to something that is not plugged in.',
    mark(world) {
      // Above the floors and the furniture because an unpowered turret is forty
      // steel standing in the yard doing nothing, and the player who paid for it
      // reads a dark turret as a broken turret rather than as an errand. It is
      // also the cheapest ambition on the list: conduit is a wood or two a cell.
      if (!affordsBuilding(world, 'conduit')) return 0;

      // Which networks can actually supply anything. A conduit run to a second
      // dead turret joins two things that are both off.
      const live = new Set<number>();
      for (const net of powerNetworks(world)) {
        if (!net.some((b) => isSource(b.kind))) continue;
        for (const b of net) live.add(b.id);
      }
      if (live.size === 0) return 0;

      // Every orphan gets asked, not just the first one in the list. A machine
      // walled off from the grid — behind a lake, or inside a store room whose
      // door the player later bricked up — is a permanent no, and stopping at it
      // would leave the three reachable turrets dark on its account forever.
      for (const orphan of world.buildings) {
        if (!orphan.built || !isElectrical(orphan.kind) || isSource(orphan.kind)) continue;
        if (live.has(orphan.id)) continue;

        const route = wireRoute(world, orphan, live);
        if (!route) continue;

        let n = 0;
        for (const c of route) {
          if (n >= BATCH) break;
          // Already carrying current — a door, the cabin wall, a spur laid on an
          // earlier pass. Stepped over, not stopped at.
          if (buildingAt(world, c.x, c.y)) continue;
          if (planBlueprint(world, 'conduit', c.x, c.y)) n++;
        }
        if (n > 0) return n;
      }
      return 0;
    },
  },
  {
    id: 'knowhow',
    says: 'The colony clears a corner for a workbench and a place to think.',
    mark(world) {
      const room = heart(world);
      if (!room) return 0;
      // The two benches nothing else on this list ever marks, and the reason a
      // ninety-day colony measured on three seeds finished with `bench:0 lab:0
      // research done 0 current null`. Everything gated behind the tech tree —
      // stone walls, solar, the mill, every crafting recipe, every `*Scale`
      // bonus in `research.ts` — was unreachable in a game nobody was clicking
      // through, which is most games after the first hour.
      //
      // The workbench comes first because it is cheaper, because it is the only
      // way the colony turns steel into a rifle or a herb into a dose, and
      // because half of what the research bench unlocks is recipes that need one
      // to mean anything.
      //
      // Behind the defences on purpose: a colony that studies before it can
      // shoot back does not finish the project. Ahead of the floors, because
      // boarding a cabin eight cells at a time is a fortnight of work that
      // changes nothing, and this is the difference between a colony that gets
      // better at things and one that does not.
      const want: Building['kind'] | null =
        builtCount(world, 'bench') === 0 ? 'bench' : builtCount(world, 'lab') === 0 ? 'lab' : null;
      if (!want) return 0;
      if (!affordsBuilding(world, want)) return 0;
      // Reversed, so the bench goes against the back wall rather than into the
      // middle of the room everybody walks through to reach the door.
      for (const cell of freeCells(world, room).reverse()) {
        if (planBlueprint(world, want, cell.x, cell.y)) return 1;
      }
      return 0;
    },
  },
  {
    id: 'floors',
    says: 'The colony marks the cabin floor for boards.',
    mark(world) {
      if (!affords(world, 'wood', 3 * BATCH)) return 0;
      const room = heart(world);
      if (!room) return 0;
      let n = 0;
      for (const packed of room.cells) {
        if (n >= BATCH) break;
        const x = packed % world.width;
        const y = (packed - x) / world.width;
        if (!canFloor(world, x, y, 'plank')) continue;
        world.cellDesig[packCell(world, x, y)] = DESIG_FLOOR_PLANK;
        n++;
      }
      return n;
    },
  },
  {
    id: 'comfort',
    says: 'The colony finds room for somewhere to spend an evening.',
    mark(world) {
      const room = heart(world);
      if (!room) return 0;
      // A second place to sit only once there is a bed each and the fire is not
      // the only one. Anything in `REC_SPOTS` counts, so this stays true if more
      // places to sit are added later.
      //
      // Counted in *seats*, not in furniture, and against the population. The old
      // rule was three pieces of furniture full stop, and the starter cabin ships
      // with two tables — so every colony ever built exactly one game table and
      // then declared the evenings solved, for nine people, on two seats and a
      // bench. `nothing to do` was the second-largest drag on morale on every day
      // of every seed I measured. One seat each plus a spare is the bar.
      const seats = world.buildings.reduce(
        (n, b) => n + (b.built ? (REC_SPOTS[b.kind]?.seats ?? 0) : 0),
        0,
      );
      if (seats >= livingColonists(world).length + 1) return 0;
      if (!affordsBuilding(world, 'gametable')) return 0;
      for (const cell of freeCells(world, room)) {
        if (planBlueprint(world, 'gametable', cell.x, cell.y)) return 1;
      }
      return 0;
    },
  },
  {
    id: 'statue',
    says: 'The colony puts up a statue, because somebody thought the place could use one.',
    mark(world) {
      const room = heart(world);
      if (!room) return 0;
      if (builtCount(world, 'statue') >= 2) return 0;
      // Steel-priced, so this is the last thing a colony does with a surplus.
      if (!affords(world, 'steel', (defOf('statue').cost.steel ?? 0) + 60)) return 0;
      for (const cell of freeCells(world, room).reverse()) {
        if (planBlueprint(world, 'statue', cell.x, cell.y)) return 1;
      }
      return 0;
    },
  },
  {
    id: 'cover',
    says: 'The colony piles sandbags either side of the gate.',
    mark(world) {
      if (world.stats.raidersKilled < 1 && world.storyteller.threatsFired < 1) return 0;
      if (!affordsBuilding(world, 'sandbag')) return 0;
      const room = heart(world);
      if (!room) return 0;
      const gate = yardRing(world, room)
        .map((c) => buildingAt(world, c.x, c.y))
        .find((b): b is Building => b !== null && b.kind === 'door');
      if (!gate) return 0;
      let n = 0;
      // A short line inside the gate: somewhere to fight from that faces the way
      // anything coming through it has to arrive.
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, -1],
      ]) {
        if (n >= 4) break;
        const x = gate.x + dx * 2;
        const y = gate.y + dy * 2;
        if (canPlace(world, 'sandbag', x, y) !== 'ok') continue;
        if (planBlueprint(world, 'sandbag', x, y)) n++;
      }
      return n;
    },
  },
];

/**
 * Is the Steward switched on for this colony?
 *
 * Absent reads as on, which is both the sane default for a new game and what an
 * older save has to mean — the field did not exist when it was written, and a
 * colony that loads with its foreman mysteriously asleep is a bug the player
 * cannot see the cause of.
 */
export function stewardOn(world: World): boolean {
  return world.steward !== false;
}

/**
 * Days of food below which the bench should care about the pantry.
 *
 * Deliberately not `alerts.ts`'s four-day warning, and the gap between them is
 * the point. An alert is *act today* — sow something, go hunting, cook what is
 * in the store — and a colony four days from empty cannot be helped by anything
 * a settler starts reading this afternoon. The bench works on a horizon of days
 * to a week, so the question it should be asked is the slower one: is the pantry
 * thin enough that a third more out of every meal, for ever, is worth an
 * afternoon now?
 *
 * A fortnight, because the sixty-day grid ends hard country somewhere between
 * five and twenty days of food and the quiet valley between forty and sixty. So
 * this is the number that has harsh colonies studying preserves and leaves calm
 * ones free to study whatever comes next — which is the whole behaviour, visible
 * in one constant.
 */
const LEAN_DAYS = 15;

/** Stores this far under the floor is a colony that wants sharper tools. */
const SPENT_STORES = 0.5;

/**
 * How badly the colony has to want a thing before it reorders its own work.
 *
 * A want with no floor under it is not a preference, it is a tiebreak — and it
 * wins every tie, because the thing it is bidding against scores exactly zero.
 * `available[0]` has no want on it at all; it is there because the tree is
 * ordered. So *any* reading above nothing took the bench.
 *
 * calm/99001 is the whole argument, and it took a tick-by-tick probe to see it
 * because the grid only reports endings. Day eight, thirteen days and change of
 * food in the store, nobody hurt, nobody cold: `hunger` read **0.05**, and five
 * percent was enough to put eleven thousand points of salting in front of the
 * tree. Day eleven, fourteen and a half days of food, it read 0.02 and bought
 * fifteen thousand points of raised beds. That colony finished its sixty days
 * with five projects done against sixteen, seven hands against thirteen, and one
 * trade party past the near ring against ten. Nothing was ever wrong with it. It
 * was simply never quite comfortable, and a scorer with no floor under it reads
 * "not quite comfortable" as "drop everything".
 *
 * One settler in three, because three is what a colony is founded with — the
 * smallest share that is a fact about a settlement rather than about one person
 * having a bad week. `fieldmedicine` and `weaving` are shares of the colony
 * outright, so it means precisely that. `hunger` measures a fortnight, so it
 * means ten days of food left, which is where a colony starts planning around
 * its pantry instead of merely noticing it.
 *
 * Applied here rather than in `pickProject` so one number means one thing
 * everywhere: below the floor there is no want, so the log line names no
 * pressure, the research panel prints no reason, and the bench works down the
 * tree. One behaviour, described the same way in three places.
 */
const WORTH_THE_BENCH = 1 / 3;

/**
 * A reason to study something *now*.
 *
 * Mirrors `Ambition` on purpose, down to the `says` line: an id, what the colony
 * says when it takes the work up, and one function that reads the world and
 * answers how badly. Anything not in this table wants nothing on its own, which
 * is not the same as never being chosen — see `wantOf`.
 */
interface Want {
  id: ResearchId;
  /**
   * Present tense, and it names the pressure rather than the project. The player
   * should be able to read the line in the log and agree with the choice without
   * opening the research panel.
   */
  says: string;
  /** 0 is "no reason today"; 1 is "this is the worst thing about this colony". */
  want(world: World): number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** How thin the pantry is, on the bench's horizon rather than the alert bar's. */
function hunger(world: World): number {
  return clamp01((LEAN_DAYS - foodDays(world)) / LEAN_DAYS);
}

/** Whether the last raid drew blood. Nothing before the first raid. */
function bloodied(world: World): boolean {
  const st = world.storyteller;
  return st.threatsFired > 0 && (st.unbloodied ?? 1) === 0;
}

/**
 * What the colony is short of, project by project.
 *
 * Seven entries against nineteen projects, and the emptiness is deliberate:
 * a want belongs here only where there is a signal the colony already keeps for
 * its own reasons and where the project genuinely answers it. `apprenticeship`
 * is the clearest omission and the clearest case — its whole design is that it
 * is worth taking *early* and worth nothing late, which is a judgement about the
 * calendar and not about any pressure the colony is under. A scorer for it would
 * be a number invented to look like a measurement.
 */
const WANTS: Want[] = [
  {
    id: 'toolmaking',
    says: 'The colony puts somebody on toolmaking — the stores go down faster than they come in.',
    want: (world) =>
      clamp01(
        Math.max(
          (WOOD_FLOOR * SPENT_STORES - countResource(world, 'wood')) / (WOOD_FLOOR * SPENT_STORES),
          (STEEL_FLOOR * SPENT_STORES - countResource(world, 'steel')) / (STEEL_FLOOR * SPENT_STORES),
        ),
      ),
  },
  {
    id: 'preserves',
    says: 'The colony takes up preserving — the pantry will not last the month as it is.',
    want: hunger,
  },
  {
    id: 'soilbeds',
    // Only with something planted. A colony with no plot gets nothing at all from
    // a faster plot, however hungry it is, and a want that fires anyway would
    // send a starving colony to read about drainage instead of about salt.
    says: 'The colony studies its beds — the plot has to come in faster than this.',
    want: (world) => (growingCells(world).length > 0 ? hunger(world) : 0),
  },
  {
    id: 'fieldmedicine',
    says: 'The colony turns to field medicine — there are more people to treat than hands to treat them.',
    want: (world) => {
      const living = livingColonists(world);
      if (living.length === 0) return 0;
      // Down counts whole and ill counts half: one is somebody bleeding on the
      // floor and the other is somebody who will be at work tomorrow.
      const hurt = living.reduce((n, p) => n + (p.downed ? 1 : (p.ailments?.length ?? 0) > 0 ? 0.5 : 0), 0);
      return clamp01(hurt / living.length);
    },
  },
  {
    id: 'stonecutting',
    // Wanted for the stone wall it unlocks, so it wants a timber perimeter to
    // replace. A colony with nothing built to keep anybody out is not short of
    // masonry; it is short of a wall, and that is the Steward's other half.
    says: 'The colony sends for stone — timber did not hold the last time.',
    want: (world) =>
      bloodied(world) && world.buildings.some((b) => b.built && (b.kind === 'fence' || b.kind === 'wall')) ? 1 : 0,
  },
  {
    id: 'rifling',
    says: 'The colony works on its barrels — the last raid cost more than it should have.',
    want: (world) => (bloodied(world) ? 1 : 0),
  },
  {
    id: 'weaving',
    // `COLD_BELOW` and not "below comfortable", which is the difference between a
    // pressure and a weather report. `comfortAt` puts a clear night outdoors near
    // −0.46 with nothing on, so every colony ever founded is *below comfortable*
    // on its first night — a want reading 1.0 in every game on day eight is a
    // constant wearing a measurement's clothes, and it cost two grid colonies
    // their founding by putting twenty-two thousand points of coats in front of
    // the six-thousand-point axe. `COLD_BELOW` is the line health.ts already draws
    // and already charges for: past it the immune system starts paying.
    says: 'The colony gets to work on coats — somebody is out there cold.',
    want: (world) => {
      const living = livingColonists(world);
      if (living.length === 0) return 0;
      return clamp01(living.filter((p) => (p.comfort ?? 0) < COLD_BELOW).length / living.length);
    },
  },
];

/**
 * A project is worth what it is worth, or what the best thing behind it is worth
 * — whichever is larger.
 *
 * This is the part that makes need-driven picking work at all. Every want in the
 * table above is on a project some colony cannot yet reach: parkas are two
 * projects deep and stone is behind toolmaking, so a colony freezing to death
 * would score `weaving` at 1.0, find it unavailable, and study something else
 * for ever. So a want propagates *down* its prerequisites — the cold colony sees
 * `tanning` scoring what the parka scores, takes it, and arrives at the parka
 * next pass, which is what a person planning would have done.
 *
 * The tree is nineteen nodes and acyclic, so this is a memoised walk and not
 * worth being cleverer about.
 */
export interface Wanted {
  /** The best want reachable from here, this project's own included. */
  score: number;
  /**
   * Which project that want is actually *on* — the same id when the colony wants
   * this thing for itself, and the one further up when this is the prerequisite
   * standing in for it. Null when nothing wants this at all. It is what lets the
   * log say "somebody is out there cold" over a settler sitting down to study
   * tanning, which is the sentence that makes the choice legible.
   */
  because: ResearchId | null;
}

export function researchWants(world: World): Map<ResearchId, Wanted> {
  const raw = new Map<ResearchId, number>();
  // Below the floor is not a small want; it is no want at all. See
  // `WORTH_THE_BENCH` — a pressure nobody would change their plans over is a
  // reading, not a reason, and the tree is what a colony does when it has none.
  for (const w of WANTS) {
    const score = w.want(world);
    raw.set(w.id, score >= WORTH_THE_BENCH ? score : 0);
  }

  const leadsTo = new Map<ResearchId, ResearchId[]>();
  for (const def of Object.values(RESEARCH)) {
    for (const need of def.needs) {
      const list = leadsTo.get(need);
      if (list) list.push(def.id);
      else leadsTo.set(need, [def.id]);
    }
  }

  const out = new Map<ResearchId, Wanted>();
  const scoreOf = (id: ResearchId): Wanted => {
    const seen = out.get(id);
    if (seen !== undefined) return seen;
    const own = raw.get(id) ?? 0;
    let best: Wanted = { score: own, because: own > 0 ? id : null };
    // Written before the recursion so a malformed tree cannot hang the sim.
    out.set(id, best);
    for (const next of leadsTo.get(id) ?? []) {
      const up = scoreOf(next);
      // Strictly greater, so a want on this project beats an equal one behind it
      // and the colony is told about the thing it is doing now.
      if (up.score > best.score) best = { score: up.score, because: up.because };
    }
    out.set(id, best);
    return best;
  };
  for (const def of Object.values(RESEARCH)) scoreOf(def.id);
  return out;
}

/**
 * The colony's argument for each project, in its own words.
 *
 * The log line the Steward writes when it takes something up scrolls away inside
 * an afternoon, and the research panel is where a player goes to ask "why is
 * *that* on the bench". A colony that is freezing and studying tanning looks
 * exactly like a colony that has lost the plot until the panel says the word
 * cold. Projects nothing argues for are absent rather than present and empty,
 * so the caller can ask the map and get a straight answer.
 *
 * Read-only, and derived entirely from `researchWants` — one walk of the tree
 * for a whole panel, which is why it hands back a map rather than answering one
 * project at a time.
 */
export function researchReasons(world: World): Map<ResearchId, string> {
  const out = new Map<ResearchId, string>();
  for (const [id, w] of researchWants(world)) {
    if (w.because === null) continue;
    const says = WANTS.find((x) => x.id === w.because)?.says;
    if (says !== undefined) out.set(id, says);
  }
  return out;
}

/**
 * Keep a project on the bench, and keep the right one on it.
 *
 * `setProject` had exactly two callers in the whole game: the eval harness, and
 * a human clicking the Research panel. So an unattended colony left
 * `world.research.current` at `null` for ever — the bench it had just paid forty
 * five materials for stood there being furniture, and the entire tech tree plus
 * everything gated behind it was dead content. Ninety days on three seeds:
 * `research done 0`.
 *
 * That was fixed by taking `available(world)[0]`, which is `RESEARCH_ORDER` with
 * the prerequisites filtered out. It made the bench work and it made every
 * colony identical: a settlement under siege with a timber wall studied Tanning
 * because the list said Tanning, and a player watching it could tell the colony
 * was reading from a curriculum rather than looking out of the window.
 *
 * So the order is now the *tiebreak* rather than the rule. `researchWants` reads
 * the colony, the highest want wins, and ties fall through to `RESEARCH_ORDER`
 * exactly as before — which is worth stating plainly, because it means a colony
 * with nothing pressing behaves precisely as it did before this change. The
 * comparison is strict `>` for that reason.
 *
 * Not scaled by cost. A cheap project that answers nothing still loses to an
 * expensive one that answers the worst thing about the colony, because the
 * horizon of a want is the rest of the run and not this week. Where nothing is
 * pressing, `RESEARCH_ORDER` is already roughly cheapest-first, so the cheap
 * ordering survives exactly where it is the only thing to go on.
 *
 * Only ever fills a hole, never overrides: if the player has chosen something,
 * `current` is not null and this does nothing. The player who wants a *different*
 * project clicks it and keeps it — the Steward will not take it back. The player
 * who wants no research at all turns the Steward off, which is the same switch
 * that stops it marking fences.
 *
 * Deliberately not gated on the build board. Choosing what to study is not
 * marking a blueprint, it costs nothing, and it competes with the player's plan
 * for nobody's time — a colony with a fortnight of building queued should still
 * be learning something while it hammers.
 */
export function pickProject(world: World): boolean {
  if (world.research.current !== null) return false;
  // A project with nowhere to work on it is a HUD bar that never moves.
  if (!world.buildings.some((b) => b.built && b.kind === 'lab')) return false;
  const open = available(world);
  let next = open[0];
  if (!next) return false;
  const wants = researchWants(world);
  let best = wants.get(next.id)?.score ?? 0;
  for (const def of open) {
    const w = wants.get(def.id)?.score ?? 0;
    if (w > best) {
      best = w;
      next = def;
    }
  }
  // The pressure's own words when there is one, and the plain line when the
  // colony is comfortable enough to simply work down the tree.
  const because = wants.get(next.id)?.because;
  const said = because ? WANTS.find((w) => w.id === because)?.says : undefined;
  msg(
    world,
    said === undefined
      ? `The colony takes up ${next.label} at the research bench.`
      : because === next.id
        ? said
        : `${said} They need ${next.label} first.`,
    'info',
  );
  setProject(world, next.id);
  return true;
}

export function setSteward(world: World, on: boolean): void {
  world.steward = on;
  msg(world, on ? 'The Steward takes up the plans again.' : 'The Steward stands down; the colony builds only what you mark.', 'info');
}

/**
 * One planning pass.
 *
 * Everything that makes this safe is in the guards at the top: switched on, quiet
 * outside, daylight, and nothing already marked. What follows is a walk down the
 * ambitions in order, and the first one that marks anything ends the pass.
 */
/**
 * The one ambition allowed to run over a board that is not clear.
 *
 * Found by id rather than taken as `AMBITIONS[0]`, so reordering the list to
 * change what the colony cares about first cannot silently change what it is
 * allowed to do when it is stuck.
 */
const STORES = AMBITIONS.find((a) => a.id === 'stores')!;

/**
 * Is the board stuck for want of something nobody can go and get?
 *
 * `boardClear` freezes every ambition while a blueprint stands, which is right —
 * the Steward must not queue a second project over a stalled first. But fetching
 * the timber the stalled first is waiting for is not a second project, and
 * without this the gate is a trap that springs itself: a colony that runs out of
 * wood halfway along a fence can never order another tree cut, because the
 * unbuilt fence is the thing stopping it. Measured on seed 99001 at forty days —
 * thirty-five frames standing, not one plank on the map, no designations, and
 * five of six settlers idle in the yard.
 *
 * "Nobody can go and get it" is `countResource === 0`: none anywhere, in any
 * pile, on the whole map. That reading is only trustworthy because a stack can no
 * longer be walled over — see `shoveItemsClear`. While it could, the colony
 * counted forty-nine planks it had entombed and concluded it was fine.
 *
 * An outstanding designation means somebody is already out there with an axe, so
 * the board is moving and this is not the moment to mark eight more trees.
 */
function boardStarved(world: World): boolean {
  for (let i = 0; i < world.cellDesig.length; i++) {
    if (world.cellDesig[i] !== DESIG_NONE) return false;
  }
  for (const b of world.buildings) {
    if (b.built) continue;
    const missing = missingResource(b);
    if (missing && countResource(world, missing.kind) === 0) return true;
  }
  return false;
}

export function tickSteward(world: World): void {
  if (!stewardOn(world) || world.gameOver) return;
  if (world.tick % STEWARD_INTERVAL !== 0) return;
  // Not while there is shooting: a blueprint marked mid-raid is a settler sent
  // out to stand in the open and hammer it. Same reasoning as `rebuild.ts`.
  if (hostiles(world).length > 0) return;
  // Not at night either. The plan can wait until morning, and a colony that lays
  // out a fence at three in the morning reads as a glitch rather than as work.
  if (isSleepHours(world)) return;
  if (livingColonists(world).length === 0) return;
  // Above the board check, and the only thing here that is: see `pickProject`.
  // Everything below this line spends materials and competes with the player's
  // own queue. Choosing what to study does neither.
  pickProject(world);
  if (!boardClear(world)) {
    // Stuck, and stuck on something the colony does not have. Send people out
    // for it — and nothing else, because everything below this line would be
    // starting a second thing while the first is still standing half-built.
    if (!boardStarved(world)) return;
    const n = STORES.mark(world);
    if (n > 0) {
      if (world.stewardLast !== STORES.id) msg(world, STORES.says, 'info');
      world.stewardLast = STORES.id;
    }
    return;
  }

  for (const ambition of AMBITIONS) {
    const n = ambition.mark(world);
    if (n > 0) {
      // Once per ambition, not once per batch. A fence goes up eight posts at a
      // time and takes a fortnight; a line in the log every time another eight
      // are marked is fourteen identical messages, and the log holds eighty —
      // the colony would talk over its own story. The player is told when the
      // colony starts something new, which is the only part that is news.
      if (world.stewardLast !== ambition.id) msg(world, ambition.says, 'info');
      world.stewardLast = ambition.id;
      return;
    }
  }
}
