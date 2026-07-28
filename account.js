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

let dom = null;
let initialized = false;

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
    dom.signupBtn.disabled = isLoading;
    dom.signupBtn.textContent = (isLoading && actionType === 'signup') ? 'Creating Account...' : 'Create Account';
  }

  if (dom.authEmail) dom.authEmail.disabled = isLoading;
  if (dom.authPassword) dom.authPassword.disabled = isLoading;
}

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

  if (!email || !password) {
    setErrorMessage('Please enter both email and password.');
    return;
  }

  if (password.length < 6) {
    setErrorMessage('Password must be at least 6 characters.');
    return;
  }

  setLoading(true, 'signup');
  try {
    await signUpUser(email, password);
    if (dom.authPassword) dom.authPassword.value = '';
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

  // Submit on 'Enter' key inside password field
  dom.authPassword?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });

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
