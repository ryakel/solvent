// app.js — size-agnostic UI flow: scan -> verify -> solve -> step through moves.
// It drives whichever SizeModule is active and never assumes a cube size.

import { SIZE_MODULES, getSizeModule, defaultSizeModule } from '../sizes/index.js';
import { createScanner } from './scanner.js';
import { createRenderer } from './renderer.js';
import { createGuide } from './guide.js';
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

export function initApp() {
  const mod = { current: defaultSizeModule() };
  let faces = mod.current.emptyFaces();
  // Per-sticker "this scan read was ambiguous" flags, parallel to `faces`. Only
  // ever set on the camera path (manual entry has no confidence signal), reset
  // alongside faces, and cleared for a sticker the moment the user repaints it.
  let lowConf = emptyLowConf();
  let paintColor = mod.current.colors[0];
  let captureIndex = 0;
  let scanner = null;
  let renderer = null;
  let guide = null;
  let solution = null;
  let stepIndex = 0;
  let animating = false;
  // Whether the camera preview is mirrored (a selfie / front camera). When on,
  // the preview flips left-for-right, so the guide and the turn wording flip to
  // match. Auto-detected from the camera when possible; also user-toggleable.
  let mirror = false;
  // One-time selfie-camera nudge: shown at most once per session, only when the
  // camera reports no facingMode (auto-detect can't decide) and mirror wasn't
  // already turned on. Helps people discover the Mirror toggle without nagging.
  let mirrorNudgeSpent = false;

  // A short haptic tick on discrete, user-initiated confirmations (a face
  // captured, the set completed). Deliberately never fired by the looping guide,
  // so it confirms rather than nags. Suppressed under reduced-motion (a proxy
  // for "keep it calm") and guarded for browsers without the Vibration API.
  function haptic(pattern) {
    if (REDUCED_MOTION) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      /* vibration unsupported / blocked — non-essential, ignore */
    }
  }

  // The active size module owns its own scan path (ordered faces + the single
  // whole-cube turn between each). The net layout and validation still use the
  // module's faceOrder; only capture guidance uses the scan sequence.
  const scanSeq = () => mod.current.scanSequence;
  const scanFaces = () => scanSeq().map((s) => s.face);

  // ---- scan-confidence bookkeeping ----
  // A face flagged "uncertain" is one that was scanned (filled) and holds at
  // least one low-confidence sticker. Skipped / empty faces are never flagged —
  // they are merely incomplete, handled by the fill-in path.
  function emptyLowConf() {
    const f = {};
    const n = mod.current.gridN * mod.current.gridN;
    for (const face of mod.current.faceOrder) f[face] = new Array(n).fill(false);
    return f;
  }
  function faceHasLowConf(f) {
    return isFaceFilled(f) && !!lowConf[f] && lowConf[f].some(Boolean);
  }
  function countUncertainFaces() {
    return mod.current.faceOrder.filter(faceHasLowConf).length;
  }

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
    lowConf = emptyLowConf();
    captureIndex = 0;
    [...sizeButtons.children].forEach((b) => {
      if (!b.disabled) b.setAttribute('aria-pressed', String(b.textContent === mod.current.name));
    });
    buildReticle();
    buildFaceProgress();
    buildNet();
    buildPalette();
    // The scan path is per-size; hand the new module's sequence to the guide.
    if (guide) guide.setSequence(mod.current.scanSequence);
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
    scanFaces().forEach((f, i) => {
      const chip = el('button', 'face-chip');
      const sw = el('span', 'swatch');
      sw.style.background = mod.current.colorHex[mod.current.faceColor[f]];
      chip.appendChild(sw);
      chip.appendChild(el('span', 'face-chip__name', mod.current.faceLabels[f]));
      // Non-color "recheck" marker; shown via [data-flag] so it never relies on
      // hue alone. Kept out of the accessibility tree — the chip's aria-label
      // carries the word "uncertain" when flagged.
      const flag = el('span', 'face-chip__flag', '!');
      flag.setAttribute('aria-hidden', 'true');
      chip.appendChild(flag);
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
    scanFaces().forEach((f, i) => {
      const chip = chips[i];
      const flagged = faceHasLowConf(f);
      chip.dataset.active = String(i === captureIndex);
      chip.dataset.done = String(isFaceFilled(f));
      chip.dataset.flag = String(flagged);
      chip.setAttribute(
        'aria-label',
        flagged
          ? `${mod.current.faceLabels[f]} — scanned, some stickers uncertain, recheck`
          : mod.current.faceLabels[f]
      );
      chip.title = flagged ? 'Some stickers on this face look uncertain — recheck at Verify.' : '';
    });
  }
  function updateCaptureTarget() {
    const seq = scanSeq();
    const step = seq[captureIndex];
    const f = step.face;
    // Re-derive the label/text from the turn so the wording flips with mirror.
    const { label, text } = mod.current.describeScanStep(step.turn, step.face, { mirror });
    $('#capture-step').textContent = `STEP ${captureIndex + 1}/${seq.length}`;
    $('#capture-turn').textContent = label;
    $('#capture-face-name').textContent = mod.current.faceLabels[f];
    $('#capture-face-swatch').style.background = mod.current.colorHex[mod.current.faceColor[f]];
    $('#capture-face-hint').textContent = text;
    renderReadback(f);
    if (guide) guide.showStep(captureIndex);
    refreshFaceProgress();
  }

  // Immediate per-face feedback: the moment a face is scanned, mirror the colors
  // the camera actually read back as a compact grid in the capture card, so a
  // misread is obvious right here — not only later at Verify. Reflects whatever
  // is stored for the target face, so jumping between chips shows each reading.
  function renderReadback(f) {
    const wrap = $('#scan-readback');
    const grid = $('#scan-readback-grid');
    if (!wrap || !grid) return;
    if (!isFaceFilled(f)) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const n = mod.current.gridN;
    grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    if (grid.children.length !== n * n) {
      grid.innerHTML = '';
      for (let i = 0; i < n * n; i++) grid.appendChild(el('i'));
    }
    [...grid.children].forEach((cell, i) => {
      cell.style.background = mod.current.colorHex[faces[f][i]] || 'transparent';
    });
  }

  // The animated guide cube demonstrates how to turn the cube to show each face.
  function ensureGuide() {
    if (guide) return;
    try {
      guide = createGuide($('#guide-view'), {
        colorHex: mod.current.colorHex,
        reducedMotion: REDUCED_MOTION,
        scanSequence: mod.current.scanSequence,
        solvedState: mod.current.SOLVED_STATE,
        geomFromState: mod.current.geomFromState,
        onArrive: pulseArrival,
      });
      guide.setMirror(mirror);
    } catch (err) {
      guide = null; // WebGL unavailable: text guidance still covers it.
    }
  }

  // Arrival tick: when the guide's demonstrated turn completes and the face
  // locks in, flash the reticle's corner brackets (and the guide's own frame)
  // once, in sync — a crisp, instrument-like confirmation.
  let arrivalTimer = 0;
  function pulseArrival() {
    const nodes = [$('#reticle'), $('#guide-view').closest('.guide-stage')];
    for (const n of nodes) {
      if (!n) continue;
      n.classList.remove('arrived');
      // reflow so re-adding the class restarts the animation
      void n.offsetWidth;
      n.classList.add('arrived');
    }
    clearTimeout(arrivalTimer);
    arrivalTimer = setTimeout(() => {
      for (const n of nodes) if (n) n.classList.remove('arrived');
    }, 620);
  }

  // Flip the mirror state (auto-detected or user-toggled) and keep the guide,
  // the preview, and the wording in agreement.
  function setMirror(on) {
    mirror = !!on;
    $('#camera-wrap').classList.toggle('is-mirrored', mirror);
    const btn = $('#btn-mirror');
    if (btn) {
      btn.setAttribute('aria-pressed', String(mirror));
      btn.textContent = mirror ? 'Mirror: on' : 'Mirror: off';
    }
    if (guide) guide.setMirror(mirror);
    updateCaptureTarget();
  }

  // The selfie-camera nudge (see mirrorNudgeSpent). Shown at most once, and never
  // when mirror is already on or the camera told us its facingMode.
  function maybeShowMirrorNudge(facing) {
    if (mirrorNudgeSpent || mirror || facing) return;
    const n = $('#mirror-nudge');
    if (!n) return;
    n.hidden = false;
    mirrorNudgeSpent = true;
  }
  function dismissMirrorNudge() {
    mirrorNudgeSpent = true;
    const n = $('#mirror-nudge');
    if (n) n.hidden = true;
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
        markSticker(st, f, i);
        st.addEventListener('click', () => {
          faces[f][i] = paintColor;
          // The user just verified this sticker by hand — clear its "recheck"
          // flag so the highlight and the summary count stay honest.
          if (lowConf[f]) lowConf[f][i] = false;
          paintSticker(st, paintColor);
          markSticker(st, f, i);
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
  // Mark (or unmark) a net sticker as a low-confidence scan read: a restrained
  // ring (CSS, [data-lowconf]) plus a non-visual "recheck" note on its label. A
  // gentle "look here," not an error — real errors stay the red validation path.
  function markSticker(node, f, i) {
    const low = !!(lowConf[f] && lowConf[f][i]);
    node.dataset.lowconf = String(low);
    const base = `${mod.current.faceLabels[f]} sticker ${i + 1}`;
    node.setAttribute('aria-label', low ? `${base}, low-confidence, recheck` : base);
  }
  function refreshNet() {
    const net = $('#net');
    for (const f of mod.current.faceOrder) {
      const grid = net.querySelector(`.net-face[data-face="${f}"] .sticker-grid`);
      if (!grid) continue;
      [...grid.children].forEach((st, i) => {
        paintSticker(st, faces[f][i]);
        markSticker(st, f, i);
      });
    }
  }

  // ---- validation ----
  function allFilled() {
    return mod.current.faceOrder.every((f) => isFaceFilled(f));
  }
  // A gentle, distinct-from-errors summary of scan uncertainty at Verify. It
  // agrees with the on-net highlights (same lowConf source) and clears itself
  // as the user repaints flagged stickers.
  function updateUncertainNote() {
    const note = $('#uncertain-note');
    if (!note) return;
    const n = countUncertainFaces();
    if (n === 0) {
      note.hidden = true;
      note.textContent = '';
      return;
    }
    note.hidden = false;
    note.textContent =
      `${n} face${n > 1 ? 's' : ''} look${n > 1 ? '' : 's'} uncertain — the flagged ` +
      `stickers are highlighted below. Tap any to confirm or repaint it.`;
  }
  function validateNow() {
    updateUncertainNote();
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

  const mirrorBtn = $('#btn-mirror');
  if (mirrorBtn)
    mirrorBtn.addEventListener('click', () => {
      dismissMirrorNudge();
      setMirror(!mirror);
    });
  const nudgeDismiss = $('#btn-mirror-nudge-dismiss');
  if (nudgeDismiss) nudgeDismiss.addEventListener('click', dismissMirrorNudge);

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
      // Auto-detect a mirrored (front / selfie) camera and flip guidance to
      // match. Users can still override with the Mirror toggle.
      const fm = scanner.facingMode();
      if (fm === 'user') setMirror(true);
      else if (fm === 'environment') setMirror(false);
      // When the camera won't report which way it faces, auto-detect can't
      // decide — surface the one-time Mirror hint so selfie users aren't stuck
      // with reversed turn directions.
      maybeShowMirrorNudge(fm);
    }
    updateFlashButton();
  }

  $('#btn-capture').addEventListener('click', () => {
    if (!scanner || !scanner.isActive()) return;
    const samples = scanner.sample();
    if (!samples) return;
    const order = scanFaces();
    const f = order[captureIndex];
    // Classify with a confidence margin when the module supports it, so genuinely
    // ambiguous reads get flagged for a recheck at Verify. Falls back cleanly to
    // the plain classifier (and no flags) for a module that doesn't opt in.
    const thr = mod.current.confidenceThreshold ?? 0;
    if (typeof mod.current.classifyColorDetailed === 'function') {
      const detailed = samples.map((rgb) => mod.current.classifyColorDetailed(rgb));
      faces[f] = detailed.map((d) => d.color);
      lowConf[f] = detailed.map((d) => d.confidence < thr);
    } else {
      faces[f] = samples.map((rgb) => mod.current.classifyColor(rgb));
      lowConf[f] = faces[f].map(() => false);
    }
    dismissMirrorNudge();
    // advance to next unfilled face
    let next = (captureIndex + 1) % order.length;
    for (let i = 0; i < order.length; i++) {
      if (!isFaceFilled(order[next])) break;
      next = (next + 1) % order.length;
    }
    captureIndex = next;
    updateCaptureTarget();
    if (allFilled()) {
      haptic([16, 60, 28]); // set complete — a distinct double tick
      goReview();
    } else {
      haptic(14); // one face locked in — a single crisp tick
    }
  });

  $('#btn-skip-face').addEventListener('click', () => {
    captureIndex = (captureIndex + 1) % scanFaces().length;
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
    lowConf = emptyLowConf();
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
    lowConf = emptyLowConf();
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
      // Manually-injected faces (and the e2e path) carry no scan confidence, so
      // clear any flags — uncertainty is a camera-only signal.
      lowConf = emptyLowConf();
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
