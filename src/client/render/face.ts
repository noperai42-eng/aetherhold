/**
 * A settler's face and the lie of their hair, painted in the fragment shader.
 *
 * The rig spends 2,988 of its 3,000 triangles on the trader with a rifle, so a
 * face cannot be modelled: a brow ridge and a pair of lips are a hundred
 * triangles each at the fewest, on a head that from the manager camera is
 * twenty pixels across. What a face is at that size is a few changes of colour
 * in the right places — brows, the whites either side of each eye, a mouth — and
 * a colour can be worked out per pixel from where on the skull it lands, which
 * costs no geometry, no texture and no download. The same goes for the strands
 * of the hair.
 *
 * Both are worked out in the mesh's own frame, so they ride every nod, turn and
 * lean without being told about any of them, and both widen their edges by the
 * pixel's own footprint (`fwidth`), so a feature thinner than a pixel fades into
 * the skin instead of crawling.
 *
 * glTF has nowhere to put a fragment program, so an exported head is plain skin
 * and exported hair is its colour with the vertex shading `makeHair` bakes;
 * `ASSETS.md` says so.
 */

import * as THREE from 'three';

/**
 * How high on the skull the eyes sit, in the head's own frame. A little under
 * the middle, where a face's eyes are: r28 had them a third of the way up from
 * the chin, below the equator, where from a camera fifty degrees overhead the
 * brow and the fringe hid them and a head was a ball of hair. The brows and
 * the mouth below are set off it, and `assembleSettler` seats the beads on it.
 */
export const EYE_Y = -0.025;

const glslFloat = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * The face, drawn over the skin. Every position is in the head's own frame,
 * which faces +Z, in metres of the skull `settlerGeometry` cuts (0.13 across,
 * 0.138 tall, 0.166 deep), and each one is set off an eye bead's own centre at
 * (±0.05, `EYE_Y`).
 *
 *  - The whites: an almond round each bead, wider than tall. A black bead on
 *    skin is a button; the same bead with a white either side is an eye looking
 *    somewhere.
 *  - A lid line over each: the dark crease that gives an eye a top.
 *  - Brows, in the hair's own colour darkened, arched and a little heavier at
 *    the inner end. They are what makes a face from overhead, where the eyes
 *    are foreshortened to slits and the brows are not.
 *  - A mouth: a short, shallow smile in a darker, redder skin.
 *  - Cheeks: a warm flush under each eye.
 *  - A beard, for some: the lower face and the jaw in the hair's colour.
 *
 * r30 found that at that much a face is a mask: brows, eyes and a mouth on an
 * even skin. So the modelling a face has in shadow is painted too — each eye
 * set in a socket, a fold from the nose to each corner of the mouth, a shadow
 * under the lower lip — and a settler's own marks ride on `uTraits`:
 * a moustache or stubble instead of a beard, freckles across the nose, and on
 * the grey-haired the lines of age at the eyes and round the mouth.
 */
const FACE_GLSL = /* glsl */ `
  {
    vec3 p = vFacePos - vec3(0.0, ${glslFloat(EYE_Y)}, 0.0);
    float aa = max(fwidth(p.y), 1e-5);
    float front = smoothstep(0.05, 0.09, p.z);
    vec3 skin = diffuseColor.rgb;
    vec3 brow = mix(uHair, vec3(0.02, 0.015, 0.012), 0.35);

    // Beard: below the cheekbones on the front and round the jaw. Its top
    // edge rides up the cheeks and dips under the nose, and fades over a few
    // millimetres, because a straight hard line across the face is a mask.
    float beardTop = -0.028 - 0.014 * (1.0 - smoothstep(0.015, 0.06, abs(p.x)));
    float jaw = 1.0 - smoothstep(beardTop - 0.008, beardTop + 0.002 + aa, p.y);
    float beard = uBeard * jaw * smoothstep(-0.02, 0.05, p.z);
    float bcomb = 1.0 + 0.18 * sin(p.x * 700.0 + p.y * 240.0) * (1.0 - smoothstep(0.3, 0.8, fwidth(p.x * 700.0)));
    vec3 col = mix(skin, uHair * 0.8 * bcomb, beard);

    // Stubble: a shadow of the hair's colour where a beard would be and
    // over the lip.
    float lipZone = (1.0 - smoothstep(0.03, 0.036, abs(p.x)))
                  * (1.0 - smoothstep(0.007, 0.009, abs(p.y + 0.045)));
    col = mix(col, uHair * 0.7, 0.3 * uTraits.y * max(jaw, lipZone) * smoothstep(-0.02, 0.05, p.z));

    // Freckles over the nose and the tops of the cheeks, fading out where
    // they would be finer than a pixel.
    vec2 fc = p.xy * 260.0;
    vec2 fi = floor(fc);
    float fh = fract(sin(dot(fi, vec2(12.9898, 78.233))) * 43758.5453);
    vec2 fj = vec2(fh, fract(fh * 17.13)) * 0.5 - 0.25;
    float speck = step(0.74, fh) * (1.0 - smoothstep(0.14, 0.26, length(fract(fc) - 0.5 - fj)));
    float field = 1.0 - smoothstep(0.7, 1.0, length(vec2(p.x / 0.075, (p.y + 0.022) / 0.018)));
    float ffine = 1.0 - smoothstep(0.25, 0.6, fwidth(fc.x));
    col = mix(col, skin * vec3(0.8, 0.52, 0.34), 0.7 * uTraits.z * speck * field * ffine * front);

    // Cheeks.
    float cheek = 1.0 - smoothstep(0.0, 0.03, length(vec2(abs(p.x) - 0.066, p.y + 0.03)));
    col = mix(col, col * vec3(1.0, 0.8, 0.76), 0.4 * cheek * front * (1.0 - beard));

    // Eyes: set in a socket, then the white, then the lid over it.
    vec2 e = vec2(abs(p.x) - 0.05, p.y);
    float socket = 1.0 - smoothstep(0.8, 1.9, length((e - vec2(0.0, 0.004)) / vec2(0.027, 0.02)));
    col *= 1.0 - 0.16 * socket * front;
    // Age: a bag line under each eye and crow's feet at the outer corner.
    float bag = abs(length((e + vec2(0.0, 0.002)) / vec2(0.024, 0.02)) - 1.0) * 0.02;
    float bagLine = (1.0 - smoothstep(0.0012, 0.0012 + aa * 1.5, bag)) * smoothstep(0.0, -0.01, e.y)
                  * (1.0 - smoothstep(0.012, 0.02, abs(e.x)));
    vec2 cf = vec2(e.x - 0.028, e.y);
    float cfa = atan(cf.y, cf.x);
    float cfr = length(cf);
    float crow = (1.0 - smoothstep(0.12, 0.2, abs(fract(cfa / 0.45 + 0.5) - 0.5)))
               * smoothstep(0.001, 0.003, cfr) * (1.0 - smoothstep(0.008, 0.011, cfr))
               * (1.0 - smoothstep(0.7, 0.9, abs(cfa)));
    col = mix(col, col * 0.72, 0.8 * uTraits.w * max(bagLine, crow * step(0.0, cf.x)) * front);
    float r = length(e / vec2(0.023, 0.0135));
    float white = 1.0 - smoothstep(1.0 - aa / 0.0135, 1.0 + aa / 0.0135, r);
    col = mix(col, vec3(0.8, 0.77, 0.72), white * front);
    float lidBand = abs(length(e / vec2(0.025, 0.016)) - 1.0) * 0.016;
    float lid = (1.0 - smoothstep(0.0018, 0.0018 + aa * 1.5, lidBand)) * smoothstep(0.0, 0.006, e.y);
    col = mix(col, brow * 0.6, lid * front);

    // Brows: arched, heavier at the inner end.
    float bx = abs(p.x) - 0.052;
    float bt = clamp(bx / 0.03, -1.0, 1.0);
    float by = p.y - 0.029 - 0.005 * (1.0 - bt * bt);
    float thick = 0.0055 - 0.0018 * bt;
    float browMask = (1.0 - smoothstep(0.026, 0.03 + aa, abs(bx)))
                   * (1.0 - smoothstep(thick, thick + aa * 1.5, abs(by)));
    col = mix(col, brow, browMask * front);

    // Mouth: a shallow smile, and a softer lower lip under it. The colour is
    // the skin darkened and pulled towards a fixed rose: on pale skin that is
    // a darker line, on dark skin a warmer, lighter one. The skin darkened
    // alone was black on black, and the darkest faces had no mouth.
    vec3 lip = mix(skin * vec3(0.62, 0.38, 0.36), vec3(0.42, 0.16, 0.15), 0.35);
    // The fold from beside the nose to each corner of the mouth: faint on the
    // young, a line on the old.
    vec2 fa = vec2(0.02, -0.03);
    vec2 fb = vec2(0.033, -0.062);
    vec2 fp = vec2(abs(p.x), p.y) - fa;
    vec2 fd = fb - fa;
    float fold = length(fp - fd * clamp(dot(fp, fd) / dot(fd, fd), 0.0, 1.0));
    float foldLine = 1.0 - smoothstep(0.0015, 0.0045 + aa, fold);
    col = mix(col, col * 0.72, (0.5 + 0.5 * uTraits.w) * foldLine * front * (1.0 - beard));
    // The shadow under the lower lip, where the chin comes forward.
    float under = (1.0 - smoothstep(0.012, 0.02, abs(p.x)))
                * (1.0 - smoothstep(0.0, 0.005, abs(p.y + 0.0705)));
    col = mix(col, col * 0.8, 0.6 * under * front * (1.0 - beard));
    float mx = p.x / 0.028;
    float my = p.y + 0.056 - 0.005 * mx * mx;
    float mw = 1.0 - smoothstep(0.75, 1.0, abs(mx));
    float mouth = mw * (1.0 - smoothstep(0.0028, 0.0028 + aa * 1.5, abs(my)));
    float lower = (1.0 - smoothstep(0.55, 0.8, abs(mx)))
                * (1.0 - smoothstep(0.003, 0.003 + aa * 2.0, abs(my + 0.0065)));
    col = mix(col, mix(skin, vec3(0.6, 0.34, 0.32), 0.35), lower * front * (1.0 - beard));
    col = mix(col, lip, mouth * front);

    // A moustache: wider than the mouth and drooping past its corners, full
    // in the middle and tapering to the ends. A short block under the nose is
    // a shape with its own history, and one curving up reads as a grin.
    float tx = p.x / 0.036;
    float my2 = p.y + 0.0445 + 0.006 * tx * tx;
    float th = 0.0068 * (1.0 - 0.45 * tx * tx);
    float tache = (1.0 - smoothstep(0.92, 1.0, abs(tx)))
                * (1.0 - smoothstep(th, th + aa * 1.5, abs(my2)));
    float comb = 1.0 + 0.22 * sin(p.x * 900.0 + my2 * 300.0) * (1.0 - smoothstep(0.3, 0.8, fwidth(p.x * 900.0)));
    col = mix(col, uHair * mix(0.55, 0.85, smoothstep(-th, th, my2)) * comb, uTraits.x * tache * front);

    diffuseColor.rgb = col;
  }
`;

/**
 * The hair's strands: fine stripes running from a whorl behind the crown down
 * to the hem, curling a little as they leave it, so a shell of one colour
 * reads as hair lying in a direction rather than as a painted helmet. Every
 * strand has a shade of its own, the strands lie together in locks with a
 * shadowed gap between one lock and the next, and `HAIR_BUMP_GLSL` raises the
 * same strands in relief. The stripes wander a little along their length and
 * fade out wherever they would be finer than a pixel. From the manager camera the top of the head is most
 * of what a player sees of a settler, so the stripes are coarse and strong
 * enough to survive at twenty pixels, and a parted cut draws its parting: a
 * dark line from the hairline back to the crown, on the middle for the long
 * cut and off to one side for the swept one.
 */
const HAIR_GLSL = /* glsl */ `
  {
    vec3 q = vHairPos;
    // The whorl sits behind the crown, where hair grows from, not on top.
    // Every angular term is a whole multiple of a, so the seam at the back
    // of the head, where a wraps, draws nothing.
    float a = atan(q.x, q.z + 0.1);
    float s = a * 48.0 + sin(a * 5.0 + q.y * 30.0) * 1.4 + q.y * 12.0 * uSweep + length(q.xz + vec2(0.0, 0.1)) * 70.0;
    float fine = 1.0 - smoothstep(0.35, 1.0, fwidth(s));
    // Each strand has its own shade and its own lie: the id wraps with a, so
    // the strands either side of the seam are the same strand.
    float id = mod(floor(s / 6.2832), 48.0);
    float h1 = fract(sin(id * 12.9898) * 43758.5453);
    float h2 = fract(sin(id * 78.233) * 12543.123);
    float strand = sin(s + h2 * 2.0) * 0.4 + sin(s * 2.3 + 1.7 + h1 * 3.0) * 0.2 + (h1 - 0.5) * 0.5;
    diffuseColor.rgb *= 1.0 + strand * 0.3 * fine;
    // Locks: strands lie together four at a time, each lock a shade of its
    // own, with a shadowed gap where one lock parts from the next.
    float c = s / 25.1327;
    float lid = mod(floor(c), 12.0);
    float lf = fract(c);
    float lh = fract(sin(lid * 39.346 + 11.0) * 24634.634);
    float lockFine = 1.0 - smoothstep(0.08, 0.3, fwidth(c));
    float gap = 1.0 - smoothstep(0.0, 0.18, min(lf, 1.0 - lf));
    diffuseColor.rgb *= 1.0 + (lh - 0.5) * 0.22 - 0.2 * gap * lockFine;
    // The same strands and gaps as relief, in metres, for the normal below.
    hairH = (sin(s) * 0.5 * fine - gap * lockFine) * 0.0012;
    // Sheen: the band round the head where hair catches the light, broken up
    // by the strands. Lifted rather than scaled, or black hair would have none.
    float sheen = exp(-pow((q.y - 0.105) / 0.022, 2.0)) * (0.55 + 0.45 * strand) * fine;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.45 + 0.035, 0.45 * sheen);

    float pa = max(fwidth(q.x), 1e-5);
    float parting = (1.0 - smoothstep(0.0035, 0.0035 + pa * 1.5, abs(q.x - uPart.x)))
                  * smoothstep(0.05, 0.09, q.y) * smoothstep(-0.05, 0.02, q.z);
    diffuseColor.rgb *= 1.0 - 0.5 * uPart.y * parting;
  }
`;

/**
 * The strands in relief: the height the colour block left in `hairH` tilts the
 * normal, as a bump map would, so the light catches each lock's ridge and the
 * gaps between them fall into shade. Three's own bump code only compiles with
 * a bump texture, so its screen-space derivative form is written out here.
 */
const HAIR_BUMP_GLSL = /* glsl */ `
  {
    vec3 hp = -vViewPosition;
    vec3 dPdx = dFdx(hp);
    vec3 dPdy = dFdy(hp);
    vec3 r1 = cross(dPdy, normal);
    vec3 r2 = cross(normal, dPdx);
    float det = dot(dPdx, r1) * faceDirection;
    vec3 grad = sign(det) * (dFdx(hairH) * r1 + dFdy(hairH) * r2);
    normal = normalize(abs(det) * normal - grad);
  }
`;

/** One program for every face and one for every head of hair, whatever the colours. */
const FACE_KEY = 'settler-face';
const HAIR_KEY = 'settler-hair';

/** A settler's own marks on the face, each nought or one. */
export interface FaceTraits {
  beard: number;
  moustache: number;
  stubble: number;
  freckles: number;
  /** The lines of age: on the grey-haired. */
  age: number;
}

export const NO_TRAITS: FaceTraits = { beard: 0, moustache: 0, stubble: 0, freckles: 0, age: 0 };

/**
 * Which marks a seed has. The facial hair is dealt from bits sixteen and
 * seventeen as the beard always was, so every bearded settler keeps the beard;
 * of the three in four who had none, bit eighteen gives one in eight a
 * moustache and one in eight stubble. Freckles are one in five, from a hash
 * of the whole seed (it is twenty bits, and the top bits alone would give
 * them to half the colony). Age is the hair: `grey` is whether it has gone white.
 */
export function faceTraitsOf(colorSeed: number, grey: boolean): FaceTraits {
  const facial = (colorSeed >> 16) & 3;
  const alt = (colorSeed >> 18) & 1;
  return {
    beard: facial === 1 ? 0.85 : 0,
    moustache: facial === 2 && alt === 1 ? 1 : 0,
    stubble: facial === 3 && alt === 1 ? 1 : 0,
    freckles: (Math.imul(colorSeed ^ 0x5bd1e995, 0x85ebca6b) >>> 16) % 5 === 0 ? 1 : 0,
    age: grey ? 1 : 0,
  };
}

/**
 * The skin of a settler's head, with the face on it. `hair` colours the brows
 * and any facial hair; `traits` are the settler's own marks.
 */
export function faceMaterial(skin: THREE.Color, hair: THREE.Color, traits: FaceTraits = NO_TRAITS): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62 });
  const uHair = { value: hair.clone() };
  const uBeard = { value: traits.beard };
  const uTraits = { value: new THREE.Vector4(traits.moustache, traits.stubble, traits.freckles, traits.age) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHair = uHair;
    shader.uniforms.uBeard = uBeard;
    shader.uniforms.uTraits = uTraits;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vFacePos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'varying vec3 vFacePos;\nuniform vec3 uHair;\nuniform float uBeard;\nuniform vec4 uTraits;\nvoid main() {',
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACE_GLSL}`);
  };
  mat.customProgramCacheKey = () => FACE_KEY;
  mat.userData.face = { hair: uHair, beard: uBeard, traits: uTraits };
  return mat;
}

/**
 * A settler's hair: the colour, the strands, and the darker ends `makeHair`
 * bakes into the vertex colours. `sweep` leans the strands across the head, for
 * the styles that are combed to one side; `part` is where across the head a
 * parting runs, in metres of the head's frame, or null for a cut without one.
 */
export function hairMaterial(hair: THREE.Color, sweep: number, part: number | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.82, vertexColors: true });
  const uSweep = { value: sweep };
  const uPart = { value: new THREE.Vector2(part ?? 0, part === null ? 0 : 1) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSweep = uSweep;
    shader.uniforms.uPart = uPart;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vHairPos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec3 vHairPos;\nuniform float uSweep;\nuniform vec2 uPart;\nvoid main() {\nfloat hairH = 0.0;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${HAIR_GLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${HAIR_BUMP_GLSL}`);
  };
  mat.customProgramCacheKey = () => HAIR_KEY;
  mat.userData.hair = { sweep: uSweep, part: uPart };
  return mat;
}

/**
 * The eye, painted on its own bead. A black bead with a glint is a button: it
 * stares, and from the manager camera, which looks down on it, it is a black
 * ball standing out under the fringe. This paints an eyeball on it, in the
 * bead's own frame (which faces +Z like the head's), measured on the bead as a
 * unit sphere:
 *
 *  - an iris in the settler's eye colour, with a darker ring round its edge and
 *    a pupil in the middle;
 *  - the white of the eye everywhere else on the bead, so the bead joins the
 *    whites the face paints round it instead of sitting on them;
 *  - an upper lid in the skin's colour over the top of the bead, with a dark
 *    lash line along its edge. The lid covers the top of the iris, as a lid
 *    does, and it is also what the camera sees from above: skin with a line on
 *    it, not a black ball.
 *
 * Since r32 the bead is a shallow lens turned outward and down along the
 * skull's normal (`EYE_SEAT` in `pawns.ts`), with the left one mirrored. An
 * iris painted in the middle of it would look out and down with it, so the
 * iris sits towards the nose and a little up, and the lid line is raised to
 * match.
 */
const EYE_GLSL = /* glsl */ `
  {
    vec3 n = vEyePos / uEyeSize;
    float ea = max(fwidth(n.x), 1e-4);
    float r = length(n.xy - vec2(-0.2, 0.1));
    float facing = smoothstep(0.0, 0.25, n.z);
    vec3 col = vec3(0.8, 0.77, 0.72);
    float iris = (1.0 - smoothstep(0.62 - ea, 0.62 + ea, r)) * facing;
    vec3 irisCol = mix(uIris, uIris * 0.45, smoothstep(0.4, 0.62, r));
    col = mix(col, irisCol, iris);
    float pupil = (1.0 - smoothstep(0.27 - ea, 0.27 + ea, r)) * facing;
    col = mix(col, vec3(0.012, 0.01, 0.01), pupil);
    float lid = smoothstep(0.52 - ea, 0.52 + ea, n.y);
    float lash = (1.0 - smoothstep(0.07, 0.07 + ea * 1.5, abs(n.y - 0.52)));
    col = mix(col, uLid, lid);
    col = mix(col, uLash, lash);
    diffuseColor.rgb = col;
  }
`;

const EYE_KEY = 'settler-eye';

/**
 * The eye colours a settler can have, weighted: brown twice and dark brown
 * twice, then hazel, grey and green once each.
 */
export const IRIS_TONES = [0x5b3a22, 0x5b3a22, 0x2e1c10, 0x2e1c10, 0x6f5b2c, 0x5d6f7c, 0x4d6440] as const;

/** Which of `IRIS_TONES` a seed has: a hash of the whole seed, so it is not tied to any other colour. */
export function irisOf(colorSeed: number): number {
  return IRIS_TONES[(Math.imul(colorSeed, 0x9e3779b1) >>> 16) % IRIS_TONES.length]!;
}

/**
 * The eye bead's material. `size` is the bead's own semi-axes, `lid` the skin it
 * is set in and `lash` the colour of the lid's edge.
 */
export function eyeMaterial(size: THREE.Vector3, iris: THREE.Color, lid: THREE.Color, lash: THREE.Color): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const uniforms = {
    uEyeSize: { value: size.clone() },
    uIris: { value: iris.clone() },
    uLid: { value: lid.clone() },
    uLash: { value: lash.clone() },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vEyePos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'varying vec3 vEyePos;\nuniform vec3 uEyeSize;\nuniform vec3 uIris;\nuniform vec3 uLid;\nuniform vec3 uLash;\nvoid main() {',
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${EYE_GLSL}`);
  };
  mat.customProgramCacheKey = () => EYE_KEY;
  mat.userData.eye = uniforms;
  return mat;
}
