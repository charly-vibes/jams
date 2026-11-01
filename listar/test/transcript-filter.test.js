import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTranscript } from '../transcript-filter.mjs';

test('drops silence and short Whisper hallucination fragments', () => {
  const result = filterTranscript({
    text: 'Gracias por ver el video',
    chunks: [
      { text: 'Gracias por ver el video', timestamp: [0, 2], score: 0.1 },
      { text: 'sí', timestamp: [2, 2.4] },
    ],
  });
  assert.deepEqual(result, {
    text: '', chunks: [], dropped: 2, droppedSegments: [
      { text: 'Gracias por ver el video', timestamp: [0, 2], score: 0.1, reason: 'low-confidence' },
      { text: 'sí', timestamp: [2, 2.4], reason: 'short-segment' },
    ], empty: true,
  });
});

test('keeps plausible segments and attributes survivors to source timestamps', () => {
  const result = filterTranscript({
    text: 'comprar leche pan',
    chunks: [
      { text: 'comprar leche', timestamp: [0, 1.2] },
      { text: 'eh', timestamp: [1.2, 1.4] },
      { text: 'pan integral', timestamp: [3, 4], score: 0.8 },
    ],
  });
  assert.deepEqual(result, {
    text: 'comprar leche pan integral',
    chunks: [
      { text: 'comprar leche', timestamp: [0, 1.2] },
      { text: 'pan integral', timestamp: [3, 4], score: 0.8 },
    ],
    dropped: 1,
    droppedSegments: [{ text: 'eh', timestamp: [1.2, 1.4], reason: 'short-segment' }],
    empty: false,
  });
});

test('drops low-confidence segments when confidence is available', () => {
  const result = filterTranscript({
    text: 'comprar pan y leche',
    chunks: [
      { text: 'comprar pan', timestamp: [0, 1], score: 0.9 },
      { text: 'y leche', timestamp: [1, 2], score: 0.1 },
    ],
  });
  assert.equal(result.text, 'comprar pan');
  assert.deepEqual(result.chunks.map(({ timestamp }) => timestamp), [[0, 1]]);
  assert.deepEqual(result.droppedSegments, [
    { text: 'y leche', timestamp: [1, 2], score: 0.1, reason: 'low-confidence' },
  ]);
});

test('falls back to transcript text when Whisper has no segment metadata', () => {
  assert.deepEqual(filterTranscript({ text: 'comprar arroz integral', chunks: [] }), {
    text: 'comprar arroz integral', chunks: [], dropped: 0, droppedSegments: [], empty: false,
  });
});

test('retains long unscored hallucination text because lexical guessing is out of scope', () => {
  const result = filterTranscript({
    text: 'Gracias por ver el video',
    chunks: [{ text: 'Gracias por ver el video', timestamp: [0, 2] }],
  });
  assert.equal(result.text, 'Gracias por ver el video');
  assert.deepEqual(result.droppedSegments, []);
});

test('worker sends filtered transcript results and keeps chunk confidence/timestamps', async () => {
  const messages = [];
  let messageHandler;
  globalThis.self = {
    addEventListener(type, handler) {
      if (type === 'message') messageHandler = handler;
    },
    postMessage(message) { messages.push(message); },
    transformers: {
      async pipeline() {
        return async () => ({
          text: 'comprar leche sí',
          chunks: [
            { text: 'comprar leche', timestamp: [0, 1], score: 0.9 },
            { text: 'sí', timestamp: [1, 1.2], score: 0.1 },
          ],
        });
      },
    },
  };
  await import('../worker.js?filtered-result');
  await messageHandler({ data: {
    type: 'transcribe', requestId: 73, audio: new Float32Array([0]),
    modelKey: 'tiny', options: {}, chunkSize: 1,
  } });
  const result = messages.find(({ type }) => type === 'result');
  assert.equal(result.requestId, 73);
  assert.equal(result.text, 'comprar leche');
  assert.deepEqual(result.chunks.map(({ timestamp }) => timestamp), [[0, 1]]);
  assert.equal(result.chunks[0].score, 0.9);
  delete globalThis.self;
});

test('silence with no decoded words produces the explicit empty state', () => {
  assert.deepEqual(filterTranscript({ text: '', chunks: [] }), {
    text: '', chunks: [], dropped: 0, droppedSegments: [], empty: true,
  });
});

test('an empty audio buffer produces an empty result instead of a processing error', async () => {
  const messages = [];
  let messageHandler;
  globalThis.self = {
    addEventListener(type, handler) {
      if (type === 'message') messageHandler = handler;
    },
    postMessage(message) { messages.push(message); },
    transformers: {
      async pipeline() { return async () => ({ text: '', chunks: [] }); },
    },
  };
  await import('../worker.js?empty-audio');
  await messageHandler({ data: {
    type: 'transcribe', requestId: 74, audio: new Float32Array(0),
    modelKey: 'tiny', options: {},
  } });
  const result = messages.find(({ type }) => type === 'result');
  assert.equal(result.empty, true);
  assert.equal(result.text, '');
  assert.equal(messages.some(({ type }) => type === 'error'), false);
  delete globalThis.self;
});
