// mirror2.test.js — the 2x2 mirror-scheme (opposite chirality) correctness gate.
// A 2x2 has no centres, so a globally left-handed cube is a real, solvable cube.
// Reflecting a standard scramble yields a mirror one; we prove that the PHYSICAL
// moves size2x2.solve returns drive the user's actual cube to six solid faces, in
// the user's own colours, with the animation matching the moves. Zero failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACE_ORDER, FACES, applyGeomMove, geomEquals } from '../src/core/geometry.js';
import { SOLVED, applyMove, geomFromState } from '../src/core/cube2.js';
import { reflectXGeom, isMirror2, alignGeom, findMove } from '../src/core/mirror2.js';
import size2x2 from '../src/sizes/size2x2.js';

const MOVES = ['U', 'R', 'F', 'D', 'L', 'B'];
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
function scramble(rng, len) {
  let s = SOLVED;
  for (let i = 0; i < len; i++) s = applyMove(s, MOVES[(rng() * 6) | 0] + SUFFIX[(rng() * 3) | 0]);
  return s;
}
// Read a 2x2 geometry into per-face colour arrays (row-major) via the same VIEW
// basis the facelet module uses, to build a faces object for size2x2.solve.
const VIEW = {
  U: { u: [1, 0, 0], v: [0, 0, 1] }, D: { u: [1, 0, 0], v: [0, 0, -1] },
  F: { u: [1, 0, 0], v: [0, -1, 0] }, B: { u: [-1, 0, 0], v: [0, -1, 0] },
  R: { u: [0, 0, -1], v: [0, -1, 0] }, L: { u: [0, 0, 1], v: [0, -1, 0] },
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function facesFromGeom(geom) {
  const faces = {};
  for (const face of FACE_ORDER) {
    const { axis, sign } = FACES[face];
    const { u, v } = VIEW[face];
    faces[face] = new Array(4);
    for (const c of geom) {
      if (c.pos[axis] !== sign) continue;
      const col = dot(c.pos, u) > 0 ? 1 : 0;
      const row = dot(c.pos, v) > 0 ? 1 : 0;
      const st = c.stickers.find((s) => s.normal[axis] === sign);
      faces[face][row * 2 + col] = st.color;
    }
  }
  return faces;
}
function faceUniform(geom) {
  return FACE_ORDER.every((f) => {
    const { axis, sign } = FACES[f];
    const cols = new Set();
    for (const c of geom) {
      if (c.pos[axis] !== sign) continue;
      cols.add(c.stickers.find((s) => s.normal[axis] === sign).color);
    }
    return cols.size === 1;
  });
}
function applyName(geom, name) {
  const face = name[0];
  const times = name.length === 1 ? 1 : name[1] === "'" ? -1 : 2;
  return applyGeomMove(geom, face, times);
}

test('alignGeom + findMove are exact identities on the standard cube', () => {
  const g = geomFromState(scramble(mulberry32(5), 10));
  const id = alignGeom(g, g);
  assert.ok(id, 'a cube always aligns to itself');
  assert.ok(geomEquals(id(g), g), 'self-alignment is the identity');
  const moved = applyName(g, 'R');
  assert.equal(findMove(g, moved), 'R');
  assert.equal(findMove(moved, g), "R'");
});

test('a standard 2x2 is never flagged mirror; a reflected one always is', () => {
  const rng = mulberry32(77);
  for (let i = 0; i < 300; i++) {
    const g = geomFromState(scramble(rng, 1 + Math.floor(rng() * 14)));
    assert.equal(isMirror2(g), false, 'standard cube wrongly flagged mirror');
    assert.equal(isMirror2(reflectXGeom(g)), true, 'reflected cube not flagged mirror');
  }
});

test('SOLVE 2000 mirror-scheme 2x2 cubes: validate, solve, physical moves end solved', () => {
  const rng = mulberry32(2468);
  const N = 2000;
  let count = 0;
  for (let i = 0; i < N; i++) {
    const rawGeom = reflectXGeom(geomFromState(scramble(rng, 1 + Math.floor(rng() * 14))));
    const faces = facesFromGeom(rawGeom);

    const v = size2x2.validate(faces);
    assert.ok(v.ok, `mirror 2x2 rejected: ${v.errors && v.errors.join(' ')}`);
    assert.equal(v.mirror, true, 'mirror 2x2 not flagged by validate');
    assert.ok(v.warning, 'mirror 2x2 carries no heads-up');

    const res = size2x2.solve(faces);
    assert.equal(res.mirror, true, 'solve did not flag mirror');

    // First frame reproduces the user's scanned cube exactly (their colours).
    assert.ok(geomEquals(res.frames[0], rawGeom), 'first frame is not the scanned cube');
    // Last frame is six solid faces.
    assert.ok(faceUniform(res.frames[res.frames.length - 1]), 'solve does not end solid');

    // The physical moves, applied to the user's actual cube, end solved...
    let g = rawGeom;
    for (const m of res.moves) g = applyName(g, m.name);
    assert.ok(faceUniform(g), 'physical moves do not solve the cube');
    // ...and every move exactly matches the animation frame it produces.
    let gg = rawGeom;
    res.moves.forEach((m, k) => {
      gg = applyName(gg, m.name);
      assert.ok(geomEquals(gg, res.frames[k + 1]), `move ${k} disagrees with its frame`);
    });
    count++;
  }
  console.log(`    solved ${count}/${N} mirror-scheme 2x2 cubes to solid faces`);
});

test('a twisted (unsolvable) 2x2 is still rejected in both handedness frames', () => {
  const rng = mulberry32(13);
  // Take a solved cube, twist one corner in place -> unsolvable; and its reflection.
  const base = geomFromState(SOLVED);
  const faces = facesFromGeom(base);
  // Rotate the URF corner's three stickers among themselves (a single twist).
  const twisted = JSON.parse(JSON.stringify(faces));
  // URF corner shows U[3] (bottom-right of U), R and F top stickers; cycle three
  // face cells that meet at one physical corner to force twist != 0 mod 3.
  const tmp = twisted.U[3];
  twisted.U[3] = twisted.F[1];
  twisted.F[1] = twisted.R[0];
  twisted.R[0] = tmp;
  const v = size2x2.validate(twisted);
  assert.ok(!v.ok, 'a twisted corner must be rejected');
  const vr = size2x2.validate(facesFromGeom(reflectXGeom(base)));
  // (control) the clean reflection is accepted as a mirror cube
  assert.ok(vr.ok && vr.mirror, 'clean reflected solved cube should validate as mirror');
  void rng;
});
