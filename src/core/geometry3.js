// geometry3.js — Ground-truth geometric model of a 3x3 cube.
//
// This is the 3x3 ORACLE, the exact analog of geometry.js for the 2x2. A cube is
// represented as 26 cubies (8 corners, 12 edges, 6 centers), each with a 3D
// integer position and a set of stickers, each sticker having an outward normal
// and a color. A face turn is a literal 90-degree spatial rotation of the outer
// layer for that face. No move tables, no orientation numbers — just geometry —
// so it is manifestly a real cube. cube3.js derives its fast algebra FROM this
// module and cube3.test.js cross-checks the two over thousands of sequences.
//
// It reuses the 2x2 oracle's rotation primitives (rotateVec, quartersForMove) and
// its face/color definitions so there is ONE source of truth for rotation and the
// color scheme. Frame: +x=R, +y=U, +z=F. U=White D=Yellow F=Green B=Blue R=Red
// L=Orange.

import {
  FACES,
  FACE_ORDER,
  COLORS,
  colorOfNormal,
  rotateVec,
  quartersForMove,
  geomEquals,
} from './geometry.js';

export { FACES, FACE_ORDER, COLORS, colorOfNormal };

// The 26 cubie positions: every {-1,0,1}^3 point except the origin. A cubie is a
// corner if all three coords are nonzero, an edge if exactly one coord is zero,
// and a center if exactly two coords are zero.
export function cubieKind(pos) {
  const zeros = pos.filter((c) => c === 0).length;
  if (zeros === 0) return 'corner';
  if (zeros === 1) return 'edge';
  if (zeros === 2) return 'center';
  return 'origin';
}

// Build a solved cube geometry: 26 cubies, each { pos, stickers:[{normal,color}] }.
// A cubie gets one outward sticker per nonzero coordinate.
export function solvedGeom3() {
  const cubies = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const pos = [x, y, z];
        const stickers = [];
        for (let axis = 0; axis < 3; axis++) {
          if (pos[axis] !== 0) {
            const normal = [0, 0, 0];
            normal[axis] = pos[axis];
            stickers.push({ normal, color: colorOfNormal(normal) });
          }
        }
        cubies.push({ pos, stickers });
      }
    }
  }
  return cubies;
}

// Apply a face turn to a geometry (returns a new geometry). Only the outer layer
// where pos[axis]===sign moves; centers on the turned axis just spin in place.
// Same clockwise convention as geometry.js (reuses quartersForMove).
export function applyGeomMove3(geom, face, times = 1) {
  const f = FACES[face];
  const quarters = quartersForMove(face, times);
  return geom.map((cubie) => {
    if (cubie.pos[f.axis] !== f.sign) return cubie; // not in this layer
    return {
      pos: rotateVec(cubie.pos, f.axis, quarters),
      stickers: cubie.stickers.map((s) => ({
        normal: rotateVec(s.normal, f.axis, quarters),
        color: s.color,
      })),
    };
  });
}

export function applyGeomSequence3(geom, moves) {
  let g = geom;
  for (const { face, times } of moves) g = applyGeomMove3(g, face, times);
  return g;
}

// Rotate the WHOLE cube (every cubie, not just one layer) by `quarters` * 90° about
// a coordinate axis. This is a re-orientation of the cube in space, not a move — it
// permutes which physical face each cubie shows on. Used to reason about the 24
// ways a solved cube can be held.
export function rotateWholeGeom3(geom, axis, quarters) {
  return geom.map((cubie) => ({
    pos: rotateVec(cubie.pos, axis, quarters),
    stickers: cubie.stickers.map((s) => ({
      normal: rotateVec(s.normal, axis, quarters),
      color: s.color,
    })),
  }));
}

// The center color shown on each physical face of a geometry (its middle cubie).
function centerSchemeOf(geom) {
  const scheme = {};
  for (const f of FACE_ORDER) {
    const { axis, sign } = FACES[f];
    const cubie = geom.find(
      (c) => c.pos[axis] === sign && c.pos.filter((v) => v === 0).length === 2
    );
    scheme[f] = cubie.stickers[0].color;
  }
  return scheme;
}

// All center-color schemes reachable from `seed` by whole-cube rotations (BFS
// composing x/y/z quarter turns). Rotations preserve chirality, so this returns
// the 24 orientations of whatever handedness `seed` has.
function orientationsFrom(seed) {
  const schemes = [];
  const seen = new Set();
  const keyOf = (s) => FACE_ORDER.map((f) => s[f]).join('');
  const queue = [seed];
  const first = centerSchemeOf(queue[0]);
  seen.add(keyOf(first));
  schemes.push(first);
  for (let i = 0; i < queue.length; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const g = rotateWholeGeom3(queue[i], axis, 1);
      const scheme = centerSchemeOf(g);
      const k = keyOf(scheme);
      if (!seen.has(k)) {
        seen.add(k);
        schemes.push(scheme);
        queue.push(g);
      }
    }
  }
  return schemes; // exactly 24
}

// The 24 valid cube orientations, as center-color schemes { U, R, F, D, L, B }.
// Generated from the oracle by enumerating every whole-cube rotation, so each is a
// proper ROTATION of the canonical scheme — correct opposite pairs AND correct
// chirality, never a mirror. Any real standard-scheme scanned cube's 6 centers
// must match exactly one of these.
export function cubeOrientations3() {
  return orientationsFrom(solvedGeom3());
}

// Reflect a geometry through the x=0 plane: negate the x-component of every
// position and every sticker normal. This flips the cube's CHIRALITY (a
// right-handed / standard color scheme becomes left-handed / mirror) while keeping
// it a mechanically-identical, valid cube. One reflection lets the single standard
// solver handle mirror-scheme cubes too — reflect in, solve, reflect the moves out.
export function reflectGeom3(geom) {
  const nx = ([x, y, z]) => [-x, y, z];
  return geom.map((cubie) => ({
    pos: nx(cubie.pos),
    stickers: cubie.stickers.map((s) => ({ normal: nx(s.normal), color: s.color })),
  }));
}

// The 24 MIRROR cube orientations: center schemes of a reflected solved cube under
// every whole-cube rotation. A scanned cube whose 6 centers match one of these
// (and none of the 24 proper orientations) is a left-handed / mirror color scheme —
// a real, solvable cube of opposite chirality (or a scan that mirror-flipped).
export function cubeMirrorOrientations3() {
  return orientationsFrom(reflectGeom3(solvedGeom3()));
}

// reflectMoveName[m] = the move whose effect on a reflected cube mirrors m's effect
// on the original: reflectGeom3(applyGeomMove3(g, m)) equals
// applyGeomMove3(reflectGeom3(g), reflectMoveName[m]) for every geometry g. Derived
// purely from the oracle (no hand-picked turn convention), so a mirror cube's
// solution — found in the reflected/standard frame — maps back to real physical
// face turns by relabelling each move through this table.
export const reflectMoveName = (() => {
  const solved = solvedGeom3();
  const reflSolved = reflectGeom3(solved);
  const names = [];
  for (const face of FACE_ORDER) {
    names.push({ name: face, face, times: 1 });
    names.push({ name: face + "'", face, times: -1 });
    names.push({ name: face + '2', face, times: 2 });
  }
  const map = {};
  for (const src of names) {
    const target = reflectGeom3(applyGeomMove3(solved, src.face, src.times));
    const hit = names.find((cand) =>
      geomEquals3(applyGeomMove3(reflSolved, cand.face, cand.times), target)
    );
    if (!hit) throw new Error('no mirror image for move ' + src.name);
    map[src.name] = hit.name;
  }
  return map;
})();


// Structural equality of two geometries; order-independent. Reuses the 2x2
// oracle's comparator, which already keys on position + per-normal color and so
// works for cubies with any number of stickers.
export function geomEquals3(a, b) {
  return geomEquals(a, b);
}
