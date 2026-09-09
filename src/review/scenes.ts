/**
 * The frames worth looking at, and how to stage each one.
 *
 * A scene is a fixture: a seed, a world built from it, one panel of real HUD
 * code drawn against that world, and nothing else. It never steps the
 * simulation, never reads or writes a save, and never touches `localStorage`.
 *
 * The reason this file exists is that [LOOK.md](../../LOOK.md) judges a change
 * by photographing the same frames before and after, and that only works when
 * the frame is one the game reliably produces. Some of them are not: a good gear
 * card wants a settler in plate standing next to a better coat in a cold snap,
 * and waiting for a colony to arrive at that on its own is why those panels have
 * never actually been looked at. A scene arrives there in one page load.
 *
 * The contract that makes the loop work is determinism. Two loads of the same
 * scene at the same viewport must produce the same frame, or a before-and-after
 * pair is comparing two different colonies rather than two designs. Everything
 * here is therefore a pure function of the seed written into it.
 *
 * One panel per load, which is a decision the stylesheet made rather than a
 * preference: the settler card's whole appearance hangs off forty-five rules
 * scoped to `#inspector`, and an id appears once in a document. To compare two
 * variants, load the scene twice.
 */

import { corpsePanel, groundPanel, kitPanel, kitRows } from '../client/ui/hud';
import { cellFacts } from '../client/ui/cell';
import { kitFacts } from '../client/ui/kit';
import { apparelOf, equip, gearOf } from '../sim/gear';
import { remember } from '../sim/lifelog';

import { terrainAt, type EquipKind, type Pawn, type Terrain, type World } from '../sim/types';
import { createWorld } from '../sim/worldgen';

export interface Scene {
  /** The `?scene=` value. Kebab-case, and the test asserts it round-trips. */
  readonly name: string;
  /** Printed above the panel, so a screenshot says what it is a screenshot of. */
  readonly title: string;
  /** One line on what this frame is for — the question it was staged to answer. */
  readonly note: string;
  /** The panel's inner HTML, drawn by the same function the game draws it with. */
  render(): string;
}

/**
 * The world every scene starts from.
 *
 * One seed for all of them on purpose: a reviewer who has looked at four scenes
 * has looked at four corners of one colony rather than four unrelated ones, and
 * a scene that reads oddly can be checked against the game by loading that seed.
 */
const SEED = 20260729;

/**
 * The first cell of a given ground, scanned in a fixed order.
 *
 * Row-major and first-match, because "somewhere there is soil" is not a frame —
 * the same seed has to resolve to the same square every time or the photograph
 * moves under the loop.
 */
function firstCell(world: World, want: Terrain): { x: number; y: number } | null {
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (terrainAt(world, x, y) === want) return { x, y };
    }
  }
  return null;
}

/** A ground panel over the first cell of some terrain, or a plain note if the map has none. */
function groundScene(name: string, title: string, note: string, terrain: Terrain): Scene {
  return {
    name,
    title,
    note,
    render() {
      const world = createWorld(SEED);
      const at = firstCell(world, terrain);
      if (!at) return `<h3>no ${terrain}</h3><div class="sub">seed ${SEED} grew no ${terrain} to stand on</div>`;
      const facts = cellFacts(world, at.x, at.y);
      if (!facts) return `<h3>no facts</h3><div class="sub">(${at.x}, ${at.y}) is off the grid</div>`;
      return groundPanel(world, facts);
    },
  };
}

/**
 * A settler, staged.
 *
 * This is the part of the harness that earns it. A colony arrives at "a rifleman
 * in a leather jerkin, in reach of a steel plate" on its own eventually, and
 * eventually is why the card has never been looked at. Here it is one call.
 *
 * Mutating a settler on a fixture world is safe in a way it would not be
 * anywhere else: the world was built two lines ago from a seed, is never
 * stepped, and is thrown away when the page unloads.
 */
function staged(seed: number, fit: (p: Pawn) => void): Pawn {
  const world = createWorld(seed);
  const pawn = world.pawns[0];
  if (!pawn) throw new Error(`seed ${seed} landed no settlers`);
  fit(pawn);
  return pawn;
}

/** A kit card for a staged settler, drawn by the same function the game draws it with. */
function kitScene(name: string, title: string, note: string, kind: EquipKind, fit: (p: Pawn) => void): Scene {
  return {
    name,
    title,
    note,
    render: () => kitPanel(kitFacts(staged(SEED, fit), kind)),
  };
}

/** The gear block of the settler card, as it reads on a settler who has some. */
function wornScene(name: string, title: string, note: string, fit: (p: Pawn) => void): Scene {
  return {
    name,
    title,
    note,
    render() {
      const p = staged(SEED, fit);
      return `<h3>${p.name}</h3><div class="sub">the gear block, in place</div>${kitRows(apparelOf(p), gearOf(p))}`;
    },
  };
}

/**
 * A body, staged.
 *
 * The one frame in this file that cannot be reached by playing carefully. A
 * corpse card is only ever read in the ten seconds after a raid, with the log
 * still shouting and half the colony downed, which is the worst possible moment
 * to be judging whether a panel reads well. Here it holds still.
 *
 * Killed the crude way — `dead` set by hand rather than by `damagePawn` — because
 * the panel is a function of what a corpse *is*, and routing through combat would
 * drag a message log, a grief pass and a eulogy into a fixture that wants none of
 * them.
 */
function corpseScene(name: string, title: string, note: string, fit: (world: World, p: Pawn) => void): Scene {
  return {
    name,
    title,
    note,
    render() {
      const world = createWorld(SEED);
      const pawn = world.pawns[0];
      if (!pawn) throw new Error(`seed ${SEED} landed no settlers`);
      fit(world, pawn);
      pawn.dead = true;
      pawn.activity = 'dead';
      return corpsePanel(pawn);
    },
  };
}

export const SCENES: readonly Scene[] = [
  corpseScene(
    'corpse-with-kit',
    'Somebody who died wearing something',
    'The reason to walk out there: a body still in a parka, with a toolbelt on it and a story above it.',
    (world, p) => {
      p.weapon = 'club';
      equip(p, 'parka');
      equip(p, 'toolbelt');
      remember(world, p, 'went out to the treeline when the shooting started');
    },
  ),
  corpseScene(
    'corpse-stripped',
    'Somebody who died with nothing on',
    'The empty case, which is most of the early colony — the card has to be worth opening anyway.',
    // Disarmed on purpose. The founding settler comes with a rifle, and a frame
    // captioned "nothing on" that prints a weapon row is a photograph of the
    // wrong thing.
    (_world, p) => void (p.weapon = 'none'),
  ),
  wornScene(
    'worn-plate-and-belt',
    'Plate and a toolbelt, worn',
    'The two lines the settler card used to print as bare names, now saying what they cost and what they buy.',
    (p) => {
      p.weapon = 'rifle';
      equip(p, 'plate');
      equip(p, 'toolbelt');
    },
  ),
  wornScene(
    'worn-parka-and-bag',
    'A parka and the doctor\'s bag, worn',
    'The other half of the tree: the settler who stands outside in a storm, and the one axis nobody else touches.',
    (p) => {
      equip(p, 'parka');
      equip(p, 'medkit');
    },
  ),
  kitScene(
    'kit-plate-on-rifleman',
    'Steel plate, on the one with the rifle',
    'The trade the whole apparel tree is built on: armour bought with warmth and with work, for life.',
    'plate',
    (p) => {
      p.weapon = 'rifle';
      equip(p, 'jerkin');
    },
  ),
  kitScene(
    'kit-parka-on-rifleman',
    'Fur parka, on the one with the rifle',
    'The refusal. Warmer and safer to wear, and the bench will not make it — this is the frame that has to say why.',
    'parka',
    (p) => {
      p.weapon = 'rifle';
      equip(p, 'jerkin');
    },
  ),
  kitScene(
    'kit-parka-on-worker',
    'Fur parka, on somebody who works outside',
    'The same coat, the same jerkin, the opposite verdict — and the line that says why. This and the one above are the whole rule.',
    'parka',
    (p) => {
      p.weapon = 'none';
      equip(p, 'jerkin');
    },
  ),
  kitScene(
    'kit-toolbelt-empty-hands',
    'Toolbelt, into an empty slot',
    'The empty-slot case, which is most of the early colony and the one place the card has nothing to compare against.',
    'toolbelt',
    (p) => {
      p.weapon = 'none';
    },
  ),
  groundScene(
    'ground-grass',
    'Grass',
    'The panel with nothing on it — the baseline every other ground frame is read against.',
    'grass',
  ),
  groundScene(
    'ground-water',
    'Water',
    'The one ground nobody can stand on, so the walkable row has something to say.',
    'water',
  ),
];

/** The scene a `?scene=` value names, or null so the page can say what it has instead. */
export function sceneByName(name: string): Scene | null {
  return SCENES.find((s) => s.name === name) ?? null;
}
