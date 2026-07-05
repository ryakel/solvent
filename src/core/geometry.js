// geometry.js — Ground-truth geometric model of a 2x2 cube.
//
// This module is the ORACLE. It represents a cube as 8 corner cubies, each with
// a 3D integer position and three stickers, each sticker having an outward
// normal vector and a color. Face turns are implemented as literal 90-degree
// spatial rotations of a layer. There is no hand-entered "move table" here and
// no orientation-number bookkeeping — just geometry — so it is manifestly a real
// cube. Everything else in the solver is derived from and cross-checked against
// this module (see cube2.js and the tests).
//
// Coordinate frame:  +x = R (right), +y = U (up), +z = F (front).
// Western color scheme: U=White, D=Yellow, F=Green, B=Blue, R=Red, L=Orange.

// The six faces. `axis` is 0/1/2 for x/y/z; `sign` is +1/-1 for the positive or
// negative side of that axis.
export const FACES = {
  U: { axis: 1, sign: +1, color: 'W' },
  D: { axis: 1, sign: -1, color: 'Y' },
  F: { axis: 2, sign: +1, color: 'G' },
  B: { axis: 2, sign: -1, color: 'B' },
  R: { axis: 0, sign: +1, color: 'R' },
  L: { axis: 0, sign: -1, color: 'O' },
};

export const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
export const COLORS = ['W', 'Y', 'G', 'B', 'R', 'O'];

// The eight corner slots, in the canonical Kociemba order. The name lists the
// three faces the corner touches; the position is its integer coordinate.
export const SLOTS = [
  { name: 'URF', pos: [+1, +1, +1] },
  { name: 'UFL', pos: [-1, +1, +1] },
  { name: 'ULB', pos: [-1, +1, -1] },
  { name: 'UBR', pos: [+1, +1, -1] },
  { name: 'DFR', pos: [+1, -1, +1] },
  { name: 'DLF', pos: [-1, -1, +1] },
  { name: 'DBL', pos: [-1, -1, -1] },
  { name: 'DRB', pos: [+1, -1, -1] },
];

// Return the face letter for a given outward normal (an axis-aligned unit-ish
// vector like [1,0,0]). Throws on a non-axis vector — a useful invariant check.
export function faceOfNormal(n) {
  for (const [letter, f] of Object.entries(FACES)) {
    const v = [0, 0, 0];
    v[f.axis] = f.sign;
    if (v[0] === n[0] && v[1] === n[1] && v[2] === n[2]) return letter;
  }
  throw new Error('normal is not axis-aligned: ' + JSON.stringify(n));
}

export function colorOfNormal(n) {
  return FACES[faceOfNormal(n)].color;
}

// Rotate an integer vector by `quarters` * 90 degrees about a coordinate axis,
// using right-handed rotations. quarters may be negative. Exact integer math.
export function rotateVec(v, axis, quarters) {
  let [x, y, z] = v;
  let q = ((quarters % 4) + 4) % 4;
  for (let i = 0; i < q; i++) {
    // +90 degrees about each axis (right-hand rule).
    if (axis === 0) [x, y, z] = [x, -z, y]; // about +x
    else if (axis === 1) [x, y, z] = [z, y, -x]; // about +y
    else [x, y, z] = [-y, x, z]; // about +z
  }
  return [x, y, z];
}

// A face move "F" (clockwise, viewed from outside that face) is a rotation by
// -sign quarter turns about the positive coordinate axis. Derivation: a
// clockwise turn seen from outside is a -90 deg rotation about the OUTWARD
// normal (right-hand rule); the outward normal is sign*axis, so about the
// positive axis it is -sign quarter turns.
export function quartersForMove(face, times) {
  const f = FACES[face];
  return -f.sign * times;
}

// Build a solved cube geometry: 8 cubies, each a { pos, stickers:[{normal,color}] }.
export function solvedGeom() {
  return SLOTS.map(({ pos }) => {
    const stickers = [];
    for (let axis = 0; axis < 3; axis++) {
      const normal = [0, 0, 0];
      normal[axis] = pos[axis]; // outward along this axis
      stickers.push({ normal, color: colorOfNormal(normal) });
    }
    return { pos: [...pos], stickers };
  });
}

// Apply a face turn to a geometry (returns a new geometry). `times` is the
// number of clockwise quarter turns (1, 2, or -1 for prime, etc.).
export function applyGeomMove(geom, face, times = 1) {
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

export function applyGeomSequence(geom, moves) {
  let g = geom;
  for (const { face, times } of moves) g = applyGeomMove(g, face, times);
  return g;
}

// Deep structural equality of two geometries (position + sticker colors per
// outward normal). Independent of cubie array order.
export function geomEquals(a, b) {
  const key = (g) =>
    g
      .map((c) => {
        const st = c.stickers
          .map((s) => s.normal.join(',') + ':' + s.color)
          .sort()
          .join('|');
        return c.pos.join(',') + '=>' + st;
      })
      .sort()
      .join('#');
  return key(a) === key(b);
}
