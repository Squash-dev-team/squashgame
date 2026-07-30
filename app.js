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
  player, bot,
  moveVector, aimVector, setKey,
  startCharge, releaseCharge, triggerDive, attemptHit,
  applyLook, currentForward, getCamMode, toggleCamMode,
  updateReticle, setReticleVisible, aimTarget,
  determineShotTypeFromAim, refreshAutoShotType,
  setShotType, setAutoShotMode, getIsAutoShotMode,
  setDifficulty, getDifficultyLabel,
  getPlayerStamina, getIsWinded, getDiveRecoveryTimer,
  getIsCharging, getChargeRatio, canRequestLet,
  resetForServe, resetBotMemory, setSoloRallyMode,
  EYE_HEIGHT, LOOK_SPEED
} from './player.js';

import { revealScreen, concealScreen } from './transitions.js';
import { getProfile, saveProfile } from './shop.js';
import { checkAchievements } from './stats.js';
import { getSocket, disconnectSocket } from './netplay.js';

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
   ONLINE MATCH STATE
   In an online match the "bot" avatar/slot is repurposed to
   represent the remote opponent: their transform is streamed in
   over the socket instead of driven by AI, and their "hits" are
   ball-state snapshots relayed from their client instead of
   attemptHit('bot', ...) AI decisions.

   Rally/score authority is centralized on the host (role
   'player1'): only the host's own endRally() actually decides a
   winner and broadcasts it via 'matchState'; the joiner's local
   fault-detection is inert (see the guard at the top of
   endRally()) and its scoreboard/banners/serve are instead driven
   entirely by applyRemoteRally(), so the two clients can't ever
   disagree about who won a point. 'player'/'bot' are always
   perspective-relative, so every relayed side/score/games label
   gets flipped on receipt — see flipSide()/flipScore().
--------------------------------------------------------- */
let onlineMode = false;
let isHost = false;
let netTransformTimer = 0;
const NET_TRANSFORM_INTERVAL = 1 / 15;

/* ---------------------------------------------------------
   PRACTICE MODE
   null in every real match (singleplayer or online) — every branch
   below is an `if (practiceMode)` check so normal matches are
   unaffected. 'serve' repeats serves with no return expected;
   'wallrally' is a solo rally with no bot opponent at all. Both
   skip scoring/match-format entirely and just track an attempt's
   rally length against a session-best.
--------------------------------------------------------- */
let practiceMode = null; // null | 'serve' | 'wallrally'
let practiceBest = { serve: 0, wallrally: 0 };
let practiceStreak = 0;

function flipSide(side) { return side === 'player' ? 'bot' : side === 'bot' ? 'player' : side; }
function flipSides(obj) { return { player: obj.bot, bot: obj.player }; }

function teardownOnlineListeners() {
  const socket = getSocket();
  if (socket) {
    socket.off('opponentTransform', onOpponentTransform);
    socket.off('opponentBallHit', onOpponentBallHit);
    socket.off('opponentMatchState', applyRemoteRally);
    socket.off('letTriggered', onRemoteLetRequest);
    socket.off('opponentLeft', onOpponentLeftMidMatch);
  }
}

function onOpponentTransform({ position, rotation }) {
  if (!position || matchOver) return;
  bot.position.set(position.x, position.y, position.z);
  bot.rotation.y = rotation || 0;
}

function onOpponentBallHit({ pos, vel, shotType, chargeRatio, isServe }) {
  if (matchOver) return;
  // A late/reordered packet for a shot that landed just before the rally
  // ended (e.g. the return that caused the double-bounce fault) can arrive
  // after the host already called endRally() and set status 'dead'. Without
  // this guard it would resurrect the dead ball mid-flight and let it fault
  // again (e.g. into the tin), double-scoring the same rally.
  if (!isServe && ballState.status === 'dead') return;
  if (pos) ballState.pos.set(pos.x, pos.y, pos.z);
  if (vel) ballState.vel.set(vel.x, vel.y, vel.z);
  ballState.lastHitBy = 'bot';
  ballState.lastExecutedShot = shotType || 'drive';
  ballState.bounces = 0;
  ballState.hitFrontWall = false;
  ballState.isServeShot = !!isServe;
  ballState.status = 'inplay';
  handleHitResult({ hit: true, who: 'bot', shotType: shotType || 'drive', isFluke: false, chargeRatio: chargeRatio || 0, powerShot: false, isServe: !!isServe });
}

/**
 * Joiner-side mirror of the host's endRally() outcome. Never computes
 * anything itself — just replays the same banner/sound/serve timing
 * the host already decided, with sides flipped to this client's frame.
 */
function applyRemoteRally(payload) {
  if (!onlineMode || isHost) return;

  // The host only ever sends this once it's actually calling its own
  // startServe() locally — reacting to it here (instead of running our
  // own independently-scheduled timer) is what keeps both clients'
  // serve avatar-TP and ball status changing at the same logical
  // moment, rather than racing each other by however long the banner
  // delay + network latency happens to differ that rally.
  if (payload.kind === 'serveBegin') {
    if (payload.resetScore) { score.player = 0; score.bot = 0; }
    updateScoreboardUI();
    startServe(flipSide(payload.server));
    return;
  }

  if (matchOver) return;
  ballState.status = 'dead';

  if (payload.kind === 'let') {
    showBanner(`<span style="color:#ffb83b">LET CALLED</span><br><span style="font-size:10px;opacity:0.75">${payload.reason}</span>`, 2200);
    return;
  }

  const winner = flipSide(payload.winner);
  Object.assign(score, flipSides(payload.score));
  Object.assign(matchStats, payload.matchStats);
  updateScoreboardUI();

  if (payload.kind === 'matchOver') {
    Object.assign(gamesWon, flipSides(payload.gamesWon));
    matchOver = true;
    const color = winner === 'player' ? '#c8ff3d' : '#ff4a40';
    showBanner(`<span style="color:${color}">${winner === 'player' ? 'MATCH WON!' : 'MATCH LOST'}</span><br><span style="font-size:10px;opacity:0.75">${payload.reason}</span>`, 1800);
    playSound(winner === 'player' ? 'win' : 'loss');
    setTimeout(() => showGameOverScreen(winner), 1600);
    return;
  }

  if (payload.kind === 'gameWon') {
    Object.assign(gamesWon, flipSides(payload.gamesWon));
    updateScoreboardUI();
    const color = winner === 'player' ? '#c8ff3d' : '#ff4a40';
    showBanner(`<span style="color:${color}">GAME WON!</span><br><span style="font-size:10px;opacity:0.75">Next game starting...</span>`, 2500);
    playSound(winner === 'player' ? 'win' : 'loss');
    return;
  }

  const color = winner === 'player' ? '#c8ff3d' : '#ff4a40';
  showBanner(`<span style="color:${color}">${winner === 'player' ? 'POINT' : 'BOT POINT'}</span><br><span style="font-size:10px;opacity:0.75">${payload.reason}</span>`, 1800);
  playSound(winner === 'player' ? 'win' : 'loss');
}

function onOpponentLeftMidMatch() {
  if (!onlineMode || matchOver) return;
  showBanner('<span style="color:var(--red)">OPPONENT DISCONNECTED</span>', 2200);
  setTimeout(returnToMainMenu, 1600);
}

export function startOnlineMatch(role) {
  onlineMode = true;
  practiceMode = null;
  setSoloRallyMode(false);
  bot.visible = true;
  isHost = role !== 'player2';
  if (pauseBtnEl) pauseBtnEl.textContent = 'HOLD: RESIGN';
  const socket = getSocket();
  if (socket) {
    socket.on('opponentTransform', onOpponentTransform);
    socket.on('opponentBallHit', onOpponentBallHit);
    socket.on('opponentMatchState', applyRemoteRally);
    socket.on('letTriggered', onRemoteLetRequest);
    socket.on('opponentLeft', onOpponentLeftMidMatch);
  }
  beginMatch(role === 'player2' ? 'bot' : 'player');
}

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

  // Online: the "bot" slot is the real remote opponent — their serve
  // arrives as a genuine opponentBallHit event, not a local AI decision.
  // Practice modes never hand the serve to 'bot' (handlePracticeRallyEnd
  // always re-serves as 'player'), but guard defensively anyway.
  if (server === 'bot' && !onlineMode && !practiceMode) {
    setTimeout(() => {
      whenResumed(() => {
        if (ballState.status === 'serving' && !matchOver && ballState.server === 'bot') {
          handleHitResult(attemptHit('bot'));
        }
      });
    }, 1100 + Math.random() * 600);
  }
}

/**
 * Practice-mode counterpart to endRally() — no score/games/match-format,
 * just tracks this attempt's rally length against a session-best and
 * re-serves as 'player' every time.
 */
function handlePracticeRallyEnd(winner, reason) {
  if (ballState.status === 'dead') return;
  ballState.status = 'dead';

  const length = matchStats.currentRallyLength;
  matchStats.currentRallyLength = 0;
  let banner;

  if (practiceMode === 'serve') {
    const isFault = /FAULT|OUT/.test(reason || '');
    if (isFault) {
      practiceStreak = 0;
      banner = `<span style="color:var(--red)">FAULT</span><br><span style="font-size:10px;opacity:0.75">${reason}</span>`;
    } else {
      practiceStreak++;
      if (practiceStreak > practiceBest.serve) practiceBest.serve = practiceStreak;
      banner = `<span style="color:var(--lime)">GOOD SERVE!</span><br><span style="font-size:10px;opacity:0.8">Streak: ${practiceStreak} · Best: ${practiceBest.serve}</span>`;
    }
  } else {
    if (length > practiceBest.wallrally) {
      practiceBest.wallrally = length;
      banner = `<span style="color:var(--lime)">NEW BEST!</span><br><span style="font-size:10px;opacity:0.8">Rally: ${length}</span>`;
    } else {
      banner = `<span style="font-size:14px;">Rally: ${length}</span><br><span style="font-size:10px;opacity:0.7">Best: ${practiceBest.wallrally}</span>`;
    }
  }

  showBanner(banner, 1400);
  setTimeout(() => whenResumed(() => startServe('player')), 1400);
}

function endRally(winner, reason) {
  if (practiceMode) return handlePracticeRallyEnd(winner, reason);
  // Online: only the host decides rally outcomes — the joiner's own
  // fault-detection is a no-op and instead mirrors whatever the host
  // broadcasts via applyRemoteRally(), so the two sides can't disagree.
  if (onlineMode && !isHost) return;
  if (matchOver || ballState.status === 'dead') return;
  ballState.status = 'dead';

  if (winner === 'let') {
    const letServer = ballState.server;
    showBanner(`<span style="color:#ffb83b">LET CALLED</span><br><span style="font-size:10px;opacity:0.75">${reason}</span>`, 2200);
    if (onlineMode) getSocket()?.emit('matchState', { kind: 'let', reason, server: letServer });
    setTimeout(() => {
      whenResumed(() => {
        if (onlineMode) getSocket()?.emit('matchState', { kind: 'serveBegin', server: letServer });
        startServe(letServer);
      });
    }, 2200);
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
      if (onlineMode) getSocket()?.emit('matchState', { kind: 'matchOver', winner, reason, score, gamesWon, matchStats });
      setTimeout(() => showGameOverScreen(winner), 1600);
      return;
    }

    const color = winner === 'player' ? '#c8ff3d' : '#ff4a40';
    showBanner(`<span style="color:${color}">GAME WON!</span><br><span style="font-size:10px;opacity:0.75">Next game starting...</span>`, 2500);
    playSound(winner === 'player' ? 'win' : 'loss');
    if (onlineMode) getSocket()?.emit('matchState', { kind: 'gameWon', winner, reason, score, gamesWon, matchStats });
    setTimeout(() => {
      whenResumed(() => {
        score.player = 0; score.bot = 0;
        if (onlineMode) getSocket()?.emit('matchState', { kind: 'serveBegin', server: winner, resetScore: true });
        startServe(winner);
        updateScoreboardUI();
      });
    }, 2500);
    return;
  }

  const color = winner === 'player' ? '#c8ff3d' : '#ff4a40';
  showBanner(`<span style="color:${color}">${winner === 'player' ? 'POINT' : 'BOT POINT'}</span><br><span style="font-size:10px;opacity:0.75">${reason}</span>`, 1800);
  playSound(winner === 'player' ? 'win' : 'loss');
  if (onlineMode) getSocket()?.emit('matchState', { kind: 'point', winner, reason, score, matchStats });
  setTimeout(() => {
    whenResumed(() => {
      if (onlineMode) getSocket()?.emit('matchState', { kind: 'serveBegin', server: winner });
      startServe(winner);
    });
  }, 1800);
}

function requestLet() {
  if (ballState.status !== 'inplay' || matchOver || isPaused) return;
  if (ballState.lastHitBy === 'player') return;
  // Online joiner: only the host is allowed to decide/broadcast rally
  // outcomes, so relay the claim and let the host's onRemoteLetRequest
  // arbitrate it (using the existing requestLet/letTriggered server relay).
  if (onlineMode && !isHost) {
    getSocket()?.emit('requestLet', {});
    return;
  }
  if (canRequestLet()) endRally('let', 'Let Called (Interference)');
  else endRally('bot', 'NO LET - Clear path to ball');
}

function onRemoteLetRequest() {
  if (!onlineMode || !isHost) return;
  if (ballState.status !== 'inplay' || matchOver || isPaused) return;
  // Arbitrated from the host's own frame: the remote requester is 'bot' here.
  if (ballState.lastHitBy === 'bot') endRally('player', 'NO LET - Clear path to ball');
  else endRally('let', 'Let Called (Interference)');
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

  // Local player just hit the ball for real — tell the opponent's
  // client so their view of ballState snaps to the same outcome.
  if (onlineMode && result.who === 'player') {
    const socket = getSocket();
    socket?.emit('ballHit', {
      pos: { x: ballState.pos.x, y: ballState.pos.y, z: ballState.pos.z },
      vel: { x: ballState.vel.x, y: ballState.vel.y, z: ballState.vel.z },
      shotType: result.shotType,
      chargeRatio: result.chargeRatio,
      isServe: result.isServe,
      hitBy: 'player'
    });
  }

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
  if (e.key === 'Escape') {
    if (onlineMode) startResignHold();
    else if (running && !matchOver) togglePause();
  }
});
window.addEventListener('keyup', (e) => {
  setKey(e.key.toLowerCase(), false);
  if (e.key === 'Escape' && onlineMode) cancelResignHold();
});

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
    if (onlineMode) { if (lookHint) lookHint.style.display = 'flex'; }
    else togglePause(true);
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

function showView(el) { revealScreen(el); }
function hideView(el) { concealScreen(el); }

/** main.js (the screen-flow orchestrator) registers what "return to menu" means. */
let onReturnToMenu = null;
let onReturnToMenuOnline = null;
export function setReturnToMenuHandler(fn) { onReturnToMenu = fn; }
export function setOnlineReturnToMenuHandler(fn) { onReturnToMenuOnline = fn; }

const pauseBtnEl = document.getElementById('pauseBtn');
bindTap(pauseBtnEl, () => { if (!onlineMode) togglePause(true); });
bindTap(document.getElementById('resumeBtn'), () => togglePause(false));
bindTap(document.getElementById('pauseSettingsBtn'), () => { hideView(pauseMainView); showView(pauseSettingsModal); });
bindTap(document.getElementById('closePauseSettingsBtn'), () => { hideView(pauseSettingsModal); showView(pauseMainView); });
bindTap(document.getElementById('quitBtn'), returnToMainMenu);
bindTap(document.getElementById('restartBtn'), returnToMainMenu);

// Online matches can't be paused (there's no "freezing" a live opponent) —
// holding the same button/ESC key instead resigns the match.
['mousedown', 'touchstart'].forEach(evt => pauseBtnEl?.addEventListener(evt, () => { if (onlineMode) startResignHold(); }, { passive: true }));
['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(evt => pauseBtnEl?.addEventListener(evt, () => { if (onlineMode) cancelResignHold(); }));

function togglePause(forceState) {
  if (!running || matchOver || onlineMode) return;
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

/* ---------------------------------------------------------
   RESIGN (online only) — hold ESC / the HUD button for 3s to
   forfeit the match instead of pausing it.
--------------------------------------------------------- */
const RESIGN_HOLD_MS = 3000;
let resignHoldTimer = null;
let resignHoldActive = false;

function startResignHold() {
  if (resignHoldActive || matchOver || !onlineMode) return;
  resignHoldActive = true;
  const bar = document.getElementById('resignHoldBar');
  const fill = document.getElementById('resignHoldFill');
  bar?.classList.remove('hidden');
  if (fill) {
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetWidth;
    fill.style.transition = `width ${RESIGN_HOLD_MS}ms linear`;
    fill.style.width = '100%';
  }
  resignHoldTimer = setTimeout(() => {
    resignHoldActive = false;
    bar?.classList.add('hidden');
    returnToMainMenu();
  }, RESIGN_HOLD_MS);
}

function cancelResignHold() {
  if (!resignHoldActive) return;
  resignHoldActive = false;
  clearTimeout(resignHoldTimer);
  const bar = document.getElementById('resignHoldBar');
  const fill = document.getElementById('resignHoldFill');
  bar?.classList.add('hidden');
  if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; }
}

function beginMatch(firstServer) {
  showView(hud);
  setReticleVisible(true);
  if (reachEl) reachEl.style.display = 'block';

  score.player = 0; score.bot = 0;
  gamesWon.player = 0; gamesWon.bot = 0;
  matchOver = false; isPaused = false;
  matchStats.rallies = 0; matchStats.maxSpeed = 0; matchStats.playerHits = 0; matchStats.totalBounces = 0;
  matchStats.longestRally = 0; matchStats.winners = 0; matchStats.errors = 0; matchStats.currentRallyLength = 0;

  document.getElementById('scoreboard')?.classList.toggle('practice-mode', !!practiceMode);
  updateScoreboardUI();
  hideView(gameOverScreen);
  clock.getDelta();
  running = true;
  startServe(firstServer);
  requestLook();
}

export function startMatch() {
  onlineMode = false;
  practiceMode = null;
  setSoloRallyMode(false);
  bot.visible = true;
  resetBotMemory();
  if (pauseBtnEl) pauseBtnEl.textContent = 'PAUSE';
  beginMatch('player');
}

/**
 * Practice modes reuse the real match setup (beginMatch) but skip scoring
 * entirely (see handlePracticeRallyEnd) — 'serve' repeats serves with no
 * return expected; 'wallrally' is a solo rally with no bot opponent, so
 * the bot avatar is hidden and attemptHit's same-actor guard is relaxed
 * (see setSoloRallyMode) so the player can keep hitting their own return.
 */
export function startPracticeMatch(mode) {
  onlineMode = false;
  practiceMode = mode;
  practiceStreak = 0;
  setSoloRallyMode(mode === 'wallrally');
  bot.visible = mode !== 'wallrally';
  resetBotMemory();
  if (pauseBtnEl) pauseBtnEl.textContent = 'PAUSE';
  beginMatch('player');
}

function returnToMainMenu() {
  const wasOnline = onlineMode;
  cancelResignHold();
  running = false; matchOver = false; isPaused = false;
  if (document.pointerLockElement) document.exitPointerLock();

  hideView(gameOverScreen);
  hideView(pauseScreen);
  hideView(hud);
  setReticleVisible(false);
  if (reachEl) reachEl.style.display = 'none';
  if (lookHint) lookHint.style.display = 'none';

  if (onlineMode) {
    onlineMode = false;
    teardownOnlineListeners();
    disconnectSocket();
  }

  if (practiceMode) {
    practiceMode = null;
    setSoloRallyMode(false);
    bot.visible = true;
    document.getElementById('scoreboard')?.classList.remove('practice-mode');
  }

  if (wasOnline) onReturnToMenuOnline?.();
  else onReturnToMenu?.();
}

function awardMatchRewards(isWin) {
  const profile = getProfile();
  const coinsEarned = (isWin ? 60 : 25) + matchStats.rallies * 2 + matchStats.winners * 3;
  profile.coins += coinsEarned;

  profile.stats.matchesPlayed++;
  if (isWin) profile.stats.matchesWon++; else profile.stats.matchesLost++;
  profile.stats.totalRallies += matchStats.rallies;
  profile.stats.totalWinners += matchStats.winners;
  profile.stats.totalErrors += matchStats.errors;
  if (matchStats.maxSpeed > profile.stats.maxSpeedAllTime) profile.stats.maxSpeedAllTime = matchStats.maxSpeed;
  if (matchStats.longestRally > profile.stats.longestRallyAllTime) profile.stats.longestRallyAllTime = matchStats.longestRally;

  const newlyUnlocked = checkAchievements(matchStats, isWin, profile);
  saveProfile();
  newlyUnlocked.forEach((ach, i) => {
    setTimeout(() => showBanner(`<span style="color:var(--lime)">ACHIEVEMENT UNLOCKED</span><br><span style="font-size:10px;opacity:0.85">${ach.icon} ${ach.name}</span>`, 2400), i * 600);
  });
  return coinsEarned;
}

function showGameOverScreen(winner) {
  running = false;
  if (lookHint) lookHint.style.display = 'none';

  const isWin = winner === 'player';
  const coinsEarned = awardMatchRewards(isWin);

  setText('statRallies', matchStats.rallies);
  setText('statMaxSpeed', matchStats.maxSpeed + ' m/s');
  setText('statBounces', matchStats.totalBounces);
  setText('statLongestRally', matchStats.longestRally);
  setText('statWinners', matchStats.winners);
  setText('statErrors', matchStats.errors);
  setText('statCoins', '+' + coinsEarned + ' 🪙');

  const title = document.getElementById('gameOverTitle');
  const sub = document.getElementById('gameOverSub');
  const formatText = gamesToWin === 1 ? '1 Game Match' : (gamesToWin === 2 ? 'Best of 3 Match' : 'Best of 5 Match');
  title.innerHTML = isWin
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
  setText('botLabel', onlineMode ? 'Opponent' : getDifficultyLabel());
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

    // Online: the opponent's avatar is driven by network events (see
    // onOpponentTransform/onOpponentBallHit), not local bot AI. Solo
    // wall-rally practice has no opponent at all, so skip it there too
    // ('serve' practice still has a visible-but-inert bot, harmless to
    // update since the ball never reaches it).
    if (!onlineMode && practiceMode !== 'wallrally') handleHitResult(updateBot(worldDt));
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

    if (onlineMode) {
      netTransformTimer -= dt;
      if (netTransformTimer <= 0) {
        netTransformTimer = NET_TRANSFORM_INTERVAL;
        const socket = getSocket();
        socket?.emit('updateTransform', {
          position: { x: player.position.x, y: player.position.y, z: player.position.z },
          rotation: player.rotation.y,
          isDiving: false,
          animState: 'idle',
          stamina: getPlayerStamina()
        });
      }
    }
  }

  updateGameCamera(dt);
  renderer.render(scene, camera);
}

animate();
