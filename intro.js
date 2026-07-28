/* ===========================================================
   intro.js
   UI1 — the highlight-reel landing screen: a ~9.5s cinematic of
   four signature shots (kill, dive, nick, lob) that ends in a
   title slam landing on the menu buttons (Singleplayer,
   Multiplayer, Shop, Account). Ported from the intro reference
   file; DOM ids are namespaced under #introScreen to avoid
   colliding with the other screens' own canvases.

   Consumed by main.js via:
     initIntro({ onSingleplayer, onMultiplayer, onShop, onAccount });
     pauseIntro();  // stop rendering when navigating away
     resumeIntro(); // resume if the user comes back
=========================================================== */

const HALF_W = 3.2, LEN = 9.75;
const FRONT_H = 4.57, TIN_H = 0.48, BACK_H = 2.13;
const shortLineZ = 4.26;

let scene, camera, renderer;
let rafId = null;
let active = false;
let initialized = false;

function createToonRamp() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 1;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#444444'; ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = '#888888'; ctx.fillRect(1, 0, 1, 1);
  ctx.fillStyle = '#cccccc'; ctx.fillRect(2, 0, 1, 1);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(3, 0, 1, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
  return tex;
}

function attachOutline(mesh, scaleFactor = 1.08) {
  if (!mesh || !mesh.geometry) return;
  const outline = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
  outline.scale.setScalar(scaleFactor);
  mesh.add(outline);
  return outline;
}

function easeInCubic(t) { return t * t * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function lerp(a, b, u) { return a + (b - a) * u; }
function lerpV(a, b, u) { return a.clone().lerp(b, u); }
function quadBezier(p0, p1, p2, u) { return p0.clone().lerp(p1, u).lerp(p1.clone().lerp(p2, u), u); }

export function initIntro(callbacks = {}) {
  const { onSingleplayer, onMultiplayer, onShop, onAccount } = callbacks;

  const canvasHolder = document.getElementById('introCanvasHolder');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06070a);
  scene.fog = new THREE.FogExp2(0x06070a, 0.03);

  camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.03, 60);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasHolder.appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const toonRamp = createToonRamp();

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.3);
  mainLight.position.set(4, 8, 5);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.set(1024, 1024);
  scene.add(mainLight);
  const rimGlow = new THREE.PointLight(0xc8ff3d, 0.35, 25);
  rimGlow.position.set(0, 4.0, 5.0);
  scene.add(rimGlow);

  /* ---------------- COURT ---------------- */
  const courtGroup = new THREE.Group();
  scene.add(courtGroup);

  function generateAnimeWoodTexture() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 1024;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#dca868'; ctx.fillRect(0, 0, 512, 1024);
    ctx.strokeStyle = '#00000022'; ctx.lineWidth = 2;
    for (let i = 0; i <= 16; i++) { ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 1024); ctx.stroke(); }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  const floorMat = new THREE.MeshToonMaterial({ map: generateAnimeWoodTexture(), gradientMap: toonRamp });
  const wallMat = new THREE.MeshToonMaterial({ color: 0xf5f3ea, gradientMap: toonRamp, side: THREE.DoubleSide });
  const tinMat = new THREE.MeshToonMaterial({ color: 0x3d0c0c, gradientMap: toonRamp });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, LEN), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, LEN / 2); floor.receiveShadow = true;
  courtGroup.add(floor);

  function drawLine(x1, z1, x2, z2, w = 0.06) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(x2 - x1, z2 - z1), 0.005, w), new THREE.MeshBasicMaterial({ color: 0xee2c2c }));
    mesh.position.set((x1 + x2) / 2, 0.003, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    attachOutline(mesh, 1.15);
    courtGroup.add(mesh);
  }
  drawLine(-HALF_W, shortLineZ, HALF_W, shortLineZ);
  drawLine(0, shortLineZ, 0, LEN);
  drawLine(-HALF_W + 1.6, shortLineZ, -HALF_W + 1.6, shortLineZ + 1.6);
  drawLine(-HALF_W + 1.6, shortLineZ + 1.6, -HALF_W, shortLineZ + 1.6);
  drawLine(HALF_W - 1.6, shortLineZ, HALF_W - 1.6, shortLineZ + 1.6);
  drawLine(HALF_W - 1.6, shortLineZ + 1.6, HALF_W, shortLineZ + 1.6);

  const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, FRONT_H - TIN_H), wallMat);
  frontWall.position.set(0, TIN_H + (FRONT_H - TIN_H) / 2, 0);
  courtGroup.add(frontWall);

  const tin = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, TIN_H, 0.04), tinMat);
  tin.position.set(0, TIN_H / 2, -0.02);
  attachOutline(tin, 1.04);
  courtGroup.add(tin);

  const SERVICE_LINE_H = 1.78;
  function drawFrontWallLine(height, thick = 0.04) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, thick, 0.01), new THREE.MeshBasicMaterial({ color: 0xee2c2c }));
    line.position.set(0, height, 0.01);
    attachOutline(line, 1.1);
    courtGroup.add(line);
  }
  drawFrontWallLine(SERVICE_LINE_H, 0.03);
  drawFrontWallLine(FRONT_H, 0.05);

  [-1, 1].forEach(side => {
    const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(LEN, FRONT_H), wallMat);
    sideWall.position.set(side * HALF_W, FRONT_H / 2, LEN / 2);
    sideWall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    courtGroup.add(sideWall);

    const slopeLineGeo = new THREE.BufferGeometry();
    const vertices = new Float32Array([side * HALF_W, FRONT_H, 0, side * HALF_W, BACK_H, LEN]);
    slopeLineGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const slopeLine = new THREE.Line(slopeLineGeo, new THREE.LineBasicMaterial({ color: 0xee2c2c, linewidth: 3 }));
    scene.add(slopeLine);
  });

  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.92, opacity: 1, transparent: true, roughness: 0.06, side: THREE.DoubleSide });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, BACK_H + 2.6), glassMat);
  backWall.position.set(0, (BACK_H + 2.6) / 2, LEN);
  courtGroup.add(backWall);

  /* ---------------- ANIME PLAYER AVATARS ---------------- */
  function buildAnimeAvatar(skinColor, jerseyColor, racquetColor) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.1, 16), new THREE.MeshToonMaterial({ color: jerseyColor, gradientMap: toonRamp }));
    body.position.y = 0.75; body.castShadow = true; attachOutline(body, 1.08); group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), new THREE.MeshToonMaterial({ color: skinColor, gradientMap: toonRamp }));
    head.position.y = 1.4; head.castShadow = true; attachOutline(head, 1.08); group.add(head);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 12, 1, false, -1.2, 2.4), new THREE.MeshBasicMaterial({ color: racquetColor }));
    visor.position.set(0, 1.41, 0.05); visor.rotation.x = Math.PI / 2; attachOutline(visor, 1.1); group.add(visor);
    const racketPivot = new THREE.Group(); racketPivot.position.set(0, 0.95, 0);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 8), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    handle.position.set(0.38, 0, 0.05); handle.rotation.z = Math.PI / 2.3; attachOutline(handle, 1.2); racketPivot.add(handle);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.016, 10, 24), new THREE.MeshToonMaterial({ color: racquetColor, gradientMap: toonRamp }));
    rim.position.set(0.66, 0, 0.05); rim.rotation.z = Math.PI / 2.3; attachOutline(rim, 1.18); racketPivot.add(rim);
    group.add(racketPivot);
    return group;
  }

  const playerA = buildAnimeAvatar(0xe7c9a3, 0x192e47, 0x3ba3ff);
  const playerB = buildAnimeAvatar(0xe7c9a3, 0x5a1414, 0xff3b30);
  const playerC = buildAnimeAvatar(0xe7c9a3, 0x4a3a10, 0xffb83b);
  scene.add(playerA, playerB, playerC);

  /* ---------------- BALL + TRAIL ---------------- */
  const BALL_R = 0.045;
  const ballMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, emissive: 0x0a0a0a, roughness: 0.5, metalness: 0.05 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 16), ballMat);
  ball.castShadow = true;
  scene.add(ball);
  const glowSprite = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 2.2, 12, 12), new THREE.MeshBasicMaterial({ color: 0xc8ff3d, transparent: true, opacity: 0.35, depthWrite: false }));
  ball.add(glowSprite);

  const TRAIL_N = 16;
  const trailDots = [];
  for (let i = 0; i < TRAIL_N; i++) {
    const t = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 0.9, 8, 8), new THREE.MeshBasicMaterial({ color: 0xc8ff3d, transparent: true, opacity: 0 }));
    scene.add(t);
    trailDots.push({ mesh: t });
  }
  let trailHistory = [];

  /* ---------------- PARTICLE BURST ---------------- */
  const burstGroup = new THREE.Group();
  scene.add(burstGroup);
  function spawnBurst(pos, color, count) {
    for (let i = 0; i < (count || 14); i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
      p.position.copy(pos);
      const dir = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.6 + 0.1, (Math.random() - 0.5)).normalize().multiplyScalar(1.0 + Math.random() * 1.6);
      p.userData = { vel: dir, life: 1.0 };
      burstGroup.add(p);
    }
  }
  function updateBursts(dt) {
    for (let i = burstGroup.children.length - 1; i >= 0; i--) {
      const p = burstGroup.children[i];
      p.userData.life -= dt * 1.6;
      if (p.userData.life <= 0) { burstGroup.remove(p); p.geometry.dispose(); p.material.dispose(); continue; }
      p.position.addScaledVector(p.userData.vel, dt);
      p.userData.vel.y -= dt * 2.2;
      p.material.opacity = Math.max(0, p.userData.life);
    }
  }

  /* ---------------- FX HELPERS ---------------- */
  const flashEl = document.getElementById('introFlashOverlay');
  const mangaEl = document.getElementById('introMangaImpact');
  const mangaTextEl = document.getElementById('introMangaText');
  const speedLinesEl = document.getElementById('introSpeedLines');
  let flashOpacity = 0;
  let mangaTimer = 0;

  function triggerImpact(pos, color, text, count) {
    spawnBurst(pos, color, count);
    flashOpacity = 0.22;
    if (text) {
      mangaTextEl.textContent = text;
      mangaEl.classList.add('active');
      mangaTimer = 0.16;
    }
  }
  function cutFlash() { flashOpacity = 0.32; }

  /* ---------------- FOUR SIGNATURE-SHOT VIGNETTES ---------------- */
  const V = [];

  { // 1. Kill shot
    const start = 0.00, duration = 1.55, flightFrac = 0.68;
    const p0 = new THREE.Vector3(1.35, 2.7, 4.3), p1 = new THREE.Vector3(0.75, 3.0, 2.0), p2 = new THREE.Vector3(0.3, 0.42, 0.05);
    const camBase = new THREE.Vector3(0.55, 0.32, 1.7), camEnd = new THREE.Vector3(0.45, 0.3, 1.35);
    const look = new THREE.Vector3(0.25, 0.45, 0.15);
    V.push({
      start, end: start + duration, duration, flightFrac,
      setup() { playerA.position.set(1.1, 0, 3.0); playerA.rotation.set(0, 0.15, 0); playerB.visible = false; playerC.visible = false; playerA.visible = true; },
      ballPos(uf) { return quadBezier(p0, p1, p2, easeInCubic(uf)); },
      cam(u) { return { pos: lerpV(camBase, camEnd, u), look, fov: 36 }; },
      impactPoint: p2, impactColor: 0x3ba3ff, mangaText: 'KILL SHOT!'
    });
  }
  { // 2. Desperation dive
    const start = V[0].end, duration = 1.60, flightFrac = 0.70;
    const p0 = new THREE.Vector3(-0.4, 1.0, 5.0), p2 = new THREE.Vector3(-2.55, 0.35, 5.12);
    const p1 = new THREE.Vector3(-1.4, 1.3, 5.05);
    const camA = new THREE.Vector3(-3.2, 1.1, 6.3), camB = new THREE.Vector3(-1.3, 1.0, 4.9);
    const standPos = new THREE.Vector3(-1.9, 0, 5.4), divePos = new THREE.Vector3(-2.6, 0.18, 5.05);
    V.push({
      start, end: start + duration, duration, flightFrac,
      setup() { playerA.visible = false; playerC.visible = false; playerB.visible = true; playerB.position.copy(standPos); playerB.rotation.set(0, 0.6, 0); },
      ballPos(uf) { return quadBezier(p0, p1, p2, easeOutCubic(uf)); },
      cam(u) { return { pos: lerpV(camA, camB, u), look: playerB.position.clone().add(new THREE.Vector3(0, 0.35, 0)), fov: 40 }; },
      updatePlayers(uf) {
        playerB.position.lerpVectors(standPos, divePos, uf);
        playerB.rotation.z = lerp(0, -1.15, uf);
        playerB.rotation.x = lerp(0, 0.3, uf);
      },
      impactPoint: p2, impactColor: 0xff3b30, mangaText: 'GET IT!!'
    });
  }
  { // 3. Pinpoint nick
    const start = V[1].end, duration = 1.50, flightFrac = 0.72;
    const p0 = new THREE.Vector3(0.6, 1.6, 4.6), p1 = new THREE.Vector3(2.0, 2.2, 3.4), p2 = new THREE.Vector3(HALF_W - 0.05, 0.08, 2.0);
    const camA = new THREE.Vector3(2.6, 3.3, 2.3), camB = new THREE.Vector3(2.3, 3.0, 2.1);
    const look = p2.clone();
    V.push({
      start, end: start + duration, duration, flightFrac,
      setup() { playerA.visible = false; playerB.visible = false; playerC.visible = true; playerC.position.set(2.0, 0, 4.2); playerC.rotation.set(0, -0.6, 0); },
      ballPos(uf) { return quadBezier(p0, p1, p2, easeInOutQuad(uf)); },
      cam(u) { return { pos: lerpV(camA, camB, u), look, fov: 38 }; },
      impactPoint: p2, impactColor: 0xffb83b, mangaText: 'DEAD NICK!'
    });
  }
  { // 4. Soaring lob
    const start = V[2].end, duration = 1.70, flightFrac = 0.75;
    const p0 = new THREE.Vector3(0.5, 1.0, 3.0), p1 = new THREE.Vector3(0.1, 4.0, 6.0), p2 = new THREE.Vector3(0, 3.15, 9.4);
    const camPos0 = new THREE.Vector3(0.5, 0.5, 4.3), camPos1 = new THREE.Vector3(0.4, 0.55, 4.6);
    V.push({
      start, end: start + duration, duration, flightFrac,
      setup() { playerA.visible = false; playerB.visible = false; playerC.visible = true; playerC.position.set(0.6, 0, 3.0); playerC.rotation.set(0, 0.3, 0); },
      ballPos(uf) { return quadBezier(p0, p1, p2, easeOutCubic(uf)); },
      cam(u) { return { pos: lerpV(camPos0, camPos1, u), look: this._ballPosCache || p0, fov: lerp(40, 35, u) }; },
      impactPoint: p2, impactColor: 0xc8ff3d, mangaText: 'SKY HIGH!'
    });
  }

  const lastVignetteEnd = V[V.length - 1].end;
  const TITLE_START = lastVignetteEnd;
  const TITLE_HOLD_END = TITLE_START + 1.40;
  const BUTTONS_AT = TITLE_HOLD_END;
  const TOTAL = BUTTONS_AT + 1.75;
  const heroCamPos = new THREE.Vector3(0, 1.95, 9.6);
  const heroLook = new THREE.Vector3(0, 1.55, 0.3);

  /* ---------------- TITLE / UI STATE ---------------- */
  let buttonsShown = false;
  let titleShown = false;
  const introUI = document.getElementById('introUI');
  const cinematicBars = document.getElementById('introCinematicBars');
  const replayBtn = document.getElementById('introReplayBtn');
  const mainTitleEl = document.getElementById('introMainTitle');

  function maybeShowTitle(t) {
    if (!titleShown && t >= TITLE_START) {
      titleShown = true;
      cutFlash();
      mainTitleEl.classList.add('slam');
    }
  }
  function maybeShowButtons(t) {
    if (!buttonsShown && t >= BUTTONS_AT) {
      buttonsShown = true;
      cinematicBars.classList.add('hide-bars');
      introUI.classList.add('show');
      setTimeout(() => replayBtn.classList.add('show'), 400);
    }
  }

  /* ---------------- RESET / REPLAY ---------------- */
  let elapsed = 0;
  let lastFrameTime = performance.now();
  let activeVignetteIdx = -1;

  function resetIntro() {
    elapsed = 0;
    activeVignetteIdx = -1;
    V.forEach(v => { v._fired = false; v._setupDone = false; });
    buttonsShown = false; titleShown = false;
    introUI.classList.remove('show');
    cinematicBars.classList.remove('hide-bars');
    replayBtn.classList.remove('show');
    mangaEl.classList.remove('active');
    speedLinesEl.classList.remove('active');
    mainTitleEl.classList.remove('slam');
    flashOpacity = 0;
    lastFrameTime = performance.now();
    resumeIntro();
  }
  replayBtn.addEventListener('click', resetIntro);

  document.getElementById('introSingleplayerBtn').addEventListener('click', () => { pauseIntro(); onSingleplayer?.(); });
  document.getElementById('introMultiplayerBtn').addEventListener('click', () => { onMultiplayer?.(); });
  document.getElementById('introShopBtn').addEventListener('click', () => { onShop?.(); });
  document.getElementById('introAccountBtn').addEventListener('click', () => { onAccount?.(); });

  /* ---------------- MAIN LOOP ---------------- */
  function updateVignette(v, t) {
    const local = t - v.start;
    const u = Math.min(1, local / v.duration);
    const uFlight = Math.min(1, u / v.flightFrac);

    if (v.setup && !v._setupDone) { v.setup(); v._setupDone = true; }
    if (v.updatePlayers) v.updatePlayers(uFlight);

    const pos = v.ballPos(uFlight);
    ball.position.copy(pos);
    ball.visible = true;
    v._ballPosCache = pos;

    trailHistory.unshift(pos.clone());
    if (trailHistory.length > TRAIL_N) trailHistory.pop();
    trailDots.forEach((d, i) => {
      const hp = trailHistory[i];
      if (hp) { d.mesh.position.copy(hp); d.mesh.material.opacity = Math.max(0, 0.5 - i * 0.03); d.mesh.visible = true; }
      else d.mesh.visible = false;
    });

    const cam = v.cam(u);
    camera.position.copy(cam.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.look);
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();

    if (uFlight >= 1 && !v._fired) {
      v._fired = true;
      triggerImpact(v.impactPoint, v.impactColor, v.mangaText, v.mangaText === 'GET IT!!' ? 20 : 14);
    }
  }

  function animate() {
    rafId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    elapsed += dt;
    const t = Math.min(elapsed, TOTAL);

    if (t < lastVignetteEnd) {
      let idx = 0;
      for (let i = 0; i < V.length; i++) { if (t < V[i].end || i === V.length - 1) { idx = i; break; } }
      if (idx !== activeVignetteIdx) {
        activeVignetteIdx = idx;
        cutFlash();
        speedLinesEl.classList.add('active');
        setTimeout(() => speedLinesEl.classList.remove('active'), 140);
      }
      updateVignette(V[idx], t);
    } else {
      trailDots.forEach(d => d.mesh.visible = false);
      ball.visible = false;
      camera.position.copy(heroCamPos);
      camera.up.set(0, 1, 0);
      camera.lookAt(heroLook);
      camera.fov += (34 - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
      maybeShowTitle(t);
    }

    updateBursts(dt);
    maybeShowButtons(t);

    if (mangaTimer > 0) {
      mangaTimer -= dt;
      if (mangaTimer <= 0) mangaEl.classList.remove('active');
    }
    flashOpacity = Math.max(0, flashOpacity - dt * 2.2);
    flashEl.style.opacity = flashOpacity;

    renderer.render(scene, camera);
  }

  _animateRef = animate;
  initialized = true;
  resumeIntro();
}

let _animateRef = null;

export function pauseIntro() {
  active = false;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

export function resumeIntro() {
  if (!initialized || active || !_animateRef) return;
  active = true;
  // animate() clamps its internal frame delta to 0.05s, so a stale
  // lastFrameTime from before the pause is harmless here.
  rafId = requestAnimationFrame(_animateRef);
}
