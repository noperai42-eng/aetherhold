/**
 * Building definitions — the single table that both the simulation and the
 * renderer read. `solid` here is THE authority for collision: pathfinding and the
 * first-person capsule both call `isSolid()` in grid.ts, which reads this table.
 * If a thing looks like a wall in one view it blocks you in the other.
 */

import type { BuildingKind, ResourceKind } from './types';

export interface BuildingDef {
  kind: BuildingKind;
  label: string;
  /** blocks movement for pawns AND the first-person player */
  solid: boolean;
  /** walkable surface height in metres (bed = a low platform you stand on) */
  standHeight: number;
  /** visual height, also used for first-person head clearance checks */
  height: number;
  cost: Partial<Record<ResourceKind, number>>;
  work: number;
  hp: number;
  /** can a pawn/player use it with E to satisfy a need or advance work */
  interact: 'none' | 'sleep' | 'eat' | 'cook' | 'craft' | 'relax' | 'door' | 'fish';
  /** appears in the player-facing build menu */
  buildable: boolean;
  /**
   * Only goes on a cell with water orthogonally beside it — see `onShore` in
   * fishing.ts. Absent means anywhere the terrain allows, which is everything
   * else in this table.
   */
  needsShore?: boolean;
  /** burns when a fire spreads onto it */
  flammable: boolean;
  hotkey?: string;
  blurb?: string;
}

/**
 * The line between "you shoot over it" and "it stops the bullet".
 *
 * One number, used by both `blocksSight` and the cover roll, because the two
 * questions are the same question: anything you can see over is something you
 * can shoot over, and is therefore cover rather than a wall. They used to
 * disagree — sight blocked above 1.2, cover counted below 1.2 — which left the
 * turret, at 1.4, in a gap where it was neither. A turret fires from its own
 * cell, so every round it ever fired was deleted by its own emplacement on the
 * first step of flight: four turrets, 120 steel, and not one bullet that reached
 * anybody. Sharing the constant is what stops that gap reopening.
 */
export const SHOOT_OVER_HEIGHT = 1.5;

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  wall: {
    kind: 'wall',
    label: 'Wall',
    solid: true,
    standHeight: 0,
    height: 2.6,
    cost: { wood: 5 },
    work: 90,
    hp: 180,
    interact: 'none',
    buildable: true,
    flammable: true,
    hotkey: '1',
    blurb: 'Blocks movement and bullets. 5 wood.',
  },
  stonewall: {
    kind: 'stonewall',
    label: 'Stone wall',
    solid: true,
    standHeight: 0,
    height: 2.7,
    // Steel rather than wood, so the upgrade competes with turrets for the same
    // pile and walling the whole colony in stone is a real choice rather than the
    // obvious one.
    cost: { steel: 6 },
    work: 170,
    hp: 540,
    interact: 'none',
    buildable: true,
    flammable: false,
    blurb: 'Three times the punishment of timber, and fireproof. 6 steel. Needs Stonecutting.',
  },
  lab: {
    kind: 'lab',
    label: 'Research bench',
    solid: true,
    standHeight: 0,
    height: 1.15,
    cost: { wood: 25, steel: 20 },
    work: 280,
    hp: 120,
    interact: 'craft',
    buildable: true,
    flammable: true,
    hotkey: '0',
    blurb: 'Where projects get worked out. 25 wood, 20 steel.',
  },
  door: {
    kind: 'door',
    label: 'Door',
    solid: false,
    standHeight: 0,
    height: 2.6,
    cost: { wood: 8 },
    work: 110,
    hp: 140,
    interact: 'door',
    buildable: true,
    flammable: true,
    hotkey: '2',
    blurb: 'Passable by settlers, swings open. 8 wood.',
  },
  bed: {
    kind: 'bed',
    label: 'Bed',
    solid: false,
    standHeight: 0.34,
    height: 0.62,
    cost: { wood: 12 },
    work: 130,
    hp: 90,
    interact: 'sleep',
    buildable: true,
    flammable: true,
    hotkey: '3',
    blurb: 'Restores Rest much faster than the ground. 12 wood.',
  },
  table: {
    kind: 'table',
    label: 'Table',
    solid: true,
    standHeight: 0,
    height: 0.9,
    cost: { wood: 14 },
    work: 130,
    hp: 110,
    interact: 'eat',
    buildable: true,
    flammable: true,
    hotkey: '4',
    blurb: 'Eat and relax here. Boosts Recreation. 14 wood.',
  },
  gametable: {
    kind: 'gametable',
    label: 'Games table',
    // A board and two stools. Solid like the dining table it sits next to, and
    // for the same reason: you pull a stool up to it, you do not walk over it.
    solid: true,
    standHeight: 0,
    height: 0.85,
    // Cheaper than the dining table on purpose. A young colony that cannot
    // afford anywhere to spend an evening is a colony being punished for being
    // young, and the answer to a miserable settler must never be "later".
    cost: { wood: 10, steel: 4 },
    work: 150,
    hp: 100,
    interact: 'none',
    buildable: true,
    flammable: true,
    blurb: 'Somewhere to play. The best recreation in the game, and it seats two. 10 wood, 4 steel.',
  },
  stove: {
    kind: 'stove',
    label: 'Cook stove',
    solid: true,
    standHeight: 0,
    height: 1.1,
    cost: { wood: 10, steel: 10 },
    work: 200,
    hp: 130,
    interact: 'cook',
    buildable: true,
    flammable: false,
    hotkey: '5',
    blurb: 'Turns raw food into meals. 10 wood, 10 steel.',
  },
  bench: {
    kind: 'bench',
    label: 'Workbench',
    solid: true,
    standHeight: 0,
    height: 1.05,
    cost: { wood: 20, steel: 15 },
    work: 240,
    hp: 140,
    interact: 'craft',
    buildable: true,
    flammable: true,
    hotkey: '6',
    blurb: 'Makes rifles from steel and medicine from raw plants. 20 wood, 15 steel.',
  },
  fishhole: {
    kind: 'fishhole',
    label: 'Fishing stage',
    // Not solid, and standing on it is the whole point: a plank deck flush with
    // the bank that a settler walks out onto. Solid would have put a fence
    // between the colony and the one square of shoreline worth having.
    solid: false,
    standHeight: 0.14,
    height: 0.9,
    // The cheapest production building in the game, on purpose. It is the thing
    // you build in the middle of a bad winter with whatever is left in the
    // woodpile, and a price you cannot pay in February is not an answer.
    cost: { wood: 12 },
    work: 130,
    hp: 90,
    interact: 'fish',
    buildable: true,
    flammable: true,
    needsShore: true,
    hotkey: '-',
    blurb: 'Pulls food out of the lake, slower once it freezes. Must sit on the shore. 12 wood.',
  },
  turret: {
    kind: 'turret',
    label: 'Turret',
    solid: true,
    standHeight: 0,
    height: 1.4,
    cost: { steel: 30 },
    work: 300,
    hp: 160,
    interact: 'none',
    buildable: true,
    flammable: false,
    hotkey: '7',
    blurb: 'Fires at hostiles on its own. 30 steel.',
  },
  sandbag: {
    kind: 'sandbag',
    label: 'Sandbags',
    solid: true,
    standHeight: 0,
    height: 0.85,
    cost: { steel: 4 },
    work: 60,
    hp: 200,
    interact: 'none',
    buildable: true,
    flammable: false,
    hotkey: '8',
    blurb: 'Cheap hard cover to fight behind. 4 steel.',
  },
  trap: {
    kind: 'trap',
    // Not solid, and deliberately shorter than anything that counts as cover:
    // a raider must be able to walk onto it, and must get nothing back for
    // standing there. See traps.ts for the two rules that make it a defence.
    label: 'Deadfall trap',
    solid: false,
    standHeight: 0,
    height: 0.3,
    cost: { wood: 12 },
    work: 110,
    hp: 30,
    interact: 'none',
    buildable: true,
    flammable: true,
    blurb: 'Springs once on a raider who walks over it, then needs re-arming. 12 wood.',
  },
  fence: {
    kind: 'fence',
    label: 'Fence',
    solid: true,
    standHeight: 0,
    // Deliberately under SHOOT_OVER_HEIGHT: a fence stops a body and not a bullet,
    // which is what separates it from a wall rather than making it a cheap one.
    height: 1.15,
    cost: { wood: 3 },
    work: 45,
    hp: 70,
    interact: 'none',
    buildable: true,
    flammable: true,
    blurb: 'Cheap timber rail. Stops bodies, not bullets — pens and yards. 3 wood.',
  },
  lamp: {
    kind: 'lamp',
    label: 'Lamp',
    solid: false,
    standHeight: 0,
    height: 1.7,
    cost: { steel: 8 },
    work: 90,
    hp: 60,
    interact: 'none',
    buildable: true,
    flammable: false,
    hotkey: '9',
    blurb: 'Lights the room after dark. 8 steel.',
  },
  medbed: {
    kind: 'medbed',
    label: 'Hospital bed',
    solid: false,
    standHeight: 0.34,
    height: 0.62,
    // Steel because it is a frame and a mattress you can hose down, and dear
    // enough that a colony builds one or two rather than replacing every bunk.
    cost: { wood: 20, steel: 12 },
    work: 180,
    hp: 90,
    interact: 'sleep',
    buildable: true,
    flammable: true,
    blurb: 'The sick sleep here and fight illness off faster. Healthy settlers stay out. 20 wood, 12 steel.',
  },
  prisonbed: {
    kind: 'prisonbed',
    label: 'Prison bunk',
    solid: false,
    standHeight: 0.34,
    height: 0.62,
    // Dearer than a bed and it needs steel, because the number of these you have
    // built is the number of raiders you can hold — and that decision should cost
    // something before the fight, not after it.
    cost: { wood: 16, steel: 8 },
    work: 160,
    hp: 90,
    interact: 'none',
    buildable: true,
    flammable: true,
    blurb: 'Holds one captured raider. Wardens feed and recruit them. 16 wood, 8 steel.',
  },
  cooler: {
    kind: 'cooler',
    label: 'Cooler',
    solid: true,
    standHeight: 0,
    height: 1.3,
    // The dearest thing in the menu that is not a turret, and on purpose: a cold
    // store is a week-two project a colony commits to, not something you dot
    // around. The steel is the same steel the turrets want.
    cost: { steel: 28, wood: 12 },
    work: 260,
    hp: 130,
    interact: 'none',
    buildable: true,
    flammable: false,
    blurb: 'Freezes the walled room around it so food keeps. Useless outdoors. 28 steel, 12 wood.',
  },
  campfire: {
    kind: 'campfire',
    label: 'Campfire',
    solid: true,
    standHeight: 0,
    // Knee height: a fire pit you stand around, and cover you can shoot over.
    height: 0.78,
    // Twenty wood and no steel at all, because this is the answer to a cold night
    // on day one — before there is a grid, before there is anything to spend.
    cost: { wood: 20 },
    work: 70,
    hp: 60,
    interact: 'none',
    // It is already on fire. Nothing more can happen to it.
    flammable: false,
    buildable: true,
    blurb: 'Burns wood to warm the room it stands in, and lights it. 20 wood.',
  },
  heater: {
    kind: 'heater',
    label: 'Heater',
    solid: true,
    standHeight: 0,
    height: 1.25,
    cost: { steel: 22, wood: 8 },
    work: 190,
    hp: 110,
    interact: 'none',
    buildable: true,
    flammable: true,
    blurb: 'Holds a walled room at 22°C for 60 W. No wood to carry. 22 steel, 8 wood.',
  },
  grave: {
    kind: 'grave',
    label: 'Grave',
    // You walk over a grave, you do not walk into one. Solid would let a player
    // ring the colony in headstones for four wood apiece, and would put a body
    // somewhere the hauler carrying it cannot stand.
    solid: false,
    standHeight: 0,
    // Knee-high marker. The first pass made it ankle-high and a graveyard read
    // from the manager camera as four dark squares of dirt floor — you could not
    // tell a plot from a scorch mark. It is the marker that has to be visible,
    // not the mound. Still far under every sight and cover threshold, because a
    // graveyard must never turn out to be a free wall.
    height: 0.7,
    // Four wood, because the alternative to burying somebody must never be
    // "we could not afford it".
    cost: { wood: 4 },
    work: 60,
    hp: 70,
    interact: 'none',
    buildable: true,
    // A wooden marker over turned earth. The marker is what burns.
    flammable: true,
    blurb: 'Holds one of your dead. Bodies left out weigh on everyone. 4 wood.',
  },
  statue: {
    kind: 'statue',
    label: 'Statue',
    // You walk round a statue. Solid also means it stops a bullet, and at 20
    // steel apiece that is not a cheaper wall than a wall — it is four times the
    // price, which is the only guard this needs.
    solid: true,
    standHeight: 0,
    // Head height, and deliberately under ROOM_WALL_HEIGHT: a statue must never
    // cut a hall into two rooms with two temperatures. Over SHOOT_OVER_HEIGHT,
    // so it stops a shot rather than being something to crouch behind.
    height: 1.9,
    cost: { steel: 20, wood: 10 },
    work: 340,
    hp: 220,
    interact: 'none',
    buildable: true,
    // Steel and stone over a timber armature. It is the one furnishing that does
    // not go up with the room.
    flammable: false,
    blurb: 'Does nothing but be worth looking at. Lifts the whole room. 20 steel, 10 wood.',
  },
  generator: {
    kind: 'generator',
    label: 'Wood generator',
    solid: true,
    standHeight: 0,
    // Just under SHOOT_OVER_HEIGHT: a machine you take cover behind, not a wall
    // you hide a whole colony behind for the price of thirty wood.
    height: 1.45,
    cost: { wood: 30, steel: 10 },
    work: 200,
    hp: 110,
    interact: 'none',
    buildable: true,
    // It is a firebox. Of course it burns.
    flammable: true,
    blurb: 'Burns wood for 240 W. Power runs through walls and conduit. 30 wood, 10 steel.',
  },
  conduit: {
    kind: 'conduit',
    label: 'Power conduit',
    solid: false,
    standHeight: 0,
    height: 0.06,
    // A single steel, because the answer to "why is my lamp dark" should never be
    // "you could not afford the wire".
    cost: { steel: 1 },
    work: 14,
    hp: 30,
    interact: 'none',
    buildable: true,
    flammable: false,
    blurb: 'Carries power across open ground. Walk over it. 1 steel.',
  },
  battery: {
    kind: 'battery',
    label: 'Battery bank',
    solid: true,
    standHeight: 0,
    height: 0.9,
    cost: { steel: 25, wood: 8 },
    work: 180,
    hp: 100,
    interact: 'none',
    buildable: true,
    flammable: true,
    blurb: 'Stores surplus power and covers the gaps. 25 steel, 8 wood.',
  },
  solar: {
    kind: 'solar',
    label: 'Solar panel',
    solid: true,
    standHeight: 0,
    height: 1.1,
    cost: { steel: 40 },
    work: 240,
    hp: 90,
    interact: 'none',
    buildable: true,
    flammable: false,
    blurb: 'Up to 200 W in daylight and nothing at night. Needs Solar cells. 40 steel.',
  },
  watermill: {
    kind: 'watermill',
    label: 'Watermill',
    solid: true,
    standHeight: 0,
    height: 1.6,
    // Dearer than a generator in wood and a fifth of a panel in steel, because
    // what it sells is not watts but *hours* — 150 W at four in the morning in
    // the rain, with nobody hauling logs to it. The steel is what keeps it out
    // of the opening week, and the shore rule is what keeps it from being the
    // only answer.
    cost: { wood: 55, steel: 20 },
    work: 320,
    hp: 110,
    interact: 'none',
    buildable: true,
    flammable: true,
    needsShore: true,
    blurb: '150 W day and night, dead while the lake is frozen. Needs Machining and a shore. 55 wood, 20 steel.',
  },
  tree: {
    kind: 'tree',
    label: 'Tree',
    solid: true,
    standHeight: 0,
    height: 4.5,
    cost: {},
    work: 0,
    hp: 120,
    interact: 'none',
    buildable: false,
    flammable: true,
  },
};

/**
 * The build menu, in the groups the bar draws it in.
 *
 * These used to be one flat row with the grouping left in comments, and the row
 * grew with the game until twenty-two tiles were 1994 px wide on a 1440 px
 * screen: walls and doors were laid out at negative x, off the left edge, and
 * a player could no longer click the first thing the game asks them to build.
 * Groups are the fix that keeps working — a row is now four or five tiles
 * whatever else ships later.
 *
 * The names are what a player is looking for rather than what the code calls
 * them: somebody who wants to keep the rain off is thinking "structure", and
 * somebody who wants the meat to keep is thinking about the room, not the wiring.
 */
export interface BuildGroup {
  name: string;
  kinds: BuildingKind[];
}

export const BUILD_GROUPS: BuildGroup[] = [
  // `stonewall` sits next to `wall` because that is where a player looks for it,
  // and it simply is not drawn until Stonecutting lands — see `buildingUnlocked`
  // in research.ts, which is the authority on that. The fence is here on the same
  // logic: three ways to keep something out, chosen on price.
  { name: 'Structure', kinds: ['wall', 'stonewall', 'fence', 'door'] },
  // The variants sit beside the bed they are variants of. The grave is last in
  // the row for the same reason it is in this group at all: it is a place you
  // lay a person down, and a player looking for one is looking at the beds.
  { name: 'Furniture', kinds: ['bed', 'medbed', 'prisonbed', 'table', 'grave'] },
  // The two things you build for no reason except that the people living here
  // are people: somewhere to spend an evening and something to look at. They
  // used to sit at the end of the furniture row, which is where a seventh tile
  // pushed that row off a small screen — see tests/buildmenu.test.ts for the
  // bug that cost a ten-year-old his walls. A short group is not a problem; a
  // row a player cannot click is.
  { name: 'Comfort', kinds: ['gametable', 'statue'] },
  // The fishing stage is production, not defence or comfort: it is a building
  // that turns a place into food, which is what the other three do. It sits last
  // because it is the one that cannot go just anywhere, and a player hunting for
  // a tile that will take a blueprint should find the awkward one at the end of
  // the row rather than in the middle of the ones that always work.
  { name: 'Production', kinds: ['stove', 'bench', 'lab', 'fishhole'] },
  // One machine takes heat out of a room and two put it back, and the choice
  // between them is the same choice.
  { name: 'Climate', kinds: ['cooler', 'campfire', 'heater'] },
  // Cheap-to-dear, left to right: timber you can afford on day one, then the
  // steel emplacement you fight behind, then the thing that fights for you.
  { name: 'Defence', kinds: ['trap', 'sandbag', 'turret'] },
  // A player who wants a lamp lit is looking at the lamp and at the thing that
  // feeds it in the same glance.
  // The watermill goes at the end for the same reason the fishing stage does:
  // it is the one power source that cannot go where you point, so a player
  // scanning the row for something that will take a blueprint anywhere should
  // hit the four that always work first.
  { name: 'Power', kinds: ['lamp', 'generator', 'conduit', 'battery', 'solar', 'watermill'] },
];

/** Every buildable kind, in menu order. The groups are the source of truth. */
export const BUILD_MENU: BuildingKind[] = BUILD_GROUPS.flatMap((g) => g.kinds);

export function defOf(kind: BuildingKind): BuildingDef {
  return BUILDING_DEFS[kind];
}

/**
 * The beds a settler claims for themselves with `occupant`.
 *
 * One predicate rather than a `kind === 'bed'` test at each of the four sites
 * that hand a mattress back — claiming, cancelling, waking and possessing. The
 * hospital bed shipped with three of those four still reading `=== 'bed'`, which
 * meant a medbed was never released and never re-let: a bed nobody could ever
 * sleep in twice. Prison bunks are deliberately not on this list; a captive is
 * assigned one by the warden and never claims anything.
 */
export function isBed(kind: BuildingKind): boolean {
  return kind === 'bed' || kind === 'medbed';
}
