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
import { initMultiplayer, pauseMultiplayer, resumeMultiplayer } from './multiplayer.js';
import { initShop, openShop } from './shop.js';
import { initAccount, openAccountOverlay } from './account.js';
import { startMatch, startOnlineMatch, setReturnToMenuHandler } from './app.js';
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
  pauseIntro();
  show('multiplayerScreen');
  resumeMultiplayer();
}

initShop();
initAccount();

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
  onStats: () => { /* no dedicated career-stats screen yet */ },
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

// When a match ends (quit or restart), return to the home menu rather
// than a dead end — app.js doesn't know about home.js, it just calls this.
setReturnToMenuHandler(showHomeScreen);
