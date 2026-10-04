// size2x2.js — the 2x2 implementation of the SizeModule interface.
//
// A SizeModule is everything the size-agnostic UI needs to drive one cube size:
// its facelet layout, scan grid, color scheme, validator, and solver. Adding a
// 3x3 later means writing another module with the same shape and registering it
// (see sizes/index.js) — no UI rewrite.

import {
  FACE_ORDER,
  COLORS,
  FACES as GEOM_FACES,
  quartersForMove,
} from '../core/geometry.js';
import {
  SOLVED,
  applyMove,
  geomFromState,
  stateFromGeom,
} from '../core/cube2.js';
import {
  faceColorsFromState,
  validateFaces,
  geomFromFaces,
  SOLVED_FACES,
  MIRROR_NOTE,
  N,
} from '../core/facelet.js';
import { solve as solveState } from '../core/solver2.js';
import {
  isMirror2,
  reflectXGeom,
  alignGeom,
  alignRotation,
  findMove,
} from '../core/mirror2.js';
import { buildScanSequence } from './scanpath.js';
import { makeCaptureCheck } from './capturecheck.js';

// Palette (mirrors DESIGN.md). Used for the 3D stickers, the correction grid,
// and camera color classification.
export const COLOR_HEX = {
  W: '#F4F6F8',
  Y: '#F5C518',
  G: '#2EC27E',
  B: '#2B7FFF',
  R: '#E5484D',
  O: '#F2792B',
};
export const COLOR_NAMES = {
  W: 'White',
  Y: 'Yellow',
  G: 'Green',
  B: 'Blue',
  R: 'Red',
  O: 'Orange',
};
// Which scheme color each face is when solved (for scan guidance).
export const FACE_COLOR = {};
for (const f of FACE_ORDER) FACE_COLOR[f] = SOLVED_FACES[f][0];

const FACE_LABELS = {
  U: 'Up',
  R: 'Right',
  F: 'Front',
  D: 'Down',
  L: 'Left',
  B: 'Back',
};

// ---- camera color classification (HSV / hue-based) -------------------------
//
// Absolute RGB proximity to fixed reference colors is fragile: a warm or cool
// white balance shifts every channel, and the scheme's warm colors (white /
// yellow / orange / red) sit close in RGB, so a naive nearest-RGB read flips
// between them under ordinary phone lighting. Hue is far more stable — it barely
// moves when the whole frame warms or cools — so we classify in HSV instead:
//
//   • White is the only ACHROMATIC scheme color, so it is detected by LOW
//     saturation + adequate VALUE (brightness), never by RGB proximity. A dim,
//     low-saturation grey is still "nearest White" but reports low confidence.
//   • The five chromatic colors (Yellow, Orange, Red, Green, Blue) are matched
//     to the nearest HUE band. Red / Orange / Yellow are close in hue and Red
//     wraps around 0°/360°, so distances are measured on the hue circle.
//
// Hue reference angles (degrees) derived from the scheme hexes in COLOR_HEX:
//   Red ≈ 358°, Orange ≈ 24°, Yellow ≈ 47°, Green ≈ 152°, Blue ≈ 216°.
const HUE_REF = { R: 358, O: 24, Y: 47, G: 152, B: 216 };

// Saturation below this reads as achromatic → White. The scheme's chromatic
// colors stay well above this even when dim or lightly tinted; a warm/cool
// white stays below it.
const S_WHITE = 0.2;
// White must be at least this bright to be a confident white (vs a mid grey).
const V_WHITE_FLOOR = 0.45;
const V_WHITE_SPAN = 0.4; // value at which white confidence saturates ≈ 0.85

function rgbToHsv([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

// Shortest distance between two hues on the 0–360 circle.
function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Classify a sample AND report how sure we are. `confidence` is a normalized
// 0..1 margin, kept comparable across colors so the existing recheck flags work
// unchanged:
//   • chromatic: the hue-circle margin between the nearest and second-nearest
//     band, (d2 - d1) / (d1 + d2) — ~1 sits squarely on one hue, ~0 is a
//     coin-flip between two adjacent hues (the warm colors, typically);
//   • White: how clearly achromatic (saturation below S_WHITE) AND bright the
//     sample is — a dim grey lands near White but reports low confidence.
// Purely a hint: correction is always available and nothing downstream trusts it.
export function classifyColorDetailed(rgb) {
  const { h, s, v } = rgbToHsv(rgb);

  if (s < S_WHITE) {
    // Achromatic → White. Confident when saturation is well under the boundary
    // and the sample is bright; a mid-value grey stays low-confidence.
    const satMargin = clamp01((S_WHITE - s) / S_WHITE);
    const valMargin = clamp01((v - V_WHITE_FLOOR) / V_WHITE_SPAN);
    return { color: 'W', confidence: satMargin * valMargin };
  }

  // Chromatic → nearest hue band, measured on the hue circle.
  let best = 'R';
  let d1 = Infinity;
  let d2 = Infinity;
  for (const c of Object.keys(HUE_REF)) {
    const d = hueDist(h, HUE_REF[c]);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      best = c;
    } else if (d < d2) {
      d2 = d;
    }
  }
  const confidence = d1 + d2 === 0 ? 1 : (d2 - d1) / (d1 + d2);
  return { color: best, confidence };
}

// Below this normalized margin a scan sample is "low confidence" — either two
// hue bands are near enough that the read could go either way, or a would-be
// White is a dim/borderline grey — so the UI flags it for a recheck. Tunable;
// a hint, never a hard gate.
export const CONFIDENCE_THRESHOLD = 0.2;

// Classify an [r,g,b] sample to the nearest scheme color. Correction is always
// available, so this only needs to be close. Kept returning a plain letter for
// back-compat; opt into the margin with classifyColorDetailed.
export function classifyColor(rgb) {
  return classifyColorDetailed(rgb).color;
}

// Human-readable hint for a move name like "R", "U'", "F2".
export function moveHint(name) {
  const face = name[0];
  const suffix = name.slice(1);
  const dir =
    suffix === "'" ? 'counter-clockwise' : suffix === '2' ? '180°' : 'clockwise';
  return `${name} — ${FACE_LABELS[face].toLowerCase()} face ${dir}`;
}

// Convert a move name into the geometric turn the renderer animates.
export function moveToTurn(name) {
  const face = name[0];
  const times = name[1] === "'" ? -1 : name[1] === '2' ? 2 : 1;
  const { axis, sign } = GEOM_FACES[face];
  return { axis, sign, quarters: quartersForMove(face, times), times };
}

// ---- scan sequence: the size's own scan path -------------------------------
//
// The scan sequence orders the six faces so that each consecutive step differs
// from the previous one by exactly ONE simple whole-cube turn — a 90° yaw or a
// 90° tilt — expressed in the camera's frame (+x right, +y up, +z toward the
// camera), signed by the right-hand rule about the positive axis. The guide
// cube animates that exact turn, and the label/instruction below are derived
// from the same turn spec, so the motion and the words can never disagree.
//
// A future 3×3 module defines its own scanSequence with the same shape; the UI
// and the 3D guide consume it from whichever module is active.
const YAW_LEFT_90 = { axis: 'y', deg: -90 };
const TILT_FWD_90 = { axis: 'x', deg: 90 };

// Turn a spec into a short technical label + plain-language instruction.
// `mirror` swaps left/right so the wording and the on-screen arrow match a
// mirrored (selfie) camera preview, where the world reads reversed.
//
// The words say where the next face IS right now (on the right, on top), never
// its name: once the path has tilted, the Left face can arrive from the right.
export function describeScanStep(turn, face, { mirror = false, centers = true } = {}) {
  if (!turn) {
    // A scrambled cube has no solid "white face", so we can't say "white on top".
    // A 3x3's CENTER squares never move, so they anchor the start even scrambled;
    // a 2x2 has no centers, so any starting orientation works — the app figures
    // out the rest.
    if (centers) {
      const up = COLOR_NAMES[FACE_COLOR.U];
      const front = COLOR_NAMES[FACE_COLOR.F];
      return {
        label: 'START',
        text: `Put the ${up}-center face on top and the ${front}-center face toward the camera. Go by the center squares — they never move, even scrambled. Keep that grip and follow each turn.`,
      };
    }
    return {
      label: 'START',
      text: `Hold the cube in any comfortable orientation and keep that exact grip — just follow each turn. Solvent works out the orientation from the cube itself.`,
    };
  }
  const amount = Math.abs(turn.deg);
  if (amount === 180) {
    return {
      label: 'HALF TURN · 180°',
      text: 'Turn the whole cube a full half-turn — the face at the back comes round to the camera.',
    };
  }
  if (turn.axis === 'y') {
    let left = turn.deg < 0;
    if (mirror) left = !left;
    const dir = left ? 'left' : 'right';
    const from = left ? 'right' : 'left';
    return {
      label: `TURN ${dir.toUpperCase()} · ${amount}°`,
      text: `Turn the whole cube ${amount}° to the ${dir} — the face on the ${from} swings around to the camera.`,
    };
  }
  const fwd = turn.deg > 0;
  return {
    label: `TILT ${fwd ? 'FORWARD' : 'BACK'} · ${amount}°`,
    text: fwd
      ? `Tip the cube ${amount}° forward, top toward the camera — the face on top rolls down into view.`
      : `Tip the cube ${amount}° back — the face underneath rolls up into view.`,
  };
}

// Every turn is a single 90° quarter turn — the motion people do most exactly:
// left, left, tip forward, left, left, showing F, R, B, U, L, D. After the tip the
// cube lies on its side, and L then D come round from the right like the others.
// No half-turn flip anywhere (SOLV-20).
export const SCAN_STEPS = [
  { face: 'F', turn: null },
  { face: 'R', turn: YAW_LEFT_90 },
  { face: 'B', turn: YAW_LEFT_90 },
  { face: 'U', turn: TILT_FWD_90 },
  { face: 'L', turn: YAW_LEFT_90 },
  { face: 'D', turn: YAW_LEFT_90 },
];

// Each step also carries `cameraToFacelet`, derived from the geometry oracle (see
// scanpath.js): where each camera cell lands on the facelet grid. Faces shown
// before the tip read straight across; after it the cube lies on its side, so
// some faces (U and L on this path) arrive rotated in the camera's view and the
// capture must re-seat them. Building the mapping throws at module load if a
// step ever stops presenting its face.
export const SCAN_SEQUENCE = buildScanSequence(SCAN_STEPS, {
  faceOrder: FACE_ORDER,
  gridN: N,
  geomFromFaces,
}).map((s) => ({ ...s, ...describeScanStep(s.turn, s.face) }));

// Does a just-captured face fit with the faces already captured? (capturecheck.js)
const checkCapture = makeCaptureCheck({
  faceOrder: FACE_ORDER,
  gridN: N,
  geomFromFaces,
  scanSequence: SCAN_SEQUENCE,
  hasCenters: false,
  faceLabels: FACE_LABELS,
  colorNames: COLOR_NAMES,
});

function emptyFaces() {
  const f = {};
  for (const face of FACE_ORDER) f[face] = new Array(N * N).fill(null);
  return f;
}

// Carry a solution computed in the solver's frame back onto the cube as the user
// holds it: map every frame through `align` (fixed for the whole solution) and
// read each physical move straight off consecutive frames, so the move names can
// never disagree with the animation.
function inUserFrame(canon, userGeom, align) {
  // validate() guarantees a real cube, so alignment and every move lookup succeed;
  // if that ever breaks, fail with words rather than a TypeError at Solve.
  const toUser = align(canon[0], userGeom);
  if (!toUser) throw new Error('This cube does not match a real 2×2 — recheck the stickers.');
  const frames = canon.map(toUser);
  const names = [];
  for (let k = 0; k < frames.length - 1; k++) {
    const name = findMove(frames[k], frames[k + 1]);
    if (!name) throw new Error('Could not read a face turn off the solution — recheck the stickers.');
    names.push(name);
  }
  return { frames, names };
}

// Solve from a validated faces object. Returns everything the UI needs:
//   moves: [{ name, hint }]
//   frames: geometry after each step, starting from the cube EXACTLY as scanned
//   normalizedGeom: frames[0]
//
// The solver works in its own frame: it rotates the cube so a reference corner
// sits still (see solver2.js), and a mirror-scheme cube is reflected first (the
// compact state can't encode handedness; see core/mirror2.js). Both are undone
// here — a rotation for a standard cube, an isometry + colour map for a mirror
// one — so the solution starts in the grip the user scanned with, not one they
// would have to find by eye on a scrambled cube.
function solve(faces) {
  const v = validateFaces(faces);
  if (!v.ok) throw new Error('invalid cube: ' + v.errors.join(' '));
  const userGeom = geomFromFaces(faces);
  const mirror = isMirror2(userGeom);
  const start = stateFromGeom(mirror ? reflectXGeom(userGeom) : userGeom);
  const { normalized, moves } = solveState(start);
  const canon = [geomFromState(normalized)];
  let s = normalized;
  for (const m of moves) {
    s = applyMove(s, m);
    canon.push(geomFromState(s));
  }
  const { frames, names } = inUserFrame(canon, userGeom, mirror ? alignGeom : alignRotation);
  return {
    moves: names.map((name) => ({ name, hint: moveHint(name) })),
    frames,
    normalizedGeom: frames[0],
    // A 2x2 has no centers to name a face by: the grip is "as you held it for the
    // first scan", which the UI shows as the scanned front and top faces.
    hold: null,
    faceColors: null,
    mirror,
    warning: mirror ? MIRROR_NOTE : null,
  };
}

export const size2x2 = {
  id: '2x2',
  name: '2×2',
  gridN: N, // stickers per face edge for scanning + correction
  cubiesPerEdge: 2, // for the 3D renderer
  hasCenters: false, // a 2x2 has no fixed centers to anchor the scan start
  faceOrder: FACE_ORDER,
  colors: COLORS,
  colorHex: COLOR_HEX,
  colorNames: COLOR_NAMES,
  faceLabels: FACE_LABELS,
  faceColor: FACE_COLOR,
  solvedFaces: SOLVED_FACES,
  // Scan path for this size: ordered faces, each one whole-cube turn apart.
  scanSequence: SCAN_SEQUENCE,
  describeScanStep,
  checkCapture,
  // faces (possibly incomplete) -> geometry in the first scan's frame; drives the
  // guide cube's colours
  facesToGeom: geomFromFaces,
  emptyFaces,
  validate: validateFaces,
  classifyColor,
  classifyColorDetailed,
  confidenceThreshold: CONFIDENCE_THRESHOLD,
  moveToTurn,
  solve,
  // exposed for tests / renderer
  faceColorsFromState,
  geomFromState,
  SOLVED_STATE: SOLVED,
};

export default size2x2;
