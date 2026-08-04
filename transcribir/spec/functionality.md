# Transcribir — Browser-Based Audio Transcription

## Purpose

Transcribe audio to text entirely in the browser using Whisper via transformers.js. No server, no file uploads, no API keys — everything runs locally on-device, even on a phone.

## Workflow

```
[Audio input] → [Decode + mix to mono + downsample to 16kHz] → [Chunk into 30s windows] → [Whisper sequentially] → [Texto or SRT/VTT]
```

Two input paths:
1. **File upload** — pick an audio file from the device (MP3, WAV, OGG, M4A, etc.)
2. **Microphone** — record audio directly in the browser, then transcribe

## Model Options

| Model | Size (ONNX) | Use case |
|-------|-------------|----------|
| `whisper-tiny` | ~40 MB | Fast, good on low-end phones, recommended for long audio |
| `whisper-base` | ~75 MB | Recommended balance |
| `whisper-small` | ~250 MB | Best accuracy, needs WebGPU |

Models are downloaded once from Hugging Face Hub, cached in IndexedDB.

## Language Support

Auto-detect or explicit selection: es, en, pt, fr, de, it, ca. Passed as the `language` option to the pipeline.

## Audio Processing

1. **Decode** — `AudioContext.decodeAudioData()` handles any format the browser supports
2. **Mono mix** — all channels averaged (instead of just taking channel 0), works with stereo recordings
3. **Resample** — `OfflineAudioContext` resamples to 16000 Hz (Whisper requirement)
4. **Chunk** — audio is split into 30-second windows and processed sequentially; bounds inference working memory, while the decoded source remains in memory
5. **Accumulate** — text and timestamped chunks from each segment are combined with offset correction

## Chunked Processing (Long Audio)

Audio files of any length are processed in 30-second chunks. Each chunk runs through the Whisper pipeline independently and results are concatenated:

```javascript
for (let i = 0; i < totalSamples; i += chunkSize) {
  const segment = audio.slice(i, i + chunkSize);
  const result = await transcriber(segment, options);
  // accumulate text and chunks with timestamp offset
}
```

This means:
- **Inference working memory is bounded** to one ~30s segment at a time; the decoded PCM for the full source remains in memory
- **Progress reporting** shows "fragmento 3 de 120"
- **Graceful degradation** — if one chunk fails, previous chunks' work is preserved
- Whisper-tiny on a phone processes roughly 30 seconds of audio in 2-5 seconds of inference

## Output Formats

Three formats selectable from a dropdown next to the copy/download buttons:

### TXT (Plain Text)
Single text block, no timestamps. Best for notes, summaries, quotes.

### SRT (SubRip)
```
1
00:00:01,200 --> 00:00:04,500
Buenos días, señores.

2
00:00:05,000 --> 00:00:08,300
Hoy vamos a revisar los números.
```

### VTT (WebVTT)
```
WEBVTT

01:02.300 --> 01:05.800
Esta es una transcripción.
```

If no timestamped chunks are available (very short audio), SRT/VTT fall back to displaying the plain text.

## Output

- Display transcription in a `<pre>` block
- **Format selector** — TXT / SRT / VTT
- **Copy to clipboard** button
- **Download as file** — filename derived from source with correct extension (.txt, .srt, .vtt)
- Source label in status: filename or "micrófono"
- Duration displayed in the file info badge

## States & Edge Cases

### Loading states
- **Model download:** progress percentage shown in overlay (0–100%)
- **Model loaded once:** subsequent transcriptions skip download — model stays in memory for the session
- **Model switch:** if user changes model (tiny → base), unloads old and loads new; shows loading overlay
- **Chunk progress:** shows "Transcribiendo... fragmento N de M" for long audio

### Empty states
- **No audio loaded:** Transcribe button disabled
- **No speech detected:** "⚠️ No se detectó contenido de audio" with guidance
- **First visit:** status bar hidden, only input + settings visible

### Warning states
- **Long audio warning (>25 min ~100 MB PCM):** banner warns about processing time and explains chunking

### Error states
- **File not decodable:** "Error al leer el archivo de audio"
- **Mic access denied:** "No se pudo acceder al micrófono"
- **Model load fails:** "Error al cargar el modelo: [message]"
- **Transcription fails:** "Error en la transcripción: [message]"
- Button re-enabled on failure so user can retry

### Recording edge cases
- **Switching tabs while recording:** stops automatically via `visibilitychange` listener
- **Double-tap record:** guard prevents starting a second recorder during `getUserMedia` negotiation
- **Transcription button disabled during transcription:** prevents concurrent runs
- **Very short recording (<1s):** may produce empty transcription; user sees the no-speech warning
- **Stereo mic streams:** all channels averaged to mono instead of discarding channels

## Technical Constraints

- **Vanilla JS** — no frameworks
- **CDN library:** `@xenova/transformers` v2.17.2 from jsDelivr (UMD build)
- **All computation client-side** — nothing sent over network except model download
- **Mobile-first** — dark theme, touch-friendly buttons, portrait-orientation PWA
- **Works offline after initial model load** — model is cached in IndexedDB by the library
- **Firefox support:** explicit `audio/ogg;codecs=opus` mimeType fallback for MediaRecorder
- **AudioContext properly closed:** `try/finally` ensures `audioCtx.close()` runs even on decode error

## PWA

- `manifest.json` with standalone display, dark background
- SVG icon (🎙️ emoji-based)
- Service worker **required** for Web Share Target and offline support
  - Precaches app shell (index.html, script.js, style.css, manifest.json, icon.svg)
  - Intercepts POST requests from Web Share Target, extracts audio files, stores in cache, redirects to main page
  - Page reads shared files from cache on load (`?shared=true`)

## Share Target (WhatsApp & other apps)

Users can share audio files from any app (WhatsApp, Telegram, Signal, Files) directly to Transcribir.

### How it works

1. **Web Share Target API** (`share_target` in manifest.json) registers Transcribir as a destination in the system share sheet
2. **Service worker** intercepts the `POST` request, extracts the audio file(s) from `multipart/form-data`, and stores them in a dedicated cache (`transcribir-shared-v5`)
3. **Redirect** to `./?shared=true` — the page reads files from cache, loads them, and cleans up
4. **LaunchQueue** handles warm starts — when the app is already open and the user shares another audio, `window.launchQueue.setConsumer()` receives the file directly

### Data flow

```
WhatsApp Share → System Share Sheet → Transcribir (installed PWA)
  → POST to start_url with multipart/form-data (audio file)
  → Service Worker intercepts → extracts file → stores in cache
  → Redirect to ./?shared=true
  → Page: reads file from cache → loadAudio() → transcription UI

  (if app is already open)
  → LaunchQueue fires → file handle → getFile() → loadAudio()
```

### Limitations

- **iOS Safari** does not support Web Share Target API — sharing from WhatsApp on iPhone won't show Transcribir as an option. Consider iOS Shortcuts as a workaround.
- The PWA must be **installed** (added to home screen) for share target to appear. Running in a browser tab won't work.
- Multiple files shared at once are processed sequentially.

### Service Worker

Located at `sw.js`. Responsibilities:

| Event | Behavior |
|-------|----------|
| `install` | Precaches all shell assets |
| `activate` | Prunes stale caches, claims clients |
| `fetch` | Cache-first for GET; intercepts POST for share target |

Caches:
- `transcribir-shell-v5` — static app shell (cache-first)
- `transcribir-shared-v5` — temporarily holds incoming shared files (cleared after ingestion)

### Manifest additions

```json
"share_target": {
  "action": "./",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "files": [
      { "name": "audio_files", "accept": ["audio/*"] }
    ]
  }
},
"file_handlers": [
  {
    "action": "./",
    "accept": {
      "audio/*": [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".wma", ".opus", ".webm"]
    }
  }
]
```

## Install Prompt

When the user visits the page on a supported browser, a `beforeinstallprompt` event fires. The app shows a subtle banner suggesting installation with the message:

> 📲 Instala Transcribir en tu pantalla de inicio para recibir audios desde WhatsApp y otras apps

If already installed (`display-mode: standalone`), the prompt is hidden automatically.

## Vocal Separation

Audio can be processed to isolate or enhance vocals before transcription. Located at `script.js` in the vocal separation section.

### Modes

| Mode | Description | Dependencies
|------|-------------|-------------|
| `none` | No enhancement — transcribe audio as-is | None |
| `hpf` | **High-pass filter** (~120 Hz cutoff). Removes sub-bass rumble, making voices clearer. Simple DSP, works on any audio. | None (built-in) |

The former experimental Spleeter option was removed because its ONNX model requires STFT preprocessing and a tensor contract that the browser implementation did not satisfy. It must not be exposed again without end-to-end model validation and tests.

## Diagnostics

- `debug.js` captures console output, uncaught errors, UI actions, network lifecycle, and service-worker messages.
- Diagnostics activate only when the local HTTPS collector advertises support; ordinary static servers and production deployments stay silent.
- Use `just serve-ssl` and export the in-app event log from **Cómo usar** when troubleshooting a device.

## Future Considerations

- **Translate mode:** Whisper can also translate to English — add as option alongside transcribe
- **Larger models with WebGPU:** `whisper-medium` (~700 MB) if device supports enough heap
- **Streaming mic transcription:** process audio as it's being recorded (requires incremental Whisper, not supported by transformers.js yet)

## Data Flow

```
User input (File | MediaRecorder Blob)
  → ArrayBuffer
  → AudioContext.decodeAudioData()
  → Float32Array (all channels averaged to mono, original sample rate)
  → OfflineAudioContext resample to 16000
  → Float32Array (16000 Hz mono, full duration in RAM)
  → [Optional] voice enhancement (high-pass filter)
  → Chunk into 30s windows
  → For each chunk: transformers.js pipeline('automatic-speech-recognition')
    → { text: string, chunks: [{ text, timestamp }] }
  → Accumulate text + chunks (with timestamp offset)
  → Render in selected format (TXT / SRT / VTT)
  → Display + copy/download
```
