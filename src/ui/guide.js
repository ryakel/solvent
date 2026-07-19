// guide.js — the scan turn-guide: an animated, engineering-style demonstration
// of EXACTLY how to rotate the physical cube between scans.
//
// The scan path itself (which faces, in what order, and the single whole-cube
// turn between each) is owned by the active SizeModule as `scanSequence` (see
// sizes/size2x2.js). This module is the *renderer* for that path: for each step
// it composes the target orientation from the declared turn, animates the demo
// cube from the previous step's orientation along that exact turn, and derives
// the curved arrow, the rotation axis, and the traveling marker from the same
// turn. The animation IS the instruction — they cannot disagree.
//
// Features layered on top of the base demonstration:
//   • onArrive() fires the instant a turn completes and the face locks in, so
//     the UI can pulse the camera reticle in sync ("arrival tick").
//   • The 180° flip draws its arc progressively as the cube rolls, a stronger
//     "keep going" cue than a static half-circle.
//   • setMirror() reflects the whole demonstration left-for-right to match a
//     mirrored (selfie) camera preview, so guide and preview always agree.
//
// Honors prefers-reduced-motion by snapping to the target pose with a static
// arrow instead of looping the demonstration.

import * as THREE from '../../vendor/three.module.js';

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createGuide(container, opts) {
  const colorHex = opts.colorHex;
  const reducedMotion = !!opts.reducedMotion;
  const onArrive = typeof opts.onArrive === 'function' ? opts.onArrive : () => {};
  // Size-adaptive: keep the demo cube the same overall size for any N (so the
  // arrows, which wrap its outer extent, stay correct). For N=2, CELL=1 and
  // cubie=0.94 — identical to before.
  const cubiesPerEdge = opts.cubiesPerEdge || 2;
  const CELL = 2 / cubiesPerEdge;
  const cubie = CELL * 0.94;
  const posScale = (CELL * (cubiesPerEdge - 1)) / 2; // geom coord -> cube-frame position

  // The demo cube geometry is built from the size module's solved state so the
  // guide always matches the cube being scanned.
  const SOLVED = opts.solvedState;
  const geomFromState = opts.geomFromState;

  const scene = new THREE.Scene();
  // The camera sits a little above and looks down ~17°. The stage (below) tips
  // the cube back by about the same angle, so the presented face still meets
  // the camera face-on while horizontal arcs open up and read as true circles.
  const camera = new THREE.PerspectiveCamera(34, 1.6, 0.1, 100);
  camera.position.set(0, 2.05, 6.2);
  camera.lookAt(0, 0.05, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(4, 6, 8);
  scene.add(key);

  // The stage carries a constant, gentle presentation tilt (peek at the top and
  // the right side so the pose reads as 3D). Everything inside the stage lives
  // in the cube's own frame, so the arrows and the motion stay geometrically
  // locked together no matter the tilt. A left-for-right mirror (for selfie
  // cameras) is applied as a negative x-scale on this same group, so the cube,
  // the arrows and the traveling marker all reflect together and stay coherent.
  const stage = new THREE.Group();
  const TILT = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.33)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.48));
  stage.quaternion.copy(TILT);
  scene.add(stage);

  // ---- the demonstration cube (solved; built from the geometry oracle) ----
  // Materials are DoubleSide so the cube still renders correctly when the stage
  // is mirrored (a negative scale flips triangle winding).
  const cube = new THREE.Group();
  stage.add(cube);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x0b0d11,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
  const stickerMat = {};
  const mat = (c) =>
    (stickerMat[c] ||= new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex[c]),
      roughness: 0.4,
      emissive: new THREE.Color(colorHex[c]),
      emissiveIntensity: 0.12,
      side: THREE.DoubleSide,
    }));
  for (const c of geomFromState(SOLVED)) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(cubie, cubie, cubie), bodyMat));
    for (const s of c.stickers) {
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(cubie * 0.82, cubie * 0.82), mat(s.color));
      const d = cubie * 0.5 + 0.008;
      tile.position.set(s.normal[0] * d, s.normal[1] * d, s.normal[2] * d);
      tile.lookAt(tile.position.clone().multiplyScalar(2));
      g.add(tile);
    }
    g.position.set(c.pos[0] * posScale, c.pos[1] * posScale, c.pos[2] * posScale);
    cube.add(g);
  }

  // ---- turn indicators: curved arrow + rotation axis, flat and engineered ----
  const matInk = new THREE.MeshBasicMaterial({
    color: 0xf4f6f8,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });
  // Faint "path track" for the progressive flip: the whole arc drawn quietly so
  // the eye knows where the sweep is headed before the bright arc gets there.
  const matGhost = new THREE.MeshBasicMaterial({
    color: 0xf4f6f8,
    transparent: true,
    opacity: 0.13,
    side: THREE.DoubleSide,
  });
  const matAxis = new THREE.MeshBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.38 });
  const matDot = new THREE.MeshBasicMaterial({ color: 0x2b7fff, transparent: true, opacity: 1 });

  // A tube following pointFn(t), t in [0,1].
  function tubeMesh(pointFn, material) {
    const pts = [];
    for (let i = 0; i <= 64; i++) pts.push(pointFn(i / 64));
    const curve = new THREE.CatmullRomCurve3(pts);
    return new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.04, 12), material);
  }

  // The three points of a flat arrowhead lying IN the rotation plane at t (a
  // cone pointing away from the camera would collapse to a dot). tip leads along
  // the tangent; b1/b2 splay across it.
  function headPoints(pointFn, axis, t) {
    const p = pointFn(t);
    const tangent = pointFn(Math.min(1, t + 0.01))
      .clone()
      .sub(pointFn(Math.max(0, t - 0.01)))
      .normalize();
    const planeNormal = new THREE.Vector3();
    planeNormal.setComponent(AXIS_INDEX[axis], 1);
    const across = new THREE.Vector3().crossVectors(planeNormal, tangent).normalize();
    const tip = p.clone().add(tangent.clone().multiplyScalar(0.3));
    const b1 = p.clone().add(across.clone().multiplyScalar(0.125));
    const b2 = p.clone().sub(across.clone().multiplyScalar(0.125));
    return [tip, b1, b2];
  }
  function headMesh(pointFn, axis, t, material) {
    const geo = new THREE.BufferGeometry().setFromPoints(headPoints(pointFn, axis, t));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
  }
  function updateHead(mesh, pointFn, axis, t) {
    mesh.geometry.setFromPoints(headPoints(pointFn, axis, t));
    mesh.geometry.attributes.position.needsUpdate = true;
  }

  // A thin rod through the cube marking the rotation axis. axis: 'x' | 'y'.
  function buildAxisRod(axis) {
    const g = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 3.4, 10), matAxis);
    g.add(rod);
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), matAxis);
      cap.position.set(0, 1.7 * s, 0);
      g.add(cap);
    }
    if (axis === 'x') g.rotation.z = -Math.PI / 2;
    return g;
  }

  const deg2rad = (d) => (d * Math.PI) / 180;
  // Yaw ring: a halo above the cube sweeping the way the front face travels
  // (from the right, across the front, off to the left). Sweeps across the
  // visible front of the ring, right → left, so the on-screen motion cue
  // matches "turn left" wherever you look at it.
  const yawPoint = (t) => {
    const a = deg2rad(-30 + t * 180);
    return new THREE.Vector3(1.18 * Math.cos(a), 1.3, 1.18 * Math.sin(a));
  };
  // Tilt arc: a large meridian sweep that wraps OVER the cube like a wheel
  // rolling toward the camera — from behind the top, over it, down the front.
  const tiltPoint = (t) => {
    const a = deg2rad(-35 + t * 150);
    return new THREE.Vector3(0.62, 1.42 * Math.cos(a), 1.42 * Math.sin(a));
  };
  // Flip arc: same axis, sweeping all the way under — a half turn.
  const flipPoint = (t) => {
    const a = deg2rad(-25 + t * 225);
    return new THREE.Vector3(0.62, 1.48 * Math.cos(a), 1.48 * Math.sin(a));
  };

  // kind: 'static' (full arc always drawn) | 'progressive' (arc grows with the
  // turn). Both carry a rotation-axis rod and a traveling marker.
  function makeIndicator(pointFn, axis, kind) {
    const group = new THREE.Group();
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), matInk);
    tail.position.copy(pointFn(0));
    group.add(tail);
    group.add(buildAxisRod(axis));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), matDot);
    dot.visible = false;
    group.add(dot);

    let obj;
    if (kind === 'progressive') {
      group.add(tubeMesh(pointFn, matGhost)); // faint full-path track
      const bright = tubeMesh(pointFn, matInk);
      bright.geometry.setDrawRange(0, 0);
      group.add(bright);
      const head = headMesh(pointFn, axis, 1, matInk);
      const chev = headMesh(pointFn, axis, 0.87, matInk); // trailing "keep going" chevron
      group.add(head, chev);
      obj = { group, pointFn, kind, dot, axis, bright, fullCount: bright.geometry.index.count, head, chev };
    } else {
      group.add(tubeMesh(pointFn, matInk));
      group.add(headMesh(pointFn, axis, 1, matInk));
      obj = { group, pointFn, kind, dot, axis };
    }
    group.visible = false;
    stage.add(group);
    return obj;
  }

  const INDICATORS = {
    yaw: makeIndicator(yawPoint, 'y', 'static'),
    tilt: makeIndicator(tiltPoint, 'x', 'static'),
    flip: makeIndicator(flipPoint, 'x', 'progressive'),
  };
  function indicatorFor(turn) {
    if (!turn) return null;
    if (turn.axis === 'y') return INDICATORS.yaw;
    return Math.abs(turn.deg) >= 180 ? INDICATORS.flip : INDICATORS.tilt;
  }

  // phase: 'pre' | 'travel' | 'hold'; e is the eased travel fraction [0,1].
  function renderIndicator(obj, phase, e) {
    if (!obj) return;
    if (phase === 'hold') {
      obj.dot.visible = false;
    } else {
      obj.dot.visible = true;
      obj.dot.position.copy(obj.pointFn(phase === 'pre' ? 0 : e));
    }
    if (obj.kind === 'progressive') {
      const p = phase === 'hold' ? 1 : phase === 'pre' ? 0 : e;
      obj.bright.geometry.setDrawRange(0, Math.max(0, Math.floor(p * obj.fullCount)));
      if (p > 0.03) {
        obj.head.visible = true;
        updateHead(obj.head, obj.pointFn, obj.axis, p);
      } else {
        obj.head.visible = false;
      }
      if (p > 0.58) {
        obj.chev.visible = true;
        updateHead(obj.chev, obj.pointFn, obj.axis, Math.max(0.02, p - 0.13));
      } else {
        obj.chev.visible = false;
      }
    }
  }

  // ---- the active scan sequence and its per-step orientations ----------------
  // SEQ comes from the size module; STEP_Q/STEP_AXIS/STEP_RAD are composed from
  // the declared turns so the motion is exact even for the 180° flip.
  let SEQ = [];
  const STEP_Q = [];
  const STEP_AXIS = [];
  const STEP_RAD = [];
  function setSequence(seq) {
    SEQ = Array.isArray(seq) ? seq : [];
    STEP_Q.length = STEP_AXIS.length = STEP_RAD.length = 0;
    let q = new THREE.Quaternion();
    for (const step of SEQ) {
      if (step.turn) {
        const axis = new THREE.Vector3();
        axis.setComponent(AXIS_INDEX[step.turn.axis], 1);
        const rad = deg2rad(step.turn.deg);
        q = new THREE.Quaternion().setFromAxisAngle(axis, rad).multiply(q);
        STEP_AXIS.push(axis);
        STEP_RAD.push(rad);
      } else {
        STEP_AXIS.push(null);
        STEP_RAD.push(0);
      }
      STEP_Q.push(q.clone());
    }
    showStep(Math.min(stepIndex, Math.max(0, SEQ.length - 1)));
  }

  // ---- demonstration loop: show start pose → turn → hold → repeat ----
  const PRE_MS = 520; // beat on the "from" pose so the start of the turn reads
  const HOLD_MS = 1350; // rest on the presented face
  const travelMsFor = (turn) => (Math.abs(turn.deg) >= 180 ? 2400 : 1500);

  let stepIndex = 0;
  let active = null; // current indicator
  let cycleStart = null;
  let curPhase = null;
  let inkTarget = 0.95;
  const tmpQ = new THREE.Quaternion();
  const swayA = new THREE.Quaternion();
  const swayB = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);

  function setIndicator(turn) {
    for (const k of Object.keys(INDICATORS)) INDICATORS[k].group.visible = false;
    active = indicatorFor(turn);
    if (active) {
      active.group.visible = true;
      active.dot.visible = false;
    }
  }

  function showStep(i) {
    stepIndex = Math.max(0, Math.min(Math.max(0, SEQ.length - 1), i | 0));
    cycleStart = null; // restart the demonstration for the new step
    curPhase = null;
    const step = SEQ[stepIndex];
    setIndicator(step ? step.turn : null);
    if (STEP_Q[stepIndex]) cube.quaternion.copy(STEP_Q[stepIndex]);
    if (reducedMotion) {
      matInk.opacity = 0.9;
      matAxis.opacity = 0.34;
      if (active) renderIndicator(active, 'hold', 1);
    }
  }

  // ---- mirror (selfie camera): reflect the whole stage left-for-right --------
  let mirrored = false;
  function setMirror(on) {
    mirrored = !!on;
    stage.scale.x = mirrored ? -1 : 1;
  }

  let running = false;
  let raf = 0;
  function loop(now) {
    if (!running) return;
    const step = SEQ[stepIndex];
    if (reducedMotion) {
      // Snap to the target pose; the static arrow still shows the turn.
      if (STEP_Q[stepIndex]) cube.quaternion.copy(STEP_Q[stepIndex]);
      inkTarget = 0.9;
      if (active) renderIndicator(active, 'hold', 1);
    } else if (!step || !step.turn) {
      // Starting hold: a slow, instrument-steady sway so the pose reads as 3D.
      swayA.setFromAxisAngle(Y, Math.sin(now / 1900) * 0.05);
      swayB.setFromAxisAngle(X, Math.sin(now / 2700 + 1) * 0.03);
      cube.quaternion.copy(swayA).multiply(swayB).multiply(STEP_Q[stepIndex] || new THREE.Quaternion());
    } else {
      if (cycleStart == null) cycleStart = now;
      const travel = travelMsFor(step.turn);
      const cycle = PRE_MS + travel + HOLD_MS;
      const t = (now - cycleStart) % cycle;
      const qFrom = STEP_Q[stepIndex - 1];
      let phase;
      let e = 0;
      if (t < PRE_MS) {
        phase = 'pre';
        cube.quaternion.copy(qFrom);
        inkTarget = 0.95;
      } else if (t < PRE_MS + travel) {
        phase = 'travel';
        // Rotate about the REAL turn axis by the eased fraction of the real
        // angle — exact even for the 180° flip, where slerp would be ambiguous.
        e = easeInOut((t - PRE_MS) / travel);
        tmpQ.setFromAxisAngle(STEP_AXIS[stepIndex], STEP_RAD[stepIndex] * e);
        cube.quaternion.copy(tmpQ).multiply(qFrom);
        inkTarget = 0.95;
      } else {
        phase = 'hold';
        cube.quaternion.copy(STEP_Q[stepIndex]);
        inkTarget = 0.32; // rest quietly on the presented face
      }
      if (active) renderIndicator(active, phase, e);
      // Fire the arrival tick exactly once, as travel completes and the face
      // locks in — the UI pulses the reticle in sync.
      if (phase !== curPhase) {
        if (phase === 'hold') onArrive();
        curPhase = phase;
      }
    }
    // ease the indicator brightness between phases
    if (!reducedMotion) {
      matInk.opacity += (inkTarget - matInk.opacity) * 0.12;
      matAxis.opacity += (inkTarget * 0.4 - matAxis.opacity) * 0.12;
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    cycleStart = null;
    curPhase = null;
    resize();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
  }

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  setSequence(opts.scanSequence || []);

  // Tear the guide down so it can be rebuilt for a different cube size.
  function dispose() {
    stop();
    ro.disconnect();
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  return { showStep, setSequence, setMirror, start, stop, resize, dispose };
}
