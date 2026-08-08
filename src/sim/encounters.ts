/**
 * The storyteller's other beats — the ones that are not a raid, a fire or a
 * maddened animal.
 *
 * Three of them, and they are deliberately three *different shapes* of event
 * rather than three more attacks. A raid asks whether the colony can shoot; these
 * ask whether it can decide. Somebody is running for the gate with two slavers
 * behind them and the settlers are half a map away — go, or bar the door? The
 * grid is dead for a day and the turrets with it — where does that leave the
 * night? A herd is crossing the valley and will be gone by tomorrow — is anyone
 * free to hunt? None of them can be answered by drafting everybody, which is what
 * makes them worth having on a map this size: the walk itself is now a cost.
 *
 * Everything here draws from the story stream and touches nothing else, so a beat
 * landing can never shift the weather or a bullet. New state hangs off optional
 * fields, so a colony saved before any of this existed loads with a quiet sky and
 * no herd, which is what it had.
 */

import { canStep, dist, isWalkable, nearestWalkable } from './grid';
import { livestock } from './livestock';
import { findPath } from './path';
import { isElectrical } from './power';
import { Rng } from './rng';
import type { Pawn, SkillName, World } from './types';
import { packCell, TICKS_PER_DAY } from './types';
import { PACK_MIN, PACK_SPAN, PACK_STAY } from './predators';
import { spawnAnimal } from './wildlife';
import { makePawn } from './worldgen';
import { livingColonists, msg } from './world';
import { remember } from './lifelog';

/**
 * Where a newcomer can walk in from and actually reach the colony.
 *
 * A walkable cell is not enough. Worldgen fences parts of the map off in rock,
 * and a settler dropped inside one of those pockets is stranded for good: seed
 * 99001 walked Ivet Marrowes in at (17,60), where every job in the colony was
 * unreachable, so she stood still with no job at all and starved to death two
 * days later while the colony sat on three weeks of food. A raid that lands in a
 * pocket has the retreat path to fall back on (`findEdgePath`); an arrival has
 * nothing, so the spot has to be checked before anybody stands on it.
 *
 * `minRun` is what a chase needs and a quiet arrival does not: a refugee who
 * appears twelve cells from the gate is not a decision, they are a notification.
 *
 * `latch` is who is arriving. People work doors, so a pocket whose only way out
 * is through somebody's cabin is a fine place to walk a refugee in. Wildlife does
 * not, and asking the wrong question is how seed 18 staged a herd at (16,124) —
 * a corner the colony could reach and no mossback could leave, so the animals
 * spawned and the crossing never happened. What the spot has to be reachable
 * *by* is whatever is about to stand on it.
 */
export function arrivalSpot(
  world: World,
  rng: Rng,
  minRun = 0,
  latch = true,
): { x: number; y: number } | null {
  const anchor = livingColonists(world)[0];
  if (!anchor) return null;
  const hx = Math.round(anchor.x);
  const hy = Math.round(anchor.y);
  // What "can reach the colony" means depends on who is arriving. For people it
  // is the settler's own cell. For anything door-blind it cannot be: that
  // settler is very often asleep in a bed, a bed is behind a door, and a flood
  // that treats the door as a wall would then decline every spot on the map —
  // so wildlife is asked to reach the *yard*, meaning any open ground within a
  // few paces of them, which is where a wolf or a mossback was ever going.
  const goals = latch ? undefined : yard(world, hx, hy);
  if (goals && goals.size === 0) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const side = rng.int(4);
    const along = 8 + rng.int(world.width - 16);
    const edge =
      side === 0
        ? { x: along, y: 3 }
        : side === 1
          ? { x: along, y: world.height - 4 }
          : side === 2
            ? { x: 3, y: along }
            : { x: world.width - 4, y: along };
    const spot = nearestWalkable(world, edge.x, edge.y, 16);
    if (!spot) continue;
    if (minRun > 0 && dist(spot.x, spot.y, hx, hy) < minRun) continue;
    // No expansion budget of its own. This is the longest search in the game —
    // map edge to hearth, around whatever the colony has walled off since — and
    // twenty thousand was a number picked when the map was 128 across and a
    // corner-to-corner route could not cost that much. It can now. `path.ts`
    // scales the default off the map, which is the only place that number
    // belongs.
    if (findPath(world, spot.x, spot.y, hx, hy, { latch, goals }) !== null) {
      return spot;
    }
  }
  return null;
}

/** Every open cell within a few paces of home — "the colony" to anything wild. */
function yard(world: World, hx: number, hy: number): Set<number> {
  const out = new Set<number>();
  for (let dy = -WILD_YARD; dy <= WILD_YARD; dy++) {
    for (let dx = -WILD_YARD; dx <= WILD_YARD; dx++) {
      const x = hx + dx;
      const y = hy + dy;
      if (!isWalkable(world, x, y)) continue;
      out.add(packCell(world, x, y));
    }
  }
  return out;
}

const SLAVER_NAMES = ['Kesk', 'Ordo', 'Halb', 'Tace', 'Merrow', 'Skint'];

/**
 * How the slavers on a refugee's heels are built.
 *
 * Flat, and deliberately off the raid escalation curve. An Ashbound band scales
 * with how many beats have landed, because that is a war getting worse; two
 * thugs who chased somebody across a moor are just two thugs, and pricing them
 * off the same curve would mean that by week four the rescue was a suicide the
 * game had invited the player to attempt. Clubs, for the same reason: a rescue
 * has to be winnable by whoever is nearest, not by whoever has the rifle.
 */
const SLAVER_HP = 52;
const SLAVERS = 2;
/** Cells of head start the runner gets. Enough to read as a chase, not a rout. */
const HEAD_START = 5;
/** Nearer than this to home and the run is over before anybody can react. */
const REFUGEE_MIN_RUN = 22;

const REFUGEE_SKILLS: SkillName[] = [
  'construction', 'cooking', 'plants', 'mining', 'shooting', 'medicine',
];

/**
 * Somebody breaks cover at the treeline with slavers behind them.
 *
 * They arrive as one of yours from the first tick, which is the point: the colony
 * does not get to audition them, it gets to decide whether it goes out. Their
 * health is set low because they have been running, and because a refugee who
 * arrives at full strength is a free settler with some scenery attached.
 *
 * Returns false when the map cannot stage it — no colony to run to, or nowhere
 * far enough out that is still reachable. The caller sends something else, so a
 * beat is never silently skipped.
 */
export function startRefugeeFlight(world: World, rng: Rng): boolean {
  const anchor = livingColonists(world)[0];
  if (!anchor) return false;
  const spot = arrivalSpot(world, rng, REFUGEE_MIN_RUN);
  if (!spot) return false;

  const refugee = makePawn(world, rng, 'colony', spot.x, spot.y, {
    weapon: 'club',
    skillBias: rng.pick(REFUGEE_SKILLS),
  });
  refugee.hp = Math.max(20, Math.round(refugee.maxHp * 0.55));

  // Behind them, on the line back out of the map — so the chase points at the
  // colony and the player can see which way it is running.
  const ang = Math.atan2(spot.y - anchor.y, spot.x - anchor.x);
  let chasers = 0;
  for (let i = 0; i < SLAVERS; i++) {
    const bx = spot.x + Math.cos(ang) * HEAD_START + (i - (SLAVERS - 1) / 2) * 1.5;
    const by = spot.y + Math.sin(ang) * HEAD_START + (i - (SLAVERS - 1) / 2) * 1.5;
    const at = nearestWalkable(world, Math.round(bx), Math.round(by), 8);
    if (!at) continue;
    const thug = makePawn(world, rng, 'raider', at.x, at.y, {
      name: `${rng.pick(SLAVER_NAMES)} the slaver`,
      weapon: 'club',
    });
    thug.hp = SLAVER_HP;
    thug.maxHp = SLAVER_HP;
    thug.skills.shooting = 2;
    chasers++;
  }

  // The first line of their story, and for most refugees the only one that ever
  // gets retold. Written here rather than at `makePawn` because what they are
  // remembered for is what was behind them, and that is not known until the
  // slavers have found somewhere to stand.
  remember(
    world,
    refugee,
    chasers === 0
      ? 'came out of the trees hurt, asking to stay'
      : `ran in out of the trees with ${chasers === 1 ? 'a slaver' : 'slavers'} behind them`,
  );

  if (chasers === 0) {
    // The edge was too tight to stand anybody behind them. They still ran from
    // something; the something just did not follow them onto the map.
    msg(world, `${refugee.name} stumbles out of the trees, hurt and asking to stay.`, 'good', {
      at: spot,
      headline: true,
    });
    return true;
  }
  world.storyteller.raidActive = true;
  msg(
    world,
    `${refugee.name} is running for the colony with ${chasers === 1 ? 'a slaver' : `${chasers} slavers`} behind them. Draft somebody (T).`,
    'threat',
    { at: spot, headline: true },
  );
  return true;
}

/** Shortest and longest a flare lasts, in ticks. Long enough to be a night. */
const FLARE_MIN = Math.round(TICKS_PER_DAY * 0.8);
const FLARE_SPAN = Math.round(TICKS_PER_DAY * 0.6);

/**
 * The sky goes green and every wire in the colony stops carrying.
 *
 * Only fires at a colony that has something electrical standing — a flare over a
 * settlement with no grid is a message about nothing, and the storyteller sends
 * a fire instead. What it costs is the machines: the cooler thaws, the turrets go
 * quiet, and the lamps go out for a night. That last one is the reason it is a
 * threat rather than an inconvenience — a raid that lands in the dark against
 * dead turrets is the hardest fight in the game, and it is one the colony can see
 * coming from the moment the aurora starts.
 */
export function startSolarFlare(world: World, rng: Rng): boolean {
  if (!world.buildings.some((b) => b.built && isElectrical(b.kind))) return false;
  world.storyteller.flareUntil = world.tick + FLARE_MIN + Math.round(rng.next() * FLARE_SPAN);
  msg(
    world,
    'A solar flare washes green across the sky. Every wire in the colony is dead until it passes.',
    'threat',
    { headline: true },
  );
  return true;
}

/** Head and tail of a herd. Big enough to be a week of meals, small enough to miss. */
const HERD_MIN = 5;
const HERD_SPAN = 4;
/**
 * How long the herd is willing to spend crossing before it settles here instead.
 *
 * Not a timer on the event so much as a floor under it: an animal that wedges
 * itself against a rock face on the way through stops being a migration and
 * becomes ordinary wildlife, which is true of real herds and costs no pathfinder.
 */
const HERD_PATIENCE = Math.round(TICKS_PER_DAY * 2.5);

/**
 * A herd crosses the valley, and it does not stop.
 *
 * The line is drawn *through* the colony rather than across a random corner —
 * on a map this wide a herd that passes the far edge is a log line about animals
 * nobody ever saw. They walk in one side, past the fields, and out the other, and
 * everything about them is ordinary wildlife in the meantime: mark one and a
 * hunter goes after it, tame one and it stays behind when the rest move on.
 *
 * This is the one beat that is a gift. It shares the threat clock with the raids
 * on purpose — smoke on the ridge line ought to be able to turn out to be dinner,
 * or the warning means nothing but "brace".
 */
export function startHerdMigration(world: World, rng: Rng): boolean {
  const anchor = livingColonists(world)[0];
  if (!anchor) return false;
  const entry = arrivalSpot(world, rng, 0, false);
  if (!entry) return false;

  // Straight through the colony and out the far side, and "the far side" is
  // asked rather than guessed: the exit is the furthest cell a mossback can
  // actually walk to along that heading.
  //
  // Guessing was the first version and it is worth saying how it failed, because
  // it looked right. It projected the map diagonal down the heading, clamped x
  // and y back into bounds, and took the nearest walkable cell to that. Clamping
  // the two independently is not a point on the ray — a heading leaving through
  // the north edge clamps to the north-*west* corner — so the herd was aimed at
  // the exact corner of the map, which on a valley this wide is reliably a
  // pocket of rim rock with no way into it, and two seeds in six staged nothing.
  // Walking the ray properly fixed those two and left others: the aim point is
  // still a guess, and a guess that lands in a sealed pocket is a declined
  // event. Falling back to shorter reaches down the ray only moved the guess.
  //
  // A flood answers it outright and costs less than the retries did.
  const ang = Math.atan2(anchor.y - entry.y, anchor.x - entry.x);
  const far = furthestAlong(world, entry, Math.cos(ang), Math.sin(ang));
  if (!far) return false;
  const exit = { x: far.x, y: far.y, until: world.tick + HERD_PATIENCE };

  // One route for the herd, walked in single file.
  //
  // Steering straight at the far side does not work and is not a near miss: the
  // first version pointed each animal at the exit and let collision slide them
  // along whatever they hit, and seed 17 put a rock shoulder eight cells in, so
  // all seven mossbacks ground into the same cell and stood there for the rest of
  // the event. A herd that never crosses the valley is the log line lying.
  //
  // So the crossing is a real path, found once here rather than once per animal —
  // eight floods of a map this wide inside one tick is a stutter the player would
  // feel — and handed out as copies, since walking one consumes it. An
  // animal that loses its copy re-paths for itself in `tickWildlife`, which is
  // rare enough to afford.
  //
  // `latch: false`, because the herd is wild and a door is a wall to the wild.
  // A crossing routed through somebody's cabin would stop at the doorstep, which
  // is the one failure this whole paragraph exists to prevent. It is also what
  // the flood above walked under, so this route exists by construction — the
  // budget is the whole map because the crossing is, by definition, the longest
  // walk anything in the game takes.
  const route = findPath(world, entry.x, entry.y, exit.x, exit.y, {
    maxExpansions: world.width * world.height,
    latch: false,
  });
  if (!route) return false;

  const size = HERD_MIN + rng.int(HERD_SPAN);
  let placed = 0;
  for (let i = 0; i < size; i++) {
    const beast = spawnAnimal(
      world,
      rng,
      'mossback',
      entry.x + rng.int(7) - 3,
      entry.y + rng.int(7) - 3,
    );
    if (!beast) continue;
    beast.migrateTo = exit;
    beast.path = route.slice();
    placed++;
  }
  if (placed === 0) return false;

  msg(
    world,
    `A herd of ${placed} mossbacks is crossing the valley. They will be gone by tomorrow — mark what you want (H).`,
    'good',
    { at: entry, headline: true },
  );
  return true;
}

/**
 * The furthest cell along a heading that something door-blind can actually reach
 * from `from`, or null if it cannot leave the cell it is standing on.
 *
 * "Furthest along" is the projection onto the heading, not the distance: a cell
 * three paces further out but well off to the side is a worse exit than one
 * squarely down the line, because the whole point of the heading is that the walk
 * passes the colony. Ties keep the first one found, which is the shorter walk.
 *
 * This is a flood of the map and it is deliberately not clever. It replaces four
 * A* attempts at guessed aim points — one flood is cheaper than the retries were,
 * and unlike them it cannot fail on a map where any answer exists at all.
 */
function furthestAlong(
  world: World,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): { x: number; y: number } | null {
  const seen = new Uint8Array(world.width * world.height);
  const queue: number[] = [packCell(world, from.x, from.y)];
  seen[queue[0]!] = 1;
  let best: { x: number; y: number } | null = null;
  let bestProj = 0;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const cx = cell % world.width;
    const cy = (cell - cx) / world.width;
    const proj = (cx - from.x) * dx + (cy - from.y) * dy;
    if (proj > bestProj) {
      bestProj = proj;
      best = { x: cx, y: cy };
    }
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
        const next = packCell(world, nx, ny);
        if (seen[next]) continue;
        if (!canStep(world, cx, cy, nx, ny, false)) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return best;
}

/** How far off a pack comes in, so there is a night of it and not an ambush. */
const PACK_RUN = 26;

/**
 * A fenwolf pack comes down into the valley.
 *
 * The mirror image of the herd, and deliberately so: the same walk in from the
 * same edge, and what it costs is the difference. A herd is a gift you have to be
 * free to collect; a pack is a bill you have to be free to argue with. Both are
 * answered by the same thing — somebody with a rifle and a spare afternoon — which
 * is what makes "who is not busy right now" the colony's actual defence, rather
 * than a wall.
 *
 * They walk in aimed at the colony rather than wandering, because a pack that
 * spent its day and a half grazing the far treeline is a log line and nothing
 * else. Once they are close the chase logic takes over — the route is only how
 * they get here. And they arrive hungry: `fed` is left unset, so the first thing
 * they do on reaching the fields is look for something in a pen.
 */
/**
 * How wide "the yard" is to something wild — what the pack walks to, and what an
 * arriving animal has to be able to reach for its entry to count.
 *
 * Wide enough that a colony sprawled across a few buildings still counts as one
 * place, narrow enough that the route ends at the settlement rather than in the
 * woods a screen away from it.
 */
const WILD_YARD = 10;

export function startPredatorPack(world: World, rng: Rng): boolean {
  const anchor = livingColonists(world)[0];
  if (!anchor) return false;
  const entry = arrivalSpot(world, rng, PACK_RUN, false);
  if (!entry) return false;

  // One route in, found once and handed out as copies — same reasoning as the
  // herd above, and the same failure it is avoiding: six wolves each flooding a
  // ninety-six-cell map in the same tick is a stutter the player feels.
  //
  // Found with `latch: false`, which is the same rule the wolves will walk it
  // under. Handing them a route that goes through the cabin door would have been
  // a route that stops dead at the doorstep, and a pack that arrived by standing
  // still in a field is not a pack.
  //
  // Which also decides what they are aimed at, and it is not a pawn. Aiming a
  // route at `livingColonists(world)[0]` was fine while a door was a hole, and
  // became "no pack tonight" the moment it was not: that settler is very often
  // asleep in a bed, a bed is behind a door, and a colony whose people happened
  // to be indoors when the storyteller fired would silently never see a wolf.
  //
  // So the goal is the *yard* — every cell near the colony, and near each animal
  // in it, that a wolf could stand on — handed to one A\* as a goal set rather
  // than tried one at a time. One flood, aimed at the colony, stopping at the
  // first piece of open ground outside it the pack can actually reach. Cells
  // inside the walls end up in the set too and simply never come up, which is
  // the whole point: the route ends where the wolves end, at the fence.
  //
  // Only when *nothing* in that ring can be reached without a latch is there no
  // pack tonight — a colony that has sealed itself completely, which is exactly
  // what it paid for.
  const hx = Math.round(anchor.x);
  const hy = Math.round(anchor.y);
  const goals = new Set<number>();
  const ring = (cx: number, cy: number, r: number): void => {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (isWalkable(world, x, y, false)) goals.add(packCell(world, x, y));
      }
    }
  };
  ring(hx, hy, WILD_YARD);
  for (const beast of livestock(world)) {
    if (!beast.dead) ring(Math.round(beast.x), Math.round(beast.y), 2);
  }
  if (goals.size === 0) return false;
  const route = findPath(world, entry.x, entry.y, hx, hy, { latch: false, goals });
  if (!route) return false;

  const size = PACK_MIN + rng.int(PACK_SPAN);
  let placed = 0;
  for (let i = 0; i < size; i++) {
    const wolf = spawnAnimal(world, rng, 'fenwolf', entry.x + rng.int(5) - 2, entry.y + rng.int(5) - 2);
    if (!wolf) continue;
    // Not `migrateTo`: that means "leaving", and a wolf that reached the colony
    // under a migration would count itself departed and vanish off the map in
    // the middle of the pen. The route is a path and nothing more; the clock is
    // `packUntil`, which is what `tickPackLeaving` reads when the stay is up.
    wolf.path = route.slice();
    wolf.packUntil = world.tick + PACK_STAY;
    placed++;
  }
  if (placed === 0) return false;

  msg(
    world,
    `Fenwolves — ${placed} of them — are coming down off the moor. They are after the animals, not you.`,
    'threat',
    { at: entry, headline: true },
  );
  return true;
}

/**
 * The per-tick half of the encounters that have a duration.
 *
 * Only the flare has one so far. It is here rather than in `tickStoryteller`
 * because "when does this end" belongs beside "when does it start" — the two
 * readings of `flareUntil` are four lines apart and cannot drift.
 */
export function tickEncounters(world: World): void {
  const st = world.storyteller;
  if (st.flareUntil !== undefined && st.flareUntil <= world.tick) {
    st.flareUntil = undefined;
    msg(world, 'The aurora fades. Power is coming back on.', 'good', { headline: true });
  }
}

/** Everything on the map that is only passing through. */
export function migrating(world: World): Pawn[] {
  return world.pawns.filter((p) => p.migrateTo !== undefined && !p.dead);
}
