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
 */
const FACE_GLSL = /* glsl */ `
  {
    vec3 p = vFacePos - vec3(0.0, ${glslFloat(EYE_Y)}, 0.0);
    float aa = max(fwidth(p.y), 1e-5);
    float front = smoothstep(0.05, 0.09, p.z);
    vec3 skin = diffuseColor.rgb;
    vec3 brow = mix(uHair, vec3(0.02, 0.015, 0.012), 0.35);

    // Beard: below the cheekbones on the front and round the jaw.
    float jaw = 1.0 - smoothstep(-0.036 - aa, -0.024 + aa, p.y);
    float beard = uBeard * jaw * smoothstep(-0.02, 0.05, p.z);
    vec3 col = mix(skin, uHair * 0.8, beard);

    // Cheeks.
    float cheek = 1.0 - smoothstep(0.0, 0.03, length(vec2(abs(p.x) - 0.066, p.y + 0.03)));
    col = mix(col, col * vec3(1.0, 0.8, 0.76), 0.4 * cheek * front * (1.0 - beard));

    // Eyes: the white, then the lid over it.
    vec2 e = vec2(abs(p.x) - 0.05, p.y);
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

    // Mouth: a shallow smile.
    float mx = p.x / 0.028;
    float my = p.y + 0.056 - 0.005 * mx * mx;
    float mouth = (1.0 - smoothstep(0.75, 1.0, abs(mx)))
                * (1.0 - smoothstep(0.0028, 0.0028 + aa * 1.5, abs(my)));
    col = mix(col, skin * vec3(0.55, 0.34, 0.33), mouth * front);

    diffuseColor.rgb = col;
  }
`;

/**
 * The hair's strands: fine stripes running from the crown down to the hem,
 * each a shade darker or lighter than the colour, so a shell of one colour
 * reads as hair lying in a direction rather than as a painted helmet. The
 * stripes wander a little along their length and fade out wherever they would
 * be finer than a pixel. From the manager camera the top of the head is most
 * of what a player sees of a settler, so the stripes are coarse and strong
 * enough to survive at twenty pixels, and a parted cut draws its parting: a
 * dark line from the hairline back to the crown, on the middle for the long
 * cut and off to one side for the swept one.
 */
const HAIR_GLSL = /* glsl */ `
  {
    vec3 q = vHairPos;
    float a = atan(q.x, q.z);
    float s = a * 30.0 + sin(a * 5.0 + q.y * 30.0) * 1.4 + q.y * 12.0 * uSweep;
    float fine = 1.0 - smoothstep(0.35, 1.0, fwidth(s));
    float strand = sin(s) * 0.5 + sin(s * 2.3 + 1.7) * 0.25;
    diffuseColor.rgb *= 1.0 + strand * 0.26 * fine;

    float pa = max(fwidth(q.x), 1e-5);
    float parting = (1.0 - smoothstep(0.0035, 0.0035 + pa * 1.5, abs(q.x - uPart.x)))
                  * smoothstep(0.05, 0.09, q.y) * smoothstep(-0.05, 0.02, q.z);
    diffuseColor.rgb *= 1.0 - 0.5 * uPart.y * parting;
  }
`;

/** One program for every face and one for every head of hair, whatever the colours. */
const FACE_KEY = 'settler-face';
const HAIR_KEY = 'settler-hair';

/**
 * The skin of a settler's head, with the face on it. `hair` colours the brows
 * and any beard; `beard` is how much of one, nought to one.
 */
export function faceMaterial(skin: THREE.Color, hair: THREE.Color, beard: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62 });
  const uHair = { value: hair.clone() };
  const uBeard = { value: beard };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHair = uHair;
    shader.uniforms.uBeard = uBeard;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vFacePos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec3 vFacePos;\nuniform vec3 uHair;\nuniform float uBeard;\nvoid main() {')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACE_GLSL}`);
  };
  mat.customProgramCacheKey = () => FACE_KEY;
  mat.userData.face = { hair: uHair, beard: uBeard };
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
      .replace('void main() {', 'varying vec3 vHairPos;\nuniform float uSweep;\nuniform vec2 uPart;\nvoid main() {')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${HAIR_GLSL}`);
  };
  mat.customProgramCacheKey = () => HAIR_KEY;
  mat.userData.hair = { sweep: uSweep, part: uPart };
  return mat;
}
