// app.js — size-agnostic UI flow: scan -> verify -> solve -> step through moves.
// It drives whichever SizeModule is active and never assumes a cube size.

import { SIZE_MODULES, getSizeModule, defaultSizeModule } from '../sizes/index.js';
import { createScanner } from './scanner.js';
import { createRenderer } from './renderer.js';
import { createGuide, SCAN_SEQUENCE } from './guide.js';
import { stateFromGeom, isSolved } from '../core/cube2.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Solution turn duration. Kept deliberately unhurried so each move reads clearly.
const ANIM_MS = REDUCED_MOTION ? 0 : 720;

// Capture order for scanning. SCAN_SEQUENCE (see guide.js) orders the faces so
// each step is ONE simple whole-cube turn from the previous — the guide cube
// demonstrates that exact turn, and the labels/text below are derived from it.
// The net layout and validation still use the module's faceOrder.
const SCAN_FACES = SCAN_SEQUENCE.map((s) => s.face);

export function initApp() {
  const mod = { current: defaultSizeModule() };
  let faces = mod.current.emptyFaces();
  let paintColor = mod.current.colors[0];
  let captureIndex = 0;
  let scanner = null;
  let renderer = null;
  let guide = null;
  let solution = null;
  let stepIndex = 0;
  let animating = false;

  // ---- size buttons ----
  const sizeButtons = $('#size-buttons');
  for (const m of SIZE_MODULES) {
    const b = el('button', 'size-btn', m.name);
    b.setAttribute('aria-pressed', String(m.id === mod.current.id));
    b.addEventListener('click', () => selectSize(m.id));
    sizeButtons.appendChild(b);
  }
  // Placeholder for the next size, to make the seam visible in the UI.
  const soon = el('button', 'size-btn', '3×3');
  soon.disabled = true;
  soon.title = 'Coming via a size module — the flow already supports it.';
  sizeButtons.appendChild(soon);

  function selectSize(id) {
    mod.current = getSizeModule(id);
    faces = mod.current.emptyFaces();
    captureIndex = 0;
    [...sizeButtons.children].forEach((b) => {
      if (!b.disabled) b.setAttribute('aria-pressed', String(b.textContent === mod.current.name));
    });
    buildReticle();
    buildFaceProgress();
    buildNet();
    buildPalette();
    updateCaptureTarget();
    showScreen('capture');
  }

  // ---- screens ----
  const screens = {
    capture: $('#screen-capture'),
    review: $('#screen-review'),
    solution: $('#screen-solution'),
  };
  const rail = $('#step-rail');
  function showScreen(name) {
    for (const [k, node] of Object.entries(screens)) node.classList.toggle('is-active', k === name);
    [...rail.children].forEach((li) => {
      const step = li.dataset.step;
      li.toggleAttribute('aria-current', step === name);
      if (step === name) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    // mark done states
    const order = ['capture', 'review', 'solution'];
    order.forEach((s, i) => {
      const li = rail.querySelector(`[data-step="${s}"]`);
      li.dataset.done = order.indexOf(name) > i ? 'true' : 'false';
    });
    if (name === 'review') refreshNet(), validateNow();
    if (guide) {
      if (name === 'capture') {
        guide.start();
        guide.showStep(captureIndex);
      } else {
        guide.stop();
      }
    }
  }

  // ---- reticle ----
  function buildReticle() {
    const reticle = $('#reticle');
    reticle.style.setProperty('--gn', mod.current.gridN);
    reticle.innerHTML = '';
    for (let i = 0; i < mod.current.gridN * mod.current.gridN; i++) reticle.appendChild(el('i'));
  }

  // ---- face progress chips ----
  function buildFaceProgress() {
    const wrap = $('#face-progress');
    wrap.innerHTML = '';
    SCAN_FACES.forEach((f, i) => {
      const chip = el('button', 'face-chip');
      const sw = el('span', 'swatch');
      sw.style.background = mod.current.colorHex[mod.current.faceColor[f]];
      chip.appendChild(sw);
      chip.appendChild(el('span', null, mod.current.faceLabels[f]));
      chip.addEventListener('click', () => {
        captureIndex = i;
        updateCaptureTarget();
      });
      wrap.appendChild(chip);
    });
    refreshFaceProgress();
  }
  function isFaceFilled(f) {
    return faces[f].every((c) => c != null);
  }
  function refreshFaceProgress() {
    const chips = $('#face-progress').children;
    SCAN_FACES.forEach((f, i) => {
      chips[i].dataset.active = String(i === captureIndex);
      chips[i].dataset.done = String(isFaceFilled(f));
    });
  }
  function updateCaptureTarget() {
    const step = SCAN_SEQUENCE[captureIndex];
    const f = step.face;
    $('#capture-step').textContent = `STEP ${captureIndex + 1}/${SCAN_SEQUENCE.length}`;
    $('#capture-turn').textContent = step.label;
    $('#capture-face-name').textContent = mod.current.faceLabels[f];
    $('#capture-face-swatch').style.background = mod.current.colorHex[mod.current.faceColor[f]];
    $('#capture-face-hint').textContent = step.text;
    if (guide) guide.showStep(captureIndex);
    refreshFaceProgress();
  }

  // The animated guide cube demonstrates how to turn the cube to show each face.
  function ensureGuide() {
    if (guide) return;
    try {
      guide = createGuide($('#guide-view'), {
        colorHex: mod.current.colorHex,
        reducedMotion: REDUCED_MOTION,
      });
    } catch (err) {
      guide = null; // WebGL unavailable: text guidance still covers it.
    }
  }

  // ---- palette ----
  function buildPalette() {
    const pal = $('#palette');
    pal.innerHTML = '';
    pal.appendChild(el('span', 'palette__label', 'Paint'));
    for (const c of mod.current.colors) {
      const b = el('button', 'swatch-btn');
      b.style.background = mod.current.colorHex[c];
      b.setAttribute('aria-label', mod.current.colorNames[c]);
      b.setAttribute('aria-pressed', String(c === paintColor));
      b.addEventListener('click', () => {
        paintColor = c;
        [...pal.querySelectorAll('.swatch-btn')].forEach((x, i) =>
          x.setAttribute('aria-pressed', String(mod.current.colors[i] === paintColor))
        );
      });
      pal.appendChild(b);
    }
  }

  // ---- net (editable) ----
  function buildNet() {
    const net = $('#net');
    net.innerHTML = '';
    for (const f of mod.current.faceOrder) {
      const face = el('div', 'net-face');
      face.dataset.face = f;
      face.appendChild(el('div', 'net-face__label', `${f} · ${mod.current.faceLabels[f]}`));
      const grid = el('div', 'sticker-grid');
      grid.style.gridTemplateColumns = `repeat(${mod.current.gridN}, 1fr)`;
      for (let i = 0; i < mod.current.gridN * mod.current.gridN; i++) {
        const st = el('button', 'sticker');
        st.setAttribute('aria-label', `${mod.current.faceLabels[f]} sticker ${i + 1}`);
        st.addEventListener('click', () => {
          faces[f][i] = paintColor;
          paintSticker(st, paintColor);
          refreshFaceProgress();
          validateNow();
        });
        grid.appendChild(st);
      }
      face.appendChild(grid);
      net.appendChild(face);
    }
    refreshNet();
  }
  function paintSticker(node, color) {
    if (color == null) {
      node.style.background = '';
      node.dataset.empty = 'true';
    } else {
      node.style.background = mod.current.colorHex[color];
      node.dataset.empty = 'false';
    }
  }
  function refreshNet() {
    const net = $('#net');
    for (const f of mod.current.faceOrder) {
      const grid = net.querySelector(`.net-face[data-face="${f}"] .sticker-grid`);
      if (!grid) continue;
      [...grid.children].forEach((st, i) => paintSticker(st, faces[f][i]));
    }
  }

  // ---- validation ----
  function allFilled() {
    return mod.current.faceOrder.every((f) => isFaceFilled(f));
  }
  function validateNow() {
    const box = $('#validation');
    const solveBtn = $('#btn-solve');
    if (!allFilled()) {
      box.innerHTML = '';
      const div = el('div', 'validation__errs');
      div.appendChild(el('h2', null, 'Fill in every sticker'));
      const remaining = mod.current.faceOrder.filter((f) => !isFaceFilled(f)).map((f) => mod.current.faceLabels[f]);
      const ul = el('ul');
      ul.appendChild(el('li', null, `Still empty: ${remaining.join(', ')}.`));
      div.appendChild(ul);
      box.appendChild(div);
      solveBtn.disabled = true;
      return false;
    }
    const { ok, errors } = mod.current.validate(faces);
    box.innerHTML = '';
    if (ok) {
      const div = el('div', 'validation__ok', 'This is a real, solvable cube. Ready to solve.');
      box.appendChild(div);
      solveBtn.disabled = false;
    } else {
      const div = el('div', 'validation__errs');
      div.appendChild(el('h2', null, `${errors.length} thing${errors.length > 1 ? 's' : ''} to fix`));
      const ul = el('ul');
      for (const e of errors) ul.appendChild(el('li', null, e));
      div.appendChild(ul);
      box.appendChild(div);
      solveBtn.disabled = true;
    }
    return ok;
  }

  // ---- capture actions ----
  const video = $('#video');
  const flashBtn = $('#btn-flash');
  function updateFlashButton() {
    const supported = scanner && scanner.isActive() && scanner.hasTorch();
    flashBtn.hidden = !supported;
    if (!supported) return;
    const on = scanner.isTorchOn();
    flashBtn.setAttribute('aria-pressed', String(on));
    flashBtn.textContent = on ? 'Flash on' : 'Flash off';
  }
  flashBtn.addEventListener('click', async () => {
    if (!scanner || !scanner.hasTorch()) return;
    await scanner.setTorch(!scanner.isTorchOn());
    updateFlashButton();
  });

  async function startCamera() {
    scanner = createScanner({ video, gridN: mod.current.gridN });
    const ok = await scanner.start();
    const msg = $('#camera-msg');
    const capBtn = $('#btn-capture');
    if (!ok) {
      msg.hidden = false;
      msg.textContent =
        'Camera unavailable. That is fine — use “Enter colors by hand,” the solver works the same.';
      capBtn.disabled = true;
    } else {
      msg.hidden = true;
      capBtn.disabled = false;
    }
    updateFlashButton();
  }

  $('#btn-capture').addEventListener('click', () => {
    if (!scanner || !scanner.isActive()) return;
    const samples = scanner.sample();
    if (!samples) return;
    const f = SCAN_FACES[captureIndex];
    faces[f] = samples.map((rgb) => mod.current.classifyColor(rgb));
    // advance to next unfilled face
    const order = SCAN_FACES;
    let next = (captureIndex + 1) % order.length;
    for (let i = 0; i < order.length; i++) {
      if (!isFaceFilled(order[next])) break;
      next = (next + 1) % order.length;
    }
    captureIndex = next;
    updateCaptureTarget();
    if (allFilled()) goReview();
  });

  $('#btn-skip-face').addEventListener('click', () => {
    captureIndex = (captureIndex + 1) % SCAN_FACES.length;
    updateCaptureTarget();
  });

  function goReview() {
    if (scanner) scanner.stop();
    updateFlashButton();
    buildNet();
    showScreen('review');
  }
  $('#btn-manual').addEventListener('click', goReview);
  $('#btn-back-capture').addEventListener('click', () => {
    showScreen('capture');
    startCamera();
  });
  $('#btn-reset').addEventListener('click', () => {
    faces = mod.current.emptyFaces();
    refreshNet();
    refreshFaceProgress();
    validateNow();
  });

  // ---- solve ----
  $('#btn-solve').addEventListener('click', () => {
    if (!validateNow()) return;
    try {
      solution = mod.current.solve(faces);
    } catch (err) {
      const box = $('#validation');
      box.innerHTML = '';
      const div = el('div', 'validation__errs');
      div.appendChild(el('h2', null, 'Could not solve'));
      const ul = el('ul');
      ul.appendChild(el('li', null, String(err.message || err)));
      div.appendChild(ul);
      box.appendChild(div);
      return;
    }
    openSolution();
  });

  function ensureRenderer() {
    if (renderer) return renderer;
    try {
      renderer = createRenderer($('#viewer'), {
        cubiesPerEdge: mod.current.cubiesPerEdge,
        colorHex: mod.current.colorHex,
        reducedMotion: REDUCED_MOTION,
      });
    } catch (err) {
      const v = $('#viewer');
      v.innerHTML = '';
      v.appendChild(el('div', 'camera-msg', '3D view unavailable here, but the move list below is complete.'));
      renderer = null;
    }
    return renderer;
  }

  function openSolution() {
    showScreen('solution');
    stepIndex = 0;
    ensureRenderer();
    if (renderer) renderer.setGeom(solution.frames[0]);
    buildMoveList();
    updateSolveReadout();
    const lede = $('#solution-lede');
    if (solution.moves.length === 0) {
      lede.textContent = 'This cube is already solved. Nothing to do.';
    } else {
      lede.textContent = `Optimal solution in ${solution.moves.length} move${
        solution.moves.length > 1 ? 's' : ''
      }. Step through with Next, or drag the cube to look around.`;
    }
    updateStepButtons();
  }

  function buildMoveList() {
    const list = $('#move-list');
    list.innerHTML = '';
    solution.moves.forEach((m, i) => {
      const li = el('li', null, m.name);
      li.dataset.state = 'todo';
      li.title = m.hint;
      li.addEventListener('click', () => jumpTo(i + 1));
      list.appendChild(li);
    });
  }
  function refreshMoveList() {
    const items = $('#move-list').children;
    for (let i = 0; i < items.length; i++) {
      items[i].dataset.state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo';
    }
  }
  function updateSolveReadout() {
    $('#move-counter').textContent = `Move ${stepIndex} / ${solution.moves.length}`;
    const hint = $('#move-hint');
    if (solution.moves.length === 0) {
      hint.textContent = 'Already solved.';
    } else if (stepIndex === 0) {
      hint.textContent = `Next: ${solution.moves[0].hint}`;
    } else if (stepIndex >= solution.moves.length) {
      hint.textContent = 'Solved. Six solid faces.';
    } else {
      hint.textContent = `Next: ${solution.moves[stepIndex].hint}`;
    }
    refreshMoveList();
  }
  function updateStepButtons() {
    $('#btn-prev').disabled = animating || stepIndex <= 0;
    $('#btn-next').disabled = animating || stepIndex >= solution.moves.length;
  }

  async function goNext() {
    if (animating || stepIndex >= solution.moves.length) return;
    animating = true;
    updateStepButtons();
    const name = solution.moves[stepIndex].name;
    const turn = mod.current.moveToTurn(name);
    const after = solution.frames[stepIndex + 1];
    if (renderer) await renderer.animateMove(turn, after, ANIM_MS);
    stepIndex++;
    animating = false;
    updateSolveReadout();
    updateStepButtons();
  }
  async function goPrev() {
    if (animating || stepIndex <= 0) return;
    animating = true;
    updateStepButtons();
    const name = solution.moves[stepIndex - 1].name;
    const turn = mod.current.moveToTurn(name);
    const reverse = { axis: turn.axis, sign: turn.sign, quarters: -turn.quarters };
    const before = solution.frames[stepIndex - 1];
    if (renderer) await renderer.animateMove(reverse, before, ANIM_MS);
    stepIndex--;
    animating = false;
    updateSolveReadout();
    updateStepButtons();
  }
  async function jumpTo(target) {
    // step one at a time so the animation reads clearly
    while (stepIndex < target) {
      await goNext();
    }
    while (stepIndex > target) {
      await goPrev();
    }
  }

  $('#btn-next').addEventListener('click', goNext);
  $('#btn-prev').addEventListener('click', goPrev);
  $('#btn-restart-anim').addEventListener('click', () => jumpTo(0));
  $('#btn-new').addEventListener('click', () => {
    faces = mod.current.emptyFaces();
    captureIndex = 0;
    solution = null;
    stepIndex = 0;
    buildFaceProgress();
    buildNet();
    updateCaptureTarget();
    showScreen('capture');
    startCamera();
  });

  // keyboard stepping
  document.addEventListener('keydown', (e) => {
    if (!screens.solution.classList.contains('is-active')) return;
    if (e.key === 'ArrowRight') goNext();
    if (e.key === 'ArrowLeft') goPrev();
  });

  // ---- boot ----
  buildReticle();
  buildFaceProgress();
  buildPalette();
  buildNet();
  ensureGuide();
  updateCaptureTarget();
  showScreen('capture');
  if (guide) guide.start();
  startCamera();

  // expose a tiny hook for the e2e test to drive deterministically.
  window.__solvent = {
    setFaces(next) {
      faces = next;
      refreshNet();
      refreshFaceProgress();
      validateNow();
    },
    solvedFaces: () => mod.current.solvedFaces,
    getState: () => ({ stepIndex, moves: solution ? solution.moves.map((m) => m.name) : null }),
    goReview,
    faceColorsFromState: (s) => mod.current.faceColorsFromState(s),
    // True when the frame currently displayed is a fully solved cube — used by the
    // e2e test to confirm stepping through the moves ends solved.
    currentFrameSolved: () => {
      if (!solution) return false;
      const geom = solution.frames[stepIndex];
      return isSolved(stateFromGeom(geom));
    },
  };
}
