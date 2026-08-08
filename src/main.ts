/** Entry point: find the canvas and the HUD root, start the app, report failures visibly. */

import './client/ui/style.css';
import { App } from './client/app';

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
const hud = document.getElementById('hud');

if (!canvas || !hud) {
  document.body.innerHTML = '<p style="color:#e0745f;font:14px system-ui;padding:24px">index.html is missing #canvas or #hud.</p>';
} else {
  try {
    const app = new App(canvas, hud);
    app.start();
    // Handy in the console while playtesting; nothing in the game reads it.
    (window as unknown as { aetherhold: App }).aetherhold = app;
  } catch (err) {
    console.error('[aetherhold] failed to start', err);
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;inset:0;display:grid;place-items:center;background:#05080c;color:#e0745f;font:14px/1.6 ui-monospace,monospace;padding:32px;text-align:center;white-space:pre-wrap';
    box.textContent = `Aetherhold could not start.\n\n${String(err)}\n\nThis build needs WebGL2.`;
    document.body.append(box);
  }
}
