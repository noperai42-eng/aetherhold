/**
 * Combat: one resolution path shared by settler AI, turrets, raiders and the
 * first-person player. The player's trigger pull calls `fireWeapon` — the same
 * function a drafted settler's AI calls — so a bullet behaves identically
 * whichever view fired it.
 */

import { blocksSight, buildingAt, dist, hasLineOfSight, isWalkable } from './grid';
import { defOf, SHOOT_OVER_HEIGHT } from './buildings';
import { Rng } from './rng';
import { followPath, moveWithCollision, RUN_SPEED } from './movement';
import { grieve } from './needs';
import { tooIllToStand } from './health';
import { findPath, findPathAdjacent } from './path';
import { planRebuild } from './rebuild';
import { spreadMultiplier } from './weather';
import { riflingBonus, structureDamageScale, turretCooldownScale } from './research';
import { FLEE_TICKS } from './wildlife';
import { BITE_DAMAGE, biteReady, feast, hunters, preyFor } from './predators';
import { aimBonus } from './traits';
import { armourOf } from './gear';
import { gainSkill } from './skills';
import { eulogyFor, rememberFirst } from './lifelog';
import type { Building, Faction, Pawn, Projectile, World } from './types';
import { cancelJob, findBuilding, msg, nextId, removeBuilding } from './world';

export interface WeaponStats {
  range: number;
  cooldown: number;
  damage: number;
  speed: number;
  accuracy: number;
  melee: boolean;
}

export const WEAPONS: Record<Pawn['weapon'], WeaponStats> = {
  none: { range: 1.5, cooldown: 26, damage: 6, speed: 0, accuracy: 0.7, melee: true },
  club: { range: 1.6, cooldown: 22, damage: 13, speed: 0, accuracy: 0.8, melee: true },
  rifle: { range: 13, cooldown: 30, damage: 15, speed: 0.62, accuracy: 0.72, melee: false },
};

/**
 * Ticks between blood-loss ticks while a pawn is down.
 *
 * A settler goes down at a fifth of their health, so this interval decides
 * whether "down" means a lost day or a funeral. The colony rate is slow enough
 * that they survive the whole bleed window untreated — the fight can be finished
 * first, and a doctor arriving just makes it quicker. Raiders have no field
 * medic and bleed out at more than twice the rate, which is what ends a raid.
 */
const BLEED_INTERVAL_COLONY = 70;
const BLEED_INTERVAL_HOSTILE = 30;

export const TURRET_STATS: WeaponStats = {
  range: 13.5,
  cooldown: 26,
  damage: 12,
  speed: 0.7,
  accuracy: 0.75,
  melee: false,
};

export function isHostileTo(a: Faction, b: Faction): boolean {
  // Grazing animals are at war with nobody and nobody is at war with them. That
  // single line is what keeps turrets, raiders, self-defence and stray gunfire
  // off the herds — a hunter's bullet reaches them by `Projectile.targetId`
  // instead, which is a decision the player made rather than a reflex.
  if (a === 'fauna' || b === 'fauna') return false;
  // Same deal for the pedlar in the yard. A caravan that gets shot by its own
  // customers' turrets is not a trade route, and there is no version of this
  // game where raiding the trader is the interesting choice.
  if (a === 'trader' || b === 'trader') return false;
  // And for the raider in your bunk. They came here to kill you, but they are
  // disarmed, in your care and being talked round; a turret that reads the cell
  // as a target would make the whole feature a trap for the player who built it.
  if (a === 'prisoner' || b === 'prisoner') return false;
  return a !== b;
}

export function damagePawn(world: World, pawn: Pawn, amount: number, source: string): void {
  if (pawn.dead) return;
  // Armour applies here rather than at each of the seven places that deal damage,
  // which is the only way it can be true of fire, a raider's club, a bear and a
  // sprung trap alike without any of them knowing what a jerkin is. It is a
  // fraction, never a subtraction — see the note in `gear.ts`.
  pawn.hp -= amount * (1 - armourOf(pawn));
  // A wounded animal bolts. This is the whole difficulty of hunting: the first
  // shot is the easy one, and everything after it is a chase.
  if (pawn.faction === 'fauna') pawn.fleeUntil = world.tick + FLEE_TICKS;
  if (pawn.hp <= 0) {
    pawn.hp = 0;
    pawn.dead = true;
    pawn.downed = false;
    pawn.activity = 'dead';
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
    // The kill message and the meat both belong to the wildlife pass, which
    // owns everything that happens to a carcass.
    if (pawn.faction === 'fauna') return;
    if (pawn.faction === 'colony') {
      world.stats.colonistsLost++;
      msg(world, `${pawn.name} is dead. (${source})`, 'bad', { at: pawn, headline: true });
      // The line above says what happened and where to look, which is what a
      // player needs in the two seconds after it happens. This one is the twenty
      // days they spent earning it, and it is the only place the game ever spends
      // them. Second message rather than a longer first: the headline card stays
      // scannable, and the eulogy is there in the log to read when the shooting
      // stops. Null for somebody nothing was ever written down about.
      const eulogy = eulogyFor(world, pawn);
      if (eulogy) msg(world, eulogy, 'bad');
      grieve(world, pawn);
    } else {
      world.stats.raidersKilled++;
      msg(world, `${pawn.name} is killed.`, 'good');
    }
    return;
  }
  // Animals have no downed state — a wounded one runs until it drops, so a hunt
  // never leaves a twitching deer on the grass that nobody can finish.
  if (pawn.faction === 'fauna') return;
  if (!pawn.downed && pawn.hp < pawn.maxHp * 0.22) {
    pawn.downed = true;
    pawn.activity = 'downed';
    pawn.bleed = 20 * 45;
    pawn.path = null;
    pawn.drafted = false;
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
    // The first time only — see `rememberFirst`. Going down and getting back up
    // is the thing a settler is marked by; going down for the fifth time is a
    // Tuesday, and eight lines of it is a life with nothing else in it.
    rememberFirst(world, pawn, 'went down to', `went down to ${source}`);
    // Only ours gets a card. A raider going down is good news you can already
    // see, and in a firefight there are six of them.
    msg(world, `${pawn.name} is down!`, pawn.faction === 'colony' ? 'bad' : 'good', {
      at: pawn,
      headline: pawn.faction === 'colony',
    });
  }
}

export function damageBuilding(world: World, buildingId: number, amount: number): void {
  const b = world.buildings.find((q) => q.id === buildingId);
  if (!b) return;
  // Every caller — bullets, fire, a raider swinging at a wall — comes through
  // here, so plating is applied once, at the point the damage lands, and covers
  // structures that were already standing when the project finished.
  b.hp -= amount * structureDamageScale(world);
  if (b.hp <= 0) {
    b.hp = 0;
    // Before it leaves the world, while it still knows what and where it was.
    // Only the damage path plans a rebuild — deconstruction and the cancel tool
    // call `removeBuilding` directly, so what the player takes down stays down.
    planRebuild(world, b);
    removeBuilding(world, b);
  }
}

/** Spawn a projectile travelling in a unit direction. Used by AI, turrets and the player. */
export function fireWeapon(
  world: World,
  shooter: { id: number; faction: Faction; x: number; y: number },
  dirX: number,
  dirY: number,
  stats: WeaponStats,
  rng: Rng,
  skill = 5,
  /** A pawn this shot may hit regardless of faction — see `Projectile.targetId`. */
  targetId?: number,
): Projectile {
  // Weather widens the cone for everyone who pulls a trigger, raiders included,
  // which is why fog is a tactical situation and not just a nerf.
  const spread = (1 - Math.min(0.95, stats.accuracy + skill * 0.02)) * 0.42 * spreadMultiplier(world);
  const ang = Math.atan2(dirY, dirX) + rng.range(-spread, spread);
  const p: Projectile = {
    id: nextId(world),
    x: shooter.x,
    y: shooter.y,
    z: 1.05,
    vx: Math.cos(ang) * stats.speed,
    vy: Math.sin(ang) * stats.speed,
    ownerId: shooter.id,
    faction: shooter.faction,
    damage: stats.damage,
    life: Math.ceil((stats.range + 4) / stats.speed),
    targetId,
    spent: false,
  };
  world.projectiles.push(p);
  return p;
}

/** Melee swing: hits the nearest hostile inside reach and roughly in front. */
export function meleeSwing(world: World, pawn: Pawn, rng: Rng, includeFauna = false): boolean {
  const stats = WEAPONS[pawn.weapon];
  let best: Pawn | null = null;
  let bestD = Infinity;
  for (const q of world.pawns) {
    if (q.dead || q.id === pawn.id) continue;
    // `includeFauna` is the player swinging in first person. AI melee never sets
    // it, so a settler walking past a deer still has no reason to touch it.
    const fair = includeFauna && q.faction === 'fauna';
    if (!fair && !isHostileTo(pawn.faction, q.faction)) continue;
    // Nobody finishes off the fallen. Targeting and gunfire already skip downed
    // pawns; melee did not, so a raider walking past a body clubbed it to death
    // in the same tick it fell — the eval runs read "X is down!" and "X is dead"
    // 0.01 days apart, which turns one lost fight into one lost settler forever.
    if (q.downed) continue;
    const d = dist(pawn.x, pawn.y, q.x, q.y);
    if (d > stats.range + 0.5) continue;
    const ang = Math.atan2(q.y - pawn.y, q.x - pawn.x);
    let diff = Math.abs(((ang - pawn.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    diff = Math.abs(diff);
    if (diff > 1.1) continue;
    if (d < bestD) {
      best = q;
      bestD = d;
    }
  }
  if (!best) return false;
  const hit = rng.chance(Math.min(0.95, stats.accuracy + (pawn.skills.shooting + aimBonus(pawn)) * 0.01));
  if (hit) damagePawn(world, best, stats.damage * rng.range(0.8, 1.25), `${pawn.name}'s ${pawn.weapon}`);
  return true;
}

/**
 * A hunter engaging their quarry. Returns true if they are close enough to be
 * working on it — false means "keep walking".
 *
 * This is separate from `meleeSwing` and from the drafted-settler AI for one
 * reason: those both pick their own target by hostility, and nothing is hostile
 * to a grazing animal. A hunt is a *named* target the player chose, so the
 * target is passed in and the faction check is skipped. Everything else — the
 * weapon table, the cooldown, the accuracy roll, the weather spread inside
 * `fireWeapon` — is the same code a firefight runs on.
 */
export function huntStrike(world: World, pawn: Pawn, quarry: Pawn, rng: Rng): boolean {
  const stats = WEAPONS[pawn.weapon];
  const d = dist(pawn.x, pawn.y, quarry.x, quarry.y);
  if (d > stats.range) return false;
  if (!stats.melee && !hasLineOfSight(world, pawn.x, pawn.y, quarry.x, quarry.y)) return false;

  pawn.facing = Math.atan2(quarry.y - pawn.y, quarry.x - pawn.x);
  if (pawn.attackCooldown > 0) return true;
  pawn.attackCooldown = stats.cooldown;

  if (stats.melee) {
    // Clubbing a hare works; clubbing a mossback is a long afternoon. That is
    // the accuracy roll doing the balancing, not a special case.
    if (rng.chance(Math.min(0.95, stats.accuracy + (pawn.skills.shooting + aimBonus(pawn)) * 0.01))) {
      damagePawn(world, quarry, stats.damage * rng.range(0.8, 1.25), `${pawn.name}'s ${pawn.weapon}`);
    }
  } else {
    fireWeapon(
      world,
      pawn,
      quarry.x - pawn.x,
      quarry.y - pawn.y,
      stats,
      rng,
      marksmanship(world, pawn),
      quarry.id,
    );
  }
  return true;
}

/**
 * The player pulling the trigger. Routes through the exact same `fireWeapon` /
 * `meleeSwing` as settler AI and turrets, so a bullet from the first-person view
 * is indistinguishable from an AI bullet in the manager view.
 * `aimX/aimY` is a unit direction in world cell space.
 */
export function playerAttack(
  world: World,
  pawn: Pawn,
  aimX: number,
  aimY: number,
  rng: Rng,
): boolean {
  if (pawn.dead || pawn.downed) return false;
  if (pawn.attackCooldown > 0) return false;
  const stats = WEAPONS[pawn.weapon];
  pawn.facing = Math.atan2(aimY, aimX);
  pawn.attackCooldown = stats.cooldown;
  pawn.activity = 'fighting';
  practise(world, pawn);
  if (stats.melee) {
    meleeSwing(world, pawn, rng, true);
    return true;
  }
  // A player who lines up a deer and pulls the trigger expects to hit it, so the
  // shot carries that animal's id. AI bullets never do — this is the one place a
  // non-hostile pawn becomes a legitimate target, and only by an aimed decision.
  fireWeapon(world, pawn, aimX, aimY, stats, rng, marksmanship(world, pawn), aimedFauna(world, pawn, aimX, aimY, stats.range));
  return true;
}

/** The grazing animal the player is actually pointing at, if any. */
function aimedFauna(world: World, pawn: Pawn, aimX: number, aimY: number, range: number): number | undefined {
  const len = Math.hypot(aimX, aimY);
  if (len < 1e-6) return undefined;
  const aim = Math.atan2(aimY, aimX);
  let best: number | undefined;
  let bestD = range;
  for (const q of world.pawns) {
    if (q.faction !== 'fauna' || q.dead) continue;
    const d = dist(pawn.x, pawn.y, q.x, q.y);
    if (d > bestD) continue;
    const ang = Math.atan2(q.y - pawn.y, q.x - pawn.x);
    const diff = Math.abs(((ang - aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    // A cone rather than a ray: the bullet still has to fly there and can still
    // miss, but a shot roughly at an animal counts as a shot at that animal.
    if (diff > 0.35) continue;
    if (!hasLineOfSight(world, pawn.x, pawn.y, q.x, q.y)) continue;
    best = q.id;
    bestD = d;
  }
  return best;
}

/**
 * Chance that hard cover eats a bullet aimed at whoever is standing behind it.
 *
 * Sandbags call themselves "cheap hard cover to fight behind" and, until this
 * existed, did precisely nothing: they are short enough to shoot over, so
 * `blocksSight` waved every bullet straight through. That made the gate the
 * Steward builds — and any killbox a player builds — scenery, and the 21-day eval
 * runs measured the result: from day 11 on, every single raid floored the entire
 * colony while it stood in its own gateway.
 *
 * At a half the wall pays for itself without making a settler behind one immune:
 * four bullets in and two have landed.
 */
const COVER_DEFLECT = 0.5;


/**
 * The hard cover protecting `(x, y)` from fire arriving along `(dirX, dirY)`, if any.
 *
 * Directional, as cover has to be: sandbags across the lane are no help at all
 * against the raider who walked round the end of the line, and a player who
 * flanks a raider position should get the same reward.
 *
 * Takes a position rather than a pawn because it answers two questions now — "is
 * this shot deflected" and "would that cell over there be a better place to
 * stand" — and the second one is asked about cells nobody is standing on yet.
 */
function coverAt(world: World, x: number, y: number, dirX: number, dirY: number): Building | null {
  const len = Math.hypot(dirX, dirY);
  if (len < 1e-6) return null;
  const cx = Math.round(x - dirX / len);
  const cy = Math.round(y - dirY / len);
  if (cx === Math.round(x) && cy === Math.round(y)) return null;
  const b = buildingAt(world, cx, cy);
  if (!b || !b.built) return null;
  const def = defOf(b.kind);
  return def.solid && def.height <= SHOOT_OVER_HEIGHT ? b : null;
}

function moveProjectiles(world: World, rng: Rng): void {
  const keep: Projectile[] = [];
  for (const p of world.projectiles) {
    if (p.spent) continue;
    p.life--;
    if (p.life <= 0) continue;
    const steps = 3;
    let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      p.x += p.vx / steps;
      p.y += p.vy / steps;
      if (blocksSight(world, Math.round(p.x), Math.round(p.y))) {
        dead = true;
        break;
      }
      for (const q of world.pawns) {
        if (q.dead || q.id === p.ownerId) continue;
        if (!isHostileTo(p.faction, q.faction) && p.targetId !== q.id) continue;
        if (q.downed) continue;
        if (dist(p.x, p.y, q.x, q.y) < 0.42) {
          dead = true;
          const cover = coverAt(world, q.x, q.y, p.vx, p.vy);
          if (cover && rng.chance(COVER_DEFLECT)) {
            // The sandbag took it. Cover wears out, which is what stops a gate
            // from being permanent and keeps the steel bill coming.
            damageBuilding(world, cover.id, p.damage * 0.5);
            break;
          }
          damagePawn(world, q, p.damage, 'gunfire');
          break;
        }
      }
      if (dead) break;
      // Aimed at a machine rather than a person. Checked after the bodies, so
      // anybody standing between the shooter and the emplacement still catches
      // it — walking in front of the turret you are defending is a real mistake
      // and the sim should let you make it.
      if (p.targetBuildingId !== undefined) {
        const b = findBuilding(world, p.targetBuildingId);
        if (!b || !b.built) {
          p.targetBuildingId = undefined;
        } else if (Math.round(p.x) === b.x && Math.round(p.y) === b.y) {
          dead = true;
          damageBuilding(world, b.id, p.damage);
        }
      }
    }
    if (!dead) keep.push(p);
  }
  world.projectiles = keep;
}

/**
 * `needSight` restricts the search to enemies this pawn can actually see, with a
 * short grace distance for anything about to come round the corner. Reactive
 * self-defence needs it; deliberate hunting does not.
 */
function nearestEnemy(world: World, pawn: Pawn, maxRange = Infinity, needSight = false): Pawn | null {
  let best: Pawn | null = null;
  let bestD = maxRange;
  for (const q of world.pawns) {
    if (q.dead || q.downed || q.id === pawn.id) continue;
    if (!isHostileTo(pawn.faction, q.faction)) continue;
    const d = dist(pawn.x, pawn.y, q.x, q.y);
    if (d >= bestD) continue;
    if (needSight && d > 2.5 && !hasLineOfSight(world, pawn.x, pawn.y, q.x, q.y)) continue;
    best = q;
    bestD = d;
  }
  return best;
}

/** Shoot or swing at `target` if in range and visible. Returns true if it acted. */
/**
 * Skill gained by a settler for every round they actually fire.
 *
 * Mining, cooking, building, farming and doctoring all improve with use;
 * shooting was the one skill in the game frozen at whatever a settler rolled at
 * character creation. Raids escalate — the Ashbound reach shooting 7-10 by the
 * second week — so a colony whose defenders were stuck on 2-6 got relatively
 * weaker every week no matter how well it played, and the 30-day sweeps showed
 * exactly that: raid after raid won on the exchange with all five settlers left
 * unconscious on the ground afterwards. Veterans are the answer the escalation
 * curve is asking for.
 *
 * Roughly half a level per engagement, so a starting settler is a match for the
 * Ashbound by the end of the first month rather than in the first fortnight.
 */
const SHOOTING_PER_SHOT = 0.012;

/**
 * Only settlers keep what they learn. Raiders are issued their skill by the
 * storyteller's escalation curve and are gone within the day; letting them
 * practise would quietly bid the curve up past what it says it is.
 */
function practise(world: World, pawn: Pawn): void {
  if (pawn.faction !== 'colony') return;
  gainSkill(world, pawn, 'shooting', SHOOTING_PER_SHOT);
}

/**
 * What a shooter is worth on this shot: their own skill, plus whatever the
 * colony has worked out about barrels. Raiders get no share of it — the research
 * is the colony's, and a tech that made the people shooting at you better too
 * would be worth nothing.
 */
function marksmanship(world: World, pawn: Pawn): number {
  return (
    pawn.skills.shooting +
    aimBonus(pawn) +
    (pawn.faction === 'colony' ? riflingBonus(world) : 0)
  );
}

function attackIfAble(world: World, pawn: Pawn, target: Pawn, rng: Rng): boolean {
  const stats = WEAPONS[pawn.weapon];
  const d = dist(pawn.x, pawn.y, target.x, target.y);
  if (d > stats.range) return false;
  pawn.facing = Math.atan2(target.y - pawn.y, target.x - pawn.x);
  if (pawn.attackCooldown > 0) return true;
  if (stats.melee) {
    pawn.attackCooldown = stats.cooldown;
    practise(world, pawn);
    meleeSwing(world, pawn, rng);
    return true;
  }
  if (!hasLineOfSight(world, pawn.x, pawn.y, target.x, target.y)) return false;
  pawn.attackCooldown = stats.cooldown;
  practise(world, pawn);
  // Lead the target slightly so moving raiders are not free hits.
  const lead = d / (stats.speed * 20);
  const tx = target.x + Math.cos(target.facing) * lead * 0.1;
  const ty = target.y + Math.sin(target.facing) * lead * 0.1;
  fireWeapon(world, pawn, tx - pawn.x, ty - pawn.y, stats, rng, marksmanship(world, pawn));
  return true;
}

/** Raiders that have nothing left to fight walk off the map and despawn. */
const RETREAT_MARK = -999;

/**
 * Ticks a raider will stand there with no route to anybody and nothing to break
 * before it gives up and walks home. Without this a single raider wedged behind
 * a wall it cannot path around stays on the map forever, which keeps the raid
 * flag up and the colony at arms for the rest of the game.
 */
const RAIDER_GIVE_UP = 20 * 40;

/**
 * Ticks a raider with nothing to fight will spend failing to find a way off the
 * map before it despawns where it stands. Twice the give-up window, so a raider
 * genuinely walking home is never mistaken for a wedged one.
 */
const RETREAT_STUCK = RAIDER_GIVE_UP * 2;

function raiderAI(world: World, pawn: Pawn, rng: Rng): void {
  const givenUp = (pawn.frustration ?? 0) > RAIDER_GIVE_UP;
  const target = givenUp ? null : nearestEnemy(world, pawn);
  if (!target) {
    // Nobody left to reach, so nothing left worth breaking through to.
    pawn.breachId = undefined;
    pawn.activity = 'walking';
    if (!pawn.path) findEdgePath(world, pawn);
    if (pawn.path) {
      followPath(world, pawn, RUN_SPEED);
      if (atMapEdge(world, pawn)) pawn.orderX = RETREAT_MARK;
      return;
    }
    // Nothing to fight and no route home. This is the one that killed colonies:
    // nearestEnemy skips downed pawns, so once a raid had floored everybody the
    // raiders were done — but they stood in the yard forever, and every settler
    // who healed back to their feet was shot down again in the same tick. A
    // raider with nobody to shoot and nowhere to walk melts into the trees.
    pawn.frustration = (pawn.frustration ?? 0) + 1;
    if (pawn.frustration > RETREAT_STUCK) pawn.orderX = RETREAT_MARK;
    return;
  }

  // Frustration is measured on outcomes, not on intentions: a raider that
  // neither shot, nor hit a wall, nor covered ground this tick achieved nothing,
  // whatever branch it took. Counting it here rather than in one branch means no
  // geometry anybody builds later can park a raid on the map forever.
  const wasX = pawn.x;
  const wasY = pawn.y;
  const acted = raiderFight(world, pawn, target, rng);
  if (acted || dist(pawn.x, pawn.y, wasX, wasY) > 0.01) {
    pawn.frustration = 0;
    return;
  }
  pawn.frustration = (pawn.frustration ?? 0) + 1;
  if (pawn.frustration === RAIDER_GIVE_UP + 1) {
    msg(world, `${pawn.name} loses their nerve and turns back.`, 'good');
  }
}

/**
 * How far a raider will walk to get behind something. Short on purpose: this is
 * a soldier taking the nearest bit of hard cover, not one crossing the yard to
 * find the perfect firing position, and a wide search would read as a raid that
 * mills about instead of attacking.
 */
const COVER_SEARCH = 5;

/**
 * Cells of extra walking a raider will trade for one hit point of whatever is
 * in the way, before it stops going round and starts going through.
 *
 * A fence is three wood and seventy hit points, and until this a raid would walk
 * the entire length of one to get round it — which quietly made the cheapest
 * thing on the build bar into a wall the colony never had to pay for. The rule
 * is the arithmetic a person would do: is the way round worth more than the
 * timber? Priced against the structure's *current* health rather than by kind,
 * so nothing needs a special case and a wall somebody has already burned half
 * through is correctly the tempting one.
 *
 * Strict time parity: a raider walks 0.191 cells a tick at raiding pace and
 * takes roughly 1.7 ticks a hit point off a wall with a club, so one hit point
 * costs what 0.32 cells of walking costs. Above the line the way through is
 * genuinely faster; below it the raid is knocking a hole in something to arrive
 * later than it would have by walking.
 *
 * This shipped at 0.12 — a third of parity — on the reasoning that a raider
 * crossing open ground is a raider being shot at while it crosses, so the way
 * round should be discounted. That argument is the wrong way round. A raider
 * standing still swinging at a rail is also being shot at, for longer, and it is
 * not closing the distance while it happens. Under fire, moving beats stationary,
 * so if the constant leaves parity at all it should leave it upward.
 *
 * The grid said the same thing louder. At 0.12 a seventy-hit-point fence was
 * worth breaking to save eight cells of walking, which is nothing — so raids
 * stopped routing to the gate and started coming through the siding, and
 * settler/1312 went from 9 downs over sixty days to 86, two burials to eight,
 * and from never leaving anybody at zero to leaving somebody there for 47.6
 * hours. At parity the same colony reads 40 downs and one burial, with the worst
 * spell upright at zero back to 0.9 h. Four times the downs a free fence used to
 * cost, which is the difficulty this change was for; not a colony wrecked, which
 * was not.
 *
 * At 0.32 a fence is worth breaking to save twenty-two cells and a hut wall to
 * save forty-two — a rail thrown across the approach, not the ring round the goat
 * pen — and it leaves a walled compound with a gate doing what a walled compound
 * with a gate is for.
 */
const BREACH_CELLS_PER_HP = 0.32;

/**
 * Steps below which the way round is short enough not to be worth pricing.
 * Three cells round the end of a rail is not a siege.
 */
const BREACH_MIN_STEPS = 10;

/** Close enough to get at it. Breaking a fence means being at the fence. */
const BREACH_REACH = 1.8;

/**
 * The first thing on the straight line to the goal that a raider cannot walk
 * through, when that thing is a building.
 *
 * Walks the line rather than searching a radius, because the thing worth
 * breaking is the thing in the way — a fence two cells off the approach is
 * somebody else's problem. Terrain ends the walk with nothing: a line stopped
 * by rock stays stopped whatever gets knocked down behind it, and a raider that
 * chewed a fence to reach a cliff would be a raider making the player's point
 * for them.
 */
function breachTarget(world: World, pawn: Pawn, gx: number, gy: number): Building | null {
  const dx = gx - pawn.x;
  const dy = gy - pawn.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const steps = Math.ceil(len);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(pawn.x + dx * t);
    const cy = Math.round(pawn.y + dy * t);
    if (isWalkable(world, cx, cy)) continue;
    const b = buildingAt(world, cx, cy);
    return b && b.built ? b : null;
  }
  return null;
}

/**
 * Whether this raider should stop going round and go through, and what through.
 *
 * `detour` is the length of the route it just planned, so the comparison costs
 * nothing — the expensive half of the question was already answered by the path
 * search that had to run anyway.
 */
function worthBreaching(
  world: World,
  pawn: Pawn,
  gx: number,
  gy: number,
  detour: number,
): Building | null {
  if (detour < BREACH_MIN_STEPS) return null;
  const wall = breachTarget(world, pawn, gx, gy);
  if (!wall) return null;
  // What the way round actually costs is the walking it adds over the line the
  // obstacle is standing on, which is the straight-line distance — the route
  // through would still have to cover that.
  const extra = detour - dist(pawn.x, pawn.y, gx, gy);
  return extra > wall.hp * BREACH_CELLS_PER_HP ? wall : null;
}

/**
 * How often a raider re-reads the ground for a better place to stand, in ticks.
 * The same cadence they re-path on — a firefight that re-plans every tick both
 * costs more than it is worth and reads as twitching.
 */
const RETHINK = 24;

/**
 * The live turret that can see this raider, nearest first.
 *
 * Only powered ones. An unpowered turret is a steel box that happens to be hard
 * cover, and a raider who stops to demolish it is a raider the brownout just
 * bought the colony ten free seconds from — which is backwards. The rule is the
 * one a person would use: answer the gun that is firing at you.
 */
function liveTurretThreat(world: World, pawn: Pawn): Building | null {
  let best: Building | null = null;
  let bestD = TURRET_STATS.range;
  for (const b of world.buildings) {
    if (b.kind !== 'turret' || !b.built || b.powered !== true) continue;
    const d = dist(pawn.x, pawn.y, b.x, b.y);
    if (d >= bestD) continue;
    if (!hasLineOfSight(world, pawn.x, pawn.y, b.x, b.y)) continue;
    best = b;
    bestD = d;
  }
  return best;
}

/**
 * Swing at or shoot a building. Same shape as `attackIfAble`, and deliberately
 * the same weapon table: a raider does not get a special turret-breaking attack,
 * they just point what they are holding at the machine instead of at the cook.
 */
function attackBuilding(world: World, pawn: Pawn, b: Building, rng: Rng): boolean {
  const stats = WEAPONS[pawn.weapon];
  const d = dist(pawn.x, pawn.y, b.x, b.y);
  if (d > stats.range + 0.5) return false;
  pawn.facing = Math.atan2(b.y - pawn.y, b.x - pawn.x);
  if (pawn.attackCooldown > 0) return true;
  if (stats.melee) {
    pawn.attackCooldown = stats.cooldown;
    damageBuilding(world, b.id, stats.damage * rng.range(0.8, 1.25));
    return true;
  }
  if (!hasLineOfSight(world, pawn.x, pawn.y, b.x, b.y)) return false;
  pawn.attackCooldown = stats.cooldown;
  const shot = fireWeapon(world, pawn, b.x - pawn.x, b.y - pawn.y, stats, rng, marksmanship(world, pawn));
  shot.targetBuildingId = b.id;
  return true;
}

/**
 * The nearest cell within `COVER_SEARCH` that still has a shot at `(tx, ty)` and
 * has something solid between it and them.
 *
 * The cheap tests run first — walkable, in range, has cover — because the line
 * of sight check is the expensive one and almost every cell fails before it.
 */
function findCoverCell(
  world: World,
  pawn: Pawn,
  tx: number,
  ty: number,
  stats: WeaponStats,
): { x: number; y: number } | null {
  const px = Math.round(pawn.x);
  const py = Math.round(pawn.y);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let dy = -COVER_SEARCH; dy <= COVER_SEARCH; dy++) {
    for (let dx = -COVER_SEARCH; dx <= COVER_SEARCH; dx++) {
      const cx = px + dx;
      const cy = py + dy;
      if (!isWalkable(world, cx, cy)) continue;
      const away = dist(cx, cy, tx, ty);
      // Still a firing position: inside the weapon's reach, and not so close that
      // "taking cover" means walking into the muzzle.
      if (away > stats.range * 0.9 || away < 2) continue;
      const step = dx * dx + dy * dy;
      if (step >= bestD) continue;
      // Direction *of the incoming fire* — from them to here, not from here to
      // them. `coverAt` walks one step back up the bullet's path, so handing it
      // the outgoing direction finds the cell on the wrong side of the shooter.
      if (!coverAt(world, cx, cy, cx - tx, cy - ty)) continue;
      if (!hasLineOfSight(world, cx, cy, tx, ty)) continue;
      best = { x: cx, y: cy };
      bestD = step;
    }
  }
  return best;
}

/** Shoot, take cover, close in, or chew the wall in the way. True if it did any of those. */
function raiderFight(world: World, pawn: Pawn, target: Pawn, rng: Rng): boolean {
  pawn.activity = 'fighting';
  const stats = WEAPONS[pawn.weapon];

  // Whatever is nearest is what is in front of them. Before this a raider would
  // walk past a live turret to get at a cook, which made one turret win every
  // raid on its own and made the 30-steel emplacement the only build that
  // mattered. A raider now answers the gun when the gun is the closer problem.
  const turret = liveTurretThreat(world, pawn);
  const dPawn = dist(pawn.x, pawn.y, target.x, target.y);
  const dTurret = turret ? dist(pawn.x, pawn.y, turret.x, turret.y) : Infinity;
  const onTurret = turret !== null && dTurret < dPawn;
  const goalX = onTurret ? turret!.x : target.x;
  const goalY = onTurret ? turret!.y : target.y;
  const d = onTurret ? dTurret : dPawn;

  const shot = onTurret
    ? attackBuilding(world, pawn, turret!, rng)
    : attackIfAble(world, pawn, target, rng);

  // Shooters hold ground once comfortably in range; brawlers always close.
  if (shot && !stats.melee && d < stats.range * 0.55) {
    // ...but standing in the open at 55% of rifle range is how a raid used to
    // lose to two settlers behind sandbags without ever touching them. If there
    // is something solid within a few paces, they get behind it and shoot from
    // there. Nothing within reach means the old behaviour: stand and trade.
    if (coverAt(world, pawn.x, pawn.y, pawn.x - goalX, pawn.y - goalY)) {
      pawn.path = null;
      return true;
    }
    if (!pawn.path || world.tick % RETHINK === 0) {
      const cell = findCoverCell(world, pawn, goalX, goalY, stats);
      pawn.path = cell
        ? findPath(world, Math.round(pawn.x), Math.round(pawn.y), cell.x, cell.y, { maxExpansions: 900 })
        : null;
    }
    if (pawn.path) followPath(world, pawn, RUN_SPEED * 0.85);
    return true;
  }
  // A search that finds nothing leaves `path` null, which reads to the line
  // below as "this raider has not looked yet" — so it looks again on the very
  // next tick, and the next, four thousand cells at a time, for the whole raid.
  // The colony that triggers it is the one with its wall finished, which is to
  // say the better the player builds the more the fight costs. A failed search
  // is a thought, and thoughts happen on the rethink cadence like everything
  // else here.
  const gaveUpRecently =
    pawn.pathFailedAt !== undefined && world.tick - pawn.pathFailedAt < RETHINK;
  if ((!pawn.path && !gaveUpRecently) || world.tick % RETHINK === 0) {
    // A turret's own cell is solid, so a plain path *to* it can never succeed —
    // walk to the ring around it and let the weapon reach the last cell.
    const p = onTurret
      ? findPathAdjacent(world, Math.round(pawn.x), Math.round(pawn.y), goalX, goalY)
      : findPath(world, Math.round(pawn.x), Math.round(pawn.y), Math.round(goalX), Math.round(goalY), {
          maxExpansions: 4000,
        });
    if (p) {
      pawn.path = p;
      pawn.pathFailedAt = undefined;
      // The way round is now measured, so this is the one moment the raider can
      // honestly compare it to the way through. Committing rewrites the path to
      // end at the obstacle's doorstep instead of at the colonist's.
      const wall = worthBreaching(world, pawn, goalX, goalY, p.length);
      if (wall) {
        pawn.breachId = wall.id;
        pawn.path =
          findPathAdjacent(world, Math.round(pawn.x), Math.round(pawn.y), wall.x, wall.y) ?? p;
      }
    } else {
      pawn.pathFailedAt = world.tick;
      // No way round at all is the strongest case there is for going through.
      // The fallback further down only ever swung at whatever happened to be
      // under the raider's nose, so a settler fenced in on the far side of the
      // yard was one the raid could not reach and never tried to: it stood in
      // the open field facing them until its nerve went. Now it walks to the
      // rail and takes it down.
      const wall = breachTarget(world, pawn, goalX, goalY);
      if (wall) {
        pawn.breachId = wall.id;
        pawn.path = findPathAdjacent(world, Math.round(pawn.x), Math.round(pawn.y), wall.x, wall.y);
      }
    }
  }
  // Committed: swing the moment it is in reach, and walk the path laid to its
  // doorstep until then. When it falls the id stops resolving and the raider goes
  // back to walking — now through the hole it made.
  if (pawn.breachId !== undefined) {
    const wall = findBuilding(world, pawn.breachId);
    if (!wall || !wall.built) pawn.breachId = undefined;
    else if (dist(pawn.x, pawn.y, wall.x, wall.y) <= BREACH_REACH) {
      if (attackBuilding(world, pawn, wall, rng)) return true;
    }
  }
  if (pawn.path) {
    followPath(world, pawn, RUN_SPEED * 0.85);
    return shot;
  }
  // No route to the colonists — chew through whatever is in the way.
  const bx = Math.round(pawn.x + Math.cos(pawn.facing));
  const by = Math.round(pawn.y + Math.sin(pawn.facing));
  const b = world.buildings.find((q) => q.x === bx && q.y === by && q.built);
  if (b) {
    if (pawn.attackCooldown <= 0) {
      pawn.attackCooldown = 20;
      damageBuilding(world, b.id, 12);
    }
    return true;
  }
  return shot;
}

/**
 * Route to whichever map edge is actually reachable.
 *
 * The old version aimed at one hard-coded column, which is fine until worldgen
 * fences that side in rock: seed 99001 leaves zero walkable cells in column 1,
 * so every retreat path search failed and the raid became scenery. Every
 * walkable cell in the border ring is a goal now, on all four sides.
 */
function findEdgePath(world: World, pawn: Pawn): void {
  const goals = new Set<number>();
  for (let y = 1; y < world.height - 1; y++) {
    if (isWalkable(world, 1, y)) goals.add(y * world.width + 1);
    if (isWalkable(world, world.width - 2, y)) goals.add(y * world.width + world.width - 2);
  }
  for (let x = 1; x < world.width - 1; x++) {
    if (isWalkable(world, x, 1)) goals.add(world.width + x);
    if (isWalkable(world, x, world.height - 2)) goals.add((world.height - 2) * world.width + x);
  }
  if (goals.size === 0) return;
  // Goal set, so the target cell only steers the heuristic; the pawn's own
  // position makes it behave as a plain nearest-goal search.
  const p = findPath(world, Math.round(pawn.x), Math.round(pawn.y), Math.round(pawn.x), Math.round(pawn.y), {
    goals,
  });
  if (p) pawn.path = p;
}

/** Close enough to the border to count as off the map. */
function atMapEdge(world: World, pawn: Pawn): boolean {
  return pawn.x < 2.5 || pawn.y < 2.5 || pawn.x > world.width - 3.5 || pawn.y > world.height - 3.5;
}

function draftedColonist(world: World, pawn: Pawn, rng: Rng): void {
  const target = nearestEnemy(world, pawn, WEAPONS[pawn.weapon].range + 3);
  if (pawn.orderX !== null && pawn.orderY !== null) {
    if (!pawn.path) {
      const ok = findPath(world, Math.round(pawn.x), Math.round(pawn.y), pawn.orderX, pawn.orderY);
      if (ok) pawn.path = ok;
      else {
        pawn.orderX = null;
        pawn.orderY = null;
      }
    }
    if (pawn.path) {
      pawn.activity = 'walking';
      const arrived = followPath(world, pawn, RUN_SPEED);
      if (arrived) {
        pawn.orderX = null;
        pawn.orderY = null;
      }
      // A drafted settler still shoots while repositioning.
      if (target) attackIfAble(world, pawn, target, rng);
      return;
    }
  }
  if (target) {
    pawn.activity = 'fighting';
    attackIfAble(world, pawn, target, rng);
  } else {
    pawn.activity = 'idle';
  }
}

/**
 * Undrafted settlers react to hostiles on their own: an armed one gives ground
 * while returning fire — backing to hard cover if any is within a few cells —
 * and an unarmed one just runs. Drafting is still how you win
 * a fight — it is what lets you pick the ground and focus fire — but a colony
 * left alone defends itself instead of being executed where it stands.
 * Returns true if the settler is busy with the threat this tick.
 */
function defendSelf(world: World, pawn: Pawn, rng: Rng): boolean {
  // Nothing outside is worth starving over. A settler at empty goes to the
  // pantry even with a raider in the yard, because standing at arms through a
  // stalemate they cannot break is the one way to lose the colony to a fight
  // nobody was losing.
  if (pawn.needs.food <= 0) return false;
  const stats = WEAPONS[pawn.weapon];
  // Only what they can see. A hostile behind a wall is the wall's problem, and
  // reacting to one through solid rock froze whole colonies at arms.
  const threat = nearestEnemy(world, pawn, Math.max(9, stats.range), true);
  if (!threat) return false;
  if (pawn.activity === 'sleeping') pawn.activity = 'idle';
  if (pawn.jobId !== null) cancelJob(world, pawn.jobId);

  const d = dist(pawn.x, pawn.y, threat.x, threat.y);
  const armed = pawn.weapon !== 'none';
  const fought = armed ? attackIfAble(world, pawn, threat, rng) : false;
  if (fought) pawn.activity = 'fighting';

  // Back off when the threat is inside comfortable range — or always, if unarmed.
  const holdAt = armed ? (stats.melee ? 1.3 : 4.5) : Infinity;
  if (d < holdAt) {
    const step = RUN_SPEED * (fought ? 0.55 : 0.9);
    // Giving ground *to* something beats giving ground in a straight line: the
    // steps cost the same and half the incoming fire stops at the sandbag. Only
    // for a settler with a gun — one with nothing to shoot back with should be
    // leaving the fight, not settling in three cells from it. Re-picked every
    // RETHINK ticks rather than every tick, because the scan is an 11x11 sweep
    // with a line-of-sight test per cell and a settler who changes their mind
    // every tick never actually reaches anywhere.
    const canHide = armed && !stats.melee;
    if (canHide && coverAt(world, pawn.x, pawn.y, pawn.x - threat.x, pawn.y - threat.y)) {
      pawn.path = null;
      pawn.facing = Math.atan2(threat.y - pawn.y, threat.x - pawn.x);
      if (!fought) pawn.activity = 'idle';
      return true;
    }
    if (canHide && (!pawn.path || world.tick % RETHINK === 0)) {
      const cell = findCoverCell(world, pawn, threat.x, threat.y, stats);
      pawn.path = cell
        ? findPath(world, Math.round(pawn.x), Math.round(pawn.y), cell.x, cell.y, { maxExpansions: 900 })
        : null;
    }
    if (pawn.path) {
      followPath(world, pawn, step);
      if (!fought) pawn.activity = 'walking';
      return true;
    }
    const ang = Math.atan2(pawn.y - threat.y, pawn.x - threat.x);
    moveWithCollision(world, pawn, Math.cos(ang) * step, Math.sin(ang) * step);
    if (!fought) {
      pawn.facing = ang;
      pawn.activity = 'walking';
    }
  } else if (!fought) {
    pawn.activity = 'idle';
    pawn.facing = Math.atan2(threat.y - pawn.y, threat.x - pawn.x);
  }
  return true;
}

function tickTurrets(world: World, rng: Rng): void {
  for (const b of world.buildings) {
    // An unpowered turret is a steel box. It still soaks bullets and still gives
    // cover, which is why it is worth deconstructing rather than leaving — but it
    // does not shoot, and the whole point of a brownout is that you find that out
    // from the log rather than from the raiders.
    if (b.kind !== 'turret' || !b.built || b.powered !== true) continue;
    b.cooldown = Math.max(0, (b.cooldown ?? 0) - 1);
    let target: Pawn | null = null;
    let bestD = TURRET_STATS.range;
    for (const q of world.pawns) {
      if (q.dead || q.downed || q.faction === 'colony' || q.faction === 'fauna') continue;
      const d = dist(b.x, b.y, q.x, q.y);
      if (d < bestD && hasLineOfSight(world, b.x, b.y, q.x, q.y)) {
        target = q;
        bestD = d;
      }
    }
    if (!target || (b.cooldown ?? 0) > 0) continue;
    b.cooldown = Math.round(TURRET_STATS.cooldown * turretCooldownScale(world));
    fireWeapon(
      world,
      { id: -b.id, faction: 'colony', x: b.x, y: b.y },
      target.x - b.x,
      target.y - b.y,
      TURRET_STATS,
      rng,
      6,
    );
  }
}

/**
 * Combat pass. Returns nothing; mutates the world. Called once per sim tick
 * before job execution so a settler under fire reacts this tick, not next.
 * `playerPawnId` is skipped for movement (the player drives that body) but still
 * fights, bleeds and dies like any other.
 */
export function tickCombat(world: World, rng: Rng, playerPawnId: number | null): void {
  moveProjectiles(world, rng);
  tickTurrets(world, rng);

  for (const pawn of world.pawns) {
    if (pawn.dead) continue;
    pawn.attackCooldown = Math.max(0, pawn.attackCooldown - 1);
    if (pawn.downed) {
      if (pawn.bleed > 0) {
        pawn.bleed--;
        const interval = pawn.faction === 'colony' ? BLEED_INTERVAL_COLONY : BLEED_INTERVAL_HOSTILE;
        if (pawn.bleed % interval === 0) damagePawn(world, pawn, 1, 'blood loss');
        continue;
      }
      // Stopped bleeding and healed enough: get back up, doctor or no doctor.
      // Unless a fever is what put them there — closed skin is not a broken
      // fever, and standing a septic settler up would undo the illness pass.
      if (pawn.hp > pawn.maxHp * 0.35 && !tooIllToStand(pawn)) {
        pawn.downed = false;
        pawn.activity = 'idle';
        if (pawn.faction === 'colony') msg(world, `${pawn.name} gets back on their feet.`, 'good');
      }
      continue;
    }
    // Grazing animals are driven by the wildlife pass and the caravan by the
    // trade pass, not by an AI that looks for something to kill.
    // A prisoner is driven by the prison pass and has no AI whatsoever; without
    // this line the first one to get back on their feet would run `raiderAI` and
    // go looking for a settler to punch, from inside the colony.
    if (pawn.faction === 'fauna' || pawn.faction === 'trader' || pawn.faction === 'prisoner') continue;
    if (pawn.faction !== 'colony') {
      raiderAI(world, pawn, rng);
      continue;
    }
    if (pawn.id === playerPawnId) {
      // The player's own body: aiming and firing come from input, not AI.
      continue;
    }
    if (pawn.drafted) {
      draftedColonist(world, pawn, rng);
      continue;
    }
    if (defendSelf(world, pawn, rng)) continue;
  }

  // Retreating raiders that reached the map edge leave the world entirely.
  if (world.pawns.some((p) => p.orderX === RETREAT_MARK)) {
    world.pawns = world.pawns.filter((p) => p.orderX !== RETREAT_MARK);
  }
}

/**
 * A predator's teeth, resolved after every animal has finished moving.
 *
 * It lives here rather than in the wildlife pass for one structural reason and
 * one design one. Structural: `combat.ts` imports `wildlife.ts` for `FLEE_TICKS`,
 * so wildlife can never import back, and `damagePawn` is the only door in the
 * codebase that a body may lose hit points through — armour, bleeding, the death
 * bookkeeping and the carcass hand-off are all behind it. Design: a bite decided
 * mid-movement would be decided from a position half the herd had not caught up
 * to yet, so a mossback could be bitten from a cell it had already left.
 *
 * A kill is `feast`, not a corpse: the wildlife pass sees `eaten` next tick and
 * clears the body without leaving meat, which is what stops a pack in the yard
 * from being a windfall.
 */
export function tickMaulings(world: World): void {
  for (const hunter of hunters(world)) {
    if (hunter.migrateTo) continue;
    const prey = preyFor(world, hunter);
    if (!prey) continue;
    if (!biteReady(world, hunter, prey)) continue;
    damagePawn(world, prey, BITE_DAMAGE, `${hunter.name}`);
    if (prey.dead) feast(world, hunter, prey);
  }
}
