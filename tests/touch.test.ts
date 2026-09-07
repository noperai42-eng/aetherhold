/**
 * Playing with fingers.
 *
 * The game was built for a mouse and a keyboard, and on a tablet that meant a
 * dead screen: `Input` listened for `mousedown`, `mousemove` and `wheel`, and iOS
 * fires none of them for a drag. Four things had to learn touch, so there are four
 * blocks here — the raw gesture reader in `Input` (was that a tap, a drag or a
 * pinch?), the manager's reading of it (what does a drag *mean* right now?), the
 * thumb pad that stands in for a keyboard, and first person driven by the two of
 * them together. Each is driven exactly the way the render loop drives it.
 */

import { describe, expect, it } from 'vitest';

import { FpsController } from '../src/client/fps/controller';
import { ManagerCamera } from '../src/client/manager/camera';
import { ManagerController } from '../src/client/manager/controller';
import { Input } from '../src/client/input/input';
import { Rng } from '../src/sim/rng';
import { TouchControls } from '../src/client/input/touch-controls';
import { buildingAt } from '../src/sim/grid';
import { canPlace, possess, setDrafted } from '../src/sim/orders';
import { livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import type { World } from '../src/sim/types';

// ---------------------------------------------------------------- fake browser

interface Stub {
  addEventListener(type: string, fn: (e: unknown) => void): void;
  removeEventListener(type: string, fn: (e: unknown) => void): void;
  fire(type: string, ev: unknown): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture(id: number): void;
  releasePointerCapture(id: number): void;
}

/** Just enough of an element for `Input` to bind to and for a test to poke. */
function stub(): Stub {
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  return {
    addEventListener(type, fn) {
      const list = handlers.get(type) ?? [];
      list.push(fn);
      handlers.set(type, list);
    },
    removeEventListener(type, fn) {
      handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== fn));
    },
    fire(type, ev) {
      for (const fn of handlers.get(type) ?? []) fn(ev);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  };
}

/** A `pointerdown`/`move`/`up` as the browser would deliver it for one finger. */
function touchEvent(id: number, x: number, y: number, type = 'touch'): unknown {
  return { pointerId: id, pointerType: type, clientX: x, clientY: y, preventDefault: () => {} };
}

/** `Input` binds to `window` and `document`; in node neither exists. */
function withBrowser<T>(fn: (el: Stub, win: Stub) => T): T {
  const g = globalThis as Record<string, unknown>;
  const el = stub();
  const win = stub();
  const doc = stub();
  const hadWindow = 'window' in g;
  const hadDoc = 'document' in g;
  const hadEl = 'HTMLElement' in g;
  const oldWindow = g.window;
  const oldDoc = g.document;
  const oldEl = g.HTMLElement;
  g.window = win;
  g.document = doc;
  // `isTypingTarget` asks `t instanceof HTMLElement`, and `instanceof` against an
  // undefined right-hand side is a TypeError rather than a false. Any key event
  // fired at the window without this throws inside the listener.
  g.HTMLElement = class {};
  try {
    return fn(el, win);
  } finally {
    if (hadWindow) g.window = oldWindow;
    else delete g.window;
    if (hadDoc) g.document = oldDoc;
    else delete g.document;
    if (hadEl) g.HTMLElement = oldEl;
    else delete g.HTMLElement;
  }
}

function reader(el: Stub): Input {
  return new Input(el as unknown as HTMLElement);
}

// ------------------------------------------------------- the gesture reader

describe('Input reads fingers', () => {
  it('calls a touch that goes down and comes straight back up a tap', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 500, 400));
      el.fire('pointerup', touchEvent(1, 500, 400));

      expect(input.tapped).toBe(true);
      expect(input.dragging).toBe(false);
      expect(input.dragStarted).toBe(false);
      // A tap has to leave a position behind, or the view has nothing to pick with.
      expect(input.ndcX).toBeCloseTo(0, 5);
      expect(input.ndcY).toBeCloseTo(0, 5);
      expect(input.touchSeen).toBe(true);
    });
  });

  it('calls a touch that travels a drag, and never also a tap', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 200, 200));
      el.fire('pointermove', touchEvent(1, 240, 210));
      expect(input.dragStarted).toBe(true);
      expect(input.dragging).toBe(true);
      expect(input.moveX).toBe(40);
      expect(input.moveY).toBe(10);

      el.fire('pointerup', touchEvent(1, 240, 210));
      expect(input.dragEnded).toBe(true);
      expect(input.dragging).toBe(false);
      // The bug this pins: a drag that also reports a tap paints the rectangle
      // and then plants one more building where the finger came off.
      expect(input.tapped).toBe(false);
    });
  });

  it('does not call a shaky finger a drag', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 300, 300));
      el.fire('pointermove', touchEvent(1, 303, 302));
      el.fire('pointerup', touchEvent(1, 304, 301));

      expect(input.dragStarted).toBe(false);
      expect(input.tapped).toBe(true);
    });
  });

  it('reads two fingers moving together as a pan, not a zoom', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 400, 400));
      el.fire('pointerdown', touchEvent(2, 500, 400));
      el.fire('pointermove', touchEvent(1, 430, 380));
      el.fire('pointermove', touchEvent(2, 530, 380));

      expect(input.panX).toBeGreaterThan(0);
      expect(input.panY).toBeLessThan(0);
      // The distance between them never changed, so nothing zoomed.
      expect(input.zoomScale).toBeCloseTo(1, 4);
    });
  });

  it('reads fingers spreading apart as pulling the map closer', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 400, 400));
      el.fire('pointerdown', touchEvent(2, 500, 400));
      el.fire('pointermove', touchEvent(1, 350, 400));
      el.fire('pointermove', touchEvent(2, 550, 400));

      expect(input.zoomScale).toBeCloseTo(2, 1);
      // Spreading around a fixed centre is not also a pan.
      expect(Math.abs(input.panX)).toBeLessThan(1);
    });
  });

  it('reads two fingers turning about their centre as a twist', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 400, 400));
      el.fire('pointerdown', touchEvent(2, 500, 400));
      // A quarter turn clockwise about (450, 400), spread unchanged.
      el.fire('pointermove', touchEvent(1, 450, 350));
      el.fire('pointermove', touchEvent(2, 450, 450));

      expect(input.twist).toBeCloseTo(Math.PI / 2, 1);
      // Turning about a fixed centre is neither a pan nor a pinch.
      expect(input.zoomScale).toBeCloseTo(1, 1);
      expect(Math.abs(input.panX) + Math.abs(input.panY)).toBeLessThan(1);
    });
  });

  it('does not read a twist off a pinch', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 400, 400));
      el.fire('pointerdown', touchEvent(2, 500, 400));
      el.fire('pointermove', touchEvent(1, 350, 400));
      el.fire('pointermove', touchEvent(2, 550, 400));

      expect(input.zoomScale).toBeCloseTo(2, 1);
      expect(input.twist).toBeCloseTo(0, 4);
    });
  });

  it('ignores the angle between fingertips that are almost touching', () => {
    // Two fingers 20px apart swing through half a radian on 5px of travel, and
    // that half radian would ride on top of every pinch the player makes.
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 400, 400));
      el.fire('pointerdown', touchEvent(2, 420, 400));
      el.fire('pointermove', touchEvent(1, 410, 390));
      el.fire('pointermove', touchEvent(2, 410, 410));

      expect(input.twist).toBe(0);
    });
  });

  it('forgets the twist when the frame is read', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 400, 400));
      el.fire('pointerdown', touchEvent(2, 500, 400));
      el.fire('pointermove', touchEvent(1, 450, 350));
      el.fire('pointermove', touchEvent(2, 450, 450));
      expect(input.twist).not.toBe(0);

      input.endFrame();
      expect(input.twist).toBe(0);
    });
  });

  it('gives up on the drag when a second finger lands', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 200, 200));
      el.fire('pointermove', touchEvent(1, 260, 200));
      expect(input.dragging).toBe(true);

      el.fire('pointerdown', touchEvent(2, 400, 200));
      // Aborted, not ended: the player reached for the camera, and a rectangle
      // built out of the moment they changed their mind is not what they asked for.
      expect(input.dragAborted).toBe(true);
      expect(input.dragEnded).toBe(false);
      expect(input.dragging).toBe(false);
    });
  });

  it('does not leave a gesture running when the window loses focus', () => {
    withBrowser((el, win) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 200, 200));
      el.fire('pointermove', touchEvent(1, 280, 200));
      win.fire('blur', {});

      expect(input.dragging).toBe(false);
      expect(input.dragAborted).toBe(true);
      // And the next touch starts clean rather than resuming the abandoned one.
      el.fire('pointerdown', touchEvent(1, 600, 300));
      el.fire('pointerup', touchEvent(1, 600, 300));
      expect(input.tapped).toBe(true);
    });
  });

  it('ignores a mouse arriving on the pointer path', () => {
    withBrowser((el) => {
      const input = reader(el);
      // The mouse has its own listeners. Reading it here too would report every
      // click twice — once as a click and once as a tap.
      el.fire('pointerdown', touchEvent(3, 100, 100, 'mouse'));
      el.fire('pointerup', touchEvent(3, 100, 100, 'mouse'));

      expect(input.tapped).toBe(false);
      expect(input.touchSeen).toBe(false);
    });
  });

  it('clears every gesture at the end of the frame', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 400, 400));
      el.fire('pointerdown', touchEvent(2, 500, 400));
      el.fire('pointermove', touchEvent(1, 350, 420));
      el.fire('pointermove', touchEvent(2, 560, 420));
      expect(input.panX !== 0 || input.panY !== 0).toBe(true);

      input.endFrame();
      expect(input.tapped).toBe(false);
      expect(input.dragStarted).toBe(false);
      expect(input.dragEnded).toBe(false);
      expect(input.dragAborted).toBe(false);
      expect(input.panX).toBe(0);
      expect(input.panY).toBe(0);
      expect(input.zoomScale).toBe(1);
    });
  });
});

// ------------------------------------------------- the manager, played by hand

/** Only the fields the controller reads. Cast, so a real Input change breaks this. */
function fakeInput(opts: Partial<Record<string, unknown>> = {}): Input {
  return {
    down: new Set<string>(),
    mouseButtons: new Set<number>(),
    wheel: 0,
    clientX: 0,
    clientY: 0,
    ndcX: 0,
    ndcY: 0,
    moveX: 0,
    moveY: 0,
    locked: false,
    touchSeen: true,
    tapped: false,
    dragging: false,
    dragStarted: false,
    dragEnded: false,
    dragAborted: false,
    panX: 0,
    panY: 0,
    zoomScale: 1,
    twist: 0,
    pressed: () => false,
    held: () => false,
    clicked: () => false,
    released: () => false,
    ...opts,
  } as unknown as Input;
}

function game(seed = 7): { world: World; cam: ManagerCamera; ctl: ManagerController } {
  const world = createWorld(seed);
  const cam = new ManagerCamera(world, { targetX: 32, targetY: 32, distance: 34, yaw: 0.8, pitch: 0.95 });
  cam.resize(1024 / 768);
  const ctl = new ManagerController(cam, { possess: () => {} });
  return { world, cam, ctl };
}

/** Point the camera at a cell and return the screen centre that now picks it. */
function aim(cam: ManagerCamera, x: number, y: number): { x: number; y: number } {
  cam.focusOn(x, y);
  const hit = cam.pickCell(0, 0);
  if (!hit) throw new Error('the camera is not looking at the ground');
  return { x: hit.x, y: hit.y };
}

/** An ndc that picks some cell other than the one at the centre of the screen. */
function offCentre(cam: ManagerCamera, from: { x: number; y: number }): number {
  for (let n = 0.02; n < 0.6; n += 0.02) {
    const hit = cam.pickCell(n, 0);
    if (hit && (hit.x !== from.x || hit.y !== from.y)) return n;
  }
  throw new Error('the whole screen is one cell');
}

describe('the manager under a finger', () => {
  it('selects the settler under a tap', () => {
    const { world, cam, ctl } = game();
    const pawn = livingColonists(world)[0]!;
    aim(cam, Math.round(pawn.x), Math.round(pawn.y));

    ctl.update(world, fakeInput({ tapped: true }), 0.05);

    expect(ctl.selection).toEqual({ type: 'pawn', id: pawn.id });
  });

  it('drags the map around with one finger when nothing is armed', () => {
    const { world, cam, ctl } = game();
    const before = { x: cam.state.targetX, y: cam.state.targetY };

    ctl.update(world, fakeInput({ dragging: true, moveX: 90, moveY: -40 }), 0.05);

    const moved = Math.hypot(cam.state.targetX - before.x, cam.state.targetY - before.y);
    expect(moved).toBeGreaterThan(1);
    // Dragging the map is not also clicking on it.
    expect(ctl.selection).toBe(null);
  });

  it('pans with two fingers even while a tool is armed', () => {
    const { world, cam, ctl } = game();
    ctl.setTool('build', 'wall');
    const before = { x: cam.state.targetX, y: cam.state.targetY };

    ctl.update(world, fakeInput({ panX: 120, panY: 60 }), 0.05);

    expect(Math.hypot(cam.state.targetX - before.x, cam.state.targetY - before.y)).toBeGreaterThan(1);
    // The armed tool is the point: with the bar in build mode there is no spare
    // gesture, and a player who cannot move the map cannot build past the screen.
    expect(world.buildings.some((b) => !b.built)).toBe(false);
  });

  it('pinches the camera in and out', () => {
    const { world, cam, ctl } = game();
    const start = cam.state.distance;

    ctl.update(world, fakeInput({ zoomScale: 1.5 }), 0.05);
    const closer = cam.state.distance;
    expect(closer).toBeLessThan(start);

    ctl.update(world, fakeInput({ zoomScale: 1 / 1.5 }), 0.05);
    expect(cam.state.distance).toBeGreaterThan(closer);
  });

  it('turns the valley when two fingers twist', () => {
    const { world, cam, ctl } = game();
    const start = cam.state.yaw;

    ctl.update(world, fakeInput({ twist: 0.4 }), 0.05);
    const turned = cam.state.yaw;
    expect(turned).not.toBeCloseTo(start, 3);

    // And back the other way, so a twist is a control rather than a ratchet.
    ctl.update(world, fakeInput({ twist: -0.4 }), 0.05);
    expect(cam.state.yaw).toBeCloseTo(start, 3);
  });

  it('turns the ground with the hand, the way the pan does', () => {
    // A twist that turned the *camera* clockwise would slide the valley the
    // other way under the fingers, which reads as the map fighting you.
    //
    // Which sign that is cannot be reasoned out from `orbit` alone — it depends
    // on how yaw lands on the screen through the projection. Measured in a
    // browser instead: a fixed world point ten cells north of the camera's
    // target, projected before and after `orbit(-0.5, 0)`, swings +0.505 rad
    // clockwise in screen terms. So a clockwise finger — which is a rising
    // `atan2(dy, dx)`, because screen y points down — has to reach `orbit` with
    // its sign flipped, and this test is what holds that flip in place.
    const { world, cam, ctl } = game();
    const start = cam.state.yaw;
    ctl.update(world, fakeInput({ twist: 0.4 }), 0.05);
    expect(cam.state.yaw).toBeLessThan(start);
  });

  it('plants one building where a tap lands', () => {
    const { world, cam, ctl } = game();
    const spot = clearGround(world, cam);
    ctl.setTool('build', 'wall');

    ctl.update(world, fakeInput({ tapped: true }), 0.05);

    const b = buildingAt(world, spot.x, spot.y);
    expect(b?.kind).toBe('wall');
    expect(b?.built).toBe(false);
    // Silence is how a tool reads as broken; the drag path says this, so the tap
    // path has to say it too.
    expect(world.messages.at(-1)?.text).toMatch(/Wall planned/);
  });

  it('paints a run of blueprints along a drag', () => {
    const { world, cam, ctl } = game();
    const from = clearGround(world, cam);
    const away = offCentre(cam, from);
    const to = cam.pickCell(away, 0)!;
    ctl.setTool('build', 'wall');

    ctl.update(world, fakeInput({ dragStarted: true }), 0.05);
    expect(ctl.preview.length).toBe(1);
    ctl.update(world, fakeInput({ dragging: true, ndcX: away }), 0.05);
    expect(ctl.preview.length).toBeGreaterThan(1);
    ctl.update(world, fakeInput({ dragEnded: true, ndcX: away }), 0.05);

    const planned = world.buildings.filter((b) => !b.built && b.kind === 'wall');
    expect(planned.length).toBeGreaterThan(1);
    expect(planned.some((b) => b.x === from.x && b.y === from.y)).toBe(true);
    expect(planned.some((b) => b.x === to.x && b.y === to.y)).toBe(true);
    // The drag rectangle is gone; what is left is the one hovered cell the armed
    // tool always previews.
    expect(ctl.preview.length).toBeLessThanOrEqual(1);
  });

  it('builds nothing from a drag the player changed their mind about', () => {
    const { world, cam, ctl } = game();
    clearGround(world, cam);
    ctl.setTool('build', 'wall');

    ctl.update(world, fakeInput({ dragStarted: true }), 0.05);
    ctl.update(world, fakeInput({ dragAborted: true }), 0.05);
    // The second finger landed to move the camera. Ending the drag there would
    // build a wall the player never asked for, at the exact moment they were
    // reaching for the map.
    ctl.update(world, fakeInput({ dragEnded: true }), 0.05);

    expect(world.buildings.filter((b) => !b.built).length).toBe(0);
    expect(ctl.preview.length).toBeLessThanOrEqual(1);
  });
});

// ------------------------------------------------------------ the thumb pad

/**
 * Enough of an element to hang a control surface off. `TouchControls` builds real
 * DOM — a pad, a knob and four buttons — and there is no jsdom here, so the DOM is
 * the part that gets faked and the key mapping is the part that gets tested.
 */
class FakeEl {
  id = '';
  className = '';
  textContent = '';
  title = '';
  style: Record<string, string> = {};
  parentElement: FakeEl | null = null;
  readonly children: FakeEl[] = [];
  readonly classes = new Set<string>();
  readonly classList = {
    toggle: (c: string, on?: boolean): void => {
      if (on ?? !this.classes.has(c)) this.classes.add(c);
      else this.classes.delete(c);
    },
  };
  rect = { left: 0, top: 0, width: 100, height: 100 };
  private readonly handlers = new Map<string, Array<(e: unknown) => void>>();

  append(...kids: FakeEl[]): void {
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
  }
  remove(): void {
    this.parentElement = null;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  fire(type: string, ev: unknown): void {
    for (const fn of this.handlers.get(type) ?? []) fn(ev);
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.rect;
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}

  /** First descendant with this class. The controls are built, not injected. */
  find(cls: string): FakeEl {
    for (const k of this.children) {
      if (k.className === cls) return k;
      const deep = k.findMaybe(cls);
      if (deep) return deep;
    }
    throw new Error(`no .${cls} was built`);
  }
  findMaybe(cls: string): FakeEl | null {
    for (const k of this.children) {
      if (k.className === cls) return k;
      const deep = k.findMaybe(cls);
      if (deep) return deep;
    }
    return null;
  }
  /** Every descendant with this class, in build order. */
  all(cls: string): FakeEl[] {
    const out: FakeEl[] = [];
    for (const k of this.children) {
      if (k.className === cls) out.push(k);
      out.push(...k.all(cls));
    }
    return out;
  }
}

/**
 * A real `Input` and a real `TouchControls` wired together over a fake document,
 * with the pad given a definite place on the glass so a thumb can be aimed at it.
 * Centre (200, 600), radius 100 — so the 0.26 deadzone is 26px of travel.
 */
function glass(fn: (ctx: { input: Input; controls: TouchControls; hud: FakeEl; pad: FakeEl }) => void): void {
  const g = globalThis as Record<string, unknown>;
  const el = stub();
  const hadWindow = 'window' in g;
  const hadDoc = 'document' in g;
  const oldWindow = g.window;
  const oldDoc = g.document;
  g.window = stub();
  g.document = { ...stub(), createElement: () => new FakeEl() };
  try {
    const input = reader(el);
    const hud = new FakeEl();
    const controls = new TouchControls(input, hud as unknown as HTMLElement);
    const pad = hud.find('stickpad');
    pad.rect = { left: 100, top: 500, width: 200, height: 200 };
    fn({ input, controls, hud, pad });
  } finally {
    if (hadWindow) g.window = oldWindow;
    else delete g.window;
    if (hadDoc) g.document = oldDoc;
    else delete g.document;
  }
}

/** Put a thumb on the pad and drag it to a point, as one gesture. */
function thumb(pad: FakeEl, x: number, y: number): void {
  pad.fire('pointerdown', touchEvent(1, x, y));
}

describe('the thumb pad stands in for a keyboard', () => {
  it('walks forward when the thumb pushes up the screen', () => {
    glass(({ input, pad }) => {
      thumb(pad, 200, 520);

      expect(input.held('KeyW')).toBe(true);
      expect(input.held('KeyS')).toBe(false);
      expect(input.held('KeyA')).toBe(false);
      expect(input.held('KeyD')).toBe(false);
      // A virtual key has to arrive as a press too, or anything watching for the
      // keystroke rather than the hold would never see it.
      expect(input.pressed('KeyW')).toBe(true);
    });
  });

  it('ignores a thumb resting near the middle', () => {
    glass(({ input, pad }) => {
      // 15px of 100 is inside the 0.26 deadzone: a thumb sitting on the pad
      // between moves must not creep the body forward.
      thumb(pad, 200, 585);

      expect(input.down.size).toBe(0);
    });
  });

  it('holds two keys on a diagonal push', () => {
    glass(({ input, pad }) => {
      thumb(pad, 270, 530);

      expect(input.held('KeyW')).toBe(true);
      expect(input.held('KeyD')).toBe(true);
      expect(input.held('KeyS')).toBe(false);
      expect(input.held('KeyA')).toBe(false);
    });
  });

  it('swaps keys when the thumb crosses the middle without lifting', () => {
    glass(({ input, pad }) => {
      thumb(pad, 200, 520);
      pad.fire('pointermove', touchEvent(1, 200, 690));

      // The forward key has to be let go of, not merely joined by its opposite,
      // or the body would hold W and S at once and stand still for no reason.
      expect(input.held('KeyW')).toBe(false);
      expect(input.held('KeyS')).toBe(true);
    });
  });

  it('lets go of everything when the thumb comes off', () => {
    glass(({ input, pad }) => {
      thumb(pad, 200, 520);
      pad.fire('pointerup', touchEvent(1, 200, 520));

      expect(input.down.size).toBe(0);
    });
  });

  it('does not let a second finger on the pad steer', () => {
    glass(({ input, pad }) => {
      thumb(pad, 200, 520);
      pad.fire('pointermove', touchEvent(2, 200, 690));

      expect(input.held('KeyW')).toBe(true);
      expect(input.held('KeyS')).toBe(false);
    });
  });

  it('holds the trigger only while the fire button is held', () => {
    glass(({ input, hud }) => {
      const fire = hud.all('touchbtn').find((b) => b.textContent === 'Fire')!;

      fire.fire('pointerdown', touchEvent(1, 0, 0));
      expect(input.virtualFire).toBe(true);
      fire.fire('pointerup', touchEvent(1, 0, 0));
      expect(input.virtualFire).toBe(false);
    });
  });

  it('gives a tablet a way back to the colony view', () => {
    glass(({ input, hud }) => {
      // V is a keyboard shortcut and the tablet has no keyboard. Without this
      // button, possessing a settler on glass is a one-way trip.
      const back = hud.all('touchbtn').find((b) => b.textContent === 'Colony')!;
      back.fire('pointerdown', touchEvent(1, 0, 0));

      expect(input.pressed('KeyV')).toBe(true);
    });
  });

  it('drops the keys it was holding when the controls are hidden', () => {
    glass(({ input, controls, pad }) => {
      controls.setVisible(true);
      thumb(pad, 200, 520);
      // Switching to the colony view mid-stride would otherwise leave W held
      // down forever, with nothing on screen to release it.
      controls.setVisible(false);

      expect(input.down.size).toBe(0);
      expect(input.virtualFire).toBe(false);
    });
  });

  it('tells the HUD when a finger is driving, so the keyboard advice can go', () => {
    glass(({ controls, hud }) => {
      controls.setVisible(true);
      expect(hud.classes.has('touching')).toBe(true);
      controls.setVisible(false);
      expect(hud.classes.has('touching')).toBe(false);
    });
  });
});

// ------------------------------------------------- first person, played by hand

/** The fields `FpsController` reads. Same trick as the manager's fake above. */
function fpsInput(
  opts: {
    held?: string[];
    dragging?: boolean;
    moveX?: number;
    moveY?: number;
    virtualFire?: boolean;
    locked?: boolean;
  } = {},
): Input {
  const down = new Set(opts.held ?? []);
  return {
    down,
    mouseButtons: new Set<number>(),
    locked: opts.locked ?? false,
    dragging: opts.dragging ?? false,
    moveX: opts.moveX ?? 0,
    moveY: opts.moveY ?? 0,
    virtualFire: opts.virtualFire ?? false,
    held: (code: string) => down.has(code),
  } as unknown as Input;
}

describe('first person under a finger', () => {
  it('turns the head when a finger drags across the world', () => {
    const fps = new FpsController();
    fps.yaw = 0;

    // A tablet cannot lock the pointer, so the drag is the only way to look
    // around: without this the view is a fixed stare.
    fps.applyLook(fpsInput({ dragging: true, moveX: 100 }), 0.016);

    expect(fps.yaw).toBeCloseTo(0.24, 3);
  });

  it('does not turn the head from pointer movement that is not a drag', () => {
    const fps = new FpsController();
    fps.yaw = 0;

    fps.applyLook(fpsInput({ moveX: 100 }), 0.016);

    expect(fps.yaw).toBe(0);
  });

  it('fires on the on-screen trigger while drafted', () => {
    const world = createWorld(77);
    const pawn = world.pawns[0]!;
    possess(world, pawn.id);
    pawn.weapon = 'rifle';
    pawn.attackCooldown = 0;
    setDrafted(world, pawn.id, true);

    const fps = new FpsController();
    fps.attach(pawn);
    fps.applyTick(world, pawn, fpsInput({ virtualFire: true }), new Rng(9));

    expect(world.projectiles.filter((p) => p.ownerId === pawn.id).length).toBe(1);
  });

  it('fires nothing from the trigger while undrafted', () => {
    const world = createWorld(77);
    const pawn = world.pawns[0]!;
    possess(world, pawn.id);
    pawn.weapon = 'rifle';
    pawn.attackCooldown = 0;
    setDrafted(world, pawn.id, false);

    new FpsController().applyTick(world, pawn, fpsInput({ virtualFire: true }), new Rng(9));

    expect(world.projectiles.length).toBe(0);
  });

  it('walks the body on the pad’s virtual keys, through the same path a keyboard takes', () => {
    const world = createWorld(77);
    const pawn = world.pawns[0]!;
    possess(world, pawn.id);
    const from = { x: pawn.x, y: pawn.y };

    const fps = new FpsController();
    fps.attach(pawn);
    fps.yaw = 0;
    for (let i = 0; i < 6; i++) fps.applyTick(world, pawn, fpsInput({ held: ['KeyW'] }), new Rng(3));

    expect(Math.hypot(pawn.x - from.x, pawn.y - from.y)).toBeGreaterThan(0.2);
    expect(pawn.activity).toBe('walking');
  });
});

/**
 * Aim the camera at ground a wall can actually go on, and hand back the cell.
 * Anchoring on the map centre would be betting on the seed putting grass there.
 */
function clearGround(world: World, cam: ManagerCamera): { x: number; y: number } {
  for (let r = 0; r < 30; r++) {
    for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r]] as const) {
      const x = Math.floor(world.width / 2) + dx;
      const y = Math.floor(world.height / 2) + dy;
      if (x < 2 || y < 2 || x > world.width - 3 || y > world.height - 3) continue;
      if (canPlace(world, 'wall', x, y) !== 'ok') continue;
      const at = aim(cam, x, y);
      if (canPlace(world, 'wall', at.x, at.y) === 'ok') return at;
    }
  }
  throw new Error('nowhere on this map to stand a wall');
}

// ------------------------------------------------------- audio on a touchscreen

/** One method's body, sliced out of a source file by brace depth. */
function methodBody(text: string, name: string): string {
  const at = text.indexOf(`private ${name}(`);
  expect(at, `${name} is gone from app.ts — this test is measuring nothing`).toBeGreaterThan(-1);
  let i = text.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  throw new Error(`${name} never closes`);
}

const APP = Object.values(
  import.meta.glob('../src/client/app.ts', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

describe('audio unlocks for hands as well as for a keyboard', () => {
  it('has seen no gesture before the player touches anything', () => {
    withBrowser((el) => {
      expect(reader(el).hasGestured).toBe(false);
    });
  });

  it('counts a finger going down', () => {
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(1, 500, 400));
      expect(input.hasGestured).toBe(true);
    });
  });

  it('counts a drag that never becomes a tap', () => {
    // The gesture a phone player is most likely to make first is pushing the
    // valley around, and it produces no tap at all. Gating audio on `tapped`
    // would leave that player in silence for as long as they only ever panned.
    withBrowser((el) => {
      const input = reader(el);
      el.fire('pointerdown', touchEvent(2, 200, 200));
      el.fire('pointermove', touchEvent(2, 400, 260));
      el.fire('pointerup', touchEvent(2, 400, 260));
      expect(input.tapped).toBe(false);
      expect(input.hasGestured).toBe(true);
    });
  });

  it('counts a key, and forgets neither at the end of the frame', () => {
    // Sticky is the whole point: `unlock` is called from the frame loop, and a
    // per-frame flag would have to be caught on exactly the right frame.
    withBrowser((el, win) => {
      const input = reader(el);
      win.fire('keydown', { code: 'KeyW', repeat: false, target: null, preventDefault: () => {} });
      input.endFrame();
      expect(input.pressed('KeyW')).toBe(false);
      expect(input.hasGestured).toBe(true);
    });
  });

  it('is what the app actually unlocks audio on', () => {
    // The app cannot be built in node — it wants a canvas and a GL context — so
    // the wiring is read instead. Without this the flag above can be perfect and
    // still connected to nothing, which is exactly the state this fixed: a phone
    // player could found a colony, fight a raid and lose it in silence, because
    // the unlock was gated on a left click or the space bar.
    const body = methodBody(APP, 'globalKeys');
    expect(body).toContain('this.input.hasGestured');
    expect(body).toContain('this.sfx.unlock()');
    expect(body).not.toContain("this.input.clicked(0) || this.input.pressed('Space')");
  });

  it('listens from where the camera is looking, not from whoever is asleep', () => {
    // The overhead ear used to be `livingColonists(w)[0]`, which is the same
    // person all game and is wherever they happen to be standing — so the
    // ambient bed put a roof over a player watching rain on the open moor
    // because that settler was indoors, and took it off again when they stepped
    // out. `render` already focuses `this.cam.target`; the ear now agrees with
    // the eye.
    const body = methodBody(APP, 'driveAmbience');
    expect(body).toContain('this.cam.target');
    expect(body).not.toContain('livingColonists');
  });
});
