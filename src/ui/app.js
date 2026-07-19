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
  // Solution auto-play: advances through the moves on a timer, but STRICTLY by
  // awaiting goNext() each step (never a raw timer that could overlap the
  // `animating` guard). `playDelayTimer` is the only bare timeout — the cancelable
  // rest between moves — and it gates the loop rather than triggering a move.
  let playing = false;
  let playDelayTimer = 0;
  // Whether the camera preview is mirrored (a selfie / front camera). When on,
  // the preview flips left-for-right, so the guide and the turn wording flip to
  // match. Auto-detected from the camera when possible; also user-toggleable.
  let mirror = false;
  // One-time selfie-camera nudge: shown at most once per session, only when the
  // camera reports no facingMode (auto-detect can't decide) and mirror wasn't
  // already turned on. Helps people discover the Mirror toggle without nagging.
  let mirrorNudgeSpent = false;

  // ---- confirmation feedback: haptic buzz + optional soft audio tick ----------
  // Fired on discrete, user-initiated confirmations (a face captured, the set
  // completed) — never by the looping guide, so it confirms rather than nags.
  // Haptics are on by default (as before); the soft tick is opt-in via one
  // "Sound" toggle and persisted. Both are suppressed under reduced-motion (a
  // proxy for "keep it calm") and degrade silently where the API is missing.
  let soundOn = false;
  try {
    soundOn = localStorage.getItem('solvent.sound') === '1';
  } catch {
    /* storage blocked (private mode / sandbox) — fall back to the default */
  }

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

  // A single lazily-created AudioContext, only ever touched from inside a user
  // gesture (the capture click), so autoplay policy never blocks or warns. Any
  // failure is swallowed — audio is a garnish, never load-bearing.
  let audioCtx = null;
  function ensureAudio() {
    if (REDUCED_MOTION) return null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return audioCtx;
    } catch {
      return null;
    }
  }
  // A short sine "tick" (or a two-note chime for the completed set). Synthesized —
  // no audio files, no network. Kept quiet and brief so it reads as an instrument
  // confirmation, not an alert.
  function tick(freq, when, dur, peak) {
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }
  function blip(kind) {
    if (!soundOn || REDUCED_MOTION) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime;
      if (kind === 'complete') {
        tick(660, t0, 0.12, 0.05);
        tick(990, t0 + 0.1, 0.16, 0.05); // resolves up — "done"
      } else {
        tick(760, t0, 0.09, 0.045);
      }
    } catch {
      /* audio graph unavailable mid-call — ignore */
    }
  }

  // The one call the capture paths make: haptic + (opt-in) sound together.
  function confirmFeedback(kind) {
    if (kind === 'complete') {
      haptic([16, 60, 28]); // set complete — a distinct double tick
      blip('complete');
    } else {
      haptic(14); // one face locked in — a single crisp tick
      blip('tick');
    }
  }

  function setSoundButton() {
    const btn = $('#btn-sound');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(soundOn));
    btn.textContent = soundOn ? 'Sound: on' : 'Sound: off';
  }
  const soundBtn = $('#btn-sound');
  if (soundBtn) {
    setSoundButton();
    soundBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      try {
        localStorage.setItem('solvent.sound', soundOn ? '1' : '0');
      } catch {
        /* ignore persistence failure */
      }
      // Prime the context inside this gesture and play a confirming tick so the
      // toggle is audible feedback for itself.
      if (soundOn) {
        ensureAudio();
        blip('tick');
      }
      setSoundButton();
    });
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

  function selectSize(id) {
    if (id === mod.current.id) return;
    mod.current = getSizeModule(id);
    faces = mod.current.emptyFaces();
    lowConf = emptyLowConf();
    captureIndex = 0;
    solution = null;
    [...sizeButtons.children].forEach((b) => {
      if (!b.disabled) b.setAttribute('aria-pressed', String(b.textContent === mod.current.name));
    });
    buildReticle();
    buildFaceProgress();
    buildNet();
    buildPalette();
    // The guide cube and the solution renderer are per-size (grid + geometry), so
    // rebuild both for the new module. The renderer is recreated lazily on solve.
    if (guide) {
      guide.dispose();
      guide = null;
      ensureGuide();
    }
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
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
    // Auto-capture and the live colour read-out only run on the live capture screen.
    if (name === 'capture') {
      if (autoOn) startAuto();
      startLive();
    } else {
      stopAuto();
      stopLive();
    }
    // Solution auto-play must never keep running off-screen.
    if (name !== 'solution') stopPlay();
  }

  // ---- reticle ----
  function buildReticle() {
    const reticle = $('#reticle');
    reticle.style.setProperty('--gn', mod.current.gridN);
    reticle.innerHTML = '';
    reticle.classList.remove('live');
    // Each cell carries a live-read chip: a small swatch showing the colour
    // Solvent currently reads there, so the user can SEE the read before capturing.
    for (let i = 0; i < mod.current.gridN * mod.current.gridN; i++) {
      const cell = el('i');
      cell.appendChild(el('b', 'reticle-chip'));
      reticle.appendChild(cell);
    }
  }

  // ---- live colour read-out ---------------------------------------------------
  // Whenever the camera is live on the capture screen, sample the reticle a few
  // times a second and paint each cell's chip with the colour Solvent reads there
  // (dimmed + marked when the read is low-confidence). This makes the capture
  // legible: the user adjusts light/angle until the chips are right, then captures.
  // Fully gated on a live camera, so headless / e2e never starts it.
  let liveTimer = 0;
  const LIVE_SAMPLE_MS = 160;
  function liveActive() {
    return (
      scanner &&
      scanner.isActive() &&
      screens.capture.classList.contains('is-active') &&
      (typeof document.hidden === 'undefined' || !document.hidden)
    );
  }
  function clearLiveChips() {
    const reticle = $('#reticle');
    reticle.classList.remove('live');
    reticle.querySelectorAll('.reticle-chip').forEach((chip) => {
      chip.style.background = '';
      chip.dataset.low = 'false';
    });
  }
  function liveTick() {
    if (!liveActive()) return;
    let samples;
    try {
      samples = scanner.sample();
    } catch {
      samples = null;
    }
    if (!samples || !samples.length) return;
    const chips = $('#reticle').querySelectorAll('.reticle-chip');
    const detailed = typeof mod.current.classifyColorDetailed === 'function';
    const thr = mod.current.confidenceThreshold ?? 0.2;
    samples.forEach((rgb, i) => {
      const chip = chips[i];
      if (!chip) return;
      let color, low;
      if (detailed) {
        const d = mod.current.classifyColorDetailed(rgb);
        color = d.color;
        low = d.confidence < thr;
      } else {
        color = mod.current.classifyColor(rgb);
        low = false;
      }
      chip.style.background = mod.current.colorHex[color];
      chip.dataset.low = low ? 'true' : 'false';
    });
    $('#reticle').classList.add('live');
  }
  function startLive() {
    if (liveTimer || !liveActive()) return;
    $('#camera-wrap').classList.add('is-live');
    liveTimer = setInterval(liveTick, LIVE_SAMPLE_MS);
    liveTick();
  }
  function stopLive() {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = 0;
    }
    $('#camera-wrap').classList.remove('is-live');
    clearLiveChips();
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
        cubiesPerEdge: mod.current.cubiesPerEdge,
        scanSequence: mod.current.scanSequence,
        solvedState: mod.current.SOLVED_STATE,
        geomFromState: mod.current.geomFromState,
        onArrive: pulseArrival,
      });
      guide.setMirror(mirror);
      if (screens.capture.classList.contains('is-active')) guide.start();
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
    const { ok, errors, mirror, warning } = mod.current.validate(faces);
    box.innerHTML = '';
    if (ok) {
      const div = el('div', 'validation__ok', 'This is a real, solvable cube. Ready to solve.');
      box.appendChild(div);
      if (mirror && warning) {
        box.appendChild(el('div', 'validation__note', warning));
      }
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
      // If the user had already opted into auto-capture, begin sampling now that
      // the camera is live.
      if (autoOn) startAuto();
      // Begin the live per-sticker colour read-out.
      startLive();
    }
    updateFlashButton();
  }

  // The single capture path shared by the manual button and the auto-capture
  // assist. Samples the reticle, classifies with a confidence margin, advances to
  // the next unfilled face, and fires the confirmation feedback. Returns true if a
  // face was recorded. Guarded so it is a no-op without a live camera frame.
  function commitCapture() {
    if (!scanner || !scanner.isActive()) return false;
    const samples = scanner.sample();
    if (!samples) return false;
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
      confirmFeedback('complete');
      goReview();
    } else {
      confirmFeedback('tick');
    }
    return true;
  }

  $('#btn-capture').addEventListener('click', () => {
    commitCapture();
  });

  $('#btn-skip-face').addEventListener('click', () => {
    stopAuto(); // a manual jump: drop any in-progress auto countdown
    captureIndex = (captureIndex + 1) % scanFaces().length;
    updateCaptureTarget();
  });

  // ---- auto-capture assist (opt-in) -----------------------------------------
  // When enabled AND the camera is live, sample the reticle a few times a second
  // and, once the frame holds STEADY (low frame-to-frame color change) and reads
  // CLEANLY (every sticker classifies with high confidence) for a short window,
  // run an ~0.8s countdown ring and then fire the same commitCapture() the manual
  // button uses. Any movement resets it; it re-arms only after it sees the cube
  // move, so it can never double-fire the same face. Entirely gated on a live
  // camera, so headless / e2e (no camera) never runs a sample or a timer.
  let autoOn = false;
  let autoTimer = 0; // setInterval handle for sampling
  let autoLast = null; // previous sample, for frame-to-frame steadiness
  let autoSteadyMs = 0; // accumulated steady+confident time
  let autoArmed = true; // must see movement before it can fire again
  let autoCountdownStart = 0; // performance.now() when the ring began, else 0
  const AUTO_SAMPLE_MS = 180; // ~5.5 samples/sec — responsive but battery-light
  const AUTO_HOLD_MS = 480; // steady+confident this long before the ring starts
  const AUTO_COUNTDOWN_MS = 800; // ring fill duration
  const AUTO_STEADY_EPS = 15; // mean per-channel delta below this = "not moving"
  const AUTO_MIN_CONF = 0.32; // every sticker must beat this margin to count

  const autoRing = $('#auto-ring');
  const autoRingFill = autoRing ? autoRing.querySelector('.auto-ring__fill') : null;
  function setAutoRing(p) {
    // p in [0,1]; pathLength is 100, dashoffset 100 -> 0 as it fills.
    if (!autoRing || !autoRingFill) return;
    if (p == null) {
      autoRing.hidden = true;
      return;
    }
    autoRing.hidden = false;
    autoRingFill.style.strokeDashoffset = String(100 * (1 - p));
  }
  function autoActive() {
    return (
      autoOn &&
      scanner &&
      scanner.isActive() &&
      screens.capture.classList.contains('is-active') &&
      (typeof document.hidden === 'undefined' || !document.hidden)
    );
  }
  function resetAutoProgress() {
    autoSteadyMs = 0;
    autoCountdownStart = 0;
    setAutoRing(null);
  }
  function startAuto() {
    if (autoTimer || !autoActive()) return;
    autoLast = null;
    autoArmed = true;
    resetAutoProgress();
    autoTimer = setInterval(autoTick, AUTO_SAMPLE_MS);
  }
  function stopAuto() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = 0;
    }
    autoLast = null;
    resetAutoProgress();
  }
  function autoTick() {
    if (!autoActive()) {
      resetAutoProgress();
      return;
    }
    let samples;
    try {
      samples = scanner.sample();
    } catch {
      samples = null;
    }
    if (!samples || !samples.length) return;

    // Confidence: the weakest sticker gates the whole face.
    let minConf = 1;
    if (typeof mod.current.classifyColorDetailed === 'function') {
      for (const rgb of samples) {
        const c = mod.current.classifyColorDetailed(rgb).confidence;
        if (c < minConf) minConf = c;
      }
    }
    // Steadiness: mean absolute per-channel change vs the previous sample.
    let steady = false;
    if (autoLast && autoLast.length === samples.length) {
      let tot = 0;
      let n = 0;
      for (let i = 0; i < samples.length; i++) {
        for (let c = 0; c < 3; c++) {
          tot += Math.abs(samples[i][c] - autoLast[i][c]);
          n++;
        }
      }
      steady = n > 0 && tot / n < AUTO_STEADY_EPS;
    }
    autoLast = samples;

    const aligned = steady && minConf >= AUTO_MIN_CONF;
    if (!aligned) {
      // Movement (or a poor read) — this is what re-arms a fresh capture.
      autoArmed = true;
      resetAutoProgress();
      return;
    }
    if (!autoArmed) {
      // Still parked on the face we just captured; wait for the user to turn it.
      resetAutoProgress();
      return;
    }
    autoSteadyMs += AUTO_SAMPLE_MS;
    if (autoSteadyMs < AUTO_HOLD_MS) return;
    if (!autoCountdownStart) autoCountdownStart = performance.now();
    const p = Math.min(1, (performance.now() - autoCountdownStart) / AUTO_COUNTDOWN_MS);
    setAutoRing(p);
    if (p >= 1) {
      autoArmed = false; // require movement before the next auto fire
      resetAutoProgress();
      commitCapture();
    }
  }

  const autoBtn = $('#btn-auto');
  function setAutoButton() {
    if (!autoBtn) return;
    autoBtn.setAttribute('aria-pressed', String(autoOn));
    autoBtn.textContent = autoOn ? 'Auto: on' : 'Auto: off';
  }
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      autoOn = !autoOn;
      setAutoButton();
      if (autoOn) startAuto();
      else stopAuto();
    });
  }
  // Pause sampling when the tab is backgrounded; resume when it returns.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAuto();
    else if (autoOn) startAuto();
  });

  // ---- hold-steady assist (opt-in, device-motion) ----------------------------
  // A deliberately modest reading: NOT "hold the phone level" (people scan from
  // any angle), but "is the phone moving or still right now?" — derived from the
  // gyroscope's rotation-rate magnitude, which is independent of how the phone is
  // held and of the screen orientation, so there is no axis-remapping to get
  // wrong. Shown only after an explicit tap (iOS requires the gesture to grant
  // permission) and only where the sensor plausibly exists; hidden on desktop /
  // when no motion ever arrives, so it never clutters a machine that can't use it.
  const steadyPill = $('#steady-pill');
  const steadyText = $('#steady-pill-text');
  const steadyBtn = $('#btn-steady');
  let steadyOn = false;
  let steadyRate = 0; // smoothed rotation-rate magnitude (deg/s)
  let steadyGotEvent = false; // have we ever received a non-trivial motion sample?
  const STEADY_THRESHOLD = 12; // deg/s below which we call it "steady"

  const motionSupported =
    typeof window !== 'undefined' &&
    typeof window.DeviceMotionEvent !== 'undefined' &&
    // Only surface on touch-like devices; keeps it off desktop/headless.
    (window.matchMedia?.('(pointer: coarse)')?.matches ||
      typeof window.DeviceMotionEvent.requestPermission === 'function');

  function paintSteady() {
    if (!steadyPill) return;
    if (!steadyOn) {
      steadyPill.hidden = true;
      return;
    }
    steadyPill.hidden = false;
    if (!steadyGotEvent) {
      steadyPill.dataset.steady = 'unknown';
      if (steadyText) steadyText.textContent = 'Sensing…';
      return;
    }
    const still = steadyRate < STEADY_THRESHOLD;
    steadyPill.dataset.steady = still ? 'steady' : 'moving';
    if (steadyText) steadyText.textContent = still ? 'Steady' : 'Hold steady';
  }

  function onMotion(e) {
    const r = e && e.rotationRate;
    if (!r) return;
    const mag = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
    // Some browsers emit a constant-zero event when there is truly no sensor;
    // treat only a real, non-zero reading as proof the sensor is live.
    if (mag > 0.001) steadyGotEvent = true;
    // Low-pass so the pill doesn't flicker on tiny tremors.
    steadyRate += (mag - steadyRate) * 0.3;
    paintSteady();
  }

  function enableSteady() {
    steadyOn = true;
    steadyGotEvent = false;
    steadyRate = 0;
    window.addEventListener('devicemotion', onMotion);
    if (steadyBtn) {
      steadyBtn.setAttribute('aria-pressed', 'true');
      steadyBtn.textContent = 'Hold-steady: on';
    }
    paintSteady();
    // If nothing ever arrives (permission-less desktop that still has the API),
    // quietly retire the control rather than leave a dead "Sensing…" pill.
    setTimeout(() => {
      if (steadyOn && !steadyGotEvent) disableSteady(true);
    }, 2500);
  }
  function disableSteady(retire) {
    steadyOn = false;
    window.removeEventListener('devicemotion', onMotion);
    if (steadyPill) steadyPill.hidden = true;
    if (steadyBtn) {
      steadyBtn.setAttribute('aria-pressed', 'false');
      steadyBtn.textContent = 'Hold-steady assist';
      if (retire) steadyBtn.hidden = true; // no live sensor — stop offering it
    }
  }

  if (steadyBtn && motionSupported) {
    steadyBtn.hidden = false;
    steadyBtn.setAttribute('aria-pressed', 'false');
    steadyBtn.addEventListener('click', async () => {
      if (steadyOn) {
        disableSteady(false);
        return;
      }
      // iOS 13+ gates the sensor behind an explicit permission prompt that must
      // be triggered from a user gesture (this click).
      try {
        const req = window.DeviceMotionEvent.requestPermission;
        if (typeof req === 'function') {
          const res = await req();
          if (res !== 'granted') {
            if (steadyText) steadyText.textContent = 'Motion access denied';
            return;
          }
        }
      } catch {
        /* requestPermission threw (not in a gesture, unsupported) — bail quietly */
        return;
      }
      enableSteady();
    });
  }

  function goReview() {
    stopAuto();
    stopLive();
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
    playing = false;
    showScreen('solution');
    stepIndex = 0;
    ensureRenderer();
    const copyBtn = $('#btn-copy');
    if (copyBtn) {
      copyBtn.disabled = !solution || solution.moves.length === 0;
      copyBtn.textContent = 'Copy moves';
    }
    if (renderer) renderer.setGeom(solution.frames[0]);
    buildMoveList();
    updateSolveReadout();
    const lede = $('#solution-lede');
    if (solution.moves.length === 0) {
      lede.textContent = 'This cube is already solved. Nothing to do.';
    } else {
      lede.textContent = `Solution in ${solution.moves.length} move${
        solution.moves.length > 1 ? 's' : ''
      }. Set the cube up as below, then step through with Next.`;
    }
    renderSetupCard();
    // Carry the mirror-scheme heads-up onto the solution screen too, so the note
    // stays visible while the user follows the moves.
    let mnote = $('#solution-mirror-note');
    if (solution.mirror && solution.warning) {
      if (!mnote) {
        mnote = el('div', 'validation__note');
        mnote.id = 'solution-mirror-note';
        lede.parentNode.insertBefore(mnote, lede.nextSibling);
      }
      mnote.textContent = solution.warning;
      mnote.hidden = false;
    } else if (mnote) {
      mnote.hidden = true;
    }
    updateStepButtons();
  }

  // ---- crystal-clear turn wording -------------------------------------------
  // Name the face by its own colour when we have it (3x3 centres), and always say
  // the turn direction the way a person reads it: looking straight at that face.
  function moveDir(name) {
    const s = name.slice(1);
    return s === "'" ? 'counter-clockwise' : s === '2' ? 'a half turn (180°)' : 'clockwise';
  }
  function moveText(name, withConvention) {
    const face = name[0];
    const label = mod.current.faceLabels[face].toLowerCase();
    const fc = solution.faceColors && solution.faceColors[face];
    const faceName = fc ? `${mod.current.colorNames[fc]} face (the ${label})` : `${label} face`;
    const conv = withConvention && name.slice(1) !== '2' ? ', looking straight at it' : '';
    return `turn the ${faceName} ${moveDir(name)}${conv}`;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // The "Set up your cube" card: how to orient the physical cube before move 1.
  // The on-screen 3D cube (in the user's own colours) is the definitive anchor;
  // for a 3x3 we also name the up/front centre colours as a quick shortcut.
  function renderSetupCard() {
    const screen = $('#screen-solution');
    let card = $('#solution-setup');
    if (!solution || solution.moves.length === 0) {
      if (card) card.hidden = true;
      return;
    }
    if (!card) {
      card = el('div', 'setup-card');
      card.id = 'solution-setup';
      const grid = screen.querySelector('.solve-grid');
      screen.insertBefore(card, grid);
    }
    card.hidden = false;
    card.innerHTML = '';
    card.appendChild(el('span', 'setup-card__label', 'Set up your cube'));
    card.appendChild(
      el(
        'p',
        'setup-card__text',
        'Turn your real cube so every side matches the cube on screen — drag the cube to check all six faces. Hold that exact grip for the whole solution; the turn directions only work from this one starting position.'
      )
    );
    if (solution.hold) {
      const row = el('div', 'setup-card__hold');
      const chip = (color, where) => {
        const c = el('span', 'setup-chip');
        const dot = el('i', 'face-dot');
        dot.style.background = mod.current.colorHex[color];
        c.appendChild(dot);
        c.appendChild(el('span', null, `${mod.current.colorNames[color]} ${where}`));
        return c;
      };
      row.appendChild(chip(solution.hold.up, 'on top'));
      row.appendChild(chip(solution.hold.front, 'facing you'));
      card.appendChild(row);
    }
  }

  function buildMoveList() {
    const list = $('#move-list');
    list.innerHTML = '';
    solution.moves.forEach((m, i) => {
      const li = el('li', null, m.name);
      li.dataset.state = 'todo';
      li.title = cap(moveText(m.name, false));
      li.addEventListener('click', () => {
        stopPlay();
        jumpTo(i + 1);
      });
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
    } else if (stepIndex >= solution.moves.length) {
      hint.textContent = 'Solved. Six solid faces.';
    } else {
      const name = solution.moves[stepIndex].name;
      hint.textContent = `Next — ${name}: ${moveText(name, true)}.`;
    }
    refreshMoveList();
  }
  function updateStepButtons() {
    $('#btn-prev').disabled = animating || stepIndex <= 0;
    $('#btn-next').disabled = animating || stepIndex >= solution.moves.length;
    updatePlayButton();
  }
  function updatePlayButton() {
    const btn = $('#btn-play');
    if (!btn) return;
    // Nothing to play for an already-solved cube (empty move list).
    btn.disabled = !solution || solution.moves.length === 0;
    btn.setAttribute('aria-pressed', String(playing));
    btn.textContent = playing ? '❚❚ Pause' : '▶ Play';
    btn.setAttribute('aria-label', playing ? 'Pause the solution' : 'Play the solution');
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

  // ---- solution auto-play -----------------------------------------------------
  // Runs entirely through goNext()'s promise: await one move, rest for a beat,
  // repeat, until paused or the end is reached. The rest is a single cancelable
  // timeout that only GATES the loop — it never triggers a move itself, so the
  // `animating` guard can never be raced. Under reduced motion each goNext()
  // resolves instantly (ANIM_MS = 0), so a short rest keeps it legible.
  function stopPlay() {
    if (!playing && !playDelayTimer) return;
    playing = false;
    if (playDelayTimer) {
      clearTimeout(playDelayTimer);
      playDelayTimer = 0;
    }
    updatePlayButton();
  }
  function restRoughly(ms) {
    return new Promise((resolve) => {
      playDelayTimer = setTimeout(() => {
        playDelayTimer = 0;
        resolve();
      }, ms);
    });
  }
  async function playLoop() {
    while (playing && stepIndex < solution.moves.length) {
      await goNext();
      if (!playing) break;
      await restRoughly(REDUCED_MOTION ? 140 : 460);
    }
    // Reached the end (or was paused mid-rest): settle the button state.
    playing = false;
    updatePlayButton();
    updateStepButtons();
  }
  function togglePlay() {
    if (!solution || solution.moves.length === 0) return;
    if (playing) {
      stopPlay();
      return;
    }
    // Starting from the end replays from the top.
    if (stepIndex >= solution.moves.length) {
      stepIndex = 0;
      if (renderer) renderer.setGeom(solution.frames[0]);
      updateSolveReadout();
    }
    playing = true;
    updatePlayButton();
    playLoop();
  }

  // ---- copy move list ---------------------------------------------------------
  let copyResetTimer = 0;
  function fallbackCopy(text) {
    // execCommand path for browsers without the async clipboard API (or when it
    // is blocked by an insecure context). Best-effort; returns success.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }
  async function copyMoves() {
    if (!solution || solution.moves.length === 0) return;
    const text = solution.moves.map((m) => m.name).join(' ');
    let ok = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false; // permission denied / insecure context — fall through
    }
    if (!ok) ok = fallbackCopy(text);
    const btn = $('#btn-copy');
    if (btn) {
      btn.textContent = ok ? 'Copied ✓' : 'Copy unavailable';
      clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        btn.textContent = 'Copy moves';
      }, 1500);
    }
  }

  $('#btn-next').addEventListener('click', () => {
    stopPlay();
    goNext();
  });
  $('#btn-prev').addEventListener('click', () => {
    stopPlay();
    goPrev();
  });
  $('#btn-play').addEventListener('click', togglePlay);
  $('#btn-copy').addEventListener('click', copyMoves);
  $('#btn-restart-anim').addEventListener('click', () => {
    stopPlay();
    jumpTo(0);
  });
  $('#btn-new').addEventListener('click', () => {
    stopPlay();
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
    if (e.key === 'ArrowRight') {
      stopPlay();
      goNext();
    }
    if (e.key === 'ArrowLeft') {
      stopPlay();
      goPrev();
    }
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
    // Auto-play state, so the e2e can click Play and assert it reaches solved
    // then stops on its own.
    isPlaying: () => playing,
  };
}
