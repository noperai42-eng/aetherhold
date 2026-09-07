// Did a change reach the frame?
//
// Some briefs ask for texture — grain in the ground, tone between boards, noise in a
// material — and a lane can come back green, with the constants plainly changed in the
// diff, and the photograph be identical. Round 6 spent a lane that way: the ground's
// speckle went up by half and the frames did not move, because a per-corner vertex
// colour on a shared lattice is ramped across a whole cell before it is ever drawn. The
// eye suspected it; this settled it.
//
// What it measures: fine detail, with the smooth shading taken out. A tile of a rendered
// frame is mostly a gradient — a lit plane, a shadow ramp, a sky — so this fits a plane
// to every tile and reports what is left over. Objects and shadow edges leave a lot
// left over, so the interesting numbers are the low percentiles: those tiles are flat
// surfaces answering for themselves. A frame whose p10 is a quarter of a grey level has
// nothing on its flat surfaces at all.
//
//   node grain.mjs before.png after.png
//
// Read it as a comparison, never as a score: the same camera, the same seed, the same
// hour, one change between them. It says whether something arrived, not whether it is
// any good — that is what LOOK.md's step 6 is for, and no number replaces it.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** The side of a tile, in pixels. Small enough that a plane is a fair model of the shading across it. */
const TILE = 32;

/**
 * Greyscale pixels from a PNG, as a `Float64Array` of luminance in 0..255 with the
 * image's width and height. Only what the screenshot harness actually writes is
 * supported — 8 bits a channel, RGB or RGBA, no interlacing — and anything else throws
 * rather than returning a plausible wrong answer.
 */
function readPng(path) {
  const buf = readFileSync(path);
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (SIG.some((b, i) => buf[i] !== b)) throw new Error(`${path}: not a PNG`);

  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  for (let at = 8; at + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString('ascii', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colour = body[9];
      const interlace = body[12];
      if (depth !== 8) throw new Error(`${path}: ${depth}-bit PNG, expected 8`);
      if (colour !== 2 && colour !== 6) throw new Error(`${path}: colour type ${colour}, expected RGB or RGBA`);
      if (interlace !== 0) throw new Error(`${path}: interlaced PNG`);
      channels = colour === 6 ? 4 : 3;
    } else if (kind === 'IDAT') {
      idat.push(body);
    } else if (kind === 'IEND') {
      break;
    }
    at += 12 + len;
  }
  if (!width || !channels) throw new Error(`${path}: no IHDR`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const grey = new Float64Array(width * height);
  // Undo the per-scanline filters in place, then take luminance. The five filter types
  // are the whole of PNG decoding once the stream is inflated: each byte is stored as a
  // difference from the pixel to its left, the one above, their average, or Paeth's
  // pick of the three.
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1);
    const filter = raw[at];
    raw.copy(line, 0, at + 1, at + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 0xff;
    }
    line.copy(prev);
    for (let x = 0; x < width; x++) {
      const p = x * channels;
      grey[y * width + x] = 0.2126 * line[p] + 0.7152 * line[p + 1] + 0.0722 * line[p + 2];
    }
  }
  return { grey, width, height };
}

/**
 * The residual standard deviation of every tile, sorted.
 *
 * The plane is fitted in closed form rather than by a solver: over a full square grid
 * the centred x and y coordinates are orthogonal to each other and to the constant, so
 * each coefficient is just a projection, and the residual variance is the tile's own
 * variance less what those two slopes account for.
 */
function residuals({ grey, width, height }) {
  const n = TILE * TILE;
  // Sum of squares of the centred coordinate, the same for both axes.
  let sxx = 0;
  for (let i = 0; i < TILE; i++) sxx += (i - (TILE - 1) / 2) ** 2;
  sxx *= TILE;

  const out = [];
  for (let ty = 0; ty + TILE <= height; ty += TILE) {
    for (let tx = 0; tx + TILE <= width; tx += TILE) {
      let sum = 0;
      let sumSq = 0;
      let sx = 0;
      let sy = 0;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const v = grey[(ty + y) * width + tx + x];
          sum += v;
          sumSq += v * v;
          sx += (x - (TILE - 1) / 2) * v;
          sy += (y - (TILE - 1) / 2) * v;
        }
      }
      const variance = sumSq / n - (sum / n) ** 2;
      const explained = (sx * sx + sy * sy) / (sxx * n);
      out.push(Math.sqrt(Math.max(0, variance - explained)));
    }
  }
  return out.sort((a, b) => a - b);
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('usage: node grain.mjs <frame.png> [more.png ...]   (compare a before and an after)');
  process.exit(2);
}
for (const path of paths) {
  const r = residuals(readPng(path));
  const name = path.split('/').pop();
  const [p10, p25, p50] = [10, 25, 50].map((p) => percentile(r, p).toFixed(3));
  console.log(`${name.padEnd(28)} residual std  p10 ${p10.padStart(6)}  p25 ${p25.padStart(6)}  p50 ${p50.padStart(6)}`);
}
