// e2e/app.test.js — headless browser test of the real built site, served under a
// /solvent/ subpath to mimic GitHub Pages. Covers DoD #3, #4, #7.
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { createServer } from '../../scripts/serve.mjs';
import { SOLVED, applyMove } from '../../src/core/cube2.js';
import * as cube2 from '../../src/core/cube2.js';
import size2x2 from '../../src/sizes/size2x2.js';
import size3x3 from '../../src/sizes/size3x3.js';
import * as cube3 from '../../src/core/cube3.js';
import { scanPhotos } from '../virtual-camera.js';

// The cloud dev image ships Chromium here; anywhere else (CI, a laptop) fall back
// to the browser Playwright downloaded itself.
const DEV_IMAGE_CHROMIUM = '/opt/pw-browsers/chromium';
const EXE = existsSync(DEV_IMAGE_CHROMIUM) ? DEV_IMAGE_CHROMIUM : undefined;
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

    // With reduced motion, a Next click lands on the next frame without animating.
    // Timed inside the page — click to stepIndex change — so Playwright round trips
    // and a busy test machine can't masquerade as an animation. An animated turn
    // takes 720ms; a snap takes a few milliseconds.
    const dt = await page.evaluate(async () => {
      const t0 = performance.now();
      document.querySelector('#btn-next').click();
      while (window.__solvent.getState().stepIndex !== 1) await new Promise((r) => setTimeout(r, 0));
      return performance.now() - t0;
    });
    assert.ok(dt < 360, `reduced-motion step should snap, took ${Math.round(dt)}ms`);

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
    // Refuse permission (as after tapping "Block") until set back to false. A test
    // can start in that state by setting window.__fakeCamDenied before install.
    deny: !!window.__fakeCamDenied,
    // The camera dies under the page (backgrounded phone, another app).
    stopAll: () => streams.flatMap((st) => st.getTracks()).forEach((t) => t.stop()),
  };
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.__fakeCam.deny) throw new DOMException('Permission denied', 'NotAllowedError');
    const st = canvas.captureStream(30);
    streams.push(st);
    return st;
  };
}

const hexToRgb = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`;
};

// A camera-order grid as it appears in a left-for-right mirrored preview.
function mirrorCols(cells, n) {
  return cells.map((_, i) => cells[Math.floor(i / n) * n + (n - 1 - (i % n))]);
}

// Show the camera one face and wait until the live read-out over the reticle
// reports exactly those colours where the user sees them (flipped when the
// preview is mirrored), so the next capture samples this face.
async function presentFace(page, mod, cells, { mirrored = false } = {}) {
  await page.evaluate(
    ({ hexes, n }) => window.__fakeCam.show(hexes, n),
    { hexes: cells.map((c) => mod.colorHex[c]), n: mod.gridN }
  );
  const shown = mirrored ? mirrorCols(cells, mod.gridN) : cells;
  await page.waitForFunction(
    (want) => {
      const chips = [...document.querySelectorAll('#reticle .reticle-chip')];
      return chips.length === want.length && chips.every((c, i) => c.style.background === want[i]);
    },
    shown.map((c) => hexToRgb(mod.colorHex[c])),
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

// ---- jumping while a turn animates --------------------------------------------

// Have the page click `selector` on its next task (so the click is certainly
// dispatched), then report 'ok' if it still answers within `ms`, else 'hung' —
// a frozen main thread never answers, so the test fails fast instead of hanging.
async function clickStaysResponsive(page, selector, ms = 3000) {
  await page.evaluate((sel) => {
    setTimeout(() => document.querySelector(sel).click(), 0);
  }, selector);
  await new Promise((r) => setTimeout(r, 100));
  return Promise.race([page.evaluate(() => 'ok'), new Promise((r) => setTimeout(() => r('hung'), ms))]);
}

test('tapping a move or Reset animation mid-turn never freezes the page', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    // Normal motion on purpose: the bug needs a turn genuinely in flight.
    const context = await browser.newContext();
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent);
    await page.evaluate((f) => {
      window.__solvent.goReview();
      window.__solvent.setFaces(f);
    }, scrambledFaces(['R', 'U', 'F', "R'", 'U2']));
    await page.click('#btn-solve');
    await page.waitForSelector('#screen-solution.is-active');
    const moveCount = await page.$$eval('#move-list li', (els) => els.length);
    assert.ok(moveCount >= 3, 'need a few moves to jump across');

    // During Play, tap the last move while a turn is animating.
    await page.click('#btn-play');
    await page.waitForTimeout(250);
    assert.equal(
      await clickStaysResponsive(page, `#move-list li:nth-child(${moveCount})`),
      'ok',
      'page froze after tapping a move mid-turn'
    );
    await page.waitForFunction((n) => window.__solvent.getState().stepIndex === n, moveCount, { timeout: 20000 });
    assert.ok(await page.evaluate(() => window.__solvent.currentFrameSolved()), 'should end on the solved frame');

    // Reset animation while a backward step is in flight.
    await page.click('#btn-prev');
    await page.waitForTimeout(200);
    assert.equal(await clickStaysResponsive(page, '#btn-restart-anim'), 'ok', 'page froze after Reset animation mid-turn');
    await page.waitForFunction(() => window.__solvent.getState().stepIndex === 0, null, { timeout: 20000 });

    // Two quick taps in opposite directions: the latest one wins, no ping-pong.
    await page.click(`#move-list li:nth-child(${moveCount})`);
    await page.waitForTimeout(250);
    assert.equal(await clickStaysResponsive(page, '#move-list li:nth-child(1)'), 'ok', 'page froze on a second jump');
    await page.waitForFunction(() => window.__solvent.getState().stepIndex === 1, null, { timeout: 20000 });
    await page.waitForTimeout(1600); // nothing keeps moving afterwards
    assert.equal(await page.evaluate(() => window.__solvent.getState().stepIndex), 1);

    assert.deepEqual(errors, [], 'page errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('with Mirror on, the live dots and read-back flip with the preview; stored stickers do not', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page, errors } = await openWithCamera(browser, port);
    const s = scrambleState(cube2, ['R', 'U', "F'", 'R2', "U'", 'F']);
    const photos = scanPhotos(size2x2.scanSequence, size2x2.geomFromState(s));
    const asymmetric = photos.find((p) => p.cells.join('') !== mirrorCols(p.cells, 2).join(''));
    assert.ok(asymmetric, 'need a face whose columns differ');
    const step = size2x2.scanSequence.findIndex((st) => st.face === asymmetric.face);
    await page.click(`#face-progress .face-chip:nth-child(${step + 1})`);

    // Mirror off: dots in the camera's own layout (presentFace waits for exactly that).
    await presentFace(page, size2x2, asymmetric.cells);
    await page.click('#btn-capture');
    const plain = (await page.evaluate(() => window.__solvent.snapshot())).faces[asymmetric.face];

    // Mirror on: the dots flip to sit over the stickers the user sees...
    await page.click('#btn-mirror');
    await page.click(`#face-progress .face-chip:nth-child(${step + 1})`);
    await presentFace(page, size2x2, asymmetric.cells, { mirrored: true });
    // ...the read-back of the stored face flips the same way...
    const readback = await page.$$eval('#scan-readback-grid i', (els) => els.map((e) => e.style.background));
    assert.deepEqual(readback, mirrorCols(asymmetric.cells, 2).map((c) => hexToRgb(size2x2.colorHex[c])));
    // ...and a capture stores exactly the same stickers as without Mirror.
    await page.click('#btn-capture');
    const mirroredCapture = (await page.evaluate(() => window.__solvent.snapshot())).faces[asymmetric.face];
    assert.deepEqual(mirroredCapture, plain);

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- capture-time check ----------------------------------------------------------

test('a face that does not fit is held at capture, with Rescan and Keep', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page, errors } = await openWithCamera(browser, port);
    const warning = () => page.$eval('#capture-warning', (n) => (n.hidden ? null : n.textContent));

    // 2x2: capture the first face, then capture again without turning.
    const two = scanPhotos(size2x2.scanSequence, size2x2.geomFromState(scrambleState(cube2, ['R', 'U', "F'", 'R2'])));
    await presentFace(page, size2x2, two[0].cells);
    await page.click('#btn-capture');
    assert.equal(await warning(), null, 'a first capture never warns');
    await page.click('#btn-capture');
    assert.match(await warning(), /hasn't changed/);
    let snap = await page.evaluate(() => window.__solvent.snapshot());
    assert.equal(snap.captureIndex, 1, 'the step is held');

    // Rescan clears the face; the right face then goes through and advances.
    await page.click('#btn-warn-rescan');
    assert.equal(await warning(), null);
    snap = await page.evaluate(() => window.__solvent.snapshot());
    assert.ok(snap.faces[two[1].face].every((c) => c === null), 'Rescan clears the held face');
    await presentFace(page, size2x2, two[1].cells);
    await page.click('#btn-capture');
    assert.equal(await warning(), null);
    assert.equal((await page.evaluate(() => window.__solvent.snapshot())).captureIndex, 2);

    // 3x3: showing the face OPPOSITE the first one at step 2 can't be right.
    await page.click('.size-btn:nth-child(2)');
    await page.waitForFunction(() => window.__solvent.snapshot().size === '3x3');
    const three = scanPhotos(size3x3.scanSequence, size3x3.geomFromState(scrambleState(cube3, ['R', 'U', "F'", 'L2', 'D'])));
    await presentFace(page, size3x3, three[0].cells);
    await page.click('#btn-capture');
    await presentFace(page, size3x3, three[2].cells); // the Back face, at the Right step
    await page.click('#btn-capture');
    assert.match(await warning(), /opposite the Front face/);
    assert.equal((await page.evaluate(() => window.__solvent.snapshot())).captureIndex, 1);

    // Keep moves on regardless (Verify still has the final say).
    await page.click('#btn-warn-keep');
    assert.equal(await warning(), null);
    assert.equal((await page.evaluate(() => window.__solvent.snapshot())).captureIndex, 2);

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- the guide shows this cube; the turn cue rides the preview --------------------

// What the guide cube should show for `faces`: scanned stickers in colour, the
// rest null; a 3x3's unscanned centres in the start instruction's colours.
function expectedGuide(mod, faces) {
  const shown = {};
  for (const f of mod.faceOrder) {
    shown[f] = faces[f].slice();
    if (mod.hasCenters) {
      const c = Math.floor(shown[f].length / 2);
      if (shown[f][c] == null) shown[f][c] = mod.solvedFaces[f][c];
    }
  }
  const out = {};
  for (const c of mod.facesToGeom(shown)) {
    for (const s of c.stickers) out[c.pos.join(',') + '|' + s.normal.join(',')] = s.color ?? null;
  }
  return out;
}

test('the guide cube shows the stickers scanned so far, and the next turn sweeps over the preview', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page, errors } = await openWithCamera(browser, port);
    const snap = () => page.evaluate(() => window.__solvent.snapshot());

    // Nothing scanned: an all-unscanned 2x2.
    let s0 = await snap();
    assert.ok(Object.values(s0.guideColors).every((c) => c === null), 'a fresh 2x2 guide shows no colours');

    const photos = scanPhotos(size2x2.scanSequence, size2x2.geomFromState(scrambleState(cube2, ['R', 'U', "F'", 'R2', "U'"])));
    const cues = [];
    for (let k = 0; k < 5; k++) {
      await presentFace(page, size2x2, photos[k].cells, { mirrored: k >= 2 });
      await page.click('#btn-capture');
      const s = await snap();
      // Exactly the faces captured so far are painted, in their scanned colours.
      assert.deepEqual(s.guideColors, expectedGuide(size2x2, s.faces), `guide colours after capture ${k + 1}`);
      cues.push(s.turnCue);
      if (k === 1) {
        // Turning Mirror on re-points the cue already on screen...
        await page.click('#btn-mirror');
        assert.equal((await snap()).turnCue, 'right');
      }
    }
    // ...and later yaws read mirrored. After F and R: yaw left; after B: tip
    // forward; after U and L (Mirror on): right. Every turn is a quarter turn.
    assert.deepEqual(cues, ['left', 'left', 'down', 'right', 'right']);

    // New cube wipes the guide back to unscanned.
    await page.click('#btn-new-cube');
    await page.waitForFunction(() => window.__solvent.snapshot().captureIndex === 0);
    s0 = await snap();
    assert.ok(Object.values(s0.guideColors).every((c) => c === null));
    assert.equal(s0.turnCue, null);

    // A fresh 3x3 shows only the centres the start instruction asks for.
    await page.click('.size-btn:nth-child(2)');
    await page.waitForFunction(() => window.__solvent.snapshot().size === '3x3');
    const s3 = await snap();
    assert.deepEqual(s3.guideColors, expectedGuide(size3x3, s3.faces));
    assert.equal(Object.values(s3.guideColors).filter(Boolean).length, 6, 'just the six centres');

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- [hidden] means hidden ----------------------------------------------------------

test('every element marked hidden is really hidden, and nothing covers the live preview', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page, errors } = await openWithCamera(browser, port);
    const leaks = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[hidden]')]
          .filter((n) => getComputedStyle(n).display !== 'none')
          .map((n) => '#' + (n.id || n.className))
      );
    // Live capture screen: the message box, the selfie hint, the empty read-back...
    assert.deepEqual(await leaks(), [], 'hidden elements still displayed on Scan');
    // ...and nothing sits over the live video. (The reticle, dots and cue are
    // pointer-transparent overlays, so the hit test lands on the video itself;
    // the old message-box scrim was what it hit instead.)
    const top = await page.evaluate(() => {
      const r = document.querySelector('#reticle').getBoundingClientRect();
      const n = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return '#' + (n.id || n.className);
    });
    assert.equal(top, '#video');
    // Same guarantee on the other screens.
    await page.click('#btn-manual');
    assert.deepEqual(await leaks(), [], 'hidden elements still displayed on Verify');
    await page.evaluate((f) => window.__solvent.setFaces(f), scrambledFaces(['R', 'U']));
    await page.click('#btn-solve');
    await page.waitForSelector('#screen-solution.is-active');
    assert.deepEqual(await leaks(), [], 'hidden elements still displayed on Solve');

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('auto-capture shows its countdown ring, then captures on its own', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page, errors } = await openWithCamera(browser, port);
    const photos = scanPhotos(size2x2.scanSequence, size2x2.geomFromState(scrambleState(cube2, ['R', 'U'])));
    await page.click('#btn-auto');
    await presentFace(page, size2x2, photos[0].cells);
    // Held steady and read cleanly: the ring appears (it never did while an
    // <svg> was "hidden" by property instead of attribute)...
    await page.waitForFunction(() => window.__solvent.snapshot().autoRingShown, null, { timeout: 5000 });
    assert.equal(await page.$eval('#auto-ring', (n) => getComputedStyle(n).display), 'block');
    // ...and the face is captured without a click.
    await page.waitForFunction(() => window.__solvent.snapshot().captureIndex === 1, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__solvent.snapshot().autoRingShown), false);
    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- Verify points at the stickers to fix ---------------------------------------------

test('Verify rings the stickers each finding is about, and clears them once fixed', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext();
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent);

    const good = scrambledFaces(['R', 'U', "F'", 'R2']);
    // Swap two stickers of the URF corner (U bottom-right, F top-right).
    const bad = JSON.parse(JSON.stringify(good));
    [bad.U[3], bad.F[1]] = [bad.F[1], bad.U[3]];
    await page.evaluate((f) => {
      window.__solvent.goReview();
      window.__solvent.setFaces(f);
    }, bad);
    const marks = () =>
      page.$$eval('#net .sticker', (els) =>
        Object.fromEntries(els.filter((e) => e.dataset.fix !== 'false').map((e) => [e.dataset.cell, e.dataset.fix]))
      );
    const ringed = await marks();
    assert.deepEqual(Object.keys(ringed).sort(), ['F:1', 'R:0', 'U:3'], 'the URF corner is ringed');
    assert.ok(Object.values(ringed).every((v) => v === 'true'));

    // Pointing at the finding rings its stickers harder.
    await page.hover('.validation__errs li[data-cells]');
    assert.ok(Object.values(await marks()).every((v) => v === 'focus'));

    // Fixed: nothing ringed, ready to solve.
    await page.evaluate((f) => window.__solvent.setFaces(f), good);
    assert.deepEqual(await marks(), {});
    await page.waitForSelector('.validation__ok');

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('Verify offers a one-tap fix for a face read turned, with Undo', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext();
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent);

    const good = scrambledFaces(['R', 'U', "F'", 'R2', "U'"]);
    const bad = JSON.parse(JSON.stringify(good));
    bad.U = [bad.U[2], bad.U[0], bad.U[3], bad.U[1]]; // read a quarter-turn off
    await page.evaluate((f) => {
      window.__solvent.goReview();
      window.__solvent.setFaces(f);
    }, bad);
    await page.waitForSelector('#btn-apply-repair');
    assert.match(await page.textContent('.validation__repair'), /Up face looks like it was read turned/);

    await page.click('#btn-apply-repair');
    await page.waitForSelector('.validation__ok');
    assert.deepEqual((await page.evaluate(() => window.__solvent.snapshot())).faces, good);

    await page.click('#btn-undo-repair');
    await page.waitForSelector('.validation__errs');
    assert.deepEqual((await page.evaluate(() => window.__solvent.snapshot())).faces, bad);

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('the solution cube shows the move being waited on — layer and direction', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent);
    await page.evaluate((f) => {
      window.__solvent.goReview();
      window.__solvent.setFaces(f);
    }, scrambledFaces(['R', "U'", 'F2', 'R']));
    await page.click('#btn-solve');
    await page.waitForSelector('#screen-solution.is-active');

    const { moves } = await page.evaluate(() => window.__solvent.getState());
    const expect = (name) => {
      const t = size2x2.moveToTurn(name);
      return { axis: t.axis, sign: t.sign, quarters: t.quarters };
    };
    const shown = () => page.evaluate(() => window.__solvent.turnShown());
    assert.deepEqual(await shown(), expect(moves[0]), 'move 1 is shown before it is played');
    await page.click('#btn-next');
    await page.waitForFunction(() => window.__solvent.getState().stepIndex === 1);
    assert.deepEqual(await shown(), expect(moves[1]), 'then move 2');
    await page.click(`#move-list li:nth-child(${moves.length})`);
    await page.waitForFunction((n) => window.__solvent.getState().stepIndex === n, moves.length);
    assert.equal(await shown(), null, 'nothing to show once solved');
    await page.click('#btn-prev');
    await page.waitForFunction((n) => window.__solvent.getState().stepIndex === n, moves.length - 1);
    assert.deepEqual(await shown(), expect(moves[moves.length - 1]), 'Prev brings the last move back');

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- camera problems ---------------------------------------------------------------

test('a blocked camera says so and comes back with Retry once allowed', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(() => (window.__fakeCamDenied = true));
    await context.addInitScript(installFakeCamera);
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__solvent && window.__solvent.snapshot().cameraProblem === 'denied');
    assert.match(await page.textContent('#camera-msg'), /blocked/);
    assert.ok(await page.$eval('#btn-capture', (b) => b.disabled), 'no capturing without a camera');

    // The user allows it in site settings and taps Retry.
    await page.evaluate(() => (window.__fakeCam.deny = false));
    await page.click('#btn-camera-retry');
    await page.waitForFunction(() => window.__fakeCam.liveTracks() === 1 && !document.querySelector('#btn-capture').disabled);
    assert.equal(await page.evaluate(() => window.__solvent.snapshot().cameraProblem), null);
    assert.equal(await page.$eval('#camera-msg', (n) => getComputedStyle(n).display), 'none');
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('a camera that drops mid-scan is noticed, and Retry brings it back', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page, errors } = await openWithCamera(browser, port);
    const photos = scanPhotos(size2x2.scanSequence, size2x2.geomFromState(scrambleState(cube2, ['R', 'U'])));
    await presentFace(page, size2x2, photos[0].cells);
    await page.click('#btn-capture');

    await page.evaluate(() => window.__fakeCam.stopAll());
    await page.waitForFunction(() => window.__solvent.snapshot().cameraProblem === 'stopped', null, { timeout: 3000 });
    assert.match(await page.textContent('#camera-msg'), /camera stopped/);

    await page.click('#btn-camera-retry');
    await page.waitForFunction(() => window.__fakeCam.liveTracks() === 1 && !document.querySelector('#btn-capture').disabled);
    // The scan carries on where it was.
    assert.equal(await page.evaluate(() => window.__solvent.snapshot().captureIndex), 1);
    await presentFace(page, size2x2, photos[1].cells);
    await page.click('#btn-capture');
    assert.equal(await page.evaluate(() => window.__solvent.snapshot().captureIndex), 2);

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- screen wake lock --------------------------------------------------------------

test('the screen is kept awake on Scan and Solve, not on Verify, and re-taken after hiding', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    // A stand-in wake lock that counts what is held, and can be "released by the
    // browser" (as when the tab is hidden).
    await context.addInitScript(() => {
      const held = new Set();
      window.__wake = { held: () => held.size, browserRelease: () => [...held].forEach((l) => l.release()) };
      const wakeLock = {
        request: async () => {
          const lock = new EventTarget();
          lock.release = async () => {
            if (!held.delete(lock)) return;
            lock.dispatchEvent(new Event('release'));
          };
          held.add(lock);
          return lock;
        },
      };
      Object.defineProperty(navigator, 'wakeLock', { value: wakeLock, configurable: true });
    });
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent);
    const held = () => page.evaluate(() => window.__wake.held());

    await page.waitForFunction(() => window.__wake.held() === 1);
    await page.click('#btn-manual');
    await page.waitForFunction(() => window.__wake.held() === 0);
    await page.evaluate((f) => window.__solvent.setFaces(f), scrambledFaces(['R', 'U']));
    await page.click('#btn-solve');
    await page.waitForFunction(() => window.__wake.held() === 1);

    // The browser lets it go (tab hidden); coming back takes it again — once.
    await page.evaluate(() => window.__wake.browserRelease());
    assert.equal(await held(), 0);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => window.__wake.held() === 1);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(100);
    assert.equal(await held(), 1, 'never more than one lock');
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- unexpected errors -----------------------------------------------------------------

test('an unexpected error shows a plain notice and the app keeps working', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page } = await openWithCamera(browser, port);
    const notice = () => page.$eval('#oops', (n) => (getComputedStyle(n).display === 'none' ? null : n.textContent));
    assert.equal(await notice(), null, 'no notice on a healthy start');

    await page.evaluate(() => setTimeout(() => { throw new Error('boom-test'); }));
    await page.waitForFunction(() => !document.querySelector('#oops').hidden);
    assert.match(await notice(), /Something went wrong \(boom-test\)\. Your cube is still here/);
    await page.click('#btn-oops-dismiss');
    assert.equal(await notice(), null);

    await page.evaluate(() => { Promise.reject(new Error('reject-test')); });
    await page.waitForFunction(() => !document.querySelector('#oops').hidden);
    assert.match(await notice(), /reject-test/);
    await page.click('#btn-oops-dismiss');

    // Still a working app: a face still captures.
    const photos = scanPhotos(size2x2.scanSequence, size2x2.geomFromState(scrambleState(cube2, ['R'])));
    await presentFace(page, size2x2, photos[0].cells);
    await page.click('#btn-capture');
    assert.equal(await page.evaluate(() => window.__solvent.snapshot().captureIndex), 1);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- rescan one face from Verify ---------------------------------------------------------

test('Rescan fixes one misread face from Verify, whichever way round it is held', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page, errors } = await openWithCamera(browser, port);
    const s = scrambleState(cube2, ['R', 'U', "F'", 'R2', "U'", 'F']);
    const truth = size2x2.faceColorsFromState(s);
    const photos = scanPhotos(size2x2.scanSequence, size2x2.geomFromState(s));
    const bad = 2; // the Back face is read with one wrong sticker
    for (let k = 0; k < photos.length; k++) {
      let cells = photos[k].cells;
      if (k === bad) cells = [cells[0] === 'W' ? 'Y' : 'W', ...cells.slice(1)];
      await presentFace(page, size2x2, cells);
      await page.click('#btn-capture');
      // The capture check may (rightly) object to the misread; keep it for now.
      if (await page.$eval('#capture-warning', (n) => !n.hidden)) await page.click('#btn-warn-keep');
    }
    await page.waitForSelector('#screen-review.is-active');
    await page.waitForSelector('.validation__errs');

    // Rescan just that face, held a quarter-turn off.
    const face = photos[bad].face;
    await page.click(`.net-face__rescan[data-face="${face}"]`);
    await page.waitForSelector('#screen-capture.is-active');
    assert.equal(await page.textContent('#capture-step'), 'RESCAN');
    const c = photos[bad].cells; // rotate the camera's view of the true face 90°
    await presentFace(page, size2x2, [c[2], c[0], c[3], c[1]]);
    await page.click('#btn-capture');

    // Straight back to Verify, the face lined up and the cube real.
    await page.waitForSelector('#screen-review.is-active');
    await page.waitForSelector('.validation__ok');
    const snap = await page.evaluate(() => window.__solvent.snapshot());
    assert.deepEqual(snap.faces[face], truth[face]);
    assert.equal(snap.rescanning, null);

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- re-read colours against the cube's own stickers -------------------------------------

test('under warm light, Verify offers to re-read the colours — and gets the real cube', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const { context, page, errors } = await openWithCamera(browser, port);
    const s = scrambleState(cube2, ['R', 'U', "F'", 'R2', "U'", 'F']);
    const truth = size2x2.faceColorsFromState(s);
    const photos = scanPhotos(size2x2.scanSequence, size2x2.geomFromState(s));
    // A warm lamp: blue and green drop away, whites drift toward yellow.
    const warm = (c) => {
      const v = parseInt(size2x2.colorHex[c].slice(1), 16);
      const rgb = [(v >> 16) & 255, Math.round(((v >> 8) & 255) * 0.86), Math.round((v & 255) * 0.55)];
      return '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('');
    };
    for (const { cells } of photos) {
      await page.evaluate((h) => window.__fakeCam.show(h, 2), cells.map(warm));
      await page.waitForTimeout(450); // let the live read-out see the new face
      await page.click('#btn-capture');
      if (await page.$eval('#capture-warning', (n) => !n.hidden)) await page.click('#btn-warn-keep');
    }
    await page.waitForSelector('#screen-review.is-active');
    await page.waitForSelector('.validation__errs'); // the raw read is impossible
    const misread = await page.evaluate(() => window.__solvent.snapshot().faces);

    await page.waitForSelector('#btn-apply-repair');
    assert.match(await page.textContent('.validation__repair'), /Re-reading the colors against your cube's own stickers/);
    await page.click('#btn-apply-repair');
    await page.waitForSelector('.validation__ok');
    const snap = await page.evaluate(() => window.__solvent.snapshot());
    assert.deepEqual(snap.faces, truth, 'the re-read is the real cube');
    // Every sticker it changed is ringed for checking.
    const changed = size2x2.faceOrder.flatMap((f) => truth[f].map((c, i) => (c !== misread[f][i] ? `${f}:${i}` : null))).filter(Boolean);
    assert.ok(changed.length > 0);
    const ringed = await page.$$eval('#net .sticker[data-lowconf="true"]', (els) => els.map((e) => e.dataset.cell));
    for (const k of changed) assert.ok(ringed.includes(k), `${k} changed but isn't ringed`);

    await page.click('#btn-undo-repair');
    await page.waitForSelector('.validation__errs');
    assert.deepEqual((await page.evaluate(() => window.__solvent.snapshot())).faces, misread);

    assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

// ---- Verify undo ----------------------------------------------------------------------------

test('every Verify edit is undoable — a paint, Reset cube, a fix', async () => {
  const { server, port } = await startServer();
  const browser = await launch();
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`http://localhost:${port}${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__solvent);
    const good = scrambledFaces(['R', 'U', "F'", 'R2', "U'"]);
    await page.evaluate((f) => {
      window.__solvent.goReview();
      window.__solvent.setFaces(f);
    }, good);
    const faces = () => page.evaluate(() => window.__solvent.snapshot().faces);
    const undoDisabled = () => page.$eval('#btn-undo', (b) => b.disabled);
    assert.ok(await undoDisabled(), 'nothing to undo yet');

    // A mis-tapped paint.
    const paint = good.F[0] === 'B' ? 'R' : 'B';
    await page.click(`#palette .swatch-btn[aria-label="${{ B: 'Blue', R: 'Red' }[paint]}"]`);
    await page.click('#net .sticker[data-cell="F:0"]');
    assert.equal((await faces()).F[0], paint);
    await page.click('#btn-undo');
    assert.deepEqual(await faces(), good);
    assert.ok(await undoDisabled());

    // An accidental Reset cube — the whole scan comes back.
    await page.click('#btn-reset');
    assert.ok((await faces()).U.every((c) => c === null));
    await page.click('#btn-undo');
    assert.deepEqual(await faces(), good);

    // A fix, then a paint: Undo walks back through both.
    const bad = JSON.parse(JSON.stringify(good));
    bad.U = [bad.U[2], bad.U[0], bad.U[3], bad.U[1]];
    await page.evaluate((f) => window.__solvent.setFaces(f), bad);
    await page.click('#btn-apply-repair');
    await page.waitForSelector('.validation__ok');
    assert.deepEqual(await faces(), good);
    await page.click('#net .sticker[data-cell="F:0"]');
    await page.click('#btn-undo'); // the paint
    assert.deepEqual(await faces(), good);
    await page.waitForSelector('#btn-undo-repair'); // last edit is the fix again
    await page.click('#btn-undo'); // the fix
    assert.deepEqual(await faces(), bad);

    // A new cube starts with nothing to undo.
    await page.click('#btn-new-cube');
    await page.click('#btn-manual');
    assert.ok(await undoDisabled());

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});
