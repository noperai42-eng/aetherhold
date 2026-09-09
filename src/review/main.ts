/**
 * Entry point for the review page: read `?scene=`, draw that one panel, stop.
 *
 * There is no simulation on this page and no loop. It mounts a fixture, hands
 * the panel to the browser and finishes, which is what makes it photographable:
 * the look loop can shoot it the moment the load event fires rather than waiting
 * out a colony.
 *
 * A `?scene=` nobody registered lists what there is instead of failing blank,
 * because the commonest way to arrive here with a wrong name is to have typed it.
 */

import '../client/ui/style.css';
import './review.css';
import { SCENES, sceneByName } from './scenes';

const app = document.getElementById('app');

function index(missing: string): string {
  const head = missing
    ? `<h1>No scene called “${missing}”</h1>`
    : '<h1>Scenes</h1>';
  const rows = SCENES.map(
    (s) => `<div><a href="?scene=${s.name}">${s.name}</a> — ${s.note}</div>`,
  ).join('');
  return `<div class="caption">${head}</div><div class="index">${rows}</div>`;
}

if (app) {
  const want = new URLSearchParams(location.search).get('scene') ?? '';
  const scene = want ? sceneByName(want) : null;
  if (!scene) {
    app.innerHTML = index(want);
  } else {
    document.title = `${scene.title} — Aetherhold review`;
    const caption = document.createElement('div');
    caption.className = 'caption';
    caption.innerHTML = `<h1>${scene.title}</h1><p>${scene.note}</p>`;
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'inspector';
    panel.innerHTML = scene.render();
    app.append(caption, panel);
  }
}
