// cube2.js — Compact algebraic model of the 2x2 cube, DERIVED from geometry.js.
//
// State = { cp: Int[8], co: Int[8] }:
//   cp[j] = which cubie (id 0..7) currently sits in slot j
//   co[j] = orientation of that cubie (0,1,2); 0 means its White/Yellow sticker
//           faces the U/D axis.
//
// Move tables are not hand-written: they are extracted from the geometric oracle
// at load time, and cube2.test.js proves the fast additive apply agrees with the
// slow geometric simulation over thousands of random sequences.

import {
  FACES,
  SLOTS,
  solvedGeom,
  applyGeomMove,
  colorOfNormal,
} from './geometry.js';

export const SOLVED = { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] };

// ---- geometry <-> compact-state bridge --------------------------------------

// Map a slot position [x,y,z] to its slot index.
function slotIndexOfPos(pos) {
  for (let i = 0; i < SLOTS.length; i++) {
    const p = SLOTS[i].pos;
    if (p[0] === pos[0] && p[1] === pos[1] && p[2] === pos[2]) return i;
  }
  throw new Error('no slot at ' + pos);
}

// A cubie's identity = the slot it belongs in when solved, keyed by its unordered
// set of sticker colors.
const COLORSET_TO_ID = (() => {
  const m = new Map();
  const g = solvedGeom();
  for (let id = 0; id < g.length; id++) {
    const key = g[id].stickers
      .map((s) => s.color)
      .sort()
      .join('');
    m.set(key, id);
  }
  return m;
})();

// Canonical cyclic order of a slot's three axes. Orientation is the index of a
// sticker within this order. The order is parity-aware: this is what makes corner
// orientation ADDITIVE under every face turn (proven by the cross-check test).
// Derivation: the y (U/D) axis is always index 0 (so solved => orientation 0);
// the remaining two axes are ordered by the corner's chirality (product of its
// position signs), so a face rotation adds a constant twist regardless of the
// incoming orientation.
function canonicalOrder(pos) {
  const parity = pos[0] * pos[1] * pos[2]; // +1 or -1
  return parity > 0 ? [1, 0, 2] : [1, 2, 0];
}

function orderIndexOfAxis(pos, axis) {
  const order = canonicalOrder(pos);
  return order.indexOf(axis);
}

function axisOfNormal(normal) {
  return normal[0] !== 0 ? 0 : normal[1] !== 0 ? 1 : 2;
}

// For each cubie id, its three colors listed in its own SOLVED canonical order.
// Index 0 is always the primary (White/Yellow) color.
const SOLVED_COLORS_IN_ORDER = (() => {
  const g = solvedGeom();
  return g.map((cubie, id) => {
    const byAxis = [null, null, null];
    for (const s of cubie.stickers) byAxis[axisOfNormal(s.normal)] = s.color;
    const order = canonicalOrder(SLOTS[id].pos);
    return order.map((axis) => byAxis[axis]);
  });
})();

function cubieIdOf(cubie) {
  const key = cubie.stickers
    .map((s) => s.color)
    .sort()
    .join('');
  const id = COLORSET_TO_ID.get(key);
  if (id === undefined) throw new Error('unknown cubie colors: ' + key);
  return id;
}

// Orientation of a cubie in the slot at `pos`: the canonical-order index of its
// White/Yellow ("primary") sticker.
function orientationOf(cubie) {
  for (const s of cubie.stickers) {
    if (s.color === 'W' || s.color === 'Y') {
      return orderIndexOfAxis(cubie.pos, axisOfNormal(s.normal));
    }
  }
  throw new Error('corner has no U/D sticker');
}

export function stateFromGeom(geom) {
  const cp = new Array(8);
  const co = new Array(8);
  for (const cubie of geom) {
    const j = slotIndexOfPos(cubie.pos);
    cp[j] = cubieIdOf(cubie);
    co[j] = orientationOf(cubie);
  }
  return { cp, co };
}

export function geomFromState(state) {
  return SLOTS.map((slot, j) => {
    const id = state.cp[j];
    const twist = state.co[j];
    const colorsInOrder = SOLVED_COLORS_IN_ORDER[id];
    const stickers = [];
    for (let axis = 0; axis < 3; axis++) {
      const normal = [0, 0, 0];
      normal[axis] = slot.pos[axis];
      // Color on this axis = the cubie color whose canonical-order index, shifted
      // by the twist, lands on this axis's order index.
      const k = orderIndexOfAxis(slot.pos, axis);
      const color = colorsInOrder[((k - twist) % 3 + 3) % 3];
      stickers.push({ normal, color });
    }
    return { pos: [...slot.pos], stickers };
  });
}

// ---- move tables (extracted from geometry) ----------------------------------

// A move applied to the solved state reveals its permutation/orientation table:
//   perm[j]  = cp of the moved-solved state (where slot j's cubie came from)
//   oriAdd[j]= co of the moved-solved state (twist injected into slot j)
function deriveTable(face, times) {
  const moved = stateFromGeom(applyGeomMove(solvedGeom(), face, times));
  return { perm: moved.cp, oriAdd: moved.co };
}

// Base quarter-turn tables for every face; higher turns are derived by repetition
// but we extract them directly from geometry to stay honest.
export const MOVES = {};
for (const face of Object.keys(FACES)) {
  MOVES[face] = deriveTable(face, 1); //  clockwise
  MOVES[face + "'"] = deriveTable(face, -1); // counter-clockwise
  MOVES[face + '2'] = deriveTable(face, 2); // half turn
}

// Fast additive apply. Proven equivalent to geometry in the tests.
export function applyMove(state, moveName) {
  const t = MOVES[moveName];
  if (!t) throw new Error('unknown move ' + moveName);
  const cp = new Array(8);
  const co = new Array(8);
  for (let j = 0; j < 8; j++) {
    const from = t.perm[j];
    cp[j] = state.cp[from];
    co[j] = (state.co[from] + t.oriAdd[j]) % 3;
  }
  return { cp, co };
}

export function applySequence(state, moveNames) {
  let s = state;
  for (const m of moveNames) s = applyMove(s, m);
  return s;
}

export function isSolved(state) {
  for (let i = 0; i < 8; i++) if (state.cp[i] !== i || state.co[i] !== 0) return false;
  return true;
}

export function statesEqual(a, b) {
  for (let i = 0; i < 8; i++) if (a.cp[i] !== b.cp[i] || a.co[i] !== b.co[i]) return false;
  return true;
}

export function cloneState(s) {
  return { cp: [...s.cp], co: [...s.co] };
}

// A compact integer key for hashing/visited-sets.
export function stateKey(state) {
  let k = 0;
  for (let i = 0; i < 8; i++) k = k * 8 + state.cp[i];
  for (let i = 0; i < 8; i++) k = k * 3 + state.co[i];
  return k;
}

export const ALL_MOVE_NAMES = Object.keys(MOVES);

export { colorOfNormal };
