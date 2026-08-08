/**
 * The moor, with nobody in it, and then with somebody in it.
 *
 * Every other test in this directory checks that a rule fires. These check that
 * three of them, left running against each other for weeks, arrive somewhere — and
 * that is a genuinely different kind of question. A food chain is not a property of
 * any one function; it is what `tickWildlife`, `berries.ts` and `predators.ts` do
 * to each other over a hundred days, and no unit test can be wrong about it because
 * no unit test can see it. The bugs this file exists to catch both looked like
 * working code:
 *
 * - Brambletails sat between two and six against fruit that would carry
 *   thirty-four, for a thousand days, with ninety per cent of the moor's berries
 *   standing untouched. Nothing was broken. A fed female needs a male within twenty
 *   cells, the map had got half again as wide, and the two facts had never been
 *   read next to each other. The species was on respawn life support and every
 *   individual test still passed.
 * - Fenwolves existed only inside `encounters.ts`, aimed at the colony, and went
 *   home afterwards. So the valley's top predator was not in the valley, and a moor
 *   with no colony on it had no predation in it at all — which nothing anywhere
 *   asserted, because until there was a way to run the moor without a colony there
 *   was no way to notice.
 *
 * Both were found by running `src/eval/ecosystem.ts` for a thousand days and
 * reading the census. So that is what these tests do, at a length the suite can
 * afford, with the thousand-day version behind `ECO=1` — `npm run eco`.
 *
 * The thresholds are wide on purpose. This is a stochastic system with real cycles
 * in it: brambletails boom to their ceiling, strip the moor, and crash to two,
 * which is the feature working and not a regression. What is pinned is the shape —
 * nobody goes extinct, nobody runs away, the fruit gets eaten, the wolves eat — and
 * a band loose enough that a passing run means the chain held rather than that the
 * dice fell the same way twice.
 */

import { describe, expect, it } from 'vitest';

import {
  meanRipeFraction,
  runEcosystem,
  statsFor,
  window,
  WILD_KINDS,
  type EcoRun,
} from '../src/eval/ecosystem';

// No node types in this project — the same one-line declaration `survival-sweep`
// uses, and for the same reason: one long run behind an env flag is not worth a
// dependency.
declare const process: { env: Record<string, string | undefined> };

/**
 * Long enough for the answer to mean something, short enough for the suite.
 *
 * Forty-five days is two and a bit brambletail lifetimes and one and a half
 * fenwolf ones, so every species on the moor has had to replace itself at least
 * once out of its own breeding to still be standing at the end. That is the
 * property — a population that merely had not died yet would clear a shorter run
 * and fail this one.
 */
const SUITE_DAYS = 45;

/** The full thing, behind `npm run eco`. Twenty-five brambletail generations. */
const LONG_DAYS = Number(process.env.ECO_DAYS ?? 1000);

/** One line per species, for reading a failure without re-running it. */
function report(run: EcoRun, from = 1): string {
  const rows = WILD_KINDS.map((k) => {
    const s = statsFor(window(run, from, run.samples.length), k);
    return `  ${k.padEnd(12)} min=${s.min} max=${s.max} mean=${s.mean.toFixed(1)} zeroDays=${s.zeroDays} longestGap=${s.longestGap}`;
  });
  return [`${run.width}x${run.height} seed ${run.seed} cap ${run.cap}`, ...rows].join('\n');
}

describe('the moor on its own', () => {
  const run = runEcosystem({ seed: 20260729, days: SUITE_DAYS });
  const settled = window(run, 10, SUITE_DAYS);

  it('keeps every species on the map', () => {
    // Not "some of each survived to the end" — that passes on a lone survivor, and
    // one brambletail is not a population (see `browsersCanBreed`). What is checked
    // is that no species was ever gone for long enough that only a respawn could
    // have brought it back: a week of zeroes is a local extinction whatever walks
    // in on day eight.
    for (const kind of WILD_KINDS) {
      const stats = statsFor(settled, kind);
      expect(stats.longestGap, `${kind} vanished for ${stats.longestGap} days\n${report(run, 10)}`).toBeLessThan(7);
    }
  });

  it('holds the valley near what it carries rather than filling it or emptying it', () => {
    // The grazers are the moor's steady term — `populationCap` plus the respawn
    // clock — so this is really asking whether anything has broken the arithmetic
    // underneath them. Generous on both sides: browsers and wolves are counted here
    // too and neither answers to that cap, so a brambletail boom legitimately
    // overshoots it by half.
    for (const s of settled) {
      expect(s.animals, `day ${s.day}: ${s.animals} animals\n${report(run, 10)}`).toBeGreaterThan(run.cap * 0.4);
      expect(s.animals, `day ${s.day}: ${s.animals} animals\n${report(run, 10)}`).toBeLessThan(run.cap * 2.5);
    }
  });

  it('has the browsers actually eating the moor', () => {
    // The one that caught the mate-range bug, and the reason it is phrased as fruit
    // rather than as squirrels. A broken browser tier is invisible in the animal
    // count — three brambletails and thirty both read as "some" — but it is written
    // all over the hedges: nothing eating means nothing picked, and the moor sits at
    // ninety per cent ripe forever. A living population takes a real bite out of
    // that and gives it back between booms, so the mean lands well below full.
    const ripe = meanRipeFraction(settled);
    expect(ripe, `moor sat ${(ripe * 100).toFixed(0)}% ripe — is anything browsing?`).toBeLessThan(0.8);
    // And the other way: a moor stripped bare for six weeks means the browsers have
    // overrun their own food and the ceiling is not binding.
    expect(ripe, `moor sat ${(ripe * 100).toFixed(0)}% ripe — the hedges never recover`).toBeGreaterThan(0.15);
  });

  it('keeps predators on the moor without a colony to send them', () => {
    // Before resident wolves this was zero for a thousand days straight, and the
    // only fenwolf that had ever existed in the game was one `encounters.ts` aimed
    // at a player. A chain whose top link only exists when somebody is watching is
    // not a chain.
    const wolves = statsFor(settled, 'fenwolf');
    expect(wolves.mean, `fenwolf mean ${wolves.mean.toFixed(1)}\n${report(run, 10)}`).toBeGreaterThan(0.5);
    // And they are limited by what they eat rather than by nothing. `wolfCap` is
    // about five on a full moor; a valley with fifteen wolves on it has a cap that
    // has stopped binding, which is how a predator turns into a plague.
    expect(wolves.max, `fenwolf peaked at ${wolves.max}\n${report(run, 10)}`).toBeLessThan(15);
  });

  it('is the same moor twice on the same seed', () => {
    // Cheap, and it guards the thing every other assertion here quietly assumes:
    // that a run is a measurement rather than a roll. Eight days is enough for the
    // wolves to have hunted, the browsers to have bred and the respawn clock to have
    // fired several times — all three of the stochastic subsystems.
    const a = runEcosystem({ seed: 4242, days: 8 });
    const b = runEcosystem({ seed: 4242, days: 8 });
    expect(a.samples.map((s) => s.animals)).toEqual(b.samples.map((s) => s.animals));
    expect(a.samples.map((s) => s.ripe)).toEqual(b.samples.map((s) => s.ripe));
  });
});

describe('colonists arriving in a settled valley', () => {
  // Twenty-five days of moor on its own, then the landing party is put back
  // exactly where worldgen left it and the counting carries on. The point of
  // settling first is that whatever the numbers do afterwards is attributable: a
  // colony and a wilderness started together are two things finding their level at
  // once, and there is no way to read one out of the other.
  const LAND_ON = 25;
  const run = runEcosystem({ seed: 20260729, days: LAND_ON + 12, landOn: LAND_ON });
  const before = window(run, 15, LAND_ON);
  const after = window(run, LAND_ON + 1, run.samples.length);

  it('puts the colony in without touching the wild population directly', () => {
    // The splice itself must be a no-op on the moor. If landing a colony changed
    // the animal count on the day it happened, this harness would be measuring its
    // own seam rather than the disruption.
    const last = before[before.length - 1];
    const first = after[0];
    expect(first.colonists).toBeGreaterThan(0);
    expect(last.colonists).toBe(0);
    expect(Math.abs(first.animals - last.animals)).toBeLessThan(run.cap * 0.5);
  });

  it('leaves a valley that is disturbed and still standing', () => {
    // The whole ask, in one assertion. Settlers are a disruption: they shoot
    // animals, they pick the hedges, they wall off ground the herds walked over.
    // What they must not be is an extinction event within a fortnight — and the
    // moor must still be recognisably the same moor, not a wasteland and not
    // untouched.
    for (const kind of WILD_KINDS) {
      const stats = statsFor(after, kind);
      expect(stats.longestGap, `${kind} gone for ${stats.longestGap} days after the landing\n${report(run)}`).toBeLessThan(9);
    }
    const end = after[after.length - 1];
    expect(end.animals, `moor down to ${end.animals} animals\n${report(run)}`).toBeGreaterThan(run.cap * 0.3);
  });
});

describe.runIf(process.env.ECO)(`${LONG_DAYS} days of moor`, () => {
  it('holds its balance for a thousand days', () => {
    const run = runEcosystem({
      seed: Number(process.env.ECO_SEED ?? 20260729),
      days: LONG_DAYS,
      onDay: (s) => {
        if (s.day % 50 !== 0) return;
        console.log(
          `d${String(s.day).padStart(4)} ` +
            WILD_KINDS.map((k) => `${k.slice(0, 5)}=${String(s.counts[k]).padStart(3)}`).join(' ') +
            ` | all ${String(s.animals).padStart(3)} | ripe ${String(s.ripe).padStart(3)}/${s.bushes}`,
        );
      },
    });
    console.log(report(run, 20));
    console.log(`ripe fraction mean ${(meanRipeFraction(window(run, 20, LONG_DAYS)) * 100).toFixed(1)}%`);

    // The drift check, which is the only thing a thousand days can tell you that a
    // hundred cannot. A chain can hold for a season and still be losing half a
    // per cent a week to something nobody modelled; the way that shows up is the
    // last tenth of the run sitting somewhere the first tenth was not.
    const early = window(run, 20, Math.round(LONG_DAYS * 0.15));
    const late = window(run, Math.round(LONG_DAYS * 0.85), LONG_DAYS);
    for (const kind of WILD_KINDS) {
      const a = statsFor(early, kind).mean;
      const b = statsFor(late, kind).mean;
      expect(a, `${kind} was absent early — nothing to compare\n${report(run, 20)}`).toBeGreaterThan(0.4);
      expect(b, `${kind} drifted from ${a.toFixed(1)} to ${b.toFixed(1)}\n${report(run, 20)}`).toBeGreaterThan(a * 0.35);
      expect(b, `${kind} drifted from ${a.toFixed(1)} to ${b.toFixed(1)}\n${report(run, 20)}`).toBeLessThan(a * 3);
    }

    // And nobody may go missing for a season along the way.
    for (const kind of WILD_KINDS) {
      const stats = statsFor(window(run, 20, LONG_DAYS), kind);
      expect(stats.longestGap, `${kind} vanished for ${stats.longestGap} days\n${report(run, 20)}`).toBeLessThan(25);
    }
  },
  // Two hours, because the honest number is fifty-one minutes and a harness that
  // reports a red X after five is worse than no harness: the run had *already
  // printed a passing moor* when vitest killed it, so the one thing the operator
  // saw was a failure that had not happened. An opt-in test gated behind an env
  // var is allowed to take as long as it takes; what it is not allowed to do is
  // lie about the result.
  2 * 60 * 60 * 1000);
});
