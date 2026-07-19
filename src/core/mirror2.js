// mirror2.js — chirality handling for the 2x2, done purely in the geometry domain.
//
// A 2x2 has no centres, so a mirror-scheme (left-handed) cube is a real, solvable
// cube — but the compact state stores corner orientation as a twist (0/1/2) and so
// cannot represent a corner of the wrong handedness. Feeding a mirror cube through
// the state solver silently mis-solves it. We instead:
//
//   1. detect a mirror cube (the compact state fails to round-trip to its geometry),
//   2. reflect it into the standard frame, solve with the normal state solver,
//   3. ALIGN the solved frames back onto the user's actual scanned geometry — a
//      fixed cube isometry + colour bijection — so the on-screen cube matches the
//      cube in hand and ends solved, and
//   4. read each physical move straight off consecutive aligned frames, so the move
//      names can never disagree with the animation.
//
// Everything here is geometric and oracle-derived; mirror2.test.js proves that the
// physical moves solve thousands of random mirror scrambles to six solid faces.

import { applyGeomMove, geomEquals } from './geometry.js';
import { geomFromState, stateFromGeom } from './cube2.js';

// Reflect a geometry through the x=0 plane: negate the x of every position and
// normal. Flips chirality; keeps a valid, mechanically-identical cube.
export function reflectXGeom(geom) {
  const nx = ([x, y, z]) => [-x, y, z];
  return geom.map((c) => ({
    pos: nx(c.pos),
    stickers: c.stickers.map((s) => ({ normal: nx(s.normal), color: s.color })),
  }));
}

// A mirror cube is one whose compact state does not round-trip: the state cannot
// encode its handedness, so rebuilding geometry from it gives a different cube.
export function isMirror2(geom) {
  return !geomEquals(geomFromState(stateFromGeom(geom)), geom);
}

// The 48 cube isometries as signed 3x3 permutation matrices (24 rotations + 24
// reflections). Each maps the cube onto itself. new[i] = sign[i] * v[perm[i]].
const ISOMETRIES = (() => {
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const out = [];
  for (const perm of perms) {
    for (let bits = 0; bits < 8; bits++) {
      const sign = [bits & 1 ? -1 : 1, bits & 2 ? -1 : 1, bits & 4 ? -1 : 1];
      out.push({ perm, sign });
    }
  }
  return out; // 6 * 8 = 48
})();

function applyIso(M, v) {
  return [M.sign[0] * v[M.perm[0]], M.sign[1] * v[M.perm[1]], M.sign[2] * v[M.perm[2]]];
}

function transformGeom(geom, M) {
  return geom.map((c) => ({
    pos: applyIso(M, c.pos),
    stickers: c.stickers.map((s) => ({ normal: applyIso(M, s.normal), color: s.color })),
  }));
}

const stickerKey = (pos, normal) => pos.join(',') + '|' + normal.join(',');

// If `moved` matches `target` under some consistent colour bijection, return that
// bijection (fromColour -> toColour); else null. Positions and normals must align
// exactly (both are the same physical cube, just recoloured).
function colorBijection(moved, target) {
  const byKey = new Map();
  for (const c of target) {
    for (const s of c.stickers) byKey.set(stickerKey(c.pos, s.normal), s.color);
  }
  const fwd = {};
  const rev = {};
  for (const c of moved) {
    for (const s of c.stickers) {
      const tk = byKey.get(stickerKey(c.pos, s.normal));
      if (tk === undefined) return null; // geometry mismatch
      if (fwd[s.color] !== undefined && fwd[s.color] !== tk) return null;
      if (rev[tk] !== undefined && rev[tk] !== s.color) return null;
      fwd[s.color] = tk;
      rev[tk] = s.color;
    }
  }
  return fwd;
}

// Find the isometry + colour bijection that carries `fromGeom` onto `toGeom` (the
// same physical cube in a possibly-reflected orientation and different colours).
// Returns a function mapping ANY geometry in fromGeom's frame into toGeom's frame,
// or null if the two are not the same cube.
export function alignGeom(fromGeom, toGeom) {
  for (const M of ISOMETRIES) {
    const C = colorBijection(transformGeom(fromGeom, M), toGeom);
    if (C) {
      return (geom) =>
        transformGeom(geom, M).map((c) => ({
          pos: c.pos,
          stickers: c.stickers.map((s) => ({ normal: s.normal, color: C[s.color] })),
        }));
    }
  }
  return null;
}

const ALL_MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'R', "R'", 'R2', 'L', "L'", 'L2'];
function parseMove(name) {
  return { face: name[0], times: name.length === 1 ? 1 : name[1] === "'" ? -1 : 2 };
}

// The single face turn that takes `from` to `to` (both full geometries), or null.
export function findMove(from, to) {
  for (const name of ALL_MOVES) {
    const { face, times } = parseMove(name);
    if (geomEquals(applyGeomMove(from, face, times), to)) return name;
  }
  return null;
}
