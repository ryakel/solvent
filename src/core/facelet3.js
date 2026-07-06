// facelet3.js — the 3x3 sticker-grid representation used by scanning, correction,
// and validation, plus conversion to/from the solver's compact state.
//
// A "faces" object maps each face letter to an array of 9 color letters in reading
// order (row-major: 3 rows of 3, top-left first). The 3x3 uses the SAME per-face
// VIEW basis as the 2x2 (facelet.js), just a 3x3 grid, so the two sizes read a
// face the same way. The face<->cubie mapping is derived from geometry3.js so it
// stays consistent with the renderer and solver. facelet3.test.js proves the
// round-trip state -> faces -> state is the identity.

import { FACES, FACE_ORDER, COLORS } from './geometry.js';
import { SLOTS } from './geometry.js';
import { solvedGeom3, cubieKind } from './geometry3.js';
import {
  SOLVED,
  EDGE_SLOTS,
  geomFromState3,
  stateFromGeom3,
  statesEqual,
} from './cube3.js';

export const N = 3; // stickers per face edge (3x3).

// Per-face 2D view basis: `u` points to the viewer's right, `v` points down, when
// the face is held in the documented orientation (White up, Green front). Same
// basis as facelet.js — one source of truth for how a face reads.
const VIEW = {
  U: { u: [1, 0, 0], v: [0, 0, 1] },
  D: { u: [1, 0, 0], v: [0, 0, -1] },
  F: { u: [1, 0, 0], v: [0, -1, 0] },
  B: { u: [-1, 0, 0], v: [0, -1, 0] },
  R: { u: [0, 0, -1], v: [0, -1, 0] },
  L: { u: [0, 0, 1], v: [0, -1, 0] },
};

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function posKey(p) {
  return p.join(',');
}

// FACE_CELL_POS[face][idx] = the integer position of the cubie showing sticker idx.
const FACE_CELL_POS = (() => {
  const g = solvedGeom3();
  const map = {};
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    const { u, v } = VIEW[face];
    map[face] = new Array(N * N);
    for (const cubie of g) {
      const pos = cubie.pos;
      if (pos[axis] !== sign) continue;
      const col = dot(pos, u) + 1; // -1,0,1 -> 0,1,2
      const row = dot(pos, v) + 1;
      map[face][row * N + col] = pos;
    }
  }
  return map;
})();

// POS_TO_CELLS[posKey] = [{ face, idx, axis, sign }] for each face this cubie shows on.
const POS_TO_CELLS = (() => {
  const m = new Map();
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    FACE_CELL_POS[face].forEach((pos, idx) => {
      const k = posKey(pos);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ face, idx, axis, sign });
    });
  }
  return m;
})();

// The center cell index (middle of the grid) and each face's fixed center color.
const CENTER_IDX = 4; // row 1, col 1
const CENTER_COLOR = Object.fromEntries(FACE_ORDER.map((f) => [f, FACES[f].color]));

// state -> faces
export function faceColorsFromState(state) {
  const geom = geomFromState3(state);
  const byPos = new Map();
  for (const cubie of geom) byPos.set(posKey(cubie.pos), cubie);
  const faces = {};
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    faces[face] = FACE_CELL_POS[face].map((pos) => {
      const cubie = byPos.get(posKey(pos));
      const st = cubie.stickers.find((s) => s.normal[axis] === sign);
      return st.color;
    });
  }
  return faces;
}

export const SOLVED_FACES = faceColorsFromState(SOLVED);

// faces -> geometry (may be an invalid cube; validate first). Centers are fixed by
// construction; the corner/edge stickers come from the grid.
function geomFromFaces(faces) {
  const cubies = [];
  // centers (fixed frame)
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    const pos = [0, 0, 0];
    pos[axis] = sign;
    const normal = [0, 0, 0];
    normal[axis] = sign;
    cubies.push({ pos, stickers: [{ normal, color: CENTER_COLOR[face] }] });
  }
  const build = (pos) => {
    const stickers = [];
    for (const cell of POS_TO_CELLS.get(posKey(pos))) {
      const normal = [0, 0, 0];
      normal[cell.axis] = cell.sign;
      stickers.push({ normal, color: faces[cell.face][cell.idx] });
    }
    return { pos: [...pos], stickers };
  };
  for (const slot of SLOTS) cubies.push(build(slot.pos));
  for (const slot of EDGE_SLOTS) cubies.push(build(slot.pos));
  return cubies;
}

// The real pieces and opposite-color pairs, from the oracle.
const REAL_CORNER_SETS = new Set();
const REAL_EDGE_SETS = new Set();
(function () {
  for (const cubie of solvedGeom3()) {
    const kind = cubieKind(cubie.pos);
    const key = cubie.stickers.map((s) => s.color).sort().join('');
    if (kind === 'corner') REAL_CORNER_SETS.add(key);
    else if (kind === 'edge') REAL_EDGE_SETS.add(key);
  }
})();
const OPPOSITE = { W: 'Y', Y: 'W', G: 'B', B: 'G', R: 'O', O: 'R' };
const COLOR_NAMES = { W: 'White', Y: 'Yellow', G: 'Green', B: 'Blue', R: 'Red', O: 'Orange' };

function permParity(p) {
  const seen = new Array(p.length).fill(false);
  let parity = 0;
  for (let i = 0; i < p.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    let j = i;
    while (!seen[j]) {
      seen[j] = true;
      j = p[j];
      len++;
    }
    parity ^= (len - 1) & 1;
  }
  return parity;
}

function dedupe(arr) {
  return [...new Set(arr)];
}

// Validate a faces object as a physically real, solvable 3x3 cube. Returns
// { ok, errors: string[] } with specific, actionable messages.
export function validateFaces(faces) {
  const errors = [];

  // 1. Every face has 9 known-color stickers.
  let allFilled = true;
  for (const face of FACE_ORDER) {
    const arr = faces[face];
    if (!arr || arr.length !== N * N) {
      errors.push(`Face ${face} is missing stickers.`);
      allFilled = false;
      continue;
    }
    for (const c of arr) {
      if (!COLORS.includes(c)) {
        errors.push(`Face ${face} has an unset or unknown sticker.`);
        allFilled = false;
        break;
      }
    }
  }
  if (!allFilled) return { ok: false, errors };

  // 2. Each color appears exactly 9 times.
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const face of FACE_ORDER) for (const c of faces[face]) counts[c]++;
  for (const c of COLORS) {
    if (counts[c] !== N * N) {
      errors.push(`${COLOR_NAMES[c]} appears ${counts[c]} times; a real cube has exactly ${N * N}.`);
    }
  }

  // 3. Centers are fixed and define the frame: each must be its scheme color.
  for (const face of FACE_ORDER) {
    const c = faces[face][CENTER_IDX];
    if (c !== CENTER_COLOR[face]) {
      errors.push(
        `The ${face} center is ${COLOR_NAMES[c] || c}; it must be ${COLOR_NAMES[CENTER_COLOR[face]]} — re-check the cube's orientation.`
      );
    }
  }

  // 4. Corners: 3 distinct, non-opposite colors, a real piece, all 8 distinct.
  const cornerSeen = new Set();
  for (const slot of SLOTS) {
    const cols = POS_TO_CELLS.get(posKey(slot.pos)).map((cell) => faces[cell.face][cell.idx]);
    const uniq = new Set(cols);
    const key = [...cols].sort().join('');
    if (uniq.size !== 3) {
      errors.push(`The ${slot.name} corner repeats a color (${cols.join('/')}).`);
      continue;
    }
    let opp = false;
    for (const c of cols) {
      if (uniq.has(OPPOSITE[c])) {
        errors.push(
          `The ${slot.name} corner pairs opposite colors ${COLOR_NAMES[c]} and ${COLOR_NAMES[OPPOSITE[c]]}, which can't touch.`
        );
        opp = true;
        break;
      }
    }
    if (opp) continue;
    if (!REAL_CORNER_SETS.has(key)) {
      errors.push(`The ${slot.name} corner (${cols.join('/')}) is not a real cube piece.`);
      continue;
    }
    if (cornerSeen.has(key)) {
      errors.push(`Two corners are the same piece (${slot.name} duplicates another).`);
    }
    cornerSeen.add(key);
  }

  // 5. Edges: 2 distinct, non-opposite colors, a real piece, all 12 distinct.
  const edgeSeen = new Set();
  for (const slot of EDGE_SLOTS) {
    const cols = POS_TO_CELLS.get(posKey(slot.pos)).map((cell) => faces[cell.face][cell.idx]);
    const uniq = new Set(cols);
    const key = [...cols].sort().join('');
    if (uniq.size !== 2) {
      errors.push(`The ${slot.name} edge repeats a color (${cols.join('/')}).`);
      continue;
    }
    if (uniq.has(OPPOSITE[cols[0]])) {
      errors.push(
        `The ${slot.name} edge pairs opposite colors ${COLOR_NAMES[cols[0]]} and ${COLOR_NAMES[cols[1]]}, which can't touch.`
      );
      continue;
    }
    if (!REAL_EDGE_SETS.has(key)) {
      errors.push(`The ${slot.name} edge (${cols.join('/')}) is not a real cube piece.`);
      continue;
    }
    if (edgeSeen.has(key)) {
      errors.push(`Two edges are the same piece (${slot.name} duplicates another).`);
    }
    edgeSeen.add(key);
  }

  if (errors.length) return { ok: false, errors: dedupe(errors) };

  // 6. Solvability constraints (all three must hold for a real cube).
  const state = stateFromGeom3(geomFromFaces(faces));
  const twist = state.co.reduce((a, b) => a + b, 0) % 3;
  if (twist !== 0) {
    errors.push(
      'One corner is twisted in place — the total corner twist is off. Re-check a corner whose colors look rotated.'
    );
  }
  const flip = state.eo.reduce((a, b) => a + b, 0) % 2;
  if (flip !== 0) {
    errors.push(
      'One edge is flipped in place — the total edge flip is off. Re-check an edge whose two colors look swapped.'
    );
  }
  if (permParity(state.cp) !== permParity(state.ep)) {
    errors.push(
      'Two pieces are swapped — the corner and edge permutation parity disagree, which no sequence of turns can produce. Re-check for two swapped pieces.'
    );
  }

  return { ok: errors.length === 0, errors: dedupe(errors) };
}

// Parse a validated faces object into a solver state. Throws if invalid.
export function stateFromFaces(faces) {
  const { ok, errors } = validateFaces(faces);
  if (!ok) throw new Error('invalid cube: ' + errors.join(' '));
  return stateFromGeom3(geomFromFaces(faces));
}

export { statesEqual };
