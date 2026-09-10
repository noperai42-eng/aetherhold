// Photograph every model on the bench, at the viewport the look loop judges at.
//
// The model list is not written down here, for the reason `review.mjs` does not
// write its scene list down: the bench with no `?model=` on it renders an index
// of everything registered, so this reads that index and shoots what it finds.
// A recipe added in `src/forge/recipes.ts` is photographed on the next run
// without anybody remembering to come here.
//
// Two frames come out of each model. The bench itself, sliders and all, which is
// the frame to judge one shape in; and its `Generate 12`, which is the frame
// that says whether the recipe has variety in it or twelve copies of one lump.
// Then one contact sheet over all of them, which is the only thing that can
// answer "which of the models have actually been looked at" — the question
// FORGING.md says the bench exists to stop guessing at, and which it can only
// answer honestly if it counts against the whole game and not against itself.
//
// Provenance is the URL, and the URL is real since stage 3: every field of a
// recipe rides in the query string, so `page.url()` after a load is the exact
// thing in the picture. It is written to a JSON beside the frames rather than
// drawn into them, because a harness that doctors the page before shooting it
// is a harness whose frames are not quite the page.
import { launch, URL as BASE } from './chrome.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * How many models the game actually has, against how many the bench can shape.
 *
 * Without this the sheet says "2 of 2" and reads as complete, which is the exact
 * failure FORGING.md's risks section names: a bench covering two models that
 * says it covers the game. The census is `models/manifest.json`, which
 * `npm run export:models` writes and `.gitignore` covers, so a box that has
 * never run the export is told that rather than quietly given a smaller
 * denominator.
 */
function census() {
  try {
    return Object.keys(JSON.parse(readFileSync('models/manifest.json', 'utf8')).models).length;
  } catch {
    return null;
  }
}
const total = census();

// Under `.look/`, which `.gitignore` covers: a sweep is a handful of PNGs and
// the verdict written into ROUND_NOTES.md is the part worth keeping.
const out = process.argv[2] ?? '.look/shots/forge';
const label = process.argv[3] ?? 'r0';
/**
 * A comma list of column counts turns this into an arrangement sweep.
 *
 * Without it the sweep is the one every round is compared across and must not
 * move: the bench, and its grid at the stage's own default. With it the two
 * standard frames are skipped and the grid is shot once per count instead,
 * which is the only way to answer whether a family reads better at three to a
 * row than at four — a question the round that added this could measure the
 * inputs to and could not settle, because a bounding box is not a silhouette.
 */
const arrangement = (process.argv[4] ?? '')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
mkdirSync(out, { recursive: true });

const browser = await launch();
const page = await browser.newPage();
// The same 1280x800 at 1.5x the rest of the loop uses, so a bench frame and a
// game frame can be put side by side without one of them being resampled.
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });

const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e)));

const url = BASE.replace(/\/$/, '');
await page.goto(`${url}/forge.html`, { waitUntil: 'networkidle0' });
// Each index link carries what that bench shapes, because a bench is not a model:
// the wood is two crown variants, the stack is eight files, the herd is four
// species. Reading the names and counting them is what made this sheet say six.
const listed = await page.$$eval('.index a', (as) => as.map((a) => ({
  name: a.textContent.trim(),
  covers: (a.dataset.covers ?? '').split(',').filter(Boolean),
})));
if (!listed.length) throw new Error('the bench index listed no models — is the dev server on forge.html?');
const models = listed.map((m) => m.name);
const covered = new Set(listed.flatMap((m) => m.covers));

/**
 * Two animation frames.
 *
 * `networkidle0` says the page has stopped fetching, which on a WebGL page says
 * nothing at all about whether anything has been drawn into the canvas yet. One
 * frame schedules the draw and the second lands after it.
 */
const drawn = () => page.evaluate(
  () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
);

const took = [];
const shots = [];
for (const name of models) {
  if (arrangement.length) {
    for (const n of arrangement) {
      await page.goto(`${url}/forge.html?model=${name}&columns=${n}`, { waitUntil: 'networkidle0' });
      const at = await page.$('.bench');
      if (!at) { errs.push(`${name}: no bench rendered at ${n} columns`); continue; }
      // Draw once before touching the page. `networkidle0` only says the module
      // graph has stopped arriving; clicking into a page whose first frame has
      // not been scheduled is how this loop lost its last model twice, with
      // "execution context was destroyed" from inside the click.
      await drawn();
      await page.click('#grid');
      await drawn();
      const file = `${label}-${name}-c${n}.png`;
      await at.screenshot({ path: `${out}/${file}` });
      shots.push({ file, model: name, of: `${n} to a row`, url: page.url() });
    }
    took.push(name);
    continue;
  }

  await page.goto(`${url}/forge.html?model=${name}`, { waitUntil: 'networkidle0' });
  const bench = await page.$('.bench');
  if (!bench) { errs.push(`${name}: no bench rendered`); continue; }
  await drawn();
  // The whole bench and not just the canvas: the sliders beside the model are
  // every number that made it, so the frame says what it is a frame of without
  // anything having to be stamped on top of it.
  const one = `${label}-${name}.png`;
  await bench.screenshot({ path: `${out}/${one}` });
  shots.push({ file: one, model: name, of: 'one', url: page.url() });

  await page.click('#grid');
  await drawn();
  const twelve = `${label}-${name}-12.png`;
  await bench.screenshot({ path: `${out}/${twelve}` });
  // The grid is the recipe in the address under twelve seeds a fixed step
  // apart, so the same URL is the provenance of both frames.
  shots.push({ file: twelve, model: name, of: 'twelve', url: page.url() });
  took.push(name);
}

// What the sheet has to say out loud, because a contact sheet is the thing
// somebody will quote as coverage.
// Assemblies and not benches: the grass declares none on purpose, so a page that
// declares none at all is a page whose index predates `covers` rather than a
// bench that covers nothing, and it is told that rather than given a zero.
const gap = total === null
  ? 'census unknown — run npm run export:models'
  : covered.size === 0
    ? `${models.length} benches, coverage undeclared — is this index built from src/forge/recipes.ts?`
    : `${covered.size} of ${total} assemblies on the bench`;

// The contact sheet, built from the bytes just written rather than from the
// files on disk: a `file://` page reading `file://` images is a fight with
// Chrome's origin rules that this does not need to have.
if (shots.length) {
  const cells = shots.map((s) => {
    const b64 = readFileSync(`${out}/${s.file}`).toString('base64');
    return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${s.file}<br><span>${s.url}</span></figcaption></figure>`;
  }).join('');
  await page.setContent(
    `<style>
      body { margin: 0; padding: 18px; background: #14171b; color: #cfd6dd;
             font: 12px ui-monospace, Menlo, monospace; }
      h1 { font-size: 13px; font-weight: 600; margin: 0 0 14px; }
      .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      figure { margin: 0; }
      img { width: 100%; display: block; border: 1px solid #2b3138; }
      figcaption { padding: 5px 2px; line-height: 1.5; }
      figcaption span { color: #7b858f; word-break: break-all; }
    </style>
    <h1>Aetherhold forge — ${label} — ${took.length} of ${models.length} shot, ${gap}</h1>
    <div class="sheet">${cells}</div>`,
    { waitUntil: 'load' },
  );
  await page.screenshot({ path: `${out}/${label}-sheet.png`, fullPage: true });
}

writeFileSync(`${out}/${label}-frames.json`, `${JSON.stringify({ label, shots }, null, 2)}\n`);

await browser.close();
console.log(`${took.length}/${models.length} models: ${took.join(', ')}`);
console.log(gap);
const missed = models.filter((m) => !took.includes(m));
if (missed.length) console.log(`MISSED: ${missed.join(', ')}`);
if (errs.length) console.log(`console errors:\n${errs.join('\n')}`);
