// guide.js — the scan turn-guide: an animated, engineering-style demonstration
// of EXACTLY how to rotate the physical cube between scans.
//
// The core idea: SCAN_SEQUENCE orders the six faces so that each consecutive
// step differs from the previous one by ONE simple whole-cube turn — a 90° yaw
// or a 90°/180° tilt — expressed in the camera's frame (+x right, +y up,
// +z toward the camera). Each step's target orientation is COMPOSED from that
// turn, the demo cube animates from the previous step's orientation along that
// exact turn, and the curved arrow, the rotation axis, and the instruction text
// are all derived from the same turn spec. The animation IS the instruction —
// they cannot disagree.
//
// Sequence:  F → R → B → L (three 90° left yaws to go around the sides),
//            then U (tilt forward 90°), then D (keep tipping — a 180° flip).
//
// Honors prefers-reduced-motion by snapping to the target pose with a static
// arrow instead of looping the demonstration.

import * as THREE from '../../vendor/three.module.js';
import { FACES, rotateVec } from '../core/geometry.js';
import { SOLVED, geomFromState } from '../core/cube2.js';

const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const FACE_WORDS = { U: 'top', D: 'bottom', F: 'front', B: 'back', R: 'right', L: 'left' };

// Whole-cube turns in the camera frame, signed by the right-hand rule about
// the positive axis. -90° about +y swings the front face to the left;
// +90° about +x rolls the top face toward the camera.
const YAW_LEFT_90 = { axis: 'y', deg: -90 };
const TILT_FWD_90 = { axis: 'x', deg: 90 };
const TILT_FWD_180 = { axis: 'x', deg: 180 };

// Derive the short technical label and the plain-language instruction from the
// actual turn, so the words come from the same source of truth as the motion.
function instructionFor(turn, face) {
  const word = FACE_WORDS[face];
  if (!turn) {
    return {
      label: 'START',
      text: 'Hold the cube with White on top and Green toward the camera.',
    };
  }
  const amount = Math.abs(turn.deg);
  if (turn.axis === 'y') {
    const dir = turn.deg < 0 ? 'left' : 'right';
    return {
      label: `TURN ${dir.toUpperCase()} · ${amount}°`,
      text: `Turn the whole cube ${amount}° to the ${dir} — the ${word} face swings around to the camera.`,
    };
  }
  if (amount === 180) {
    return {
      label: 'FLIP FORWARD · 180°',
      text: `Keep tipping forward — a full half-turn — so the ${word} face rolls up to the camera.`,
    };
  }
  const fwd = turn.deg > 0;
  return {
    label: `TILT ${fwd ? 'FORWARD' : 'BACK'} · ${amount}°`,
    text: fwd
      ? `Tip the cube ${amount}° forward, top toward the camera — the ${word} face rolls down into view.`
      : `Tip the cube ${amount}° back — the ${word} face rolls into view.`,
  };
}

const RAW_SEQUENCE = [
  { face: 'F', turn: null },
  { face: 'R', turn: YAW_LEFT_90 },
  { face: 'B', turn: YAW_LEFT_90 },
  { face: 'L', turn: YAW_LEFT_90 },
  { face: 'U', turn: TILT_FWD_90 },
  { face: 'D', turn: TILT_FWD_180 },
];

export const SCAN_SEQUENCE = RAW_SEQUENCE.map((s) => ({ ...s, ...instructionFor(s.turn, s.face) }));

// Self-check with exact integer math (geometry.js is the oracle): accumulating
// the declared turns must present each step's face to the camera (+z). Throws
// at module load if the sequence and the turns ever drift apart.
(function verifySequence() {
  const world = {};
  for (const [f, spec] of Object.entries(FACES)) {
    const v = [0, 0, 0];
    v[spec.axis] = spec.sign;
    world[f] = v;
  }
  for (const step of RAW_SEQUENCE) {
    if (step.turn) {
      const quarters = Math.round(step.turn.deg / 90);
      for (const f of Object.keys(world)) {
        world[f] = rotateVec(world[f], AXIS_INDEX[step.turn.axis], quarters);
      }
    }
    const w = world[step.face];
    if (!(w[0] === 0 && w[1] === 0 && w[2] === 1)) {
      throw new Error(`scan sequence broken: step ${step.face} does not face the camera`);
    }
  }
})();

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createGuide(container, opts) {
  const colorHex = opts.colorHex;
  const reducedMotion = !!opts.reducedMotion;
  const cubie = 0.94;

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
  // locked together no matter the tilt.
  const stage = new THREE.Group();
  const TILT = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.33)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.48));
  stage.quaternion.copy(TILT);
  scene.add(stage);

  // ---- the demonstration cube (solved; built from the geometry oracle) ----
  const cube = new THREE.Group();
  stage.add(cube);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.55 });
  const stickerMat = {};
  const mat = (c) =>
    (stickerMat[c] ||= new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex[c]),
      roughness: 0.4,
      emissive: new THREE.Color(colorHex[c]),
      emissiveIntensity: 0.12,
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
    g.position.set(c.pos[0] * 0.5, c.pos[1] * 0.5, c.pos[2] * 0.5);
    cube.add(g);
  }

  // ---- turn indicators: curved arrow + rotation axis, flat and engineered ----
  const matInk = new THREE.MeshBasicMaterial({
    color: 0xf4f6f8,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });
  const matAxis = new THREE.MeshBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.38 });
  const matDot = new THREE.MeshBasicMaterial({ color: 0x2b7fff, transparent: true, opacity: 1 });

  // Build a curved arrow along pointFn(t), t in [0,1], head at t = 1.
  // Arrowheads are flat triangles lying IN the rotation plane (like a technical
  // drawing) — a cone pointing away from the camera would collapse to a dot.
  function buildArrow(pointFn, axis, doubleHead) {
    const g = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 64; i++) pts.push(pointFn(i / 64));
    const curve = new THREE.CatmullRomCurve3(pts);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.04, 12), matInk));
    // tail tick: a small round terminal where the sweep begins
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), matInk);
    tail.position.copy(pointFn(0));
    g.add(tail);
    const planeNormal = new THREE.Vector3();
    planeNormal.setComponent(AXIS_INDEX[axis], 1);
    const headAt = (t) => {
      const p = pointFn(t);
      const tangent = pointFn(Math.min(1, t + 0.01))
        .clone()
        .sub(pointFn(Math.max(0, t - 0.01)))
        .normalize();
      const across = new THREE.Vector3().crossVectors(planeNormal, tangent).normalize();
      const tip = p.clone().add(tangent.clone().multiplyScalar(0.3));
      const b1 = p.clone().add(across.clone().multiplyScalar(0.125));
      const b2 = p.clone().sub(across.clone().multiplyScalar(0.125));
      const geo = new THREE.BufferGeometry().setFromPoints([tip, b1, b2]);
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, matInk));
    };
    headAt(1);
    if (doubleHead) headAt(0.88); // a second chevron reads as "keep going — half turn"
    return g;
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
  // (from the right, across the front, off to the left). Head at the far end.
  // Sweeps across the visible front of the ring, right → left, so the on-screen
  // motion cue matches "turn left" wherever you look at it.
  const yawPoint = (t) => {
    const a = deg2rad(-30 + t * 180);
    return new THREE.Vector3(1.18 * Math.cos(a), 1.3, 1.18 * Math.sin(a));
  };
  // Tilt arc: beside the cube on the right, rolling the top toward the camera.
  const tiltPoint = (t) => {
    const a = deg2rad(-25 + t * 140);
    return new THREE.Vector3(1.28, 0.92 * Math.cos(a), 0.92 * Math.sin(a));
  };
  // Flip arc: same axis, but sweeping all the way under — a half turn.
  const flipPoint = (t) => {
    const a = deg2rad(-15 + t * 205);
    return new THREE.Vector3(1.28, 0.98 * Math.cos(a), 0.98 * Math.sin(a));
  };

  function makeIndicator(pointFn, axis, doubleHead) {
    const group = new THREE.Group();
    group.add(buildArrow(pointFn, axis, doubleHead));
    group.add(buildAxisRod(axis));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), matDot);
    dot.visible = false;
    group.add(dot);
    group.visible = false;
    stage.add(group);
    return { group, pointFn, dot };
  }
  const INDICATORS = {
    yaw: makeIndicator(yawPoint, 'y', false),
    tilt: makeIndicator(tiltPoint, 'x', false),
    flip: makeIndicator(flipPoint, 'x', true),
  };
  function indicatorFor(turn) {
    if (!turn) return null;
    if (turn.axis === 'y') return INDICATORS.yaw;
    return Math.abs(turn.deg) >= 180 ? INDICATORS.flip : INDICATORS.tilt;
  }

  // ---- per-step orientations, composed from the actual turns ----
  const STEP_Q = [];
  const STEP_AXIS = [];
  const STEP_RAD = [];
  {
    let q = new THREE.Quaternion();
    for (const step of SCAN_SEQUENCE) {
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
  }

  // ---- demonstration loop: show start pose → turn → hold → repeat ----
  const PRE_MS = 520; // beat on the "from" pose so the start of the turn reads
  const HOLD_MS = 1350; // rest on the presented face
  const travelMsFor = (turn) => (Math.abs(turn.deg) >= 180 ? 2400 : 1500);

  let stepIndex = 0;
  let active = null; // current indicator
  let cycleStart = null;
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
    stepIndex = Math.max(0, Math.min(SCAN_SEQUENCE.length - 1, i | 0));
    cycleStart = null; // restart the demonstration for the new step
    setIndicator(SCAN_SEQUENCE[stepIndex].turn);
    cube.quaternion.copy(STEP_Q[stepIndex]);
    if (reducedMotion) {
      matInk.opacity = 0.95;
      matAxis.opacity = 0.38;
    }
  }

  let running = false;
  let raf = 0;
  function loop(now) {
    if (!running) return;
    const step = SCAN_SEQUENCE[stepIndex];
    if (reducedMotion) {
      // Snap to the target pose; the static arrow still shows the turn.
      cube.quaternion.copy(STEP_Q[stepIndex]);
      inkTarget = 0.95;
      if (active) active.dot.visible = false;
    } else if (!step.turn) {
      // Starting hold: a slow, instrument-steady sway so the pose reads as 3D.
      swayA.setFromAxisAngle(Y, Math.sin(now / 1900) * 0.05);
      swayB.setFromAxisAngle(X, Math.sin(now / 2700 + 1) * 0.03);
      cube.quaternion.copy(swayA).multiply(swayB).multiply(STEP_Q[0]);
    } else {
      if (cycleStart == null) cycleStart = now;
      const travel = travelMsFor(step.turn);
      const cycle = PRE_MS + travel + HOLD_MS;
      const t = (now - cycleStart) % cycle;
      const qFrom = STEP_Q[stepIndex - 1];
      if (t < PRE_MS) {
        cube.quaternion.copy(qFrom);
        inkTarget = 0.95;
        if (active) {
          active.dot.visible = true;
          active.dot.position.copy(active.pointFn(0));
        }
      } else if (t < PRE_MS + travel) {
        // Rotate about the REAL turn axis by the eased fraction of the real
        // angle — exact even for the 180° flip, where slerp would be ambiguous.
        const e = easeInOut((t - PRE_MS) / travel);
        tmpQ.setFromAxisAngle(STEP_AXIS[stepIndex], STEP_RAD[stepIndex] * e);
        cube.quaternion.copy(tmpQ).multiply(qFrom);
        inkTarget = 0.95;
        if (active) {
          active.dot.visible = true;
          active.dot.position.copy(active.pointFn(e));
        }
      } else {
        cube.quaternion.copy(STEP_Q[stepIndex]);
        inkTarget = 0.32; // rest quietly on the presented face
        if (active) active.dot.visible = false;
      }
    }
    // ease the indicator brightness between phases
    matInk.opacity += (inkTarget - matInk.opacity) * 0.12;
    matAxis.opacity += (inkTarget * 0.4 - matAxis.opacity) * 0.12;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    cycleStart = null;
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

  showStep(0);

  return { showStep, start, stop, resize };
}
