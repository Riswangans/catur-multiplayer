const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "catur-multiplayer" }));

// Rooms are intentionally in-memory: this is suitable for a small prototype.
// Render's free service can restart/sleep, so active rooms can be lost.
const rooms = new Map();

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function broadcast(room, payload) {
  for (const p of Object.values(room.players)) send(p && p.ws, payload);
}
function cleanName(value) {
  return String(value || "Pemain").trim().replace(/[<>]/g, "").slice(0, 18) || "Pemain";
}
function roomState(room) {
  return {
    type: "state",
    roomCode: room.code,
    players: {
      white: room.players.white ? room.players.white.name : null,
      black: room.players.black ? room.players.black.name : null
    },
    fen: room.chess.fen(),
    turn: room.chess.turn(),
    pgn: room.chess.pgn(),
    history: room.chess.history(),
    gameOver: room.chess.isGameOver(),
    check: room.chess.isCheck(),
    checkmate: room.chess.isCheckmate(),
    draw: room.chess.isDraw(),
    stalemate: room.chess.isStalemate(),
    insufficientMaterial: room.chess.isInsufficientMaterial(),
    winner: room.chess.isCheckmate() ? (room.chess.turn() === "w" ? "black" : "white") : null
  };
}
function notifyState(room) {
  broadcast(room, roomState(room));
}
function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}
function removePlayer(ws) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  if (room.players.white && room.players.white.ws === ws) room.players.white = null;
  if (room.players.black && room.players.black.ws === ws) room.players.black = null;
  ws.roomCode = null;
  if (!room.players.white && !room.players.black) {
    rooms.delete(code);
    return;
  }
  broadcast(room, { type: "notice", message: "Lawan terputus. Room tetap tersedia; pemain dapat masuk kembali dengan kode room." });
  notifyState(room);
}
function attachPlayer(ws, room, color, name) {
  room.players[color] = { ws, name: cleanName(name) };
  ws.roomCode = room.code;
  ws.color = color;
  send(ws, { type: "joined", color, roomCode: room.code });
  notifyState(room);
}

wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.color = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: "error", message: "Pesan tidak valid." }); }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "create") {
      if (ws.roomCode) return send(ws, { type: "error", message: "Keluar dari room saat ini dulu." });
      const code = makeCode();
      const room = { code, chess: new Chess(), players: { white: null, black: null } };
      rooms.set(code, room);
      attachPlayer(ws, room, "white", msg.name);
      return;
    }

    if (msg.type === "join") {
      if (ws.roomCode) return send(ws, { type: "error", message: "Keluar dari room saat ini dulu." });
      const code = String(msg.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: "error", message: "Room tidak ditemukan. Periksa kode room." });
      if (room.players.white && room.players.black) return send(ws, { type: "error", message: "Room sudah penuh." });
      const color = room.players.white ? "black" : "white";
      attachPlayer(ws, room, color, msg.name);
      return;
    }

    if (!ws.roomCode) return send(ws, { type: "error", message: "Buat atau gabung room terlebih dahulu." });
    const room = rooms.get(ws.roomCode);
    if (!room) {
      ws.roomCode = null;
      ws.color = null;
      return send(ws, { type: "error", message: "Room sudah berakhir. Buat room baru." });
    }

    if (msg.type === "move") {
      if (room.players[ws.color]?.ws !== ws) return;
      if (room.chess.isGameOver()) return send(ws, { type: "error", message: "Permainan sudah selesai." });
      if (room.chess.turn() !== (ws.color === "white" ? "w" : "b")) {
        return send(ws, { type: "error", message: "Belum giliran lu." });
      }
      const from = String(msg.from || "");
      const to = String(msg.to || "");
      const promotion = String(msg.promotion || "q").toLowerCase();
      if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to) || !["q", "r", "b", "n"].includes(promotion)) {
        return send(ws, { type: "error", message: "Langkah tidak valid." });
      }
      try {
        const move = room.chess.move({ from, to, promotion });
        if (!move) return send(ws, { type: "error", message: "Langkah catur tidak sah." });
        notifyState(room);
      } catch {
        send(ws, { type: "error", message: "Langkah catur tidak sah." });
      }
      return;
    }

    if (msg.type === "resign") {
      if (room.chess.isGameOver()) return;
      room.resigned = ws.color;
      broadcast(room, { type: "notice", message: `${room.players[ws.color]?.name || "Pemain"} menyerah. ${room.players[ws.color === "white" ? "black" : "white"]?.name || "Lawan"} menang.` });
      // End the game cleanly by reporting resignation separately; board remains visible.
      room.finishedByResignation = ws.color;
      broadcast(room, { type: "resigned", loser: ws.color, winner: ws.color === "white" ? "black" : "white" });
      return;
    }

    if (msg.type === "newgame") {
      // Either player may restart; notify both players and reset the board.
      room.chess = new Chess();
      room.resigned = null;
      room.finishedByResignation = null;
      notifyState(room);
      broadcast(room, { type: "notice", message: "Permainan baru dimulai." });
      return;
    }

    if (msg.type === "leave") {
      removePlayer(ws);
      ws.color = null;
      send(ws, { type: "left" });
    }
  });

  ws.on("close", () => removePlayer(ws));
  ws.on("error", () => removePlayer(ws));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Catur multiplayer listening on ${PORT}`);
});
