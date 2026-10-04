// scanpath.js — where each camera cell lands on the facelet grid, per scan step.
//
// The camera reads a face in its own frame: row-major, left->right = +x, top->bottom
// = -y, with the presented face toward the camera (+z). The facelet grids
// (core/facelet.js, core/facelet3.js) read each face in a fixed documented
// orientation instead. The two agree for the side faces, but the scan path reaches
// U and D by tilting from a side face, so those arrive rotated in the camera's view.
//
// Rather than hand-writing per-face rotations, derive the mapping from the geometry
// oracle: label every sticker of a cube uniquely, turn it through the scan path's
// declared whole-cube turns, and read off which labelled sticker sits in each camera
// cell. The mapping is then correct by construction for any grid size and any scan
// path, and building it doubles as the self-check that every step really presents
// its declared face.

import { rotateVec } from '../core/geometry.js';

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

function rotateGeom(geom, axis, quarters) {
  const a = AXIS_INDEX[axis];
  return geom.map((c) => ({
    pos: rotateVec(c.pos, a, quarters),
    stickers: c.stickers.map((s) => ({ normal: rotateVec(s.normal, a, quarters), color: s.color })),
  }));
}

// The stickers facing the camera (+z), in camera reading order (row-major from
// the top-left as the camera sees it).
function cameraView(geom) {
  const cells = [];
  for (const c of geom) {
    for (const s of c.stickers) {
      if (s.normal[2] === 1) cells.push({ x: c.pos[0], y: c.pos[1], color: s.color });
    }
  }
  cells.sort((a, b) => b.y - a.y || a.x - b.x);
  return cells.map((c) => c.color);
}

// Attach `cameraToFacelet` to each step: cameraToFacelet[k] is the facelet index
// (within step.face) shown in camera cell k. `geomFromFaces` is the size's own
// faces -> geometry builder, which copies sticker values through verbatim — that
// is what lets unique labels stand in for colours. Throws if a step does not
// present exactly its declared face, so a broken scan path fails at module load.
export function buildScanSequence(steps, { faceOrder, gridN, geomFromFaces }) {
  const n = gridN * gridN;
  const labelled = {};
  for (const f of faceOrder) labelled[f] = Array.from({ length: n }, (_, i) => `${f}:${i}`);
  let geom = geomFromFaces(labelled);
  return steps.map((step) => {
    if (step.turn) geom = rotateGeom(geom, step.turn.axis, Math.round(step.turn.deg / 90));
    const view = cameraView(geom);
    const map = view.map((label) => {
      const [face, idx] = label.split(':');
      if (face !== step.face) {
        throw new Error(`scan sequence broken: step ${step.face} shows ${face} stickers to the camera`);
      }
      return Number(idx);
    });
    if (map.length !== n || new Set(map).size !== n) {
      throw new Error(`scan sequence broken: step ${step.face} does not show the whole face`);
    }
    return { ...step, cameraToFacelet: map };
  });
}

// One face as the camera read it (row-major in camera order) -> facelet order.
export function cameraToFace(map, cells) {
  if (!map) return cells.slice();
  const out = new Array(cells.length);
  map.forEach((idx, k) => {
    out[idx] = cells[k];
  });
  return out;
}

// The inverse: a stored face laid out the way the camera sees it at that step, so
// the on-screen read-back matches the cube in front of the lens.
export function faceToCamera(map, face) {
  if (!map) return face.slice();
  return map.map((idx) => face[idx]);
}
