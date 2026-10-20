const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const PORT = process.env.PORT || 10000;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

app.use(express.json({ limit: "8kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "catur-multiplayer" }));

// Rooms are in-memory. Disconnects preserve seats for automatic reconnection,
// but a server restart/deploy still clears all rooms.
const rooms = new Map();
function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function broadcast(room, payload) {
  for (const p of Object.values(room.players)) if (p) send(p.ws, payload);
}
function cleanName(value) {
  return String(value || "Pemain").trim().replace(/[<>]/g, "").slice(0, 18) || "Pemain";
}
function roomState(room) {
  return {
    type: "state", roomCode: room.code,
    players: {
      white: room.players.white ? room.players.white.name : null,
      black: room.players.black ? room.players.black.name : null
    },
    fen: room.chess.fen(), turn: room.chess.turn(), pgn: room.chess.pgn(),
    history: room.chess.history(), gameOver: room.chess.isGameOver(),
    check: room.chess.isCheck(), checkmate: room.chess.isCheckmate(),
    draw: room.chess.isDraw(), stalemate: room.chess.isStalemate(),
    insufficientMaterial: room.chess.isInsufficientMaterial(),
    winner: room.chess.isCheckmate() ? (room.chess.turn() === "w" ? "black" : "white") : null
  };
}
function notifyState(room) { broadcast(room, roomState(room)); }
function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(""); }
  while (rooms.has(code));
  return code;
}
function makeRoom() {
  const code = makeCode();
  const room = { code, chess: new Chess(), players: { white: null, black: null }, createdAt: Date.now(), lastActivity: Date.now(), resigned: null, finishedByResignation: null };
  rooms.set(code, room);
  return room;
}
function attachPlayer(ws, room, color, name, token) {
  const existing = room.players[color];
  const playerToken = token || (existing && existing.token) || require("crypto").randomBytes(24).toString("hex");
  room.players[color] = { ws, name: cleanName(name || (existing && existing.name)), token: playerToken };
  room.lastActivity = Date.now();
  ws.roomCode = room.code; ws.color = color; ws.playerToken = playerToken;
  send(ws, { type: "joined", color, roomCode: room.code, token: playerToken, name: room.players[color].name });
  notifyState(room);
}
// Bot calls this endpoint when a user runs .catur. The room exists before anyone opens it.
app.post("/api/rooms", (_req, res) => {
  if (rooms.size >= 1000) return res.status(503).json({ ok: false, error: "Server sedang penuh. Coba lagi nanti." });
  const room = makeRoom();
  res.status(201).json({ ok: true, roomCode: room.code, url: `https://${_req.get("host")}/?room=${room.code}` });
});

function disconnectPlayer(ws, permanent = false) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) { ws.roomCode = null; ws.color = null; return; }
  const player = room.players[ws.color];
  if (player && player.ws === ws) {
    if (permanent) room.players[ws.color] = null;
    else player.ws = null; // retain seat + resume token for background/reconnect
  }
  ws.roomCode = null; ws.color = null;
  room.lastActivity = Date.now();
  if (permanent) send(ws, { type: "left" });
  if (!room.players.white && !room.players.black) {
    // Keep the room briefly so a reload or delayed invite can still use its code.
  } else {
    broadcast(room, { type: "notice", message: permanent ? "Pemain keluar dari room." : "Koneksi lawan terputus. Menunggu sambung ulang…" });
    notifyState(room);
  }
}

wss.on("connection", (ws) => {
  ws.roomCode = null; ws.color = null; ws.playerToken = null;
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: "error", message: "Pesan tidak valid." }); }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "create") {
      if (ws.roomCode) return send(ws, { type: "error", message: "Keluar dari room saat ini dulu." });
      const room = makeRoom();
      attachPlayer(ws, room, "white", msg.name, msg.token);
      return;
    }
    if (msg.type === "join") {
      if (ws.roomCode) return send(ws, { type: "error", message: "Keluar dari room saat ini dulu." });
      const code = String(msg.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: "error", message: "Room tidak ditemukan atau server baru saja restart. Buat room baru." });
      const color = !room.players.white ? "white" : !room.players.black ? "black" : null;
      if (!color) return send(ws, { type: "error", message: "Room sudah penuh." });
      attachPlayer(ws, room, color, msg.name, msg.token);
      return;
    }
    if (msg.type === "reconnect") {
      const code = String(msg.code || "").trim().toUpperCase();
      const color = msg.color === "black" ? "black" : "white";
      const room = rooms.get(code);
      if (!room) return send(ws, { type: "error", message: "Room sudah hilang karena server restart. Buat room baru dari .catur." });
      const player = room.players[color];
      if (!player || !msg.token || player.token !== msg.token) return send(ws, { type: "error", message: "Sesi sambung ulang tidak valid. Masuk room lagi menggunakan link atau kode." });
      if (player.ws && player.ws !== ws && player.ws.readyState === WebSocket.OPEN) {
        try { player.ws.close(4001, "Session resumed on another connection"); } catch {}
      }
      attachPlayer(ws, room, color, player.name, player.token);
      send(ws, { type: "notice", message: "Koneksi pulih. Permainan dilanjutkan." });
      return;
    }

    if (!ws.roomCode) return send(ws, { type: "error", message: "Buat atau gabung room terlebih dahulu." });
    const room = rooms.get(ws.roomCode);
    if (!room) { ws.roomCode = null; ws.color = null; return send(ws, { type: "error", message: "Room sudah berakhir. Buat room baru." }); }
    room.lastActivity = Date.now();

    if (msg.type === "move") {
      if (room.players[ws.color]?.ws !== ws) return;
      if (room.chess.isGameOver() || room.finishedByResignation) return send(ws, { type: "error", message: "Permainan sudah selesai." });
      if (room.chess.turn() !== (ws.color === "white" ? "w" : "b")) return send(ws, { type: "error", message: "Belum giliran lu." });
      const from = String(msg.from || ""), to = String(msg.to || ""), promotion = String(msg.promotion || "q").toLowerCase();
      if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to) || !["q", "r", "b", "n"].includes(promotion)) return send(ws, { type: "error", message: "Langkah tidak valid." });
      try {
        const move = room.chess.move({ from, to, promotion });
        if (!move) return send(ws, { type: "error", message: "Langkah catur tidak sah." });
        notifyState(room);
      } catch { send(ws, { type: "error", message: "Langkah catur tidak sah." }); }
      return;
    }
    if (msg.type === "resign") {
      if (room.chess.isGameOver() || room.finishedByResignation) return;
      room.resigned = ws.color;
      room.finishedByResignation = ws.color;
      broadcast(room, { type: "notice", message: `${room.players[ws.color]?.name || "Pemain"} menyerah. ${room.players[ws.color === "white" ? "black" : "white"]?.name || "Lawan"} menang.` });
      broadcast(room, { type: "resigned", loser: ws.color, winner: ws.color === "white" ? "black" : "white" });
      return;
    }
    if (msg.type === "newgame") {
      room.chess = new Chess(); room.resigned = null; room.finishedByResignation = null;
      notifyState(room); broadcast(room, { type: "notice", message: "Permainan baru dimulai." }); return;
    }
    if (msg.type === "leave") {
      disconnectPlayer(ws, true);
      send(ws, { type: "left" });
    }
  });
  ws.on("close", () => disconnectPlayer(ws, false));
  ws.on("error", () => disconnectPlayer(ws, false));
});

// Clean up old rooms that have no connected players. Keeps RAM bounded.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const connected = Object.values(room.players).some(p => p && p.ws && p.ws.readyState === WebSocket.OPEN);
    if (!connected && now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();

// Keepalive pings help detect dead network connections; client reconnect logic resumes seats.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { ws.terminate(); }
  }
}, 25000);
heartbeat.unref();
wss.on("connection", ws => { ws.isAlive = true; ws.on("pong", () => { ws.isAlive = true; }); });

server.listen(PORT, "0.0.0.0", () => console.log(`Catur multiplayer listening on ${PORT}`));
