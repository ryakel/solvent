// facelet3.test.js — 3x3 round-trip and validation coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOLVED, applySequence, statesEqual } from '../src/core/cube3.js';
import {
  faceColorsFromState,
  stateFromFaces,
  validateFaces,
  SOLVED_FACES,
  N,
} from '../src/core/facelet3.js';
import { FACE_ORDER, FACES as GEOM_FACES, SLOTS } from '../src/core/geometry.js';
import { EDGE_SLOTS } from '../src/core/cube3.js';

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

// Reading-order cell index of a cubie position on a face — rebuilds the same VIEW
// mapping facelet3.js uses so tests can target a specific sticker.
const VIEW = {
  U: { u: [1, 0, 0], v: [0, 0, 1] },
  D: { u: [1, 0, 0], v: [0, 0, -1] },
  F: { u: [1, 0, 0], v: [0, -1, 0] },
  B: { u: [-1, 0, 0], v: [0, -1, 0] },
  R: { u: [0, 0, -1], v: [0, -1, 0] },
  L: { u: [0, 0, 1], v: [0, -1, 0] },
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function cellOf(face, pos) {
  const { axis, sign } = GEOM_FACES[face];
  if (pos[axis] !== sign) return -1;
  const col = dot(pos, VIEW[face].u) + 1;
  const row = dot(pos, VIEW[face].v) + 1;
  return row * N + col;
}
const CORNER_POS = (name) => SLOTS.find((s) => s.name === name).pos;
const EDGE_POS = (name) => EDGE_SLOTS.find((s) => s.name === name).pos;

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
  const set = new Set(FACE_ORDER.map((f) => SOLVED_FACES[f][0]));
  assert.equal(set.size, 6);
});

test('validateFaces accepts every reachable (scrambled) cube', () => {
  const rng = mulberry32(555);
  for (let i = 0; i < 2000; i++) {
    const state = applySequence(SOLVED, randomScramble(rng, (rng() * 25) | 0));
    const faces = faceColorsFromState(state);
    const { ok, errors } = validateFaces(faces);
    assert.ok(ok, `valid cube rejected: ${errors.join(' ')}`);
  }
});

test('validateFaces rejects a wrong color count with a specific message', () => {
  const faces = clone(SOLVED_FACES);
  faces.U[0] = 'R'; // now 8 White, 10 Red
  const { ok, errors } = validateFaces(faces);
  assert.ok(!ok);
  assert.ok(errors.some((e) => /White appears 8/.test(e)), errors.join(' '));
  assert.ok(errors.some((e) => /Red appears 10/.test(e)), errors.join(' '));
});

test('validateFaces rejects a single twisted corner (corner-twist parity)', () => {
  // Cycle the three stickers of the URF corner: physically a single-corner twist.
  const faces = clone(SOLVED_FACES);
  const uCell = cellOf('U', CORNER_POS('URF'));
  const rCell = cellOf('R', CORNER_POS('URF'));
  const fCell = cellOf('F', CORNER_POS('URF'));
  const a = faces.U[uCell];
  const b = faces.R[rCell];
  const c = faces.F[fCell];
  faces.U[uCell] = c;
  faces.R[rCell] = a;
  faces.F[fCell] = b;
  const { ok, errors } = validateFaces(faces);
  assert.ok(!ok, 'a single twisted corner must be rejected');
  assert.ok(errors.some((e) => /twist/i.test(e)), errors.join(' '));
});

test('validateFaces rejects a single flipped edge (edge-flip parity)', () => {
  // Swap the two stickers of the UF edge: physically a single-edge flip.
  const faces = clone(SOLVED_FACES);
  const uCell = cellOf('U', EDGE_POS('UF'));
  const fCell = cellOf('F', EDGE_POS('UF'));
  const a = faces.U[uCell];
  const b = faces.F[fCell];
  faces.U[uCell] = b;
  faces.F[fCell] = a;
  const { ok, errors } = validateFaces(faces);
  assert.ok(!ok, 'a single flipped edge must be rejected');
  assert.ok(errors.some((e) => /flip/i.test(e)), errors.join(' '));
});

test('validateFaces rejects a single-swap (permutation parity) with a specific message', () => {
  // Swap the UF and UR edge pieces (a single 2-swap): impossible on a real cube.
  const faces = clone(SOLVED_FACES);
  const uf = EDGE_POS('UF');
  const ur = EDGE_POS('UR');
  const ufU = cellOf('U', uf);
  const ufF = cellOf('F', uf);
  const urU = cellOf('U', ur);
  const urR = cellOf('R', ur);
  const a1 = faces.U[ufU];
  const a2 = faces.F[ufF];
  faces.U[ufU] = faces.U[urU];
  faces.F[ufF] = faces.R[urR];
  faces.U[urU] = a1;
  faces.R[urR] = a2;
  const { ok, errors } = validateFaces(faces);
  assert.ok(!ok, 'a single swap must be rejected');
  assert.ok(errors.some((e) => /parity|swapped/i.test(e)), errors.join(' '));
});

test('validateFaces rejects a wrong center with a specific message', () => {
  const faces = clone(SOLVED_FACES);
  faces.U[4] = 'Y'; // center of U changed (also breaks counts, but center msg fires)
  const { ok, errors } = validateFaces(faces);
  assert.ok(!ok);
  assert.ok(errors.some((e) => /center/i.test(e)), errors.join(' '));
});

test('stateFromFaces throws on invalid cube', () => {
  const faces = clone(SOLVED_FACES);
  faces.U[0] = 'R';
  assert.throws(() => stateFromFaces(faces));
});
