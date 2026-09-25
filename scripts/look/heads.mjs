/**
 * The compass line: eight settlers stood in a row on clear ground, one facing
 * each eighth of the compass, and photographed together.
 *
 * Round twelve gave the head a neck and then reported that the turn did not
 * survive the manager camera, and blamed the model: a dark sphere whose
 * silhouette barely changes when it rotates. The frames it blamed it from were
 * `crew.mjs`, which pins every settler to one facing so that the hands and the
 * attention are the only things varying along the row -- correct for that
 * round, and blind for this one. Its own comment says that facing is "towards
 * the camera"; the frames show seven backs. So every head this project has
 * ever photographed has been the back of a head, and whether a head has a
 * front has never been in a frame at all.
 *
 * This varies the one thing that harness pins. Eight bodies, no jobs and no
 * loads, heads straight, so the only difference along the row is which way the
 * settler is pointed. If a head has a front, this frame shows it eight times;
 * if it is a circle, this frame says so once and for all.
 *
 * Same pins as the crew line it is modelled on: seed 4242 typed into the setup
 * card, paused at the first tick past 1800, the clock moved to noon, the HUD
 * hidden.
 *
 *   LOOK_MIRROR=$SCRATCH/frames npm run look:heads -- .look/shots/r13 r13
 *   LOOK_HAIR=long npm run look:heads -- .look/shots/r13-long r13-long
 */

import { launch, URL } from './chrome.mjs';
import { copyFileSync, mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const label = process.argv[3] ?? 'heads';
mkdirSync(out, { recursive: true });
const mirror = process.env.LOOK_MIRROR || '';
if (mirror) mkdirSync(mirror, { recursive: true });
const TICKS_PER_DAY = 4800;

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (code) => { await page.keyboard.down(code); await sleep(60); await page.keyboard.up(code); await sleep(150); };

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await sleep(3500);
await page.evaluate(() => { const box = document.querySelector('input.seedbox'); if (box) box.value = '4242'; const play = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Play'); play?.click(); });
await sleep(1500);
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await sleep(2500);
await page.evaluate(() => document.getElementById('canvas').focus());
await page.waitForFunction(() => window.aether.world.tick >= 1800, { polling: 16, timeout: 120000 });
await key('Space');
await page.evaluate((tpd) => { const w = window.aether.world; w.tick = w.tick - (w.tick % tpd) + Math.round(tpd * 0.5); }, TICKS_PER_DAY);
await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });

const shot = async (name) => {
  await sleep(1200);
  const path = `${out}/${label}-${name}.png`;
  await page.screenshot({ path });
  if (mirror) copyFileSync(path, `${mirror}/${label}-${name}.png`);
};
let net = 0;
const zoomTo = async (target) => { const ticks = target - net; for (let i = 0; i < Math.abs(ticks); i++) { await page.mouse.move(640, 400); await page.mouse.wheel({ deltaY: ticks > 0 ? -100 : 100 }); await sleep(60); } net = target; };
const reveal = (x0, y0, x1, y1) => page.evaluate(([x0, y0, x1, y1]) => { const w = window.aether.world; if (!w.seen) w.seen = new Array(w.width * w.height).fill(0); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue; w.seen[y * w.width + x] = 1; } w.stats.explored = (w.stats.explored ?? 0) + 1; }, [x0, y0, x1, y1]);

const home = await page.evaluate(() => {
  const p = window.aether.world.pawns.find((q) => q.faction === 'colony' && !q.dead);
  window.aether.look(Math.round(p.x), Math.round(p.y));
  return { x: Math.round(p.x), y: Math.round(p.y), id: p.id };
});
await reveal(home.x - 70, home.y - 70, home.x + 70, home.y + 70);

const setup = await page.evaluate(([home, hair]) => {
  const w = window.aether.world;
  const TERRAIN_LIST = ['grass', 'dirt', 'stone', 'rock', 'water', 'sand', 'plank', 'paved', 'bridge'];
  const buildingCells = new Set(w.buildings.map((b) => `${b.x},${b.y}`));
  const isClear = (x, y) => {
    if (x < 2 || y < 2 || x >= w.width - 2 || y >= w.height - 2) return false;
    const idx = y * w.width + x;
    const t = TERRAIN_LIST[w.terrain[idx]] ?? 'grass';
    if (t === 'rock' || t === 'water') return false;
    if (w.cellZone && w.cellZone[idx] !== -1) return false;
    return !buildingCells.has(`${x},${y}`);
  };
  const clearRect = (x0, y0, w2, h2) => {
    for (let y = y0; y < y0 + h2; y++) for (let x = x0; x < x0 + w2; x++) if (!isClear(x, y)) return false;
    return true;
  };
  const findZone = (w2, h2) => {
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    for (let r = 10; r <= 90; r += 5) {
      for (const [dx, dy] of dirs) {
        const x0 = home.x + dx * r - Math.floor(w2 / 2);
        const y0 = home.y + dy * r - Math.floor(h2 / 2);
        if (clearRect(x0, y0, w2, h2)) return { x0, y0, x1: x0 + w2 - 1, y1: y0 + h2 - 1 };
      }
    }
    return null;
  };

  const result = { errors: [] };
  const zone = findZone(16, 14);
  result.zone = zone;
  if (!zone) { result.errors.push('no clear 16x14 rectangle within radius 90'); return result; }

  const tpl = w.pawns.find((p) => p.faction === 'colony' && !p.dead && !p.animal);
  if (!tpl) { result.errors.push('no live colonist to clone'); return result; }

  // The row steps one cell east and one cell north per settler, because under
  // this isometric camera a cell east is down-right by as much as a cell north
  // is up-right: the two vertical halves cancel and the line lands straight
  // across the screen. This is `crew.mjs`'s measurement and it is the only part
  // of that harness this one keeps unchanged.
  const x0 = zone.x0 + 3;
  const y0 = zone.y0 + 10;

  // Sim facing 0 is +X and turns towards +Y. Eight of them, in order, so the
  // row reads as a compass swept left to right and a reader can name the angle
  // of any settler by counting along.
  const placed = [];
  for (let i = 0; i < 8; i++) {
    const p = JSON.parse(JSON.stringify(tpl));
    p.id = w.nextId++;
    p.x = x0 + i;
    p.y = y0 - i;
    p.facing = (i * Math.PI) / 4;
    p.path = null;
    p.jobId = null;
    p.targetPawnId = null;
    p.carryingItemId = null;
    p.carryingPawnId = null;
    p.dead = false;
    p.buried = false;
    p.downed = false;
    p.activity = 'idle';
    // Every settler in the row keeps the template's own colours. The first
    // version of this forced bit 12 across the row to get both hair shapes into
    // one frame, on the reasoning that the bit picks the shape -- and it does,
    // but the same bit is inside `(colorSeed >> 8) % HAIR_TONES.length`, so it
    // picks the colour too. The frame came back with four gingers and four
    // brunettes and a comment claiming the only difference along the row was
    // the facing. One thing varies here, and it is the facing; the hair shape
    // is a second axis, and LOOK_HAIR=long photographs the other half of it.
    if (hair === 'long') p.colorSeed = tpl.colorSeed | 0x1000;
    else if (hair === 'cropped') p.colorSeed = tpl.colorSeed & ~0x1000;
    w.pawns.push(p);
    placed.push({ key: `f${i}`, id: p.id, x: p.x, y: p.y, facing: p.facing });
  }

  result.row = placed;
  result.center = { x: x0 + 3, y: y0 - 3 };
  result.close = { x: x0 + 1, y: y0 - 1 };
  result.close2 = { x: x0 + 5, y: y0 - 5 };
  // Nothing here turns a head off the body, but the tick nudge costs nothing
  // and keeps this harness the same shape as the one it was cloned from.
  w.tick += 1;
  return result;
}, [home, process.env.LOOK_HAIR || '']);

console.log('setup:', JSON.stringify(setup));
if (setup.errors && setup.errors.length) console.log('SETUP ERRORS:', setup.errors);

if (setup.zone) {
  await reveal(setup.zone.x0 - 4, setup.zone.y0 - 4, setup.zone.x1 + 4, setup.zone.y1 + 4);
  // Pawns teleported while paused render at their old spot until a real tick
  // runs onTick and resyncs the interpolation buffer -- the trap zoo.mjs
  // documents. Two ticks, then paused again, and nothing moves during a shot.
  await key('Space');
  await sleep(300);
  await key('Space');

  await page.evaluate((c) => window.aether.look(c.x, c.y), setup.center);
  await zoomTo(8);
  await shot('D-heads');
  await page.evaluate((c) => window.aether.look(c.x, c.y), setup.close);
  await zoomTo(14);
  await shot('D2-heads-near');
  await page.evaluate((c) => window.aether.look(c.x, c.y), setup.close2);
  await shot('D3-heads-far');
} else {
  console.log('SKIP D-heads: no zone found');
}

console.log(`${label}: ${errs.length} console/page errors`, errs.slice(0, 10));
await browser.close();
