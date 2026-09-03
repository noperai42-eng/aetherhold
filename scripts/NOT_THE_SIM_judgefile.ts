/**
 * Judge a measurements file that is not the one on disk.
 *
 * `npm run balance` refuses a stale file, correctly — a verdict about a game
 * nobody played is the one unacceptable output. This is the other question:
 * what did the *previous* grid say, judged by the same principles, so a
 * regression can be attributed instead of guessed at. It reads a file by path
 * and never looks at the fingerprint, which is exactly why it lives here and
 * not in `src/eval`.
 */
import { readFileSync } from 'node:fs';
import { formatPrinciples, judgePrinciples } from '../src/eval/principles';

const path = process.argv[2]!;
const m = JSON.parse(readFileSync(path, 'utf8'));
const results = judgePrinciples(m.sweep);
console.log(`# ${path} — fingerprint ${m.fingerprint}\n`);
console.log(formatPrinciples(results));
console.log('\n# enforced verdicts');
for (const r of results.filter((p: { enforced: boolean }) => p.enforced)) {
  console.log(`${r.verdict.toUpperCase().padEnd(9)} ${r.id}`);
}
