/* ===========================================================
   physics.js
   Ball simulation matching the reference implementation exactly:
   gravity + exponential air-drag integration, axis-by-axis wall
   collision resolution (floor / side / back / front), serve
   legality (short serve, wrong box, below service line), tin
   faults, nick detection, double-bounce/no-return scoring, the
   inverse-projectile "aim at this point on the wall" solver used
   by shots, and all ball visuals (mesh, glow, shadow, trail,
   hit sparks).

   Depends on the global THREE namespace (r128) and on shared
   geometry/materials + dimension constants from court.js.

   Consumed by app.js via:
     initPhysics(scene);                 // once
     stepPhysics(dt) -> events[]         // every frame (worldDt, i.e. time-scaled)
     hitBallTo(tx, ty, tz, speed)        // from player.js's shot resolution
   player.js reads/writes `ballState` directly (it's a shared
   mutable object) to record who hit the ball, shot type, etc.
=========================================================== */

import { HALF_W, LEN, FRONT_H, TIN_H, SERVICE_LINE_H, BACK_H, shortLineZ, shadowMat } from './court.js';

/* ---------------------------------------------------------
   CONSTANTS
--------------------------------------------------------- */
export const BALL_R = 0.021;
export const NICK_HEIGHT = 0.10;
export const G = 9.81;
export const AIR_DRAG = 0.12;
export const FRICTION_FLOOR = 0.90;
export const FRICTION_WALL = 0.95;
export const FRONT_WALL_Y_DAMP = 0.2;
const MAX_ARC_PEAK = 5.5;

export let currentRestFloor = 0.46;
export let currentRestWall = 0.80;
export function resetRestitution() {
  currentRestFloor = 0.46;
  currentRestWall = 0.80;
}

/** Shot-type → accent color, shared with player.js (avoids a circular import). */
export const shotColors = { drive: 0xc8ff3d, drop: 0x3ba3ff, lob: 0xffb83b, kill: 0xff4a40 };

/* ---------------------------------------------------------
   BALL STATE (shared mutable object — player.js writes
   lastHitBy / lastExecutedShot / isServeShot directly)
--------------------------------------------------------- */
export const ballState = {
  pos: new THREE.Vector3(1.2, 1.0, 5.0),
  vel: new THREE.Vector3(0, 0, 0),
  bounces: 0,
  lastHitBy: null,
  status: 'serving',       // 'serving' | 'inplay' | 'dead'
  server: 'player',
  serveSide: 'right',
  hitFrontWall: false,
  isServeShot: false,
  lastExecutedShot: 'drive'
};

/** Repositions the ball for a serve. Player/bot avatar repositioning is player.js's job. */
export function resetBallForServe(server, serveSide) {
  ballState.server = server;
  ballState.status = 'serving';
  ballState.lastHitBy = null;
  ballState.bounces = 0;
  ballState.hitFrontWall = false;
  ballState.isServeShot = false;
  resetRestitution();

  ballState.serveSide = serveSide;
  const sx = serveSide === 'right' ? HALF_W - 1.0 : -HALF_W + 1.0;
  const sz = shortLineZ + 1.1;
  ballState.pos.set(sx, 1.0, sz);
  ballState.vel.set(0, 0, 0);
}

/* ---------------------------------------------------------
   INVERSE PROJECTILE SOLVER
   Given a target point on/near a wall and a desired shot speed,
   solves the initial velocity (accounting for the same
   exponential-decay air drag model stepPhysics integrates with)
   so the ball actually arrives at that point.
--------------------------------------------------------- */
export function hitBallTo(tx, ty, tz, speed) {
  speed *= 0.82;
  const dx = tx - ballState.pos.x;
  const dz = tz - ballState.pos.z;
  const distXZ = Math.max(0.3, Math.hypot(dx, dz));
  const y0 = ballState.pos.y;
  const k = AIR_DRAG;
  const timeNoDrag = distXZ / speed;
  const dragTerm = (k * distXZ) / speed;

  let vx, vz, vy, time;
  if (dragTerm >= 0.999) {
    time = timeNoDrag;
    vx = dx / time;
    vz = dz / time;
    vy = (ty - y0 + 0.5 * G * time * time) / time;
  } else {
    time = -Math.log(1 - dragTerm) / k;
    vx = (dx / distXZ) * speed;
    vz = (dz / distXZ) * speed;
    vy = (ty - y0 + (G / k) * time) / timeNoDrag - G / k;
  }

  if (vy > 0) {
    const peakEstimate = y0 + (vy * vy) / (2 * G);
    if (peakEstimate > MAX_ARC_PEAK) vy = Math.sqrt(Math.max(0, 2 * G * (MAX_ARC_PEAK - y0)));
  }

  ballState.vel.set(vx, vy, vz);
  return ballState.vel.length();
}

/* ---------------------------------------------------------
   COLLISION STEP
   Mirrors the reference's stepBall() exactly: a single forward
   integration followed by sequential axis collision checks
   against the already-advanced position. Returns an array of
   events for app.js to turn into sound/banners/scoring:
     { type:'wallBounce', pos }
     { type:'nick', pos }
     { type:'fault'|'point', winner:'player'|'bot', reason, sound? }
--------------------------------------------------------- */
function bounceOff(events, axis, elasticity, friction, pos, sparkN = 5, yOverride = null) {
  ballState.vel[axis] *= -elasticity;
  const others = axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['x', 'z'] : ['x', 'y'];
  others.forEach(a => {
    ballState.vel[a] *= (a === 'y' && yOverride !== null) ? yOverride : friction;
  });
  events.push({ type: 'wallBounce', pos: pos.clone(), sparkColor: shotColors[ballState.lastExecutedShot] || 0xc8ff3d, sparkCount: sparkN });
}

export function stepPhysics(dt) {
  const events = [];

  if (ballState.status === 'serving') {
    ballState.pos.y = 1.0 + Math.sin(performance.now() * 0.005) * 0.04;
    if (ball) ball.position.copy(ballState.pos);
    return events;
  }
  if (ballState.status !== 'inplay') return events;

  ballState.vel.y -= G * dt;
  ballState.vel.multiplyScalar(Math.max(0, 1 - AIR_DRAG * dt));

  const nextPos = ballState.pos.clone().addScaledVector(ballState.vel, dt);

  // --- Floor ---
  if (nextPos.y <= BALL_R) {
    nextPos.y = BALL_R;
    bounceOff(events, 'y', currentRestFloor, FRICTION_FLOOR, nextPos);
    ballState.bounces++;
    events.push({ type: 'floorBounce', pos: nextPos.clone() });

    if (!ballState.hitFrontWall) {
      const winner = ballState.lastHitBy === 'player' ? 'bot' : 'player';
      events.push({ type: 'fault', winner, reason: 'FAULT - Floor before front wall' });
      return events;
    }

    if (ballState.isServeShot && ballState.bounces === 1) {
      if (nextPos.z <= shortLineZ) {
        const winner = ballState.lastHitBy === 'player' ? 'bot' : 'player';
        events.push({ type: 'fault', winner, reason: 'FAULT - Serve too short' });
        return events;
      }
      const isLandingRight = nextPos.x > 0;
      const isServeRight = ballState.serveSide === 'right';
      if ((isServeRight && isLandingRight) || (!isServeRight && !isLandingRight)) {
        const winner = ballState.lastHitBy === 'player' ? 'bot' : 'player';
        events.push({ type: 'fault', winner, reason: 'FAULT - Wrong box' });
        return events;
      }
      ballState.isServeShot = false;
    }

    if (ballState.bounces >= 2) {
      const winner = ballState.lastHitBy === 'player' ? 'player' : 'bot';
      events.push({ type: 'point', winner, reason: 'POINT - Double Bounce!' });
      return events;
    }
  }

  // --- Side walls (with sloped out-line + nick detection) ---
  if (Math.abs(nextPos.x) >= HALF_W - BALL_R) {
    nextPos.x = Math.sign(nextPos.x) * (HALF_W - BALL_R);
    const progressZ = THREE.MathUtils.clamp(nextPos.z / LEN, 0, 1);
    if (nextPos.y > FRONT_H - (FRONT_H - BACK_H) * progressZ) {
      const winner = ballState.lastHitBy === 'player' ? 'bot' : 'player';
      events.push({ type: 'fault', winner, reason: 'OUT - Boundary line' });
      return events;
    }
    if (nextPos.y <= NICK_HEIGHT && !ballState.isServeShot) {
      events.push({ type: 'nick', pos: nextPos.clone() });
      ballState.vel.y = Math.random() * 0.8;
      ballState.vel.x *= -0.15;
      ballState.vel.z *= 0.6;
    } else {
      const incidenceAngle = Math.atan2(Math.abs(ballState.vel.z), Math.abs(ballState.vel.x));
      const normalizedAngle = incidenceAngle / (Math.PI / 2);
      const dynamicFriction = THREE.MathUtils.lerp(0.70, 0.98, normalizedAngle);
      const dynamicElasticity = THREE.MathUtils.lerp(0.70, 0.85, normalizedAngle);
      bounceOff(events, 'x', dynamicElasticity, dynamicFriction, nextPos);
    }
  }

  // --- Back wall (glass) ---
  if (nextPos.z >= LEN - BALL_R) {
    if (nextPos.y > BACK_H) {
      const winner = ballState.lastHitBy === 'player' ? 'bot' : 'player';
      events.push({ type: 'fault', winner, reason: 'OUT - Over back wall' });
      return events;
    }
    nextPos.z = LEN - BALL_R;
    bounceOff(events, 'z', currentRestWall, FRICTION_WALL, nextPos);
  }

  // --- Front wall / tin ---
  if (nextPos.z <= BALL_R) {
    if (nextPos.y > FRONT_H) {
      const winner = ballState.lastHitBy === 'player' ? 'bot' : 'player';
      events.push({ type: 'fault', winner, reason: 'OUT - Above front line' });
      return events;
    }
    if (nextPos.y <= TIN_H) {
      const winner = ballState.lastHitBy === 'player' ? 'bot' : 'player';
      events.push({ type: 'fault', winner, reason: 'TIN FAULT!', sound: 'tin' });
      return events;
    }
    if (ballState.isServeShot && nextPos.y < SERVICE_LINE_H) {
      const winner = ballState.server === 'player' ? 'bot' : 'player';
      events.push({ type: 'fault', winner, reason: 'FAULT - Below service line' });
      return events;
    }
    nextPos.z = BALL_R;
    bounceOff(events, 'z', currentRestWall, FRICTION_WALL, nextPos, 12, FRONT_WALL_Y_DAMP);
    ballState.hitFrontWall = true;
  }

  ballState.pos.copy(nextPos);
  if (ball) { ball.position.copy(ballState.pos); ballGlow.position.copy(ballState.pos); }

  return events;
}

/* ---------------------------------------------------------
   BALL VISUALS (mesh, glow light, floor shadow)
--------------------------------------------------------- */
export const ballMat = new THREE.MeshStandardMaterial({
  color: 0x0d0d0d,
  emissive: 0x0a0a0a,
  roughness: 0.5,
  metalness: 0.05
});

let ball = null;
let ballGlow = null;
let ballShadow = null;

export function initBallVisuals(scene) {
  ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 3.5, 20, 20), ballMat);
  ball.castShadow = true;
  scene.add(ball);

  ballGlow = new THREE.PointLight(0xff8c1a, 0.6, 7);
  scene.add(ballGlow);

  ballShadow = new THREE.Mesh(new THREE.RingGeometry(0, BALL_R * 3.5, 16), shadowMat);
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.y = 0.001;
  scene.add(ballShadow);

  return { ball, ballGlow, ballShadow };
}

function updateBallShadow() {
  if (!ballShadow) return;
  if (ballState.status === 'inplay') {
    ballShadow.position.set(ballState.pos.x, 0.001, ballState.pos.z);
    const heightFactor = Math.max(0, 1 - ballState.pos.y / FRONT_H);
    ballShadow.material.opacity = heightFactor * 0.7;
    ballShadow.scale.setScalar(1 + ballState.pos.y * 0.3);
  } else {
    ballShadow.material.opacity = 0;
  }
}

/* ---------------------------------------------------------
   BALL MOTION TRAIL
--------------------------------------------------------- */
const TRAIL_LEN = 14;
export const trailDots = [];
const trailHistory = [];

export function initBallTrail(scene) {
  for (let i = 0; i < TRAIL_LEN; i++) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R * 1.6, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0, depthWrite: false })
    );
    dot.visible = false;
    scene.add(dot);
    trailDots.push(dot);
  }
  return trailDots;
}

function updateBallTrail() {
  if (ballState.status === 'inplay') {
    trailHistory.unshift(ballState.pos.clone());
    if (trailHistory.length > TRAIL_LEN) trailHistory.length = TRAIL_LEN;
  } else {
    trailHistory.length = 0;
  }

  for (let i = 0; i < TRAIL_LEN; i++) {
    const dot = trailDots[i];
    const hp = trailHistory[i];
    if (hp) {
      dot.visible = true;
      dot.position.copy(hp);
      const t = 1 - i / TRAIL_LEN;
      dot.material.opacity = t * 0.55;
      dot.scale.setScalar(0.35 + t * 0.65);
    } else {
      dot.visible = false;
    }
  }
}

/* ---------------------------------------------------------
   HIT SPARK PARTICLES
--------------------------------------------------------- */
const sparkCount = 60;
const sparksGeo = new THREE.BufferGeometry();
const sparkPositions = new Float32Array(sparkCount * 3);
const sparkVelocities = [];
const sparkColors = new Float32Array(sparkCount * 3);

for (let i = 0; i < sparkCount; i++) {
  sparkPositions[i * 3 + 1] = -999;
  sparkVelocities.push(new THREE.Vector3(0, 0, 0));
  sparkColors[i * 3] = 0.78;
  sparkColors[i * 3 + 1] = 0.8;
  sparkColors[i * 3 + 2] = 0.2;
}
sparksGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
sparksGeo.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));

const sparkSystem = new THREE.Points(
  sparksGeo,
  new THREE.PointsMaterial({
    size: 0.065,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending
  })
);

export function initSparks(scene) {
  scene.add(sparkSystem);
  return sparkSystem;
}

let activeSparkIndex = 0;

/**
 * @param {THREE.Vector3} origin  world-space spawn point
 * @param {number} numSparks
 * @param {number} colorHex
 * @param {THREE.Vector3|null} kickDir  optional directional bias (e.g. a dive direction)
 */
export function spawnSparks(origin, numSparks = 10, colorHex = 0xc8ff3d, kickDir = null) {
  const positions = sparkSystem.geometry.attributes.position.array;
  const colors = sparkSystem.geometry.attributes.color.array;
  const col = new THREE.Color(colorHex);

  for (let i = 0; i < numSparks; i++) {
    const idx = (activeSparkIndex + i) % sparkCount;
    positions[idx * 3] = origin.x;
    positions[idx * 3 + 1] = origin.y;
    positions[idx * 3 + 2] = origin.z;

    colors[idx * 3] = col.r;
    colors[idx * 3 + 1] = col.g;
    colors[idx * 3 + 2] = col.b;

    if (kickDir) {
      sparkVelocities[idx].set(
        (Math.random() - 0.5) * 1.5 - kickDir.x * 2,
        Math.random() * 0.8 + 0.1,
        (Math.random() - 0.5) * 1.5 - kickDir.z * 2
      );
    } else {
      sparkVelocities[idx].set(
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.4) * 4 + 1.5,
        (Math.random() - 0.5) * 4
      );
    }
  }

  sparkSystem.geometry.attributes.position.needsUpdate = true;
  sparkSystem.geometry.attributes.color.needsUpdate = true;
  activeSparkIndex = (activeSparkIndex + numSparks) % sparkCount;
}

function updateSparks(dt) {
  const positions = sparkSystem.geometry.attributes.position.array;
  for (let i = 0; i < sparkCount; i++) {
    if (positions[i * 3 + 1] < -50) continue;
    positions[i * 3] += sparkVelocities[i].x * dt;
    positions[i * 3 + 1] += sparkVelocities[i].y * dt;
    positions[i * 3 + 2] += sparkVelocities[i].z * dt;
    sparkVelocities[i].y -= 9.8 * dt;
    sparkVelocities[i].multiplyScalar(0.94);
    if (positions[i * 3 + 1] <= 0.01) positions[i * 3 + 1] = -999;
  }
  sparkSystem.geometry.attributes.position.needsUpdate = true;
}

/* ---------------------------------------------------------
   PUBLIC INIT / PER-FRAME UPDATE
--------------------------------------------------------- */
export function initPhysics(scene) {
  initBallVisuals(scene);
  initBallTrail(scene);
  initSparks(scene);
}

/**
 * Runs one physics step (at world/time-scaled dt), spawns sparks
 * for any wall bounces / nicks that occurred, syncs the trail and
 * ball shadow, advances spark particles, and returns the frame's
 * events for app.js to turn into sound/banners/scoring.
 */
export function updatePhysics(dt) {
  const events = stepPhysics(dt);

  for (const ev of events) {
    if (ev.type === 'wallBounce') {
      spawnSparks(ev.pos, ev.sparkCount, ev.sparkColor);
    } else if (ev.type === 'nick') {
      spawnSparks(ev.pos, 22, 0xffffff);
    }
  }

  updateBallTrail();
  updateBallShadow();
  updateSparks(dt);
  return events;
}
