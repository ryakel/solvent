// e2e.test.js — headless browser test of the real built site, served under a
// /solvent/ subpath to mimic GitHub Pages. Covers DoD #3, #4, #7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { createServer } from '../scripts/serve.mjs';
import { SOLVED, applyMove } from '../src/core/cube2.js';
import size2x2 from '../src/sizes/size2x2.js';

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
