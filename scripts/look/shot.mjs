import { launch, URL } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots'; const label = process.argv[3] ?? 'r0';
mkdirSync(out, { recursive: true });
const SHOWCASE = ['wall','stonewall','door','fence','sandbag','turret','trap','bed','medbed','prisonbed','table','gametable','statue','stove','bench','lab','cooler','campfire','heater','generator','battery','solar','watermill','conduit','lamp','grave'];
const TICKS_PER_DAY = 4800;
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (code) => { await page.keyboard.down(code); await sleep(60); await page.keyboard.up(code); await sleep(150); };
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(3500);
await page.evaluate(() => { const box = document.querySelector('input.seedbox'); if (box) box.value = '4242'; const play = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Play'); play?.click(); });
await sleep(1500);
// Software GL takes minutes over the first frame (the environment map is prefiltered
// on it), and the sim only starts ticking once frames flow: wait for two painted
// frames and a moment of ticking before pausing, or the world has never revealed a cell.
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await sleep(2500);
await page.evaluate(() => document.getElementById('canvas').focus());
// Pause at the same tick every run, so two rounds photograph the same colony
// state (a fence half-built in one and finished in the other is not a regression).
await page.waitForFunction(() => window.aether.world.tick >= 1800, { polling: 16, timeout: 120000 });
await key('Space');                       // pause so nothing walks out of shot
// Noon, on the same day: the frames are for judging models, and dusk hides them.
await page.evaluate((tpd) => { const w = window.aether.world; w.tick = w.tick - (w.tick % tpd) + Math.round(tpd * 0.5); }, TICKS_PER_DAY);
await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });
const shot = async (name) => { await sleep(1200); await page.screenshot({ path: `${out}/${label}-${name}.png` }); };
let net = 0;
const zoomTo = async (target) => { const ticks = target - net; for (let i = 0; i < Math.abs(ticks); i++) { await page.mouse.move(640, 400); await page.mouse.wheel({ deltaY: ticks > 0 ? -100 : 100 }); await sleep(60); } net = target; };
// 1. settlers close-up
const home = await page.evaluate(() => { const p = window.aether.world.pawns.find((q) => q.faction === 'colony'); window.aether.look(Math.round(p.x), Math.round(p.y)); return { x: Math.round(p.x), y: Math.round(p.y) }; });
// Software GL advances the sim a tenth of a second per multi-second frame, so the
// colony never gets to reveal its own ground before the shot: reveal it by hand.
const reveal = (x0, y0, x1, y1) => page.evaluate(([x0, y0, x1, y1]) => { const w = window.aether.world; if (!w.seen) w.seen = new Array(w.width * w.height).fill(0); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue; w.seen[y * w.width + x] = 1; } w.stats.explored = (w.stats.explored ?? 0) + 1; }, [x0, y0, x1, y1]);
await reveal(home.x - 26, home.y - 26, home.x + 26, home.y + 26);
await zoomTo(12); await shot('1-settlers');
// How heavy is a frame now? Ten animation frames, wall-clock, so a model round that
// makes the picture slow shows up as a number rather than as a screenshot timeout.
const frameMs = await page.evaluate(() => new Promise((resolve) => { let n = 0; let t0 = 0; const tick = (t) => { if (n === 0) t0 = t; if (++n > 10) return resolve((t - t0) / 10); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));

// 2. showcase rows on revealed ground (cx-14..cx+14, cy-3..cy+10, cy = pawn.y+11), 9 per row, 3 apart
const site = await page.evaluate((kinds) => { const w = window.aether.world; const cx = Math.round(w.pawns[0].x); const cy = Math.round(w.pawns[0].y) + 11;
  const x0 = cx - 14, x1 = cx + 14, y0 = cy - 3, y1 = cy + 10;
  if (w.seen) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue; w.seen[y * w.width + x] = 1; } w.stats.explored = (w.stats.explored ?? 0) + 1; }
  let n = 0; kinds.forEach((k, i) => { const x = cx - 12 + (i % 9) * 3; const y = cy + Math.floor(i / 9) * 3; try { if (window.aether.build(k, x, y)) n++; } catch (e) {} });
  window.aether.look(cx, cy + 3); return { n, cx, cy }; }, SHOWCASE);
await sleep(1500); await zoomTo(-2); await shot('2-buildings');
// 2b. the middle row up close: beds, tables, statue, stove, bench
await page.evaluate((s) => window.aether.look(s.cx - 3, s.cy + 3), site); await zoomTo(8); await shot('2b-closeup');
// 3. colony overview
await page.evaluate((h) => window.aether.look(h.x, h.y), home); await zoomTo(3); await shot('3-colony');
// 4. first person
await key('KeyV'); await sleep(1500); await shot('4-firstperson');
console.log(`${label}: ${errs.length} console errors, ${site.n} showcase buildings stood, ${frameMs.toFixed(0)} ms/frame`, errs.slice(0, 3));
await browser.close();
