// Photograph every review scene, at the viewport the look loop judges at.
//
// The scene list is not written down here. The review page with no `?scene=` on
// it renders an index of everything registered, so this reads that index and
// shoots what it finds — which means a scene added in `src/review/scenes.ts`
// is photographed on the next run without anybody remembering to come here.
// SHOWCASE in `shot.mjs` is the counter-example: a hand-kept list, and the
// comment above it exists because things fall off hand-kept lists.
import { launch, URL as BASE } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

// Under `.look/`, which `.gitignore` covers: a sweep is ten PNGs and about a
// megabyte, and the verdict written into ROUND_NOTES.md is the part worth keeping.
const out = process.argv[2] ?? '.look/shots/review';
const label = process.argv[3] ?? 'r0';
mkdirSync(out, { recursive: true });
const mirror = process.env.LOOK_MIRROR || '';
if (mirror) mkdirSync(mirror, { recursive: true });

const browser = await launch();
const page = await browser.newPage();
// The same 1280x800 at 1.5x the rest of the loop uses, so a review frame and a
// game frame can be put side by side without one of them being resampled.
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });

const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e)));

const url = BASE.replace(/\/$/, '');
await page.goto(`${url}/review.html`, { waitUntil: 'networkidle0' });
const scenes = await page.$$eval('.index a', (as) => as.map((a) => a.textContent.trim()));
if (!scenes.length) throw new Error('the review index listed no scenes — is the dev server on review.html?');

const took = [];
for (const name of scenes) {
  await page.goto(`${url}/review.html?scene=${name}`, { waitUntil: 'networkidle0' });
  // The caption and the card, not the page: a scene is one small panel on a
  // large dark field, and a full-page shot is mostly field — which at review
  // size means the thing being judged arrives a tenth of the frame wide.
  const app = await page.$('#app');
  if (!app || !(await page.$('#inspector'))) { errs.push(`${name}: no panel rendered`); continue; }
  const file = `${out}/${label}-${name}.png`;
  await app.screenshot({ path: file });
  took.push(name);
}

await browser.close();
console.log(`${took.length}/${scenes.length} scenes: ${took.join(', ')}`);
const missed = scenes.filter((s) => !took.includes(s));
if (missed.length) console.log(`MISSED: ${missed.join(', ')}`);
if (errs.length) console.log(`console errors:\n${errs.join('\n')}`);
