const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const ROOM_CODE_LENGTH = 5;
const BETWEEN_ROUND_DELAY_MS = 2000;
const RESULT_FLASH_MS = 2000;
const DIRECTIONS = ["up", "down", "left", "right"];
const COLORS = ["red", "blue", "yellow", "green"];
const COLOR_TO_DIRECTION = {
  red: "up",
  blue: "left",
  yellow: "down",
  green: "right"
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("trust proxy", true);

const publicDir = path.join(__dirname, "public");
const flatDir = __dirname;
const staticDir = fs.existsSync(path.join(publicDir, "index.html")) ? publicDir : flatDir;

app.use(express.static(staticDir));
app.get("/", (req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

const rooms = new Map();

function now() {
  return Date.now();
}

function cleanName(name) {
  const value = String(name || "").trim().replace(/\s+/g, " ");
  return value.slice(0, 18) || "玩家";
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function createUniqueRoomCode() {
  let code = makeRoomCode();
  while (rooms.has(code)) code = makeRoomCode();
  return code;
}

function clampTotalRounds(value) {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) return 10;
  return Math.max(1, Math.min(30, rounded));
}

function getRoundMode(roundNumber) {
  return roundNumber % 2 === 1 ? "color" : "direction";
}

function getRoundRuleText(mode) {
  return mode === "color" ? "按颜色点击，不要被箭头骗了" : "按箭头点击，不要被颜色骗了";
}

function getRoundConfig(roundNumber) {
  const fixed = [
    { sequenceLength: 5, showSeconds: 1, answerSeconds: 5 },
    { sequenceLength: 6, showSeconds: 1, answerSeconds: 6 },
    { sequenceLength: 7, showSeconds: 1, answerSeconds: 7 },
    { sequenceLength: 8, showSeconds: 1, answerSeconds: 8 },
    { sequenceLength: 9, showSeconds: 1, answerSeconds: 9 },
    { sequenceLength: 10, showSeconds: 1, answerSeconds: 10 },
    { sequenceLength: 10, showSeconds: 0.7, answerSeconds: 7 },
    { sequenceLength: 10, showSeconds: 0.66, answerSeconds: 6.66 }
  ];

  const base =
    roundNumber <= fixed.length
      ? fixed[roundNumber - 1]
      : {
          sequenceLength: 10,
          showSeconds: Math.max(0.25, Number((0.66 - (roundNumber - 8) * 0.04).toFixed(2))),
          answerSeconds: Math.max(3, Number((6.66 - (roundNumber - 8) * 0.34).toFixed(2)))
        };

  const mode = getRoundMode(roundNumber);
  return {
    ...base,
    mode,
    ruleText: getRoundRuleText(mode)
  };
}

function makeSequence(length, mode) {
  return Array.from({ length }, () => {
    if (mode === "color") {
      const color = pick(COLORS);
      const matchingDirection = COLOR_TO_DIRECTION[color];
      const misleadingDirections = DIRECTIONS.filter((direction) => direction !== matchingDirection);
      const direction = Math.random() < 0.78 ? pick(misleadingDirections) : matchingDirection;
      return { direction, color };
    }

    const direction = pick(DIRECTIONS);
    const matchingColor = COLORS.find((color) => COLOR_TO_DIRECTION[color] === direction);
    const misleadingColors = COLORS.filter((color) => color !== matchingColor);
    const color = Math.random() < 0.78 ? pick(misleadingColors) : matchingColor;
    return { direction, color };
  });
}

function activePlayers(room) {
  return Array.from(room.players.values()).filter((player) => player.role === "player");
}

function publicPlayer(player, room) {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    role: player.role,
    isHost: player.id === room.hostId,
    joinedAt: player.joinedAt,
    completed: player.role === "player" ? Boolean(player.completed) : false,
    roundResult: player.roundResult || null
  };
}

function roomSnapshot(room) {
  return {
    roomCode: room.code,
    status: room.status,
    hostId: room.hostId,
    totalRounds: room.totalRounds,
    currentRound: room.currentRound,
    stage: room.stage,
    answerEndsAt: room.answerEndsAt,
    config: room.config,
    activeCount: activePlayers(room).length,
    waitingCount: Array.from(room.players.values()).filter((player) => player.role === "spectator").length,
    players: Array.from(room.players.values()).map((player) => publicPlayer(player, room))
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", roomSnapshot(room));
}

function emitError(socket, message) {
  socket.emit("notice", { type: "error", message });
}

function clearRoomTimers(room) {
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
}

function addRoomTimer(room, callback, delay) {
  const timer = setTimeout(() => {
    room.timers.delete(timer);
    callback();
  }, delay);
  room.timers.add(timer);
  return timer;
}

function createPlayer(socket, name, role) {
  return {
    id: socket.id,
    name: cleanName(name),
    role,
    score: 0,
    joinedAt: now(),
    completed: false,
    input: [],
    roundResult: null
  };
}

function attachSocketToRoom(socket, room, player) {
  room.players.set(player.id, player);
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerName = player.name;
  socket.emit("room:joined", { roomCode: room.code, playerId: player.id, role: player.role });
}

function createRoom(hostSocket, hostName) {
  const code = createUniqueRoomCode();
  const host = createPlayer(hostSocket, hostName, "player");
  const room = {
    code,
    status: "lobby",
    stage: "lobby",
    hostId: host.id,
    totalRounds: 10,
    currentRound: 0,
    sequence: [],
    config: null,
    timing: null,
    answerEndsAt: null,
    players: new Map(),
    timers: new Set()
  };
  rooms.set(code, room);
  attachSocketToRoom(hostSocket, room, host);
  emitRoom(room);
}

function joinRoom(socket, roomCode, playerName) {
  const code = String(roomCode || "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    emitError(socket, "房间不存在，请检查房间号。");
    return;
  }

  const role = room.status === "playing" ? "spectator" : "player";
  const player = createPlayer(socket, playerName, role);
  attachSocketToRoom(socket, room, player);

  if (role === "spectator") {
    socket.emit("notice", {
      type: "info",
      message: "本局已经开始，你正在观战，将在下一轮自动加入。"
    });
    if (room.config && room.timing) {
      if (room.stage === "showing") {
        socket.emit("round:start", {
          roundNumber: room.currentRound,
          totalRounds: room.totalRounds,
          sequence: room.sequence,
          config: room.config,
          ...room.timing,
          serverNow: now()
        });
      } else if (room.stage === "answering") {
        socket.emit("round:answer", {
          roundNumber: room.currentRound,
          config: room.config,
          answerEndsAt: room.timing.answerEndsAt,
          serverNow: now()
        });
      }
    }
  }
  emitRoom(room);
}

function promoteSpectators(room) {
  for (const player of room.players.values()) {
    if (player.role === "spectator") {
      player.role = "player";
      player.completed = false;
      player.input = [];
      player.roundResult = null;
    }
  }
}

function resetPlayerRoundState(room) {
  for (const player of room.players.values()) {
    if (player.role === "player") {
      player.completed = false;
      player.input = [];
      player.roundResult = null;
    }
  }
}

function startGame(room) {
  if (!room || activePlayers(room).length === 0) return;
  clearRoomTimers(room);
  room.status = "playing";
  room.currentRound = 0;
  room.timing = null;
  room.answerEndsAt = null;
  for (const player of room.players.values()) {
    player.role = "player";
    player.score = 0;
    player.roundResult = null;
    player.completed = false;
    player.input = [];
  }
  emitRoom(room);
  startNextRound(room);
}

function startNextRound(room) {
  if (!room || room.players.size === 0) return;
  clearRoomTimers(room);

  if (room.currentRound >= room.totalRounds) {
    endGame(room);
    return;
  }

  promoteSpectators(room);
  if (activePlayers(room).length === 0) {
    endGame(room);
    return;
  }

  room.currentRound += 1;
  room.stage = "showing";
  room.config = getRoundConfig(room.currentRound);
  room.sequence = makeSequence(room.config.sequenceLength, room.config.mode);
  room.answerEndsAt = null;
  resetPlayerRoundState(room);

  const showStartsAt = now() + 1400;
  const stepMs = Math.round(room.config.showSeconds * 1000);
  const answerStartsAt = showStartsAt + room.sequence.length * stepMs + 600;
  const answerEndsAt = answerStartsAt + Math.round(room.config.answerSeconds * 1000);
  room.timing = { showStartsAt, answerStartsAt, answerEndsAt };

  io.to(room.code).emit("round:start", {
    roundNumber: room.currentRound,
    totalRounds: room.totalRounds,
    sequence: room.sequence,
    config: room.config,
    showStartsAt,
    answerStartsAt,
    answerEndsAt,
    serverNow: now()
  });
  emitRoom(room);

  addRoomTimer(room, () => {
    room.stage = "answering";
    room.answerEndsAt = answerEndsAt;
    io.to(room.code).emit("round:answer", {
      roundNumber: room.currentRound,
      config: room.config,
      answerEndsAt,
      serverNow: now()
    });
    emitRoom(room);
  }, Math.max(0, answerStartsAt - now()));

  addRoomTimer(room, () => finishTimedOutPlayers(room), Math.max(0, answerEndsAt - now() + 80));
}

function expectedInputFor(item, mode) {
  if (mode === "color") return COLOR_TO_DIRECTION[item.color];
  return item.direction;
}

function answersMatch(input, sequence, mode) {
  if (input.length !== sequence.length) return false;
  return sequence.every((item, index) => expectedInputFor(item, mode) === input[index]);
}

function finishPlayer(room, player, input, reason = "submitted") {
  if (!room || !player || player.role !== "player" || player.completed || room.stage !== "answering") return;
  const finalInput = Array.isArray(input) ? input.slice(0, room.sequence.length) : [];
  const correct = reason === "submitted" && answersMatch(finalInput, room.sequence, room.config.mode);
  player.input = finalInput;
  player.completed = true;
  player.roundResult = correct ? "correct" : "wrong";
  player.score += correct ? 1 : -1;

  io.to(player.id).emit("round:result", {
    correct,
    result: player.roundResult,
    score: player.score,
    flashMs: RESULT_FLASH_MS
  });
  emitRoom(room);
  checkRoundComplete(room);
}

function finishTimedOutPlayers(room) {
  if (!room || room.stage !== "answering") return;
  for (const player of activePlayers(room)) {
    if (!player.completed) finishPlayer(room, player, player.input || [], "timeout");
  }
  checkRoundComplete(room);
}

function checkRoundComplete(room) {
  if (!room || room.status !== "playing" || room.stage !== "answering") return;
  const players = activePlayers(room);
  const everyoneDone = players.length === 0 || players.every((player) => player.completed);
  if (!everyoneDone) return;

  room.stage = "roundResult";
  room.answerEndsAt = null;
  emitRoom(room);
  addRoomTimer(room, () => startNextRound(room), BETWEEN_ROUND_DELAY_MS);
}

function endGame(room) {
  clearRoomTimers(room);
  room.status = "finished";
  room.stage = "finished";
  room.sequence = [];
  room.config = null;
  room.timing = null;
  room.answerEndsAt = null;
  for (const player of room.players.values()) {
    player.role = "player";
    player.completed = false;
    player.input = [];
  }
  io.to(room.code).emit("game:finished", roomSnapshot(room));
  emitRoom(room);
}

function transferHostIfNeeded(room) {
  if (!room || room.players.has(room.hostId)) return;
  const nextHost = Array.from(room.players.values()).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  room.hostId = nextHost ? nextHost.id : null;
}

function leaveCurrentRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  room.players.delete(socket.id);
  socket.leave(code);
  socket.data.roomCode = null;
  transferHostIfNeeded(room);

  if (room.players.size === 0) {
    clearRoomTimers(room);
    rooms.delete(code);
    return;
  }

  emitRoom(room);
  checkRoundComplete(room);
}

function publicJoinUrl(req, roomCode) {
  const protocol = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${protocol}://${req.get("host")}/?room=${encodeURIComponent(roomCode)}`;
}

app.get("/room-qr/:roomCode.svg", async (req, res) => {
  const roomCode = String(req.params.roomCode || "").trim().toUpperCase();
  const joinUrl = String(req.query.url || publicJoinUrl(req, roomCode));
  try {
    const svg = await QRCode.toString(joinUrl, {
      type: "svg",
      width: 260,
      margin: 1,
      color: {
        dark: "#101820",
        light: "#ffffff"
      }
    });
    res.type("image/svg+xml").send(svg);
  } catch (error) {
    res.status(500).send("QR generation failed");
  }
});

io.on("connection", (socket) => {
  socket.emit("hello", { id: socket.id, serverNow: now() });

  socket.on("room:create", ({ name } = {}) => {
    leaveCurrentRoom(socket);
    createRoom(socket, name);
  });

  socket.on("room:join", ({ roomCode, name } = {}) => {
    leaveCurrentRoom(socket);
    joinRoom(socket, roomCode, name);
  });

  socket.on("room:setRounds", ({ totalRounds } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.status === "playing") return;
    room.totalRounds = clampTotalRounds(totalRounds);
    emitRoom(room);
  });

  socket.on("game:start", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (activePlayers(room).length < 1) return;
    startGame(room);
  });

  socket.on("game:restart", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.status !== "finished") return;
    room.status = "lobby";
    room.stage = "lobby";
    room.currentRound = 0;
    room.sequence = [];
    room.config = null;
    room.timing = null;
    room.answerEndsAt = null;
    for (const player of room.players.values()) {
      player.role = "player";
      player.score = 0;
      player.completed = false;
      player.input = [];
      player.roundResult = null;
    }
    emitRoom(room);
  });

  socket.on("player:submit", ({ input } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.stage !== "answering") return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== "player" || player.completed) return;
    if (now() > room.answerEndsAt + 150) {
      finishPlayer(room, player, input || [], "timeout");
      return;
    }
    finishPlayer(room, player, input || [], "submitted");
  });

  socket.on("disconnect", () => leaveCurrentRoom(socket));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Direction Memory server running at http://localhost:${PORT}`);
});
