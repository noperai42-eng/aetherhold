// Where headless Chrome is on this box, and the one way it may be launched.
//
// The flags are the whole point of the file. Without `--ignore-gpu-blocklist` headless
// Chrome falls back to SwiftShader, and on SwiftShader a frame of this game takes
// seconds to minutes: the sim, which is capped at a tenth of a second of world time
// per frame, advances a few ticks a minute, nothing is ever revealed, and every frame
// comes out hazed grey-blue by the shroud — which looks exactly like a lighting
// regression and is not one. `--use-angle=metal` puts the frame on the Apple GPU at
// about 16 ms. See LOOK.md, "What will bite".
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer-core';

/** The dev server to photograph. vite serves on :5063; override when this box runs it elsewhere. */
export const URL = process.env.URL ?? 'http://localhost:5063/';

/**
 * Chrome for Testing, as `npm run look:setup` installs it — the newest build in the
 * puppeteer cache, or whatever `CHROME` names.
 */
export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = `${homedir()}/.cache/puppeteer/chrome`;
  let builds = [];
  try {
    builds = readdirSync(root).filter((d) => d.startsWith('mac_arm-')).sort();
  } catch {
    // fall through to the error below
  }
  if (!builds.length) throw new Error(`no Chrome for Testing under ${root} — run: npm run look:setup`);
  const build = builds[builds.length - 1];
  return `${root}/${build}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
}

/**
 * A headless browser on the GPU. The long protocol timeout is deliberate: a screenshot
 * of a heavy frame can take a while, and a harness that gives up early reports a
 * hang that was only a slow frame.
 */
export function launch() {
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    protocolTimeout: 900000,
    args: ['--ignore-gpu-blocklist', '--use-angle=metal'],
  });
}
