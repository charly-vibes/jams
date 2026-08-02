// transcribir — browser-based Whisper transcription using transformers.js

/* ─── State ─── */
const MODEL_MAP = {
  tiny:  'Xenova/whisper-tiny',
  base:  'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
};
const CHUNK_SECONDS = 30;     // Whisper's native window size

let transcriber = null;
let loadedModel = null;
let currentAudio = null;      // { data: Float32Array, duration: number, name: string }
let sourceFileName = null;
let sourceDuration = null;
let mediaRecorder = null;
let micChunks = [];
let micTimer = null;
let micSeconds = 0;
let isRecording = false;
let isTranscribing = false;

/* ─── DOM refs ─── */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const fileInput        = $('#file-input');
const uploadZone       = $('#upload-zone');
const fileInfo         = $('#file-info');
const recordBtn        = $('#record-btn');
const micTimerEl       = $('#mic-timer');
const micInfo          = $('#mic-info');
const inputTabs        = $$('.input-tab');
const paneFile         = $('#pane-file');
const paneMic          = $('#pane-mic');
const modelSelect      = $('#model-select');
const langSelect       = $('#lang-select');
const transcribeBtn    = $('#transcribe-btn');
const statusEl         = $('#status');
const outputSection    = $('#output-section');
const outputText       = $('#output-text');
const outputFormat     = $('#output-format');
const copyBtn          = $('#copy-btn');
const downloadBtn      = $('#download-btn');
const loadingOverlay   = $('#loading-overlay');
const loadingMsg       = $('#loading-msg');
const longAudioWarn    = $('#long-audio-warn');
const longAudioWarn    = $('#long-audio-warn');

/* ─── File input ─── */
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return clearFile();
  sourceFileName = file.name;
  await loadAudio(file);
});

async function loadAudio(input, name) {
  try {
    currentAudio = await decodeAudio(input);
    sourceFileName = name || sourceFileName;
    sourceDuration = currentAudio.duration;
    transcribeBtn.disabled = false;

    // Show file/duration info
    const dur = formatDuration(Math.round(sourceDuration));
    fileInfo.textContent = `📄 ${sourceFileName} — ${dur} (${formatSize(input.size || 0)})`;
    fileInfo.classList.remove('hidden');

    // Memory warning for long audio (>25 min PCM ≈ 100 MB Float32Array)
    const pcmMB = (sourceDuration * 16000 * 4) / (1024 * 1024);
    longAudioWarn.classList.toggle('hidden', pcmMB < 100);
    if (pcmMB >= 100) {
      const est = Math.round(sourceDuration / 60);
      longAudioWarn.innerHTML = `⚠️ Audio largo (~${est} min). La transcripción puede tomar varios minutos. ` +
        `Se procesará en fragmentos de ${CHUNK_SECONDS}s para ahorrar memoria.`;
    }
  } catch (err) {
    showStatus('Error al leer el archivo de audio', true);
    currentAudio = null;
    sourceFileName = null;
    transcribeBtn.disabled = true;
  }
}

function clearFile() {
  fileInfo.classList.add('hidden');
  longAudioWarn.classList.add('hidden');
  currentAudio = null;
  sourceFileName = null;
  sourceDuration = null;
  transcribeBtn.disabled = true;
}

/* ─── Mic recording ─── */
recordBtn.addEventListener('click', () => {
  if (isTranscribing) return; // prevent interaction during transcription
  if (isRecording) return stopRecording();
  startRecording();
});

async function startRecording() {
  if (isRecording) return;
  isRecording = true;
  recordBtn.disabled = true; // disable during getUserMedia negotiation

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showStatus('No se pudo acceder al micrófono', true);
    isRecording = false;
    recordBtn.disabled = false;
    return;
  }

  micChunks = [];
  micSeconds = 0;
  recordBtn.disabled = false;
  recordBtn.classList.add('recording');
  recordBtn.querySelector('.record-icon').textContent = '⏹';
  recordBtn.querySelector('.record-label').textContent = 'Detener';

  // MIME type support: prefer Opus in WebM, fallback through Ogg, then mp4
  const mimeType =
    MediaRecorder.isTypeSupported('audio/webm;codecs=opus')  ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')            ? 'audio/webm'
    : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/mp4')             ? 'audio/mp4'
    : '';

  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) micChunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    clearInterval(micTimer);
    micTimerEl.classList.add('hidden');
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordBtn.querySelector('.record-icon').textContent = '⏺';
    recordBtn.querySelector('.record-label').textContent = 'Grabar';

    const blob = new Blob(micChunks, { type: mimeType || 'audio/webm' });
    if (blob.size === 0) return;

    const name = `micrófono-${formatDuration(micSeconds)}`;
    await loadAudio(blob, name);
    micInfo.textContent = `🎤 Grabación: ${formatDuration(micSeconds)} (${formatSize(blob.size)})`;
    micInfo.classList.remove('hidden');
  };

  mediaRecorder.start(250);
  micTimerEl.classList.remove('hidden');
  micTimerEl.textContent = '00:00';
  micTimer = setInterval(() => {
    micSeconds++;
    micTimerEl.textContent = formatDuration(micSeconds);
  }, 1000);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

// Stop mic if tab becomes hidden during recording
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isRecording) stopRecording();
});

/* ─── Input mode tabs ─── */
inputTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    if (isTranscribing) return; // don't switch during transcription
    const mode = tab.dataset.mode;
    inputTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    paneFile.classList.toggle('active', mode === 'file');
    paneMic.classList.toggle('active', mode === 'mic');
    if (mode !== 'mic' && isRecording) stopRecording();
  });
});

/* ─── Audio decoding & resampling ─── */
async function decodeAudio(input) {
  const arrayBuffer = await input.arrayBuffer();
  const audioCtx = new AudioContext();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    // Mix all channels to mono by averaging them
    const numChannels = audioBuffer.numberOfChannels;
    const numSamples = audioBuffer.length;
    const mono = new Float32Array(numSamples);
    for (let ch = 0; ch < numChannels; ch++) {
      const channel = audioBuffer.getChannelData(ch);
      for (let i = 0; i < numSamples; i++) {
        mono[i] += channel[i] / numChannels;
      }
    }
    const origSampleRate = audioBuffer.sampleRate;

    // If already 16kHz, return as-is
    if (origSampleRate === 16000) {
      return { data: mono, duration: mono.length / 16000 };
    }

    // Resample to 16kHz via OfflineAudioContext
    const targetLen = Math.round(numSamples * 16000 / origSampleRate);
    const offlineCtx = new OfflineAudioContext(1, targetLen, 16000);
    const buf = offlineCtx.createBuffer(1, numSamples, origSampleRate);
    buf.getChannelData(0).set(mono);
    const source = offlineCtx.createBufferSource();
    source.buffer = buf;
    source.connect(offlineCtx.destination);
    source.start();
    const rendered = await offlineCtx.startRendering();
    return { data: rendered.getChannelData(0), duration: targetLen / 16000 };
  } finally {
    audioCtx.close();
  }
}

/* ─── Transcription (with chunking for long audio) ─── */
transcribeBtn.addEventListener('click', async () => {
  if (!currentAudio || isTranscribing) return;
  isTranscribing = true;
  transcribeBtn.disabled = true;
  outputSection.classList.add('hidden');

  const modelKey = modelSelect.value;
  const lang = langSelect.value;

  // Load model if needed
  if (transcriber === null || loadedModel !== modelKey) {
    try {
      await loadModel(modelKey);
    } catch {
      isTranscribing = false;
      transcribeBtn.disabled = !currentAudio;
      return;
    }
  }

  await runTranscription(lang);

  isTranscribing = false;
  transcribeBtn.disabled = !currentAudio;
});

async function loadModel(modelKey) {
  showLoading(`Cargando ${modelMapLabel(modelKey)}...`);

  const modelId = MODEL_MAP[modelKey];
  const { pipeline } = window.transformers;
  transcriber = await pipeline('automatic-speech-recognition', modelId, {
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        const pct = Math.round(p.loaded / p.total * 100);
        loadingMsg.textContent = `Cargando ${modelMapLabel(modelKey)}... ${pct}%`;
      }
    },
  });
  loadedModel = modelKey;
  hideLoading();
  showStatus(`✅ Modelo cargado: ${modelMapLabel(modelKey)}`);
}

async function runTranscription(lang) {
  const audio = currentAudio.data;
  const totalSamples = audio.length;
  const chunkSize = CHUNK_SECONDS * 16000; // samples per chunk
  const totalChunks = Math.ceil(totalSamples / chunkSize);
  const options = { task: 'transcribe' };
  if (lang !== 'auto') options.language = lang;

  // Estimate time
  if (totalChunks > 1) {
    showLoading(`Transcribiendo... fragmento 1 de ${totalChunks}`);
  } else {
    showLoading('Transcribiendo...');
  }

  try {
    let fullText = '';
    let allChunks = [];  // accumulate timestamped chunks from all segments
    const startTime = performance.now();

    for (let i = 0; i < totalSamples; i += chunkSize) {
      const end = Math.min(i + chunkSize, totalSamples);
      const segment = audio.slice(i, end);

      if (totalChunks > 1) {
        const chunkNum = Math.floor(i / chunkSize) + 1;
        loadingMsg.textContent = `Transcribiendo... fragmento ${chunkNum} de ${totalChunks}`;
      }

      const result = await transcriber(segment, options);
      const text = result.text ? result.text.trim() : '';

      if (text) {
        fullText += (fullText ? ' ' : '') + text;
      }

      // Accumulate timestamped chunks with offset
      if (result.chunks) {
        const offset = i / 16000; // seconds
        for (const c of result.chunks) {
          allChunks.push({
            text: c.text,
            timestamp: [
              Math.round((c.timestamp[0] + offset) * 100) / 100,
              c.timestamp[1] !== null ? Math.round((c.timestamp[1] + offset) * 100) / 100 : null,
            ],
          });
        }
      }
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    hideLoading();

    const text = fullText || (allChunks.length ? allChunks.map(c => c.text).join(' ').trim() : '');
    if (!text) {
      showStatus('⚠️ No se detectó contenido de audio. ¿Esperabas transcripción?', true);
      return;
    }

    // Store chunks for format switching
    outputText._chunks = allChunks.length > 0 ? allChunks : null;

    // Render in selected format
    renderOutput(text, allChunks);
    outputSection.classList.remove('hidden');
    const totalDur = Math.round(currentAudio.duration);
    const durStr = totalDur > 60 ? `${Math.round(totalDur / 60)} min` : `${totalDur}s`;
    showStatus(`✅ Transcripción completada en ${elapsed}s — ${durStr} de audio`);
    outputSection.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    hideLoading();
    showStatus(`❌ Error en la transcripción: ${err.message}`, true);
    console.error(err);
  }
}

/* ─── Output format switching ─── */
outputFormat.addEventListener('change', () => {
  const text = outputText._plainText;
  const chunks = outputText._chunks;
  if (!text) return;
  renderOutput(text, chunks);
});

function renderOutput(text, chunks) {
  outputText._plainText = text;

  const fmt = outputFormat.value;
  let display;

  switch (fmt) {
    case 'txt':
      display = text;
      break;
    case 'srt':
      display = chunks && chunks.length ? toSRT(chunks) : text;
      break;
    case 'vtt':
      display = chunks && chunks.length ? toVTT(chunks) : text;
      break;
    default:
      display = text;
  }

  outputText.textContent = display;
}

function toSRT(chunks) {
  return chunks.map((c, i) => {
    const start = srtTime(c.timestamp[0]);
    const end = srtTime(c.timestamp[1] !== null ? c.timestamp[1] : c.timestamp[0] + 1);
    return `${i + 1}\n${start} --> ${end}\n${c.text.trim()}\n`;
  }).join('\n');
}

function toVTT(chunks) {
  const header = 'WEBVTT\n\n';
  return header + chunks.map((c) => {
    const start = vttTime(c.timestamp[0]);
    const end = vttTime(c.timestamp[1] !== null ? c.timestamp[1] : c.timestamp[0] + 1);
    return `${start} --> ${end}\n${c.text.trim()}\n`;
  }).join('\n');
}

function srtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${pad(h)}:${pad(m)}:${pad2(s)}`;
}

function vttTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${pad(m)}:${pad2(s)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }
function pad2(n) { return n.toFixed(3).padStart(6, '0'); }

function modelMapLabel(key) {
  return ({ tiny: 'whisper-tiny', base: 'whisper-base', small: 'whisper-small' })[key] || key;
}

/* ─── Output actions ─── */
copyBtn.addEventListener('click', async () => {
  const text = outputText.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showStatus('📋 Transcripción copiada al portapapeles');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showStatus('📋 Transcripción copiada');
  }
});

downloadBtn.addEventListener('click', () => {
  const text = outputText.textContent;
  if (!text) return;
  const baseName = sourceFileName
    ? sourceFileName.replace(/\.\w+$/, '').replace(/[-:]/g, '.')
    : 'transcripcion';
  const fmt = outputFormat.value;
  const ext = fmt === 'txt' ? 'txt' : fmt;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showStatus(`⬇️ Descargado como .${ext}`);
});

/* ─── UI helpers ─── */
function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusEl.classList.remove('hidden');
  clearTimeout(statusEl._hideTimer);
  statusEl._hideTimer = setTimeout(
    () => statusEl.classList.add('hidden'),
    isError ? 8000 : 4000
  );
}

function showLoading(msg) {
  loadingMsg.textContent = msg;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/* ─── Init ─── */
console.log('transcribir loaded — 🎙️ Audio a texto en el navegador');