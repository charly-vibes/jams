import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { List, Item, Audio } from '../db.js';
import {
  DEFAULT_SETTINGS, loadSettings, saveSettings, saveAudioCapture, clearAudioForList,
  formatListExport, copyText, shareOrCopy, makePreview, appendSelectedItems,
} from '../app-core.mjs';

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key); },
  };
}

test('settings default safely and persist only validated language/model/retention values', () => {
  const storage = makeStorage();
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  assert.equal(saveSettings(storage, { language: 'en', model: 'base', saveAudio: false }), true);
  assert.deepEqual(loadSettings(storage), { language: 'en', model: 'base', saveAudio: false });
  storage.setItem('listar-settings', JSON.stringify({ language: 'bogus', model: 'missing', saveAudio: 'no' }));
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  const failingStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadSettings(failingStorage), DEFAULT_SETTINGS);
  assert.equal(saveSettings(failingStorage, DEFAULT_SETTINGS), false);
});

test('audio retention defaults on and off persists no captured blob or record', async () => {
  const list = await List.add({ name: 'Retention on' });
  const kept = await saveAudioCapture(list.id, new Blob(['kept']), 'pan', 'tiny', true);
  assert.equal((await Audio.byList(list.id))[0].id, kept.id);
  const noRetention = await List.add({ name: 'Retention off' });
  assert.equal(await saveAudioCapture(noRetention.id, new Blob(['discard']), 'leche', 'tiny', false), null);
  assert.deepEqual(await Audio.byList(noRetention.id), []);
});

test('clear audio removes every capture for one list and leaves other lists untouched', async () => {
  const first = await List.add({ name: 'Clear A' });
  const second = await List.add({ name: 'Keep B' });
  await saveAudioCapture(first.id, new Blob(['a1']), 'pan', 'tiny', true);
  await saveAudioCapture(first.id, new Blob(['a2']), 'leche', 'tiny', true);
  await saveAudioCapture(second.id, new Blob(['b']), 'arroz', 'base', true);
  assert.equal(await clearAudioForList(first.id), 2);
  assert.deepEqual(await Audio.byList(first.id), []);
  assert.equal((await Audio.byList(second.id)).length, 1);
});

test('plain text export keeps completion status and formats quantities/units', () => {
  assert.equal(formatListExport([
    { label: 'leche', quantity: 2, unit: 'litros', done: false },
    { label: 'pan', done: true },
  ]), '☐ leche ×2 litros\n✓ pan');
  assert.equal(formatListExport([]), '');
});

test('copy helper falls back to a temporary textarea and reports execCommand failure', async () => {
  let copied = '';
  let removed = false;
  const textarea = { value: '', style: {}, setAttribute() {}, select() {}, remove() { removed = true; } };
  const document = {
    createElement(tag) { assert.equal(tag, 'textarea'); return textarea; },
    body: { appendChild(node) { assert.equal(node, textarea); } },
    execCommand(command) { assert.equal(command, 'copy'); copied = textarea.value; return true; },
  };
  await copyText('lista de compras', { clipboard: { writeText: async () => { throw new Error('blocked'); } }, document });
  assert.equal(copied, 'lista de compras');
  assert.equal(removed, true);
  await assert.rejects(copyText('fallo', { clipboard: null, document: { ...document, execCommand: () => false } }), /copi/);
});

test('export shares when available and falls back to clipboard when share is absent or fails', async () => {
  const outcomes = [];
  assert.equal(await shareOrCopy('lista', {
    navigator: { share: async (payload) => outcomes.push(payload.text) },
    copy: async () => outcomes.push('copied'),
  }), 'shared');
  assert.equal(await shareOrCopy('lista', {
    navigator: {}, copy: async () => outcomes.push('copied'),
  }), 'copied');
  assert.equal(await shareOrCopy('lista', {
    navigator: { share: async () => { throw new Error('share unavailable'); } },
    copy: async () => outcomes.push('fallback'),
  }), 'copied');
  assert.deepEqual(outcomes, ['lista', 'copied', 'fallback']);
});

test('share cancellation remains cancellation and never falls back to copy', async () => {
  let copied = false;
  const result = await shareOrCopy('lista', {
    navigator: { share: async () => { throw new DOMException('aborted', 'AbortError'); } },
    copy: async () => { copied = true; },
  });
  assert.equal(result, 'cancelled');
  assert.equal(copied, false);
});

test('retention off still reaches preview append without an audio source ID', async () => {
  const list = await List.add({ name: 'No audio retention flow' });
  const audio = await saveAudioCapture(list.id, new Blob(['discard']), 'comprar arroz', 'tiny', false);
  const sourceAudioId = audio?.id ?? null;
  const preview = makePreview('comprar arroz');
  const appended = await appendSelectedItems(list.id, preview, sourceAudioId);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].sourceAudioId, null);
  assert.equal((await Item.list(list.id))[0].label, 'comprar arroz');
  assert.deepEqual(await Audio.byList(list.id), []);
});
