/**
 * The colony having a bad day, photographed with the interface up.
 *
 * The standard sixteen frames pause seed 4242 at the first tick past 1800, and
 * at that tick nothing has gone wrong yet: nobody is down, the pantry is full,
 * the woodpile is full, and the alert strip is empty or close to it. So the two
 * HUD frames that round ten added — `6-hud-colony` and `7-hud-selected` — have
 * only ever photographed a quiet desk. Every panel that exists to carry bad news
 * has been judged on a day with none: the alert strip at its cap and its `+N
 * more` row, the message log full enough to reach the panel below it, an
 * inspector open on a settler who is bleeding on the floor. An interface round
 * was spent on those panels and this is the state they were built for, which
 * until now nothing could take a picture of.
 *
 * What is real here and what is staged, said plainly, because the difference is
 * the whole worth of the frames. The fire, the raid, the solar flare and the flu
 * go through `aether.*`, which calls the same `forceThreat`/`igniteFire`/
 * `afflict` the storyteller calls — no second code path, so the alerts, the log
 * lines and the models are the ones a real event produces. The rest is state
 * written by hand: the stores emptied, two settlers put on the floor, moods
 * dropped, weapons taken away, and the raiders walked in from the map edge to
 * where the camera can see them. Those are not events and there is no honest way
 * to fake them into being events; they are the colony this harness needs to
 * exist, set up the way the crew line stands seven settlers in a row.
 *
 *   LOOK_MIRROR=$SCRATCH/frames npm run look:trouble -- .look/shots/r14 r14
 */

import { launch, URL } from './chrome.mjs';
import { copyFileSync, mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const label = process.argv[3] ?? 'trouble';
mkdirSync(out, { recursive: true });
const mirror = process.env.LOOK_MIRROR || '';
if (mirror) mkdirSync(mirror, { recursive: true });
const TICKS_PER_DAY = 4800;
// Every frame this run is supposed to write, so the last line can name the ones
// that did not happen instead of leaving a short run looking like a whole one.
const WANTED = ['T1-desk', 'T2-desk-downed', 'T3-phone-map', 'T3-phone-details', 'T3-phone-events', 'T3-phone-crew', 'T3-phone-more'];
const took = [];

// A stopwatch on each step, on stderr so it does not sit between the two report
// lines. When this harness dies it dies inside a `page.evaluate` that never came
// back, which from the outside is one protocol timeout and no clue which of the
// dozen steps was holding the page. Two runs were spent guessing at that before
// this line existed.
const t0 = Date.now();
const step = (what) => process.stderr.write(`${((Date.now() - t0) / 1000).toFixed(1)}s ${what}\n`);

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (code) => { await page.keyboard.down(code); await sleep(60); await page.keyboard.up(code); await sleep(150); };
const shot = async (name) => {
  step(`shot ${name}`);
  await sleep(1200);
  const path = `${out}/${label}-${name}.png`;
  await page.screenshot({ path });
  if (mirror) copyFileSync(path, `${mirror}/${label}-${name}.png`);
  took.push(name);
};
// Space, and then proof that Space arrived — lifted from `shot.mjs`, and for the
// same reason: under GPU contention the focus call and the keypress can land
// either side of a slow frame, and every frame after an unpause is of a colony
// walking about while the script believes it is standing still.
const pause = async () => {
  for (let i = 0; i < 3; i++) {
    if (await page.evaluate(() => window.aetherhold?.speed === 0)) return;
    await page.evaluate(() => document.getElementById('canvas').focus());
    await key('Space');
    await sleep(300);
  }
  if (!(await page.evaluate(() => window.aetherhold?.speed === 0))) {
    throw new Error('the sim would not pause — Space is not reaching the canvas, and every frame after this one would be of a colony in motion');
  }
};
let mid = { x: 640, y: 400 };
let net = 0;
const zoomTo = async (target) => {
  const ticks = target - net;
  for (let i = 0; i < Math.abs(ticks); i++) { await page.mouse.move(mid.x, mid.y); await page.mouse.wheel({ deltaY: ticks > 0 ? -100 : 100 }); await sleep(60); }
  net = target;
};

// The same colony as every other harness: seed 4242, paused at the first tick
// past 1800, clock forced to noon. The trouble is staged on top of that, so the
// before-and-after of an interface change is two pictures of one colony.
const start = async (timeout) => {
  await page.evaluate(() => { const box = document.querySelector('input.seedbox'); if (box) box.value = '4242'; const play = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Play'); play?.click(); });
  await sleep(1500);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(2500);
  await page.evaluate(() => document.getElementById('canvas').focus());
  await page.waitForFunction(() => window.aether.world.tick >= 1800, { polling: 16, timeout });
  await pause();
  await page.evaluate((tpd) => { const w = window.aether.world; w.tick = w.tick - (w.tick % tpd) + Math.round(tpd * 0.5); }, TICKS_PER_DAY);
};

// Everything wrong at once, and a count of what the strip ended up holding.
// Called twice — the phone half needs a reload, which throws the staged colony
// away along with the desk layout, so the trouble has to be repeatable rather
// than a script that runs once down the page.
const stage = () => page.evaluate(() => {
  const a = window.aether;
  const w = a.world;
  const home = w.pawns.find((p) => p.faction === 'colony' && !p.dead);
  const hx = Math.round(home.x), hy = Math.round(home.y);
  // Software GL never lets the colony reveal its own ground before the shot, and
  // shrouded cells hide the fire the alert strip is talking about.
  if (!w.seen) w.seen = new Array(w.width * w.height).fill(0);
  for (let y = hy - 26; y <= hy + 26; y++) for (let x = hx - 26; x <= hx + 26; x++) {
    if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
    w.seen[y * w.width + x] = 1;
  }
  w.stats.explored = (w.stats.explored ?? 0) + 1;

  // The real events, through the storyteller's own calls.
  a.fire(hx + 2, hy + 2);
  a.fire(hx - 3, hy + 4);
  a.raid();
  a.flare();

  const crew = w.pawns.filter((p) => p.faction === 'colony' && !p.dead);
  if (crew[0]) a.ill(crew[0].id);

  // The staged half. Emptying `items` empties the pantry, the woodpile, the
  // medicine shelf and the steel in one line, which is four alert rows and is
  // also the honest end state of a colony that has stopped coping.
  w.items.length = 0;
  crew.slice(0, 2).forEach((p) => { p.downed = true; });
  crew.forEach((p) => { p.mood = 0.18; p.weapon = 'none'; });

  // Raiders spawn at the map edge and walk in, and this colony is paused, so
  // without a nudge the strip would say "hostiles on the map" over a frame with
  // none in it. Put them where the sentence can be checked.
  const raiders = w.pawns.filter((p) => p.faction === 'raider' && !p.dead);
  raiders.forEach((p, i) => { p.x = hx + 7 + (i % 4) * 2; p.y = hy - 5 - Math.floor(i / 4) * 2; });
  // One of them does not get up, which is the only way to reach the unburied-body
  // row without killing somebody the colony is counting.
  if (raiders[0]) { raiders[0].dead = true; raiders[0].downed = false; }

  a.look(hx, hy);
  // The name, so the roster row can be found by who it is about rather than by
  // guessing at the word the activity column happens to print.
  return { home: { x: hx, y: hy }, raiders: raiders.length, crew: crew.length, downed: crew[0]?.name ?? '' };
});

// How full the strip actually got, read from the DOM rather than from the sim,
// because the question this harness exists to ask is what the panel does with
// the news and not how much news there is.
const strip = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#alerts .alert')].map((r) => r.textContent?.trim() ?? '');
  const log = document.querySelectorAll('#log > div').length;
  return { rows: rows.length, last: rows[rows.length - 1] ?? '', log };
});

// Where the panels actually are, which is the one thing the frames above cannot
// be trusted on. A panel drawn over another panel photographs as a correct
// panel: the one on top looks right, and nothing on it says it is standing on
// something. Round fourteen read these numbers out of the stylesheet by hand and
// got the mechanism wrong twice before the source corrected it, so they are
// measured here instead — off the same staged colony, in the same run, so a
// frame and the geometry behind it can never disagree.
const column = () => page.evaluate(() => {
  const box = (id) => {
    const e = document.getElementById(id);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const panels = ['goals', 'inspector', 'alerts', 'log', 'colonists', 'minimap'].map(box).filter(Boolean);
  const over = [];
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i], b = panels[j];
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w > 0 && h > 0) over.push(`${a.id}/${b.id} ${w}x${h}`);
    }
  }
  // The count row specifically, because it is the row whose whole job is to be
  // read when the others cannot be, and it is the last child of the box that is
  // cutting them.
  const panel = document.getElementById('alerts');
  const seen = (row) => {
    const p = panel.getBoundingClientRect(), r = row.getBoundingClientRect();
    return r.top >= p.top - 1 && r.bottom <= p.bottom + 1;
  };
  const rows = [...panel.querySelectorAll('.alert')];
  const more = panel.querySelector('.alert.more');
  return {
    over,
    rows: rows.length,
    shown: rows.filter(seen).length,
    more: more ? (seen(more) ? 'in view' : 'CUT') : 'none',
  };
});

step('load');
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3500);
step('start');
await start(120000);
step('stage');
const site = await stage();
// Wide enough that the colony, the fire and the raiders are all in one frame,
// which is the same zoom `3-colony` is taken at.
step('zoom');
await zoomTo(3);
await sleep(2500);
await page.evaluate(() => document.getElementById('canvas').focus());
// The desk with nothing selected and every panel populated at once: the roster
// down the left, the log, the alerts, the goals. `shot.mjs` reaches this state by
// leaving first person; here nothing has selected anything, so one Escape to put
// the tool back to select is enough.
await key('Escape');
await shot('T1-desk');
step('strip, desk');
const deskStrip = await strip();
step('column, desk');
const deskCol = await column();
// The same desk with a settler who is on the floor, which is the arrangement
// that puts the inspector, the Next steps panel and a full alert strip on screen
// together — the three panels round ten found colliding by reading CSS.
const clickDowned = (name) => page.evaluate((who) => {
  const rows = [...document.querySelectorAll('#colonists .colonist')];
  const hurt = rows.find((r) => r.querySelector('.name')?.textContent === who);
  (hurt ?? rows[0])?.click();
}, name);
step('select the downed settler');
await clickDowned(site.downed);
await shot('T2-desk-downed');
step('column, selected');
const selCol = await column();

// The phone, which needs a reload for `layout-mode.ts` to ask its two questions
// at 390 points with touch on, and therefore needs the whole colony staged again.
// Behind a net, exactly as `shot.mjs` runs it: both desk frames are already on
// disk by this line and a phone half that throws must not take the report with it.
let phoneStrip = null;
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  mid = { x: 195, y: 400 };
  step('reload as a phone');
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3500);
  if (!(await page.evaluate(() => document.getElementById('hud')?.classList.contains('phone')))) {
    console.log(`${label}: the phone layout did not engage after the reload — no T3-phone frames`);
  } else {
    step('start, phone');
    await start(180000);
    const phoneSite = await stage();
    net = 0;
    await zoomTo(3);
    // The camera eases rather than jumps, and the reload put it back at the
    // valley's own starting point, which is a long way from the colony.
    await sleep(4000);
    await shot('T3-phone-map');
    phoneStrip = await strip();
    await clickDowned(phoneSite.downed);
    await shot('T3-phone-details');
    for (const name of ['Events', 'Crew', 'More']) {
      await page.evaluate((l) => {
        // By key, and then checked. Matching the label broke silently the round a
        // count was appended to one of these buttons, and a click that lands on
        // nothing photographs the sheet that was already up under the name of the
        // one that was asked for.
        const k = l.toLowerCase();
        const b = document.querySelector(`#tabbar .sheetbtn[data-key='${k}']`);
        if (!b) throw new Error(`no tab button carries data-key='${k}'`);
        b.click();
        if (document.getElementById('hud')?.dataset.sheet !== k) {
          throw new Error(`clicking ${l} did not raise the ${k} sheet`);
        }
      }, name);
      await shot(`T3-phone-${name.toLowerCase()}`);
    }
  }
} catch (e) {
  console.log(`${label}: the phone half failed — ${e && e.message ? e.message : e}`);
}

const missed = WANTED.filter((n) => !took.includes(n));
console.log(`${label}: ${errs.length} console errors, ${site.crew} settlers and ${site.raiders} raiders, desk strip ${deskStrip.rows} rows ending "${deskStrip.last}" over ${deskStrip.log} log lines, phone strip ${phoneStrip ? `${phoneStrip.rows} rows` : 'not reached'}, ${took.length}/${WANTED.length} frames${missed.length ? `, MISSING ${missed.join(' ')}` : ' (all)'}`, errs.slice(0, 3));
// Second line, and the one to read first when a panel change is being judged: a
// count row reported as CUT, or an overlap that was not there last round, is a
// regression the frames would have shown as a tidy screen.
for (const [when, c] of [['nothing selected', deskCol], ['a settler selected', selCol]]) {
  console.log(`${label}: ${when} — alert strip shows ${c.shown} of ${c.rows} rows, count row ${c.more}; overlaps ${c.over.length ? c.over.join(', ') : 'none'}`);
}
await browser.close();
