/**
 * The exam.
 *
 * Two things are worth pinning here and they are not the arithmetic. The first
 * is that the founding cannot be *stumbled into* — a colony that is short of one
 * charter must never win, however long it is left running, because a win that
 * arrives on its own is the same as no win. The second is the clock: it has to
 * start, it has to reset when the colony slips, and it has to survive a save,
 * since three days is long enough that a player will close the tab in the middle
 * of one.
 */

import { describe, expect, it } from 'vitest';

import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { makePawn } from '../src/sim/pawn';
import { Rng } from '../src/sim/rng';
import { addBuilding, addItem, livingColonists } from '../src/sim/world';
import { RESEARCH_ORDER } from '../src/sim/research';
import { settlementsOf } from '../src/sim/settlements';
import { deserialize, serialize } from '../src/sim/save';
import { TICKS_PER_DAY, type World } from '../src/sim/types';
import {
  HOLD_DAYS,
  HOLD_TICKS,
  NEED_PEOPLE,
  bestStanding,
  charters,
  foundingLeft,
  hasWon,
  tickVictory,
} from '../src/sim/victory';

const VIEW = {
  mode: 'manager' as const,
  camera: { targetX: 32, targetY: 32, distance: 40, yaw: 0.8, pitch: 0.9 },
  possessedId: null,
};

function met(world: World): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of charters(world)) out[c.id] = c.met;
  return out;
}

/**
 * Stand a turret somewhere it will actually go up, and prove that it did.
 *
 * Two fixed coordinates used to stand here, and on most seeds both were open
 * ground. On seed 77 one of them was rock, `addBuilding` returned null, the
 * colony held one turret out of the two the charter asks for, and the test
 * failed several assertions later complaining that the founding clock had not
 * started — which is true, and says nothing about the founding clock. A fixture
 * that can half-build itself is a fixture that reports its own failures as
 * failures of the thing under test.
 */
function turret(world: World, near: { x: number; y: number }): void {
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (addBuilding(world, 'turret', near.x + dx, near.y + dy, true)) return;
      }
    }
  }
  throw new Error(`nowhere to stand a turret near ${near.x},${near.y}`);
}

/**
 * A colony that qualifies on every axis, and a storyteller told to stay away.
 *
 * The threat clock is pushed out on purpose: these tests are about the founding
 * clock, and a raid landing mid-hold is exactly the thing that legitimately
 * resets it — which is its own test below, run deliberately rather than by
 * whatever the seed felt like doing on day nine.
 */
function qualifying(seed = 4242): { world: World; streams: ReturnType<typeof makeStreams> } {
  const world = createWorld(seed);
  const rng = new Rng(99);
  while (livingColonists(world).length < NEED_PEOPLE) {
    makePawn(world, rng, 'colony', 30, 30);
  }
  // Food: meals are worth the most per unit, and this is well past twelve days
  // for eight mouths so the larder does not tip over mid-hold as they eat.
  addItem(world, 'meal', 400, 31, 34);
  turret(world, { x: 24, y: 30 });
  turret(world, { x: 24, y: 32 });
  for (const id of RESEARCH_ORDER.slice(0, 6)) {
    if (!world.research.done.includes(id)) world.research.done.push(id);
  }
  settlementsOf(world)[0].relations = 40;
  world.storyteller.nextThreat = TICKS_PER_DAY * 60;
  world.storyteller.nextScout = TICKS_PER_DAY * 60;
  world.storyteller.nextOutbreak = TICKS_PER_DAY * 60;
  return { world, streams: makeStreams(world) };
}

describe('the charters', () => {
  it('a fresh colony is short of the ones that take a colony to earn', () => {
    const world = createWorld(11);
    const m = met(world);
    expect(m.hearth).toBe(false);
    expect(m.guns).toBe(false);
    expect(m.knowledge).toBe(false);
    expect(m.ally).toBe(false);
    // Five axes, and every `met` agrees with its own numbers — the flag and the
    // bar are read off the same measure, so they can never disagree on screen.
    const list = charters(world);
    expect(list).toHaveLength(5);
    for (const c of list) expect(c.met).toBe(c.at >= c.of);
  });

  it('counts a settler who is away on the road', () => {
    const world = createWorld(12);
    const before = charters(world).find((c) => c.id === 'hearth')!.at;
    const rng = new Rng(7);
    const traveller = makePawn(world, rng, 'colony', 30, 30);
    world.pawns = world.pawns.filter((p) => p.id !== traveller.id);
    world.caravan = {
      pawn: traveller,
      settlementId: settlementsOf(world)[0].id,
      give: { kind: 'wood', amount: 40 },
      take: null,
      phase: 'outbound',
      dueTick: world.tick + 100,
      x: 0,
      y: 0,
    };
    // Somebody four days out buying medicine is still one of yours. A founding
    // that fell over because of it would read as a bug rather than a rule.
    expect(charters(world).find((c) => c.id === 'hearth')!.at).toBe(before + 1);
  });

  it('reports the best standing anywhere, not the first one it finds', () => {
    const world = createWorld(13);
    expect(bestStanding(world)).toBe(0);
    const places = settlementsOf(world);
    places[0].relations = 4;
    places[2].relations = 31;
    expect(bestStanding(world)).toBe(31);
  });
});

describe('the founding', () => {
  it('starts the clock, holds it, and founds the colony', () => {
    const { world, streams } = qualifying();
    expect(foundingLeft(world)).toBe(null);

    stepWorldN(world, streams, 40);
    // Every charter is met, so the clock is running and the log says so.
    expect(foundingLeft(world)).not.toBe(null);
    expect(world.messages.some((m) => m.text.includes('Every charter is met'))).toBe(true);
    expect(hasWon(world)).toBe(false);

    // Halfway through: still not founded. Three days is the whole design — a win
    // that lands the moment the last charter ticks over is a number changing.
    stepWorldN(world, streams, Math.round(HOLD_TICKS / 2));
    expect(hasWon(world)).toBe(false);
    expect(world.gameOver).toBe(false);
    expect(foundingLeft(world)!).toBeLessThan(HOLD_TICKS);

    stepWorldN(world, streams, HOLD_TICKS);
    expect(hasWon(world)).toBe(true);
    // Founded, and *not* over. These were the same flag once, and nine sim
    // passes read `gameOver` as "everybody is dead" — so the prize for winning
    // was that the Steward stopped planning, the events stopped firing and the
    // caravans stopped coming while the colony burned its woodpile down to zero.
    // See `tickVictory`.
    expect(world.gameOver).toBe(false);
    expect(world.messages.some((m) => m.text.includes('Aetherhold is founded'))).toBe(true);
  });

  it('keeps being a colony after it is founded', () => {
    const { world, streams } = qualifying(4242);
    stepWorldN(world, streams, HOLD_TICKS + 80);
    expect(hasWon(world)).toBe(true);

    // The passes that a win used to switch off, checked through the one gate
    // they all share rather than one at a time: `gameOver` is what every one of
    // them reads, and it has to still be false a fortnight after the founding.
    const built = world.stats.built;
    stepWorldN(world, streams, TICKS_PER_DAY * 3);
    expect(world.gameOver).toBe(false);
    // The foreman is the loudest of the nine — a founded colony with an idle
    // board and a standing Steward should still be putting things up.
    expect(world.stats.built).toBeGreaterThanOrEqual(built);
    expect(livingColonists(world).length).toBeGreaterThan(0);
  });

  it('resets the clock when the colony slips, and says which charter went', () => {
    const { world, streams } = qualifying(77);
    stepWorldN(world, streams, 40);
    expect(foundingLeft(world)).not.toBe(null);

    // A turret is lost — the sort of thing one raid does.
    const lost = world.buildings.find((b) => b.kind === 'turret')!;
    world.buildings = world.buildings.filter((b) => b.id !== lost.id);
    stepWorldN(world, streams, 40);

    expect(foundingLeft(world)).toBe(null);
    expect(hasWon(world)).toBe(false);
    const told = world.messages.filter((m) => m.text.includes('founding falters'));
    expect(told.length).toBe(1);
    expect(told[0].text).toContain('turrets');
    expect(told[0].kind).toBe('bad');

    // Put it back and the colony gets the full three days again, not the two it
    // had banked. That is the point of a hold.
    turret(world, { x: 24, y: 34 });
    stepWorldN(world, streams, 40);
    expect(foundingLeft(world)).toBeGreaterThan(HOLD_TICKS - TICKS_PER_DAY * 0.2);
  });

  it('never founds a colony that is short of one charter', () => {
    const { world, streams } = qualifying(1234);
    // Everything but the road. This is the charter that costs the most days, so
    // it is the one a colony is most likely to try to win without.
    settlementsOf(world)[0].relations = 0;
    stepWorldN(world, streams, TICKS_PER_DAY * (HOLD_DAYS + 2));
    expect(hasWon(world)).toBe(false);
    expect(foundingLeft(world)).toBe(null);
    expect(met(world).ally).toBe(false);
  });

  it('a wiped colony has not won', () => {
    const world = createWorld(5);
    const streams = makeStreams(world);
    for (const p of world.pawns) if (p.faction === 'colony') p.dead = true;
    stepWorldN(world, streams, 40);
    expect(world.gameOver).toBe(true);
    expect(hasWon(world)).toBe(false);
  });

  it('does not keep scoring after the run has ended', () => {
    const { world, streams } = qualifying(31);
    stepWorldN(world, streams, HOLD_TICKS + 80);
    expect(hasWon(world)).toBe(true);
    const founded = world.messages.filter((m) => m.text.includes('Aetherhold is founded')).length;
    const since = world.charter!.since;
    stepWorldN(world, streams, 200);
    // The world is still there and still tickable — the overlay is a HUD state,
    // not a torn-down sim, and the weather still turns — but nothing re-founds
    // it, restarts the clock or takes the win back.
    expect(hasWon(world)).toBe(true);
    expect(world.charter!.since).toBe(since);
    expect(world.messages.filter((m) => m.text.includes('Aetherhold is founded')).length).toBe(
      founded,
    );
  });
});

describe('the clock survives a save', () => {
  it('a colony saved mid-founding is founded on the other side', () => {
    const { world, streams } = qualifying(808);
    stepWorldN(world, streams, TICKS_PER_DAY);
    const left = foundingLeft(world);
    expect(left).not.toBe(null);
    expect(left!).toBeLessThan(HOLD_TICKS);

    const r = deserialize(serialize(world, VIEW, 1, 1_700_000_000_000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const loaded = r.save.world;
    // Not "a clock is running" — the *same* clock, with the days already served
    // still served.
    expect(foundingLeft(loaded)).toBe(left);

    stepWorldN(loaded, makeStreams(loaded), HOLD_TICKS);
    expect(hasWon(loaded)).toBe(true);
  });

  it('an old save loads with the clock stopped and starts it on its own', () => {
    const { world, streams } = qualifying(909);
    // Exactly what a colony written before there was a way to win looks like.
    delete world.charter;
    expect(foundingLeft(world)).toBe(null);
    tickVictory(world);
    stepWorldN(world, streams, 40);
    expect(foundingLeft(world)).not.toBe(null);
  });
});
