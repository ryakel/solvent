// solver3.test.js — the primary 3x3 correctness gate.
// Generate many random scrambles, solve each, apply the solution back, and prove
// it returns the cube to solved. Zero tolerance for failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOLVED, applySequence, applyMove, isSolved, geomFromState3 } from '../src/core/cube3.js';
import { solve, ensureTables, PHASE_MOVES } from '../src/core/solver3.js';
import { facesFromGeom3, analyzeFaces, reflectFaces } from '../src/core/facelet3.js';
import { rotateWholeGeom3 } from '../src/core/geometry3.js';
import { FACE_ORDER } from '../src/core/geometry.js';
import size3x3 from '../src/sizes/size3x3.js';

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

// ---- orientation-agnostic solving (the key regression) ----------------------
// The 24 whole-cube re-orientations, as sequences of axis quarter-turns.
function orientationSeqs() {
  const seqs = [];
  const seen = new Set();
  const centerKey = (g) => {
    const f = facesFromGeom3(g);
    return FACE_ORDER.map((x) => f[x][4]).join('');
  };
  const q = [{ g: geomFromState3(SOLVED), seq: [] }];
  seen.add(centerKey(q[0].g));
  seqs.push([]);
  for (let i = 0; i < q.length; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const g = rotateWholeGeom3(q[i].g, axis, 1);
      const k = centerKey(g);
      if (!seen.has(k)) {
        seen.add(k);
        seqs.push([...q[i].seq, { axis, q: 1 }]);
        q.push({ g, seq: [...q[i].seq, { axis, q: 1 }] });
      }
    }
  }
  return seqs;
}
function facesAsScanned(state, seq) {
  let g = geomFromState3(state);
  for (const r of seq) g = rotateWholeGeom3(g, r.axis, r.q);
  return facesFromGeom3(g);
}

test('SOLVE from any of the 24 orientations: validate, solve, and the solution solves', () => {
  const rng = mulberry32(31337);
  const states = [SOLVED];
  for (let i = 0; i < 25; i++) states.push(applySequence(SOLVED, randomScramble(rng, 1 + Math.floor(rng() * 25))));
  const seqs = orientationSeqs();
  assert.equal(seqs.length, 24);
  let count = 0;
  for (const st of states) {
    for (const seq of seqs) {
      const faces = facesAsScanned(st, seq);
      const a = analyzeFaces(faces);
      assert.ok(a.ok, `valid cube in orientation rejected: ${a.errors && a.errors.join(' ')}`);
      const { moves } = size3x3.solve(faces);
      // moves are physical; applying them to the canonicalized state must solve it.
      let s = a.state;
      for (const mv of moves) s = applyMove(s, mv.name);
      assert.ok(isSolved(s), 'solution did not solve the cube in this orientation');
      count++;
    }
  }
  console.log(`    solved ${count} (state × orientation) cases across all 24 holds`);
});

// ---- mirror-scheme (opposite chirality) solving -----------------------------
// A mirror-scheme cube has correct opposite pairs but flipped handedness — its 6
// centers match none of the 24 proper orientations. It is a real, solvable cube.
// Reflecting a proper cube always yields a mirror one, so we generate mirror scans
// by reflecting random standard scrambles (in varied orientations), then prove the
// returned PHYSICAL moves drive the user's actual scanned cube to solved.
test('SOLVE mirror-scheme cubes: 500 reflect, validate as mirror, solve, and end solved', () => {
  const rng = mulberry32(90210);
  const seqs = orientationSeqs();
  const N = 500;
  let count = 0;
  for (let i = 0; i < N; i++) {
    const scramble = randomScramble(rng, 1 + Math.floor(rng() * 25));
    const state = applySequence(SOLVED, scramble);
    const seq = seqs[(rng() * seqs.length) | 0];
    const standardFaces = facesAsScanned(state, seq);
    const mirrorFaces = reflectFaces(standardFaces);

    const a = analyzeFaces(mirrorFaces);
    assert.ok(a.ok, `mirror cube rejected: ${a.errors && a.errors.join(' ')}`);
    assert.ok(a.mirror, 'mirror cube not flagged as mirror');
    assert.ok(a.warning, 'mirror cube carries no heads-up warning');

    const res = size3x3.solve(mirrorFaces);
    assert.ok(res.mirror, 'solve did not flag mirror');

    // The first frame reproduces exactly the user's scanned cube (their colors).
    const first = facesFromGeom3(res.frames[0]);
    for (const f of FACE_ORDER) {
      assert.deepEqual(first[f], mirrorFaces[f], `mirror first frame face ${f} altered`);
    }
    // Applying the physical moves (simulated in the frames) ends solved: six solid
    // faces, each in the user's own scanned center color.
    const centers = {};
    for (const f of FACE_ORDER) centers[f] = mirrorFaces[f][4];
    const last = facesFromGeom3(res.frames[res.frames.length - 1]);
    for (const f of FACE_ORDER) {
      assert.ok(
        last[f].every((c) => c === centers[f]),
        `mirror solved face ${f} not solid in the user's color`
      );
    }
    count++;
  }
  console.log(`    solved ${count}/${N} mirror-scheme cubes to solid faces`);
});

test('a standard cube is never flagged mirror; a reflected one always is', () => {
  const rng = mulberry32(555);
  for (let i = 0; i < 200; i++) {
    const state = applySequence(SOLVED, randomScramble(rng, 1 + Math.floor(rng() * 20)));
    const std = facesFromGeom3(geomFromState3(state));
    const aStd = analyzeFaces(std);
    assert.ok(aStd.ok && aStd.mirror === false, 'standard cube wrongly flagged mirror');
    const aMir = analyzeFaces(reflectFaces(std));
    assert.ok(aMir.ok && aMir.mirror === true, 'reflected cube not flagged mirror');
  }
});

test("the user's hand-entered mirror cube validates and solves", () => {
  // The exact 54 stickers the user entered (camera failed) — a mirror-scheme cube
  // that the pre-chirality validator rejected as "not a single real cube".
  const faces = {
    U: 'GBWOGYOOW'.split(''),
    L: 'WGYRROYOW'.split(''),
    F: 'BWRBYGBBR'.split(''),
    R: 'GGBWOWGBB'.split(''),
    B: 'RRORWYRRO'.split(''),
    D: 'OYYYBWGGY'.split(''),
  };
  const a = analyzeFaces(faces);
  assert.ok(a.ok, `user cube rejected: ${a.errors && a.errors.join(' ')}`);
  assert.ok(a.mirror, 'user cube should be detected as mirror-scheme');
  const res = size3x3.solve(faces);
  const centers = {};
  for (const f of FACE_ORDER) centers[f] = faces[f][4];
  const last = facesFromGeom3(res.frames[res.frames.length - 1]);
  for (const f of FACE_ORDER) {
    assert.ok(last[f].every((c) => c === centers[f]), `user cube face ${f} not solved`);
  }
});

test('rendered frames come back in the USER\'s scanned colors', () => {
  const rng = mulberry32(24601);
  const state = applySequence(SOLVED, randomScramble(rng, 18));
  const seqs = orientationSeqs();
  // pick a non-canonical orientation (Green up etc.)
  const seq = seqs.find((s) => s.length > 0);
  const faces = facesAsScanned(state, seq);
  const centers = {};
  for (const f of FACE_ORDER) centers[f] = faces[f][4];
  const { frames } = size3x3.solve(faces);
  // first frame reproduces exactly what was scanned (user's colors, user's frame)
  const first = facesFromGeom3(frames[0]);
  for (const f of FACE_ORDER) {
    assert.deepEqual(first[f], faces[f], `first frame face ${f} not the scanned colors`);
  }
  // last frame is solved: six solid faces, each in the user's own center color.
  const last = facesFromGeom3(frames[frames.length - 1]);
  for (const f of FACE_ORDER) {
    assert.ok(last[f].every((c) => c === centers[f]), `solved face ${f} not solid in the user's color`);
  }
});
