import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { attachDebugInteractionListeners, createDebugLogger, DEBUG_OPTIONS_KEY, setDebugLoggerForTests } from '../debug.mjs';
import { DB_NAME, List, Item, readSnapshot, commitCommands } from '../db.js';
import { transcribeWithWorker } from '../app-core.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

async function resetDatabase() {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('database unexpectedly blocked'));
  });
}

test('debug logging and text capture are separate, default off, and redact text by default', () => {
  const storage = memoryStorage();
  const logger = createDebugLogger({ storage, sessionId: 'session-test' });
  logger.record('capture.transcript', { transcript: 'comprar leche', label: 'leche', source: 'comprar leche', audioBuffer: new Float32Array([1, 2]) });
  assert.deepEqual(logger.export().events, []);
  logger.configure({ enabled: true });
  logger.record('capture.transcript', { transcript: 'comprar leche', label: 'leche', source: 'comprar leche', sampleCount: 22, audioBuffer: new Float32Array([1, 2]) }, { requestId: 2 });
  let exported = logger.export();
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.environment.app, 'Listar');
  assert.equal(exported.events[0].sessionId, 'session-test');
  assert.equal(exported.events[0].fields.transcript, '[redacted]');
  assert.equal(exported.events[0].fields.label, '[redacted]');
  assert.equal(exported.events[0].requestId, 2);
  assert.equal(exported.events[0].fields.source, '[redacted]');
  assert.equal(exported.events[0].fields.sampleCount, 22);
  assert.equal(exported.events[0].fields.audioBuffer, '[omitted]');
  logger.configure({ enabled: true, captureText: true });
  logger.record('capture.transcript', { transcript: 'texto autorizado' });
  assert.equal(logger.export().events[1].fields.transcript, 'texto autorizado');
  logger.configure({ enabled: true, captureText: false });
  assert.equal(logger.export().events[1].fields.transcript, '[redacted]');
  logger.configure({ enabled: false, captureText: true });
  const writes = storage.values.get('listar-debug-log');
  logger.record('ui.click', { action: 'clear' });
  assert.equal(storage.values.get('listar-debug-log'), writes, 'disable prevents new persistent writes');
  assert.equal(JSON.parse(storage.values.get(DEBUG_OPTIONS_KEY)).captureText, true);
});

test('debug log bounds event count and bytes, tracks dropped events, and clears/disposes safely', () => {
  const storage = memoryStorage();
  const logger = createDebugLogger({ storage, maxEvents: 2, maxBytes: 1800, sessionId: 'bounded' });
  logger.configure({ enabled: true });
  logger.record('ui.one', { count: 1 });
  logger.record('ui.two', { count: 2 });
  logger.record('ui.three', { count: 3 });
  const exported = logger.export();
  assert.ok(exported.events.length <= 2);
  assert.ok(exported.droppedEventCount >= 1);
  assert.deepEqual(exported.events.map(({ fields }) => fields.count), [2, 3]);
  logger.clear();
  assert.deepEqual(logger.export().events, []);
  assert.equal(logger.dispose(), true);
  logger.record('ui.after-dispose');
  assert.equal(logger.export().events.length, 0);
  assert.equal(logger.dispose(), false);
});

test('serialized storage never exceeds the byte cap and oversized events count as dropped', () => {
  const storage = memoryStorage();
  const logger = createDebugLogger({ storage, maxBytes: 360 });
  logger.configure({ enabled: true, captureText: true });
  logger.record('capture.transcript', { transcript: 'x'.repeat(500) });
  const serialized = storage.values.get('listar-debug-log');
  assert.ok(new TextEncoder().encode(serialized).length <= 360);
  assert.deepEqual(logger.export().events, []);
  assert.equal(logger.export().droppedEventCount, 1);
});

test('storage failures never escape the diagnostics API', () => {
  const brokenStorage = {
    getItem() { throw new Error('storage denied'); },
    setItem() { throw new Error('storage denied'); },
    removeItem() { throw new Error('storage denied'); },
  };
  const logger = createDebugLogger({ storage: brokenStorage });
  assert.doesNotThrow(() => logger.configure({ enabled: true }));
  assert.doesNotThrow(() => logger.record('db.error', { errorName: 'QuotaExceededError' }));
  assert.equal(logger.export().events.length, 1, 'in-memory logging remains available when persistent storage fails');
  assert.doesNotThrow(() => logger.clear());
  assert.deepEqual(logger.export().events, []);
});

test('binary values are omitted by type under neutral keys even when text capture is enabled', () => {
  const storage = memoryStorage();
  const logger = createDebugLogger({ storage });
  logger.configure({ enabled: true, captureText: true });
  const binary = [
    new Blob(['audio bytes']), new ArrayBuffer(8), new DataView(new ArrayBuffer(8)), new Float32Array([0.1, 0.2]),
  ];
  if (typeof File !== 'undefined') binary.push(new File(['audio bytes'], 'private-name.wav', { type: 'audio/wav' }));
  logger.record('test.binary', { data: binary });
  const fields = logger.export().events[0].fields;
  for (const value of Object.values(fields.data)) assert.equal(value, '[omitted]');
  assert.doesNotMatch(JSON.stringify(logger.export()), /audio bytes|private-name\.wav/u);
});

test('document interaction hooks keep stable descriptors and include values only with text opt-in', () => {
  const logger = createDebugLogger({ storage: memoryStorage(), sessionId: 'dom-events' });
  logger.configure({ enabled: true });
  const restoreLogger = setDebugLoggerForTests(logger);
  const registered = new Map();
  const documentObject = {
    addEventListener(type, handler) { registered.set(type, handler); },
    removeEventListener(type) { registered.delete(type); },
  };
  const dispose = attachDebugInteractionListeners(documentObject);
  const target = (id, tagName, type, value, extras = {}) => ({
    id, tagName, type, value, textContent: 'private content', ariaLabel: 'private accessible label',
    closest() { return this; }, ...extras,
  });
  try {
    registered.get('click')({ type: 'click', target: target('record-button', 'BUTTON', 'button') });
    registered.get('input')({ type: 'input', target: target('preview-label', 'INPUT', 'text', 'private edited milk') });
    registered.get('change')({ type: 'change', target: target(undefined, 'INPUT', 'checkbox', 'on', { checked: true, dataset: { debugTarget: 'item-toggle' } }) });
    registered.get('submit')({ type: 'submit', target: target('preview-form', 'FORM', undefined, undefined) });
    let events = logger.export().events;
    assert.equal(events.length, 4);
    assert.equal(events[0].fields.targetId, 'record-button');
    assert.equal(Object.hasOwn(events[1].fields, 'value'), false, 'input values are omitted unless text capture is opted in');
    assert.equal(events[2].fields.targetId, 'item-toggle');
    assert.equal(Object.hasOwn(events[2].fields, 'checked'), false);
    assert.doesNotMatch(JSON.stringify(events), /private content|private accessible label|private edited milk/u);
    logger.configure({ enabled: true, captureText: true });
    registered.get('input')({ type: 'input', target: target('preview-label', 'INPUT', 'text', 'edited value opted in') });
    registered.get('change')({ type: 'change', target: target(undefined, 'INPUT', 'checkbox', 'on', { checked: false, dataset: { debugTarget: 'item-toggle' } }) });
    events = logger.export().events;
    assert.equal(events[4].fields.value, 'edited value opted in');
    assert.equal(events[5].fields.checked, false);
    assert.doesNotMatch(JSON.stringify(events), /private content|private accessible label/u);
    registered.get('change')({ type: 'change', target: target('debug-text-setting', 'INPUT', 'checkbox', 'on', { checked: false }) });
    events = logger.export().events;
    assert.equal(Object.hasOwn(events.at(-1).fields, 'checked'), false, 'turning text capture off immediately stops value capture');
    const eventCount = events.length;
    registered.get('change')({ type: 'change', target: target('debug-log-setting', 'INPUT', 'checkbox', 'on', { checked: false }) });
    assert.equal(logger.export().events.length, eventCount, 'turning logging off writes no final interaction event');
    assert.equal(dispose(), true);
    assert.equal(registered.size, 0);
  } finally { restoreLogger(); }
});

test('real IndexedDB CRUD transactions emit metadata-only debug events', async () => {
  await resetDatabase();
  const storage = memoryStorage();
  const logger = createDebugLogger({ storage, sessionId: 'db-integration' });
  logger.configure({ enabled: true });
  const restoreLogger = setDebugLoggerForTests(logger);
  try {
    const list = await List.add({ name: 'Sensitive list title' });
    await Item.add({ listId: list.id, label: 'Sensitive item title', text: 'private phrase' });
    const snapshot = await readSnapshot(list.id);
    const commands = [{ intent: 'add', item: { id: 'debug-item', listId: list.id, label: 'private append' } }];
    await commitCommands({ snapshot, commands, operationId: 'debug-operation' });
    await commitCommands({ snapshot, commands, operationId: 'debug-operation' });
    await assert.rejects(commitCommands({
      snapshot,
      commands: [{ intent: 'add', item: { id: 'stale-item', listId: list.id, label: 'stale private append' } }],
      operationId: 'debug-stale-operation',
    }), { code: 'stale-snapshot' });
    const events = logger.export().events;
    assert.ok(events.some(({ name, fields }) => name === 'db.transaction.complete' && fields.mode === 'readwrite'));
    assert.ok(events.some(({ name, operationId }) => name === 'commit.complete' && operationId === 'debug-operation'));
    assert.ok(events.some(({ name, operationId, fields }) => name === 'commit.replay' && operationId === 'debug-operation' && fields.retryCount === 1));
    assert.ok(events.some(({ name, operationId }) => name === 'commit.stale' && operationId === 'debug-stale-operation'));
    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, /Sensitive list title|Sensitive item title|private phrase|private append|stale private append/u);
  } finally {
    restoreLogger();
  }
});

test('an actual IndexedDB open failure is recorded without its message or rejecting diagnostics', async () => {
  const logger = createDebugLogger({ storage: memoryStorage(), sessionId: 'db-open-failure' });
  logger.configure({ enabled: true });
  const restoreLogger = setDebugLoggerForTests(logger);
  const previousIndexedDB = globalThis.indexedDB;
  globalThis.indexedDB = { open() { throw new TypeError('private database detail'); } };
  try {
    await assert.rejects(List.all(), /private database detail/u);
    const events = logger.export().events;
    assert.ok(events.some(({ name, fields }) => name === 'db.open.error' && fields.errorName === 'TypeError'));
    assert.doesNotMatch(JSON.stringify(events), /private database detail/u);
  } finally {
    globalThis.indexedDB = previousIndexedDB;
    restoreLogger();
  }
});

test('actual worker message/progress/error listeners emit correlated debug events', async () => {
  const storage = memoryStorage();
  const logger = createDebugLogger({ storage, sessionId: 'worker-integration' });
  logger.configure({ enabled: true });
  const restoreLogger = setDebugLoggerForTests(logger);
  const listeners = new Map();
  const worker = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    postMessage(message) {
      if (message.type !== 'transcribe') return;
      queueMicrotask(() => {
        listeners.get('message')?.({ data: { type: 'progress', requestId: message.requestId, step: 'download', message: '25%' } });
        listeners.get('message')?.({ data: { type: 'error', requestId: message.requestId, message: 'No se pudo leer leche privada' } });
      });
    },
  };
  try {
    await assert.rejects(transcribeWithWorker(worker, new Float32Array([0.1]), 'tiny'), /No se pudo leer leche privada/u);
    const events = logger.export().events;
    assert.ok(events.some(({ name }) => name === 'worker.request'));
    assert.ok(events.some(({ name }) => name === 'worker.progress'));
    assert.ok(events.some(({ name }) => name === 'worker.error'));
    assert.ok(Number.isSafeInteger(events.find(({ name }) => name === 'worker.request').requestId));
    assert.equal(events.find(({ name }) => name === 'worker.progress').fields.phase, 'download');
    assert.ok(events.every(({ timestamp, sequence }) => typeof timestamp === 'string' && Number.isInteger(sequence)));
    assert.equal(events.find(({ name }) => name === 'worker.error').fields.message, '[redacted]');
    assert.equal(new Set(events.map(({ correlationId }) => correlationId)).size, 1);
    assert.doesNotMatch(JSON.stringify(events), /leche privada/u);
    assert.equal(listeners.size, 0);
    logger.configure({ enabled: true, captureText: true });
    await assert.rejects(transcribeWithWorker(worker, new Float32Array([0.1]), 'tiny'), /No se pudo leer leche privada/u);
    assert.equal(logger.export().events.filter(({ name }) => name === 'worker.error').at(-1).fields.message, 'No se pudo leer leche privada');
  } finally {
    restoreLogger();
  }
});

test('worker result events record chunk counts but never transcript or chunk text', async () => {
  const logger = createDebugLogger({ storage: memoryStorage(), sessionId: 'worker-result' });
  logger.configure({ enabled: true });
  const restoreLogger = setDebugLoggerForTests(logger);
  const listeners = new Map();
  const worker = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    postMessage(message) {
      queueMicrotask(() => listeners.get('message')?.({ data: {
        type: 'result', requestId: message.requestId, text: 'dictado privado',
        chunks: [{ text: 'fragmento privado', timestamp: 1 }],
      } }));
    },
  };
  try {
    const result = await transcribeWithWorker(worker, new Float32Array([0.1]), 'tiny');
    assert.equal(result.chunks.length, 1);
    const exported = logger.export();
    const resultEvent = exported.events.find(({ name }) => name === 'worker.result');
    assert.equal(resultEvent.fields.segmentCount, 1);
    assert.doesNotMatch(JSON.stringify(exported), /dictado privado|fragmento privado/u);
    assert.equal(listeners.size, 0);
  } finally {
    restoreLogger();
  }
});
