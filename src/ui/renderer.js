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

  // Size-adaptive geometry: keep the whole cube ~2 world units across for any N,
  // so 2x2 and 3x3 fill the viewer the same. For N=2 this reproduces the earlier
  // constants exactly (CELL=1, CUBIE=0.94, cubie centers at +/-0.5).
  const CELL = 2 / cubiesPerEdge; // per-cubie footprint in world units
  const CUBIE = CELL * 0.94; // body size, leaving a small gap between cubies

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
  // Bumped by every setGeom. A turn still animating when a new cube is shown sees
  // the change and stops, so it can never paint the previous cube back over it.
  let geomEpoch = 0;

  // Geometry coords are symmetric about 0: 2x2 in {-1,1}, 3x3 in {-1,0,1}.
  // Adjacent coords differ by 2/(N-1); scale so adjacent cubie centers sit CELL
  // apart, which keeps the overall cube the same size for any N.
  function toScene(p) {
    return (p * CELL * (cubiesPerEdge - 1)) / 2;
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
    geomEpoch++;
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

  // ---- next-turn cue -----------------------------------------------------------
  // While the user turns their real cube, show the move on this one: the slab
  // that turns is outlined, and a bold arrow circles it the way it turns (in the
  // same rotation sense animateMove uses, so picture and animation agree). It
  // rings the layer rather than sitting on a face, so it reads from any angle,
  // and lives in the draggable group so it turns with the cube.
  const cueGroup = new THREE.Group();
  spin.add(cueGroup);
  const cueInk = new THREE.MeshBasicMaterial({ color: 0xf4f6f8 });
  const cueLine = new THREE.LineBasicMaterial({ color: 0xf4f6f8, transparent: true, opacity: 0.85 });
  let cueInfo = null;
  function clearCue() {
    for (const child of [...cueGroup.children]) {
      cueGroup.remove(child);
      child.traverse((o) => o.geometry && o.geometry.dispose());
    }
    cueInfo = null;
  }
  // turn: { axis: 0|1|2, sign: ±1, quarters } as from a size module's moveToTurn,
  // or null to clear.
  function showTurn(turn) {
    clearCue();
    if (!turn) return;
    const half = (CELL * cubiesPerEdge) / 2; // the cube spans ±half on every axis
    const slabMid = turn.sign * (half - CELL / 2);
    // Outline the slab that turns.
    const size = [2 * half + 0.08, 2 * half + 0.08, 2 * half + 0.08];
    size[turn.axis] = CELL + 0.08;
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2])),
      cueLine
    );
    box.position.setComponent(turn.axis, slabMid);
    cueGroup.add(box);
    // An arc around the axis through the slab's middle. (u, v) span the plane
    // with u × v = +axis, so increasing angle IS positive rotation about +axis.
    const u = AXIS_VEC[(turn.axis + 1) % 3];
    const v = AXIS_VEC[(turn.axis + 2) % 3];
    const dir = Math.sign(turn.quarters) || 1;
    const sweep = (Math.abs(turn.quarters) >= 2 ? 300 : 200) * (Math.PI / 180);
    const r = half * 1.62;
    const a0 = Math.PI * 0.15;
    const at = (t) => {
      const a = a0 + dir * sweep * t;
      return u.clone().multiplyScalar(r * Math.cos(a)).add(v.clone().multiplyScalar(r * Math.sin(a)))
        .add(AXIS_VEC[turn.axis].clone().multiplyScalar(slabMid));
    };
    const pts = [];
    for (let i = 0; i <= 64; i++) pts.push(at((i / 64) * 0.92));
    cueGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.045, 10), cueInk));
    // Arrowhead: a cone at the end, pointing along the direction of travel.
    const tip = at(1);
    const back = at(0.92);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.13, tip.distanceTo(back) * 1.25, 16), cueInk);
    head.position.copy(back.clone().add(tip).multiplyScalar(0.5));
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(back).normalize());
    cueGroup.add(head);
    cueInfo = { axis: turn.axis, sign: turn.sign, quarters: turn.quarters };
  }

  // Animate a face turn, then snap to `geomAfter`. Returns a promise.
  function animateMove(turn, geomAfter, durationMs) {
    clearCue(); // the animation is the cue now
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
      const epoch = geomEpoch;

      function frame(now) {
        if (epoch !== geomEpoch) {
          resolve(); // superseded: a different cube is on screen now
          return;
        }
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

  return {
    setGeom,
    animateMove,
    showTurn,
    turnShown: () => cueInfo,
    resize,
    dispose,
    get reducedMotion() {
      return reducedMotion;
    },
  };
}
