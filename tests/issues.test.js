// issues.test.js — every validator finding that can point at stickers does, and
// points at the RIGHT ones (sizes/…/validate → issues[].cells), in the user's own
// frame and colours: a cube held any way up, or a mirror-scheme cube analyzed
// reflected, still marks the stickers the user actually entered.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as cube2 from '../src/core/cube2.js';
import * as cube3 from '../src/core/cube3.js';
import { geomFromFaces } from '../src/core/facelet.js';
import { geomFromRawFaces, facesFromGeom3 } from '../src/core/facelet3.js';
import { rotateWholeGeom3, reflectGeom3 } from '../src/core/geometry3.js';
import size2x2 from '../src/sizes/size2x2.js';
import size3x3 from '../src/sizes/size3x3.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const clone = (f) => JSON.parse(JSON.stringify(f));
const key = ([f, i]) => `${f}:${i}`;
const keys = (cells) => cells.map(key).sort();

function scramble(cube, rand) {
  const names = Object.keys(cube.MOVES);
  let s = cube.SOLVED;
  for (let i = 0; i < 25; i++) s = cube.applyMove(s, names[Math.floor(rand() * names.length)]);
  return s;
}

// Facelets of every corner, by running unique labels through the size's builder.
function corners(mod, toGeom) {
  const labelled = {};
  for (const f of mod.faceOrder) labelled[f] = Array.from({ length: mod.gridN ** 2 }, (_, i) => `${f}:${i}`);
  return toGeom(labelled)
    .filter((c) => c.stickers.length === 3)
    .map((c) => c.stickers.map((s) => s.color.split(':')).map(([f, i]) => [f, Number(i)]));
}

test('2x2: a corner with two stickers swapped marks exactly that corner', () => {
  const rand = rng(5);
  const cs = corners(size2x2, geomFromFaces);
  for (let t = 0; t < 100; t++) {
    const base = size2x2.faceColorsFromState(scramble(cube2, rand));
    const c = cs[t % cs.length];
    const f = clone(base);
    [f[c[0][0]][c[0][1]], f[c[1][0]][c[1][1]]] = [f[c[1][0]][c[1][1]], f[c[0][0]][c[0][1]]];
    const v = size2x2.validate(f);
    assert.equal(v.ok, false);
    assert.equal(v.issues.length, 1);
    assert.deepEqual(keys(v.issues[0].cells), keys(c));
  }
});

for (const { mod, cube } of [
  { mod: size2x2, cube: cube2 },
  { mod: size3x3, cube: cube3 },
]) {
  test(`${mod.id}: a misread sticker is among the stickers marked`, () => {
    const rand = rng(mod.id === '2x2' ? 7 : 9);
    for (let t = 0; t < 200; t++) {
      const f = clone(mod.faceColorsFromState(scramble(cube, rand)));
      const face = mod.faceOrder[t % 6];
      const i = Math.floor(rand() * mod.gridN ** 2);
      if (mod.hasCenters && i === Math.floor(mod.gridN ** 2 / 2)) continue; // centres: own test
      const others = mod.colors.filter((c) => c !== f[face][i]);
      f[face][i] = others[Math.floor(rand() * others.length)];
      const v = mod.validate(f);
      assert.equal(v.ok, false);
      const marked = new Set(v.issues.flatMap((it) => it.cells.map(key)));
      assert.ok(marked.has(`${face}:${i}`), `misread ${face}:${i} not marked: ${v.errors.join(' | ')}`);
      // Every mark is a real sticker.
      for (const k of marked) {
        const [g, j] = k.split(':');
        assert.ok(mod.faceOrder.includes(g) && Number(j) >= 0 && Number(j) < mod.gridN ** 2, k);
      }
    }
  });
}

test('3x3 held Yellow-up: findings name the colours as the user sees them', () => {
  // Turn a solved cube upside down (x2): Yellow centre on top, Blue in front.
  let g = rotateWholeGeom3(size3x3.geomFromState(cube3.SOLVED), 0, 2);
  const f = clone(facesFromGeom3(g));
  assert.equal(f.U[4], 'Y');
  // Paint one Front edge sticker Yellow: now there are ten yellows.
  const was = f.F[1];
  f.F[1] = 'Y';
  const v = size3x3.validate(f);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith('Yellow appears 10 times')), v.errors.join(' | '));
  const short = { W: 'White', Y: 'Yellow', G: 'Green', B: 'Blue', R: 'Red', O: 'Orange' }[was];
  assert.ok(v.errors.some((e) => e.startsWith(`${short} appears 8 times`)), v.errors.join(' | '));
});

test('3x3 mirror-scheme cube: marks point back at the stickers as entered', () => {
  const rand = rng(11);
  for (let t = 0; t < 100; t++) {
    const g = reflectGeom3(size3x3.geomFromState(scramble(cube3, rand)));
    const f = clone(facesFromGeom3(g));
    assert.equal(size3x3.validate(f).mirror, true, 'precondition: a valid mirror cube');
    const face = size3x3.faceOrder[t % 6];
    const i = [0, 1, 2, 3, 5, 6, 7, 8][t % 8];
    const others = size3x3.colors.filter((c) => c !== f[face][i]);
    f[face][i] = others[t % others.length];
    const v = size3x3.validate(f);
    assert.equal(v.ok, false);
    const marked = new Set(v.issues.flatMap((it) => it.cells.map(key)));
    assert.ok(marked.has(`${face}:${i}`), `mirror cube: ${face}:${i} not marked`);
  }
});

test('3x3: two faces given the same centre colour mark those two centres', () => {
  const f = clone(size3x3.faceColorsFromState(cube3.SOLVED));
  f.D[4] = f.U[4];
  const v = size3x3.validate(f);
  assert.equal(v.ok, false);
  assert.deepEqual(keys(v.issues[0].cells), ['D:4', 'U:4']);
});

test('a valid cube has no findings', () => {
  assert.deepEqual(size2x2.validate(size2x2.faceColorsFromState(cube2.SOLVED)).issues, []);
  assert.deepEqual(size3x3.validate(size3x3.faceColorsFromState(cube3.SOLVED)).issues, []);
  // geomFromRawFaces is here to keep the 3x3 builder exercised alongside facesFromGeom3.
  assert.ok(geomFromRawFaces(size3x3.faceColorsFromState(cube3.SOLVED)).length > 0);
});
