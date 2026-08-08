/**
 * The controls a body needs when the machine has no keyboard.
 *
 * First person asks for WASD, E and a mouse. A tablet has none of them, and
 * without a stand-in the second half of the game — the half the whole thing was
 * built around — is a view you can look at and not move. So: a thumb pad in the
 * corner where a thumb already is, and three buttons for the verbs that are not
 * walking.
 *
 * It writes into `Input` rather than into the world, and it writes the same keys
 * a keyboard would. Nothing downstream knows a finger is driving: `FpsController`
 * still reads `held('KeyW')`, `app.ts` still reads `pressed('KeyE')`. That is the
 * whole point of putting it here instead of in the HUD — one input surface, two
 * ways of reaching it, and no second movement path to keep in step with the first.
 */

import type { Input } from './input';

/** Fraction of the pad's radius a thumb must travel before it counts as a push. */
const DEADZONE = 0.26;

interface Btn {
  label: string;
  title: string;
  /** A one-shot key, as if the player had tapped it. */
  key?: string;
  /** Held for as long as the finger is down. */
  hold?: 'fire';
}

const BUTTONS: Btn[] = [
  { label: 'E', title: 'Use what you are looking at', key: 'KeyE' },
  { label: 'Fire', title: 'Shoot (drafted only)', hold: 'fire' },
  { label: 'T', title: 'Draft or stand down', key: 'KeyT' },
  { label: 'Colony', title: 'Back to the colony view', key: 'KeyV' },
];

export class TouchControls {
  private readonly input: Input;
  private readonly root: HTMLDivElement;
  private readonly pad: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  /** Which of WASD the stick is currently holding, so a release can undo exactly it. */
  private readonly holding = new Set<string>();
  private stickId: number | null = null;
  private visible = false;

  constructor(input: Input, parent: HTMLElement = document.body) {
    this.input = input;

    this.root = document.createElement('div');
    this.root.id = 'touchcontrols';
    this.root.style.display = 'none';

    this.pad = document.createElement('div');
    this.pad.className = 'stickpad';
    this.knob = document.createElement('div');
    this.knob.className = 'stickknob';
    this.pad.append(this.knob);

    const bar = document.createElement('div');
    bar.className = 'touchbtns';
    for (const b of BUTTONS) {
      const el = document.createElement('button');
      el.className = 'touchbtn';
      el.textContent = b.label;
      el.title = b.title;
      if (b.hold === 'fire') {
        // Held, not tapped: a trigger you have to keep your thumb on is the same
        // deal the mouse button offers.
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.input.virtualFire = true;
        });
        const off = (e: Event): void => {
          e.preventDefault();
          this.input.virtualFire = false;
        };
        el.addEventListener('pointerup', off);
        el.addEventListener('pointercancel', off);
        el.addEventListener('pointerleave', off);
      } else if (b.key) {
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.input.tapKey(b.key!);
        });
      }
      bar.append(el);
    }

    this.root.append(this.pad, bar);
    parent.append(this.root);

    this.pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stickId = e.pointerId;
      this.pad.setPointerCapture?.(e.pointerId);
      this.aim(e.clientX, e.clientY);
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      this.aim(e.clientX, e.clientY);
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.pad.releasePointerCapture?.(e.pointerId);
      this.centre();
    };
    this.pad.addEventListener('pointerup', release);
    this.pad.addEventListener('pointercancel', release);
  }

  /** Shown only in first person, and only once the machine has proved it has a finger. */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.root.style.display = on ? '' : 'none';
    // The HUD's own first-person furniture is a keyboard manual. It is wrong on
    // glass and it is underneath these buttons, so the layer is told.
    this.root.parentElement?.classList.toggle('touching', on);
    if (!on) this.centre();
  }

  private aim(clientX: number, clientY: number): void {
    const r = this.pad.getBoundingClientRect();
    const radius = r.width / 2;
    if (radius <= 0) return;
    let dx = (clientX - (r.left + radius)) / radius;
    let dy = (clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.knob.style.transform = `translate(${(dx * radius * 0.55).toFixed(1)}px, ${(dy * radius * 0.55).toFixed(1)}px)`;
    // Screen up is forward. Below the deadzone the thumb is resting, not steering.
    this.hold('KeyW', dy < -DEADZONE);
    this.hold('KeyS', dy > DEADZONE);
    this.hold('KeyD', dx > DEADZONE);
    this.hold('KeyA', dx < -DEADZONE);
  }

  private centre(): void {
    this.knob.style.transform = '';
    for (const code of [...this.holding]) this.hold(code, false);
    this.input.virtualFire = false;
  }

  private hold(code: string, on: boolean): void {
    if (on === this.holding.has(code)) return;
    if (on) this.holding.add(code);
    else this.holding.delete(code);
    this.input.setVirtualKey(code, on);
  }

  dispose(): void {
    this.centre();
    this.root.remove();
  }
}
