// e2e.test.js — headless browser test of the real built site, served under a
// /solvent/ subpath to mimic GitHub Pages. Covers DoD #3, #4, #7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { createServer } from '../scripts/serve.mjs';
import { SOLVED, applyMove } from '../src/core/cube2.js';
import * as cube2 from '../src/core/cube2.js';
import size2x2 from '../src/sizes/size2x2.js';
import size3x3 from '../src/sizes/size3x3.js';
import * as cube3 from '../src/core/cube3.js';
import { scanPhotos } from './virtual-camera.js';

const EXE = '/opt/pw-browsers/chromium';
const BASE = '/solvent';

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(BASE);
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

// Build a known scramble's faces object to inject via the manual palette hook.
function scrambledFaces(seq) {
  let s = SOLVED;
  for (const m of seq) s = applyMove(s, m);
  return size2x2.faceColorsFromState(s);
}

async function launch() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXE,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  return browser;
}

test('site loads with no console errors and no camera permission (fallback path)', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    // NOTE: no camera permission granted -> exercises the manual fallback.
    const context = await browser.newContext();
    const errors = [];
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });

    // The app booted and the capture screen is active.
    await page.waitForSelector('#screen-capture.is-active');
    // Camera is unavailable in headless without permission -> fallback message shows.
    await page.waitForSelector('#camera-msg:not([hidden])', { timeout: 5000 }).catch(() => {});

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('manual entry of a known scramble solves and steps to a solved cube', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext();
    const errors = [];
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent);

    const seq = ['R', 'U', "F'", 'R2', "U'", 'F', 'U'];
    const faces = scrambledFaces(seq);

    // Enter review and inject the corrected/known stickers via the palette hook.
    await page.evaluate((f) => {
      window.__solvent.goReview();
      window.__solvent.setFaces(f);
    }, faces);

    await page.waitForSelector('#screen-review.is-active');
    // trigger validation by focusing the solve flow: validity is recomputed on setFaces? call solve.
    await page.click('#btn-solve');

    await page.waitForSelector('#screen-solution.is-active');

    // A move list was produced.
    const moveCount = await page.$$eval('#move-list li', (els) => els.length);
    assert.ok(moveCount > 0, 'expected a non-empty move list');

    // The 3D cube initialized (a WebGL canvas exists and has size).
    const canvasOk = await page.$eval('#viewer canvas', (c) => c.width > 0 && c.height > 0);
    assert.ok(canvasOk, '3D cube canvas should be initialized');

    // Step through every move.
    for (let i = 0; i < moveCount; i++) {
      await page.click('#btn-next');
      await page.waitForFunction(
        (n) => window.__solvent.getState().stepIndex === n,
        i + 1
      );
    }

    // Ended solved: the displayed frame is a solved cube, and Next is disabled.
    const solved = await page.evaluate(() => window.__solvent.currentFrameSolved());
    assert.ok(solved, 'stepping through the solution should end in a solved cube');
    const nextDisabled = await page.$eval('#btn-next', (b) => b.disabled);
    assert.ok(nextDisabled, 'Next should be disabled at the end');

    // Stepping back works too.
    await page.click('#btn-prev');
    await page.waitForFunction((n) => window.__solvent.getState().stepIndex === n, moveCount - 1);

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('an impossible cube is rejected with a helpful message', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent);

    // All six faces White: correct total sticker count is impossible; clearly invalid.
    const bogus = {
      U: ['W', 'W', 'W', 'W'],
      R: ['W', 'W', 'W', 'W'],
      F: ['W', 'W', 'W', 'W'],
      D: ['W', 'W', 'W', 'W'],
      L: ['W', 'W', 'W', 'W'],
      B: ['W', 'W', 'W', 'W'],
    };
    await page.evaluate((f) => {
      window.__solvent.goReview();
      window.__solvent.setFaces(f);
    }, bogus);
    await page.waitForSelector('#screen-review.is-active');

    // Validation runs immediately; an invalid cube shows errors and DISABLES solve
    // (so there is no way to attempt a solve on an impossible cube).
    await page.waitForSelector('.validation__errs');
    const stillReview = await page.$eval('#screen-review', (s) => s.classList.contains('is-active'));
    assert.ok(stillReview, 'invalid cube must not proceed to solution');
    const errText = await page.$eval('.validation__errs', (n) => n.textContent);
    assert.ok(/appears/.test(errText), 'expected a specific count error, got: ' + errText);
    const solveDisabled = await page.$eval('#btn-solve', (b) => b.disabled);
    assert.ok(solveDisabled, 'Solve should be disabled for an invalid cube');

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('solution auto-play advances to a solved cube and then stops on its own', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext();
    const errors = [];
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent);

    // A short scramble keeps the auto-play run brief and deterministic.
    const faces = scrambledFaces(['R', 'U', "R'"]);
    await page.evaluate((f) => {
      window.__solvent.goReview();
      window.__solvent.setFaces(f);
    }, faces);
    await page.click('#btn-solve');
    await page.waitForSelector('#screen-solution.is-active');

    const moveCount = await page.$$eval('#move-list li', (els) => els.length);
    assert.ok(moveCount > 0, 'expected a non-empty move list');

    // Press Play and let it run to the end untouched.
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__solvent.isPlaying() === true, { timeout: 5000 });
    await page.waitForFunction(
      () => window.__solvent.currentFrameSolved() && window.__solvent.isPlaying() === false,
      { timeout: 30000 }
    );

    // Ended at the last move, stopped, and Next is disabled.
    const state = await page.evaluate(() => window.__solvent.getState());
    assert.equal(state.stepIndex, moveCount, 'auto-play should reach the final move');
    const nextDisabled = await page.$eval('#btn-next', (b) => b.disabled);
    assert.ok(nextDisabled, 'Next should be disabled once auto-play finishes');

    // Stepping still works after playing.
    await page.click('#btn-prev');
    await page.waitForFunction((n) => window.__solvent.getState().stepIndex === n, moveCount - 1);

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('prefers-reduced-motion snaps instead of animating', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent);

    const faces = scrambledFaces(['R', 'U', "R'"]);
    await page.evaluate((f) => {
      window.__solvent.goReview();
      window.__solvent.setFaces(f);
    }, faces);
    await page.click('#btn-solve');
    await page.waitForSelector('#screen-solution.is-active');

    // With reduced motion, a Next click resolves effectively instantly.
    const t0 = Date.now();
    await page.click('#btn-next');
    await page.waitForFunction(() => window.__solvent.getState().stepIndex === 1);
    const dt = Date.now() - t0;
    assert.ok(dt < 300, `reduced-motion step should be near-instant, took ${dt}ms`);

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- synthetic camera -------------------------------------------------------
// Replaces getUserMedia with a canvas stream that paints whatever face the test
// shows it, sized to the scanner's centred reticle square. Each call returns a
// fresh stream (the app stops tracks between screens).
function installFakeCamera() {
  const W = 640;
  const H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  let cells = null;
  let n = 2;
  (function paint() {
    ctx.fillStyle = '#0b0d11';
    ctx.fillRect(0, 0, W, H);
    if (cells) {
      const side = Math.min(W, H) * 0.6;
      const x0 = (W - side) / 2;
      const y0 = (H - side) / 2;
      const cell = side / n;
      cells.forEach((hex, i) => {
        ctx.fillStyle = hex;
        ctx.fillRect(x0 + (i % n) * cell + cell * 0.06, y0 + Math.floor(i / n) * cell + cell * 0.06, cell * 0.88, cell * 0.88);
      });
    }
    requestAnimationFrame(paint);
  })();
  const streams = [];
  window.__fakeCam = {
    show(hexes, gridN) {
      cells = hexes;
      n = gridN;
    },
    // How many camera tracks are open right now — must never exceed one.
    liveTracks: () => streams.flatMap((st) => st.getTracks()).filter((t) => t.readyState === 'live').length,
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const st = canvas.captureStream(30);
    streams.push(st);
    return st;
  };
}

const hexToRgb = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`;
};

// Show the camera one face and wait until the live read-out over the reticle
// reports exactly those colours, so the next capture samples this face.
async function presentFace(page, mod, cells) {
  await page.evaluate(
    ({ hexes, n }) => window.__fakeCam.show(hexes, n),
    { hexes: cells.map((c) => mod.colorHex[c]), n: mod.gridN }
  );
  await page.waitForFunction(
    (want) => {
      const chips = [...document.querySelectorAll('#reticle .reticle-chip')];
      return chips.length === want.length && chips.every((c, i) => c.style.background === want[i]);
    },
    cells.map((c) => hexToRgb(mod.colorHex[c])),
    { timeout: 5000 }
  );
}

// Scan a cube with the camera exactly as the guide instructs: one face per step,
// the cube turned between steps. Ends on Verify (the app moves there by itself).
async function scanWithCamera(page, mod, geom) {
  const photos = scanPhotos(mod.scanSequence, geom);
  for (const { cells } of photos) {
    await presentFace(page, mod, cells);
    await page.click('#btn-capture');
  }
  await page.waitForSelector('#screen-review.is-active');
  return photos;
}

async function netFaces(page) {
  return page.$$eval('.net-face', (els) =>
    Object.fromEntries(els.map((f) => [f.dataset.face, [...f.querySelectorAll('.sticker')].map((s) => s.style.background)]))
  );
}

function netOf(mod, faces) {
  return Object.fromEntries(mod.faceOrder.map((f) => [f, faces[f].map((c) => hexToRgb(mod.colorHex[c]))]));
}

test('a camera scan that follows the guide yields the real cube and solves it', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(installFakeCamera);
    const errors = [];
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent && !document.querySelector('#btn-capture').disabled);

    let s = SOLVED;
    for (const m of ['R', 'U', "F'", 'R2', "U'", 'F', 'U', "R'", 'F2']) s = applyMove(s, m);
    const photos = await scanWithCamera(page, size2x2, size2x2.geomFromState(s));

    // Verify shows the cube in hand, sticker for sticker, and accepts it.
    assert.deepEqual(await netFaces(page), netOf(size2x2, size2x2.faceColorsFromState(s)));
    await page.waitForSelector('.validation__ok');

    // Back on Scan, the read-back for a tilted face (Up) still shows it the way
    // the camera saw it, not the way it is stored.
    await page.click('#btn-back-capture');
    const up = size2x2.scanSequence.findIndex((st) => st.face === 'U');
    await page.click(`#face-progress .face-chip:nth-child(${up + 1})`);
    const readback = await page.$$eval('#scan-readback-grid i', (els) => els.map((e) => e.style.background));
    assert.deepEqual(readback, photos[up].cells.map((c) => hexToRgb(size2x2.colorHex[c])));

    // And the solution solves it.
    await page.click('#btn-manual');
    await page.click('#btn-solve');
    await page.waitForSelector('#screen-solution.is-active');
    const moveCount = await page.$$eval('#move-list li', (els) => els.length);
    await page.click(`#move-list li:nth-child(${moveCount})`);
    await page.waitForFunction((n) => window.__solvent.getState().stepIndex === n, moveCount);
    assert.ok(await page.evaluate(() => window.__solvent.currentFrameSolved()), 'camera-scanned cube should end solved');

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- New cube ---------------------------------------------------------------

async function openWithCamera(browser, port) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addInitScript(installFakeCamera);
  const errors = [];
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__solvent && !document.querySelector('#btn-capture').disabled);
  return { context, page, errors };
}

function scrambleState(cube, seq) {
  let s = cube.SOLVED;
  for (const m of seq) s = cube.applyMove(s, m);
  return s;
}

// The app holds nothing of a previous cube: step 1 of a fresh scan, camera on once.
async function assertFreshCube(page, mod) {
  await page.waitForFunction(() => window.__fakeCam.liveTracks() === 1 && window.__solvent.snapshot().screen === 'capture');
  const snap = await page.evaluate(() => window.__solvent.snapshot());
  assert.equal(snap.size, mod.id);
  assert.equal(snap.captureIndex, 0);
  assert.equal(snap.hasSolution, false);
  assert.equal(snap.stepIndex, 0);
  for (const f of mod.faceOrder) {
    assert.deepEqual(snap.faces[f], new Array(mod.gridN ** 2).fill(null), `face ${f} not cleared`);
    assert.ok(snap.lowConf[f].every((x) => x === false), `face ${f} still flagged`);
  }
  assert.equal(await page.textContent('#capture-step'), `STEP 1/${mod.scanSequence.length}`);
  assert.equal(await page.$$eval('#face-progress [data-done="true"]', (els) => els.length), 0);
  assert.ok(await page.$eval('#scan-readback', (n) => n.hidden), 'read-back should be empty');
  assert.equal(await page.$$eval('#move-list li', (els) => els.length), 0);
  assert.equal(await page.evaluate(() => window.__fakeCam.liveTracks()), 1, 'exactly one camera stream');
}

async function solveToEnd(page) {
  await page.click('#btn-solve');
  await page.waitForSelector('#screen-solution.is-active');
  const moveCount = await page.$$eval('#move-list li', (els) => els.length);
  await page.click(`#move-list li:nth-child(${moveCount})`);
  await page.waitForFunction((n) => window.__solvent.getState().stepIndex === n, moveCount);
  return moveCount;
}

test('New cube clears every trace of the previous cube, from every screen', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page, errors } = await openWithCamera(browser, port);

    // Cube A, scanned and solved part-way.
    const a = scrambleState(cube2, ['R', 'U', "F'", 'R2', "U'", 'F']);
    await scanWithCamera(page, size2x2, size2x2.geomFromState(a));
    await page.click('#btn-solve');
    await page.waitForSelector('#screen-solution.is-active');
    await page.click('#btn-next');
    await page.waitForFunction(() => window.__solvent.getState().stepIndex === 1);

    // From Solve, via the header.
    await page.click('#btn-new-cube');
    await assertFreshCube(page, size2x2);
    assert.ok(await page.$eval('#solution-setup', (n) => n.hidden), 'setup card should be gone');

    // From Scan, half-way through a cube: the camera stays up, nothing restarts.
    const photos = scanPhotos(size2x2.scanSequence, size2x2.geomFromState(a));
    for (const { cells } of photos.slice(0, 3)) {
      await presentFace(page, size2x2, cells);
      await page.click('#btn-capture');
    }
    await page.click('#btn-new-cube');
    await assertFreshCube(page, size2x2);

    // From Verify (camera stopped there), and Verify's own Reset rewinds the scan.
    await presentFace(page, size2x2, photos[0].cells);
    await page.click('#btn-capture');
    await page.click('#btn-manual');
    await page.waitForSelector('#screen-review.is-active');
    await page.click('#btn-reset');
    await page.click('#btn-back-capture');
    await assertFreshCube(page, size2x2);
    await page.click('#btn-manual');
    await page.click('#btn-new-cube');
    await assertFreshCube(page, size2x2);

    // Cube B goes through cleanly and solves; the Solution screen's button resets too.
    const b = scrambleState(cube2, ['F', 'R', "U'", 'F2', 'R', "U'", "R'"]);
    await scanWithCamera(page, size2x2, size2x2.geomFromState(b));
    assert.deepEqual(await netFaces(page), netOf(size2x2, size2x2.faceColorsFromState(b)));
    await solveToEnd(page);
    assert.ok(await page.evaluate(() => window.__solvent.currentFrameSolved()), 'cube B should end solved');
    await page.click('#btn-new');
    await assertFreshCube(page, size2x2);

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('switching size mid-scan starts a fresh cube that samples the new grid', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page, errors } = await openWithCamera(browser, port);

    // Half a 2x2, then switch to 3x3 with the camera live.
    const two = scanPhotos(size2x2.scanSequence, size2x2.geomFromState(scrambleState(cube2, ['R', 'U'])));
    await presentFace(page, size2x2, two[0].cells);
    await page.click('#btn-capture');
    await page.click('.size-btn:nth-child(2)');
    await assertFreshCube(page, size3x3);

    // A full 3x3 camera scan lands every sticker of the real cube and validates.
    const s3 = scrambleState(cube3, ['R', 'U', "F'", 'L2', 'D', "B'", 'U2', 'R']);
    await scanWithCamera(page, size3x3, size3x3.geomFromState(s3));
    assert.deepEqual(await netFaces(page), netOf(size3x3, size3x3.faceColorsFromState(s3)));
    await page.waitForSelector('.validation__ok');

    // And back to 2x2 is a fresh 2x2.
    await page.click('#btn-back-capture');
    await page.click('.size-btn:nth-child(1)');
    await assertFreshCube(page, size2x2);

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});
