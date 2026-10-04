// virtual-camera.js — test helper: a camera on +z (x right, y up) photographing a
// cube geometry as a person turns it through a size's scan path. Shared by the
// unit-level scan-path test and the browser test that feeds a synthetic camera.
import { rotateVec } from '../src/core/geometry.js';

const AXIS = { x: 0, y: 1, z: 2 };

export function turnWhole(geom, axis, quarters) {
  const a = typeof axis === 'string' ? AXIS[axis] : axis;
  return geom.map((c) => ({
    pos: rotateVec(c.pos, a, quarters),
    stickers: c.stickers.map((s) => ({ normal: rotateVec(s.normal, a, quarters), color: s.color })),
  }));
}

// What the camera sees: the +z stickers, row-major from its top-left.
export function photograph(geom) {
  const cells = [];
  for (const c of geom) {
    for (const s of c.stickers) if (s.normal[2] === 1) cells.push({ x: c.pos[0], y: c.pos[1], color: s.color });
  }
  cells.sort((a, b) => b.y - a.y || a.x - b.x);
  return cells.map((c) => c.color);
}

// One photograph per scan step, taken after performing that step's turn.
export function scanPhotos(scanSequence, geom) {
  let g = geom;
  return scanSequence.map((step) => {
    if (step.turn) g = turnWhole(g, step.turn.axis, Math.round(step.turn.deg / 90));
    return { face: step.face, cells: photograph(g) };
  });
}
