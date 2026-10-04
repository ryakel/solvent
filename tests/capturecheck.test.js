// capturecheck.test.js — the capture-time check (sizes/capturecheck.js).
//
// The bar is asymmetric: a correctly followed scan must NEVER be stopped (any
// size, any starting grip, standard or mirror scheme), while the common slips —
// forgetting to turn, turning the wrong way — should be caught early. A virtual
// person performs the turns physically; the camera sees what they actually did.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as cube2 from '../src/core/cube2.js';
import * as cube3 from '../src/core/cube3.js';
import { reflectXGeom } from '../src/core/mirror2.js';
import { reflectGeom3 } from '../src/core/geometry3.js';
import size2x2 from '../src/sizes/size2x2.js';
import size3x3 from '../src/sizes/size3x3.js';
import { cameraToFace } from '../src/sizes/scanpath.js';
import { turnWhole, photograph } from './virtual-camera.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomCube(mod, cube, rand, { mirror = false } = {}) {
  const names = Object.keys(cube.MOVES);
  let s = cube.SOLVED;
  for (let i = 0; i < 25; i++) s = cube.applyMove(s, names[Math.floor(rand() * names.length)]);
  let g = mod.geomFromState(s);
  if (mirror) g = mod.id === '2x2' ? reflectXGeom(g) : reflectGeom3(g);
  for (let k = 0; k < 3; k++) g = turnWhole(g, Math.floor(rand() * 3), 1 + Math.floor(rand() * 3));
  return g;
}

// A person scanning: at each step they perform `turns[k]` (default: the turn the
// guide shows), the camera photographs the face in front of it, the app stores
// it for that step and runs the check. `motion` says whether the app's live
// read-out reports the picture unchanged when no turn happened (as it does on a
// real device); without it the check gets no motion signal at all.
// Returns the first step that warns, or -1.
function scanAs(mod, geom, turns = {}, { motion = true } = {}) {
  const faces = mod.emptyFaces();
  let g = geom;
  for (let k = 0; k < mod.scanSequence.length; k++) {
    const step = mod.scanSequence[k];
    const turn = k in turns ? turns[k] : step.turn;
    if (turn) g = turnWhole(g, turn.axis, Math.round(turn.deg / 90));
    faces[step.face] = cameraToFace(step.cameraToFacelet, photograph(g));
    const unchanged = motion && k > 0 && !turn;
    if (mod.checkCapture(faces, k, { unchanged })) return k;
  }
  return -1;
}

const SIZES = [
  { mod: size2x2, cube: cube2 },
  { mod: size3x3, cube: cube3 },
];

for (const { mod, cube } of SIZES) {
  test(`${mod.id}: a correctly followed scan is never stopped (any grip, either scheme)`, () => {
    const rand = rng(mod.id === '2x2' ? 61 : 67);
    for (let t = 0; t < 600; t++) {
      const g = randomCube(mod, cube, rand, { mirror: t % 3 === 0 });
      assert.equal(scanAs(mod, g), -1, `cube #${t} was stopped although scanned correctly`);
    }
    // Solved cubes are the most uniform case there is.
    assert.equal(scanAs(mod, mod.geomFromState(cube.SOLVED)), -1);
  });

  test(`${mod.id}: forgetting to turn is caught on that very step`, () => {
    const rand = rng(mod.id === '2x2' ? 71 : 73);
    for (let t = 0; t < 300; t++) {
      const k = 1 + (t % (mod.scanSequence.length - 1)); // a step that has a turn
      const g = randomCube(mod, cube, rand);
      assert.equal(scanAs(mod, g, { [k]: null }), k, `cube #${t}: missed turn at step ${k} not caught there`);
      // A 3x3 doesn't even need the motion signal: the repeated centre gives it away.
      if (mod.hasCenters) {
        assert.equal(scanAs(mod, g, { [k]: null }, { motion: false }), k, `cube #${t}: 3x3 needed motion`);
      }
    }
  });
}

test('turning the wrong way at step 2: caught by step 3 on a 3x3, mostly on the spot on a 2x2', () => {
  const wrong = { 1: { axis: 'y', deg: 90 } }; // right instead of left
  const rand3 = rng(79);
  for (let t = 0; t < 300; t++) {
    const at = scanAs(size3x3, randomCube(size3x3, cube3, rand3), wrong);
    assert.ok(at >= 1 && at <= 2, `3x3 cube #${t}: wrong turn caught at step ${at + 1}`);
  }
  const rand2 = rng(83);
  const T = 2000;
  const caughtBy = [0, 0, 0, 0, 0, 0];
  let missed = 0;
  for (let t = 0; t < T; t++) {
    const at = scanAs(size2x2, randomCube(size2x2, cube2, rand2), wrong);
    if (at < 0) missed++;
    else caughtBy[at]++;
  }
  // A 2x2 has no centres, so only pieces can give a wrong turn away: about half
  // are caught on the spot and nearly all before the scan ends (Verify still
  // catches every one). Recorded in SOLV-8.
  const later = caughtBy[2] + caughtBy[3] + caughtBy[4] + caughtBy[5];
  console.log(`    2x2 wrong turn at step 2: caught at step 2 ${caughtBy[1]}, later ${later}, never ${missed} (of ${T})`);
  assert.ok(caughtBy[1] / T > 0.5, `2x2: only ${caughtBy[1]}/${T} caught on the spot`);
  assert.ok(missed / T < 0.05, `2x2: ${missed}/${T} wrong turns never caught during the scan`);
});

test('a left turn where the path tips forward is caught, almost always on the spot', () => {
  // The old path turned left three times before tipping; a returning user may
  // turn left again out of habit where the tip now goes (SOLV-20).
  const k = size2x2.scanSequence.findIndex((s) => s.turn && s.turn.axis === 'x');
  assert.ok(k > 0, 'the scan path tips forward somewhere');
  const habit = { [k]: { axis: 'y', deg: -90 } };
  const rand3 = rng(89);
  for (let t = 0; t < 300; t++) {
    assert.equal(scanAs(size3x3, randomCube(size3x3, cube3, rand3), habit), k, `3x3 cube #${t}`);
  }
  const rand2 = rng(97);
  const T = 1000;
  let spot = 0;
  let missed = 0;
  for (let t = 0; t < T; t++) {
    const at = scanAs(size2x2, randomCube(size2x2, cube2, rand2), habit);
    if (at === k) spot++;
    if (at < 0) missed++;
  }
  console.log(`    2x2 left turn instead of the tip: caught on the spot ${spot}, never ${missed} (of ${T})`);
  assert.ok(spot / T > 0.85, `2x2: only ${spot}/${T} caught on the spot`);
  assert.ok(missed / T < 0.02, `2x2: ${missed}/${T} never caught during the scan`);
});
