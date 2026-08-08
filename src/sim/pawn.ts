/**
 * The one place a body comes into the world.
 *
 * This lives apart from `worldgen.ts` because four different systems create
 * pawns — worldgen (the founding settlers), events (raiders, beasts, wanderers),
 * scout (survivors brought home) and wildlife (the herds) — and every one of
 * them used to have to import worldgen to do it. Wildlife is spawned *by*
 * worldgen as well, which made that last import a cycle. A leaf module the
 * others share fixes it, and the dependencies run one way again.
 */

import { Rng } from './rng';
import { backfillTraits } from './traits';
import { ROLLED_SKILLS, WORK_TYPES } from './types';
import type { Pawn, SkillName, World, WorkType } from './types';

export const GIVEN_NAMES = [
  'Bram', 'Wren', 'Oda', 'Kesh', 'Tibb', 'Sela', 'Anders', 'Mira', 'Corwin', 'Juna',
  'Halle', 'Pell', 'Rook', 'Ivet', 'Sorrel', 'Dax', 'Nell', 'Ozias', 'Fenn', 'Lark',
];
export const FAMILY_NAMES = [
  'Ashdown', 'Verrow', 'Quill', 'Marrowes', 'Stonehearth', 'Tallis', 'Windmere',
  'Brackwater', 'Emberly', 'Draysant', 'Holloway', 'Kettleby',
];

export function makePawn(
  world: World,
  rng: Rng,
  faction: Pawn['faction'],
  x: number,
  y: number,
  opts: { name?: string; weapon?: Pawn['weapon']; skillBias?: SkillName } = {},
): Pawn {
  const skills = {} as Record<SkillName, number>;
  for (const s of ROLLED_SKILLS) skills[s] = 2 + rng.int(5);
  if (opts.skillBias) skills[opts.skillBias] = 8 + rng.int(5);
  const priorities = {} as Record<WorkType, number>;
  for (const w of WORK_TYPES) priorities[w] = 3;
  priorities.firefight = 1;
  priorities.doctor = 2;
  // Beside the doctor, for the reason given in WORK_TYPES: a downed raider is on
  // the same bleed clock a settler is, and the window to carry one in closes
  // when they die. Everything else a warden does waits happily.
  priorities.warden = 2;
  priorities.haul = 4;
  // Bottom of the board with hauling: a settler goes looking for the rest of the
  // world only once the work at home is done.
  priorities.scout = 4;
  // Above the general run of work, because unlike every other column a hunt only
  // exists because the player pointed at something. Left at the bottom of the
  // board it never came up at all: there is always another wall to build, and the
  // quarry has wandered off by the time anyone is free. Only firefighting, which
  // is the colony burning down, outranks it.
  priorities.hunt = 2;

  const name =
    opts.name ?? `${rng.pick(GIVEN_NAMES)} ${rng.pick(FAMILY_NAMES)}`;
  const pawn: Pawn = {
    id: world.nextId++,
    name,
    faction,
    x,
    y,
    facing: rng.range(0, Math.PI * 2),
    hp: 100,
    maxHp: 100,
    downed: false,
    dead: false,
    bleed: 0,
    needs: {
      food: faction === 'colony' ? rng.range(0.6, 0.9) : 0.8,
      rest: faction === 'colony' ? rng.range(0.55, 0.9) : 0.8,
      recreation: faction === 'colony' ? rng.range(0.5, 0.85) : 0.8,
    },
    mood: 0.75,
    skills,
    priorities,
    jobId: null,
    path: null,
    activity: 'idle',
    carryingItemId: null,
    drafted: false,
    orderX: null,
    orderY: null,
    weapon: opts.weapon ?? (faction === 'colony' ? (rng.chance(0.5) ? 'rifle' : 'club') : 'club'),
    attackCooldown: 0,
    targetPawnId: null,
    playerControlled: false,
    animPhase: rng.next() * 10,
    stuck: 0,
    colorSeed: rng.int(1 << 20),
  };
  // Everything with a name gets a character; the herds do not. A dunhare has no
  // opinion about work and cannot be talked round, and a beast rolling `slothful`
  // would be a joke the game makes once and then has to live with.
  //
  // Rolled from the pawn's own id and colour seed rather than from `rng`, and by
  // the same call that backfills an old save. Drawing from the caller's stream
  // would have been the obvious way to write it and is the wrong one: `makePawn`
  // is handed worldgen's stream, and wildlife's, and the storyteller's, so two
  // extra draws per body silently re-rolled every map, every herd and every deal
  // the trader ever offered. The tests caught it; a player would have seen their
  // seed stop meaning anything.
  if (faction !== 'fauna' && faction !== 'wildlife') backfillTraits(pawn);
  backfillSkills(pawn);
  world.pawns.push(pawn);
  return pawn;
}

/**
 * Give a settler the skills that were added after their body was designed.
 *
 * Rolled from the pawn's own id and colour seed, exactly as `backfillTraits`
 * does and for exactly the same reason: `makePawn` is handed four different
 * random streams, so a draw taken here would re-roll the map, the herds and the
 * trader's book. Called both when a body is made and when an old save is opened,
 * so the same settler is the same person either way.
 *
 * Also the migration path. A colony saved before `social` existed loads with the
 * key missing, and `Math.floor(undefined)` on the settler card is `NaN` — a
 * number the player cannot act on and cannot tell the cause of.
 */
export function backfillSkills(pawn: Pawn): void {
  if (typeof pawn.skills?.social === 'number') return;
  if (!pawn.skills) return;
  // Its own stream, offset off the trait one so a settler's charm is not simply
  // a restatement of their character.
  pawn.skills.social = 2 + new Rng(pawn.id * 31 + pawn.colorSeed + 7919).int(5);
}
