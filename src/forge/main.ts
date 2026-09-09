/**
 * Entry point for the forge: read `?model=`, put that one thing on the bench,
 * and hand its knobs to whoever is looking.
 *
 * A sibling of `src/review/main.ts` rather than a mode inside it, and the split
 * is not tidiness. The review page stages HTML panels against a fixture world
 * and has no canvas in it on purpose; this one is a WebGL scene with a light rig
 * and nothing else, and the two would share a stylesheet, an index and a
 * `?scene=` that meant two different things. `?model=` with nothing after it
 * lists what there is, for the same reason the review page does: the commonest
 * way to arrive here with a wrong name is to have typed it.
 *
 * What this page is *for* is the loop [FORGING.md](../../FORGING.md) describes.
 * Every number in a rock or a tree used to be a literal in the middle of a
 * render file, and seeing what a different one looked like meant editing,
 * rebuilding, starting a colony and walking to a rock. Here it is a slider, and
 * `Generate 12` is the same recipe under twelve seeds at once — which is the
 * frame a round note can actually carry a before and after of.
 */

import '../client/ui/style.css';
import './forge.css';

import { BuildingsView } from '../client/render/buildings';
import { benchWorld, forge, forgeSeeds, prototypes } from './forge';
import { BENCHES, benchByName, type Bench, type Knobs } from './recipes';
import { Stage } from './stage';

/** How many of the recipes you have looked at the strip along the bottom keeps. */
const HISTORY = 16;
/** How many seeds `Generate 12` lays out. The button is named after it. */
const GRID = 12;

const app = document.getElementById('app');

function index(missing: string): string {
  const head = missing ? `<h1>Nothing on the bench called “${missing}”</h1>` : '<h1>The bench</h1>';
  const rows = BENCHES.map((b) => `<div><a href="?model=${b.name}">${b.name}</a> — ${b.note}</div>`).join('');
  return `<div class="caption">${head}</div><div class="index">${rows}</div>`;
}

/** A number as short as it can be written without changing it. */
function short(n: number): string {
  return String(Math.round(n * 1e4) / 1e4);
}

/**
 * What a history chip is labelled with: the seed, and a mark when the rest of
 * the recipe was not the default. Text rather than a thumbnail on purpose — a
 * strip of sixteen live previews is sixteen more scenes to light, and what the
 * strip is actually for is getting back to the one you liked two changes ago.
 */
function chipLabel(bench: Bench, k: Knobs): string {
  const seed = short(k[bench.seedKey] ?? 0);
  const moved = bench.fields.some((f) => f.key !== bench.seedKey && k[f.key] !== bench.defaults[f.key]);
  return moved ? `${seed}*` : seed;
}

function start(bench: Bench): void {
  if (!app) return;
  document.title = `${bench.title} — Aetherhold forge`;

  app.innerHTML = `
    <div class="bench">
      <canvas id="stage"></canvas>
      <div class="knobs" id="knobs">
        <div class="caption"><h1>${bench.title}</h1><p>${bench.note}</p></div>
        <div class="fields" id="fields"></div>
        <div class="buttons">
          <button id="seed">Random seed</button>
          <button id="grid">Generate ${GRID}</button>
          <button id="reset">Reset</button>
        </div>
        <div class="problems" id="problems"></div>
        <div class="history"><h2>Last ${HISTORY}</h2><div id="strip"></div></div>
      </div>
    </div>`;

  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const world = benchWorld();
  const view = new BuildingsView();
  const protos = prototypes(world, view);
  const stage = new Stage(canvas, world);

  let knobs: Knobs = { ...bench.defaults };
  const past: Knobs[] = [];

  const fields = document.getElementById('fields')!;
  const problems = document.getElementById('problems')!;
  const strip = document.getElementById('strip')!;

  const inputs = new Map<string, { range: HTMLInputElement; box: HTMLInputElement }>();
  for (const f of bench.fields) {
    const row = document.createElement('label');
    row.className = 'field';
    row.innerHTML = `<span>${f.label}</span>`;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(f.min);
    range.max = String(f.max);
    range.step = String(f.step);
    const box = document.createElement('input');
    box.type = 'number';
    box.min = String(f.min);
    box.max = String(f.max);
    box.step = String(f.step);
    row.append(range, box);
    fields.append(row);
    inputs.set(f.key, { range, box });
    // `input` redraws while the handle is moving, `change` writes the result
    // into the strip. Recording on every frame of a drag would fill sixteen
    // slots with one gesture.
    const set = (raw: string, keep: boolean): void => {
      const v = Number(raw);
      knobs = { ...knobs, [f.key]: v };
      draw(keep);
    };
    range.addEventListener('input', () => set(range.value, false));
    range.addEventListener('change', () => set(range.value, true));
    box.addEventListener('change', () => set(box.value, true));
  }

  function showKnobs(): void {
    for (const [key, io] of inputs) {
      const v = String(knobs[key] ?? 0);
      io.range.value = v;
      io.box.value = v;
    }
  }

  function remember(): void {
    const last = past[past.length - 1];
    if (last && bench.fields.every((f) => last[f.key] === knobs[f.key])) return;
    past.push(knobs);
    while (past.length > HISTORY) past.shift();
    strip.innerHTML = '';
    // Newest first: the one you want back is nearly always the one before this.
    for (let i = past.length - 1; i >= 0; i--) {
      const k = past[i]!;
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = chipLabel(bench, k);
      chip.addEventListener('click', () => {
        knobs = k;
        showKnobs();
        draw(true);
      });
      strip.append(chip);
    }
  }

  /** One model on the bench. `keep` writes what is on it into the strip. */
  function draw(keep: boolean): void {
    showKnobs();
    const made = forge(bench, knobs, protos);
    report(made.problems);
    stage.show(made.group ? [made.group] : []);
    stage.render();
    if (keep && made.group) remember();
  }

  /**
   * The same recipe under twelve seeds a fixed step apart, rather than twelve
   * random ones. The whole use of the grid is a before and after in a round
   * note, and that only works when the twelve in the second frame are the same
   * twelve as in the first — which they are when the seed in the box is the
   * only thing that decides them.
   */
  function drawGrid(): void {
    const first = knobs[bench.seedKey] ?? 0;
    const seeds = Array.from({ length: GRID }, (_, i) => first + i * bench.seedStep);
    const made = forgeSeeds(bench, knobs, seeds, protos);
    report(made.flatMap((m) => m.problems));
    stage.show(made.map((m) => m.group).filter((g): g is NonNullable<typeof g> => g !== null));
    stage.render();
  }

  function report(list: readonly string[]): void {
    problems.innerHTML = list.map((p) => `<div>${p}</div>`).join('');
  }

  document.getElementById('seed')!.addEventListener('click', () => {
    const f = bench.fields.find((q) => q.key === bench.seedKey)!;
    const span = Math.floor((f.max - f.min) / bench.seedStep);
    knobs = { ...knobs, [bench.seedKey]: f.min + Math.floor(Math.random() * span) * bench.seedStep };
    draw(true);
  });
  document.getElementById('grid')!.addEventListener('click', drawGrid);
  document.getElementById('reset')!.addEventListener('click', () => {
    knobs = { ...bench.defaults };
    draw(true);
  });

  const fit = (): void => {
    const r = canvas.getBoundingClientRect();
    stage.resize(Math.round(r.width), Math.round(r.height));
    stage.render();
  };
  window.addEventListener('resize', fit);
  fit();
  draw(true);
}

if (app) {
  const want = new URLSearchParams(location.search).get('model') ?? '';
  const bench = want ? benchByName(want) : null;
  if (!bench) app.innerHTML = index(want);
  else start(bench);
}
