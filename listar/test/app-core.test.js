import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { List, Item, Audio } from '../db.js';
import {
  createList, renameList, deleteList, toggleItem, deleteItem, clearDoneItems, saveAudioCapture, applyPreviewFields, createPreviewSubmission,
  makePreview, appendSelectedItems, decodeAudioToMono16k, transcribeWithWorker,
} from '../app-core.mjs';

test('list operations persist create, rename, delete and cascade items in IndexedDB', async () => {
  const list = await createList({ name: 'Compras', emoji: '🛒' });
  assert.equal((await List.get(list.id)).name, 'Compras');
  await renameList(list.id, { name: 'Mercado', emoji: '🥬' });
  const renamed = await List.get(list.id);
  assert.deepEqual({ name: renamed.name, emoji: renamed.emoji }, { name: 'Mercado', emoji: '🥬' });
  const item = await Item.add({ listId: list.id, label: 'pan', text: 'un pan' });
  await Audio.add({ listId: list.id, blob: new Blob(['audio']), transcript: 'un pan', model: 'tiny' });
  await deleteList(list.id);
  assert.equal(await List.get(list.id), undefined);
  assert.deepEqual(await Item.list(list.id), []);
  assert.equal(item.listId, list.id);
});

test('A10 list removal preserves items and audio, leaving them unassigned instead of erased', async () => {
  const list = await createList({ name: 'Compras', emoji: '🛒' });
  const pan = await Item.add({ listId: list.id, label: 'pan', text: 'un pan' });
  const leche = await Item.add({ listId: list.id, label: 'leche', text: 'dos litros' });
  const audio = await Audio.add({ listId: list.id, blob: new Blob(['audio']), transcript: 'pan y leche', model: 'tiny' });
  await deleteList(list.id);
  assert.equal(await List.get(list.id), undefined);
  assert.deepEqual(await Item.list(list.id), []);
  const items = await Item.all();
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const id of [pan.id, leche.id]) {
    assert.ok(byId.has(id), `item ${id} must survive list removal`);
    assert.ok(!Object.hasOwn(byId.get(id), 'listId'), `item ${id} must be unassigned`);
  }
  const audios = await Audio.byList(list.id);
  assert.equal(audios.length, 0);
  const storedAudio = await new Promise((resolve, reject) => {
    const request = indexedDB.open('listar');
    request.onsuccess = () => {
      const tx = request.result.transaction('audio', 'readonly');
      const getAll = tx.objectStore('audio').getAll();
      getAll.onsuccess = () => { request.result.close(); resolve(getAll.result); };
      getAll.onerror = () => reject(getAll.error);
    };
    request.onerror = () => reject(request.error);
  });
  const kept = storedAudio.find((record) => record.id === audio.id);
  assert.ok(kept, 'audio must survive list removal');
  assert.ok(!Object.hasOwn(kept, 'listId'), 'audio must be detached, not deleted');
});

test('item operations toggle, delete and clear completed rows in IndexedDB', async () => {
  const list = await List.add({ name: 'Tareas' });
  const first = await Item.add({ listId: list.id, label: 'leer' });
  const second = await Item.add({ listId: list.id, label: 'llamar' });
  await toggleItem(first.id, true);
  await deleteItem(second.id);
  assert.equal((await Item.list(list.id))[0].done, true);
  assert.equal(await clearDoneItems(list.id), 1);
  assert.deepEqual(await Item.list(list.id), []);
});

test('preview preserves split output fields and appends only selected edited rows once', async () => {
  const list = await List.add({ name: 'Compras' });
  const preview = makePreview('2 litros de leche y pan integral');
  assert.deepEqual(preview.map(({ label, text, quantity, unit, selected }) => ({ label, text, quantity, unit, selected })), [
    { label: 'leche', text: '2 litros de leche', quantity: 2, unit: 'litros', selected: true },
    { label: 'pan integral', text: 'pan integral', quantity: undefined, unit: undefined, selected: true },
  ]);
  preview[0].label = 'leche entera';
  preview[1].selected = false;
  const appended = await appendSelectedItems(list.id, preview);
  assert.equal(appended.length, 1);
  assert.deepEqual((await Item.list(list.id)).map(({ label, text, quantity, unit }) => ({ label, text, quantity, unit })), [
    { label: 'leche entera', text: '2 litros de leche', quantity: 2, unit: 'litros' },
  ]);
});

test('preview append uses one durable command receipt across an identical retry', async () => {
  const list = await List.add({ name: 'Compras' });
  const rows = [{ selected: true, label: 'leche', text: 'dos litros de leche', quantity: 2, unit: 'litros' }];
  const request = { operationId: 'preview-retry-1', commandTime: 5000 };
  const first = await appendSelectedItems(list.id, rows, 'audio-1', request);
  const replay = await appendSelectedItems(list.id, rows, 'audio-1', request);
  assert.deepEqual(replay, first);
  assert.equal((await Item.list(list.id)).length, 1);
  assert.equal((await List.get(list.id)).version, 1);
});

test('audio decode mixes channels and resamples to mono 16 kHz', async () => {
  const channels = [new Float32Array([0, 1, 0, -1]), new Float32Array([1, 0, -1, 0])];
  const buffer = {
    sampleRate: 32000,
    numberOfChannels: 2,
    length: 4,
    duration: 4 / 32000,
    getChannelData: (index) => channels[index],
  };
  class MockAudioContext {
    async decodeAudioData() { return buffer; }
    async close() {}
  }
  const decoded = await decodeAudioToMono16k(new Blob(['audio']), MockAudioContext);
  assert.equal(decoded.sampleRate, 16000);
  assert.equal(decoded.data.length, 2);
  assert.deepEqual([...decoded.data], [0.5, -0.5]);
});

test('worker bridge forwards progress and resolves the matching result or rejects errors', async () => {
  const worker = {
    listeners: new Set(),
    addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); },
    removeEventListener(type, listener) { this.listeners.delete(listener); },
    postMessage(message) {
      assert.equal(message.type, 'transcribe');
      assert.equal(message.modelKey, 'base');
      assert.deepEqual(message.options, { task: 'transcribe', language: 'en' });
      queueMicrotask(() => {
        for (const listener of this.listeners) listener({ data: { type: 'progress', requestId: message.requestId, message: 'Transcribiendo' } });
        for (const listener of this.listeners) listener({ data: { type: 'result', requestId: message.requestId, text: 'pan', empty: false } });
      });
    },
  };
  const progress = [];
  assert.equal((await transcribeWithWorker(worker, new Float32Array([0]), 'base', { task: 'transcribe', language: 'en' }, (message) => progress.push(message.message))).text, 'pan');
  assert.deepEqual(progress, ['Transcribiendo']);
});

test('audio capture metadata persists through the Audio store', async () => {
  const list = await List.add({ name: 'Audio test' });
  const capture = await saveAudioCapture(list.id, new Blob(['audio']), 'comprar pan', 'tiny');
  const records = await Audio.byList(list.id);
  assert.equal(records[0].id, capture.id);
  assert.equal(records[0].transcript, 'comprar pan');
  assert.equal(records[0].model, 'tiny');
});

test('preview form field order maps checkbox, label, quantity and unit correctly', () => {
  const item = { selected: true, label: 'leche', text: '2 litros de leche', quantity: 2, unit: 'litros' };
  assert.deepEqual(applyPreviewFields(item, [false, 'leche entera', '3', 'botellas']), {
    selected: false, label: 'leche entera', text: '2 litros de leche', quantity: 3, unit: 'botellas',
  });
});

test('empty decoded audio is rejected without producing invalid samples', async () => {
  class EmptyAudioContext {
    async decodeAudioData() {
      return { sampleRate: 48000, numberOfChannels: 1, length: 0, duration: 0, getChannelData: () => new Float32Array() };
    }
    async close() {}
  }
  await assert.rejects(decodeAudioToMono16k(new Blob(['empty']), EmptyAudioContext), /vacío/);
});

test('worker bridge rejects browser worker errors and removes its listeners', async () => {
  const listeners = new Map();
  const worker = {
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    postMessage() {},
  };
  const pending = transcribeWithWorker(worker, new Float32Array([0]), 'tiny');
  listeners.get('error')({ message: 'worker crash' });
  await assert.rejects(pending, /worker crash/);
  assert.equal(listeners.size, 0);
});

function fakeForm() {
  const listeners = new Set();
  return {
    addEventListener(type, listener) { if (type === 'submit') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'submit') listeners.delete(listener); },
    async submit() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      await Promise.all([...listeners].map((listener) => listener(event)));
      return event;
    },
  };
}

test('preview form submit event appends edited selected rows once and preserves raw phrase', async () => {
  const list = await List.add({ name: 'Preview form submit' });
  const draft = makePreview('2 litros de leche y pan integral');
  const form = fakeForm();
  let successCount = 0;
  const submission = createPreviewSubmission({
    form, getTargetId: () => list.id, getDraft: () => draft, getSourceAudioId: () => 'audio-preview-1',
    readFieldValues: () => [
      [true, 'leche entera', '3', 'botellas'],
      [false, 'pan integral', '1', 'barra'],
    ],
    onSuccess: () => { successCount++; },
  });
  const pendingSubmit = form.submit();
  assert.equal(submission.cancel(), false, 'cancel is refused while IndexedDB writes are in flight');
  const [first, second] = await Promise.all([pendingSubmit, form.submit()]);
  assert.equal(first.prevented, true);
  assert.equal(second.prevented, true);
  assert.equal(successCount, 1);
  assert.deepEqual((await Item.list(list.id)).map(({ label, text, quantity, unit, sourceAudioId }) => ({ label, text, quantity, unit, sourceAudioId })), [
    { label: 'leche entera', text: '2 litros de leche', quantity: 3, unit: 'botellas', sourceAudioId: 'audio-preview-1' },
  ]);
  assert.equal(submission.cancel(), false);
});

test('cancelled preview form submit causes no IndexedDB writes', async () => {
  const list = await List.add({ name: 'Preview cancel' });
  const form = fakeForm();
  const submission = createPreviewSubmission({
    form, getTargetId: () => list.id, getDraft: () => makePreview('comprar pan'),
    getSourceAudioId: () => undefined, readFieldValues: () => [[true, 'pan', '', '']],
  });
  assert.equal(submission.cancel(), true);
  await form.submit();
  assert.deepEqual(await Item.list(list.id), []);
});
