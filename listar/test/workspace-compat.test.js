// Purpose: verify the greenfield workspace coexists with a populated legacy installation.
// Responsibilities: cover legacy fixture preservation, interleaved legacy/new writers,
//   frozen snapshots, durable reopen, and aborts that write zero partial records.
// Rationale: first use must not corrupt, duplicate, or lose an existing populated installation.
// Fixtures: .wai/projects/listar/plans/2026-11-02-jams-8be1-workspace-guard-fixture-design.org
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { List, Item, Audio } from '../db.js';
import { loadSettings, saveSettings } from '../app-core.mjs';
import { captureItem, readWorkspace } from '../workspace.mjs';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

const workspaceDb = 'listar-workspace';
beforeEach(async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(workspaceDb);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Workspace database is still open during test reset.'));
  });
});

// A11 fixture: a populated legacy installation with every field shape the spec names.
async function seedLegacy() {
  const storage = memoryStorage();
  const settings = { language: 'en', model: 'base', saveAudio: false };
  assert.equal(saveSettings(storage, settings), true);
  const list = await List.add({ name: 'Compras', emoji: '🛒' });
  const audio = await Audio.add({ listId: list.id, transcript: 'leche y pan', model: 'whisper-tiny' });
  const milk = await Item.add({
    listId: list.id, label: 'Leche', text: 'leche entera', quantity: 2, unit: 'litros', order: 2,
    attributes: {
      brand: [{
        id: 'a-brand-1', role: 'observation',
        value: { type: 'brand', name: 'La Serenísima' },
        evidence: { source: 'user statement' },
      }],
    },
  });
  const bread = await Item.add({ listId: list.id, label: 'Pan', text: 'pan', done: true, order: 1, sourceAudioId: audio.id });
  const legacy = deepFreeze({
    list: await List.get(list.id),
    items: await Item.list(list.id),
    audio: await Audio.byList(list.id),
    settings: loadSettings(storage),
  });
  assert.deepEqual(legacy.items.map((item) => item.id), [bread.id, milk.id]);
  assert.equal(Object.hasOwn(bread, 'quantity'), false);
  assert.equal(Object.hasOwn(bread, 'unit'), false);
  return { storage, listId: list.id, legacy };
}

async function readLegacyById(legacy) {
  const items = [];
  for (const fixtureItem of legacy.items) items.push(await Item.get(fixtureItem.id));
  // The legacy guard legitimately bumps list.version on its own writes; identity lives in the other fields.
  const { version: _version, ...listRest } = await List.get(legacy.list.id);
  return { list: listRest, items, audio: await Audio.byList(legacy.list.id) };
}

test('A11: workspace captures preserve every legacy ID, absent optional field, attribute, evidence, order, setting and retained audio', async () => {
  const { storage, listId, legacy } = await seedLegacy();
  const pan = await captureItem('pan', 'capture-a', 0);

  // Interleave a legacy writer between workspace captures.
  const eggs = await Item.add({ listId, label: 'Huevos', text: 'huevos', order: 3 });
  const sal = await captureItem('sal', 'capture-b', 1);

  assert.deepEqual(await readLegacyById(legacy), {
    list: (({ version: _v, ...rest }) => rest)(structuredClone(legacy.list)),
    items: structuredClone(legacy.items),
    audio: structuredClone(legacy.audio),
  });
  assert.deepEqual(loadSettings(storage), legacy.settings);
  assert.equal((await Item.list(listId)).length, 3);
  assert.equal((await Item.get(eggs.id)).label, 'Huevos');

  const workspace = await readWorkspace();
  assert.equal(workspace.revision, 2);
  const byId = new Map(workspace.items.map((entry) => [entry.id, entry]));
  assert.deepEqual(byId.get('capture-a'), { ...pan, collectionId: null });
  assert.deepEqual(byId.get('capture-b'), { ...sal, collectionId: null });
  assert.ok(byId.get(eggs.id));
  assert.ok(workspace.collections.some((collection) => collection.id === legacy.list.id));
  for (const id of ['capture-a', 'capture-b']) {
    assert.equal(Object.hasOwn(byId.get(id), 'listId'), false);
    assert.equal(byId.get(id).done, false);
  }
});

test('frozen legacy fixture and held workspace snapshot stay unchanged through interleaved writes', async () => {
  const { legacy } = await seedLegacy();
  const heldSnapshot = await readWorkspace();
  const heldClone = structuredClone(heldSnapshot);
  const fixtureClone = structuredClone(legacy);

  await captureItem('pan', 'capture-c', 0);
  await Item.put({ ...(await Item.get(legacy.items[0].id)) });
  await captureItem('aceite', 'capture-d', 1);

  assert.deepEqual(heldSnapshot, heldClone);
  assert.equal(heldSnapshot.revision, 0);
  assert.deepEqual(await readLegacyById(legacy), {
    list: (({ version: _v, ...rest }) => rest)(fixtureClone.list),
    items: [structuredClone(legacy.items[0]), structuredClone(legacy.items[1])],
    audio: fixtureClone.audio,
  });
});

test('A15: stale capture aborts with zero partial records on workspace and legacy sides', async () => {
  const { listId, legacy } = await seedLegacy();
  const pan = await captureItem('pan', 'capture-e', 0);
  await assert.rejects(captureItem('leche', 'capture-f', 0));

  const workspace = await readWorkspace();
  assert.equal(workspace.revision, 1);
  assert.deepEqual(workspace.items.find((entry) => entry.id === 'capture-e'), { ...pan, collectionId: null });
  assert.equal(workspace.items.filter((entry) => !entry.listId && entry.id.startsWith('capture-')).length, 1);
  assert.equal((await Item.list(listId)).length, 2);
  assert.deepEqual((await readLegacyById(legacy)).items, structuredClone(legacy.items));
});

test('A01/A14: captured unassigned item survives reopen and identical retry returns the original item', async () => {
  const pan = await captureItem('pan', 'capture-g', 0);
  const reopened = await readWorkspace();
  assert.equal(reopened.revision, 1);
  assert.deepEqual(reopened.items.find((entry) => entry.id === 'capture-g'), { ...pan, collectionId: null });

  const retry = await captureItem('pan', 'capture-g', 0);
  assert.deepEqual(retry, pan);
  const afterRetry = await readWorkspace();
  assert.equal(afterRetry.revision, 1);
  assert.equal(afterRetry.items.filter((entry) => entry.id === 'capture-g').length, 1);
});
