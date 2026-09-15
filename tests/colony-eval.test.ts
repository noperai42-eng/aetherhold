/**
 * The balance gate. `npm run eval` runs exactly this file and prints the tables.
 *
 * A colony sim can be technically correct and still unplayable: if the storyteller
 * outpaces the economy, every new player watches their settlers collapse and
 * concludes the game is broken. These runs are the standing check that an
 * unattended, competently-managed colony survives the opening week — and the
 * per-day tables are what a balance change gets judged against.
 */

import { describe, expect, it } from 'vitest';
import { formatReport, judge, runColony } from '../src/eval/run';
import { stewardTick } from '../src/eval/steward';
import { CABIN, createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { countResource, hostiles, livingColonists } from '../src/sim/world';
import { dist } from '../src/sim/grid';
import { roomOf } from '../src/sim/rooms';
import { cellTemp, tickTemperature } from '../src/sim/temperature';
import { reachable } from '../src/sim/jobs';
import { spawnRaid } from '../src/sim/events';
import { DESIG_HARVEST, TICKS_PER_DAY, terrainAt } from '../src/sim/types';
import { idleRates } from '../src/eval/run';
import type { EvalReport } from '../src/eval/run';

const HOME = {
  x: Math.round((CABIN.x0 + CABIN.x1) / 2),
  y: Math.round((CABIN.y0 + CABIN.y1) / 2),
};

/** Seeds, not one seed: a single map can be lucky in ways the genre never is. */
const SEEDS = [20260729, 7, 1312, 99001, 424242];
const DAYS = 8;

/** Plays the world forward, reporting the most cells ever marked at one time. */
function play(world: ReturnType<typeof createWorld>, ticks: number): number {
  const streams = makeStreams(world);
  let peakDesignated = 0;
  for (let i = 0; i < ticks; i++) {
    stepWorld(world, streams);
    stewardTick(world, world.tick);
    const n = world.cellDesig.filter((d) => d === DESIG_HARVEST).length;
    if (n > peakDesignated) peakDesignated = n;
  }
  return peakDesignated;
}

describe('every seed can progress', () => {
  // Steel comes from mined rock and nothing else. A seed that buries all its
  // rock behind water, or drops it outside walking distance, is a seed where the
  // build menu is decoration — so worldgen lays deliberate outcrops and this is
  // the check that they landed somewhere a settler can actually reach.
  it('puts minable rock within reach of the cabin', () => {
    for (const seed of [...SEEDS, 4242, 31337, 1, 555]) {
      const world = createWorld(seed);
      const pawn = livingColonists(world)[0]!;
      let minable = 0;
      for (let y = 1; y < world.height - 1; y++) {
        for (let x = 1; x < world.width - 1; x++) {
          if (terrainAt(world, x, y) !== 'rock') continue;
          if (dist(x, y, HOME.x, HOME.y) > 22) continue;
          if (!reachable(world, pawn, x, y, true)) continue;
          minable++;
        }
      }
      expect(minable, `seed ${seed} has ${minable} reachable rock cells near home`).toBeGreaterThan(10);
    }
  });
});

describe('steward', () => {
  it('marks reachable rock and turns it into steel', () => {
    const world = createWorld(4242);
    const steelBefore = countResource(world, 'steel');
    // Empty the store so the Steward has a reason to send someone mining.
    for (const s of world.items) if (s.kind === 'steel') s.amount = 1;

    // Peak, not final: a designation that got mined is cleared, so counting at
    // the end of the day punishes exactly the outcome under test.
    const designated = play(world, TICKS_PER_DAY);
    expect(designated).toBeGreaterThan(0);
    // Mining is the only source of steel in the game, so a rise proves the whole
    // chain ran: designation → job → walk → work → dropped stack.
    expect(countResource(world, 'steel')).toBeGreaterThan(1);
    expect(steelBefore).toBeGreaterThan(0);
  });

  it('gets a fire into the cabin before the settlers need one', () => {
    const world = createWorld(20260729);
    const cold = createWorld(20260729);
    play(world, TICKS_PER_DAY * 2);

    const fire = world.buildings.find((b) => b.kind === 'campfire');
    expect(fire, 'no campfire two days in').toBeDefined();
    expect(fire!.built).toBe(true);
    // Inside the cabin, not in the yard where it would warm the sky.
    expect(roomOf(world, fire!)?.size).toBeGreaterThan(50);

    // And it is doing something: the same colony, same hour, without one. The
    // pair is the whole point — an absolute number here would only be pinning the
    // constant, not the fact that the Steward's decision paid for itself.
    cold.tick = world.tick;
    cold.weather = { ...world.weather };
    for (let i = 0; i < 400; i++) {
      cold.tick++;
      tickTemperature(cold);
    }
    expect(cellTemp(world, HOME.x, HOME.y)).toBeGreaterThan(cellTemp(cold, HOME.x, HOME.y) + 3);
  });

  it('drafts everyone when raiders arrive and stands them down afterwards', () => {
    const world = createWorld(31337);
    const streams = makeStreams(world);
    spawnRaid(world, streams.story, 2);

    // The Steward answers raiders that are actually coming for the colony, not
    // every dot on the map, so the draft happens when they arrive rather than
    // when they spawn. Forty ticks was enough while the map edge was thirty-two
    // cells from the hearth; on a wider map the walk is the point — a bigger map
    // buys the colony warning, and the test waits for the arrival instead of
    // assuming the spawn is one.
    let armed = livingColonists(world).filter((p) => p.weapon !== 'none' && !p.downed);
    for (let i = 0; i < TICKS_PER_DAY / 4; i++) {
      stepWorld(world, streams);
      stewardTick(world, world.tick);
      armed = livingColonists(world).filter((p) => p.weapon !== 'none' && !p.downed);
      if (armed.length > 0 && armed.every((p) => p.drafted)) break;
    }
    expect(armed.length).toBeGreaterThan(0);
    expect(armed.every((p) => p.drafted)).toBe(true);

    // Clear the field the way a won fight does, then let the Steward notice.
    for (const p of hostiles(world)) p.dead = true;
    for (let i = 0; i < 40; i++) {
      stepWorld(world, streams);
      stewardTick(world, world.tick);
    }
    expect(livingColonists(world).some((p) => p.drafted)).toBe(false);
  });
});

describe('colony survives its first week', () => {
  const reports = SEEDS.map((seed) => runColony({ seed, days: DAYS }));

  // A test whose job is to print. The per-day tables are what a balance change
  // is actually judged against, and a green suite with no numbers in it tells
  // whoever comes next nothing about how close to the edge the colony ran.
  it('reports what happened on every seed', () => {
    for (const r of reports) console.log(`\n${formatReport(r)}`);
    expect(reports).toHaveLength(SEEDS.length);
  });

  it('never wipes out', () => {
    for (const r of reports) {
      expect(r.verdict, `seed ${r.seed}: ${r.summary}`).not.toBe('collapsed');
    }
  });

  it('mostly thrives — whole colony, fed, at the end of the week', () => {
    const thriving = reports.filter((r) => r.verdict === 'thriving').length;
    const detail = reports.map((r) => `${r.seed}:${r.verdict}`).join(' ');
    expect(thriving, detail).toBeGreaterThanOrEqual(4);
  });

  it('never starves a settler to the point of collapse', () => {
    for (const r of reports) {
      const hungriest = Math.min(...r.snapshots.map((s) => s.minFood));
      expect(hungriest, `seed ${r.seed} bottomed out at food ${hungriest}`).toBeGreaterThan(0.02);
    }
  });

  // The four starvation columns, on a run chosen because it contains all four
  // things they exist to tell apart. Twenty days on the hard setting, seed 7,
  // **unmanaged**: somebody spends a couple of hours at zero on their feet and
  // then eats; somebody else spends the better part of a day on the floor at zero
  // with the larder stocked; only *part* of that floor time has a colonist
  // upright to fetch the meal, the rest being a colony where everybody is
  // unconscious; and only part of *that* is time nobody was carrying a meal over.
  //
  // A run where all four came back zero would pass any assertion about the shape
  // of these numbers, which is the way a new column quietly dies — wired to
  // nothing and green forever. So this pins them **nonzero**, on a named run.
  //
  // It is meant to fail when the sim gets better, and it has, three times.
  // harsh/424242 went first, its floor spell falling to zero the day
  // `sendSomebodyToFeed` shipped. Then harsh/1312 went the day `RESCUER_KEEPS`
  // shipped, and not by collapsing: its floor and stranded columns *converged*,
  // both 12.56 h, because feeding people sooner kept enough of that colony
  // conscious that it never went fully dark. harsh/99001 went third, the day
  // `walkTo` stopped calling a route cut by a new wall the end of the errand: its
  // floor, stranded and unfed columns all fell to zero together while the walk
  // home *rose*, 1.9 h to 10.9. That is the whole shape of the change in one row
  // — the same people get just as hungry, and now they are on their feet when it
  // happens, because the settler carrying the meal no longer drops the job when
  // somebody finishes a wall across the path. Re-point off
  // `scripts/probe-starve-pin.ts`, which prints all four
  // columns for the short runs a unit test can afford and flags the rows that
  // satisfy this test's own conjunction.
  //
  // `steward: false` is load-bearing and is the reason harsh/424242 was ever
  // pinned here. `runColony` opens `opts.steward ?? true`, so leaving the flag off
  // silently plays a *managed* colony — an arm the grid does not measure at all,
  // since `--steward` is opt-in on `npm run measure` and `measurements.json`
  // records `steward: false`. Measured on 99001 the day that flag was found: run
  // managed, its upright column read 155.7 h; unmanaged, 1.9. Both are real. Only
  // one is the colony these starvation principles judge.
  //
  // harsh/7 went fourth, the day the Steward learned to wall people a bedroom,
  // and it went the way the three before it went — by the colony getting better
  // rather than by anything breaking. Three of its four columns fell together:
  // the walk home 1.39 h to 0.74, the floor spell 29.99 to 17.62, the unfed
  // column 3.59 to 1.67, with only the stranded column steady at 4.85 to 5.15.
  // Two settlers who used to be buried on that seed were alive on day twenty.
  // The pin asks for a colony that still starves visibly enough to tell four
  // causes apart, and harsh/7 is no longer one.
  //
  // harsh/1234 went fifth, the day the flu learned to pass between people, and
  // it went the way all four before it went. Contagion is not a starvation rule
  // and it moved every one of these columns anyway, because a settler in bed
  // with a fever is a settler not carrying a meal to anybody: 1234's unfed
  // column read 2.3 h when it was pinned and 0.0 after, with the floor spell
  // going 25.4 to 0.3. The colony is not worse. It is differently occupied, and
  // this pin asks for one that still starves visibly enough to tell four causes
  // apart.
  //
  // The readings this pin was re-pointed on, from `scripts/probe-starve-pin.ts`:
  // feet 3.7 h, floor 21.3, stranded 7.7, unfed 1.5 — the widest margins of the
  // three runs that fit, out of twelve seeds walked on two difficulties. This is
  // a harder twenty days than the pins before it: three of the six are dead by
  // the end, which is the point, because a colony that starves visibly is the
  // only kind that can tell four causes of starving apart.
  //
  // harsh/5150 (1.1 / 8.1 / 4.4 / 2.4) is the spare, and has the best margin on
  // the unfed column — the one that has collapsed under every re-point. It was
  // not taken because its walk-home column reads 1.1 against a threshold of 1,
  // and that is the margin harsh/424242 was carrying the round before it failed.
  //
  // harsh/8675309 (1.5 / 14.9 / 3.2 / 1.8) fits as well and was pinned here for
  // one run before being backed out on cost rather than on a reading: it takes
  // 87 s to simulate against 61 s for the seed it replaced, and this file has
  // fifteen runs in it and sits nearest the 300 s per-test ceiling. It timed out
  // in the full suite and passed alone, which is the whole failure mode. Check
  // the clock as well as the columns before pinning anything here — 20260902
  // costs 64 s, so this re-point is free.
  //
  // Re-pointed again to harsh/7 when a rotted settler started releasing her
  // claims (`tickGraves`): every run where a body rots now takes a different
  // path, and 20260902's fourth column went to 0.0 h — the pin failing because
  // the sim moved, not because feeding broke. The grid says three of twenty-four
  // runs still fit, and 7 is the widest of them by a distance (3.7 / 24.9 / 9.9 /
  // 5.0) *and* the cheapest row on the clock at 47 s against 20260902's 58 s, so
  // this re-point buys margin on both axes. `probe-starve-pin` now prints the
  // clock alongside the columns, so the next person does not have to time it by
  // hand.
  //
  // And re-pointed off harsh/7 the day the Steward stopped being satisfied with
  // one room — seventh in the line, and seventh in a row that went by the colony
  // getting better rather than by anything breaking. A colony that clears ground
  // and puts up a second and a third building is a colony with more floor, more
  // stockpile and more hands moving, and harsh/7's fourth column went 5.0 h to
  // 0.0: nobody on that seed now goes down hungry with hands free and no meal
  // walking over. Its stranded column reads 0.8 as well. Two of the four are
  // gone, so the pin cannot tell four causes apart on it any more.
  //
  // harsh/31 (1.8 / 19.2 / 3.5 / 1.8) takes it, out of the same twelve seeds
  // walked again. It is not the widest row on the grid — harsh/8675309 reads
  // 3.7 / 26.1 / 10.7 / 8.1 — but that is the seed this pin already backed out
  // of once on the clock, and pinning it again would be walking into a known
  // wall. What makes 31 the right one is the fourth column: 1.8 h against a
  // stranded column of 3.5, so the gap the strict inequality rests on is 1.7 h
  // rather than the 0.2 h that harsh/1312 offers at 1.5 against 1.7. The unfed
  // column is the one that has collapsed under every re-point in this list, and
  // the seed worth pinning is the one that has somewhere to fall.
  it('tells a walk home from a wait on the floor from a wait with hands free', () => {
    const r = runColony({
      seed: 31,
      days: 20,
      difficulty: 'harsh',
      playPastFounding: true,
      steward: false,
    });
    const last = r.snapshots[r.snapshots.length - 1]!;
    expect(last.starveHours, 'nobody walked home hungry').toBeGreaterThan(1);
    expect(last.floorStarveHours, 'nobody was left down and hungry').toBeGreaterThan(1);
    expect(
      last.strandedStarveHours,
      'nobody was left down and hungry while somebody could still walk — has feeding been fixed?',
    ).toBeGreaterThan(1);
    expect(
      last.unfedStarveHours,
      'nobody was left down and hungry with hands free and no meal moving — has dispatch been fixed?',
    ).toBeGreaterThan(1);
    // Disjoint, not nested: the floor spell must not be counted in the walk. If
    // one collapse could fill both columns the pair would say one thing twice.
    expect(last.starveHours).not.toBe(last.floorStarveHours);
    // And each narrow column is strictly inside the wider one, which is the whole
    // reason there are four of them. Hours on the floor with nobody upright to
    // help are hours no rule on the work board can reach; hours with a meal
    // already walking over are hours the colony *did* answer, slowly. The promise
    // is drawn on what is left. Equal at any step would mean that step is
    // measuring nothing.
    expect(last.strandedStarveHours).toBeLessThan(last.floorStarveHours);
    expect(last.unfedStarveHours).toBeLessThan(last.strandedStarveHours);
  });

  // The opening week is tuned to be kind. The check that the game is still a
  // game is the long run: threats escalate every beat, so by the third week the
  // Ashbound out-shoot three settlers and the colony is living off its turrets
  // and its walls. Surviving that is the point; surviving it untouched is not,
  // which is why this only asserts the colony is still standing.
  it('is still standing three weeks in, with the threats escalating', () => {
    const long = runColony({ seed: SEEDS[0], days: 21 });
    console.log(`\n${formatReport(long)}`);
    expect(long.verdict, long.summary).not.toBe('collapsed');
    const last = long.snapshots[long.snapshots.length - 1]!;
    expect(last.threats, 'the storyteller stopped firing').toBeGreaterThan(6);
    expect(last.turrets, 'no turrets were ever finished').toBeGreaterThan(0);
  });

  it('keeps food in store the whole week', () => {
    for (const r of reports) {
      const leanest = Math.min(...r.snapshots.map((s) => s.foodDays));
      expect(leanest, `seed ${r.seed} dropped to ${leanest} days of food`).toBeGreaterThan(0.5);
    }
  });
});

describe('playing past the founding', () => {
  // Only the cheap half lives here. Proving a colony *keeps* playing means
  // playing one all the way to its charter, which is a thirty-day run and far
  // too slow for the gate — `npm run sweep` carries that one, and the measured
  // `--past-founding` grid is what actually judges it.
  it('changes nothing at all until a colony founds', () => {
    // The claim the default rests on: the flag is inert until the charter
    // closes, so every number the difficulty work was calibrated on is the
    // number it was. Four days is nowhere near any setting's founding, so these
    // two runs have to agree on every field of every snapshot.
    const off = runColony({ seed: SEEDS[0], days: 4, steward: false });
    const on = runColony({ seed: SEEDS[0], days: 4, steward: false, playPastFounding: true });
    expect(on.foundedOn, 'four days should be far short of any founding').toBeNull();
    expect(on).toEqual(off);
  });
});

/**
 * The fourth verdict, and the order it has to be taken in.
 *
 * Same division as above: the colony that actually reaches a terminal is a
 * forty-day run and the grid carries it — `an-ending-is-the-last-word` is the
 * promise that reads it. What the gate can afford is the part that goes wrong by
 * being rearranged, so `judge` is called directly on worlds built to have
 * exactly one interesting fact each.
 */
describe('a run that reached the far end of a road', () => {
  const landed = (id: 'ship' | 'berths' | 'dominion', day: number, tick: number) => {
    const world = createWorld(1);
    world.tick = tick;
    world.ending = {
      id,
      committed: tick - TICKS_PER_DAY * 12,
      since: tick - TICKS_PER_DAY * 12,
      paid: {},
      lastWorked: day - 1,
      landed: tick,
      record: { day, standing: 6, stats: { ...world.stats } },
    };
    return world;
  };

  it('is filed under its ending and named by it', () => {
    const out = judge(landed('ship', 43, TICKS_PER_DAY * 43), [], 12, true);
    expect(out.verdict).toBe('landed');
    expect(out.summary).toContain('founded on day 12');
    expect(out.summary).toContain('the ship on day 43');
    expect(out.summary).toContain('6 still standing');
  });

  it('keeps its ending when the valley behind it is wiped out', () => {
    // The ordering, stated as the case that breaks it. The ship sailed on day
    // forty-three and everyone who stayed is dead by day sixty: `gameOver` is
    // set, there is no snapshot to read, and the wipe branch below would take
    // this run and file it beside the ones that never left the yard. The clause
    // about the valley is not optional either — an instrument that swallowed a
    // wipe to keep a nicer verdict would be lying in the other direction.
    const world = landed('dominion', 43, TICKS_PER_DAY * 43);
    world.gameOver = true;
    const out = judge(world, [], 12, true);
    expect(out.verdict).toBe('landed');
    expect(out.summary).toContain('the dominion on day 43');
    expect(out.summary).toContain('the valley was empty');
  });

  it('leaves a committed-but-unlanded terminal to be judged on its last day', () => {
    // Committed and still paying when the clock ran out, which is not an ending
    // — it is a colony in the middle of something, and how it is doing is still
    // the question. `landed: null` is the whole difference and the only thing
    // separating this world from the first one.
    const world = landed('berths', 43, TICKS_PER_DAY * 43);
    world.ending!.landed = null;
    delete world.ending!.record;
    world.gameOver = true;
    expect(judge(world, [], 12, true).verdict).toBe('collapsed');
  });
});

/**
 * Group 3's fourth pin: what the colony built, whether it grew a room, and
 * how much of every settler's day sat idle while work stood on the board
 * (`idleBoardShare`, the Steward's gap) against how much sat idle while work
 * stood ready for THIS pawn specifically to take (`idleTakeableShare`,
 * dispatch's gap). One predicate cannot answer both questions, which is why
 * there are two.
 */
describe('what the colony built and how idle its hands sat', () => {
  // The unmanaged arm: EvalOptions.steward is explicitly false (the eval
  // harness's own driver, src/eval/steward.ts, never runs) while
  // world.steward is left undefined, which leaves the in-sim foreman
  // (src/sim/steward.ts) running exactly as it would for a player who never
  // opened the steward panel. This is the balance grid's default arm — the
  // one every Group 3 fix is judged against — so it is the one pinned here.
  it('builds, grows rooms and idles at a pinned rate on harsh/99001, foreman on (world.steward left undefined) and eval driver off (steward: false)', () => {
    const r = runColony({
      seed: 99001,
      days: 30,
      difficulty: 'harsh',
      playPastFounding: true,
      steward: false,
    });
    const rates = idleRates(r);
    // "One room a day", finally given a number: 0.03. Thirty harsh days add
    // *one* room to the three the valley was generated with. The first pin
    // read 0.13 and was measuring the wrong thing — `prevRooms` started at 0,
    // so day one's delta counted the whole world-gen room set as something the
    // colony built. Subtracting the three it was handed leaves 0.9 rooms over
    // thirty days, which is this number, and which is the gap Group 3 exists
    // to close.
    expect(rates.roomsPerDay).toBeCloseTo(0.03, 2);
    expect(rates.builtPerDay).toBeCloseTo(4.8, 2);
    // Both shares moved with the denominator, not with the colony: `awakeTicks`
    // now excludes the same four states `isIdlePawn` does (asleep, drafted,
    // hand-driven, on a break) instead of only sleep, so the divisor counts the
    // ticks a settler could actually have been working. A smaller true
    // denominator reads both gaps slightly wider.
    expect(rates.idleBoardShare).toBeCloseTo(0.124, 3);
    expect(rates.idleTakeableShare).toBeCloseTo(0.049, 3);
    expect(
      rates.idleTakeableShare,
      "dispatch's gap can never be wider than the Steward's gap — takeable work is only ever counted once the board is already confirmed open",
    ).toBeLessThanOrEqual(rates.idleBoardShare);
  });

  // Deleted: "keeps dispatch's gap inside the Steward's gap on every seed of
  // the opening week". `idleTakeableTicks` is only ever incremented inside the
  // `boardOpen` branch (`run.ts`), so `idleTakeableShare <= idleBoardShare` is
  // a structural identity no sim change and no predicate change can break. It
  // burned five colony runs to assert nothing — rule 9: a test that cannot fail
  // when business logic changes is wrong. The one-seed assertion inside the
  // pinned test above is kept as documentation of the relationship, where it
  // costs no extra run.

  /**
   * Both zero-denominator guards, on hand-built reports rather than colony
   * runs, because a run cannot reach the second one.
   *
   * `idleRates` guards the divide twice: `if (!last)` for an empty snapshot
   * list, and `Math.max(1, last.awakeTicks)` for a real snapshot where nobody
   * was ever conscious. The test this replaces ran `days: 0`, which returns at
   * the first guard and never evaluates the second — so the case its own
   * comment described ("nobody ever conscious") was the one it did not cover.
   *
   * A NaN here would print blank in every table and silently pass any
   * `toBeLessThanOrEqual` against another NaN, which is why these assert a
   * literal 0 rather than a shape.
   */
  it('reads 0, not NaN, when the snapshot list is empty', () => {
    const rates = idleRates({ snapshots: [] } as unknown as EvalReport);
    expect(rates.idleBoardShare).toBe(0);
    expect(rates.idleTakeableShare).toBe(0);
    expect(rates.builtPerDay).toBe(0);
    expect(rates.roomsPerDay).toBe(0);
  });

  it('reads 0, not NaN, on a day nobody was ever awake', () => {
    const day = {
      builtToday: 0,
      roomsToday: 0,
      awakeTicks: 0,
      idleBoardTicks: 0,
      idleTakeableTicks: 0,
    };
    const rates = idleRates({ snapshots: [day] } as unknown as EvalReport);
    expect(rates.idleBoardShare).toBe(0);
    expect(rates.idleTakeableShare).toBe(0);
  });

  /**
   * And the guard must be a floor on the denominator, not a clamp on the
   * answer: one awake tick spent idle is a share of 1, not of 1/`Math.max`
   * anything. Without this the previous test passes against a `return 0`.
   */
  it('still divides by a real denominator once anybody is awake', () => {
    const day = {
      builtToday: 0,
      roomsToday: 0,
      awakeTicks: 4,
      idleBoardTicks: 3,
      idleTakeableTicks: 1,
    };
    const rates = idleRates({ snapshots: [day] } as unknown as EvalReport);
    expect(rates.idleBoardShare).toBe(0.75);
    expect(rates.idleTakeableShare).toBe(0.25);
  });
});
