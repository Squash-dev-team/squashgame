/* ===========================================================
   multiplayer.js
   UI3 — the multiplayer lobby: a mirrored counterpart to UI2's
   cinematic side-nav (right-aligned, blue-accented) sitting over
   a slow-orbiting court shot instead of home.js's rally
   choreography. Holds Create Room / Enter Room / Free Play,
   backed by the real Squash Strike matchmaking server (see
   netplay.js) rather than local placeholders.

   Consumed by main.js via:
     initMultiplayer({ onBack, onMatchStart });
       onMatchStart(role) fires once the server pairs two
       sockets in a room ('player1' or 'player2' — 'player1'
       always serves first).
     pauseMultiplayer(); resumeMultiplayer();
=========================================================== */

import { connectSocket, disconnectSocket } from './netplay.js';
import { getProfile } from './shop.js';

let scene, camera, renderer;
let rafId = null;
let active = false;
let initialized = false;

function profileSnapshot() {
  const p = getProfile();
  return { character: p.equipped.character, racquet: p.equipped.racquet, class: p.equipped.class };
}

export function initMultiplayer(callbacks = {}) {
  const { onBack, onMatchStart } = callbacks;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0f12);
  scene.fog = new THREE.FogExp2(0x0e0f12, 0.035);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('mpCanvasHolder').appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const overheadLight = new THREE.DirectionalLight(0xfff6e0, 0.95);
  overheadLight.position.set(0, 8, 4.87);
  scene.add(overheadLight);
  const ambientGlow = new THREE.PointLight(0x3ba3ff, 0.4, 25);
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
  });

  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, opacity: 1, transparent: true, side: THREE.DoubleSide });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, BACK_H), glassMat);
  backWall.position.set(0, BACK_H / 2, LEN);
  scene.add(backWall);

  function buildActor(bodyColor, glowColor) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.05, 16), new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4 }));
    body.position.y = 0.72; group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), new THREE.MeshStandardMaterial({ color: 0xe7c9a3 }));
    head.position.y = 1.35; group.add(head);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 12, 1, false, -1.2, 2.4), new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor }));
    visor.position.set(0, 1.36, 0.05); visor.rotation.x = Math.PI / 2; group.add(visor);
    return group;
  }

  const p1 = buildActor(0x192e47, 0x3ba3ff);
  const p2 = buildActor(0x471920, 0xff4a40);
  p1.position.set(-0.9, 0, 6.2);
  p2.position.set(0.9, 0, 3.4);
  p2.rotation.y = Math.PI;
  scene.add(p1, p2);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), new THREE.MeshStandardMaterial({ color: 0x0d0d0d, emissive: 0x0a0a0a }));
  ball.position.set(0, 1.4, 4.8);
  scene.add(ball);

  /* ---------------- MENU / PANEL SWITCHING ----------------
     Mirrors home.js exactly: hovering a nav button swaps which
     preview panel is shown (title + floating icon + one-line
     definition) so you can browse all three without committing to
     one; clicking additionally reveals that panel's actual
     buttons/inputs a beat later, so "the function" only shows up
     once you've read what it does. ---------------------------- */
  const menuButtonsArray = document.querySelectorAll('.mp-menu-btn');
  const previewPanelsArray = document.querySelectorAll('.mp-preview-content');
  let controlsRevealTimer = null;

  function activatePanel(btn) {
    menuButtonsArray.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.getAttribute('data-target');
    previewPanelsArray.forEach(panel => panel.classList.remove('active'));
    const panel = document.getElementById(target);
    panel?.classList.add('active');
    return panel;
  }

  menuButtonsArray.forEach(btn => {
    btn.addEventListener('mouseenter', () => activatePanel(btn));
    btn.addEventListener('click', () => {
      const panel = activatePanel(btn);
      clearTimeout(controlsRevealTimer);
      const controls = panel?.querySelector('.mp-controls');
      if (controls) {
        controls.classList.remove('mp-reveal');
        void controls.offsetWidth;
        controlsRevealTimer = setTimeout(() => controls.classList.add('mp-reveal'), 550);
      }
    });
  });

  const backBtn = document.getElementById('mpBackBtn');
  if (backBtn) backBtn.addEventListener('click', () => onBack?.());

  /* ---------------- CREATE ROOM ---------------- */
  const createGenerateBtn = document.getElementById('mpCreateGenerateBtn');
  const createCancelBtn = document.getElementById('mpCreateCancelBtn');
  const createIdle = document.getElementById('mpCreateIdle');
  const createActive = document.getElementById('mpCreateActive');
  const createCodeEl = document.getElementById('mpRoomCode');
  const createStatus = document.getElementById('mpCreateStatus');

  /* ---------------- ENTER ROOM ---------------- */
  const joinBtn = document.getElementById('mpJoinBtn');
  const joinInput = document.getElementById('mpJoinInput');
  const joinStatus = document.getElementById('mpJoinStatus');

  /* ---------------- FREE PLAY ---------------- */
  const findMatchBtn = document.getElementById('mpFindMatchBtn');
  const findStatus = document.getElementById('mpFindStatus');
  const findCancelBtn = document.getElementById('mpFindCancelBtn');

  /* ---------------- NETWORKING ---------------- */
  // Distinguishes which flow a shared server event ('roomCreated'/
  // 'opponentJoined' fire identically for Create Room and for Free
  // Play's "no opponent yet, became host" fallback) should update.
  let pendingAction = null; // 'create' | 'find' | null
  let myRole = null;

  function resetFindUI() {
    findMatchBtn.disabled = false;
    findCancelBtn?.classList.add('hidden');
  }

  function wireSocketOnce(socket) {
    if (socket._sqWired) return;
    socket._sqWired = true;

    socket.on('roomCreated', ({ roomCode, role }) => {
      myRole = role;
      if (pendingAction === 'find') {
        findStatus.textContent = `No opponents right now — waiting for someone to join (Room ${roomCode})...`;
        findCancelBtn?.classList.remove('hidden');
      } else {
        createCodeEl.textContent = roomCode;
        createIdle.classList.add('hidden');
        createActive.classList.remove('hidden');
        createStatus.textContent = 'Waiting for opponent to join...';
      }
    });

    socket.on('roomJoined', ({ role }) => {
      myRole = role;
      joinStatus.textContent = 'Joined! Starting match...';
    });

    socket.on('opponentJoined', () => {
      if (pendingAction === 'find') findStatus.textContent = 'Opponent found! Starting match...';
      else createStatus.textContent = 'Opponent found! Starting match...';
    });

    socket.on('matchFound', ({ roomCode }) => {
      findStatus.textContent = 'Opponent found! Joining...';
      socket.emit('joinRoom', { roomCode, playerProfile: profileSnapshot() });
    });

    socket.on('matchStart', () => {
      const role = myRole === 'player2' ? 'player2' : 'player1';
      pendingAction = null;
      onMatchStart?.(role);
    });

    socket.on('errorMsg', (msg) => {
      if (pendingAction === 'find') { findStatus.textContent = msg; resetFindUI(); }
      else joinStatus.textContent = msg;
    });

    socket.on('opponentLeft', () => {
      createStatus.textContent = 'Opponent disconnected.';
      findStatus.textContent = 'Opponent disconnected.';
      resetFindUI();
    });
  }

  createGenerateBtn?.addEventListener('click', () => {
    pendingAction = 'create';
    createStatus.textContent = 'Connecting...';
    createCodeEl.textContent = '------';
    createIdle.classList.add('hidden');
    createActive.classList.remove('hidden');
    const socket = connectSocket();
    wireSocketOnce(socket);
    socket.emit('createRoom', { isPublic: false, playerProfile: profileSnapshot() });
  });
  createCancelBtn?.addEventListener('click', () => {
    disconnectSocket();
    createActive.classList.add('hidden');
    createIdle.classList.remove('hidden');
  });

  joinBtn?.addEventListener('click', () => {
    const code = (joinInput?.value || '').trim().toUpperCase();
    if (!code) { joinStatus.textContent = 'Enter a room code first.'; return; }
    pendingAction = 'join';
    joinStatus.textContent = 'Joining...';
    const socket = connectSocket();
    wireSocketOnce(socket);
    socket.emit('joinRoom', { roomCode: code, playerProfile: profileSnapshot() });
  });

  findMatchBtn?.addEventListener('click', () => {
    if (findMatchBtn.disabled) return;
    pendingAction = 'find';
    findMatchBtn.disabled = true;
    findCancelBtn?.classList.remove('hidden');
    findStatus.textContent = 'Searching for an opponent...';
    const socket = connectSocket();
    wireSocketOnce(socket);
    socket.emit('findMatch', { playerProfile: profileSnapshot() });
  });
  findCancelBtn?.addEventListener('click', () => {
    disconnectSocket();
    findStatus.textContent = '';
    resetFindUI();
  });

  /* ---------------- MAIN LOOP (slow orbiting camera + idle bob) ---------------- */
  let orbitAngle = 0;
  const clock = new THREE.Clock();

  function animate() {
    rafId = requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    orbitAngle += dt * 0.12;

    const radius = 8.5;
    camera.position.set(
      Math.sin(orbitAngle) * radius,
      3.4 + Math.sin(orbitAngle * 0.5) * 0.5,
      LEN / 2 + Math.cos(orbitAngle) * radius * 0.55
    );
    camera.lookAt(0, 1.3, LEN / 2);

    const now = performance.now();
    p1.position.y = Math.abs(Math.sin(now * 0.0016)) * 0.08;
    p2.position.y = Math.abs(Math.sin(now * 0.0016 + 1.4)) * 0.08;
    ball.position.y = 1.3 + Math.sin(now * 0.002) * 0.3;

    renderer.render(scene, camera);
  }

  // The first panel starts active without a click ever firing — reveal
  // its controls the same way, just once, on load.
  const initialControls = document.querySelector('.mp-preview-content.active .mp-controls');
  if (initialControls) setTimeout(() => initialControls.classList.add('mp-reveal'), 550);

  _animateRef = animate;
  initialized = true;
}

let _animateRef = null;

export function pauseMultiplayer() {
  active = false;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

export function resumeMultiplayer() {
  if (!initialized || active || !_animateRef) return;
  active = true;
  rafId = requestAnimationFrame(_animateRef);
}

/** Called by main.js whenever the lobby is (re)shown, so a stale room
 * code / "waiting for opponent" state from a finished match doesn't
 * linger the next time you look at Create Room / Free Play. */
export function resetLobby() {
  document.getElementById('mpCreateActive')?.classList.add('hidden');
  document.getElementById('mpCreateIdle')?.classList.remove('hidden');
  const joinInput = document.getElementById('mpJoinInput');
  if (joinInput) joinInput.value = '';
  const joinStatus = document.getElementById('mpJoinStatus');
  if (joinStatus) joinStatus.textContent = '';
  const findMatchBtn = document.getElementById('mpFindMatchBtn');
  if (findMatchBtn) findMatchBtn.disabled = false;
  document.getElementById('mpFindCancelBtn')?.classList.add('hidden');
  const findStatus = document.getElementById('mpFindStatus');
  if (findStatus) findStatus.textContent = '';
}
