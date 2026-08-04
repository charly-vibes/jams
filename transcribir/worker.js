// transcribir — Web Worker for Whisper transcription
// Runs transformers.js off the main thread to keep the UI responsive.
// Communicates with the main thread via postMessage.

// The worker is created as a module worker ({ type: 'module' }) to support
// dynamic import() of the ESM-format CDN file.
const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js',
  'https://unpkg.com/@xenova/transformers@2.17.2/dist/transformers.min.js',
];

const MODEL_MAP = {
  tiny:  'Xenova/whisper-tiny',
  base:  'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
};

// Throttle progress messages for audio with more chunks than this
const PROGRESS_THROTTLE_THRESHOLD = 50;

let transcriber = null;
let loadedModel = null;
let abortController = null;

/* ─── Message handler ─── */
self.addEventListener('message', async (e) => {
  const msg = e.data;

  switch (msg.type) {
    case 'transcribe': {
      const requestId = msg.requestId;
      // Guard: abort any previous transcription before starting a new one
      if (abortController) {
        abortController.abort();
      }
      const controller = new AbortController();
      abortController = controller;
      const signal = controller.signal;
      const audio = msg.audio;        // Float32Array
      const options = msg.options;    // { task, language? }
      const chunkSize = msg.chunkSize || (30 * 16000);
      const totalSamples = audio.length;
      const totalChunks = Math.ceil(totalSamples / chunkSize);

      // Report model load progress if needed
      if (!transcriber || loadedModel !== msg.modelKey) {
        self.postMessage({ type: 'progress', requestId, step: 'load-model', message: 'Cargando modelo Whisper...' });
        try {
          await loadModel(msg.modelKey, signal, requestId);
          self.postMessage({ type: 'model-loaded', requestId, modelKey: msg.modelKey });
        } catch (err) {
          if (abortController === controller) abortController = null;
          if (err.name === 'AbortError') {
            self.postMessage({ type: 'cancelled', requestId });
          } else {
            self.postMessage({ type: 'error', requestId, message: 'Error al cargar el modelo: ' + err.message });
          }
          return;
        }
      }

      try {
        const result = await runTranscription(audio, options, chunkSize, totalChunks, signal, requestId);
        if (abortController === controller) abortController = null;
        self.postMessage({ type: 'result', requestId, ...result });
      } catch (err) {
        if (abortController === controller) abortController = null;
        if (err.name === 'AbortError') {
          self.postMessage({ type: 'cancelled', requestId });
        } else {
          self.postMessage({ type: 'error', requestId, message: err.message });
        }
      }
      break;
    }

    case 'cancel':
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      break;
  }
});

/* ─── Load transformers.js CDN ─── */
async function loadTransformers() {
  for (const url of CDN_URLS) {
    try {
      // Module worker: use dynamic import() instead of importScripts
      // because the CDN file uses ESM export syntax.
      self.transformers = await import(url);
      if (typeof self.transformers?.pipeline === 'function') {
        return;
      }
    } catch (err) {
      console.warn('Worker: CDN failed:', url, err);
      continue;
    }
  }
  throw new Error('No se pudo cargar transformers.js desde ningún CDN');
}

/* ─── Load Whisper model (signal-aware, with retry) ─── */
const MAX_MODEL_RETRIES = 2;

async function loadModel(modelKey, signal, requestId) {
  if (transcriber && loadedModel === modelKey) return;

  if (typeof self.transformers === 'undefined') {
    self.postMessage({ type: 'progress', requestId, step: 'cdn', message: 'Cargando biblioteca de IA...' });
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    await loadTransformers();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  }

  const modelId = MODEL_MAP[modelKey];

  for (let attempt = 1; attempt <= MAX_MODEL_RETRIES; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    self.postMessage({
      type: 'progress',
      requestId,
      step: 'download',
      modelKey,
      message: `Descargando ${modelKey}${attempt > 1 ? ` (intento ${attempt})` : ''}...`,
    });

    try {
      transcriber = await self.transformers.pipeline('automatic-speech-recognition', modelId, {
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            const pct = Math.round(p.loaded / p.total * 100);
            self.postMessage({
              type: 'progress',
              requestId,
              step: 'download',
              modelKey,
              percent: pct,
              message: `Descargando ${modelKey}... ${pct}%`,
            });
          }
        },
      });
      loadedModel = modelKey;
      return;
    } catch (err) {
      // Reset so retry starts fresh
      if (transcriber) {
        transcriber = null;
        loadedModel = null;
      }
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt === MAX_MODEL_RETRIES) {
        throw err;
      }
      console.warn(`Worker: model load attempt ${attempt} failed, retrying:`, err);
    }
  }
}

/* ─── Run transcription with chunking ─── */
async function runTranscription(audio, options, chunkSize, totalChunks, signal, requestId) {
  const totalSamples = audio.length;
  let fullText = '';
  let allChunks = [];
  let failedChunks = 0;
  const throttle = totalChunks > PROGRESS_THROTTLE_THRESHOLD ? 5 : 1;

  for (let i = 0; i < totalSamples; i += chunkSize) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const end = Math.min(i + chunkSize, totalSamples);
    const segment = audio.slice(i, end);
    const chunkNum = Math.floor(i / chunkSize) + 1;

    // Throttle progress messages for very long audio
    if (throttle === 1 || chunkNum % throttle === 0 || chunkNum === totalChunks) {
      self.postMessage({
        type: 'progress',
        requestId,
        step: 'transcribe',
        chunk: chunkNum,
        totalChunks,
        message: `Transcribiendo... fragmento ${chunkNum} de ${totalChunks}`,
      });
    }

    // Graceful per-chunk: if one fails, continue with others
    const result = await transcriber(segment, options).catch(err => {
      console.warn(`Worker: chunk ${chunkNum} failed:`, err);
      failedChunks++;
      return { text: '', chunks: null };
    });

    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const text = result.text ? result.text.trim() : '';
    if (text) {
      fullText += (fullText ? ' ' : '') + text;
    }

    if (result.chunks) {
      const offset = i / 16000;
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

  if (failedChunks === totalChunks) {
    throw new Error('No se pudo procesar ningún fragmento de audio');
  }

  return { text: fullText, chunks: allChunks, failedChunks };
}
