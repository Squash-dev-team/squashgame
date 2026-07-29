/* ===========================================================
   account.js
   Handles user authentication UI (Sign In, Sign Up, Sign Out),
   error formatting, button loading states, Firebase auth state
   persistence, and Cloud Firestore profile synchronization.
=========================================================== */

import {
  signUpUser,
  signInUser,
  logoutUser,
  listenToAuthChanges
} from './firebase-config.js';

import { syncWithCloudAccount } from './shop.js';
import { revealScreen, concealScreen } from './transitions.js';

const MIN_PASSWORD_LENGTH = 8;

let dom = null;
let initialized = false;
let authMode = 'login'; // 'login' | 'signup'

function setErrorMessage(msg) {
  if (dom && dom.authError) {
    dom.authError.textContent = msg || '';
  }
}

/**
 * Maps raw Firebase error codes to friendly, user-facing error messages.
 */
function formatAuthError(error) {
  const code = error?.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/missing-password':
      return 'Please enter a password.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a moment.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection.';
    default:
      return error.message || 'Authentication failed. Please try again.';
  }
}

/**
 * Toggles loading state on inputs and buttons during network requests.
 */
function setLoading(isLoading, actionType = '') {
  if (!dom) return;

  if (dom.loginBtn) {
    dom.loginBtn.disabled = isLoading;
    dom.loginBtn.textContent = (isLoading && actionType === 'login') ? 'Signing In...' : 'Sign In';
  }

  if (dom.signupBtn) {
    dom.signupBtn.disabled = isLoading || !checkRequirements().allMet;
    dom.signupBtn.textContent = (isLoading && actionType === 'signup') ? 'Creating Account...' : 'Create Account';
  }

  if (dom.authEmail) dom.authEmail.disabled = isLoading;
  if (dom.authPassword) dom.authPassword.disabled = isLoading;
  if (dom.authPasswordConfirm) dom.authPasswordConfirm.disabled = isLoading;
}

/* ---------------------------------------------------------
   MODE SWITCHING (Sign In <-> Create Account)
--------------------------------------------------------- */
function switchAuthMode(mode) {
  authMode = mode;
  setErrorMessage('');

  dom.modeLoginTab?.classList.toggle('active', mode === 'login');
  dom.modeSignupTab?.classList.toggle('active', mode === 'signup');
  dom.signupExtra?.classList.toggle('hidden', mode !== 'signup');
  dom.loginBtn?.classList.toggle('hidden', mode !== 'login');
  dom.signupBtn?.classList.toggle('hidden', mode !== 'signup');

  if (dom.authPasswordConfirm) dom.authPasswordConfirm.value = '';
  updateRequirementsUI();
}

/* ---------------------------------------------------------
   PASSWORD VISIBILITY TOGGLES
--------------------------------------------------------- */
function wireEyeToggle(btn, input) {
  if (!btn || !input) return;
  btn.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? '👁' : '🙈';
    btn.classList.toggle('showing', !showing);
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });
}

/* ---------------------------------------------------------
   SIGNUP PASSWORD REQUIREMENTS (live checklist)
--------------------------------------------------------- */
function checkRequirements() {
  const password = dom.authPassword ? dom.authPassword.value : '';
  const confirm = dom.authPasswordConfirm ? dom.authPasswordConfirm.value : '';

  const rules = {
    length: password.length >= MIN_PASSWORD_LENGTH,
    letter: /[A-Za-z]/.test(password),
    number: /[0-9]/.test(password),
    match: password.length > 0 && password === confirm
  };
  const allMet = Object.values(rules).every(Boolean);
  return { rules, allMet };
}

function updateRequirementsUI() {
  if (!dom.requirementsList) return;
  const { rules, allMet } = checkRequirements();
  dom.requirementsList.querySelectorAll('li[data-rule]').forEach(li => {
    li.classList.toggle('met', !!rules[li.dataset.rule]);
  });
  if (authMode === 'signup' && dom.signupBtn) {
    dom.signupBtn.disabled = !allMet;
  }
}

/* ---------------------------------------------------------
   LOGIN / SIGNUP / LOGOUT
--------------------------------------------------------- */
async function handleLogin() {
  setErrorMessage('');
  const email = dom.authEmail ? dom.authEmail.value.trim() : '';
  const password = dom.authPassword ? dom.authPassword.value : '';

  if (!email || !password) {
    setErrorMessage('Please enter both email and password.');
    return;
  }

  setLoading(true, 'login');
  try {
    await signInUser(email, password);
    if (dom.authPassword) dom.authPassword.value = '';
  } catch (err) {
    setErrorMessage(formatAuthError(err));
  } finally {
    setLoading(false);
  }
}

async function handleSignup() {
  setErrorMessage('');
  const email = dom.authEmail ? dom.authEmail.value.trim() : '';
  const password = dom.authPassword ? dom.authPassword.value : '';
  const confirm = dom.authPasswordConfirm ? dom.authPasswordConfirm.value : '';

  if (!email || !password || !confirm) {
    setErrorMessage('Please fill in every field.');
    return;
  }

  const { allMet } = checkRequirements();
  if (!allMet) {
    setErrorMessage('Please meet all password requirements below.');
    return;
  }

  setLoading(true, 'signup');
  try {
    await signUpUser(email, password);
    if (dom.authPassword) dom.authPassword.value = '';
    if (dom.authPasswordConfirm) dom.authPasswordConfirm.value = '';
  } catch (err) {
    setErrorMessage(formatAuthError(err));
  } finally {
    setLoading(false);
  }
}

async function handleLogout() {
  setErrorMessage('');
  try {
    await logoutUser();
  } catch (err) {
    setErrorMessage('Failed to sign out. Please try again.');
  }
}

export function openAccountOverlay() {
  if (!initialized) initAccount();
  revealScreen(dom?.accountOverlay);
}

export function closeAccountOverlay() {
  if (!dom) return;
  concealScreen(dom.accountOverlay);
  setErrorMessage('');
}

export function initAccount() {
  if (initialized) return;
  initialized = true;

  dom = {
    accountOverlay: document.getElementById('accountOverlay'),
    loggedInView: document.getElementById('accountLoggedInView'),
    authView: document.getElementById('accountAuthView'),
    accountEmail: document.getElementById('accountEmail'),
    authEmail: document.getElementById('authEmail'),
    authPassword: document.getElementById('authPassword'),
    authPasswordConfirm: document.getElementById('authPasswordConfirm'),
    authPasswordToggle: document.getElementById('authPasswordToggle'),
    authPasswordConfirmToggle: document.getElementById('authPasswordConfirmToggle'),
    signupExtra: document.getElementById('authSignupExtra'),
    requirementsList: document.getElementById('authRequirements'),
    modeLoginTab: document.getElementById('authModeLoginTab'),
    modeSignupTab: document.getElementById('authModeSignupTab'),
    authError: document.getElementById('authError'),
    loginBtn: document.getElementById('loginBtn'),
    signupBtn: document.getElementById('signupBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    closeBtn: document.getElementById('closeAccountOverlayBtn')
  };

  // Wire UI Action Listeners
  dom.loginBtn?.addEventListener('click', handleLogin);
  dom.signupBtn?.addEventListener('click', handleSignup);
  dom.logoutBtn?.addEventListener('click', handleLogout);
  dom.closeBtn?.addEventListener('click', closeAccountOverlay);

  dom.modeLoginTab?.addEventListener('click', () => switchAuthMode('login'));
  dom.modeSignupTab?.addEventListener('click', () => switchAuthMode('signup'));

  wireEyeToggle(dom.authPasswordToggle, dom.authPassword);
  wireEyeToggle(dom.authPasswordConfirmToggle, dom.authPasswordConfirm);

  dom.authPassword?.addEventListener('input', updateRequirementsUI);
  dom.authPasswordConfirm?.addEventListener('input', updateRequirementsUI);

  // Submit on 'Enter' key inside password field (whichever mode is active)
  dom.authPassword?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (authMode === 'signup') handleSignup(); else handleLogin();
  });
  dom.authPasswordConfirm?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSignup();
  });

  switchAuthMode('login');

  // Listen for Firebase Auth State changes
  listenToAuthChanges(async (user) => {
    if (!dom) return;

    if (user) {
      if (dom.accountEmail) dom.accountEmail.textContent = user.email;
      if (dom.loggedInView) dom.loggedInView.classList.remove('hidden');
      if (dom.authView) dom.authView.classList.add('hidden');
      setErrorMessage('');

      // Synchronize player profile (coins, shop unlocks) with Firestore
      await syncWithCloudAccount(user);
    } else {
      if (dom.loggedInView) dom.loggedInView.classList.add('hidden');
      if (dom.authView) dom.authView.classList.remove('hidden');
      if (dom.accountEmail) dom.accountEmail.textContent = '';
    }
  });
}
