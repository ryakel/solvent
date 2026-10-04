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
