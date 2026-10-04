// scanpath.test.js — a virtual camera walks a real cube through each size's scan
// path, exactly as the on-screen guide instructs, and the app's capture mapping
// must turn what it sees into the cube's true facelets.
//
// This is the camera half of the pipeline that the e2e test (manual entry) never
// exercises: it caught U and D being stored a quarter-turn off.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as cube2 from '../src/core/cube2.js';
import * as cube3 from '../src/core/cube3.js';
import size2x2 from '../src/sizes/size2x2.js';
import size3x3 from '../src/sizes/size3x3.js';
import { cameraToFace, faceToCamera } from '../src/sizes/scanpath.js';
import { turnWhole, scanPhotos } from './virtual-camera.js';

// Deterministic PRNG so failures reproduce.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function scramble(cube, rand, len = 25) {
  const names = Object.keys(cube.MOVES);
  let s = cube.SOLVED;
  for (let i = 0; i < len; i++) s = cube.applyMove(s, names[Math.floor(rand() * names.length)]);
  return s;
}

// Follow the scan path physically and capture each face the way the app does.
function scanWithCamera(mod, geom) {
  const faces = {};
  scanPhotos(mod.scanSequence, geom).forEach(({ face, cells }, i) => {
    faces[face] = cameraToFace(mod.scanSequence[i].cameraToFacelet, cells);
  });
  return faces;
}

const SIZES = [
  { mod: size2x2, cube: cube2 },
  { mod: size3x3, cube: cube3 },
];

for (const { mod, cube } of SIZES) {
  test(`${mod.id}: every scan step carries a camera -> facelet mapping`, () => {
    const n = mod.gridN * mod.gridN;
    for (const step of mod.scanSequence) {
      assert.ok(Array.isArray(step.cameraToFacelet), `step ${step.face} has no mapping`);
      assert.equal(new Set(step.cameraToFacelet).size, n, `step ${step.face} mapping is not a permutation`);
    }
  });

  test(`${mod.id}: a camera following the scan guide reads the true facelets`, () => {
    const rand = rng(mod.id === '2x2' ? 7 : 11);
    for (let t = 0; t < 400; t++) {
      const state = scramble(cube, rand);
      const scanned = scanWithCamera(mod, mod.geomFromState(state));
      assert.deepEqual(scanned, mod.faceColorsFromState(state), `scramble #${t} scanned wrong`);
      const v = mod.validate(scanned);
      assert.ok(v.ok, `scramble #${t} failed validation: ${v.errors.join(' ')}`);
    }
  });

  test(`${mod.id}: a camera scan validates from any starting grip`, () => {
    // The user may start holding the cube any way up; whole-cube rotations are
    // normalized downstream, so every grip must still yield a real cube.
    const rand = rng(mod.id === '2x2' ? 13 : 17);
    for (let t = 0; t < 200; t++) {
      let g = mod.geomFromState(scramble(cube, rand));
      for (let k = 0; k < 4; k++) g = turnWhole(g, Math.floor(rand() * 3), 1 + Math.floor(rand() * 3));
      const v = mod.validate(scanWithCamera(mod, g));
      assert.ok(v.ok, `grip #${t} failed validation: ${v.errors.join(' ')}`);
    }
  });

  test(`${mod.id}: the read-back shows a face exactly as the camera saw it`, () => {
    const rand = rng(23);
    const photos = scanPhotos(mod.scanSequence, mod.geomFromState(scramble(cube, rand)));
    photos.forEach(({ cells }, i) => {
      const map = mod.scanSequence[i].cameraToFacelet;
      assert.deepEqual(faceToCamera(map, cameraToFace(map, cells)), cells);
    });
  });
}
