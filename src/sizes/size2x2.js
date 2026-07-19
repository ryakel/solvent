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
  rotateVec,
} from '../core/geometry.js';
import {
  SOLVED,
  applyMove,
  geomFromState,
} from '../core/cube2.js';
import {
  faceColorsFromState,
  stateFromFaces,
  validateFaces,
  SOLVED_FACES,
  N,
} from '../core/facelet.js';
import { solve as solveState } from '../core/solver2.js';

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
// 90°/180° tilt — expressed in the camera's frame (+x right, +y up, +z toward
// the camera), signed by the right-hand rule about the positive axis. The guide
// cube animates that exact turn, and the label/instruction below are derived
// from the same turn spec, so the motion and the words can never disagree.
//
// A future 3×3 module defines its own scanSequence with the same shape; the UI
// and the 3D guide consume it from whichever module is active.
const YAW_LEFT_90 = { axis: 'y', deg: -90 };
const TILT_FWD_90 = { axis: 'x', deg: 90 };
const TILT_FWD_180 = { axis: 'x', deg: 180 };

const FACE_WORDS = { U: 'top', D: 'bottom', F: 'front', B: 'back', R: 'right', L: 'left' };

// Turn a spec into a short technical label + plain-language instruction.
// `mirror` swaps left/right so the wording and the on-screen arrow match a
// mirrored (selfie) camera preview, where the world reads reversed.
export function describeScanStep(turn, face, { mirror = false } = {}) {
  const word = FACE_WORDS[face];
  if (!turn) {
    const up = COLOR_NAMES[FACE_COLOR.U];
    const front = COLOR_NAMES[FACE_COLOR.F];
    return {
      label: 'START',
      text: `Hold the cube with ${up} on top and ${front} toward the camera.`,
    };
  }
  const amount = Math.abs(turn.deg);
  if (turn.axis === 'y') {
    let left = turn.deg < 0;
    if (mirror) left = !left;
    const dir = left ? 'left' : 'right';
    return {
      label: `TURN ${dir.toUpperCase()} · ${amount}°`,
      text: `Turn the whole cube ${amount}° to the ${dir} — the ${word} face swings around to the camera.`,
    };
  }
  if (amount === 180) {
    return {
      label: 'FLIP FORWARD · 180°',
      text: `Keep tipping forward — a full half-turn — so the ${word} face rolls up to the camera.`,
    };
  }
  const fwd = turn.deg > 0;
  return {
    label: `TILT ${fwd ? 'FORWARD' : 'BACK'} · ${amount}°`,
    text: fwd
      ? `Tip the cube ${amount}° forward, top toward the camera — the ${word} face rolls down into view.`
      : `Tip the cube ${amount}° back — the ${word} face rolls into view.`,
  };
}

// F → R → B → L  (three 90° left yaws around the sides),
// then U (tilt forward 90°), then D (keep tipping — a 180° flip).
const SCAN_STEPS = [
  { face: 'F', turn: null },
  { face: 'R', turn: YAW_LEFT_90 },
  { face: 'B', turn: YAW_LEFT_90 },
  { face: 'L', turn: YAW_LEFT_90 },
  { face: 'U', turn: TILT_FWD_90 },
  { face: 'D', turn: TILT_FWD_180 },
];

export const SCAN_SEQUENCE = SCAN_STEPS.map((s) => ({
  ...s,
  ...describeScanStep(s.turn, s.face),
}));

// Self-check with exact integer math (geometry.js is the oracle): accumulating
// the declared turns must present each step's face to the camera (+z). Throws at
// module load if the sequence and the turns ever drift apart.
(function verifyScanSequence() {
  const AXIS_INDEX = { x: 0, y: 1, z: 2 };
  const world = {};
  for (const [f, spec] of Object.entries(GEOM_FACES)) {
    const v = [0, 0, 0];
    v[spec.axis] = spec.sign;
    world[f] = v;
  }
  for (const step of SCAN_STEPS) {
    if (step.turn) {
      const quarters = Math.round(step.turn.deg / 90);
      for (const f of Object.keys(world)) {
        world[f] = rotateVec(world[f], AXIS_INDEX[step.turn.axis], quarters);
      }
    }
    const w = world[step.face];
    if (!(w[0] === 0 && w[1] === 0 && w[2] === 1)) {
      throw new Error(`scan sequence broken: step ${step.face} does not face the camera`);
    }
  }
})();

function emptyFaces() {
  const f = {};
  for (const face of FACE_ORDER) f[face] = new Array(N * N).fill(null);
  return f;
}

// Solve from a validated faces object. Returns everything the UI needs:
//   moves: [{ name, hint }]
//   frames: geometry after each step, starting from the normalized scramble
//   normalizedGeom: the scramble as rendered (reference corner fixed)
function solve(faces) {
  const raw = stateFromFaces(faces);
  const { normalized, moves } = solveState(raw);
  const frames = [geomFromState(normalized)];
  let s = normalized;
  for (const m of moves) {
    s = applyMove(s, m);
    frames.push(geomFromState(s));
  }
  return {
    moves: moves.map((name) => ({ name, hint: moveHint(name) })),
    frames,
    normalizedGeom: frames[0],
    // A 2x2 has no centers to name a face by, so the on-screen cube is the only
    // orientation anchor: the UI tells the user to match their cube to the screen.
    hold: null,
    faceColors: null,
  };
}

export const size2x2 = {
  id: '2x2',
  name: '2×2',
  gridN: N, // stickers per face edge for scanning + correction
  cubiesPerEdge: 2, // for the 3D renderer
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
