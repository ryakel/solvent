// cube3.test.js — proves the compact 3x3 algebra agrees with the geometric oracle.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { solvedGeom3, applyGeomMove3, geomEquals3 } from '../src/core/geometry3.js';
import {
  SOLVED,
  MOVES,
  applyMove,
  applySequence,
  isSolved,
  statesEqual,
  stateFromGeom3,
  geomFromState3,
  cloneState,
} from '../src/core/cube3.js';

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const SUFFIX = ['', "'", '2'];

// Deterministic PRNG so failures reproduce.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomMoveName(rng) {
  return FACES[Math.floor(rng() * FACES.length)] + SUFFIX[Math.floor(rng() * 3)];
}
function randomScramble(rng, len) {
  const seq = [];
  for (let i = 0; i < len; i++) seq.push(randomMoveName(rng));
  return seq;
}
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

test('SOLVED state is solved', () => {
  assert.ok(isSolved(SOLVED));
});

test('geomFromState3(SOLVED) equals a real solved cube', () => {
  assert.ok(geomEquals3(geomFromState3(SOLVED), solvedGeom3()));
});

test('every face turn applied four times is the identity (compact + geometry)', () => {
  for (const f of FACES) {
    let s = SOLVED;
    for (let i = 0; i < 4; i++) s = applyMove(s, f);
    assert.ok(isSolved(s), `${f} x4 should solve (compact)`);
    let g = solvedGeom3();
    for (let i = 0; i < 4; i++) g = applyGeomMove3(g, f, 1);
    assert.ok(geomEquals3(g, solvedGeom3()), `${f} x4 should solve (geometry)`);
  }
});

test('a move and its inverse cancel', () => {
  for (const f of FACES) {
    assert.ok(isSolved(applySequence(SOLVED, [f, f + "'"])), `${f} ${f}'`);
    assert.ok(isSolved(applySequence(SOLVED, [f + '2', f + '2'])), `${f}2 ${f}2`);
    assert.ok(isSolved(applySequence(SOLVED, [f, f, f + '2'])), `${f} ${f} ${f}2`);
  }
});

test("sexy move (R U R' U') has order 6", () => {
  let s = SOLVED;
  for (let i = 0; i < 6; i++) s = applySequence(s, ['R', 'U', "R'", "U'"]);
  assert.ok(isSolved(s), '6x sexy move should solve');
  let t = SOLVED;
  for (let i = 0; i < 5; i++) {
    t = applySequence(t, ['R', 'U', "R'", "U'"]);
    assert.ok(!isSolved(t), `sexy move should not solve after ${i + 1} reps`);
  }
});

test('solvability invariants hold for all reachable states', () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 3000; i++) {
    const s = applySequence(SOLVED, randomScramble(rng, 20));
    assert.equal(s.co.reduce((a, b) => a + b, 0) % 3, 0, 'corner twist sum');
    assert.equal(s.eo.reduce((a, b) => a + b, 0) % 2, 0, 'edge flip sum');
    assert.equal(permParity(s.cp), permParity(s.ep), 'corner/edge permutation parity');
  }
});

test('CROSS-CHECK: compact apply == geometric apply over 5000 random sequences', () => {
  const rng = mulberry32(42);
  for (let iter = 0; iter < 5000; iter++) {
    const seq = randomScramble(rng, 1 + Math.floor(rng() * 25));
    let s = SOLVED;
    let g = solvedGeom3();
    for (const m of seq) {
      s = applyMove(s, m);
      const face = m[0];
      const times = m[1] === "'" ? -1 : m[1] === '2' ? 2 : 1;
      g = applyGeomMove3(g, face, times);
    }
    const sFromG = stateFromGeom3(g);
    assert.ok(
      statesEqual(s, sFromG),
      `mismatch on seq ${seq.join(' ')}\n compact=${JSON.stringify(s)}\n geom   =${JSON.stringify(sFromG)}`
    );
  }
});

test('ROUND-TRIP: state -> geometry -> state is the identity (5000 states)', () => {
  const rng = mulberry32(7);
  for (let iter = 0; iter < 5000; iter++) {
    const s = applySequence(SOLVED, randomScramble(rng, 1 + Math.floor(rng() * 30)));
    const back = stateFromGeom3(geomFromState3(s));
    assert.ok(statesEqual(s, back), `round-trip failed:\n ${JSON.stringify(s)}\n ${JSON.stringify(back)}`);
  }
});

test('MOVES tables exist for all 18 moves', () => {
  for (const f of FACES) for (const suf of SUFFIX) assert.ok(MOVES[f + suf], `missing ${f + suf}`);
});

test('applyMove does not mutate its input', () => {
  const s = cloneState(SOLVED);
  const before = JSON.stringify(s);
  applyMove(s, 'R');
  assert.equal(JSON.stringify(s), before);
});
