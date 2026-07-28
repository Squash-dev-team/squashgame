/* ===========================================================
   court.js
   Static 3D world: court geometry, materials, wall/floor
   textures, scuff-mark decals, lighting, and crowd/audience.

   Depends on the global THREE namespace (loaded via the
   three.js CDN <script> tag in index.html, r128).

   Consumed by app.js via:
     import { createCourt, HALF_W, LEN, ... } from './court.js';
     const court = createCourt(scene);

   physics.js and player.js pull shared materials/geometry
   (shadowMat, shadowGeo) and the scuff-mark helpers from here
   so ball/player shadows and skid marks render consistently
   with the court surface.
=========================================================== */

/* ---------------------------------------------------------
   COURT DIMENSION CONSTANTS
   (World Squash Federation standard singles court, in meters)
--------------------------------------------------------- */
export const HALF_W = 3.2;
export const LEN = 9.75;
export const FRONT_H = 4.57;
export const TIN_H = 0.48;
export const SERVICE_LINE_H = 1.78;
export const BACK_H = 2.13;
export const shortLineZ = 4.26;

/* ---------------------------------------------------------
   SHARED MATERIALS & GEOMETRY
   Exported so other modules (physics.js for the ball shadow,
   player.js for player/bot shadows) can reuse the exact same
   instances instead of re-creating duplicate materials.
--------------------------------------------------------- */
export const shadowMat = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.55,
  depthWrite: false
});
export const shadowGeo = new THREE.CircleGeometry(0.32, 16);

export const wallMat = new THREE.MeshStandardMaterial({
  color: 0xf5f4f0,
  roughness: 0.55,
  metalness: 0.05,
  side: THREE.DoubleSide
});

export const tinMat = new THREE.MeshStandardMaterial({
  color: 0x3d1212,
  roughness: 0.3,
  metalness: 0.8,
  emissive: 0x220505
});

export const reticleMat = new THREE.MeshBasicMaterial({
  color: 0xee2c2c,
  transparent: true,
  opacity: 0.75,
  depthWrite: false
});

export const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.95,
  opacity: 1,
  metalness: 0.1,
  roughness: 0.05,
  transparent: true,
  side: THREE.DoubleSide
});

/* ---------------------------------------------------------
   PROCEDURAL TEXTURES
--------------------------------------------------------- */
function generateWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#dec18a';
  ctx.fillRect(0, 0, 512, 1024);

  ctx.strokeStyle = 'rgba(125, 85, 30, 0.15)';
  ctx.lineWidth = 1;
  const numPlanks = 32;
  const plankW = 512 / numPlanks;
  for (let i = 0; i <= numPlanks; i++) {
    const x = i * plankW;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1024);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
  for (let i = 0; i < numPlanks; i++) {
    const x = i * plankW;
    for (let y = 0; y < 1024; y += 128) {
      const offset = (Math.random() - 0.5) * 20;
      ctx.fillRect(x, y + offset, plankW, 1);
    }
  }

  ctx.strokeStyle = 'rgba(140, 95, 40, 0.04)';
  for (let k = 0; k < 60; k++) {
    ctx.beginPath();
    ctx.lineWidth = Math.random() * 2 + 1;
    const gx = Math.random() * 512;
    ctx.moveTo(gx, 0);
    ctx.bezierCurveTo(gx + 30, 300, gx - 30, 700, gx + 10, 1024);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function generateScuffTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'black';
  ctx.beginPath();
  ctx.ellipse(32, 64, 16, 50, 0, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 100; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 128, 2, 4);
  }

  return new THREE.CanvasTexture(canvas);
}

const floorTex = generateWoodTexture();
export const floorMat = new THREE.MeshStandardMaterial({
  map: floorTex,
  roughness: 0.45,
  metalness: 0.05
});

const scuffTex = generateScuffTexture();

/* ---------------------------------------------------------
   SCUFF MARKS (skid decals left where players plant/lunge)
   Module-level state; bound to the scene passed into
   createCourt(). physics.js and player.js call addScuffMark()
   whenever a hard stop / dive / lunge should leave a mark,
   and app.js's main loop calls updateScuffs(dt) every frame.
--------------------------------------------------------- */
let _scene = null;
const activeScuffs = [];

export function addScuffMark(pos, velVector) {
  if (!_scene) return;

  const geo = new THREE.PlaneGeometry(0.2, 0.7);
  const mat = new THREE.MeshBasicMaterial({
    map: scuffTex,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    color: 0x111111
  });
  const scuff = new THREE.Mesh(geo, mat);
  scuff.position.copy(pos);
  scuff.position.y = 0.005 + Math.random() * 0.002;
  scuff.rotation.x = -Math.PI / 2;

  if (velVector && velVector.lengthSq() > 0.01) {
    scuff.rotation.z = -Math.atan2(velVector.z, velVector.x) + Math.PI / 2;
  }

  _scene.add(scuff);
  activeScuffs.push({ mesh: scuff, life: 1.0 });
}

export function updateScuffs(dt) {
  for (let i = activeScuffs.length - 1; i >= 0; i--) {
    const scuff = activeScuffs[i];
    scuff.life -= dt * 0.35;
    if (scuff.life <= 0) {
      _scene.remove(scuff.mesh);
      scuff.mesh.geometry.dispose();
      scuff.mesh.material.dispose();
      activeScuffs.splice(i, 1);
    } else {
      scuff.mesh.material.opacity = scuff.life * 0.5;
    }
  }
}

/* ---------------------------------------------------------
   CROWD / AUDIENCE
   Module-level state populated by createCourt(). Exported
   triggerCheeringCrowd()/updateCrowd() let app.js react to
   match events (winners, match point, etc.) without owning
   the fan meshes itself.
--------------------------------------------------------- */
const fans = [];

export function triggerCheeringCrowd() {
  fans.forEach(fan => {
    fan.userData.cheerForce = 1.0 + Math.random() * 0.8;
    fan.userData.jumpTimer = Math.PI;
  });
}

/**
 * Per-frame fan animation, matching the reference exactly: fans
 * jump on a decaying sine curve after triggerCheeringCrowd() fires,
 * otherwise idle-bob continuously. Pass the `fans` array returned
 * by createCourt() and the frame's RAW (non-time-scaled) dt.
 */
export function fansAnimTick(fansArr, dt) {
  for (let i = 0; i < fansArr.length; i++) {
    const fan = fansArr[i];
    const ud = fan.userData;
    if (ud.jumpTimer > 0) {
      ud.jumpTimer -= dt * 8;
      const jumpY = Math.abs(Math.sin(ud.jumpTimer)) * 0.45 * ud.cheerForce;
      fan.position.y = ud.baseY + jumpY;
    } else {
      const bobY = Math.sin(performance.now() * 0.002 * ud.bobSpeed + ud.bobOffset) * 0.04;
      fan.position.y = ud.baseY + bobY;
    }
  }
}

/* ---------------------------------------------------------
   LINE-DRAWING HELPERS
   Bound to a courtGroup via closures created in createCourt().
--------------------------------------------------------- */
function makeLineDrawer(courtGroup) {
  return function drawLine(x1, z1, x2, z2, w = 0.05) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const geo = new THREE.BoxGeometry(length, 0.005, w);
    const mat = new THREE.MeshBasicMaterial({ color: 0xee2c2c });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x1 + x2) / 2, 0.003, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    courtGroup.add(mesh);
    return mesh;
  };
}

function makeFrontWallLineDrawer(courtGroup) {
  return function drawFrontWallLine(height, color = 0xee2c2c, thick = 0.04) {
    const geo = new THREE.BoxGeometry(HALF_W * 2, thick, 0.01);
    const mat = new THREE.MeshBasicMaterial({ color });
    const line = new THREE.Mesh(geo, mat);
    line.position.set(0, height, 0.005);
    courtGroup.add(line);
    return line;
  };
}

/* ---------------------------------------------------------
   CROWD BUILDER
--------------------------------------------------------- */
function buildCrowd(scene) {
  const fansGroup = new THREE.Group();
  scene.add(fansGroup);

  const rowZPositions = [LEN + 1.2, LEN + 1.8];
  const rowHeights = [0.4, 0.9];
  const colorsPalette = [0xff4a40, 0x3ba3ff, 0xc8ff3d, 0xffb83b, 0x9f5cff, 0xff7ec1];

  for (let r = 0; r < 2; r++) {
    const fz = rowZPositions[r];
    const fy = rowHeights[r];
    for (let s = -2.5; s <= 2.5; s += 1.0) {
      const fan = new THREE.Group();
      fan.position.set(s + (Math.random() - 0.5) * 0.15, fy, fz);

      const torso = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.38, 0.24),
        new THREE.MeshStandardMaterial({
          color: colorsPalette[Math.floor(Math.random() * colorsPalette.length)],
          roughness: 0.5
        })
      );
      torso.position.y = 0.19;
      fan.add(torso);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xe7c9a3, roughness: 0.5 })
      );
      head.position.y = 0.44;
      fan.add(head);

      fan.userData = {
        baseY: fy,
        jumpTimer: 0,
        cheerForce: 0,
        bobSpeed: 1 + Math.random() * 2,
        bobOffset: Math.random() * Math.PI
      };

      fansGroup.add(fan);
      fans.push(fan);
    }
  }

  return fansGroup;
}

/* ---------------------------------------------------------
   LIGHTING
--------------------------------------------------------- */
function buildLighting(scene) {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambientLight);

  const overheadLight = new THREE.DirectionalLight(0xfff6e0, 0.95);
  overheadLight.position.set(0, 8, 4.87);
  overheadLight.castShadow = true;
  overheadLight.shadow.mapSize.width = 1024;
  overheadLight.shadow.mapSize.height = 1024;
  overheadLight.shadow.camera.near = 0.5;
  overheadLight.shadow.camera.far = 15;
  overheadLight.shadow.camera.left = -HALF_W;
  overheadLight.shadow.camera.right = HALF_W;
  overheadLight.shadow.camera.top = 6;
  overheadLight.shadow.camera.bottom = -6;
  overheadLight.shadow.bias = -0.0005;
  scene.add(overheadLight);

  const ambientGlow = new THREE.PointLight(0xc8ff3d, 0.2, 25);
  ambientGlow.position.set(0, 4.5, LEN / 2);
  scene.add(ambientGlow);

  return { ambientLight, overheadLight, ambientGlow };
}

/* ---------------------------------------------------------
   COURT GEOMETRY BUILDER
--------------------------------------------------------- */
function buildCourtGeometry(scene) {
  const courtGroup = new THREE.Group();
  scene.add(courtGroup);

  const drawLine = makeLineDrawer(courtGroup);
  const drawFrontWallLine = makeFrontWallLineDrawer(courtGroup);

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, LEN), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, LEN / 2);
  floor.receiveShadow = true;
  courtGroup.add(floor);

  // Floor markings: short line, half-court line, service boxes
  drawLine(-HALF_W, shortLineZ, HALF_W, shortLineZ);
  drawLine(0, shortLineZ, 0, LEN);
  drawLine(-HALF_W + 1.6, shortLineZ, -HALF_W + 1.6, shortLineZ + 1.6);
  drawLine(-HALF_W + 1.6, shortLineZ + 1.6, -HALF_W, shortLineZ + 1.6);
  drawLine(HALF_W - 1.6, shortLineZ, HALF_W - 1.6, shortLineZ + 1.6);
  drawLine(HALF_W - 1.6, shortLineZ + 1.6, HALF_W, shortLineZ + 1.6);

  // Front wall (above the tin)
  const frontWall = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_W * 2, FRONT_H - TIN_H),
    wallMat
  );
  frontWall.position.set(0, TIN_H + (FRONT_H - TIN_H) / 2, 0.0);
  frontWall.receiveShadow = true;
  courtGroup.add(frontWall);

  // Tin
  const tin = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, TIN_H, 0.04), tinMat);
  tin.position.set(0, TIN_H / 2, -0.02);
  courtGroup.add(tin);

  const tinLip = new THREE.Mesh(
    new THREE.BoxGeometry(HALF_W * 2, 0.04, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xee2c2c })
  );
  tinLip.position.set(0, TIN_H, 0.01);
  courtGroup.add(tinLip);

  // Front wall out-of-court lines
  drawFrontWallLine(SERVICE_LINE_H, 0xee2c2c, 0.03);
  drawFrontWallLine(FRONT_H, 0xee2c2c, 0.05);

  // Side walls + their sloping out-lines
  [-1, 1].forEach(side => {
    const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(LEN, FRONT_H), wallMat);
    sideWall.position.set(side * HALF_W, FRONT_H / 2, LEN / 2);
    sideWall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    sideWall.receiveShadow = true;
    courtGroup.add(sideWall);

    const slopeLineGeo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      side * HALF_W, FRONT_H, 0,
      side * HALF_W, BACK_H, LEN
    ]);
    slopeLineGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const slopeLine = new THREE.Line(
      slopeLineGeo,
      new THREE.LineBasicMaterial({ color: 0xee2c2c, linewidth: 3 })
    );
    scene.add(slopeLine);
  });

  // Back wall (glass) + frame
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, BACK_H), glassMat);
  backWall.position.set(0, BACK_H / 2, LEN);
  courtGroup.add(backWall);

  const backWallFrame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(HALF_W * 2, BACK_H)),
    new THREE.LineBasicMaterial({ color: 0x3ba3ff, linewidth: 2 })
  );
  backWallFrame.position.set(0, BACK_H / 2, LEN - 0.002);
  scene.add(backWallFrame);

  return { courtGroup, floor, frontWall, tin, tinLip, backWall, backWallFrame };
}

/* ---------------------------------------------------------
   PUBLIC ENTRY POINT
   Call once from app.js after the THREE.Scene is created.
--------------------------------------------------------- */
export function createCourt(scene) {
  _scene = scene;

  const geometry = buildCourtGeometry(scene);
  const lighting = buildLighting(scene);
  const fansGroup = buildCrowd(scene);

  return {
    // Geometry
    courtGroup: geometry.courtGroup,
    floor: geometry.floor,
    frontWall: geometry.frontWall,
    tin: geometry.tin,
    tinLip: geometry.tinLip,
    backWall: geometry.backWall,
    backWallFrame: geometry.backWallFrame,

    // Lighting
    ambientLight: lighting.ambientLight,
    overheadLight: lighting.overheadLight,
    ambientGlow: lighting.ambientGlow,

    // Crowd
    fansGroup,
    fans
  };
}
