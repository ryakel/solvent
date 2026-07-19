// facelet3.js — the 3x3 sticker-grid representation used by scanning, correction,
// and validation, plus conversion to/from the solver's compact state.
//
// A "faces" object maps each face letter to an array of 9 color letters in reading
// order (row-major: 3 rows of 3, top-left first). The 3x3 uses the SAME per-face
// VIEW basis as the 2x2 (facelet.js), just a 3x3 grid, so the two sizes read a
// face the same way. The face<->cubie mapping is derived from geometry3.js so it
// stays consistent with the renderer and solver. facelet3.test.js proves the
// round-trip state -> faces -> state is the identity.

import { FACES, FACE_ORDER, COLORS } from './geometry.js';
import { SLOTS } from './geometry.js';
import {
  solvedGeom3,
  cubieKind,
  cubeOrientations3,
  reflectGeom3,
  geomEquals3,
} from './geometry3.js';
import {
  SOLVED,
  EDGE_SLOTS,
  geomFromState3,
  stateFromGeom3,
  statesEqual,
} from './cube3.js';

export const N = 3; // stickers per face edge (3x3).

// Per-face 2D view basis: `u` points to the viewer's right, `v` points down, when
// the face is held in the documented orientation (White up, Green front). Same
// basis as facelet.js — one source of truth for how a face reads.
const VIEW = {
  U: { u: [1, 0, 0], v: [0, 0, 1] },
  D: { u: [1, 0, 0], v: [0, 0, -1] },
  F: { u: [1, 0, 0], v: [0, -1, 0] },
  B: { u: [-1, 0, 0], v: [0, -1, 0] },
  R: { u: [0, 0, -1], v: [0, -1, 0] },
  L: { u: [0, 0, 1], v: [0, -1, 0] },
};

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function posKey(p) {
  return p.join(',');
}

// FACE_CELL_POS[face][idx] = the integer position of the cubie showing sticker idx.
const FACE_CELL_POS = (() => {
  const g = solvedGeom3();
  const map = {};
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    const { u, v } = VIEW[face];
    map[face] = new Array(N * N);
    for (const cubie of g) {
      const pos = cubie.pos;
      if (pos[axis] !== sign) continue;
      const col = dot(pos, u) + 1; // -1,0,1 -> 0,1,2
      const row = dot(pos, v) + 1;
      map[face][row * N + col] = pos;
    }
  }
  return map;
})();

// POS_TO_CELLS[posKey] = [{ face, idx, axis, sign }] for each face this cubie shows on.
const POS_TO_CELLS = (() => {
  const m = new Map();
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    FACE_CELL_POS[face].forEach((pos, idx) => {
      const k = posKey(pos);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ face, idx, axis, sign });
    });
  }
  return m;
})();

// The center cell index (middle of the grid) and each face's fixed center color.
const CENTER_IDX = 4; // row 1, col 1
const CENTER_COLOR = Object.fromEntries(FACE_ORDER.map((f) => [f, FACES[f].color]));

// geometry -> faces (reads the sticker grid off any 3x3 geometry).
export function facesFromGeom3(geom) {
  const byPos = new Map();
  for (const cubie of geom) byPos.set(posKey(cubie.pos), cubie);
  const faces = {};
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    faces[face] = FACE_CELL_POS[face].map((pos) => {
      const cubie = byPos.get(posKey(pos));
      const st = cubie.stickers.find((s) => s.normal[axis] === sign);
      return st.color;
    });
  }
  return faces;
}

// state -> faces (in the canonical frame: White up, Green front).
export function faceColorsFromState(state) {
  return facesFromGeom3(geomFromState3(state));
}

export const SOLVED_FACES = faceColorsFromState(SOLVED);

// faces -> geometry (may be an invalid cube; validate first). Centers are fixed by
// construction; the corner/edge stickers come from the grid.
function geomFromFaces(faces) {
  const cubies = [];
  // centers (fixed frame)
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    const pos = [0, 0, 0];
    pos[axis] = sign;
    const normal = [0, 0, 0];
    normal[axis] = sign;
    cubies.push({ pos, stickers: [{ normal, color: CENTER_COLOR[face] }] });
  }
  const build = (pos) => {
    const stickers = [];
    for (const cell of POS_TO_CELLS.get(posKey(pos))) {
      const normal = [0, 0, 0];
      normal[cell.axis] = cell.sign;
      stickers.push({ normal, color: faces[cell.face][cell.idx] });
    }
    return { pos: [...pos], stickers };
  };
  for (const slot of SLOTS) cubies.push(build(slot.pos));
  for (const slot of EDGE_SLOTS) cubies.push(build(slot.pos));
  return cubies;
}

// faces -> geometry keeping the ACTUAL scanned colors, centers included (unlike
// geomFromFaces, which forces the canonical center colors). Used to reflect a
// mirror-scheme scan and to render the solve in the user's own colors. Requires a
// filled faces object.
function geomFromRawFaces(faces) {
  const cubies = [];
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    const pos = [0, 0, 0];
    pos[axis] = sign;
    const normal = [0, 0, 0];
    normal[axis] = sign;
    cubies.push({ pos, stickers: [{ normal, color: faces[face][CENTER_IDX] }] });
  }
  const build = (pos) => {
    const stickers = [];
    for (const cell of POS_TO_CELLS.get(posKey(pos))) {
      const normal = [0, 0, 0];
      normal[cell.axis] = cell.sign;
      stickers.push({ normal, color: faces[cell.face][cell.idx] });
    }
    return { pos: [...pos], stickers };
  };
  for (const slot of SLOTS) cubies.push(build(slot.pos));
  for (const slot of EDGE_SLOTS) cubies.push(build(slot.pos));
  return cubies;
}

// Reflect a filled faces object through the x=0 plane (see reflectGeom3). A
// mirror-scheme scan becomes a standard-chirality one that the normal pipeline
// validates and solves; the solution moves are reflected back to physical turns.
export function reflectFaces(faces) {
  return facesFromGeom3(reflectGeom3(geomFromRawFaces(faces)));
}

export { geomFromRawFaces };

// The real pieces and opposite-color pairs, from the oracle.
const REAL_CORNER_SETS = new Set();
const REAL_EDGE_SETS = new Set();
(function () {
  for (const cubie of solvedGeom3()) {
    const kind = cubieKind(cubie.pos);
    const key = cubie.stickers.map((s) => s.color).sort().join('');
    if (kind === 'corner') REAL_CORNER_SETS.add(key);
    else if (kind === 'edge') REAL_EDGE_SETS.add(key);
  }
})();
const OPPOSITE = { W: 'Y', Y: 'W', G: 'B', B: 'G', R: 'O', O: 'R' };
const COLOR_NAMES = { W: 'White', Y: 'Yellow', G: 'Green', B: 'Blue', R: 'Red', O: 'Orange' };
const FACE_NAMES = { U: 'Up', D: 'Down', F: 'Front', B: 'Back', L: 'Left', R: 'Right' };

// A specific, actionable reason the 6 centers don't form a real cube — a repeated
// center colour, or two opposite faces that aren't an opposite pair — instead of a
// vague "not a real cube". Centres are fixed on a 3x3, so this is the single most
// common hand-entry slip (two faces given the same center) and it should name the
// exact faces to fix.
function diagnoseCenters(faces) {
  const centers = {};
  for (const f of FACE_ORDER) centers[f] = faces[f][CENTER_IDX];

  // Repeated center colour: name every face that shares it.
  const byColor = {};
  for (const f of FACE_ORDER) (byColor[centers[f]] ||= []).push(f);
  for (const color of COLORS) {
    const fs = byColor[color];
    if (fs && fs.length > 1) {
      const names = fs.map((f) => `${FACE_NAMES[f]}`);
      const list =
        names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
      return (
        `The ${list} centers are ${fs.length > 2 ? 'all' : 'both'} ${COLOR_NAMES[color]}, ` +
        `but every face has a different center color. ` +
        `Re-check ${fs.length > 2 ? 'those centers' : 'one of them'}.`
      );
    }
  }

  // Six distinct centers but an impossible pairing: opposite faces must be an
  // opposite colour pair (White–Yellow, Green–Blue, Red–Orange).
  for (const [a, b] of [['U', 'D'], ['F', 'B'], ['L', 'R']]) {
    if (OPPOSITE[centers[a]] !== centers[b]) {
      return (
        `The ${FACE_NAMES[a]} and ${FACE_NAMES[b]} centers are ${COLOR_NAMES[centers[a]]} ` +
        `and ${COLOR_NAMES[centers[b]]}, but opposite faces must be an opposite pair ` +
        `(White–Yellow, Green–Blue, Red–Orange). Re-check a center.`
      );
    }
  }

  return "The center colours aren't a single real cube — check for a misread center.";
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

function dedupe(arr) {
  return [...new Set(arr)];
}

// ---- orientation detection (centers define the frame) -----------------------
//
// A 3x3's centers are fixed relative to each other, so they DEFINE how the cube is
// held. The scanned cube may be in any of the 24 valid orientations. We read the 6
// centers and match them against the 24 real cube orientations (generated by the
// oracle). A match yields a color relabel scannedColor -> canonicalColor (the color
// on the U face becomes White, on F becomes Green, ...), which — being a global
// color bijection — preserves all counts and solvability. Everything downstream
// then runs in the canonical frame, and the solver never changes.
const ORIENTATIONS = cubeOrientations3();

// Detect the held orientation. Returns { ok, relabel, inverse } where relabel maps
// a scanned color to its canonical color and inverse maps back. Assumes each center
// is a known color (the caller checks fill first).
function detectOrientation(faces) {
  const centers = {};
  for (const face of FACE_ORDER) centers[face] = faces[face][CENTER_IDX];
  for (const scheme of ORIENTATIONS) {
    let match = true;
    for (const face of FACE_ORDER) {
      if (scheme[face] !== centers[face]) {
        match = false;
        break;
      }
    }
    if (match) {
      const relabel = {};
      const inverse = {};
      for (const face of FACE_ORDER) {
        relabel[centers[face]] = CENTER_COLOR[face];
        inverse[CENTER_COLOR[face]] = centers[face];
      }
      return { ok: true, relabel, inverse };
    }
  }
  return { ok: false };
}

function applyRelabel(faces, map) {
  const out = {};
  for (const face of FACE_ORDER) out[face] = faces[face].map((c) => map[c]);
  return out;
}

// A mirror-scheme cube reads as a real, solvable cube of the opposite handedness.
// We accept and solve it, but surface this note so a user who actually mis-entered
// a standard cube (a swapped Left/Right, say) can catch the mistake.
export const MIRROR_NOTE =
  "This cube reads as a mirror-image (left-handed) color scheme. If it is genuinely " +
  'a mirror cube, the solution is correct. If it is a standard cube, two faces are ' +
  'likely swapped in entry — most often Left and Right — so double-check those.';

// Full analysis: orientation- AND chirality-agnostic validation + (when valid) the
// solver state and everything the caller needs to render/translate the solve.
// Returns { ok, errors, state?, mirror, warning?, relabel?, inverse?, canonicalFaces?, rawFaces? }.
export function analyzeFaces(faces) {
  const errors = [];

  // 1. Every face has 9 known-color stickers.
  for (const face of FACE_ORDER) {
    const arr = faces[face];
    if (!arr || arr.length !== N * N) {
      errors.push(`Face ${face} is missing stickers.`);
      continue;
    }
    for (const c of arr) {
      if (!COLORS.includes(c)) {
        errors.push(`Face ${face} has an unset or unknown sticker.`);
        break;
      }
    }
  }
  if (errors.length) return { ok: false, errors: dedupe(errors) };

  // 2. Centers must form one of the 24 real cube orientations. Try the proper
  //    (standard, right-handed) orientations first; if none match, try the cube as
  //    a MIRROR-scheme scan by reflecting it into the standard frame and validating
  //    there. Everything downstream then runs on a standard cube.
  const det = detectOrientation(faces);
  if (det.ok) return analyzeInFrame(faces, det, false);

  const reflected = reflectFaces(faces);
  const rdet = detectOrientation(reflected);
  if (rdet.ok) {
    const res = analyzeInFrame(reflected, rdet, true);
    if (res.ok) res.rawFaces = faces;
    return res;
  }

  return { ok: false, errors: [diagnoseCenters(faces)] };
}

// Validate + solve-state for a faces object whose centers already matched a proper
// orientation `det`. `mirror` records whether these faces came from reflecting a
// mirror-scheme scan (the caller reflects the solution's moves back to physical
// turns and renders in the original colors).
function analyzeInFrame(faces, det, mirror) {
  const errors = [];

  // Relabel into the canonical frame; validation below runs on canonical faces.
  const cf = applyRelabel(faces, det.relabel);

  // 3. Each color appears exactly 9 times.
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const face of FACE_ORDER) for (const c of cf[face]) counts[c]++;
  for (const c of COLORS) {
    if (counts[c] !== N * N) {
      errors.push(`${COLOR_NAMES[c]} appears ${counts[c]} times; a real cube has exactly ${N * N}.`);
    }
  }

  // 4. Corners: 3 distinct, non-opposite colors, a real piece, all 8 distinct.
  const cornerSeen = new Set();
  for (const slot of SLOTS) {
    const cols = POS_TO_CELLS.get(posKey(slot.pos)).map((cell) => cf[cell.face][cell.idx]);
    const uniq = new Set(cols);
    const key = [...cols].sort().join('');
    if (uniq.size !== 3) {
      errors.push(`The ${slot.name} corner repeats a color (${cols.join('/')}).`);
      continue;
    }
    let opp = false;
    for (const c of cols) {
      if (uniq.has(OPPOSITE[c])) {
        errors.push(
          `The ${slot.name} corner pairs opposite colors ${COLOR_NAMES[c]} and ${COLOR_NAMES[OPPOSITE[c]]}, which can't touch.`
        );
        opp = true;
        break;
      }
    }
    if (opp) continue;
    if (!REAL_CORNER_SETS.has(key)) {
      errors.push(`The ${slot.name} corner (${cols.join('/')}) is not a real cube piece.`);
      continue;
    }
    if (cornerSeen.has(key)) {
      errors.push(`Two corners are the same piece (${slot.name} duplicates another).`);
    }
    cornerSeen.add(key);
  }

  // 5. Edges: 2 distinct, non-opposite colors, a real piece, all 12 distinct.
  const edgeSeen = new Set();
  for (const slot of EDGE_SLOTS) {
    const cols = POS_TO_CELLS.get(posKey(slot.pos)).map((cell) => cf[cell.face][cell.idx]);
    const uniq = new Set(cols);
    const key = [...cols].sort().join('');
    if (uniq.size !== 2) {
      errors.push(`The ${slot.name} edge repeats a color (${cols.join('/')}).`);
      continue;
    }
    if (uniq.has(OPPOSITE[cols[0]])) {
      errors.push(
        `The ${slot.name} edge pairs opposite colors ${COLOR_NAMES[cols[0]]} and ${COLOR_NAMES[cols[1]]}, which can't touch.`
      );
      continue;
    }
    if (!REAL_EDGE_SETS.has(key)) {
      errors.push(`The ${slot.name} edge (${cols.join('/')}) is not a real cube piece.`);
      continue;
    }
    if (edgeSeen.has(key)) {
      errors.push(`Two edges are the same piece (${slot.name} duplicates another).`);
    }
    edgeSeen.add(key);
  }

  if (errors.length) return { ok: false, errors: dedupe(errors) };

  // 6. Solvability constraints (all three must hold for a real cube).
  const cfGeom = geomFromFaces(cf);
  const state = stateFromGeom3(cfGeom);
  const twist = state.co.reduce((a, b) => a + b, 0) % 3;
  if (twist !== 0) {
    errors.push(
      'One corner is twisted in place — the total corner twist is off. Re-check a corner whose colors look rotated.'
    );
  }
  const flip = state.eo.reduce((a, b) => a + b, 0) % 2;
  if (flip !== 0) {
    errors.push(
      'One edge is flipped in place — the total edge flip is off. Re-check an edge whose two colors look swapped.'
    );
  }
  if (permParity(state.cp) !== permParity(state.ep)) {
    errors.push(
      'Two pieces are swapped — the corner and edge permutation parity disagree, which no sequence of turns can produce. Re-check for two swapped pieces.'
    );
  }
  if (errors.length) return { ok: false, errors: dedupe(errors) };

  // 7. Integrity: the compact state must round-trip to the exact same geometry.
  //    The state's corner orientation is a twist (0/1/2), so it cannot represent a
  //    corner of the WRONG chirality — a mirror-arranged piece encodes as if it
  //    were a normal one and would "solve" to a scrambled face. If rebuilding the
  //    geometry from the state does not reproduce cf exactly, a piece is mirrored
  //    (the centers and pieces disagree on handedness) — not a physically real cube.
  if (!geomEquals3(geomFromState3(state), cfGeom)) {
    errors.push(
      'A piece is mirrored — its colors are arranged in the wrong handedness for a real cube. Re-check a corner or edge whose two side colors look swapped.'
    );
    return { ok: false, errors: dedupe(errors) };
  }

  return {
    ok: true,
    errors: [],
    state,
    mirror,
    warning: mirror ? MIRROR_NOTE : null,
    relabel: det.relabel,
    inverse: det.inverse,
    canonicalFaces: cf,
  };
}

// Validate a faces object as a physically real, solvable 3x3 cube held in ANY of
// the 24 valid orientations. Returns { ok, errors: string[] }.
export function validateFaces(faces) {
  const { ok, errors, mirror, warning } = analyzeFaces(faces);
  return { ok, errors, mirror: !!mirror, warning: warning || null };
}

// Parse a validated faces object into a solver state (canonical frame). Throws if
// invalid.
export function stateFromFaces(faces) {
  const a = analyzeFaces(faces);
  if (!a.ok) throw new Error('invalid cube: ' + a.errors.join(' '));
  return a.state;
}

export { statesEqual };
