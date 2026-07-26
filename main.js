/* ===========================================================
   main.js
   Screen-flow orchestrator: wires UI1 (intro.js) → UI2 (home.js)
   → the actual match (app.js), plus the Shop (shop.js) and the
   empty Multiplayer/Account placeholders, all reachable from the
   intro screen. This is the only file that knows about screen
   transitions; each screen module only knows how to render
   itself and report back via callbacks.
=========================================================== */

import { initIntro, pauseIntro } from './intro.js';
import { initHome, pauseHome, resumeHome } from './home.js';
import { initShop, openShop } from './shop.js';
import { startMatch, setReturnToMenuHandler } from './app.js';

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

function showIntroScreen() {
  hide('homeScreen');
  pauseHome();
  show('introScreen');
}

function showHomeScreen() {
  hide('introScreen');
  pauseIntro();
  show('homeScreen');
  resumeHome();
}

initShop();

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
  onMultiplayer: () => show('multiplayerOverlay'),
  onShop: openShop,
  onAccount: () => show('accountOverlay')
});

document.getElementById('closeSettingsBtn')?.addEventListener('click', () => hide('settingsView'));
document.getElementById('closeControlsBtn')?.addEventListener('click', () => hide('controlsView'));
document.getElementById('closeAccountOverlayBtn')?.addEventListener('click', () => hide('accountOverlay'));
document.getElementById('closeMultiplayerOverlayBtn')?.addEventListener('click', () => hide('multiplayerOverlay'));

// When a match ends (quit or restart), return to the home menu rather
// than a dead end — app.js doesn't know about home.js, it just calls this.
setReturnToMenuHandler(showHomeScreen);
