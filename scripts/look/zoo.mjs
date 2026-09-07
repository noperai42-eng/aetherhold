import { launch, URL } from './chrome.mjs';
import { copyFileSync, mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots';
const label = process.argv[3] ?? 'zoo';
mkdirSync(out, { recursive: true });
// The same second home for every frame as `shot.mjs` — see the comment there.
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

const aetherKeys = await page.evaluate(() => Object.keys(window.aether));
console.log('aether keys:', aetherKeys.join(', '));

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

// ---- Find clear zones and place the zoo ----
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
  const findZone = (w2, h2, avoid) => {
    const overlaps = (x0, y0, x1, y1) => avoid.some((a) => !(x1 < a.x0 - 2 || x0 > a.x1 + 2 || y1 < a.y0 - 2 || y0 > a.y1 + 2));
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    for (let r = 10; r <= 90; r += 5) {
      for (const [dx, dy] of dirs) {
        const x0 = home.x + dx * r - Math.floor(w2 / 2);
        const y0 = home.y + dy * r - Math.floor(h2 / 2);
        const x1 = x0 + w2 - 1;
        const y1 = y0 + h2 - 1;
        if (overlaps(x0, y0, x1, y1)) continue;
        if (clearRect(x0, y0, w2, h2)) return { x0, y0, x1, y1 };
      }
    }
    return null;
  };

  const result = { errors: [] };
  const zones = [];
  // zoneA is taller (14) than a tight 9 so the checked-clear rectangle
  // extends further past the animal row on the north side -- the first
  // attempt used a 9-tall zone and the first-person shot (looking north from
  // 3 cells south of the row) ended up staring into an unrelated building
  // that sat just outside the validated rectangle, north of the row. A
  // buffer in the look direction keeps the FP sightline inside checked-clear
  // ground. (18-tall was tried first and found no rect within radius 90 --
  // 14 is a middle ground that still fits nearby open ground.)
  const zoneA = findZone(16, 14, zones); if (zoneA) zones.push(zoneA);
  const zoneB = findZone(9, 6, zones); if (zoneB) zones.push(zoneB);
  const zoneC = findZone(16, 9, zones); if (zoneC) zones.push(zoneC);
  result.zoneA = zoneA; result.zoneB = zoneB; result.zoneC = zoneC;
  if (!zoneA || !zoneB || !zoneC) { result.errors.push('could not find clear zones for one or more categories'); return result; }

  // ---- A: animals ----
  // Row sits 8 cells south of the zone's north edge and the settler sits a
  // further 3 cells south of the row -- both offsets chosen so the checked-
  // clear rectangle covers the full look-north sightline used for the FP shot.
  const rowY = zoneA.y0 + 8;
  const templates = {};
  for (const k of ['mossback', 'dunhare', 'brambletail', 'fenwolf']) {
    templates[k] = w.pawns.find((p) => p.animal === k && p.faction === 'fauna' && !p.dead) ?? null;
  }
  const specs = [
    { kind: 'mossback', tame: false, bonded: false, hunted: false },
    { kind: 'dunhare', tame: false, bonded: false, hunted: false },
    { kind: 'brambletail', tame: false, bonded: false, hunted: false },
    { kind: 'fenwolf', tame: false, bonded: false, hunted: false },
    { kind: 'mossback', tame: true, bonded: true, hunted: false },
    { kind: 'dunhare', tame: false, bonded: false, hunted: true },
  ];
  const placed = [];
  specs.forEach((spec, i) => {
    const tpl = templates[spec.kind];
    if (!tpl) { result.errors.push(`no live fauna template for kind '${spec.kind}' -- skipped`); return; }
    const clone = JSON.parse(JSON.stringify(tpl));
    clone.id = w.nextId++;
    clone.x = zoneA.x0 + 2 + i * 2;
    clone.y = rowY;
    clone.dead = false;
    clone.activity = 'idle';
    clone.facing = 0;
    delete clone.fleeUntil;
    delete clone.path;
    clone.path = null;
    if (spec.tame) clone.tame = true;
    if (spec.bonded) clone.bondedTo = home.id;
    if (spec.hunted) clone.hunted = true;
    w.pawns.push(clone);
    placed.push({ kind: spec.kind, x: clone.x, y: clone.y, tame: !!spec.tame, bonded: !!spec.bonded, hunted: !!spec.hunted, id: clone.id });
  });
  result.animals = placed;
  const lastX = zoneA.x0 + 2 + (specs.length - 1) * 2;
  const animalCenter = { x: Math.round((zoneA.x0 + 2 + lastX) / 2), y: rowY };
  result.animalCenter = animalCenter;

  // Settler placed 3 cells south of the row, facing north (toward the row), for the FP frame.
  const settler = w.pawns.find((p) => p.id === home.id);
  result.settlerOriginal = { x: settler.x, y: settler.y, facing: settler.facing };
  settler.x = animalCenter.x;
  settler.y = rowY + 3;
  settler.facing = -Math.PI / 2;
  result.settlerFp = { x: settler.x, y: settler.y };

  // ---- B: crops ----
  const cropRowY = zoneB.y0 + 2;
  const cropX0 = zoneB.x0 + 2;
  const cropCells = [0, 1, 2].map((i) => cropRowY * w.width + (cropX0 + i));
  const zoneId = w.nextId++;
  w.zones.push({ id: zoneId, kind: 'growing', cells: cropCells.slice(), accepts: [] });
  for (const c of cropCells) w.cellZone[c] = zoneId;
  const stages = [0.15, 0.6, 1.0];
  cropCells.forEach((c, i) => { w.crops[c] = stages[i]; });
  if (!w.bushes) w.bushes = [];
  const bushRowY = cropRowY + 2;
  const bushCells = [cropX0, cropX0 + 2].map((x) => bushRowY * w.width + x);
  w.bushes.push({ c: bushCells[0], ripe: 0 });
  w.bushes.push({ c: bushCells[1], ripe: 1 });
  result.crops = { stages, x0: cropX0, rowY: cropRowY, bushRowY, center: { x: cropX0 + 1, y: cropRowY + 1 } };

  // ---- C: items ----
  const itemKinds = ['wood', 'steel', 'rawfood', 'meal', 'medicine', 'hide'];
  const itemRowY = zoneC.y0 + 2;
  const itemX0 = zoneC.x0 + 2;
  itemKinds.forEach((kind, i) => {
    const x = itemX0 + i * 2;
    w.items.push({ id: w.nextId++, kind, amount: 10, x, y: itemRowY, carriedBy: null, reservedBy: null });
    w.items.push({ id: w.nextId++, kind, amount: 1, x, y: itemRowY + 2, carriedBy: null, reservedBy: null });
  });
  const lastItemX = itemX0 + (itemKinds.length - 1) * 2;
  result.items = { kinds: itemKinds, rowY: itemRowY, x0: itemX0, center: { x: Math.round((itemX0 + lastItemX) / 2), y: itemRowY + 1 } };

  return result;
}, home);

console.log('setup:', JSON.stringify(setup));
if (setup.errors && setup.errors.length) console.log('SETUP ERRORS:', setup.errors);

if (setup.zoneA) await reveal(setup.zoneA.x0 - 3, setup.zoneA.y0 - 3, setup.zoneA.x1 + 3, setup.zoneA.y1 + 3);
if (setup.zoneB) await reveal(setup.zoneB.x0 - 3, setup.zoneB.y0 - 3, setup.zoneB.x1 + 3, setup.zoneB.y1 + 3);
if (setup.zoneC) await reveal(setup.zoneC.x0 - 3, setup.zoneC.y0 - 3, setup.zoneC.x1 + 3, setup.zoneC.y1 + 3);

// The renderer interpolates every pawn between the last two positions it saw
// at a real sim tick (PawnsView.onTick / .interpolated in
// src/client/render/pawns.ts), and the first-person camera rides that
// interpolated position rather than pawn.x/y directly (src/client/fps/
// controller.ts updateCamera). Teleporting the settler while the sim is
// paused therefore has no visible effect on the FP camera -- paused means
// onTick() never runs again, so the camera stays frozen at the settler's
// pre-teleport spot (which is why the first attempt's FP shot was a wall:
// the settler's original position was inside the starter base). Briefly
// unpausing lets a couple of real ticks run onTick() with the new x/y
// already in place, which resyncs the interpolation buffer; we re-pause
// immediately after so nothing actually moves during the shots.
await key('Space');
await sleep(300);
await key('Space');

// A-animals
if (setup.animalCenter) {
  await page.evaluate((c) => window.aether.look(c.x, c.y), setup.animalCenter);
  // Wider zoom than a single-object closeup: the 6-animal row spans ~10
  // world cells and renders as a diagonal under the isometric camera, so
  // zoomTo(11) (tuned for a one-cell object) cropped the outermost animals.
  await zoomTo(8);
  await shot('A-animals');
} else {
  console.log('SKIP A-animals: no zone found');
}

// A2-animals-fp
if (setup.animalCenter) {
  try {
    const livePos = await page.evaluate((id) => { const p = window.aether.world.pawns.find((q) => q.id === id); return p ? { x: p.x, y: p.y, facing: p.facing } : null; }, home.id);
    console.log('settler position immediately before KeyV:', JSON.stringify(livePos));
    // The first-person camera sits where the body RENDERS, and the rig only
    // learns a new position from a sim tick (pawns.ts onTick snapshots). The
    // sim is paused, so without this the camera stays at the settler's original
    // spot by the starter walls. Run the sim for a few ticks, then pause again.
    await key('Space'); await key('Space');
    await key('KeyV');
    await sleep(1500);
    await shot('A2-animals-fp');
    await key('KeyV'); // back to manager view
    await sleep(500);
  } catch (e) {
    console.log('A2-animals-fp FAILED:', String(e));
  }
} else {
  console.log('SKIP A2-animals-fp: no animal row placed');
}

// B-crops
if (setup.crops) {
  await page.evaluate((c) => window.aether.look(c.x, c.y), setup.crops.center);
  await zoomTo(11);
  await shot('B-crops');
} else {
  console.log('SKIP B-crops: no zone found');
}

// C-items
if (setup.items) {
  await page.evaluate((c) => window.aether.look(c.x, c.y), setup.items.center);
  // Same reasoning as A-animals: a 6-kind x 2-row grid spans too many cells
  // for a one-cell-closeup zoom without cropping the edges.
  await zoomTo(8);
  await shot('C-items');

  // C2-items-close: same grid, tighter zoom (only 6 loose-stack kinds exist total, see report)
  await zoomTo(12);
  await shot('C2-items-close');
} else {
  console.log('SKIP C-items/C2-items-close: no zone found');
}

console.log(`${label}: ${errs.length} console/page errors`, errs.slice(0, 10));
await browser.close();
