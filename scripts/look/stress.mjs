/**
 * The colony in trouble, photographed.
 *
 * `shot.mjs` takes sixteen frames of a colony having a good day: noon, full
 * bars, nobody hurt, the alert panel empty, the log holding four polite lines
 * about a wall going up. Every interface judgement made in ten rounds has been
 * made against that colony. But the panels that matter most are the ones that
 * only appear when something is wrong — the alert stack, the mood breakdown, the
 * injury list in the inspector, the log when six things happen in the same
 * second — and none of them has ever been in a photograph. A panel nobody has
 * seen full is a panel nobody has checked, and the three defects the last round
 * found in the *quiet* panels were all of the same kind: something ran out of
 * room and did not say so.
 *
 * So this is the other half of the instrument. Same seed, same valley, same
 * camera; then the storyteller's whole cupboard is emptied over it at once —
 * the grid dies, a fire starts, two settlers take ill, raiders come over the
 * ridge — and the colony is left to run until the alert panel has filled up.
 * What comes out is not a fair fight and is not meant to be. It is the worst
 * afternoon this game can have, which is exactly the load the interface has to
 * survive without clipping a word.
 *
 * Deliberately *not* here: the clock is never jumped forward. A tick pushed to
 * day four looks like day four in the corner and is not one — every scheduled
 * thing in the world either fires at once or never fires again — and a frame
 * that lies about what it is showing is worse than no frame. This colony is in
 * trouble on its first afternoon, which is a thing that genuinely happens.
 *
 *   node scripts/look/stress.mjs .look/shots/r11 r11
 */
import { launch, URL } from './chrome.mjs';
import { copyFileSync, mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const label = process.argv[3] ?? 'r0';
mkdirSync(out, { recursive: true });
// The same second home for every frame as `shot.mjs` — see the comment there.
const mirror = process.env.LOOK_MIRROR || '';
if (mirror) mkdirSync(mirror, { recursive: true });

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (code) => { await page.keyboard.down(code); await sleep(60); await page.keyboard.up(code); await sleep(150); };
const took = [];
const shot = async (name) => {
  await sleep(1200);
  const path = `${out}/${label}-${name}.png`;
  await page.screenshot({ path });
  if (mirror) copyFileSync(path, `${mirror}/${label}-${name}.png`);
  took.push(name);
};

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3500);
await page.evaluate(() => {
  const box = document.querySelector('input.seedbox');
  if (box) box.value = '4242';
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Play')?.click();
});
await sleep(1500);
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await sleep(2500);
await page.evaluate(() => document.getElementById('canvas').focus());
// The same 1800 ticks the model harness waits for, and for the same reason: the
// colony needs a morning behind it before anything about it is worth reading.
await page.waitForFunction(() => window.aether.world.tick >= 1800, { polling: 16, timeout: 180000 });
await key('Space');

// Same fog handling as the model frames — a colony that has not walked its own
// ground photographs as a grey field, and the minimap in particular is nothing
// but explored ground.
const home = await page.evaluate(() => {
  const p = window.aether.world.pawns.find((q) => q.faction === 'colony');
  window.aether.look(Math.round(p.x), Math.round(p.y));
  return { x: Math.round(p.x), y: Math.round(p.y) };
});
await page.evaluate((h) => {
  const w = window.aether.world;
  if (!w.seen) w.seen = new Array(w.width * w.height).fill(0);
  for (let y = h.y - 26; y <= h.y + 26; y++)
    for (let x = h.x - 26; x <= h.x + 26; x++) {
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      w.seen[y * w.width + x] = 1;
    }
  w.stats.explored = (w.stats.explored ?? 0) + 1;
}, home);

/**
 * Everything the devtools console can do to a colony, fired in one breath.
 *
 * Through `aether.*` rather than by reaching into `world` and setting fields,
 * which matters more than it looks: these are the storyteller's own entry
 * points, so a fire started here is a fire the game knows about — it has an
 * alert, a log line, a chronicle entry and settlers who react to it. A hit
 * point subtracted by hand has none of those, and the panels this frame exists
 * to photograph are exactly the ones that would then stay empty.
 *
 * The order is the order a bad afternoon actually arrives in. The flare goes
 * first because a dead grid is what turns the rest from setbacks into a spiral:
 * no lights, no cooler, no turrets. Then the fire, which the colony will try to
 * fight and thereby stop doing everything else. Then the illnesses, because two
 * settlers in bed is what makes the fire unfightable. The raid is last, and by
 * itself: it takes a few hundred ticks to walk in from the edge of the map, so
 * calling it now means the raiders arrive while everything above is still
 * burning rather than after it has been put out.
 */
await page.evaluate(() => {
  const a = window.aether;
  a.flare();
  a.fire();
  a.ill();
  a.ill();
  a.raid();
});

// Let it burn. Speed 3 rather than a longer wait at speed 1: the sim is capped
// at a tenth of a second of world time per rendered frame, so on a slow frame
// the multiplier is the only thing that buys ticks. Unpause first — Space above
// left it stopped, and a paused colony recovers from nothing.
await key('Space');
await key('Equal');
await key('Equal');
/**
 * Waits until the interface is actually under load, or gives up saying so.
 *
 * A fixed sleep would photograph whatever had happened by then and call it a
 * stress frame, which on a slow frame is an ordinary colony with a small fire.
 * The condition is read off the panel itself — three alert rows and the log box
 * full — because those are the two panels the frame is being taken to judge,
 * and a frame taken before they are full judges nothing. `false` rather than a
 * throw: a run that could not reach the state should still put its frames on
 * disk and say in one line that they are not the frames that were asked for.
 */
const loaded = await page
  .waitForFunction(
    () => document.querySelectorAll('#alerts .alert').length >= 3 && document.querySelectorAll('#log div').length >= 6,
    { polling: 250, timeout: 240000 },
  )
  .then(() => true, () => false);
await key('Space');

// 9. The desk under load, nothing selected. Escape twice for the same reason the
// model harness does it: the tool back to select, then the selection dropped, so
// what is on screen is the arrangement a player is looking at when they are
// deciding what to do about all this.
await page.evaluate((h) => window.aether.look(h.x, h.y), home);
await page.evaluate(() => document.getElementById('canvas').focus());
await key('Escape');
await key('Escape');
await shot('9-stress-colony');

// 9b. A settler selected, and specifically the worst-off one the roster has: the
// inspector's injury list and mood breakdown are the two panels in this game that
// are empty on a good day and long on a bad one, and the roster is sorted by
// nothing in particular, so picking the first row would usually pick somebody
// fine. Clicked through the roster row rather than set by hand, so the frame is
// reachable by a player.
const picked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#colonists .colonist')];
  if (rows.length === 0) return null;
  const w = window.aether.world;
  const hurt = w.pawns.filter((p) => p.faction === 'colony' && !p.dead);
  // The roster prints names; the sim knows who is hurt. Match one to the other
  // rather than trusting the two to be in the same order.
  let worst = null;
  for (const p of hurt) if (!worst || (p.health ?? 1) < (worst.health ?? 1)) worst = p;
  const row = worst ? rows.find((r) => r.textContent?.includes(worst.name)) : null;
  (row ?? rows[0]).click();
  return worst ? `${worst.name} at ${(worst.health ?? 1).toFixed(2)}` : 'first row';
});
await shot('9-stress-selected');

// 9c. The work board with the colony on fire. Every tab in this game has been
// photographed empty or nearly so; the board is the one whose whole job is to
// hold a list, and the list only gets long when the colony has more to do than
// it can do — which is now.
await key('Quote');
await shot('9-stress-board');

console.log(
  `${label}: ${errs.length} console errors, ${loaded ? 'panels loaded' : 'PANELS NEVER FILLED — these are not stress frames'}, ` +
    `selected ${picked ?? 'nobody'}, ${took.length} frames: ${took.join(' ')}`,
  errs.slice(0, 3),
);
await browser.close();
