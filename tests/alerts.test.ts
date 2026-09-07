/**
 * The alert strip.
 *
 * Both defects fixed the day this was written were silent: a hundred steel in
 * piles too small to build from, and settlers burning in their beds. Neither
 * showed up anywhere on screen. So the rule these tests hold to is not "an alert
 * exists" but "the alert appears while the player can still do something about
 * it, and goes away by itself when they have".
 */

import { describe, expect, it } from 'vitest';
import { alerts, foodDays, fuelHours } from '../src/sim/alerts';
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { addItem, countResource, livingColonists, takeResource } from '../src/sim/world';
import { tickPower, WOOD_BURN_TICKS } from '../src/sim/power';
import { igniteFire } from '../src/sim/events';
import { afflict } from '../src/sim/health';
import { isBed } from '../src/sim/buildings';
import { settlementsOf, specialty } from '../src/sim/settlements';
import { colonyCanCraft } from '../src/sim/crafting';
import { TICKS_PER_DAY, type Pawn, type World } from '../src/sim/types';
import { BREAK_MOOD } from '../src/sim/needs';

const ids = (world: World): string[] => alerts(world).map((a) => a.id);
const find = (world: World, id: string) => alerts(world).find((a) => a.id === id);

/**
 * Leave the colony with exactly one pair of hands that can brew balm.
 *
 * Returns the world and the settler everything now rests on. Both doors into
 * the recipe are shut on everybody else, because a colony where a second person
 * is a doctor is a colony that is fine and would prove nothing.
 */
function onlyHerbalist(world: World): [World, Pawn] {
  for (const p of livingColonists(world)) {
    p.skills.plants = 0;
    p.skills.medicine = 0;
  }
  const only = livingColonists(world)[0]!;
  only.skills.plants = 6;
  return [world, only];
}

/** Strip every scrap of food out of the colony, carried stacks included. */
function starve(world: World): void {
  world.items = world.items.filter((s) => s.kind !== 'rawfood' && s.kind !== 'meal');
  for (const p of world.pawns) {
    if (p.carryingItemId !== null && !world.items.some((s) => s.id === p.carryingItemId)) {
      p.carryingItemId = null;
    }
  }
}

describe('alerts', () => {
  it('says nothing about a colony that is fine', () => {
    expect(alerts(createWorld(1337))).toEqual([]);
  });

  it('says nothing at all once everyone is dead', () => {
    const world = createWorld(1337);
    for (const p of livingColonists(world)) p.dead = true;
    igniteFire(world, 30, 30);
    expect(alerts(world)).toEqual([]);
  });

  it('raises a fire where the fire is, and drops it when the fire is out', () => {
    const world = createWorld(1337);
    igniteFire(world, 28, 30);
    const a = find(world, 'fire');
    expect(a?.level).toBe('urgent');
    expect(a?.at).toEqual({ x: 28, y: 30 });
    world.fires = [];
    expect(ids(world)).not.toContain('fire');
  });

  it('counts hostiles but not the ones already down', () => {
    const world = createWorld(1337);
    const raiders = livingColonists(world)
      .slice(0, 2)
      .map((p) => ({ ...p, id: world.nextId++, faction: 'raider' as const }));
    world.pawns.push(...raiders);
    expect(find(world, 'raid')?.text).toBe('2 hostiles on the map');
    raiders[0]!.downed = true;
    expect(find(world, 'raid')?.text).toBe('1 hostile on the map');
  });

  it('names the settler who is down and points at them', () => {
    const world = createWorld(1337);
    const p = livingColonists(world)[0]!;
    p.downed = true;
    const a = find(world, `downed:${p.id}`);
    expect(a?.level).toBe('urgent');
    expect(a?.text).toContain(p.name);
    expect(a?.pawnId).toBe(p.id);
  });

  it('warns about the pantry before it is empty and shouts when it is', () => {
    const world = createWorld(1337);
    expect(ids(world)).not.toContain('food');

    starve(world);
    // Three days' worth: enough to plan with, not enough to ignore.
    addItem(world, 'meal', Math.ceil(3 * 0.82 * livingColonists(world).length * 2), 34, 34);
    expect(find(world, 'food')?.level).toBe('warn');
    expect(foodDays(world)).toBeGreaterThan(1.5);

    starve(world);
    expect(find(world, 'food')?.level).toBe('urgent');
    expect(find(world, 'food')?.text).toBe('No food left');
  });

  it('flags an illness nobody has treated, and stops once somebody has', () => {
    const world = createWorld(1337);
    const p = livingColonists(world)[0]!;
    afflict(world, p, 'flu');
    expect(find(world, `untended:${p.id}`)?.level).toBe('urgent');
    p.ailments![0]!.tendedUntil = world.tick + 100;
    expect(ids(world)).not.toContain(`untended:${p.id}`);
  });

  it('separates a settler who is about to break from one who already has', () => {
    const world = createWorld(1337);
    const [a, b] = livingColonists(world);
    a!.mood = BREAK_MOOD - 0.01;
    expect(find(world, `mood:${a!.id}`)?.level).toBe('warn');

    b!.mood = BREAK_MOOD - 0.01;
    b!.breakTicks = 200;
    // The one who has downed tools is urgent and appears once, not twice: the
    // near-break warning is about somebody the player can still head off.
    expect(find(world, `break:${b!.id}`)?.level).toBe('urgent');
    expect(ids(world)).not.toContain(`mood:${b!.id}`);
  });

  it('counts the settlers with nowhere to sleep', () => {
    const world = createWorld(1337);
    expect(ids(world)).not.toContain('beds');
    const beds = world.buildings.filter((x) => x.built && isBed(x.kind));
    beds[0]!.built = false;
    expect(find(world, 'beds')?.text).toBe('1 settler sleeping rough');
    beds[1]!.built = false;
    expect(find(world, 'beds')?.text).toBe('2 settlers sleeping rough');
  });

  it('counts the settlers with nothing to fight with', () => {
    const world = createWorld(1337);
    for (const p of livingColonists(world)) p.weapon = 'club';
    expect(ids(world)).not.toContain('unarmed');
    livingColonists(world)[0]!.weapon = 'none';
    expect(find(world, 'unarmed')?.text).toBe('1 settler unarmed');
  });

  it('says when the grid is short', () => {
    const world = createWorld(1337);
    expect(ids(world)).not.toContain('power');
    world.power = { supply: 0, demand: 40, stored: 0, capacity: 0, shed: 2, warnTick: 0 };
    expect(find(world, 'power')?.text).toBe('Grid short — 2 buildings off');
  });

  it('says which resource a blueprint is waiting on, and clears when it arrives', () => {
    const world = createWorld(1337);
    world.items = world.items.filter((s) => s.kind !== 'steel');
    const stalled = {
      ...world.buildings.find((b) => b.built)!,
      id: world.nextId++,
      kind: 'turret' as const,
      built: false,
      needs: { steel: 40 },
      have: {},
    };
    world.buildings.push(stalled);
    expect(find(world, 'stalled:steel')?.text).toBe('1 blueprint waiting on steel');

    addItem(world, 'steel', 40, 34, 34);
    expect(ids(world)).not.toContain('stalled:steel');
  });

  it('puts what kills you first', () => {
    const world = createWorld(1337);
    starve(world);
    for (const p of livingColonists(world)) p.weapon = 'none';
    igniteFire(world, 30, 30);
    const list = alerts(world);
    const firstWarn = list.findIndex((a) => a.level === 'warn');
    expect(list[0]!.id).toBe('fire');
    // No urgent alert may appear after the first warning.
    expect(list.slice(firstWarn).every((a) => a.level === 'warn')).toBe(true);
  });

  // -------------------------------------------------------------- experience

  it('keeps telling the truth about the pantry through six played days', () => {
    const world = createWorld(20260801);
    const streams = makeStreams(world);
    starve(world);
    expect(find(world, 'food')?.level).toBe('urgent');

    // Six days of a real colony: settlers eat, hunt, harvest, cook, and food
    // rots. The readout has to track all of that, not just the moment it fired.
    let low = Infinity;
    let high = 0;
    for (let t = 0; t < TICKS_PER_DAY * 6; t += 20) {
      stepWorldN(world, streams, 20);
      const days = foodDays(world);
      low = Math.min(low, days);
      high = Math.max(high, days);
      const a = find(world, 'food');
      expect(Boolean(a)).toBe(days < 4);
      if (a) expect(a.level).toBe(days < 1.5 ? 'urgent' : 'warn');
    }
    // The pantry genuinely moved over those days, so the check above was not
    // being asked the same question sixty times.
    expect(high - low).toBeGreaterThan(1);
    expect(livingColonists(world).length).toBeGreaterThan(0);
  });

  it('raises a fire the settlers then put out on their own', () => {
    const world = createWorld(20260801);
    const streams = makeStreams(world);
    const p = livingColonists(world)[0]!;
    igniteFire(world, Math.round(p.x), Math.round(p.y));
    expect(find(world, 'fire')?.level).toBe('urgent');

    let cleared = false;
    for (let t = 0; t < TICKS_PER_DAY && !cleared; t += 10) {
      stepWorldN(world, streams, 10);
      cleared = !ids(world).includes('fire');
    }
    expect(cleared).toBe(true);
    expect(world.fires).toEqual([]);
    // And the colony is still standing, which is the only reason the alert had
    // any value: it was raised while the fire was one cell wide.
    expect(livingColonists(world).length).toBeGreaterThan(0);
  });

  it('nags about medicine only while there is none', () => {
    const world = createWorld(1337);
    expect(ids(world)).not.toContain('medicine');
    world.items = world.items.filter((s) => s.kind !== 'medicine');
    expect(find(world, 'medicine')?.level).toBe('warn');
    addItem(world, 'medicine', 3, 34, 34);
    expect(countResource(world, 'medicine')).toBe(3);
    expect(ids(world)).not.toContain('medicine');
  });

  it('tells a colony with no herbalist what it is short of, not what to click', () => {
    const world = createWorld(1337);
    world.items = world.items.filter((s) => s.kind !== 'medicine');
    for (const p of livingColonists(world)) {
      p.skills.plants = 1;
      p.skills.medicine = 1;
    }
    // "Craft it at a workbench" sends this player to stand in front of a bench
    // that will not offer them the job. The alert has to name the missing trade,
    // which is also how they find out the road exists.
    const hint = find(world, 'medicine')?.hint ?? '';
    expect(hint).toContain('Nobody here is a herbalist at 5 or a doctor at 4.');

    livingColonists(world)[0]!.skills.plants = 5;
    expect(find(world, 'medicine')?.hint).toBe(
      'Craft it at a workbench from raw food, or buy it from a caravan.',
    );
  });

  it('sends them somewhere that exists, or does not send them at all', () => {
    // The advice is worth four days of walking, so it has to be true. On a map
    // with a brewing neighbour the alert names them; on a map without one it
    // stops pretending there is a road to walk and points at the pedlar.
    const named = createWorld(1337);
    named.items = named.items.filter((s) => s.kind !== 'medicine');
    for (const p of livingColonists(named)) {
      p.skills.plants = 1;
      p.skills.medicine = 1;
    }
    const brewer = settlementsOf(named).find((s) => {
      const t = specialty(s);
      return t === 'balm' || t === 'medicine';
    });
    const hint = find(named, 'medicine')?.hint ?? '';
    if (brewer) {
      expect(hint).toContain(brewer.name);
      expect(hint).toContain('pedlar');
    } else {
      expect(hint).not.toContain('neighbour');
      expect(hint).toContain('herbalism 5');
    }

    // And a map with no brewer anywhere: the hint must not invent a town, and
    // must still leave the player a way out.
    //
    // This used to be seed 7302, which the survey had turned up as the one map
    // in the sweep with nobody brewing. It is not that map any more — the world
    // went from four places to twelve and eight of the new ones sell medicine,
    // so a map with no brewer on it is now rare enough that pinning the test to
    // a seed is pinning it to a coincidence. The situation is built instead,
    // which is what the branch was ever about: the alert has to cope with there
    // being nobody, however the map came to be that way.
    const alone = createWorld(7302);
    alone.items = alone.items.filter((s) => s.kind !== 'medicine');
    for (const p of livingColonists(alone)) {
      p.skills.plants = 1;
      p.skills.medicine = 1;
    }
    for (const s of settlementsOf(alone)) {
      const t = specialty(s);
      if (t === 'balm' || t === 'medicine') s.craft = null;
    }
    expect(
      settlementsOf(alone).some((s) => {
        const t = specialty(s);
        return t === 'balm' || t === 'medicine';
      }),
    ).toBe(false);
    expect(find(alone, 'medicine')?.hint).toContain('pedlar');
  });

  it('says nothing about a one-person trade on a calm morning', () => {
    // A colony of three has exactly one hand for everything it can do. That is
    // not a fault, it is a colony of three, and a panel that opens complaining
    // about it teaches the player to stop opening the panel.
    const world = onlyHerbalist(createWorld(1337))[0];
    expect(colonyCanCraft(world, 'balm')).toBe(true);
    expect(ids(world)).not.toContain('sole');
  });

  it('raises it the moment the only one who can is in the fight', () => {
    const [world, only] = onlyHerbalist(createWorld(1337));
    only.drafted = true;
    const a = find(world, 'sole');
    expect(a?.text).toBe(`Only ${only.name} brews healing balm`);
    expect(a?.level).toBe('warn');
    // Clickable, and it points at them: the row's whole job is "reach this one".
    expect(a?.pawnId).toBe(only.id);
    expect(a?.at).toEqual({ x: Math.round(only.x), y: Math.round(only.y) });
    // Why now, and the way out of ever being here again.
    expect(a?.hint).toBe('They are drafted and nobody else here can. Pull them off the line.');
  });

  it('raises it when the only one who can is the one lying on the floor', () => {
    const [world, only] = onlyHerbalist(createWorld(1337));
    only.downed = true;
    // Three settlers down and one stretcher: this is the row that says which.
    expect(find(world, 'sole')?.hint).toContain('are down');
    expect(ids(world)).toContain(`downed:${only.id}`);
  });

  it('raises it while raiders are on the map, and drops it when they are gone', () => {
    const [world, only] = onlyHerbalist(createWorld(1337));
    expect(ids(world)).not.toContain('sole');
    const raider = { ...only, id: world.nextId++, faction: 'raider' as const };
    world.pawns.push(raider);
    expect(find(world, 'sole')?.hint).toContain('raiders about');
    raider.dead = true;
    expect(ids(world)).not.toContain('sole');
  });

  it('drops it the moment somebody else can do the job', () => {
    const [world, only] = onlyHerbalist(createWorld(1337));
    only.drafted = true;
    expect(ids(world)).toContain('sole');
    const second = livingColonists(world).find((p) => p.id !== only.id)!;
    second.skills.plants = 6;
    // Two hands. The trade survives losing either, so there is nothing to say.
    expect(ids(world)).not.toContain('sole');
  });

  it('does not mourn a trade the colony never had', () => {
    const world = createWorld(1337);
    for (const p of livingColonists(world)) {
      p.skills.plants = 0;
      p.skills.medicine = 0;
      p.drafted = true;
    }
    expect(colonyCanCraft(world, 'balm')).toBe(false);
    // Nobody can brew, so nobody is the only one who can. The workbench row and
    // the medicine alert are where a colony without a herbalist gets told.
    const a = find(world, 'sole');
    expect(a?.text ?? '').not.toContain('balm');
  });

  it('folds the doctor who holds two trades into one line', () => {
    const [world, only] = onlyHerbalist(createWorld(1337));
    // Balm is the only recipe a colony starts able to make; proper medicine
    // wants the project finished first, which is the state this test is about.
    world.research.done.push('fieldmedicine');
    only.skills.medicine = 9;
    only.drafted = true;
    expect(colonyCanCraft(world, 'medicine')).toBe(true);
    const a = find(world, 'sole');
    // One person, two recipes, one row — four lines about one settler is the
    // same wallpaper in a different shape.
    // Listed in the workbench's own order, so the row and the bench agree.
    expect(a?.text).toBe(`Only ${only.name} makes medicine and healing balm`);
    expect(alerts(world).filter((x) => x.id === 'sole')).toHaveLength(1);
    // The text already carries both recipes, so the hint stays the short one.
    expect(a?.hint).toBe('They are drafted and nobody else here can. Pull them off the line.');
  });
});

describe('what a player does about it', () => {
  it('tells a colony under attack which settler to pull back', () => {
    // The scenario the row exists for: the raid siren is up, four names are on
    // the panel, and the player has one round of orders to spend. Only one of
    // those names takes a recipe with them.
    const world = createWorld(1337);
    const streams = makeStreams(world);
    stepWorldN(world, streams, TICKS_PER_DAY);
    const [, only] = onlyHerbalist(world);
    const raider = { ...only, id: world.nextId++, faction: 'raider' as const, x: 10, y: 10 };
    world.pawns.push(raider);

    const panel = alerts(world);
    const row = panel.find((a) => a.id === 'sole');
    expect(row).toBeDefined();
    // It names the person, so the player knows who without cross-referencing
    // eight skill numbers on eight inspector panels while shots are landing.
    expect(row!.text).toContain(only.name);
    expect(row!.pawnId).toBe(only.id);
    // And it sits under the raid, not over it: shooting outranks bookkeeping.
    expect(panel.indexOf(row!)).toBeGreaterThan(panel.findIndex((a) => a.id === 'raid'));
  });
});

/**
 * The other pantry.
 *
 * Wood is the only resource in this colony that is spent by machines rather than
 * by people, which is why it was the only one nothing on screen ever counted. A
 * generator eats a log every fifteen minutes of colony time while the grid is
 * short and a campfire eats one every thirteen while its room is cold, and the
 * first line either of them earned was `Grid short - N buildings off` — a
 * sentence that is only ever printed after the cold store has already stopped.
 * These tests hold the row to the same rule as the rest of the strip: it appears
 * while there is still daylight to fell a tree in, and it goes away by itself.
 */
describe('the woodpile', () => {
  it('says nothing to a colony with a winter of wood in the yard', () => {
    const world = createWorld(1337);
    expect(countResource(world, 'wood')).toBeGreaterThan(0);
    expect(ids(world)).not.toContain('fuel');
  });

  it('counts nothing at all in a colony where nothing burns wood', () => {
    const world = createWorld(1337);
    for (const b of world.buildings) if (b.kind === 'generator') b.built = false;
    // Not zero hours — no hours. A colony with no fires is not running out of
    // fuel, and an urgent row saying it was would be the strip crying wolf on
    // every solar-and-batteries colony in the game.
    expect(fuelHours(world)).toBeNull();
    expect(ids(world)).not.toContain('fuel');
  });

  it('warns while there is still a working day in the pile, and shouts on the last log', () => {
    const world = createWorld(1337);
    takeResource(world, 'wood', 10_000);
    // One generator burning one log every WOOD_BURN_TICKS is four and a half
    // hours a log, so two logs is most of a night.
    addItem(world, 'wood', 2, 34, 34);
    expect(fuelHours(world)).toBeCloseTo(9, 6);
    expect(find(world, 'fuel')?.level).toBe('warn');
    expect(find(world, 'fuel')?.text).toContain('9 hours');

    takeResource(world, 'wood', 10_000);
    expect(find(world, 'fuel')?.level).toBe('urgent');
    expect(find(world, 'fuel')?.text).toBe('No wood left to burn');
  });

  it('does not count a generator a flare has stopped from turning over', () => {
    const world = createWorld(1337);
    takeResource(world, 'wood', 10_000);
    addItem(world, 'wood', 1, 34, 34);
    expect(find(world, 'fuel')?.level).toBe('warn');

    world.storyteller.flareUntil = world.tick + TICKS_PER_DAY;
    // The grid is dead and the firebox is cold, so the woodpile is not being
    // spent at all — and the flare row is already saying the true thing about
    // the same hour. Two rows for one outage is how a strip stops being read.
    expect(fuelHours(world)).toBeNull();
    expect(ids(world)).not.toContain('fuel');
    expect(ids(world)).toContain('flare');

    world.storyteller.flareUntil = 0;
    expect(ids(world)).toContain('fuel');
  });
});

describe('who is actually coming for the settler on the floor', () => {
  it('promises a doctor when one really can come', () => {
    const world = createWorld(1337);
    const p = livingColonists(world)[0]!;
    p.downed = true;
    expect(find(world, `downed:${p.id}`)?.hint).toContain('Doctor priority will come');
  });

  it('does not promise one to a colony lying unconscious in its own yard', () => {
    const world = createWorld(1337);
    const all = livingColonists(world);
    expect(all.length).toBeGreaterThan(1);
    for (const p of all) p.downed = true;

    const rows = alerts(world).filter((a) => a.id.startsWith('downed:'));
    // The defect, exactly: one row per body, every one of them saying help was
    // on its way, on the afternoon that sentence was most completely false.
    expect(rows).toHaveLength(all.length);
    expect(rows.every((a) => !a.hint.includes('will come'))).toBe(true);
    expect(rows[0]!.hint).toContain('Nobody is on their feet');
  });

  it('names the draft when everyone still standing is holding a rifle', () => {
    const world = createWorld(1337);
    const [patient, ...rest] = livingColonists(world);
    patient!.downed = true;
    for (const p of rest) p.drafted = true;
    // The commonest way to lose somebody the game had already saved: the raid
    // ends, one settler is down, and the survivors stay drafted because nothing
    // says undrafting them is the thing that fetches the stretcher.
    expect(find(world, `downed:${patient!.id}`)?.hint).toContain('Undraft one with T');
  });

  it('names the work board when nobody has doctoring switched on', () => {
    const world = createWorld(1337);
    const [patient, ...rest] = livingColonists(world);
    patient!.downed = true;
    for (const p of rest) p.priorities.doctor = 0;
    expect(find(world, `downed:${patient!.id}`)?.hint).toContain('work board');
  });

  it('says feed them first when the only hands left are starving too', () => {
    const world = createWorld(1337);
    const [patient, ...rest] = livingColonists(world);
    patient!.downed = true;
    for (const p of rest) p.needs.food = 0;
    // `jobs.ts` refuses the errand at this point on purpose — a rescuer running
    // on empty deals with that first or two die instead of one — so the hint
    // has to name the food, not the stretcher.
    expect(find(world, `downed:${patient!.id}`)?.hint).toContain('starving themselves');
  });
});

// -------------------------------------------------------------- experience

describe('a colony that runs out of wood', () => {
  it('hears about the woodpile before the grid starts shedding, not after', () => {
    const world = createWorld(1337);
    tickPower(world);
    expect(world.power!.shed).toBe(0);
    expect(ids(world)).not.toContain('fuel');

    takeResource(world, 'wood', 10_000);
    addItem(world, 'wood', 2, 34, 34);
    tickPower(world);

    // Nine hours of notice, with the lamps still lit and nothing yet lost.
    expect(ids(world)).toContain('fuel');
    expect(ids(world)).not.toContain('power');
    expect(world.power!.shed).toBe(0);

    // And here is the row the player used to get first. Everything it reports
    // has already happened.
    for (let t = 0; t < WOOD_BURN_TICKS * 3; t++) tickPower(world);
    expect(world.power!.shed).toBeGreaterThan(0);
    expect(ids(world)).toContain('power');
    expect(ids(world)).toContain('fuel');
  });
});
