const socket = io();

const directionMeta = {
  up: { arrow: "↑", text: "上" },
  down: { arrow: "↓", text: "下" },
  left: { arrow: "←", text: "左" },
  right: { arrow: "→", text: "右" }
};

const colorMeta = {
  red: { name: "红色", short: "红", css: "#ff4d5f" },
  blue: { name: "蓝色", short: "蓝", css: "#38a4ff" },
  yellow: { name: "黄色", short: "黄", css: "#ffd43b" },
  green: { name: "绿色", short: "绿", css: "#37d67a" }
};

const keyToDirection = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right"
};

const state = {
  playerId: null,
  room: null,
  stage: "entry",
  sequence: [],
  config: null,
  input: [],
  canAnswer: false,
  completed: false,
  localResult: null,
  clockOffset: 0,
  timers: new Set(),
  rafId: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  entryView: $("#entryView"),
  roomView: $("#roomView"),
  nameInput: $("#nameInput"),
  roomCodeInput: $("#roomCodeInput"),
  createRoomBtn: $("#createRoomBtn"),
  joinRoomBtn: $("#joinRoomBtn"),
  entryNotice: $("#entryNotice"),
  roomCodeText: $("#roomCodeText"),
  copyRoomBtn: $("#copyRoomBtn"),
  copyLinkBtn: $("#copyLinkBtn"),
  qrImage: $("#qrImage"),
  shareUrlText: $("#shareUrlText"),
  roundText: $("#roundText"),
  myScoreText: $("#myScoreText"),
  lobbyPanel: $("#lobbyPanel"),
  totalRoundsInput: $("#totalRoundsInput"),
  roundMinusBtn: $("#roundMinusBtn"),
  roundPlusBtn: $("#roundPlusBtn"),
  startGameBtn: $("#startGameBtn"),
  restartGameBtn: $("#restartGameBtn"),
  hostHint: $("#hostHint"),
  playerCountText: $("#playerCountText"),
  playerList: $("#playerList"),
  difficultyText: $("#difficultyText"),
  ruleBanner: $("#ruleBanner"),
  countdownText: $("#countdownText"),
  stageMessage: $("#stageMessage"),
  sequenceDisplay: $("#sequenceDisplay"),
  inputProgress: $("#inputProgress"),
  finalPanel: $("#finalPanel"),
  finalRankList: $("#finalRankList"),
  pad: $("#pad"),
  dirButtons: $$(".dir-btn")
};

function clientNow() {
  return Date.now() + state.clockOffset;
}

function rememberTimer(timer) {
  state.timers.add(timer);
  return timer;
}

function clearLocalTimers() {
  for (const timer of state.timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  state.timers.clear();
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
}

function setNotice(message, type = "info") {
  els.entryNotice.textContent = message || "";
  els.entryNotice.style.color = type === "error" ? "var(--danger)" : "var(--warning)";
}

function cleanName() {
  return els.nameInput.value.trim() || `玩家${Math.floor(Math.random() * 900 + 100)}`;
}

function switchToRoom() {
  els.entryView.classList.add("hidden");
  els.roomView.classList.remove("hidden");
}

function formatSeconds(value) {
  return Number(value).toFixed(2);
}

function ruleLabel(config) {
  if (!config) return "看清本轮规则";
  return config.mode === "color" ? "本轮规则：按颜色点击" : "本轮规则：按箭头点击";
}

function difficultyText(config) {
  if (!config) return "等待开始";
  return `${config.sequenceLength} 个记忆项 · 每个显示 ${formatSeconds(config.showSeconds)} 秒 · 答题时间 ${formatSeconds(
    config.answerSeconds
  )} 秒`;
}

function sortedPlayers() {
  if (!state.room) return [];
  return [...state.room.players].sort((a, b) => {
    if (a.role !== b.role) return a.role === "player" ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.joinedAt - b.joinedAt;
  });
}

function myPlayer() {
  if (!state.room) return null;
  return state.room.players.find((player) => player.id === state.playerId) || null;
}

function isHost() {
  const me = myPlayer();
  return Boolean(me && me.isHost);
}

function isSpectator() {
  return myPlayer()?.role === "spectator";
}

function joinUrl() {
  const code = state.room?.roomCode || "";
  const url = new URL(window.location.origin);
  url.searchParams.set("room", code);
  return url.toString();
}

function renderShare() {
  if (!state.room) return;
  const url = joinUrl();
  els.shareUrlText.textContent = url;
  els.qrImage.src = `/room-qr/${encodeURIComponent(state.room.roomCode)}.svg?url=${encodeURIComponent(url)}`;
}

function badgeForPlayer(player) {
  const badges = [];
  if (player.isHost) badges.push(`<span class="badge host">房主</span>`);
  if (player.role === "spectator") {
    badges.push(`<span class="badge wait">观战中</span>`);
    badges.push(`<span class="badge">下轮加入</span>`);
    return badges.join("");
  }
  if (state.room?.status === "playing") {
    if (player.completed && player.roundResult === "correct") badges.push(`<span class="badge done">正确</span>`);
    if (player.completed && player.roundResult === "wrong") badges.push(`<span class="badge wrong">错误</span>`);
    if (!player.completed && state.room.stage === "answering") badges.push(`<span class="badge">作答中</span>`);
  }
  return badges.join("");
}

function renderPlayers() {
  const players = sortedPlayers();
  const active = players.filter((player) => player.role === "player").length;
  const waiting = players.length - active;
  els.playerCountText.textContent = waiting > 0 ? `${active} 人 · ${waiting} 人观战` : `${active} 人`;
  els.playerList.innerHTML = players
    .map(
      (player) => `
        <div class="player-row ${player.role === "spectator" ? "is-waiting" : ""}">
          <div>
            <div class="player-name">${escapeHtml(player.name)}${player.id === state.playerId ? "（你）" : ""}</div>
            <div class="badges">${badgeForPlayer(player)}</div>
          </div>
          <div class="score">${player.score}</div>
        </div>
      `
    )
    .join("");
}

function renderFinalRanks() {
  const players = sortedPlayers();
  els.finalRankList.innerHTML = players
    .map(
      (player, index) => `
        <div class="player-row">
          <div class="player-name">#${index + 1} ${escapeHtml(player.name)}</div>
          <div class="score">${player.score}</div>
        </div>
      `
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderRoom() {
  if (!state.room) return;
  const room = state.room;
  const me = myPlayer();
  const host = isHost();
  const spectator = isSpectator();

  els.roomCodeText.textContent = room.roomCode;
  els.roundText.textContent = `第 ${room.currentRound || 0} / ${room.totalRounds} 轮`;
  els.myScoreText.textContent = me ? me.score : 0;
  els.totalRoundsInput.value = room.totalRounds;
  els.difficultyText.textContent = difficultyText(state.config || room.config);
  els.ruleBanner.textContent = ruleLabel(state.config || room.config);
  els.ruleBanner.classList.toggle("rule-color", (state.config || room.config)?.mode === "color");
  els.ruleBanner.classList.toggle("rule-direction", (state.config || room.config)?.mode === "direction");

  const inLobby = room.status === "lobby";
  const finished = room.status === "finished";
  els.lobbyPanel.classList.toggle("hidden", room.status === "playing");
  els.finalPanel.classList.toggle("hidden", !finished);
  els.startGameBtn.classList.toggle("hidden", finished);
  els.restartGameBtn.classList.toggle("hidden", !finished);
  els.startGameBtn.disabled = !host || !inLobby;
  els.restartGameBtn.disabled = !host || !finished;
  els.totalRoundsInput.disabled = !host || room.status === "playing";
  els.roundMinusBtn.disabled = !host || room.status === "playing";
  els.roundPlusBtn.disabled = !host || room.status === "playing";
  renderShare();

  if (inLobby) {
    els.hostHint.textContent = host
      ? `房间内已有 ${room.players.length} 位玩家，可以扫码邀请朋友，调整轮数后开始。`
      : "等待房主开始。";
    els.stageMessage.textContent = "等待房主开始游戏";
    els.countdownText.textContent = "--";
    els.sequenceDisplay.textContent = "";
    els.inputProgress.textContent = "已输入 0 / 0";
    state.config = null;
    setPadEnabled(false);
  } else if (finished) {
    els.hostHint.textContent = host ? "可以调整轮数，然后点击再来一局。" : "等待房主开启下一局。";
    els.stageMessage.textContent = "游戏结束";
    els.countdownText.textContent = "END";
    els.sequenceDisplay.textContent = "";
    els.inputProgress.textContent = "查看最终排行榜";
    state.config = null;
    setPadEnabled(false);
    renderFinalRanks();
  } else if (spectator && room.stage === "answering") {
    setPadEnabled(false);
    els.stageMessage.textContent = "观战中，下轮自动加入";
  }

  renderPlayers();
}

function setPadEnabled(enabled) {
  const allow = Boolean(enabled && !isSpectator());
  state.canAnswer = allow;
  els.dirButtons.forEach((button) => {
    button.disabled = !allow;
  });
}

function setPadResult(result) {
  els.pad.classList.remove("correct", "wrong");
  if (result) els.pad.classList.add(result);
}

function pulseButton(direction) {
  const button = els.dirButtons.find((item) => item.dataset.dir === direction);
  if (!button) return;
  button.classList.add("pressed");
  rememberTimer(setTimeout(() => button.classList.remove("pressed"), 120));
}

function updateInputProgress() {
  const total = state.sequence.length || state.config?.sequenceLength || 0;
  els.inputProgress.textContent = `已输入 ${state.input.length} / ${total}`;
}

function submitIfComplete() {
  if (state.input.length !== state.sequence.length) return;
  state.completed = true;
  setPadEnabled(false);
  els.stageMessage.textContent = "等待其他玩家完成……";
  socket.emit("player:submit", { input: state.input });
}

function handleDirection(direction) {
  if (!state.canAnswer || state.completed || !direction) return;
  state.input.push(direction);
  pulseButton(direction);
  updateInputProgress();
  submitIfComplete();
}

function startCountdown(targetTime, options = {}) {
  const { precision = 1, onDone, doneText = "0.0" } = options;
  if (state.rafId) cancelAnimationFrame(state.rafId);

  function tick() {
    const remaining = Math.max(0, (targetTime - clientNow()) / 1000);
    els.countdownText.textContent = remaining > 0 ? remaining.toFixed(precision) : doneText;
    if (remaining <= 0) {
      state.rafId = null;
      if (onDone) onDone();
      return;
    }
    state.rafId = requestAnimationFrame(tick);
  }

  tick();
}

function scheduleAt(serverTime, callback) {
  return rememberTimer(setTimeout(callback, Math.max(0, serverTime - clientNow())));
}

function showSequenceItem(item) {
  const direction = directionMeta[item.direction];
  const color = colorMeta[item.color];
  els.sequenceDisplay.innerHTML = `
    <span class="shown-arrow" style="color: ${color.css}; text-shadow: 0 0 32px ${color.css}66">${direction.arrow}</span>
    <span class="shown-info">${direction.text} · ${color.name}</span>
  `;
}

function showSequence(payload) {
  clearLocalTimers();
  setPadResult(null);
  setPadEnabled(false);
  state.stage = "showing";
  state.sequence = payload.sequence;
  state.config = payload.config;
  state.input = [];
  state.completed = false;
  state.localResult = null;

  els.difficultyText.textContent = difficultyText(payload.config);
  els.ruleBanner.textContent = ruleLabel(payload.config);
  els.ruleBanner.classList.toggle("rule-color", payload.config.mode === "color");
  els.ruleBanner.classList.toggle("rule-direction", payload.config.mode === "direction");
  els.stageMessage.classList.remove("stage-correct", "stage-wrong");
  els.stageMessage.textContent = payload.config.ruleText;
  els.sequenceDisplay.innerHTML = "";
  updateInputProgress();
  startCountdown(payload.answerStartsAt, { doneText: "GO" });

  const stepMs = Math.round(payload.config.showSeconds * 1000);
  payload.sequence.forEach((item, index) => {
    const itemStartsAt = payload.showStartsAt + index * stepMs;
    const itemEndsAt = itemStartsAt + Math.max(120, stepMs - 80);
    if (itemEndsAt < clientNow()) return;

    if (itemStartsAt <= clientNow()) {
      showSequenceItem(item);
    } else {
      scheduleAt(itemStartsAt, () => showSequenceItem(item));
    }

    scheduleAt(itemEndsAt, () => {
      els.sequenceDisplay.innerHTML = "";
    });
  });
}

function enterAnswerPhase(payload) {
  state.stage = "answering";
  state.input = [];
  state.completed = false;
  setPadResult(null);
  els.stageMessage.classList.remove("stage-correct", "stage-wrong");
  els.ruleBanner.textContent = ruleLabel(payload.config || state.config);
  els.stageMessage.textContent = isSpectator() ? "观战中，下轮自动加入" : (payload.config || state.config).ruleText;
  els.sequenceDisplay.innerHTML = "";
  updateInputProgress();
  setPadEnabled(!isSpectator());
  startCountdown(payload.answerEndsAt, {
    doneText: "0.0",
    onDone: () => {
      if (!state.completed) {
        state.completed = true;
        setPadEnabled(false);
        els.stageMessage.textContent = isSpectator() ? "观战中，下轮自动加入" : "等待其他玩家完成……";
      }
    }
  });
}

function applyRoundResult(payload) {
  state.localResult = payload.result;
  state.completed = true;
  setPadEnabled(false);
  setPadResult(payload.correct ? "correct" : "wrong");
  els.stageMessage.classList.toggle("stage-correct", payload.correct);
  els.stageMessage.classList.toggle("stage-wrong", !payload.correct);
  els.stageMessage.textContent = payload.correct ? "本轮正确！" : "本轮错误";
  els.myScoreText.textContent = payload.score;
  rememberTimer(
    setTimeout(() => {
      setPadResult(null);
      els.stageMessage.classList.remove("stage-correct", "stage-wrong");
      els.stageMessage.textContent = "等待其他玩家完成……";
    }, payload.flashMs || 2000)
  );
}

function setRounds(value) {
  const next = Math.max(1, Math.min(30, Math.round(Number(value) || 10)));
  els.totalRoundsInput.value = next;
  socket.emit("room:setRounds", { totalRounds: next });
}

async function copyText(text, fallbackButton, doneText) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const oldText = fallbackButton.textContent;
    fallbackButton.textContent = doneText;
    setTimeout(() => {
      fallbackButton.textContent = oldText;
    }, 1000);
  } catch {
    fallbackButton.textContent = text;
  }
}

function hydrateRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get("room");
  if (roomCode) {
    els.roomCodeInput.value = roomCode.toUpperCase();
    setNotice("已填入扫码房间号，输入昵称后点击加入。");
  }
}

els.createRoomBtn.addEventListener("click", () => {
  setNotice("");
  socket.emit("room:create", { name: cleanName() });
});

els.joinRoomBtn.addEventListener("click", () => {
  const roomCode = els.roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) {
    setNotice("请输入房间号。", "error");
    return;
  }
  setNotice("");
  socket.emit("room:join", { roomCode, name: cleanName() });
});

els.roomCodeInput.addEventListener("input", () => {
  els.roomCodeInput.value = els.roomCodeInput.value.toUpperCase();
});

els.copyRoomBtn.addEventListener("click", () => copyText(state.room?.roomCode, els.copyRoomBtn, "已复制"));
els.copyLinkBtn.addEventListener("click", () => copyText(joinUrl(), els.copyLinkBtn, "已复制"));
els.roundMinusBtn.addEventListener("click", () => setRounds(Number(els.totalRoundsInput.value) - 1));
els.roundPlusBtn.addEventListener("click", () => setRounds(Number(els.totalRoundsInput.value) + 1));
els.totalRoundsInput.addEventListener("change", () => setRounds(els.totalRoundsInput.value));
els.startGameBtn.addEventListener("click", () => {
  setRounds(els.totalRoundsInput.value);
  socket.emit("game:start");
});
els.restartGameBtn.addEventListener("click", () => socket.emit("game:restart"));

els.dirButtons.forEach((button) => {
  button.addEventListener("click", () => handleDirection(button.dataset.dir));
});

window.addEventListener(
  "keydown",
  (event) => {
    const direction = keyToDirection[event.key];
    if (!direction) return;
    event.preventDefault();
    handleDirection(direction);
  },
  { passive: false }
);

socket.on("hello", ({ id, serverNow }) => {
  state.playerId = id;
  state.clockOffset = serverNow - Date.now();
});

socket.on("notice", ({ message, type }) => setNotice(message, type));

socket.on("room:joined", ({ roomCode, playerId }) => {
  state.playerId = playerId;
  els.roomCodeInput.value = roomCode;
  switchToRoom();
});

socket.on("room:update", (room) => {
  state.room = room;
  renderRoom();
});

socket.on("round:start", (payload) => {
  state.clockOffset = payload.serverNow - Date.now();
  showSequence(payload);
});

socket.on("round:answer", (payload) => {
  state.clockOffset = payload.serverNow - Date.now();
  enterAnswerPhase(payload);
});

socket.on("round:result", (payload) => applyRoundResult(payload));

socket.on("game:finished", (room) => {
  clearLocalTimers();
  state.room = room;
  renderRoom();
});

hydrateRoomFromUrl();
