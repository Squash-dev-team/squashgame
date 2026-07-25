const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Initialize Socket.IO with CORS enabled for cross-origin game clients
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Health check endpoint for cloud hosts (Render, Railway, Fly.io)
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    activeRooms: rooms.size,
    totalPlayers: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

// Store active match rooms
// Room structure: { id, players: [{ id, role, profile }], score: { player1: 0, player2: 0 }, games: { player1: 0, player2: 0 }, state: 'waiting' | 'playing' }
const rooms = new Map();

/**
 * Helper: Generate a unique 5-character room code (e.g. "SQUASH", "A7X92")
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

/**
 * Helper: Find an existing waiting room for matchmaking
 */
function findAvailableRoom() {
  for (const [code, room] of rooms.entries()) {
    if (room.isPublic && room.players.length === 1 && room.state === 'waiting') {
      return code;
    }
  }
  return null;
}

io.on('connection', (socket) => {
  console.log(`[+] Player connected: ${socket.id}`);
  let currentRoomCode = null;

  // --- ROOM MANAGEMENT ---

  // Create a new match room (Public or Private)
  socket.on('createRoom', ({ isPublic = true, playerProfile = {} } = {}) => {
    const roomCode = generateRoomCode();
    currentRoomCode = roomCode;

    const newRoom = {
      id: roomCode,
      isPublic,
      players: [
        {
          id: socket.id,
          role: 'player1',
          profile: playerProfile
        }
      ],
      score: { player1: 0, player2: 0 },
      games: { player1: 0, player2: 0 },
      state: 'waiting',
      serverRole: 'player1'
    };

    rooms.set(roomCode, newRoom);
    socket.join(roomCode);

    socket.emit('roomCreated', {
      roomCode,
      role: 'player1',
      roomState: newRoom
    });

    console.log(`[Room ${roomCode}] Created by ${socket.id}`);
  });

  // Join a specific match room using a 5-letter code
  socket.on('joinRoom', ({ roomCode, playerProfile = {} }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      return socket.emit('errorMsg', 'Room code does not exist.');
    }

    if (room.players.length >= 2) {
      return socket.emit('errorMsg', 'Room is full.');
    }

    currentRoomCode = code;
    const role = 'player2';

    room.players.push({
      id: socket.id,
      role,
      profile: playerProfile
    });

    socket.join(code);

    // Notify player of their assigned role
    socket.emit('roomJoined', {
      roomCode: code,
      role,
      roomState: room
    });

    // Notify host that player 2 joined
    socket.to(code).emit('opponentJoined', {
      role,
      profile: playerProfile
    });

    // If room is full, transition to game start
    if (room.players.length === 2) {
      room.state = 'playing';
      io.to(code).emit('matchStart', {
        roomState: room,
        serverRole: room.serverRole
      });
      console.log(`[Room ${code}] Match started between ${room.players[0].id} and ${room.players[1].id}`);
    }
  });

  // Matchmaking: Find any open public room or create one
  socket.on('findMatch', ({ playerProfile = {} } = {}) => {
    const openRoomCode = findAvailableRoom();

    if (openRoomCode) {
      socket.emit('matchFound', { roomCode: openRoomCode });
      // Player will now emit 'joinRoom' with openRoomCode
    } else {
      // No open room, create a public one
      const roomCode = generateRoomCode();
      currentRoomCode = roomCode;

      const newRoom = {
        id: roomCode,
        isPublic: true,
        players: [
          {
            id: socket.id,
            role: 'player1',
            profile: playerProfile
          }
        ],
        score: { player1: 0, player2: 0 },
        games: { player1: 0, player2: 0 },
        state: 'waiting',
        serverRole: 'player1'
      };

      rooms.set(roomCode, newRoom);
      socket.join(roomCode);

      socket.emit('roomCreated', {
        roomCode,
        role: 'player1',
        roomState: newRoom
      });
      console.log(`[Matchmaking] Created public room ${roomCode} for ${socket.id}`);
    }
  });

  // --- REAL-TIME GAMEPLAY SYNC ---

  // Player position, rotation, and animation updates
  socket.on('updateTransform', (data) => {
    if (!currentRoomCode) return;
    // Relay transform to opponent in the same room
    socket.to(currentRoomCode).emit('opponentTransform', {
      position: data.position,
      rotation: data.rotation,
      isDiving: data.isDiving,
      animState: data.animState,
      stamina: data.stamina
    });
  });

  // Ball hit/stroke event
  socket.on('ballHit', (data) => {
    if (!currentRoomCode) return;
    socket.to(currentRoomCode).emit('opponentBallHit', {
      pos: data.pos,
      vel: data.vel,
      shotType: data.shotType,
      chargeRatio: data.chargeRatio,
      hitBy: data.hitBy
    });
  });

  // Rally finished event (Point scored)
  socket.on('rallyEnd', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    if (data.winner) {
      room.score[data.winner] = (room.score[data.winner] || 0) + 1;
    }

    io.to(currentRoomCode).emit('rallyResult', {
      winner: data.winner,
      reason: data.reason,
      score: room.score,
      nextServer: data.winner || room.serverRole
    });
  });

  // Let called event (interference claim)
  socket.on('requestLet', (data) => {
    if (!currentRoomCode) return;
    io.to(currentRoomCode).emit('letTriggered', {
      caller: data.caller,
      reason: data.reason || 'Player Interference'
    });
  });

  // Quick Emotes / Taunts
  socket.on('sendEmote', (data) => {
    if (!currentRoomCode) return;
    socket.to(currentRoomCode).emit('opponentEmote', {
      emoji: data.emoji
    });
  });

  // --- DISCONNECT / CLEANUP ---

  socket.on('disconnect', () => {
    console.log(`[-] Player disconnected: ${socket.id}`);

    if (currentRoomCode && rooms.has(currentRoomCode)) {
      const room = rooms.get(currentRoomCode);
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        // Delete empty room
        rooms.delete(currentRoomCode);
        console.log(`[Room ${currentRoomCode}] Destroyed (Empty)`);
      } else {
        // Notify remaining opponent
        io.to(currentRoomCode).emit('opponentLeft', {
          reason: 'Opponent disconnected'
        });
        room.state = 'waiting';
      }
    }
  });
});

// Start listening
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`Squash Strike Server is live!`);
  console.log(`Listening on port: ${PORT}`);
  console.log(`=================================`);
});