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

  // The two starvation columns, on a run chosen because it contains both things
  // they exist to tell apart. Twenty days on the hard setting, seed 424242: one
  // settler spends most of a day on the floor at zero with the larder stocked,
  // and a different settler spends most of a working day at zero on their feet
  // and then eats.
  //
  // A run where both came back zero would pass any assertion about the shape of
  // these numbers, which is the way a new column quietly dies — wired to nothing
  // and green forever. So this pins them **nonzero**, on a named run, with the
  // walk and the collapse separated.
  it('tells a settler walking home hungry from one starving on the floor', () => {
    const r = runColony({ seed: 424242, days: 20, difficulty: 'harsh', playPastFounding: true });
    const last = r.snapshots[r.snapshots.length - 1]!;
    expect(last.floorStarveHours, 'nobody was left down and hungry — has feeding been fixed?')
      .toBeGreaterThan(1);
    expect(last.starveHours, 'nobody walked home hungry').toBeGreaterThan(1);
    // Disjoint, not nested: the floor spell must not be counted in the walk. If
    // one collapse could fill both columns the pair would say one thing twice.
    expect(last.starveHours).not.toBe(last.floorStarveHours);
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
