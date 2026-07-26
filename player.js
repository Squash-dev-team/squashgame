/* ===========================================================
   player.js
   Player + bot avatars, movement (acceleration/friction model),
   diving, stamina, camera-mode-aware input (3rd = fixed
   broadcast cam with a free-roaming aim reticle; 1st = actual
   FPS look), the aim reticle itself, bot AI (landing prediction,
   reaction delay, tactical shot selection), and the full shot
   resolution (reach/accuracy/fluke model) — all ported to match
   the reference implementation's exact behavior and feel.

   Depends on the global THREE namespace (r128) and on exports
   from court.js and physics.js.

   Consumed by app.js via:
     createAvatars(scene);          // once
     updatePlayer(dt) -> {bonked}   // every frame, RAW dt (not time-scaled)
     updateBot(worldDt) -> hitResult|null   // every frame, time-scaled dt
     resolvePlayerCollisions(worldDt);      // every frame, time-scaled dt
     startCharge() / releaseCharge() -> hitResult|null
     triggerDive() -> boolean
     applyLook(dx, dy, aimScale, lookScale) // from mousemove/touch-look
=========================================================== */

import {
  HALF_W, LEN, FRONT_H, TIN_H, SERVICE_LINE_H,
  shadowMat, shadowGeo, addScuffMark
} from './court.js';
import { ballState, BALL_R, G, hitBallTo, spawnSparks, shotColors } from './physics.js';

/* ---------------------------------------------------------
   CONSTANTS
--------------------------------------------------------- */
export const PLAYER_SPEED = 4.5;
export const PLAYER_REACH = 1.3;
export const PLAYER_SWEET_SPOT = 0.75;
export const EYE_HEIGHT = 1.55;
export const MAX_TURN_RATE = 9;
export const DIVE_SLIDE_DUR = 0.42;
export const MAX_CHARGE_MS = 900;

export const LOOK_SPEED = 0.0022;
export const PITCH_MIN = -0.92;
export const PITCH_MAX = 0.52;

/* ---------------------------------------------------------
   BOT DIFFICULTY TABLE
--------------------------------------------------------- */
export const DIFF = {
  easy:   { reach: 1.60, speed: 2.2, reactDelay: 0.50, aimErr: 1.25, faultChance: 0.15, label: 'Bot·Easy' },
  medium: { reach: 1.80, speed: 3.2, reactDelay: 0.26, aimErr: 0.60, faultChance: 0.06, label: 'Bot·Med' },
  hard:   { reach: 1.90, speed: 4.5, reactDelay: 0.10, aimErr: 0.18, faultChance: 0.01, label: 'Bot·Hard' }
};
let DIFFICULTY = 'medium';
export function setDifficulty(level) { if (DIFF[level]) DIFFICULTY = level; }
export function getDifficulty() { return DIFFICULTY; }
export function getDifficultyLabel() { return DIFF[DIFFICULTY].label; }

/* ---------------------------------------------------------
   INPUT STATE
--------------------------------------------------------- */
export const keys = {};
export function setKey(key, pressed) { keys[key.toLowerCase()] = pressed; }

export const moveVector = { x: 0, y: 0 };
export const aimVector = { x: 0, y: 0 };
export const playerVelocity = { x: 0, z: 0 };
export const botVelocity = { x: 0, z: 0 };

/* ---------------------------------------------------------
   CAMERA MODE / LOOK / AIM TARGET
--------------------------------------------------------- */
let camMode = '3rd'; // '3rd' = fixed broadcast cam + free aim reticle | '1st' = FPS look
export function getCamMode() { return camMode; }
export function toggleCamMode() { camMode = camMode === '3rd' ? '1st' : '3rd'; return camMode; }

let yaw = 0, pitch = -0.12;
export function getYaw() { return yaw; }
export function getPitch() { return pitch; }

export const aimTarget = { x: 0, y: 1.8 };

/** Mirrors the reference's applyLook(): drags the aim reticle in 3rd-person, or the head look in 1st-person. */
export function applyLook(dx, dy, aimScale, lookScale) {
  if (camMode === '3rd') {
    aimTarget.x = THREE.MathUtils.clamp(aimTarget.x + dx * aimScale, -HALF_W - 3.25, HALF_W + 3.25);
    aimTarget.y = THREE.MathUtils.clamp(aimTarget.y - dy * aimScale, 0.65, FRONT_H - 0.5);
  } else {
    yaw += dx * lookScale;
    pitch = THREE.MathUtils.clamp(pitch - dy * lookScale, PITCH_MIN, PITCH_MAX);
  }
}

export function currentForward() {
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

/** Converts an aim-space (x can extend past ±HALF_W onto the side walls, y = height) point into a 3D wall point. */
function getAim3D(ax, ay) {
  if (ax > HALF_W) return { x: HALF_W, y: ay, z: ax - HALF_W, rx: 0, ry: -Math.PI / 2, rz: 0 };
  if (ax < -HALF_W) return { x: -HALF_W, y: ay, z: -(ax + HALF_W), rx: 0, ry: Math.PI / 2, rz: 0 };
  return { x: ax, y: ay, z: 0, rx: 0, ry: 0, rz: 0 };
}

/* ---------------------------------------------------------
   AIM RETICLE
--------------------------------------------------------- */
const reticleMat = new THREE.MeshBasicMaterial({ color: 0xee2c2c, transparent: true, opacity: 0.75, depthWrite: false });
let reticle = null;
const raycaster = new THREE.Raycaster();

export function createReticle(scene) {
  reticle = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.13, 24), reticleMat);
  reticle.position.set(0, 1.8, 0.035);
  reticle.visible = false;
  scene.add(reticle);
  return reticle;
}

export function setReticleVisible(v) { if (reticle) reticle.visible = v; }

/** Recomputes aimTarget (in 1st-person, via raycast onto the court walls) and repositions the reticle mesh. Call once per frame during active play. */
export function updateReticle(camera) {
  if (!reticle) return;

  if (camMode === '3rd') {
    aimTarget.x = THREE.MathUtils.clamp(aimTarget.x, -HALF_W - 3.25, HALF_W + 3.25);
    aimTarget.y = THREE.MathUtils.clamp(aimTarget.y, 0.65, FRONT_H - 0.5);
  } else {
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    let bestHit = null, bestDist = Infinity;
    const pt = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), pt)) {
      if (pt.x >= -HALF_W && pt.x <= HALF_W && pt.y >= 0 && pt.y <= FRONT_H) {
        const d = pt.distanceTo(camera.position);
        if (d < bestDist) { bestDist = d; bestHit = { x: pt.x, y: pt.y }; }
      }
    }
    if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(-1, 0, 0), HALF_W), pt)) {
      if (pt.z >= 0 && pt.z <= 3.25 && pt.y >= 0 && pt.y <= FRONT_H) {
        const d = pt.distanceTo(camera.position);
        if (d < bestDist) { bestDist = d; bestHit = { x: HALF_W + pt.z, y: pt.y }; }
      }
    }
    if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(1, 0, 0), HALF_W), pt)) {
      if (pt.z >= 0 && pt.z <= 3.25 && pt.y >= 0 && pt.y <= FRONT_H) {
        const d = pt.distanceTo(camera.position);
        if (d < bestDist) { bestDist = d; bestHit = { x: -HALF_W - pt.z, y: pt.y }; }
      }
    }

    if (bestHit) { aimTarget.x = bestHit.x; aimTarget.y = bestHit.y; }
    aimTarget.x = THREE.MathUtils.clamp(aimTarget.x, -HALF_W - 3.25, HALF_W + 3.25);
    aimTarget.y = THREE.MathUtils.clamp(aimTarget.y, 0.65, FRONT_H - 0.5);
  }

  const aim3D = getAim3D(aimTarget.x, aimTarget.y);
  if (aimTarget.x > HALF_W) reticle.position.set(aim3D.x - 0.03, aim3D.y, aim3D.z);
  else if (aimTarget.x < -HALF_W) reticle.position.set(aim3D.x + 0.03, aim3D.y, aim3D.z);
  else reticle.position.set(aim3D.x, aim3D.y, aim3D.z + 0.03);
  reticle.rotation.set(aim3D.rx, aim3D.ry, aim3D.rz);
}

/* ---------------------------------------------------------
   SHOT TYPE
--------------------------------------------------------- */
let playerShotType = 'drive';
let isAutoShotMode = true;

export function determineShotTypeFromAim(aimY, currentCharge = 0) {
  if (aimY > 3.0) return 'lob';
  if (aimY < 1.15) return currentCharge > 0.25 ? 'kill' : 'drop';
  return 'drive';
}

export function setShotType(type) {
  if (!shotColors[type]) return;
  playerShotType = type;
  if (reticle) reticle.material.color.setHex(shotColors[type]);
}
export function setAutoShotMode(v) { isAutoShotMode = !!v; }
export function getPlayerShotType() { return playerShotType; }
export function getIsAutoShotMode() { return isAutoShotMode; }

/** Call once per frame while playing and in auto-shot mode: recolors the reticle and returns the live shot type for HUD highlighting. */
export function refreshAutoShotType() {
  const chargeRatio = charging ? Math.min((performance.now() - chargeStart) / MAX_CHARGE_MS, 1) : 0;
  const type = determineShotTypeFromAim(aimTarget.y, chargeRatio);
  if (reticle) reticle.material.color.setHex(shotColors[type]);
  return type;
}

/* ---------------------------------------------------------
   STAMINA / DIVE / SWING STATE
--------------------------------------------------------- */
let playerStamina = 100;
let isWinded = false;
let playerFacing = 0;
let playerTurnRate = 0;
let botReactTimer = -1;

let isDiving = false;
let diveTimer = 0;
let diveRecoveryTimer = 0;
const diveDir = new THREE.Vector3();

let letCollisionTimer = 0;

let charging = false;
let chargeStart = 0;

let playerSwingT = 0;
let botSwingT = 0;

export function getPlayerStamina() { return playerStamina; }
export function getIsWinded() { return isWinded; }
export function getDiveRecoveryTimer() { return diveRecoveryTimer; }
export function canClaimLet() { return letCollisionTimer > 0; }
export function getIsCharging() { return charging; }
export function getChargeRatio() {
  if (!charging) return 0;
  return Math.min((performance.now() - chargeStart) / MAX_CHARGE_MS, 1);
}

/* ---------------------------------------------------------
   AVATAR CONSTRUCTION
--------------------------------------------------------- */
export let player = null;
export let bot = null;
export let playerShadow = null;
export let botShadow = null;

function buildAvatar(bodyColor, glowColor) {
  const actorGroup = new THREE.Group();
  const fallback = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.25, 1.05, 16),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4, metalness: 0.2 })
  );
  body.position.y = 0.72;
  body.castShadow = true;
  body.receiveShadow = true;
  fallback.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xe7c9a3, roughness: 0.5 })
  );
  head.position.y = 1.35;
  head.castShadow = true;
  fallback.add(head);

  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.19, 0.07, 12, 1, false, -1.2, 2.4),
    new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, roughness: 0.1, transparent: true, opacity: 0.95 })
  );
  visor.position.set(0, 1.36, 0.05);
  visor.rotation.x = Math.PI / 2;
  fallback.add(visor);

  const racketPivot = new THREE.Group();
  racketPivot.position.set(0, 0.95, 0);
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.45, 8),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  );
  handle.position.set(0.35, 0, 0.05);
  handle.rotation.z = Math.PI / 2.3;
  racketPivot.add(handle);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.15, 0.016, 10, 24),
    new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, roughness: 0.2 })
  );
  rim.position.set(0.62, 0, 0.05);
  rim.rotation.z = Math.PI / 2.3;
  racketPivot.add(rim);

  const strings = new THREE.Mesh(
    new THREE.CylinderGeometry(0.002, 0.002, 0.28, 4),
    new THREE.MeshBasicMaterial({ color: 0xefefef, transparent: true, opacity: 0.6 })
  );
  strings.position.copy(rim.position);
  strings.rotation.copy(rim.rotation);
  racketPivot.add(strings);

  const swingRibbon = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.5, 12, 1, 0, Math.PI),
    new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  swingRibbon.position.set(0.62, 0, 0.05);
  swingRibbon.rotation.x = Math.PI / 2;
  racketPivot.add(swingRibbon);

  fallback.add(racketPivot);
  actorGroup.add(fallback);

  actorGroup.userData = {
    fallback, racketPivot, swingRibbon,
    prevVel: new THREE.Vector3(),
    scuffCooldown: 0
  };
  return actorGroup;
}

export function createAvatars(scene) {
  player = buildAvatar(0x192e47, 0x3ba3ff);
  bot = buildAvatar(0x471920, 0xff4a40);
  scene.add(player, bot);

  player.position.set(1.0, 0, 6.0);
  bot.position.set(-1.0, 0, 5.0);

  playerShadow = new THREE.Mesh(shadowGeo, shadowMat);
  playerShadow.rotation.x = -Math.PI / 2;
  playerShadow.position.y = 0.002;
  scene.add(playerShadow);

  botShadow = new THREE.Mesh(shadowGeo, shadowMat);
  botShadow.rotation.x = -Math.PI / 2;
  botShadow.position.y = 0.002;
  scene.add(botShadow);

  createReticle(scene);

  return { player, bot, playerShadow, botShadow };
}

function dropShadow(shadow, obj) {
  shadow.position.set(obj.position.x, 0.002, obj.position.z);
}

function updateSwing(entity, t, dt, sign) {
  if (t > 0) {
    t = Math.max(0, t - dt * 3.8);
    if (entity.userData.racketPivot) {
      entity.userData.racketPivot.rotation.y = Math.sin(t * Math.PI) * -2.4 * sign;
      entity.userData.racketPivot.rotation.z = Math.sin(t * Math.PI) * 0.8 * sign;
    }
    if (entity.userData.swingRibbon) entity.userData.swingRibbon.material.opacity = Math.sin(t * Math.PI) * 0.7;
  } else {
    if (entity.userData.racketPivot) entity.userData.racketPivot.rotation.set(0, 0, 0);
    if (entity.userData.swingRibbon) entity.userData.swingRibbon.material.opacity = 0;
  }
  return t;
}

/* ---------------------------------------------------------
   SERVE SETUP (avatar positions + movement/dive state reset)
--------------------------------------------------------- */
export function resetForServe(server, serveSide) {
  isDiving = false; diveTimer = 0; diveRecoveryTimer = 0; letCollisionTimer = 0;
  playerVelocity.x = 0; playerVelocity.z = 0;
  botVelocity.x = 0; botVelocity.z = 0;
  playerFacing = 0; playerTurnRate = 0; botReactTimer = -1;
  player.rotation.set(0, 0, 0);

  const sx = serveSide === 'right' ? HALF_W - 1.0 : -HALF_W + 1.0;
  const sz = 5.36; // shortLineZ + 1.1 (kept numeric to avoid importing shortLineZ just for this)
  const rx = serveSide === 'right' ? -HALF_W / 2 : HALF_W / 2;
  const rz = LEN - 2.0;

  if (server === 'player') {
    player.position.set(sx, 0, sz + 0.4);
    bot.position.set(rx, 0, rz);
    aimTarget.x = sx * -0.4;
    aimTarget.y = SERVICE_LINE_H + 0.7;
    yaw = serveSide === 'right' ? -0.3 : 0.3;
    pitch = -0.1;
    if (isAutoShotMode) setShotType('drive');
  } else {
    bot.position.set(sx, 0, sz + 0.4);
    player.position.set(rx, 0, rz);
    yaw = serveSide === 'right' ? 0.2 : -0.2;
    pitch = -0.1;
    moveVector.x = 0;
    moveVector.y = 0;
  }
}

/* ---------------------------------------------------------
   SHOT RESOLUTION (reach / accuracy / fluke model)
   Returns null if no contact was made, otherwise a descriptor
   app.js uses to decide banners / hit-pause / screen shake:
     { hit:true, who, shotType, isFluke, chargeRatio, powerShot }
--------------------------------------------------------- */
export function attemptHit(who, forcedShotOverride, chargeRatio = 0) {
  if (ballState.status === 'dead') return null;
  const actor = who === 'player' ? player : bot;
  const diff = DIFF[DIFFICULTY];
  if (who === 'player') playerSwingT = 1; else botSwingT = 1;

  if (ballState.status === 'serving') {
    if (who !== ballState.server) return null;

    let currentExecutedShot;
    const powerMult = who === 'player' ? 1 + chargeRatio * 0.8 : 1;

    if (who === 'player') {
      let virtualTx = aimTarget.x;
      let virtualTy = Math.max(SERVICE_LINE_H + 0.1, aimTarget.y);
      currentExecutedShot = forcedShotOverride || (isAutoShotMode ? determineShotTypeFromAim(aimTarget.y, chargeRatio) : playerShotType);

      const hitSpeed = currentExecutedShot === 'lob'
        ? (virtualTy = Math.max(FRONT_H - 1.2, virtualTy), 11.5 * powerMult)
        : 16.5 * powerMult;

      virtualTx = THREE.MathUtils.clamp(virtualTx, -HALF_W - 3.25, HALF_W + 3.25);
      const finalAim = getAim3D(virtualTx, virtualTy);
      hitBallTo(finalAim.x, finalAim.y, finalAim.z, hitSpeed);
    } else {
      const tx = ballState.serveSide === 'left' ? 1.2 : -1.2;
      const ty = Math.max(FRONT_H - 1.5, SERVICE_LINE_H + 1.2 + Math.random());
      currentExecutedShot = 'lob';
      hitBallTo(tx, ty, 0, 12.5);
    }

    ballState.status = 'inplay';
    ballState.lastHitBy = who;
    ballState.bounces = 0;
    ballState.hitFrontWall = false;
    ballState.isServeShot = true;
    ballState.lastExecutedShot = currentExecutedShot;

    return { hit: true, who, shotType: currentExecutedShot, isFluke: false, chargeRatio, powerShot: false, isServe: true };
  }

  if (ballState.lastHitBy === who) return null;
  if (!ballState.hitFrontWall) return null;

  const dx = ballState.pos.x - actor.position.x;
  const dz = ballState.pos.z - actor.position.z;
  const distXZ = Math.hypot(dx, dz);
  const reach = (who === 'player' && isDiving) ? (PLAYER_REACH * 1.5) : (who === 'player' ? PLAYER_REACH : diff.reach);
  if (distXZ > reach || ballState.pos.y > 2.8) return null;

  if (ballState.isServeShot) ballState.isServeShot = false;

  let pressure = Math.max(0, Math.min(1.0, distXZ / reach));
  if (who === 'bot' && ballState.vel.length() > 13) pressure = Math.min(1.0, pressure + 0.25);

  let missRatio = 0;
  if (who === 'player') {
    missRatio = Math.max(0, Math.min(1, (distXZ - PLAYER_SWEET_SPOT) / (reach - PLAYER_SWEET_SPOT)));
    if (isDiving) missRatio = Math.min(1, missRatio + 0.35);
    if (isWinded) missRatio = Math.min(1, missRatio + 0.3);
    if (diveRecoveryTimer > 0) missRatio = Math.min(1, missRatio + 0.15);
  }

  let tx, ty, speed, currentExecutedShot;

  if (who === 'player') {
    if (forcedShotOverride) currentExecutedShot = forcedShotOverride;
    else if (isAutoShotMode) currentExecutedShot = determineShotTypeFromAim(aimTarget.y, chargeRatio);
    else currentExecutedShot = playerShotType;

    tx = aimTarget.x;
    if (currentExecutedShot === 'drop') { ty = TIN_H + 0.15; speed = 10.5 + Math.random() * 1.5; }
    else if (currentExecutedShot === 'lob') { ty = FRONT_H - 0.9; speed = 10.5 + Math.random() * 1.5; }
    else if (currentExecutedShot === 'kill') { ty = TIN_H + 0.08; speed = 12.0 * (1 + chargeRatio * 0.95); }
    else { ty = aimTarget.y; speed = 10.5 * (1 + chargeRatio * 0.95); }

    let errorSpread = missRatio * missRatio * 2.4;
    if (chargeRatio > 0.8) errorSpread *= 0.6;

    tx += (Math.random() - 0.5) * errorSpread;
    ty += (Math.random() - 0.5) * (errorSpread * 0.9);
    speed *= (1.0 - (missRatio * 0.2));

    if (missRatio > 0 && Math.random() < missRatio * 0.5) {
      if (Math.random() < 0.5) ty = TIN_H - 0.15 - Math.random() * 0.3;
      else ty += (Math.random() < 0.5 ? 1 : -1) * (0.8 + missRatio * 1.3);
    }

    tx = THREE.MathUtils.clamp(tx, -HALF_W - 3.25, HALF_W + 3.25);
    ty = THREE.MathUtils.clamp(ty, -0.6, FRONT_H + 1.5);

    const finalAim = getAim3D(tx, ty);
    hitBallTo(finalAim.x, finalAim.y, finalAim.z, speed);
  } else {
    const playerDeep = player.position.z > LEN - 2.6;
    const playerShort = player.position.z < 3.46; // shortLineZ - 0.8
    const botUpFront = ballState.pos.z < 4.2;
    const tacticalChance = { easy: 0.35, medium: 0.7, hard: 1.0 }[DIFFICULTY];
    const readsPlayer = Math.random() < tacticalChance;

    if (readsPlayer && playerDeep && botUpFront) currentExecutedShot = 'drop';
    else if (readsPlayer && playerShort) currentExecutedShot = 'lob';
    else if (botUpFront && ballState.pos.y < 1.2 && Math.random() < 0.2 + diff.speed * 0.03) currentExecutedShot = 'kill';
    else currentExecutedShot = 'drive';

    const playerThreat = player.position.x > 0 ? -1 : 1;
    const targetXOffset = HALF_W - (0.3 + pressure * 0.6);
    tx = playerThreat * targetXOffset;

    if (currentExecutedShot === 'drop') { ty = TIN_H + 0.16; speed = 10.0 + diff.speed * 0.2 + Math.random() * 1.2; }
    else if (currentExecutedShot === 'lob') { ty = FRONT_H - 0.95; speed = 9.8 + diff.speed * 0.2 + Math.random() * 1.4; }
    else if (currentExecutedShot === 'kill') { ty = TIN_H + 0.09; speed = 11.0 + diff.speed * 0.3; tx *= 0.55; }
    else { ty = (Math.random() < 0.28 ? 1.0 + Math.random() * 0.5 : 2.5 + Math.random() * 0.8); speed = 8.5 + diff.speed * 0.85; }

    let errorSpread = diff.aimErr * (0.2 + pressure * 2.0);
    tx += (Math.random() - 0.5) * errorSpread;
    ty += (Math.random() - 0.5) * (errorSpread * 0.6);
    speed *= (1.0 - (pressure * 0.15));

    const currentFaultChance = diff.faultChance * (0.2 + pressure * 3.5);
    if (Math.random() < currentFaultChance) ty = TIN_H - 0.15;

    tx = THREE.MathUtils.clamp(tx, -HALF_W + 0.2, HALF_W - 0.2);
    ty = THREE.MathUtils.clamp(ty, 0.1, FRONT_H - 0.3);

    hitBallTo(tx, ty, 0, speed);
  }

  let isFluke = false;
  if (Math.random() < 0.04) {
    isFluke = true;
    speed *= 1.30;
    let flukeTx = (who === 'player' ? aimTarget.x : tx) + (Math.random() - 0.5) * 1.5;
    let flukeTy = ty + (Math.random() - 0.5) * 0.8;
    flukeTx = THREE.MathUtils.clamp(flukeTx, -HALF_W - 3.25, HALF_W + 3.25);
    flukeTy = THREE.MathUtils.clamp(flukeTy, TIN_H + 0.1, FRONT_H - 0.1);
    const flukeAim = getAim3D(flukeTx, flukeTy);
    hitBallTo(flukeAim.x, flukeAim.y, flukeAim.z, speed);
  }

  ballState.lastHitBy = who;
  ballState.bounces = 0;
  ballState.hitFrontWall = false;
  ballState.lastExecutedShot = currentExecutedShot;

  const powerShot = who === 'player' && chargeRatio > 0.75 && (currentExecutedShot === 'drive' || currentExecutedShot === 'kill');
  return { hit: true, who, shotType: currentExecutedShot, isFluke, chargeRatio, powerShot, isServe: false };
}

export function startCharge() {
  if (charging) return;
  charging = true;
  chargeStart = performance.now();
}

export function releaseCharge() {
  if (!charging) return null;
  charging = false;
  const chargeRatio = Math.min((performance.now() - chargeStart) / MAX_CHARGE_MS, 1);
  return attemptHit('player', null, chargeRatio);
}

/* ---------------------------------------------------------
   DIVE
--------------------------------------------------------- */
export function triggerDive() {
  if (isDiving || diveRecoveryTimer > 0) return false;
  if (ballState.status === 'dead' || ballState.status === 'serving') return false;
  if (playerStamina < 20) return false;

  playerStamina -= 35;
  isDiving = true;
  diveTimer = DIVE_SLIDE_DUR;

  const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  const fwdX = sinY, fwdZ = -cosY, rightX = cosY, rightZ = sinY;
  let dx = 0, dz = 0;

  if (camMode === '3rd') {
    if (keys['w']) dz -= 1; if (keys['s']) dz += 1;
    if (keys['d']) dx += 1; if (keys['a']) dx -= 1;
  } else {
    if (keys['w']) { dx += fwdX; dz += fwdZ; }
    if (keys['s']) { dx -= fwdX; dz -= fwdZ; }
    if (keys['d']) { dx += rightX; dz += rightZ; }
    if (keys['a']) { dx -= rightX; dz -= rightZ; }
  }

  if (moveVector.x !== 0 || moveVector.y !== 0) {
    if (camMode === '3rd') { dx += moveVector.x; dz += moveVector.y; }
    else { dx += fwdX * (-moveVector.y) + rightX * moveVector.x; dz += fwdZ * (-moveVector.y) + rightX * moveVector.x; }
  }

  const length = Math.hypot(dx, dz);
  if (length > 0) diveDir.set(dx / length, 0, dz / length);
  else if (camMode === '1st') diveDir.copy(currentForward().setY(0).normalize());
  else diveDir.set(0, 0, -1);

  addScuffMark(player.position, diveDir);
  return true;
}

/* ---------------------------------------------------------
   PLAYER MOVEMENT (call every frame with RAW, un-time-scaled dt)
--------------------------------------------------------- */
export function updatePlayer(dt) {
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  const fwdX = sinY, fwdZ = -cosY, rightX = cosY, rightZ = sinY;
  let inputX = 0, inputZ = 0;

  if (ballState.status !== 'serving') {
    if (camMode === '3rd') {
      if (keys['w']) inputZ -= 1; if (keys['s']) inputZ += 1;
      if (keys['d']) inputX += 1; if (keys['a']) inputX -= 1;
    } else {
      if (keys['w']) { inputX += fwdX; inputZ += fwdZ; }
      if (keys['s']) { inputX -= fwdX; inputZ -= fwdZ; }
      if (keys['d']) { inputX += rightX; inputZ += rightZ; }
      if (keys['a']) { inputX -= rightX; inputZ -= rightZ; }
    }

    if (moveVector.x !== 0 || moveVector.y !== 0) {
      if (camMode === '3rd') { inputX += moveVector.x; inputZ += moveVector.y; }
      else { inputX += fwdX * (-moveVector.y) + rightX * moveVector.x; inputZ += fwdZ * (-moveVector.y) + rightX * moveVector.x; }
    }
  }

  const length = Math.hypot(inputX, inputZ);
  if (length > 1) { inputX /= length; inputZ /= length; }

  const isSprinting = keys['shift'] && length > 0.1 && !isWinded;
  if (isSprinting) playerStamina -= 22 * dt;
  else if (length > 0.8) playerStamina -= 8 * dt;
  else if (length < 0.5) playerStamina += 18 * dt;
  playerStamina = THREE.MathUtils.clamp(playerStamina, 0, 100);

  if (playerStamina <= 0) isWinded = true;
  if (playerStamina >= 30) isWinded = false;

  let bonked = false;
  let currentSpeed = 0;

  if (isDiving) {
    diveTimer -= dt;
    const diveLungeSpeed = PLAYER_SPEED * 1.85;
    player.position.x = THREE.MathUtils.clamp(player.position.x + diveDir.x * diveLungeSpeed * dt, -HALF_W + 0.35, HALF_W - 0.35);
    player.position.z = THREE.MathUtils.clamp(player.position.z + diveDir.z * diveLungeSpeed * dt, 0.4, LEN - 0.4);
    player.position.y = 0;

    if (player.userData.fallback) {
      player.userData.fallback.rotation.z = Math.sin((diveTimer / DIVE_SLIDE_DUR) * Math.PI) * -1.0;
      player.userData.fallback.rotation.x = Math.sin((diveTimer / DIVE_SLIDE_DUR) * Math.PI) * 0.45;
    }
    if (Math.random() < 0.6) spawnSparks(player.position.clone().setY(0.05), 1, 0xbfb6a5, diveDir);

    if (diveTimer <= 0) {
      isDiving = false;
      diveRecoveryTimer = 1.1;
      if (player.userData.fallback) { player.userData.fallback.rotation.z = 0; player.userData.fallback.rotation.x = 0; }
    }
    playerVelocity.x = 0; playerVelocity.z = 0;
  } else {
    if (diveRecoveryTimer > 0) diveRecoveryTimer -= dt;
    let currentMaxSpeed = PLAYER_SPEED;
    if (diveRecoveryTimer > 0 || isWinded) currentMaxSpeed = PLAYER_SPEED * 0.65;
    else if (isSprinting) currentMaxSpeed = PLAYER_SPEED * 1.4;

    if (length > 0.01) currentMaxSpeed *= Math.max(0.15, Math.min(length, 1.0));

    const accelRate = 68.0;
    const velLen = Math.hypot(playerVelocity.x, playerVelocity.z);
    if (velLen > 0.05 && length > 0.05) {
      const dot = (playerVelocity.x / velLen) * (inputX / length) + (playerVelocity.z / velLen) * (inputZ / length);
      if (dot < -0.15) {
        const turnKill = Math.max(0, 1 - (-dot) * 14 * dt);
        playerVelocity.x *= turnKill; playerVelocity.z *= turnKill;
      }
    }

    playerVelocity.x += inputX * accelRate * dt;
    playerVelocity.z += inputZ * accelRate * dt;
    playerVelocity.x -= playerVelocity.x * 9.5 * dt;
    playerVelocity.z -= playerVelocity.z * 9.5 * dt;

    currentSpeed = Math.hypot(playerVelocity.x, playerVelocity.z);

    if (player.userData.scuffCooldown > 0) player.userData.scuffCooldown -= dt;
    const curVelVector = new THREE.Vector3(playerVelocity.x, 0, playerVelocity.z);
    if (player.userData.scuffCooldown <= 0 && player.userData.prevVel.length() > 2.0 && curVelVector.length() > 2.0) {
      const dot = player.userData.prevVel.clone().normalize().dot(curVelVector.clone().normalize());
      if (dot < -0.2) {
        addScuffMark(player.position, player.userData.prevVel);
        player.userData.scuffCooldown = 0.5;
      }
    }
    player.userData.prevVel.copy(curVelVector);

    if (currentSpeed > currentMaxSpeed) {
      const scale = currentMaxSpeed / currentSpeed;
      playerVelocity.x *= scale; playerVelocity.z *= scale; currentSpeed = currentMaxSpeed;
    }

    if (length === 0 && currentSpeed < 0.15) { playerVelocity.x = 0; playerVelocity.z = 0; currentSpeed = 0; }

    let nextX = player.position.x + playerVelocity.x * dt;
    let nextZ = player.position.z + playerVelocity.z * dt;

    if (nextX > HALF_W - 0.35) { nextX = HALF_W - 0.35; if (playerVelocity.x > 0.5) bonked = true; playerVelocity.x = 0; }
    else if (nextX < -HALF_W + 0.35) { nextX = -HALF_W + 0.35; if (playerVelocity.x < -0.5) bonked = true; playerVelocity.x = 0; }
    if (nextZ > LEN - 0.4) { nextZ = LEN - 0.4; if (playerVelocity.z > 0.5) bonked = true; playerVelocity.z = 0; }
    else if (nextZ < 0.4) { nextZ = 0.4; if (playerVelocity.z < -0.5) bonked = true; playerVelocity.z = 0; }

    player.position.x = nextX; player.position.z = nextZ;

    if (currentSpeed > 0.5) player.position.y = Math.abs(Math.sin(performance.now() * 0.001 * 22)) * 0.12;
    else player.position.y = THREE.MathUtils.lerp(player.position.y, 0, 15 * dt);
  }

  if (camMode === '3rd') {
    if (length > 0) {
      const targetFacing = Math.atan2(inputX, -inputZ);
      let diff = targetFacing - playerFacing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const turnTargetSpeed = Math.min(MAX_TURN_RATE, Math.abs(diff) * 6 + 1.5);
      if (playerTurnRate < turnTargetSpeed) playerTurnRate = Math.min(turnTargetSpeed, playerTurnRate + 18 * dt);
      else playerTurnRate = Math.max(turnTargetSpeed, playerTurnRate - 18 * dt);
      const step = Math.sign(diff) * Math.min(Math.abs(diff), playerTurnRate * dt);
      playerFacing += step;
    } else {
      playerTurnRate = Math.max(0, playerTurnRate - 18 * dt);
    }
    player.rotation.y = playerFacing;
  } else {
    player.rotation.y = yaw;
  }

  playerSwingT = updateSwing(player, playerSwingT, dt, 1);
  dropShadow(playerShadow, player);

  return { bonked };
}

/* ---------------------------------------------------------
   BOT AI (call every frame with worldDt, i.e. time-scaled dt)
--------------------------------------------------------- */
export function updateBot(dt) {
  if (ballState.status === 'serving') {
    bot.rotation.y = Math.PI;
    if (bot.userData.racketPivot) bot.userData.racketPivot.rotation.set(0, 0, 0);
    dropShadow(botShadow, bot);
    return null;
  }

  const diff = DIFF[DIFFICULTY];
  let targetX = ballState.pos.x, targetZ = ballState.pos.z;

  if (ballState.status === 'inplay' && ballState.vel.y < 0) {
    const a = -0.5 * G, b = ballState.vel.y, c = ballState.pos.y - 0.9;
    const disc = b * b - 4 * a * c;
    if (disc > 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t > 0 && t < 1.4) { targetX = ballState.pos.x + ballState.vel.x * t; targetZ = ballState.pos.z + ballState.vel.z * t; }
    }
  }
  if (ballState.lastHitBy === 'bot') { targetX = 0; targetZ = 5.06; /* shortLineZ + 0.8 */ }
  targetX = THREE.MathUtils.clamp(targetX, -HALF_W + 0.35, HALF_W - 0.35);
  targetZ = THREE.MathUtils.clamp(targetZ, 0.4, LEN - 0.4);

  const dx = targetX - bot.position.x, dz = targetZ - bot.position.z;
  const dist = Math.hypot(dx, dz);

  let moveDirX = 0, moveDirZ = 0;
  if (dist > 0.05) { moveDirX = dx / dist; moveDirZ = dz / dist; }

  botVelocity.x += moveDirX * 60.0 * dt;
  botVelocity.z += moveDirZ * 60.0 * dt;
  botVelocity.x -= botVelocity.x * 12.0 * dt;
  botVelocity.z -= botVelocity.z * 12.0 * dt;

  let botCurrentSpeed = Math.hypot(botVelocity.x, botVelocity.z);
  if (botCurrentSpeed > diff.speed) {
    const scale = diff.speed / botCurrentSpeed;
    botVelocity.x *= scale; botVelocity.z *= scale; botCurrentSpeed = diff.speed;
  }
  if (dist <= 0.05 && botCurrentSpeed < 0.2) { botVelocity.x = 0; botVelocity.z = 0; botCurrentSpeed = 0; }

  bot.position.x = THREE.MathUtils.clamp(bot.position.x + botVelocity.x * dt, -HALF_W + 0.35, HALF_W - 0.35);
  bot.position.z = THREE.MathUtils.clamp(bot.position.z + botVelocity.z * dt, 0.4, LEN - 0.4);

  if (botCurrentSpeed > 0.5) bot.position.y = Math.abs(Math.sin(performance.now() * 0.001 * 22)) * 0.12;
  else bot.position.y = THREE.MathUtils.lerp(bot.position.y, 0, 15 * dt);

  bot.rotation.y = Math.PI;
  botSwingT = updateSwing(bot, botSwingT, dt, -1);

  let hitResult = null;
  if (ballState.status === 'inplay' && ballState.lastHitBy === 'player') {
    const rx = ballState.pos.x - bot.position.x, rz = ballState.pos.z - bot.position.z;
    const targetDist = Math.hypot(rx, rz);
    if (targetDist <= diff.reach && ballState.pos.y < 2.5) {
      if (botReactTimer < 0) botReactTimer = diff.reactDelay * (0.85 + Math.random() * 0.3);
      botReactTimer -= dt;
      if (botReactTimer <= 0) hitResult = attemptHit('bot');
    }
  } else {
    botReactTimer = -1;
  }

  dropShadow(botShadow, bot);
  return hitResult;
}

/* ---------------------------------------------------------
   PLAYER/BOT COLLISION + LET-INTERFERENCE TRACKING
   (call every frame with worldDt, i.e. time-scaled dt)
--------------------------------------------------------- */
export function resolvePlayerCollisions(dt) {
  if (ballState.status === 'serving') return;
  if (letCollisionTimer > 0) letCollisionTimer -= dt;

  const dx = player.position.x - bot.position.x;
  const dz = player.position.z - bot.position.z;
  const dist = Math.hypot(dx, dz);
  const minDist = 0.65;

  if (dist > 0 && dist < minDist + 0.3) {
    const strikerObj = ballState.lastHitBy === 'player' ? bot : player;
    const distToBall = Math.hypot(strikerObj.position.x - ballState.pos.x, strikerObj.position.z - ballState.pos.z);
    if (distToBall < 5.0 && ballState.hitFrontWall) letCollisionTimer = 1.5;
  }

  if (dist > 0 && dist < minDist) {
    const overlap = minDist - dist, nx = dx / dist, nz = dz / dist;
    player.position.x += nx * overlap * 0.5; player.position.z += nz * overlap * 0.5;
    bot.position.x -= nx * overlap * 0.5; bot.position.z -= nz * overlap * 0.5;

    playerVelocity.x *= 0.85; playerVelocity.z *= 0.85;
    botVelocity.x *= 0.85; botVelocity.z *= 0.85;

    player.position.x = THREE.MathUtils.clamp(player.position.x, -HALF_W + 0.35, HALF_W - 0.35);
    player.position.z = THREE.MathUtils.clamp(player.position.z, 0.4, LEN - 0.4);
    bot.position.x = THREE.MathUtils.clamp(bot.position.x, -HALF_W + 0.35, HALF_W - 0.35);
    bot.position.z = THREE.MathUtils.clamp(bot.position.z, 0.4, LEN - 0.4);
  }
}

/** Returns true if requestLet() should be a valid let claim (i.e. ball wasn't already the player's own hit). */
export function canRequestLet() {
  return ballState.status === 'inplay' && ballState.lastHitBy !== 'player';
}
