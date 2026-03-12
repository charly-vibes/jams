// ═══════════════════════════════════════════════════════
//  Marginalia — Book Notes PWA
//  Vanilla JS • IndexedDB • Tesseract.js OCR
// ═══════════════════════════════════════════════════════

const DB_NAME = 'marginalia';
const DB_VERSION = 1;

// ─── State ───
const state = {
  db: null,
  books: [],
  currentBookId: null,
  captures: [],        // { id, blob, url, ocrText, ocrStatus }
  captureMode: 'batch', // 'batch' | 'single'
  ocrWorker: null,
  ocrReady: false,
  ocrLang: localStorage.getItem('marginalia-ocr-lang') || 'eng',
  activeView: 'books',
  activeFilter: 'all',
  searchQuery: '',
};

// ═══════════════════════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════════════════════

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('books')) {
        const bookStore = db.createObjectStore('books', { keyPath: 'id' });
        bookStore.createIndex('title', 'title', { unique: false });
      }
      if (!db.objectStoreNames.contains('notes')) {
        const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
        noteStore.createIndex('bookId', 'bookId', { unique: false });
        noteStore.createIndex('highlight', 'highlight', { unique: false });
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbTx(storeName, mode = 'readonly') {
  const tx = state.db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = dbTx(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(storeName, data) {
  return new Promise((resolve, reject) => {
    const req = dbTx(storeName, 'readwrite').put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = dbTx(storeName, 'readwrite').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbGetByIndex(storeName, indexName, value) {
  return new Promise((resolve, reject) => {
    const store = dbTx(storeName);
    const idx = store.index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ═══════════════════════════════════════════════════════
//  OCR
// ═══════════════════════════════════════════════════════

const OCR_LANGUAGES = [
  { code: 'eng', name: 'English' },
  { code: 'fra', name: 'French' },
  { code: 'deu', name: 'German' },
  { code: 'spa', name: 'Spanish' },
  { code: 'ita', name: 'Italian' },
  { code: 'por', name: 'Portuguese' },
  { code: 'rus', name: 'Russian' },
  { code: 'pol', name: 'Polish' },
  { code: 'nld', name: 'Dutch' },
  { code: 'jpn', name: 'Japanese' },
  { code: 'chi_sim', name: 'Chinese (Simplified)' },
  { code: 'chi_tra', name: 'Chinese (Traditional)' },
  { code: 'kor', name: 'Korean' },
  { code: 'ara', name: 'Arabic' },
  { code: 'hin', name: 'Hindi' },
  { code: 'tur', name: 'Turkish' },
  { code: 'ukr', name: 'Ukrainian' },
];

async function initOCR(lang) {
  const targetLang = lang || state.ocrLang;
  if (state.ocrReady && state._ocrLoadedLang === targetLang) return;
  if (state.ocrWorker) {
    await state.ocrWorker.terminate();
    state.ocrWorker = null;
    state.ocrReady = false;
  }
  try {
    state.ocrWorker = await Tesseract.createWorker(targetLang, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          updateOCRProgress(m.progress);
        }
      },
    });
    state.ocrReady = true;
    state._ocrLoadedLang = targetLang;
  } catch (err) {
    console.error('OCR init failed:', err);
    showToast('OCR engine failed to load');
  }
}

function setOCRLang(lang) {
  state.ocrLang = lang;
  localStorage.setItem('marginalia-ocr-lang', lang);
  // Worker will reinit on next OCR run if language changed
  if (state._ocrLoadedLang && state._ocrLoadedLang !== lang) {
    state.ocrReady = false;
  }
}

function updateOCRProgress(progress, label) {
  const bar = document.querySelector('.ocr-progress-fill');
  if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
  if (label) {
    const span = document.querySelector('#ocr-status span');
    if (span) span.textContent = label;
  }
}

// ─── Multi-pass OCR ───

const OCR_PASSES = [
  { name: 'raw',      psm: '3',  prep: 'upscale' },
  { name: 'contrast', psm: '3',  prep: 'contrast' },
  { name: 'binarize', psm: '6',  prep: 'binarize' },
  { name: 'block',    psm: '6',  prep: 'upscale' },
  { name: 'sharp',    psm: '6',  prep: 'sharpen' },
];

const CONFIDENCE_THRESHOLD = 65;

function scoreResult(result) {
  const words = result.data.words || [];
  if (words.length === 0) return 0;
  const totalConf = words.reduce((sum, w) => sum + w.confidence, 0);
  return totalConf / words.length;
}

async function runOCR(imageBlob, onPassResult) {
  if (!state.ocrReady) await initOCR();

  state._ocrCancelled = false;
  state._ocrAcceptedText = null;
  const img = await loadImage(imageBlob);
  let bestText = '';
  let bestScore = -1;

  for (let i = 0; i < OCR_PASSES.length; i++) {
    if (state._ocrCancelled) break;

    const pass = OCR_PASSES[i];
    const passLabel = `Pass ${i + 1}/${OCR_PASSES.length}: ${pass.name}`;
    updateOCRProgress(0, passLabel);

    const preprocessed = await preprocessImage(imageBlob, pass.prep, img);
    const result = await state.ocrWorker.recognize(preprocessed, {
      tessedit_pageseg_mode: pass.psm,
    });

    const score = scoreResult(result);
    const text = result.data.text.trim();

    if (score > bestScore && text.length > 0) {
      bestScore = score;
      bestText = text;
    }

    if (onPassResult) {
      onPassResult({ index: i, total: OCR_PASSES.length, name: pass.name, text, score });
    }

    if (state._ocrCancelled) break;
    if (bestScore >= CONFIDENCE_THRESHOLD) break;
  }

  updateOCRProgress(1, 'Done');
  return state._ocrAcceptedText || bestText;
}

function showPassResult({ index, total, name, text, score }) {
  let container = $('#ocr-passes');
  if (!container) return;
  container.style.display = 'block';

  const scoreClass = score >= 80 ? 'good' : score >= 50 ? 'ok' : 'poor';
  const preview = text ? esc(text) : '<em>No text detected</em>';

  const passEl = document.createElement('div');
  passEl.className = 'ocr-pass-result';
  passEl.innerHTML = `
    <div class="pass-header">
      <span class="pass-label">${name}</span>
      <span class="pass-score ${scoreClass}">${Math.round(score)}%</span>
      ${text ? '<button class="btn btn-sm btn-amber pass-use">Use this</button>' : ''}
    </div>
    <div class="pass-text">${preview}</div>
  `;

  if (text) {
    passEl.querySelector('.pass-use').onclick = () => {
      state._ocrAcceptedText = text;
      state._ocrCancelled = true;
    };
  }

  container.appendChild(passEl);
}

function clearPassResults() {
  const container = $('#ocr-passes');
  if (container) {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}

// ─── Image Preprocessing Variants ───

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function preprocessImage(blob, mode, cachedImg) {
  const img = cachedImg || await loadImage(blob);
  const shorter = Math.min(img.naturalWidth, img.naturalHeight);
  const scale = shorter < 750 ? 3 : shorter < 1500 ? 2 : 1;
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;

  if (mode === 'upscale' && scale === 1) return blob;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  if (mode === 'upscale') return canvasToBlob(canvas);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const len = w * h;

  // Grayscale
  const gray = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const j = i * 4;
    gray[i] = Math.round(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]);
  }

  if (mode === 'contrast') {
    // Auto-levels: remap 2nd/98th percentile to 0-255
    const hist = new Uint32Array(256);
    for (let i = 0; i < len; i++) hist[gray[i]]++;
    const loTarget = len * 0.02, hiTarget = len * 0.98;
    let lo = 0, hi = 255, cumul = 0;
    for (let v = 0; v < 256; v++) {
      cumul += hist[v];
      if (cumul >= loTarget) { lo = v; break; }
    }
    cumul = 0;
    for (let v = 0; v < 256; v++) {
      cumul += hist[v];
      if (cumul >= hiTarget) { hi = v; break; }
    }
    const range = hi - lo || 1;
    for (let i = 0; i < len; i++) {
      const v = Math.max(0, Math.min(255, Math.round((gray[i] - lo) * 255 / range)));
      const j = i * 4;
      d[j] = d[j + 1] = d[j + 2] = v;
    }
  } else if (mode === 'binarize') {
    // Otsu's threshold — converts to pure black/white
    const hist = new Uint32Array(256);
    for (let i = 0; i < len; i++) hist[gray[i]]++;
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * hist[i];
    let sumBg = 0, wBg = 0;
    let bestVariance = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wBg += hist[t];
      if (wBg === 0) continue;
      const wFg = len - wBg;
      if (wFg === 0) break;
      sumBg += t * hist[t];
      const diff = sumBg / wBg - (sumAll - sumBg) / wFg;
      const variance = wBg * wFg * diff * diff;
      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = t;
      }
    }
    for (let i = 0; i < len; i++) {
      const v = gray[i] > threshold ? 255 : 0;
      const j = i * 4;
      d[j] = d[j + 1] = d[j + 2] = v;
    }
  } else if (mode === 'sharpen') {
    // Unsharp mask: 3x3 box blur, strength 1.0
    const blurred = new Uint8Array(len);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
              sum += gray[ny * w + nx]; cnt++;
            }
          }
        }
        blurred[y * w + x] = Math.round(sum / cnt);
      }
    }
    for (let i = 0; i < len; i++) {
      const v = Math.max(0, Math.min(255, gray[i] + (gray[i] - blurred[i])));
      const j = i * 4;
      d[j] = d[j + 1] = d[j + 2] = v;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
}

// ─── Crop UI ───

function openCropModal(blob) {
  return new Promise((resolve) => {
    const imgUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const overlay = openModal(`
        <button class="modal-close" id="crop-close">×</button>
        <h2>Crop Text Region</h2>
        <p class="crop-hint">Drag to select the text area, or skip to use the full image.</p>
        <div class="crop-container" id="crop-container">
          <canvas id="crop-canvas"></canvas>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn btn-secondary" id="crop-skip" style="flex:1">Skip Crop</button>
          <button class="btn btn-primary" id="crop-apply" style="flex:1">Crop & Process</button>
        </div>
      `);

      const canvas = overlay.querySelector('#crop-canvas');
      const container = overlay.querySelector('#crop-container');
      const ctx = canvas.getContext('2d');

      // Size canvas to fit container width, maintaining aspect ratio
      const maxW = container.clientWidth || 400;
      const ratio = img.naturalHeight / img.naturalWidth;
      const dispW = Math.min(maxW, img.naturalWidth);
      const dispH = Math.round(dispW * ratio);
      canvas.width = dispW;
      canvas.height = dispH;
      canvas.style.width = dispW + 'px';
      canvas.style.height = dispH + 'px';

      ctx.drawImage(img, 0, 0, dispW, dispH);

      let dragging = false;
      let startX = 0, startY = 0, curX = 0, curY = 0;
      let hasCrop = false;

      function drawOverlay() {
        ctx.clearRect(0, 0, dispW, dispH);
        ctx.drawImage(img, 0, 0, dispW, dispH);
        if (!hasCrop) return;

        const rx = Math.min(startX, curX);
        const ry = Math.min(startY, curY);
        const rw = Math.abs(curX - startX);
        const rh = Math.abs(curY - startY);

        // Semi-transparent overlay outside crop
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, dispW, ry);
        ctx.fillRect(0, ry, rx, rh);
        ctx.fillRect(rx + rw, ry, dispW - rx - rw, rh);
        ctx.fillRect(0, ry + rh, dispW, dispH - ry - rh);

        // Border on crop rect
        ctx.strokeStyle = '#c4956a';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);
      }

      function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
        const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
        return {
          x: Math.max(0, Math.min(dispW, clientX - rect.left)),
          y: Math.max(0, Math.min(dispH, clientY - rect.top))
        };
      }

      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = true;
        hasCrop = true;
        const pos = getPos(e);
        startX = curX = pos.x;
        startY = curY = pos.y;
        canvas.setPointerCapture(e.pointerId);
      });

      canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        e.preventDefault();
        const pos = getPos(e);
        curX = pos.x;
        curY = pos.y;
        drawOverlay();
      });

      canvas.addEventListener('pointerup', (e) => {
        dragging = false;
        drawOverlay();
      });

      function finish(cropped) {
        URL.revokeObjectURL(imgUrl);
        closeModal();
        resolve(cropped);
      }

      overlay.querySelector('#crop-close').onclick = () => finish(blob);
      overlay.querySelector('#crop-skip').onclick = () => finish(blob);

      overlay.querySelector('#crop-apply').onclick = () => {
        const rw = Math.abs(curX - startX);
        const rh = Math.abs(curY - startY);
        // Zero-area = skip
        if (!hasCrop || rw < 5 || rh < 5) {
          finish(blob);
          return;
        }

        const rx = Math.min(startX, curX);
        const ry = Math.min(startY, curY);

        // Scale from display coords back to natural image coords
        const scaleX = img.naturalWidth / dispW;
        const scaleY = img.naturalHeight / dispH;
        const sx = Math.round(rx * scaleX);
        const sy = Math.round(ry * scaleY);
        const sw = Math.round(rw * scaleX);
        const sh = Math.round(rh * scaleY);

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = sw;
        cropCanvas.height = sh;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        cropCanvas.toBlob((croppedBlob) => finish(croppedBlob), 'image/png');
      };
    };
    img.onerror = () => { URL.revokeObjectURL(imgUrl); resolve(blob); };
    img.src = imgUrl;
  });
}

// ═══════════════════════════════════════════════════════
//  SPEECH-TO-TEXT
// ═══════════════════════════════════════════════════════

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSupported = !!SpeechRecognition;
let _activeRecognition = null;

function startDictation(textarea, btn) {
  if (!speechSupported) {
    showToast('Speech recognition not supported in this browser');
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = state.ocrLang === 'eng' ? 'en-US'
    : state.ocrLang === 'fra' ? 'fr-FR'
    : state.ocrLang === 'deu' ? 'de-DE'
    : state.ocrLang === 'spa' ? 'es-ES'
    : state.ocrLang === 'ita' ? 'it-IT'
    : state.ocrLang === 'por' ? 'pt-BR'
    : state.ocrLang === 'rus' ? 'ru-RU'
    : state.ocrLang === 'pol' ? 'pl-PL'
    : state.ocrLang === 'nld' ? 'nl-NL'
    : state.ocrLang === 'jpn' ? 'ja-JP'
    : state.ocrLang === 'kor' ? 'ko-KR'
    : state.ocrLang === 'ara' ? 'ar-SA'
    : state.ocrLang === 'hin' ? 'hi-IN'
    : state.ocrLang === 'tur' ? 'tr-TR'
    : state.ocrLang === 'ukr' ? 'uk-UA'
    : state.ocrLang.startsWith('chi') ? 'zh-CN'
    : 'en-US';

  recognition.continuous = true;
  recognition.interimResults = true;

  let finalTranscript = textarea.value;

  btn.classList.add('recording');
  btn.textContent = '⏹ Stop';
  _activeRecognition = recognition;

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        finalTranscript += (finalTranscript ? ' ' : '') + e.results[i][0].transcript;
      } else {
        interim += e.results[i][0].transcript;
      }
    }
    textarea.value = finalTranscript + (interim ? ' ' + interim : '');
  };

  recognition.onerror = (e) => {
    if (e.error !== 'aborted') showToast('Speech error: ' + e.error);
    btn.classList.remove('recording');
    btn.textContent = '🎤 Dictate';
    _activeRecognition = null;
  };

  recognition.onend = () => {
    btn.classList.remove('recording');
    btn.textContent = '🎤 Dictate';
    _activeRecognition = null;
  };

  recognition.start();
  return recognition;
}

function setupDictateButton(container) {
  const btn = container.querySelector('.dictate-btn');
  const textarea = container.querySelector('#note-text');
  if (!btn || !textarea) return;
  if (!speechSupported) { btn.style.display = 'none'; return; }

  let activeRecognition = null;
  btn.onclick = () => {
    if (activeRecognition) {
      activeRecognition.stop();
      activeRecognition = null;
    } else {
      activeRecognition = startDictation(textarea, btn);
    }
  };
}

function openDictateNoteModal() {
  const overlay = openModal(`
    <button class="modal-close" id="modal-close">×</button>
    <h2>Dictate Note</h2>

    <div class="highlight-picker">
      <button class="hl-note active" data-hl="note">Note</button>
      <button class="hl-important" data-hl="important">Key</button>
      <button class="hl-question" data-hl="question">?</button>
      <button class="hl-idea" data-hl="idea">Idea</button>
      <button class="hl-quote" data-hl="quote">Quote</button>
    </div>

    <div class="form-group">
      <label>Text</label>
      <textarea id="note-text" placeholder="Tap Dictate or type your note..."></textarea>
      <button class="btn btn-sm btn-secondary dictate-btn" style="margin-top:6px;">🎤 Dictate</button>
    </div>
    <div class="form-group">
      <label>Page Number</label>
      <input type="number" id="note-page" placeholder="Optional" />
    </div>
    <div class="form-group">
      <label>Tags (press Enter to add)</label>
      <div class="tags-input-wrap" id="tags-wrap">
        <input type="text" id="tag-input" placeholder="Add tag..." />
      </div>
    </div>
    <button class="btn btn-primary btn-full" id="save-note">Save Note</button>
  `);

  let selectedHighlight = 'note';
  let tags = [];

  overlay.querySelector('#modal-close').onclick = closeModal;

  overlay.querySelectorAll('.highlight-picker button').forEach(btn => {
    btn.onclick = () => {
      overlay.querySelectorAll('.highlight-picker button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedHighlight = btn.dataset.hl;
    };
  });

  setupTagsInput(overlay, tags);
  setupDictateButton(overlay);

  const saveBtn = overlay.querySelector('#save-note');
  saveBtn.onclick = async () => {
    const text = overlay.querySelector('#note-text').value.trim();
    if (!text) { showToast('Please enter some text'); return; }
    saveBtn.disabled = true;

    try {
      const pageVal = overlay.querySelector('#note-page').value;
      const note = {
        id: uid(),
        bookId: state.currentBookId,
        text,
        highlight: selectedHighlight,
        pageNum: pageVal ? parseInt(pageVal, 10) : null,
        tags,
        photoId: null,
        createdAt: Date.now(),
      };
      await dbPut('notes', note);

      const book = state.books.find(b => b.id === state.currentBookId);
      if (book) {
        book.updatedAt = Date.now();
        await dbPut('books', book);
      }

      closeModal();
      showToast('Note saved!');
      openBookDetail(state.currentBookId);
    } catch (err) {
      saveBtn.disabled = false;
      showToast('Failed to save note');
    }
  };
}

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

// ═══════════════════════════════════════════════════════
//  RENDERING
// ═══════════════════════════════════════════════════════

function switchView(view) {
  state.activeView = view;
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`.view[data-view="${view}"]`).classList.add('active');
  $$('nav.tabs button').forEach(b => b.classList.remove('active'));
  $(`nav.tabs button[data-tab="${view}"]`)?.classList.add('active');

  // Show/hide FAB
  const fab = $('.fab');
  if (fab) {
    fab.style.display = (view === 'books' || view === 'book-detail') ? 'flex' : 'none';
    fab.onclick = view === 'book-detail' ? () => openCaptureForBook() : () => openNewBookModal();
  }
}

async function renderBooks() {
  state.books = await dbGetAll('books');
  state.books.sort((a, b) => b.updatedAt - a.updatedAt);

  const container = $('#books-list');
  if (state.books.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>No books yet. Tap + to add a book and start capturing your marginalia.</p>
      </div>`;
    return;
  }

  // Count notes per book
  const allNotes = await dbGetAll('notes');
  const countMap = {};
  allNotes.forEach(n => {
    countMap[n.bookId] = (countMap[n.bookId] || 0) + 1;
  });

  container.innerHTML = state.books.map(b => `
    <div class="book-card" data-id="${b.id}">
      <button class="delete-book" data-id="${b.id}" title="Delete book">×</button>
      <h3>${esc(b.title)}</h3>
      <div class="book-author">${esc(b.author || 'Unknown author')}</div>
      <div class="book-meta">
        <span class="note-count">${countMap[b.id] || 0} notes</span>
        <span>${formatDate(b.updatedAt)}</span>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-book')) return;
      openBookDetail(card.dataset.id);
    });
  });

  container.querySelectorAll('.delete-book').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this book and all its notes?')) {
        await deleteBook(btn.dataset.id);
      }
    });
  });
}

async function deleteBook(bookId) {
  await dbDelete('books', bookId);
  const notes = await dbGetByIndex('notes', 'bookId', bookId);
  for (const n of notes) {
    if (n.photoId) await dbDelete('photos', n.photoId);
    await dbDelete('notes', n.id);
  }
  showToast('Book deleted');
  renderBooks();
}

async function openBookDetail(bookId) {
  state.currentBookId = bookId;
  state.activeFilter = 'all';
  state.searchQuery = '';
  const book = state.books.find(b => b.id === bookId);
  if (!book) return;

  const notes = await dbGetByIndex('notes', 'bookId', bookId);
  notes.sort((a, b) => (a.pageNum || 0) - (b.pageNum || 0));

  const detailView = $('.view[data-view="book-detail"]');
  detailView.innerHTML = `
    <div class="book-detail-header">
      <button class="back-btn" id="back-to-books">←</button>
      <h2>${esc(book.title)}</h2>
      <button class="btn btn-sm btn-secondary" id="export-book-btn">Export .md</button>
    </div>

    <div class="search-bar">
      <span class="search-icon">🔍</span>
      <input type="text" placeholder="Search notes..." id="note-search" />
    </div>

    <div class="filter-chips">
      <button class="filter-chip active" data-filter="all">All</button>
      <button class="filter-chip" data-filter="note">Notes</button>
      <button class="filter-chip" data-filter="important">Important</button>
      <button class="filter-chip" data-filter="question">Questions</button>
      <button class="filter-chip" data-filter="idea">Ideas</button>
      <button class="filter-chip" data-filter="quote">Quotes</button>
    </div>

    <div id="notes-list">${renderNotes(notes)}</div>
  `;

  $('#back-to-books').onclick = () => {
    switchView('books');
    renderBooks();
  };

  $('#export-book-btn').onclick = () => exportBook(book, notes);

  $('#note-search').oninput = (e) => {
    state.searchQuery = e.target.value.toLowerCase();
    filterAndRenderNotes(notes);
  };

  detailView.querySelectorAll('.filter-chip').forEach(chip => {
    chip.onclick = () => {
      detailView.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeFilter = chip.dataset.filter;
      filterAndRenderNotes(notes);
    };
  });

  bindNoteActions(notes);
  switchView('book-detail');
}

function filterAndRenderNotes(notes) {
  let filtered = notes;
  if (state.activeFilter !== 'all') {
    filtered = filtered.filter(n => n.highlight === state.activeFilter);
  }
  if (state.searchQuery) {
    filtered = filtered.filter(n =>
      (n.text || '').toLowerCase().includes(state.searchQuery) ||
      (n.tags || []).some(t => t.toLowerCase().includes(state.searchQuery))
    );
  }
  $('#notes-list').innerHTML = renderNotes(filtered);
  bindNoteActions(filtered);
}

function renderNotes(notes) {
  if (notes.length === 0) {
    return `<div class="empty-state">
      <div class="empty-icon">📝</div>
      <p>No notes yet. Capture some pages to get started.</p>
    </div>`;
  }

  return notes.map(n => `
    <div class="note-card highlight-${n.highlight || 'note'}" data-id="${n.id}">
      <div class="note-text">${esc(n.text || '(no text extracted)')}</div>
      ${n.pageNum ? `<div class="note-page">p. ${n.pageNum}</div>` : ''}
      ${(n.tags && n.tags.length) ? `
        <div class="note-tags">
          ${n.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
        </div>` : ''}
      <div class="note-actions">
        <button data-action="edit" data-id="${n.id}">Edit</button>
        <button data-action="delete" data-id="${n.id}">Delete</button>
      </div>
    </div>
  `).join('');
}

function bindNoteActions(notes) {
  $$('.note-actions button').forEach(btn => {
    btn.onclick = async () => {
      const noteId = btn.dataset.id;
      const note = notes.find(n => n.id === noteId);
      if (!note) return;

      if (btn.dataset.action === 'delete') {
        if (confirm('Delete this note?')) {
          if (note.photoId) await dbDelete('photos', note.photoId);
          await dbDelete('notes', noteId);
          showToast('Note deleted');
          openBookDetail(state.currentBookId);
        }
      } else if (btn.dataset.action === 'edit') {
        openEditNoteModal(note);
      }
    };
  });
}

// ═══════════════════════════════════════════════════════
//  CAPTURE
// ═══════════════════════════════════════════════════════

function revokeCaptures() {
  for (const c of state.captures) {
    if (c.url) URL.revokeObjectURL(c.url);
  }
}

function openCaptureForBook() {
  revokeCaptures();
  state.captures = [];
  renderCaptureView();
  switchView('capture');
}

function renderCaptureView() {
  const view = $('.view[data-view="capture"]');
  const currentBook = state.books.find(b => b.id === state.currentBookId);
  view.innerHTML = `
    <div class="capture-header">
      <button class="back-btn" id="capture-back">←</button>
      <div style="flex:1">
        <h2>Capture Pages</h2>
        ${currentBook ? `<div style="font-size:0.8rem;color:var(--ink-muted);margin-top:2px;">${esc(currentBook.title)}</div>` : ''}
      </div>
      <div class="mode-toggle">
        <button class="${state.captureMode === 'batch' ? 'active' : ''}" data-mode="batch">Batch</button>
        <button class="${state.captureMode === 'single' ? 'active' : ''}" data-mode="single">Single</button>
      </div>
    </div>

    <div class="capture-zones">
      <div class="camera-zone" id="camera-zone">
        <div class="camera-icon">📷</div>
        <p>Tap to capture or select photos</p>
        <input type="file" id="photo-input" accept="image/*" capture="environment" ${state.captureMode === 'batch' ? 'multiple' : ''} />
      </div>
      ${speechSupported ? `
      <div class="camera-zone" id="dictate-zone">
        <div class="camera-icon">🎤</div>
        <p>Dictate a note</p>
      </div>` : ''}
    </div>

    <div class="captures-grid" id="captures-grid"></div>

    ${state.captures.length > 0 ? `
      <div class="ocr-loading" id="ocr-status" style="display:none">
        <div class="spinner"></div>
        <span>Running OCR...</span>
        <div class="progress-bar" style="flex:1"><div class="progress-fill ocr-progress-fill" style="width:0%"></div></div>
      </div>
      <div id="ocr-passes" style="display:none"></div>
      <button class="btn btn-primary btn-full" id="process-captures">
        Process ${state.captures.length} capture${state.captures.length > 1 ? 's' : ''} with OCR
      </button>
    ` : ''}
  `;

  // Back button
  $('#capture-back').onclick = () => {
    if (state.currentBookId) {
      openBookDetail(state.currentBookId);
    } else {
      switchView('books');
    }
  };

  // Mode toggle
  view.querySelectorAll('.mode-toggle button').forEach(btn => {
    btn.onclick = () => {
      state.captureMode = btn.dataset.mode;
      renderCaptureView();
    };
  });

  // Camera zone click
  $('#camera-zone').onclick = () => $('#photo-input').click();

  // Dictate zone click
  const dictateZone = $('#dictate-zone');
  if (dictateZone) dictateZone.onclick = () => {
    if (!state.currentBookId) {
      showToast('Open a book first');
      return;
    }
    openDictateNoteModal();
  };

  // File input
  $('#photo-input').onchange = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const capture = {
        id: uid(),
        blob: file,
        url,
        ocrText: '',
        ocrStatus: 'pending'
      };
      state.captures.push(capture);

      if (state.captureMode === 'single') {
        // In single mode, crop then process
        renderCaptureView();
        capture.blob = await openCropModal(capture.blob);
        await processSingleCapture(capture);
        return;
      }
    }
    renderCaptureView();
  };

  // Render thumbnails
  renderThumbnails();

  // Process button
  const processBtn = $('#process-captures');
  if (processBtn) {
    processBtn.onclick = () => processBatchCaptures();
  }
}

function renderThumbnails() {
  const grid = $('#captures-grid');
  if (!grid) return;
  grid.innerHTML = state.captures.map(c => `
    <div class="capture-thumb" data-id="${c.id}">
      <img src="${c.url}" alt="Capture" />
      <button class="remove-capture" data-id="${c.id}">×</button>
      ${c.ocrStatus !== 'pending' ? `
        <div class="ocr-status ${c.ocrStatus}">${
          c.ocrStatus === 'processing' ? '...' :
          c.ocrStatus === 'done' ? '✓' : '✗'
        }</div>` : ''}
    </div>
  `).join('');

  // Tap thumbnail to crop (batch mode, before processing)
  grid.querySelectorAll('.capture-thumb').forEach(thumb => {
    thumb.addEventListener('click', async (e) => {
      if (e.target.classList.contains('remove-capture')) return;
      const capture = state.captures.find(c => c.id === thumb.dataset.id);
      if (capture && capture.ocrStatus === 'pending') {
        capture.blob = await openCropModal(capture.blob);
        showToast('Cropped');
      }
    });
  });

  grid.querySelectorAll('.remove-capture').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const removed = state.captures.find(c => c.id === btn.dataset.id);
      if (removed && removed.url) URL.revokeObjectURL(removed.url);
      state.captures = state.captures.filter(c => c.id !== btn.dataset.id);
      renderCaptureView();
    };
  });
}

async function processSingleCapture(capture) {
  const status = $('#ocr-status');
  if (status) status.style.display = 'flex';
  clearPassResults();
  capture.ocrStatus = 'processing';
  renderThumbnails();

  try {
    const text = await runOCR(capture.blob, showPassResult);
    capture.ocrText = text;
    capture.ocrStatus = 'done';
    renderThumbnails();
    if (status) status.style.display = 'none';
    clearPassResults();
    openNewNoteModal(capture);
  } catch (err) {
    capture.ocrStatus = 'error';
    renderThumbnails();
    if (status) status.style.display = 'none';
    clearPassResults();
    showToast('OCR failed for this image');
  }
}

async function processBatchCaptures() {
  const pending = state.captures.filter(c => c.ocrStatus === 'pending');
  if (pending.length === 0) {
    openBatchReviewModal();
    return;
  }

  const status = $('#ocr-status');
  if (status) status.style.display = 'flex';

  for (let ci = 0; ci < pending.length; ci++) {
    const capture = pending[ci];
    clearPassResults();
    capture.ocrStatus = 'processing';
    renderThumbnails();

    const batchLabel = `Image ${ci + 1}/${pending.length}`;
    const statusSpan = document.querySelector('#ocr-status span');
    if (statusSpan) statusSpan.textContent = batchLabel;

    try {
      const text = await runOCR(capture.blob, showPassResult);
      capture.ocrText = text;
      capture.ocrStatus = 'done';
    } catch (err) {
      capture.ocrStatus = 'error';
    }
    renderThumbnails();
  }

  if (status) status.style.display = 'none';
  clearPassResults();
  renderCaptureView();
  openBatchReviewModal();
}

// ═══════════════════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════════════════

function openModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  return overlay;
}

function closeModal() {
  if (_activeRecognition) {
    _activeRecognition.stop();
    _activeRecognition = null;
  }
  const m = document.querySelector('.modal-overlay');
  if (m) m.remove();
}

// ─── New Book Modal ───
function openNewBookModal() {
  const overlay = openModal(`
    <button class="modal-close" id="modal-close">×</button>
    <h2>New Book</h2>
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="book-title" placeholder="e.g. Thinking, Fast and Slow" autofocus />
    </div>
    <div class="form-group">
      <label>Author</label>
      <input type="text" id="book-author" placeholder="e.g. Daniel Kahneman" />
    </div>
    <button class="btn btn-primary btn-full" id="save-book">Add Book</button>
  `);

  overlay.querySelector('#modal-close').onclick = closeModal;
  const saveBookBtn = overlay.querySelector('#save-book');
  saveBookBtn.onclick = async () => {
    const title = overlay.querySelector('#book-title').value.trim();
    if (!title) { showToast('Please enter a title'); return; }
    saveBookBtn.disabled = true;
    const book = {
      id: uid(),
      title,
      author: overlay.querySelector('#book-author').value.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await dbPut('books', book);
    closeModal();
    showToast('Book added!');
    renderBooks();
  };
}

// ─── New Note Modal (after single capture OCR) ───
function openNewNoteModal(capture) {
  const overlay = openModal(`
    <button class="modal-close" id="modal-close">×</button>
    <h2>New Note</h2>

    <div class="highlight-picker">
      <button class="hl-note active" data-hl="note">Note</button>
      <button class="hl-important" data-hl="important">Key</button>
      <button class="hl-question" data-hl="question">?</button>
      <button class="hl-idea" data-hl="idea">Idea</button>
      <button class="hl-quote" data-hl="quote">Quote</button>
    </div>

    <div class="form-group">
      <label>Extracted Text</label>
      <textarea id="note-text">${esc(capture.ocrText)}</textarea>
      <button class="btn btn-sm btn-secondary dictate-btn" style="margin-top:6px;">🎤 Dictate</button>
    </div>
    <div class="form-group">
      <label>Page Number</label>
      <input type="number" id="note-page" placeholder="Optional" />
    </div>
    <div class="form-group">
      <label>Tags (press Enter to add)</label>
      <div class="tags-input-wrap" id="tags-wrap">
        <input type="text" id="tag-input" placeholder="Add tag..." />
      </div>
    </div>
    <button class="btn btn-primary btn-full" id="save-note">Save Note</button>
  `);

  let selectedHighlight = 'note';
  let tags = [];

  overlay.querySelector('#modal-close').onclick = closeModal;

  // Highlight picker
  overlay.querySelectorAll('.highlight-picker button').forEach(btn => {
    btn.onclick = () => {
      overlay.querySelectorAll('.highlight-picker button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedHighlight = btn.dataset.hl;
    };
  });

  // Tags
  setupTagsInput(overlay, tags);
  setupDictateButton(overlay);

  // Save
  const saveBtn = overlay.querySelector('#save-note');
  saveBtn.onclick = async () => {
    const text = overlay.querySelector('#note-text').value.trim();
    if (!text) { showToast('Please enter some text'); return; }

    saveBtn.disabled = true;

    try {
      // Save photo
      const photoId = uid();
      const dataUrl = await blobToDataURL(capture.blob);
      await dbPut('photos', { id: photoId, data: dataUrl });

      const pageVal = overlay.querySelector('#note-page').value;
      const note = {
        id: uid(),
        bookId: state.currentBookId,
        text,
        highlight: selectedHighlight,
        pageNum: pageVal ? parseInt(pageVal, 10) : null,
        tags,
        photoId,
        createdAt: Date.now(),
      };
      await dbPut('notes', note);

      // Update book timestamp
      const book = state.books.find(b => b.id === state.currentBookId);
      if (book) {
        book.updatedAt = Date.now();
        await dbPut('books', book);
      }

      closeModal();
      showToast('Note saved!');
      openBookDetail(state.currentBookId);
    } catch (err) {
      saveBtn.disabled = false;
      showToast('Failed to save note');
      console.error('Save note error:', err);
    }
  };
}

// ─── Batch Review Modal ───
function openBatchReviewModal() {
  const done = state.captures.filter(c => c.ocrStatus === 'done');
  if (done.length === 0) {
    showToast('No captures to review');
    return;
  }

  let currentIdx = 0;
  let notesData = done.map(c => ({
    capture: c,
    text: c.ocrText,
    highlight: 'note',
    pageNum: '',
    tags: [],
  }));

  function renderReview() {
    const nd = notesData[currentIdx];
    const overlay = openModal(`
      <button class="modal-close" id="modal-close">×</button>
      <h2>Review ${currentIdx + 1} of ${done.length}</h2>

      <div style="margin-bottom:12px;">
        <img src="${nd.capture.url}" style="width:100%;max-height:180px;object-fit:contain;border-radius:var(--radius);background:#eee;" />
      </div>

      <div class="highlight-picker">
        <button class="hl-note ${nd.highlight === 'note' ? 'active' : ''}" data-hl="note">Note</button>
        <button class="hl-important ${nd.highlight === 'important' ? 'active' : ''}" data-hl="important">Key</button>
        <button class="hl-question ${nd.highlight === 'question' ? 'active' : ''}" data-hl="question">?</button>
        <button class="hl-idea ${nd.highlight === 'idea' ? 'active' : ''}" data-hl="idea">Idea</button>
        <button class="hl-quote ${nd.highlight === 'quote' ? 'active' : ''}" data-hl="quote">Quote</button>
      </div>

      <div class="form-group">
        <label>Extracted Text</label>
        <textarea id="note-text">${esc(nd.text)}</textarea>
      </div>
      <div class="form-group">
        <label>Page Number</label>
        <input type="number" id="note-page" value="${nd.pageNum}" placeholder="Optional" />
      </div>
      <div class="form-group">
        <label>Tags (press Enter to add)</label>
        <div class="tags-input-wrap" id="tags-wrap">
          ${nd.tags.map(t => `<span class="tag">${esc(t)} <span class="remove-tag" data-tag="${esc(t)}">×</span></span>`).join('')}
          <input type="text" id="tag-input" placeholder="Add tag..." />
        </div>
      </div>

      <div style="display:flex;gap:8px;">
        ${currentIdx > 0 ? '<button class="btn btn-secondary" id="review-prev" style="flex:1">← Prev</button>' : ''}
        <button class="btn btn-secondary" id="review-skip" style="flex:1">Skip</button>
        ${currentIdx < done.length - 1
          ? '<button class="btn btn-amber" id="review-next" style="flex:1">Next →</button>'
          : '<button class="btn btn-primary" id="review-save-all" style="flex:1">Save All</button>'
        }
      </div>
    `);

    overlay.querySelector('#modal-close').onclick = closeModal;

    // Highlight
    overlay.querySelectorAll('.highlight-picker button').forEach(btn => {
      btn.onclick = () => {
        overlay.querySelectorAll('.highlight-picker button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        nd.highlight = btn.dataset.hl;
      };
    });

    // Tags
    setupTagsInput(overlay, nd.tags);

    // Save current state on navigate
    function saveCurrentState() {
      nd.text = overlay.querySelector('#note-text').value;
      nd.pageNum = overlay.querySelector('#note-page').value;
    }

    const prevBtn = overlay.querySelector('#review-prev');
    if (prevBtn) prevBtn.onclick = () => { saveCurrentState(); currentIdx--; closeModal(); renderReview(); };

    const skipBtn = overlay.querySelector('#review-skip');
    skipBtn.onclick = () => {
      notesData[currentIdx].skip = true;
      if (currentIdx < done.length - 1) { currentIdx++; closeModal(); renderReview(); }
      else { closeModal(); saveAllBatchNotes(notesData); }
    };

    const nextBtn = overlay.querySelector('#review-next');
    if (nextBtn) nextBtn.onclick = () => { saveCurrentState(); currentIdx++; closeModal(); renderReview(); };

    const saveAllBtn = overlay.querySelector('#review-save-all');
    if (saveAllBtn) saveAllBtn.onclick = () => { saveCurrentState(); closeModal(); saveAllBatchNotes(notesData); };
  }

  renderReview();
}

async function saveAllBatchNotes(notesData) {
  let saved = 0;
  for (const nd of notesData) {
    if (nd.skip) continue;
    const text = nd.text.trim();
    if (!text) continue;

    // Save photo
    const photoId = uid();
    const dataUrl = await blobToDataURL(nd.capture.blob);
    await dbPut('photos', { id: photoId, data: dataUrl });

    const note = {
      id: uid(),
      bookId: state.currentBookId,
      text,
      highlight: nd.highlight,
      pageNum: nd.pageNum ? parseInt(nd.pageNum, 10) : null,
      tags: nd.tags,
      photoId,
      createdAt: Date.now(),
    };
    await dbPut('notes', note);
    saved++;
  }

  // Update book timestamp
  const book = state.books.find(b => b.id === state.currentBookId);
  if (book) {
    book.updatedAt = Date.now();
    await dbPut('books', book);
  }

  revokeCaptures();
  state.captures = [];
  showToast(`${saved} note${saved !== 1 ? 's' : ''} saved!`);
  openBookDetail(state.currentBookId);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ─── Edit Note Modal ───
function openEditNoteModal(note) {
  const tags = [...(note.tags || [])];
  const overlay = openModal(`
    <button class="modal-close" id="modal-close">×</button>
    <h2>Edit Note</h2>

    <div class="highlight-picker">
      <button class="hl-note ${note.highlight === 'note' ? 'active' : ''}" data-hl="note">Note</button>
      <button class="hl-important ${note.highlight === 'important' ? 'active' : ''}" data-hl="important">Key</button>
      <button class="hl-question ${note.highlight === 'question' ? 'active' : ''}" data-hl="question">?</button>
      <button class="hl-idea ${note.highlight === 'idea' ? 'active' : ''}" data-hl="idea">Idea</button>
      <button class="hl-quote ${note.highlight === 'quote' ? 'active' : ''}" data-hl="quote">Quote</button>
    </div>

    <div class="form-group">
      <label>Text</label>
      <textarea id="note-text">${esc(note.text)}</textarea>
      <button class="btn btn-sm btn-secondary dictate-btn" style="margin-top:6px;">🎤 Dictate</button>
    </div>
    <div class="form-group">
      <label>Page Number</label>
      <input type="number" id="note-page" value="${note.pageNum || ''}" />
    </div>
    <div class="form-group">
      <label>Tags (press Enter to add)</label>
      <div class="tags-input-wrap" id="tags-wrap">
        ${tags.map(t => `<span class="tag">${esc(t)} <span class="remove-tag" data-tag="${esc(t)}">×</span></span>`).join('')}
        <input type="text" id="tag-input" placeholder="Add tag..." />
      </div>
    </div>
    <button class="btn btn-primary btn-full" id="save-note">Update Note</button>
  `);

  let selectedHighlight = note.highlight || 'note';

  overlay.querySelector('#modal-close').onclick = closeModal;

  overlay.querySelectorAll('.highlight-picker button').forEach(btn => {
    btn.onclick = () => {
      overlay.querySelectorAll('.highlight-picker button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedHighlight = btn.dataset.hl;
    };
  });

  setupTagsInput(overlay, tags);
  setupDictateButton(overlay);

  const updateBtn = overlay.querySelector('#save-note');
  updateBtn.onclick = async () => {
    const text = overlay.querySelector('#note-text').value.trim();
    if (!text) { showToast('Please enter some text'); return; }
    updateBtn.disabled = true;
    const pageVal = overlay.querySelector('#note-page').value;
    note.text = text;
    note.highlight = selectedHighlight;
    note.pageNum = pageVal ? parseInt(pageVal, 10) : null;
    note.tags = tags;
    await dbPut('notes', note);
    closeModal();
    showToast('Note updated');
    openBookDetail(state.currentBookId);
  };
}

// ─── Tags Input Helper ───
function setupTagsInput(container, tags) {
  const wrap = container.querySelector('#tags-wrap');
  const input = container.querySelector('#tag-input');

  // Remove existing tag handlers
  wrap.querySelectorAll('.remove-tag').forEach(rt => {
    rt.onclick = () => {
      const tag = rt.dataset.tag;
      const idx = tags.indexOf(tag);
      if (idx > -1) tags.splice(idx, 1);
      rt.parentElement.remove();
    };
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input.value.trim();
      if (val && !tags.includes(val)) {
        tags.push(val);
        const span = document.createElement('span');
        span.className = 'tag';
        span.innerHTML = `${esc(val)} <span class="remove-tag" data-tag="${esc(val)}">×</span>`;
        span.querySelector('.remove-tag').onclick = () => {
          tags.splice(tags.indexOf(val), 1);
          span.remove();
        };
        wrap.insertBefore(span, input);
      }
      input.value = '';
    }
  });

  wrap.onclick = () => input.focus();
}

// ═══════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════

function exportBook(book, notes) {
  const highlightEmoji = {
    note: '📝',
    important: '🔴',
    question: '❓',
    idea: '💡',
    quote: '💬',
  };

  let md = `# ${book.title}\n`;
  if (book.author) md += `*${book.author}*\n`;
  md += `\nExported from Marginalia — ${formatDate(Date.now())}\n\n---\n\n`;

  // Group by highlight type
  const grouped = {};
  notes.forEach(n => {
    const hl = n.highlight || 'note';
    if (!grouped[hl]) grouped[hl] = [];
    grouped[hl].push(n);
  });

  const order = ['important', 'quote', 'idea', 'question', 'note'];
  for (const hl of order) {
    if (!grouped[hl]) continue;
    const emoji = highlightEmoji[hl] || '📝';
    md += `## ${emoji} ${hl.charAt(0).toUpperCase() + hl.slice(1)}s\n\n`;
    for (const n of grouped[hl]) {
      md += `- ${n.text}`;
      if (n.pageNum) md += ` *(p. ${n.pageNum})*`;
      if (n.tags && n.tags.length) md += `  \n  Tags: ${n.tags.map(t => `#${t}`).join(' ')}`;
      md += '\n\n';
    }
  }

  // Show preview and download
  const overlay = openModal(`
    <button class="modal-close" id="modal-close">×</button>
    <h2>Export to Markdown</h2>
    <p style="font-size:0.85rem;color:var(--ink-muted);margin-bottom:12px;">
      Ready for Obsidian. Copy or download below.
    </p>
    <div class="export-preview">${esc(md)}</div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" id="copy-md" style="flex:1">Copy to Clipboard</button>
      <button class="btn btn-primary" id="download-md" style="flex:1">Download .md</button>
    </div>
  `);

  overlay.querySelector('#modal-close').onclick = closeModal;

  overlay.querySelector('#copy-md').onclick = async () => {
    await navigator.clipboard.writeText(md);
    showToast('Copied to clipboard!');
  };

  overlay.querySelector('#download-md').onclick = () => {
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloading...');
  };
}

// ═══════════════════════════════════════════════════════
//  SETTINGS VIEW
// ═══════════════════════════════════════════════════════

function renderSettings() {
  const view = $('.view[data-view="settings"]');
  view.innerHTML = `
    <h2 style="font-family:var(--font-display);margin-bottom:20px;">Settings</h2>

    <div class="book-card" style="border-left-color:var(--sage);cursor:default;">
      <h3>OCR Engine</h3>
      <p style="font-size:0.85rem;color:var(--ink-muted);margin-top:4px;">
        Tesseract.js v5 — runs entirely offline in your browser.
        ${state.ocrReady ? '<span style="color:var(--sage);">● Ready</span>' : '<span style="color:var(--amber);">○ Will load on first use</span>'}
      </p>
      <div class="form-group" style="margin-top:10px;margin-bottom:8px;">
        <label>OCR Language</label>
        <select id="ocr-lang">
          ${OCR_LANGUAGES.map(l => `<option value="${l.code}" ${l.code === state.ocrLang ? 'selected' : ''}>${l.name}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-sm btn-secondary" id="preload-ocr">
        ${state.ocrReady ? 'OCR Loaded ✓' : 'Pre-load OCR Engine'}
      </button>
    </div>

    <div class="book-card" style="border-left-color:var(--danger);cursor:default;">
      <h3>Data Management</h3>
      <p style="font-size:0.85rem;color:var(--ink-muted);margin-top:4px;">
        All data is stored locally in your browser using IndexedDB.
      </p>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn btn-sm btn-secondary" id="export-all">Export All Data</button>
        <button class="btn btn-sm btn-secondary" id="import-data">Import Data</button>
        <input type="file" id="import-file" accept=".json" style="display:none" />
      </div>
    </div>

    <div class="book-card" style="border-left-color:var(--ink-muted);cursor:default;">
      <h3>About</h3>
      <p style="font-size:0.85rem;color:var(--ink-muted);margin-top:4px;">
        <strong>Marginalia</strong> — capture post-it notes from your books and transform them into structured, searchable knowledge.
      </p>
      <p style="font-size:0.8rem;color:var(--ink-muted);margin-top:6px;">
        PWA • Offline-first • Obsidian-compatible
      </p>
    </div>
  `;

  view.querySelector('#ocr-lang').onchange = (e) => {
    setOCRLang(e.target.value);
    const preload = view.querySelector('#preload-ocr');
    preload.textContent = 'Pre-load OCR Engine';
    preload.disabled = false;
  };

  const preloadBtn = view.querySelector('#preload-ocr');
  preloadBtn.onclick = async () => {
    preloadBtn.textContent = 'Loading...';
    preloadBtn.disabled = true;
    await initOCR();
    preloadBtn.textContent = 'OCR Loaded ✓';
  };

  view.querySelector('#export-all').onclick = async () => {
    const books = await dbGetAll('books');
    const notes = await dbGetAll('notes');
    const photos = await dbGetAll('photos');
    const data = JSON.stringify({ books, notes, photos, exportedAt: Date.now() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marginalia-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported!');
  };

  view.querySelector('#import-data').onclick = () => view.querySelector('#import-file').click();
  view.querySelector('#import-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.books) for (const b of data.books) await dbPut('books', b);
      if (data.notes) for (const n of data.notes) await dbPut('notes', n);
      if (data.photos) for (const p of data.photos) await dbPut('photos', p);
      showToast('Data imported!');
      renderBooks();
    } catch (err) {
      showToast('Invalid backup file');
    }
  };
}

// ═══════════════════════════════════════════════════════
//  HELP VIEW
// ═══════════════════════════════════════════════════════

function renderHelp() {
  const view = $('.view[data-view="help"]');
  view.innerHTML = `
    <h2 style="font-family:var(--font-display);margin-bottom:20px;">How to Use Marginalia</h2>

    <div class="help-section">
      <h3>1. Add a Book</h3>
      <p>Tap the <strong>+</strong> button on the Books tab to create a new book entry with its title and author.</p>
    </div>

    <div class="help-section">
      <h3>2. Capture Notes</h3>
      <p>Open a book, then tap <strong>+</strong> to enter capture mode. You have two options:</p>
      <ul>
        <li><strong>📷 Photo capture</strong> — take a photo of a book page or post-it note. The app will run OCR to extract the text.</li>
        ${speechSupported ? '<li><strong>🎤 Dictate</strong> — speak your note aloud and it will be transcribed using your browser\'s speech recognition.</li>' : ''}
      </ul>
    </div>

    <div class="help-section">
      <h3>3. Crop for Better OCR</h3>
      <p>In <strong>single mode</strong>, a crop modal appears after each photo. Drag a rectangle around just the text you want to read.</p>
      <p>In <strong>batch mode</strong>, tap any thumbnail to crop it before processing. Cropping is optional — uncropped images are processed as-is.</p>
    </div>

    <div class="help-section">
      <h3>4. Capture Modes</h3>
      <ul>
        <li><strong>Single</strong> — process one photo at a time. Crop → OCR → review immediately.</li>
        <li><strong>Batch</strong> — snap multiple photos, optionally crop each via thumbnails, then process all at once.</li>
      </ul>
    </div>

    <div class="help-section">
      <h3>5. Review &amp; Categorize</h3>
      <p>After OCR, review the extracted text and edit if needed. Classify each note:</p>
      <ul>
        <li><strong>Note</strong> — general note</li>
        <li><strong>Key</strong> — important passage</li>
        <li><strong>?</strong> — question or something to revisit</li>
        <li><strong>Idea</strong> — your own idea sparked by the text</li>
        <li><strong>Quote</strong> — exact quotation</li>
      </ul>
      <p>You can also add a page number and tags for organization.</p>
    </div>

    <div class="help-section">
      <h3>6. Search &amp; Filter</h3>
      <p>Inside a book, use the <strong>search bar</strong> to find notes by text or tag. Use the <strong>filter chips</strong> to show only a specific category.</p>
    </div>

    <div class="help-section">
      <h3>7. Export to Markdown</h3>
      <p>Tap <strong>Export .md</strong> in a book to generate Obsidian-compatible Markdown. Notes are grouped by category. You can copy to clipboard or download the file.</p>
    </div>

    <div class="help-section">
      <h3>8. Settings</h3>
      <ul>
        <li><strong>OCR Language</strong> — change the recognition language (${OCR_LANGUAGES.length} supported). The dictation language follows this setting.</li>
        <li><strong>Pre-load OCR</strong> — load the OCR engine ahead of time so capture is faster.</li>
        <li><strong>Import/Export</strong> — back up all your data as JSON, or restore from a backup.</li>
      </ul>
    </div>

    <div class="help-section">
      <h3>Tips for Better OCR</h3>
      <ul>
        <li>Use good lighting — avoid shadows across the text.</li>
        <li>Hold the camera steady and fill the frame with the text.</li>
        <li>Use the crop tool to select just the text area.</li>
        <li>The app runs multiple OCR passes (raw, contrast, binarize, block, sharp) and shows each result with a confidence score. Tap <strong>Use this</strong> on any pass to accept it immediately.</li>
        <li>You can always edit the extracted text before saving.</li>
      </ul>
    </div>

    <div class="help-section">
      <h3>Offline Use</h3>
      <p>Marginalia works offline. All data is stored locally in your browser. Install it as an app from your browser's menu for the best experience.</p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
//  ESCAPE HTML
// ═══════════════════════════════════════════════════════

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════

async function init() {
  try {
    state.db = await openDB();
  } catch (err) {
    console.error('IndexedDB failed:', err);
    document.querySelector('main').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Could not open database. This may happen in private browsing mode or if storage is restricted. Please try in a regular browser window.</p>
      </div>`;
    return;
  }

  // Render views
  await renderBooks();
  renderSettings();
  renderHelp();

  // Tab navigation
  $$('nav.tabs button').forEach(btn => {
    btn.onclick = () => {
      const tab = btn.dataset.tab;
      if (tab === 'capture') {
        if (state.currentBookId) {
          openCaptureForBook();
        } else {
          switchView('capture');
        }
        return;
      }
      if (tab === 'books') {
        state.currentBookId = null;
        renderBooks();
      }
      switchView(tab);
    };
  });

  // FAB
  const fab = $('.fab');
  fab.onclick = () => openNewBookModal();

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Warn about unsaved captures
  window.addEventListener('beforeunload', (e) => {
    if (state.captures.length > 0) {
      e.preventDefault();
    }
  });

  switchView('books');

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
