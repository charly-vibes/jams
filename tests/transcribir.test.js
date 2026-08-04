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
