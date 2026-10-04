// repair.test.js — the Verify auto-fix (sizes/repair.js). The bar: an offered
// fix must ALWAYS be the user's real cube (a wrong fix means a wrong solution),
// and the common slips should almost always get one.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as cube2 from '../src/core/cube2.js';
import * as cube3 from '../src/core/cube3.js';
import size2x2 from '../src/sizes/size2x2.js';
import size3x3 from '../src/sizes/size3x3.js';
import { findRepair, applyRepair, rotateGrid } from '../src/sizes/repair.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const clone = (f) => JSON.parse(JSON.stringify(f));

for (const { mod, cube, floor } of [
  { mod: size2x2, cube: cube2, floor: 0.9 },
  { mod: size3x3, cube: cube3, floor: 0.97 },
]) {
  test(`${mod.id}: a fix is offered for the common slips, and is always the real cube`, () => {
    const rand = rng(mod.id === '2x2' ? 3 : 5);
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const n = mod.gridN;
    const slips = {
      'one face read turned': (f) => {
        const x = pick(mod.faceOrder);
        f[x] = rotateGrid(f[x], n, 1 + Math.floor(rand() * 3));
      },
      'two faces read turned': (f) => {
        const [a, b] = [...mod.faceOrder].sort(() => rand() - 0.5);
        f[a] = rotateGrid(f[a], n, 1 + Math.floor(rand() * 3));
        f[b] = rotateGrid(f[b], n, 1 + Math.floor(rand() * 3));
      },
      'left and right swapped': (f) => {
        [f.L, f.R] = [f.R, f.L];
      },
    };
    const names = Object.keys(cube.MOVES);
    for (const [slip, damage] of Object.entries(slips)) {
      let fixed = 0;
      let broken = 0;
      for (let t = 0; t < 150; t++) {
        let s = cube.SOLVED;
        for (let i = 0; i < 25; i++) s = cube.applyMove(s, pick(names));
        const truth = mod.faceColorsFromState(s);
        const f = clone(truth);
        damage(f);
        if (mod.validate(f).ok) continue; // undetectable: still a real cube
        broken++;
        const r = findRepair(mod, f);
        if (!r) continue;
        assert.deepEqual(r.faces, truth, `${slip} #${t}: offered a fix that isn't the real cube (${r.message})`);
        assert.ok(mod.validate(r.faces).ok);
        assert.ok(r.message.length > 20);
        fixed++;
      }
      assert.ok(fixed / broken >= floor, `${slip}: only ${fixed}/${broken} fixed`);
    }
  });
}

test('a valid cube gets no fix; low-confidence flags travel with their stickers', () => {
  assert.equal(findRepair(size2x2, size2x2.faceColorsFromState(cube2.SOLVED)), null);
  // (A near-solved cube can be fixed several equally real ways — rightly no
  // offer — so use a proper scramble.)
  let s = cube3.SOLVED;
  for (const m of ['R', 'U', "F'", 'L2', 'D', "B'", 'U2', 'R', 'F']) s = cube3.applyMove(s, m);
  const f = clone(size3x3.faceColorsFromState(s));
  f.U = rotateGrid(f.U, 3, 1);
  const r = findRepair(size3x3, f);
  assert.ok(r && r.turns.U === 3, 'U turned back a quarter-turn counter-clockwise');
  const flags = Object.fromEntries(size3x3.faceOrder.map((x) => [x, new Array(9).fill(false)]));
  flags.U[0] = true; // top-left of the misread face
  const moved = applyRepair(flags, r, 3);
  assert.equal(moved.U.filter(Boolean).length, 1);
  assert.equal(moved.U[6], true, 'top-left turned counter-clockwise lands bottom-left');
});
