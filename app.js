/* ===========================================================
   app.js
   Entry point / orchestrator, rewritten to match the reference
   implementation's exact feel: a fixed "broadcast" 3rd-person
   camera with an independently-aimed reticle (drag with the
   mouse/right-joystick) plus a true 1st-person FPS mode, the
   acceleration-based movement/dive/bot-AI physics owned by
   player.js, the fault/serve-legality-aware ball physics owned
   by physics.js, hit-pause + slow-mo + screen-shake juice, and
   all menu/HUD DOM wiring.
=========================================================== */

import {
  createCourt, updateScuffs, triggerCheeringCrowd, fansAnimTick,
  LEN
} from './court.js';

import {
  initPhysics, updatePhysics, ballState, shotColors, spawnSparks,
  resetBallForServe
} from './physics.js';

import {
  createAvatars, updatePlayer, updateBot, resolvePlayerCollisions,
  player,
  moveVector, aimVector, setKey,
  startCharge, releaseCharge, triggerDive, attemptHit,
  applyLook, currentForward, getCamMode, toggleCamMode,
  updateReticle, setReticleVisible, aimTarget,
  determineShotTypeFromAim, refreshAutoShotType,
  setShotType, setAutoShotMode, getIsAutoShotMode,
  setDifficulty, getDifficultyLabel,
  getPlayerStamina, getIsWinded, getDiveRecoveryTimer,
  getIsCharging, getChargeRatio, canRequestLet,
  resetForServe,
  EYE_HEIGHT, LOOK_SPEED
} from './player.js';

/* ---------------------------------------------------------
   SCENE / CAMERA / RENDERER
--------------------------------------------------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f12);
scene.fog = new THREE.FogExp2(0x0e0f12, 0.035);

const COURT_CAM_FOV = 38;
const ACTION_CAM_FOV = 62;
const CAM_HEIGHT = 7.5;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(0, CAM_HEIGHT, LEN + 10);
camera.lookAt(0, 1.2, LEN * 0.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('canvasHolder').appendChild(renderer.domElement);

function resizeToWindow() {
  const w = window.innerWidth || document.documentElement.clientWidth || 1;
  const h = window.innerHeight || document.documentElement.clientHeight || 1;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resizeToWindow);
window.addEventListener('load', resizeToWindow);
requestAnimationFrame(resizeToWindow);

const courtRefs = createCourt(scene);
initPhysics(scene);
createAvatars(scene);
setReticleVisible(false);

/* ---------------------------------------------------------
   CAMERA STATE (3rd = fixed broadcast cam, 1st = FPS)
--------------------------------------------------------- */
let camPanX = 0, camOffset = 10, camLookZ = 1.2;
let shakeIntensity = 0;
let shakeDuration = 0;
function screenShake(intensity, duration) {
  shakeIntensity = intensity;
  shakeDuration = duration;
}

function updateGameCamera(dt) {
  let shakeX = 0, shakeY = 0, shakeZ = 0;
  if (shakeDuration > 0) {
    shakeX = (Math.random() - 0.5) * shakeIntensity;
    shakeY = (Math.random() - 0.5) * shakeIntensity;
    shakeZ = (Math.random() - 0.5) * shakeIntensity;
    shakeDuration -= dt;
  }

  if (getCamMode() === '3rd') {
    if (camera.fov !== COURT_CAM_FOV) { camera.fov = COURT_CAM_FOV; camera.updateProjectionMatrix(); }

    const focusX = THREE.MathUtils.lerp(player.position.x, ballState.pos.x, 0.4);
    camPanX = THREE.MathUtils.lerp(camPanX, focusX, 0.06);

    const spread = Math.abs(player.position.z - ballState.pos.z);
    const targetOffset = THREE.MathUtils.clamp(8 + spread * 0.24, 8, 12);
    camOffset = THREE.MathUtils.lerp(camOffset, targetOffset, 0.04);

    camera.position.set(camPanX * 0.5 + shakeX, CAM_HEIGHT + shakeY, LEN + camOffset + shakeZ);

    const targetLookZ = THREE.MathUtils.lerp(player.position.z, ballState.pos.z, 0.4);
    camLookZ = THREE.MathUtils.lerp(camLookZ, targetLookZ, 0.08);
    const lookY = THREE.MathUtils.lerp(1.2, Math.min(ballState.pos.y, 3.5), 0.2);
    camera.lookAt(camPanX * 0.85, lookY, camLookZ);
  } else {
    if (camera.fov !== ACTION_CAM_FOV) { camera.fov = ACTION_CAM_FOV; camera.updateProjectionMatrix(); }
    const forward = currentForward();
    const headLevel = player.position.clone().setY(EYE_HEIGHT + 0.1);
    headLevel.x += shakeX; headLevel.y += shakeY; headLevel.z += shakeZ;
    camera.position.copy(headLevel);
    camera.lookAt(headLevel.clone().add(forward));
  }
}

/* ---------------------------------------------------------
   SOUND
--------------------------------------------------------- */
let audioCtx = null;
let soundEnabled = true;

function tone(f0, f1, dur, wave, vol, delay = 0) {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = wave;
    const t0 = audioCtx.currentTime + delay;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  } catch (e) { /* audio is best-effort */ }
}

function playSound(type, shotType = 'drive') {
  if (!soundEnabled) return;
  if (type === 'racket') {
    const presets = {
      drop: [280, 100, 0.07, 'sine', 0.12],
      lob: [360, 180, 0.12, 'triangle', 0.15],
      kill: [550, 80, 0.09, 'sawtooth', 0.25],
      drive: [420, 140, 0.08, 'triangle', 0.18]
    };
    const [f0, f1, dur, wave, vol] = presets[shotType] || presets.drive;
    tone(f0, f1, dur, wave, vol);
  } else if (type === 'wall') { tone(180, 70, 0.12, 'sine', 0.15); }
  else if (type === 'tin') { tone(110, 110, 0.3, 'sawtooth', 0.2); tone(335, 335, 0.3, 'sine', 0.2); }
  else if (type === 'win') { [330, 440, 550, 660].forEach((f, i) => tone(f, f, 0.15, 'sine', 0.05, i * 0.06)); }
  else if (type === 'loss') { [220, 180, 140].forEach((f, i) => tone(f, f, 0.2, 'sine', 0.06, i * 0.08)); }
  else if (type === 'dive') { tone(160, 45, 0.38, 'triangle', 0.18); }
}

/* ---------------------------------------------------------
   MATCH STATE
--------------------------------------------------------- */
let running = false;
let matchOver = false;
let isPaused = false;

let timeScale = 1;
let slowMoTimeout = null;
let hitPauseTimer = 0;

const matchStats = { rallies: 0, maxSpeed: 0, playerHits: 0, totalBounces: 0, currentRallyLength: 0, longestRally: 0, winners: 0, errors: 0 };
const score = { player: 0, bot: 0 };
let gamesWon = { player: 0, bot: 0 };
let gamesToWin = 1;

/* ---------------------------------------------------------
   SERVE / SCORING (mirrors setupServe / endRally exactly)
--------------------------------------------------------- */
function whenResumed(fn) {
  if (isPaused) setTimeout(() => whenResumed(fn), 150);
  else fn();
}

function startServe(server) {
  const serveSide = (score.player + score.bot) % 2 === 0 ? 'right' : 'left';
  resetBallForServe(server, serveSide);
  resetForServe(server, serveSide);

  if (server === 'bot') {
    setTimeout(() => {
      whenResumed(() => {
        if (ballState.status === 'serving' && !matchOver && ballState.server === 'bot') {
          handleHitResult(attemptHit('bot'));
        }
      });
    }, 1100 + Math.random() * 600);
  }
}

function endRally(winner, reason) {
  if (matchOver || ballState.status === 'dead') return;
  ballState.status = 'dead';

  if (winner === 'let') {
    showBanner(`<span style="color:#ffb83b">LET CALLED</span><br><span style="font-size:10px;opacity:0.75">${reason}</span>`, 2200);
    setTimeout(() => { whenResumed(() => startServe(ballState.server)); }, 2200);
    return;
  }

  score[winner]++;
  updateScoreboardUI();
  matchStats.rallies++;
  triggerCheeringCrowd();

  if (matchStats.currentRallyLength > matchStats.longestRally) matchStats.longestRally = matchStats.currentRallyLength;
  if (ballState.lastHitBy === winner) { if (winner === 'player') matchStats.winners++; }
  else { if (winner === 'bot') matchStats.errors++; }
  matchStats.currentRallyLength = 0;

  if (score[winner] >= 11 && Math.abs(score.player - score.bot) >= 2) {
    gamesWon[winner]++;
    updateScoreboardUI();

    if (gamesWon[winner] >= gamesToWin) {
      matchOver = true;
      const color = winner === 'player' ? '#c8ff3d' : '#ff4a40';
      showBanner(`<span style="color:${color}">${winner === 'player' ? 'MATCH WON!' : 'MATCH LOST'}</span><br><span style="font-size:10px;opacity:0.75">${reason}</span>`, 1800);
      playSound(winner === 'player' ? 'win' : 'loss');
      setTimeout(() => showGameOverScreen(winner), 1600);
      return;
    }

    const color = winner === 'player' ? '#c8ff3d' : '#ff4a40';
    showBanner(`<span style="color:${color}">GAME WON!</span><br><span style="font-size:10px;opacity:0.75">Next game starting...</span>`, 2500);
    playSound(winner === 'player' ? 'win' : 'loss');
    setTimeout(() => {
      whenResumed(() => {
        score.player = 0; score.bot = 0;
        startServe(winner);
        updateScoreboardUI();
      });
    }, 2500);
    return;
  }

  const color = winner === 'player' ? '#c8ff3d' : '#ff4a40';
  showBanner(`<span style="color:${color}">${winner === 'player' ? 'POINT' : 'BOT POINT'}</span><br><span style="font-size:10px;opacity:0.75">${reason}</span>`, 1800);
  playSound(winner === 'player' ? 'win' : 'loss');
  setTimeout(() => { whenResumed(() => startServe(winner)); }, 1800);
}

function requestLet() {
  if (ballState.status !== 'inplay' || matchOver || isPaused) return;
  if (ballState.lastHitBy === 'player') return;
  if (canRequestLet()) endRally('let', 'Let Called (Interference)');
  else endRally('bot', 'NO LET - Clear path to ball');
}

/* ---------------------------------------------------------
   HIT RESOLUTION → banners / hit-pause / screen shake / sound
--------------------------------------------------------- */
function hexToCss(hex) { return '#' + hex.toString(16).padStart(6, '0'); }

function handleHitResult(result) {
  if (!result || !result.hit) return;

  playSound('racket', result.shotType);
  matchStats.currentRallyLength++;
  if (result.who === 'player') matchStats.playerHits++;

  if (result.isServe) return;

  if (result.who === 'player') {
    if (result.isFluke) {
      hitPauseTimer = 0.08;
      spawnSparks(player.position.clone().setY(1.1), 20, 0xffffff);
      screenShake(0.4, 0.4);
      showBanner('<span style="color:#ffb83b">FLUKE SHOT!</span>', 1200);
    } else if (result.powerShot) {
      hitPauseTimer = 0.06;
      spawnSparks(player.position.clone().setY(1.1), 16, 0xffffff);
      showBanner('<span style="color:var(--orange)">POWER SHOT!</span>', 700);
      screenShake(0.35, 0.4);
    } else {
      if (result.shotType === 'kill') { hitPauseTimer = 0.04; screenShake(0.12, 0.25); }
      showBanner(`<span style="color:${hexToCss(shotColors[result.shotType])}">${result.shotType.toUpperCase()} SHOT!</span>`, 800);
    }
  } else if (result.who === 'bot' && result.isFluke) {
    showBanner('<span style="color:#ff4a40">BOT FLUKE!</span>', 1000);
  }
}

/* ---------------------------------------------------------
   BALL EVENTS → sound / faults / points
--------------------------------------------------------- */
function handleBallEvents(events) {
  for (const ev of events) {
    if (ev.type === 'wallBounce') {
      playSound('wall');
    } else if (ev.type === 'nick') {
      playSound('wall');
      showBanner('<span style="color:#ffb83b">NICK!</span>', 1000);
    } else if (ev.type === 'floorBounce') {
      matchStats.totalBounces++;
    } else if (ev.type === 'fault' || ev.type === 'point') {
      if (ev.sound) playSound(ev.sound);
      endRally(ev.winner, ev.reason);
    }
  }
}

/* ---------------------------------------------------------
   INPUT — KEYBOARD
--------------------------------------------------------- */
window.addEventListener('contextmenu', (e) => e.preventDefault());

function doPlayerDive() {
  if (!running || matchOver || isPaused) return;
  if (!triggerDive()) return;
  playSound('dive');
  showBanner('<span style="color:var(--orange)">DIVE LUNGE SAVE!</span>', 900);
  timeScale = 0.3;
  const overlay = document.getElementById('slowmoOverlay');
  overlay.classList.add('active');
  clearTimeout(slowMoTimeout);
  slowMoTimeout = setTimeout(() => { timeScale = 1; overlay.classList.remove('active'); }, 380);
}

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  setKey(key, true);
  if (key === 'c') doToggleCamera();
  if (e.code === 'Space') { e.preventDefault(); doPlayerDive(); }
  if (e.key === 'Escape' && running && !matchOver) togglePause();
});
window.addEventListener('keyup', (e) => setKey(e.key.toLowerCase(), false));

/* ---------------------------------------------------------
   INPUT — MOUSE (look/aim, charge/swing, let)
--------------------------------------------------------- */
const lookHint = document.getElementById('lookHint');

function requestLook() {
  try { if (renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock(); } catch (e) { /* ignore */ }
}
renderer.domElement.addEventListener('click', () => { if (running && !matchOver && !isPaused) requestLook(); });

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    if (lookHint) lookHint.style.display = 'none';
  } else if (running && !matchOver && !isPaused) {
    togglePause(true);
  } else if (running && !matchOver) {
    if (lookHint) lookHint.style.display = 'flex';
  }
});

document.addEventListener('mousemove', (e) => {
  if (!running || isPaused) return;
  applyLook(e.movementX, e.movementY, 0.015, LOOK_SPEED);
  if (running && document.pointerLockElement && lookHint) lookHint.style.display = 'none';
});

document.addEventListener('mousedown', (e) => {
  if (!running || matchOver || isPaused) return;
  if (e.button === 0) startCharge();
  else if (e.button === 2) requestLet();
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) handleHitResult(releaseCharge());
});

/* ---------------------------------------------------------
   INPUT — TOUCH (movement + aim joysticks, free-look drag, buttons)
--------------------------------------------------------- */
const JOY_DEADZONE = 0.12;

function bindJoystick(zoneEl, knobEl, onMove, onEnd) {
  if (!zoneEl || !knobEl) return;
  let touchId = null, startPos = { x: 0, y: 0 };

  zoneEl.addEventListener('touchstart', (e) => {
    const touch = e.changedTouches[0];
    touchId = touch.identifier;
    startPos = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });

  zoneEl.addEventListener('touchmove', (e) => {
    if (touchId === null) return;
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      if (t.identifier !== touchId) continue;
      const dx = t.clientX - startPos.x, dy = t.clientY - startPos.y;
      const dist = Math.hypot(dx, dy), maxDist = 55, angle = Math.atan2(dy, dx);
      let intensity = Math.min(dist, maxDist) / maxDist;
      intensity = intensity < JOY_DEADZONE ? 0 : (intensity - JOY_DEADZONE) / (1 - JOY_DEADZONE);
      const knobX = Math.cos(angle) * intensity * maxDist;
      const knobY = Math.sin(angle) * intensity * maxDist;
      knobEl.style.transform = `translate(${knobX}px, ${knobY}px)`;
      onMove(Math.cos(angle) * intensity, Math.sin(angle) * intensity);
    }
  }, { passive: true });

  const end = () => { touchId = null; knobEl.style.transform = 'translate(0px, 0px)'; onEnd(); };
  zoneEl.addEventListener('touchend', end);
  zoneEl.addEventListener('touchcancel', end);
}

bindJoystick(
  document.getElementById('joystickZone'), document.getElementById('joystickKnob'),
  (x, y) => { moveVector.x = x; moveVector.y = y; },
  () => { moveVector.x = 0; moveVector.y = 0; }
);

const actionJoystickKnob = document.getElementById('actionJoystickKnob');
let actionActive = false;
bindJoystick(
  document.getElementById('actionJoystickZone'), actionJoystickKnob,
  (x, y) => {
    aimVector.x = x; aimVector.y = y;
    if (!actionActive) { actionActive = true; actionJoystickKnob?.classList.add('active'); startCharge(); }
  },
  () => {
    if (!actionActive) return;
    actionActive = false;
    actionJoystickKnob?.classList.remove('active');
    aimVector.x = 0; aimVector.y = 0;
    handleHitResult(releaseCharge());
  }
);

// Free-look: dragging a finger on the right ~55% of the screen (outside HUD/joysticks) rotates the aim/look.
let lookTouchId = null, lastLookPos = { x: 0, y: 0 };
window.addEventListener('touchstart', (e) => {
  if (isPaused) return;
  const touch = e.changedTouches[0];
  if (touch.clientX < window.innerWidth * 0.45) return;
  if (e.target.closest('#hud') || e.target.closest('#touchLayer') || e.target.closest('#shotSelector') || e.target.closest('.menu-overlay')) return;
  lookTouchId = touch.identifier;
  lastLookPos = { x: touch.clientX, y: touch.clientY };
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (lookTouchId === null || isPaused) return;
  for (let i = 0; i < e.touches.length; i++) {
    const t = e.touches[i];
    if (t.identifier !== lookTouchId) continue;
    applyLook(t.clientX - lastLookPos.x, t.clientY - lastLookPos.y, 0.015, 0.005);
    lastLookPos = { x: t.clientX, y: t.clientY };
  }
}, { passive: true });

const stopLook = (e) => {
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === lookTouchId) lookTouchId = null;
  }
};
window.addEventListener('touchend', stopLook);
window.addEventListener('touchcancel', stopLook);

function bindTap(el, handler) {
  if (!el) return;
  el.addEventListener('click', handler);
  el.addEventListener('touchstart', (e) => { e.preventDefault(); handler(e); }, { passive: false });
}
bindTap(document.getElementById('touchDiveBtn'), doPlayerDive);
bindTap(document.getElementById('touchLetBtn'), requestLet);

/* ---------------------------------------------------------
   SHOT SELECTOR / DIFFICULTY / FORMAT / CONTROL SCHEME / SETTINGS
--------------------------------------------------------- */
function selectManualShot(shot) {
  setShotType(shot);
  setAutoShotMode(false);
  const methodBtn = document.getElementById('methodToggle');
  if (methodBtn) { methodBtn.textContent = 'METHOD: MANUAL'; methodBtn.classList.remove('active'); }
  const selector = document.getElementById('shotSelector');
  if (selector) selector.style.display = 'flex';
  updateShotSelectorUI(shot);
}
function updateShotSelectorUI(activeType) {
  document.querySelectorAll('.shot-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.shot === activeType));
}
document.querySelectorAll('.shot-btn').forEach(btn => bindTap(btn, () => selectManualShot(btn.dataset.shot)));

document.querySelectorAll('#diffRow .menu-btn-opt').forEach(btn => {
  bindTap(btn, () => {
    setDifficulty(btn.dataset.d);
    document.querySelectorAll('#diffRow .menu-btn-opt').forEach(b => b.classList.toggle('active', b === btn));
    updateScoreboardUI();
  });
});
document.querySelectorAll('#modeRow .menu-btn-opt').forEach(btn => {
  bindTap(btn, () => {
    gamesToWin = Math.ceil(parseInt(btn.dataset.format, 10) / 2);
    document.querySelectorAll('#modeRow .menu-btn-opt').forEach(b => b.classList.toggle('active', b === btn));
  });
});
document.querySelectorAll('#controlRow .menu-btn-opt').forEach(btn => {
  bindTap(btn, () => {
    document.body.classList.remove('ctrl-auto', 'ctrl-touch', 'ctrl-kb');
    document.body.classList.add('ctrl-' + btn.dataset.ctrl);
    document.querySelectorAll('#controlRow .menu-btn-opt').forEach(b => b.classList.toggle('active', b === btn));
  });
});

function doToggleCamera() {
  const mode = toggleCamMode();
  const btn = document.getElementById('camToggle');
  if (btn) btn.textContent = `VIEW: ${mode === '3rd' ? 'COURT CAM' : 'ACTION CAM'}`;
}
bindTap(document.getElementById('camToggle'), doToggleCamera);

bindTap(document.getElementById('methodToggle'), () => {
  const nowAuto = !getIsAutoShotMode();
  setAutoShotMode(nowAuto);
  const btn = document.getElementById('methodToggle');
  if (btn) { btn.textContent = `METHOD: ${nowAuto ? 'AUTO' : 'MANUAL'}`; btn.classList.toggle('active', nowAuto); }
  const selector = document.getElementById('shotSelector');
  if (selector) selector.style.display = nowAuto ? 'none' : 'flex';
  if (nowAuto) setShotType(determineShotTypeFromAim(aimTarget.y));
});

bindTap(document.getElementById('muteToggle'), () => {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('muteToggle');
  if (btn) { btn.textContent = `SOUND: ${soundEnabled ? 'ON' : 'MUTED'}`; btn.classList.toggle('active', !soundEnabled); }
});

bindTap(document.getElementById('fsToggle'), () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.().catch(() => {});
});

/* ---------------------------------------------------------
   MENU NAVIGATION
--------------------------------------------------------- */
const pauseScreen = document.getElementById('pauseScreen');
const pauseMainView = document.getElementById('pauseMainView');
const pauseSettingsModal = document.getElementById('pauseSettingsModal');
const gameOverScreen = document.getElementById('gameOverScreen');
const hud = document.getElementById('hud');
const reachEl = document.getElementById('reach');

function showView(el) { if (el) el.classList.remove('hidden'); }
function hideView(el) { if (el) el.classList.add('hidden'); }

/** main.js (the screen-flow orchestrator) registers what "return to menu" means. */
let onReturnToMenu = null;
export function setReturnToMenuHandler(fn) { onReturnToMenu = fn; }

bindTap(document.getElementById('pauseBtn'), () => togglePause(true));
bindTap(document.getElementById('resumeBtn'), () => togglePause(false));
bindTap(document.getElementById('pauseSettingsBtn'), () => { hideView(pauseMainView); showView(pauseSettingsModal); });
bindTap(document.getElementById('closePauseSettingsBtn'), () => { hideView(pauseSettingsModal); showView(pauseMainView); });
bindTap(document.getElementById('quitBtn'), returnToMainMenu);
bindTap(document.getElementById('restartBtn'), returnToMainMenu);

function togglePause(forceState) {
  if (!running || matchOver) return;
  const next = typeof forceState === 'boolean' ? forceState : !isPaused;
  if (next === isPaused) return;
  isPaused = next;

  if (isPaused) {
    showView(pauseScreen); showView(pauseMainView); hideView(pauseSettingsModal);
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    hideView(pauseScreen);
    if (getCamMode() === '1st' || !('ontouchstart' in window)) {
      if (lookHint) lookHint.style.display = 'flex';
    }
  }
}

export function startMatch() {
  showView(hud);
  setReticleVisible(true);
  if (reachEl) reachEl.style.display = 'block';

  score.player = 0; score.bot = 0;
  gamesWon.player = 0; gamesWon.bot = 0;
  matchOver = false; isPaused = false;
  matchStats.rallies = 0; matchStats.maxSpeed = 0; matchStats.playerHits = 0; matchStats.totalBounces = 0;
  matchStats.longestRally = 0; matchStats.winners = 0; matchStats.errors = 0; matchStats.currentRallyLength = 0;

  updateScoreboardUI();
  hideView(gameOverScreen);
  clock.getDelta();
  running = true;
  startServe('player');
  requestLook();
}

function returnToMainMenu() {
  running = false; matchOver = false; isPaused = false;
  if (document.pointerLockElement) document.exitPointerLock();

  hideView(gameOverScreen);
  hideView(pauseScreen);
  hideView(hud);
  setReticleVisible(false);
  if (reachEl) reachEl.style.display = 'none';
  if (lookHint) lookHint.style.display = 'none';

  onReturnToMenu?.();
}

function showGameOverScreen(winner) {
  running = false;
  if (lookHint) lookHint.style.display = 'none';

  setText('statRallies', matchStats.rallies);
  setText('statMaxSpeed', matchStats.maxSpeed + ' m/s');
  setText('statBounces', matchStats.totalBounces);
  setText('statLongestRally', matchStats.longestRally);
  setText('statWinners', matchStats.winners);
  setText('statErrors', matchStats.errors);

  const title = document.getElementById('gameOverTitle');
  const sub = document.getElementById('gameOverSub');
  const formatText = gamesToWin === 1 ? '1 Game Match' : (gamesToWin === 2 ? 'Best of 3 Match' : 'Best of 5 Match');
  title.innerHTML = gamesWon.player > gamesWon.bot
    ? "MATCH <span style='color:var(--lime)'>WON!</span>"
    : "MATCH <span style='color:var(--red)'>LOST</span>";
  sub.textContent = `${formatText} — Final Games: ${gamesWon.player} - ${gamesWon.bot}`;

  showView(gameOverScreen);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/* ---------------------------------------------------------
   BANNER / SCOREBOARD / HUD
--------------------------------------------------------- */
let bannerTimeout = null;
function showBanner(html, ms = 1500) {
  const banner = document.getElementById('banner');
  if (!banner) return;
  banner.innerHTML = html;
  banner.classList.add('show');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => banner.classList.remove('show'), ms);
}

function updateScoreboardUI() {
  setText('scorePlayer', score.player);
  setText('scoreBot', score.bot);
  setText('gamesScore', `GAMES: ${gamesWon.player}-${gamesWon.bot}`);
  setText('botLabel', getDifficultyLabel());
}

function updateHUD() {
  const warningEl = document.getElementById('staminaWarning');
  const recovery = getDiveRecoveryTimer();
  if (recovery > 0) {
    warningEl.style.display = 'block';
    warningEl.textContent = `FATIGUED: RECOVERING... (${recovery.toFixed(1)}s)`;
  } else if (getIsWinded()) {
    warningEl.style.display = 'block';
    warningEl.textContent = 'OUT OF BREATH';
  } else {
    warningEl.style.display = 'none';
  }

  const bar = document.getElementById('staminaProgressBar');
  if (bar) bar.style.width = getPlayerStamina() + '%';

  const ring = document.getElementById('powerRing');
  if (ring) {
    if (getIsCharging()) {
      const pct = getChargeRatio() * 100;
      ring.classList.add('show');
      ring.style.setProperty('--chg', String(pct));
      ring.classList.toggle('maxed', pct >= 90);
    } else {
      ring.classList.remove('show', 'maxed');
    }
  }

  if (getIsAutoShotMode()) {
    updateShotSelectorUI(refreshAutoShotType());
  }
}

/* ---------------------------------------------------------
   MAIN LOOP
--------------------------------------------------------- */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();

  if (hitPauseTimer > 0) {
    hitPauseTimer -= rawDt;
    renderer.render(scene, camera);
    return;
  }

  const dt = Math.min(rawDt, 0.033);
  const worldDt = dt * timeScale;

  if (running && !matchOver && !isPaused) {
    updateReticle(camera);

    if (aimVector.x !== 0 || aimVector.y !== 0) {
      const aimMag = Math.hypot(aimVector.x, aimVector.y);
      const aimFactor = aimMag * aimMag;
      const moveX = aimMag > 0 ? (aimVector.x / aimMag) * aimFactor : 0;
      const moveY = aimMag > 0 ? (aimVector.y / aimMag) * aimFactor : 0;
      applyLook(moveX * 1400 * dt, moveY * 1400 * dt, 0.015, LOOK_SPEED);
    }

    const playerResult = updatePlayer(dt);
    if (playerResult.bonked) { screenShake(0.08, 0.15); playSound('wall'); }

    handleHitResult(updateBot(worldDt));
    resolvePlayerCollisions(worldDt);

    const events = updatePhysics(worldDt);
    handleBallEvents(events);
    if (ballState.status === 'inplay') {
      const speed = ballState.vel.length();
      if (speed > matchStats.maxSpeed) matchStats.maxSpeed = Math.round(speed * 10) / 10;
    }

    updateScuffs(worldDt);
    fansAnimTick(courtRefs.fans, dt);
    updateHUD();
  }

  updateGameCamera(dt);
  renderer.render(scene, camera);
}

animate();
