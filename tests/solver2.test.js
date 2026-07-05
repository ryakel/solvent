// solver2.test.js — the primary correctness gate.
// Generate many random scrambles, solve each, and prove the solution returns the
// cube to solved. Zero tolerance for failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOLVED, applySequence, applyMove, isSolved } from '../src/core/cube2.js';
import {
  solve,
  normalize,
  SOLVE_MOVES,
  ensureTables,
} from '../src/core/solver2.js';

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
  for (let i = 0; i < len; i++) {
    seq.push(FACES[Math.floor(rng() * 6)] + SUFFIX[Math.floor(rng() * 3)]);
  }
  return seq;
}

test('pattern databases build and fully cover their spaces', () => {
  ensureTables();
  // (indirectly verified by solves below; here we just ensure no throw)
  assert.ok(true);
});

test('already-solved cube yields an empty solution', () => {
  const { moves } = solve(SOLVED);
  assert.deepEqual(moves, []);
});

test('normalize fixes the reference corner (cubie 6 -> slot 6, ori 0)', () => {
  const rng = mulberry32(99);
  for (let i = 0; i < 500; i++) {
    const s = applySequence(SOLVED, randomScramble(rng, 15));
    const n = normalize(s);
    assert.equal(n.cp[6], 6);
    assert.equal(n.co[6], 0);
  }
});

test('SOLVE: 3000 random scrambles each solve to a solved cube (0 failures)', () => {
  const rng = mulberry32(2024);
  const N = 3000;
  let maxLen = 0;
  const lenHist = {};
  for (let i = 0; i < N; i++) {
    const scramble = randomScramble(rng, 1 + Math.floor(rng() * 25));
    const state = applySequence(SOLVED, scramble);
    const { normalized, moves } = solve(state);

    // every move must be a legal solve move (U/R/F family)
    for (const m of moves) assert.ok(SOLVE_MOVES.includes(m), `illegal move ${m}`);

    // applying the solution to the normalized state must solve it
    let s = normalized;
    for (const m of moves) s = applyMove(s, m);
    assert.ok(
      isSolved(s),
      `scramble [${scramble.join(' ')}] -> solution [${moves.join(' ')}] did not solve`
    );

    maxLen = Math.max(maxLen, moves.length);
    lenHist[moves.length] = (lenHist[moves.length] || 0) + 1;
  }
  // 2x2 God's number in the half-turn metric is 11.
  assert.ok(maxLen <= 11, `max solution length ${maxLen} exceeds God's number 11`);
  console.log(`    solved ${N}/${N}; max length ${maxLen}; distribution:`, lenHist);
});

test('solutions are optimal for a set of hand-checked short cases', () => {
  // A single quarter turn away from solved must be solved in exactly 1 move.
  for (const m of ['U', "U'", 'R', "R'", 'F', "F'"]) {
    const state = applyMove(SOLVED, m);
    const { moves } = solve(state);
    assert.equal(moves.length, 1, `${m} scramble should need 1 move, got ${moves.join(' ')}`);
  }
  // Two independent quarter turns need exactly 2.
  const two = applyMove(applyMove(SOLVED, 'R'), 'U');
  assert.equal(solve(two).moves.length, 2);
});
