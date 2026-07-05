// solver2.js — optimal 2x2 solver.
//
// Strategy:
//   1. A 2x2 has no fixed centers, so "solved" is defined relative to one corner.
//      We normalize any scanned state by a whole-cube rotation that puts the DBL
//      cubie (id 6) into slot 6 with orientation 0. After that, the three faces
//      U, R, F never touch that corner and suffice to solve the cube.
//   2. IDA* over the moves {U,R,F} x {1,2,3}, guided by two admissible pattern
//      databases (corner permutation distance, corner orientation distance).
//
// Optimality and correctness are covered in solver2.test.js: thousands of random
// scrambles are solved and each solution is applied back and asserted to solve.

import {
  SOLVED,
  MOVES,
  applyMove,
  applySequence,
  isSolved,
  stateKey,
} from './cube2.js';

// The reference corner we hold fixed.
const REF_CUBIE = 6;
const REF_SLOT = 6;

// Moves usable once the reference corner is fixed.
export const SOLVE_MOVES = ['U', "U'", 'U2', 'R', "R'", 'R2', 'F', "F'", 'F2'];

// ---- whole-cube rotations ---------------------------------------------------

// A whole-cube rotation is a relabeling of the cube. For a 2x2 it can be produced
// by turning both parallel layers together: x = R L', y = U D', z = F B'.
function rotState(state, gen) {
  return applySequence(state, gen);
}
const ROT_GENERATORS = [
  ['R', "L'"], // x
  ['U', "D'"], // y
  ['F', "B'"], // z
];

// Enumerate the 24 rotations as tables (each is "rotation applied to SOLVED").
const ROTATIONS = (() => {
  const seen = new Map();
  const list = [];
  const push = (s) => {
    const k = stateKey(s);
    if (!seen.has(k)) {
      seen.set(k, true);
      list.push(s);
    }
  };
  push(SOLVED);
  // BFS closure under the three generators.
  for (let i = 0; i < list.length; i++) {
    for (const gen of ROT_GENERATORS) push(rotState(list[i], gen));
  }
  return list; // exactly 24
})();

// Apply a rotation table to an arbitrary state (same additive form as a move).
function applyRotationTable(state, table) {
  const cp = new Array(8);
  const co = new Array(8);
  for (let j = 0; j < 8; j++) {
    const from = table.cp[j];
    cp[j] = state.cp[from];
    co[j] = (state.co[from] + table.co[j]) % 3;
  }
  return { cp, co };
}

// Rotate a state so cubie REF_CUBIE sits in slot REF_SLOT with orientation 0.
// Exactly one of the 24 rotations achieves this; return the normalized state.
export function normalize(state) {
  for (const table of ROTATIONS) {
    const r = applyRotationTable(state, table);
    if (r.cp[REF_SLOT] === REF_CUBIE && r.co[REF_SLOT] === 0) return r;
  }
  throw new Error('could not normalize state (invalid cube?)');
}

// ---- indexing ---------------------------------------------------------------

// The seven non-reference slots and a compact 0..6 id remapping.
const FREE_SLOTS = [0, 1, 2, 3, 4, 5, 7];
const ID_REMAP = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 7: 6 };
const ORI_SLOTS = [0, 1, 2, 3, 4, 5]; // co[6]=0 fixed, co[7] determined by parity

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040];

// Lehmer-code rank of the permutation of the 7 free corners -> 0..5039.
function permIndex(state) {
  const p = FREE_SLOTS.map((s) => ID_REMAP[state.cp[s]]);
  let index = 0;
  for (let i = 0; i < 7; i++) {
    let smaller = 0;
    for (let j = i + 1; j < 7; j++) if (p[j] < p[i]) smaller++;
    index += smaller * FACT[7 - 1 - i];
  }
  return index;
}

// Base-3 index of the six free orientations -> 0..728.
function oriIndex(state) {
  let index = 0;
  for (const s of ORI_SLOTS) index = index * 3 + state.co[s];
  return index;
}

// ---- pattern databases ------------------------------------------------------

const PERM_SIZE = 5040;
const ORI_SIZE = 729;

function buildDB(size, indexOf) {
  const dist = new Int8Array(size).fill(-1);
  const start = normalize(SOLVED); // == SOLVED, but explicit
  const startIdx = indexOf(start);
  dist[startIdx] = 0;
  let frontier = [start];
  let depth = 0;
  let filled = 1;
  while (frontier.length && filled < size) {
    const next = [];
    depth++;
    for (const st of frontier) {
      for (const m of SOLVE_MOVES) {
        const ns = applyMove(st, m);
        const idx = indexOf(ns);
        if (dist[idx] === -1) {
          dist[idx] = depth;
          filled++;
          next.push(ns);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

let PERM_DB = null;
let ORI_DB = null;
export function ensureTables() {
  if (!PERM_DB) PERM_DB = buildDB(PERM_SIZE, permIndex);
  if (!ORI_DB) ORI_DB = buildDB(ORI_SIZE, oriIndex);
}

function heuristic(state) {
  return Math.max(PERM_DB[permIndex(state)], ORI_DB[oriIndex(state)]);
}

// ---- IDA* -------------------------------------------------------------------

// The face letter of a move name, to forbid consecutive same-face turns.
function faceOf(m) {
  return m[0];
}

function idaSearch(state) {
  ensureTables();
  if (isSolved(state)) return [];
  let bound = heuristic(state);
  const path = [];

  function dfs(st, g, bound, lastFace) {
    const h = heuristic(st);
    const f = g + h;
    if (f > bound) return f;
    if (h === 0 && isSolved(st)) return 'FOUND';
    let min = Infinity;
    for (const m of SOLVE_MOVES) {
      if (faceOf(m) === lastFace) continue; // no two consecutive turns of one face
      const ns = applyMove(st, m);
      path.push(m);
      const t = dfs(ns, g + 1, bound, faceOf(m));
      if (t === 'FOUND') return 'FOUND';
      if (t < min) min = t;
      path.pop();
    }
    return min;
  }

  // 2x2 God's number in HTM is 11; the loop terminates well before this cap.
  for (let iter = 0; iter < 30; iter++) {
    const t = dfs(state, 0, bound, '');
    if (t === 'FOUND') return [...path];
    if (t === Infinity) throw new Error('no solution found (invalid cube?)');
    bound = t;
  }
  throw new Error('search exceeded expected depth');
}

// Public API: solve a (possibly unnormalized) state. Returns { normalized, moves }.
// `moves` is a list of move names (U, R', F2, ...) that, applied to `normalized`,
// solve the cube. If already solved, moves is [].
export function solve(rawState) {
  const normalized = normalize(rawState);
  const moves = idaSearch(normalized);
  return { normalized, moves };
}
