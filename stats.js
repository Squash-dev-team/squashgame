/* ===========================================================
   stats.js
   Career stats + achievements: surfaces the lifetime totals
   already tracked on the player's profile (shop.js's
   playerProfile.stats) — collected every match but never shown
   anywhere until now — plus a small set of skill-based
   achievements checked at match end.

   Consumed by app.js via:
     checkAchievements(matchStats, isWin, profile) -> newly-unlocked defs
   Consumed by main.js via:
     initStats();          // once, wires the DOM already in index.html
     openStatsOverlay();   // show it
=========================================================== */

import { revealScreen, concealScreen } from './transitions.js';
import { getProfile } from './shop.js';

export const ACHIEVEMENTS = [
  { id: 'first_win', name: 'First Blood', icon: '🥇', desc: 'Win your first match.',
    check: (m, isWin, profile) => isWin && profile.stats.matchesWon >= 1 },
  { id: 'rally_10', name: '10-Shot Rally', icon: '🔁', desc: 'Win a rally lasting 10+ shots.',
    check: (m) => m.longestRally >= 10 },
  { id: 'clean_win', name: 'Clutch & Clean', icon: '✨', desc: 'Win a match without a single unforced error.',
    check: (m, isWin) => isWin && m.errors === 0 && m.rallies > 0 },
  { id: 'speed_demon', name: 'Speed Demon', icon: '⚡', desc: 'Hit a shot recorded at 20+ m/s.',
    check: (m) => m.maxSpeed >= 20 },
  { id: 'century_rallies', name: 'Rally Veteran', icon: '💯', desc: 'Reach 100 lifetime rallies played.',
    check: (m, isWin, profile) => profile.stats.totalRallies >= 100 }
];

/**
 * Runs every achievement's check against this match's stats + the
 * (already-updated) lifetime profile, skipping ones already unlocked.
 * Mutates profile.achievements in place; caller is responsible for
 * saveProfile() and any unlock toast. Returns the list of newly-unlocked
 * achievement defs (empty array if none).
 */
export function checkAchievements(matchStats, isWin, profile) {
  if (!profile.achievements) profile.achievements = {};
  const newlyUnlocked = [];
  for (const ach of ACHIEVEMENTS) {
    if (profile.achievements[ach.id]?.unlocked) continue;
    if (ach.check(matchStats, isWin, profile)) {
      profile.achievements[ach.id] = { unlocked: true, unlockedAt: Date.now() };
      newlyUnlocked.push(ach);
    }
  }
  return newlyUnlocked;
}

/* ---------------------------------------------------------
   DOM WIRING
--------------------------------------------------------- */
let dom = null;
let initialized = false;

function statRow(label, value) {
  return `<div class="career-stat-row"><span class="career-stat-label">${label}</span><span class="career-stat-value">${value}</span></div>`;
}

function renderStats() {
  const profile = getProfile();
  const s = profile.stats;
  const winRate = s.matchesPlayed > 0 ? Math.round((s.matchesWon / s.matchesPlayed) * 100) : 0;

  dom.grid.innerHTML = [
    statRow('Matches Played', s.matchesPlayed),
    statRow('Record', `${s.matchesWon}W – ${s.matchesLost}L (${winRate}%)`),
    statRow('Total Rallies', s.totalRallies),
    statRow('Winners Hit', s.totalWinners),
    statRow('Unforced Errors', s.totalErrors),
    statRow('Longest Rally', s.longestRallyAllTime),
    statRow('Fastest Shot', `${s.maxSpeedAllTime.toFixed(1)} m/s`)
  ].join('');

  dom.achievements.innerHTML = ACHIEVEMENTS.map(ach => {
    const unlocked = !!profile.achievements?.[ach.id]?.unlocked;
    return `
      <div class="achievement-card ${unlocked ? 'unlocked' : 'locked'}">
        <div class="achievement-icon">${unlocked ? ach.icon : '🔒'}</div>
        <div class="achievement-info">
          <div class="achievement-name">${ach.name}</div>
          <div class="achievement-desc">${ach.desc}</div>
        </div>
      </div>`;
  }).join('');
}

export function openStatsOverlay() {
  if (!initialized) initStats();
  renderStats();
  revealScreen(dom.overlay);
}

export function closeStatsOverlay() {
  if (dom) concealScreen(dom.overlay);
}

export function initStats() {
  if (initialized) return;
  initialized = true;

  dom = {
    overlay: document.getElementById('statsOverlay'),
    grid: document.getElementById('careerStatsGrid'),
    achievements: document.getElementById('achievementsList'),
    closeBtn: document.getElementById('closeStatsBtn')
  };

  dom.closeBtn?.addEventListener('click', closeStatsOverlay);
}
