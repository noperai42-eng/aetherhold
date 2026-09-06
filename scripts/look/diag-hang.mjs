// The harness stalls somewhere after the frames start: this walks the same steps
// with a stopwatch on each, measures animation frames separately from the
// screenshot, and if the page stops answering it pauses the JS engine through
// the inspector and prints the stack it was standing on.
import { launch, URL } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots/hang';
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const browser = await launch();
const page = await browser.newPage();
await page.setViewport(process.env.VIEW === 'small' ? { width: 960, height: 600, deviceScaleFactor: 1 } : { width: 1280, height: 800, deviceScaleFactor: 1.5 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log('console', m.type(), m.text().slice(0, 200)); });
page.on('pageerror', (e) => log('pageerror', String(e).slice(0, 300)));
const client = await page.createCDPSession();
await client.send('Debugger.enable');
let paused = null;
client.on('Debugger.paused', (ev) => { paused = ev; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (code) => { await page.keyboard.down(code); await sleep(60); await page.keyboard.up(code); await sleep(150); };
// Ten animation frames or a 15 s ceiling; the ceiling means the main thread is not
// coming back and we go and ask the debugger where it is.
const frameMs = async (tag) => {
  const r = await Promise.race([
    page.evaluate(() => new Promise((resolve) => { let n = 0; let s = 0; const f = (t) => { if (n === 0) s = t; if (++n > 10) return resolve((t - s) / 10); requestAnimationFrame(f); }; requestAnimationFrame(f); })),
    sleep(15000).then(() => 'HUNG'),
  ]);
  log(tag, 'frameMs', r);
  if (r !== 'HUNG') log(tag, 'programs', JSON.stringify(await page.evaluate(() => { const g = window.__glReport?.(); return g && { programs: g.programs, frame: g.prevFrame }; })));
  if (r === 'HUNG') {
    const alive = await Promise.race([page.evaluate(() => { const gl = document.getElementById('canvas').getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return { vis: document.visibilityState, now: performance.now(), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a', tick: window.aether?.world?.tick }; }), sleep(5000).then(() => 'evaluate also hung')]);
    log('main thread', JSON.stringify(alive));
    log('gl', JSON.stringify(await Promise.race([page.evaluate(() => { const w = window.aether?.world; return { ...window.__glReport?.(), world: w && { w: w.width, h: w.height, pawns: w.pawns.length, buildings: w.buildings?.length, seed: w.seed } }; }), sleep(5000).then(() => 'hung')])));
    await client.send('Debugger.pause');
    for (let i = 0; i < 100 && !paused; i++) await sleep(100);
    if (paused) {
      log('stack:');
      log('reason', paused.reason); for (const f of paused.callFrames.slice(0, 12)) log('   ', f.functionName || '(anon)', f.url.replace(/^.*\/src\//, 'src/') || f.location.scriptId, f.location.lineNumber + 1);
      await client.send('Debugger.resume');
    } else log('debugger never paused: not a JS loop (compositor/GPU?)');
  }
  return r;
};
const shot = async (name) => { const s = Date.now(); await Promise.race([page.screenshot({ path: `${out}/${name}.png` }), sleep(30000).then(() => log(name, 'screenshot >30s'))]); log(name, 'screenshot', ((Date.now() - s) / 1000).toFixed(1) + 's'); };
if (!process.env.NOPATCH) await page.evaluateOnNewDocument(() => {
  // Every draw call is charged to the program bound at the time, and every program
  // remembers its three.js defines, so a frame that never comes back can be read as
  // "the first draw of program N, a MeshStandardMaterial with these features".
  const g = (window.__gl = { frames: 0, calls: 0, programs: [], frame: [], prev: [] });
  const P = WebGL2RenderingContext.prototype;
  let cur = null; let nextId = 0;
  const shaders = new WeakMap(); const progs = new WeakMap();
  const ss = P.shaderSource; P.shaderSource = function (sh, src) { const defs = [...src.matchAll(/#define ([A-Z_0-9]+)/g)].map((m) => m[1]).filter((d) => !/^(HIGH_PRECISION|SHADER_TYPE|SHADER_NAME|opaque|saturate|whiteCompliment|PI|PI2|PI_HALF|RECIPROCAL_PI|RECIPROCAL_PI2|EPSILON|CUBEUV_|LOG2|USE_ENVMAP|ENVMAP_TYPE_CUBE_UV|ENVMAP_MODE_REFLECTION|ENVMAP_BLENDING_NONE|TONE_MAPPING|LEGACY_LIGHTS|isnan|isinf|texture2D|textureCube|textureCubeLodEXT|texture2DLodEXT|texture2DProjLodEXT|textureCubeGradEXT|texture2DGradEXT|texture2DProjGradEXT|texture2DProj|gl_FragDepthEXT|texelFetch|attribute|varying|GLSL3|USE_LOGDEPTHBUF|OPAQUE|Material)/.test(d)); const name = (src.match(/#define SHADER_NAME (\S+)/) || [])[1]; shaders.set(sh, { defs, name }); return ss.call(this, sh, src); };
  const at = P.attachShader; P.attachShader = function (pr, sh) { let m = progs.get(pr); if (!m) { m = { id: nextId++, defs: new Set(), name: '' }; progs.set(pr, m); g.programs.push(m); } const info = shaders.get(sh); if (info) { info.defs.forEach((d) => m.defs.add(d)); if (info.name) m.name = info.name; } return at.call(this, pr, sh); };
  const lp = P.linkProgram; P.linkProgram = function (pr) { const m = progs.get(pr); if (m) m.linkedAtFrame = g.frames; return lp.call(this, pr); };
  const up = P.useProgram; P.useProgram = function (pr) { cur = progs.get(pr) ?? null; return up.call(this, pr); };
  const note = (kind, count, inst) => { g.calls++; const id = cur ? cur.id : -1; let row = g.frame.find((r) => r.id === id); if (!row) { row = { id, draws: 0, maxInst: 0, maxCount: 0 }; g.frame.push(row); } row.draws++; if (inst > row.maxInst) row.maxInst = inst; if (count > row.maxCount) row.maxCount = count; };
  for (const [name, ci, ii] of [['drawElementsInstanced', 1, 4], ['drawArraysInstanced', 2, 3], ['drawElements', 1, -1], ['drawArrays', 2, -1]]) { const orig = P[name]; P[name] = function (...a) { note(name, a[ci], ii < 0 ? 1 : a[ii]); return orig.apply(this, a); }; }
  const raf = window.requestAnimationFrame; window.requestAnimationFrame = (cb) => raf.call(window, (t) => { g.frames++; g.prev = g.frame; g.frame = []; return cb(t); });
  window.__glReport = () => ({ frames: g.frames, calls: g.calls, programs: g.programs.length, lastFrame: g.frame.map((r) => ({ ...r, prog: g.programs[r.id] && { name: g.programs[r.id].name, linked: g.programs[r.id].linkedAtFrame, defs: [...g.programs[r.id].defs].join(' ') } })), prevFrame: g.prev.map((r) => r.id) });
});
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 }); log('loaded'); await sleep(3500);
await page.evaluate((seed, noplay) => { const box = document.querySelector('input.seedbox'); if (box && seed) box.value = seed; const play = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Play'); if (!noplay) play?.click(); }, process.env.SEED ?? '', !!process.env.NOPLAY);
await sleep(1500);
await frameMs('first-frames');
log('gl', JSON.stringify(await Promise.race([page.evaluate(() => { const w = window.aether?.world; return { ...window.__glReport?.(), world: w && { w: w.width, h: w.height, tick: w.tick, pawns: w.pawns.length, buildings: w.buildings?.length, seed: w.seed, card: !!document.querySelector('.overlay .card') } }; }), sleep(5000).then(() => 'hung')])));
await sleep(2500);
await page.evaluate(() => document.getElementById('canvas').focus());
await frameMs('live');
await page.waitForFunction(() => window.aether.world.tick >= 1800, { polling: 16, timeout: 120000 }); log('tick 1800');
await key('Space');
await page.evaluate((tpd) => { const w = window.aether.world; w.tick = w.tick - (w.tick % tpd) + Math.round(tpd * 0.5); }, 4800);
await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });
await frameMs('paused-noon');
let net = 0;
const zoomTo = async (target) => { const ticks = target - net; for (let i = 0; i < Math.abs(ticks); i++) { await page.mouse.move(640, 400); await page.mouse.wheel({ deltaY: ticks > 0 ? -100 : 100 }); await sleep(60); } net = target; };
const home = await page.evaluate(() => { const p = window.aether.world.pawns.find((q) => q.faction === 'colony'); window.aether.look(Math.round(p.x), Math.round(p.y)); return { x: Math.round(p.x), y: Math.round(p.y) }; });
await page.evaluate(([x0, y0, x1, y1]) => { const w = window.aether.world; if (!w.seen) w.seen = new Array(w.width * w.height).fill(0); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue; w.seen[y * w.width + x] = 1; } w.stats.explored = (w.stats.explored ?? 0) + 1; }, [home.x - 26, home.y - 26, home.x + 26, home.y + 26]);
await frameMs('revealed');
await zoomTo(12); await frameMs('zoom12'); await shot('1-settlers');
await frameMs('after-shot1');
const SHOWCASE = ['wall','stonewall','door','fence','sandbag','turret','trap','bed','medbed','prisonbed','table','gametable','statue','stove','bench','lab','cooler','campfire','heater','generator','battery','solar','watermill','conduit','lamp','grave'];
const site = await page.evaluate((kinds) => { const w = window.aether.world; const cx = Math.round(w.pawns[0].x); const cy = Math.round(w.pawns[0].y) + 11;
  const x0 = cx - 14, x1 = cx + 14, y0 = cy - 3, y1 = cy + 10;
  if (w.seen) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue; w.seen[y * w.width + x] = 1; } w.stats.explored = (w.stats.explored ?? 0) + 1; }
  let n = 0; kinds.forEach((k, i) => { const x = cx - 12 + (i % 9) * 3; const y = cy + Math.floor(i / 9) * 3; try { if (window.aether.build(k, x, y)) n++; } catch (e) {} });
  window.aether.look(cx, cy + 3); return { n, cx, cy }; }, SHOWCASE);
await sleep(1500); await zoomTo(-2); await frameMs('showcase'); await shot('2-buildings');
await page.evaluate((s) => window.aether.look(s.cx - 3, s.cy + 3), site); await zoomTo(8); await frameMs('closeup'); await shot('2b-closeup');
await page.evaluate((h) => window.aether.look(h.x, h.y), home); await zoomTo(3); await frameMs('zoom3'); await shot('3-colony');
await frameMs('after-shot3');
await key('KeyV'); await sleep(1500); await frameMs('firstperson'); await shot('4-firstperson');
await frameMs('after-shot4');
log('done'); await browser.close();
