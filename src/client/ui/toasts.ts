/**
 * The cards that come up over the world when something happens.
 *
 * The log has always had every line, and that is the problem: it says "Ruth is
 * dead" in the same six grey pixels it says "Ruth finished a wall", and then it
 * scrolls both away. A player watching the far side of the map misses the raid
 * that started behind them and only finds out when the alerts panel tells them
 * the colony has no doctor. So the sim marks its story beats (`Message.headline`)
 * and they get raised over the world for a few seconds, with somewhere to look.
 *
 * This half is deliberately DOM-free: which cards are up, how long they have
 * left and what falls off the bottom when a raid raises four at once is
 * arithmetic, and arithmetic can be tested without a browser. `hud.ts` owns the
 * elements and reads `list()`.
 */

import type { Message } from '../../sim/types';

export interface Toast {
  /** Stable while the card is up, so the panel is not rebuilt under a finger. */
  id: number;
  text: string;
  kind: Message['kind'];
  /** Where it happened, if anywhere. The card grows a Look button when set. */
  at?: { x: number; y: number };
  /** Seconds before it goes on its own. */
  life: number;
  /** What it started with, so the card can fade over its last moment. */
  span: number;
}

/**
 * Cards on screen at once.
 *
 * Three. A raid can raise a card for the warning, the raiders, two settlers down
 * and the all-clear inside a minute, and a column of six is a wall of text over
 * the thing the player is trying to look at — which is the failure the cards
 * exist to fix, not a fix for it.
 */
export const MAX_TOASTS = 3;

/**
 * How long a card stays, by kind, in seconds.
 *
 * A threat outlives the rest by design: "raiders are coming" has to survive the
 * ten seconds a player spends drafting settlers, and it is the one message where
 * missing it costs the run. Good news is the shortest — it is nice to know and
 * nothing goes wrong if you were looking elsewhere.
 */
export const TOAST_LIFE: Record<Message['kind'], number> = {
  threat: 22,
  bad: 16,
  good: 11,
  info: 11,
};

/** Seconds of fade at the end. Long enough to notice a card leaving. */
export const FADE = 1.2;

export class ToastStack {
  private items: Toast[] = [];
  private nextId = 1;

  /**
   * Raise a card, if the message asked for one.
   *
   * Every message goes to the log; only a headline comes here. Repeating the
   * exact same line — a second wall falling in the same fire, the same warning
   * on two consecutive days — refreshes the card that is already up instead of
   * stacking a duplicate on top of it.
   */
  push(m: Message): void {
    if (!m.headline) return;
    const same = this.items.find((t) => t.text === m.text);
    if (same) {
      same.life = TOAST_LIFE[m.kind];
      same.span = same.life;
      if (m.at) same.at = m.at;
      return;
    }
    const life = TOAST_LIFE[m.kind];
    const t: Toast = { id: this.nextId++, text: m.text, kind: m.kind, life, span: life };
    if (m.at) t.at = m.at;
    this.items.unshift(t);
    // Newest first, so the card that just appeared is the one nearest the top
    // bar where the eye already is. When the stack overflows, the *oldest* card
    // goes — but never a threat while an ordinary card is still standing, or a
    // raid warning gets pushed off the screen by the aurora fading.
    while (this.items.length > MAX_TOASTS) {
      let victim = this.items.length - 1;
      for (let i = this.items.length - 1; i >= 0; i--) {
        if (this.items[i]!.kind !== 'threat') {
          victim = i;
          break;
        }
      }
      this.items.splice(victim, 1);
    }
  }

  /**
   * Burn `dt` seconds off every card.
   *
   * Called with the render clock rather than the sim tick, because a card is a
   * thing a player reads and reading happens in real seconds. The caller passes
   * zero while the game is paused: a player who hit space to think about a raid
   * should still have the raid card there when they look up.
   */
  age(dt: number): void {
    if (dt <= 0) return;
    for (const t of this.items) t.life -= dt;
    this.items = this.items.filter((t) => t.life > 0);
  }

  /** Send one away by hand. The × on the card. */
  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }

  /** Clear the lot — a new colony does not inherit the last one's bad news. */
  clear(): void {
    this.items = [];
  }

  /** Newest first. */
  list(): Toast[] {
    return this.items;
  }

  /** 0..1, for the last moment of a card's life. */
  static opacity(t: Toast): number {
    return t.life >= FADE ? 1 : Math.max(0, t.life / FADE);
  }
}

/** A rectangle on the screen. What `getBoundingClientRect` gives, minus the rest. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Widest a card column gets, however much room there is. */
export const CARD_MAX = 440;
/** Narrowest it is allowed to be squeezed to before it stops giving ground. */
export const CARD_MIN = 260;
/** Breathing room against a panel edge and against the screen edge. */
export const CARD_GAP = 10;

/**
 * Where the card column goes, given the screen and the panels already on it.
 *
 * Centring in the *viewport* is only right when the viewport is wide. At 1024
 * the roster and the goals panel leave a comfortable channel down the middle; at
 * 768 they do not, and a column centred on the screen lands on top of both —
 * with `pointer-events: auto` on every card, so it also eats the clicks meant
 * for the settler you were trying to select. So the column is centred in what is
 * *left*, not in the window.
 *
 * Only panels that overlap the column's own band count: the log lives at the
 * bottom of the screen and has no opinion about a card at the top. That falls
 * out of the same test rather than a list of which panels are which, so a panel
 * the player has dragged somewhere else constrains the cards from wherever they
 * put it.
 *
 * If the channel closes to less than `CARD_MIN` the column stops shrinking and
 * takes the overlap. A card too narrow to hold a sentence and two buttons is not
 * a card, and the only way to get there is to drag the panels together yourself.
 */
export function cardChannel(
  screenW: number,
  band: { top: number; bottom: number },
  panels: Box[],
): { left: number; width: number } {
  let left = CARD_GAP;
  let right = Math.max(CARD_GAP, screenW - CARD_GAP);
  const mid = screenW / 2;
  for (const p of panels) {
    if (p.right <= p.left || p.bottom <= p.top) continue;
    if (p.bottom <= band.top || p.top >= band.bottom) continue;
    // Which side it is on is decided by where its middle is, not its edges: a
    // panel wider than half the screen has edges on both sides of centre.
    if ((p.left + p.right) / 2 < mid) left = Math.max(left, p.right + CARD_GAP);
    else right = Math.min(right, p.left - CARD_GAP);
  }
  const free = right - left;
  const width = Math.min(CARD_MAX, Math.max(CARD_MIN, free));
  // Centred in the channel when it fits, and centred on the channel's middle
  // when it does not — then pulled back on screen, because overlapping a panel
  // is survivable and hanging off the edge is not.
  let x = left + (free - width) / 2;
  x = Math.max(CARD_GAP, Math.min(x, screenW - CARD_GAP - width));
  return { left: Math.round(x), width: Math.round(width) };
}
