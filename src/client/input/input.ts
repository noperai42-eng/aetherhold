/**
 * One input source for both views. It records raw state; the view controllers
 * decide what it means. One-shot presses are consumed at the end of each frame so
 * a key never fires twice, and pointer-lock deltas are kept separate from free
 * mouse movement because only first person uses them.
 *
 * Touch is recorded at the same level: what the hands did, not what it meant. A
 * tap, a one-finger drag and a two-finger pinch are facts about the glass; which
 * of them paints a stockpile and which of them moves the camera is a decision
 * only the view that owns the current tool can make, and it makes it below.
 */

/** Travel, in px, past which a finger is dragging rather than tapping. */
const TAP_SLOP = 9;
/** A finger held longer than this is not a tap even if it never moved. */
const TAP_MS = 700;
/** Fingers closer together than this are too short a lever to read a twist off. */
const TWIST_SPREAD = 60;

export class Input {
  readonly down = new Set<string>();
  readonly mouseButtons = new Set<number>();
  private readonly pressedThisFrame = new Set<string>();
  private readonly clickedThisFrame = new Set<number>();
  private readonly releasedThisFrame = new Set<number>();

  wheel = 0;
  /** Client-space pointer position and its normalised device equivalent. */
  clientX = 0;
  clientY = 0;
  ndcX = 0;
  ndcY = 0;
  /** Movement since the last frame; in pointer lock this is the look delta. */
  moveX = 0;
  moveY = 0;
  locked = false;

  // ---- touch, as raw as the mouse state above ----

  /**
   * True once the player has done anything at all with their hands, and never
   * false again.
   *
   * This exists because of audio. A browser refuses to start an `AudioContext`
   * until a gesture has happened, so the app watches for one and unlocks — and
   * what it used to watch for was a left click or the space bar. Neither of
   * those exists on a phone. A player could found a colony, fight a raid and
   * lose it on a touchscreen with the whole soundtrack sitting behind a lock
   * nothing on the device could open, and the only door through was entering
   * first person, which also calls `unlock`.
   *
   * Sticky rather than a per-frame flag, and set by *any* first contact rather
   * than by a tap, because a tap is the one gesture a player might never make:
   * dragging the camera around the valley is a gesture, means the same thing to
   * the browser, and used to unlock nothing.
   */
  hasGestured = false;
  /** True once this session has seen a finger. The HUD reads it to change its advice. */
  touchSeen = false;
  /** A finger touched and lifted without travelling. Position is in `clientX`/`ndcX`. */
  tapped = false;
  /** A single finger is down and has travelled past the slop threshold. */
  dragging = false;
  dragStarted = false;
  /** The drag ended by lifting the finger — the gesture meant something. */
  dragEnded = false;
  /** The drag was interrupted (second finger, or the browser took the pointer). */
  dragAborted = false;
  /** Two-finger travel this frame, in px. */
  panX = 0;
  panY = 0;
  /** Pinch this frame as a ratio: >1 fingers spread, <1 pinched, 1 nothing happened. */
  zoomScale = 1;
  /** Two-finger twist this frame, in radians, clockwise positive. Zero if neither. */
  twist = 0;
  /** An on-screen trigger is held. Pointer lock is the mouse's version of this. */
  virtualFire = false;

  private readonly touches = new Map<number, { x: number; y: number }>();
  private touchStart: { x: number; y: number; at: number } | null = null;
  private pinchPrev: { x: number; y: number; d: number; a: number } | null = null;

  private readonly el: HTMLElement;
  private readonly handlers: Array<[EventTarget, string, EventListener]> = [];

  constructor(el: HTMLElement) {
    this.el = el;
    this.on(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      if (isTypingTarget(ev.target)) return;
      this.hasGestured = true;
      this.down.add(ev.code);
      this.pressedThisFrame.add(ev.code);
      // The browser's own bindings for these get in the way of playing.
      if (SWALLOW.has(ev.code)) ev.preventDefault();
    });
    this.on(window, 'keyup', (e) => {
      this.down.delete((e as KeyboardEvent).code);
    });
    this.on(window, 'blur', () => {
      this.down.clear();
      this.mouseButtons.clear();
      // A window that lost focus mid-gesture never gets the pointerup.
      this.touches.clear();
      this.touchStart = null;
      this.pinchPrev = null;
      if (this.dragging) this.dragAborted = true;
      this.dragging = false;
    });
    this.on(el, 'mousedown', (e) => {
      const ev = e as MouseEvent;
      this.hasGestured = true;
      this.mouseButtons.add(ev.button);
      this.clickedThisFrame.add(ev.button);
      this.readPosition(ev);
    });
    this.on(window, 'mouseup', (e) => {
      const ev = e as MouseEvent;
      this.mouseButtons.delete(ev.button);
      this.releasedThisFrame.add(ev.button);
    });
    this.on(window, 'mousemove', (e) => {
      const ev = e as MouseEvent;
      if (this.locked) {
        this.moveX += ev.movementX;
        this.moveY += ev.movementY;
      } else {
        this.moveX += ev.movementX || 0;
        this.moveY += ev.movementY || 0;
        this.readPosition(ev);
      }
    });
    this.on(el, 'wheel', (e) => {
      const ev = e as WheelEvent;
      ev.preventDefault();
      this.wheel += ev.deltaY;
    });
    this.on(el, 'contextmenu', (e) => e.preventDefault());

    // Touch. Only fingers and pens come down this path: a mouse already has its
    // own listeners above, and letting both fire would double every click.
    this.on(el, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      if (ev.pointerType === 'mouse') return;
      // Stops iOS synthesising a mouse click a moment later, and stops the page
      // from treating a drag across the world as a scroll.
      ev.preventDefault();
      this.hasGestured = true;
      this.touchSeen = true;
      this.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      this.el.setPointerCapture?.(ev.pointerId);
      if (this.touches.size === 1) {
        this.touchStart = { x: ev.clientX, y: ev.clientY, at: performance.now() };
        this.readPosition(ev);
      } else {
        // A second finger means the gesture was always going to be a camera
        // move. Whatever the first finger had started, it did not mean it.
        if (this.dragging) this.dragAborted = true;
        this.dragging = false;
        this.touchStart = null;
        // Measured from where the fingers actually landed. Leaving it null until
        // the first move meant the gesture was measured from one finger having
        // already travelled and the other not: a straight two-finger pan came out
        // as a lurch of zoom, because the browser delivers one pointer per event.
        this.pinchPrev = this.gesture();
      }
    });

    this.on(el, 'pointermove', (e) => {
      const ev = e as PointerEvent;
      if (ev.pointerType === 'mouse') return;
      if (!this.touches.has(ev.pointerId)) return;
      ev.preventDefault();
      const prev = this.touches.get(ev.pointerId)!;
      const dx = ev.clientX - prev.x;
      const dy = ev.clientY - prev.y;
      this.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (this.touches.size === 1) {
        this.moveX += dx;
        this.moveY += dy;
        this.readPosition(ev);
        const s = this.touchStart;
        if (s && !this.dragging && Math.hypot(ev.clientX - s.x, ev.clientY - s.y) > TAP_SLOP) {
          this.dragging = true;
          this.dragStarted = true;
        }
        return;
      }

      // Two or more: the centroid moves the camera, the spread between the first
      // two zooms it. Both are measured against the previous event rather than
      // the start of the gesture, so a pinch that turns into a drag just works —
      // and so the per-pointer events of one two-finger move cancel out instead
      // of reading as zoom.
      const now = this.gesture();
      if (this.pinchPrev && now) {
        this.panX += now.x - this.pinchPrev.x;
        this.panY += now.y - this.pinchPrev.y;
        if (this.pinchPrev.d > 8 && now.d > 8) {
          this.zoomScale *= now.d / this.pinchPrev.d;
          // Wrapped to the short way round, or a twist across the -pi/pi seam
          // would read as most of a turn the other way. Only counted while the
          // fingers are far enough apart to have an angle worth trusting: two
          // fingertips 10px apart swing through a lot of degrees on very little
          // movement, and the whole gesture would fight the pinch it rides on.
          if (now.d > TWIST_SPREAD) {
            let da = now.a - this.pinchPrev.a;
            if (da > Math.PI) da -= 2 * Math.PI;
            else if (da < -Math.PI) da += 2 * Math.PI;
            this.twist += da;
          }
        }
      }
      this.pinchPrev = now;
    });

    const liftTouch = (e: Event, clean: boolean): void => {
      const ev = e as PointerEvent;
      if (ev.pointerType === 'mouse') return;
      if (!this.touches.delete(ev.pointerId)) return;
      this.el.releasePointerCapture?.(ev.pointerId);
      if (this.touches.size < 2) this.pinchPrev = null;
      if (this.dragging) {
        this.dragging = false;
        if (clean) this.dragEnded = true;
        else this.dragAborted = true;
      } else if (clean && this.touches.size === 0 && this.touchStart) {
        const s = this.touchStart;
        const still = Math.hypot(ev.clientX - s.x, ev.clientY - s.y) <= TAP_SLOP;
        if (still && performance.now() - s.at < TAP_MS) {
          this.readPosition(ev);
          this.tapped = true;
        }
      }
      if (this.touches.size === 0) this.touchStart = null;
    };
    this.on(el, 'pointerup', (e) => liftTouch(e, true));
    this.on(el, 'pointercancel', (e) => liftTouch(e, false));

    this.on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        this.moveX = 0;
        this.moveY = 0;
      }
    });
  }

  /**
   * Where the fingers are, as one point, one spread and one angle. Null under
   * two fingers.
   *
   * The angle is of the line between the first two fingers, which is what a
   * twist changes. Taken from the same pair as the spread on purpose: with three
   * fingers down the centroid still moves the camera, but the pair that decides
   * zoom has to be the pair that decides rotation or a third finger landing
   * would swap one gesture's reference without swapping the other's.
   */
  private gesture(): { x: number; y: number; d: number; a: number } | null {
    const pts = [...this.touches.values()];
    if (pts.length < 2) return null;
    const x = pts.reduce((t, p) => t + p.x, 0) / pts.length;
    const y = pts.reduce((t, p) => t + p.y, 0) / pts.length;
    const dx = pts[1]!.x - pts[0]!.x;
    const dy = pts[1]!.y - pts[0]!.y;
    return { x, y, d: Math.hypot(dx, dy), a: Math.atan2(dy, dx) };
  }

  private on(target: EventTarget, type: string, fn: EventListener): void {
    // Both of these default to passive in some engines, and a passive listener
    // cannot stop the page scrolling out from under a drag.
    const opts = type === 'wheel' || type.startsWith('pointer') ? { passive: false } : undefined;
    target.addEventListener(type, fn, opts);
    this.handlers.push([target, type, fn]);
  }

  private readPosition(ev: MouseEvent): void {
    const r = this.el.getBoundingClientRect();
    this.clientX = ev.clientX - r.left;
    this.clientY = ev.clientY - r.top;
    this.ndcX = (this.clientX / r.width) * 2 - 1;
    this.ndcY = -((this.clientY / r.height) * 2 - 1);
  }

  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  held(code: string): boolean {
    return this.down.has(code);
  }

  clicked(button: number): boolean {
    return this.clickedThisFrame.has(button);
  }

  released(button: number): boolean {
    return this.releasedThisFrame.has(button);
  }

  /**
   * Hold a key down on behalf of a control that is not a key — the thumb pad
   * standing in for WASD. It goes through the same two sets a real keydown does,
   * so nothing downstream can tell the difference, and a stuck virtual key is
   * released by the same `keyup`/`blur` paths.
   */
  setVirtualKey(code: string, on: boolean): void {
    if (on) {
      if (!this.down.has(code)) this.pressedThisFrame.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
    }
  }

  /** Tap a key once, for an on-screen button standing in for a keystroke. */
  tapKey(code: string): void {
    this.pressedThisFrame.add(code);
  }

  requestLock(): void {
    if (this.locked) return;
    // Chrome hands back a promise that legitimately rejects: Esc pressed a moment
    // before the click, an unfocused document, an embedded frame. A refused lock is
    // not an error — pointerlockchange never fires, the body keeps its mouse-look
    // yaw, and the player can click again. Swallow it instead of leaking a rejection.
    const req = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
    void req?.catch(() => {});
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Clears one-shot state. Call once at the very end of every frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.clickedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.wheel = 0;
    this.moveX = 0;
    this.moveY = 0;
    this.tapped = false;
    this.dragStarted = false;
    this.dragEnded = false;
    this.dragAborted = false;
    this.panX = 0;
    this.panY = 0;
    this.zoomScale = 1;
    this.twist = 0;
  }

  dispose(): void {
    for (const [target, type, fn] of this.handlers) target.removeEventListener(type, fn);
    this.handlers.length = 0;
  }
}

const SWALLOW = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
]);

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}
