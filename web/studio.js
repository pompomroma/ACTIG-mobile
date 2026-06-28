/* ACTIG 3D studio (web) — Three.js loaded from CDN. Iron-Man-style space:
   spawn shapes, drag with finger/mouse, pinch/scroll to scale, clone, delete,
   and optional camera hand-gesture control (MediaPipe). Loaded lazily by app.js. */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

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
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 5, 4); scene.add(key);
  const grid = new THREE.GridHelper(20, 20, 0x1d6f9c, 0x123); grid.position.y = -2; scene.add(grid);

  const objects = [];
  let selected = null;

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

  function spawn(kind) {
    const m = new THREE.Mesh(geom(kind), mat());
    m.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, 0);
    m.userData.kind = kind;
    scene.add(m); objects.push(m); select(m);
    return m;
  }
  function select(m) {
    if (selected) selected.material.emissive.setHex(0x0a3550);
    selected = m;
    if (m) m.material.emissive.setHex(0x2da0ff);
  }
  function clone() {
    if (!selected) return;
    const m = new THREE.Mesh(selected.geometry.clone(), selected.material.clone());
    m.position.copy(selected.position).add(new THREE.Vector3(1.4, 0, 0));
    m.userData.kind = selected.userData.kind;
    scene.add(m); objects.push(m); select(m);
  }
  function remove() {
    if (!selected) return;
    scene.remove(selected); objects.splice(objects.indexOf(selected), 1);
    selected = null;
  }

  /* ---- touch / mouse: drag to move, pinch / wheel to scale ---- */
  const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
  let dragging = false; const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();

  function toNdc(x, y) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }
  function pick() {
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(objects, false);
    return hits[0]?.object || null;
  }
  renderer.domElement.addEventListener("pointerdown", (e) => {
    toNdc(e.clientX, e.clientY); const o = pick();
    if (o) { select(o); dragging = true; renderer.domElement.setPointerCapture(e.pointerId); }
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (!dragging || !selected) return;
    toNdc(e.clientX, e.clientY); ray.setFromCamera(ptr, camera);
    plane.constant = -selected.position.z;
    if (ray.ray.intersectPlane(plane, hit)) { selected.position.x = hit.x; selected.position.y = hit.y; }
  });
  const endDrag = () => { dragging = false; };
  renderer.domElement.addEventListener("pointerup", endDrag);
  renderer.domElement.addEventListener("pointercancel", endDrag);
  renderer.domElement.addEventListener("wheel", (e) => {
    if (!selected) return; e.preventDefault();
    const s = Math.max(0.2, Math.min(6, selected.scale.x * (e.deltaY < 0 ? 1.08 : 0.93)));
    selected.scale.setScalar(s);
  }, { passive: false });
  // two-finger pinch scale
  let pinch0 = 0;
  renderer.domElement.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && selected) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.hypot(dx, dy);
      if (pinch0) {
        const s = Math.max(0.2, Math.min(6, selected.scale.x * (d / pinch0)));
        selected.scale.setScalar(s);
      }
      pinch0 = d;
    }
  }, { passive: true });
  renderer.domElement.addEventListener("touchend", () => { pinch0 = 0; });

  /* ---- optional camera hand gestures (MediaPipe, lazy) ---- */
  let gesturesOn = false, handLandmarker = null, video = null, rafId = 0;
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
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" },
      numHands: 1, runningMode: "VIDEO",
    });
    video = document.createElement("video"); video.playsInline = true; video.muted = true;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    video.srcObject = stream; await video.play();
    const loop = () => {
      if (!gesturesOn) return;
      const res = handLandmarker.detectForVideo(video, performance.now());
      const lm = res.landmarks?.[0];
      if (lm && selected) {
        const thumb = lm[4], index = lm[8];
        const pinch = Math.hypot(thumb.x - index.x, thumb.y - index.y) < 0.06;
        if (pinch) { // map normalized coords to world-ish plane
          selected.position.x = (0.5 - index.x) * 8;
          selected.position.y = (0.5 - index.y) * 6;
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    loop();
  }
  function stopHands() {
    cancelAnimationFrame(rafId);
    video?.srcObject?.getTracks().forEach(t => t.stop());
    handLandmarker = null; video = null;
  }

  window.addEventListener("resize", () => {
    camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
  });

  (function animate() { requestAnimationFrame(animate); objects.forEach(o => o.rotation.y += 0.002); renderer.render(scene, camera); })();

  spawn("box");
  return { spawn, clone, remove, toggleGestures };
}
