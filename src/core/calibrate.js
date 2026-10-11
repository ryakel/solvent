// calibrate.js — re-read sticker colours against the cube's own stickers.
//
// The camera classifier (sizes/size2x2.js) compares each sticker with FIXED hue
// references, so a warm room, a cool LED or a cube whose red runs orange can
// tip stickers into the neighbouring colour. But every cube carries its own
// references: exactly N² stickers of each colour, all photographed by the same
// camera under the same light. So instead of judging stickers one at a time,
// assign ALL of them at once to the six colours — each colour getting exactly
// its N² stickers — choosing the assignment that keeps every colour's stickers
// closest to that colour's own average. Iterate (re-average, re-assign) until
// stable. Starts from the classifier's reading; never needs the scheme's hexes
// except to seed a colour nobody was read as.
//
// Pure functions: samples in, labels out. The Verify step decides whether to
// offer the result (only if it turns an impossible cube into a real one).

// sRGB (0..255) -> CIE L*a*b* (D65). Distances in Lab track perceived colour.
export function rgbToLab([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Lightness varies most with light and angle; colour (a*, b*) is what tells
// stickers apart. Weight L* down so a shadowed sticker still matches its kin.
const L_WEIGHT = 0.35;
function dist2(p, q) {
  const dl = (p[0] - q[0]) * L_WEIGHT;
  const da = p[1] - q[1];
  const db = p[2] - q[2];
  return dl * dl + da * da + db * db;
}

// Minimum-cost perfect matching on a square cost matrix (Hungarian algorithm,
// O(n³)). Returns assign[row] = column.
export function hungarian(cost) {
  const n = cost.length;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1); // p[col] = row matched to col (1-based)
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const assign = new Array(n);
  for (let j = 1; j <= n; j++) assign[p[j] - 1] = j - 1;
  return assign;
}

// Re-read colours as a balanced assignment.
//   rgbs:   [r,g,b] per sticker (any order; one entry per sticker on the cube),
//           or null for a sticker with no camera sample (hand-painted) — those
//           keep their colour and don't count towards any colour's average
//   labels: the classifier's reading of each, as colour letters
//   colors: the scheme's colour letters; perColor: stickers per colour (N²)
//   seedHex: { letter: '#rrggbb' } — only used for a colour no sticker was read as
//   fixed:  optional boolean per sticker — hand-painted stickers keep their colour
// Returns the new label per sticker.
export function calibrateLabels({ rgbs, labels, colors, perColor, seedHex, fixed = [] }) {
  const pinned = rgbs.map((rgb, i) => !rgb || !!fixed[i]);
  const labs = rgbs.map((rgb) => (rgb ? rgbToLab(rgb) : null));
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  let current = labels.slice();
  for (let round = 0; round < 8; round++) {
    // Each colour's prototype: the average of the stickers currently read as it.
    const proto = {};
    for (const c of colors) {
      const mine = labs.filter((p, i) => p && current[i] === c);
      proto[c] = mine.length
        ? [0, 1, 2].map((k) => mine.reduce((sum, p) => sum + p[k], 0) / mine.length)
        : rgbToLab(hexToRgb(seedHex[c]));
    }
    // Slots: perColor per colour. A fixed sticker can only take its own colour.
    const slotColor = colors.flatMap((c) => new Array(perColor).fill(c));
    const BIG = 1e9;
    const cost = labs.map((p, i) =>
      slotColor.map((c) => (pinned[i] ? (c === labels[i] ? 0 : BIG) : dist2(p, proto[c])))
    );
    const assign = hungarian(cost);
    const next = assign.map((slot) => slotColor[slot]);
    if (next.every((c, i) => c === current[i])) break;
    current = next;
  }
  return current;
}

// Group stickers into the six colours from the cube's OWN colours — for cubes
// whose stickers aren't the standard shades (a lime "green", a coral "red"), where
// fixed references put whole colours on the wrong side of a line.
//
// Same balanced assignment as calibrateLabels (exactly perColor stickers per
// colour, iterated to a fixed point), plus a per-face brightness correction:
// a face lit more brightly than the others makes every one of its stickers look
// lighter, so each face gets a gain, estimated from how much brighter its
// stickers are than their colours' averages, and is divided back out before
// comparing. Groups take their names from the starting labels (the classifier's
// reading, or seedHex for a colour nobody was read as), so a lime green still
// ends up called Green. Names can come out traded between two close colours —
// harmless for solving, which only needs stickers that match to match.
//
//   rgbs, labels, colors, perColor, seedHex, fixed: as calibrateLabels
//   faceOf: the face index of each sticker
// Returns { labels, margins }. margins[i] is how clearly sticker i belongs to its
// group: (d_next - d_own) / (d_next + d_own), ~1 squarely in it, ~0 between two
// groups. Pinned stickers report 1.
export function groupColours({ rgbs, labels, colors, perColor, seedHex, faceOf, fixed = [] }) {
  const pinned = rgbs.map((rgb, i) => !rgb || !!fixed[i]);
  const faces = [...new Set(faceOf)];
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  // Log luminance: brightness differences between faces are ratios.
  const logLum = rgbs.map((x) => (x ? Math.log(8 + 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]) : 0));
  const gain = new Map(faces.map((f) => [f, 0])); // log gain per face
  const slotColor = colors.flatMap((c) => new Array(perColor).fill(c));
  const BIG = 1e9;
  let current = labels.slice();
  let labs = [];
  let proto = {};
  for (let round = 0; round < 12; round++) {
    labs = rgbs.map((x, i) => {
      if (!x) return null;
      const k = Math.exp(gain.get(faceOf[i]));
      return rgbToLab(x.map((v) => Math.min(255, v / k)));
    });
    proto = {};
    for (const c of colors) {
      const mine = labs.filter((p, i) => p && !pinned[i] && current[i] === c);
      proto[c] = mine.length
        ? [0, 1, 2].map((k) => mine.reduce((sum, p) => sum + p[k], 0) / mine.length)
        : rgbToLab(hexToRgb(seedHex[c]));
    }
    const cost = labs.map((p, i) =>
      slotColor.map((c) => (pinned[i] ? (c === labels[i] ? 0 : BIG) : dist2(p, proto[c])))
    );
    const next = hungarian(cost).map((slot) => slotColor[slot]);
    // Re-estimate each face's gain: log Y = face gain + colour level.
    const level = {};
    for (const c of colors) {
      const idx = rgbs.map((_, i) => i).filter((i) => !pinned[i] && next[i] === c);
      level[c] = idx.length ? idx.reduce((s, i) => s + logLum[i] - gain.get(faceOf[i]), 0) / idx.length : 0;
    }
    const sum = new Map(faces.map((f) => [f, [0, 0]]));
    rgbs.forEach((_, i) => {
      if (pinned[i]) return;
      const acc = sum.get(faceOf[i]);
      acc[0] += logLum[i] - level[next[i]];
      acc[1]++;
    });
    const raw = faces.map((f) => (sum.get(f)[1] ? sum.get(f)[0] / sum.get(f)[1] : 0));
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    faces.forEach((f, k) => gain.set(f, raw[k] - mean));
    const settled = next.every((c, i) => c === current[i]);
    current = next;
    if (settled && round >= 2) break;
  }
  const margins = labs.map((p, i) => {
    if (pinned[i]) return 1;
    const own = Math.sqrt(dist2(p, proto[current[i]]));
    const other = Math.min(...colors.filter((c) => c !== current[i]).map((c) => Math.sqrt(dist2(p, proto[c]))));
    return other + own === 0 ? 1 : (other - own) / (other + own);
  });
  return { labels: current, margins };
}
