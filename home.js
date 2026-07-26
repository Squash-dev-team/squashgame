/* ===========================================================
   home.js
   UI2 — the cinematic home menu: a slanted sidebar nav (Enter
   Court / Settings / How to Play / Player Stats) over a looping
   3-actor rally choreography that swaps per hovered tab. Ported
   from the home-UI reference file. DOM ids are namespaced under
   #homeScreen to avoid colliding with the other screens.

   Consumed by main.js via:
     initHome({ onEnterCourt, onSettings, onControls, onStats, onBack });
     pauseHome(); resumeHome();
=========================================================== */

let scene, camera, renderer;
let rafId = null;
let active = false;
let initialized = false;

export function initHome(callbacks = {}) {
  const { onEnterCourt, onSettings, onControls, onStats, onBack } = callbacks;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0f12);
  scene.fog = new THREE.FogExp2(0x0e0f12, 0.035);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('homeCanvasHolder').appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const overheadLight = new THREE.DirectionalLight(0xfff6e0, 0.95);
  overheadLight.position.set(0, 8, 4.87);
  scene.add(overheadLight);
  const ambientGlow = new THREE.PointLight(0xc8ff3d, 0.3, 25);
  ambientGlow.position.set(0, 4.5, 9.75 / 2);
  scene.add(ambientGlow);

  const HALF_W = 3.2, LEN = 9.75, FRONT_H = 4.57, TIN_H = 0.48, BACK_H = 2.13;

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xdec18a, roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, LEN), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, LEN / 2);
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf5f4f0, roughness: 0.6 });
  const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, FRONT_H), wallMat);
  frontWall.position.set(0, FRONT_H / 2, 0);
  scene.add(frontWall);

  const tin = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, TIN_H, 0.04), new THREE.MeshStandardMaterial({ color: 0x3d1212 }));
  tin.position.set(0, TIN_H / 2, 0.02);
  scene.add(tin);

  [-1, 1].forEach(side => {
    const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(LEN, FRONT_H), wallMat);
    sideWall.position.set(side * HALF_W, FRONT_H / 2, LEN / 2);
    sideWall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    scene.add(sideWall);

    const slopeLineGeo = new THREE.BufferGeometry();
    const vertices = new Float32Array([side * HALF_W, FRONT_H, 0, side * HALF_W, BACK_H, LEN]);
    slopeLineGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const slopeLine = new THREE.Line(slopeLineGeo, new THREE.LineBasicMaterial({ color: 0xee2c2c, linewidth: 3 }));
    scene.add(slopeLine);
  });

  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, opacity: 1, transparent: true, side: THREE.DoubleSide });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, BACK_H), glassMat);
  backWall.position.set(0, BACK_H / 2, LEN);
  scene.add(backWall);

  const shortLineZ = 4.26;
  function drawLine(x1, z1, x2, z2, w = 0.05) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 0.005, w), new THREE.MeshBasicMaterial({ color: 0xee2c2c }));
    mesh.position.set((x1 + x2) / 2, 0.003, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    scene.add(mesh);
  }
  drawLine(-HALF_W, shortLineZ, HALF_W, shortLineZ);
  drawLine(0, shortLineZ, 0, LEN);
  drawLine(-HALF_W + 1.6, shortLineZ, -HALF_W + 1.6, shortLineZ + 1.6);
  drawLine(-HALF_W + 1.6, shortLineZ + 1.6, -HALF_W, shortLineZ + 1.6);
  drawLine(HALF_W - 1.6, shortLineZ, HALF_W - 1.6, shortLineZ + 1.6);
  drawLine(HALF_W - 1.6, shortLineZ + 1.6, HALF_W, shortLineZ + 1.6);

  function drawFrontWallLine(height, color = 0xee2c2c, thick = 0.04) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, thick, 0.01), new THREE.MeshBasicMaterial({ color }));
    line.position.set(0, height, 0.005);
    scene.add(line);
  }
  drawFrontWallLine(1.78, 0xee2c2c, 0.03);
  drawFrontWallLine(FRONT_H, 0xee2c2c, 0.05);

  function buildActor(bodyColor, glowColor) {
    const actorGroup = new THREE.Group();
    const fallback = new THREE.Group();

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.05, 16), new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4 }));
    body.position.y = 0.72; fallback.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), new THREE.MeshStandardMaterial({ color: 0xe7c9a3 }));
    head.position.y = 1.35; fallback.add(head);

    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 12, 1, false, -1.2, 2.4), new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor }));
    visor.position.set(0, 1.36, 0.05); visor.rotation.x = Math.PI / 2; fallback.add(visor);

    const racketPivot = new THREE.Group();
    racketPivot.position.set(0, 0.95, 0);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    handle.position.set(0.35, 0, 0.05); handle.rotation.z = Math.PI / 2.3; racketPivot.add(handle);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.016, 10, 24), new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor }));
    rim.position.set(0.62, 0, 0.05); rim.rotation.z = Math.PI / 2.3; racketPivot.add(rim);

    fallback.add(racketPivot);
    actorGroup.add(fallback);

    actorGroup.userData = { fallback, racketPivot, swingT: 0 };
    return actorGroup;
  }

  const p1 = buildActor(0x192e47, 0x3ba3ff);
  const p2 = buildActor(0x471920, 0xff4a40);
  scene.add(p1, p2);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), new THREE.MeshStandardMaterial({ color: 0x0d0d0d, emissive: 0x0a0a0a }));
  scene.add(ball);
  const ballGlow = new THREE.PointLight(0xff8c1a, 0.6, 5);
  scene.add(ballGlow);

  const choreographies = {
    'home-preview-play': {
      duration: 9.0, initialBall: [1.5, 1, 3.5],
      hits: [
        { t: 0.2, v: [-1.5, 4, -12], by: 1 }, { t: 2.0, v: [2.5, 2.5, -14], by: 2 },
        { t: 3.6, v: [-3.5, 2.5, -12], by: 1 }, { t: 5.0, v: [3.0, 1.5, -9], by: 2 },
        { t: 6.0, v: [-1.5, 6, -10], by: 1 }, { t: 7.8, v: [0, -3.5, -18], by: 2 }
      ],
      p1Targets: [
        { t: 0.0, pos: [1.5, 3] }, { t: 0.2, pos: [1.5, 3.5] }, { t: 1.5, pos: [0, 4.5] },
        { t: 3.6, pos: [2, 3] }, { t: 4.8, pos: [0, 4.5] }, { t: 6.0, pos: [2.5, 1.5], dive: true },
        { t: 7.0, pos: [2.5, 1.5] }, { t: 8.0, pos: [1, 3] }, { t: 9.0, pos: [1.5, 3] }
      ],
      p2Targets: [
        { t: 0.0, pos: [-1, 7] }, { t: 2.0, pos: [-2, 8.5] }, { t: 3.6, pos: [-0.5, 6] },
        { t: 5.0, pos: [-2.5, 7.5] }, { t: 6.5, pos: [0, 5] }, { t: 7.8, pos: [0, 4.5], jump: true },
        { t: 9.0, pos: [-1, 7] }
      ],
      shots: [
        { start: 0.0, pos: new THREE.Vector3(-3.5, 4.5, 11), look: new THREE.Vector3(0, 0.5, 4), fov: 40, pan: new THREE.Vector3(0.001, -0.0005, -0.002) },
        { start: 3.0, pos: new THREE.Vector3(1, 0.5, 2), look: new THREE.Vector3(-1.5, 1, 8), fov: 60, pan: new THREE.Vector3(-0.002, 0, 0.003) },
        { start: 5.5, pos: new THREE.Vector3(3.1, 0.4, 3.5), look: new THREE.Vector3(2, 0, 1.5), fov: 65, pan: new THREE.Vector3(0, 0.001, -0.002) },
        { start: 7.0, pos: new THREE.Vector3(1.5, 0.2, 8), look: new THREE.Vector3(0, 2, 0), fov: 60, pan: new THREE.Vector3(-0.002, 0.001, -0.003) }
      ]
    },
    'home-preview-settings': {
      duration: 6.0, initialBall: [-2, 1, 8],
      hits: [{ t: 0.5, v: [-0.5, 3, -13], by: 1 }, { t: 2.0, v: [0.5, 3, -13], by: 2 }, { t: 3.5, v: [-0.5, 3, -13], by: 1 }, { t: 5.0, v: [0.5, 3, -13], by: 2 }],
      p1Targets: [{ t: 0, pos: [-2, 8] }, { t: 0.5, pos: [-2.5, 7.5] }, { t: 2, pos: [-1.5, 8.5] }, { t: 3.5, pos: [-2.5, 7.5] }, { t: 5, pos: [-1.5, 8.5] }, { t: 6, pos: [-2, 8] }],
      p2Targets: [{ t: 0, pos: [-1, 4] }, { t: 2.0, pos: [-2, 3] }, { t: 3.5, pos: [-1, 4.5] }, { t: 5.0, pos: [-2, 3] }, { t: 6, pos: [-1, 4] }],
      shots: [{ start: 0.0, pos: new THREE.Vector3(0, 2, 10.5), look: new THREE.Vector3(-1.5, 1, 3), fov: 50, pan: new THREE.Vector3(0.002, 0, -0.001) }]
    },
    'home-preview-controls': {
      duration: 5.0, initialBall: [1, 1, 6],
      hits: [{ t: 0.5, v: [-6, 2, -5], by: 1 }, { t: 2.5, v: [2, 1.5, -7], by: 2 }, { t: 4.0, v: [0, 3, -9], by: 1 }],
      p1Targets: [{ t: 0, pos: [0, 5] }, { t: 0.5, pos: [2.5, 2.5] }, { t: 2.5, pos: [0.5, 5] }, { t: 4.0, pos: [0, 5] }, { t: 5, pos: [0, 5] }],
      p2Targets: [{ t: 0, pos: [1, 7] }, { t: 0.5, pos: [1.5, 6.5] }, { t: 2.5, pos: [-1.5, 2] }, { t: 5, pos: [0, 5] }],
      shots: [{ start: 0.0, pos: new THREE.Vector3(0, 6, 12), look: new THREE.Vector3(0, 0, 4), fov: 45, pan: new THREE.Vector3(0, 0, 0) }]
    },
    'home-preview-stats': {
      duration: 4.0, initialBall: [0, 1.5, 3],
      hits: [{ t: 0.5, v: [1, 1, -16], by: 1 }, { t: 1.3, v: [-1.5, 1, -17], by: 2 }, { t: 2.1, v: [1.5, 1, -16], by: 1 }, { t: 2.9, v: [-1, 1, -18], by: 2 }, { t: 3.7, v: [0, 1, -16], by: 1 }],
      p1Targets: [{ t: 0, pos: [0.5, 2.5] }, { t: 4, pos: [0, 3] }],
      p2Targets: [{ t: 0, pos: [-0.5, 6] }, { t: 4, pos: [0, 5.5] }],
      shots: [{ start: 0.0, pos: new THREE.Vector3(3.2, 1.5, 6), look: new THREE.Vector3(0, 1.5, 4), fov: 60, pan: new THREE.Vector3(0, -0.001, -0.002) }]
    }
  };

  let activeScene = choreographies['home-preview-play'];
  let timeInLoop = 0, nextHitIndex = 0, currentShotIndex = 0;
  const ballPos = new THREE.Vector3();
  const ballVel = new THREE.Vector3(0, 0, 0);

  function loadScene(sceneId) {
    if (!choreographies[sceneId]) return;
    activeScene = choreographies[sceneId];
    timeInLoop = 0; nextHitIndex = 0; currentShotIndex = 0;
    ballPos.fromArray(activeScene.initialBall);
    ballVel.set(0, 0, 0);
    const shot = activeScene.shots[0];
    camera.position.copy(shot.pos);
    camera.fov = shot.fov;
    camera.updateProjectionMatrix();
  }

  const menuButtonsArray = document.querySelectorAll('.home-menu-btn');
  const previewPanelsArray = document.querySelectorAll('.home-preview-content');

  menuButtonsArray.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      menuButtonsArray.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-target');
      previewPanelsArray.forEach(panel => panel.classList.remove('active'));
      document.getElementById(target)?.classList.add('active');
      loadScene(target);
    });
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      if (target === 'home-preview-play') onEnterCourt?.();
      else if (target === 'home-preview-settings') onSettings?.();
      else if (target === 'home-preview-controls') onControls?.();
      else if (target === 'home-preview-stats') onStats?.();
    });
  });

  const backBtn = document.getElementById('homeBackBtn');
  if (backBtn) backBtn.addEventListener('click', () => onBack?.());

  function getInterp(targets, t) {
    const state = { x: 0, z: 0, dive: 0, jump: 0, vx: 0, vz: 0 };
    for (let i = 0; i < targets.length - 1; i++) {
      if (t >= targets[i].t && t < targets[i + 1].t) {
        const seg = targets[i + 1].t - targets[i].t;
        const pct = (t - targets[i].t) / seg;
        const ease = pct * pct * (3 - 2 * pct);
        state.x = THREE.MathUtils.lerp(targets[i].pos[0], targets[i + 1].pos[0], ease);
        state.z = THREE.MathUtils.lerp(targets[i].pos[1], targets[i + 1].pos[1], ease);
        state.vx = targets[i + 1].pos[0] - targets[i].pos[0];
        state.vz = targets[i + 1].pos[1] - targets[i].pos[1];
        if (targets[i].dive) state.dive = 1 - ease;
        if (targets[i + 1].dive) state.dive = ease;
        if (targets[i].jump) state.jump = 1 - ease;
        if (targets[i + 1].jump) state.jump = ease;
        break;
      }
    }
    return state;
  }

  const clock = new THREE.Clock();

  function animate() {
    rafId = requestAnimationFrame(animate);
    const dt = clock.getDelta() * 0.4;
    timeInLoop += dt;

    if (timeInLoop >= activeScene.duration) {
      timeInLoop = 0; nextHitIndex = 0; currentShotIndex = 0;
      ballPos.fromArray(activeScene.initialBall);
      ballVel.set(0, 0, 0);
    }

    if (currentShotIndex + 1 < activeScene.shots.length) {
      const nextShot = activeScene.shots[currentShotIndex + 1];
      if (timeInLoop >= nextShot.start) {
        currentShotIndex++;
        const shot = activeScene.shots[currentShotIndex];
        camera.position.copy(shot.pos);
        camera.fov = shot.fov;
        camera.updateProjectionMatrix();
      }
    }

    const activeShot = activeScene.shots[currentShotIndex];
    camera.position.add(activeShot.pan);
    camera.lookAt(activeShot.look);

    if (nextHitIndex < activeScene.hits.length && timeInLoop >= activeScene.hits[nextHitIndex].t) {
      const hit = activeScene.hits[nextHitIndex];
      ballVel.fromArray(hit.v);
      if (hit.by === 1) p1.userData.swingT = 1; else p2.userData.swingT = 1;
      nextHitIndex++;
    }

    ballPos.addScaledVector(ballVel, dt);
    ballVel.y -= 9.8 * dt;
    if (ballPos.z < 0.1) { ballPos.z = 0.1; ballVel.z *= -0.9; }
    if (ballPos.y < 0.04) { ballPos.y = 0.04; ballVel.y *= -0.85; }
    if (Math.abs(ballPos.x) > HALF_W - 0.04) { ballPos.x = Math.sign(ballPos.x) * (HALF_W - 0.04); ballVel.x *= -0.9; }
    if (ballPos.z > LEN) { ballPos.z = LEN; ballVel.z *= -0.9; }

    ball.position.copy(ballPos);
    ballGlow.position.copy(ballPos);

    [{ actor: p1, targets: activeScene.p1Targets }, { actor: p2, targets: activeScene.p2Targets }].forEach(data => {
      const state = getInterp(data.targets, timeInLoop);
      data.actor.position.x = state.x;
      data.actor.position.z = state.z;

      if (Math.abs(state.vx) > 0.1 || Math.abs(state.vz) > 0.1) {
        const targetRot = Math.atan2(state.vx, state.vz);
        data.actor.rotation.y = THREE.MathUtils.lerp(data.actor.rotation.y, targetRot, dt * 10);
      }

      let targetY = 0, targetRotX = 0;
      if (state.jump > 0) targetY = Math.sin(state.jump * Math.PI) * 1.2;
      if (state.dive > 0) {
        targetRotX = (-Math.PI / 2.2) * Math.sin(state.dive * Math.PI);
        targetY = -0.2 * Math.sin(state.dive * Math.PI);
      }
      data.actor.position.y = targetY;
      data.actor.userData.fallback.rotation.x = targetRotX;

      if (data.actor.userData.swingT > 0) {
        data.actor.userData.swingT = Math.max(0, data.actor.userData.swingT - dt * 3.5);
        const s = data.actor.userData.swingT;
        data.actor.userData.racketPivot.rotation.y = Math.sin(s * Math.PI) * -2.4;
        data.actor.userData.racketPivot.rotation.z = Math.sin(s * Math.PI) * 0.8;
      } else {
        data.actor.userData.racketPivot.rotation.set(0, 0, 0);
      }
    });

    renderer.render(scene, camera);
  }

  _animateRef = animate;
  loadScene('home-preview-play');
  initialized = true;
  // Deliberately NOT auto-started: the home screen is built up front
  // (so its scene is ready instantly) but stays paused until main.js
  // actually shows it, avoiding a second renderer running behind the intro.
}

let _animateRef = null;

export function pauseHome() {
  active = false;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

export function resumeHome() {
  if (!initialized || active || !_animateRef) return;
  active = true;
  rafId = requestAnimationFrame(_animateRef);
}
