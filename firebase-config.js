/* ===========================================================
   firebase-config.js
   Firebase App, Authentication, and Cloud Firestore initialization.
   Provides helpers for user sign-up, sign-in, sign-out, and
   syncing player profile data to Cloud Firestore.
=========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* ---------------------------------------------------------
   FIREBASE CONFIGURATION
   Linked to project: squash-strike
--------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyCjJLX9-m283KuRtWNdbK5FxrB4p1HTLmk",
  authDomain: "squash-strike.firebaseapp.com",
  projectId: "squash-strike",
  storageBucket: "squash-strike.firebasestorage.app",
  messagingSenderId: "176412448862",
  appId: "1:176412448862:web:46386d5ada0ed6fa19fccf",
  measurementId: "G-JMC26M4TH1"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Services
export const auth = getAuth(app);
export const db = getFirestore(app);

/* ---------------------------------------------------------
   AUTHENTICATION HELPERS
--------------------------------------------------------- */

/**
 * Registers a new user with email and password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js").User>}
 */
export async function signUpUser(email, password) {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

/**
 * Signs in an existing user with email and password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js").User>}
 */
export async function signInUser(email, password) {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

/**
 * Signs out the currently logged in user.
 * @returns {Promise<void>}
 */
export async function logoutUser() {
  await signOut(auth);
}

/**
 * Listens for user authentication state changes (login, logout, session restoration).
 * @param {function} callback
 * @returns {import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js").Unsubscribe}
 */
export function listenToAuthChanges(callback) {
  return onAuthStateChanged(auth, callback);
}

/* ---------------------------------------------------------
   FIRESTORE PROFILE SYNC HELPERS
--------------------------------------------------------- */

/**
 * Saves or updates player profile data in Firestore under users/{userId}.
 * @param {string} userId
 * @param {object} profileData
 * @returns {Promise<void>}
 */
export async function saveProfileToCloud(userId, profileData) {
  if (!userId) return;
  try {
    const userDocRef = doc(db, "users", userId);
    await setDoc(userDocRef, profileData, { merge: true });
  } catch (error) {
    console.error("Failed to save profile to Cloud Firestore:", error);
  }
}

/**
 * Fetches player profile data from Firestore under users/{userId}.
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function loadProfileFromCloud(userId) {
  if (!userId) return null;
  try {
    const userDocRef = doc(db, "users", userId);
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists()) {
      return docSnap.data();
    }
  } catch (error) {
    console.error("Failed to load profile from Cloud Firestore:", error);
  }
  return null;
}
