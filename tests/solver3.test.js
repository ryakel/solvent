// solver3.test.js — the primary 3x3 correctness gate.
// Generate many random scrambles, solve each, apply the solution back, and prove
// it returns the cube to solved. Zero tolerance for failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOLVED, applySequence, applyMove, isSolved } from '../src/core/cube3.js';
import { solve, ensureTables, PHASE_MOVES } from '../src/core/solver3.js';

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
  const seq = [];
  for (let i = 0; i < len; i++) seq.push(FACES[(rng() * 6) | 0] + SUFFIX[(rng() * 3) | 0]);
  return seq;
}

const ALL_MOVES = new Set([
  ...PHASE_MOVES.P1_MOVES,
  ...PHASE_MOVES.P2_MOVES,
  ...PHASE_MOVES.P3_MOVES,
  ...PHASE_MOVES.P4_MOVES,
]);

test('pattern databases build without error', () => {
  ensureTables();
  assert.ok(true);
});

test('already-solved cube yields an empty solution', () => {
  const { moves } = solve(SOLVED);
  assert.deepEqual(moves, []);
});

test('SOLVE: 2000 random scrambles each solve to a solved cube (0 failures)', () => {
  const rng = mulberry32(2024);
  const N = 2000;
  let failures = 0;
  let maxLen = 0;
  const lens = [];
  for (let i = 0; i < N; i++) {
    const scramble = randomScramble(rng, 1 + Math.floor(rng() * 25));
    const state = applySequence(SOLVED, scramble);
    const { moves } = solve(state);

    for (const m of moves) assert.ok(ALL_MOVES.has(m), `illegal move ${m}`);

    let s = state;
    for (const m of moves) s = applyMove(s, m);
    if (!isSolved(s)) {
      failures++;
      if (failures <= 3) {
        console.log(`  FAIL scramble [${scramble.join(' ')}] -> [${moves.join(' ')}]`);
      }
    } else {
      maxLen = Math.max(maxLen, moves.length);
      lens.push(moves.length);
    }
  }
  assert.equal(failures, 0, `${failures} scrambles did not solve`);
  lens.sort((a, b) => a - b);
  const median = lens[lens.length >> 1];
  const avg = (lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1);
  console.log(`    solved ${N}/${N}; solution length max ${maxLen}, median ${median}, avg ${avg}`);
});

test('a single quarter turn is solved and the solution actually solves it', () => {
  for (const m of ['U', "U'", 'R', "R'", 'F', "F'", 'D', "D'", 'L', "L'", 'B', "B'"]) {
    const state = applyMove(SOLVED, m);
    const { moves } = solve(state);
    let s = state;
    for (const mv of moves) s = applyMove(s, mv);
    assert.ok(isSolved(s), `solution for scramble ${m} failed`);
  }
});
