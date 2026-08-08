/**
 * Hunting — the colony's second food supply.
 *
 * Before this, every calorie in Aetherhold came from a growing zone: one loop, on
 * one clock, that a fire or a bad patch of soil stops dead. Hunting runs on a
 * different clock — a bullet and a walk instead of a season — and it is the one
 * place where a marked target dies because the *player* decided it should.
 *
 * The tests below pin the two halves of that. First, that the herds are genuinely
 * outside the war: no turret, no raider and no self-defending settler ever touches
 * one, and a deer standing in the yard is not read as a raid. Second, that a mark
 * actually turns into meat in the stockpile through the systems that already
 * existed, with no private butchering step bolted on.
 *
 * The regression guard at the bottom is the important one: wildlife draws from
 * streams nothing else uses, because spending a single worldgen roll on a deer
 * would have regenerated every map in the game.
 */

import { describe, expect, it } from 'vitest';

import { damagePawn, isHostileTo, tickCombat } from '../src/sim/combat';
import { clearColony } from '../src/eval/ecosystem';
import { assignJob } from '../src/sim/jobs';
import { inhabitableId, markHunt, markHuntPawn } from '../src/sim/orders';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import {
  ANIMALS,
  isBrowser,
  isHuntable,
  livingAnimals,
  populationCap,
  spawnInitialFauna,
  tickWildlife,
} from '../src/sim/wildlife';
import type { AnimalKind, Faction, Pawn, World } from '../src/sim/types';
import { TICKS_PER_DAY } from '../src/sim/types';
import { addBuilding, countResource, hostiles, itemsAt, livingColonists } from '../src/sim/world';
import { createWorld, makePawn } from '../src/sim/worldgen';

const FACTIONS: Faction[] = ['colony', 'raider', 'wildlife', 'fauna'];

/** A world with the herds cleared out, so a test can place exactly what it means. */
function emptyRange(seed = 20260729): World {
  const world = createWorld(seed);
  world.pawns = world.pawns.filter((p) => p.faction !== 'fauna');
  return world;
}

/** Drop one animal of a species at a spot, the way worldgen would have. */
function putAnimal(world: World, kind: AnimalKind, x: number, y: number): Pawn {
  const def = ANIMALS[kind];
  const beast = makePawn(world, new Rng(world.pawns.length + 1), 'fauna', x, y, {
    name: def.label,
    weapon: 'none',
  });
  beast.animal = kind;
  beast.hp = def.hp;
  beast.maxHp = def.hp;
  return beast;
}

/** The first colonist who can actually take a shot. */
function rifleman(world: World): Pawn {
  const p = livingColonists(world).find((q) => q.weapon === 'rifle');
  if (!p) throw new Error('no rifle on this seed');
  return p;
}

/** Clear the work board down to one column, so a decision is observable. */
function onlyWork(world: World, keep: 'hunt' | 'haul'): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
      p.priorities[w] = w === keep ? 1 : 0;
    }
  }
}

// ---------------------------------------------------------------- functional

describe('fauna are outside the war', () => {
  it('is hostile to nobody, and nobody is hostile to it', () => {
    for (const f of FACTIONS) {
      expect(isHostileTo('fauna', f)).toBe(false);
      expect(isHostileTo(f, 'fauna')).toBe(false);
    }
  });

  it('leaves every other faction pairing exactly as it was', () => {
    expect(isHostileTo('colony', 'raider')).toBe(true);
    expect(isHostileTo('raider', 'wildlife')).toBe(true);
    expect(isHostileTo('colony', 'colony')).toBe(false);
  });

  it('does not read as a raid: hostiles() ignores the herds', () => {
    const world = emptyRange();
    putAnimal(world, 'mossback', 30, 30);
    expect(hostiles(world)).toHaveLength(0);
    // …and the same query still sees an actual attacker standing beside it.
    makePawn(world, new Rng(3), 'raider', 31, 30, { weapon: 'club' });
    expect(hostiles(world)).toHaveLength(1);
  });

  it('a turret standing over a grazing herd never fires', () => {
    const world = emptyRange();
    const colonist = livingColonists(world)[0]!;
    const t = addBuilding(world, 'turret', Math.round(colonist.x) + 2, Math.round(colonist.y), true);
    expect(t, 'the turret needs somewhere clear to stand').not.toBeNull();
    for (let i = 0; i < 6; i++) {
      putAnimal(world, 'dunhare', t!.x + 1 + i * 0.3, t!.y + 1);
    }
    const rng = new Rng(11);
    for (let i = 0; i < 400; i++) tickCombat(world, rng, null);
    expect(world.projectiles).toHaveLength(0);
    expect(livingAnimals(world)).toHaveLength(6);
  });

  it('an armed settler standing next to one never shoots it', () => {
    const world = emptyRange();
    const shooter = rifleman(world);
    shooter.drafted = true;
    const deer = putAnimal(world, 'mossback', shooter.x + 1.5, shooter.y);
    const rng = new Rng(5);
    for (let i = 0; i < 400; i++) tickCombat(world, rng, null);
    expect(deer.hp).toBe(ANIMALS.mossback.hp);
    expect(deer.dead).toBe(false);
  });
});

describe('animals under fire', () => {
  it('bolts when hurt, and keeps running for a while after', () => {
    const world = emptyRange();
    const deer = putAnimal(world, 'mossback', 30, 30);
    expect(deer.fleeUntil ?? 0).toBe(0);
    damagePawn(world, deer, 5, 'test');
    expect(deer.fleeUntil!).toBeGreaterThan(world.tick + 100);
  });

  it('dies outright rather than lying downed and bleeding', () => {
    const world = emptyRange();
    const hare = putAnimal(world, 'dunhare', 30, 30);
    damagePawn(world, hare, ANIMALS.dunhare.hp * 0.9, 'test');
    // A person at this much damage would be on the ground. An animal is not a
    // rescue case: there is no medical care for it and no downed state to sit in.
    expect(hare.downed).toBe(false);
    damagePawn(world, hare, ANIMALS.dunhare.hp, 'test');
    expect(hare.dead).toBe(true);
    expect(hare.downed).toBe(false);
  });

  it('runs away from whoever is nearby instead of standing there', () => {
    const world = emptyRange();
    const person = livingColonists(world)[0]!;
    const deer = putAnimal(world, 'mossback', person.x + 2, person.y);
    const before = Math.hypot(deer.x - person.x, deer.y - person.y);
    const rng = new Rng(9);
    for (let i = 0; i < 60; i++) {
      world.tick++;
      tickWildlife(world, rng);
    }
    expect(Math.hypot(deer.x - person.x, deer.y - person.y)).toBeGreaterThan(before);
  });

  it('turns a carcass into meat on the ground and then clears the body', () => {
    const world = emptyRange();
    const deer = putAnimal(world, 'mossback', 30, 30);
    deer.dead = true;
    tickWildlife(world, new Rng(1));
    expect(world.pawns.some((p) => p.id === deer.id)).toBe(false);
    const meat = itemsAt(world, 30, 30)
      .filter((s) => s.kind === 'rawfood')
      .reduce((n, s) => n + s.amount, 0);
    expect(meat).toBe(ANIMALS.mossback.meat);
  });
});

describe('the herd population', () => {
  it('seeds a map with game to hunt and something living off it', () => {
    const world = createWorld(20260729);
    const herd = livingAnimals(world);
    expect(herd.length).toBeGreaterThanOrEqual(8);
    const kinds = new Set(herd.map((a) => a.animal));
    // Both huntable species, on every map — a valley of nothing but hares is a
    // valley where the meat economy silently halves.
    expect(kinds).toContain<AnimalKind>('mossback');
    expect(kinds).toContain<AnimalKind>('dunhare');
    // And the browser, which is not game: it is here because the brambles are,
    // and because something has to be standing between the fruit and the wolves.
    expect(kinds).toContain<AnimalKind>('brambletail');
    // And the wolf, which used to be the one species deliberately *not* here: a
    // fenwolf was an event that arrived and went home, never scenery. That was
    // wrong, and running the valley for a thousand days with nobody in it is what
    // showed it — a moor with no colony on it had no predation on it at all, so
    // the top of the food chain only existed while somebody was watching. There
    // are wolves living out here now. The pack that comes down at the pens is
    // still an event on top of them; see `tests/ecosystem.test.ts`.
    expect(kinds).toContain<AnimalKind>('fenwolf');
    // Out on the moor, though, not in the yard. Landing in the middle of a pack
    // on turn one is not an opening, it is a coin toss.
    const home = livingColonists(world)[0]!;
    for (const wolf of herd.filter((a) => a.animal === 'fenwolf')) {
      expect(Math.hypot(wolf.x - home.x, wolf.y - home.y)).toBeGreaterThan(30);
    }
  });

  it('replaces what is taken but never overruns the map', () => {
    const world = emptyRange();
    const rng = new Rng(77);
    // Two in-game days of nothing but wildlife: enough respawn rolls to blow past
    // the cap if nothing held it, since a colony that never hunts still ticks.
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
      world.tick++;
      tickWildlife(world, rng);
    }
    const n = livingAnimals(world).length;
    expect(n).toBeGreaterThan(0);
    // Asked of the map rather than written down: the cap is a density, so a valley
    // that grows carries proportionally more and this test keeps meaning the same
    // thing — "the respawn clock does not run away" — at any size.
    expect(n).toBeLessThanOrEqual(populationCap(world));
  });
});

describe('the hunt order', () => {
  it('marks only the animal standing on the cell it was dragged over', () => {
    const world = emptyRange();
    const a = putAnimal(world, 'mossback', 30, 30);
    const b = putAnimal(world, 'mossback', 34, 30);
    const person = livingColonists(world)[0]!;

    expect(markHunt(world, 30, 30, true)).toBe(1);
    expect(isHuntable(a)).toBe(true);
    expect(isHuntable(b)).toBe(false);
    // A settler standing on a marked cell is not livestock.
    expect(markHunt(world, Math.round(person.x), Math.round(person.y), true)).toBe(0);
    expect(person.hunted).toBeUndefined();
  });

  it('is idempotent, so a dragged rectangle does not double-count', () => {
    const world = emptyRange();
    putAnimal(world, 'dunhare', 30, 30);
    expect(markHunt(world, 30, 30, true)).toBe(1);
    expect(markHunt(world, 30, 30, true)).toBe(0);
    expect(markHunt(world, 30, 30, false)).toBe(1);
  });

  it('calling off a hunt drops the job the hunter was already running', () => {
    const world = emptyRange();
    onlyWork(world, 'hunt');
    const hunter = rifleman(world);
    const deer = putAnimal(world, 'mossback', hunter.x + 6, hunter.y);
    markHuntPawn(world, deer.id, true);
    assignJob(world, hunter);
    expect(hunter.jobId).not.toBeNull();

    markHuntPawn(world, deer.id, false);
    expect(hunter.jobId).toBeNull();
    expect(world.jobs.some((j) => j.kind === 'hunt')).toBe(false);
  });

  it('will not send someone armed with a club after something that outruns them', () => {
    const world = emptyRange();
    onlyWork(world, 'hunt');
    const deer = putAnimal(world, 'mossback', 30, 30);
    markHuntPawn(world, deer.id, true);
    for (const p of livingColonists(world)) {
      p.weapon = 'club';
      p.x = 29;
      p.y = 30;
      assignJob(world, p);
      expect(p.jobId).toBeNull();
    }
  });
});

// --------------------------------------------------------------- experience

describe('a hunt, end to end', () => {
  it('mark an animal and the meat ends up in the stockpile', () => {
    const world = emptyRange();
    const streams = makeStreams(world);
    const hunter = rifleman(world);
    // Everyone hunts and hauls; nothing else competes for the day.
    for (const p of world.pawns) {
      if (p.faction !== 'colony') continue;
      for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
        p.priorities[w] = w === 'hunt' || w === 'haul' ? 1 : 0;
      }
      p.needs.food = 0.9;
      p.needs.rest = 0.9;
    }

    const deer = putAnimal(world, 'mossback', hunter.x + 8, hunter.y + 3);
    markHuntPawn(world, deer.id, true);
    const foodBefore = countResource(world, 'rawfood');

    // Half a day is far longer than a hunt needs, and short enough that a colony
    // this idle cannot have eaten its way through the delivery.
    for (let i = 0; i < TICKS_PER_DAY / 2; i++) {
      stepWorld(world, streams);
      if (world.pawns.every((p) => p.id !== deer.id)) break;
    }

    expect(world.pawns.some((p) => p.id === deer.id)).toBe(false);
    expect(world.messages.some((m) => m.text.includes('Mossback down'))).toBe(true);

    // …and the existing haul loop, untouched, carries it home.
    for (let i = 0; i < TICKS_PER_DAY / 2; i++) stepWorld(world, streams);
    expect(countResource(world, 'rawfood')).toBeGreaterThan(foodBefore);
  });

  it('survives a week of ordinary play without breaking the colony', () => {
    const world = createWorld(20260729);
    const streams = makeStreams(world);
    const before = livingColonists(world).length;
    stepWorldN(world, streams, TICKS_PER_DAY * 7);

    // The herds are still out there, still capped, and still nobody's enemy.
    // `populationCap` is a ceiling on *game* — the animals a hunter walks out to
    // shoot — and browsers are deliberately outside it: a squirrel is not a meat
    // supply, and charging one against the herd budget would delete a deer to make
    // room for something nobody hunts. Browsers answer to the brambles instead.
    const herd = livingAnimals(world);
    // Wolves come out of this count for the same reason browsers do, one ceiling
    // further up: a fenwolf is not game either — nobody hunts one for meat — and
    // it answers to `wolfCap`, which reads the herd rather than the ground.
    const game = herd.filter((a) => !isBrowser(a) && a.hunts !== true);
    expect(game.length).toBeGreaterThan(0);
    // Counted the way the sim counts it, which is a scar. The ceiling is applied
    // in `tickWildlife` as `alive - travelling < populationCap`, and the line
    // above it says why in as many words: a herd that is halfway across is not
    // the map's wildlife, it is weather. Widening the valley to 192 made that
    // visible for the first time — the crossing is long enough now that a herd is
    // genuinely mid-transit on day seven — and this read 62 against a cap of 56
    // with nothing wrong. Filtering to the animals that have actually arrived
    // gives 56 exactly, on this seed and on 21 and 7: the respawn gate is holding
    // the resident population precisely at the ceiling, which is the thing worth
    // asserting. Charging travellers against the ceiling would delete a resident
    // deer to make room for one that is only passing through.
    const resident = game.filter((a) => !a.migrateTo);
    expect(resident.length).toBeLessThanOrEqual(populationCap(world));
    expect(herd.every((a) => a.hunted !== true)).toBe(true);
    // Nothing shot at a deer for a week, so no deer died of one either — and it
    // is *game* that this is about, not every animal on the moor. A fenwolf can
    // die in a week nobody hunted: it walks down the fence line into a deadfall,
    // which `springsFor` lets it do on purpose (`traps.ts`) on the grounds that a
    // pack strolling over a trap line unharmed would read as broken traps. So
    // the assertion names the herbivores the hunt is for. If it stayed as "no
    // animal died at all" it would be a test of where the steward happened to put
    // its traps, and it would go red the first time the pack found one.
    const gameLabels = Object.values(ANIMALS)
      .filter((d) => d.browses !== true && d.hunts !== true)
      .map((d) => d.label);
    const died = world.messages
      .filter((m) => m.text.includes('down —'))
      .filter((m) => gameLabels.some((label) => m.text.startsWith(label)));
    expect(died).toEqual([]);
    expect(livingColonists(world).length).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });
});

describe('a marked animal is an order, not a suggestion', () => {
  it('gets picked up while there is ordinary work on the board', () => {
    // The bug this pins: hunting sat at the bottom of the priority list next to
    // hauling, so on a live map — where there is always a wall to build and a
    // stove to light — a marked animal was simply never collected.
    const world = emptyRange();
    const streams = makeStreams(world);
    const hunter = rifleman(world);
    const deer = putAnimal(world, 'mossback', hunter.x + 7, hunter.y + 2);
    markHuntPawn(world, deer.id, true);

    let claimed = false;
    for (let i = 0; i < 20 * 60; i++) {
      stepWorld(world, streams);
      if (world.jobs.some((j) => j.kind === 'hunt')) {
        claimed = true;
        break;
      }
      if (world.pawns.every((p) => p.id !== deer.id)) {
        claimed = true;
        break;
      }
    }
    expect(claimed, 'nobody took the hunt within a minute of play').toBe(true);
  });

  it('finishes on the real map, in the woods, with nothing rearranged', () => {
    // The end-to-end test above this one runs on a cleared range with the work
    // board forced to hunting. This one is the actual game: default priorities,
    // real terrain, a deer standing in a stand of trees. All three ways that used
    // to fail — never claimed, never in line of sight, timed out mid-kill — look
    // identical from outside, and all three are this assertion.
    const world = createWorld(20260729);
    const streams = makeStreams(world);
    const deer = livingAnimals(world)[0]!;
    const foodBefore = countResource(world, 'rawfood');
    markHuntPawn(world, deer.id, true);

    let killedAt = -1;
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      stepWorld(world, streams);
      if (killedAt < 0 && !world.pawns.some((p) => p.id === deer.id)) killedAt = i;
    }
    expect(killedAt, 'the hunt never resolved inside a day').toBeGreaterThan(0);
    expect(countResource(world, 'rawfood')).toBeGreaterThan(foodBefore);
  });
});

// -------------------------------------------------------- regression guards

describe('selecting an animal does not break the view swap', () => {
  it('V steps into a settler even while a deer is the current selection', () => {
    // Animals are selectable, so the manager can hand the view swap an id that
    // cannot be inhabited. It used to pass that id straight through, possession
    // refused it, and V looked broken to anyone who had just clicked a deer.
    const world = emptyRange();
    const deer = putAnimal(world, 'mossback', 30, 30);
    const target = inhabitableId(world, null, deer.id);
    expect(target).not.toBeNull();
    expect(livingColonists(world).some((p) => p.id === target)).toBe(true);
  });

  it('prefers the body you were already in, then the selection', () => {
    const world = emptyRange();
    const [first, second] = livingColonists(world);
    expect(inhabitableId(world, second!.id, first!.id)).toBe(second!.id);
    expect(inhabitableId(world, null, first!.id)).toBe(first!.id);
  });

  it('gives up only when there is genuinely nobody left', () => {
    const world = emptyRange();
    for (const p of livingColonists(world)) p.dead = true;
    const deer = putAnimal(world, 'mossback', 30, 30);
    expect(inhabitableId(world, deer.id, null)).toBeNull();
  });
});

describe('wildlife keeps to its own randomness', () => {
  it('does not spend a single worldgen roll', () => {
    // Pinned on purpose. Seeding the herds from the worldgen stream would shift
    // every terrain, tree and site decision on every seed in the game, and the
    // only way to notice is a number that stops matching.
    // Moved four times, deliberately. First when research became the seventh
    // skill: makePawn rolls one value per SKILL_NAME, so the three settlers cost
    // three extra rolls. Then when the map grew to 96x96, again at 128x128, and
    // again at 192x192 — every cell of terrain noise is a draw, so a wider map is
    // a different stream by construction.
    //
    // That is the cost of a golden number and it is worth paying: it is the only
    // check in the suite that fails when a *new* system quietly helps itself to
    // the worldgen stream, which is a bug with no other symptom than every seed
    // in the game silently becoming a different map.
    expect(createWorld(20260729).rng.main).toBe(1672083406);
  });

  it('spawning a herd touches nothing but the pawn list', () => {
    const world = emptyRange();
    const terrain = world.terrain.slice();
    const buildings = world.buildings.length;
    const sites = world.sites.length;

    spawnInitialFauna(world, new Rng(1234));

    expect(livingAnimals(world).length).toBeGreaterThan(0);
    expect(world.terrain).toEqual(terrain);
    expect(world.buildings).toHaveLength(buildings);
    expect(world.sites).toHaveLength(sites);
  });

  it('the herds cannot perturb the weather or a firefight', () => {
    // Same seed, same day, one world carrying twice the wildlife: if the herds
    // drew from a shared stream, the sky would diverge.
    //
    // The colony comes out of both worlds first, and that is not a convenience —
    // it is what makes the question answerable. With settlers in it the extra
    // herd *legitimately* moves the combat stream: more animals near the fence
    // means more of them marked and shot at, and `tickJob` draws from that stream
    // when somebody fires. That is a causal difference, not a shared stream, and
    // a test that cannot tell the two apart is a test that fails for the wrong
    // reason the first time a wolf wanders past a rifle. Take the people out and
    // the only thing left that could move any of these numbers is the wildlife
    // tick itself, which is the thing being pinned.
    const a = createWorld(4242);
    const b = createWorld(4242);
    clearColony(a);
    clearColony(b);
    spawnInitialFauna(b, new Rng(999));
    expect(livingAnimals(b).length).toBeGreaterThan(livingAnimals(a).length);

    stepWorldN(a, makeStreams(a), TICKS_PER_DAY);
    stepWorldN(b, makeStreams(b), TICKS_PER_DAY);

    expect(b.weather.kind).toBe(a.weather.kind);
    expect(b.rng.story).toBe(a.rng.story);
    expect(b.rng.combat).toBe(a.rng.combat);
  });
});
