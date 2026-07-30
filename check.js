
/* =====================================================================
   BÖLÜM 1: Genel durum ve yardımcılar
   ===================================================================== */
const state = {
  myName: '',
  isHost: false,
  roomCode: '',
  peer: null,
  conn: null,       // data connection
  call: null,       // media connection
  localStream: null,
  puzzle: null,     // {imageUrl, size}
  pieces: {},       // id -> {row,col,locked}
};

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}
function randomCode(len=4){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s='';
  for(let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

/* =====================================================================
   BÖLÜM 2: Bağlantı (PeerJS) — oda kurma / katılma
   ===================================================================== */
const PEER_PREFIX = 'birlikte-puzzle-'; // çakışmayı azaltmak için basit bir namespace

document.getElementById('create-room-btn').onclick = () => {
  state.myName = document.getElementById('name-input').value.trim() || 'Sen';
  const code = randomCode();
  state.roomCode = code;
  state.isHost = true;
  document.getElementById('room-code-display').textContent = code;
  showScreen('waiting-screen');

  state.peer = new Peer(PEER_PREFIX + code);
  state.peer.on('open', () => {});
  state.peer.on('error', (err) => {
    console.error(err);
    if(err.type === 'unavailable-id'){
      toast('Bu kod alınmış, tekrar deniyorum…');
      document.getElementById('create-room-btn').onclick();
    }
  });
  // Karşı taraf veri bağlantısı kurunca
  state.peer.on('connection', (conn) => {
    state.conn = conn;
    setupDataConnection();
  });
  // Karşı taraf görüntülü arama başlatınca (biz cevaplarız)
  state.peer.on('call', (call) => {
    ensureLocalStream().then(stream => {
      call.answer(stream);
      state.call = call;
      call.on('stream', remoteStream => addRemoteVideo(remoteStream));
    });
  });
};

document.getElementById('join-room-btn').onclick = () => {
  state.myName = document.getElementById('name-input').value.trim() || 'Sen';
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if(!code){ document.getElementById('connect-error').textContent = 'Lütfen bir oda kodu gir.'; return; }
  state.roomCode = code;
  state.isHost = false;

  state.peer = new Peer();
  state.peer.on('open', async () => {
    const hostId = PEER_PREFIX + code;
    state.conn = state.peer.connect(hostId);
    setupDataConnection();

    const stream = await ensureLocalStream();
    state.call = state.peer.call(hostId, stream);
    state.call.on('stream', remoteStream => addRemoteVideo(remoteStream));
  });
  state.peer.on('error', (err) => {
    console.error(err);
    document.getElementById('connect-error').textContent = 'Bağlanılamadı, kodu kontrol et.';
  });
};

document.getElementById('cancel-room-btn').onclick = () => {
  if(state.peer) state.peer.destroy();
  showScreen('connect-screen');
};

function setupDataConnection(){
  state.conn.on('open', () => {
    toast('Bağlandı!');
    showScreen('select-screen');
    renderPuzzleGrid();
  });
  state.conn.on('data', handleRemoteMessage);
  state.conn.on('close', () => toast('Bağlantı kesildi.'));
}

function sendData(msg){
  if(state.conn && state.conn.open) state.conn.send(msg);
}

async function ensureLocalStream(){
  if(state.localStream) return state.localStream;
  try{
    state.localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    addLocalVideo(state.localStream);
  }catch(e){
    console.warn('Kamera/mikrofon alınamadı:', e);
    toast('Kamera izni verilmedi, sesli/görüntülü olmadan devam ediliyor.');
  }
  return state.localStream;
}

/* =====================================================================
   BÖLÜM 3: Kamera balonları (sürüklenebilir, her kullanıcı kendi
   ekranında konumlandırır — konum diğer tarafa senkron edilmez)
   ===================================================================== */
function addLocalVideo(stream){
  addVideoBubble('me', stream, state.myName || 'Sen', {left:'8px', top:'8px'}, true);
}
function addRemoteVideo(stream){
  addVideoBubble('peer', stream, 'Eşleşme', {left:'8px', top:'104px'}, true);
}
function addVideoBubble(id, stream, label, pos, mine){
  if(document.getElementById('cam-'+id)) return;
  const wrap = document.createElement('div');
  wrap.className = 'cam-bubble';
  wrap.id = 'cam-'+id;
  wrap.style.left = pos.left; wrap.style.top = pos.top;
  wrap.innerHTML = `<video autoplay playsinline ${mine?'muted':''}></video><div class="cam-label">${label}</div>`;
  document.getElementById('cams').appendChild(wrap);
  const v = wrap.querySelector('video');
  v.srcObject = stream;
  if(id==='me') v.style.transform='scaleX(-1)'; else v.style.transform='none';
  makeCamDraggable(wrap);
}
function makeCamDraggable(el){
  let dragging=false, sx=0, sy=0, ol=0, ot=0;
  const wrapRect = () => document.getElementById('playfield-wrap').getBoundingClientRect();
  el.addEventListener('pointerdown', e=>{
    dragging=true; el.setPointerCapture(e.pointerId);
    sx=e.clientX; sy=e.clientY;
    ol=el.offsetLeft; ot=el.offsetTop;
  });
  el.addEventListener('pointermove', e=>{
    if(!dragging) return;
    const r = wrapRect();
    let nl = ol + (e.clientX - sx);
    let nt = ot + (e.clientY - sy);
    nl = Math.max(0, Math.min(r.width-88, nl));
    nt = Math.max(0, Math.min(r.height-88, nt));
    el.style.left = nl+'px'; el.style.top = nt+'px';
  });
  el.addEventListener('pointerup', ()=> dragging=false);
}

/* =====================================================================
   BÖLÜM 4: Puzzle seçim ekranı
   ===================================================================== */
const PRESET_IMAGES = [
  'https://picsum.photos/id/1015/600/600',
  'https://picsum.photos/id/1039/600/600',
  'https://picsum.photos/id/1043/600/600',
  'https://picsum.photos/id/1069/600/600',
];
let selectedImage = PRESET_IMAGES[0];
let selectedSize = 3;

function renderPuzzleGrid(){
  const grid = document.getElementById('puzzle-grid');
  grid.innerHTML = '';
  PRESET_IMAGES.forEach(url=>{
    const d = document.createElement('div');
    d.className = 'puzzle-thumb' + (url===selectedImage?' selected':'');
    d.style.backgroundImage = `url(${url})`;
    d.onclick = () => { selectedImage = url; renderPuzzleGrid(); };
    grid.appendChild(d);
  });
  document.querySelectorAll('#difficulty-row button').forEach(b=>{
    b.classList.toggle('active', parseInt(b.dataset.size)===selectedSize);
  });
}
document.querySelectorAll('#difficulty-row button').forEach(b=>{
  b.onclick = () => { selectedSize = parseInt(b.dataset.size); renderPuzzleGrid(); };
});
document.getElementById('start-puzzle-btn').onclick = () => {
  startPuzzle(selectedImage, selectedSize);
  sendData({type:'start', imageUrl:selectedImage, size:selectedSize});
};
document.getElementById('change-puzzle-btn').onclick = () => {
  showScreen('select-screen');
};
document.getElementById('play-again-btn').onclick = () => {
  document.getElementById('win-overlay').classList.add('hidden');
  showScreen('select-screen');
};

/* =====================================================================
   BÖLÜM 5: Puzzle tahtası — parçaları oluşturma, sürükleme, kilitleme
   ===================================================================== */
const BOARD_PCT = 70; // board genişliği/yüksekliği, playfield'in yüzdesi
const BOARD_OFFSET = 15; // board sol/üst offseti, playfield'in yüzdesi
const SNAP_THRESHOLD = 4; // yüzde cinsinden yakalama mesafesi

function startPuzzle(imageUrl, size){
  state.puzzle = { imageUrl, size };
  state.pieces = {};
  showScreen('game-screen');
  buildBoard(imageUrl, size);
}

function buildBoard(imageUrl, size){
  const board = document.getElementById('board');
  board.innerHTML = '';
  document.getElementById('win-overlay').classList.add('hidden');

  const cellPct = BOARD_PCT / size; // her hücrenin playfield yüzdesi cinsinden genişliği

  // Görsel referans için hafif slot çizgileri
  for(let r=0;r<size;r++){
    for(let c=0;c<size;c++){
      const slot = document.createElement('div');
      slot.className='slot';
      slot.style.left = (c*cellPct)+'%';
      slot.style.top = (r*cellPct)+'%';
      slot.style.width = cellPct+'%';
      slot.style.height = cellPct+'%';
      board.appendChild(slot);
    }
  }

  // Parçaları oluştur ve rastgele dağıt
  const wrap = document.getElementById('playfield-wrap');
  // önce eski parçaları temizle
  wrap.querySelectorAll('.piece').forEach(p=>p.remove());

  for(let r=0;r<size;r++){
    for(let c=0;c<size;c++){
      const id = r+'-'+c;
      const piece = document.createElement('div');
      piece.className='piece';
      piece.dataset.id = id;
      piece.style.width = cellPct+'%';
      piece.style.height = cellPct+'%';
      piece.style.backgroundImage = `url(${imageUrl})`;
      piece.style.backgroundSize = `${size*100}% ${size*100}%`;
      piece.style.backgroundPosition = `${size>1 ? c*100/(size-1) : 0}% ${size>1 ? r*100/(size-1) : 0}%`;

      // rastgele başlangıç konumu (playfield içinde, board dışında olması şart değil)
      const randLeft = Math.random()*(100-cellPct);
      const randTop = Math.random()*(100-cellPct);
      piece.style.left = randLeft+'%';
      piece.style.top = randTop+'%';

      state.pieces[id] = {
        row:r, col:c, locked:false,
        correctLeft: BOARD_OFFSET + c*cellPct,
        correctTop: BOARD_OFFSET + r*cellPct,
      };

      makePieceDraggable(piece);
      wrap.appendChild(piece);
    }
  }
}

function makePieceDraggable(piece){
  let dragging=false, sx=0, sy=0, ol=0, ot=0;
  const wrap = document.getElementById('playfield-wrap');

  piece.addEventListener('pointerdown', e=>{
    const id = piece.dataset.id;
    if(state.pieces[id].locked) return;
    dragging = true;
    piece.setPointerCapture(e.pointerId);
    piece.style.zIndex = 30;
    sx = e.clientX; sy = e.clientY;
    ol = parseFloat(piece.style.left); ot = parseFloat(piece.style.top);
  });

  piece.addEventListener('pointermove', e=>{
    if(!dragging) return;
    const rect = wrap.getBoundingClientRect();
    const dxPct = (e.clientX - sx) / rect.width * 100;
    const dyPct = (e.clientY - sy) / rect.height * 100;
    const nl = ol + dxPct, nt = ot + dyPct;
    piece.style.left = nl+'%';
    piece.style.top = nt+'%';
    throttledBroadcastMove(piece.dataset.id, nl, nt, false);
  });

  piece.addEventListener('pointerup', e=>{
    if(!dragging) return;
    dragging = false;
    piece.style.zIndex = 5;
    const id = piece.dataset.id;
    const info = state.pieces[id];
    const curLeft = parseFloat(piece.style.left);
    const curTop = parseFloat(piece.style.top);
    const dist = Math.hypot(curLeft-info.correctLeft, curTop-info.correctTop);
    if(dist < SNAP_THRESHOLD){
      piece.style.left = info.correctLeft+'%';
      piece.style.top = info.correctTop+'%';
      piece.classList.add('locked');
      info.locked = true;
      sendData({type:'lock', id, left:info.correctLeft, top:info.correctTop});
      checkWin();
    } else {
      sendData({type:'move', id, left:curLeft, top:curTop, final:true});
    }
  });
}

let lastMoveSent = 0;
function throttledBroadcastMove(id, left, top){
  const now = Date.now();
  if(now - lastMoveSent < 60) return;
  lastMoveSent = now;
  sendData({type:'move', id, left, top, final:false});
}

function checkWin(){
  const ids = Object.keys(state.pieces);
  if(ids.every(id=>state.pieces[id].locked)){
    setTimeout(()=>document.getElementById('win-overlay').classList.remove('hidden'), 300);
  }
}

/* =====================================================================
   BÖLÜM 6: Karşı taraftan gelen mesajları işleme
   ===================================================================== */
function handleRemoteMessage(msg){
  if(msg.type === 'start'){
    startPuzzle(msg.imageUrl, msg.size);
  } else if(msg.type === 'move'){
    const piece = document.querySelector(`.piece[data-id="${msg.id}"]`);
    if(!piece) return;
    const info = state.pieces[msg.id];
    if(info.locked) return;
    piece.style.left = msg.left+'%';
    piece.style.top = msg.top+'%';
  } else if(msg.type === 'lock'){
    const piece = document.querySelector(`.piece[data-id="${msg.id}"]`);
    if(!piece) return;
    const info = state.pieces[msg.id];
    piece.style.left = msg.left+'%';
    piece.style.top = msg.top+'%';
    piece.classList.add('locked');
    info.locked = true;
    checkWin();
  }
}
