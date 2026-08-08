/**
 * The rules `ARCHITECTURE.md` states, checked instead of asserted.
 *
 * Every claim in here is one a reader has to take on trust otherwise, and every
 * one of them is the kind that decays quietly: a single convenient import from
 * `sim/` into `client/` does not break a test, does not break the build, and
 * costs the project the one property that makes "two views onto one simulation"
 * true rather than aspirational. So the source is read as text and the rules are
 * asserted against it.
 *
 * Source is loaded through Vite's raw glob rather than `node:fs` on purpose: the
 * project has no `@types/node`, and adding a dependency so that a test can read
 * a file is a worse trade than one glob.
 */

import { describe, expect, it } from 'vitest';

const SRC = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const HTML = import.meta.glob('../index.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every source path under a directory, normalised to `src/...` for readable failures. */
function under(dir: string): [string, string][] {
  return Object.entries(SRC)
    .map(([path, text]) => [path.replace(/^\.\.\//, ''), text] as [string, string])
    .filter(([path]) => path.startsWith(dir));
}

/** The module specifiers a file imports, in source order. */
function importsOf(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]!);
  return out;
}

describe('the reader itself', () => {
  it('actually found the source it is about to judge', () => {
    // Without this, every rule below passes by reading nothing — a green suite
    // guarding an empty set is worse than no guard, because it reads as proof.
    expect(Object.keys(SRC).length).toBeGreaterThan(50);
    expect(under('src/sim').length).toBeGreaterThan(30);
    expect(under('src/client/fps').length).toBeGreaterThan(0);
    expect(Object.keys(HTML).length).toBe(1);

    // And the import scanner finds imports in a file that certainly has them.
    const tick = under('src/sim').find(([path]) => path.endsWith('sim/tick.ts'))!;
    expect(importsOf(tick[1]).length).toBeGreaterThan(10);
    expect(importsOf(tick[1])).toContain('./types');
  });
});

describe('the dependency rule', () => {
  it('has sim/ importing nothing from client/', () => {
    // This is the load-bearing one. `sim/` staying ignorant of `client/` is what
    // lets the whole colony run headlessly at thousands of ticks a second in a
    // test, and it is what makes a second view a rendering question rather than
    // a synchronisation problem. One import the other way and both properties go.
    const offenders: string[] = [];
    for (const [path, text] of under('src/sim')) {
      for (const spec of importsOf(text)) {
        if (spec.includes('client/') || spec.includes('/render') || spec === 'three') {
          offenders.push(`${path} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has sim/ importing no rendering library at all', () => {
    // Belt and braces on the same rule from the other end: a three.js type
    // imported "just for a Vector3" is how the sim starts needing a canvas.
    for (const [path, text] of under('src/sim')) {
      expect(text.includes("from 'three'"), `${path} imports three.js`).toBe(false);
    }
  });

  it('keeps the eval harness out of the game', () => {
    // `eval/steward.ts` is a *test driver* — it plays the colony far better than
    // the in-game foreman does, including building turrets. If it ever ran in a
    // real game the player would win charters they never earned, and the probe
    // numbers in `victory.ts` would silently become the player's experience.
    for (const [path, text] of under('src/client')) {
      for (const spec of importsOf(text)) {
        expect(spec.includes('eval/'), `${path} imports the eval harness`).toBe(false);
      }
    }
  });
});

describe('one simulation', () => {
  it('never lets the first-person view build or step a world of its own', () => {
    // The anti-slop rule, as an import check. A body that stepped its own copy
    // would drift from the manager's colony within seconds, and the drift would
    // look like a physics bug rather than the architectural mistake it is.
    for (const [path, text] of under('src/client/fps')) {
      for (const spec of importsOf(text)) {
        expect(spec.endsWith('/worldgen'), `${path} builds a world`).toBe(false);
      }
      expect(text.includes('stepWorld('), `${path} steps a world`).toBe(false);
    }
  });

  it('walks the possessed body through the same collision settlers use', () => {
    // Collision matches the visuals because there is exactly one function that
    // moves a body past a wall. The FPS controller must call it rather than
    // rolling its own test against `world.buildings`.
    const controller = under('src/client/fps').find(([path]) => path.endsWith('controller.ts'));
    expect(controller, 'the fps controller has moved').toBeTruthy();
    const [, text] = controller!;
    expect(text).toContain('moveWithCollision');
    expect(text.includes('world.buildings'), 'the fps controller scans buildings itself').toBe(false);
  });

  it('lets only one file know how fast the ground is', () => {
    // `terrainSpeed` is the bare table — the boards and the paving, with nothing
    // lying on them. `groundSpeed` is that table plus whatever the weather has
    // put on top, and it is what anything that walks must ask.
    //
    // The failure this stops is a quiet one and it goes straight at the killer
    // feature: somebody adds a movement path, reaches for the obvious-sounding
    // name, and now settlers wade through the drifts while the body the player
    // is standing in skates over them. Nothing crashes, no test about snow
    // fails, and the first-person view has quietly stopped being a window onto
    // the same simulation. So the raw table is readable in exactly one place.
    const offenders = [...under('src/sim'), ...under('src/client')]
      .filter(([path]) => !path.endsWith('sim/types.ts') && !path.endsWith('sim/snowpack.ts'))
      .filter(([, text]) => text.includes('terrainSpeed'))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe('no stubs', () => {
  it('has nothing left marked unfinished', () => {
    // The anti-slop rule with teeth. A slice that claims to be done and leaves a
    // marker behind is claiming something false, and the marker is the evidence.
    // Note what this does *not* forbid: a comment explaining a decision, or one
    // naming a trade-off that was made deliberately. Only the ones that mean
    // "this does not work yet".
    const marks: string[] = [];
    for (const [path, text] of under('src')) {
      for (const line of text.split('\n')) {
        if (/\b(?:TODO|FIXME|XXX|HACK)\b/.test(line)) marks.push(`${path}: ${line.trim()}`);
      }
    }
    expect(marks).toEqual([]);
  });
});

describe('nothing comes off the network', () => {
  it('loads no script, style or font from anywhere but this project', () => {
    const [, html] = Object.entries(HTML)[0]!;
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/@import\s+url\(\s*["']?https?:/i);
  });

  it('fetches nothing at runtime', () => {
    // Every URL left in the source is in a comment — a citation, not a request.
    // The check is on the *call*, so a documented link stays allowed and a
    // dependency on somebody else's uptime does not.
    for (const [path, text] of under('src')) {
      expect(text, `${path} fetches`).not.toMatch(/\b(?:fetch|XMLHttpRequest|importScripts)\s*\(\s*["'`]https?:/);
      expect(text, `${path} opens a socket`).not.toMatch(/new\s+(?:WebSocket|EventSource)\s*\(/);
    }
  });

  it('ships no art, model or audio files', () => {
    // All geometry, every sound and the whole palette are generated in code.
    // A stray asset is not just weight: it is the first one, and the second is
    // always easier.
    const assets = Object.keys(
      import.meta.glob('../src/**/*.{png,jpg,jpeg,gif,webp,svg,glb,gltf,fbx,obj,mp3,wav,ogg,ttf,woff,woff2}'),
    );
    expect(assets).toEqual([]);
  });
});
