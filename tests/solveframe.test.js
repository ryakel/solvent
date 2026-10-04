// solveframe.test.js — a 2x2 solution starts from the cube exactly as it was
// scanned. The solver works in its own normalized frame (a reference corner held
// fixed); the user must never have to find that frame by eye. So the frames the
// app animates begin at the scanned cube, every step is exactly the move it is
// named for, and the last frame is solved — from any starting grip.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyGeomMove, geomEquals } from '../src/core/geometry.js';
import * as cube2 from '../src/core/cube2.js';
import { geomFromFaces } from '../src/core/facelet.js';
import { solve as solveState } from '../src/core/solver2.js';
import { reflectXGeom } from '../src/core/mirror2.js';
import size2x2 from '../src/sizes/size2x2.js';
import { cameraToFace } from '../src/sizes/scanpath.js';
import { turnWhole, scanPhotos } from './virtual-camera.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Scan a geometry through the guide's path, as the app captures it.
function scan(geom) {
  const faces = {};
  scanPhotos(size2x2.scanSequence, geom).forEach(({ face, cells }, i) => {
    faces[face] = cameraToFace(size2x2.scanSequence[i].cameraToFacelet, cells);
  });
  return faces;
}

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

function parse(name) {
  return { face: name[0], times: name.length === 1 ? 1 : name[1] === "'" ? -1 : 2 };
}

function checkSolution(faces, label) {
  const sol = size2x2.solve(faces);
  const scanned = geomFromFaces(faces);
  assert.ok(geomEquals(sol.frames[0], scanned), `${label}: solution does not start from the scanned cube`);
  assert.equal(sol.frames.length, sol.moves.length + 1);
  sol.moves.forEach((m, k) => {
    const { face, times } = parse(m.name);
    assert.ok(
      geomEquals(applyGeomMove(sol.frames[k], face, times), sol.frames[k + 1]),
      `${label}: frame ${k + 1} is not ${m.name} applied to frame ${k}`
    );
  });
  assert.ok(sixSolidFaces(sol.frames[sol.frames.length - 1]), `${label}: does not end solved`);
  return sol;
}

test('2x2 solutions start from the scanned cube, from any starting grip, and stay optimal', () => {
  const rand = rng(41);
  const names = Object.keys(cube2.MOVES);
  for (let t = 0; t < 600; t++) {
    let s = cube2.SOLVED;
    for (let i = 0; i < 25; i++) s = cube2.applyMove(s, names[Math.floor(rand() * names.length)]);
    let g = size2x2.geomFromState(s);
    for (let k = 0; k < 4; k++) g = turnWhole(g, Math.floor(rand() * 3), 1 + Math.floor(rand() * 3));
    const faces = scan(g);
    const sol = checkSolution(faces, `scramble #${t}`);
    const optimal = solveState(cube2.stateFromGeom(geomFromFaces(faces))).moves.length;
    assert.equal(sol.moves.length, optimal, `scramble #${t}: solution length changed`);
  }
});

test('2x2 mirror-scheme and already-solved cubes start from the scanned cube too', () => {
  const rand = rng(43);
  const names = Object.keys(cube2.MOVES);
  for (let t = 0; t < 200; t++) {
    let s = cube2.SOLVED;
    for (let i = 0; i < 25; i++) s = cube2.applyMove(s, names[Math.floor(rand() * names.length)]);
    let g = reflectXGeom(size2x2.geomFromState(s));
    g = turnWhole(g, Math.floor(rand() * 3), 1 + Math.floor(rand() * 3));
    const sol = checkSolution(scan(g), `mirror #${t}`);
    assert.equal(sol.mirror, true);
  }
  // A solved cube held any way up: nothing to do, and the screen shows it as held.
  for (let k = 0; k < 6; k++) {
    let g = size2x2.geomFromState(cube2.SOLVED);
    g = turnWhole(g, k % 3, 1 + (k % 3));
    const sol = checkSolution(scan(g), `solved grip ${k}`);
    assert.equal(sol.moves.length, 0);
  }
});
