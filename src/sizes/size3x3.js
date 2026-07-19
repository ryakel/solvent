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
import { applyGeomMove3, reflectMoveName } from '../core/geometry3.js';
import {
  faceColorsFromState,
  analyzeFaces,
  validateFaces,
  geomFromRawFaces,
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

// Recolor a geometry's stickers through a color map (canonical -> scanned), leaving
// positions untouched. The moves are physical (they name face positions as held),
// so only the colors are mapped back into the user's frame for rendering.
function recolor(geom, map) {
  return geom.map((cubie) => ({
    pos: cubie.pos,
    stickers: cubie.stickers.map((s) => ({ normal: s.normal, color: map[s.color] })),
  }));
}

// Parse a move name ("U", "R'", "F2") into an oracle (face, times) pair.
function parseMove(name) {
  const face = name[0];
  const times = name.length === 1 ? 1 : name[1] === "'" ? -1 : 2;
  return { face, times };
}

const CENTER = Math.floor((N * N) / 2); // middle cell = this face's fixed center color

// The center color on each face of the scanned cube. A 3x3's centers never move,
// so these are exactly the colors the solved cube will show on each face — the
// anchor for "hold it like this" and for naming which face each move turns.
function faceCenters(faces) {
  const map = {};
  for (const f of FACE_ORDER) map[f] = faces[f][CENTER];
  return map;
}

// Solve from a validated faces object. Returns everything the UI needs:
//   moves: [{ name, hint }]
//   frames: geometry after each step, starting from the scanned scramble
//   normalizedGeom: the scramble as rendered
//   mirror, warning: set when the scan was a mirror-scheme cube
//
// The cube is solved internally in the canonical frame (centers relabelled to the
// standard scheme), but the returned frames are recoloured back into the USER's
// scanned colors so the on-screen 3D cube matches the physical cube in hand. Centers
// define the frame, so there is no whole-cube normalization.
function solve(faces) {
  const a = analyzeFaces(faces);
  if (!a.ok) throw new Error('invalid cube: ' + a.errors.join(' '));
  const raw = a.state;
  const { moves } = solveState(raw);

  // Mirror-scheme cube: the solver ran on the reflected (standard) cube, so each
  // move must be reflected back to a real physical face turn (R<->L, direction
  // inverted). We render by simulating those physical turns on the user's ACTUAL
  // scanned geometry, so the on-screen cube and colors match the cube in hand and
  // end solved.
  const faceColors = faceCenters(faces);
  const hold = { up: faceColors.U, front: faceColors.F };

  if (a.mirror) {
    const physMoves = moves.map((m) => reflectMoveName[m]);
    let g = geomFromRawFaces(a.rawFaces);
    const frames = [g];
    for (const name of physMoves) {
      const { face, times } = parseMove(name);
      g = applyGeomMove3(g, face, times);
      frames.push(g);
    }
    return {
      moves: physMoves.map((name) => ({ name, hint: moveHint(name) })),
      frames,
      normalizedGeom: frames[0],
      hold,
      faceColors,
      mirror: true,
      warning: a.warning,
    };
  }

  const frames = [recolor(geomFromState3(raw), a.inverse)];
  let s = raw;
  for (const m of moves) {
    s = applyMove(s, m);
    frames.push(recolor(geomFromState3(s), a.inverse));
  }
  return {
    moves: moves.map((name) => ({ name, hint: moveHint(name) })),
    frames,
    normalizedGeom: frames[0],
    hold,
    faceColors,
    mirror: false,
    warning: null,
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
