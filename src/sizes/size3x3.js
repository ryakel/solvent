// size3x3.js — the 3x3 implementation of the SizeModule interface.
//
// Same shape as size2x2 (see sizes/index.js). The size-agnostic UI drives this
// module identically: it scans a gridN x gridN grid, renders a cubiesPerEdge^3
// cube, validates, solves, and animates the returned frames.
//
// The genuinely size-agnostic pieces — the color palette, the camera color
// classifier, the whole-cube scan path, the per-move turn spec, and the move
// hint text — are IMPORTED from size2x2 rather than forked, so both sizes share
// one source of truth and 2x2 behavior is untouched. Only the 3x3-specific parts
// (grid size, facelet layout, validator, solver) live here.

import { FACE_ORDER, COLORS } from '../core/geometry.js';
import { SOLVED, applyMove, geomFromState3 } from '../core/cube3.js';
import {
  faceColorsFromState,
  stateFromFaces,
  validateFaces,
  SOLVED_FACES,
  N,
} from '../core/facelet3.js';
import { solve as solveState } from '../core/solver3.js';
import {
  COLOR_HEX,
  COLOR_NAMES,
  classifyColor,
  classifyColorDetailed,
  CONFIDENCE_THRESHOLD,
  moveHint,
  moveToTurn,
  describeScanStep,
  SCAN_SEQUENCE,
} from './size2x2.js';

const FACE_LABELS = {
  U: 'Up',
  R: 'Right',
  F: 'Front',
  D: 'Down',
  L: 'Left',
  B: 'Back',
};

// Which scheme color each face is when solved (its center) — for scan guidance.
export const FACE_COLOR = {};
for (const f of FACE_ORDER) FACE_COLOR[f] = SOLVED_FACES[f][0];

function emptyFaces() {
  const f = {};
  for (const face of FACE_ORDER) f[face] = new Array(N * N).fill(null);
  return f;
}

// Solve from a validated faces object. Returns everything the UI needs:
//   moves: [{ name, hint }]
//   frames: geometry after each step, starting from the scanned scramble
//   normalizedGeom: the scramble as rendered (no normalization: centers fix the
//                   frame, so this is just the scramble geometry)
function solve(faces) {
  const raw = stateFromFaces(faces);
  const { moves } = solveState(raw);
  const frames = [geomFromState3(raw)];
  let s = raw;
  for (const m of moves) {
    s = applyMove(s, m);
    frames.push(geomFromState3(s));
  }
  return {
    moves: moves.map((name) => ({ name, hint: moveHint(name) })),
    frames,
    normalizedGeom: frames[0],
  };
}

export const size3x3 = {
  id: '3x3',
  name: '3×3',
  gridN: N, // 3 stickers per face edge for scanning + correction
  cubiesPerEdge: 3, // for the 3D renderer
  faceOrder: FACE_ORDER,
  colors: COLORS,
  colorHex: COLOR_HEX,
  colorNames: COLOR_NAMES,
  faceLabels: FACE_LABELS,
  faceColor: FACE_COLOR,
  solvedFaces: SOLVED_FACES,
  // Scan path: same whole-cube turns as the 2x2 (F→R→B→L→U→D), a 3x3 grid.
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
  geomFromState: geomFromState3,
  SOLVED_STATE: SOLVED,
};

export default size3x3;
