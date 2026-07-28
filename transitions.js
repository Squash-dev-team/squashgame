/* ===========================================================
   transitions.js
   Shared "PowerPoint-style" dissolve used whenever a screen or
   menu overlay is swapped in/out (intro <-> home, pause, shop,
   settings, game-over, etc.) so navigation reads as a soft
   fade+scale merge instead of an instant cut. Every screen owner
   (main.js, app.js, shop.js) calls these two helpers instead of
   toggling the `hidden` class directly.
=========================================================== */

export const TRANSITION_MS = 500;

export function revealScreen(el) {
  if (!el) return;
  el.classList.add('xfade');
  el.classList.remove('hidden');
  el.classList.add('xfade-hide');
  void el.offsetWidth; // force reflow so the removal below actually transitions
  el.classList.remove('xfade-hide');
}

export function concealScreen(el, onDone) {
  if (!el) return;
  el.classList.add('xfade', 'xfade-hide');
  window.setTimeout(() => {
    el.classList.add('hidden');
    onDone?.();
  }, TRANSITION_MS);
}
