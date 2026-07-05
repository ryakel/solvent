// facelet.test.js — round-trip and validation coverage (DoD #2 + #3 validation).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOLVED, applySequence, applyMove, statesEqual } from '../src/core/cube2.js';
import {
  faceColorsFromState,
  stateFromFaces,
  validateFaces,
  SOLVED_FACES,
  N,
} from '../src/core/facelet.js';
import { COLORS, FACE_ORDER } from '../src/core/geometry.js';

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const SUFFIX = ['', "'", '2'];
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomScramble(rng, len) {
  const s = [];
  for (let i = 0; i < len; i++) s.push(FACES[(rng() * 6) | 0] + SUFFIX[(rng() * 3) | 0]);
  return s;
}
function clone(faces) {
  const c = {};
  for (const f of FACE_ORDER) c[f] = [...faces[f]];
  return c;
}

test('ROUND-TRIP: state -> faces -> state over 5000 random valid states (0 failures)', () => {
  const rng = mulberry32(123);
  for (let i = 0; i < 5000; i++) {
    const state = applySequence(SOLVED, randomScramble(rng, 1 + ((rng() * 30) | 0)));
    const faces = faceColorsFromState(state);
    const back = stateFromFaces(faces);
    assert.ok(statesEqual(state, back), `round-trip mismatch at ${i}`);
  }
});

test('solved faces are six solid colors, one per face', () => {
  for (const f of FACE_ORDER) {
    const arr = SOLVED_FACES[f];
    assert.equal(arr.length, N * N);
    assert.ok(arr.every((c) => c === arr[0]), `face ${f} not solid`);
  }
  // all six faces are different colors
  const set = new Set(FACE_ORDER.map((f) => SOLVED_FACES[f][0]));
  assert.equal(set.size, 6);
});

test('validateFaces accepts every reachable (scrambled) cube', () => {
  const rng = mulberry32(555);
  for (let i = 0; i < 1000; i++) {
    const state = applySequence(SOLVED, randomScramble(rng, (rng() * 25) | 0));
    const faces = faceColorsFromState(state);
    const { ok, errors } = validateFaces(faces);
    assert.ok(ok, `valid cube rejected: ${errors.join(' ')}`);
  }
});

test('validateFaces rejects a wrong color count with a specific message', () => {
  const faces = clone(SOLVED_FACES);
  faces.U[0] = 'R'; // now 5 Red, 3 White
  const { ok, errors } = validateFaces(faces);
  assert.ok(!ok);
  assert.ok(errors.some((e) => /White appears 3/.test(e)));
  assert.ok(errors.some((e) => /Red appears 5/.test(e)));
});

test('validateFaces rejects an impossible corner (opposite colors)', () => {
  // Put Yellow on URF's Red cell (URF becomes White/Yellow/Green -> opposite
  // colors White+Yellow), and rebalance counts by turning a Yellow cell Red.
  const faces = clone(SOLVED_FACES);
  faces.R[FACELET_INDEX('R', 'URF')] = 'Y'; // URF now W,Y,G
  faces.D[FACELET_INDEX('D', 'DLF')] = 'R'; // keep counts (Y-1+? ) balanced
  const { ok, errors } = validateFaces(faces);
  assert.ok(!ok);
  assert.ok(
    errors.some((e) => /opposite|not a real cube piece/.test(e)),
    `expected an opposite/real-piece error, got: ${errors.join(' ')}`
  );
});

test('validateFaces rejects a single twisted corner (orientation parity)', () => {
  // Cycle the three stickers of one corner: physically a single-corner twist.
  const faces = clone(SOLVED_FACES);
  const uCell = FACELET_INDEX('U', 'URF');
  const rCell = FACELET_INDEX('R', 'URF');
  const fCell = FACELET_INDEX('F', 'URF');
  const a = faces.U[uCell],
    b = faces.R[rCell],
    c = faces.F[fCell];
  faces.U[uCell] = c;
  faces.R[rCell] = a;
  faces.F[fCell] = b;
  const { ok, errors } = validateFaces(faces);
  assert.ok(!ok, 'a single twisted corner must be rejected');
  assert.ok(errors.some((e) => /twist/i.test(e)));
});

test('stateFromFaces throws on invalid cube', () => {
  const faces = clone(SOLVED_FACES);
  faces.U[0] = 'R';
  assert.throws(() => stateFromFaces(faces));
});

// Helper: find the reading-order index of a named corner's sticker on a face.
// Rebuilds the same mapping facelet.js uses, via a solved-state probe.
import { FACES as GEOM_FACES, SLOTS } from '../src/core/geometry.js';
function FACELET_INDEX(face, cornerName) {
  const slot = SLOTS.findIndex((s) => s.name === cornerName);
  // faceColorsFromState on a state where only this slot's face sticker is unique
  // would be complex; instead reuse the exported mapping by matching a probe.
  // Simpler: brute force using a marker state is overkill — reconstruct mapping.
  const { axis, sign } = GEOM_FACES[face];
  // Build a state that is solved, read faces, then find which index corresponds
  // to this corner by checking geometry position via faceColorsFromState marker.
  // We can identify the cell by temporarily marking: not available here, so we
  // recompute using the same VIEW logic embedded through a solved probe.
  return CELL_OF[face][slot];
}

// Precompute CELL_OF[face][slot] by probing faceColorsFromState with unique marks.
import { geomFromState, stateFromGeom } from '../src/core/cube2.js';
const CELL_OF = (() => {
  // Use faceColorsFromState on solved and match by a geometry re-derivation.
  // We reconstruct the mapping by placing a distinct tag per slot is not possible
  // through colors; instead replicate facelet's VIEW mapping directly.
  const VIEW = {
    U: { u: [1, 0, 0], v: [0, 0, 1] },
    D: { u: [1, 0, 0], v: [0, 0, -1] },
    F: { u: [1, 0, 0], v: [0, -1, 0] },
    B: { u: [-1, 0, 0], v: [0, -1, 0] },
    R: { u: [0, 0, -1], v: [0, -1, 0] },
    L: { u: [0, 0, 1], v: [0, -1, 0] },
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const out = {};
  for (const face of FACE_ORDER) {
    const { axis, sign } = GEOM_FACES[face];
    out[face] = {};
    for (let slot = 0; slot < SLOTS.length; slot++) {
      const pos = SLOTS[slot].pos;
      if (pos[axis] !== sign) continue;
      const col = dot(pos, VIEW[face].u) > 0 ? 1 : 0;
      const row = dot(pos, VIEW[face].v) > 0 ? 1 : 0;
      out[face][slot] = row * 2 + col;
    }
  }
  return out;
})();
