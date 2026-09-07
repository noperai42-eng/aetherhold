/**
 * The Ashbound's holdings, and the war parties sent to take them.
 *
 * Three stages ago the world past the treeline was a place to *sell* to. This is
 * the other thing a map can be: ground somebody else is standing on. One holding
 * behind each ring of neighbours — a doorway the raiders come through — and a
 * colony with hands to spare can go and take it.
 *
 * Everything here is bought from numbers that already existed, because a stage
 * that invents its own scale invents its own difficulty curve with it:
 *
 * - **How many.** One per ring, `NEIGHBOUR_COUNT / PER_RING`. The far country is
 *   already three deep and the depth is already earned; holdings ride on it
 *   rather than laying a second, disagreeing map over the top.
 * - **How far.** `roundTripDays(ring) / 2` each way, the same walk the caravans
 *   take to that ring's worst road. A war party is not faster than a merchant.
 * - **How many go.** `CAN_SPARE_ONE - 1` — one fewer than the colony has to keep
 *   at home. Three go, four hold the valley, and the colony needs seven standing
 *   before it can say yes to that. `CAN_SPARE_ONE`'s own argument is the whole
 *   argument: three left behind is a colony that can still hold a wall, two is
 *   not, and a war party is the one errand that is *supposed* to leave the place
 *   short-handed.
 * - **What is waiting.** `garrisonSize(ring)` men, rolled out of `raiderBand` at
 *   the moment of the fight — so the garrison is scaled by difficulty and by the
 *   escalation ladder without this file knowing either exists.
 * - **What it pays.** `PACK_MIN * (ring + 1)` of steel every `roundTripDays(ring)`
 *   days, which is about the same steel per day whichever holding it is. The far
 *   one is not richer. What the far one buys is the rung.
 *
 * Two decisions here are departures, and both are on purpose:
 *
 * **Nobody dies off-screen.** `settlements.ts` states it and this file honours it
 * even though a war is exactly where a reader would expect the exception. A
 * beaten war party comes home wrecked — floored at a quarter of their health, so
 * nobody arrives already down — and not buried. A settler killed by dice the
 * player could not watch, on a map they cannot look at, is a story the game has
 * no way to tell them; three settlers ruined for a week is a story it can, and
 * the escalation the win bought is the rest of the bill. The day there is a
 * screen to watch a battle on, this is the first rule to revisit.
 *
 * **The Ashbound do not take a holding back.** Held is held, in this cut. A
 * garrison that re-forms is a second system — a threat clock, a second front,
 * and a tribute line that stops without the player being anywhere near it — and
 * it belongs to the stage that can afford to test it, not smuggled in under this
 * one.
 */

import { WEAPONS } from './combat';
import { raiderBand } from './events';
import { nearestWalkable } from './grid';
import { Rng } from './rng';
import {
  CAN_SPARE_ONE,
  NEIGHBOUR_COUNT,
  PACK_MIN,
  PER_RING,
  ringOpen,
  roadHead,
  roundTripDays,
} from './settlements';
import { gainSkill } from './skills';
import { TICKS_PER_DAY } from './types';
import type { Holding, Pawn, WarParty, World } from './types';
import { addItem, cancelJob, livingColonists, msg } from './world';

/** One holding behind each ring of neighbours. */
export const HOLDING_COUNT = NEIGHBOUR_COUNT / PER_RING;

/**
 * Settlers in a war party.
 *
 * One fewer than the colony must be able to leave behind, so the smallest colony
 * that can field a war party is `CAN_SPARE_ONE + WAR_PARTY` — seven. That is a
 * high bar on purpose. Nine of the fifteen colonies on the last grid never got
 * there, and a road only the successful colonies can walk is what a *third* road
 * is for.
 */
export const WAR_PARTY = CAN_SPARE_ONE - 1;

/**
 * Ashbound in the holding, by ring.
 *
 * Two, three, four: one short of the party at the doorway, level with it a ring
 * out, and one over at the far one. Deliberately *not* an even fight at the near
 * holding — the garrison shoots first (see `storm`) and a defender's opening
 * volley against equal numbers is a party that gets nowhere, which would make
 * the first holding unwinnable rather than dear.
 */
export function garrisonSize(ring: number): number {
  return WAR_PARTY + ring - 1;
}

/** Steel a held holding sends home, per delivery. */
export function tributeOf(h: Holding): number {
  return PACK_MIN * (h.ring + 1);
}

/** Ticks between one holding's deliveries — its own round trip, walked by somebody else. */
export function tributeTicks(h: Holding): number {
  return Math.round(roundTripDays(h.ring) * TICKS_PER_DAY);
}

/** The walk out, in ticks. Half a round trip to that ring, same as any road. */
function legTicks(h: Holding): number {
  return Math.round((roundTripDays(h.ring) / 2) * TICKS_PER_DAY);
}

/**
 * A club only counts for the share of the fight it can reach.
 *
 * `combat.ts` fights this out cell by cell and a man with a club spends most of a
 * firefight walking. Off-map there are no cells, so the range difference has to
 * be paid some other way or a clubbing party would read as the equal of a party
 * with rifles. It is paid as a fraction of the exchange: `club.range / rifle.range`
 * — about an eighth. Not a guess about melee; the ratio of the two numbers the
 * on-map fight is already using.
 */
const MELEE_SHARE = WEAPONS.club.range / WEAPONS.rifle.range;

/** One exchange of fire: the time it takes to work a bolt. */
const ROUND = WEAPONS.rifle.cooldown;

/** A day of it, and then they break off. Nobody storms a wall for two days. */
const ROUNDS_MAX = Math.ceil(TICKS_PER_DAY / ROUND);

/**
 * Where a settler stops fighting: a quarter of their health.
 *
 * Just above `combat.ts`'s 0.22 downed line, and that is the whole of the
 * arithmetic. A war party comes home wrecked but on its feet, so the homecoming
 * does not have to reproduce bleeding, rescue and a doctor's queue for bodies
 * that were never on the map to be carried.
 */
const WOUND_FLOOR = 0.25;

/** How long the colony will wait at the edge for three people to turn up. */
const MUSTER_DAYS = 1;

/**
 * A fortnight away is worth the same to a rifle as it is to a tongue.
 *
 * The caravan's `SOCIAL_PER_TRIP` by construction rather than by coincidence:
 * both are "a settler was gone for a week doing one thing", and inventing a
 * second number for it would be inventing a second opinion about what a week is
 * worth.
 */
const WAR_SKILL = 0.9;

/** Holdings are named for what the Ashbound did to the last people who lived there. */
const HOLDING_NAMES = [
  'Blackhearth',
  'Gallows Rise',
  'Ironmouth',
  'Cairnfell',
  'Redwatch',
  'The Ash Stair',
];

/**
 * The holdings of this map.
 *
 * Built on first use off a salted stream of its own, exactly like `settlementsOf`
 * and for the same reason: nothing here may draw from a die another system is
 * counting on, or every seed on the balance grid becomes a different map the day
 * this file ships. A save from before holdings existed grows them on load and
 * every other number in it is untouched.
 */
export function holdingsOf(world: World): Holding[] {
  const known = world.holdings;
  if (known && known.length >= HOLDING_COUNT) return known;
  const rng = new Rng((world.seed ^ 0x21c9d3b7) >>> 0);
  const names = [...HOLDING_NAMES];
  const made: Holding[] = [];
  for (let ring = 0; ring < HOLDING_COUNT; ring++) {
    made.push({
      id: ring + 1,
      name: names.splice(rng.int(names.length), 1)[0]!,
      // Off the compass quarters the neighbours sit on, so a holding is never
      // "behind Ashfen" — the raiders come from their own direction.
      bearing: rng.range(0, Math.PI * 2),
      ring: ring as 0 | 1 | 2,
      held: false,
      attempts: 0,
    });
  }
  world.holdings = made;
  return made;
}

export function holdingById(world: World, id: number): Holding | null {
  return holdingsOf(world).find((h) => h.id === id) ?? null;
}

/** Ground the colony is standing on out there. */
export function heldCount(world: World): number {
  return holdingsOf(world).filter((h) => h.held).length;
}

/** The party in the field, if there is one. One at a time: the colony has one army. */
export function warPartyOf(world: World): WarParty | null {
  return world.war ?? null;
}

/** Days until the war party is home, or 0 if nobody is out. */
export function warDaysLeft(world: World): number {
  const w = world.war;
  if (!w || w.phase === 'mustering') return 0;
  return Math.max(0, (w.dueTick - world.tick) / TICKS_PER_DAY);
}

export type CampaignPlan =
  | { ok: true; holding: Holding; head: { x: number; y: number }; party: Pawn[] }
  | { ok: false; text: string };

/**
 * Whether the colony may march on a holding, and who would go.
 *
 * Every refusal returns the sentence the panel prints, for the reason the trade
 * panel gives: "the button is greyed out" is not a rule the player can learn.
 *
 * The headcount is read off the map rather than off `colonySize`, and that is the
 * one place this parts company with the caravan rules. `colonySize` counts the
 * people already walking, which is right for "how many roads may this colony
 * afford" and wrong for "who is left holding the wall" — a colony of seven with
 * two on the trade road has five standing, and sending three of those leaves two.
 * What has to be true is that four remain *here*, so four here is what is asked.
 */
export function planCampaign(world: World, holdingId: number): CampaignPlan {
  const holding = holdingById(world, holdingId);
  if (!holding) return { ok: false, text: 'No such place.' };
  if (holding.held) return { ok: false, text: `${holding.name} is already yours.` };
  if (world.war) return { ok: false, text: 'The war party is already in the field.' };
  if (world.storyteller.raidActive) {
    return { ok: false, text: 'There are raiders in the yard. Nobody is leaving.' };
  }
  // The same gate the trade road uses, and it is the honest one to reuse: a
  // colony that has not dealt with a ring has no idea what is behind it.
  if (!ringOpen(world, holding.ring)) {
    return { ok: false, text: `Nobody has been out that far. ${holding.name} is past the country you know.` };
  }
  // Fit to walk and fit to fight, in that order: the ones with the guns first,
  // then the healthiest, because a war party is the one errand where who goes is
  // a decision the colony would actually make that way.
  const able = livingColonists(world)
    .filter((p) => !p.downed && p.hp > p.maxHp * 0.6)
    .sort((a, b) => score(b) - score(a));
  if (able.length < CAN_SPARE_ONE + WAR_PARTY) {
    return {
      ok: false,
      text:
        `${CAN_SPARE_ONE + WAR_PARTY} on their feet before anyone marches — ` +
        `${WAR_PARTY} to go and ${CAN_SPARE_ONE} to hold the valley. You have ${able.length}.`,
    };
  }
  const party = able.slice(0, WAR_PARTY);
  const head = roadHead(world, holding, party[0]!);
  if (!head) return { ok: false, text: `There is no road out of this valley towards ${holding.name}.` };
  return { ok: true, holding, head, party };
}

/** How much use somebody is in a fight, for picking the party. */
function score(p: Pawn): number {
  return punch(p.weapon, p.skills?.shooting ?? 0) * 100 + p.hp / p.maxHp;
}

/**
 * What one fighter takes off the other side per tick.
 *
 * Damage per cooldown at the hit chance `combat.ts` would give them — the same
 * `min(0.95, accuracy + skill * 0.02)` the on-map fight rolls against, spent as a
 * rate instead of a die. Off-map there is no cover, no line of sight and no
 * flanking, so what is left of a firefight is how fast each side can put damage
 * into the other, and that is the number this returns.
 */
function punch(weapon: Pawn['weapon'], skill: number): number {
  const w = WEAPONS[weapon];
  const hit = Math.min(0.95, w.accuracy + skill * 0.02);
  return ((w.damage * hit) / w.cooldown) * (w.melee ? MELEE_SHARE : 1);
}

interface Fighter {
  hp: number;
  floor: number;
  punch: number;
  pawn?: Pawn;
}

/**
 * The assault, resolved.
 *
 * Both sides fire at once into the man in front, no spillover — overkill is
 * wasted, which is what stops a party of three with rifles from evaporating a
 * garrison of four in a single exchange. The garrison gets one volley before the
 * party can answer, because the party is the one crossing open ground, and that
 * volley is most of what makes a holding a hard thing rather than an arithmetic
 * comparison of two totals.
 *
 * The fight is a pure function of the fighters and the dice. Nothing in here
 * touches the world; the caller writes the outcome down.
 */
function storm(attackers: Fighter[], defenders: Fighter[]): { won: boolean; killed: number } {
  const standing = (side: Fighter[]) => side.filter((f) => f.hp > f.floor);
  const hurt = (side: Fighter[], amount: number) => {
    const front = standing(side)[0];
    if (front) front.hp -= amount;
  };
  const force = (side: Fighter[]) => standing(side).reduce((sum, f) => sum + f.punch, 0);

  // The opening volley. They are seen coming for the length of one exchange.
  hurt(attackers, force(defenders) * ROUND);

  for (let round = 0; round < ROUNDS_MAX; round++) {
    const a = force(attackers);
    const d = force(defenders);
    if (a <= 0 || d <= 0) break;
    // Simultaneous: the dead man's last shot still counts, which is the
    // difference between a garrison that is a wall and one that is a speed bump.
    hurt(defenders, a * ROUND);
    hurt(attackers, d * ROUND);
  }
  const killed = defenders.filter((f) => f.hp <= f.floor).length;
  // Standing on it at the end, not merely alive: a party that ran the clock out
  // has spent a day being shot at and gained nothing, which is a loss.
  return { won: killed === defenders.length && standing(attackers).length > 0, killed };
}

/**
 * Open the muster: the party is on the books, walking to the edge.
 *
 * The jobs that carry them there are `jobs.ts`'s business, the same way
 * `orderCaravan` is — every rule about whether the march may happen is in
 * `planCampaign`, so the two cannot drift apart.
 *
 * The bill is booked here rather than on the way home, and that is deliberate.
 * The colony is short these three for the whole walk the moment it says go — the
 * road back is not optional — and a count that waited for the homecoming would
 * read a holding as free for every day between taking it and standing down.
 */
export function musterWarParty(world: World, plan: CampaignPlan & { ok: true }): void {
  world.war = {
    holdingId: plan.holding.id,
    pawns: [],
    x: plan.head.x,
    y: plan.head.y,
    dueTick: world.tick + Math.round(MUSTER_DAYS * TICKS_PER_DAY),
    phase: 'mustering',
  };
  world.stats.campaigns = (world.stats.campaigns ?? 0) + 1;
  world.stats.warPawnDays = (world.stats.warPawnDays ?? 0) + WAR_PARTY * roundTripDays(plan.holding.ring);
  msg(
    world,
    `${plan.party.map((p) => p.name).join(', ')} take up arms and start for ${plan.holding.name}.`,
    'threat',
    { headline: true },
  );
}

/**
 * A settler reaches the edge and joins the party, off the map like a caravan.
 *
 * Called by the `campaign` job on arrival. The party leaves on the third one.
 */
export function joinWarParty(world: World, pawn: Pawn): void {
  const w = world.war;
  if (!w || w.phase !== 'mustering') return;
  w.pawns.push(pawn);
  // Their claims come free before they march, exactly as a settler leaving with
  // a caravan releases theirs — a job held by somebody who is off the map cannot
  // be finished and cannot be taken off them. See `tickGraves` for what one
  // orphaned build job costs a colony.
  for (const j of world.jobs.slice()) if (j.pawnId === pawn.id) cancelJob(world, j.id);
  world.pawns = world.pawns.filter((p) => p.id !== pawn.id);
  if (w.pawns.length < WAR_PARTY) return;
  const h = holdingById(world, w.holdingId);
  w.phase = 'outbound';
  w.dueTick = world.tick + (h ? legTicks(h) : TICKS_PER_DAY);
  msg(world, `The war party walks out of the valley towards ${h?.name ?? 'the moor'}.`, 'info');
}

/**
 * Call it off and put everybody back.
 *
 * One exit for every way a march can fail before it starts — a raid, a muster
 * that never filled, a settler the player took over — because a war party that
 * is half-lifted off the map is the one state nothing else in the sim knows how
 * to read.
 */
export function abandonMuster(world: World, why: string): void {
  const w = world.war;
  if (!w || w.phase !== 'mustering') return;
  // The ones still crossing the yard, first: a `campaign` job outliving the party
  // it was mustering for would walk a settler to the treeline to join nobody.
  for (const j of world.jobs.slice()) if (j.kind === 'campaign') cancelJob(world, j.id);
  for (const pawn of w.pawns) {
    const spot = nearestWalkable(world, w.x, w.y, 8) ?? { x: w.x, y: w.y };
    pawn.x = spot.x;
    pawn.y = spot.y;
    pawn.jobId = null;
    pawn.path = null;
    pawn.activity = 'idle';
    world.pawns.push(pawn);
  }
  world.war = null;
  msg(world, why, 'bad');
}

/** One tick of the war. */
export function tickWar(world: World): void {
  tribute(world);
  const w = world.war;
  if (!w) return;

  if (w.phase === 'mustering') {
    // A raid at home outranks a war abroad, and a muster that never filled is
    // three people standing at the treeline waiting for somebody who is in bed.
    if (world.storyteller.raidActive) return abandonMuster(world, 'The war party turns back — the valley is under attack.');
    if (world.tick >= w.dueTick) {
      return abandonMuster(world, 'The war party never formed up. Whoever got to the treeline walks back in.');
    }
    return;
  }

  if (world.tick < w.dueTick) return;
  const h = holdingById(world, w.holdingId);
  if (!h) {
    world.war = null;
    return;
  }

  if (w.phase === 'outbound') {
    fight(world, w, h);
    w.phase = 'inbound';
    w.dueTick = world.tick + legTicks(h);
    return;
  }

  comeHome(world, w, h);
}

/** The assault: roll the garrison, resolve it, write down what it cost. */
function fight(world: World, w: WarParty, h: Holding): void {
  // Its own dice, seeded off the map, the holding and how many times this colony
  // has tried it — so a second attempt on the same place draws the next card
  // rather than a fresh copy of the last one, exactly as the trade road does.
  const rng = new Rng((world.seed ^ ((h.id * 977 + h.attempts + 1) * 0x9e3779b9)) >>> 0);
  h.attempts++;

  const attackers: Fighter[] = w.pawns.map((p) => ({
    hp: p.hp,
    floor: p.maxHp * WOUND_FLOOR,
    punch: punch(p.weapon, p.skills?.shooting ?? 0),
    pawn: p,
  }));
  const defenders: Fighter[] = [];
  for (let i = 0; i < garrisonSize(h.ring); i++) {
    const band = raiderBand(world, rng);
    defenders.push({
      hp: band.hp,
      floor: 0,
      punch: punch(band.rifle ? 'rifle' : 'club', band.shooting),
    });
  }

  const { won, killed } = storm(attackers, defenders);
  for (const f of attackers) if (f.pawn) f.pawn.hp = Math.max(f.floor, Math.round(f.hp));
  world.stats.raidersKilled = (world.stats.raidersKilled ?? 0) + killed;
  w.won = won;
  w.killed = killed;

  if (!won) {
    msg(
      world,
      `The war party is thrown back off the walls of ${h.name}. ${killed ? `${killed} Ashbound down; ` : ''}they are walking home hurt.`,
      'bad',
      { headline: true },
    );
    return;
  }
  h.held = true;
  h.takenTick = world.tick;
  h.dueTick = world.tick + tributeTicks(h);
  world.stats.holdingsTaken = (world.stats.holdingsTaken ?? 0) + 1;
  // The price of the war is the war. A clean campaign is a colony the Ashbound
  // have not managed to hurt, which is the streak the storyteller was already
  // counting, so taking ground raises what comes over the treeline next — with
  // no second dial to keep in step with the first one.
  world.storyteller.unbloodied = (world.storyteller.unbloodied ?? 0) + 1;
  msg(world, `${h.name} is taken. ${killed} Ashbound dead, and the doorway is yours.`, 'good', {
    headline: true,
  });
}

/** Back on the map, in the state a week in the field leaves people. */
function comeHome(world: World, w: WarParty, h: Holding): void {
  const spot = nearestWalkable(world, w.x, w.y, 8) ?? { x: w.x, y: w.y };
  for (const pawn of w.pawns) {
    pawn.x = spot.x;
    pawn.y = spot.y;
    pawn.jobId = null;
    pawn.path = null;
    pawn.activity = 'idle';
    pawn.carryingItemId = null;
    pawn.drafted = false;
    pawn.orderX = null;
    pawn.orderY = null;
    pawn.needs.food = Math.min(pawn.needs.food, 0.3);
    pawn.needs.rest = Math.min(pawn.needs.rest, 0.25);
    gainSkill(world, pawn, 'shooting', WAR_SKILL);
    world.pawns.push(pawn);
  }
  world.war = null;
  msg(
    world,
    w.won
      ? `The war party is home from ${h.name}, and there is a garrison on the moor flying your colours.`
      : `The war party limps back in from ${h.name} with nothing to show for it.`,
    w.won ? 'good' : 'bad',
  );
}

/** What the holdings send home, on their own clock. */
function tribute(world: World): void {
  for (const h of holdingsOf(world)) {
    if (!h.held || h.dueTick === undefined || world.tick < h.dueTick) continue;
    h.dueTick = world.tick + tributeTicks(h);
    const anchor = livingColonists(world)[0];
    if (!anchor) continue;
    const spot = nearestWalkable(world, Math.round(anchor.x), Math.round(anchor.y), 8);
    if (!spot) continue;
    const amount = tributeOf(h);
    addItem(world, 'steel', amount, spot.x, spot.y);
    msg(world, `A cart comes down off the moor from ${h.name}: ${amount} steel.`, 'good', { at: spot });
  }
}
