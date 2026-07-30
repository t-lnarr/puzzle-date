const socket = io();

// ---------- Screen management ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ---------- State ----------
let myRoomCode = null;
let peerId = null;
let isInitiator = false;
let myColor = "blue";
let peerColor = "red";
let pc = null;
let localStream = null;
let selectedImageKey = "sunset";
let customImageUrl = null;
let selectedGridSize = 10;
let boardEl, scatterEl, wrapEl;
let pieceEls = {}; // id -> element
let puzzleMeta = null; // {imageKey, gridSize, pieces}
let dragState = null;
let startTime = null;
let timerInterval = null;

// ---------- Landing ----------
document.getElementById("btn-create").addEventListener("click", () => {
  socket.emit("create-room", (res) => {
    if (!res.ok) return;
    myRoomCode = res.code;
    isInitiator = true;
    myColor = res.color || "blue";
    peerColor = myColor === "blue" ? "red" : "blue";
    applyVideoColors();
    updateStartButtonVisibility();
    document.getElementById("room-code-display").textContent = res.code;
    showScreen("screen-waiting");
    initMedia();
  });
});

document.getElementById("btn-join").addEventListener("click", () => joinRoom());
document.getElementById("input-code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});

function joinRoom() {
  const code = document.getElementById("input-code").value.trim().toUpperCase();
  const errEl = document.getElementById("landing-error");
  errEl.textContent = "";
  if (code.length !== 5) {
    errEl.textContent = "5 haneli oda kodunu gir.";
    return;
  }
  socket.emit("join-room", code, (res) => {
    if (!res.ok) {
      errEl.textContent = res.error;
      return;
    }
    myRoomCode = res.code;
    isInitiator = false;
    myColor = res.color || "red";
    peerColor = myColor === "blue" ? "red" : "blue";
    applyVideoColors();
    updateStartButtonVisibility();
    initMedia().then(() => {
      if (res.puzzle) {
        // Rejoining a room where the game already started -- resume
        // straight into it instead of the puzzle-select screen.
        puzzleMeta = res.puzzle;
        startGame();
      } else {
        showScreen("screen-select");
      }
    });
  });
}

function applyVideoColors() {
  const localVideo = document.getElementById("video-local");
  const remoteVideo = document.getElementById("video-remote");
  localVideo.classList.remove("border-blue", "border-red");
  remoteVideo.classList.remove("border-blue", "border-red");
  localVideo.classList.add(`border-${myColor}`);
  remoteVideo.classList.add(`border-${peerColor}`);
}

// ---------- WebRTC ----------
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("video-local").srcObject = localStream;
  } catch (e) {
    console.warn("Kamera/mikrofon alınamadı:", e);
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }
  pc.ontrack = (event) => {
    document.getElementById("video-remote").srcObject = event.streams[0];
  };
  pc.onicecandidate = (event) => {
    if (event.candidate && peerId) {
      socket.emit("signal", { to: peerId, data: { candidate: event.candidate } });
    }
  };
}

socket.on("peer-joined", async ({ socketId }) => {
  peerId = socketId;
  createPeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: peerId, data: { sdp: offer } });
  // Only the very first join (before any puzzle exists) should jump to the
  // puzzle-select screen. If a game is already running and the partner
  // reconnects, stay right where we are -- just the video call re-links.
  if (!puzzleMeta) {
    showScreen("screen-select");
  } else {
    hideToast();
    showToast("Partnerin geri döndü 💕", { duration: 2500 });
  }
});

socket.on("signal", async ({ from, data }) => {
  peerId = from;
  if (data.sdp) {
    if (data.sdp.type === "offer") {
      if (!pc) createPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { to: peerId, data: { sdp: answer } });
    } else if (data.sdp.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    }
  } else if (data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {}
  }
});

socket.on("peer-left", () => {
  if (pc) {
    pc.close();
    pc = null;
  }
  const remoteVideo = document.getElementById("video-remote");
  if (remoteVideo) remoteVideo.srcObject = null;
  peerId = null;
  showToast("Partnerin bağlantısı koptu. Aynı oda koduyla tekrar katılabilir 💌", { persist: true });
});

// ---------- Toast notifications ----------
function showToast(message, opts = {}) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toast._hideTimer);
  if (!opts.persist) {
    toast._hideTimer = setTimeout(() => toast.classList.remove("show"), opts.duration || 3500);
  }
}
function hideToast() {
  const toast = document.getElementById("toast");
  if (toast) toast.classList.remove("show");
}

// ---------- Puzzle selection ----------
document.querySelectorAll(".puzzle-choice:not(.puzzle-upload)").forEach((el) => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".puzzle-choice").forEach((c) => c.classList.remove("selected"));
    el.classList.add("selected");
    selectedImageKey = el.dataset.key;
  });
});
document.querySelector(".puzzle-choice[data-key='sunset']").classList.add("selected");

// ---------- Custom photo upload ----------
const uploadTile = document.getElementById("puzzle-upload-tile");
const uploadInput = document.getElementById("input-custom-image");
const uploadStatus = document.getElementById("upload-status");
const uploadPlaceholder = uploadTile.querySelector(".upload-placeholder");

uploadTile.addEventListener("click", (e) => {
  e.stopPropagation();
  uploadInput.click();
});

uploadInput.addEventListener("change", () => {
  const file = uploadInput.files[0];
  uploadInput.value = ""; // allow re-selecting the same file later
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    uploadStatus.textContent = "Lütfen bir görsel dosyası seç.";
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    uploadStatus.textContent = "Dosya çok büyük (en fazla 8MB).";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    uploadTile.classList.add("has-image");
    uploadPlaceholder.innerHTML = `<img src="${dataUrl}" alt="Seçilen fotoğraf" />`;
    uploadStatus.textContent = "Yükleniyor…";

    fetch("/upload-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageData: dataUrl }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) {
          uploadStatus.textContent = res.error || "Yükleme başarısız oldu.";
          return;
        }
        customImageUrl = res.url;
        selectedImageKey = "custom";
        uploadStatus.textContent = "Fotoğrafın hazır 💕";
        document.querySelectorAll(".puzzle-choice").forEach((c) => c.classList.remove("selected"));
        uploadTile.classList.add("selected");
      })
      .catch(() => {
        uploadStatus.textContent = "Yükleme başarısız oldu, tekrar dener misin?";
      });
  };
  reader.readAsDataURL(file);
});

document.querySelectorAll(".grid-btn").forEach((el) => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".grid-btn").forEach((c) => c.classList.remove("active"));
    el.classList.add("active");
    selectedGridSize = parseInt(el.dataset.size, 10);
  });
});

// Only the room creator picks the puzzle and starts the round -- their
// screen shows the choices + start button, the other player just sees a
// waiting hint until it's pressed.
function updateStartButtonVisibility() {
  const controls = document.getElementById("select-controls");
  const hint = document.getElementById("select-waiting-hint");
  controls.style.display = isInitiator ? "" : "none";
  hint.style.display = isInitiator ? "none" : "";
}

let choiceLocked = false;
document.getElementById("btn-start-game").addEventListener("click", () => {
  if (choiceLocked || !isInitiator) return;
  choiceLocked = true;
  socket.emit("select-puzzle", {
    imageKey: selectedImageKey,
    gridSize: selectedGridSize,
    customImageUrl: selectedImageKey === "custom" ? customImageUrl : null,
  });
});

socket.on("puzzle-state", (state) => {
  puzzleMeta = state;
  startGame();
});

// ---------- Jigsaw piece shape ----------
// Builds a puzzle-piece SVG path for one edge (tab, blank, or straight) and
// appends it to `d`. `sign` is 0 for a straight boundary edge, otherwise the
// signed tab direction. `mapFn(u, v)` maps local edge coords (u = along the
// edge 0..S, v = signed bulge amount) to absolute (x, y) box coordinates.
const TAB_SHAPE = [
  [0.0, 0.0], [0.4, 0.0], [0.42, 0.65], [0.28, 0.8], [0.28, 1.1],
  [0.38, 1.35], [0.5, 1.42], [0.62, 1.35], [0.72, 1.1], [0.72, 0.8],
  [0.58, 0.65], [0.6, 0.0], [1.0, 0.0],
];

function tabAnchorPoints(S, amp, sign) {
  return TAB_SHAPE.map(([fu, fd]) => [fu * S, fd * amp * sign]);
}

function crBezier(p0, p1, p2, p3) {
  return [
    [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
    [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
  ];
}

function appendEdge(d, S, amp, sign, mapFn) {
  if (sign === 0) {
    const [x, y] = mapFn(S, 0);
    d.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
    return;
  }
  const P = tabAnchorPoints(S, amp, sign);
  const [lx, ly] = mapFn(P[1][0], P[1][1]);
  d.push(`L ${lx.toFixed(2)} ${ly.toFixed(2)}`);
  for (let i = 1; i < P.length - 1; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
    const [c1, c2] = crBezier(p0, p1, p2, p3);
    const [c1x, c1y] = mapFn(c1[0], c1[1]);
    const [c2x, c2y] = mapFn(c2[0], c2[1]);
    const [px, py] = mapFn(p2[0], p2[1]);
    d.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${px.toFixed(2)} ${py.toFixed(2)}`
    );
  }
}

// pad = transparent margin around the S x S base square that gives tabs room
// to bulge outward. top/right/bottom/left are 0 (straight, grid boundary) or
// +-1 (which piece "owns" the tab on that shared edge).
// x0/y0 = where the S x S base square starts (in whatever coordinate space
// the caller is drawing in -- a piece's own small box, or a shared cell
// position within the full board).
function buildEdgePath(S, x0, y0, amp, top, right, bottom, left) {
  const d = [`M ${x0.toFixed(2)} ${y0.toFixed(2)}`];
  appendEdge(d, S, amp, -top, (u, v) => [x0 + u, y0 + v]);
  appendEdge(d, S, amp, right, (u, v) => [x0 + S + v, y0 + u]);
  appendEdge(d, S, amp, bottom, (u, v) => [x0 + S - u, y0 + S + v]);
  appendEdge(d, S, amp, -left, (u, v) => [x0 + v, y0 + S - u]);
  d.push("Z");
  return d.join(" ");
}

function buildPiecePath(S, pad, top, right, bottom, left, amp) {
  return buildEdgePath(S, pad, pad, amp, top, right, bottom, left);
}

// Which shape each side of piece (r,c) has, given the puzzle's shared edge
// data (edgesH = vertical-line edges between columns, edgesV = horizontal-line
// edges between rows). 0 = straight outer border.
function pieceEdgeShapes(r, c, N, edgesH, edgesV) {
  return {
    top: r === 0 ? 0 : -edgesV[r - 1][c],
    bottom: r === N - 1 ? 0 : edgesV[r][c],
    left: c === 0 ? 0 : -edgesH[r][c - 1],
    right: c === N - 1 ? 0 : edgesH[r][c],
  };
}

// ---------- Game rendering ----------
function startGame() {
  showScreen("screen-game");
  boardEl = document.getElementById("puzzle-board");
  scatterEl = document.getElementById("puzzle-scatter");
  wrapEl = document.getElementById("puzzle-wrap");
  boardEl.innerHTML = "";
  scatterEl.innerHTML = "";
  pieceEls = {};

  const N = puzzleMeta.gridSize;
  const imgUrl = puzzleMeta.customImageUrl || `images/${puzzleMeta.imageKey}.png`;

  requestAnimationFrame(() => {
    const wrapRect = wrapEl.getBoundingClientRect();
    const boardSize = Math.min(wrapRect.width, wrapRect.height) * 0.55;
    const pieceSize = boardSize / N; // S: base cell size (no overhang)
    const pad = pieceSize * 0.32; // margin for tabs to bulge outward
    const amp = pieceSize * 0.2; // tab bulge amplitude
    const boxSize = pieceSize + pad * 2; // full piece element size (S + 2*pad)

    // Crisp, thin edge lines regardless of how small the pieces get at
    // higher grid sizes -- scaled to piece size rather than a fixed px
    // value, so a 15x15 piece doesn't end up with a border thicker than
    // the piece itself.
    const edgeStroke = Math.max(0.5, Math.min(1.4, pieceSize * 0.014));

    boardEl.style.width = boardSize + "px";
    boardEl.style.height = boardSize + "px";

    // Instead of a plain N x N grid of square cells, draw the actual jigsaw
    // cut lines for every slot -- so an empty spot on the board shows the
    // tab/blank silhouette of the exact piece that belongs there.
    const slotSvgNS = "http://www.w3.org/2000/svg";
    const slotSvg = document.createElementNS(slotSvgNS, "svg");
    slotSvg.classList.add("board-slots");
    slotSvg.setAttribute("width", boardSize);
    slotSvg.setAttribute("height", boardSize);
    slotSvg.setAttribute("viewBox", `0 0 ${boardSize} ${boardSize}`);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const shapes = pieceEdgeShapes(r, c, N, puzzleMeta.edgesH, puzzleMeta.edgesV);
        const d = buildEdgePath(pieceSize, c * pieceSize, r * pieceSize, amp, shapes.top, shapes.right, shapes.bottom, shapes.left);
        const slotPath = document.createElementNS(slotSvgNS, "path");
        slotPath.setAttribute("d", d);
        slotPath.setAttribute("fill", "none");
        slotPath.setAttribute("stroke-width", edgeStroke.toFixed(2));
        slotSvg.appendChild(slotPath);
      }
    }
    boardEl.appendChild(slotSvg);

    Object.entries(puzzleMeta.pieces).forEach(([id, p]) => {
      const [r, c] = id.split("-").map(Number);
      const shapes = pieceEdgeShapes(r, c, N, puzzleMeta.edgesH, puzzleMeta.edgesV);
      const pathD = buildPiecePath(pieceSize, pad, shapes.top, shapes.right, shapes.bottom, shapes.left, amp);
      const patId = `pat-${id}`;

      const el = document.createElement("div");
      el.className = "piece";
      el.style.width = boxSize + "px";
      el.style.height = boxSize + "px";
      el.dataset.id = id;

      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("width", boxSize);
      svg.setAttribute("height", boxSize);
      svg.setAttribute("viewBox", `0 0 ${boxSize} ${boxSize}`);

      const defs = document.createElementNS(svgNS, "defs");
      const pattern = document.createElementNS(svgNS, "pattern");
      pattern.setAttribute("id", patId);
      pattern.setAttribute("patternUnits", "userSpaceOnUse");
      pattern.setAttribute("width", boardSize);
      pattern.setAttribute("height", boardSize);
      pattern.setAttribute("x", pad - c * pieceSize);
      pattern.setAttribute("y", pad - r * pieceSize);
      const image = document.createElementNS(svgNS, "image");
      image.setAttributeNS("http://www.w3.org/1999/xlink", "href", imgUrl);
      image.setAttribute("href", imgUrl);
      image.setAttribute("x", 0);
      image.setAttribute("y", 0);
      image.setAttribute("width", boardSize);
      image.setAttribute("height", boardSize);
      image.setAttribute("preserveAspectRatio", "none");
      pattern.appendChild(image);
      defs.appendChild(pattern);
      svg.appendChild(defs);

      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", pathD);
      path.setAttribute("fill", `url(#${patId})`);
      path.style.setProperty("--edge-stroke", edgeStroke.toFixed(2) + "px");
      svg.appendChild(path);

      el.appendChild(svg);
      pieceEls[id] = el;

      // Pieces always live in #puzzle-scatter (one shared coordinate frame
      // that lines up 1:1 with #puzzle-wrap). "Locked" is just a class +
      // position, not a different parent -- that way a locked piece can
      // still be picked back up and re-dropped without any bookkeeping.
      scatterEl.appendChild(el);
      if (p.locked) {
        placeLocked(el, r, c, pieceSize, pad);
      } else {
        positionScattered(el, p.x, p.y);
      }
      attachDrag(el, path, id, pieceSize, pad, boxSize);
    });

    startTimer();
  });
}

// Where #puzzle-board sits relative to #puzzle-wrap (both are absolutely
// positioned within the same parent), so a locked piece's left/top can be
// expressed in the same coordinate frame as every other piece.
function boardOffset() {
  const wrapRect = wrapEl.getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();
  return { x: boardRect.left - wrapRect.left, y: boardRect.top - wrapRect.top };
}

function placeLocked(el, r, c, pieceSize, pad) {
  const off = boardOffset();
  el.classList.remove("drag-blue", "drag-red", "dragging");
  el.classList.add("locked");
  el.style.left = off.x + c * pieceSize - pad + "px";
  el.style.top = off.y + r * pieceSize - pad + "px";
}

function positionScattered(el, xFrac, yFrac) {
  const wrapRect = wrapEl.getBoundingClientRect();
  const boxSize = parseFloat(el.style.width);
  const maxX = wrapRect.width - boxSize;
  const maxY = wrapRect.height - boxSize;
  el.style.left = xFrac * maxX + "px";
  el.style.top = yFrac * maxY + "px";
}

function attachDrag(el, hitEl, id, pieceSize, pad, boxSize) {
  let lastEmitTime = 0;

  function emitMove(left, top) {
    const wrapRect = wrapEl.getBoundingClientRect();
    const maxX = wrapRect.width - boxSize;
    const maxY = wrapRect.height - boxSize;
    const xFrac = Math.max(0, Math.min(1, left / maxX));
    const yFrac = Math.max(0, Math.min(1, top / maxY));
    socket.emit("move-piece", { id, x: xFrac, y: yFrac });
  }

  // Pointer listeners live on the SVG <path> itself, so only its painted
  // (visible jigsaw-shaped) area is draggable -- not the transparent margin
  // around it where tabs have room to bulge.
  hitEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    hitEl.setPointerCapture(e.pointerId);

    // Picking a placed piece back up: unlock it so it becomes free-floating
    // again, and tell the other player.
    if (el.classList.contains("locked")) {
      el.classList.remove("locked");
      socket.emit("unlock-piece", { id });
    }

    el.classList.add("dragging", `drag-${myColor}`);
    const rect = el.getBoundingClientRect();
    dragState = {
      id,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    socket.emit("piece-drag-start", { id });
  });

  hitEl.addEventListener("pointermove", (e) => {
    if (!dragState || dragState.id !== id) return;
    const wrapRect = wrapEl.getBoundingClientRect();
    let left = e.clientX - wrapRect.left - dragState.offsetX;
    let top = e.clientY - wrapRect.top - dragState.offsetY;

    // Keep the piece inside the puzzle area -- otherwise it can be dragged
    // out past the edge, clipped by overflow:hidden, and effectively lost.
    const maxX = wrapRect.width - boxSize;
    const maxY = wrapRect.height - boxSize;
    left = Math.max(0, Math.min(maxX, left));
    top = Math.max(0, Math.min(maxY, top));

    el.style.left = left + "px";
    el.style.top = top + "px";

    // Broadcast live position to the other player (throttled).
    const now = Date.now();
    if (now - lastEmitTime > 35) {
      lastEmitTime = now;
      emitMove(left, top);
    }
  });

  function finishDrag() {
    if (!dragState || dragState.id !== id) return;
    el.classList.remove("dragging", `drag-${myColor}`);
    dragState = null;
    socket.emit("piece-drag-end", { id });

    const off = boardOffset();
    const [r, c] = id.split("-").map(Number);
    const correctLeft = off.x + c * pieceSize - pad;
    const correctTop = off.y + r * pieceSize - pad;
    const curLeft = parseFloat(el.style.left);
    const curTop = parseFloat(el.style.top);
    const dist = Math.hypot(curLeft - correctLeft, curTop - correctTop);

    if (dist < pieceSize * 0.35) {
      // snap + lock into its slot
      placeLocked(el, r, c, pieceSize, pad);
      socket.emit("lock-piece", { id });
      checkWin();
    } else {
      emitMove(curLeft, curTop);
    }
  }

  hitEl.addEventListener("pointerup", finishDrag);
  hitEl.addEventListener("pointercancel", finishDrag);
}

socket.on("piece-drag-start", ({ id, color }) => {
  const el = pieceEls[id];
  if (!el) return;
  el.classList.remove("locked", "drag-blue", "drag-red");
  el.classList.add(`drag-${color || peerColor}`);
});

socket.on("piece-drag-end", ({ id }) => {
  const el = pieceEls[id];
  if (!el) return;
  el.classList.remove("drag-blue", "drag-red");
});

socket.on("piece-moved", ({ id, x, y }) => {
  const el = pieceEls[id];
  if (!el || el.classList.contains("locked")) return;
  positionScattered(el, x, y);
});

socket.on("piece-unlocked", ({ id }) => {
  const el = pieceEls[id];
  if (!el) return;
  el.classList.remove("locked");
});

socket.on("piece-locked", ({ id }) => {
  const el = pieceEls[id];
  if (!el) return;
  const N = puzzleMeta.gridSize;
  const boardRect = boardEl.getBoundingClientRect();
  const pieceSize = boardRect.width / N;
  const pad = pieceSize * 0.32;
  const [r, c] = id.split("-").map(Number);
  placeLocked(el, r, c, pieceSize, pad);
  checkWin();
});

function checkWin() {
  const total = puzzleMeta.gridSize * puzzleMeta.gridSize;
  const lockedCount = Object.values(pieceEls).filter((el) => el.classList.contains("locked")).length;
  if (lockedCount === total) {
    stopTimer();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    document.getElementById("win-time").textContent = `Süre: ${mm}:${ss}`;
    setTimeout(() => showScreen("screen-win"), 500);
  }
}

function startTimer() {
  // Use only this device's own clock. puzzleMeta.elapsedMs is a duration
  // (not an absolute timestamp), computed entirely on the server, so it's
  // immune to the client's system clock being wrong/off (a real issue on
  // some phones) -- that mismatch used to show a negative countdown.
  const elapsedMs = (puzzleMeta && puzzleMeta.elapsedMs) || 0;
  startTime = Date.now() - elapsedMs;
  clearInterval(timerInterval);
  function tick() {
    const elapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    document.getElementById("timer").textContent = `${mm}:${ss}`;
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}
function stopTimer() {
  clearInterval(timerInterval);
}

document.getElementById("btn-again").addEventListener("click", () => {
  choiceLocked = false;
  showScreen("screen-select");
});

// ---------- Emoji reactions ----------
const btnEmoji = document.getElementById("btn-emoji");
const emojiPicker = document.getElementById("emoji-picker");
const emojiRainLayer = document.getElementById("emoji-rain-layer");

btnEmoji.addEventListener("click", (e) => {
  e.stopPropagation();
  colorPicker.classList.remove("open");
  emojiPicker.classList.toggle("open");
});

document.addEventListener("click", (e) => {
  if (!emojiPicker.contains(e.target) && e.target !== btnEmoji) {
    emojiPicker.classList.remove("open");
  }
  if (!colorPicker.contains(e.target) && e.target !== btnDraw) {
    colorPicker.classList.remove("open");
  }
});

emojiPicker.querySelectorAll(".emoji-opt").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const emoji = btn.dataset.emoji;
    socket.emit("send-emoji", { emoji });
    emojiPicker.classList.remove("open");
  });
});

socket.on("emoji-rain", ({ emoji }) => {
  spawnEmojiRain(emoji);
});

function spawnEmojiRain(emoji) {
  const count = 24;
  const layerWidth = window.innerWidth;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    el.className = "emoji-drop";
    el.textContent = emoji;
    const startX = Math.random() * layerWidth;
    const drift = (Math.random() - 0.5) * 160;
    const spin = (Math.random() - 0.5) * 360;
    const duration = 1.6 + Math.random() * 1.4;
    const delay = Math.random() * 0.5;
    const size = 24 + Math.random() * 22;
    el.style.left = `${startX}px`;
    el.style.fontSize = `${size}px`;
    el.style.setProperty("--drift", `${drift}px`);
    el.style.setProperty("--spin", `${spin}deg`);
    el.style.animationDuration = `${duration}s`;
    el.style.animationDelay = `${delay}s`;
    emojiRainLayer.appendChild(el);
    setTimeout(() => el.remove(), (duration + delay) * 1000 + 100);
  }
}

// ---------- Pen / drawing ----------
const btnDraw = document.getElementById("btn-draw");
const colorPicker = document.getElementById("color-picker");
const drawLayer = document.getElementById("draw-layer");
const SVG_NS = "http://www.w3.org/2000/svg";
const ERASE_DELAY_MS = 4000; // strokes stay ~3-5s before fading out
const ERASE_ANIM_MS = 1100; // must match .draw-stroke transition duration
const LONG_PRESS_MS = 450;

let drawColor = "#ff3b3b";
let drawModeOn = false;
let activeLocalStroke = null; // { id, el, points }
const remoteStrokes = {}; // strokeId -> { el }

// Tap = toggle drawing on/off. Long-press = open the color palette.
let longPressTimer = null;
let longPressFired = false;

btnDraw.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  longPressFired = false;
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    longPressFired = true;
    emojiPicker.classList.remove("open");
    colorPicker.classList.add("open");
    if (navigator.vibrate) navigator.vibrate(15);
  }, LONG_PRESS_MS);
});

["pointerup", "pointerleave", "pointercancel"].forEach((evt) => {
  btnDraw.addEventListener(evt, () => clearTimeout(longPressTimer));
});

btnDraw.addEventListener("click", (e) => {
  e.stopPropagation();
  if (longPressFired) {
    // Long-press already opened the color picker; a color choice (or the
    // exit swatch) will decide the draw state, so the tap itself does nothing.
    longPressFired = false;
    return;
  }
  emojiPicker.classList.remove("open");
  setDrawMode(!drawModeOn);
});

colorPicker.querySelectorAll(".color-opt:not(.exit-opt)").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    drawColor = btn.dataset.color;
    colorPicker.querySelectorAll(".color-opt").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    setDrawMode(true);
    colorPicker.classList.remove("open");
  });
});

document.getElementById("btn-draw-exit").addEventListener("click", (e) => {
  e.stopPropagation();
  setDrawMode(false);
  colorPicker.classList.remove("open");
});

function setDrawMode(on) {
  drawModeOn = on;
  drawLayer.classList.toggle("draw-active", on);
  btnDraw.classList.toggle("active-tool", on);
}

function scheduleStrokeErase(el) {
  setTimeout(() => {
    if (!el.isConnected) return;
    el.classList.add("fading");
    setTimeout(() => el.remove(), ERASE_ANIM_MS + 50);
  }, ERASE_DELAY_MS);
}

function makeStrokeEl(color) {
  const el = document.createElementNS(SVG_NS, "path");
  el.setAttribute("class", "draw-stroke");
  el.setAttribute("stroke", color);
  el.setAttribute("stroke-width", "5");
  el.setAttribute("d", "");
  drawLayer.appendChild(el);
  return el;
}

function pointerFrac(e) {
  return { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
}

drawLayer.addEventListener("pointerdown", (e) => {
  if (!drawModeOn) return;
  e.preventDefault();
  const id = `${socket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const el = makeStrokeEl(drawColor);
  el.setAttribute("d", `M ${e.clientX} ${e.clientY}`);
  activeLocalStroke = { id, el };
  drawLayer.setPointerCapture(e.pointerId);
  const frac = pointerFrac(e);
  socket.emit("draw-start", { strokeId: id, color: drawColor, x: frac.x, y: frac.y });
});

drawLayer.addEventListener("pointermove", (e) => {
  if (!activeLocalStroke) return;
  e.preventDefault();
  const d = activeLocalStroke.el.getAttribute("d");
  activeLocalStroke.el.setAttribute("d", `${d} L ${e.clientX} ${e.clientY}`);
  const frac = pointerFrac(e);
  socket.emit("draw-move", { strokeId: activeLocalStroke.id, x: frac.x, y: frac.y });
});

function endLocalStroke(e) {
  if (!activeLocalStroke) return;
  scheduleStrokeErase(activeLocalStroke.el);
  socket.emit("draw-end", { strokeId: activeLocalStroke.id });
  activeLocalStroke = null;
}
drawLayer.addEventListener("pointerup", endLocalStroke);
drawLayer.addEventListener("pointercancel", endLocalStroke);

socket.on("draw-start", ({ strokeId, color, x, y }) => {
  const el = makeStrokeEl(color);
  const px = x * window.innerWidth;
  const py = y * window.innerHeight;
  el.setAttribute("d", `M ${px} ${py}`);
  remoteStrokes[strokeId] = { el };
});

socket.on("draw-move", ({ strokeId, x, y }) => {
  const stroke = remoteStrokes[strokeId];
  if (!stroke) return;
  const px = x * window.innerWidth;
  const py = y * window.innerHeight;
  const d = stroke.el.getAttribute("d");
  stroke.el.setAttribute("d", `${d} L ${px} ${py}`);
});

socket.on("draw-end", ({ strokeId }) => {
  const stroke = remoteStrokes[strokeId];
  if (!stroke) return;
  scheduleStrokeErase(stroke.el);
  delete remoteStrokes[strokeId];
});
