/**
 * What the colony is not telling you.
 *
 * Every serious defect this game has shipped was silent. A hundred steel sat in
 * five piles too small to build a rifle from and nobody said anything for twenty
 * days; four settlers burned in their beds without a line in the log. The log is
 * a history — it says what happened, once, and then scrolls away. This says what
 * is *still true*, which is the thing a player can actually act on.
 *
 * Pure: it reads the world and returns a list. Nothing here writes game state,
 * and nothing here is remembered between calls — an alert exists exactly as long
 * as the state that causes it, which is why the ids are stable strings rather
 * than counters. (`settlementsOf` memoises the neighbours on first read off its
 * own rng stream; asking early is deterministic and changes nothing.)
 */

import { livingColonists, hostiles, countResource } from './world';
import { FOOD_VALUE, FOOD_DRAIN, BREAK_MOOD, isBreaking, worstMoodFactor } from './needs';
import { worstAilment } from './health';
import { isBed } from './buildings';
import { missingResource } from './jobs';
import { CRAFT_DEFS, RECIPE_ORDER, bestCrafter, colonyCanCraft, craftBlocker } from './crafting';
import { DAYS_PER_SEASON, daysUntilWinter } from './seasons';
import { settlementsOf, specialty } from './settlements';
import { freeGraves, unburiedDead } from './graves';
import { knowhowNow } from './knowhow';
import { TICKS_PER_DAY, flareActive, type CraftRecipe, type Pawn, type World } from './types';

/** Sentence case for a blocker phrase that was written to sit mid-sentence. */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Where a colony that cannot brew is actually supposed to get medicine.
 *
 * About one map in sixty starts with nobody at herbalism 5 or medicine 4 *and*
 * no neighbour who brews, and on that map "send somebody to a neighbour who
 * brews it" is a lie that costs four days of walking to disprove. So the hint
 * names the settlement when there is one and falls back to the pedlar — who
 * carries medicine on two of his eight deals — when there is not.
 */
function sourceOfMedicine(world: World): string {
  const healer = settlementsOf(world).find((s) => {
    const trade = specialty(s);
    return trade === 'balm' || trade === 'medicine';
  });
  if (healer) return `Buy it from the pedlar, or walk a caravan out to ${healer.name}, who brews it.`;
  // Nobody out there makes it either. The trade road is still the answer, it is
  // just the road that comes to you — and a farmer who keeps farming crosses
  // herbalism 5 on their own eventually.
  return 'Buy it from the pedlar when he comes, and keep a farmer on the plots — herbalism 5 unlocks balm.';
}

/**
 * What to actually do about the thing dragging one settler down.
 *
 * Both morale alerts used to carry the same sentence — "Feed them, build beds
 * and a table, and give it a day" — for every settler in the colony regardless
 * of what was wrong with them. For the settler who is fed, in a bed, and
 * freezing, that is not a vague hint, it is wrong advice: it sends the player to
 * the stove while the actual answer is a campfire. Now the hint reads the same
 * breakdown the settler card does and names the one thing at the top of it.
 *
 * Keyed by `MoodFactor.label`, so the wording lives beside the wording it
 * answers. Traits are absent on purpose — `worstMoodFactor` never returns one,
 * because "go and fix their personality" is not a hint. So are `starving` and
 * `has not slept`: those flat penalties only ever appear alongside the bigger
 * row from the same need, which always wins the sort and carries the same
 * advice.
 */
const MOOD_REMEDY: Record<string, string> = {
  hungry: 'Hungry. Cook a meal, and check the pantry is stocked and reachable.',
  tired: 'Worn out. Build a bed, or clear the way to the one they have.',
  'nothing to do': 'Nothing but work. A table and chairs to sit at, near where they live.',
  'badly hurt': 'Badly hurt. Get them tended — a doctor, medicine, and a bed to do it in.',
  down: 'Down where they fell. Somebody has to carry them to a bed.',
  cold: 'Freezing. A campfire or a stove where they work and where they sleep.',
  'too hot': 'Overheating. Get them out of the sun, or shut down whatever is roasting them.',
  'bad blood here': 'They are not getting on with somebody here. Mostly this takes time.',
  'grim surroundings': 'Bleak quarters. Floors, a lamp, anything built well enough to look at.',
  'breathing fumes': 'Breathing generator fumes. Move it out of doors.',
  'a rough few days': 'A bad run of days, nothing worse. Hot meals and a night in a real bed.',
};

/** The hint for a settler whose morale is the problem. */
function moodHint(pawn: Pawn): string {
  const worst = worstMoodFactor(pawn);
  const remedy = worst ? MOOD_REMEDY[worst.label] : undefined;
  // Nothing is wrong with them that this can name — a pessimist having a normal
  // week, or a factor added to the breakdown and not to the table above. The old
  // generic line is exactly right for that case, and only for that case.
  return remedy ?? 'Morale. Hot meals, real beds and a table to sit at, and give it a day.';
}

export type AlertLevel = 'urgent' | 'warn';

export interface Alert {
  /** Stable across ticks for the same problem, so the panel does not flicker. */
  id: string;
  /** What is wrong, in the fewest words that are still true. */
  text: string;
  /** What to do about it. An alert with no answer is just anxiety. */
  hint: string;
  level: AlertLevel;
  /** Where to look, if there is somewhere to look. */
  at?: { x: number; y: number };
  /** Who it is about, so a click can select them. */
  pawnId?: number;
}

/** Food eaten per settler per day — derived, so it cannot drift from the drain. */
export const FOOD_PER_DAY = FOOD_DRAIN * TICKS_PER_DAY;

/** Below this many days of food left, someone should be cooking or sowing. */
const FOOD_WARN_DAYS = 4;
/** Below this, the colony is already losing. */
const FOOD_URGENT_DAYS = 1.5;
/** How close to a break counts as "about to". */
const NEAR_BREAK = 0.06;

/**
 * How many days out the colony is told winter is coming.
 *
 * Three, which is one day longer than a crop takes to ripen — so the warning
 * arrives while there is still time to sow one more round and pull it in, rather
 * than as a report on a decision already made. Any earlier and it would sit on
 * the alert strip for most of autumn saying a thing the player cannot act on
 * yet, and an alert nobody can act on is the one that teaches them to ignore the
 * strip.
 */
const WINTER_HEADS_UP = 3;

/** Whether anything in the colony makes heat — a fire to stand at, or one to build around. */
function hasHeat(world: World): boolean {
  return world.buildings.some(
    (b) => b.built && (b.kind === 'heater' || b.kind === 'campfire'),
  );
}

/** How many days the pantry covers at the current head count. */
export function foodDays(world: World): number {
  const n = livingColonists(world).length;
  if (n === 0) return 0;
  const food =
    countResource(world, 'rawfood') * (FOOD_VALUE.rawfood ?? 0) +
    countResource(world, 'meal') * (FOOD_VALUE.meal ?? 0);
  return food / (FOOD_PER_DAY * n);
}

/**
 * Everything currently wrong with the colony, worst first.
 *
 * The order inside a level is the order the checks are written in, which is
 * roughly "how fast does this kill somebody" — fire and raiders before beds and
 * blueprints. That ordering is deliberate and the tests pin it.
 */
export function alerts(world: World): Alert[] {
  const out: Alert[] = [];
  const settlers = livingColonists(world);
  if (settlers.length === 0 || world.gameOver) return out;

  const fire = world.fires[0];
  if (fire) {
    out.push({
      id: 'fire',
      text: world.fires.length === 1 ? 'Fire burning' : `${world.fires.length} fires burning`,
      hint: 'Anyone with Firefight priority will beat it out. Fires spread.',
      level: 'urgent',
      at: { x: fire.x, y: fire.y },
    });
  }

  const enemies = hostiles(world);
  if (enemies.length > 0) {
    const e = enemies[0]!;
    out.push({
      id: 'raid',
      text: `${enemies.length} hostile${enemies.length === 1 ? '' : 's'} on the map`,
      hint: 'Draft your settlers with T and put them behind cover.',
      level: 'urgent',
      at: { x: Math.round(e.x), y: Math.round(e.y) },
    });
  }

  for (const p of settlers) {
    if (!p.downed) continue;
    out.push({
      id: `downed:${p.id}`,
      text: `${p.name} is down`,
      hint: 'A settler with Doctor priority will come. Medicine makes it faster.',
      level: 'urgent',
      at: { x: Math.round(p.x), y: Math.round(p.y) },
      pawnId: p.id,
    });
  }

  const days = foodDays(world);
  if (days < FOOD_WARN_DAYS) {
    out.push({
      id: 'food',
      text: days < 0.05 ? 'No food left' : `${days.toFixed(1)} days of food`,
      hint: 'Sow a grow zone, hunt, or cook what is in the pantry.',
      level: days < FOOD_URGENT_DAYS ? 'urgent' : 'warn',
    });
  }

  const toWinter = daysUntilWinter(world);
  // Close enough to act on, and something is still missing. The two conditions
  // are separate because they are separate problems with separate answers: no
  // fire kills a settler in a night whatever the pantry holds, and an empty
  // pantry starves the colony in a week however warm the room is. A colony that
  // has both has already answered this and is told nothing — an alert that fires
  // at the prepared player every autumn is how the strip stops being read.
  const fed = days >= toWinter + DAYS_PER_SEASON;
  const warm = hasHeat(world);
  if (toWinter > 0 && toWinter <= WINTER_HEADS_UP && !(fed && warm)) {
    out.push({
      id: 'winter',
      text: `Winter in ${toWinter} day${toWinter === 1 ? '' : 's'} · ${days.toFixed(1)} days of food`,
      // The two things that actually kill a colony over a winter, in the order
      // they kill it. A settler with no fire to stand at is cold tonight; a
      // colony with no pantry is hungry in a week — so the hint leads with heat
      // when there is none and with the harvest when there is.
      hint: warm
        ? `Nothing grows outdoors for ${DAYS_PER_SEASON} days once it turns. Harvest everything, cook it, and sow again in spring.`
        : 'Build a heater or a campfire in a sealed room before it turns, and fill the pantry — nothing grows outdoors in winter.',
      level: 'warn',
    });
  }

  for (const p of settlers) {
    const ill = worstAilment(p);
    if (!ill || ill.tendedUntil > world.tick) continue;
    out.push({
      id: `untended:${p.id}`,
      text: `${p.name} is ill and untended`,
      hint: 'Give someone Doctor priority; keep medicine in stock.',
      level: 'urgent',
      at: { x: Math.round(p.x), y: Math.round(p.y) },
      pawnId: p.id,
    });
  }

  for (const p of settlers) {
    if (!isBreaking(p)) continue;
    out.push({
      id: `break:${p.id}`,
      text: `${p.name} has stopped working`,
      hint: moodHint(p),
      level: 'urgent',
      at: { x: Math.round(p.x), y: Math.round(p.y) },
      pawnId: p.id,
    });
  }

  // --- warnings: nobody is dying of these this hour, but they are why people die

  for (const p of settlers) {
    if (isBreaking(p) || p.mood > BREAK_MOOD + NEAR_BREAK) continue;
    out.push({
      id: `mood:${p.id}`,
      text: `${p.name} is close to breaking`,
      hint: moodHint(p),
      level: 'warn',
      at: { x: Math.round(p.x), y: Math.round(p.y) },
      pawnId: p.id,
    });
  }

  if (countResource(world, 'medicine') === 0) {
    // Two very different problems behind one empty shelf. A colony with a
    // herbalist has simply not got round to it; a colony without one cannot get
    // round to it, and telling that player to "craft it at a workbench" sends them
    // to stand in front of a bench that will not offer them the job. Naming the
    // missing trade is also how they find out trade exists.
    const brewer = colonyCanCraft(world, 'balm') || colonyCanCraft(world, 'medicine');
    out.push({
      id: 'medicine',
      text: 'No medicine',
      hint: brewer
        ? 'Craft it at a workbench from raw food, or buy it from a caravan.'
        : `${capitalise(craftBlocker(world, null, 'balm') ?? '')}. ${sourceOfMedicine(world)}`,
      level: 'warn',
    });
  }

  const beds = world.buildings.filter((b) => b.built && isBed(b.kind)).length;
  if (beds < settlers.length) {
    out.push({
      id: 'beds',
      text: `${settlers.length - beds} settler${settlers.length - beds === 1 ? '' : 's'} sleeping rough`,
      hint: 'Build beds — Furniture tab. Sleeping on the ground costs mood and rest.',
      level: 'warn',
    });
  }

  const dead = unburiedDead(world);
  if (dead.length > 0) {
    const graves = freeGraves(world).length;
    out.push({
      id: 'unburied',
      text: `${dead.length} unburied ${dead.length === 1 ? 'body' : 'bodies'}`,
      // Two different problems wear the same alert, because to the player they
      // are one problem with two answers: either there is nowhere to put them,
      // or there is and nobody has got round to it yet.
      hint:
        graves === 0
          ? 'Build a grave — Furniture tab, 4 wood. Bodies left out weigh on everyone.'
          : 'A settler with Haul priority will carry them. Raise it, or dig more graves.',
      level: 'warn',
      at: { x: Math.round(dead[0]!.x), y: Math.round(dead[0]!.y) },
    });
  }

  const unarmed = settlers.filter((p) => p.weapon === 'none').length;
  if (unarmed > 0) {
    out.push({
      id: 'unarmed',
      text: `${unarmed} settler${unarmed === 1 ? '' : 's'} unarmed`,
      hint: colonyCanCraft(world, 'rifle')
        ? 'A workbench turns steel into rifles. Raids do not wait.'
        : `A workbench turns steel into rifles, but ${craftBlocker(world, null, 'rifle')}. Raids do not wait.`,
      level: 'warn',
    });
  }

  // A flare and a shortage look identical from the meter — everything is off —
  // and the answers are opposite. Under a flare, fuelling the generator burns
  // wood into a dead wire, so the shortage hint would be advice that costs the
  // player the thing they need on the other side of it. The log line said this
  // once at dawn; this is what stays true until the sky clears.
  if (flareActive(world)) {
    const left = (world.storyteller.flareUntil ?? 0) - world.tick;
    const hours = Math.max(1, Math.round(left / (TICKS_PER_DAY / 24)));
    out.push({
      id: 'flare',
      text: `Solar flare — grid dead about ${hours} more hour${hours === 1 ? '' : 's'}`,
      hint: 'Nothing electrical runs, turrets included. Draft settlers and eat what would spoil.',
      level: 'warn',
    });
  } else if ((world.power?.shed ?? 0) > 0) {
    out.push({
      id: 'power',
      text: `Grid short — ${world.power!.shed} building${world.power!.shed === 1 ? '' : 's'} off`,
      hint: 'Fuel or build a generator, or add a battery for the night.',
      level: 'warn',
    });
  }

  // The trade that is about to walk into a fight.
  //
  // A skill gate is a gate on a *person*, so a colony's recipe book is really a
  // list of the people standing in it, and losing the only herbalist is losing
  // the recipe. `knowhow.ts` says that once, the hour it becomes true, and the
  // inspector's "can make" block says it about whoever you clicked. What neither
  // does is say it at the moment it costs something.
  //
  // Which is why this row wants danger and not just arithmetic. A colony of
  // three has exactly one hand for everything it can do — that is not a fault,
  // it is a colony of three, and a panel that opens on the first calm morning
  // complaining about it is teaching the player to stop reading the panel. So
  // the row appears when the sole holder is *exposed*: down, drafted, ill and
  // untended, or standing on a map with hostiles on it. Then it is triage —
  // three settlers are down and this is the one to reach first.
  //
  // One row however many trades: they nearly always rest on the same person
  // anyway (the doctor holds balm and medicine both), and four lines about one
  // settler is the wallpaper again in a different shape.
  const untended = (p: (typeof settlers)[number]): boolean => {
    const ill = worstAilment(p);
    return !!ill && ill.tendedUntil <= world.tick;
  };
  // Why they are exposed, and the one thing to do about it. Both halves are
  // short on purpose: this row is read with shots landing, and the panel gives a
  // hint 214 pixels of width — a sentence about growing a second herbalist runs
  // to four lines of advice nobody can act on until the raid is over.
  const exposure = (p: (typeof settlers)[number]): { why: string; act: string } | null => {
    if (p.downed) return { why: 'are down', act: 'Tend them first.' };
    if (untended(p)) return { why: 'are hurt and untended', act: 'Get a doctor to them.' };
    if (p.drafted) return { why: 'are drafted', act: 'Pull them off the line.' };
    if (enemies.length > 0) return { why: 'are out with raiders about', act: 'Get them behind cover.' };
    return null;
  };
  const hands = knowhowNow(world).hands;
  const sole = RECIPE_ORDER.filter((r) => (hands[r] ?? 0) === 1 && colonyCanCraft(world, r))
    .map((r) => ({ r, who: bestCrafter(world, r) }))
    .filter((e): e is { r: CraftRecipe; who: NonNullable<typeof e.who> } => e.who !== null && !!exposure(e.who));
  if (sole.length > 0) {
    const first = sole[0]!;
    const alone = sole.every((e) => e.who.id === first.who.id);
    const trades = sole.map((e) => CRAFT_DEFS[e.r].label);
    const risk = exposure(first.who)!;
    out.push({
      id: 'sole',
      text: alone
        ? `Only ${first.who.name} ${sole.length === 1 ? CRAFT_DEFS[first.r].trade : `makes ${trades.join(' and ')}`}`
        : `${sole.length} trades rest on one settler each`,
      hint: alone
        ? `They ${risk.why} and nobody else here can. ${risk.act}`
        : `${sole.map((e) => `${e.who.name} (${CRAFT_DEFS[e.r].label})`).join(', ')}. Lose one and that trade goes with them.`,
      level: 'warn',
      at: { x: Math.round(first.who.x), y: Math.round(first.who.y) },
      pawnId: first.who.id,
    });
  }

  // A blueprint waiting on stuff the colony does not have is the shape both of
  // this session's silent failures took: work posted, nobody able to take it.
  const stalled = new Map<string, number>();
  for (const b of world.buildings) {
    if (b.built) continue;
    const need = missingResource(b);
    if (!need) continue;
    if (countResource(world, need.kind) >= need.amount) continue;
    stalled.set(need.kind, (stalled.get(need.kind) ?? 0) + 1);
  }
  for (const [kind, count] of stalled) {
    out.push({
      id: `stalled:${kind}`,
      text: `${count} blueprint${count === 1 ? '' : 's'} waiting on ${kind}`,
      hint: `Nothing will be built there until there is ${kind} in a stockpile.`,
      level: 'warn',
    });
  }

  // Stable, so an alert never swaps places with its neighbour between ticks: the
  // urgent ones rise, everything else keeps the order the checks are written in.
  return out
    .map((a, i) => ({ a, i }))
    .sort((p, q) => rank(p.a) - rank(q.a) || p.i - q.i)
    .map((e) => e.a);
}

function rank(a: Alert): number {
  return a.level === 'urgent' ? 0 : 1;
}
