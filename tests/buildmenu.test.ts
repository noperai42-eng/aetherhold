/**
 * The build menu's shape, which is a UI bug waiting to happen if nobody watches it.
 *
 * The bar was one flat row for twenty-two buildings, and by the time the heaters
 * shipped it was 1994 px wide on a 1440 px screen: centred, so it overflowed both
 * edges, and Wall, Fence and Door — the first three things the game asks a player
 * to build — were laid out at negative x, where a click cannot reach them. A
 * ten-year-old found that before any test did. These assertions are the guard: a
 * building that is added to the game but not to a group is a tile that never
 * renders, and a group that grows past a handful is the old bug coming back.
 */

import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, BUILD_GROUPS, BUILD_MENU, defOf } from '../src/sim/buildings';
import type { BuildingKind } from '../src/sim/types';

/** Six tiles is about 700 px of bar — comfortable on the smallest laptop we care about. */
const MAX_PER_GROUP = 6;

describe('the build menu', () => {
  it('puts every building in exactly one group', () => {
    // Trees and rock are buildings to the collision code and to nobody else —
    // `buildable: false` is the def's own word for "not a blueprint".
    const kinds = (Object.keys(BUILDING_DEFS) as BuildingKind[]).filter(
      (k) => BUILDING_DEFS[k].buildable,
    );
    const seen = new Map<BuildingKind, number>();
    for (const group of BUILD_GROUPS) {
      for (const kind of group.kinds) seen.set(kind, (seen.get(kind) ?? 0) + 1);
    }
    // A kind in two groups renders two tiles that fight over the same `.on` state;
    // a kind in none is a building the player can never place.
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
    expect(kinds.filter((k) => !seen.has(k))).toEqual([]);
  });

  it('keeps BUILD_MENU as the flattened groups', () => {
    expect(BUILD_MENU).toEqual(BUILD_GROUPS.flatMap((g) => g.kinds));
  });

  it('keeps every group short enough to fit one row of a small screen', () => {
    for (const group of BUILD_GROUPS) {
      expect(group.kinds.length, `${group.name} has too many tiles`).toBeLessThanOrEqual(
        MAX_PER_GROUP,
      );
      expect(group.kinds.length, `${group.name} is empty`).toBeGreaterThan(0);
    }
  });

  it('gives every tile something to print', () => {
    for (const kind of BUILD_MENU) {
      const def = defOf(kind);
      expect(def.label.length).toBeGreaterThan(0);
      // A tile with no cost prints an em dash, which is fine; a tile with a cost
      // of zero of something is a def somebody half-edited.
      for (const [res, n] of Object.entries(def.cost)) {
        expect(n, `${kind} costs ${n} ${res}`).toBeGreaterThan(0);
      }
    }
  });

  it('never binds one digit to two buildings', () => {
    const byKey = new Map<string, BuildingKind[]>();
    for (const kind of BUILD_MENU) {
      const key = defOf(kind).hotkey;
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), kind]);
    }
    expect([...byKey].filter(([, kinds]) => kinds.length > 1)).toEqual([]);
  });
});
