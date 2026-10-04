// contract.test.js — the Verify step's promise, fuzzed: whatever the validator
// accepts, the solver must solve. Real cubes are damaged the ways people damage
// them while entering or correcting stickers (two stickers swapped, a face read
// rotated, two faces swapped, the whole cube mirrored), and every damaged cube the
// validator lets through has to come out of solve() as six solid faces — never a
// thrown error at the moment the user presses Solve.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SLOTS } from '../src/core/geometry.js';
import * as cube2 from '../src/core/cube2.js';
import * as cube3 from '../src/core/cube3.js';
import { geomFromFaces } from '../src/core/facelet.js';
import { geomFromRawFaces } from '../src/core/facelet3.js';
import size2x2 from '../src/sizes/size2x2.js';
import size3x3 from '../src/sizes/size3x3.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

function scrambledFaces(mod, cube, rand) {
  const names = Object.keys(cube.MOVES);
  let s = cube.SOLVED;
  for (let i = 0; i < 25; i++) s = cube.applyMove(s, pick(rand, names));
  return mod.faceColorsFromState(s);
}
const clone = (faces) => JSON.parse(JSON.stringify(faces));

// Which facelets each corner shows, found by running unique labels through the
// size's own faces -> geometry builder (so no orientation convention is restated
// here). corners[j] = [[face, idx], [face, idx], [face, idx]] in SLOTS order for
// the 2x2 (geomFromFaces builds cubies in SLOTS order).
function cornerFacelets(mod, toGeom) {
  const labelled = {};
  for (const f of mod.faceOrder) labelled[f] = Array.from({ length: mod.gridN ** 2 }, (_, i) => `${f}:${i}`);
  return toGeom(labelled)
    .filter((c) => c.stickers.length === 3)
    .map((c) => c.stickers.map((s) => s.color.split(':')).map(([f, i]) => [f, Number(i)]));
}

function rotateGrid(arr, n) {
  const out = new Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[c * n + (n - 1 - r)] = arr[r * n + c];
  return out;
}

// Six solid faces: every outward sticker on a face shares one colour.
function sixSolidFaces(geom) {
  const byFace = new Map();
  for (const c of geom) {
    for (const s of c.stickers) {
      const k = s.normal.join(',');
      if (!byFace.has(k)) byFace.set(k, new Set());
      byFace.get(k).add(s.color);
    }
  }
  return byFace.size === 6 && [...byFace.values()].every((set) => set.size === 1);
}

const SIZES = [
  { mod: size2x2, cube: cube2, toGeom: geomFromFaces, trials: 3000 },
  { mod: size3x3, cube: cube3, toGeom: geomFromRawFaces, trials: 400 },
];

for (const { mod, cube, toGeom, trials } of SIZES) {
  test(`${mod.id}: every cube the validator accepts, the solver solves`, () => {
    const rand = rng(mod.id === '2x2' ? 101 : 202);
    const n = mod.gridN;
    const corners = cornerFacelets(mod, toGeom);
    const damage = [
      (f) => f, // untouched
      (f) => {
        // two stickers on ONE corner swapped
        const c = pick(rand, corners);
        const a = Math.floor(rand() * 3);
        const b = (a + 1 + Math.floor(rand() * 2)) % 3;
        const [[fa, ia], [fb, ib]] = [c[a], c[b]];
        [f[fa][ia], f[fb][ib]] = [f[fb][ib], f[fa][ia]];
        return f;
      },
      (f) => {
        // any two stickers swapped
        const fa = pick(rand, mod.faceOrder);
        const fb = pick(rand, mod.faceOrder);
        const ia = Math.floor(rand() * n * n);
        const ib = Math.floor(rand() * n * n);
        [f[fa][ia], f[fb][ib]] = [f[fb][ib], f[fa][ia]];
        return f;
      },
      (f) => {
        // one face read rotated
        const face = pick(rand, mod.faceOrder);
        for (let k = 1 + Math.floor(rand() * 3); k > 0; k--) f[face] = rotateGrid(f[face], n);
        return f;
      },
      (f) => {
        // two whole faces swapped
        const a = pick(rand, mod.faceOrder);
        const b = pick(rand, mod.faceOrder);
        [f[a], f[b]] = [f[b], f[a]];
        return f;
      },
      (f) => {
        // mirrored left-for-right (a mirror-scheme cube, or a mirrored entry)
        const out = {};
        const swap = { L: 'R', R: 'L' };
        for (const face of mod.faceOrder) {
          const src = f[swap[face] || face];
          out[face] = src.map((_, i) => src[Math.floor(i / n) * n + (n - 1 - (i % n))]);
        }
        return out;
      },
    ];
    let accepted = 0;
    for (let t = 0; t < trials; t++) {
      const kind = t % damage.length;
      const faces = damage[kind](clone(scrambledFaces(mod, cube, rand)));
      if (!mod.validate(faces).ok) continue;
      accepted++;
      let sol;
      assert.doesNotThrow(() => {
        sol = mod.solve(faces);
      }, `trial ${t} (damage #${kind}) validated but solve() threw`);
      assert.equal(sol.frames.length, sol.moves.length + 1);
      assert.ok(sixSolidFaces(sol.frames[sol.frames.length - 1]), `trial ${t} (damage #${kind}) did not end solved`);
    }
    assert.ok(accepted > trials / 6, `fuzz too weak: only ${accepted} accepted cubes exercised`);
  });
}

test('2x2: two stickers swapped on one corner is rejected, naming that corner', () => {
  const rand = rng(303);
  const corners = cornerFacelets(size2x2, geomFromFaces);
  for (let t = 0; t < 200; t++) {
    const base = scrambledFaces(size2x2, cube2, rand);
    corners.forEach((c, j) => {
      for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
        const f = clone(base);
        const [[fa, ia], [fb, ib]] = [c[a], c[b]];
        [f[fa][ia], f[fb][ib]] = [f[fb][ib], f[fa][ia]];
        const v = size2x2.validate(f);
        assert.equal(v.ok, false, `swap on ${SLOTS[j].name} was accepted`);
        assert.ok(
          v.errors.some((e) => e.includes(`${SLOTS[j].name} corner`)),
          `swap on ${SLOTS[j].name} not named: ${v.errors.join(' ')}`
        );
      }
    });
  }
});
