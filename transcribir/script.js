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
let originalAudio = null;     // backup of pre-separation audio for reset
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
    originalAudio = { data: new Float32Array(currentAudio.data), duration: currentAudio.duration };
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
  originalAudio = null;
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
    if (blob.size === 0) {
      appLog('mic: empty recording (too short or no data)');
      showStatus('⚠️ Grabación demasiado corta. Intenta grabar al menos 1 segundo.', true);
      return;
    }
    appLog('mic: recording stopped, blob='+formatSize(blob.size));

    const name = `micrófono-${formatDuration(micSeconds)}`;
    await loadAudio(blob, name);
    appLog('mic: audio loaded, duration='+formatDuration(micSeconds));
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

/* ─── Vocal separation ─── */
let separationModel = null;
let separationLoaded = false;
let onnxLoaded = false;

const SEPARATION_MODEL_URL =
  'https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems-int8/resolve/main/vocals.int8.onnx';

const separationSelect = document.getElementById('separation-select');

async function loadONNXRuntime() {
  if (onnxLoaded) return;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js';
    script.onload = () => { onnxLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('No se pudo cargar ONNX Runtime'));
    document.head.appendChild(script);
  });
}

async function loadSeparationModel() {
  if (separationLoaded) return;
  if (!onnxLoaded) await loadONNXRuntime();

  showLoading('Cargando modelo de separación vocal (~8 MB)...');
  try {
    const session = await onnx.InferenceSession.create(SEPARATION_MODEL_URL);
    separationModel = session;
    separationLoaded = true;
    hideLoading();
    showStatus('✅ Modelo de separación listo');
  } catch (err) {
    hideLoading();
    showStatus('❌ Error al cargar modelo: ' + err.message, true);
    separationSelect.value = 'none';
    throw err;
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

/*
 * Run Spleeter vocal extraction via ONNX Runtime.
 *
 * NOTE: This is EXPERIMENTAL. The exact model API (input/output tensor
 * names and shapes) depends on the ONNX export. If the model below
 * doesn't match, adjust tensor names in the `results` handling.
 *
 * Input:  mono Float32Array at 16000 Hz
 * Output: mono Float32Array at 16000 Hz (vocals estimate)
 */
async function separateVocalsONNX(audioData, sampleRate) {
  if (!separationLoaded) {
    showStatus('⚠️ Modelo de separación no cargado', true);
    return audioData;
  }

  showLoading('Separando voz con ML...');

  try {
    // Spleeter expects 16000 Hz mono input
    let audio = audioData;
    if (sampleRate !== 16000) {
      const len = Math.round(audio.length * 16000 / sampleRate);
      const ctx = new OfflineAudioContext(1, len, 16000);
      const buf = ctx.createBuffer(1, audio.length, sampleRate);
      buf.getChannelData(0).set(audio);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      const rendered = await ctx.startRendering();
      audio = rendered.getChannelData(0);
    }

    // Try input shape [1, 1, num_samples]
    const inputTensor = new onnx.Tensor('float32', audio, [1, 1, audio.length]);
    const results = await separationModel.run({ input: inputTensor });

    // Try common output names: 'output', 'vocals', or first result
    let outputData = results.output?.data
      || results.vocals?.data
      || Object.values(results)[0]?.data;

    if (!outputData || outputData.length === 0) {
      throw new Error('No se pudo leer la salida del modelo');
    }

    hideLoading();
    showStatus('✅ Voz separada — transcribiendo...');
    return outputData;
  } catch (err) {
    hideLoading();
    showStatus('⚠️ Error en separación: ' + err.message + '. Usando audio original.', true);
    return audioData;
  }
}

/* ─── Transcription (with chunking for long audio) ─── */
transcribeBtn.addEventListener('click', async () => {
  if (!currentAudio || isTranscribing || cdnFailed) {
    appLog('transcribe: blocked — currentAudio='+!!currentAudio+' isTranscribing='+isTranscribing+' cdnFailed='+cdnFailed);
    return;
  }
  appLog('transcribe: starting');
  isTranscribing = true;
  transcribeBtn.disabled = true;
  outputSection.classList.add('hidden');

  const modelKey = modelSelect.value;
  const lang = langSelect.value;
  const sepMode = separationSelect.value;

  appLog('transcribe: model='+modelKey+' lang='+lang+' sep='+sepMode);

  // Load Whisper model if needed
  if (transcriber === null || loadedModel !== modelKey) {
    try {
      await loadModel(modelKey);
    } catch (err) {
      hideLoading();
      showStatus('❌ Error al cargar el modelo Whisper: ' + (err.message || err), true);
      isTranscribing = false;
      transcribeBtn.disabled = !currentAudio;
      return;
    }
  } else {
    appLog('transcribe: model already loaded');
  }
  // Vocal separation step (before transcription)
  // Always start from original audio to make separation idempotent
  if (sepMode !== 'none' && originalAudio) {
    currentAudio.data = new Float32Array(originalAudio.data);
  }

  if (sepMode === 'spleeter') {
    try {
      clearPersistentStatus();
      appLog('spleeter: loading model');
      await loadSeparationModel();
      appLog('spleeter: running inference');
      const separated = await separateVocalsONNX(currentAudio.data, 16000);
      currentAudio.data = separated;
      appLog('spleeter: done');
    } catch {
      // Error already shown by loadSeparationModel/separateVocalsONNX
      isTranscribing = false;
      transcribeBtn.disabled = !currentAudio;
      return;
    }
  } else if (sepMode === 'hpf') {
    clearPersistentStatus();
    appLog('hpf: applying high-pass filter');
    showStatus('🎛️ Aplicando filtro pasa altos para realzar voz...');
    currentAudio.data = enhanceVocalsHPF(currentAudio.data, 16000);
    appLog('hpf: done');
  }

  appLog('transcribe: running transcription');

  await runTranscription(lang);

  isTranscribing = false;
  transcribeBtn.disabled = !currentAudio;
});

async function loadModel(modelKey) {
  showLoading(`Cargando ${modelMapLabel(modelKey)}...`);
  appLog('model: starting download for '+modelKey);
  // Yield to event loop so the browser paints the loading overlay
  await tick();

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

      // Graceful per-chunk: if one chunk fails, continue with others
      const result = await transcriber(segment, options).catch(err => {
        console.warn(`Fragmento falló:`, err);
        return { text: '', chunks: null };
      });
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
    appLog('transcribe: completed — ' + elapsed + 's for ' + totalDur + 's audio');
    showStatus(`✅ Transcripción completada en ${elapsed}s — ${durStr} de audio`);
    outputSection.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    hideLoading();
    appLog('transcribe: error — ' + err.message);
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

/* ─── Tab helper ─── */
function switchToFileTab() {
  inputTabs.forEach(t => t.classList.remove('active'));
  document.querySelector('[data-mode="file"]').classList.add('active');
  paneFile.classList.add('active');
  paneMic.classList.remove('active');
  if (isRecording) stopRecording();
}

/* ─── Service worker registration ─── */
let swRegistration = null;

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    swRegistration = reg;
    console.log('SW registered:', reg.scope);

    // Show version in footer
    const verEl = document.getElementById('app-version');
    if (verEl && reg.active) {
      // Try to read version from SW's broadcast, or just show a cached indicator
      verEl.textContent = 'v' + (reg.active.scriptURL.match(/v=(\d+)/)?.[1] || '?');
    }

    // Detect SW updates
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if (!newSW) return;

      newSW.addEventListener('statechange', () => {
        // 'installed' means the new SW is ready but waiting to activate
        // (skipWaiting will activate it immediately, but we still show the banner)
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdatePrompt();
        }
      });
    });
  } catch (err) {
    console.warn('SW registration failed:', err);
  }
}

/* ─── Update prompt ─── */
const updatePrompt = document.getElementById('update-prompt');
const updateBtn = document.getElementById('update-btn');
const updateDismiss = document.getElementById('update-dismiss');

function showUpdatePrompt() {
  if (!updatePrompt) return;
  updatePrompt.classList.remove('hidden');
}

updateBtn?.addEventListener('click', async () => {
  updatePrompt.classList.add('hidden');
  if (swRegistration && swRegistration.waiting) {
    // Tell the waiting SW to activate
    swRegistration.waiting.postMessage('SKIP_WAITING');
    // Wait for the new SW to take control, then reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }
});

updateDismiss?.addEventListener('click', () => {
  updatePrompt.classList.add('hidden');
});

/* ─── Shared file ingestion (from SW share target) ─── */
const SHARED_CACHE = 'transcribir-shared-v2';

async function checkSharedFiles() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('shared') === 'true') {
    appLog('check-shared: ?shared=true detected');
    let foundAny = false;
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
        await loadAudio(file, fileName);
        foundAny = true;
        appLog('check-shared: loaded '+fileName);
        // Persistent notification + auto-transcribe for shared files
        showStatus(`📲 Audio compartido: ${fileName}`, false, true);
        switchToFileTab();
      }

      // Clean up shared cache
      await cache.delete('file-count');
      for (let i = 0; i < count; i++) {
        await cache.delete(`file-${i}`);
      }

      // Remove query param without reloading
      window.history.replaceState({}, '', './');

      // Auto-start transcription after all files loaded
      if (foundAny && currentAudio) {
        appLog('check-shared: auto-transcribing');
        transcribeBtn.click();
      }
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

/* ─── In-app logging (for debugging user issues) ─── */
const transcribirLog = [];
const MAX_LOG = 100;

function appLog(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  transcribirLog.push(entry);
  if (transcribirLog.length > MAX_LOG) transcribirLog.shift();
  console.log('transcribir:', msg);
  // Update log viewer if open
  const logEl = document.getElementById('log-content');
  if (logEl) {
    logEl.textContent = transcribirLog.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }
}

/* ─── Log viewer toggle ─── */
document.addEventListener('DOMContentLoaded', () => {
  const logBtn = document.getElementById('log-toggle');
  const logPanel = document.getElementById('log-panel');
  if (!logBtn || !logPanel) return;

  logBtn.addEventListener('click', () => {
    const isOpen = !logPanel.classList.contains('hidden');
    logPanel.classList.toggle('hidden');
    logBtn.textContent = isOpen ? '🐛' : '✕';
    if (!isOpen) {
      const logEl = document.getElementById('log-content');
      if (logEl) {
        logEl.textContent = transcribirLog.join('\n');
        logEl.scrollTop = logEl.scrollHeight;
      }
    }
  });

  // Copy logs button
  const logCopy = document.getElementById('log-copy');
  logCopy.addEventListener('click', () => {
    const text = transcribirLog.join('\n') + '\n\n=== Transcribir Log ===\n' + new Date().toISOString();
    navigator.clipboard.writeText(text).then(() => {
      logCopy.textContent = '✅';
      setTimeout(() => { logCopy.textContent = '📋'; }, 2000);
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      logCopy.textContent = '✅';
      setTimeout(() => { logCopy.textContent = '📋'; }, 2000);
    });
  });
});

/* ─── UI helpers ─── */
let persistentStatusTimeout = null;

function showStatus(msg, isError = false, persistent = false) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusEl.classList.remove('hidden');
  clearTimeout(statusEl._hideTimer);
  clearTimeout(persistentStatusTimeout);
  if (!persistent) {
    statusEl._hideTimer = setTimeout(
      () => statusEl.classList.add('hidden'),
      isError ? 8000 : 4000
    );
  }
}

function clearPersistentStatus() {
  statusEl.classList.add('hidden');
  clearTimeout(persistentStatusTimeout);
}

function showLoading(msg) {
  loadingMsg.textContent = msg;
  loadingOverlay.classList.remove('hidden');
}

// Yield to event loop so the browser paints pending DOM changes
function tick() {
  return new Promise(r => setTimeout(r, 50));
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

    for (const fileHandle of launchParams.files) {
      try {
        const file = await fileHandle.getFile();
        if (!file.type.startsWith('audio/')) {
          showStatus(`⚠️ "${file.name}" no es un archivo de audio`, true);
          continue;
        }
        await loadAudio(file, file.name);
        // Persistent notification + auto-transcribe for shared files
        showStatus(`📲 Audio compartido: ${file.name}`, false, true);
        switchToFileTab();
      } catch (err) {
        console.warn('LaunchQueue error:', err);
        showStatus('⚠️ Error al recibir archivo de audio', true);
      }
    }

    // Auto-start transcription after all files loaded
    if (currentAudio) transcribeBtn.click();
  });
}

/* ─── Init ─── */
// Clear the loading status shown by inline script
if (statusEl) { statusEl.classList.add('hidden'); }

// Guard: if transformers.js failed to load
let cdnFailed = false;
if (typeof window.transformers === 'undefined') {
  cdnFailed = true;
  showStatus('❌ No se pudo cargar la biblioteca de IA. Verifica tu conexión y recarga.', true);
  transcribeBtn.disabled = true;
} else {
  registerSW();
  checkSharedFiles();
}

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