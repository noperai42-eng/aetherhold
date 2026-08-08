/**
 * Draws the Aetherhold home-screen icon and writes it out as PNG.
 *
 * There is no image library here on purpose. The project ships procedural
 * geometry and no CDNs, and an icon pipeline that needs `sharp` or a headless
 * browser is a second toolchain to keep alive for four files that change once a
 * year. Node's own zlib is enough to write a PNG, and the mark below is a
 * function of (x, y) — which means it renders at any size without ever going
 * soft, and the 180px iPad tile is the same drawing as the 512px one rather than
 * a resample of it.
 *
 * Run with `npm run icons`. Output lands in `public/`, which Vite serves at the
 * site root in dev and copies into `dist/` on build.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA8 pixels (row-major, no filtering) → a PNG file. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  // One filter byte per scanline. Filter 0 (none) throughout: these are smooth
  // gradients, deflate handles them fine, and the files come out ~10 KB.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// the mark
// ---------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * clamp01(t);
const mixRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Paint `col` over `dst` at coverage `a`. */
function over(dst, col, a) {
  if (a <= 0) return;
  dst[0] = mix(dst[0], col[0], a);
  dst[1] = mix(dst[1], col[1], a);
  dst[2] = mix(dst[2], col[2], a);
}

/** A smooth mound: 1 at the centre, 0 at ±w, with no corner at the join. */
function bump(x, c, w) {
  const t = (x - c) / w;
  if (t <= -1 || t >= 1) return 0;
  return (1 - t * t) ** 1.5;
}

/** The skyline of the hill the keep stands on, as a height for each x. */
function hillY(x) {
  return (
    0.845 -
    0.175 * bump(x, 0.5, 0.44) -
    0.055 * bump(x, 0.07, 0.34) -
    0.045 * bump(x, 0.95, 0.32)
  );
}

/** Half-width of the tower's tapering body at height y. */
function towerHalfWidth(y) {
  return mix(0.112, 0.134, (y - 0.28) / 0.5);
}

const STARS = [
  [0.165, 0.15, 0.0105, 0.85],
  [0.815, 0.115, 0.009, 0.7],
  [0.7, 0.235, 0.0072, 0.55],
  [0.29, 0.28, 0.0062, 0.4],
];

/**
 * The colour at one point of the icon, in unit coordinates with y downward.
 *
 * Written as a plain sample function so antialiasing is just supersampling —
 * every edge below is a hard predicate, and the caller averages. That keeps the
 * shape code readable (`is this point inside the tower?`) instead of turning
 * every silhouette into a distance field.
 */
function sample(x, y) {
  // --- night ---------------------------------------------------------------
  const c = mixRgb([10, 15, 24], [23, 33, 48], y * 0.9 + 0.05);
  // A cold wash at the top corners, so the sky has somewhere to be darkest and
  // the mark does not read as a flat swatch behind a shape.
  const corner = Math.hypot(x - 0.5, y - 0.42) - 0.45;
  over(c, [6, 9, 16], clamp01(corner * 1.6) * 0.75);

  // --- the aether ----------------------------------------------------------
  // Two slow ribbons across the upper third. Low alpha on purpose: at 60px on a
  // home screen this is texture, not a subject, and anything louder competes
  // with the lit window for the one thing the eye should land on.
  const ribbon = (phase, mid, thick, col, alpha) => {
    const path = mid + 0.045 * Math.sin((x + phase) * 5.6) + 0.018 * Math.sin((x + phase) * 11.3);
    const d = Math.abs(y - path) / thick;
    if (d >= 1) return;
    over(c, col, (1 - d) ** 2 * alpha * clamp01((0.62 - y) * 6));
  };
  ribbon(0.0, 0.235, 0.085, [78, 220, 186], 0.3);
  ribbon(1.9, 0.315, 0.07, [138, 122, 224], 0.2);

  // --- stars ---------------------------------------------------------------
  for (const [sx, sy, r, a] of STARS) {
    const d = Math.hypot(x - sx, y - sy) / r;
    if (d < 3) over(c, [226, 238, 255], Math.max(0, 1 - d * d * 0.5) * a);
  }

  // --- hearth glow ---------------------------------------------------------
  // Behind everything that follows, so the tower is silhouetted against its own
  // light rather than lit from nowhere.
  const gd = Math.hypot((x - 0.5) * 1.05, (y - 0.5) * 0.9) / 0.46;
  if (gd < 1) over(c, [255, 176, 74], (1 - gd) ** 2.2 * 0.62);

  const hy = hillY(x);
  const inHill = y >= hy;

  // --- the keep ------------------------------------------------------------
  // Drawn before the hill so its footing is buried in the crest: a tower whose
  // base line floats a pixel above the ground reads as a sticker.
  let onTower = false;
  const hw = towerHalfWidth(y);
  const dx = Math.abs(x - 0.5);
  if (y >= 0.28 && y <= 0.86 && dx <= hw) onTower = true;
  // The parapet: wider than the body, with two notches cut out of the top.
  if (y >= 0.228 && y < 0.298 && dx <= 0.162) {
    const notch = (dx > 0.044 && dx < 0.094) || dx > 0.142;
    if (!(notch && y < 0.267)) onTower = true;
  }
  if (onTower) {
    // Vertical gradient for weathering, and a darker left face so the stone has
    // a direction to be lit from — the same side the window spills towards.
    const lit = mixRgb([228, 205, 160], [118, 100, 74], clamp01((y - 0.23) / 0.62));
    const face = x < 0.5 ? 0.82 : 1;
    const band = 0.94 + 0.06 * Math.sin(y * 84);
    over(c, [lit[0] * face * band, lit[1] * face * band, lit[2] * face * band], 1);
    // Warm bounce along the right edge, where the window light rakes the stone.
    over(c, [255, 198, 110], clamp01((dx - hw + 0.02) / 0.02) * (x > 0.5 ? 0.28 : 0) * 0.9);
  }

  // --- the window ----------------------------------------------------------
  // An arched slit, which at icon size is the whole point of the drawing: one
  // warm mark in a cold field is what makes this a place somebody lives.
  const wx = Math.abs(x - 0.5);
  const arch = wx <= 0.05 && y <= 0.565 && (y >= 0.44 || Math.hypot(wx / 0.05, (y - 0.44) / 0.05) <= 1);
  // A bloom around it first, so the light looks like it is coming out of the
  // opening rather than being painted on the front of the stone.
  const bloom = clamp01(1 - Math.hypot((x - 0.5) / 0.135, (y - 0.5) / 0.155));
  over(c, [255, 190, 96], bloom * bloom * 0.42);
  if (arch) {
    const core = clamp01(1 - Math.hypot(wx / 0.055, (y - 0.505) / 0.08));
    over(c, mixRgb([255, 190, 82], [255, 246, 212], core * core), 1);
  }

  // --- the hill ------------------------------------------------------------
  if (inHill) {
    const depth = clamp01((y - hy) / 0.28);
    over(c, mixRgb([48, 84, 60], [12, 21, 18], depth), 1);
    // A rim of light along the crest, brightest under the keep. Without it the
    // hill and the sky merge into one dark mass at small sizes.
    const rim = clamp01(1 - (y - hy) / 0.016);
    over(c, [116, 176, 126], rim * 0.9 * (0.4 + 0.6 * bump(x, 0.5, 0.5)));
    // And the spill from the window, thrown down the slope in front.
    const spill = clamp01(1 - Math.hypot((x - 0.5) / 0.3, (y - hy) / 0.16));
    over(c, [255, 182, 88], spill * spill * 0.34);
  }

  return c;
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/**
 * @param size    pixels square
 * @param inset   fraction of the canvas the mark is shrunk into. 0 is
 *                full-bleed; the maskable icon needs padding so a circular
 *                or squircle crop never eats the parapet.
 * @param radius  corner radius as a fraction of the size, 0 for a hard square.
 *                iOS masks `apple-touch-icon` itself and fills anything
 *                transparent with black, so that one has to stay square.
 */
function render(size, { inset = 0, radius = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // 3×3 supersampling: 9 coverage levels per edge, plenty at 512px
  const scale = 1 - inset * 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          if (radius > 0) {
            // Rounded-rect coverage, evaluated per subsample like everything else.
            const qx = Math.abs(u - 0.5) - (0.5 - radius);
            const qy = Math.abs(v - 0.5) - (0.5 - radius);
            const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
            if (d > 0 && Math.max(qx, qy) > 0) continue;
          }
          const col = sample((u - 0.5) / scale + 0.5, (v - 0.5) / scale + 0.5);
          r += col[0];
          g += col[1];
          b += col[2];
          a += 255;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      // Premultiplied averaging would darken the rounded edge against the page,
      // so the colour is averaged over the *covered* subsamples only and the
      // coverage goes in the alpha channel by itself.
      const cov = a / (n * 255);
      const k = cov > 0 ? 1 / (n * cov) : 0;
      rgba[i] = Math.round(clamp01(r * k / 255) * 255);
      rgba[i + 1] = Math.round(clamp01(g * k / 255) * 255);
      rgba[i + 2] = Math.round(clamp01(b * k / 255) * 255);
      rgba[i + 3] = Math.round(cov * 255);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });

const FILES = [
  // Square and full-bleed: iOS applies its own squircle and paints anything
  // transparent black, so a pre-rounded tile comes out with dark ears.
  ['apple-touch-icon.png', 180, { radius: 0 }],
  // The two sizes the manifest is required to offer, rounded for the browsers
  // that draw the icon as-is.
  ['icon-192.png', 192, { radius: 0.21 }],
  ['icon-512.png', 512, { radius: 0.21 }],
  // Android crops `maskable` to whatever shape the launcher likes, anywhere
  // from a circle inwards, so the mark sits inside the safe zone and the
  // background carries the rest.
  ['icon-maskable-512.png', 512, { inset: 0.13 }],
  // For the tab, where the mark is 16px and the parapet is one pixel tall.
  ['favicon-32.png', 32, { radius: 0.19 }],
];

for (const [name, size, opts] of FILES) {
  const png = render(size, opts);
  writeFileSync(join(OUT, name), png);
  console.log(`${name.padEnd(24)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
