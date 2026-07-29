/* ===========================================================
   shop.js
   The "Pro Shop": character/racquet/class catalogs, the gacha
   roll mechanic (equal-odds mystery box), equip state, and a
   localStorage-backed profile with export/import save codes.
   Ported from the RNG shop reference file.

   Consumed by main.js / intro.js via:
     initShop();     // once, wires the DOM already present in index.html
     openShop();      // show the shop overlay
     closeShop();     // hide it
=========================================================== */

import { revealScreen, concealScreen } from './transitions.js';
import { auth, saveProfileToCloud, loadProfileFromCloud } from './firebase-config.js';

export const CHARACTERS = [
  { id: 'c_default', name: 'Rookie', rarity: 'Common', skin: '0x192e47', glow: '0x3ba3ff', desc: 'A blank slate — no bonuses, no penalties.', powerMult: 1.0, speedMult: 1.0, aimMult: 1.0, stamMult: 1.0 },
  { id: 'c_crimson', name: 'Crimson Striker', rarity: 'Rare', skin: '0x4a1212', glow: '0xff4a40', desc: 'Trained to hit hard.', powerMult: 1.05, speedMult: 1.0, aimMult: 1.0, stamMult: 1.0 },
  { id: 'c_neon', name: 'Neon Ninja', rarity: 'Rare', skin: '0x111a0d', glow: '0xc8ff3d', desc: 'Light on the feet.', powerMult: 1.0, speedMult: 1.05, aimMult: 1.0, stamMult: 1.0 },
  { id: 'c_gold', name: 'Golden Ace', rarity: 'Rare', skin: '0x33250b', glow: '0xffb83b', desc: 'A sharpshooter\'s eye.', powerMult: 1.0, speedMult: 1.0, aimMult: 1.05, stamMult: 1.0 },
  { id: 'c_cyber', name: 'Cyber Punk', rarity: 'Super Rare', skin: '0x0f2930', glow: '0x00f0ff', desc: 'Precision-engineered reflexes.', powerMult: 1.0, speedMult: 1.0, aimMult: 1.08, stamMult: 1.0 },
  { id: 'c_ghost', name: 'Ghost', rarity: 'Super Rare', skin: '0x404040', glow: '0xffffff', desc: 'Slips past the eye — and the reach.', powerMult: 1.0, speedMult: 1.08, aimMult: 1.0, stamMult: 1.0 },
  { id: 'c_toxic', name: 'Toxic Hazard', rarity: 'Super Rare', skin: '0x2a123d', glow: '0x8a2be2', desc: 'Never seems to run out of gas.', powerMult: 1.0, speedMult: 1.0, aimMult: 1.0, stamMult: 1.08 },
  { id: 'c_magma', name: 'Magma Core', rarity: 'Epic', skin: '0x3d1502', glow: '0xff771c', desc: 'Every swing packs extra heat.', powerMult: 1.10, speedMult: 1.0, aimMult: 1.0, stamMult: 1.0 },
  { id: 'c_void', name: 'Void Walker', rarity: 'Epic', skin: '0x050505', glow: '0x9400d3', desc: 'Runs on borrowed energy.', powerMult: 1.0, speedMult: 1.0, aimMult: 1.0, stamMult: 1.10 },
  { id: 'c_champ', name: 'Champion', rarity: 'Legendary', skin: '0xffd700', glow: '0xffffff', desc: 'A well-rounded elite — great at everything.', powerMult: 1.05, speedMult: 1.05, aimMult: 1.05, stamMult: 1.05 }
];

export const RACQUETS = [
  { id: 'r_wood', name: 'Starter Wood', rarity: 'Common', powerMult: 1.0, speedMult: 1.0, aimMult: 1.0, color: '0xd4b375', desc: 'Standard specs' },
  { id: 'r_alum', name: 'Aluminum Frame', rarity: 'Rare', powerMult: 1.05, speedMult: 0.95, aimMult: 1.0, color: '0xaaaaaa', desc: '+Power -Speed' },
  { id: 'r_feather', name: 'Aero Feather', rarity: 'Rare', powerMult: 0.90, speedMult: 1.15, aimMult: 1.15, color: '0x88ccff', desc: 'Max speed & control' },
  { id: 'r_hammer', name: 'The Sledge', rarity: 'Super Rare', powerMult: 1.25, speedMult: 0.85, aimMult: 0.90, color: '0xff4444', desc: 'Raw power, very heavy' },
  { id: 'r_sniper', name: 'Precision Pro', rarity: 'Super Rare', powerMult: 1.05, speedMult: 1.05, aimMult: 1.35, color: '0x33ff55', desc: 'Pinpoint accuracy' },
  { id: 'r_carbon', name: 'Carbon Fiber', rarity: 'Super Rare', powerMult: 1.15, speedMult: 1.10, aimMult: 1.10, color: '0x222222', desc: 'Light & powerful' },
  { id: 'r_titanium', name: 'Titanium Weave', rarity: 'Epic', powerMult: 1.20, speedMult: 0.95, aimMult: 1.15, color: '0xe6e6fa', desc: 'Heavy but very precise' },
  { id: 'r_quantum', name: 'Quantum Strike', rarity: 'Epic', powerMult: 1.30, speedMult: 1.20, aimMult: 1.25, color: '0x00ffff', desc: 'Elite balanced gear' },
  { id: 'r_vortex', name: 'Vortex Core', rarity: 'Epic', powerMult: 0.95, speedMult: 1.40, aimMult: 1.20, color: '0x9933ff', desc: 'Blindingly fast swing' },
  { id: 'r_obsidian', name: 'Obsidian Blade', rarity: 'Legendary', powerMult: 1.50, speedMult: 0.75, aimMult: 1.40, color: '0x151515', desc: 'Glass cannon specs' },
  { id: 'r_genesis', name: 'Genesis X', rarity: 'Legendary', powerMult: 1.45, speedMult: 1.35, aimMult: 1.45, color: '0xffd700', desc: 'The ultimate weapon' }
];

export const CLASSES = [
  { id: 'class_balanced', name: 'Balanced', rarity: 'Common', icon: '⚖️', speedMult: 1.0, powerMult: 1.0, stamMult: 1.0, reachMult: 1.0, desc: 'All-around stats' },
  { id: 'class_runner', name: 'Runner', rarity: 'Rare', icon: '👟', speedMult: 1.15, powerMult: 0.9, stamMult: 1.25, reachMult: 1.0, desc: '+Speed +Stamina' },
  { id: 'class_striker', name: 'Striker', rarity: 'Rare', icon: '💥', speedMult: 0.9, powerMult: 1.25, stamMult: 0.9, reachMult: 1.0, desc: '+Power -Speed' },
  { id: 'class_giant', name: 'Giant', rarity: 'Super Rare', icon: '🦍', speedMult: 0.8, powerMult: 1.1, stamMult: 0.8, reachMult: 1.25, desc: '+Reach -Speed' },
  { id: 'class_acrobat', name: 'Acrobat', rarity: 'Super Rare', icon: '🤸', speedMult: 1.1, powerMult: 0.85, stamMult: 1.35, reachMult: 1.3, desc: 'Max reach & stamina' },
  { id: 'class_ninja', name: 'Ninja', rarity: 'Super Rare', icon: '🥷', speedMult: 1.25, powerMult: 0.85, stamMult: 1.1, reachMult: 1.1, desc: '+Speed +Reach' },
  { id: 'class_tank', name: 'Juggernaut', rarity: 'Epic', icon: '🛡️', speedMult: 0.75, powerMult: 1.4, stamMult: 1.25, reachMult: 1.1, desc: 'Unstoppable power' },
  { id: 'class_pro', name: 'Pro Athlete', rarity: 'Epic', icon: '🏆', speedMult: 1.15, powerMult: 1.15, stamMult: 1.15, reachMult: 1.15, desc: 'All stats boosted' },
  { id: 'class_phantom', name: 'Phantom', rarity: 'Epic', icon: '👻', speedMult: 1.40, powerMult: 0.9, stamMult: 0.85, reachMult: 1.30, desc: 'Unreal speed & reach' },
  { id: 'class_cyborg', name: 'Cyborg', rarity: 'Legendary', icon: '🤖', speedMult: 1.25, powerMult: 1.35, stamMult: 1.50, reachMult: 1.10, desc: 'Tireless machine' },
  { id: 'class_master', name: 'Grandmaster', rarity: 'Legendary', icon: '👑', speedMult: 1.40, powerMult: 1.40, stamMult: 1.40, reachMult: 1.40, desc: 'Absolute perfection' }
];

const LOCAL_SAVE_KEY = 'squashStrikeProfileV2';
const SAVE_CODE_PREFIX = 'SSPRO2-';
const ROLL_COSTS = { char: 120, racquet: 80, class: 80 };
const TAB_LABELS = { char: 'Character', racquet: 'Racquet', class: 'Class' };
let activeTab = 'char';

function defaultProfile() {
  return {
    version: 2.1,
    coins: 0,
    unlockedCharacters: ['c_default'],
    unlockedRacquets: ['r_wood'],
    unlockedClasses: ['class_balanced'],
    equipped: { character: 'c_default', racquet: 'r_wood', class: 'class_balanced' },
    stats: { matchesPlayed: 0, matchesWon: 0, matchesLost: 0, totalRallies: 0, totalWinners: 0, totalErrors: 0, maxSpeedAllTime: 0 }
  };
}

let playerProfile = defaultProfile();

export function loadProfile() {
  try {
    const raw = localStorage.getItem(LOCAL_SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.unlockedCharacters) parsed.unlockedCharacters = ['c_default'];
      if (!parsed.unlockedRacquets) parsed.unlockedRacquets = ['r_wood'];
      if (!parsed.unlockedClasses) parsed.unlockedClasses = ['class_balanced'];
      if (!parsed.equipped) parsed.equipped = { character: 'c_default', racquet: 'r_wood', class: 'class_balanced' };
      playerProfile = Object.assign(defaultProfile(), parsed);
    }
  } catch (e) { playerProfile = defaultProfile(); }
  return playerProfile;
}

export function saveProfile() {
  try {
    localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(playerProfile));

    // Automatically save to Cloud Firestore if logged in
    if (auth.currentUser) {
      saveProfileToCloud(auth.currentUser.uid, playerProfile);
    }
  } catch (e) { /* storage may be unavailable */ }
}

export async function syncWithCloudAccount(user) {
  if (!user) return;
  const cloudData = await loadProfileFromCloud(user.uid);
  if (cloudData) {
    playerProfile = Object.assign(defaultProfile(), cloudData);
    try { localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(playerProfile)); } catch (e) {}
    if (dom) renderShop();
  } else {
    // New account: upload current local save to cloud
    saveProfileToCloud(user.uid, playerProfile);
  }
}

export function getProfile() { return playerProfile; }

export function encodeProfileToCode(profile) {
  const json = JSON.stringify(profile);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return SAVE_CODE_PREFIX + b64;
}

export function decodeCodeToProfile(code) {
  const trimmed = (code || '').trim();
  if (!trimmed.startsWith(SAVE_CODE_PREFIX)) throw new Error('Invalid save code.');
  const b64 = trimmed.slice(SAVE_CODE_PREFIX.length);
  const json = decodeURIComponent(escape(atob(b64)));
  const parsed = JSON.parse(json);
  return Object.assign(defaultProfile(), parsed);
}

/* ---------------------------------------------------------
   DOM WIRING
--------------------------------------------------------- */
let dom = null;
let initialized = false;

function makeStatBar(label, mult, colorCls) {
  let pct = 50 + (mult - 1.0) * 120;
  pct = Math.max(5, Math.min(100, pct));
  return `<div class="stat-row"><span style="width:25px;text-align:left;font-weight:700;">${label}</span><div class="stat-bar-bg"><div class="stat-bar-fg ${colorCls}" style="width:${pct}%"></div></div></div>`;
}

function switchTab(tab) {
  activeTab = tab;
  dom.tabChar.classList.toggle('active', tab === 'char');
  dom.tabRacquet.classList.toggle('active', tab === 'racquet');
  dom.tabClass.classList.toggle('active', tab === 'class');
  dom.gridChar.classList.toggle('hidden', tab !== 'char');
  dom.gridRacquet.classList.toggle('hidden', tab !== 'racquet');
  dom.gridClass.classList.toggle('hidden', tab !== 'class');
  updateRollPanel();
}

function updateRollPanel() {
  const cost = ROLL_COSTS[activeTab];
  dom.rollBtn.textContent = `🎰 Roll ${TAB_LABELS[activeTab]} — ${cost} 🪙`;
  dom.rollBtn.disabled = playerProfile.coins < cost;
  dom.rollResult.innerHTML = '';
}

function equipItem(type, id) {
  if (type === 'char') playerProfile.equipped.character = id;
  else if (type === 'racquet') playerProfile.equipped.racquet = id;
  else if (type === 'class') playerProfile.equipped.class = id;
  saveProfile();
  renderShop();
}

function charStatsBar(char) {
  return `<div class="item-stats-box">${makeStatBar('POW', char.powerMult, 'stat-pow')}${makeStatBar('SPD', char.speedMult, 'stat-spd')}${makeStatBar('ACC', char.aimMult, 'stat-acc')}${makeStatBar('STM', char.stamMult, 'stat-stm')}</div>`;
}

function openItemInfo(item, type) {
  if (!dom.infoOverlay) return;
  const rarityClass = item.rarity.replace(' ', '-');
  dom.infoRarity.className = `rarity-label rarity-${rarityClass}`;
  dom.infoRarity.textContent = item.rarity;
  dom.infoName.textContent = item.name;
  dom.infoDesc.textContent = item.desc || '';

  if (type === 'char') {
    dom.infoPreview.innerHTML = `<div class="char-preview-core" style="background-color:${item.skin.replace('0x', '#')};box-shadow:0 0 15px ${item.glow.replace('0x', '#')} inset;border-color:${item.glow.replace('0x', '#')};"></div>`;
    dom.infoStats.innerHTML = charStatsBar(item);
  } else if (type === 'racquet') {
    dom.infoPreview.innerHTML = `<div class="racquet-preview-core" style="border-color:${item.color.replace('0x', '#')};"></div>`;
    dom.infoStats.innerHTML = `<div class="item-stats-box">${makeStatBar('POW', item.powerMult, 'stat-pow')}${makeStatBar('SPD', item.speedMult, 'stat-spd')}${makeStatBar('ACC', item.aimMult, 'stat-acc')}</div>`;
  } else {
    dom.infoPreview.innerHTML = `<div style="font-size:48px;">${item.icon}</div>`;
    dom.infoStats.innerHTML = `<div class="item-stats-box">${makeStatBar('SPD', item.speedMult, 'stat-spd')}${makeStatBar('POW', item.powerMult, 'stat-pow')}${makeStatBar('STM', item.stamMult, 'stat-stm')}${makeStatBar('RCH', item.reachMult, 'stat-rch')}</div>`;
  }
  revealScreen(dom.infoOverlay);
}

function makeShopCard(item, type, isUnlocked, isEquipped, innerHtml) {
  const card = document.createElement('div');
  card.className = `shop-card ${isEquipped ? 'equipped' : ''}`;
  card.innerHTML = innerHtml;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.shop-btn')) return;
    openItemInfo(item, type);
  });

  const btn = document.createElement('button');
  btn.className = 'shop-btn ' + (isEquipped ? 'btn-equipped' : isUnlocked ? 'btn-equip' : '');
  btn.textContent = isEquipped ? 'Equipped' : isUnlocked ? 'Equip' : '🔒 Locked';
  if (!isUnlocked) { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed'; }
  else if (!isEquipped) btn.addEventListener('click', () => equipItem(type, item.id));
  card.appendChild(btn);
  return card;
}

function renderShop() {
  dom.topCoins.textContent = playerProfile.coins;
  updateRollPanel();

  dom.gridChar.innerHTML = '';
  CHARACTERS.forEach(char => {
    const isUnlocked = playerProfile.unlockedCharacters.includes(char.id);
    const isEquipped = playerProfile.equipped.character === char.id;
    const rarityClass = char.rarity.replace(' ', '-');
    const html = `
      <div class="rarity-label rarity-${rarityClass}">${char.rarity}</div>
      <div class="item-preview"><div class="char-preview-core" style="background-color:${char.skin.replace('0x', '#')};box-shadow:0 0 15px ${char.glow.replace('0x', '#')} inset;border-color:${char.glow.replace('0x', '#')};"></div></div>
      <div class="item-name">${char.name}</div><div class="item-stat">Tap for stats</div>
    `;
    dom.gridChar.appendChild(makeShopCard(char, 'char', isUnlocked, isEquipped, html));
  });

  dom.gridRacquet.innerHTML = '';
  RACQUETS.forEach(raq => {
    const isUnlocked = playerProfile.unlockedRacquets.includes(raq.id);
    const isEquipped = playerProfile.equipped.racquet === raq.id;
    const statBars = `<div class="item-stats-box">${makeStatBar('POW', raq.powerMult, 'stat-pow')}${makeStatBar('SPD', raq.speedMult, 'stat-spd')}${makeStatBar('ACC', raq.aimMult, 'stat-acc')}</div>`;
    const rarityClass = raq.rarity.replace(' ', '-');
    const html = `
      <div class="rarity-label rarity-${rarityClass}">${raq.rarity}</div>
      <div class="item-preview"><div class="racquet-preview-core" style="border-color:${raq.color.replace('0x', '#')};"></div></div>
      <div class="item-name">${raq.name}</div><div class="item-stat" style="margin-bottom:2px;">${raq.desc}</div>
      ${statBars}
    `;
    dom.gridRacquet.appendChild(makeShopCard(raq, 'racquet', isUnlocked, isEquipped, html));
  });

  dom.gridClass.innerHTML = '';
  CLASSES.forEach(cls => {
    const isUnlocked = playerProfile.unlockedClasses.includes(cls.id);
    const isEquipped = playerProfile.equipped.class === cls.id;
    const statBars = `<div class="item-stats-box">${makeStatBar('SPD', cls.speedMult, 'stat-spd')}${makeStatBar('POW', cls.powerMult, 'stat-pow')}${makeStatBar('STM', cls.stamMult, 'stat-stm')}${makeStatBar('RCH', cls.reachMult, 'stat-rch')}</div>`;
    const rarityClass = cls.rarity.replace(' ', '-');
    const html = `
      <div class="rarity-label rarity-${rarityClass}">${cls.rarity}</div>
      <div class="item-preview" style="font-size:38px;display:flex;align-items:center;justify-content:center;">${cls.icon}</div>
      <div class="item-name">${cls.name}</div><div class="item-stat" style="margin-bottom:2px;">${cls.desc}</div>
      ${statBars}
    `;
    dom.gridClass.appendChild(makeShopCard(cls, 'class', isUnlocked, isEquipped, html));
  });
}

function rollItem() {
  const cost = ROLL_COSTS[activeTab];
  if (playerProfile.coins < cost) return;
  playerProfile.coins -= cost;

  const pool = activeTab === 'char' ? CHARACTERS : activeTab === 'racquet' ? RACQUETS : CLASSES;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const unlockedList = activeTab === 'char' ? playerProfile.unlockedCharacters : activeTab === 'racquet' ? playerProfile.unlockedRacquets : playerProfile.unlockedClasses;
  const rarityClass = pick.rarity.replace(' ', '-');
  const dupeRefund = Math.round(cost / 3);

  if (unlockedList.includes(pick.id)) {
    playerProfile.coins += dupeRefund;
    dom.rollResult.innerHTML = `Duplicate <span class="rarity-label rarity-${rarityClass}" style="display:inline-block;">${pick.rarity}</span> ${pick.name} — converted to +${dupeRefund} 🪙`;
  } else {
    unlockedList.push(pick.id);
    dom.rollResult.innerHTML = `🎉 New ${TAB_LABELS[activeTab]}! <span class="rarity-label rarity-${rarityClass}" style="display:inline-block;">${pick.rarity}</span> ${pick.name}`;
  }

  saveProfile();
  renderShop();
}

export function initShop() {
  if (initialized) return;
  initialized = true;
  loadProfile();

  dom = {
    overlay: document.getElementById('shopOverlay'),
    topCoins: document.getElementById('shopTopCoins'),
    gridChar: document.getElementById('shopGridChar'),
    gridRacquet: document.getElementById('shopGridRacquet'),
    gridClass: document.getElementById('shopGridClass'),
    tabChar: document.getElementById('tabChar'),
    tabRacquet: document.getElementById('tabRacquet'),
    tabClass: document.getElementById('tabClass'),
    rollBtn: document.getElementById('rollBtn'),
    rollResult: document.getElementById('rollResult'),
    closeBtn: document.getElementById('closeShopBtn'),
    infoOverlay: document.getElementById('itemInfoOverlay'),
    infoRarity: document.getElementById('infoRarity'),
    infoPreview: document.getElementById('infoPreview'),
    infoName: document.getElementById('infoName'),
    infoDesc: document.getElementById('infoDesc'),
    infoStats: document.getElementById('infoStats'),
    closeInfoBtn: document.getElementById('closeItemInfoBtn')
  };

  dom.tabChar.addEventListener('click', () => switchTab('char'));
  dom.tabRacquet.addEventListener('click', () => switchTab('racquet'));
  dom.tabClass.addEventListener('click', () => switchTab('class'));
  dom.rollBtn.addEventListener('click', rollItem);
  dom.closeBtn.addEventListener('click', closeShop);
  dom.closeInfoBtn?.addEventListener('click', () => concealScreen(dom.infoOverlay));
}

export function openShop() {
  if (!initialized) initShop();
  renderShop();
  revealScreen(dom.overlay);
}

export function closeShop() {
  if (dom) concealScreen(dom.overlay);
}
