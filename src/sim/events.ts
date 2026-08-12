/**
 * The storyteller: paced threat beats, plus fire propagation.
 * Threats escalate slowly so the first one is survivable with three settlers.
 */

import { defOf } from './buildings';
import { difficultyOf } from './difficulty';
import { FIRE_TOUCH, buildingAt, dist, nearestWalkable } from './grid';
import { damageBuilding, damagePawn } from './combat';
import {
  arrivalSpot,
  startHerdMigration,
  startPredatorPack,
  startRefugeeFlight,
  startSolarFlare,
  tickEncounters,
} from './encounters';
import { afflict } from './health';
import { Rng } from './rng';
import { caravansOf } from './settlements';
import type { Pawn, SkillName, World } from './types';
import { TICKS_PER_DAY, packCell, terrainAt } from './types';
import { tickScoutItch } from './scout';
import { douse, isStormbound } from './weather';
import { makePawn } from './worldgen';
import { msg, nextId, livingColonists, hostiles } from './world';
import { remember } from './lifelog';

const RAIDER_NAMES = [
  'Scrag', 'Vult', 'Hob', 'Draff', 'Mott', 'Skell', 'Grist', 'Yarrow', 'Culth', 'Bex',
];

/** Ticks of warning before a threat beat lands. */
export const WARN_LEAD = Math.round(TICKS_PER_DAY * 0.35);

/**
 * How hard the Ashbound hit, as a function of how many beats have already
 * landed. The first band deliberately fields club-armed stragglers with less
 * health than a settler: the opening raid is a lesson, not an execution. Later
 * bands out-shoot the colony, which is what walls and turrets are for.
 *
 * The difficulty multiplier is applied *after* every draw, never inside one.
 * That is not a style preference: a band of the same size must consume the same
 * number of values from the story stream on all three settings, so the setting
 * changes what a raider *is* and never what comes next. In particular the
 * `settler` path multiplies by one throughout and is therefore bit-for-bit the
 * run this function produced before difficulty existed — which every eval sweep
 * and the seed contract in `tests/hunting.test.ts` are measured against.
 *
 * (Two settings do still part company later in a run, and honestly so: a bigger
 * band is more raiders to roll up, so hard country's third beat draws more than
 * the quiet valley's. The invariant is per-raider, not per-run.)
 */
/**
 * Clean fights per step up the ladder.
 *
 * Three, so holding the line once is luck and three times running is a pattern.
 * Beats land every day and a half to two and a half and about half of them are
 * something to shoot at, so the first step is somewhere past day twelve on the
 * middle setting. That is deliberately outside the eight-day eval sweep: the
 * harness measures whether a colony can get on its feet, and a difficulty curve
 * that moved inside the window would quietly be measuring the curve instead.
 */
export const CLEAN_PER_STEP = 3;

/**
 * What the Ashbound send when they are not making a point of it.
 *
 * A ceiling and not a count: the band that actually arrives is the smaller of
 * this and what the colony can meet, then scaled by the setting. Named because
 * `roads.ts` measures the warfare road in bands put down and a band has to mean
 * the same thing there as it does here — an unnamed six in an expression is a
 * number two files would each have their own copy of.
 */
export const STANDING_BAND = 6;

/** The most the ladder ever adds: ten raiders instead of six, each of them harder. */
const MAX_ESCALATION = 4;

/**
 * How far past the standing band the Ashbound have climbed.
 *
 * Zero for the whole early game, and zero again for any colony still taking
 * casualties — which between them is most colonies most of the time.
 */
export function escalation(world: World): number {
  return Math.min(MAX_ESCALATION, Math.floor((world.storyteller.unbloodied ?? 0) / CLEAN_PER_STEP));
}

/**
 * What the colony hears when the Ashbound decide it wants more attention.
 *
 * One line per rung, and every rung says something, because a difficulty curve
 * the player cannot see is one they experience as the game cheating. If the raids
 * got harder, the game said so first.
 */
const ESCALATION_WORD = [
  'A rider watches the yard from the ridge for an hour, then turns north. The Ashbound have seen enough.',
  'The Ashbound have stopped sending scouts. Whatever comes next comes in force.',
  'Ashbound war-bands are massing out on the moor, and they are bringing rifles for everyone.',
  'Word up the valley: the Ashbound have put a price on this colony. They will send whatever it takes.',
];

/**
 * Read the marks a finished fight left behind, move the streak, and say so if the
 * Ashbound have changed their minds about this colony.
 */
function settleTheStreak(world: World): void {
  const st = world.storyteller;
  const buried = world.stats.colonistsLost > (st.raidMark ?? world.stats.colonistsLost);
  const before = escalation(world);
  st.unbloodied = st.raidHurt || buried ? 0 : (st.unbloodied ?? 0) + 1;
  st.raidHurt = undefined;
  st.raidMark = undefined;
  // Only ever announced on the way up. Losing somebody is already the worst news
  // on the screen, and appending "and the raiders have eased off" to it reads as
  // the game consoling the player — which is worse than saying nothing at all.
  for (let rung = before + 1; rung <= escalation(world); rung++) {
    const word = ESCALATION_WORD[rung - 1] ?? ESCALATION_WORD[ESCALATION_WORD.length - 1]!;
    msg(world, word, 'threat', { headline: true });
  }
}

/**
 * One Ashbound, scaled by the difficulty dials and by the escalation ladder.
 *
 * Exported for `holdings.ts`, which rolls a holding's garrison out of it at the
 * moment of the assault rather than at world generation. That is the whole
 * reason the war road needs no difficulty settings of its own: the men behind
 * the wall are the men who would have come over the treeline.
 */
export function raiderBand(world: World, rng: Rng): { hp: number; shooting: number; rifle: boolean } {
  const esc = escalation(world);
  // Half, because `step` is the one number every other dial reads. Counting the
  // rung in whole made a rung move all four at once — on seed 99001, reaching rung
  // two put a third more raiders in the yard, each with fifteen percent more hp and
  // a quarter better aim, and the colony that earned the rung by never losing
  // anybody spent the next six days with six of its ten settlers on the floor and
  // its kitchen cold. A curve the player climbs, not a cliff they fall off: the
  // band still grows by the full rung, and the men in it get tougher at half of it.
  const step = Math.min(6, world.storyteller.threatsFired) + Math.floor(esc / 2);
  const { bite, tech } = difficultyOf(world);
  const hp = 58 + step * 8 + rng.int(16);
  const shooting = 1 + step + rng.int(4);
  return {
    hp: Math.round(hp * bite),
    shooting: Math.max(0, Math.round(shooting * bite)),
    // The cap is on the base odds rather than on the product: it is a statement
    // about how well armed the Ashbound get, and hard country is allowed past it.
    // The ladder raises the statement rather than sidestepping it — a colony that
    // has not been touched in a dozen fights is worth the good rifles.
    //
    // `tech` rather than `bite` because this is the dial the player reads off the
    // screen. It draws from the same `rng.chance` call in the same order it
    // always did, so Settler — where `tech` is 1 — is still the run it was.
    rifle: rng.chance(Math.min(0.6 + esc * 0.05, 0.1 + step * 0.09) * tech),
  };
}

export function spawnRaid(world: World, rng: Rng, count: number): Pawn[] {
  // Pick one map edge so the raid arrives as a readable front, not a surround.
  const side = rng.int(4);
  const spawned: Pawn[] = [];
  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    const along = 6 + rng.int(world.width - 12);
    if (side === 0) {
      x = along;
      y = 2;
    } else if (side === 1) {
      x = along;
      y = world.height - 3;
    } else if (side === 2) {
      x = 2;
      y = along;
    } else {
      x = world.width - 3;
      y = along;
    }
    const spot = nearestWalkable(world, x + rng.int(3) - 1, y + rng.int(3) - 1, 14);
    if (!spot) continue;
    const band = raiderBand(world, rng);
    const p = makePawn(world, rng, 'raider', spot.x, spot.y, {
      name: `${rng.pick(RAIDER_NAMES)} the Ashbound`,
      weapon: band.rifle ? 'rifle' : 'club',
    });
    p.hp = band.hp;
    p.maxHp = p.hp;
    p.skills.shooting = band.shooting;
    spawned.push(p);
  }
  world.storyteller.raidActive = true;
  msg(
    world,
    `Ashbound raiders — ${spawned.length} of them — break the treeline. Draft your settlers (T).`,
    'threat',
    { at: spawned[0], headline: true },
  );
  return spawned;
}

export function spawnWildlife(world: World, rng: Rng): void {
  const side = rng.chance(0.5) ? 2 : 3;
  const x = side === 2 ? 3 : world.width - 4;
  const y = 8 + rng.int(world.height - 16);
  const spot = nearestWalkable(world, x, y, 14);
  if (!spot) return;
  const beast = makePawn(world, rng, 'wildlife', spot.x, spot.y, {
    name: 'Maddened thornback',
    weapon: 'club',
  });
  beast.hp = Math.round((68 + Math.min(6, world.storyteller.threatsFired) * 7) * difficultyOf(world).bite);
  beast.maxHp = beast.hp;
  beast.skills.shooting = 0;
  world.storyteller.raidActive = true;
  msg(world, 'A maddened thornback crashes out of the woods.', 'threat', {
    at: spot,
    headline: true,
  });
}

/** Nobody joins a colony that is already crowded. */
export const WANDERER_CAP = 5;

/**
 * A settler wanders in and asks to stay.
 *
 * Without this, attrition is a one-way ratchet: the eval sweeps showed colonies
 * dropping 3 → 2 → 1 over three weeks and then dying the first time the last
 * settler was downed, because a downed settler alone cannot eat. Raids escalate,
 * so the colony has to be able to grow too. The wait scales with how many people
 * are already here — a colony down to one gets help soonest, which is exactly
 * when a player needs a reason to keep going.
 */
function tickArrivals(world: World, rng: Rng): void {
  const st = world.storyteller;
  st.nextArrival--;
  if (st.nextArrival > 0) return;

  const colonists = livingColonists(world).length;
  // Reschedule first, so every early return still pushes the next attempt out.
  st.nextArrival = Math.round(TICKS_PER_DAY * (2 + colonists + rng.next()));
  if (colonists >= WANDERER_CAP) return;
  // Not into the middle of a firefight, and not into a fallen colony — the
  // game-over check owns that ending.
  if (hostiles(world).length > 0 || colonists === 0 || world.gameOver) return;

  const spot = arrivalSpot(world, rng);
  if (!spot) return;

  const skills: SkillName[] = ['construction', 'cooking', 'plants', 'mining', 'shooting', 'medicine'];
  const p = makePawn(world, rng, 'colony', spot.x, spot.y, { skillBias: rng.pick(skills) });
  remember(world, p, 'walked out of the trees and asked to stay');
  msg(world, `${p.name} walks out of the trees and asks to stay. Welcome them.`, 'good', {
    at: spot,
    headline: true,
  });
}

/** How soon somebody turns up once word travels. Most of a day's walk out. */
export const HASTENED_ARRIVAL = Math.round(TICKS_PER_DAY * 0.6);

/**
 * Bring the next wanderer forward, because somebody out there has heard of you.
 *
 * The same shape as `summonCaravan`, for the same reason: it moves the clock on
 * the arrival that was already coming rather than conjuring a settler out of
 * nothing. Growth still runs on `tickArrivals`' rules — including the crowding
 * cap, checked there and again here so that no caller can be the one door that
 * ignores it — and nothing about this can be farmed for a second settler.
 *
 * Returns false when the colony is already full, or when whoever is walking is
 * closer than this would put them: in both cases there is nothing to give.
 */
export function hastenArrival(world: World): boolean {
  const st = world.storyteller;
  if (livingColonists(world).length >= WANDERER_CAP) return false;
  if (st.nextArrival <= HASTENED_ARRIVAL) return false;
  st.nextArrival = HASTENED_ARRIVAL;
  msg(
    world,
    'Word of the colony goes back down the road with the scouts. Somebody is walking this way.',
    'good',
    { headline: true },
  );
  return true;
}

/**
 * Somebody comes down with the flu.
 *
 * It picks the settler who has been treated worst, not a random one: the person
 * who has been up three nights running is the one who gets ill, which turns a
 * die roll into a consequence. Nobody who is already sick is picked twice.
 */
function tickOutbreak(world: World, rng: Rng): void {
  const st = world.storyteller;
  st.nextOutbreak = (st.nextOutbreak ?? Math.round(TICKS_PER_DAY * 4.5)) - 1;
  if (st.nextOutbreak > 0) return;
  st.nextOutbreak = Math.round(TICKS_PER_DAY * (3 + rng.next() * 3));
  if (world.gameOver) return;

  const candidates = livingColonists(world).filter((p) => (p.ailments?.length ?? 0) === 0);
  if (candidates.length === 0) return;
  // Worn down first: lowest rest, then lowest mood, then id so a replay lands on
  // the same person.
  candidates.sort(
    (a, b) => a.needs.rest - b.needs.rest || a.mood - b.mood || a.id - b.id,
  );
  const victims = candidates.length > 5 ? 2 : 1;
  for (let i = 0; i < victims && i < candidates.length; i++) {
    afflict(world, candidates[i]!, 'flu');
  }
}

export function igniteFire(world: World, x: number, y: number): void {
  if (world.fires.some((f) => f.x === x && f.y === y)) return;
  world.fires.push({ id: nextId(world), x, y, size: 0.35 });
}

export function startFireEvent(world: World, rng: Rng): void {
  const flammable = world.buildings.filter((b) => b.built && defOf(b.kind).flammable && b.kind !== 'tree');
  const target = flammable.length > 0 ? rng.pick(flammable) : null;
  if (target) {
    igniteFire(world, target.x, target.y);
    msg(world, `Fire! A ${defOf(target.kind).label.toLowerCase()} is burning.`, 'threat', {
      at: target,
      headline: true,
    });
  } else {
    const c = livingColonists(world)[0];
    if (!c) return;
    const x = Math.round(c.x) + 2;
    const y = Math.round(c.y) + 2;
    igniteFire(world, x, y);
    msg(world, 'Fire breaks out in the yard.', 'threat', { at: { x, y }, headline: true });
  }
}

export function tickFires(world: World, rng: Rng): void {
  if (world.fires.length === 0) return;
  // Rain fights the fire for you. At full downpour a flame loses ground three
  // times faster than it gains it, so a storm-lit blaze is a scare rather than
  // the end of the cabin — and a player who sees rain coming can let it work.
  // A winter storm is much less help: snow smothers slowly where rain drowns.
  const wet = douse(world);
  for (const f of world.fires.slice()) {
    f.size = Math.min(1, f.size + 0.006 - wet * 0.02);
    if (f.size <= 0) {
      world.fires = world.fires.filter((q) => q.id !== f.id);
      continue;
    }

    const b = buildingAt(world, f.x, f.y);
    if (b && b.built && world.tick % 10 === 0) {
      damageBuilding(world, b.id, 4 * f.size + 1);
    }
    // Anything standing in a fire gets burned.
    if (world.tick % 12 === 0) {
      for (const p of world.pawns) {
        if (p.dead) continue;
        if (dist(p.x, p.y, f.x, f.y) < FIRE_TOUCH) damagePawn(world, p, 3, 'fire');
      }
    }
    // Spread, preferring things that burn. Wet ground does not carry a fire.
    if (f.size > 0.5 && world.tick % 25 === 0 && wet < 0.35) {
      const dx = rng.int(3) - 1;
      const dy = rng.int(3) - 1;
      const nx = f.x + dx;
      const ny = f.y + dy;
      if (nx < 1 || ny < 1 || nx >= world.width - 1 || ny >= world.height - 1) continue;
      const nb = buildingAt(world, nx, ny);
      // Paving does not carry a fire. A stone path around the woodshed is the
      // firebreak the player can build, and it is the only reason to pay steel
      // for a floor when boards walk nearly as well.
      if (terrainAt(world, nx, ny) === 'paved' && !(nb && nb.built && defOf(nb.kind).flammable)) {
        continue;
      }
      const chance = nb && nb.built && defOf(nb.kind).flammable ? 0.55 : 0.08;
      if (rng.chance(chance)) igniteFire(world, nx, ny);
    }
    // Fires burn out on bare ground with nothing left to consume.
    if (!b && f.size > 0.85 && rng.chance(0.02)) {
      world.fires = world.fires.filter((q) => q.id !== f.id);
    }
  }
  // Fires standing on nothing flammable and fully grown eventually die.
  world.fires = world.fires.filter((f) => f.size > 0);
}

/** Advance the threat clock; fire the next beat when it comes due. */
export function tickStoryteller(world: World, rng: Rng): void {
  const st = world.storyteller;
  // One door in for the whole streak. A fight is on and nothing is marked yet, so
  // this is its first tick; a fight is on and nothing hostile is standing, so this
  // is its last. The three places that set `raidActive` do not have to know any of
  // this exists, and a fourth gets the accounting for free.
  if (st.raidActive && st.raidMark === undefined) st.raidMark = world.stats.colonistsLost;
  if (st.raidActive && livingColonists(world).some((p) => p.downed)) st.raidHurt = true;

  if (st.raidActive && hostiles(world).length === 0) {
    st.raidActive = false;
    const standing = world.pawns.filter((p) => p.faction === 'colony' && !p.dead && !p.downed).length;
    if (standing > 0)
      msg(world, 'The clearing is quiet again. The colony holds.', 'good', { headline: true });
    else
      msg(world, 'The attackers are gone. Nobody is left standing to tend the wounded.', 'bad', {
        headline: true,
      });
    settleTheStreak(world);
  }

  tickArrivals(world, rng);
  tickOutbreak(world, rng);
  tickEncounters(world);
  if (st.nextScout > 0) st.nextScout--;
  else tickScoutItch(world);

  st.nextThreat--;
  // Trouble announces itself. Roughly a third of a day of warning is enough to
  // pull settlers off the far side of the map, draft them and pick the ground —
  // which is the whole skill of the game. Without it the first a player knows of
  // a raid is a body.
  if (st.nextThreat === WARN_LEAD && st.threatsFired > 0) {
    msg(world, 'Smoke on the ridge line. Something is coming before the day is out.', 'threat', {
      headline: true,
    });
  }
  if (st.nextThreat > 0) return;
  if (world.gameOver) return;
  // Nothing marches out of the woods in a storm. This is the one place weather
  // hands the player a window rather than a penalty: a colony caught unready can
  // buy an hour by watching the sky, and the beat lands the moment it clears.
  if (isStormbound(world)) {
    st.nextThreat = Math.round(TICKS_PER_DAY * 0.05);
    return;
  }

  const colonists = livingColonists(world).length;
  const hardness = difficultyOf(world);
  const n = st.threatsFired;
  st.threatsFired++;
  // Days between beats, not hours. A colony needs the quiet to mine, build and
  // sleep — that quiet is where all the progress happens, which is why the
  // difficulty setting spends most of its effect here rather than on how hard a
  // raider punches: three quiet days is a wall, and a wall is worth more than
  // twenty points of enemy health.
  st.nextThreat = Math.round(TICKS_PER_DAY * (1.5 + rng.next() * 1.0) * hardness.respite);

  if (n === 0) {
    // The opening beat is one club-armed straggler, on every difficulty. It
    // teaches drafting and costs a bandage, not a settler — and a tutorial that
    // arrives three-handed on hard country is not a tutorial. Hard country gets
    // it a day sooner instead, and everything after it is worse.
    spawnRaid(world, rng, 1);
    return;
  }
  // Never more than the colony can meet, never fewer than the last one taught
  // them to expect — then scaled, so hard country is allowed past the six the
  // middle setting caps at and the quiet valley sends the pair a new colony can
  // actually stand in a doorway and beat.
  //
  // The six is a floor on the ceiling rather than the ceiling itself. A colony
  // that has taken a dozen fights without a scratch has told the Ashbound
  // something, and `escalation` is where they answer — up to ten, and only ever
  // for colonies that have stopped finding six a problem.
  const band = Math.max(
    1,
    Math.round(
      Math.min(STANDING_BAND + escalation(world), Math.min(colonists + 1, 1 + Math.ceil(n / 2))) *
        hardness.band,
    ),
  );
  // Half the beats are still a raid, because the game is about holding ground.
  // The other half is where the map got interesting: three of the six outcomes
  // below cannot be answered by drafting everybody and standing in the doorway,
  // which is the only way a ninety-six-cell map is bigger rather than just
  // longer to walk across.
  //
  // Every one of the new beats can decline — a flare over a colony with no wires
  // is a message about nothing — and each falls back to the nearest old beat
  // rather than passing, so the clock never ticks over into silence.
  const roll = rng.next();
  if (roll < 0.5) {
    spawnRaid(world, rng, band);
  } else if (roll < 0.65) {
    startFireEvent(world, rng);
  } else if (roll < 0.74) {
    spawnWildlife(world, rng);
  } else if (roll < 0.83) {
    // A rescue is only an offer worth making to a colony with room for them.
    if (colonists >= WANDERER_CAP || !startRefugeeFlight(world, rng)) spawnRaid(world, rng, band);
  } else if (roll < 0.9) {
    if (!startSolarFlare(world, rng)) startFireEvent(world, rng);
  } else if (roll < 0.95) {
    if (!startHerdMigration(world, rng)) spawnWildlife(world, rng);
  } else if (!startPredatorPack(world, rng)) {
    // The pack and the herd share an edge of this table on purpose. Both are the
    // same walk in off the same moor, and until the shapes resolve the player
    // cannot tell which one they got — which is the only reason a message saying
    // "animals are coming down into the valley" is worth reading twice.
    spawnWildlife(world, rng);
  }
}

/** Debug/UI hook: force the next threat immediately. */
export function forceThreat(
  world: World,
  rng: Rng,
  kind: 'raid' | 'fire' | 'beast' | 'refugee' | 'flare' | 'herd' | 'pack',
): void {
  if (kind === 'raid') spawnRaid(world, rng, Math.max(2, livingColonists(world).length));
  else if (kind === 'fire') startFireEvent(world, rng);
  else if (kind === 'refugee') startRefugeeFlight(world, rng);
  else if (kind === 'flare') startSolarFlare(world, rng);
  else if (kind === 'herd') startHerdMigration(world, rng);
  else if (kind === 'pack') startPredatorPack(world, rng);
  else spawnWildlife(world, rng);
  world.storyteller.nextThreat = Math.round(TICKS_PER_DAY * 0.9);
  world.storyteller.threatsFired++;
}

/** True when every colonist is dead. */
export function checkGameOver(world: World): void {
  if (world.gameOver) return;
  // Travellers are off `world.pawns` entirely while they are on the road
  // (`settlements.ts` lifts them out of the map so nothing can path to, shoot at
  // or feed a body that is not here). Without this, a colony whose last settlers
  // are four days out reads as wiped and the run ends while somebody is walking
  // home to it — and with two roads open that is a colony of two, which is
  // exactly the size that gets itself killed at home.
  const away = caravansOf(world).filter((c) => !c.pawn.dead).length;
  const alive = world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
  if (alive.length + away === 0) {
    world.gameOver = true;
    msg(world, 'Aetherhold has fallen. No settlers remain.', 'bad', { headline: true });
  }
}

/** Cells that are currently on fire, for the renderer. */
export function firePacked(world: World): number[] {
  return world.fires.map((f) => packCell(world, f.x, f.y));
}
