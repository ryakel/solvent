// colourmemory.js — the colours the user has taught Solvent for THIS cube.
//
// When Solvent can't tell what a sticker is, it asks (app.js), and the answer is
// remembered here: that sticker's camera colour becomes a reference for the
// colour the user picked. Later stickers that clearly match a reference take its
// colour without asking — on the same face, on later faces, and in the live dots.
// Forgotten on New cube: the next cube may be a different cube.
//
// Stickers are compared by their colour MIX, with brightness divided out (each
// sample scaled so its brightest channel is 1). A face turned away from the light
// reads darker but keeps its mix; that is what lets a lime "green" taught on one
// face be recognised on the next. Measured in the synthetic lighting simulator:
// at the thresholds below, plus the whole-cube grouping after the scan, a cube
// with knockoff colours comes out usable ~91–96% of the time in ordinary light,
// for ~8 questions a scan (SOLV-22).

// A sample counts as a taught colour when it is within NEAR of one of that
// colour's samples AND at most RATIO times as far from it as from any other
// taught colour. Once every colour has been taught, every sticker must be one of
// them, so only RATIO applies.
export const NEAR = 0.08;
export const RATIO = 0.5;

// [r,g,b] -> the colour's mix, brightness divided out.
export function colourMix(rgb) {
  const m = Math.max(1, rgb[0], rgb[1], rgb[2]);
  return [rgb[0] / m, rgb[1] / m, rgb[2] / m];
}

export function mixDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// colourCount: how many colours the cube has (6), so the memory knows when it
// has seen them all.
export function createColourMemory({ near = NEAR, ratio = RATIO, colourCount = 6 } = {}) {
  const taught = []; // { mix, rgb, colour }

  // Each taught colour with its distance to `rgb` (its nearest sample), nearest first.
  function rank(rgb) {
    const mix = colourMix(rgb);
    const best = new Map();
    for (const t of taught) {
      const d = mixDistance(mix, t.mix);
      if (!best.has(t.colour) || d < best.get(t.colour)) best.set(t.colour, d);
    }
    return [...best.entries()].sort((a, b) => a[1] - b[1]);
  }

  return {
    // { colour, nearest }: colour when the sample clearly matches a taught colour,
    // else null; nearest is the closest taught colour either way (a guess), or
    // null when nothing has been taught.
    recall(rgb) {
      const ranked = rank(rgb);
      if (!ranked.length) return { colour: null, nearest: null };
      const [[c0, d0], second] = ranked;
      const r = second ? (second[1] === 0 ? 1 : d0 / second[1]) : 0;
      const seenAll = ranked.length >= colourCount;
      const known = seenAll ? r <= ratio : d0 <= near && r <= ratio;
      return { colour: known ? c0 : null, nearest: c0 };
    },
    teach(rgb, colour) {
      taught.push({ mix: colourMix(rgb), rgb: rgb.slice(), colour });
    },
    // The colour the user gave this exact sample, if they did — a taught answer
    // is ground truth, so the whole-cube grouping keeps it.
    answerFor(rgb) {
      const t = taught.find((x) => x.rgb[0] === rgb[0] && x.rgb[1] === rgb[1] && x.rgb[2] === rgb[2]);
      return t ? t.colour : null;
    },
    taughtColours() {
      return [...new Set(taught.map((t) => t.colour))].sort();
    },
    forget() {
      taught.length = 0;
    },
  };
}

// Group look-alike samples so the user is asked once per colour, not once per
// sticker: indices whose mixes chain together within `near`.
export function lookAlikeGroups(rgbs, indices, near = NEAR) {
  const groups = [];
  for (const i of indices) {
    const mix = colourMix(rgbs[i]);
    const hits = groups.filter((g) => g.some((j) => mixDistance(mix, colourMix(rgbs[j])) <= near));
    if (!hits.length) {
      groups.push([i]);
      continue;
    }
    // i links these groups together: merge them.
    const merged = hits.flat().concat(i);
    for (const h of hits) groups.splice(groups.indexOf(h), 1);
    groups.push(merged);
  }
  return groups.map((g) => g.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}
