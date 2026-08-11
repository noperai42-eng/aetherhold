/**
 * Save / load. The World is plain JSON data by construction — no class
 * instances, Maps, Sets or typed arrays — so the save file is just the world
 * plus the bit of state that belongs to the *viewer* rather than the sim:
 * which view is open, which body is possessed, where the manager camera sits.
 *
 * Versioning is strict: a save from an incompatible schema is refused with a
 * message rather than half-migrated into a broken world.
 */

import { backfillSkills } from './pawn';
import { backfillTraits } from './traits';
import type { Pawn, World } from './types';
import { SAVE_VERSION, WORK_TYPES } from './types';

/**
 * Two slots, two keys. The manual slot only ever changes when a player presses
 * Save, so an autosave a minute later can never eat the colony they deliberately
 * kept; the auto slot is the one that survives a refresh, a closed tab or a
 * dev-server reload.
 */
export type SaveSlot = 'manual' | 'auto';

const KEYS: Record<SaveSlot, string> = {
  manual: 'aetherhold.save.v1',
  auto: 'aetherhold.autosave.v1',
};

export type ViewMode = 'manager' | 'fps';

export interface CameraState {
  targetX: number;
  targetY: number;
  distance: number;
  yaw: number;
  pitch: number;
}

export interface SaveEnvelope {
  v: number;
  savedAt: number;
  world: World;
  view: { mode: ViewMode; possessedId: number | null; camera: CameraState };
  speed: number;
}

export type LoadResult =
  | { ok: true; save: SaveEnvelope }
  | { ok: false; reason: 'empty' | 'version' | 'corrupt'; detail: string };

export function hasSave(slot: SaveSlot = 'manual'): boolean {
  try {
    return localStorage.getItem(KEYS[slot]) !== null;
  } catch {
    return false;
  }
}

/** When a slot was written, epoch ms, or null if it holds nothing readable. */
export function savedAt(slot: SaveSlot): number | null {
  try {
    const text = localStorage.getItem(KEYS[slot]);
    if (text === null) return null;
    const res = deserialize(text);
    return res.ok ? res.save.savedAt : null;
  } catch {
    return null;
  }
}

export function serialize(
  world: World,
  view: SaveEnvelope['view'],
  speed: number,
  now: number,
): string {
  const env: SaveEnvelope = { v: SAVE_VERSION, savedAt: now, world, view, speed };
  return JSON.stringify(env);
}

export function saveGame(
  world: World,
  view: SaveEnvelope['view'],
  speed: number,
  now: number,
  slot: SaveSlot = 'manual',
): boolean {
  try {
    localStorage.setItem(KEYS[slot], serialize(world, view, speed, now));
    return true;
  } catch (err) {
    console.warn('[aetherhold] save failed', err);
    return false;
  }
}

/** Parse an envelope from text. Split out from loadGame so tests need no DOM. */
export function deserialize(text: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: 'corrupt', detail: String(err) };
  }
  const env = parsed as Partial<SaveEnvelope>;
  if (!env || typeof env !== 'object' || typeof env.v !== 'number') {
    return { ok: false, reason: 'corrupt', detail: 'not a save envelope' };
  }
  if (env.v !== SAVE_VERSION) {
    return {
      ok: false,
      reason: 'version',
      detail: `save is version ${env.v}, this build reads ${SAVE_VERSION}`,
    };
  }
  const w = env.world;
  if (
    !w ||
    typeof w.tick !== 'number' ||
    typeof w.width !== 'number' ||
    !Array.isArray(w.pawns) ||
    !Array.isArray(w.terrain) ||
    w.terrain.length !== w.width * w.height
  ) {
    return { ok: false, reason: 'corrupt', detail: 'world payload is malformed' };
  }
  // Two backfills, same argument: a version bump would throw the player's colony
  // away over a field they cannot see. A new work type changes the shape of
  // `priorities`, and `assignJob` reads it by key — a settler loaded from a save
  // written before the column existed would get `undefined`, never match a level,
  // and silently never do that work again. Traits are rolled from the pawn's own
  // id, so an old settler becomes the same person every time that save is opened.
  for (const p of w.pawns as Pawn[]) {
    if (p.faction !== 'fauna' && p.faction !== 'wildlife') backfillTraits(p);
    backfillSkills(p);
    if (!p.priorities) continue;
    for (const t of WORK_TYPES) if (typeof p.priorities[t] !== 'number') p.priorities[t] = 3;
  }
  // The colony used to have one road and held its traveller in `world.caravan`.
  // It has two now, so fold the old field into the list and clear it — a save
  // that kept both would have a settler who exists twice, and the first tick that
  // walked one of them home would put a second copy of the same person on the
  // map. This is the only reader of the legacy field anywhere; see `types.ts`.
  const world = w as World;
  if (!world.caravans) world.caravans = [];
  if (world.caravan) {
    world.caravans.push(world.caravan);
    delete world.caravan;
  }
  // And the settlers who are not in the list above: a traveller on the road is
  // held inside `world.caravans` rather than in `world.pawns` (see
  // `settlements.ts`), so every backfill would step straight over them and they
  // would walk back onto the map with no social skill and no priority for
  // whatever work type this build added while they were away.
  world.caravans.forEach((c, i) => {
    // Party numbers only started being written down when there could be two, so
    // an older save's traveller has none. Hand them one off their position
    // rather than leaving it undefined, because the eval counts round trips by
    // identity and every id-less party would otherwise read as the same trip.
    if (c.id === undefined) c.id = i + 1;
    const away = c.pawn;
    if (!away) return;
    backfillTraits(away);
    backfillSkills(away);
    if (away.priorities) {
      for (const t of WORK_TYPES) if (typeof away.priorities[t] !== 'number') away.priorities[t] = 3;
    }
  });
  // Suspicion does not survive a reload. `stranded.ts` cancels a plan only after
  // two sweeps agree nobody can reach it, and the whole value of the second look
  // is that it is a fresh one — a colony reopened after a fortnight should not
  // reap on its first pass off the back of what the last session was thinking.
  delete (w as World).stranded;
  return {
    ok: true,
    save: {
      v: env.v,
      savedAt: typeof env.savedAt === 'number' ? env.savedAt : 0,
      world: w,
      view: env.view ?? { mode: 'manager', possessedId: null, camera: defaultCamera(w) },
      speed: typeof env.speed === 'number' ? env.speed : 1,
    },
  };
}

export function loadGame(slot: SaveSlot = 'manual'): LoadResult {
  let text: string | null = null;
  try {
    text = localStorage.getItem(KEYS[slot]);
  } catch (err) {
    return { ok: false, reason: 'corrupt', detail: String(err) };
  }
  if (text === null) return { ok: false, reason: 'empty', detail: 'no save found' };
  return deserialize(text);
}

/** Clears one slot, or every slot when asked for none — starting over means both. */
export function clearSave(slot?: SaveSlot): void {
  const slots: SaveSlot[] = slot ? [slot] : ['manual', 'auto'];
  for (const s of slots) {
    try {
      localStorage.removeItem(KEYS[s]);
    } catch {
      /* private-mode browsers: nothing to clear */
    }
  }
}

export function defaultCamera(world: World): CameraState {
  return {
    targetX: world.width * 0.5,
    targetY: world.height * 0.5,
    distance: 34,
    yaw: Math.PI * 0.25,
    pitch: 0.92,
  };
}
