// renderer.js — Three.js N x N x N cube renderer.
//
// Size-agnostic: built from `cubiesPerEdge`, not hard-coded to 8 cubies. It is
// driven by geometry frames (each cubie = { pos, stickers:[{normal,color}] }) so
// it stays exactly consistent with the solver. A face turn is animated by
// rotating the affected layer 90 degrees, then snapping to the next frame — the
// snap is invisible because a real quarter turn maps one frame onto the next.

import * as THREE from '../../vendor/three.module.js';

const AXIS_VEC = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

export function createRenderer(container, opts) {
  const cubiesPerEdge = opts.cubiesPerEdge || 2;
  const colorHex = opts.colorHex;
  const reducedMotion = !!opts.reducedMotion;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(3.6, 3.2, 4.8);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(5, 8, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-6, -3, -4);
  scene.add(fill);

  // The cube lives in a group the user can spin; a nested group holds the cubies.
  const spin = new THREE.Group();
  scene.add(spin);
  const cubeGroup = new THREE.Group();
  spin.add(cubeGroup);
  spin.rotation.set(-0.15, -0.5, 0);

  const SPACING = 1.0;
  const CUBIE = 0.94;
  const offset = (cubiesPerEdge - 1) / 2; // center the cube on origin

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x0b0d11,
    roughness: 0.55,
    metalness: 0.05,
  });

  const stickerMatCache = {};
  function stickerMat(letter) {
    if (!stickerMatCache[letter]) {
      stickerMatCache[letter] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex[letter]),
        roughness: 0.4,
        metalness: 0.0,
        emissive: new THREE.Color(colorHex[letter]),
        emissiveIntensity: 0.12,
      });
    }
    return stickerMatCache[letter];
  }

  let cubies = []; // { mesh, pos:[x,y,z] } in cube coordinates (integers, centered)

  // Convert a geometry cubie position (values like -1..1 in steps of 2 for 2x2)
  // to a scene coordinate. geom positions for 2x2 are +/-1; generalize by index.
  function toScene(p) {
    return p * (SPACING / 2) * (cubiesPerEdge === 2 ? 1 : 1);
  }

  function disposeCubies() {
    for (const c of cubies) {
      cubeGroup.remove(c.mesh);
      c.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    cubies = [];
  }

  // Build the cube from a geometry frame.
  function setGeom(geom) {
    disposeCubies();
    // reset any layer pivot leftovers
    while (cubeGroup.children.length) cubeGroup.remove(cubeGroup.children[0]);

    for (const cubie of geom) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(CUBIE, CUBIE, CUBIE), bodyMat);
      g.add(body);
      for (const s of cubie.stickers) {
        const tile = new THREE.Mesh(new THREE.PlaneGeometry(CUBIE * 0.82, CUBIE * 0.82), stickerMat(s.color));
        const n = s.normal;
        // lift the sticker just off the cubie surface to avoid z-fighting
        const d = CUBIE * 0.5 + 0.008;
        tile.position.set(n[0] * d, n[1] * d, n[2] * d);
        // orient plane to face outward along the normal
        tile.lookAt(tile.position.clone().multiplyScalar(2));
        g.add(tile);
      }
      g.position.set(toScene(cubie.pos[0]), toScene(cubie.pos[1]), toScene(cubie.pos[2]));
      cubeGroup.add(g);
      cubies.push({ mesh: g, pos: [...cubie.pos] });
    }
  }

  // Animate a face turn, then snap to `geomAfter`. Returns a promise.
  function animateMove(turn, geomAfter, durationMs) {
    return new Promise((resolve) => {
      if (reducedMotion || durationMs <= 0) {
        setGeom(geomAfter);
        resolve();
        return;
      }
      const pivot = new THREE.Group();
      cubeGroup.add(pivot);
      const layer = cubies.filter((c) => c.pos[turn.axis] === turn.sign);
      for (const c of layer) pivot.attach(c.mesh);

      const axisVec = AXIS_VEC[turn.axis];
      const target = turn.quarters * (Math.PI / 2);
      const start = performance.now();

      function frame(now) {
        const t = Math.min(1, (now - start) / durationMs);
        // easeInOutCubic
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        pivot.setRotationFromAxisAngle(axisVec, target * e);
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          setGeom(geomAfter); // rebuild; disposes pivot children
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  // ---- render loop + resize ----
  let running = true;
  function render() {
    if (!running) return;
    renderer.render(scene, camera);
    requestAnimationFrame(render);
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
  resize();
  render();

  // ---- drag to rotate ----
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  function onDown(e) {
    dragging = true;
    const p = pointer(e);
    lastX = p.x;
    lastY = p.y;
  }
  function onMove(e) {
    if (!dragging) return;
    const p = pointer(e);
    const dx = p.x - lastX;
    const dy = p.y - lastY;
    lastX = p.x;
    lastY = p.y;
    spin.rotation.y += dx * 0.01;
    spin.rotation.x += dy * 0.01;
    spin.rotation.x = Math.max(-1.3, Math.min(1.3, spin.rotation.x));
  }
  function onUp() {
    dragging = false;
  }
  function pointer(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }
  renderer.domElement.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  function dispose() {
    running = false;
    ro.disconnect();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  return { setGeom, animateMove, resize, dispose, get reducedMotion() { return reducedMotion; } };
}
