/**
 * Aetherhold simulation types.
 *
 * Everything in this file is PLAIN DATA. No classes with behaviour, no three.js,
 * no DOM. The whole `World` must survive `JSON.parse(JSON.stringify(world))`
 * unchanged — that property is what makes save/load and headless tests possible.
 */

// Type-only, and mutual: `research.ts` needs `World` to read state off it and
// this file needs the shape of that state. Both sides are `import type`, so the
// cycle is erased at compile time and nothing circular reaches the bundle.
import type { EndingId } from './endings';
import type { ResearchState } from './research';
import type { TraitName } from './traits';

/** Bumped for the research state, which no earlier save carries. */
export const SAVE_VERSION = 10;

/** Simulation ticks per second. Render runs on rAF and interpolates between ticks. */
export const TICKS_PER_SECOND = 20;
/** Real seconds for one full in-game day at 1x speed. */
export const SECONDS_PER_DAY = 240;
export const TICKS_PER_DAY = TICKS_PER_SECOND * SECONDS_PER_DAY;

export type Terrain =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'rock'
  | 'water'
  | 'sand'
  | 'plank'
  | 'paved'
  /** Boards on piles, over water. The lake with a way across it. */
  | 'bridge';

/** Terrain that nothing can walk through. */
export const SOLID_TERRAIN: ReadonlySet<Terrain> = new Set<Terrain>(['rock', 'water']);

/**
 * Ground the colony laid itself. Floors are terrain rather than buildings on
 * purpose: a cell holds one building, and a bed standing on its own floorboards
 * would otherwise be two. Being terrain also means they save, load and render
 * with everything else, and that tilling a floor is impossible by construction.
 */
export const FLOOR_TERRAIN: ReadonlySet<Terrain> = new Set<Terrain>(['plank', 'paved', 'bridge']);

export function isFloor(t: Terrain): boolean {
  return FLOOR_TERRAIN.has(t);
}

/**
 * The three floors a colony can lay. A subset of Terrain, and deliberately narrow.
 *
 * A bridge is one of these in every way that matters to the sim — painted on the
 * ground, hauled to a cell at a time, laid down as terrain, and no more sowable or
 * tillable than a plank corridor. What is different about it is one thing and it is
 * a picture rather than a rule: the ground under a bridge is still lake. It is the
 * only floor drawn as a deck standing over the cell rather than as the cell itself,
 * so the water goes on being shaded, sunk and iced beneath the boards.
 */
export type FloorKind = 'plank' | 'paved' | 'bridge';

/**
 * Everything that can sit in a stockpile.
 *
 * The first five are the economy: dug up, grown, cooked or brewed here, and
 * every one of them is something a neighbour will both buy and sell. `hide` was
 * the first thing on this list the colony could not trade — it comes off an
 * animal and goes onto a settler's back, and no town on the map deals in it.
 *
 * `components` is the second, and it is the opposite shape. Nothing here makes
 * it and no amount of mining produces it: the only way a crate of milled parts
 * arrives in this valley is on somebody's back, from a workshop five days out.
 * That is the whole point of it. It is the first material in the game whose
 * supply is a *road* rather than a resource patch, which is what lets the last
 * tier of the research tree cost something a colony cannot simply dig harder for.
 *
 * `assemblies` is the same shape one ring further out, and it exists because
 * "the supply is a road" was only half true while there was one road worth
 * walking. Parts come from the middle country, five days out, and a colony that
 * has reached the third tier walks there as a matter of routine. Nothing on the
 * board was sold *only* by the far ring, so nine days out stayed a place the
 * colony was permitted to go and did not — the grid opened that road on ten maps
 * in ten and saw two of them use it. Finished machinery is what the far country
 * has and the middle country does not, and it is the top of the tier's bill.
 */
export type ResourceKind =
  | 'wood'
  | 'steel'
  | 'rawfood'
  | 'meal'
  | 'medicine'
  | 'hide'
  | 'components'
  | 'assemblies';

export const RESOURCE_KINDS: ResourceKind[] = [
  'wood',
  'steel',
  'rawfood',
  'meal',
  'medicine',
  'hide',
  'components',
  'assemblies',
];

export type BuildingKind =
  | 'wall'
  | 'stonewall'
  | 'lab'
  | 'door'
  | 'bed'
  | 'medbed'
  | 'table'
  | 'stove'
  | 'turret'
  | 'sandbag'
  | 'trap'
  | 'tree'
  | 'lamp'
  | 'bench'
  | 'prisonbed'
  | 'cooler'
  | 'fence'
  | 'generator'
  | 'conduit'
  | 'battery'
  | 'solar'
  | 'campfire'
  | 'heater'
  | 'grave'
  | 'gametable'
  | 'statue'
  /** A plank stage over the shore of the lake. Somebody stands on it and fishes. */
  | 'fishhole'
  /** A geared wheel in the shallows. Free watts, round the clock, until it ices up. */
  | 'watermill';

export type WorkType =
  | 'firefight'
  | 'doctor'
  /** Carrying downed raiders to a bunk, feeding them, and talking them round. */
  | 'warden'
  | 'cook'
  | 'farm'
  | 'construct'
  | 'craft'
  | 'mine'
  | 'chop'
  | 'research'
  | 'hunt'
  | 'haul'
  | 'scout'
  /** Walk a pack of goods to a neighbouring settlement and walk back with theirs. */
  | 'caravan';

// Order matters: within one priority level a settler tries these left to right.
// Scouting is last, because it is the one job that takes someone off the map for
// minutes at a time — it should only ever win when there is genuinely nothing at
// home for them to do.
export const WORK_TYPES: WorkType[] = [
  'firefight',
  'doctor',
  // Beside the doctor, and for the same reason: a raider face-down in the yard is
  // bleeding on the same clock a settler is, and the window to carry them in
  // closes when they die. Everything else the warden does — meals, persuasion —
  // is patient, but the capture is not.
  'warden',
  'cook',
  'farm',
  'construct',
  'craft',
  'mine',
  'chop',
  // Above hauling: a project the player deliberately chose should not sit behind
  // moving crates around. Below the four that keep everyone alive and housed —
  // there is no point knowing how to cut stone in a colony that is not eating.
  'research',
  'hunt',
  'haul',
  'scout',
  // Dead last, below even scouting. A trade run is the longest a settler is ever
  // away — days, not minutes — and a colony that sends its carpenter to market
  // while there is a wall half-built has got its own priorities wrong.
  'caravan',
];

export type SkillName =
  | 'construction'
  | 'cooking'
  | 'plants'
  | 'mining'
  | 'shooting'
  | 'medicine'
  | 'research'
  /** Talking to people who are not from here: prices on the road, and prisoners. */
  | 'social';

/**
 * The skills drawn from the caller's random stream when a body is made.
 *
 * `social` is deliberately not in this list even though it is a skill like any
 * other. `makePawn` is handed worldgen's stream, and wildlife's, and the
 * storyteller's — one extra draw per body inside this loop silently re-rolls
 * every map, every herd and every deal the trader ever offered, which is the
 * same trap `backfillTraits` was written to get out of. Social is derived from
 * the settler's own id instead, by `backfillSkills`.
 */
export const ROLLED_SKILLS: SkillName[] = [
  'construction',
  'cooking',
  'plants',
  'mining',
  'shooting',
  'medicine',
  'research',
];

/** Every skill, for anything that shows or iterates them. */
export const SKILL_NAMES: SkillName[] = [...ROLLED_SKILLS, 'social'];

/**
 * `wildlife` is the maddened beast the storyteller throws at the colony; `fauna`
 * is the herd that grazes the map and wants nothing to do with anybody. They are
 * separate factions rather than one faction with a flag because every hostility
 * test in the game is a faction test — splitting them means turrets, raiders and
 * self-defence all leave the deer alone without a single extra condition.
 *
 * `prisoner` is a captured raider and exists for exactly the same reason. A flag
 * on a `raider` would have meant auditing every place the game asks "is this
 * thing an enemy" and hoping none was missed; a faction that is hostile to
 * nobody means the turrets, the raid-is-over check and the settler who walks
 * past the cell all get it right for free.
 */
export type Faction = 'colony' | 'raider' | 'wildlife' | 'fauna' | 'trader' | 'prisoner';

/**
 * Wild species. Only ever set on a `fauna` pawn.
 *
 * Three of them are food and one of them eats the other three. A fenwolf is still
 * `fauna` and not `wildlife`: the maddened thornback under that faction comes for
 * your settlers and is answered by drafting, and a pack that came for the herd is
 * a different problem with a different answer. Faction is what the game uses to
 * decide who shoots at whom, and nothing about a wolf wants shooting at on sight.
 *
 * The brambletail is the one that eats something itself. Mossbacks and dunhares
 * are scenery with meat on: nothing they do changes the valley. A brambletail
 * strips the bushes it lives on, so its numbers are the middle term of an actual
 * chain — berries feed it, wolves thin it, and a colony that removes either end
 * finds out which one it was relying on. See `berries.ts`.
 */
export type AnimalKind = 'mossback' | 'dunhare' | 'brambletail' | 'fenwolf';

export interface Cell {
  x: number;
  y: number;
}

/**
 * One wild bramblebush. The plant end of the food chain — see `berries.ts` for
 * what grows it, who eats it, and why it matters that two different things can.
 */
export interface Bush {
  /** Packed cell. */
  c: number;
  /** 0 just stripped, 1 in fruit. */
  ripe: number;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  /** false while it is still a blueprint waiting for materials + work. */
  built: boolean;
  /** Work points applied so far (blueprints only). */
  work: number;
  /** Work points required to finish. */
  workLeft: number;
  /** Materials still required, keyed by resource. Empty object == satisfied. */
  needs: Partial<Record<ResourceKind, number>>;
  /** Materials delivered so far. */
  have: Partial<Record<ResourceKind, number>>;
  hp: number;
  maxHp: number;
  /** door only: 0 closed .. 1 fully open (sim-side so both views agree). */
  open?: number;
  /**
   * Who is in it: for a bed, the pawn sleeping there; for a grave, the pawn
   * buried there. Both mean the same thing to every caller — this one is taken,
   * find another — so they share the field rather than inventing a second one.
   */
  occupant?: number | null;
  /**
   * bed only: the settler this room belongs to. Ownership is re-derived every
   * pass by `tickQuarters` — this is remembered so somebody sleeps in the same
   * room two nights running, not so a claim can outlive the room. Absent on
   * every bed in a shared hall, and on every save written before bedrooms.
   */
  ownerId?: number;
  /** turret only */
  cooldown?: number;
  /**
   * Power: is this thing switched on and fed, as of the last tick?
   *
   * Set by `tickPower` for everything that makes or spends watts, and left
   * undefined on everything that does neither — a bed is not "unpowered", it is
   * a bed. Consumers read it as `=== true`, so a machine the power pass has
   * never looked at is off rather than silently free.
   */
  powered?: boolean;
  /**
   * Consumers only: this machine is off because nothing on its network makes
   * power, rather than because the grid could not carry it. The card says "not
   * wired" instead of "no power", which is a different job for the player.
   */
  unwired?: boolean;
  /** generator and campfire: ticks of run time left in the firebox. */
  fuel?: number;
  /** battery only: stored energy in watt-ticks. */
  charge?: number;
  /**
   * Watermill only: the wheel is locked in the ice, as of the last tick.
   *
   * A latch, not a reading — `iceBears` already answers whether the lake is
   * hard, but "it froze *this* tick" is the only moment worth a line in the log,
   * and that is a change rather than a state. Kept per building so a save can
   * come back mid-winter without announcing a freeze that happened in January.
   */
  iced?: boolean;
  /** cosmetic seed for procedural variation (trees) */
  seed?: number;
  /**
   * Trees only: how grown this one is, 0 to 1.
   *
   * Absent means full grown, which is what makes the field free: every tree in
   * every save written before the forest could regrow has no opinion, and every
   * one of them is a hundred years old. Only a sapling ever carries a number.
   */
  grow?: number;
}

/**
 * What the grid did on the last tick, summed over every network.
 *
 * Derived state — `tickPower` rebuilds it from the buildings every tick, so it
 * is only here for the HUD to read and for a save to carry harmlessly.
 */
export interface PowerReport {
  /** Watts being produced right now. */
  supply: number;
  /**
   * Watts every built consumer wants — including the ones the grid has just
   * switched off. A meter that only counted what survived would read `0 / 0 W`
   * in a blackout, which is the one moment it has to say something.
   */
  demand: number;
  stored: number;
  capacity: number;
  /** Consumers switched off because the grid could not feed them. */
  shed: number;
  /**
   * Consumers standing on a network that makes and stores nothing at all.
   *
   * Kept apart from `shed` because they are a different sentence to the player:
   * a shed machine means build another generator, an unwired one means run a
   * conduit. Optional so a save written before the distinction existed loads.
   */
  unwired?: number;
  /** Tick of the last brownout message, so the log does not flicker. */
  warnTick: number;
}

export interface ItemStack {
  id: number;
  kind: ResourceKind;
  amount: number;
  x: number;
  y: number;
  /** true while a pawn is carrying it (position follows the pawn, not rendered on ground). */
  carriedBy: number | null;
  /** Job that reserved this stack, so two haulers don't fight over it. */
  reservedBy: number | null;
  /**
   * How far gone this stack is: 0 fresh, 1 inedible and removed. Only ever set on
   * the kinds in `SPOIL_DAYS`; absent everywhere else and on saves written before
   * spoilage existed, where it reads as fresh.
   */
  rot?: number;
}

/**
 * What is waiting at a point of interest out on the map.
 *
 * `cache` is buried supplies, `lode` is an ore body worth walking to, `survivor`
 * is somebody who did not make it home on their own.
 */
export type SiteKind = 'cache' | 'lode' | 'survivor';

/**
 * One swap on a caravan's stall: what the colony hands over, what it gets back.
 * The rules that build these live in `trade.ts`; the shape lives here because a
 * `World` carries them and `types.ts` is the module nothing else imports from.
 */
export interface TradeOffer {
  id: number;
  give: { kind: ResourceKind; amount: number };
  /** Goods dropped at the trader's feet, or one new settler. */
  take: { kind: ResourceKind; amount: number } | { hire: true };
  taken: boolean;
}

export interface TradeState {
  /** Ticks until the next caravan sets out. */
  nextVisit: number;
  /** The pawn standing in the yard, or null between visits. */
  traderId: number | null;
  /** Tick at which they pack up. */
  leaveAt: number;
  offers: TradeOffer[];
  /** How many caravans have come. Seeds the deal roll, so a save replays. */
  visits: number;
}

/**
 * Somewhere else that people live.
 *
 * Deliberately off the map rather than on it. The 192×192 grid is the colony's
 * ground, and a neighbour drawn on it would be either a village the player can
 * walk into — a second map's worth of simulation — or a decoration. Off the edge
 * it is a *destination*: a bearing, a number of days, and a reason to send
 * somebody away for a week. See `settlements.ts`.
 */
export interface Settlement {
  id: number;
  name: string;
  /** Which way the road out of the yard runs, in radians. */
  bearing: number;
  /** Days of walking, one way. The whole cost of dealing with them. */
  days: number;
  /** What they have too much of, and will hand over cheaply. */
  sells: ResourceKind;
  /** What they are short of, and will pay over the odds for. */
  buys: ResourceKind;
  /**
   * The trade they are known for, if their surplus is something somebody made
   * rather than something somebody dug up.
   *
   * Optional because it is derived from `sells` rather than rolled, so a save
   * written before recipes had gates gets one the moment it is next asked — and
   * because half the neighbours are raw producers with no workshop at all.
   */
  craft?: CraftRecipe | null;
  /**
   * How deep into the world this place sits: 0 near, 1 middle, 2 far.
   *
   * Distance is the cost model, so depth is the gate — a ring is not reachable
   * until the colony can keep a party alive on the road that long and somebody
   * one ring in will vouch for them. Optional for the same reason `craft` is: a
   * save written when the world was four places wide has no ring on anybody, and
   * `ringOf` reads one off the distance the first time it is asked.
   */
  ring?: 0 | 1 | 2;
  /** −100 hostile to +100 allied. Trading lifts it; being robbed on their road does not. */
  relations: number;
  /** How many caravans the colony has walked out to them. */
  visits: number;
}

/**
 * A trade party on the road, or the memory of one.
 *
 * The traveller is *stored here*, not left on the map — a settler walking to
 * Ashfen is genuinely away, so they take no jobs, eat no meals and cannot be
 * shot at, and the colony has to get by without them. That is the cost the whole
 * feature is built around, so it is modelled honestly rather than by leaving a
 * body standing in the yard with a flag on it.
 */
export interface Caravan {
  /**
   * Which party this is. Only meaningful while a colony can field more than one,
   * which is the whole reason it exists: with two on the road at once, "is there
   * a caravan" stops being enough to tell one trip from the next, and anything
   * counting round trips by watching the world would fold two overlapping
   * journeys into one. Optional because a save written when there was only ever
   * one party has no id to restore; `save.ts` hands those a number on load.
   */
  id?: number;
  settlementId: number;
  /** The traveller, lifted off the map for the duration. Plain data, so it saves. */
  pawn: Pawn;
  /** What they set out with. */
  give: { kind: ResourceKind; amount: number };
  /** What they are bringing back, decided when they get there. */
  take: { kind: ResourceKind; amount: number } | null;
  /** Where they walked off the map, and where they walk back on. */
  x: number;
  y: number;
  /** Tick the current leg ends. */
  dueTick: number;
  phase: 'outbound' | 'inbound';
  /**
   * The tick the deal was actually struck, set only on a run that was not robbed.
   *
   * The seam `commissions.ts` reads to settle a request on the same tick the pack
   * changed hands, without `settlements.ts` having to import it back. Optional
   * because a party already on the road when a save was written never had one.
   */
  dealtTick?: number;
}

/**
 * A place the Ashbound hold, out past a ring of neighbours.
 *
 * The other thing a map can be: not somewhere to sell to, somewhere somebody
 * else is standing. One per ring — see `holdings.ts` for why every number on it
 * is bought from a number the trade road already had.
 */
export interface Holding {
  id: number;
  name: string;
  /** Which way out of the valley. Its own bearing, off the neighbours' compass quarters. */
  bearing: number;
  /** How deep, which is the whole of how far and how hard. */
  ring: 0 | 1 | 2;
  /** True once a war party has taken it and stayed. */
  held: boolean;
  takenTick?: number;
  /** Tick the next tribute cart comes down off the moor. Set only while held. */
  dueTick?: number;
  /** Campaigns sent against it, which is what seeds the next one's dice. */
  attempts: number;
}

/**
 * The colony's army, for as long as it has one.
 *
 * At most one, ever. A colony that can field two war parties is a colony that
 * has stopped being short-handed by sending one, which is the entire cost of the
 * road. The pawns are lifted off the map for the duration, exactly like a
 * caravan's traveller, so they save as plain data.
 */
export interface WarParty {
  holdingId: number;
  /** Filled at the treeline, one settler at a time, and emptied on the homecoming. */
  pawns: Pawn[];
  /** Where they walk off the map, and where they walk back on. */
  x: number;
  y: number;
  /** Tick the muster expires, or the current leg ends. */
  dueTick: number;
  phase: 'mustering' | 'outbound' | 'inbound';
  /** Set at the walls, read on the way in: what the colony gets told when they arrive. */
  won?: boolean;
  killed?: number;
}

/**
 * The far end of one of the three roads, once the colony has committed to it.
 *
 * At most one, ever, and it is deliberately not a latch on the way in: the gate
 * is the top rung of its road and that rung is read live, so a colony that lets
 * a road slip out from under it stops the clock. See `endings.ts` for the whole
 * of the mechanism and for why none of this touches `gameOver`.
 */
/**
 * What the colony was on the day its ending landed.
 *
 * The run does not stop when a terminal lands. That is the choice, not an
 * oversight — the ship leaves and the valley is still there with whoever stayed
 * in it — and it means every number on the ending card would otherwise be read
 * off a world that has moved on since. A colony that sailed on day forty-three
 * and buried two people by day sixty must not be handed a card saying it lost
 * two people getting out. So the tally is taken once, on the tick it lands, and
 * never again.
 *
 * `stats` is a shallow copy, which is right exactly as long as the tally stays a
 * bag of numbers. The day somebody nests an object in it this quietly starts
 * aliasing the live world again, so a test asserts the shape rather than a
 * comment asking nicely.
 *
 * The `manifest` is the same instant told by name instead of by number, and it
 * lives here rather than anywhere else for exactly that reason.
 */
export interface EndingRecord {
  /** Day it landed, one-based, the way the log and the card count days. */
  day: number;
  /** Settlers standing when it landed. */
  standing: number;
  /** The colony's whole tally, frozen. */
  stats: World['stats'];
  /**
   * Who the colony was, by name, on that tick. Optional because a save written
   * between the record and the manifest has a tally and no roll, and the honest
   * reading of that is *nobody wrote the names down* rather than a roll invented
   * out of a world twenty days further on. See `ManifestEntry`.
   */
  manifest?: ManifestEntry[];
}

/**
 * One person on the manifest, as they were on the tick the ending landed.
 *
 * `ENDGAME.md` asks for this and says why: if there is ever a second game that
 * takes these colonists somewhere, the roll is cheap to write here and cannot be
 * reconstructed later from a save that never kept it. So this is deliberately
 * **complete rather than card-shaped** — every skill above zero, not the three
 * the overlay has room for. What to show is the client's problem; what happened
 * is this one's.
 *
 * Every field is a copied value. Nothing on here points at a `Pawn`, because a
 * manifest holding live bodies would be the `EndingRecord` bug one level down:
 * a card about the day the ship sailed, printing the wounds of a settler who was
 * shot a fortnight later.
 */
export interface ManifestEntry {
  /** Their id in the world that wrote this, so a sequel can match a save to it. */
  id: number;
  name: string;
  /**
   * What became of them.
   *
   * `left` and `held` are the same people under two different endings — the ship
   * and the berths take the colony off the map, the dominion is the one you win
   * by staying — and the distinction is worth keeping because it is the only
   * place the record says which kind of ending this was about its people rather
   * than about its bill.
   *
   * `lost` is everyone the colony buried and everyone it never got to bury. The
   * manifest's question is who came, and a headstone is not the difference.
   */
  fate: 'left' | 'held' | 'lost';
  /**
   * Every skill they had a level in, best first. Ties keep table order.
   *
   * Whole levels, the way every other surface in the game reads a skill. The
   * fractional progress towards the next one is a fact about a settler who is
   * still working, and this is a list of people who have stopped.
   */
  skills: { skill: SkillName; level: number }[];
  traits: TraitName[];
  weapon: Pawn['weapon'];
  apparel?: ApparelKind;
  gear?: GearKind;
  /**
   * How much of them was missing: 0 whole, 1 gone. The dead are 1 by arithmetic
   * rather than by a special case, which is the right kind of accident.
   */
  hurt: number;
  /**
   * The person they were paired with, by name, alive or buried.
   *
   * Deliberately not `partnerOf`, which answers *do they have somebody now* and
   * so returns null for the one who is left. On a manifest that would erase the
   * one line worth reading twice: somebody walking onto a ship alone who did not
   * board it alone.
   */
  partner: string | null;
}

export interface EndingState {
  id: EndingId;
  /** Tick the colony committed. Kept for the record even after it lands. */
  committed: number;
  /** Tick the current stretch began, or null while the colony is out of the running. */
  since: number | null;
  /** What has gone into the hull so far. The ship's ledger; empty for the other two. */
  paid: Partial<Record<ResourceKind, number>>;
  /** Day the hull last took a bite, so it takes one a day rather than one a tick. */
  lastWorked: number | null;
  /** Tick it landed, or null. */
  landed: number | null;
  /**
   * The colony as it stood on that tick. Absent until it lands — and absent
   * forever on a save written before the record existed, which reads as "no
   * tally was kept" and is exactly what happened.
   */
  record?: EndingRecord;
}

/**
 * A reason to leave the yard.
 *
 * Everything a colony needs on day one is within ten cells of the door, so
 * without these the map is scenery — settlers mine the same six outcrops and
 * nobody ever looks at the other three thousand cells. Sites are laid down at
 * world generation rather than rolled when a scout arrives, so what is out there
 * is a property of the seed: the same map always holds the same finds, which is
 * what makes a map worth learning.
 */
export interface Site {
  id: number;
  kind: SiteKind;
  x: number;
  y: number;
  /** True once a settler has surveyed it. A site is only worth the walk once. */
  found: boolean;
  /**
   * True once the colony has had eyes on the cell it stands on — which is a
   * different and much weaker thing than `found`. Seeing a cairn from the wall
   * puts a line in the log and a marker on the map; what is buried under it
   * still has to be walked to. Optional so a colony saved before the map had any
   * dark on it still loads: absent reads as "not yet announced", and the first
   * explore pass after the load marks every site already in the open without
   * saying anything about them.
   */
  sighted?: boolean;
  /** cache only: what is buried here. */
  resource?: ResourceKind;
  amount?: number;
}

export type ZoneKind = 'stockpile' | 'growing' | 'pen';

export interface Zone {
  id: number;
  kind: ZoneKind;
  cells: number[]; // packed y * width + x
  /** stockpile filter */
  accepts: ResourceKind[];
}

export type JobKind =
  | 'haulToStockpile'
  | 'haulToBlueprint'
  | 'build'
  | 'deconstruct'
  | 'mine'
  | 'chop'
  | 'cook'
  /** Break a cell of ground over to tilled soil, so what is sown there grows faster. */
  | 'till'
  /** Fetch boards or steel and lay a floor over one cell of ground. */
  | 'floor'
  /** Plant a crop in a growing-zone cell. */
  | 'sow'
  /** Pull a ripe crop and drop the raw food where it grew. */
  | 'harvestCrop'
  /** Walk out to a wild bramblebush and strip the fruit off it. See `berries.ts`. */
  | 'forage'
  | 'eat'
  | 'sleep'
  | 'recreate'
  | 'doctor'
  /** Carry food to a settler who is down and cannot walk to the pantry. */
  | 'feedPatient'
  /** Turn materials into a rifle or a course of medicine at a workbench. */
  | 'craft'
  | 'firefight'
  /** Stand at the research bench and push the current project along. */
  | 'research'
  /** Stalk a marked animal, shoot it, and leave the meat where it fell. */
  | 'hunt'
  /** Stand at a fishing stage over the lake and pull something out of it. */
  | 'fish'
  /** Stand with a marked wild animal until it settles and joins the herd. */
  | 'tame'
  /** Walk out to a penned animal and take what it has grown. See `husbandry.ts`. */
  | 'gatherAnimal'
  /** Walk out to a point of interest and survey it. */
  | 'scout'
  /** Carry a downed raider to a free prison bunk. */
  | 'capture'
  /** Take a meal to a prisoner, who cannot go and get one. */
  | 'feedPrisoner'
  /** Sit with a prisoner and wear their resistance down. */
  | 'recruit'
  /**
   * Get out of a fire. Forced on a settler who is standing in one, over the top
   * of whatever they were doing — including sleeping through it.
   */
  | 'flee'
  /** Carry a settler who cannot walk out of a fire to open ground. */
  | 'rescue'
  /** Carry a body to an empty grave and lay it in. */
  | 'bury'
  /** Walk to the edge of the map with a pack, and leave it. See `settlements.ts`. */
  | 'caravan'
  /**
   * Walk to the edge of the map with a rifle and wait for the other two. Never
   * planned by the colony — a war is the player's decision every time, which is
   * why there is no work type to set a priority on. See `holdings.ts`.
   */
  | 'campaign'
  /**
   * Go and stand there. The colony's own job picker never creates one — this is
   * the player's, the one command that needs no target worth working on, and the
   * reason a hand-driven settler can be sent somewhere without being drafted.
   */
  | 'moveTo';

/**
 * What a workbench can make: the things a colony runs out of and cannot mine,
 * grow or scavenge.
 *
 * The list is short because each one has to be worth *not* being able to make.
 * Every recipe is behind a project, a skill, or both — see `crafting.ts` — and a
 * gate is only interesting if the thing behind it is something the colony misses.
 */
export type CraftRecipe =
  | 'rifle'
  | 'medicine'
  | 'balm'
  | 'rations'
  | 'jerkin'
  | 'parka'
  | 'plate'
  | 'toolbelt'
  | 'medkit';

/**
 * What a settler wears. One slot, so this is always a trade-off — see `gear.ts`.
 */
export type ApparelKind = 'jerkin' | 'parka' | 'plate';

/** What a settler carries to work with. One slot, same reason. */
export type GearKind = 'toolbelt' | 'medkit';

export type EquipKind = ApparelKind | GearKind;

/** Player designations painted onto cells. */
export const DESIG_NONE = 0;
/** Mine the rock / chop the tree in this cell. */
export const DESIG_HARVEST = 1;
/** Tear down the finished building in this cell and refund half its cost. */
export const DESIG_DECONSTRUCT = 2;
/** Break the ground in this cell over to tilled soil. */
export const DESIG_TILL = 3;
/** Lay a plank floor here — three wood, and everyone walks quicker over it. */
export const DESIG_FLOOR_PLANK = 4;
/** Lay a paved floor here — two steel, quicker still, and it will not burn. */
export const DESIG_FLOOR_PAVED = 5;
/** Deck this cell of water over — six wood, and the lake stops being a wall. */
export const DESIG_FLOOR_BRIDGE = 6;

export type JobStage = 'goto' | 'work' | 'carry' | 'deliver' | 'done';

export interface Job {
  id: number;
  kind: JobKind;
  pawnId: number;
  stage: JobStage;
  /** target cell for the current stage */
  tx: number;
  ty: number;
  /** building / item / pawn the job acts on (kind dependent) */
  buildingId?: number;
  itemId?: number;
  targetPawnId?: number;
  /** resource being fetched for a blueprint */
  resource?: ResourceKind;
  /** what a craft job is making */
  recipe?: CraftRecipe;
  amount?: number;
  /** which neighbour a caravan job is walking to — see `settlements.ts` */
  settlementId?: number;
  /** which holding a campaign job is mustering against — see `holdings.ts` */
  holdingId?: number;
  /**
   * The cell a floor job is laying, and what it is laying there. Separate from
   * `tx`/`ty` because those follow the stage — first the woodpile, then the cell.
   */
  floorX?: number;
  floorY?: number;
  floorKind?: FloorKind;
  /** accumulated work for work stages */
  progress: number;
  /** ticks spent; used to abandon jobs that wedge */
  age: number;
  /**
   * Where this sat in the work board's ordering when the look-ahead planned it.
   *
   * Only set on jobs the *colony* lined up, and only so they can be taken back:
   * a plan made while a settler's hands were full is a guess about a board that
   * has since moved, and anything ranked above it gets done first. A player's
   * order has no rank and is never second-guessed — being told is the point —
   * which is also what an old save's queue means, since the field did not exist
   * when it was written.
   */
  rank?: number;
}

export interface Needs {
  /** 1 = full, 0 = starving */
  food: number;
  /** 1 = rested, 0 = exhausted */
  rest: number;
  /** 1 = entertained, 0 = bored */
  recreation: number;
}

/** Illnesses a settler can be carrying. See `sim/health.ts` for the rates. */
export type AilmentKind = 'infection' | 'flu' | 'foodPoisoning';
/**
 * One thing that happened to one settler, and the day it happened on.
 *
 * Written as a bare past-tense clause with no name and no pronoun — "came out of
 * the trees, hurt and asking to stay" — so the card can print it under a name it
 * is already showing and the eulogy can compose two of them into a sentence.
 * Lives here rather than in `lifelog.ts` because `Pawn` holds it and this file
 * imports from nowhere in the sim. See `lifelog.ts` for the rules.
 */
export interface Memory {
  day: number;
  text: string;
}


/**
 * One illness in progress. Two numbers climb towards 1 and whichever arrives
 * first decides the outcome: immunity means they shrug it off, severity means
 * they die of it.
 */
export interface Ailment {
  kind: AilmentKind;
  /** 0..1. Past `DOWN_AT` they cannot stand; at 1 it has killed them. */
  severity: number;
  /** 0..1. At 1 the body has beaten it. */
  immunity: number;
  /** Tick until which the last round of treatment still counts. */
  tendedUntil: number;
  /** 0..1 — how good that treatment was, from the doctor's skill and supplies. */
  tendQuality: number;
}

export type PawnActivity =
  | 'idle'
  | 'walking'
  | 'working'
  | 'sleeping'
  | 'eating'
  | 'relaxing'
  | 'breaking'
  | 'fighting'
  | 'downed'
  | 'dead';

export interface Pawn {
  id: number;
  name: string;
  faction: Faction;
  x: number;
  y: number;
  /** facing angle in radians, 0 = +X */
  facing: number;
  hp: number;
  maxHp: number;
  downed: boolean;
  dead: boolean;
  /** ticks remaining until a downed pawn either bleeds out or stabilises */
  bleed: number;
  needs: Needs;
  /** 0..1, derived from needs + events */
  mood: number;
  /**
   * Morale from things that happened rather than from the three bars — a hot
   * meal at the table, a night on the floor, a funeral. Decays back to zero over
   * about a day. Optional so saves written before it existed still load.
   */
  moodOffset?: number;
  /**
   * How the air feels where this pawn is standing: 0 comfortable, −1 dangerously
   * cold, +1 dangerously hot. A field of its own rather than a `moodOffset` nudge
   * because the offset is always decaying back to zero — a state that holds for as
   * long as you stand in it cannot be expressed as an event. Written once a tick
   * by tickHealth; optional so older saves still load.
   */
  comfort?: number;
  /**
   * What the people around them are worth to their morale — the friends they
   * have, less the people they cannot stand. Written once every social tick by
   * `social.ts` and read by `computeMood`, for exactly the reason `comfort` is a
   * field and not a nudge: having a friend is a state that holds, not an event
   * that decays. Optional so older saves still load.
   */
  socialMood?: number;
  /**
   * How the room they are standing in makes them feel, written by `beauty.ts` on
   * the same cadence and for the same reason as `socialMood`: where you live is
   * a state, not an event. Zero outdoors — a field is not something you decorate.
   * Optional so older saves still load.
   */
  roomMood?: number;
  /**
   * What sleeping in a bunkhouse costs them. Written by `tickQuarters` like
   * `roomMood` is written by `tickBeauty` — a standing fact about the world
   * that `computeMood` cannot look up for itself, because it takes a pawn.
   */
  privacyMood?: number;
  /**
   * What their partner is worth to them, written by `partners.ts` on the same
   * cadence and for the same reason as `socialMood`. Positive while that person
   * is alive and well, smaller while they are hurt, and *negative* for the days
   * after they die — one slot for the whole shape of having somebody, because a
   * settler is either in that state or they are not. Optional; older saves load.
   */
  partnerMood?: number;
  /**
   * Ticks left of grieving a partner, counted down by `partners.ts`. Its only
   * job is to make the loss last longer than the spike: `moodOffset` is clamped
   * and decays flat, so depth cannot distinguish burying a friend from burying
   * your person, and duration can. Absent means not grieving, which is nearly
   * everybody nearly always.
   */
  mourning?: number;
  /**
   * What the air where they are standing is doing to them — zero everywhere
   * except a closed room with an engine running in it. Written once every fumes
   * tick by `fumes.ts`, on the same cadence and for the same reason as
   * `socialMood`: breathing exhaust is a state you are in, not an event that
   * happened. Optional so older saves still load.
   */
  fumesMood?: number;
  /**
   * Ticks left of a morale break: the settler has downed tools and will do
   * nothing for the colony until they feel better. Optional for the same reason.
   */
  breakTicks?: number;
  skills: Record<SkillName, number>;
  priorities: Record<WorkType, number>; // 0 = disabled, 1 = highest .. 4 = lowest
  /**
   * The run of one trade they are on: which work type, and how many of its jobs
   * they have taken back to back. Cleared the moment they do something else —
   * see `tedium.ts`, where the whole rule lives. Optional so older saves load.
   */
  stint?: { work: WorkType; count: number } | null;
  /**
   * Work they have had their fill of, and the tick they will happily take it
   * again. A preference, not a refusal: a settler with nothing else on the
   * board still does it. Optional for the same reason.
   */
  tedium?: Partial<Record<WorkType, number>>;
  jobId: number | null;
  /**
   * The control stack: ids of jobs this settler has taken but not started, in the
   * order they will be picked up. They are ordinary entries in `world.jobs` and
   * hold their reservations from the moment they are queued, so nobody else goes
   * after the same tree — the only thing that makes them different from
   * `jobId` is that nothing ticks them yet. See `sim/queue.ts`.
   *
   * Optional so saves written before the stack existed still load; absent reads
   * as empty.
   */
  queue?: number[];
  /**
   * The player has taken this settler off the work board. They still eat and
   * sleep — hand-driving somebody is not a licence to starve them — but the
   * colony never picks work for them again until it is switched off, and the
   * stack holds only what the player put there. Optional for the same reason.
   */
  manual?: boolean;
  path: number[] | null; // packed cells, path[0] is the next step
  /**
   * The tick a route search last came back with nothing.
   *
   * Only the combat pass sets it, and only so that "I have no path" and "there
   * is no path" stop looking the same. A raider outside a sealed colony fails
   * every search it runs, and a failed search leaves `path` null, so the "no
   * path — search now" rule sent it back through a full-map A* on every one of
   * the next twenty-four ticks. Optional: an old save simply searches once.
   */
  pathFailedAt?: number;
  activity: PawnActivity;
  /** carried stack id (hauling) */
  carryingItemId: number | null;
  /**
   * Whoever this pawn has over their shoulder — a captive being carried to a
   * bunk, or a settler being dragged out of a fire. The carried pawn's position
   * is written from the carrier's every tick, so
   * both views show one body carrying another rather than two bodies overlapping.
   * Optional so saves written before prisoners existed still load.
   */
  carryingPawnId?: number | null;
  /**
   * The dead only: somebody put them in a grave. A buried pawn stays in
   * `world.pawns` so the grave can name whoever is in it, but stops counting as
   * a corpse — no mood penalty, no body drawn, no job goes looking for them.
   * Optional so saves written before graves existed still load.
   */
  buried?: boolean;
  /**
   * The dead only: ticks spent lying out unburied. At `ROT_TICKS` there is
   * nothing left to bury and the body leaves the world, which is also what
   * stops `world.pawns` growing without bound over a long game.
   */
  rot?: number;
  /**
   * Prisoners only: how many more sessions of persuasion they have in them.
   * Counts down to zero, at which point they join the colony.
   */
  resistance?: number;
  /** Prisoners only: the bunk they were laid in, so nobody else claims it. */
  bunkId?: number;
  /**
   * Prisoners only: the tick before which nobody may sit down with them again.
   * Without it a warden talks continuously and a raider joins the colony inside
   * an afternoon, which makes capturing strictly better than fighting.
   */
  talkCooldown?: number;
  drafted: boolean;
  /** manual move order while drafted */
  orderX: number | null;
  orderY: number | null;
  /** combat */
  weapon: 'none' | 'club' | 'rifle';
  /**
   * What they are wearing and what they are carrying. Optional, and read through
   * `gear.ts` rather than directly, so a save written before either existed loads
   * as a settler in their own clothes with their bare hands — which is what every
   * settler was until somebody worked out tanning.
   */
  apparel?: ApparelKind;
  gear?: GearKind;
  attackCooldown: number;
  targetPawnId: number | null;
  /** true while a human player is inhabiting this body (sim honours it by
   * suppressing autonomous movement — the body still has needs and can work). */
  playerControlled: boolean;
  /** animation phase, advanced by the sim so both views agree */
  animPhase: number;
  /** ticks the pawn has been stuck with no path progress */
  stuck: number;
  /**
   * Hostiles only: ticks spent with no route to a target and nothing to break.
   * Optional so saves written before it existed still load — absent reads as 0.
   */
  frustration?: number;
  /**
   * Hostiles only: the building this one has decided to break through rather
   * than walk round. Held across ticks so the choice does not flip every time
   * the route is re-read — the moment it commits, the way round stops being the
   * shorter answer, and a raider re-asking that question would pace the fence
   * line forever. Optional for the same reason as `frustration`.
   */
  breachId?: number;
  /** Fauna only: which species. Absent on people. */
  animal?: AnimalKind;
  /** Fauna only: tick until which it runs from whatever just hurt it. */
  fleeUntil?: number;
  /** Fauna only: the player has marked this one for the hunters. */
  hunted?: boolean;
  /**
   * Fauna only: livestock. Still `fauna` rather than `colony` on purpose — a goat
   * has no mood, no skills and no vote in the work board, and promoting it to the
   * colony faction would quietly hand it all three.
   */
  tame?: boolean;
  /** Fauna only: the player has marked this wild animal to be coaxed in. */
  tameTarget?: boolean;
  /**
   * Fauna only: this one eats the others.
   *
   * A flag on the pawn rather than a lookup in the species table, so `predators.ts`
   * can be written without ever knowing what a fenwolf is — the same trick that
   * keeps `pets.ts` and `livestock.ts` importable by `wildlife.ts` instead of
   * tangled with it. Written once by whatever spawned the animal.
   */
  hunts?: boolean;
  /** Fauna only, predators: tick until which it has eaten and leaves the herd alone. */
  fed?: number;
  /** Fauna only, predators: tick at which its pack has had enough of this valley. */
  packUntil?: number;
  /**
   * Fauna only: a predator got it, so there is nothing left to carry home.
   *
   * The alternative was a pack in the yard being thirty-four free food a night,
   * which would make the correct play "let them eat" — see `predators.ts`.
   */
  eaten?: boolean;
  /**
   * Fauna only: the settler this animal belongs to, rather than the colony.
   *
   * Set the moment a tame job finishes and never by a sweep — see `pets.ts`. A
   * bonded animal is not livestock: it follows its person instead of the pen, it
   * cannot be marked for the table, and its body is not butchered.
   */
  bondedTo?: number;
  /**
   * Fauna only: what its person calls it. Absent on everything that is still a
   * mossback rather than somebody's Biscuit.
   *
   * Stored *beside* `name` rather than over it, on purpose. `name` holds the
   * species label for every animal in the game, and overwriting it would mean
   * `pets.ts` had to know how to put it back — which would mean importing the
   * species table, which would mean a cycle with `wildlife.ts`. This way letting
   * an animal go is one deleted field.
   */
  petName?: string;
  /**
   * Colony only: what having a companion alive is worth on the mood scale.
   *
   * Recomputed every tick by `tickPets` like `socialMood` and `roomMood`, because
   * `computeMood` runs off the needs and would erase anything written straight
   * into `mood`.
   */
  petMood?: number;
  /**
   * Fauna only: the tick this one was born — a real one for anything born in the
   * pen, a back-dated one for anything that walked onto the map already grown.
   *
   * Absent means grown and ageless, which is what every animal in a save written
   * before this existed is; `tickWildlife` hands those a birthday on its next
   * sweep so they start ageing from the day the save was loaded rather than
   * dropping dead of the years they never lived. See `wildlife.ts`.
   */
  born?: number;
  /**
   * Fauna only: this one died of old age rather than of anything anyone did.
   *
   * The carcass sweep reads it to leave the meat out of a body that was already
   * finished when it fell — a hide, and nothing anyone will eat. Absent on every
   * animal that was killed, which is the only kind that feeds a colony.
   */
  aged?: boolean;
  /**
   * Livestock only: the tick this one is next worth collecting from.
   *
   * A timestamp rather than a running total, so nothing accrues per tick and an
   * animal from a save written before husbandry existed simply has none — see
   * `husbandry.ts`, which hands it one on its next sweep.
   */
  ripeAt?: number;
  /**
   * Fauna only: this one is passing through — where it is headed, and the tick
   * after which it gives up and lives here instead.
   *
   * The deadline is not decoration. A migrating animal walks at its target every
   * tick, so one that wedges itself against a rock face would shove at it for the
   * rest of the game; when the clock runs out it simply becomes resident
   * wildlife, which is both a true thing to say about a herd and the only failure
   * mode that does not need a pathfinder.
   */
  migrateTo?: { x: number; y: number; until: number };
  /**
   * Fauna only: the tick a handler last failed to find any route to this animal.
   *
   * A marked animal on the far side of a river is a search of the whole map that
   * fails, repeated every time anybody looks for farm work — the one shape of
   * pathfinding that costs the most and buys the least. Stamping the failure lets
   * everyone skip it until the ground might plausibly have changed.
   */
  unreachable?: number;
  /**
   * People only — never fauna. One or two, and optional because saves written
   * before the trait table existed are backfilled on load rather than rejected.
   */
  traits?: TraitName[];
  /**
   * The handful of things that happened to this one, oldest first and capped.
   *
   * Optional and never backfilled: a settler loaded out of an older save has no
   * recorded past, which is honest — the events are gone and the alternative is
   * inventing a history for somebody who does not have one. They start keeping
   * one from the next thing that happens to them. See `lifelog.ts`.
   */
  memories?: Memory[];
  /**
   * Illnesses currently running. Absent on anyone who has never been sick, which
   * is most of the map most of the time — and which is why it is optional rather
   * than an empty array everybody carries.
   */
  ailments?: Ailment[];
  /**
   * Tick until which a doctor's last dressing holds. Lives on the body rather
   * than on the ailments because a bandaged wound with no fever behind it still
   * has to count as looked-after — that dressing is what keeps it from going
   * septic in the first place.
   */
  tendedUntil?: number;
  /**
   * Tick until which nothing new can take hold. Set when an ailment clears, so
   * beating a fever is worth something — see `afflict` in `health.ts`.
   */
  wellUntil?: number;
  /**
   * Consecutive ticks on an empty stomach, reset by the first mouthful. Mood
   * climbs with it, so the third day of a famine is worse than the first.
   */
  emptyTicks?: number;
  /** cosmetic */
  colorSeed: number;
}

/**
 * What a Picky was summoned to find out. See `pickies.ts`.
 *
 * Every task is a *question about the world* rather than work the colony wants
 * done — that is the line between a Picky and a job. A Picky never carries
 * anything, never builds anything and never fights; it goes and looks, says what
 * it found, and stops existing.
 */
export type PickyTask =
  /** Can anything get from where the colony stands to this cell? */
  | { kind: 'reach'; x: number; y: number }
  /**
   * Can anything still get to the things the colony has already built?
   *
   * The itinerary — packed cells — is chosen once, when the Picky is summoned,
   * rather than a stop at a time. That is what makes the errand repeatable.
   */
  | { kind: 'rounds'; stops: number[] }
  /**
   * Does every door still open, and can anything get to it?
   *
   * A door that has been walled in on both sides is the quietest failure the
   * colony has: it looks built, it looks fine, and nothing will ever use it.
   */
  | { kind: 'doors'; stops: number[] }
  /**
   * The hauling chain: something on the ground, then somewhere to put it.
   *
   * Two stops, in order — the stack, then the nearest stockpile cell that would
   * take it. This is the failure the work board cannot report, because a haul
   * job that could never be finished is simply a job that never gets handed out.
   * `what` is the resource, so the verdict can name it.
   */
  | { kind: 'fetch'; stops: number[]; what: string };

/**
 * A Picky: a small pink goblin summoned to answer one question about the map.
 *
 * It is deliberately not a `Pawn`. It has no needs, no skills, no health, no
 * faction and no job — giving it those would put it on the work board, in the
 * combat pass and in the colonist count, and a diagnostic that changes the thing
 * it is measuring is worthless. What it *does* share with a settler is the part
 * that matters: the same pathfinder and the same collision, via the `Walker`
 * shape in `movement.ts`. A reachability tester that walks by different rules
 * than the colony does would answer the wrong question.
 *
 * Plain data like everything else in the World, so it survives a save without a
 * line of code — a Picky mid-errand comes back mid-errand.
 */
export interface Picky {
  id: number;
  x: number;
  y: number;
  /** The `Walker` fields. Driven by the same `followPath` a settler uses. */
  path: number[] | null;
  stuck: number;
  facing: number;
  animPhase: number;
  task: PickyTask;
  /** Tick it was summoned, which is what the patience timeout is measured from. */
  born: number;
  /** Packed cell it is currently walking to, or null when it needs a new one. */
  target: number | null;
  /** Which leg of the errand it is on — the index into a `rounds` itinerary. */
  leg: number;
  /**
   * Ticks left of the vanishing, or null while it is still working. Set the
   * moment its answer is delivered — a Picky that has said its piece is already
   * on the way out, and the countdown is only there so the player sees it go.
   */
  poof: number | null;
  /** Its own randomness, so nothing a Picky does can move the world's streams. */
  seed: number;
  /** Cosmetic: which shade of pink, how big the ears. */
  colorSeed: number;
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  ownerId: number;
  faction: Faction;
  damage: number;
  life: number;
  /**
   * A pawn this shot may hit even though the factions are not at war — how a
   * hunter's bullet reaches a deer that nobody is fighting. Everything else in
   * the world still resolves by faction.
   */
  targetId?: number;
  /**
   * A building this shot was deliberately aimed at, and will hit.
   *
   * Bullets pass straight over cover — a turret is 1.4 high and `blocksSight`
   * waves everything through — which is exactly right for the shot that was
   * aimed at somebody else and quite wrong for the shot that was aimed at the
   * turret. This is how a raider answers an emplacement: they take aim at the
   * machine rather than the people, and the round stops where they aimed it.
   */
  targetBuildingId?: number;
  /** true once it has hit something; render fades it out then it is culled */
  spent: boolean;
}

export interface Fire {
  id: number;
  x: number;
  y: number;
  /** 0..1 intensity */
  size: number;
}

/**
 * The colony's intent to put back something it lost to fire or a raider. Held as
 * a plan rather than as an immediate blueprint because the cell it names is,
 * almost by definition, on fire or being shot at — see `sim/rebuild.ts`.
 */
export interface RebuildPlan {
  kind: BuildingKind;
  x: number;
  y: number;
  /** When it was lost. Only used to decide which plans to drop when over the cap. */
  tick: number;
}

export interface Message {
  tick: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'threat';
  /**
   * Where it happened, when it happened somewhere. The log turns this into a
   * button that puts the camera on the spot — "raiders break the treeline" is a
   * different sentence when you can see which treeline.
   */
  at?: { x: number; y: number };
  /**
   * A story beat rather than a line of the work log: raids, arrivals, fires,
   * deaths, the founding. The client raises these over the world as cards,
   * because the log says a thing once and then scrolls it away, and "somebody
   * finished a wall" and "somebody died" cannot cost the same amount of
   * attention. Off by default — most messages are the work log.
   */
  headline?: boolean;
}

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

export interface WeatherState {
  kind: WeatherKind;
  /** Ticks before the sky rolls again. */
  ticksLeft: number;
  /**
   * How far the current kind has arrived, 0..1.
   *
   * Weather fades rather than snaps: without this the sun would switch off
   * between two frames and rain would appear at full force out of a clear sky,
   * which reads as a bug rather than as a front coming in.
   */
  blend: number;
  /** Tick of the last lightning strike, so both views flash on the same frame. */
  strikeTick: number;
}

export interface StorytellerState {
  /** ticks until the next threat beat */
  nextThreat: number;
  /** ticks until the next settler wanders in */
  nextArrival: number;
  /**
   * Ticks until anyone may set out to survey another site.
   *
   * Without it a colony with an idle afternoon walks the whole map in a day and
   * a half and empties every find on it — eight discoveries arriving as one
   * supply drop, and then nothing out there for the rest of the game. The
   * cooldown spaces them roughly one per raid cycle, which is the rhythm the
   * rest of the storyteller already keeps.
   */
  nextScout: number;
  /**
   * Ticks the colony has been free to send somebody out and hasn't — see
   * `tickScoutItch`. Counted only while it genuinely could have gone, so it
   * measures neglect rather than bad luck. Optional so saves written before the
   * itch existed still load; absent reads as "not overdue", which is the safe
   * side of a timer that pushes a settler off the map.
   */
  scoutItch?: number;
  /**
   * Ticks until somebody comes down with something. Kept off the threat timer
   * because an outbreak is not a raid: it should be able to land in the middle
   * of one, and it should not push the next raid back when it does. Optional so
   * saves written before illness existed still load.
   */
  nextOutbreak?: number;
  /**
   * Tick the aurora dies down and the wires come back, or absent when the sky is
   * quiet. Optional so saves written before flares existed still load — absent
   * reads as "no flare", which is exactly what those colonies meant.
   */
  flareUntil?: number;
  threatsFired: number;
  /** raid in progress */
  raidActive: boolean;
  /**
   * Fights the colony has won without anybody hitting the ground.
   *
   * The Ashbound's read on how the war is going, and the only thing in the
   * storyteller that looks at the colony at all. Everything else here counts
   * beats: the band size is a function of beats fired, the raider stat line is a
   * function of beats fired, and both of them stop moving at beat ten. Measured
   * on a hundred-day run, a colony meets the same six raiders on day ninety that
   * it met on day twenty — by which point it has walls, turrets, rifles and
   * settlers enough to point them with.
   *
   * A streak rather than a wealth score on purpose. Scaling on what the colony
   * owns punishes the player for building the things the first thirty days spent
   * teaching them to build, and every player who works that out starts playing
   * poor. A streak can only be shortened by taking casualties, so the only way to
   * keep the raids small is to keep losing people — which is not a strategy, it
   * is the losing condition arriving slowly.
   *
   * Counts every fight rather than only raids: a colony that puts down a predator
   * pack without a scratch is a colony word gets round about, and saying so is
   * cheaper than the fourth field it would take to record which kind of thing had
   * been shooting at it.
   *
   * Optional so saves written before the Ashbound learned anything still load;
   * absent reads as 0, which is the band this game has always sent.
   */
  unbloodied?: number;
  /**
   * Set the tick a settler goes down while a fight is on, cleared when it ends.
   * Read once, at the end, to decide whether the streak survives.
   *
   * Latched rather than sampled at the end because getting somebody back on their
   * feet before the shooting stops is a good day, not an untouched one: the
   * question is whether the attackers landed a blow, and a settler who spent ten
   * minutes on the grass is a yes.
   */
  raidHurt?: boolean;
  /**
   * What `stats.colonistsLost` stood at when the current fight began, or absent
   * when there is no fight on. Doubles as the "am I tracking one" flag, which is
   * why it is set from the tick loop rather than from the three separate places
   * that start a fight — one door in, and no fourth caller to forget.
   *
   * Deaths need their own term because a settler killed outright never passes
   * through `downed`, and a fight that killed somebody is emphatically not one the
   * Ashbound should read as an instruction to bring more people next time.
   */
  raidMark?: number;
}

/**
 * Is the grid dead under a solar flare?
 *
 * Lives here rather than beside the encounter that starts one because the power
 * pass has to ask it, and a helper in `encounters.ts` would point the dependency
 * backwards: the storyteller knows about the grid, the grid must not have to
 * know about the storyteller. One reading, so "the panels make nothing" and "the
 * meter says nothing" can never disagree.
 */
export function flareActive(world: World): boolean {
  return (world.storyteller.flareUntil ?? 0) > world.tick;
}

/**
 * How hard the valley bites. The table behind these lives in `difficulty.ts`;
 * the name lives here because `World` carries it and `types.ts` is the leaf
 * nothing in the sim is allowed to import upward from.
 */
export type Difficulty = 'calm' | 'settler' | 'harsh';

export interface World {
  version: number;
  seed: number;
  /**
   * The difficulty the player landed on. Optional, and absent reads as
   * `settler` — which is both what every save written before the setting existed
   * meant and what every test world means, since `settler` scales nothing.
   */
  difficulty?: Difficulty;
  tick: number;
  width: number;
  height: number;
  terrain: number[]; // Terrain index per cell
  /**
   * Bumped every time a cell of terrain changes after worldgen. See `setTerrain`.
   *
   * Reachability and rooms are both derived indexes that rebuild when their
   * fingerprint moves, and both fingerprints are of the *buildings* — hashing
   * every cell on every query would cost more than the rebuild it saves. That
   * left terrain edits, which nothing hashed, caught instead by rebuilding both
   * indexes on a timer whether or not anything had happened: a full flood fill of
   * the valley, once a second, forever. On the old map that was affordable and on
   * a bigger one it is the single largest cost in the simulation, because it is
   * the one thing that scales with the *area* rather than with what is happening.
   *
   * One counter replaces the timer. Three lines of code edit terrain — a floor
   * laid, a field tilled, a rock face mined out — and all three go through the
   * same helper, so the fingerprint moves the instant the ground does and the
   * rebuild happens because something changed rather than because a second went
   * by. Optional, because a save written before it existed simply starts at zero.
   */
  terrainRev?: number;
  /**
   * Bumped whenever the standing buildings change: one is added, one is removed,
   * or one finishes building or stops being built.
   *
   * The same trick as `terrainRev` and for the same reason, but it was worth a
   * great deal more. The room index used to fingerprint its inputs by walking
   * every building on the map and hashing the walls — a few hundred multiplies,
   * which the comment on it called cheap enough to check on every query. That was
   * true when the caller was `roomAt` a handful of times a tick. It stopped being
   * true when temperature and crop growth started asking per *cell*: at 192² with
   * a built-up colony the walk ran tens of thousands of times a tick and showed up
   * as the single largest line in the profile, above the whole of wildlife. The
   * fingerprint was costing far more than the rebuild it existed to avoid.
   *
   * Optional, because a save written before it existed simply starts at zero.
   */
  buildRev?: number;
  /**
   * What the ground was before a floor went over it, keyed by packed cell.
   *
   * Floors are terrain, which is the decision the whole of `floors.ts` follows
   * from, and its one cost is that laying boards *overwrites* what they cover:
   * the header there used to say a floor could not be taken up again for exactly
   * this reason. This is the note that makes taking it up possible — one entry
   * per laid cell, written the first time a floor covers open ground and left
   * alone when one floor replaces another, so paving a plank corridor still
   * remembers the grass underneath rather than the boards.
   *
   * Sparse and optional rather than a parallel `terrain` array. A colony floors
   * a few hundred cells out of thirty-six thousand, so an object costs a
   * hundredth of what a second full-map array would in every save file; and
   * optional means a colony saved before floors could be removed loads fine and
   * simply falls back to grass for the boards it laid before anyone was
   * writing this down.
   */
  floorUnder?: Record<number, number>;
  /** building id per cell, -1 for none */
  cellBuilding: number[];
  /** zone id per cell, -1 for none */
  cellZone: number[];
  /** DESIG_* per cell */
  cellDesig: number[];
  /** Crop growth per cell: CROP_NONE for bare soil, else 0 (just sown) .. 1 (ripe). */
  crops: number[];
  /**
   * Wild bramblebushes, as a list rather than a per-cell array: there are about
   * three hundred of them on thirty-seven thousand cells, and every consumer
   * wants "the nearest ripe one", which a sparse list answers in three hundred
   * comparisons and a grid answers in thirty-seven thousand. Optional so a colony
   * saved before the
   * valley had brambles still loads — `ensureBushes` regrows them off the seed,
   * so that colony gets the bushes its own map would always have had.
   */
  bushes?: Bush[];
  /**
   * 1 per cell the colony has ever laid eyes on, 0 for ground still under haze.
   * Only ever goes up — see `explore.ts`. Optional so a colony saved before the
   * map had any dark on it still loads; it is built on that colony's first tick,
   * lit around the settlers and buildings it already has.
   */
  seen?: number[];
  buildings: Building[];
  items: ItemStack[];
  zones: Zone[];
  /** Points of interest out on the map, laid down by worldgen. */
  sites: Site[];
  jobs: Job[];
  pawns: Pawn[];
  projectiles: Projectile[];
  fires: Fire[];
  /**
   * Buildings lost to damage that the colony means to put back. Optional so a
   * colony saved before this existed still loads — absent reads as "nothing
   * outstanding", and the first tick after the load fills it in.
   */
  rebuilds?: RebuildPlan[];
  messages: Message[];
  /**
   * The story, kept. `messages` is a work log and behaves like one — it holds the
   * last eighty lines and drops the rest, which is right for a panel you glance at
   * to see what the crew is doing this minute and wrong for the only record of the
   * fact that Wren died in the spring.
   *
   * So every message raised with `headline: true` is also copied here, and here
   * nothing is dropped until five hundred of them have accumulated, which is
   * several in-game years. Two lists rather than one flag on one list because they
   * answer different questions and want different lengths: "what is happening" is
   * a window and "what happened" is a history.
   *
   * Optional so a colony saved before it existed still loads — absent reads as an
   * empty chronicle, and the story starts being kept from the load onward. That is
   * a real loss of the past on one save each, and the alternative is a save
   * version bump that costs every player their colony, which is worse.
   */
  chronicle?: Message[];
  weather: WeatherState;
  /**
   * How deep the snow is lying, 0 bare to 1 buried — one number for the whole
   * map, see `snowpack.ts`. Optional so a colony saved before winter had a
   * ground layer still loads; absent reads as bare, and the first tick after the
   * load fills it in from the sky overhead.
   */
  snow?: number;
  /**
   * How thick the ice on the lake is, 0 open to 1 solid — see `ice.ts`. Optional
   * for the same reason the snow is, and with the same consequence: a save from
   * before the lake froze loads as open water and freezes again from the season
   * it is loaded into.
   */
  ice?: number;
  /**
   * How much fish is left in the lake, 1 full to 0 emptied — see `fishing.ts`.
   * One number for the whole body of water, for the same reason the ice is one
   * number, and optional for the same reason: a save from before anybody thought
   * to fish loads with a full lake.
   */
  fish?: number;
  /**
   * Whether the lake is currently shut for fishing — the latch half of the band
   * in `fishing.ts`. Which way the stock last crossed is not a function of the
   * stock, so it has to be remembered; absent means open, which is what a save
   * from before there were fish in the water should load as.
   */
  fishOut?: boolean;
  /**
   * When the pen was first noticed to hold only one sex — the timer behind the
   * "there will be no calves" hint in `wildlife.ts`.
   *
   * A player who tames two males waits forever for a birth that cannot come, with
   * nothing on screen that says so. This remembers how long that has been true, so
   * the game can say it once after half a day instead of every tick. Absent means
   * the pen is fine, or there is no pen, which is what a save from before animals
   * had a sex should load as.
   */
  pairSince?: number;
  storyteller: StorytellerState;
  research: ResearchState;
  nextId: number;
  /** rng stream cursors so a reloaded save keeps rolling the same numbers */
  /**
   * `health` is optional so saves written before illness existed still load; it
   * is derived from `main` when absent, which keeps an old colony deterministic
   * from the moment it is opened.
   */
  rng: {
    main: number;
    combat: number;
    story: number;
    health?: number;
    social?: number;
    /** Where the next seed falls. Its own stream so a sapling cannot move a raid. */
    forest?: number;
  };
  /** set when the colony is wiped */
  gameOver: boolean;
  /** cumulative counters, handy for tests + the HUD */
  stats: {
    built: number;
    mealsCooked: number;
    raidersKilled: number;
    colonistsLost: number;
    sitesScouted: number;
    /**
     * Morale breaks started. Optional so saves written before morale existed
     * still load — absent reads as 0, same as `frustration` on a pawn.
     */
    moraleBreaks?: number;
    /**
     * Saplings the valley has put up on its own.
     *
     * Counted because a system nothing counts is a system nobody notices has
     * stopped — the liveness census reads this, and it is the only place that
     * would catch the forest quietly ceasing to grow back.
     */
    grown?: number;
    /** Deals struck with a caravan. Optional for the same reason. */
    trades?: number;
    /** Downed raiders carried to a bunk rather than left to bleed out. */
    captured?: number;
    /** Prisoners talked round into settlers. Optional for the same reason. */
    recruited?: number;
    /**
     * Raw food that has come into the world since the colony landed — every crop
     * lifted and every carcass butchered.
     *
     * The one source term the food ledger needs. Everything else that touches the
     * pantry takes away from it, so `start + rawGathered` is the ceiling on what
     * can ever be standing in it, and a run that ends above that line has
     * conjured food from somewhere. Optional, like every counter added after the
     * save format settled.
     */
    rawGathered?: number;
    /** Trade parties that walked out to a neighbour and came home. Optional, as above. */
    caravans?: number;
    /**
     * Worth handed over to the neighbours, at the `VALUE` yardstick, across every
     * deal the colony has ever struck out on the road.
     *
     * Booked at the settlement rather than at the gate: a pack that was robbed on
     * the way out cost the colony exactly as much and bought it nothing, and this
     * is the tally of what the road *earned*, not of what left the yard. It is the
     * berths' whole bill — see `endings.ts` — and it is the only cumulative
     * counter in this list that is denominated in worth rather than in things.
     */
    tradedWorth?: number;
    /** War parties sent. Counted at the muster, because that is when the colony committed to it. */
    campaigns?: number;
    /** Holdings taken and kept. Optional, as above. */
    holdingsTaken?: number;
    /**
     * Settler-days spent on campaign, booked in full the day the party forms up.
     *
     * The whole round trip rather than the days walked so far: the road home is
     * not optional, and a count that accrued day by day would read a holding as
     * free for the week between taking it and standing down — which is exactly
     * the window `no-holding-falls-for-free` is watching.
     */
    warPawnDays?: number;
    /** Requests from over the ridge the colony actually answered. Optional, as above. */
    commissions?: number;
    /**
     * Cells of the map the colony has ever seen. Kept beside the counters rather
     * than recomputed, because it doubles as the change signal the shroud
     * renderer keys off: thirty-seven thousand cells are cheap to walk once and dear to
     * walk every frame. Optional, as above.
     */
    explored?: number;
  };
  /**
   * Milestone ids the colony has already earned, in the order they landed.
   *
   * The only stored part of `objectives.ts` — everything else about a milestone
   * is measured off the world on the spot. Optional so an older save loads; it
   * comes back empty and re-earns whatever that colony has already done on its
   * first second, since every measure reads state the colony still has.
   */
  objectives?: string[];
  /**
   * The founding clock — `since` is the tick every charter came true together
   * (null when the colony is short of one), `won` is set once it has held for
   * `HOLD_TICKS`. See `victory.ts`.
   *
   * Optional so a colony saved before there was a way to win still loads; it
   * comes back with the clock stopped and restarts it on the first tick if it
   * already qualifies, because every charter is measured off state it still has.
   */
  charter?: { since: number | null; won: boolean };
  /**
   * What every pair of settlers who have met think of each other: `"3:7"` (the
   * smaller id first) to an opinion from −100 to +100.
   *
   * Sparse on purpose — a colony of eight has at most twenty-eight entries and
   * usually far fewer, so this is cheaper to store and to walk than a field on
   * every pawn would be. Optional so an older save loads; that colony starts as
   * strangers and has opinions again inside a day. See `social.ts`.
   */
  bonds?: Record<string, number>;
  /**
   * Who is paired with whom, by pawn id, written both ways so a lookup from
   * either side is one read.
   *
   * Both directions rather than a canonical `"3:7"` key like `bonds` because the
   * question this answers is always "does *this* settler have somebody", asked
   * once per colonist per tick, and a scan to answer it would be silly. The
   * duplication is two numbers. See `partners.ts`.
   */
  partners?: Record<number, number>;
  /**
   * Pairs who are close enough to pair off but have not held it long enough yet,
   * keyed like `bonds` and holding the tick they first crossed the line.
   *
   * This exists because the threshold on its own turned out to be a *peak*, not a
   * commitment: measurement showed the top bonds in an ordinary colony pinned at
   * the cap inside a fortnight, so "months of choosing each other" was a comment
   * describing a game that was not being played. The stamp is what makes it true
   * — a bond has to still be there ten days after it first got there. See
   * `partners.ts`.
   */
  courting?: Record<string, number>;
  /** Friendships and feuds already announced, so each is news exactly once. */
  bondsTold?: string[];
  /**
   * The caravan clock and whatever is currently on the stall. Optional so saves
   * written before trade existed still load — `tradeState()` fills it in on the
   * first tick after a load.
   */
  trade?: TradeState;
  /**
   * What the colony could make as of the last check, so it can notice when that
   * changes. `hands` is how many settlers qualify for each recipe and `can` is
   * whether the colony could actually make it — research included.
   *
   * Optional so an older save loads: that colony records where it stands on its
   * first tick and says nothing, which is right. It has not just learned or lost
   * anything, it has only just been read off a disk. See `knowhow.ts`.
   */
  knowhow?: { hands: Partial<Record<CraftRecipe, number>>; can: Partial<Record<CraftRecipe, boolean>> };
  /**
   * Last tick's grid summary. Optional so saves written before power existed
   * still load — the first tick after a load fills it in.
   */
  power?: PowerReport;
  /**
   * Remembered room air temperatures, keyed by the room's lowest cell index.
   *
   * Rooms themselves are derived state rebuilt from the walls, so they are
   * deliberately not in the save — but the heat *in* them is not derivable from
   * anything, and without this a reloaded colony's fires all go out and its
   * freezer comes back up to room temperature. Optional, so older saves load and
   * simply settle on their first tick.
   */
  roomTemps?: Record<string, number>;
  /**
   * Whether the colony marks out its own improvements. Optional and read as
   * *on* when absent, which is what an older save has to mean: the field did not
   * exist when it was written, and a colony that loads with its foreman
   * mysteriously asleep is a bug with no visible cause. See `steward.ts`.
   */
  steward?: boolean;
  /** The id of the last ambition the Steward committed to, for the HUD. */
  stewardLast?: string;
  /** Whether the colony has already been told the air is bad, so it is said once. */
  fumesTold?: boolean;
  /**
   * Packed cells the last sweep found nobody could reach, waiting on a second
   * opinion. See `stranded.ts` — a plan has to fail twice before it is called
   * off, and a save reloaded mid-suspicion starting the count again is the
   * cautious way round.
   */
  stranded?: number[];
  /**
   * The neighbours. Optional, and filled in on first use from the map seed, so
   * the same map always has the same people over the ridge — and so a save
   * written before any of this existed loads and meets them. See `settlements.ts`.
   */
  settlements?: Settlement[];
  /**
   * The trade parties currently on the road. Empty most of the time.
   *
   * It was one at a time, on the reasoning that the interesting version of the
   * decision is "can we spare *anyone* for a week" rather than "how many". That
   * is the right question for a colony of four and the wrong one for a colony of
   * fifteen, and the sixty-day grid said so: benches at the top of the free tree
   * waited up to eighteen days for a bill a near town could have filled three
   * times over, because one road was open and everything queued behind it. See
   * `the-road-keeps-up-with-the-bench`.
   *
   * The cap is small and stays small — `CARAVAN_PARTIES_MAX` in `settlements.ts`
   * — because the cost being interesting is the point. Two settlers away is a
   * colony visibly short-handed; twelve is an empty map.
   */
  caravans?: Caravan[];
  /**
   * The single party a save written before the cap existed was carrying.
   *
   * Load-bearing for exactly one function: `save.ts` folds it into `caravans` and
   * clears it. Nothing else may read it — a settler who is four days from home
   * when the player upgrades should walk in as though nothing happened, and the
   * only way that stays true is if the migration is the sole reader.
   */
  caravan?: Caravan | null;
  /**
   * The one job a neighbour has asked the colony to do, or null.
   *
   * One at a time, for the same reason there is one caravan: four open requests
   * is a spreadsheet, one is a decision. Optional and lazily filled, so a save
   * written before neighbours asked for anything simply gets its first letter on
   * the next quiet day. See `commissions.ts`.
   */
  commission?: Commission | null;
  /**
   * The Ashbound holdings of this map, and which of them are the colony's.
   *
   * Lazily grown like `settlements`, off a stream of its own, so a save written
   * before there was anything out there to take loads with the country already
   * on it and every other number in it untouched. See `holdings.ts`.
   */
  holdings?: Holding[];
  /** The war party in the field, or none. At most one, ever. */
  war?: WarParty | null;
  /**
   * The ending this colony has committed to, or none.
   *
   * Optional, and no migration for it beyond that: a colony saved before there
   * were endings loads with none in progress, which is the truth about it. See
   * `endings.ts`.
   */
  ending?: EndingState;
  /**
   * The Pickies currently out on an errand. See `pickies.ts`.
   *
   * Optional because they are a thing the player summons rather than a thing the
   * colony has, so the overwhelming majority of worlds — and every save written
   * before they existed — simply do not have the field. Absent reads as none out,
   * which is exactly right.
   */
  pickies?: Picky[];
  /**
   * Pickies number themselves, and count *down* from zero.
   *
   * They deliberately do not draw from `nextId`. That counter looks inert, but it
   * is a shared stream like any other: an animal born later would take a different
   * id, and `tickWildlife` staggers wandering by `(tick + id)`, so a deer would end
   * the day somewhere else purely because you had sent out a goblin an hour before.
   * Watching a colony must not change it — and negative ids mean a Picky id that
   * ever leaks into a pawn lookup finds nothing rather than the wrong body.
   */
  pickyIds?: number;
}

/**
 * A neighbour's standing request: bring us this, by then.
 *
 * Deliberately not a job, a zone or anything the colony can be *ordered* to do.
 * It is a sentence on a panel and a clock, and the only way to answer it is the
 * road that already exists — which is the point. See `commissions.ts`.
 */
export interface Commission {
  settlementId: number;
  /** What they are short of. */
  kind: ResourceKind;
  /** How much of it settles it. One pack, so nobody has to do arithmetic. */
  amount: number;
  /** Why they are short, in one clause. Flavour, but it is what makes it a place. */
  reason: string;
  /** The tick word arrived, so the panel can draw how much of the clock is gone. */
  postedTick: number;
  /** The tick it lapses. */
  dueTick: number;
}

/**
 * Terrain is saved as an index into this list, so entries may be appended but
 * never reordered or removed — a save written last week has to mean the same
 * ground this week.
 */
export const TERRAIN_LIST: Terrain[] = [
  'grass',
  'dirt',
  'stone',
  'rock',
  'water',
  'sand',
  'plank',
  'paved',
  // Appended, never inserted: a saved map is a list of indexes into this array,
  // so putting a new kind anywhere but the end would turn every old colony's
  // grass into stone the next time it loaded.
  'bridge',
];

/**
 * How fast anything walks over a cell, as a multiplier on its own speed.
 * A laid floor is the reason a colony stops being a set of buildings and
 * becomes a place with routes through it.
 */
export const TERRAIN_SPEED: Record<Terrain, number> = {
  grass: 1,
  dirt: 1,
  stone: 1,
  rock: 1,
  water: 1,
  sand: 1,
  plank: 1.25,
  paved: 1.45,
  // Boards, so boards' speed. A bridge that hurried you across would make the
  // long way round the lake feel like a punishment rather than a choice.
  bridge: 1.25,
};

export function terrainSpeed(world: World, x: number, y: number): number {
  return TERRAIN_SPEED[terrainAt(world, x, y)] ?? 1;
}

export function terrainAt(world: World, x: number, y: number): Terrain {
  const i = y * world.width + x;
  return TERRAIN_LIST[world.terrain[i]] ?? 'grass';
}

/**
 * Change the ground under a cell — the only way terrain moves once play starts.
 *
 * Every derived index that reads terrain hangs off `terrainRev`, so this is the
 * single line that has to be gone through rather than a rule that has to be
 * remembered. Worldgen writes `world.terrain` directly and is right to: nothing
 * has been indexed yet, and a counter that ticked forty thousand times before the
 * first tick would be measuring the map's creation rather than its history.
 */
export function setTerrain(world: World, x: number, y: number, kind: Terrain): void {
  const i = y * world.width + x;
  const next = TERRAIN_LIST.indexOf(kind);
  if (world.terrain[i] === next) return;
  world.terrain[i] = next;
  world.terrainRev = (world.terrainRev ?? 0) + 1;
}

/**
 * Say that the standing buildings have changed, so anything derived from them
 * rebuilds. Call it after adding or removing a building, or after flipping one's
 * `built` flag — an unfinished frame is not a wall, so a roof closing over a room
 * is a wall appearing even though no building did.
 *
 * A counter rather than a fingerprint, which means it has to be *called* rather
 * than merely be correct. That trade is deliberate and it is the same one
 * `setTerrain` makes: there are exactly six lines in the sim that change the
 * building list, they are easier to enumerate than a hash is to afford, and the
 * consequence of forgetting one is caught by the room-index tests rather than
 * discovered by a player standing in a sealed room that thinks it is outdoors.
 */
export function markBuildingsChanged(world: World): void {
  world.buildRev = (world.buildRev ?? 0) + 1;
}

export function packCell(world: World, x: number, y: number): number {
  return y * world.width + x;
}

export function unpackX(world: World, p: number): number {
  return p % world.width;
}

export function unpackY(world: World, p: number): number {
  return Math.floor(p / world.width);
}

export function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.width && y < world.height;
}
