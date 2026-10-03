const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('subtitle timestamps remain valid beyond one hour', () => {
  const { combineBatchTranscriptions, srtTime, vttTime } = require('../transcribir/format.js');

  assert.equal(srtTime(3661.25), '01:01:01,250');
  assert.equal(vttTime(3661.25), '01:01:01.250');
  assert.equal(vttTime(59.9999), '00:01:00.000');
  assert.equal(
    combineBatchTranscriptions([
      { name: 'uno.mp3', text: 'Primero' },
      { name: 'dos.ogg', text: 'Segundo' },
    ]),
    '## uno.mp3\n\nPrimero\n\n## dos.ogg\n\nSegundo',
  );
});

test('the UI does not offer the known-incompatible Spleeter model', () => {
  const page = fs.readFileSync(path.join(root, 'transcribir/index.html'), 'utf8');
  assert.doesNotMatch(page, /value="spleeter"/);
  assert.match(page, /<meta name="mobile-web-app-capable" content="yes">/);
});

test('worker pins the transformers.js v4 library on both CDN fallbacks', () => {
  const worker = fs.readFileSync(path.join(root, 'transcribir/worker.js'), 'utf8');
  const cdnUrls = worker.match(/https:\/\/[^'\s]+transformers[^'\s]*/g) || [];
  assert.ok(cdnUrls.length >= 2, 'expected jsdelivr + unpkg fallback URLs');
  for (const url of cdnUrls) {
    assert.match(url, /@huggingface\/transformers@4\.3\.0\/dist\/transformers\.min\.js/);
    assert.doesNotMatch(url, /@xenova/);
  }
});

test('model map uses onnx-community repos and pins q4f16 webgpu for turbo', () => {
  const worker = fs.readFileSync(path.join(root, 'transcribir/worker.js'), 'utf8');
  assert.match(worker, /tiny:\s*'onnx-community\/whisper-tiny'/);
  assert.match(worker, /base:\s*'onnx-community\/whisper-base'/);
  assert.match(worker, /small:\s*'onnx-community\/whisper-small'/);
  assert.match(worker, /turbo:\s*'onnx-community\/whisper-large-v3-turbo'/);

  const start = worker.indexOf('function loadModel(');
  const end = worker.indexOf('\n/* ─── Run transcription', start);
  const loadModel = worker.slice(start, end);
  // Without the dtype pin, a WebGPU load can fall back to fp16 (~1.6 GB fetch)
  assert.match(loadModel, /encoder_model:\s*'q4f16'/);
  assert.match(loadModel, /decoder_model_merged:\s*'q4f16'/);
  assert.match(loadModel, /device:\s*'webgpu'/);
  // Standard models must NOT force webgpu (they run on WASM)
  const turboOnly = loadModel.replace(/[\s\S]*TURBO_OPTS[\s\S]*$/, '');
  assert.doesNotMatch(turboOnly, /device:\s*'webgpu'/);
});

test('UI gates the turbo model by feature detection, not platform', () => {
  const page = fs.readFileSync(path.join(root, 'transcribir/index.html'), 'utf8');
  assert.match(page, /<option value="turbo"[^>]*>/);

  const script = fs.readFileSync(path.join(root, 'transcribir/script.js'), 'utf8');
  assert.match(script, /navigator\.gpu/);
  assert.match(script, /turbo:\s*'whisper-large-v3-turbo'/);
  // Restored settings must not land on a disabled (unsupported) option
  assert.match(script, /\.some\(\(?o\)?\s*=>\s*o\.value === s\.model && !o\.disabled\)/);
});

test('the offline shell includes every local runtime dependency', () => {
  const serviceWorker = fs.readFileSync(path.join(root, 'transcribir/sw.js'), 'utf8');

  for (const asset of ['./worker.js', './format.js', './debug.js']) {
    assert.match(serviceWorker, new RegExp(asset.replace('.', '\\.')));
  }
});

test('service-worker activation never deletes caches owned by other apps', () => {
  const serviceWorker = fs.readFileSync(path.join(root, 'transcribir/sw.js'), 'utf8');
  assert.match(serviceWorker, /k\.startsWith\('transcribir-'\)/);
});

test('diagnostic instrumentation is loaded by the page', () => {
  const page = fs.readFileSync(path.join(root, 'transcribir/index.html'), 'utf8');
  assert.match(page, /<script src="debug\.js"><\/script>/);
  assert.doesNotMatch(page, /navigator\.serviceWorker\.register/);
});

test('microphone setup releases its stream when recorder construction fails', () => {
  const script = fs.readFileSync(path.join(root, 'transcribir/script.js'), 'utf8');
  const start = script.indexOf('async function startRecording()');
  const end = script.indexOf('\nfunction stopRecording()', start);
  const implementation = script.slice(start, end);

  assert.match(implementation, /catch \(err\)[\s\S]*releaseMediaStream\(stream\)/);
  assert.match(implementation, /if \(document\.hidden\)/);
  assert.match(implementation, /requestId !== recordingRequestId/);
  assert.match(script, /mediaRecorder\.onerror[\s\S]*cancelRecording\(\)/);
  const batchStart = script.indexOf('async function transcribeSharedFiles');
  const batchEnd = script.indexOf('\n/* ─── In-app logging', batchStart);
  const batchImplementation = script.slice(batchStart, batchEnd);
  assert.match(batchImplementation, /cancelRecording\(\)/);
  assert.match(batchImplementation, /if \(files\.length > 1 && completed\.length\)/);
});

test('clipboard fallback treats execCommand false as a failure', () => {
  const script = fs.readFileSync(path.join(root, 'transcribir/script.js'), 'utf8');
  assert.match(script, /if \(!document\.execCommand\('copy'\)\) throw new Error/);
});

test('loading audio does not retain an unnecessary full PCM copy', () => {
  const script = fs.readFileSync(path.join(root, 'transcribir/script.js'), 'utf8');
  assert.doesNotMatch(script, /originalAudio/);
  assert.doesNotMatch(script, /uploadZone\.addEventListener\('click'/);
  assert.doesNotMatch(script, /setTimeout\(\(\) => applyUpdate/);
});

test('model loading does not remove cancellation before inference starts', () => {
  const script = fs.readFileSync(path.join(root, 'transcribir/script.js'), 'utf8');
  const start = script.indexOf("case 'model-loaded':");
  const end = script.indexOf("case 'progress':", start);
  assert.doesNotMatch(script.slice(start, end), /showCancelButton\(false\)/);
});

test('worker terminal messages identify the request they belong to', async () => {
  const source = fs.readFileSync(path.join(root, 'transcribir/worker.js'), 'utf8');
  const messages = [];
  let messageHandler;
  const context = {
    AbortController,
    DOMException,
    Float32Array,
    console: { ...console, warn() {} },
    setTimeout,
    self: {
      addEventListener(type, handler) {
        if (type === 'message') messageHandler = handler;
      },
      postMessage(message) {
        messages.push(message);
      },
      transformers: {
        async pipeline() {
          return async () => ({ text: 'ok', chunks: [] });
        },
      },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'worker.js' });

  await messageHandler({
    data: {
      type: 'transcribe',
      requestId: 17,
      audio: new Float32Array([0]),
      modelKey: 'tiny',
      options: {},
      chunkSize: 1,
    },
  });

  const terminal = messages.find((message) => message.type === 'result');
  assert.equal(terminal.requestId, 17);
});

test('worker reports an error when every audio fragment fails', async () => {
  const source = fs.readFileSync(path.join(root, 'transcribir/worker.js'), 'utf8');
  const messages = [];
  let messageHandler;
  const context = {
    AbortController,
    DOMException,
    Float32Array,
    console: { ...console, warn() {} },
    self: {
      addEventListener(type, handler) {
        if (type === 'message') messageHandler = handler;
      },
      postMessage(message) {
        messages.push(message);
      },
      transformers: {
        async pipeline() {
          return async () => { throw new Error('inference failed'); };
        },
      },
    },
  };
  vm.runInNewContext(source, context, { filename: 'worker.js' });

  await messageHandler({
    data: {
      type: 'transcribe',
      requestId: 23,
      audio: new Float32Array([0, 0]),
      modelKey: 'tiny',
      options: {},
      chunkSize: 1,
    },
  });

  const terminal = messages.find((message) => message.type === 'error');
  assert.equal(terminal.requestId, 23);
  assert.match(terminal.message, /ningún fragmento/);
});
