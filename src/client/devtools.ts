/**
 * `aether.*` in the browser console. Development builds only.
 *
 * Three of the systems worth testing are the three you cannot ask for: a fire, a
 * raid, and a fever. Waiting for the storyteller to send one is fine for playing
 * and useless for checking that the colony handles it, so this puts them on a
 * key. It is the same call the storyteller makes — nothing here is a second code
 * path, which is the whole rule: a debug hook that fakes the event proves
 * nothing about the event.
 *
 * The world is read through a getter rather than captured, because Load and
 * Restart both replace it and a console holding the old one would be inspecting
 * a colony that no longer exists.
 */

import { forceThreat, igniteFire } from '../sim/events';
import { afflict } from '../sim/health';
import { COURT_TICKS, courting } from '../sim/partners';
import { bondKey, bonds } from '../sim/social';
import { addBuilding, livingColonists } from '../sim/world';
import type { Streams } from '../sim/tick';
import type { BuildingKind, Pawn, World } from '../sim/types';

/**
 * The one piece of the client the console needs: where the manager camera is
 * pointed. Typed structurally rather than as the camera class so devtools stays
 * a leaf — it reads the sim and nudges the view, it does not know how either is
 * built.
 */
export interface DevCamera {
  focusOn(x: number, y: number): void;
  readonly target: { x: number; y: number };
}

export function installDevtools(
  world: () => World,
  streams: () => Streams,
  cam: DevCamera,
): void {
  if (!import.meta.env.DEV) return;
  const find = (who?: string | number) => {
    const living = livingColonists(world());
    if (who === undefined) return living[0] ?? null;
    if (typeof who === 'number') return living.find((p) => p.id === who) ?? null;
    const want = who.toLowerCase();
    return living.find((p) => p.name.toLowerCase().includes(want)) ?? null;
  };
  /** Two different living settlers, defaulting the second to anybody else. */
  const twoOf = (a?: string | number, b?: string | number): [Pawn, Pawn] | null => {
    const one = find(a);
    const other = find(b ?? -1) ?? livingColonists(world()).find((p) => p !== one) ?? null;
    return !one || !other || one === other ? null : [one, other];
  };
  const api = {
    /** The live sim state. Read it; writing to it is your own affair. */
    get world() {
      return world();
    },
    /** Light a cell, or let the storyteller pick something flammable. */
    fire(x?: number, y?: number) {
      if (x === undefined || y === undefined) forceThreat(world(), streams().story, 'fire');
      else igniteFire(world(), Math.round(x), Math.round(y));
      return world().fires.length;
    },
    /** Set the bed a settler is asleep in alight — the case fire safety exists for. */
    burnBed(who?: string | number) {
      const pawn = find(who);
      if (!pawn) return 'nobody by that name';
      igniteFire(world(), Math.round(pawn.x), Math.round(pawn.y));
      return `${pawn.name} is standing in a fire`;
    },
    /** A raid the size the storyteller would send right now. */
    raid() {
      forceThreat(world(), streams().story, 'raid');
      return world().pawns.filter((p) => p.faction === 'raider' && !p.dead).length;
    },
    /** A herd, which is also how a maddened animal arrives. */
    beasts() {
      forceThreat(world(), streams().story, 'beast');
    },
    /** Somebody running for the gate with slavers behind them. */
    refugee() {
      forceThreat(world(), streams().story, 'refugee');
      return world().pawns.filter((p) => p.faction === 'raider' && !p.dead).length;
    },
    /** Kill the grid for a day, which is the only way to see the cooler thaw. */
    flare() {
      forceThreat(world(), streams().story, 'flare');
      return world().storyteller.flareUntil ?? 'nothing electrical to knock out';
    },
    /** A herd crossing the map, for watching them actually cross it. */
    herd() {
      forceThreat(world(), streams().story, 'herd');
      return world().pawns.filter((p) => p.migrateTo !== undefined).length;
    },
    /** Fenwolves, for watching them come the whole way in and pick a pen. */
    pack() {
      forceThreat(world(), streams().story, 'pack');
      return world().pawns.filter((p) => p.hunts === true && !p.dead).length;
    },
    /** Give somebody the flu without waiting for a cold night. */
    ill(who?: string | number) {
      const pawn = find(who);
      if (!pawn) return 'nobody by that name';
      afflict(world(), pawn, 'flu');
      return `${pawn.name} has the flu`;
    },
    /**
     * Point the manager camera at a cell, and say where it ended up.
     *
     * Deliberately only moves the camera — it does not select anything. A test
     * that wants to know whether a thing can be clicked has to click it, and the
     * only reason that is hard from a console is that you cannot see the screen.
     * This fixes that and nothing else.
     */
    look(x?: number, y?: number) {
      if (x !== undefined && y !== undefined) cam.focusOn(x, y);
      return { ...cam.target };
    },
    /**
     * Stand a finished building on a cell, for looking at.
     *
     * The one debug hook here that is not an event: it exists because checking
     * that a new mesh reads correctly from the manager camera otherwise means
     * playing far enough to afford it. It calls the same `addBuilding` the build
     * queue calls and returns null on an occupied cell exactly as that does, so
     * what you end up looking at is the real thing rather than a mock of it.
     */
    build(kind: BuildingKind, x?: number, y?: number) {
      const at = x === undefined || y === undefined ? cam.target : { x, y };
      const b = addBuilding(world(), kind, Math.round(at.x), Math.round(at.y), true);
      return b ? { id: b.id, kind: b.kind, x: b.x, y: b.y } : 'cell taken';
    },
    /**
     * Put two settlers on the clock: as close as the game gets, as of now.
     *
     * The state a courtship actually spends most of its life in, and the one you
     * cannot otherwise reach without playing a fortnight. Shows up in the
     * inspector as `courting` on the next pairing pass; it will pair ten days
     * later on its own, exactly as a real one would.
     */
    court(a?: string | number, b?: string | number) {
      const two = twoOf(a, b);
      if (!two) return 'need two different settlers';
      const [one, other] = two;
      bonds(world())[bondKey(one.id, other.id)] = 95;
      courting(world())[bondKey(one.id, other.id)] = world().tick;
      return `${one.name} and ${other.name} are as close as it gets — ten days to go`;
    },
    /**
     * The same, with the ten days already behind them.
     *
     * A bond only reaches eighty after weeks of two people choosing each other
     * daily, and then has to stay there for ten days more, which is exactly right
     * for the game and impossible to sit through to check a mood row renders.
     * This writes the opinion and backdates the clock and leaves the rest alone:
     * the pairing itself still has to be earned by `tickPartners` on its own
     * schedule, so what you are watching is the real pass and not a mock of it.
     * Give it a minute of game time.
     */
    pair(a?: string | number, b?: string | number) {
      const two = twoOf(a, b);
      if (!two) return 'need two different settlers';
      const [one, other] = two;
      bonds(world())[bondKey(one.id, other.id)] = 95;
      courting(world())[bondKey(one.id, other.id)] = world().tick - COURT_TICKS;
      return `${one.name} and ${other.name} have waited long enough — give it a minute`;
    },
    /** Who is in the colony, by id, for the calls above. */
    who() {
      return livingColonists(world()).map((p) => `${p.id} ${p.name} (${p.activity})`);
    },
    help() {
      return [
        'aether.world            the live sim state',
        'aether.who()            colonist ids and names',
        'aether.fire(x?, y?)     light a cell, or let the storyteller choose',
        'aether.burnBed(who?)    light the cell a settler is standing or sleeping on',
        'aether.raid()           send a raid now',
        'aether.beasts()         send a maddened animal now',
        'aether.refugee()        somebody running in with slavers behind them',
        'aether.flare()          kill the grid for a day',
        'aether.herd()           send a herd across the map',
        'aether.ill(who?)        give somebody the flu',
        'aether.court(a?, b?)    make two settlers close enough, ten days short',
        'aether.pair(a?, b?)     the same, with the ten days already served',
        'aether.look(x?, y?)     point the manager camera at a cell, or ask where it is',
        'aether.build(kind, x?, y?)  stand a finished building on a cell, for looking at',
      ].join('\n');
    },
  };
  (window as unknown as { aether: typeof api }).aether = api;
}
