/**
 * Slim chrome for the hollow pocket. The colony HUD stays mounted; this layer
 * sits on top and the CSS hides the rest so a player is not reading two games.
 */

import type { HollowState } from './hollow-loop';
import { hollowPrompt } from './hollow-loop';

export class HollowHud {
  readonly root: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly line: HTMLElement;
  private readonly viewLbl: HTMLElement;
  private readonly done: HTMLElement;

  constructor(
    host: HTMLElement,
    hooks: { leave: () => void; toggleView: () => void },
  ) {
    this.root = document.createElement('div');
    this.root.id = 'hollowhud';
    this.root.innerHTML =
      `<div class="panel hollow-top">` +
      `<b>Mortal hollow</b>` +
      `<span class="hollow-view">inhabit</span>` +
      `<button type="button" class="btn" data-act="view">V · switch view</button>` +
      `<button type="button" class="btn" data-act="leave">Back to the valley</button>` +
      `</div>` +
      `<div class="panel hollow-hint">` +
      `<b>WASD</b> walk · <b>Shift</b> hurry · <b>E</b> hands · <b>mouse</b> look` +
      `<span>No qi. Throw the gate-lever and haul the snag.</span>` +
      `</div>` +
      `<div class="panel hollow-prompt"></div>` +
      `<div class="panel hollow-line"></div>` +
      `<div class="panel hollow-done">The mill is turning. The hollow has grain again.</div>`;
    host.append(this.root);
    this.viewLbl = this.root.querySelector('.hollow-view')!;
    this.prompt = this.root.querySelector('.hollow-prompt')!;
    this.line = this.root.querySelector('.hollow-line')!;
    this.done = this.root.querySelector('.hollow-done')!;
    this.root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement | null)?.closest('[data-act]')?.getAttribute('data-act');
      if (act === 'leave') hooks.leave();
      if (act === 'view') hooks.toggleView();
    });
  }

  setActive(on: boolean): void {
    this.root.classList.toggle('on', on);
  }

  sync(s: HollowState): void {
    this.viewLbl.textContent = s.view;
    const prompt = hollowPrompt(s);
    this.prompt.textContent = prompt ? `E · ${prompt}` : '';
    this.prompt.classList.toggle('on', prompt.length > 0);
    this.line.textContent = s.line;
    this.line.classList.toggle('on', s.line.length > 0);
    this.done.classList.toggle('on', s.cleared);
  }

  dispose(): void {
    this.root.remove();
  }
}
