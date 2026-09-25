import { launch, URL } from './chrome.mjs';
import { formatGpu, reduceGpu } from './gpu.mjs';
import { copyFileSync, mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots'; const label = process.argv[3] ?? 'r0';
mkdirSync(out, { recursive: true });
// A second home for every frame, named by $LOOK_MIRROR.
//
// The frames are the judge, which means somebody has to open all sixteen of them,
// and that somebody is usually an agent for whom reading a file inside the repo
// costs the person at the keyboard an approval. Sixteen approvals a round is a
// toll on the one step of the loop that must never be skipped, and the first
// thing a toll buys is a summary read in place of a photograph. So the shoot
// writes twice: once into the repo, where the record lives, and once wherever the
// reader can already look. Unset, it costs nothing and changes nothing.
const mirror = process.env.LOOK_MIRROR || '';
if (mirror) mkdirSync(mirror, { recursive: true });
const SHOWCASE = ['wall','stonewall','door','fence','sandbag','turret','trap','bed','medbed','prisonbed','table','gametable','statue','stove','bench','lab','cooler','campfire','heater','generator','battery','solar','watermill','conduit','lamp','grave'];
const TICKS_PER_DAY = 4800;
// The sheets along the bottom of a phone that a press on the bar raises, in the
// order the bar prints them. Details is missing on purpose and is photographed
// further down by a different gesture — see the loop. Kept in step with SHEETS in
// `hud.ts` by hand, the same way SHOWCASE is kept in step with BUILDING_DEFS: a
// destination nobody adds here is a sheet that never gets looked at.
const PHONE_SHEETS = ['Build', 'Crew', 'Events', 'More'];
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (code) => { await page.keyboard.down(code); await sleep(60); await page.keyboard.up(code); await sleep(150); };
// Every frame this run actually wrote, in the order it wrote them, so the last
// line reports what is on disk rather than what the script meant to take. A
// frame that was skipped is a frame missing from this list, and that is the
// point: a named frame that did not happen has to be visible from the output.
const took = [];
// Every frame this run is *supposed* to write. `took` says what landed; the gap
// between the two is what the last line prints. A run that dies in the middle
// used to end with a stack trace and nothing else, and the ten frames that had
// already been written looked from the shell exactly like sixteen.
const WANTED = ['0-hud-help','1-settlers','2-buildings','2b-closeup','3-colony','5-dusk','4-firstperson','6-hud-colony','7-hud-selected','8-phone-help','8-phone-colony','8-phone-build','8-phone-crew','8-phone-details','8-phone-events','8-phone-more'];
const shot = async (name) => {
  await sleep(1200);
  const path = `${out}/${label}-${name}.png`;
  await page.screenshot({ path });
  if (mirror) copyFileSync(path, `${mirror}/${label}-${name}.png`);
  took.push(name);
};
// Space, and then proof that Space arrived.
//
// Pausing is the pin the whole harness hangs on: every frame after it is taken of
// one colony standing still, and if the key is swallowed the settlers keep
// walking through the two seconds of zooming and easing that follow. The frame
// that shows this is `1-settlers`, whose entire job is the pawn models and which
// came back from one round as an empty patch of grass — the settler had simply
// walked out of shot, and nothing in the output said so. The key goes to the
// canvas, the canvas has to have focus, and under GPU contention the focus call
// and the keypress can land either side of a slow frame. So: press, ask the app
// whether it is stopped, press again, and if it is still running after three
// tries say so and stop, because every frame from here would be a lie.
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
// The interface, down or up. For nine rounds this was a one-way blank taken once
// before the first frame, and so every round judged the half of the screen the
// player does not spend most of the game reading: the world frames want the HUD
// out of the way, but the HUD is the game's other half and it was never
// photographed at all. A switch rather than a blank — the world frames still put
// it down, and the interface frames at the end put it back up.
const hud = (on) => page.evaluate((v) => { document.getElementById('hud').style.display = v ? '' : 'none'; }, on);
// `load`, not `networkidle2`. The dev server's HMR client opens a WebSocket and holds
// it open for the life of the page, and puppeteer counts that socket as a request that
// never finishes — so network never goes idle, `goto` spends its whole sixty seconds
// waiting for a connection that is doing its job by staying open, and the run dies at
// line one having taken no frames. Measured on this page 2026-09-18: zero HTTP requests
// in flight eight seconds after DOMContentLoaded, `networkidle2` still timing out at
// twenty-five seconds, `load` firing in 539 ms. Nothing was lost by the change — the
// readiness this harness actually needs is not "the network went quiet" but "the app
// has painted and the sim has ticked", and that is waited for properly thirteen lines
// down (two animation frames, then `world.tick >= 1800`).
await page.goto(URL, { waitUntil: 'load', timeout: 60000 }); await sleep(3500);
// 0. The help card, which is the first thing every player sees and the last thing
// anybody has looked at: twenty-odd rows of keyboard manual over a valley the
// player has not met yet, and it is dismissed on the very next line. Taken before
// the Play click for that reason — after it the card is gone for the rest of the
// run, and the only way to get it back is to press ? and photograph a card with a
// colony already behind it, which is not the screen a new player is handed.
await shot('0-hud-help');
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
await pause();                            // pause so nothing walks out of shot
// Noon, on the same day: the frames are for judging models, and dusk hides them.
await page.evaluate((tpd) => { const w = window.aether.world; w.tick = w.tick - (w.tick % tpd) + Math.round(tpd * 0.5); }, TICKS_PER_DAY);
await hud(false);
let net = 0;
// Where the wheel is pointed. The manager camera zooms about the cursor, so this
// has to be the middle of whichever viewport is current: the desk's 640 is off
// the right-hand edge of a 390-wide phone, and a wheel event delivered off the
// side of the screen zooms nothing.
let mid = { x: 640, y: 400 };
const zoomTo = async (target) => { const ticks = target - net; for (let i = 0; i < Math.abs(ticks); i++) { await page.mouse.move(mid.x, mid.y); await page.mouse.wheel({ deltaY: ticks > 0 ? -100 : 100 }); await sleep(60); } net = target; };
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
// What that frame actually cost. For ten rounds the only number this harness took
// was the wall-clock millisecond above, and that number is measured across ten
// requestAnimationFrame callbacks, which the display pins to its own 60 Hz: any
// frame that fits inside the budget reads 17 ms and so does every other one, which
// is why the change that first ran under this instrument took the colony frame from
// 189 draw calls to 123 without moving the millisecond at all. It also never says
// *which* cost moved — a draw call is a CPU-side program bind and a uniform upload,
// a triangle is work for the card, and a round can double one while halving the
// other, which the wall clock reports as no change twice over. three counts
// both itself in `renderer.info`, and resets the render half at the top of every
// `render()`, so it has to be read between one frame and the next: a callback
// queued here lands behind the app's own already-queued one, and therefore reports
// the frame the app just drew. The colony frame is the one worth counting because
// it is the only frame with a whole settlement in it — the cabin, the trees, the
// rock, the settlers and the showcase rows still standing from frame 2 — where
// `2b-closeup` is six pieces of furniture filling the screen.
//
// The instanced-mesh tally alongside it answers the question the numbers alone
// cannot: how much of that draw-call count is pools with nothing in them. An
// emptied pool — the crops out of season, the bullet pool with nothing in the air —
// costs a bind and a matrix upload in the colour pass and again in the shadow pass
// for zero pixels, and `hidden` is how many of those the renderer was actually
// spared. `aetherhold` is the app itself, hung on the window by `main.ts` for
// exactly this kind of console work; `aether` next to it is the sim-side console.
//
// And how long the card was busy drawing it, which is the number the wall clock
// cannot give. Both readings are taken here and land in the same `cost` object: a
// second measurement pass would be a second frame, and the point is to describe one.
//
// The method was chosen by measuring, and the measurement threw one out. `2a`'s brief
// expected ANGLE-Metal to expose no timestamp queries — the documented macOS history —
// and built a fence around that absence. The opposite is true here, and it is worse
// than absence: Chrome for Testing on `--use-angle=metal` lists
// `EXT_disjoint_timer_query_webgl2` with 64 counter bits, answers every query, never
// flags a disjoint batch, moves its counter with the load — and overstates the frame
// by about five times. Rendering the same frame N times inside one measured window:
//
//     N    gl.finish()   per render     TIME_ELAPSED_EXT   per render
//     1      1.8 ms         1.8            5.479 ms           5.5
//     2      3.2 ms         1.6           17.229 ms           8.6
//     4      6.8 ms         1.7           34.946 ms           8.7
//
// The stall is linear in the work, `1.7·N + 0.1`. The timer query is proportional to
// nothing — near 8.7 ms a render however many renders are in the window, a different
// ratio at N=1, and not repeatable with itself (7.40 ms and then 5.06 ms for the same
// frame at the same size). It cannot be the frame's GPU time in any case: the stall
// bounds the same draws at 1.8 ms, and time on the card cannot exceed a wall-clock
// window that opens before the commands are recorded and closes after all of them have
// completed. So the extension is not used — not as a primary, not as a fallback, and
// not printed beside the real number, because a plausible wrong number in a log is how
// a later round gets sent after a regression that never happened.
//
// What is left is the stall, and it is honest about what it is: not the card's own
// counter for the draw, but the wall time from submitting one frame's commands to the
// queue standing empty again. That is an upper bound, and the table above puts it
// within about a tenth of a millisecond of the real per-frame cost. The line says
// `(finish)` so that a round reading it later knows which claim it is holding.
//
// The rAF-polled fence the brief designed is not used either, for a quieter reason: it
// resolves to one display frame, about 16.7 ms, ten times coarser than the 1.7 ms it
// would have to measure. `--disable-gpu-vsync` was in the brief to rescue exactly that,
// and it is why the flag is not adopted — a synchronous stall does not poll on frames,
// so there is nothing for the flag to buy and no reason to re-verify sixteen frames
// for pixel-identity under it.
//
// The stall hooks `viewport.render` rather than drawing a frame of its own. `app.ts`
// calls it from three places — the first-person camera, the orbit camera and the review
// view — and a frame this harness drew itself would be a frame the app did not, with a
// camera it did not choose. The hook is removed before this returns.
const cost = await page.evaluate(() => {
  const app = window.aetherhold;
  if (!app?.viewport) return null;
  const vp = app.viewport;
  const info = vp.renderer.info;

  /** Above the reducer's floor of 10 with room for batches the driver spoils. */
  const WANT = 24;
  /** About ten seconds of frames. A run that cannot fill WANT by then says n/a. */
  const PATIENCE = 600;

  const counts = () => new Promise((resolve) => {
    let tries = 0;
    const read = () => {
      // A frame in which the app did not draw reports zero calls, and reporting that
      // as the colony's cost would be a lie the size of the whole measurement.
      if (info.render.calls === 0 && ++tries < 12) return requestAnimationFrame(read);
      let instanced = 0, empty = 0, hidden = 0;
      vp.scene.traverse((o) => {
        if (!o.isInstancedMesh) return;
        instanced++;
        if (o.count === 0) { empty++; if (!o.visible) hidden++; }
      });
      resolve({ calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines, geometries: info.memory.geometries, textures: info.memory.textures, instanced, empty, hidden });
    };
    requestAnimationFrame(read);
  });

  const timeGpu = () => new Promise((resolve) => {
    let gl = null;
    try { gl = vp.renderer.getContext(); } catch (e) { gl = null; }
    if (!gl) return resolve(null);

    const hadOwn = Object.prototype.hasOwnProperty.call(vp, 'render');
    const orig = vp.render.bind(vp);
    const samples = [];
    let spoiled = 0, waited = 0;

    vp.render = (cam) => {
      if (samples.length >= WANT) return orig(cam);
      const t0 = performance.now();
      orig(cam);
      // The stall. Everything recorded above is submitted and drained before this
      // returns, so the wall time across the pair is one frame's cost plus the cost of
      // asking — measured at about a tenth of a millisecond, which is why this is a
      // usable number and the rAF-polled fence was not.
      gl.finish();
      const ms = performance.now() - t0;
      // A frame in which the app drew nothing is not a cheap frame, it is not a frame,
      // and letting one in would drag the median toward a cost no player ever waited
      // for. `renderer.info` is reset at the top of every `render`, so this reads the
      // call count of the draw that just happened.
      if (info.render.calls === 0) spoiled++; else samples.push(ms);
    };

    const watch = () => {
      if (samples.length >= WANT || ++waited > PATIENCE) {
        // Put the renderer back exactly as it was found, whichever way it was found:
        // an own property left behind would outlive this measurement and shadow the
        // prototype for every frame after it — and every frame after it would then be
        // stalling on the GPU for a measurement nobody asked for.
        if (hadOwn) vp.render = orig; else delete vp.render;
        return resolve({ method: 'finish', samples, spoiled });
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });

  // Where the triangles actually are. The total alone says a colony frame costs
  // eight million and says nothing about what to do with that, and the one number
  // everyone reaches for — the grass — turns out to be a fifth of it rather than the
  // twentieth a misread of `decor.ts`'s own comment suggested. So the census names
  // pools: one row per drawn mesh, its cost being the triangles of its geometry times
  // the instances it draws, sorted, top ten kept. Nothing in `src/client/render` names
  // more than a handful of its meshes, so the label is built from what is there — the
  // nearest named ancestor if the graph has one, otherwise the path of types and child
  // indices down from the scene — and it is read together with `instances` and `geoTris`,
  // which is what makes a row recognisable: 258,048 instances of a fifteen-triangle
  // geometry is the grass and cannot be anything else.
  //
  // `castShadow` is on the row because a pool that casts pays twice, once in the colour
  // pass and once more in the shadow pass, and the pool at the top of this census is not
  // the pool to cut if it is the one that does not.
  const label = (o) => {
    const parts = [];
    for (let n = o; n && n !== vp.scene; n = n.parent) {
      if (n.name) { parts.unshift(n.name); break; }
      const i = n.parent ? n.parent.children.indexOf(n) : -1;
      parts.unshift(`${n.type}[${i}]`);
    }
    return parts.join('/');
  };

  const census = () => {
    const rows = [];
    vp.scene.traverse((o) => {
      const geo = o.geometry;
      if (!geo || !o.visible) return;
      const attr = geo.index ?? geo.getAttribute('position');
      if (!attr) return;
      const geoTris = Math.floor(attr.count / 3);
      const instances = o.isInstancedMesh ? o.count : 1;
      if (geoTris === 0 || instances === 0) return;
      rows.push({ label: label(o), geoTris, instances, tris: geoTris * instances, castShadow: !!o.castShadow });
    });
    rows.sort((a, b) => b.tris - a.tris);
    // The scene's own total, not `renderer.info`'s: this one counts what is in the graph
    // and visible, where the renderer counts what survived the frustum. They are close on
    // the colony frame and they are not the same number, so the percentages below are of
    // this total and say so.
    const tris = rows.reduce((n, r) => n + r.tris, 0);
    const castTris = rows.reduce((n, r) => (r.castShadow ? n + r.tris : n), 0);
    let lights = 0;
    vp.scene.traverse((o) => { if (o.isLight && o.castShadow) lights++; });
    return { top: rows.slice(0, 10), pools: rows.length, tris, castTris, lights };
  };

  // What the shadow pass costs — and the first two ways of asking both had to be thrown
  // out, which is the second time in two rounds that the instrument was the finding.
  //
  // The brief's method was `renderer.info.render.triangles` with `shadowMap.enabled` on
  // and then off. It reported 0.0 %: 8,357,240 triangles with the pass and 8,357,240
  // without, the same total to the digit. That is not a frame with no shadows in it.
  // Waiting the flip out — watching the draw-call count until it fell, rather than
  // assuming one animation frame was one render — did not rescue it either; the count
  // never fell in twenty frames. The reason is in three's own source, and it is
  // deliberate: `WebGLRenderer.render` calls `shadowMap.render(...)` and only *then*
  // calls `info.reset()` (`WebGLRenderer.js:1606` and `:1612` in 0.180). The shadow pass
  // is excluded from `renderer.info` by construction. No on/off comparison of that object
  // can ever measure it, and a round that trusted the 0.0 % would have concluded the
  // colony casts no shadows.
  //
  // So the share is taken two ways that can answer, and both are printed:
  //
  //   * **Triangles.** Every mesh that casts is drawn a second time into the depth map,
  //     so the census's own `castShadow` column, summed over the whole scene rather than
  //     the top ten, is the count of triangles the frame draws twice. It is exact and it
  //     is free — it is the census already taken, read down a different column.
  //   * **Milliseconds.** `2a`'s stall wraps the whole `render` call, the depth pass
  //     included, so timing the frame with shadows and then without is a real before and
  //     after. `shadowMap.enabled` is flipped without touching any material's
  //     `needsUpdate`: the programs stay exactly as compiled, still sampling a shadow map
  //     that has stopped being updated, so the colour pass costs what it always cost and
  //     the only thing removed from the measurement is the depth pass itself. It is put
  //     back before this returns, and the frames taken afterwards are unaffected.
  // The post chain the same way: off, timed, back on — in this shoot, against this
  // frame, because a millisecond from another run is not a comparator (see LOOK.md).
  const withoutPost = () => new Promise((resolve) => {
    const post = vp.post;
    if (!post || !post.enabled) return resolve(null);
    post.enabled = false;
    timeGpu().then((raw) => { post.enabled = true; resolve(raw); });
  });

  const withoutShadows = () => new Promise((resolve) => {
    const sm = vp.renderer.shadowMap;
    if (!sm || !sm.enabled) return resolve(null);
    sm.enabled = false;
    timeGpu().then((raw) => { sm.enabled = true; resolve(raw); });
  });

  // The census is taken the instant the counts land, not after the GPU timing: twenty-four
  // frames later the pawns have walked, the crops have grown and the pools have resized,
  // and a census of a different frame from the triangle total above would be worse than none.
  return counts().then((c) => {
    if (!c) return null;
    const scene = census();
    return timeGpu().then((gpu) => withoutShadows().then((gpuNoShadow) =>
      withoutPost().then((gpuNoPost) => ({ ...c, scene, gpu, gpuNoShadow, gpuNoPost }))));
  });
});

// 5. the same colony an hour before sundown. Noon is the fairest light to judge a
// model in and the least revealing about the light itself: the sun is overhead, the
// shadows are short, and the warm band at the horizon never appears at all. A round
// that changes the lighting cannot be judged from five frames all taken at noon, so
// this one moves the clock to a sun about eight degrees up — long shadows, the dusk
// colour across the sky, the lamps not yet lit — and then puts it back.
await page.evaluate((tpd) => { const w = window.aether.world; w.tick = w.tick - (w.tick % tpd) + Math.round(tpd * 0.725); }, TICKS_PER_DAY);
await shot('5-dusk');
await page.evaluate((tpd) => { const w = window.aether.world; w.tick = w.tick - (w.tick % tpd) + Math.round(tpd * 0.5); }, TICKS_PER_DAY);
// 4. first person
await key('KeyV'); await sleep(1500); await shot('4-firstperson');

// 6. The manager, with the interface back on. V returns from the body, and it
// hands the manager back with the settler you were wearing still selected and the
// camera already on them — so Escape twice puts the tool back to select and then
// drops that selection, which is the empty desk the player actually sits at:
// every panel populated at once, the roster down the left, the log and the alerts
// and the goals all up together. Nothing has ever photographed this arrangement,
// which is why the panels that collide with each other were found by reading CSS.
await key('KeyV'); await sleep(1500);
await page.evaluate((h) => window.aether.look(h.x, h.y), home);
await page.evaluate(() => document.getElementById('canvas').focus());
await key('Escape'); await key('Escape');
await hud(true);
await shot('6-hud-colony');
// 7. The same desk with a settler selected, by clicking their row in the roster
// exactly as a player would. This is the only arrangement that puts the inspector
// and the Next steps panel on screen at the same time, and therefore the only
// frame that can show whether the two of them fit.
await page.evaluate(() => document.querySelector('#colonists .colonist')?.click());
await shot('7-hud-selected');

// 8. The phone. `layout-mode.ts` asks two questions once, in the HUD constructor
// — is the pointer coarse, and is the screen's short side under 560 — and hangs
// the answer on the root as a class. Once, in the constructor: so resizing the
// window gets the desk layout squeezed into 390 points, which is the one thing
// worse than no phone frame at all, because it looks like a phone frame. The page
// has to be *loaded* at that size with touch emulated, which means a reload,
// which throws the photographed colony away. Hence last, with every frame above
// already on disk. The valley comes back the same: the colony this harness
// photographs is grown from a fixed seed, so the reload regrows the same one.
// The phone half runs behind a net, and the desk half deliberately does not. Every
// frame above this line is already on disk by the time we get here, so a phone
// block that throws — the reload's wait for tick 1800 timing out under contention
// is the one that has actually happened — must not take the report down with it:
// the run ended with a stack trace, the shell's exit status was eaten by a pipe,
// and ten frames read from outside as sixteen. Caught here, named in the log, and
// the missing frames are printed by name on the last line.
try {
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
mid = { x: 195, y: 400 };
// `load` here for the same reason as the first navigation: the HMR socket never
// closes, so network never goes idle, and this reload is inside the try that owns
// the eight phone frames — it would have eaten all of them.
await page.reload({ waitUntil: 'load', timeout: 60000 });
await sleep(3500);
if (!(await page.evaluate(() => document.getElementById('hud')?.classList.contains('phone')))) {
  // Said out loud rather than swallowed: a desk layout photographed at phone size
  // would be judged as the phone, and every conclusion drawn from it would be wrong.
  console.log(`${label}: the phone layout did not engage after the reload — no 8-phone frames`);
} else {
  // The help card again, and it is a different card: on a phone `buildHelp` drops
  // the two keyboard tables and prints what the five words along the bottom of the
  // screen do instead. Nobody has read that half at 390 either.
  await shot('8-phone-help');
  await page.evaluate(() => { const play = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Play'); play?.click(); });
  await sleep(1500);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(2500);
  await page.evaluate(() => document.getElementById('canvas').focus());
  await page.waitForFunction(() => window.aether.world.tick >= 1800, { polling: 16, timeout: 180000 });
  await pause();
  await page.evaluate((tpd) => { const w = window.aether.world; w.tick = w.tick - (w.tick % tpd) + Math.round(tpd * 0.5); }, TICKS_PER_DAY);
  const phoneHome = await page.evaluate(() => { const p = window.aether.world.pawns.find((q) => q.faction === 'colony'); window.aether.look(Math.round(p.x), Math.round(p.y)); return { x: Math.round(p.x), y: Math.round(p.y) }; });
  await reveal(phoneHome.x - 26, phoneHome.y - 26, phoneHome.x + 26, phoneHome.y + 26);
  net = 0; await zoomTo(3);
  // The camera eases toward whatever it was pointed at rather than jumping, and this
  // is the one place in the run where it has a long way to go: every desk frame is
  // taken a few cells from the last one, but the reload put the camera back at the
  // valley's own starting point and this is the first thing to move it. A second and
  // a bit is enough for a nudge and nowhere near enough for that, which showed up as
  // a phone frame photographed mid-flight and framed differently from the five that
  // followed it. Sit still until it has arrived.
  await sleep(4000);
  // The valley with no sheet raised, which on a phone is most of the game: the top
  // bar, the bar along the bottom, and nothing else between the player and the map.
  await shot('8-phone-colony');
  // Then one frame per sheet, raised the way a thumb raises it. Details is not in
  // that list because a Details sheet with nothing selected is an empty sheet:
  // tapping a settler is what fills it, and tapping a settler raises it by itself,
  // which is the behaviour worth photographing. So the roster row is the tap.
  for (const name of PHONE_SHEETS) {
    if (name === 'Events') {
      await page.evaluate(() => document.querySelector('#colonists .colonist')?.click());
      await shot('8-phone-details');
    }
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
    await shot(`8-phone-${name.toLowerCase()}`);
  }
}
} catch (e) {
  console.log(`${label}: the phone half failed — ${e && e.message ? e.message : e}`);
}
const gpuMs = cost ? reduceGpu(cost.gpu) : null;
const gpuNoShadowMs = cost ? reduceGpu(cost.gpuNoShadow) : null;
const gpuNoPostMs = cost ? reduceGpu(cost.gpuNoPost) : null;
const postMs = gpuMs && gpuNoPostMs && gpuMs.method === 'finish' && gpuNoPostMs.method === 'finish'
  ? `, post ${(gpuMs.median - gpuNoPostMs.median).toFixed(1)} ms of it (${gpuNoPostMs.median.toFixed(1)} ms without)`
  : ', post off';
// The shadow pass, said twice because the two halves answer different questions and
// neither substitutes for the other: how much of the frame's geometry is drawn a second
// time into the depth map, and what that second drawing actually costs in milliseconds.
// A triangle share alone would over-report — depth-only draws are cheap per triangle —
// and a millisecond share alone would not say what to cut.
const shadow = cost && cost.scene
  ? `, ${((cost.scene.castTris / cost.scene.tris) * 100).toFixed(1)}% of scene triangles cast (${cost.scene.castTris} of ${cost.scene.tris} across ${cost.scene.pools} pools, ${cost.scene.lights} shadow light${cost.scene.lights === 1 ? '' : 's'})`
  : '';
const shadowMs = gpuMs && gpuNoShadowMs && gpuMs.method === 'finish' && gpuNoShadowMs.method === 'finish'
  ? `, shadow pass ${(gpuMs.median - gpuNoShadowMs.median).toFixed(1)} ms of it (${gpuNoShadowMs.median.toFixed(1)} ms without)`
  : ', shadow pass n/a';
const gpu = cost
  ? `colony frame ${cost.calls} draw calls / ${cost.triangles} triangles / ${cost.points} points / ${cost.lines} lines, ${cost.geometries} geometries, ${cost.textures} textures, ${cost.empty} of ${cost.instanced} instanced meshes empty (${cost.hidden} of those hidden), ${formatGpu(gpuMs)}${gpuMs && gpuMs.spoiled ? ` [${gpuMs.spoiled} spoiled]` : ''}${shadowMs}${postMs}${shadow}`
  : 'colony frame not counted — window.aetherhold was not there to ask';
// The census prints above the Cost line and one pool a line, because ten rows wrapped
// into one line is a paragraph nobody reads and the whole point of it is to be scanned
// down. The share is of the scene's own visible total, which is not `renderer.info`'s —
// that one counts what survived the frustum — so the rows are read as "this pool against
// the whole valley", not "this pool against what was on screen".
if (cost && cost.scene && cost.scene.top.length) {
  console.log(`${label}: where the colony frame's triangles are — top ${cost.scene.top.length} of ${cost.scene.pools} visible pools, ${cost.scene.tris} triangles in the scene`);
  for (const r of cost.scene.top) {
    const pct = ((r.tris / cost.scene.tris) * 100).toFixed(1);
    console.log(`${label}:   ${String(r.tris).padStart(9)} tri  ${pct.padStart(5)}%  ${String(r.instances).padStart(7)} × ${String(r.geoTris).padStart(5)}  ${r.castShadow ? 'casts' : '     '}  ${r.label}`);
  }
}
const missed = WANTED.filter((n) => !took.includes(n));
console.log(`${label}: ${errs.length} console errors, ${site.n} showcase buildings stood, ${frameMs.toFixed(0)} ms/frame, ${gpu}, ${took.length}/${WANTED.length} frames${missed.length ? `, MISSING ${missed.join(' ')}` : ' (all)'}`, errs.slice(0, 3));
await browser.close();
