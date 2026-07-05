// guide.js — a small animated 3D cube for the scan step. It rotates to present
// the current target face toward the camera, so the motion itself shows the user
// how to hold and turn their cube. Size-agnostic (built from geometry), and it
// honors prefers-reduced-motion by snapping instead of animating.

import * as THREE from '../../vendor/three.module.js';
import { FACES } from '../core/geometry.js';
import { SOLVED, geomFromState } from '../core/cube2.js';

export function createGuide(container, opts) {
  const colorHex = opts.colorHex;
  const reducedMotion = !!opts.reducedMotion;
  const cubie = 0.94;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 4.4);
  camera.lookAt(0, 0, 0);

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

  const group = new THREE.Group();
  scene.add(group);

  // Build a solved cube once.
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
    group.add(g);
  }

  // A gentle tilt so the presented face reads as 3D (top + right peek in).
  const TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.34, -0.5, 0));

  // Orientation that brings a face's outward normal toward the camera (+z),
  // then applies the tilt.
  function faceQuaternion(face) {
    const { axis, sign } = FACES[face];
    const n = new THREE.Vector3();
    n.setComponent(axis, sign);
    const align = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, 1));
    return TILT.clone().multiply(align);
  }

  // The demonstration turns the cube from a pose rotated away toward the face-on
  // pose, so the motion reads as "rotate your cube like this." It then holds, and
  // repeats — a slow, looping teach.
  const START_OFFSET = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18, 0.95, 0));
  const TRAVEL_MS = 1700; // slow, legible turn
  const HOLD_MS = 1100; // pause on the face before repeating
  const CYCLE_MS = TRAVEL_MS + HOLD_MS;

  let toQ = faceQuaternion('U');
  let fromQ = START_OFFSET.clone().multiply(toQ);
  let cycleStart = null; // set on the first animated frame after a face change
  group.quaternion.copy(fromQ);

  function showFace(face) {
    toQ = faceQuaternion(face);
    fromQ = START_OFFSET.clone().multiply(toQ);
    cycleStart = null; // restart the demonstration for the new face
    if (reducedMotion) group.quaternion.copy(toQ);
  }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  let running = false;
  let raf = 0;
  function loop(now) {
    if (!running) return;
    if (reducedMotion) {
      group.quaternion.copy(toQ);
    } else {
      if (cycleStart == null) cycleStart = now;
      const t = (now - cycleStart) % CYCLE_MS;
      if (t < TRAVEL_MS) {
        group.quaternion.copy(fromQ).slerp(toQ, easeInOut(t / TRAVEL_MS));
      } else {
        group.quaternion.copy(toQ);
      }
    }
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

  return { showFace, start, stop, resize };
}
