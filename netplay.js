/* ===========================================================
   netplay.js
   Thin Socket.IO wrapper: owns the single connection to the
   Squash Strike multiplayer server (hosted on Render) and hands
   it out to multiplayer.js (room/matchmaking UI) and app.js
   (live match transform + ball-hit sync). `io` is the global
   injected by the socket.io CDN script tag in index.html.
=========================================================== */

export const SERVER_URL = 'https://squashgame.onrender.com';

let socket = null;

export function connectSocket() {
  if (socket && socket.connected) return socket;
  if (socket) { socket.connect(); return socket; }
  socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) socket.disconnect();
}
