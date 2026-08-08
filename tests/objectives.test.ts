/**
 * Milestones: the list that tells a new player what to do next.
 *
 * Two things here are worth pinning and neither is the wording. The first is
 * that a milestone is **sticky** — it is a curriculum, not an alert, and a fire
 * that takes the beds must not un-teach the player what a bed is. The second is
 * that it is announced **once**: the check runs on a timer inside the tick, and
 * the obvious bug is a colony that says "everyone has a bed" three times a
 * second for the rest of the game.
 *
 * The last block plays a real colony rather than poking the world, because the
 * claim the panel actually makes is "these are things a colony does", and a
 * curriculum full of goals ordinary play never reaches is worse than no panel.
 */

import { describe, expect, it } from 'vitest';

import { migrating } from '../src/sim/encounters';
import {
  earnedObjectives,
  nextObjectives,
  objectiveScore,
  objectives,
  tickObjectives,
} from '../src/sim/objectives';
import { makeStreams, stepWorldN, type Streams } from '../src/sim/tick';
import { SUMMONED_VISIT, tradeState } from '../src/sim/trade';
import { TICKS_PER_DAY, type World } from '../src/sim/types';
import { addBuilding, addItem, livingColonists, removeBuilding } from '../src/sim/world';
import { CABIN, createWorld } from '../src/sim/worldgen';

/** Advance the milestone check itself, without running a whole world. */
function check(world: World, times = 1): void {
  for (let i = 0; i < times; i++) {
    world.tick += 20;
    tickObjectives(world);
  }
}

function earned(world: World, id: string): boolean {
  return (world.objectives ?? []).includes(id);
}

function milestoneLines(world: World): string[] {
  return world.messages.filter((m) => m.text.startsWith('Milestone —')).map((m) => m.text);
}

/**
 * Finish the turret goal, which most of the mechanical tests below use as their
 * stand-in for "the player built the thing".
 *
 * It counts five because the Steward now lays the first four itself — see the
 * comment on the goal in `sim/objectives.ts` — so a test that wants the goal
 * finished has to put down a line, not a gun. Placed along two rows well clear of
 * the cabin; `addBuilding` only refuses a cell that is out of bounds or already
 * taken, so where they stand does not matter to anything here.
 */
function turrets(world: World, n: number): void {
  const from = world.buildings.filter((b) => b.kind === 'turret').length;
  for (let i = from; i < from + n; i++) {
    expect(addBuilding(world, 'turret', 4 + (i % 6), 4 + Math.floor(i / 6), true)).not.toBeNull();
  }
}

/**
 * Every milestone line written over a run, including the ones the log has since
 * dropped.
 *
 * `world.messages` is a rolling eighty-entry window, so over a game week it turns
 * over several times: a milestone earned on day one is long gone by day seven,
 * and reading the log at the end counts how chatty the colony was, not how many
 * goals it hit. Sampling every two hundred ticks — a game half-minute, nowhere
 * near eighty messages — makes the record complete without pretending the log is
 * something it is not.
 */
function milestonesOver(world: World, streams: Streams, ticks: number, step = 200): string[] {
  const seen: string[] = [];
  for (let t = 0; t < ticks; t += step) {
    stepWorldN(world, streams, Math.min(step, ticks - t));
    for (const line of milestoneLines(world)) if (!seen.includes(line)) seen.push(line);
  }
  return seen;
}

describe('the milestone list', () => {
  it('offers a new colony a short list rather than the whole curriculum', () => {
    const world = createWorld(4242);
    const next = nextObjectives(world);
    expect(next.length).toBe(3);
    // Every one of them has somewhere to go and something to do. A goal with no
    // hint is a scoreboard, which is the thing this panel exists not to be.
    for (const o of next) {
      expect(o.hint.length).toBeGreaterThan(20);
      expect(o.done).toBe(false);
    }
    expect(objectiveScore(world).total).toBeGreaterThan(next.length);
  });

  it('reads progress off the world without being told', () => {
    const world = createWorld(4242);
    const before = objectives(world).find((o) => o.id === 'turret')!;
    expect(before.progress).toBe(0);
    expect(before.count).toBe('0/5');
    turrets(world, 2);
    const mid = objectives(world).find((o) => o.id === 'turret')!;
    expect(mid.progress).toBeCloseTo(0.4);
    expect(mid.count).toBe('2/5');
    turrets(world, 3);
    const after = objectives(world).find((o) => o.id === 'turret')!;
    expect(after.progress).toBe(1);
    expect(after.count).toBe('5/5');
  });

  it('never reports more than the whole of a goal', () => {
    const world = createWorld(4242);
    turrets(world, 9);
    const o = objectives(world).find((q) => q.id === 'turret')!;
    // Nine turrets is not a hundred and eighty percent of a goal, and a bar that
    // runs past the end of its track is the sort of thing a thirteen-year-old
    // screenshots.
    expect(o.progress).toBe(1);
    expect(o.count).toBe('5/5');
  });

  it('keeps what the colony earned even after the colony loses it', () => {
    const world = createWorld(4242);
    turrets(world, 5);
    const turret = world.buildings.find((b) => b.kind === 'turret')!;
    check(world);
    expect(earned(world, 'turret')).toBe(true);

    removeBuilding(world, turret);
    check(world);
    // Still earned, and still reading as finished: losing the turret is the
    // alert panel's business. This one is a record of what the player has learnt.
    expect(earned(world, 'turret')).toBe(true);
    expect(objectives(world).find((o) => o.id === 'turret')!.done).toBe(true);
    expect(objectives(world).find((o) => o.id === 'turret')!.progress).toBe(1);
  });

  it('says so once, not every time it looks', () => {
    const world = createWorld(4242);
    turrets(world, 5);
    check(world, 30);
    const said = milestoneLines(world).filter((t) => t.includes('watching the approach'));
    expect(said.length).toBe(1);
  });

  it('does not congratulate a colony that has just been wiped out', () => {
    const world = createWorld(4242);
    turrets(world, 5);
    world.gameOver = true;
    check(world, 5);
    expect(earned(world, 'turret')).toBe(false);
    expect(milestoneLines(world)).toEqual([]);
  });

  it('loads a colony saved before milestones existed and re-earns what it has', () => {
    const world = createWorld(4242);
    turrets(world, 5);
    check(world);
    expect(earned(world, 'turret')).toBe(true);

    // Exactly what an older save produces once it is through `JSON.parse`.
    const reloaded = JSON.parse(JSON.stringify(world)) as World;
    delete reloaded.objectives;
    expect(objectives(reloaded).every((o) => !o.done)).toBe(true);
    // One second of play and the colony has its record back, because every
    // measure reads state that colony still has.
    check(reloaded);
    expect(earned(reloaded, 'turret')).toBe(true);
  });

  it('hands out the same array every time rather than a fresh one', () => {
    const world = createWorld(4242);
    const a = earnedObjectives(world);
    a.push('made-up');
    expect(earnedObjectives(world)).toBe(a);
    expect(world.objectives).toContain('made-up');
  });
});

/**
 * The rule the list is built on, stated as two tests.
 *
 * The first draft of this curriculum asked for beds, four days of food, a sown
 * field, ten meals and a weapon in every hand — and a colony nobody touched
 * ticked seven of fourteen off inside the first game day, because the settler AI
 * does all of that unprompted. That panel was narrating the AI. These two pin
 * the fix from both sides: watching earns you nothing, and playing earns you the
 * goal on the tick you finish it.
 */
describe('the difference between watching and playing', () => {
  it('gives a colony nobody has touched none of the player’s work', () => {
    const world = createWorld(4242);
    const streams = makeStreams(world);
    const announced = milestonesOver(world, streams, TICKS_PER_DAY * 7);

    const done = world.objectives ?? [];
    // Every one of these is out of reach of the Steward (`sim/steward.ts`), the
    // only thing on the map that places blueprints unasked. It never touches the
    // grid, the cold store or the paving at all; the ones it does touch it cannot
    // finish — its sandbag line is six fixed cells either side of the gate, and its
    // turret ladder stops hard at four — so ten bags and five guns are still the
    // player's decision by construction rather than by luck.
    //
    // If one of these ever starts landing on its own, the goal has stopped
    // measuring a decision and wants retargeting past the Steward — which is
    // exactly what happened to `floor` when the Steward learnt to board the
    // cabin, and why that goal counts paving now.
    for (const id of ['sandbags', 'battery', 'coldstore', 'turret', 'floor', 'solar']) {
      expect(done).not.toContain(id);
    }
    // Whatever it *did* earn in a week is a story beat, and each landed in the
    // log exactly once, so the player saw it happen.
    expect(announced.length).toBe(done.length);
    // And there is still a full screen of things to go and do.
    expect(nextObjectives(world).length).toBe(3);
  });

  it('gives it to them the moment they build the thing', () => {
    const world = createWorld(4242);
    const streams = makeStreams(world);
    // Ten sandbags is the third goal on the list, and the one a new colony can
    // afford on day one — which is why it is where it is.
    // Laid across the yard south of the cabin: the strip worldgen guarantees is
    // cleared and treeless, rather than a corner of the map that happened to be
    // bare while the map was sixty-four wide.
    for (let i = 0; i < 10; i++) {
      expect(addBuilding(world, 'sandbag', CABIN.doorX - 5 + i, CABIN.y1 + 3, true)).not.toBeNull();
    }
    stepWorldN(world, streams, 40);

    expect(world.objectives ?? []).toContain('sandbags');
    expect(milestoneLines(world).some((t) => t.includes('sandbag line'))).toBe(true);
    expect(nextObjectives(world).some((o) => o.id === 'sandbags')).toBe(false);
  });
});

/**
 * The half of the panel that talks back.
 *
 * Three milestones send an encounter when they land — a caravan for the steel, a
 * refugee for the ruin, a herd for the pen. The interesting cases are all about
 * *not* sending: a save being loaded must not fire a week of beats it earned
 * days ago, several milestones landing together must not stack their encounters
 * on one tick, and none of it may quietly push the storyteller's escalation up.
 */
/**
 * What is left to do once there is nothing left to do.
 *
 * Research runs dry around day fifty-five — `res 15` from day forty-five to day
 * one hundred and twenty on seed 20260729 — and the charter is usually founded
 * before that. So a colony that plays well arrives at a blank panel with seventy
 * days still to run, at the exact moment it finally has the settlers and the
 * steel to be ambitious. The second half of the list is the answer, and the thing
 * worth pinning is the gate: it must be invisible before the founding and whole
 * afterwards, in all three of the places that read the list.
 */
describe('the list a founded colony works from', () => {
  /** Found the colony the way `victory.ts` does, without playing eighty days. */
  function found(world: World): void {
    world.charter = { since: 0, won: true };
  }

  it('shows nothing of the late list to a colony still finding its feet', () => {
    const world = createWorld(4242);
    const ids = objectives(world).map((o) => o.id);
    expect(ids.some((id) => id.startsWith('late'))).toBe(false);
    // Twenty goals on day one would push "pave twenty squares" in behind "pave a
    // hundred", which teaches the wrong lesson first.
    expect(nextObjectives(world).every((o) => !o.id.startsWith('late'))).toBe(true);
  });

  it('opens the second half the moment the charter is founded', () => {
    const world = createWorld(4242);
    const before = objectiveScore(world).total;

    found(world);

    const after = objectiveScore(world).total;
    expect(after).toBeGreaterThan(before);
    expect(objectives(world).filter((o) => o.id.startsWith('late')).length).toBe(after - before);
  });

  it('counts the score out of the same list the panel is showing', () => {
    const world = createWorld(4242);
    found(world);
    // The bug this exists to stop is a score out of fourteen printed beside a
    // panel showing a fifteenth goal — three readers, one of them not updated.
    expect(objectiveScore(world).total).toBe(objectives(world).length);
  });

  it('banks a late milestone and says so, once', () => {
    const world = createWorld(4242);
    found(world);
    // A colony that has already been running: without this the very first pass
    // is the silent one that stops an old save dropping a parade on the yard.
    earnedObjectives(world);

    addItem(world, 'meal', 120, CABIN.x0 + 2, CABIN.y0 + 2);
    check(world, 3);

    expect(earned(world, 'lateLarder')).toBe(true);
    expect(milestoneLines(world).filter((l) => l.includes('larder')).length).toBe(1);
  });

  it('leaves the late goals unearnable while the colony is still young', () => {
    const world = createWorld(4242);
    earnedObjectives(world);
    addItem(world, 'meal', 120, CABIN.x0 + 2, CABIN.y0 + 2);

    check(world, 3);

    // Not merely unshown — never banked. An id earned before the list it belongs
    // to exists would tick itself off the instant the colony was founded.
    expect(earned(world, 'lateLarder')).toBe(false);
  });

  it('asks for a rifle per settler rather than a fixed number of them', () => {
    const world = createWorld(4242);
    found(world);
    const armoury = objectives(world).find((o) => o.id === 'lateArmoury')!;
    // A colony of six that arms everybody has done the thing, and so has a colony
    // of eighteen. The target moving with the headcount is the goal.
    expect(armoury.count.endsWith(`/${livingColonists(world).length}`)).toBe(true);
  });
});

describe('milestones that send something back', () => {
  /** Somewhere in the cleared strip south of the cabin. */
  const DROP = { x: CABIN.doorX, y: CABIN.y1 + 3 };

  /** A colony that has banked a milestone before, which is what unlocks grants. */
  function played(seed = 4242): World {
    const world = createWorld(seed);
    check(world);
    return world;
  }

  function firstWild(world: World) {
    return world.pawns.find((p) => p.faction === 'fauna' && !p.dead && p.tame !== true);
  }

  it('brings the next pack train forward when the colony banks its steel', () => {
    const world = played();
    expect(earned(world, 'steel')).toBe(false);
    const waiting = tradeState(world).nextVisit;
    expect(waiting).toBeGreaterThan(SUMMONED_VISIT);

    expect(addItem(world, 'steel', 200, DROP.x, DROP.y)).not.toBeNull();
    check(world);

    expect(earned(world, 'steel')).toBe(true);
    expect(tradeState(world).nextVisit).toBe(SUMMONED_VISIT);
  });

  it('sends it once, not every time it looks at the same full stockpile', () => {
    const world = played();
    expect(addItem(world, 'steel', 200, DROP.x, DROP.y)).not.toBeNull();
    check(world);
    // The caravan is now on the road and the clock is ticking down towards it.
    // Nothing here should reset that clock, or the pedlar never arrives at all.
    tradeState(world).nextVisit = 3;
    check(world, 20);
    expect(tradeState(world).nextVisit).toBe(3);
  });

  it('sends nothing when a save re-earns a week of work on its first tick', () => {
    const world = createWorld(4242);
    expect(addItem(world, 'steel', 200, DROP.x, DROP.y)).not.toBeNull();
    const wild = firstWild(world);
    expect(wild).toBeDefined();
    wild!.tame = true;
    // Straight out of `JSON.parse`: everything the colony has done, and no record
    // of having been told about any of it.
    expect(world.objectives).toBeUndefined();
    const waiting = tradeState(world).nextVisit;

    check(world);

    // Earned, announced — and completely silent about it otherwise. A player
    // opening yesterday's colony gets their milestone list back, not a caravan
    // and a herd for work they did on Tuesday.
    expect(earned(world, 'steel')).toBe(true);
    expect(earned(world, 'pen')).toBe(true);
    expect(tradeState(world).nextVisit).toBe(waiting);
    expect(migrating(world)).toEqual([]);
  });

  it('sends one thing, not three, when several land in the same second', () => {
    const world = played();
    expect(addItem(world, 'steel', 200, DROP.x, DROP.y)).not.toBeNull();
    const wild = firstWild(world);
    expect(wild).toBeDefined();
    wild!.tame = true;

    check(world);

    expect(earned(world, 'steel')).toBe(true);
    expect(earned(world, 'pen')).toBe(true);
    // Steel is the earlier goal, so steel is the one that answers. The pen is
    // still earned; it just does not get its own parade on the same tick.
    expect(tradeState(world).nextVisit).toBe(SUMMONED_VISIT);
    expect(migrating(world)).toEqual([]);
  });

  it('does not hand a quick colony a bigger raid for being quick', () => {
    const world = played();
    const fired = world.storyteller.threatsFired;
    // A beat was about to land. It should get out of the way of the one the
    // milestone just sent, and it should not count as having been fired.
    world.storyteller.nextThreat = 5;
    expect(addItem(world, 'steel', 200, DROP.x, DROP.y)).not.toBeNull();

    check(world);

    expect(world.storyteller.threatsFired).toBe(fired);
    expect(world.storyteller.nextThreat).toBeGreaterThan(TICKS_PER_DAY * 0.3);
  });

  /**
   * The experience half: nobody pokes `tickObjectives` here. A real colony runs,
   * an animal ends up tame, and the valley answers — which is the whole claim
   * the feature makes to a player.
   */
  it('walks a herd through the valley the afternoon the pen fills', () => {
    const world = createWorld(4242);
    const streams = makeStreams(world);
    stepWorldN(world, streams, 40);
    expect(migrating(world)).toEqual([]);

    const wild = firstWild(world);
    expect(wild).toBeDefined();
    wild!.tame = true;
    stepWorldN(world, streams, 40);

    expect(earned(world, 'pen')).toBe(true);
    expect(migrating(world).length).toBeGreaterThan(0);
  });
});
