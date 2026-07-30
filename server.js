const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Optional HTTPS (needed for camera access from a phone over local wifi,
// since mobile browsers block getUserMedia on plain http except localhost).
// Generate cert.pem + key.pem (see README) and drop them in the project root.
let httpsServer = null;
let ioHttps = null;
const certPath = path.join(__dirname, "cert.pem");
const keyPath = path.join(__dirname, "key.pem");
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  httpsServer = https.createServer(
    { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
    app
  );
  ioHttps = new Server(httpsServer);
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "16mb" }));

const crypto = require("crypto");
const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.post("/upload-image", (req, res) => {
  try {
    const { imageData } = req.body || {};
    if (!imageData || typeof imageData !== "string") {
      return res.status(400).json({ ok: false, error: "Geçersiz veri." });
    }
    const match = imageData.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ ok: false, error: "Desteklenmeyen dosya türü." });
    }
    const ext = match[1] === "jpeg" ? "jpg" : match[1];
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: "Dosya çok büyük (max 8MB)." });
    }
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    res.json({ ok: true, url: `/uploads/${filename}` });
  } catch (e) {
    console.error("upload-image error:", e);
    res.status(500).json({ ok: false, error: "Yükleme başarısız." });
  }
});

// rooms: { code: { users: [socketId,...], colors: {socketId: "blue"|"red"}, puzzle: {...} } }
const rooms = {};

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms[code]);
  return code;
}

// Clients shouldn't compare their own clock against the server's absolute
// startTime timestamp -- phones are frequently minutes off, which turned
// into a negative/garbage countdown on the timer. Instead we compute how
// much time has passed using only the server's own clock, and send that
// duration; the client then applies it to ITS OWN clock.
function withElapsed(puzzle) {
  if (!puzzle) return null;
  return { ...puzzle, elapsedMs: Date.now() - puzzle.startTime };
}

function registerHandlers(socket) {
  socket.on("create-room", (cb) => {
    const code = genCode();
    rooms[code] = { users: [socket.id], colors: { [socket.id]: "blue" }, puzzle: null };
    socket.join(code);
    socket.data.room = code;
    socket.data.color = "blue";
    cb({ ok: true, code, color: "blue" });
  });

  socket.on("join-room", (code, cb) => {
    code = (code || "").toUpperCase();
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: "Oda bulunamadı." });
    if (room.users.length >= 2) return cb({ ok: false, error: "Oda dolu." });
    // Take whichever color slot is free -- this matters when someone
    // reconnects mid-game: they should get their old color back, not
    // whatever the join flow used to hardcode.
    const takenColors = Object.values(room.colors || {});
    const color = takenColors.includes("blue") ? "red" : "blue";
    room.users.push(socket.id);
    room.colors = room.colors || {};
    room.colors[socket.id] = color;
    socket.join(code);
    socket.data.room = code;
    socket.data.color = color;
    // Send the current puzzle (if any) along with the join ack so a player
    // reconnecting mid-game lands straight back in the game screen instead
    // of racing with the separate "puzzle-state" broadcast below.
    cb({ ok: true, code, color, puzzle: withElapsed(room.puzzle) });
    // notify existing user that a peer joined, they will initiate WebRTC offer
    socket.to(code).emit("peer-joined", { socketId: socket.id, color });
  });

  // WebRTC signaling relay (try both instances since the two peers might be
  // on http vs https depending on how each of them connected)
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
    if (ioHttps) ioHttps.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("select-puzzle", ({ imageKey, gridSize, customImageUrl }) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room) return;
    const cols = gridSize, rows = gridSize;
    const pieces = {};
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = `${r}-${c}`;
        pieces[id] = {
          x: Math.random() * 0.8 + 0.05, // normalized scattered position
          y: Math.random() * 0.8 + 0.05,
          locked: false,
        };
      }
    }
    // Jigsaw tab/blank shapes for each internal edge, generated once on the
    // server so both players see the exact same piece silhouettes.
    // edgesH[r][c] = shape of the vertical edge between piece(r,c) and piece(r,c+1)
    // edgesV[r][c] = shape of the horizontal edge between piece(r,c) and piece(r+1,c)
    const edgesH = Array.from({ length: rows }, () =>
      Array.from({ length: cols - 1 }, () => (Math.random() < 0.5 ? 1 : -1))
    );
    const edgesV = Array.from({ length: rows - 1 }, () =>
      Array.from({ length: cols }, () => (Math.random() < 0.5 ? 1 : -1))
    );
    room.puzzle = {
      imageKey,
      gridSize,
      pieces,
      edgesH,
      edgesV,
      customImageUrl: typeof customImageUrl === "string" ? customImageUrl : null,
      startTime: Date.now(), // shared reference point so a reconnecting player's timer isn't reset
    };
    io.to(code).emit("puzzle-state", withElapsed(room.puzzle));
    if (ioHttps) ioHttps.to(code).emit("puzzle-state", withElapsed(room.puzzle));
  });

  socket.on("move-piece", ({ id, x, y }) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || !room.puzzle || !room.puzzle.pieces[id]) return;
    if (room.puzzle.pieces[id].locked) return;
    room.puzzle.pieces[id].x = x;
    room.puzzle.pieces[id].y = y;
    socket.to(code).emit("piece-moved", { id, x, y });
  });

  socket.on("lock-piece", ({ id }) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || !room.puzzle || !room.puzzle.pieces[id]) return;
    room.puzzle.pieces[id].locked = true;
    room.puzzle.pieces[id].x = 0;
    room.puzzle.pieces[id].y = 0;
    io.to(code).emit("piece-locked", { id });
    if (ioHttps) ioHttps.to(code).emit("piece-locked", { id });
  });

  // A previously-locked piece was picked back up -- unlock it so it can be
  // dragged around again, and let the other player know.
  socket.on("unlock-piece", ({ id }) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room || !room.puzzle || !room.puzzle.pieces[id]) return;
    room.puzzle.pieces[id].locked = false;
    io.to(code).emit("piece-unlocked", { id });
    if (ioHttps) ioHttps.to(code).emit("piece-unlocked", { id });
  });

  // Someone grabbed a piece -> tell the other player so they can highlight it
  // in this player's color.
  socket.on("piece-drag-start", ({ id }) => {
    const code = socket.data.room;
    if (!code) return;
    socket.to(code).emit("piece-drag-start", { id, color: socket.data.color });
  });

  socket.on("piece-drag-end", ({ id }) => {
    const code = socket.data.room;
    if (!code) return;
    socket.to(code).emit("piece-drag-end", { id });
  });

  // Emoji reaction: broadcast to everyone in the room (including sender)
  // so both players see the same rain effect at the same time.
  const ALLOWED_EMOJIS = ["😂", "😤", "😭", "🥰", "😁", "🤙", "👍", "🖕", "💋", "🤬"];
  socket.on("send-emoji", ({ emoji }) => {
    const code = socket.data.room;
    if (!code) return;
    if (!ALLOWED_EMOJIS.includes(emoji)) return;
    io.to(code).emit("emoji-rain", { emoji });
    if (ioHttps) ioHttps.to(code).emit("emoji-rain", { emoji });
  });

  // Pen tool: relay freehand drawing strokes to the other player.
  // Coordinates are sent as 0..1 fractions of the sender's own viewport so
  // each peer maps them onto their own screen size.
  socket.on("draw-start", ({ strokeId, color, x, y }) => {
    const code = socket.data.room;
    if (!code) return;
    socket.to(code).emit("draw-start", { strokeId, color, x, y });
  });

  socket.on("draw-move", ({ strokeId, x, y }) => {
    const code = socket.data.room;
    if (!code) return;
    socket.to(code).emit("draw-move", { strokeId, x, y });
  });

  socket.on("draw-end", ({ strokeId }) => {
    const code = socket.data.room;
    if (!code) return;
    socket.to(code).emit("draw-end", { strokeId });
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    if (code && rooms[code]) {
      rooms[code].users = rooms[code].users.filter((id) => id !== socket.id);
      if (rooms[code].colors) delete rooms[code].colors[socket.id];
      socket.to(code).emit("peer-left");
      // Keep the room (and its puzzle state) alive as long as at least one
      // player is still around, so the one who dropped can rejoin with the
      // same room code and pick up exactly where they left off.
      if (rooms[code].users.length === 0) delete rooms[code];
    }
  });
}

io.on("connection", registerHandlers);
if (ioHttps) ioHttps.on("connection", registerHandlers);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HTTP:  http://localhost:${PORT}`));
if (httpsServer) {
  const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
  httpsServer.listen(HTTPS_PORT, () =>
    console.log(`HTTPS: https://localhost:${HTTPS_PORT}  (use this from your phone)`)
  );
}
