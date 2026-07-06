// solver3.js — a provably-correct, staged 3x3 solver (Thistlethwaite's algorithm).
//
// The cube is solved by walking down a chain of nested subgroups
//   G0 = <U,D,L,R,F,B>  ⊃  G1 = <U,D,L,R,F2,B2>
//                       ⊃  G2 = <U,D,F2,B2,L2,R2>
//                       ⊃  G3 = <U2,D2,F2,B2,L2,R2>  ⊃  {solved}.
// Each phase drives the cube into the next-smaller subgroup, using only that
// phase's allowed moves. For every phase we precompute, by a breadth-first search
// from the solved state, the EXACT distance from every coset to the goal, keyed by
// a "coordinate" that is a well-defined quotient of the state (a move-consistent
// function). Solving a phase is then plain gradient descent: at each step take any
// allowed move that strictly decreases the stored distance. Because the coordinate
// is move-consistent and the BFS distance is exact, such a move ALWAYS exists until
// the goal is reached — so every phase, and therefore every valid cube, provably
// solves. Typical solutions are ~30–50 moves (never optimal, always correct).
//
// The coordinates (each a move-consistent quotient):
//   Phase 1 — edge orientation. Goal eo=0.                        2,048 cosets.
//   Phase 2 — corner orientation + which slots hold the equator
//             edges. Goal co=0 and equator edges in the slice.  1,082,565 cosets.
//   Phase 3 — corner-permutation coset (a LEFT coset canonicalised against the G3
//             corner subgroup, hence move-consistent), edge tetrad occupancy, and
//             edge-permutation parity. Its zero value is reached exactly when the
//             cube lies in G3.                                     29,400 cosets.
//   Phase 4 — the whole remaining permutation inside G3.          663,552 cosets.
//
// Move tables come from cube3.js (themselves derived from the geometric oracle), so
// nothing here hand-encodes cube mechanics. The big phase-2 and phase-4 tables are
// built with fast integer transition tables (the coordinate factors into
// independent, move-consistent components) so the whole precompute takes a few
// seconds. Correctness is additionally gated in solver3.test.js by solving
// thousands of random scrambles and applying each solution back.

import {
  SOLVED,
  MOVES,
  applyMove,
  isSolved,
} from './cube3.js';

// ---- per-phase move sets ----------------------------------------------------
const P1_MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'L', "L'", 'L2', 'R', "R'", 'R2', 'F', "F'", 'F2', 'B', "B'", 'B2'];
const P2_MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'L', "L'", 'L2', 'R', "R'", 'R2', 'F2', 'B2'];
const P3_MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F2', 'B2', 'L2', 'R2'];
const P4_MOVES = ['U2', 'D2', 'F2', 'B2', 'L2', 'R2'];

export const PHASE_MOVES = { P1_MOVES, P2_MOVES, P3_MOVES, P4_MOVES };

// ---- small permutation helpers ----------------------------------------------
function compose(a, b) {
  // (a∘b)[i] = a[b[i]]
  const r = new Array(b.length);
  for (let i = 0; i < b.length; i++) r[i] = a[b[i]];
  return r;
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

// The subgroup of corner/edge permutations reachable with double turns only (G3).
function doubleTurnSubgroup(getP) {
  const set = new Map();
  const q = [SOLVED];
  set.set(getP(SOLVED).join(','), getP(SOLVED));
  let head = 0;
  while (head < q.length) {
    const st = q[head++];
    for (const m of P4_MOVES) {
      const ns = applyMove(st, m);
      const k = getP(ns).join(',');
      if (!set.has(k)) {
        set.set(k, getP(ns));
        q.push(ns);
      }
    }
  }
  return [...set.values()];
}

// ---- lazily-built state -----------------------------------------------------
let BUILT = false;
let G3_CORNERS = null; // 96 corner permutations
let EDGE_TETRAD = null; // edge id -> tetrad (0/1 U/D groups, 2 equator)
let CORNER_COSET_ID = null; // canonical left-coset leader -> integer id
const CORNER_COSET_CACHE = new Map(); // cp string -> coset id
let SLICE_RANK = null; // sorted 4-subset key -> 0..494
let CORNER_G3_INDEX = null; // G3 corner perm string -> 0..95
let EDGE_G3_INDEX = null; // G3 edge perm string -> 0..6911

let T1 = null; // Map coord -> dist
let T2 = null; // Int8Array over coIndex*495 + sliceIndex
let T3 = null; // Map coord -> dist
let T4 = null; // Int8Array over cornerIdx*|G3edge| + edgeIdx
let T4_EDGE_N = 0;

// Canonical representative of the LEFT coset G3corner∘cp. The LEFT coset is
// move-consistent under our right-multiplying move action, which is what lets
// gradient descent never get stuck. Zero iff cp ∈ G3corner.
function cornerLeader(cp) {
  let best = null;
  for (const g of G3_CORNERS) {
    const c = compose(g, cp).join(',');
    if (best === null || c < best) best = c;
  }
  return best;
}
function cornerCosetOf(cp) {
  const key = cp.join(',');
  let v = CORNER_COSET_CACHE.get(key);
  if (v === undefined) {
    v = CORNER_COSET_ID.get(cornerLeader(cp));
    CORNER_COSET_CACHE.set(key, v);
  }
  return v;
}

// ---- coordinate functions for the Map-based phases (P1, P3) -----------------
function coordP1(s) {
  return s.eo.join('');
}
function coordP3(s) {
  let occ = '';
  for (let j = 0; j < 12; j++) occ += EDGE_TETRAD[s.ep[j]];
  return cornerCosetOf(s.cp) + '|' + occ + '|' + permParity(s.ep);
}

// ---- integer coordinate pieces for P2, P4 -----------------------------------
function coIndexOf(s) {
  let idx = 0;
  for (let j = 6; j >= 0; j--) idx = idx * 3 + s.co[j];
  return idx;
}
function sliceIndexOf(s) {
  const set = [];
  for (let j = 0; j < 12; j++) if (EDGE_TETRAD[s.ep[j]] === 2) set.push(j);
  return SLICE_RANK.get(set.join(','));
}
function distP2(s) {
  return T2[coIndexOf(s) * 495 + sliceIndexOf(s)];
}
function distP4(s) {
  const ci = CORNER_G3_INDEX.get(s.cp.join(','));
  const ei = EDGE_G3_INDEX.get(s.ep.join(','));
  return T4[ci * T4_EDGE_N + ei];
}

// ---- generic exact BFS distance table over a Map coordinate -----------------
function buildMapTable(coordFn, moves) {
  const dist = new Map();
  dist.set(coordFn(SOLVED), 0);
  let frontier = [SOLVED];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    depth++;
    for (const st of frontier) {
      for (const m of moves) {
        const ns = applyMove(st, m);
        const c = coordFn(ns);
        if (!dist.has(c)) {
          dist.set(c, depth);
          next.push(ns);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

// BFS over a product of two independent, move-consistent integer coordinates,
// each supplied as a transition table transA[a][m] / transB[b][m]. Returns an
// Int8Array of distances indexed by a*sizeB + b.
function buildProductTable(sizeA, transA, startA, sizeB, transB, startB, nMoves) {
  const total = sizeA * sizeB;
  const dist = new Int8Array(total).fill(-1);
  const start = startA * sizeB + startB;
  dist[start] = 0;
  let frontier = [start];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    depth++;
    for (const idx of frontier) {
      const a = (idx / sizeB) | 0;
      const b = idx - a * sizeB;
      for (let m = 0; m < nMoves; m++) {
        const ni = transA[a][m] * sizeB + transB[b][m];
        if (dist[ni] === -1) {
          dist[ni] = depth;
          next.push(ni);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

export function ensureTables() {
  if (BUILT) return;

  G3_CORNERS = doubleTurnSubgroup((s) => s.cp);

  // edge tetrads via the double-turn orbit structure (2 U/D groups + equator=2).
  {
    const arrangements = doubleTurnSubgroup((s) => s.ep);
    const slotsForId = Array.from({ length: 12 }, () => new Set());
    for (const a of arrangements) for (let s = 0; s < 12; s++) slotsForId[a[s]].add(s);
    const label = new Map();
    let next = 0;
    EDGE_TETRAD = new Array(12);
    for (let id = 0; id < 12; id++) {
      const key = [...slotsForId[id]].sort((a, b) => a - b).join(',');
      if (!label.has(key)) label.set(key, next++);
      EDGE_TETRAD[id] = label.get(key);
    }
    // equator group (edges 8..11) must read as tetrad 2 for the slice coords.
    const equatorLabel = EDGE_TETRAD[8];
    if (equatorLabel !== 2) {
      for (let id = 0; id < 12; id++) {
        if (EDGE_TETRAD[id] === equatorLabel) EDGE_TETRAD[id] = 2;
        else if (EDGE_TETRAD[id] === 2) EDGE_TETRAD[id] = equatorLabel;
      }
    }
  }

  // corner coset ids: number the left-coset leaders of every G2 corner perm.
  {
    CORNER_COSET_ID = new Map();
    const vis = new Set([SOLVED.cp.join(',')]);
    const q = [SOLVED];
    let head = 0;
    while (head < q.length) {
      const st = q[head++];
      const lead = cornerLeader(st.cp);
      if (!CORNER_COSET_ID.has(lead)) CORNER_COSET_ID.set(lead, CORNER_COSET_ID.size);
      for (const m of P3_MOVES) {
        const ns = applyMove(st, m);
        const k = ns.cp.join(',');
        if (!vis.has(k)) {
          vis.add(k);
          q.push(ns);
        }
      }
    }
  }

  // ---- Phase 1 (Map, 2048) ----
  T1 = buildMapTable(coordP1, P1_MOVES);

  // ---- Phase 3 (Map, 29400) ----
  T3 = buildMapTable(coordP3, P3_MOVES);

  // ---- Phase 2 (integer product: co 2187 × slice 495) ----
  {
    // enumerate 4-subsets of 12 slots -> rank 0..494
    SLICE_RANK = new Map();
    const subsets = [];
    for (let a = 0; a < 12; a++)
      for (let b = a + 1; b < 12; b++)
        for (let c = b + 1; c < 12; c++)
          for (let d = c + 1; d < 12; d++) {
            SLICE_RANK.set(`${a},${b},${c},${d}`, subsets.length);
            subsets.push([a, b, c, d]);
          }
    // co transition table (2187 × 14). Decode co[0..6], co[7] fixed by twist sum.
    const coTrans = new Array(2187);
    for (let v = 0; v < 2187; v++) {
      const co = new Array(8);
      let t = v;
      let sum = 0;
      for (let j = 0; j < 7; j++) {
        co[j] = t % 3;
        t = (t / 3) | 0;
        sum += co[j];
      }
      co[7] = (3 - (sum % 3)) % 3;
      coTrans[v] = new Array(P2_MOVES.length);
      for (let mi = 0; mi < P2_MOVES.length; mi++) {
        const tab = MOVES[P2_MOVES[mi]];
        let idx = 0;
        for (let j = 6; j >= 0; j--) idx = idx * 3 + (co[tab.cp[j]] + tab.co[j]) % 3;
        coTrans[v][mi] = idx;
      }
    }
    // slice transition table (495 × 14). Membership over 12 slots.
    const sliceTrans = new Array(495);
    for (let r = 0; r < 495; r++) {
      const mem = new Array(12).fill(false);
      for (const s of subsets[r]) mem[s] = true;
      sliceTrans[r] = new Array(P2_MOVES.length);
      for (let mi = 0; mi < P2_MOVES.length; mi++) {
        const tab = MOVES[P2_MOVES[mi]];
        const set = [];
        for (let j = 0; j < 12; j++) if (mem[tab.ep[j]]) set.push(j);
        sliceTrans[r][mi] = SLICE_RANK.get(set.join(','));
      }
    }
    T2 = buildProductTable(2187, coTrans, 0, 495, sliceTrans, sliceIndexOf(SOLVED), P2_MOVES.length);
  }

  // ---- Phase 4 (integer product: G3 corner perms × G3 edge perms) ----
  {
    const cornerArrs = G3_CORNERS; // 96
    CORNER_G3_INDEX = new Map();
    cornerArrs.forEach((cp, i) => CORNER_G3_INDEX.set(cp.join(','), i));
    const edgeArrs = doubleTurnSubgroup((s) => s.ep); // 6912
    EDGE_G3_INDEX = new Map();
    edgeArrs.forEach((ep, i) => EDGE_G3_INDEX.set(ep.join(','), i));
    T4_EDGE_N = edgeArrs.length;
    const cornerTrans = cornerArrs.map((cp) =>
      P4_MOVES.map((m) => CORNER_G3_INDEX.get(compose(cp, MOVES[m].cp).join(',')))
    );
    const edgeTrans = edgeArrs.map((ep) =>
      P4_MOVES.map((m) => EDGE_G3_INDEX.get(compose(ep, MOVES[m].ep).join(',')))
    );
    T4 = buildProductTable(
      cornerArrs.length, cornerTrans, 0,
      edgeArrs.length, edgeTrans, 0,
      P4_MOVES.length
    );
  }

  BUILT = true;
}

// ---- gradient descent through one phase -------------------------------------
function solvePhase(state, distFn, moves) {
  let s = state;
  const out = [];
  let guard = 0;
  let cur = distFn(s);
  while (cur !== 0) {
    let best = null;
    let bestDist = cur;
    for (const m of moves) {
      const ns = applyMove(s, m);
      const d = distFn(ns);
      if (d !== undefined && d !== -1 && d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
    if (best === null) throw new Error('solver3: phase stuck (invalid cube?)');
    s = applyMove(s, best);
    out.push(best);
    cur = bestDist;
    if (guard++ > 100) throw new Error('solver3: phase exceeded expected depth');
  }
  return { state: s, moves: out };
}

// Public API: solve a valid 3x3 state. Centers fix the frame, so there is no
// normalization. Returns { moves } — move names that, applied to the input state,
// solve the cube. Already-solved yields [].
export function solve(rawState) {
  ensureTables();
  if (isSolved(rawState)) return { moves: [] };
  const moves = [];
  let r = solvePhase(rawState, (s) => T1.get(coordP1(s)), P1_MOVES);
  moves.push(...r.moves);
  r = solvePhase(r.state, distP2, P2_MOVES);
  moves.push(...r.moves);
  r = solvePhase(r.state, (s) => T3.get(coordP3(s)), P3_MOVES);
  moves.push(...r.moves);
  r = solvePhase(r.state, distP4, P4_MOVES);
  moves.push(...r.moves);
  return { moves };
}

export { SOLVED };
