/**
 * Losing a fight has to be a setback, not the end of the run.
 *
 * Every rule here was written against a measured wipe. The 30-day eval sweeps
 * killed three colonies in five, and the traces showed the same shape every
 * time: a raid floors the colony, and then nothing ever changes again — the
 * raiders had nobody left to shoot but no way off the map either, so they stood
 * in the yard and re-downed each settler on the tick it stood up, until the last
 * one starved on the floor. These tests pin the three rules that turned that
 * into a recoverable bad day.
 */

import { describe, expect, it } from 'vitest';

import { damagePawn, meleeSwing } from '../src/sim/combat';
import { escalation, spawnRaid, tickStoryteller } from '../src/sim/events';
import { isWalkable } from '../src/sim/grid';
import { DRAFT_BREAKS_OFF } from '../src/sim/needs';
import { makePawn } from '../src/sim/pawn';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { TERRAIN_LIST, TICKS_PER_DAY, packCell, type Pawn, type World } from '../src/sim/types';
import { hostiles, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

/**
 * Seed 99001 is the regression seed: worldgen fences its west edge in solid
 * rock, which is what exposed the retreat bug. Retreat used to path at one
 * hard-coded column, and on this map that column has zero walkable cells.
 */
const FENCED_SEED = 99001;

function game(seed: number) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

/** Put a pawn on the floor the way a firefight would. */
function floor(world: World, p: Pawn): void {
  damagePawn(world, p, p.hp - p.maxHp * 0.1, 'test');
  expect(p.downed).toBe(true);
}

describe('the fallen', () => {
  it('are not finished off by melee', () => {
    const { world } = game(11);
    const victim = livingColonists(world)[0]!;
    floor(world, victim);
    const hp = victim.hp;

    const rng = new Rng(3);
    const raider = spawnRaid(world, rng, 1)[0]!;
    raider.x = victim.x + 0.5;
    raider.y = victim.y;
    raider.weapon = 'club';
    for (let i = 0; i < 200; i++) {
      raider.attackCooldown = 0;
      meleeSwing(world, raider, rng);
    }
    // Gunfire and target selection already skipped downed pawns; melee did not,
    // so a raider walking over a body clubbed it to death in the same tick it
    // fell. One lost fight must not equal one settler lost forever.
    expect(victim.hp).toBe(hp);
    expect(victim.dead).toBe(false);
  });

  it('mend on the floor and get back up', () => {
    const { world, streams } = game(FENCED_SEED);
    for (const p of livingColonists(world)) floor(world, p);
    stepWorldN(world, streams, Math.round(TICKS_PER_DAY * 1.5));
    expect(world.gameOver).toBe(false);
    expect(livingColonists(world).some((p) => !p.downed)).toBe(true);
  });
});

describe('raiders with nothing left to fight', () => {
  it('leave a map whose nearest edge is walled in rock', () => {
    const { world, streams } = game(FENCED_SEED);
    // The bug needed exactly this geometry to show itself: a raider whose nearest
    // way off the map is solid rock, who used to stand at it forever. The seed
    // used to happen to produce it, which meant the regression test quietly
    // stopped testing the regression the first time the map changed size. Wall
    // the column deliberately instead — it is the geometry that matters, not the
    // luck that once supplied it.
    for (let y = 1; y < world.height - 1; y++) {
      world.terrain[packCell(world, 1, y)] = TERRAIN_LIST.indexOf('rock');
    }
    let walkableWest = 0;
    for (let y = 1; y < world.height - 1; y++) if (isWalkable(world, 1, y)) walkableWest++;
    expect(walkableWest).toBe(0);

    const band = spawnRaid(world, new Rng(5), 3).map((p) => p.id);
    expect(band.length).toBe(3);
    for (const p of livingColonists(world)) floor(world, p);

    // Long enough to walk off the map from anywhere, short enough that the next
    // storyteller beat (1.5 days at the earliest) cannot muddy the reading.
    stepWorldN(world, streams, Math.round(TICKS_PER_DAY * 1.2));
    const left = world.pawns.filter((p) => band.includes(p.id) && !p.dead);
    expect(left).toEqual([]);
  });
});

describe('settlers wandering in', () => {
  const rng = new Rng(2);

  it('joins a shorthanded colony', () => {
    const { world } = game(31);
    const before = livingColonists(world).length;
    world.storyteller.nextArrival = 1;
    tickStoryteller(world, rng);
    expect(livingColonists(world).length).toBe(before + 1);
    // And the clock is pushed out, so the trees do not keep producing people.
    expect(world.storyteller.nextArrival).toBeGreaterThan(TICKS_PER_DAY);
  });

  it('does not walk into a firefight', () => {
    const { world } = game(31);
    spawnRaid(world, rng, 2);
    const before = livingColonists(world).length;
    world.storyteller.nextArrival = 1;
    tickStoryteller(world, rng);
    expect(livingColonists(world).length).toBe(before);
    expect(hostiles(world).length).toBeGreaterThan(0);
  });

  it('stops once the colony is no longer shorthanded', () => {
    const { world } = game(31);
    // Fill up to the cap the honest way: arrivals, one beat at a time.
    for (let i = 0; i < 12; i++) {
      world.storyteller.nextArrival = 1;
      tickStoryteller(world, rng);
    }
    expect(livingColonists(world).length).toBeLessThanOrEqual(5);
  });
});

describe('a draft the player forgot about', () => {
  it('breaks off to eat before starvation starts taking hit points', () => {
    const { world, streams } = game(31);
    const p = livingColonists(world)[0]!;
    p.drafted = true;
    p.orderX = Math.round(p.x);
    p.orderY = Math.round(p.y);
    // On the release point, so the very next drain crosses it.
    p.needs.food = DRAFT_BREAKS_OFF;
    const hp = p.hp;

    stepWorldN(world, streams, 2);

    expect(p.drafted).toBe(false);
    // The margin is the whole point: they are let go with food still in hand,
    // so the walk to the pantry costs time rather than health.
    expect(p.needs.food).toBeGreaterThan(0);
    expect(p.hp).toBe(hp);
    expect(world.messages.some((m) => m.text.includes('too hungry to hold the line'))).toBe(true);
  });

  it('holds the line while merely hungry', () => {
    const { world, streams } = game(31);
    const p = livingColonists(world)[0]!;
    p.drafted = true;
    p.orderX = Math.round(p.x);
    p.orderY = Math.round(p.y);
    p.needs.food = 0.3;
    stepWorldN(world, streams, 20);
    expect(p.drafted).toBe(true);
  });
});

describe('a lost fight, as a player lives it', () => {
  // The whole colony floored by a raid on the fenced map — the exact state that
  // used to read "wiped out on day 15" in the eval report.
  const { world, streams } = game(FENCED_SEED);
  const names = livingColonists(world).map((p) => p.name);
  spawnRaid(world, new Rng(9), 3);
  for (const p of livingColonists(world)) floor(world, p);
  stepWorldN(world, streams, TICKS_PER_DAY * 3);

  it('leaves the colony alive', () => {
    expect(world.gameOver).toBe(false);
    expect(livingColonists(world).length).toBeGreaterThan(0);
  });

  it('gets everyone back on their feet and fed', () => {
    const survivors = livingColonists(world);
    expect(survivors.every((p) => !p.downed)).toBe(true);
    expect(survivors.every((p) => p.needs.food > 0.1)).toBe(true);
    // Nobody was quietly replaced: these are the settlers who went down.
    expect(survivors.some((p) => names.includes(p.name))).toBe(true);
  });
});

describe('a lost fight nobody was left standing after', () => {
  // The spiral the thirty-day evals kept dying to, and the reason the rule that
  // wounds only close on a full stomach does not apply to the unconscious: every
  // settler on the floor with an empty stomach, so there is nobody to carry a
  // meal to anybody. Healing used to stop dead here and the colony lost one
  // settler a day to a timer with no decision in it.
  //
  // Asked of six colonies rather than one, and that is a scar. It ran on a single
  // seed for as long as a seed meant a fixed valley. Growing the map re-rolled
  // every one of them — the terrain is drawn from the same stream the settlers
  // are, so a wider map is a different draw by construction — and 99001 came out
  // one of the harder ones, keeping one settler of three instead of two. The test
  // had been reading "the colony recovers" and was actually measuring "this
  // colony recovered", which is a claim one bad map is entitled to falsify.
  //
  // So the claim is made at the size it is true at: no colony may be wiped, and
  // across the sample more than half the people who went down are still alive.
  const SEEDS = [99001, 11, 20, 21, 23, 42];
  const runs = SEEDS.map((seed) => {
    const { world, streams } = game(seed);
    for (const p of livingColonists(world)) {
      floor(world, p);
      p.needs.food = 0;
    }
    const fell = livingColonists(world).length;
    stepWorldN(world, streams, TICKS_PER_DAY * 2);
    return { seed, world, fell, live: livingColonists(world) };
  });

  it('has somebody up and about within two days', () => {
    for (const r of runs) {
      const up = r.live.filter((p) => !p.downed);
      expect(up.length, `seed ${r.seed}: nobody ever got off the floor`).toBeGreaterThan(0);
    }
  });

  it('does not bury the colony on the way there', () => {
    for (const r of runs) {
      expect(r.world.gameOver, `seed ${r.seed} was wiped out`).toBe(false);
      expect(r.live.length, `seed ${r.seed} lost everybody`).toBeGreaterThan(0);
    }
    // Some are still lost — a starving colony on the floor is supposed to be dire,
    // and on a hard map one of three walking away is what dire looks like. What it
    // must not be, taken over a spread of maps, is a wipe with nothing the player
    // could have done.
    const fell = runs.reduce((n, r) => n + r.fell, 0);
    const alive = runs.reduce((n, r) => n + r.live.length, 0);
    expect(alive).toBeGreaterThan(fell / 2);
  });

  it('still lets hunger kill somebody who is up and cannot find food', () => {
    // The rule is narrow on purpose: it is the unconscious who mend regardless,
    // because they have no way to go and eat. Anyone on their feet starves as
    // they always did.
    const { world: w, streams: s } = game(FENCED_SEED);
    w.items.length = 0;
    // The moor as well as the pantry. Emptying `items` used to be the whole of
    // "there is no food anywhere", and it stopped being true the day brambles
    // went in: a settler with an empty larder now walks out and picks two raw
    // food off a bush, which is the feature working and this test's premise
    // gone. What is being pinned here is what happens to a colonist who cannot
    // find food, so the map has to actually be bare.
    w.bushes = [];
    const pawn = livingColonists(w)[0]!;
    for (const p of livingColonists(w)) p.needs.food = 0;
    const before = pawn.hp;
    stepWorldN(w, s, TICKS_PER_DAY);
    expect(pawn.hp).toBeLessThan(before);
  });
});

/**
 * The other half of balance: a game that stops getting harder.
 *
 * Every number in the storyteller is a function of how many beats have fired.
 * The band tops out at six and the raider stat line tops out with it, both at
 * beat ten — measured, that is somewhere around day twenty. A colony still
 * standing on day ninety has stone walls, four turrets, a rifle in every hand
 * and twice the settlers, and meets exactly what it met seventy days earlier.
 *
 * `storyteller.unbloodied` is the one thing here that looks at the colony rather
 * than the clock. Win a fight with nobody on the grass and it goes up; let
 * somebody hit the ground and it goes back to nothing.
 */
describe('the Ashbound learning from a colony that never bleeds', () => {
  /** A world with the beat clock parked, so only the fights staged here happen. */
  function quiet(seed = 5): { world: World; rng: Rng } {
    const world = createWorld(seed);
    world.storyteller.nextThreat = 10_000;
    return { world, rng: new Rng(404) };
  }

  /**
   * Stage a whole fight, start to finish, through the same door the sim uses.
   *
   * Nothing here reaches into the streak: `spawnRaid` raises the flag, the first
   * tick marks the fight, `during` is whatever the raid did to the colony, and
   * the last tick finds nothing standing and settles up. If the accounting were
   * moved to a fourth call site tomorrow, these tests would still be watching it.
   */
  function fight(world: World, rng: Rng, during: () => void = () => {}): void {
    world.storyteller.nextThreat = 10_000;
    spawnRaid(world, rng, 1);
    tickStoryteller(world, rng);
    during();
    tickStoryteller(world, rng);
    for (const p of world.pawns) if (p.faction === 'raider') p.dead = true;
    tickStoryteller(world, rng);
  }

  it('has learned nothing from a colony that has not been tested', () => {
    const { world } = quiet();
    expect(escalation(world)).toBe(0);
  });

  it('wants three clean fights before it changes its mind about anything', () => {
    const { world, rng } = quiet();
    fight(world, rng);
    fight(world, rng);
    // Twice is luck. The whole point of the constant is that one good day at the
    // doorway does not rewrite what the colony is up against.
    expect(escalation(world)).toBe(0);
    fight(world, rng);
    expect(escalation(world)).toBe(1);
  });

  it('forgets the entire streak the moment a settler hits the ground', () => {
    const { world, rng } = quiet();
    fight(world, rng);
    fight(world, rng);
    fight(world, rng);
    expect(escalation(world)).toBe(1);
    const hurt = livingColonists(world)[0]!;
    fight(world, rng, () => floor(world, hurt));
    hurt.downed = false;
    // Not decremented — reset. A colony that is taking casualties is not a colony
    // the game should be leaning on, and the difference between "one rung down"
    // and "back to the start" is the difference between a bad week you claw back
    // from and a bad week that ends the run.
    expect(escalation(world)).toBe(0);
    fight(world, rng);
    fight(world, rng);
    expect(escalation(world)).toBe(0);
  });

  it('counts a settler killed outright, who never passes through downed', () => {
    const { world, rng } = quiet();
    fight(world, rng);
    fight(world, rng);
    fight(world, rng);
    expect(escalation(world)).toBe(1);
    // Straight from standing to dead: the `downed` latch never fires, and reading
    // it alone would score a funeral as an untouched afternoon.
    fight(world, rng, () => {
      const gone = livingColonists(world)[0]!;
      gone.dead = true;
      world.stats.colonistsLost++;
    });
    expect(escalation(world)).toBe(0);
  });

  it('stops climbing rather than escalating forever', () => {
    const { world, rng } = quiet();
    for (let i = 0; i < 40; i++) fight(world, rng);
    const top = escalation(world);
    for (let i = 0; i < 40; i++) fight(world, rng);
    expect(escalation(world)).toBe(top);
    expect(top).toBe(4);
  });

  it('reads a save that never heard of the streak as a colony nobody has tested', () => {
    const { world, rng } = quiet();
    fight(world, rng);
    fight(world, rng);
    fight(world, rng);
    expect(escalation(world)).toBe(1);
    // What a save written before any of this shipped deserializes to.
    delete world.storyteller.unbloodied;
    expect(escalation(world)).toBe(0);
  });

  it('says so on the way up, and says nothing on the way down', () => {
    const { world, rng } = quiet();
    const threats = (): number =>
      world.messages.filter((m) => m.kind === 'threat' && m.text.includes('Ashbound have')).length;
    fight(world, rng);
    fight(world, rng);
    expect(threats()).toBe(0);
    fight(world, rng);
    // A difficulty curve the player cannot see is one they experience as the game
    // cheating. Every rung announces itself, on the rung it happens.
    expect(threats()).toBe(1);
    fight(world, rng);
    expect(threats()).toBe(1);
    const hurt = livingColonists(world)[0]!;
    fight(world, rng, () => floor(world, hurt));
    hurt.downed = false;
    // Losing somebody is already the worst thing on the screen. "And the raiders
    // have eased off" underneath it reads as the game consoling the player.
    expect(threats()).toBe(1);
  });

  it('arms a band harder for a colony that has stopped bleeding', () => {
    // Same seed, same stream position, same band size: the only difference
    // between these two numbers is what the Ashbound think of the place.
    const hp = (streak: number): number => {
      const world = createWorld(5);
      world.storyteller.nextThreat = 10_000;
      world.storyteller.threatsFired = 12;
      world.storyteller.unbloodied = streak;
      spawnRaid(world, new Rng(88), 3);
      const band = world.pawns.filter((p) => p.faction === 'raider');
      return band.reduce((sum, p) => sum + p.maxHp, 0) / band.length;
    };
    expect(hp(0)).toBeLessThan(hp(12));
  });

  it('sends more than the six the band has always capped at', () => {
    // The ceiling only shows on a colony big enough for it to bind — the band is
    // still never more than the colony can meet, which is the older rule and the
    // one that keeps a bad day from being a wipe.
    const most = (streak: number): number => {
      const world = createWorld(5);
      const rng = new Rng(1717);
      for (let i = 0; i < 10; i++) makePawn(world, new Rng(60 + i), 'colony', 90 + i, 100);
      let seen = 0;
      for (let beat = 0; beat < 40; beat++) {
        // Pinned each pass, so the fights these beats start cannot move the thing
        // under test while it is being measured.
        world.storyteller.unbloodied = streak;
        world.storyteller.raidActive = false;
        world.storyteller.nextThreat = 0;
        for (const p of world.pawns) if (p.faction !== 'colony') p.dead = true;
        tickStoryteller(world, rng);
        const band = world.pawns.filter((p) => p.faction === 'raider' && !p.dead).length;
        if (band > seen) seen = band;
      }
      return seen;
    };
    expect(most(0)).toBe(6);
    expect(most(12)).toBe(10);
  });
});
