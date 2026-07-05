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

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const REF_RGB = Object.fromEntries(COLORS.map((c) => [c, hexToRgb(COLOR_HEX[c])]));

// Classify an [r,g,b] sample to the nearest scheme color. Correction is always
// available, so this only needs to be close; we bias by hue to separate the
// warm colors (white/yellow/orange/red) that trip up naive RGB distance.
export function classifyColor([r, g, b]) {
  let best = 'W';
  let bestD = Infinity;
  for (const c of COLORS) {
    const [rr, gg, bb] = REF_RGB[c];
    // weight green channel a little more; it discriminates G/Y/O/R well
    const d = (r - rr) ** 2 + 1.3 * (g - gg) ** 2 + (b - bb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
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
  emptyFaces,
  validate: validateFaces,
  classifyColor,
  moveToTurn,
  solve,
  // exposed for tests / renderer
  faceColorsFromState,
  geomFromState,
  SOLVED_STATE: SOLVED,
};

export default size2x2;
