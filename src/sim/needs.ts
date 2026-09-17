/**
 * Needs and mood. Rates are expressed per in-game day and converted to
 * per-tick here, so retuning day length in types.ts does not silently rebalance
 * starvation.
 */

import { difficultyOf } from './difficulty';
import { WIDOW_GRIEF, partnerLost, widow } from './partners';
import { bondBetween, closestFriendOf } from './social';
import { appetiteMultiplier, moodBonus, traitsOf } from './traits';
import { TICKS_PER_DAY, type Pawn, type World } from './types';
import { msg } from './world';
import { rememberFirst } from './lifelog';

const perTick = (perDay: number) => perDay / TICKS_PER_DAY;

export const FOOD_DRAIN = perTick(0.82);
export const REST_DRAIN = perTick(1.05);
export const REC_DRAIN = perTick(0.62);

/**
 * Hit points lost per day once the food need is empty.
 *
 * This used to be a flat point every twenty ticks — 240 hp/day, which killed a
 * settler in a hundred seconds of real time and read to a player as "they
 * collapsed for no reason". Starvation should be a crisis you can still answer:
 * at this rate a full-health settler has about three and a half days before
 * they go down, and four and a half before it kills them.
 */
export const STARVE_DAMAGE = perTick(22);

/** An unconscious settler burns far less. It is also the only mercy they get. */
export const DOWNED_METABOLISM = 0.4;

/** Rest recovered per tick while asleep in a real bed. */
/** Hit points regained per in-game day while resting. Bleeding overrides this. */
export const HEAL_SLEEPING = perTick(45);
/**
 * A downed settler mends on the floor where they fell. Fast enough that a lost
 * fight costs about a day of work rather than a settler, which is the difference
 * between a setback the colony can absorb and a spiral it cannot.
 */
export const HEAL_DOWNED = perTick(30);

export const REST_GAIN_BED = perTick(3.0);
export const REST_GAIN_GROUND = perTick(1.4);
export const REC_GAIN_TABLE = perTick(6.0);

/**
 * Food at which a drafted settler stops being drafted and goes to eat.
 *
 * Well below `HUNGRY` — the whole point of a draft is that the line holds
 * through the hungry part — but above empty, so the walk to the pantry happens
 * before the starvation damage rather than during it. At `FOOD_DRAIN` this is
 * roughly two hours of game time in hand.
 */
export const DRAFT_BREAKS_OFF = 0.07;

/** Need thresholds that make a settler drop what they are doing. */
export const HUNGRY = 0.34;
export const TIRED = 0.3;
export const BORED = 0.24;

export const FOOD_VALUE: Record<string, number> = {
  meal: 0.62,
  rawfood: 0.3,
};

// --- Morale -----------------------------------------------------------------
//
// Mood used to be a number the HUD drew and nothing else read: the panel would
// say a settler was "breaking" and the settler would keep cheerfully hauling
// planks. Either the word comes out or it means something, and a colony sim
// without morale is a spreadsheet, so it means something.
//
// Two teeth, both deliberately gentle. A miserable settler works slower — a soft
// tax you feel across a day rather than a cliff. And below `BREAK_MOOD` they
// down tools entirely. A break is not a punishment spiral: they still eat, sleep
// and sit at the table while it lasts, which is exactly what pulls them out of
// it, so the colony that built beds and a stove recovers on its own and the one
// that built neither does not.

/**
 * Morale from things that happened, on top of the three bars.
 *
 * Clamped hard, because it is meant to colour a mood the needs already set, not
 * to override them: no run of hot dinners should keep a starving settler content.
 */
export const MOOD_OFFSET_LIMIT = 0.3;
/** Per tick, back towards zero — a good day is forgotten in about a day. */
export const MOOD_OFFSET_DECAY = perTick(0.34);

export const MOOD_ATE_COOKED = 0.05;
export const MOOD_ATE_RAW = -0.05;
export const MOOD_ATE_AT_TABLE = 0.04;
export const MOOD_SLEPT_ROUGH = -0.07;
/**
 * And a night in the open, which is a different complaint.
 *
 * Roughly double, because the floor of the cabin is a bad night and the yard is
 * a night nobody in the colony should be having. The real price is not this
 * number though — it is the flu roll in `tickGroundSleep`. See `quarters.ts`.
 */
export const MOOD_SLEPT_OUTSIDE = -0.14;
export const MOOD_GRIEF = -0.16;
export const MOOD_BREAKTHROUGH = 0.06;

/** Mood at or below which a settler downs tools. Matches the "breaking" label. */
export const BREAK_MOOD = 0.24;
/** Mood at which they pick them back up. */
export const BREAK_RECOVER_MOOD = 0.4;
/**
 * Shortest a break can last, in ticks — a fifth of a day.
 *
 * Without a floor, a settler whose mood is hovering on the line flickers in and
 * out of breaking every tick, which reads as a bug and spams the log.
 */
export const BREAK_MIN_TICKS = Math.round(TICKS_PER_DAY * 0.2);
/**
 * Longest, after which they get up regardless.
 *
 * Paired with the relief nudge below: a colony with no food and no beds cannot
 * lift anyone's mood, so without a cap the first break would be permanent and
 * the run would be over before the player could answer it.
 */
export const BREAK_MAX_TICKS = Math.round(TICKS_PER_DAY * 0.55);
/** Applied when a break times out, so the settler does not re-break the next tick. */
export const MOOD_BREAK_RELIEF = 0.2;

/**
 * Nudge a settler's morale by something that just happened.
 *
 * Everything goes through here rather than writing `mood` directly, because mood
 * itself is recomputed from the needs every tick — a direct write would survive
 * for exactly one tick and then vanish, which is the bug this function exists to
 * make impossible.
 */
export function nudgeMood(pawn: Pawn, delta: number): void {
  const next = (pawn.moodOffset ?? 0) + delta;
  pawn.moodOffset = Math.max(-MOOD_OFFSET_LIMIT, Math.min(MOOD_OFFSET_LIMIT, next));
  pawn.mood = computeMood(pawn);
}

/**
 * The whole colony feels a death, and the people who knew them feel it most.
 *
 * The flat version of this was the honest first answer, and it was also the one
 * that made a death read as an event rather than a loss: every settler took the
 * same sixteen points whether the dead man had been their closest friend or
 * somebody they had never worked a shift with. Now it scales with the bond —
 * up to double for a friend, and never *less* than half for a rival, because a
 * colony is a small place and one fewer pair of hands is one fewer pair of hands
 * however you felt about them.
 */
export function grieve(world: World, lost: Pawn): void {
  const mourner = closestFriendOf(world, lost);
  // Asked before the loop and acted on after it: the pairing has to still be in
  // the map while the grief is being priced, and has to be gone by the time
  // anything else looks at the colony. See `partners.ts`.
  const left = partnerLost(world, lost);
  for (const p of world.pawns) {
    if (p.faction !== 'colony' || p.dead || p.id === lost.id) continue;
    const bond = bondBetween(world, p.id, lost.id);
    const scale = bond >= 0 ? 1 + Math.min(1, bond / 100) : 1 + Math.max(-0.5, bond / 200);
    nudgeMood(p, MOOD_GRIEF * scale * (p.id === left?.id ? WIDOW_GRIEF : 1));
  }
  // After the loop, so the survivor took the full blow first. This is what makes
  // the loss last past the afternoon — the spike clamps, the shadow does not.
  if (left) widow(world, lost, left);
  // Named, because the point of the whole social layer is that the player knows
  // who to worry about tonight.
  if (mourner) {
    // The first friend they lose is the one that marks them; the fourth is a
    // colony that is losing, and four burials on one card crowds out the life
    // that made them worth burying. Named, for the same reason the message is.
    rememberFirst(world, mourner, 'buried ', `buried ${lost.name}`);
    msg(world, `${mourner.name} has lost a friend.`, 'bad');
  }
}

/** Everyone's morale lifts when something the colony worked for finally lands. */
export function celebrate(world: World, amount = MOOD_BREAKTHROUGH): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony' || p.dead) continue;
    nudgeMood(p, amount);
  }
}

/** True while the settler is refusing work. */
export function isBreaking(pawn: Pawn): boolean {
  return (pawn.breakTicks ?? 0) > 0;
}

/**
 * How fast a settler works, as a multiplier on their skill.
 *
 * Deliberately narrow. The point is that keeping people fed and rested is worth
 * doing for its own sake, not that an unhappy colony grinds to a halt — that job
 * belongs to breaks, where the player can at least see what happened.
 */
export function moraleScale(pawn: Pawn): number {
  return 0.78 + 0.32 * pawn.mood;
}

export function tickNeeds(world: World, pawn: Pawn): void {
  if (pawn.dead) return;
  const n = pawn.needs;
  const sleeping = pawn.activity === 'sleeping';

  // How tightly the colony has to be managed, as one number. It multiplies the
  // three drains and nothing else — not the damage an empty stomach does, not
  // the mood floor, not how fast a wound mends. A harder setting makes the
  // player run the kitchen and the schedule more attentively; it does not make
  // the consequence of getting it wrong worse than it is on Settler, where this
  // is 1 and every number below is the number it has always been.
  const upkeep = difficultyOf(world).upkeep;
  const metabolism = pawn.downed ? DOWNED_METABOLISM : sleeping ? 0.55 : 1;
  n.food = Math.max(0, n.food - FOOD_DRAIN * upkeep * metabolism * appetiteMultiplier(pawn));
  // Unconscious counts as asleep, because it is. The old rule drained rest from
  // anybody not in a bed, which meant a settler face-down on the floor was
  // *staying awake* — two days on the floor after a bad fight ran them to zero
  // rest, and zero rest is a mood bleed every sixty ticks on top of the wound.
  // On the seed I measured, a plague put all seven settlers down at once and the
  // colony's average mood went to 0.01 with the top drag reading `tired`: nobody
  // conscious to carry a stretcher, everybody being punished for lying where
  // they fell. They mend on the floor (below) — they rest on it too.
  if (!sleeping && !pawn.downed) {
    n.rest = Math.max(0, n.rest - REST_DRAIN * upkeep);
    n.recreation = Math.max(0, n.recreation - REC_DRAIN * upkeep);
  } else if (pawn.downed) {
    n.rest = Math.min(1, n.rest + REST_GAIN_GROUND);
  }

  // A drafted settler takes no jobs at all, so a draft left standing is a slow
  // execution: they will hold the line until they die beside a full pantry. At
  // empty they break off and go eat, loudly, because "starved to death while
  // drafted" is a death a player reads as a bug rather than as their mistake.
  //
  // Released just *above* empty rather than at it, because the old rule handed
  // them back the moment the damage started and then made them walk to the
  // pantry: every draft the player forgot about cost hit points, which is the
  // "downed for no reason" a player cannot trace to a decision they made. The
  // margin is about two hours of game time — enough to cross the map to a meal
  // and still arrive with something in the tank.
  if (n.food <= DRAFT_BREAKS_OFF && pawn.drafted) {
    pawn.drafted = false;
    pawn.orderX = null;
    pawn.orderY = null;
    msg(world, `${pawn.name} breaks off — too hungry to hold the line.`, 'bad');
  }

  // How long they have been on nothing. Mood reads it — see `starveMood` — and it
  // has to live on the pawn because `computeMood` is a pure function of one body
  // and does not get to look at the clock.
  if (n.food <= 0) pawn.emptyTicks = (pawn.emptyTicks ?? 0) + 1;
  else if (pawn.emptyTicks) pawn.emptyTicks = 0;

  // Starvation and exhaustion have teeth, or needs are decoration.
  if (n.food <= 0) {
    // The same multiplier that slows an unconscious settler's appetite slows what
    // an empty stomach costs them. It was already applied to the drain and not to
    // the damage, which read as "burns less, dies faster" — and on the floor, with
    // nobody standing to bring a meal, that difference is what turned a lost fight
    // into a funeral.
    damageFromNeed(world, pawn, STARVE_DAMAGE * metabolism, 'starved');
    // Say it out loud, twice a day, while there is still time to act. A settler
    // who dies off-screen with no warning reads as a bug, not as a hard choice.
    if (!pawn.dead && pawn.faction === 'colony' && world.tick % Math.round(TICKS_PER_DAY / 2) === 0) {
      msg(world, `${pawn.name} is starving — get food to them.`, 'bad');
    }
  }
  if (n.rest <= 0 && world.tick % 60 === 0 && !sleeping) {
    pawn.mood = Math.max(0, pawn.mood - 0.02);
  }

  // Wounds close while resting, so a bad fight is a setback rather than permanent.
  //
  // The empty stomach stops a sleeper mending but not a downed settler, and that
  // asymmetry is the whole difference between a bad day and a wiped colony. A
  // raid that puts *everybody* on the floor leaves nobody to carry a meal to
  // anybody: food falls to zero, healing stops, and the colony dies one settler a
  // day to a timer with no decision in it — which is exactly the shape of the
  // 99001 spiral, seven buried out of ten. Mending on an empty stomach is worth
  // about eight hit points a day net of starvation, so the fastest healer climbs
  // back to their feet in a day and a half and can then feed the rest. Slow,
  // ugly, survivable — and still lost if the raiders come back first.
  const mends = sleeping || pawn.downed;
  if (pawn.hp < pawn.maxHp && mends && (n.food > 0 || pawn.downed)) {
    pawn.hp = Math.min(pawn.maxHp, pawn.hp + (pawn.downed ? HEAL_DOWNED : HEAL_SLEEPING));
  }

  // Yesterday's dinner stops mattering. Decay first, so the mood computed below
  // is the one the break check reads.
  if (pawn.moodOffset) {
    const shrunk = Math.abs(pawn.moodOffset) - MOOD_OFFSET_DECAY;
    pawn.moodOffset = shrunk <= 0 ? 0 : Math.sign(pawn.moodOffset) * shrunk;
  }

  pawn.mood = computeMood(pawn);
  tickBreak(world, pawn);
}

/**
 * Start, sustain and end a morale break.
 *
 * The player's own body is exempt: taking the controls away from somebody
 * because their settler is sad is a bug however well motivated, and the first
 * person view has no way to explain itself.
 */
function tickBreak(world: World, pawn: Pawn): void {
  const held = pawn.breakTicks ?? 0;
  if (held > 0) {
    const left = held - 1;
    pawn.breakTicks = left;
    // The floor stops a settler on the line from flickering; past it, feeling
    // better is what ends it.
    if (left <= BREAK_MAX_TICKS - BREAK_MIN_TICKS && pawn.mood >= BREAK_RECOVER_MOOD) {
      pawn.breakTicks = 0;
      if (pawn.activity === 'breaking') pawn.activity = 'idle';
      msg(world, `${pawn.name} pulls themselves together and gets back to work.`, 'good');
      return;
    }
    if (left <= 0) {
      // Out of time rather than out of misery. Give them enough relief to stay
      // on their feet for a while, or the next tick starts the break again and
      // the player never gets a window to fix what caused it.
      //
      // Sized against where their mood actually is, not a flat number: a flat
      // 0.2 clears the line for an average settler and leaves a gloomy one a
      // hair below it, so exactly the settlers most likely to break were the
      // ones who fell straight back into it on the following tick — the failure
      // this branch exists to prevent, showing up only for some of the people.
      nudgeMood(pawn, Math.max(MOOD_BREAK_RELIEF, BREAK_MOOD - pawn.mood + MOOD_BREAK_RELIEF));
      if (pawn.activity === 'breaking') pawn.activity = 'idle';
      msg(world, `${pawn.name} works the worst of it off, for now.`, 'info');
    }
    return;
  }

  if (pawn.mood > BREAK_MOOD || pawn.downed || pawn.playerControlled) return;
  pawn.breakTicks = BREAK_MAX_TICKS;
  // Drafted settlers walk off the line — which is the cost of running a colony
  // this hard, and the loudest way to say so.
  pawn.drafted = false;
  pawn.orderX = null;
  pawn.orderY = null;
  world.stats.moraleBreaks = (world.stats.moraleBreaks ?? 0) + 1;
  msg(world, `${pawn.name} has had enough and stops working.`, 'bad');
}

function damageFromNeed(world: World, pawn: Pawn, amount: number, cause: string): void {
  pawn.hp -= amount;
  if (pawn.hp <= 0) {
    pawn.hp = 0;
    pawn.dead = true;
    pawn.activity = 'dead';
    pawn.downed = false;
    if (pawn.faction === 'colony') {
      world.stats.colonistsLost++;
      msg(world, `${pawn.name} has ${cause} to death.`, 'bad');
      grieve(world, pawn);
    }
  } else if (pawn.hp < pawn.maxHp * 0.2 && !pawn.downed) {
    pawn.downed = true;
    pawn.activity = 'downed';
    msg(world, `${pawn.name} collapses from hunger.`, 'bad');
  }
}

/**
 * Mood: full marks, less what the settler is going without.
 *
 * It used to be a flat blend of the three bars over a base of 0.3, and that
 * shape could not express a crisis. The bars each move slowly and a settler
 * always sleeps, so rest sits near full almost all the time — which put a floor
 * of about 0.38 under even a starving settler and made both the "breaking" label
 * and the break below it unreachable. Worse, it said a colonist with an empty
 * stomach and one with a half-full one differed by the same amount as two
 * colonists differing anywhere else on the scale, when in fact the whole
 * difference is at the bottom.
 *
 * So: a linear term for the general shortfall, plus a flat penalty for each need
 * that has actually bottomed out. Full needs still read 1.0 — the number the
 * existing balance was tuned against — but starving now costs a fifth of the
 * scale on its own, and starving *and* bored is the combination that breaks
 * somebody. That is the aftermath of a raid or a failed harvest, which is
 * exactly when a colony sim should be making the player deal with people.
 */
/** What being as cold (or as hot) as it gets costs on the mood scale. */
const COMFORT_MOOD = 0.18;

/**
 * A settler with nothing whatsoever wrong with them.
 *
 * Everything below is signed against this, in both `computeMood` and
 * `moodBreakdown` — which is the only reason the two can be checked against each
 * other by a test rather than by eye.
 */
export const MOOD_BASE = 1;

/**
 * What an empty stomach costs, and from where.
 *
 * Nothing until they are hungry enough to go and eat, then straight down to the
 * full price at empty. It used to be linear across the whole need, and that is a
 * tax rather than a signal: a settler eats at `HUNGRY`, a meal fills them to
 * about 0.96, and the drain is most of a day — so the average colonist spends
 * their whole life somewhere around 0.6 food carrying a permanent -0.14 on
 * morale, in a colony with four hundred food in the store. Measured over twenty
 * days on three seeds, `hungry` was the single largest drag on morale on every
 * day of every run, food surplus or no food surplus, which made it the loudest
 * row on the mood card and the one thing the player could do nothing at all
 * about.
 *
 * Below `HUNGRY` it is real and it is theirs to fix: somebody is not getting fed.
 */
function hungerMood(food: number): number {
  if (food >= HUNGRY) return 0;
  return ((HUNGRY - food) / HUNGRY) * 0.34;
}

/**
 * What starving costs, and why it grows.
 *
 * An empty stomach used to be a flat penalty, which says the first hour with
 * nothing is as bad as the third day — and it is not. It also made a famine
 * something the colony simply out-waited: hunger bottoms out, mood settles at a
 * number, and nothing further happens until somebody dies of it. A settler on
 * their third empty day should be the reason the player stops what they are doing.
 *
 * So it opens where it always did and climbs to the worst thing on the mood card.
 * Half a day is the ramp, because a settler only reaches zero after most of a day
 * of draining and `STARVE_DAMAGE` kills them inside two more — by the time it is
 * at full price they are genuinely dying, and it should be the loudest row on the
 * card. That is what makes a real famine break somebody, which is the point of
 * morale being in the game at all.
 */
const STARVING_MOOD = 0.18;
const STARVING_WORST = 0.42;
const STARVING_RAMP = TICKS_PER_DAY / 2;

function starveMood(pawn: Pawn): number {
  if (pawn.needs.food > 0) return 0;
  const gone = Math.min(1, (pawn.emptyTicks ?? 0) / STARVING_RAMP);
  return STARVING_MOOD + gone * (STARVING_WORST - STARVING_MOOD);
}

export function computeMood(pawn: Pawn): number {
  const n = pawn.needs;
  let m = MOOD_BASE;
  m -= hungerMood(n.food);
  m -= (1 - n.rest) * 0.24;
  m -= (1 - n.recreation) * 0.24;
  m -= starveMood(pawn);
  if (n.rest <= 0) m -= 0.12;
  if (pawn.hp < pawn.maxHp * 0.6) m -= 0.12;
  if (pawn.downed) m -= 0.15;
  // Cold and heat, straight off the thermometer where they are standing. Worth
  // about as much as an empty stomach at its worst, which is the right price: a
  // colony that never builds a fire is unhappy, not doomed.
  m -= Math.abs(pawn.comfort ?? 0) * COMFORT_MOOD;
  // The people around them. Small on purpose — see `social.ts`: a colony of
  // people who hate each other breaks a little sooner under the same pressure,
  // it does not starve.
  m += pawn.socialMood ?? 0;
  // And where they are standing. Same size as the people around them on purpose:
  // a handsome bunkhouse and a friend in it are worth about the same, and both
  // are small next to a full stomach. See `beauty.ts`.
  m += pawn.roomMood ?? 0;
  // And whether any of that room is theirs. Same size as the people in it, on
  // purpose — a bunkhouse is a complaint, not a crisis. See `quarters.ts`.
  m += pawn.privacyMood ?? 0;
  // And whoever they came home to — positive while that person is alive, and
  // negative for the days after they are not. See `partners.ts`: the one slot
  // carries both because they are the same fact about the settler.
  m += pawn.partnerMood ?? 0;
  // And what they are breathing. Zero for every colony that kept its engines out
  // of doors, which is nearly all of them — see `fumes.ts`.
  m += pawn.fumesMood ?? 0;
  // And whether the animal that decided to follow them around is still alive.
  // Never negative: losing it is charged once through `moodOffset` like any other
  // grief, and charging it here as well would mean a settler who lost a pet was
  // permanently worse off than one who never had it. See `pets.ts`.
  m += pawn.petMood ?? 0;
  // Temperament, not circumstance: an optimist in a crisis is still in a crisis,
  // but they are further from the break than the pessimist standing next to them.
  m += moodBonus(pawn);
  m += pawn.moodOffset ?? 0;
  return Math.max(0, Math.min(1, m));
}

/** One thing pushing a settler's mood one way, and how hard. */
export interface MoodFactor {
  /**
   * What the player calls it, not what the source calls it: "hungry", not
   * "food". A noun or adjective phrase, lowercase, no punctuation — the panel
   * prints it in a row and the alert prints it inside a sentence, and both have
   * to read as English.
   */
  label: string;
  /** Signed, in mood units — the same scale as `mood` itself. */
  amount: number;
}

/**
 * Why a settler's mood is what it is.
 *
 * `computeMood` folds twelve different things into one number and the player was
 * shown only the number. That is fine right up until "Wren Holloway has had
 * enough and stops working", at which point the game has told them somebody
 * broke and given them no way at all to find out what over — hunger, cold, an
 * ugly bunkhouse, fumes off a generator, a friend buried yesterday, or simply a
 * pessimist having a normal week. The alert even said "feed them and build
 * beds", which is wrong advice for a settler who is fed, in bed, and freezing.
 *
 * ## This must not become a second implementation
 *
 * It sits directly under `computeMood` and mirrors it line for line, deliberately
 * — the two are read together or not at all, and a term added above without a
 * term added here is a panel that quietly stops adding up. `tests/morale.test.ts`
 * pins that: it fuzzes settler states and asserts `MOOD_BASE` plus these factors
 * is exactly what `computeMood` returns. Adding a term to one and not the other
 * fails the suite rather than shipping a lie to the player.
 *
 * Kept out of the hot path on purpose. `computeMood` runs for every pawn every
 * tick and allocates nothing; this allocates an array and runs when somebody
 * opens a card or an alert needs a reason, which is a handful of times a second
 * at worst.
 *
 * Ordered worst first, and zero terms are dropped: the point is the one thing to
 * go and fix, and a colony that never built a generator does not need a row
 * telling it the air is fine.
 */
export function moodBreakdown(pawn: Pawn): MoodFactor[] {
  const n = pawn.needs;
  const out: MoodFactor[] = [];
  const put = (label: string, amount: number): void => {
    if (amount !== 0) out.push({ label, amount });
  };

  put('hungry', -hungerMood(n.food));
  put('tired', -(1 - n.rest) * 0.24);
  // One number, two complaints, and the difference between them is the whole
  // hint. The idle pass sends anybody below `IDLE_REC` to the best seat they can
  // reach, so a settler holding no job and *still* short of recreation is one
  // `takeABreak` has already failed for: there was nowhere to sit. A settler
  // holding a job is the opposite case — the board is full and the table is the
  // thing they never get to. The single old label said the first of those to
  // both of them, and to a player watching a settler haul stone all day
  // `nothing to do` reads as the game plainly lying. The amount is the same
  // either way, which is why `computeMood` needs no branch: it carries the
  // number and never the words.
  //
  // `jobId === null` alone was not the question, though. It answers "are they
  // holding work", and the row needs "was the colony free to give them any".
  // `setDrafted` (`orders.ts:383`) cancels the job the instant the player
  // presses T and `tick.ts:316` never runs the job pass again while the draft
  // holds, so a drafted settler standing on the line read `nothing fun to do`
  // for every tick of it — measured at 4800 of 4800 by `3e-measure-label`, and
  // pinned in `tests/mood-label.test.ts`. `setManual` is the same shape.
  // These are the two states `isIdlePawn` (`src/eval/run.ts:405`) excludes
  // before anything else, and the row agreeing with that predicate is the
  // point; `src/sim` cannot import from `src/eval`, so the pair is restated
  // here rather than shared. Deliberately narrower than `isIdlePawn`: sleeping
  // and breaking settlers are left alone because nobody measured them, and
  // `playerControlled` — which `jobs.ts:406` withholds work from just as it
  // does these two — is left out because `isIdlePawn` does not exclude it, and
  // this row's job is to agree with that predicate, not to outrun it.
  const workWithheld = pawn.drafted || (pawn.manual ?? false);
  put(
    pawn.jobId === null && !workWithheld ? 'nothing fun to do' : 'tired of working',
    -(1 - n.recreation) * 0.24,
  );
  // The flat penalties for a need that has actually bottomed out. Separate rows
  // rather than folded into the three above, because they are separate to the
  // player too: "hungry" is a thing to get round to and "starving" is a thing to
  // drop everything for, and one row that silently doubles in size does not say
  // which of those is happening.
  put('starving', -starveMood(pawn));
  if (n.rest <= 0) put('has not slept', -0.12);
  if (pawn.hp < pawn.maxHp * 0.6) put('badly hurt', -0.12);
  if (pawn.downed) put('down', -0.15);
  const comfort = pawn.comfort ?? 0;
  put(comfort < 0 ? 'cold' : 'too hot', -Math.abs(comfort) * COMFORT_MOOD);
  put((pawn.socialMood ?? 0) < 0 ? 'bad blood here' : 'friends here', pawn.socialMood ?? 0);
  put((pawn.roomMood ?? 0) < 0 ? 'grim surroundings' : 'pleasant surroundings', pawn.roomMood ?? 0);
  // Named for what is missing rather than for the bunkhouse, because the fix is
  // a wall and a door and the player should be able to read that off the row.
  put('no room of their own', pawn.privacyMood ?? 0);
  // Two labels off one number, because the sign is the whole story: the same
  // slot that says "they have somebody" says "they had somebody" once that
  // person is gone, and a row reading "their partner −0.06" would be the game
  // blaming the dead. See `partners.ts`.
  put((pawn.partnerMood ?? 0) < 0 ? 'grieving' : 'their partner', pawn.partnerMood ?? 0);
  // Always negative when it is anything — see `fumes.ts`. Named for the cause and
  // not the symptom, because the fix is to move the generator outdoors and the
  // player cannot deduce that from "unwell".
  put('breathing fumes', pawn.fumesMood ?? 0);
  // Unnamed here, and named on the card a row above it. This function takes a
  // pawn and not a world, so it has no way to look the animal up — and the
  // colonist panel prints "Biscuit" directly under this row anyway, which is the
  // place a name is worth having. See `pets.ts`.
  put('their animal', pawn.petMood ?? 0);
  // Per trait rather than one lumped number: "Optimist" is a fact about who this
  // settler is and no amount of hauling changes it, which is worth saying plainly
  // next to the things that *can* be fixed.
  for (const t of traitsOf(pawn)) put(t.label, t.mood ?? 0);
  // Everything that has happened to them lately, in one row, labelled by which
  // way it went and nothing more. The sim genuinely stores it as one decaying
  // number — hot dinners, a night on the floor, a friend buried and an illness
  // dripping all land in the same accumulator — so naming a single cause here
  // would mean guessing, and a row that says "buried a friend +0.04" because
  // three good meals outweighed the grief is worse than no row at all. What
  // happened is what the message log is for; this row's job is to say how much
  // of the mood it accounts for.
  const offset = pawn.moodOffset ?? 0;
  put(offset < 0 ? 'a rough few days' : 'a good few days', offset);

  return out.sort((a, b) => a.amount - b.amount);
}

/**
 * The one thing to go and fix, or null for a settler with nothing wrong.
 *
 * Traits are skipped — "Pessimist" is true, is often the largest negative on the
 * card, and is the single least useful thing to tell somebody looking for
 * something to do about it. The panel still lists it; an alert that says "go and
 * fix their personality" does not.
 */
export function worstMoodFactor(pawn: Pawn): MoodFactor | null {
  const traits = new Set(traitsOf(pawn).map((t) => t.label));
  const worst = moodBreakdown(pawn).find((f) => f.amount < 0 && !traits.has(f.label));
  return worst ?? null;
}

export function moodLabel(mood: number): string {
  if (mood > 0.8) return 'content';
  if (mood > 0.62) return 'fine';
  if (mood > 0.45) return 'strained';
  if (mood > 0.28) return 'unhappy';
  return 'breaking';
}

export function needLabel(v: number): string {
  if (v > 0.75) return 'good';
  if (v > 0.45) return 'ok';
  if (v > 0.25) return 'low';
  return 'critical';
}
