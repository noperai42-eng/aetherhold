/**
 * `npm run export:models` — the command behind `ASSETS.md`.
 *
 * Everything that decides anything is in `models.ts`, which is a library and is
 * what the tests drive. This file is the handle: it picks the directory, runs the
 * job, and prints enough that a person can tell a good export from a quiet one —
 * how many files, how many triangles, how many bytes. A run that wrote three
 * models and thought that was fine should be obvious from the shell.
 */

import { exportModels } from './models';

const dir = process.argv[2] ?? 'models';
const manifest = await exportModels(dir);
const names = Object.keys(manifest.models);
let tris = 0;
let bytes = 0;
for (const m of Object.values(manifest.models)) {
  tris += m.triangles;
  bytes += m.bytes;
}
const biggest = names
  .slice()
  .sort((a, b) => manifest.models[b]!.triangles - manifest.models[a]!.triangles)
  .slice(0, 5)
  .map((n) => `${n} ${manifest.models[n]!.triangles}`)
  .join(', ');
console.log(
  `${dir}: ${names.length} models, ${Object.keys(manifest.kinds).length} kinds mapped, ${tris} triangles, ${(bytes / 1024).toFixed(0)} KiB`,
);
console.log(`heaviest: ${biggest}`);
