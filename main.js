/* ===========================================================
   main.js
   Screen-flow orchestrator: wires UI1 (intro.js) → UI2 (home.js)
   → the actual match (app.js), plus the Shop (shop.js) and the
   empty Multiplayer/Account placeholders, all reachable from the
   intro screen. This is the only file that knows about screen
   transitions; each screen module only knows how to render
   itself and report back via callbacks.
=========================================================== */

import { initIntro, pauseIntro, resumeIntro } from './intro.js';
import { initHome, pauseHome, resumeHome } from './home.js';
import { initMultiplayer, pauseMultiplayer, resumeMultiplayer, resetLobby } from './multiplayer.js';
import { initShop, openShop } from './shop.js';
import { initAccount, openAccountOverlay } from './account.js';
import { initTutorial, openTutorial } from './tutorial.js';
import { initStats, openStatsOverlay } from './stats.js';
import { startMatch, startOnlineMatch, startPracticeMatch, setReturnToMenuHandler, setOnlineReturnToMenuHandler } from './app.js';
import { revealScreen, concealScreen } from './transitions.js';

function show(id) { revealScreen(document.getElementById(id)); }
function hide(id) { concealScreen(document.getElementById(id)); }

function showIntroScreen() {
  hide('homeScreen');
  hide('multiplayerScreen');
  pauseHome();
  pauseMultiplayer();
  show('introScreen');
  resumeIntro();
}

function showHomeScreen() {
  hide('introScreen');
  hide('multiplayerScreen');
  pauseIntro();
  pauseMultiplayer();
  show('homeScreen');
  resumeHome();
}

function showMultiplayerScreen() {
  hide('introScreen');
  hide('homeScreen');
  pauseIntro();
  pauseHome();
  resetLobby();
  show('multiplayerScreen');
  resumeMultiplayer();
}

initShop();
initAccount();
initTutorial();
initStats();

initMultiplayer({
  onBack: showIntroScreen,
  onMatchStart: (role) => {
    hide('multiplayerScreen');
    pauseMultiplayer();
    startOnlineMatch(role);
  }
});

initHome({
  onEnterCourt: () => {
    hide('homeScreen');
    pauseHome();
    startMatch();
  },
  onSettings: () => show('settingsView'),
  onControls: () => show('controlsView'),
  onStats: openStatsOverlay,
  onPractice: () => show('practiceOverlay'),
  onBack: showIntroScreen
});

initIntro({
  onSingleplayer: showHomeScreen,
  onMultiplayer: showMultiplayerScreen,
  onShop: openShop,
  onAccount: openAccountOverlay
});

document.getElementById('closeSettingsBtn')?.addEventListener('click', () => hide('settingsView'));
document.getElementById('closeControlsBtn')?.addEventListener('click', () => hide('controlsView'));
document.getElementById('openTutorialBtn')?.addEventListener('click', openTutorial);
document.getElementById('closePracticeBtn')?.addEventListener('click', () => hide('practiceOverlay'));

function enterPractice(mode) {
  hide('practiceOverlay');
  hide('homeScreen');
  pauseHome();
  startPracticeMatch(mode);
}
document.getElementById('practiceServeBtn')?.addEventListener('click', () => enterPractice('serve'));
document.getElementById('practiceWallRallyBtn')?.addEventListener('click', () => enterPractice('wallrally'));

// When a match ends (quit or restart), return to the home menu rather
// than a dead end — app.js doesn't know about home.js, it just calls this.
// Online matches instead land back on the multiplayer lobby, not the
// singleplayer home screen.
setReturnToMenuHandler(showHomeScreen);
setOnlineReturnToMenuHandler(showMultiplayerScreen);
