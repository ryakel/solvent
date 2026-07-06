// cube3.js — Compact algebraic model of the 3x3 cube, DERIVED from geometry3.js.
//
// State = { cp:Int[8], co:Int[8], ep:Int[12], eo:Int[12] }:
//   cp[j] = id of the corner cubie currently in corner slot j
//   co[j] = corner orientation (0,1,2); 0 means its White/Yellow sticker faces U/D
//   ep[j] = id of the edge cubie currently in edge slot j
//   eo[j] = edge orientation (0,1); 0 means its "primary" sticker faces along the
//           slot's reference axis (see canonicalOrder2)
//
// Both orientations are defined so they compose ADDITIVELY under every face turn
// (corner co is the same parity-aware scheme cube2.js uses; edge eo is a
// pure-position cocycle). Move tables are NOT hand-written: they are extracted
// from the geometric oracle at load time, and cube3.test.js proves the fast
// additive apply agrees with the slow geometric simulation over thousands of
// random sequences.
//
// The 6 centers are fixed by construction — they define the color frame — so they
// carry no state and no whole-cube normalization is ever needed.

import { FACES, SLOTS } from './geometry.js';
import { solvedGeom3, applyGeomMove3, cubieKind } from './geometry3.js';

// The 12 edge slots in canonical (Kociemba) order. `name` lists the two faces the
// edge touches; `pos` is its integer coordinate (exactly one zero coord).
export const EDGE_SLOTS = [
  { name: 'UR', pos: [+1, +1, 0] },
  { name: 'UF', pos: [0, +1, +1] },
  { name: 'UL', pos: [-1, +1, 0] },
  { name: 'UB', pos: [0, +1, -1] },
  { name: 'DR', pos: [+1, -1, 0] },
  { name: 'DF', pos: [0, -1, +1] },
  { name: 'DL', pos: [-1, -1, 0] },
  { name: 'DB', pos: [0, -1, -1] },
  { name: 'FR', pos: [+1, 0, +1] },
  { name: 'FL', pos: [-1, 0, +1] },
  { name: 'BL', pos: [-1, 0, -1] },
  { name: 'BR', pos: [+1, 0, -1] },
];

export const SOLVED = {
  cp: [0, 1, 2, 3, 4, 5, 6, 7],
  co: [0, 0, 0, 0, 0, 0, 0, 0],
  ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

// ---- geometry <-> compact-state bridge --------------------------------------

function posEq(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function cornerSlotOfPos(pos) {
  for (let i = 0; i < SLOTS.length; i++) if (posEq(SLOTS[i].pos, pos)) return i;
  throw new Error('no corner slot at ' + pos);
}
function edgeSlotOfPos(pos) {
  for (let i = 0; i < EDGE_SLOTS.length; i++) if (posEq(EDGE_SLOTS[i].pos, pos)) return i;
  throw new Error('no edge slot at ' + pos);
}

function axisOfNormal(normal) {
  return normal[0] !== 0 ? 0 : normal[1] !== 0 ? 1 : 2;
}

// --- corner orientation: identical parity-aware scheme as cube2.js -----------
// The y (U/D) axis is index 0 of a corner's canonical order (so a solved corner
// has orientation 0); the other two axes are ordered by chirality so that a face
// rotation adds a constant twist regardless of the incoming orientation.
function canonicalOrder(pos) {
  const parity = pos[0] * pos[1] * pos[2];
  return parity > 0 ? [1, 0, 2] : [1, 2, 0];
}
function cornerOrderIndexOfAxis(pos, axis) {
  return canonicalOrder(pos).indexOf(axis);
}

// --- edge orientation: a pure-position cocycle (additive) --------------------
// canonicalOrder2(pos) lists the edge slot's two occupied axes with the slot's
// "reference axis" first: the U/D axis (y) for the 8 U/D-layer edges, else the
// F/B axis (z) for the 4 equator edges. Orientation is the index (0 or 1) of the
// edge's primary sticker within this order. Because the order depends only on the
// slot position, the induced orientation change per move is independent of the
// piece — i.e. orientation is additive (proven by the cross-check test) — and in
// the solved state every edge reads orientation 0.
function canonicalOrder2(pos) {
  const occ = [0, 1, 2].filter((a) => pos[a] !== 0);
  const ref = pos[1] !== 0 ? 1 : 2; // y for U/D edges, z for equator edges
  const other = occ.find((a) => a !== ref);
  return [ref, other];
}
function edgeOrderIndexOfAxis(pos, axis) {
  return canonicalOrder2(pos).indexOf(axis);
}

// A cubie's identity = the slot it belongs to when solved, keyed by its unordered
// color set. Built once from the oracle.
const CORNER_ID = new Map();
const EDGE_ID = new Map();
(function buildIdMaps() {
  const g = solvedGeom3();
  let cIdx = 0;
  let eIdx = 0;
  for (const cubie of g) {
    const kind = cubieKind(cubie.pos);
    const key = cubie.stickers.map((s) => s.color).sort().join('');
    if (kind === 'corner') CORNER_ID.set(key, cornerSlotOfPos(cubie.pos));
    else if (kind === 'edge') EDGE_ID.set(key, edgeSlotOfPos(cubie.pos));
    void cIdx;
    void eIdx;
  }
})();

function colorSetKey(cubie) {
  return cubie.stickers.map((s) => s.color).sort().join('');
}

// For each corner id, its three colors in that corner's own canonical order
// (index 0 = the primary U/D color). For each edge id, its two colors in canonical
// order (index 0 = primary). Built from the oracle's solved state.
const CORNER_COLORS_IN_ORDER = new Array(8);
const EDGE_COLORS_IN_ORDER = new Array(12);
(function buildColorOrder() {
  const g = solvedGeom3();
  for (const cubie of g) {
    const kind = cubieKind(cubie.pos);
    if (kind === 'corner') {
      const id = cornerSlotOfPos(cubie.pos);
      const byAxis = [null, null, null];
      for (const s of cubie.stickers) byAxis[axisOfNormal(s.normal)] = s.color;
      CORNER_COLORS_IN_ORDER[id] = canonicalOrder(cubie.pos).map((a) => byAxis[a]);
    } else if (kind === 'edge') {
      const id = edgeSlotOfPos(cubie.pos);
      const byAxis = [null, null, null];
      for (const s of cubie.stickers) byAxis[axisOfNormal(s.normal)] = s.color;
      EDGE_COLORS_IN_ORDER[id] = canonicalOrder2(cubie.pos).map((a) => byAxis[a]);
    }
  }
})();

// Which of a corner's two non-primary orders is "primary" for edges: the primary
// color is EDGE_COLORS_IN_ORDER[id][0]; for corners the primary color is the
// White/Yellow sticker.
function cornerOrientationOf(cubie) {
  for (const s of cubie.stickers) {
    if (s.color === 'W' || s.color === 'Y') {
      return cornerOrderIndexOfAxis(cubie.pos, axisOfNormal(s.normal));
    }
  }
  throw new Error('corner has no U/D sticker');
}

function edgeIdOf(cubie) {
  const id = EDGE_ID.get(colorSetKey(cubie));
  if (id === undefined) throw new Error('unknown edge colors: ' + colorSetKey(cubie));
  return id;
}
function cornerIdOf(cubie) {
  const id = CORNER_ID.get(colorSetKey(cubie));
  if (id === undefined) throw new Error('unknown corner colors: ' + colorSetKey(cubie));
  return id;
}

// The primary color of an edge id (index 0 of its canonical color order).
function edgeOrientationOf(cubie) {
  const id = edgeIdOf(cubie);
  const primaryColor = EDGE_COLORS_IN_ORDER[id][0];
  for (const s of cubie.stickers) {
    if (s.color === primaryColor) {
      return edgeOrderIndexOfAxis(cubie.pos, axisOfNormal(s.normal));
    }
  }
  throw new Error('edge missing its primary sticker');
}

export function stateFromGeom3(geom) {
  const cp = new Array(8);
  const co = new Array(8);
  const ep = new Array(12);
  const eo = new Array(12);
  for (const cubie of geom) {
    const kind = cubieKind(cubie.pos);
    if (kind === 'corner') {
      const j = cornerSlotOfPos(cubie.pos);
      cp[j] = cornerIdOf(cubie);
      co[j] = cornerOrientationOf(cubie);
    } else if (kind === 'edge') {
      const j = edgeSlotOfPos(cubie.pos);
      ep[j] = edgeIdOf(cubie);
      eo[j] = edgeOrientationOf(cubie);
    }
    // centers carry no state
  }
  return { cp, co, ep, eo };
}

export function geomFromState3(state) {
  const cubies = [];
  // centers (fixed)
  for (const [, f] of Object.entries(FACES)) {
    const pos = [0, 0, 0];
    pos[f.axis] = f.sign;
    const normal = [0, 0, 0];
    normal[f.axis] = f.sign;
    cubies.push({ pos: [...pos], stickers: [{ normal, color: f.color }] });
  }
  // corners
  for (let j = 0; j < 8; j++) {
    const slot = SLOTS[j];
    const id = state.cp[j];
    const twist = state.co[j];
    const colorsInOrder = CORNER_COLORS_IN_ORDER[id];
    const stickers = [];
    for (let axis = 0; axis < 3; axis++) {
      const normal = [0, 0, 0];
      normal[axis] = slot.pos[axis];
      const k = cornerOrderIndexOfAxis(slot.pos, axis);
      const color = colorsInOrder[((k - twist) % 3 + 3) % 3];
      stickers.push({ normal, color });
    }
    cubies.push({ pos: [...slot.pos], stickers });
  }
  // edges
  for (let j = 0; j < 12; j++) {
    const slot = EDGE_SLOTS[j];
    const id = state.ep[j];
    const flip = state.eo[j];
    const [primary, secondary] = EDGE_COLORS_IN_ORDER[id];
    const order = canonicalOrder2(slot.pos);
    const stickers = [];
    for (let k = 0; k < 2; k++) {
      const axis = order[k];
      const normal = [0, 0, 0];
      normal[axis] = slot.pos[axis];
      // primary sticker sits at order-index `flip`.
      const color = k === flip ? primary : secondary;
      stickers.push({ normal, color });
    }
    cubies.push({ pos: [...slot.pos], stickers });
  }
  return cubies;
}

// ---- move tables (extracted from geometry) ----------------------------------

function deriveTable(face, times) {
  const moved = stateFromGeom3(applyGeomMove3(solvedGeom3(), face, times));
  return { cp: moved.cp, co: moved.co, ep: moved.ep, eo: moved.eo };
}

export const MOVES = {};
for (const face of Object.keys(FACES)) {
  MOVES[face] = deriveTable(face, 1);
  MOVES[face + "'"] = deriveTable(face, -1);
  MOVES[face + '2'] = deriveTable(face, 2);
}

// Fast additive apply. Proven equivalent to geometry in the tests.
export function applyMove(state, moveName) {
  const t = MOVES[moveName];
  if (!t) throw new Error('unknown move ' + moveName);
  const cp = new Array(8);
  const co = new Array(8);
  const ep = new Array(12);
  const eo = new Array(12);
  for (let j = 0; j < 8; j++) {
    const from = t.cp[j];
    cp[j] = state.cp[from];
    co[j] = (state.co[from] + t.co[j]) % 3;
  }
  for (let j = 0; j < 12; j++) {
    const from = t.ep[j];
    ep[j] = state.ep[from];
    eo[j] = (state.eo[from] + t.eo[j]) % 2;
  }
  return { cp, co, ep, eo };
}

export function applySequence(state, moveNames) {
  let s = state;
  for (const m of moveNames) s = applyMove(s, m);
  return s;
}

export function isSolved(state) {
  for (let i = 0; i < 8; i++) if (state.cp[i] !== i || state.co[i] !== 0) return false;
  for (let i = 0; i < 12; i++) if (state.ep[i] !== i || state.eo[i] !== 0) return false;
  return true;
}

export function statesEqual(a, b) {
  for (let i = 0; i < 8; i++) if (a.cp[i] !== b.cp[i] || a.co[i] !== b.co[i]) return false;
  for (let i = 0; i < 12; i++) if (a.ep[i] !== b.ep[i] || a.eo[i] !== b.eo[i]) return false;
  return true;
}

export function cloneState(s) {
  return { cp: [...s.cp], co: [...s.co], ep: [...s.ep], eo: [...s.eo] };
}

// A compact string key for hashing/visited-sets.
export function stateKey(state) {
  return state.cp.join(',') + '|' + state.co.join('') + '|' + state.ep.join(',') + '|' + state.eo.join('');
}

export const ALL_MOVE_NAMES = Object.keys(MOVES);
