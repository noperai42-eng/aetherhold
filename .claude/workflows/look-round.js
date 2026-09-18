export const meta = {
  name: 'look-round',
  description: 'One look round (LOOK.md): lane builders in parallel, tsc + render-test gate with a fixer, the same frames photographed again, optional judge panel',
  phases: [
    { title: 'Baseline', detail: 'capture reference frames before anything changes' },
    { title: 'Build', detail: 'one builder per file lane, disjoint files, same tree' },
    { title: 'Gate', detail: 'tsc + render tests (fixer on red), then screenshots' },
    { title: 'Judge', detail: 'three lenses compare this round with the last' },
  ],
}

// Paths come in through args so the script never hard-codes a machine: args.repo is
// the checkout, args.url the dev server the harness photographs (vite's :5063 unless
// this box runs it elsewhere). Frames land under .look/shots/<label>/ in the repo.
const REPO = args.repo || '/Users/nope/Code/RimSim'
const LOOK = `${REPO}/scripts/look`
const SHOTS_DIR = `${REPO}/.look/shots`
const URL = args.url || 'http://localhost:5063/'
const round = args.round
const label = `r${round}`
const prev = args.prev
const FRAMES = ['1-settlers', '2-buildings', '2b-closeup', '3-colony', '4-firstperson']
const framesOf = (l) => FRAMES.map((f) => `${SHOTS_DIR}/${l}/${l}-${f}.png`)

const RENDER_TESTS = 'tests/buildings-view.test.ts tests/decor-view.test.ts tests/lake.test.ts tests/lighting.test.ts tests/ice.test.ts tests/landmarks.test.ts tests/minimap.test.ts tests/seasons.test.ts tests/snowpack.test.ts tests/terrain-view.test.ts'

const LANES = [
  {
    key: 'pawns',
    files: 'src/client/render/pawns.ts',
    tests: 'tests/lighting.test.ts',
    budget: 'A settler rig at most ~3,000 triangles, an animal at most ~2,500. Rigs are per-pawn Groups (a few dozen on screen), not instanced, so detail is affordable — but share geometry through `SharedGeometry` as the file already does.',
    brief: `Replace the seven-box settler with a smooth, chunky, stylised figure (think Kenney / Synty proportions, but round): torso from RoundedBoxGeometry (three/examples/jsm/geometries/RoundedBoxGeometry.js) or a capsule-ish LatheGeometry with shoulders and a slight taper to the waist; a short neck; a head that is a rounded box with a generous radius (or a scaled sphere) with a hair cap that actually wraps the skull (hemisphere or high-radius rounded slab with a fringe), two small dark eyes; arms and legs as CapsuleGeometry pivoted at the top exactly like the current pivoted() boxes so the walk/hip/shoulder swing in update() still reads; hands as small spheres; boots as rounded boxes; a belt or collar band in a darker cloth tone. Rifle with stock, barrel and a sight (3–4 parts), club tapered. Animals (mossback etc.): capsule body, tapered neck, rounded head with a snout, ears, eyes, capsule legs, a curved tail; the collar torus at 16×32 segments; a smooth pet tag and a smooth hunt mark. Keep the Rig interface, layers, castShadow, dispose (dispose every new geometry), the CALF_SCALE scaling for calves, and the facing convention (model faces +Z, yaw = PI/2 − facing).`,
  },
  {
    key: 'buildings',
    files: 'src/client/render/buildings.ts',
    tests: 'tests/buildings-view.test.ts tests/lake.test.ts tests/seasons.test.ts tests/minimap.test.ts',
    budget: 'Walls, fences, conduits and trees are instanced hundreds of times: keep each of their pool parts under ~400 triangles. Furniture and machines can spend ~1,500 triangles across their parts. Keep pool capacities and the InstancedPool pattern.',
    brief: `This is the biggest lane. (1) Remove every \`flatShading: true\` and raise segment counts (cylinders/cones/spheres 6–12 → 16–24) so nothing looks faceted. (2) Trees: a tapered trunk (12+ segments) with a root flare, and a canopy that reads smooth — three overlapping smooth ellipsoids/icosahedra (detail 2, small vertex jitter, computeVertexNormals) or a soft lathe — while still reading as a conifer from overhead; young/old growth must still scale as it does now. (3) Furniture and machines get real secondary detail with RoundedBoxGeometry bevels (0.02–0.05): bed = frame + rounded mattress + pillow + blanket (medbed/prisonbed variants keep their distinguishing colours); table = top with rounded edge + four legs + rail; gametable with a board; bench with slats; lamp = post + bracket + glass globe (emissive) — it is lit at night, keep that path working; stove = rounded body + door + flue pipe; campfire = crossed log cylinders + a ring of stones; heater = rounded body with a glowing element; cooler = rounded chest with lid and frost trim; generator/battery = rounded housings with vents/terminals; solar = frame + panel with a cell grid (dark blue, low roughness); watermill = wheel with spokes and paddles; turret = base, head, barrel, muzzle (keep aimYaw); statue = pedestal + smooth figure; grave = rounded headstone + earth mound; sandbag = stacked capsules; fence = rounded posts + rails (keep FENCE_LINKS rail logic); door = frame + panel + handle; trap = plate + teeth; lab = desk + apparatus; conduit = rounded cable. (4) Walls keep their exact box footprint and def.height (tests measure it) but get a coping cap and a subtle plank (wall) / stone-course (stonewall) relief as extra thin pool parts. Blueprints for every kind must still draw. Keep every existing test green.`,
  },
  {
    key: 'decor',
    files: 'src/client/render/decor.ts src/client/render/landmarks.ts src/client/render/fx.ts',
    tests: 'tests/decor-view.test.ts tests/landmarks.test.ts',
    budget: 'Grass is instanced cells×3 times (tens of thousands): keep a blade under ~16 triangles. Stones/landmarks under ~200 each. fx bushes/crops under ~300.',
    brief: `Grass: replace the 3-sided cone with a real curved blade — a slim tapered strip (2–4 height segments) bent forward by vertex offsets, DoubleSide, so it reads as grass from overhead and at eye level; keep the sway shader (\`grassMaterial\` with the time/wind uniforms) working with the new geometry, and keep the instance count at TUFTS_PER_CELL per cell and the blade under knee height (tests count instances and measure height). Stones: IcosahedronGeometry(0.5, 1) with per-vertex jitter and computeVertexNormals, smooth (no flatShading). Landmarks (cairns/blocks/shards): smooth rounded shapes, still four draw calls total (a test counts). fx: bushes as smooth spheres (icosahedron detail 2), crops as a small merged leafy plant instead of a cone, the rest as they are. Match the existing determinism (same blades in the same places every time).`,
  },
  {
    key: 'terrain',
    files: 'src/client/render/terrain.ts',
    tests: 'tests/terrain-view.test.ts tests/snowpack.test.ts tests/ice.test.ts tests/lake.test.ts',
    budget: 'Rock blocks are instanced per rock cell (thousands): keep a block under ~300 triangles.',
    brief: `Rock: the instanced BoxGeometry blocks become beveled boulders — RoundedBoxGeometry with a generous radius plus a little deterministic vertex jitter and smooth normals — while the tests' contract holds exactly: the block still covers its cell tilt and all, its top sits just under the block height, it never grows past the clearance height, and the same block comes back for the same cell. Keep the per-block shade variation and the cliff-foot darkening. Ground: keep the corner-coloured quads and the snow/lake lattice as they are (they are load-bearing for snowpack/ice/lake tests); if there is a cheap way to add a little micro-relief to the ground colouring without touching heights, take it, otherwise leave the ground alone.`,
  },
  {
    key: 'lighting',
    files: 'src/client/render/renderer.ts src/client/render/sky.ts src/client/render/palette.ts',
    tests: 'tests/lighting.test.ts tests/seasons.test.ts',
    budget: 'No per-frame CPU cost beyond what is there; an environment map is built once.',
    brief: `Smooth surfaces only look smooth when something specular lands on them. (1) Give the scene an environment: PMREMGenerator over three/examples/jsm/environments/RoomEnvironment.js (or a procedural gradient sky) as scene.environment with scene.environmentIntensity around 0.3–0.4, tuned so day and night still differ (the sky lights already drive that; the lighting tests measure those intensities and must stay green — the env map is renderer-side and invisible to them). (2) Shadow tuning for smooth normals: set shadow.bias / normalBias on the sun so beveled and capsule surfaces do not get acne, and a modest shadow.radius for softer edges at high/medium quality. (3) A better sky backdrop than a flat clear colour — a gradient dome or three's Sky addon driven by the existing sun elevation, with fog colour following the horizon. (4) Keep the QUALITY tiers meaningful (low stays cheap: no env map or a tiny one). Keep tone mapping ACES and the exposure roughly as it is; do not restyle the palette wholesale — small material-response tweaks only (palette.ts owns the colours other lanes read, so change hues only where the current ones are clearly flat).`,
  },
  {
    key: 'critters',
    files: 'src/client/render/pickies.ts',
    tests: 'tests/lighting.test.ts',
    budget: 'A critter at most ~1,200 triangles.',
    brief: `The small animals in pickies.ts are boxes with cone ears and sphere eyes: give them smooth capsule bodies, rounded heads with a snout, smooth ears (rounded, not sharp cones), eyes with a little highlight, capsule limbs pivoted where the current ones pivot so the existing animation keeps working, and a tail. Keep the file's public interface and dispose everything you create.`,
  },
]
// A later round may run only the lanes that still have work: args.lanes = ['decor', ...]
const ACTIVE = args.lanes ? LANES.filter((l) => args.lanes.includes(l.key)) : LANES

const BUILD = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    verified: { type: 'string', description: 'the exact commands run and their result' },
    green: { type: 'boolean' },
    bugsFixed: { type: 'array', items: { type: 'string' } },
    bugsFound: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'filesTouched', 'verified', 'green'],
}
const GATE = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    typecheckOk: { type: 'boolean' },
    testsOk: { type: 'boolean' },
    errors: { type: 'string', description: 'first ~60 lines of whatever failed, verbatim; empty if all green' },
  },
  required: ['ok', 'typecheckOk', 'testsOk', 'errors'],
}
const SHOTS = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    consoleErrors: { type: 'integer' },
    errorSamples: { type: 'array', items: { type: 'string' } },
    stood: { type: 'integer' },
    // The harness's own Cost line, verbatim: draw calls, triangles, the empty
    // instanced pools, and what the frame cost the card. Carried as a string rather
    // than parsed into numbers on purpose — it is quoted into the round note, and a
    // number pulled out of it here would be a second place for the format to drift.
    // `gpu n/a` is a legitimate value and must be reported as it stands, never as 0.
    cost: { type: 'string' },
    output: { type: 'string' },
  },
  required: ['ok', 'consoleErrors', 'errorSamples', 'stood', 'cost', 'output'],
}
const JUDGE = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    scorePrev: { type: 'number' },
    scoreNow: { type: 'number' },
    better: { type: 'boolean' },
    wins: { type: 'array', items: { type: 'string' } },
    problems: { type: 'array', items: { type: 'string' } },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lane: { type: 'string', enum: ['pawns', 'buildings', 'decor', 'terrain', 'lighting', 'critters'] },
          change: { type: 'string' },
          priority: { type: 'integer', description: '1 = highest' },
        },
        required: ['lane', 'change', 'priority'],
      },
    },
  },
  required: ['lens', 'scorePrev', 'scoreNow', 'better', 'wins', 'problems', 'proposals'],
}

const shotPrompt = (l) => `Run the screenshot harness for Aetherhold and report what it printed. Exactly this, in one Bash call with a 600000 ms timeout (chain with && — a hook rejects ';'):
cd ${LOOK} && (pkill -f "Chrome for Testing" || true) && URL=${URL} node shot.mjs ${SHOTS_DIR}/${l} ${l}${args.zoo ? ` && (pkill -f "Chrome for Testing" || true) && URL=${URL} node zoo.mjs ${SHOTS_DIR}/${l}-zoo ${l}` : ''}
Headless Chrome uses the GPU, so each harness finishes in under two minutes; a stale headless Chrome from an earlier run stalls the next one on the GPU, which is what the pkill is for. If the command has printed nothing for four minutes, it has stalled: run (pkill -f "node shot.mjs" || true) && (pkill -f "node zoo.mjs" || true) && (pkill -f "Chrome for Testing" || true), wait ten seconds with a python loop (no sleep), and run the exact command once more; report a second stall as ok=false. Then run: ls -la ${SHOTS_DIR}/${l}${args.zoo ? ` ${SHOTS_DIR}/${l}-zoo` : ''}
ok = the command exited 0, printed "0 console errors", and all five PNGs (${FRAMES.join(', ')}) exist and are over 50 KB. Put the harness's printed line and the ls listing in output, and put the Cost half of that printed line — from "colony frame" to the end, including the gpu reading — in cost, copied exactly. If it says "gpu n/a", copy that; do not substitute a number or a zero. Do not edit anything.`

const gatePrompt = `Run Aetherhold's typecheck and render tests and report the result faithfully. One Bash call, chained with && (a hook rejects ';'), timeout 300000 ms:
cd ${REPO} && npx tsc --noEmit && npx vitest run ${RENDER_TESTS}
If it goes red, run the failing part again on its own to get the full message, and put the first ~60 lines of the failure verbatim in errors (test names and the assertion/compile error, not the summary line). Do not edit anything. typecheckOk/testsOk are each true only if that step actually passed; ok = both.`

const builderPrompt = (lane, extra) => `You are one of ${ACTIVE.length} builders upgrading the procedural Three.js models of Aetherhold, a browser colony sim at ${REPO} (three 0.180, TypeScript, Vitest; render code in src/client/render/). The whole effort's goal, in the user's words: a MASSIVE update to make the models "more detailed and smooth looking, less polygon-ish". This is round ${round}.

YOUR LANE: ${lane.key}. You own ONLY these files: ${lane.files} (plus your lane's test files: ${lane.tests}). Five other builders are editing the other render files right now in the same working tree — never touch a file you do not own, not palette.ts, not instanced.ts, not world-view.ts, not another lane's tests. If tsc reports an error in a file you do not own, it is another builder mid-edit: ignore it, re-run once at the end, and put it in concerns if it persists.

WHAT TO DO: ${lane.brief}${extra ? `\n\nTHIS ROUND'S CHANGE LIST FOR YOUR LANE (from the judges and the user, highest value first — do these first, then continue the brief where it is still unmet):\n${extra}` : ''}

ORIENTATION (read the files yourself; this is only a map): every model is procedural three.js primitives. Buildings, decor, terrain and landmarks draw through InstancedPool (src/client/render/instanced.ts) — keep instancing, pool capacities and frustumCulled=false. Pawns are per-rig Groups implementing Rig { group, setLayer, update, dispose }. QUALITY tiers live in renderer.ts. Building heights come from BUILDING_DEFS (def.height) and tests measure them. Imports from three/examples/jsm/... are fine (RoundedBoxGeometry, RoomEnvironment, Sky); no new npm dependencies. Smooth = no flatShading, enough segments, computeVertexNormals where you build geometry by hand. Dispose every geometry and material you create in the existing dispose paths. The game has two cameras: an overhead manager view ~20 cells wide and a first-person view 1.6 m off the ground — things must read at both.

PERFORMANCE BUDGET: ${lane.budget}

STYLE: match each file's voice exactly — long narrative comments that explain why, precise names, surgical edits, nothing speculative, no emoji. Do not restyle or reformat code you did not need to touch.

VERIFY (Bash: chain with &&, never ';' — a preflight hook rejects ';'): cd ${REPO} && npx tsc --noEmit && npx vitest run ${lane.tests}
Run only your lane's tests, not the full suite — five other builders are running theirs. Add one to three focused assertions to your lane's test file(s) for properties checkable without WebGL (no material left flat-shaded, a geometry's vertex count within budget, a bounding box still inside its cell, a pivot still at the joint) — name each test for WHY it matters, in the file's existing voice. Never weaken an existing test to make it pass: if an existing test rightly fails because of your change, fix the change.

BUGS: the user asked to "resolve any known bugs as they come up". A rendering bug in your lane (z-fighting, floating or sunken meshes, wrong pivots, missing dispose, wrong layer, a part that never shows) — fix it and list it in bugsFixed. Bugs outside your lane go in bugsFound, untouched.

Do not commit, do not push, do not touch git. Return the structured result once tsc and your tests are green (green=false with an honest verified string if you could not get there).`

const judgePrompt = (lens, lensText) => `You are the "${lens}" judge on a design panel for Aetherhold's Three.js model upgrade. The user's goal: models "more detailed and smooth looking, less polygon-ish", while the game stays readable as a colony sim from the overhead camera. Compare round ${round} frames against the previous round.

Read ALL of these PNGs with the Read tool, previous first, then current:
PREVIOUS (${prev}): ${framesOf(prev).join(' ')}
CURRENT (${label}): ${framesOf(label).join(' ')}
The frames: 1-settlers = overhead close-up of settlers by the cabin; 2-buildings = overhead wide shot of a showcase of every building kind stood in three rows south of the cabin (row 1: wall stonewall door fence sandbag turret trap bed medbed; row 2: prisonbed table gametable statue stove bench lab cooler campfire; row 3: heater generator battery solar watermill conduit lamp grave); 2b-closeup = the middle row up close; 3-colony = the starting cabin from above; 4-firstperson = first-person view from a settler at eye level.

YOUR LENS: ${lensText}

Score previous and current 0–10 on your lens. Say whether current is better. List concrete wins and concrete problems — name the object and the frame ("the lamp globe in 2b", "grass in 4"). Then propose the 3–6 highest-value changes for the next round, each tagged with the owning lane: pawns (settlers/animals in pawns.ts), buildings (structures/furniture/trees in buildings.ts), decor (grass/stones/landmarks/fx), terrain (rock blocks/ground), lighting (renderer/sky/palette/shadows/env), critters (pickies.ts). Be specific enough that a builder can act on a proposal without seeing the frames. Do not edit any file.`

const LENSES = [
  ['silhouette & smoothness', 'Do models still read as boxes and cones? Are edges bevelled, curves round, shading smooth with no visible faceting? Where does the eye still catch a polygon or a hard 90° corner? Is the low-poly look actually gone, or just repainted?'],
  ['detail & materials', 'Is there enough secondary detail (trim, parts, props, joinery) for an object to read as crafted at close range? Do surfaces respond like wood, stone, cloth, metal, glass (roughness, specular, emissive) rather than flat colour? And from the overhead frames, can every building kind still be told apart at a glance?'],
  ['regression hunter', 'Assume something broke and go looking: floating or sunken meshes, z-fighting, black or blown-out surfaces, shadow acne on smooth surfaces, objects missing versus the previous frames (count them), wrong scale, things that no longer read as what they are, first-person clipping, a darker or muddier overall picture. Default to suspicion; a regression outranks any win.'],
]

// ---- Baseline ------------------------------------------------------------
if (args.baseline) {
  phase('Baseline')
  const base = await agent(shotPrompt(prev), { agentType: 'gate-runner', effort: 'low', schema: SHOTS, label: `shots:${prev}`, phase: 'Baseline' })
  if (!base || !base.ok) return { round, aborted: 'baseline capture failed', base }
  log(`baseline ${prev}: ${base.stood} buildings stood, ${base.consoleErrors} console errors, ${base.cost}`)
}

// ---- Build ---------------------------------------------------------------
phase('Build')
const brief = args.brief || {}
const builders = await parallel(ACTIVE.map((lane) => () =>
  agent(builderPrompt(lane, brief[lane.key] || ''), { effort: 'high', schema: BUILD, label: `build:${lane.key}`, phase: 'Build' })
    .then((r) => ({ lane: lane.key, ...(r || { summary: 'agent died', filesTouched: [], verified: '', green: false }) }))))
log(`builders done: ${builders.filter((b) => b.green).length}/${ACTIVE.length} green`)

// ---- Gate ----------------------------------------------------------------
phase('Gate')
let gate = await agent(gatePrompt, { agentType: 'gate-runner', effort: 'low', schema: GATE, label: 'gate:tsc+tests', phase: 'Gate' })
const fixes = []
for (let i = 0; i < 2 && (!gate || !gate.ok); i++) {
  const fix = await agent(`The Aetherhold tree at ${REPO} is red after ${ACTIVE.length} builders edited the render layer in parallel (files: ${LANES.map((l) => l.files).join(' ')}). Make it green with the smallest correct change — fix the code, never weaken or delete a test. Failure output:\n\n${gate ? gate.errors : 'gate agent died — run it yourself'}\n\nVerify with one Bash call chained by && (a hook rejects ';'): cd ${REPO} && npx tsc --noEmit && npx vitest run ${RENDER_TESTS}. Do not commit. Return the structured result.`, { effort: 'high', schema: BUILD, label: `fix:${i + 1}`, phase: 'Gate' })
  fixes.push(fix)
  gate = await agent(gatePrompt, { agentType: 'gate-runner', effort: 'low', schema: GATE, label: `gate:retry${i + 1}`, phase: 'Gate' })
}
if (!gate || !gate.ok) return { round, aborted: 'gate still red after two fixes', gate, fixes, builders }
const shots = await agent(shotPrompt(label), { agentType: 'gate-runner', effort: 'low', schema: SHOTS, label: `shots:${label}`, phase: 'Gate' })
if (!shots || !shots.ok) return { round, aborted: 'screenshot capture failed', shots, gate, fixes, builders }
log(`${label}: ${shots.stood} buildings stood, ${shots.consoleErrors} console errors, ${shots.cost}`)

// ---- Judge ---------------------------------------------------------------
phase('Judge')
// The lead judges the frames personally; the panel is an extra pair of eyes that a
// round can skip (args.judges === false) when the token budget matters more.
const judges = args.judges === false ? [] : (await parallel(LENSES.map(([lens, text]) => () =>
  agent(judgePrompt(lens, text), { effort: 'medium', schema: JUDGE, label: `judge:${lens}`, phase: 'Judge' })))).filter(Boolean)

const nextBrief = {}
for (const j of judges) for (const p of j.proposals) {
  (nextBrief[p.lane] = nextBrief[p.lane] || []).push({ priority: p.priority, lens: j.lens, change: p.change })
}
for (const k of Object.keys(nextBrief)) nextBrief[k].sort((a, b) => a.priority - b.priority)

return {
  round,
  frames: framesOf(label),
  verdict: judges.map((j) => ({ lens: j.lens, prev: j.scorePrev, now: j.scoreNow, better: j.better })),
  builders: builders.map((b) => ({ lane: b.lane, green: b.green, summary: b.summary, bugsFixed: b.bugsFixed || [], bugsFound: b.bugsFound || [], concerns: b.concerns || [] })),
  fixes: fixes.filter(Boolean).map((f) => f.summary),
  shots: { stood: shots.stood, consoleErrors: shots.consoleErrors, errorSamples: shots.errorSamples },
  judges: judges.map((j) => ({ lens: j.lens, wins: j.wins, problems: j.problems })),
  nextBrief,
}