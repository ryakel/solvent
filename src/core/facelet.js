// facelet.js — the sticker-grid representation used by scanning, correction, and
// validation, plus conversion to/from the solver's compact state.
//
// A "faces" object maps each face letter to an array of N*N color letters in
// reading order (row-major: top-left, top-right, bottom-left, bottom-right for a
// 2x2). Colors are the scheme letters W Y G B R O.
//
// This module derives its face<->cubie mapping from geometry.js, so it stays
// consistent with the renderer and solver. facelet.test.js proves the round-trip
// state -> faces -> state is the identity.

import { FACES, FACE_ORDER, COLORS, SLOTS, solvedGeom } from './geometry.js';
import { SOLVED, geomFromState, stateFromGeom, statesEqual } from './cube2.js';

export const N = 2; // stickers per face edge (2x2). The size module carries this.

// Per-face 2D view basis: `u` points to the viewer's right, `v` points down, when
// the face is held in the documented orientation (White up, Green front). This
// only needs to be self-consistent for the round-trip; the UI documents the hold.
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

// FACELET_MAP[face][idx] = slot index of the cubie showing that sticker.
const FACELET_MAP = (() => {
  const g = solvedGeom();
  const map = {};
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    const { u, v } = VIEW[face];
    map[face] = new Array(N * N);
    for (let slot = 0; slot < g.length; slot++) {
      const pos = g[slot].pos;
      if (pos[axis] !== sign) continue;
      const col = dot(pos, u) > 0 ? 1 : 0;
      const row = dot(pos, v) > 0 ? 1 : 0;
      map[face][row * N + col] = slot;
    }
  }
  return map;
})();

// state -> faces
export function faceColorsFromState(state) {
  const geom = geomFromState(state);
  const faces = {};
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    faces[face] = FACELET_MAP[face].map((slot) => {
      const st = geom[slot].stickers.find((s) => s.normal[axis] === sign);
      return st.color;
    });
  }
  return faces;
}

export const SOLVED_FACES = faceColorsFromState(SOLVED);

// faces -> geometry (may be an invalid cube; validate first).
function geomFromFaces(faces) {
  return SLOTS.map((slot, j) => {
    const stickers = [];
    for (let axis = 0; axis < 3; axis++) {
      const sign = slot.pos[axis];
      // which face is on this axis/sign, and which idx corresponds to slot j
      const face = FACE_ORDER.find((f) => FACES[f].axis === axis && FACES[f].sign === sign);
      const idx = FACELET_MAP[face].indexOf(j);
      const normal = [0, 0, 0];
      normal[axis] = sign;
      stickers.push({ normal, color: faces[face][idx] });
    }
    return { pos: [...slot.pos], stickers };
  });
}

// The 8 real cubies, each as a sorted color-set string, and the opposite-color
// pairs that can never share a corner.
const REAL_CUBIE_SETS = new Set(
  solvedGeom().map((c) => c.stickers.map((s) => s.color).sort().join(''))
);
const OPPOSITE = { W: 'Y', Y: 'W', G: 'B', B: 'G', R: 'O', O: 'R' };
const COLOR_NAMES = { W: 'White', Y: 'Yellow', G: 'Green', B: 'Blue', R: 'Red', O: 'Orange' };

// Validate a faces object as a physically real, solvable 2x2 cube. Returns
// { ok, errors: string[] }. Messages are specific and actionable.
export function validateFaces(faces) {
  const errors = [];

  // 1. Every sticker is a known color and every face has N*N of them.
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

  // 2. Each color appears exactly N*N times (4 on a 2x2).
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const face of FACE_ORDER) for (const c of faces[face]) counts[c]++;
  for (const c of COLORS) {
    if (counts[c] !== N * N) {
      errors.push(
        `${COLOR_NAMES[c]} appears ${counts[c]} times; a real cube has exactly ${N * N}.`
      );
    }
  }

  // 3. Each corner has three distinct, non-opposite colors and is a real piece.
  const cornerSets = [];
  for (let j = 0; j < SLOTS.length; j++) {
    const slot = SLOTS[j];
    const cols = [];
    for (let axis = 0; axis < 3; axis++) {
      const sign = slot.pos[axis];
      const face = FACE_ORDER.find((f) => FACES[f].axis === axis && FACES[f].sign === sign);
      const idx = FACELET_MAP[face].indexOf(j);
      cols.push(faces[face][idx]);
    }
    const key = [...cols].sort().join('');
    cornerSets.push(key);
    const uniq = new Set(cols);
    if (uniq.size !== 3) {
      errors.push(`The ${slot.name} corner repeats a color (${cols.join('/')}).`);
    } else {
      for (const c of cols) {
        if (uniq.has(OPPOSITE[c])) {
          errors.push(
            `The ${slot.name} corner pairs opposite colors ${COLOR_NAMES[c]} and ${COLOR_NAMES[OPPOSITE[c]]}, which can't touch.`
          );
          break;
        }
      }
      if (!REAL_CUBIE_SETS.has(key)) {
        errors.push(`The ${slot.name} corner (${cols.join('/')}) is not a real cube piece.`);
      }
    }
  }

  // 4. All 8 corners are distinct pieces (a permutation of the real set).
  const seen = new Set();
  for (let j = 0; j < cornerSets.length; j++) {
    if (REAL_CUBIE_SETS.has(cornerSets[j])) {
      if (seen.has(cornerSets[j])) {
        errors.push(`Two corners are the same piece (${SLOTS[j].name} duplicates another).`);
      }
      seen.add(cornerSets[j]);
    }
  }

  if (errors.length) return { ok: false, errors: dedupe(errors) };

  // 5. Orientation parity: total corner twist must be 0 mod 3 (a single twisted
  //    corner is unsolvable).
  const state = stateFromGeom(geomFromFaces(faces));
  const twist = state.co.reduce((a, b) => a + b, 0) % 3;
  if (twist !== 0) {
    errors.push(
      'One corner is twisted in place — the total twist is off. Re-check a corner whose colors look rotated.'
    );
  }

  return { ok: errors.length === 0, errors: dedupe(errors) };
}

function dedupe(arr) {
  return [...new Set(arr)];
}

// Parse a validated faces object into a solver state. Throws if invalid.
export function stateFromFaces(faces) {
  const { ok, errors } = validateFaces(faces);
  if (!ok) throw new Error('invalid cube: ' + errors.join(' '));
  return stateFromGeom(geomFromFaces(faces));
}

export { statesEqual };
