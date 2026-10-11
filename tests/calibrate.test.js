// calibrate.test.js — re-reading colours against the cube's own stickers
// (core/calibrate.js). The simulator below is SYNTHETIC lighting (per-face
// brightness and warm/cool tint, a per-cube palette spread, noise, glare) —
// it shows the method's shape, not real-camera numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hungarian, calibrateLabels, groupColours, rgbToLab } from '../src/core/calibrate.js';
import * as cube2 from '../src/core/cube2.js';
import * as cube3 from '../src/core/cube3.js';
import size2x2 from '../src/sizes/size2x2.js';
import size3x3 from '../src/sizes/size3x3.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function permutations(n) {
  if (n === 1) return [[0]];
  const out = [];
  for (const p of permutations(n - 1)) for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  return out;
}

test('Hungarian matching finds the cheapest assignment (vs brute force)', () => {
  const rand = rng(1);
  const perms = permutations(6);
  for (let t = 0; t < 200; t++) {
    const cost = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => Math.floor(rand() * 100)));
    const best = Math.min(...perms.map((p) => p.reduce((sum, col, row) => sum + cost[row][col], 0)));
    const a = hungarian(cost);
    assert.equal(new Set(a).size, 6, 'a permutation');
    assert.equal(a.reduce((sum, col, row) => sum + cost[row][col], 0), best);
  }
});

test('Lab: white is L*100, black L*0, greys are neutral', () => {
  assert.ok(Math.abs(rgbToLab([255, 255, 255])[0] - 100) < 0.01);
  assert.ok(Math.abs(rgbToLab([0, 0, 0])[0]) < 0.01);
  const g = rgbToLab([128, 128, 128]);
  assert.ok(Math.abs(g[1]) < 0.01 && Math.abs(g[2]) < 0.01);
});

test('a re-read gives every colour exactly its N² stickers and never moves a pinned one', () => {
  const rand = rng(2);
  for (let t = 0; t < 50; t++) {
    const rgbs = Array.from({ length: 24 }, () => [rand() * 255, rand() * 255, rand() * 255].map(Math.round));
    const labels = rgbs.map(() => size2x2.colors[Math.floor(rand() * 6)]);
    const fixed = rgbs.map(() => rand() < 0.2);
    // Pinned stickers must be satisfiable: give pinned ones a colour that still
    // fits 4 per colour by construction — pin at most one per colour.
    const seen = new Set();
    fixed.forEach((f, i) => {
      if (f && seen.has(labels[i])) fixed[i] = false;
      seen.add(labels[i]);
    });
    rgbs.forEach((_, i) => i % 7 === 0 && (rgbs[i] = null)); // hand-painted: no sample
    const out = calibrateLabels({ rgbs, labels, colors: size2x2.colors, perColor: 4, seedHex: size2x2.colorHex, fixed });
    for (const c of size2x2.colors) assert.equal(out.filter((x) => x === c).length, 4, `${c} count`);
    out.forEach((c, i) => {
      if (fixed[i] || !rgbs[i]) assert.equal(c, labels[i], `pinned sticker ${i} moved`);
    });
  }
});

// ---- simulator --------------------------------------------------------------
const PALETTE = { W: [235, 238, 240], Y: [250, 210, 30], G: [20, 170, 80], B: [20, 90, 220], R: [200, 30, 45], O: [250, 110, 20] };
function simulate(mod, cube, rand, trials) {
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (x) => Math.max(0, Math.min(255, x));
  const names = Object.keys(cube.MOVES);
  const n2 = mod.gridN ** 2;
  const toFaces = (L) => Object.fromEntries(mod.faceOrder.map((f, k) => [f, L.slice(k * n2, (k + 1) * n2)]));
  const r = { stickers: 0, rawErr: 0, calErr: 0, offered: 0, wrong: 0 };
  for (let t = 0; t < trials; t++) {
    let s = cube.SOLVED;
    for (let i = 0; i < 25; i++) s = cube.applyMove(s, names[Math.floor(rand() * names.length)]);
    const truth = mod.faceColorsFromState(s);
    const pal = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, v.map((x) => clamp(x + gauss() * 14))]));
    const rgbs = [];
    const truthL = [];
    const raw = [];
    for (const f of mod.faceOrder) {
      const bright = 0.55 + rand() * 1.1;
      const warm = (rand() * 2 - 1) * 0.18;
      const ill = [bright * (1 + warm), bright, bright * (1 - warm * 1.4)];
      for (const col of truth[f]) {
        let o = pal[col].map((x, i) => clamp(x * ill[i] + gauss() * 5));
        if (rand() < 0.06) {
          const a = 0.25 + rand() * 0.3;
          o = o.map((x) => clamp(x * (1 - a) + 255 * a));
        }
        rgbs.push(o);
        truthL.push(col);
        raw.push(mod.classifyColor(o));
      }
    }
    const cal = calibrateLabels({ rgbs, labels: raw, colors: mod.colors, perColor: n2, seedHex: mod.colorHex });
    r.stickers += truthL.length;
    r.rawErr += raw.filter((x, i) => x !== truthL[i]).length;
    r.calErr += cal.filter((x, i) => x !== truthL[i]).length;
    if (!mod.validate(toFaces(raw)).ok && mod.validate(toFaces(cal)).ok) {
      r.offered++;
      if (cal.some((x, i) => x !== truthL[i])) r.wrong++;
    }
  }
  return r;
}

for (const { mod, cube, seed } of [
  { mod: size2x2, cube: cube2, seed: 21 },
  { mod: size3x3, cube: cube3, seed: 23 },
]) {
  test(`${mod.id}: in simulated lighting the re-read misreads far less, and its offers are rarely a different cube`, () => {
    const r = simulate(mod, cube, rng(seed), 300);
    const pct = (x) => ((100 * x) / r.stickers).toFixed(2);
    console.log(`    ${mod.id}: sticker errors raw ${pct(r.rawErr)}% -> re-read ${pct(r.calErr)}%; offers ${r.offered}, wrong ${r.wrong}`);
    assert.ok(r.calErr < r.rawErr / 2, `re-read ${r.calErr} vs raw ${r.rawErr} sticker errors`);
    assert.ok(r.offered > 50, 'the offer actually comes up');
    assert.ok(r.wrong / r.offered < 0.01, `${r.wrong}/${r.offered} offers were a different cube`);
  });
}

// ---- Non-standard colors: group the cube by its own colours (SOLV-21) ---------------------

// Ryan's knockoff 3x3, from his photo: the standard classifier reads its lime
// green as yellow, and its coral red sits on the red/orange line.
test('the standard classifier misreads a knockoff lime green as yellow', () => {
  assert.equal(size3x3.classifyColor([115, 219, 0]), 'Y');
  assert.equal(size2x2.classifyColor([115, 219, 0]), 'Y');
});

test('grouping gives every colour exactly its N² stickers and never moves a pinned one', () => {
  const rand = rng(31);
  for (let t = 0; t < 50; t++) {
    const rgbs = Array.from({ length: 24 }, () => [rand() * 255, rand() * 255, rand() * 255].map(Math.round));
    const labels = rgbs.map(() => size2x2.colors[Math.floor(rand() * 6)]);
    const seen = new Set();
    const fixed = rgbs.map((_, i) => {
      const pin = rand() < 0.2 && !seen.has(labels[i]);
      if (pin) seen.add(labels[i]);
      return pin;
    });
    const faceOf = rgbs.map((_, i) => Math.floor(i / 4));
    const { labels: out, margins } = groupColours({ rgbs, labels, faceOf, fixed, colors: size2x2.colors, perColor: 4, seedHex: size2x2.colorHex });
    for (const c of size2x2.colors) assert.equal(out.filter((x) => x === c).length, 4, `${c} count`);
    out.forEach((c, i) => {
      if (fixed[i]) {
        assert.equal(c, labels[i], `pinned sticker ${i} moved`);
        assert.equal(margins[i], 1);
      }
    });
    assert.ok(margins.every((m) => m >= -1 && m <= 1));
  }
});

// Mild light: one room light, faces differing by angle. The knockoff palette is
// Ryan's hues as an older camera's video frame would give them.
const KNOCKOFF = { W: [200, 210, 205], Y: [215, 205, 40], G: [110, 180, 30], B: [40, 95, 190], R: [215, 95, 70], O: [220, 90, 25] };
function simulateGrouping(mod, cube, rand, trials, palette) {
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (x) => Math.max(0, Math.min(255, x));
  const names = Object.keys(cube.MOVES);
  const n2 = mod.gridN ** 2;
  const toFaces = (L) => Object.fromEntries(mod.faceOrder.map((f, k) => [f, L.slice(k * n2, (k + 1) * n2)]));
  const r = { classifierRight: 0, usable: 0, wrongButValid: 0 };
  for (let t = 0; t < trials; t++) {
    let s = cube.SOLVED;
    for (let i = 0; i < 25; i++) s = cube.applyMove(s, names[Math.floor(rand() * names.length)]);
    const truth = mod.faceColorsFromState(s);
    const pal = Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, v.map((x) => clamp(x + gauss() * 14))]));
    const rgbs = [];
    const truthL = [];
    const faceOf = [];
    mod.faceOrder.forEach((f, fi) => {
      const bright = 0.8 + rand() * 0.4;
      const warm = (rand() * 2 - 1) * 0.04;
      const ill = [bright * (1 + warm), bright, bright * (1 - warm * 1.4)];
      for (const col of truth[f]) {
        let o = pal[col].map((x, i) => clamp(x * ill[i] + gauss() * 5));
        if (rand() < 0.03) {
          const a = 0.25 + rand() * 0.3;
          o = o.map((x) => clamp(x * (1 - a) + 255 * a));
        }
        rgbs.push(o);
        truthL.push(col);
        faceOf.push(fi);
      }
    });
    const raw = rgbs.map((o) => mod.classifyColor(o));
    const { labels } = groupColours({ rgbs, labels: raw, faceOf, colors: mod.colors, perColor: n2, seedHex: mod.colorHex });
    r.classifierRight += raw.every((x, i) => x === truthL[i]);
    // Usable: a one-to-one relabelling of the real cube. Names may trade between
    // two close colours, but the same turns solve it ("solved" = one colour per face).
    const fwd = {};
    const back = {};
    const usable = labels.every((x, i) => (fwd[truthL[i]] ??= x) === x && (back[x] ??= truthL[i]) === truthL[i]);
    r.usable += usable;
    if (!usable && mod.validate(toFaces(labels)).ok) r.wrongButValid++;
  }
  return r;
}

for (const { mod, cube, seed } of [
  { mod: size2x2, cube: cube2, seed: 41 },
  { mod: size3x3, cube: cube3, seed: 43 },
]) {
  test(`${mod.id}: a knockoff cube grouped by its own colours is usable, and never a wrong real cube`, () => {
    const T = 300;
    const k = simulateGrouping(mod, cube, rng(seed), T, KNOCKOFF);
    const std = simulateGrouping(mod, cube, rng(seed + 1), T, PALETTE);
    console.log(
      `    ${mod.id} knockoff: classifier right ${k.classifierRight}/${T}, grouped usable ${k.usable}/${T}, wrong-but-valid ${k.wrongButValid}; standard: grouped usable ${std.usable}/${T}`
    );
    assert.ok(k.usable / T >= 0.75, `knockoff usable ${k.usable}/${T}`);
    assert.equal(k.wrongButValid, 0, 'a grouping that validates is the real cube');
    assert.equal(std.wrongButValid, 0);
    assert.ok(std.usable >= std.classifierRight && std.usable / T >= 0.95, `standard usable ${std.usable}/${T}`);
  });
}
