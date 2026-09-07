/**
 * The crew line: seven settlers stood in a row on clear ground, each one put
 * into a different state of hands and attention, and photographed together.
 *
 * The standard six frames pin a seed and a tick so that two rounds photograph
 * the same colony, and that is exactly what makes them the wrong instrument
 * for this change. Whether the settler under the close camera happens to be
 * hauling forty wood, or has a job two cells north-east, at tick 1800 of seed
 * 4242 is luck. A change to what a settler does with their head and their
 * hands has to be photographed in a frame that *contains* a settler doing it,
 * so this stages one of each and stands them side by side, facing the same
 * way, so the only difference along the row is the thing being judged.
 *
 * Same pins as the zoo it is modelled on: seed 4242 typed into the setup card,
 * paused at the first tick past 1800, the clock moved to noon, the HUD hidden.
 *
 *   LOOK_MIRROR=$SCRATCH/frames npm run look:crew -- .look/shots/r12 r12
 */

import { launch, URL } from './chrome.mjs';
import { copyFileSync, mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const label = process.argv[3] ?? 'crew';
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

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
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

const setup = await page.evaluate((home) => {
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
  if (!zone) { result.errors.push('no clear 18x12 rectangle within radius 90'); return result; }

  const tpl = w.pawns.find((p) => p.faction === 'colony' && !p.dead && !p.animal);
  if (!tpl) { result.errors.push('no live colonist to clone'); return result; }

  // Everyone faces +Y, which is south on the sim grid and towards the camera
  // under the standard isometric view, so a head that has turned is turning
  // across the frame rather than away from it.
  const FACING = Math.PI / 2;
  // The row steps one cell east and one cell north per settler, because under
  // this isometric camera a cell east is down-right by as much as a cell north
  // is up-right: the two vertical halves cancel and the crew lands as a
  // straight line across the screen. Laid out along a grid row instead, as the
  // first shoot did, they run diagonally off the corner and two of the seven
  // are never photographed at all.
  const x0 = zone.x0 + 4;
  const y0 = zone.y0 + 9;

  // The two lookers are aimed at cells three across and two down, which is
  // about 56 degrees off the body -- well inside the 70-degree neck in
  // head-aim.ts, and far enough round to be unmistakable in a frame. A cell
  // straight abreast would be 90 degrees, which the neck correctly refuses,
  // and the round would photograph a head that never moved.
  const specs = [
    { key: 'idle' },
    { key: 'look-right', job: { dx: 3, dy: 2 } },
    { key: 'look-left', job: { dx: -3, dy: 2 } },
    { key: 'working', job: { dx: 2, dy: 2 }, activity: 'working' },
    { key: 'hauling', carryItem: true },
    { key: 'carrying', carryPawn: true },
    { key: 'downed', downed: true },
  ];

  const placed = [];
  specs.forEach((spec, i) => {
    const p = JSON.parse(JSON.stringify(tpl));
    p.id = w.nextId++;
    p.x = x0 + i;
    p.y = y0 - i;
    p.facing = FACING;
    p.path = null;
    p.jobId = null;
    p.targetPawnId = null;
    p.carryingItemId = null;
    p.carryingPawnId = null;
    p.dead = false;
    p.buried = false;
    p.downed = !!spec.downed;
    p.activity = spec.activity ?? 'idle';
    w.pawns.push(p);

    if (spec.job) {
      const tx = p.x + spec.job.dx;
      const ty = p.y + spec.job.dy;
      const job = { id: w.nextId++, kind: 'build', pawnId: p.id, stage: 'work', tx, ty, progress: 0, age: 0 };
      w.jobs.push(job);
      p.jobId = job.id;
      // A stack on the target cell so a reader can see what the head is
      // pointed at; the aim itself reads the job, not the item.
      w.items.push({ id: w.nextId++, kind: 'wood', amount: 10, x: tx, y: ty, carriedBy: null, reservedBy: null });
    }
    if (spec.carryItem) {
      const it = { id: w.nextId++, kind: 'wood', amount: 40, x: p.x, y: p.y, carriedBy: p.id, reservedBy: p.id };
      w.items.push(it);
      p.carryingItemId = it.id;
    }
    if (spec.carryPawn) {
      const hurt = JSON.parse(JSON.stringify(tpl));
      hurt.id = w.nextId++;
      hurt.x = p.x;
      hurt.y = p.y;
      hurt.facing = FACING;
      hurt.path = null;
      hurt.jobId = null;
      hurt.downed = true;
      hurt.activity = 'idle';
      hurt.carryingItemId = null;
      hurt.carryingPawnId = null;
      w.pawns.push(hurt);
      p.carryingPawnId = hurt.id;
    }
    placed.push({ key: spec.key, id: p.id, x: p.x, y: p.y });
  });

  result.crew = placed;
  const mid = Math.floor((specs.length - 1) / 2);
  result.center = { x: x0 + mid, y: y0 - mid };
  // The close frame is about the head, so it centres on the two lookers rather
  // than on the middle of the line.
  result.lookers = { x: x0 + 2, y: y0 - 2 };
  // The head only re-reads its target when the tick changes, so a world
  // mutated while paused needs the clock nudged or every head stays straight.
  w.tick += 1;
  return result;
}, home);

console.log('setup:', JSON.stringify(setup));
if (setup.errors && setup.errors.length) console.log('SETUP ERRORS:', setup.errors);

if (setup.zone) {
  await reveal(setup.zone.x0 - 4, setup.zone.y0 - 4, setup.zone.x1 + 4, setup.zone.y1 + 4);
  // Pawns teleported while paused render at their old spot until a real tick
  // runs onTick and resyncs the interpolation buffer -- the same trap zoo.mjs
  // documents. Two ticks, then paused again, and nothing moves during a shot.
  await key('Space');
  await sleep(300);
  await key('Space');

  await page.evaluate((c) => window.aether.look(c.x, c.y), setup.center);
  await zoomTo(8);
  await shot('D-crew');
  await page.evaluate((c) => window.aether.look(c.x, c.y), setup.lookers);
  await zoomTo(13);
  await shot('D2-crew-close');
} else {
  console.log('SKIP D-crew: no zone found');
}

console.log(`${label}: ${errs.length} console/page errors`, errs.slice(0, 10));
await browser.close();
