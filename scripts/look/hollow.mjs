// Six frames of the hollow pocket, and one of the valley after it closes.
//
// The pocket is a place the player stands in, so it gets photographed like every
// other place: `zoo.mjs` for the animals, this for the hollow. Reach it with
// `?pocket=hollow` — there is no button.
//
// The last frame is the one that earned this file. The pocket borrows the
// renderer from `WorldView` and hands it back on the way out, and the first
// version of that handback left the returning valley wrong in a way no test
// could see and no frame of the pocket itself would show. It is pinned in
// `tests/hollow-pocket.test.ts` now; the frame is still here because the test
// can only ask whether the valley is drawn, not whether it looks right.
import { launch, URL } from './chrome.mjs';
import { copyFileSync, mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const label = process.argv[3] ?? 'h0';
const mirror = process.env.LOOK_MIRROR || '';
mkdirSync(out, { recursive: true });
if (mirror) mkdirSync(mirror, { recursive: true });

const browser = await launch();
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (code) => {
  await page.keyboard.down(code);
  await sleep(80);
  await page.keyboard.up(code);
  await sleep(200);
};
const hold = async (code, ms) => {
  await page.keyboard.down(code);
  await sleep(ms);
  await page.keyboard.up(code);
  await sleep(200);
};
const took = [];
const shot = async (name) => {
  await sleep(1200);
  const file = `${out}/${label}-${name}.png`;
  await page.screenshot({ path: file });
  if (mirror) copyFileSync(file, `${mirror}/${label}-${name}.png`);
  took.push(name);
};

await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
await page.goto(`${URL}?pocket=hollow`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(4000);
await page.evaluate(() => document.getElementById('canvas')?.focus());

// Did the URL actually open the pocket, or is this the colony with a query string?
const opened = await page.evaluate(() => document.getElementById('hud')?.classList.contains('hollow-mode') ?? false);

await shot('1-arrive');
await key('KeyV');
await shot('2-manager');
await key('KeyV');

// Walk toward the mill. Without pointer lock the look direction is fixed, so this
// is whatever forward happens to be — enough to see the ground move and the near
// geometry resolve, not a guided tour.
await hold('KeyW', 1600);
await shot('3-walked');
await key('KeyE');
await shot('4-interact');
await key('KeyV');
await hold('KeyW', 900);
await shot('5-manager-mill');

const state = await page.evaluate(() => {
  const r = document.querySelector('#hollowhud');
  return {
    hudOn: r?.classList.contains('on') ?? false,
    line: document.querySelector('.hollow-line')?.textContent ?? '',
    prompt: document.querySelector('.hollow-prompt')?.textContent ?? '',
    done: document.querySelector('.hollow-done')?.textContent ?? '',
  };
});

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
await sleep(1500);
await shot('6-phone');
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
await sleep(1200);

// Out. This is the frame the review is for.
const left = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#hollowhud .btn')].find((b) => b.dataset.act === 'leave');
  if (!btn) return 'no leave button';
  btn.click();
  return 'clicked';
});
await sleep(2500);
await shot('7-back-in-the-valley');

const after = await page.evaluate(() => {
  const app = window.aetherhold;
  const hud = document.getElementById('hud');
  return {
    pocketChrome: hud?.classList.contains('hollow-mode') ?? null,
    hollowHudPresent: !!document.getElementById('hollowhud'),
    speed: app?.speed ?? null,
    // Every group the pocket hid on the way in, read back off the live scene.
    visible: (() => {
      const v = app?.view;
      if (!v) return null;
      const names = ['terrain', 'decor', 'buildings', 'landmarks', 'pawns', 'pickies', 'shroud', 'sky', 'fx', 'weather'];
      const o = {};
      for (const n of names) o[n] = v[n]?.group?.visible ?? 'missing';
      return o;
    })(),
    touchVisible: (() => {
      const t = document.getElementById('touchcontrols');
      return t ? getComputedStyle(t).display : 'no #touchcontrols element';
    })(),
  };
});

// And can it be reopened after being closed once?
const reentered = await page.evaluate(() => {
  try {
    window.aetherhold.enterHollow();
    return document.getElementById('hud')?.classList.contains('hollow-mode') ?? false;
  } catch (e) {
    return `threw: ${String(e)}`;
  }
});
await sleep(1500);
await shot('8-reentered');

console.log(JSON.stringify({ opened, state, left, after, reentered, took, errs: errs.slice(0, 8), errCount: errs.length }, null, 2));
await browser.close();
