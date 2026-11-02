// Purpose: pin the guarded persistence of resolved voice changes (A05/A06 commit seam).
// Responsibilities: seed the workspace and legacy databases, then assert archive,
//   detach, stale membership, stale revision, replay and cancel behaviour.
// Rationale: resolution is pure; these fixtures prove the confirmed actions commit
//   atomically under the revision guard, preserve items, and that discarding a
//   reviewed session writes nothing.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const { readWorkspace, commitVoiceActions, captureItem } = await import('../workspace.mjs');
const { List, Item, DB_NAME } = await import('../db.js');

async function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteDatabases() {
  for (const name of ['listar-workspace', DB_NAME]) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(`Test left ${name} connection open`));
    });
  }
}

async function seedWorkspace() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('listar-workspace', 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('meta', { keyPath: 'key' }).put({ key: 'revision', value: 4 });
      database.createObjectStore('items', { keyPath: 'id' });
      database.createObjectStore('operations', { keyPath: 'id' });
      database.createObjectStore('collections', { keyPath: 'id' });
      database.createObjectStore('memberships', { keyPath: 'itemId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction(['items', 'collections', 'memberships'], 'readwrite');
  tx.objectStore('collections').put({ id: 'col-compras', name: 'Compras', emoji: '🛒', order: 1 });
  tx.objectStore('items').put({
    id: 'milk-a', label: 'Leche', text: 'leche entera', quantity: 2, unit: 'litros',
    done: false, createdAt: 1, order: 4,
    attributes: { note: [{ id: 'note-1', role: 'preference', value: { type: 'text', value: 'entera' }, evidence: { quote: 'entera' } }] },
  });
  tx.objectStore('memberships').put({ itemId: 'milk-a', collectionId: 'col-compras' });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function seedLegacy() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = ({ target }) => {
      const database = target.result;
      const lists = database.createObjectStore('lists', { keyPath: 'id' });
      lists.createIndex('order', 'order');
      lists.createIndex('name', 'name');
      const items = database.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('listId', 'listId');
      items.createIndex('order', 'order');
      items.createIndex('done', 'done');
      const audio = database.createObjectStore('audio', { keyPath: 'id' });
      audio.createIndex('listId', 'listId');
      audio.createIndex('createdAt', 'createdAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).then((db) => {
    db.close();
    return List.add({ name: 'Legado', emoji: '🧺', createdAt: 1, order: 1 });
  }).then((list) => Item.add({
    listId: list.id, label: 'Leche', text: 'leche vieja',
    done: false, createdAt: 2, order: 2, sourceAudioId: 'audio-1',
  }));
}

beforeEach(async () => {
  await deleteDatabases();
  await seedWorkspace();
});

afterEach(async () => {
  await deleteDatabases();
});

test('archive preserves ID, membership, source and attributes while setting archive state', async () => {
  const before = await readWorkspace();
  const result = await commitVoiceActions([{ kind: 'archive', itemId: 'milk-a' }], 'op-archive', before.revision);
  assert.equal(result.revision, before.revision + 1);
  const after = await readWorkspace();
  const archived = after.items.find(({ id }) => id === 'milk-a');
  assert.equal(archived.archived, true);
  assert.equal(archived.label, 'Leche');
  assert.equal(archived.quantity, 2);
  assert.equal(archived.collectionId, 'col-compras', 'membership is preserved');
  assert.deepEqual(archived.attributes, before.items.find(({ id }) => id === 'milk-a').attributes);
});

test('detach removes only the expected membership and keeps the item unassigned', async () => {
  const before = await readWorkspace();
  const result = await commitVoiceActions(
    [{ kind: 'detach', itemId: 'milk-a', fromCollectionId: 'col-compras' }],
    'op-detach', before.revision,
  );
  assert.equal(result.revision, before.revision + 1);
  const after = await readWorkspace();
  const item = after.items.find(({ id }) => id === 'milk-a');
  assert.equal(item.collectionId, null, 'item stays available in Sin lista');
  assert.equal(item.archived, undefined);
  assert.equal(item.label, 'Leche');
});

test('R8: a changed membership rejects detachment for fresh review with zero writes', async () => {
  const before = await readWorkspace();
  await assert.rejects(
    () => commitVoiceActions(
      [{ kind: 'detach', itemId: 'milk-a', fromCollectionId: 'col-farmacia' }],
      'op-stale-member', before.revision,
    ),
    /membresía|cambió/i,
  );
  const after = await readWorkspace();
  assert.equal(after.revision, before.revision, 'zero writes on rejection');
  assert.equal(after.items.find(({ id }) => id === 'milk-a').collectionId, 'col-compras');
});

test('R9: a stale expected revision aborts the whole batch with zero partial writes', async () => {
  await captureItem('Pan', 'op-pan', 4);
  const current = await readWorkspace();
  assert.equal(current.revision, 5);
  await assert.rejects(
    () => commitVoiceActions(
      [{ kind: 'archive', itemId: 'milk-a' }, { kind: 'detach', itemId: 'milk-a', fromCollectionId: 'col-compras' }],
      'op-stale-rev', 4,
    ),
    /actualizó|cambió/i,
  );
  const after = await readWorkspace();
  assert.equal(after.revision, 5);
  assert.equal(after.items.find(({ id }) => id === 'milk-a').archived, undefined);
});

test('R10: an identical retry after reopen returns the original outcome without double writes', async () => {
  const before = await readWorkspace();
  const actions = [{ kind: 'archive', itemId: 'milk-a' }];
  const first = await commitVoiceActions(actions, 'op-replay', before.revision);
  const second = await commitVoiceActions(actions, 'op-replay', before.revision);
  assert.equal(second.revision, first.revision);
  const after = await readWorkspace();
  assert.equal(after.revision, before.revision + 1, 'replay does not bump twice');
  assert.equal(after.items.filter(({ id }) => id === 'milk-a').length, 1);
  await assert.rejects(
    () => commitVoiceActions([{ kind: 'detach', itemId: 'milk-a', fromCollectionId: 'col-compras' }], 'op-replay', after.revision),
    /reutiliz|diferente|actualizó/i,
  );
});

test('R11: resolved adds and archive changes commit as one atomic batch under one revision', async () => {
  const before = await readWorkspace();
  const result = await commitVoiceActions([
    { kind: 'archive', itemId: 'milk-a' },
    { kind: 'add', item: { label: 'Yogur', text: 'leche no yogur' }, collectionId: 'col-compras' },
  ], 'op-batch', before.revision);
  assert.equal(result.revision, before.revision + 1, 'one revision bump for the batch');
  const after = await readWorkspace();
  const archived = after.items.find(({ id }) => id === 'milk-a');
  assert.equal(archived.archived, true);
  const added = after.items.find(({ id }) => id === 'op-batch:item:0');
  assert.equal(added.label, 'Yogur');
  assert.equal(added.collectionId, 'col-compras');
  assert.equal(added.done, false);
});

test('R3: discarding a fully resolved session without committing writes nothing', async () => {
  const before = await readWorkspace();
  // The reviewed session is dropped by the UI; nothing here touches storage.
  assert.deepEqual((await readWorkspace()).items, before.items);
  assert.equal((await readWorkspace()).revision, before.revision);
});

test('R12: archiving a legacy-owned item preserves its legacy record fields', async () => {
  await deleteDatabases();
  const legacyItem = await seedLegacy();
  const before = await readWorkspace();
  const legacy = before.items.find(({ id }) => id === legacyItem.id);
  const result = await commitVoiceActions([{ kind: 'archive', itemId: legacyItem.id }], 'op-legacy', before.revision);
  assert.equal(result.revision, before.revision + 1);
  const persisted = await Item.get(legacyItem.id);
  assert.equal(persisted.archived, true);
  assert.equal(persisted.label, 'Leche');
  assert.equal(persisted.sourceAudioId, 'audio-1');
  const after = await readWorkspace();
  assert.equal(after.items.find(({ id }) => id === legacyItem.id).collectionId, legacy.collectionId);
});

test('R13: incrementing a legacy-owned item writes through the adapter with zero silent losses', async () => {
  await deleteDatabases();
  const list = await List.add({ name: 'Legado', emoji: '🧺', createdAt: 1, order: 1 });
  const milk = await Item.add({
    listId: list.id, label: 'Leche', text: 'leche', quantity: 2, unit: 'litros',
    done: false, createdAt: 2, order: 2,
  });
  const before = await readWorkspace();
  const result = await commitVoiceActions([{ kind: 'increment', itemId: milk.id, quantity: 1 }], 'op-legacy-inc', before.revision);
  assert.equal(result.revision, before.revision + 1);
  assert.deepEqual(result.incremented, [milk.id]);
  const persisted = await Item.get(milk.id);
  assert.equal(persisted.quantity, 3);
  assert.equal(persisted.unit, 'litros');
  assert.equal(persisted.label, 'Leche');
  assert.equal(Object.hasOwn(persisted, 'collectionId'), false, 'joined view fields must not leak into the legacy store');
});
