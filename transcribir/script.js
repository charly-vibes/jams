// transcribir — browser-based Whisper transcription using transformers.js
// Transcription runs in a Web Worker to keep the UI responsive.

/* ─── State ─── */
const CHUNK_SECONDS = 30;     // Whisper's native window size

let whisperWorker = null;
let currentAudio = null;      // { data: Float32Array, duration: number, name: string }
let cdnFailed = false;
let sourceFileName = null;
let sourceDuration = null;
let mediaRecorder = null;
let activeMicStream = null;
let recordingRequestId = 0;
let micChunks = [];
let micTimer = null;
let micSeconds = 0;
let isRecording = false;
let isTranscribing = false;
let batchCancelled = false;
let pendingResolve = null;    // resolves the transcribe promise
let pendingReject = null;     // rejects the transcribe promise
let activeRequestId = null;
let nextRequestId = 1;

const { combineBatchTranscriptions, toSRT, toVTT } = window.TranscribirFormat;

/* ─── DOM refs ─── */
// All DOM element refs go here (top of file) to avoid Temporal Dead Zone issues
// with event listeners and settings handlers defined below.
const $ = (s) => document.querySelector(s);

const fileInput        = $('#file-input');
const uploadZone       = $('#upload-zone');
const fileInfo         = $('#file-info');
const recordBtn        = $('#record-btn');
const micTimerEl       = $('#mic-timer');
const micInfo          = $('#mic-info');
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
const separationSelect = document.getElementById('separation-select');
const advancedToggle   = document.querySelector('.advanced-toggle');

/* ─── Settings persistence ─── */
const SETTINGS_KEY = 'transcribir-settings';

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      model: modelSelect.value,
      lang: langSelect.value,
      separation: separationSelect.value,
      advancedOpen: advancedToggle ? advancedToggle.open : false,
    }));
  } catch { /* storage unavailable */ }
}

function restoreSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.model && [...modelSelect.options].some(o => o.value === s.model)) modelSelect.value = s.model;
    if (s.lang && [...langSelect.options].some(o => o.value === s.lang)) langSelect.value = s.lang;
    if (s.separation && [...separationSelect.options].some(o => o.value === s.separation)) separationSelect.value = s.separation;
    if (s.advancedOpen && advancedToggle) advancedToggle.open = true;
  } catch { /* corrupt data */ }
}

modelSelect.addEventListener('change', saveSettings);
langSelect.addEventListener('change', saveSettings);
separationSelect.addEventListener('change', saveSettings);
if (advancedToggle) advancedToggle.addEventListener('toggle', saveSettings);

/* ─── File input ─── */
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
  const requestId = ++recordingRequestId;
  isRecording = true;
  recordBtn.disabled = true; // disable during getUserMedia negotiation

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (requestId !== recordingRequestId) throw new DOMException('Recording cancelled', 'AbortError');
    activeMicStream = stream;
    if (document.hidden) throw new DOMException('Page hidden', 'AbortError');
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder no está disponible');

    // MIME type support: prefer Opus in WebM, fallback through Ogg, then mp4
    const mimeType =
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus')  ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')            ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4')             ? 'audio/mp4'
      : '';

    micChunks = [];
    micSeconds = 0;
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) micChunks.push(e.data); };
    mediaRecorder.onerror = (event) => {
      const message = event.error?.message || 'Error durante la grabación';
      appLog('mic: recorder error — ' + message);
      cancelRecording();
      showStatus('No se pudo completar la grabación: ' + message, true);
    };
    mediaRecorder.onstop = async () => {
      const recordedSeconds = micSeconds;
      releaseMediaStream(stream);
      activeMicStream = null;
      resetRecordingUI();

      const blob = new Blob(micChunks, { type: mimeType || 'audio/webm' });
      if (blob.size === 0) {
        appLog('mic: empty recording (too short or no data)');
        showStatus('⚠️ Grabación demasiado corta. Intenta grabar al menos 1 segundo.', true);
        return;
      }
      appLog('mic: recording stopped, blob='+formatSize(blob.size));

      const name = `micrófono-${formatDuration(recordedSeconds)}`;
      await loadAudio(blob, name);
      appLog('mic: audio loaded, duration='+formatDuration(recordedSeconds));
      micInfo.textContent = `🎤 Grabación: ${formatDuration(recordedSeconds)} (${formatSize(blob.size)})`;
      micInfo.classList.remove('hidden');
    };

    mediaRecorder.start(250);
    recordBtn.disabled = false;
    recordBtn.classList.add('recording');
    recordBtn.querySelector('.record-icon').textContent = '⏹';
    recordBtn.querySelector('.record-label').textContent = 'Detener';
    micTimerEl.classList.remove('hidden');
    micTimerEl.textContent = '00:00';
    micTimer = setInterval(() => {
      micSeconds++;
      micTimerEl.textContent = formatDuration(micSeconds);
    }, 1000);
  } catch (err) {
    appLog('mic: setup failed — ' + err.message);
    releaseMediaStream(stream);
    if (requestId === recordingRequestId) {
      activeMicStream = null;
      resetRecordingUI();
      if (err.name !== 'AbortError') showStatus('No se pudo iniciar el micrófono: ' + err.message, true);
    }
  }
}

function releaseMediaStream(stream) {
  if (stream) stream.getTracks().forEach((track) => track.stop());
}

function resetRecordingUI() {
  clearInterval(micTimer);
  micTimer = null;
  micTimerEl.classList.add('hidden');
  isRecording = false;
  mediaRecorder = null;
  recordBtn.disabled = false;
  recordBtn.classList.remove('recording');
  recordBtn.querySelector('.record-icon').textContent = '⏺';
  recordBtn.querySelector('.record-label').textContent = 'Grabar';
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

function cancelRecording() {
  recordingRequestId++;
  const recorder = mediaRecorder;
  if (recorder) {
    recorder.onstop = null;
    if (recorder.state !== 'inactive') recorder.stop();
  }
  releaseMediaStream(activeMicStream);
  activeMicStream = null;
  micChunks = [];
  resetRecordingUI();
}

// Stop mic if tab becomes hidden during recording
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isRecording) stopRecording();
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

/*
 * Enhance vocals via simple high-pass filter (remove sub-bass rumble).
 * Works on any mono audio. Does NOT do ML-based source separation.
 */
function enhanceVocalsHPF(audio, sampleRate) {
  // Simple single-pole high-pass filter at ~120 Hz
  // Removes low-frequency rumble, making vocals clearer
  const cutoff = 120; // Hz
  const RC = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sampleRate;
  const alpha = RC / (RC + dt);

  const out = new Float32Array(audio.length);
  out[0] = audio[0];
  for (let i = 1; i < audio.length; i++) {
    out[i] = alpha * (out[i - 1] + audio[i] - audio[i - 1]);
  }
  return out;
}

/* ─── Transcription (Web Worker-based) ─── */
transcribeBtn.addEventListener('click', () => {
  batchCancelled = false;
  transcribeCurrentAudio();
});

async function transcribeCurrentAudio({ scroll = true } = {}) {
  if (!currentAudio || isTranscribing || cdnFailed) {
    appLog('transcribe: blocked — currentAudio='+!!currentAudio+' isTranscribing='+isTranscribing+' cdnFailed='+cdnFailed);
    return null;
  }
  appLog('transcribe: starting');
  isTranscribing = true;
  transcribeBtn.disabled = true;
  outputSection.classList.add('hidden');

  const modelKey = modelSelect.value;
  const lang = langSelect.value;
  const sepMode = separationSelect.value;

  appLog('transcribe: model='+modelKey+' lang='+lang+' sep='+sepMode);

  let audioData = currentAudio.data;

  // Vocal separation step (before transcription)
  if (sepMode === 'hpf') {
    clearPersistentStatus();
    appLog('hpf: applying high-pass filter');
    showStatus('🎛️ Aplicando filtro pasa altos para realzar voz...');
    audioData = enhanceVocalsHPF(audioData, 16000);
    appLog('hpf: done');
  }

  appLog('transcribe: running transcription');

  // Send to worker via structured clone
  showLoading('Preparando transcripción...');
  showCancelButton(true);

  const options = { task: 'transcribe' };
  if (lang !== 'auto') options.language = lang;

  try {
    const result = await transcribeInWorker(audioData, modelKey, options);
    hideLoading();
    showCancelButton(false);

    const text = result.text || (result.chunks ? result.chunks.map(c => c.text).join(' ').trim() : '');
    if (!text) {
      showStatus('⚠️ No se detectó contenido de audio. ¿Esperabas transcripción?', true);
      isTranscribing = false;
      transcribeBtn.disabled = !currentAudio;
      return null;
    }

    // Store chunks for format switching
    outputText._chunks = result.chunks && result.chunks.length > 0 ? result.chunks : null;

    // Render in selected format
    renderOutput(text, result.chunks || []);
    outputSection.classList.remove('hidden');
    const totalDur = Math.round(currentAudio.duration);
    const durStr = totalDur > 60 ? `${Math.round(totalDur / 60)} min` : `${totalDur}s`;
    appLog('transcribe: completed — ' + (result.elapsed || '?') + 's for ' + totalDur + 's audio');
    if (result.failedChunks) {
      showStatus(`⚠️ Transcripción parcial: fallaron ${result.failedChunks} fragmentos`, true);
    } else {
      showStatus(`✅ Transcripción completada — ${durStr} de audio`);
    }
    if (scroll) outputSection.scrollIntoView({ behavior: 'smooth' });
    isTranscribing = false;
    transcribeBtn.disabled = !currentAudio;
    return text;
  } catch (err) {
    hideLoading();
    showCancelButton(false);
    if (err.name === 'AbortError' || err.message === 'Cancelled') {
      showStatus('⏹️ Transcripción cancelada');
      appLog('transcribe: cancelled');
    } else {
      appLog('transcribe: error — ' + err.message);
      showStatus(`❌ Error en la transcripción: ${err.message}`, true);
      console.error(err);
    }
  }

  isTranscribing = false;
  transcribeBtn.disabled = !currentAudio;
  return null;
}

/* ─── Web Worker orchestration ─── */

function initWorker() {
  if (whisperWorker) return;

  try {
    whisperWorker = new Worker('worker.js', { type: 'module' });

    whisperWorker.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.requestId !== activeRequestId) return;

      switch (msg.type) {
        case 'model-loaded':
          showStatus(`✅ Modelo cargado: ${modelMapLabel(msg.modelKey)}`);
          appLog('worker: model loaded — ' + msg.modelKey);
          break;

        case 'progress':
          if (msg.step === 'download' || msg.step === 'transcribe' || msg.step === 'cdn' || msg.step === 'load-model') {
            showLoading(msg.message);
          }
          break;

        case 'result': {
          if (pendingResolve) {
            const elapsed = ((performance.now() - pendingResolve._startTime) / 1000).toFixed(1);
            pendingResolve({ text: msg.text, chunks: msg.chunks, failedChunks: msg.failedChunks, elapsed });
          }
          activeRequestId = null;
          pendingResolve = null;
          pendingReject = null;
          break;
        }

        case 'error':
          if (pendingReject) {
            pendingReject(new Error(msg.message));
          }
          activeRequestId = null;
          pendingResolve = null;
          pendingReject = null;
          break;

        case 'cancelled':
          if (pendingReject) {
            pendingReject(new Error('Cancelled'));
          }
          activeRequestId = null;
          pendingResolve = null;
          pendingReject = null;
          break;
      }
    });

    whisperWorker.addEventListener('error', (err) => {
      appLog('worker: error — ' + (err.message || 'unknown'));
      cdnFailed = true;
      if (pendingReject) {
        pendingReject(new Error('Error en el worker: ' + err.message));
      }
      pendingResolve = null;
      pendingReject = null;
      activeRequestId = null;
      showStatus('❌ El worker de transcripción falló. Recarga la página para reintentar.', true);
    });

    appLog('worker: created');
  } catch (err) {
    appLog('worker: creation failed — ' + err.message);
    cdnFailed = true;
    showStatus('❌ No se pudo iniciar el worker de transcripción', true);
  }
}

function transcribeInWorker(audioData, modelKey, options) {
  return new Promise((resolve, reject) => {
    if (!whisperWorker) {
      reject(new Error('Worker no disponible'));
      return;
    }

    pendingResolve = resolve;
    pendingResolve._startTime = performance.now();
    pendingReject = reject;
    activeRequestId = nextRequestId++;

    // Send the audio data via structured clone so re-transcription works.
    whisperWorker.postMessage({
      type: 'transcribe',
      requestId: activeRequestId,
      audio: audioData,
      modelKey,
      options,
      chunkSize: CHUNK_SECONDS * 16000,
    });
  });
}

function cancelTranscription() {
  batchCancelled = true;
  if (whisperWorker && isTranscribing) {
    whisperWorker.terminate();
    whisperWorker = null;
    appLog('transcribe: cancel requested');
  }
  if (pendingReject) pendingReject(new DOMException('Cancelled', 'AbortError'));
  pendingResolve = null;
  pendingReject = null;
  activeRequestId = null;
  cdnFailed = false;
  isTranscribing = false;
  transcribeBtn.disabled = !currentAudio;
  initWorker();
}

function modelMapLabel(key) {
  return ({ tiny: 'whisper-tiny', base: 'whisper-base', small: 'whisper-small' })[key] || key;
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

/* ─── Output actions ─── */
copyBtn.addEventListener('click', async () => {
  const text = outputText.textContent;
  if (!text) return;
  try {
    await copyToClipboard(text);
    showStatus('📋 Transcripción copiada al portapapeles');
  } catch (err) {
    appLog('clipboard: copy failed — ' + err.message);
    showStatus('❌ No se pudo copiar. Selecciona el texto manualmente.', true);
  }
});

async function copyToClipboard(text) {
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API no disponible');
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      if (!document.execCommand('copy')) throw new Error('El navegador rechazó la copia');
    } finally {
      ta.remove();
    }
  }
}

downloadBtn.addEventListener('click', () => {
  const text = outputText.textContent;
  if (!text) return;
  const baseName = sourceFileName
    ? sourceFileName.replace(/\.[^.]+$/, '').replace(/[-:]/g, '.')
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

/* ─── Service worker registration ─── */
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    console.log('SW registered:', reg.scope);

    // Detect new SW versions and show update banner
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if (!newSW) return;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(reg);
        }
      });
    });
  } catch (err) {
    console.warn('SW registration failed:', err);
  }
}

function showUpdateBanner(reg) {
  const banner = document.getElementById('update-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  // Store ref for the onclick handler in HTML
  window._pendingUpdateReg = reg;
}

function applyUpdate(reg) {
  const r = reg || window._pendingUpdateReg;
  const banner = document.getElementById('update-banner');
  if (banner) banner.classList.add('hidden');
  window._pendingUpdateReg = null;
  if (r && r.waiting) {
    r.waiting.postMessage('SKIP_WAITING');
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }
}

// Expose for HTML onclick
window.applyUpdate = applyUpdate;

/* ─── Shared file ingestion (from SW share target) ─── */
const SHARED_CACHE = 'transcribir-shared-v5';

async function checkSharedFiles() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('shared') === 'true') {
    appLog('check-shared: ?shared=true detected');
    const sharedFiles = [];
    try {
      const cache = await caches.open(SHARED_CACHE);
      const countResp = await cache.match('file-count');
      if (!countResp) {
        appLog('check-shared: no file-count in cache');
        showStatus('⚠️ Audio compartido: el servicio no estaba listo. Vuelve a compartir el audio.', true);
        window.history.replaceState({}, '', './');
        return;
      }

      const count = parseInt(await countResp.text(), 10);
      if (isNaN(count) || count < 1) {
        appLog('check-shared: invalid count');
        return;
      }

      for (let i = 0; i < count; i++) {
        const fileResp = await cache.match(`file-${i}`);
        if (!fileResp) {
          appLog('check-shared: file-'+i+' not found');
          continue;
        }

        const blob = await fileResp.blob();
        const rawName = fileResp.headers.get('X-File-Name');
        const fileName = rawName ? decodeURIComponent(rawName) : `compartido-${i}.${(blob.type && blob.type.split('/')[1]) || 'wav'}`;

        const file = new File([blob], fileName, { type: blob.type });
        sharedFiles.push(file);
        appLog('check-shared: loaded '+fileName);
      }

      // Clean up shared cache
      await cache.delete('file-count');
      for (let i = 0; i < count; i++) {
        await cache.delete(`file-${i}`);
      }

      // Remove query param without reloading
      window.history.replaceState({}, '', './');

      await transcribeSharedFiles(sharedFiles);
    } catch (err) {
      console.warn('Error reading shared files:', err);
      appLog('check-shared: error '+err.message);
      showStatus('⚠️ Error al procesar audio compartido', true);
    }
  }

  if (params.get('share_error')) {
    const msg = params.get('share_error') === 'no_files'
      ? '⚠️ No se recibió ningún archivo de audio'
      : '⚠️ Error al procesar el archivo compartido';
    showStatus(msg, true);
    window.history.replaceState({}, '', './');
  }
}

async function transcribeSharedFiles(files) {
  if (!files.length) return;
  if (isRecording) cancelRecording();
  batchCancelled = false;
  const completed = [];

  for (let index = 0; index < files.length && !batchCancelled; index++) {
    const file = files[index];
    showStatus(`📲 Procesando ${index + 1} de ${files.length}: ${file.name}`, false, true);
    await loadAudio(file, file.name);
    if (!currentAudio) continue;
    const text = await transcribeCurrentAudio({ scroll: false });
    if (text) completed.push({ name: file.name, text });
  }

  if (files.length > 1 && completed.length) {
    sourceFileName = 'audios-compartidos';
    outputFormat.value = 'txt';
    outputText._chunks = null;
    renderOutput(combineBatchTranscriptions(completed), []);
    outputSection.classList.remove('hidden');
    const skipped = files.length - completed.length;
    showStatus(skipped
      ? `⚠️ ${completed.length} audios transcritos; ${skipped} sin resultado`
      : `✅ ${completed.length} audios transcritos`, skipped > 0);
    outputSection.scrollIntoView({ behavior: 'smooth' });
  }
}

/* ─── In-app logging ─── */
const transcribirLog = [];
const MAX_LOG = 100;

function appLog(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  transcribirLog.push(entry);
  if (transcribirLog.length > MAX_LOG) transcribirLog.shift();
  console.log('transcribir:', msg);
}

/* ─── UI helpers ─── */
function showStatus(msg, isError = false, persistent = false) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusEl.classList.remove('hidden');
  clearTimeout(statusEl._hideTimer);
  if (!persistent) {
    statusEl._hideTimer = setTimeout(
      () => statusEl.classList.add('hidden'),
      isError ? 8000 : 4000
    );
  }
}

function clearPersistentStatus() {
  statusEl.classList.add('hidden');
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

/* ─── LaunchQueue: receive shared files while app is open ─── */
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams.files || launchParams.files.length === 0) return;
    const files = [];

    for (const fileHandle of launchParams.files) {
      try {
        const file = await fileHandle.getFile();
        if (!file.type.startsWith('audio/')) {
          showStatus(`⚠️ "${file.name}" no es un archivo de audio`, true);
          continue;
        }
        files.push(file);
      } catch (err) {
        console.warn('LaunchQueue error:', err);
        showStatus('⚠️ Error al recibir archivo de audio', true);
      }
    }

    await transcribeSharedFiles(files);
  });
}

/* ─── Help modal toggle ─── */
document.addEventListener('DOMContentLoaded', () => {
  const helpLink = document.getElementById('help-link');
  const helpModal = document.getElementById('help-modal');
  if (!helpLink || !helpModal) return;
  helpLink.addEventListener('click', (e) => {
    e.preventDefault();
    helpModal.classList.remove('hidden');
  });
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal.classList.add('hidden');
    }
  });
  const closeBtn = document.getElementById('help-modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => helpModal.classList.add('hidden'));
  }

  // Export log link inside help modal
  const logLink = document.getElementById('export-log-link');
  if (logLink) {
    logLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const text = transcribirLog.join('\n') + '\n\n=== Transcribir Log ===\n' + new Date().toISOString();
      try {
        await copyToClipboard(text);
        logLink.textContent = '✅ Copiado';
        setTimeout(() => { logLink.textContent = '📋 Exportar registro de eventos'; }, 2000);
      } catch (err) {
        appLog('clipboard: log export failed — ' + err.message);
        logLink.textContent = '❌ No se pudo copiar';
        setTimeout(() => { logLink.textContent = '📋 Exportar registro de eventos'; }, 2000);
      }
    });
  }
});

/* ─── Cancel button in loading overlay ─── */
function showCancelButton(show) {
  let cancelBtn = document.getElementById('cancel-btn');
  if (show) {
    if (!cancelBtn) {
      cancelBtn = document.createElement('button');
      cancelBtn.id = 'cancel-btn';
      cancelBtn.className = 'cancel-btn';
      cancelBtn.textContent = '⏹ Cancelar';
      cancelBtn.addEventListener('click', () => {
        cancelTranscription();
        hideLoading();
        showCancelButton(false);
      });
      document.querySelector('.loading-box').appendChild(cancelBtn);
    }
  } else {
    if (cancelBtn) cancelBtn.remove();
  }
}

/* ─── Init ─── */
// Restore previously saved settings
restoreSettings();

// Clear the loading status shown by inline script
if (statusEl) { statusEl.classList.add('hidden'); }

// Start the worker (handles CDN loading, model loading, and transcription)
initWorker();
registerSW();
checkSharedFiles();

/* ─── Install prompt (beforeinstallprompt) ─── */
let deferredPrompt = null;
const installPrompt = document.getElementById('install-prompt');
const installBtn = document.getElementById('install-btn');
const installDismiss = document.getElementById('install-dismiss');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Only show if not in standalone mode already
  if (!window.matchMedia('(display-mode: standalone)').matches) {
    installPrompt.classList.remove('hidden');
  }
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  installPrompt.classList.add('hidden');
  deferredPrompt.prompt();
  const result = await deferredPrompt.userChoice;
  console.log('Install result:', result.outcome);
  deferredPrompt = null;
});

installDismiss.addEventListener('click', () => {
  installPrompt.classList.add('hidden');
  deferredPrompt = null;
});

// Hide install prompt if already installed
if (window.matchMedia('(display-mode: standalone)').matches) {
  installPrompt.classList.add('hidden');
}

console.log('transcribir loaded — 🎙️ Audio a texto en el navegador');
