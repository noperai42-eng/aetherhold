/**
 * Carrying a colony to a different address.
 *
 * Ranked by what it would cost a player if it broke. Worst is a code that
 * imports *cleanly* into a subtly different colony — the player keeps going and
 * only finds out days later, with no way back. Next worst is a code that will
 * not import at all, because by the time anyone reaches for it the original
 * origin is usually already unreachable; that is the entire situation this
 * feature exists for. After that: a code so big the clipboard mangles it, and a
 * damaged paste that throws instead of saying what is wrong.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { serialize } from '../src/sim/save';
import { colonyFilename, exportColony, importColony } from '../src/sim/transfer';
import { SAVE_VERSION, type World } from '../src/sim/types';
import { livingColonists } from '../src/sim/world';

const VIEW = {
  mode: 'manager' as const,
  possessedId: null,
  camera: { targetX: 3, targetY: 7, distance: 22, yaw: 0.5, pitch: 1.1 },
};

function saveTextOf(world: World, speed = 1): string {
  return serialize(world, VIEW, speed, 1_760_000_000_000);
}

/** A colony with some history behind it — a fresh one hides ordering bugs. */
function playedColony(seed = 4242, days = 3): World {
  const world = createWorld(seed);
  stepWorldN(world, makeStreams(world), 4800 * days);
  return world;
}

describe('a colony code', () => {
  it('carries the whole colony, not a summary of it', async () => {
    const world = playedColony();
    const code = await exportColony(saveTextOf(world));
    const res = await importColony(code);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const back = res.save.world;
    expect(back.tick).toBe(world.tick);
    expect(back.seed).toBe(world.seed);
    expect(back.width).toBe(world.width);
    expect(back.terrain.length).toBe(world.terrain.length);
    expect(back.pawns.map((p) => p.name)).toEqual(world.pawns.map((p) => p.name));
    expect(back.buildings.length).toBe(world.buildings.length);
    expect(back.stats).toEqual(world.stats);
  });

  it('brings the view across too, so you land where you left off', async () => {
    const world = playedColony();
    const res = await importColony(await exportColony(saveTextOf(world, 3)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.save.speed).toBe(3);
    expect(res.save.view.camera).toEqual(VIEW.camera);
    expect(res.save.v).toBe(SAVE_VERSION);
  });

  it('is small enough to survive a clipboard', async () => {
    const raw = saveTextOf(playedColony());
    const code = await exportColony(raw);
    // The point of compressing at all. 220 kB of JSON is enough to defeat a
    // phone clipboard; a quarter of that is the ceiling this stays under.
    expect(code.length).toBeLessThan(raw.length * 0.25);
    expect(code.startsWith('AETHERHOLD')).toBe(true);
  });

  it('says what it is at a glance, so a player knows they have the whole thing', async () => {
    const code = await exportColony(saveTextOf(createWorld(11)));
    expect(code.startsWith('AETHERHOLD1:')).toBe(true);
    expect(code.includes('\n')).toBe(false);
  });
});

describe('a code that has been through a mail client', () => {
  it('still imports after line wrapping and stray spaces', async () => {
    const world = playedColony(777, 2);
    const code = await exportColony(saveTextOf(world));
    // What a mail body, a chat app and a hand-made selection each do to it.
    const wrapped = code.replace(/(.{72})/g, '$1\n');
    const mangled = `\n\n  ${wrapped}  \n`;

    const res = await importColony(mangled);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.save.world.tick).toBe(world.tick);
  });

  it('takes raw save JSON as well, for anyone who opens the file and copies the guts', async () => {
    const world = playedColony(31, 1);
    const res = await importColony(saveTextOf(world));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.save.world.tick).toBe(world.tick);
  });

  it('reads the uncompressed format, so a code made on an older browser still opens here', async () => {
    const world = playedColony(99, 1);
    const raw = saveTextOf(world);
    const bytes = new TextEncoder().encode(raw);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const plain = `AETHERHOLD0:${btoa(bin)}`;
    const res = await importColony(plain);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.save.world.tick).toBe(world.tick);
  });
});

describe('a code that is wrong', () => {
  it('is refused, not thrown, when it is not a colony at all', async () => {
    const res = await importColony('hello, is this the game?');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('corrupt');
    // The message has to name the thing to look for — a player who pasted half
    // a mail body cannot act on "corrupt".
    expect(res.detail).toContain('AETHERHOLD');
  });

  it('is refused when the paste was cut short', async () => {
    const code = await exportColony(saveTextOf(createWorld(5)));
    const res = await importColony(code.slice(0, Math.floor(code.length * 0.6)));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('corrupt');
  });

  it('tells an empty box apart from a damaged one', async () => {
    const res = await importColony('   \n  ');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('empty');
  });

  it('refuses a colony from an incompatible build by version, not by crashing', async () => {
    const env = JSON.parse(saveTextOf(createWorld(8))) as { v: number };
    env.v = SAVE_VERSION + 5;
    const res = await importColony(await exportColony(JSON.stringify(env)));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('version');
  });
});

describe('the file it downloads', () => {
  it('is named so a folder of them can be told apart', () => {
    expect(colonyFilename(12, new Date(2026, 7, 2))).toBe('aetherhold-day12-2026-08-02.txt');
    expect(colonyFilename(3, new Date(2026, 10, 25))).toBe('aetherhold-day3-2026-11-25.txt');
  });
});

describe('a player whose address changed overnight', () => {
  it('pastes the code into the new browser and gets the same colony, with the same future', async () => {
    // The colony as it stood on the old address.
    const before = playedColony(20260802, 4);
    const survivors = livingColonists(before).map((p) => p.name);
    const code = await exportColony(saveTextOf(before));

    // A different browser: nothing in storage, nothing in common but the text.
    const res = await importColony(code);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = res.save.world;

    expect(livingColonists(after).map((p) => p.name)).toEqual(survivors);
    expect(after.tick).toBe(before.tick);

    // The real claim. RNG state rides along in `world.rng`, so the carried
    // colony does not merely *look* like the one left behind — it has the same
    // future. Play both on for two more days and they agree tick for tick; if
    // they did not, the player would have been handed a lookalike and would
    // never know which raids they were supposed to get.
    stepWorldN(before, makeStreams(before), 4800 * 2);
    stepWorldN(after, makeStreams(after), 4800 * 2);

    expect(after.tick).toBe(before.tick);
    expect(after.rng).toEqual(before.rng);
    expect(livingColonists(after).map((p) => p.name)).toEqual(
      livingColonists(before).map((p) => p.name),
    );
    expect(after.stats).toEqual(before.stats);
    expect(after.buildings.length).toBe(before.buildings.length);
  });
});
