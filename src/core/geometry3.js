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

// Structural equality of two geometries; order-independent. Reuses the 2x2
// oracle's comparator, which already keys on position + per-normal color and so
// works for cubies with any number of stickers.
export function geomEquals3(a, b) {
  return geomEquals(a, b);
}
