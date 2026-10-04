// calibrate.test.js — re-reading colours against the cube's own stickers
// (core/calibrate.js). The simulator below is SYNTHETIC lighting (per-face
// brightness and warm/cool tint, a per-cube palette spread, noise, glare) —
// it shows the method's shape, not real-camera numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hungarian, calibrateLabels, rgbToLab } from '../src/core/calibrate.js';
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
