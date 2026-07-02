/* ACTIG 3D studio (web) — Three.js (via import map) Iron-Man-style space:
   spawn shapes, drag to move, pinch/wheel to scale, per-axis STRETCH (strain),
   ATTACH objects into a group then MERGE into one mesh, EXPORT the project to GLB,
   and camera hand control (MediaPipe) that can SELECT, drag, and strain objects. */

import * as THREE from "three";

export async function createStudio(host) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080c);

  const camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 100);
  camera.position.set(0, 0, 6);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x88ccff, 0.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.4); keyLight.position.set(3, 5, 4); scene.add(keyLight);
  const grid = new THREE.GridHelper(20, 20, 0x1d6f9c, 0x123); grid.position.y = -2; scene.add(grid);

  const objects = [];              // top-level entities (meshes or groups)
  let selected = null;
  let stretchMode = false;
  let attachMode = false;
  const attachSet = new Set();

  const BASE = 0x0a3550, SEL = 0x2da0ff, ATT = 0xff9a3c;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const mat = () => new THREE.MeshStandardMaterial({
    color: 0x45c7ff, emissive: 0x0a3550, metalness: 0.6, roughness: 0.2,
    transparent: true, opacity: 0.9,
  });

  function geom(kind) {
    switch (kind) {
      case "sphere": return new THREE.SphereGeometry(0.8, 32, 24);
      case "cylinder": return new THREE.CylinderGeometry(0.6, 0.6, 1.4, 32);
      case "cone": return new THREE.ConeGeometry(0.7, 1.4, 32);
      case "torus": return new THREE.TorusGeometry(0.7, 0.28, 16, 48);
      default: return new THREE.BoxGeometry(1.2, 1.2, 1.2);
    }
  }

  /* ---- highlight / selection ---- */
  function setEmissive(entity, hex) {
    entity.traverse(o => { if (o.isMesh && o.material?.emissive) o.material.emissive.setHex(hex); });
  }
  function refreshHighlights() {
    for (const e of objects) setEmissive(e, attachSet.has(e) ? ATT : (e === selected ? SEL : BASE));
  }
  function select(entity) { selected = entity || null; refreshHighlights(); }

  function spawn(kind) {
    const m = new THREE.Mesh(geom(kind), mat());
    m.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, 0);
    m.userData.kind = kind;
    scene.add(m); objects.push(m); select(m);
    return m;
  }
  function clone() {
    if (!selected) return;
    const c = selected.clone(true);
    c.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
    c.position.x += 1.4;
    scene.add(c); objects.push(c); select(c);
  }
  function remove() {
    if (!selected) return;
    scene.remove(selected); objects.splice(objects.indexOf(selected), 1);
    attachSet.delete(selected); selected = null; refreshHighlights();
  }

  /* ---- picking (map a hit child up to its top-level entity) ---- */
  const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); const hit = new THREE.Vector3();
  let dragging = false, startCX = 0, startCY = 0, startScale = new THREE.Vector3();

  function rootOf(obj) { let n = obj; while (n && n.parent && n.parent !== scene) n = n.parent; return objects.includes(n) ? n : null; }
  function pickAt(nx, ny) {
    ptr.set(nx, ny); ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(objects, true);
    return hits[0] ? rootOf(hits[0].object) : null;
  }
  function ndcFromClient(x, y) {
    const r = renderer.domElement.getBoundingClientRect();
    return [((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1];
  }
  function moveEntityToNdc(entity, nx, ny) {
    ptr.set(nx, ny); ray.setFromCamera(ptr, camera);
    plane.constant = -entity.position.z;
    if (ray.ray.intersectPlane(plane, hit)) { entity.position.x = hit.x; entity.position.y = hit.y; }
  }
  function strainSelected(dx, dy, base) {           // dx,dy in NDC-ish units
    if (!selected) return;
    selected.scale.x = clamp(base.x * (1 + dx * 1.6), 0.1, 8);
    selected.scale.y = clamp(base.y * (1 + dy * 1.6), 0.1, 8);
  }

  renderer.domElement.addEventListener("pointerdown", (e) => {
    const [nx, ny] = ndcFromClient(e.clientX, e.clientY);
    const entity = pickAt(nx, ny);
    if (attachMode) {                                // tap toggles attach-selection
      if (entity) { attachSet.has(entity) ? attachSet.delete(entity) : attachSet.add(entity); refreshHighlights(); }
      return;
    }
    if (entity) {
      select(entity); dragging = true;
      startCX = e.clientX; startCY = e.clientY; startScale.copy(entity.scale);
      renderer.domElement.setPointerCapture(e.pointerId);
    }
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (!dragging || !selected) return;
    if (stretchMode) {
      const r = renderer.domElement.getBoundingClientRect();
      strainSelected((e.clientX - startCX) / r.width * 2, -(e.clientY - startCY) / r.height * 2, startScale);
    } else {
      const [nx, ny] = ndcFromClient(e.clientX, e.clientY);
      moveEntityToNdc(selected, nx, ny);
    }
  });
  const endDrag = () => { dragging = false; };
  renderer.domElement.addEventListener("pointerup", endDrag);
  renderer.domElement.addEventListener("pointercancel", endDrag);
  renderer.domElement.addEventListener("wheel", (e) => {
    if (!selected) return; e.preventDefault();
    const f = e.deltaY < 0 ? 1.08 : 0.93;
    if (stretchMode) selected.scale.z = clamp(selected.scale.z * f, 0.1, 8);
    else selected.scale.multiplyScalar(f).clampScalar(0.1, 8);
  }, { passive: false });
  // two-finger pinch: uniform scale (or Z in stretch mode)
  let pinch0 = 0;
  renderer.domElement.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && selected) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinch0) {
        const r = d / pinch0;
        if (stretchMode) selected.scale.z = clamp(selected.scale.z * r, 0.1, 8);
        else selected.scale.multiplyScalar(r).clampScalar(0.1, 8);
      }
      pinch0 = d;
    }
  }, { passive: true });
  renderer.domElement.addEventListener("touchend", () => { pinch0 = 0; });

  /* ---- modes: stretch, attach, merge, export ---- */
  function toggleStretch() { stretchMode = !stretchMode; return stretchMode; }
  function beginAttach() { attachMode = true; attachSet.clear(); refreshHighlights(); return true; }
  function submitAttach() {
    if (!attachMode) return false;
    if (attachSet.size < 2) { attachMode = false; attachSet.clear(); refreshHighlights(); return false; }
    const group = new THREE.Group(); scene.add(group);
    for (const e of attachSet) { group.attach(e); const i = objects.indexOf(e); if (i >= 0) objects.splice(i, 1); }
    objects.push(group); attachMode = false; attachSet.clear(); select(group);
    return true;
  }
  async function mergeSelected() {
    if (!selected) return false;
    const meshes = []; selected.updateMatrixWorld(true);
    selected.traverse(o => { if (o.isMesh) meshes.push(o); });
    if (meshes.length < 1) return false;
    const { mergeGeometries } = await import("three/addons/utils/BufferGeometryUtils.js");
    const geoms = meshes.map(m => { const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); return g.index ? g.toNonIndexed() : g; });
    const merged = mergeGeometries(geoms, false);
    if (!merged) return false;
    merged.computeVertexNormals();
    merged.computeBoundingBox();
    const c = new THREE.Vector3(); merged.boundingBox.getCenter(c);
    merged.translate(-c.x, -c.y, -c.z);                 // center pivot
    const mesh = new THREE.Mesh(merged, mat()); mesh.position.copy(c); mesh.userData.kind = "mesh";
    scene.remove(selected); objects.splice(objects.indexOf(selected), 1);
    scene.add(mesh); objects.push(mesh); select(mesh);
    return true;
  }
  async function exportGLB() {
    const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
    const root = new THREE.Group();
    for (const o of objects) root.add(o.clone(true));
    const glb = await new Promise((res, rej) =>
      new GLTFExporter().parse(root, res, rej, { binary: true }));
    const blob = new Blob([glb], { type: "model/gltf-binary" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "actig-model.glb";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }

  /* ---- camera hand control (MediaPipe) — select, drag, strain ----
     Cognition stack: 1080p60 capture, GPU inference, frame-synced detection,
     tuned confidence thresholds, per-slot identity matching (hands don't swap),
     One-Euro adaptive filtering (steady when slow, no lag when fast), pinch
     measured at the thumb–index midpoint with depth-normalized hysteresis. */
  let gesturesOn = false, handLandmarker = null, video = null, rafId = 0, usingRVFC = false;

  /* One-Euro filter: adaptive low-pass — heavy smoothing at low speed (kills
     jitter), light smoothing at high speed (kills lag). */
  function oneEuro({ minCutoff = 1.4, beta = 0.25, dCutoff = 1.0 } = {}) {
    let xP = null, dxP = 0, tP = 0;
    const alpha = (c, dt) => { const r = 2 * Math.PI * c * dt; return r / (r + 1); };
    const f = (x, t) => {
      if (xP === null) { xP = x; tP = t; return x; }
      const dt = Math.max((t - tP) / 1000, 1e-3); tP = t;
      const dx = (x - xP) / dt;
      dxP += alpha(dCutoff, dt) * (dx - dxP);
      xP += alpha(minCutoff + beta * Math.abs(dxP), dt) * (x - xP);
      return xP;
    };
    f.reset = () => { xP = null; dxP = 0; };
    return f;
  }
  const newHand = () => ({ pinch: false, x: 0, y: 0, wx: 0, wy: 0, seen: false, fx: oneEuro(), fy: oneEuro() });
  const H = [newHand(), newHand()];
  let grab = null, grabStartScale = new THREE.Vector3(), grabStart = { x: 0, y: 0 };
  let two = null;                                   // two-hand strain session

  async function toggleGestures() {
    gesturesOn = !gesturesOn;
    if (gesturesOn) { try { await startHands(); } catch { gesturesOn = false; } }
    else stopHands();
    return gesturesOn;
  }
  async function startHands() {
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",                             // faster than CPU
      },
      numHands: 2, runningMode: "VIDEO",             // two-hand cognition
      minHandDetectionConfidence: 0.4,               // acquire hands fast
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.6,                    // but hold tracks firmly
    });
    video = document.createElement("video"); video.playsInline = true; video.muted = true;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
    });
    video.srcObject = stream; await video.play();
    usingRVFC = typeof video.requestVideoFrameCallback === "function";
    const step = () => {
      if (!gesturesOn || !video) return;
      try { detect(); } catch {}
      if (usingRVFC) video.requestVideoFrameCallback(step);
      else rafId = requestAnimationFrame(step);
    };
    if (usingRVFC) video.requestVideoFrameCallback(step); else rafId = requestAnimationFrame(step);
  }
  function stopHands() {
    if (usingRVFC) usingRVFC = false; else cancelAnimationFrame(rafId);
    video?.srcObject?.getTracks().forEach(t => t.stop());
    handLandmarker = null; video = null; grab = null; two = null;
    H.forEach(h => { h.pinch = false; h.seen = false; h.fx.reset(); h.fy.reset(); });
  }
  /* Assign detected hands to stable slots by wrist proximity, so slot 0 stays the
     SAME physical hand across frames (no identity swaps mid-drag). */
  function assignSlots(lms) {
    if (lms.length < 2) {
      if (!lms.length) return [null, null];
      const w = lms[0][0];
      const d0 = H[0].seen ? Math.hypot(w.x - H[0].wx, w.y - H[0].wy) : (H[1].seen ? 1e9 : 0);
      const d1 = H[1].seen ? Math.hypot(w.x - H[1].wx, w.y - H[1].wy) : 1e9;
      return d0 <= d1 ? [lms[0], null] : [null, lms[0]];
    }
    const a = lms[0][0], b = lms[1][0];
    const straight = (H[0].seen ? Math.hypot(a.x - H[0].wx, a.y - H[0].wy) : 0)
                   + (H[1].seen ? Math.hypot(b.x - H[1].wx, b.y - H[1].wy) : 0);
    const swapped = (H[0].seen ? Math.hypot(b.x - H[0].wx, b.y - H[0].wy) : 0)
                  + (H[1].seen ? Math.hypot(a.x - H[1].wx, a.y - H[1].wy) : 0);
    return straight <= swapped ? [lms[0], lms[1]] : [lms[1], lms[0]];
  }
  function detect() {
    if (!handLandmarker || !video) return;
    const now = performance.now();
    const res = handLandmarker.detectForVideo(video, now);
    const slots = assignSlots(res.landmarks || []);
    for (let i = 0; i < 2; i++) {
      const lm = slots[i];
      const h = H[i];
      if (!lm) { if (h.seen) { h.fx.reset(); h.fy.reset(); } h.seen = false; h.pinch = false; continue; }
      const tip = lm[8], thumb = lm[4], wrist = lm[0], mcp = lm[9];
      h.wx = wrist.x; h.wy = wrist.y;                  // for identity matching next frame
      // pinch point = thumb–index midpoint (steadier than the fingertip alone)
      const px = (tip.x + thumb.x) / 2, py = (tip.y + thumb.y) / 2;
      const nx = 1 - 2 * px, ny = 1 - 2 * py;          // mirror + to NDC
      h.x = h.fx(nx, now); h.y = h.fy(ny, now);        // One-Euro adaptive smoothing
      h.seen = true;
      const span = Math.hypot(wrist.x - mcp.x, wrist.y - mcp.y) || 1e-3;
      const ratio = Math.hypot(thumb.x - tip.x, thumb.y - tip.y) / span;
      h.pinch = h.pinch ? ratio < 1.0 : ratio < 0.7;   // hysteresis
    }
    const p0 = H[0].seen && H[0].pinch, p1 = H[1].seen && H[1].pinch;

    // Two hands pinched → strain the selected object by their spread.
    if (p0 && p1 && selected) {
      grab = null;
      const dx = Math.abs(H[0].x - H[1].x), dy = Math.abs(H[0].y - H[1].y), dist = Math.hypot(dx, dy);
      if (!two) two = { dx: dx || 1e-3, dy: dy || 1e-3, dist: dist || 1e-3, scale: selected.scale.clone() };
      else if (stretchMode) {
        selected.scale.x = clamp(two.scale.x * (dx / two.dx), 0.1, 8);
        selected.scale.y = clamp(two.scale.y * (dy / two.dy), 0.1, 8);
      } else {
        selected.scale.copy(two.scale).multiplyScalar(clamp(dist / two.dist, 0.1, 8)).clampScalar(0.1, 8);
      }
      return;
    }
    two = null;

    // One hand pinched → select+grab, then drag or strain.
    if (p0) {
      if (!grab) {                                     // pinch just started → pick under fingertip
        const entity = pickAt(H[0].x, H[0].y);
        if (entity) { select(entity); grab = entity; grabStartScale.copy(entity.scale); grabStart = { x: H[0].x, y: H[0].y }; }
      } else if (stretchMode) {
        strainSelected(H[0].x - grabStart.x, H[0].y - grabStart.y, grabStartScale);
      } else {
        moveEntityToNdc(grab, H[0].x, H[0].y);
      }
    } else {
      grab = null;
    }
  }

  window.addEventListener("resize", () => {
    camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
  });

  (function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); })();

  spawn("box");
  return { spawn, clone, remove, toggleGestures, toggleStretch, beginAttach, submitAttach, mergeSelected, exportGLB };
}
