/* ===========================================================
   tutorial.js
   A page-by-page "how to play squash" instruction booklet —
   the general rules of squash itself (court, serve, scoring,
   lets, shot types, faults), not this game's control scheme
   (that's the separate How-to-Play controls screen).

   Consumed by main.js via:
     initTutorial();  // once, wires the DOM already in index.html
     openTutorial();  // show it
     closeTutorial(); // hide it
=========================================================== */

import { revealScreen, concealScreen } from './transitions.js';

const PAGES = [
  {
    icon: '🎾',
    title: 'What Is Squash?',
    text: `Squash is a fast-paced racquet sport played by two players inside a four-walled court. You take turns hitting a hollow rubber ball onto the front wall — above the tin, below the out line — until one player can't return it.`
  },
  {
    icon: '🏟️',
    title: 'The Court',
    text: `The court has a front wall, two side walls, and a back wall. The TIN is the low metal strip at the bottom of the front wall — hit it and it's a fault. The SHORT LINE and HALF-COURT LINE divide the floor into quarters, including the two SERVICE BOXES at the back.`
  },
  {
    icon: '🎯',
    title: 'Serving',
    text: `Each rally starts with a serve. Standing inside a service box, hit the ball onto the front wall above the service line so it lands in the OPPOSITE back quarter of the court. The serve alternates sides after every point won on serve.`
  },
  {
    icon: '🏆',
    title: 'Scoring',
    text: `Squash Strike uses PAR scoring to 11: every rally wins a point for whoever hit the last good shot, no matter who served. If the score reaches 10-10, you must win by 2 clear points.`
  },
  {
    icon: '🤝',
    title: 'Lets & Strokes',
    text: `If your opponent's body or racquet blocks your fair shot at the ball, you can call a LET and replay the rally. If they were clearly blocking a winning shot, you may be awarded a STROKE — an outright point — instead.`
  },
  {
    icon: '💥',
    title: 'Shot Types',
    text: `DRIVE: a firm, flat shot down the wall. DROP: a soft touch that dies near the front wall. LOB: a high, arcing shot that pushes your opponent deep. KILL: a hard, low shot meant to bounce twice before it can be reached.`
  },
  {
    icon: '🚫',
    title: 'Faults',
    text: `A shot is a fault if it hits the tin, lands above the out-of-court line, or bounces twice on the floor before your opponent can return it. A fault immediately ends the rally and gives the point away.`
  },
  {
    icon: '🚀',
    title: 'Ready to Play',
    text: `That covers the basics! Head back to the menu, jump into Singleplayer or Multiplayer, and start rallying. Good luck out there!`
  }
];

let dom = null;
let pageIndex = 0;
let initialized = false;

function renderPage() {
  const page = PAGES[pageIndex];
  dom.icon.textContent = page.icon;
  dom.title.textContent = page.title;
  dom.text.textContent = page.text;
  dom.counter.textContent = `PAGE ${pageIndex + 1} OF ${PAGES.length}`;
  dom.prevBtn.disabled = pageIndex === 0;
  dom.nextBtn.textContent = pageIndex === PAGES.length - 1 ? 'Done ✓' : 'Next ▶';

  dom.dots.innerHTML = '';
  PAGES.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'tutorial-dot' + (i === pageIndex ? ' active' : '');
    dom.dots.appendChild(dot);
  });

  dom.card.classList.remove('page-flip');
  void dom.card.offsetWidth;
  dom.card.classList.add('page-flip');
}

function goNext() {
  if (pageIndex < PAGES.length - 1) { pageIndex++; renderPage(); }
  else closeTutorial();
}

function goPrev() {
  if (pageIndex > 0) { pageIndex--; renderPage(); }
}

export function openTutorial() {
  if (!initialized) initTutorial();
  pageIndex = 0;
  renderPage();
  revealScreen(dom.overlay);
}

export function closeTutorial() {
  if (dom) concealScreen(dom.overlay);
}

export function initTutorial() {
  if (initialized) return;
  initialized = true;

  dom = {
    overlay: document.getElementById('tutorialOverlay'),
    card: document.getElementById('tutorialModal'),
    icon: document.getElementById('tutorialPageIcon'),
    title: document.getElementById('tutorialPageTitle'),
    text: document.getElementById('tutorialPageText'),
    counter: document.getElementById('tutorialPageCounter'),
    dots: document.getElementById('tutorialDots'),
    prevBtn: document.getElementById('tutorialPrevBtn'),
    nextBtn: document.getElementById('tutorialNextBtn'),
    closeBtn: document.getElementById('closeTutorialBtn')
  };

  dom.prevBtn?.addEventListener('click', goPrev);
  dom.nextBtn?.addEventListener('click', goNext);
  dom.closeBtn?.addEventListener('click', closeTutorial);
}
