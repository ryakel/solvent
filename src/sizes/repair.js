// repair.js — when a cube fails validation, look for the one slip that explains
// it, so Verify can offer a one-tap fix instead of a list of impossible pieces.
//
// The slips searched are the ones scanning and entry actually produce:
//   • a face read turned — its grid rotated a quarter or half turn (one face, or
//     two faces);
//   • two whole faces swapped — e.g. Left and Right after turning the wrong way
//     — each possibly also turned.
// A fix is offered only when exactly ONE distinct result among all of them is a
// real cube. If two different fixes would both give a real cube — on a 2x2 an L/R
// swap can sometimes also be "explained" by turning faces — the scan can't tell
// them apart, and guessing could hand the solver someone else's cube. Measured:
// requiring uniqueness only among the smallest fixes picked the wrong cube for
// ~1 in 150 2x2 L/R swaps; across all candidates it never does. (~400
// validations, a few ms on a laptop.)

const TURN_WORDS = {
  1: 'a quarter-turn clockwise',
  2: 'a half turn',
  3: 'a quarter-turn counter-clockwise',
};

// Rotate a row-major N×N grid a quarter-turn clockwise, `k` times.
export function rotateGrid(cells, n, k = 1) {
  let out = cells.slice();
  for (let t = 0; t < ((k % 4) + 4) % 4; t++) {
    const next = new Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) next[c * n + (n - 1 - r)] = out[r * n + c];
    out = next;
  }
  return out;
}

function* candidates(faceOrder) {
  // 1. One face turned.
  for (const f of faceOrder) for (let k = 1; k <= 3; k++) yield { size: 1, turns: { [f]: k }, swap: null };
  // 2. Two faces turned.
  for (let a = 0; a < faceOrder.length; a++) {
    for (let b = a + 1; b < faceOrder.length; b++) {
      for (let ka = 1; ka <= 3; ka++) {
        for (let kb = 1; kb <= 3; kb++) yield { size: 2, turns: { [faceOrder[a]]: ka, [faceOrder[b]]: kb }, swap: null };
      }
    }
  }
  // 3. Two faces swapped, each possibly turned as well.
  for (let a = 0; a < faceOrder.length; a++) {
    for (let b = a + 1; b < faceOrder.length; b++) {
      for (let ka = 0; ka <= 3; ka++) {
        for (let kb = 0; kb <= 3; kb++) {
          yield { size: 3, turns: { [faceOrder[a]]: ka, [faceOrder[b]]: kb }, swap: [faceOrder[a], faceOrder[b]] };
        }
      }
    }
  }
}

// Apply a candidate to faces (and to any per-sticker array shaped like faces,
// e.g. low-confidence flags, so marks travel with their stickers).
export function applyRepair(faces, repair, n) {
  const out = {};
  for (const f of Object.keys(faces)) out[f] = faces[f].slice();
  if (repair.swap) {
    const [a, b] = repair.swap;
    [out[a], out[b]] = [out[b], out[a]];
  }
  for (const [f, k] of Object.entries(repair.turns)) if (k) out[f] = rotateGrid(out[f], n, k);
  return out;
}

function describe(repair, labels) {
  const turned = Object.entries(repair.turns).filter(([, k]) => k);
  const turns = turned.map(([f, k]) => `${labels[f]} ${TURN_WORDS[k]}`).join(', ');
  if (repair.swap) {
    const [a, b] = repair.swap;
    return (
      `The ${labels[a]} and ${labels[b]} faces look swapped — the cube may have been turned the wrong way. ` +
      `Swapping them back${turned.length ? ` (and turning ${turns})` : ''} makes this a real cube.`
    );
  }
  if (turned.length === 1) {
    const [[f, k]] = turned;
    return `The ${labels[f]} face looks like it was read turned. Turning it ${TURN_WORDS[k]} makes this a real cube.`;
  }
  const names = turned.map(([f]) => labels[f]).join(' and ');
  return `The ${names} faces look like they were read turned. Turning them back (${turns}) makes this a real cube.`;
}

// Find the single repair that makes `faces` a real cube, or null. `mod` is a
// SizeModule (validate, faceOrder, gridN, faceLabels).
export function findRepair(mod, faces) {
  if (mod.validate(faces).ok) return null;
  let found = null;
  const tried = new Set();
  for (const cand of candidates(mod.faceOrder)) {
    const fixed = applyRepair(faces, cand, mod.gridN);
    // Different candidates can produce identical stickers (turning a one-colour
    // face, say); judge distinct results, not distinct recipes.
    const key = mod.faceOrder.map((f) => fixed[f].join('')).join('|');
    if (tried.has(key)) continue;
    tried.add(key);
    if (!mod.validate(fixed).ok) continue;
    if (found) return null; // two different real cubes: ambiguous, offer none
    found = { cand, fixed };
  }
  if (!found) return null;
  return { ...found.cand, message: describe(found.cand, mod.faceLabels), faces: found.fixed };
}
