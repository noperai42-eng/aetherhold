/**
 * What a running engine does to the air in a closed room.
 *
 * A wood generator is a firebox with a crank on it. Outdoors it is a machine;
 * indoors it is a fire you have decided to live with. The game had no opinion
 * about this at all — a generator in the middle of the cabin was strictly better
 * than one outside it, because the wire was shorter and nothing else changed.
 * That is a rule the world visibly contradicts, and a player who notices is being
 * told the simulation is not paying attention.
 *
 * Three decisions:
 *
 *  - **The room is the unit, not the cell.** Exhaust fills the space it is shut
 *    into, so what matters is how much engine there is per cell of room — the
 *    same shape as `temperature.ts`, and for the same reason.
 *  - **A better-sealed room is worse.** This is the whole point and it is the
 *    opposite of the intuition a player brings from heaters: the tighter the
 *    shell, the less of it gets out. `sealOf` is already the number for that, so
 *    fumes multiply by exactly what heating divides by.
 *  - **Outdoors is free.** A generator in the yard costs nothing and never will.
 *    The fix for every complaint this module generates is "move it outside",
 *    which is one drag of the deconstruct tool and a rebuild, and the alert says
 *    so in as many words.
 *
 * Mood is the main cost and it holds for as long as you stand in it, so it is a
 * cached field on the pawn — the `socialMood` / `roomMood` pattern, written once
 * per pass by the module that owns it. Above `FUMES_CHOKING` it also does damage,
 * because a two-metre shed with an engine running in it should not merely be
 * unpleasant.
 */

import { roomIndex, type Room } from './rooms';
import { sealOf } from './temperature';
import { msg } from './world';
import type { Building, World } from './types';

/**
 * Exhaust from one running generator, in units × cells.
 *
 * Divided by room size, so the number reads as "what one engine does to a
 * one-cell cupboard". In the ninety-nine-cell starter cabin it lands near 0.9 —
 * over the stuffy line and nowhere near the choking one: unpleasant, obvious in
 * the mood breakdown, and survivable while the player works out why.
 */
export const EXHAUST = 90;

/** Below this the air is fine and nothing is written anywhere. */
export const FUMES_STUFFY = 0.35;

/** Above this, standing in the room costs health as well as morale. */
export const FUMES_CHOKING = 4;

/**
 * Mood lost per unit of concentration, and the worst it can get.
 *
 * Read against the other two states in `computeMood`: an ugly room is worth
 * `BEAUTY_MOOD` (0.06) and freezing is worth `COMFORT_MOOD` (0.18). The starter
 * cabin with the engine inside lands near a fully ugly room, and a sealed shed
 * bottoms out worse than a cold night — which is right, because unlike the
 * weather this one is a choice somebody made.
 */
const MOOD_PER_UNIT = 0.09;
const MOOD_FLOOR = -0.22;

/**
 * Hit points a tick at the choking line, and the most the concentration term can
 * multiply it by. Four times the floor rate is about a settler's working day, so
 * the worst case in the game costs you somebody until they are patched up —
 * never a death, see the `hp` floor below.
 */
const DAMAGE_PER_UNIT = 0.005;
const DAMAGE_CAP = 4;

/** How often the air is re-checked. Cheap, but it is a room scan. */
export const FUMES_INTERVAL = 20;

/** Is this building currently burning fuel to make watts? */
export function isRunning(b: Building): boolean {
  return b.built && b.kind === 'generator' && (b.fuel ?? 0) > 0 && b.powered === true;
}

/**
 * How thick the air is in every enclosed room, keyed by room id.
 *
 * Rooms with nothing running in them are absent rather than zero, so the common
 * case — every colony that put its generator in the yard — allocates nothing and
 * the per-pawn pass below is a single map miss.
 */
export function roomFumes(world: World): Map<number, number> {
  const idx = roomIndex(world);
  const engines = new Map<number, number>();
  for (const b of world.buildings) {
    if (!isRunning(b)) continue;
    const id = idx.cellRoom[b.y * world.width + b.x];
    // A generator in the yard vents to the sky. This is the line that makes the
    // whole module opt-in: outdoors is id −1 and costs nothing.
    if (id === undefined || id < 0) continue;
    engines.set(id, (engines.get(id) ?? 0) + EXHAUST);
  }
  const out = new Map<number, number>();
  for (const [id, total] of engines) {
    const room: Room | undefined = idx.rooms.get(id);
    if (!room) continue;
    out.set(id, (total / room.size) * sealOf(room));
  }
  return out;
}

/** What the air is like on the cell this pawn is standing on. */
export function fumesAt(world: World, x: number, y: number): number {
  const idx = roomIndex(world);
  const id = idx.cellRoom[Math.floor(y) * world.width + Math.floor(x)];
  if (id === undefined || id < 0) return 0;
  return roomFumes(world).get(id) ?? 0;
}

/** Plain words for the concentration, for the inspector and the alert. */
export function fumesLabel(c: number): string {
  if (c >= FUMES_CHOKING) return 'choking';
  if (c >= FUMES_STUFFY * 3) return 'thick';
  return 'stuffy';
}

/**
 * One air pass.
 *
 * Writes `fumesMood` on everybody, including the zero, because a settler who has
 * walked out of the shed has to stop paying for it — a cached field that is only
 * ever written when it is bad is a field that never comes back.
 */
export function tickFumes(world: World): void {
  if (world.tick % FUMES_INTERVAL !== 0) return;
  const byRoom = roomFumes(world);
  if (byRoom.size === 0) {
    for (const p of world.pawns) if (p.fumesMood) p.fumesMood = 0;
    // This is the branch a player who took the advice lands on: the engine is
    // outside now, so no room has anything running in it at all. Saying nothing
    // here would mean the game complains and then goes quiet, which reads as the
    // complaint having been ignored rather than answered.
    if (world.fumesTold) {
      world.fumesTold = false;
      msg(world, 'The air indoors clears.', 'good');
    }
    return;
  }

  const idx = roomIndex(world);
  let worst = 0;
  for (const p of world.pawns) {
    if (p.faction !== 'colony' || p.dead) {
      p.fumesMood = 0;
      continue;
    }
    const id = idx.cellRoom[Math.floor(p.y) * world.width + Math.floor(p.x)];
    const c = id === undefined || id < 0 ? 0 : (byRoom.get(id) ?? 0);
    if (c > worst) worst = c;
    if (c <= FUMES_STUFFY) {
      p.fumesMood = 0;
      continue;
    }
    p.fumesMood = Math.max(MOOD_FLOOR, -(c - FUMES_STUFFY) * MOOD_PER_UNIT);
    if (c >= FUMES_CHOKING) {
      // Slow, capped, and floored at one hit point: this is meant to be a problem
      // the player fixes, not a way to lose a settler while looking at another
      // panel. Bad air takes somebody out of the day; it does not bury them.
      const scale = Math.min(DAMAGE_CAP, c - FUMES_CHOKING + 1);
      p.hp = Math.max(1, p.hp - scale * DAMAGE_PER_UNIT * FUMES_INTERVAL);
    }
  }

  // Said once per bout, not once per pass, and cleared the moment the air is.
  if (worst > FUMES_STUFFY && !world.fumesTold) {
    world.fumesTold = true;
    msg(
      world,
      `The air indoors is ${fumesLabel(worst)} with generator exhaust. Move the generator outside — a wall conducts, so it powers the same grid from the yard.`,
      'bad',
      { headline: true },
    );
  } else if (worst <= FUMES_STUFFY && world.fumesTold) {
    world.fumesTold = false;
    msg(world, 'The air indoors clears.', 'good');
  }
}
