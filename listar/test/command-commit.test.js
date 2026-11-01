import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import {
  DB_NAME, DB_VERSION, List, Item, readSnapshot, commitCommands,
  setUpgradeBlockedHandler, ReloadRequiredError,
} from '../db.js';
import { bindDatabaseStatus } from '../app-core.mjs';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

async function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteDatabase() {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Test left a database connection open'));
  });
}

async function makeV1Database() {
  await deleteDatabase();
  const db = await new Promise((resolve, reject) => {
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
  });
  const tx = db.transaction(['lists', 'items'], 'readwrite');
  tx.objectStore('lists').put({ id: 'legacy-list', name: 'Legado', emoji: '🧺', createdAt: 1, order: 1 });
  tx.objectStore('items').put({
    id: 'legacy-item', listId: 'legacy-list', label: 'leche', text: 'leche vieja',
    done: false, createdAt: 2, order: 2,
    attributes: { note: [{ id: 'legacy-assertion', role: 'preference', value: { type: 'text', value: 'entera' }, evidence: { quote: 'entera' } }] },
  });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function openRaw(version) {
  const request = version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
  const db = await requestResult(request);
  return db;
}

async function makeList() {
  return List.add({ name: 'Compras' });
}

function addCommand(id, label, extra = {}) {
  return { intent: 'add', item: { id, label, text: label, ...extra } };
}

beforeEach(deleteDatabase);
afterEach(() => setUpgradeBlockedHandler(null));

test('readSnapshot returns one coherent versioned list and items snapshot and rejects missing lists', async () => {
  const list = await makeList();
  const item = await Item.add({ listId: list.id, label: 'leche', text: 'leche' });
  const snapshot = await readSnapshot(list.id);
  assert.deepEqual(snapshot, { listId: list.id, version: 1, items: [item] });
  await assert.rejects(readSnapshot('missing-list'), /list.*not found/i);
});

test('every legacy list/item mutation advances the governed list version', async () => {
  const list = await makeList();
  assert.equal((await readSnapshot(list.id)).version, 0);
  const item = await Item.add({ listId: list.id, label: 'leche' });
  assert.equal((await readSnapshot(list.id)).version, 1);
  await Item.put({ ...item, done: true });
  assert.equal((await readSnapshot(list.id)).version, 2);
  await Item.appendAttribute(item.id, 'note', {
    id: 'pref-1', role: 'preference', value: { type: 'text', value: 'entera' }, evidence: { quote: 'entera' },
  });
  assert.equal((await readSnapshot(list.id)).version, 3);
  await Item.removeAttribute(item.id, 'note', 'pref-1');
  assert.equal((await readSnapshot(list.id)).version, 4);
  await Item.del(item.id);
  assert.equal((await readSnapshot(list.id)).version, 5);
  await List.put({ ...list, name: 'Renombrada' });
  assert.equal((await readSnapshot(list.id)).version, 6);
});

test('commit writes reducer output, increments version once, and resolves to its committed snapshot', async () => {
  const list = await makeList();
  const snapshot = await readSnapshot(list.id);
  const result = await commitCommands({
    snapshot, operationId: 'op-add-one', commands: [addCommand('item-1', 'leche')],
  });
  assert.deepEqual(result, { listId: list.id, version: 1, items: [{
    id: 'item-1', listId: list.id, label: 'leche', text: 'leche',
  }] });
  assert.deepEqual(await readSnapshot(list.id), result);
});

test('same operation ID and payload replays original result after reopen without another version increment', async () => {
  const list = await makeList();
  const oldSnapshot = await readSnapshot(list.id);
  const commands = [addCommand('item-1', 'leche')];
  const first = await commitCommands({ snapshot: oldSnapshot, operationId: 'stable-op', commands });
  const replay = await commitCommands({ snapshot: oldSnapshot, operationId: 'stable-op', commands });
  assert.deepEqual(replay, first);
  assert.deepEqual(await readSnapshot(list.id), first);
});

test('deleting a list atomically clears only its operation receipts and rejects old retries', async () => {
  const firstList = await makeList();
  const secondList = await makeList();
  const firstSnapshot = await readSnapshot(firstList.id);
  const secondSnapshot = await readSnapshot(secondList.id);
  const firstCommands = [addCommand('item-first', 'leche')];
  const secondCommands = [addCommand('item-second', 'pan')];
  await commitCommands({ snapshot: firstSnapshot, operationId: 'receipt-first', commands: firstCommands });
  const secondResult = await commitCommands({ snapshot: secondSnapshot, operationId: 'receipt-second', commands: secondCommands });

  await List.del(firstList.id);

  await assert.rejects(commitCommands({
    snapshot: firstSnapshot, operationId: 'receipt-first', commands: firstCommands,
  }), /list.*not found/i);
  assert.deepEqual(await commitCommands({
    snapshot: secondSnapshot, operationId: 'receipt-second', commands: secondCommands,
  }), secondResult);
  const database = await openRaw();
  const receipts = await requestResult(database.transaction('operations', 'readonly').objectStore('operations').getAll());
  assert.deepEqual(receipts.map(({ operationId, listId }) => ({ operationId, listId })), [
    { operationId: 'receipt-second', listId: secondList.id },
  ]);
  database.close();
});

test('commit snapshots caller-owned command and list identity before asynchronous opening', async () => {
  const list = await makeList();
  const snapshot = await readSnapshot(list.id);
  const command = addCommand('frozen-item', 'leche');
  const pending = commitCommands({ snapshot, operationId: 'frozen-op', commands: [command] });
  command.item.label = 'pan';
  snapshot.listId = 'mutated-list';
  snapshot.version = 99;
  const result = await pending;
  assert.equal(result.listId, list.id);
  assert.equal(result.items[0].label, 'leche');
  assert.equal((await readSnapshot(list.id)).items[0].label, 'leche');
});

test('reusing an operation ID with a different command payload rejects', async () => {
  const list = await makeList();
  const snapshot = await readSnapshot(list.id);
  await commitCommands({ snapshot, operationId: 'same-op', commands: [addCommand('item-1', 'leche')] });
  await assert.rejects(commitCommands({
    snapshot, operationId: 'same-op', commands: [addCommand('item-2', 'pan')],
  }), /operation.*payload|payload.*operation/i);
  assert.equal((await readSnapshot(list.id)).version, 1);
  assert.deepEqual((await Item.list(list.id)).map(({ id }) => id), ['item-1']);
});

test('stale new operation rejects after legacy CRUD advances the list version', async () => {
  const list = await makeList();
  const stale = await readSnapshot(list.id);
  await Item.add({ listId: list.id, label: 'pan' });
  await assert.rejects(commitCommands({
    snapshot: stale, operationId: 'stale-op', commands: [addCommand('item-2', 'leche')],
  }), /stale|version/i);
  assert.equal((await readSnapshot(list.id)).version, 1);
});

test('invalid batch leaves item rows, version and receipt unchanged', async () => {
  const list = await makeList();
  await Item.add({ listId: list.id, label: 'leche', quantity: 1, unit: 'litros' });
  const snapshot = await readSnapshot(list.id);
  await assert.rejects(commitCommands({
    snapshot, operationId: 'invalid-op', commands: [
      { intent: 'set', targetItemId: snapshot.items[0].id, quantity: 2, unit: 'litros' },
      { intent: 'remove', targetItemId: 'missing-item' },
    ],
  }), /target|item/i);
  assert.deepEqual(await readSnapshot(list.id), snapshot);
  const retry = await commitCommands({
    snapshot: await readSnapshot(list.id), operationId: 'invalid-op', commands: [addCommand('item-1', 'leche')],
  });
  assert.equal(retry.version, 2);
  assert.equal(retry.items.length, 2);
  assert.equal(retry.items.find(({ id }) => id === 'item-1').label, 'leche');
});

test('concurrent contenders on one version produce one commit and one stale outcome', async () => {
  const list = await makeList();
  const snapshot = await readSnapshot(list.id);
  const contenders = await Promise.allSettled([
    commitCommands({ snapshot, operationId: 'concurrent-a', commands: [addCommand('item-a', 'leche')] }),
    commitCommands({ snapshot, operationId: 'concurrent-b', commands: [addCommand('item-b', 'pan')] }),
  ]);
  assert.equal(contenders.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = contenders.find(({ status }) => status === 'rejected');
  assert.match(rejected.reason.message, /stale|versi[oó]n/i);
  assert.equal((await readSnapshot(list.id)).version, 1);
  assert.equal((await Item.list(list.id)).length, 1);
});

test('interleaved snapshot read sees old items with old version, then writer commits new version', async () => {
  const list = await makeList();
  const before = await readSnapshot(list.id);
  const reader = readSnapshot(list.id);
  const writer = commitCommands({ snapshot: before, operationId: 'interleave-op', commands: [addCommand('new-item', 'leche')] });
  const [readResult, writeResult] = await Promise.all([reader, writer]);
  assert.deepEqual(readResult, { listId: list.id, version: 0, items: [] });
  assert.deepEqual(writeResult, { listId: list.id, version: 1, items: [{ id: 'new-item', listId: list.id, label: 'leche', text: 'leche' }] });
});

test('upgrade from production v1 preserves legacy data and initializes list version zero', async () => {
  await makeV1Database();
  const snapshot = await readSnapshot('legacy-list');
  assert.equal(DB_VERSION, 2);
  assert.equal(snapshot.version, 0);
  assert.equal(snapshot.items[0].id, 'legacy-item');
  assert.deepEqual(snapshot.items[0].attributes.note[0], {
    id: 'legacy-assertion', role: 'preference', value: { type: 'text', value: 'entera' }, evidence: { quote: 'entera' },
  });
  const database = await openRaw();
  assert.equal(database.version, DB_VERSION);
  assert.ok(database.objectStoreNames.contains('operations'));
  database.close();
});

test('an older cooperating connection closes on versionchange and permits upgrade', async () => {
  await makeV1Database();
  const oldConnection = await openRaw(1);
  let versionChangeCount = 0;
  oldConnection.onversionchange = () => { versionChangeCount++; oldConnection.close(); };
  const snapshot = await readSnapshot('legacy-list');
  assert.equal(versionChangeCount, 1);
  assert.equal(snapshot.version, 0);
});

test('blocked upgrade exposes recoverable Spanish status and resumes on blocker close without retry', async () => {
  await makeV1Database();
  const blocker = await openRaw(1);
  let statusText = '';
  let blockedCount = 0;
  const statusElement = {
    hidden: true, dataset: {},
    get textContent() { return statusText; },
    set textContent(value) { statusText = value; if (/cierra o recarga/i.test(value)) blockedCount++; },
  };
  const unset = bindDatabaseStatus(statusElement);
  let settled = false;
  const originalOpen = indexedDB.open;
  let openCount = 0;
  indexedDB.open = function (...args) {
    openCount++;
    return originalOpen.apply(this, args);
  };
  const opening = Promise.all([readSnapshot('legacy-list'), readSnapshot('legacy-list')])
    .finally(() => { settled = true; });
  try {
    while (blockedCount === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(settled, false);
    assert.match(statusElement.textContent, /cierra o recarga/i);
    assert.equal(statusElement.hidden, false, 'blocked guidance is exposed as visible app status');
    const legacy = await requestResult(blocker.transaction('lists', 'readonly').objectStore('lists').get('legacy-list'));
    assert.equal(Object.hasOwn(legacy, 'version'), false, 'blocked upgrade has not migrated or written data');
    assert.equal(blockedCount, 1, 'one open request reports blocked and waits for the existing blocker');
    assert.equal(openCount, 1, 'concurrent retry work reuses the pending upgrade request');
  } finally {
    blocker.close();
    indexedDB.open = originalOpen;
  }
  try {
    assert.ok((await opening).every(({ version }) => version === 0));
    assert.equal(statusElement.hidden, true, 'visible blocked guidance clears after the pending upgrade resumes');
    assert.equal(statusElement.textContent, '');
  } finally {
    unset?.();
  }
});

test('aborted upgrade preserves v1 schema and data for the next open', async () => {
  await makeV1Database();
  const originalOpen = indexedDB.open;
  indexedDB.open = function (...args) {
    const request = originalOpen.apply(this, args);
    request.addEventListener('upgradeneeded', () => request.transaction.abort());
    return request;
  };
  try {
    await assert.rejects(readSnapshot('legacy-list'));
  } finally {
    indexedDB.open = originalOpen;
  }
  const database = await openRaw();
  assert.equal(database.version, 1);
  assert.equal(database.objectStoreNames.contains('operations'), false);
  const legacy = await requestResult(database.transaction('lists', 'readonly').objectStore('lists').get('legacy-list'));
  assert.equal(legacy.name, 'Legado');
  assert.equal(Object.hasOwn(legacy, 'version'), false);
  database.close();
});

test('VersionError requests reload and never recreates or lowers a newer database', async () => {
  const list = await makeList();
  const newer = await openRaw(DB_VERSION + 1);
  newer.close();
  await assert.rejects(readSnapshot(list.id), (error) => {
    assert.ok(error instanceof ReloadRequiredError);
    assert.match(error.message, /recarga/i);
    return true;
  });
  const database = await openRaw();
  assert.equal(database.version, DB_VERSION + 1);
  const record = await requestResult(database.transaction('lists', 'readonly').objectStore('lists').get(list.id));
  assert.equal(record.name, 'Compras');
  database.close();
});

test('completed CRUD connections close so a newer schema can open immediately', async () => {
  await makeList();
  const upgraded = await openRaw(DB_VERSION + 1);
  assert.equal(upgraded.version, DB_VERSION + 1);
  upgraded.close();
});

test('aborted CRUD transactions close their connection and leave schema upgradeable', async () => {
  const list = await makeList();
  const item = await Item.add({ listId: list.id, label: 'leche' });
  await assert.rejects(Item.put({ ...item, attributes: { price: [{ id: 'bad' }] } }), /attribute|assertion/i);
  const upgraded = await openRaw(DB_VERSION + 1);
  assert.equal(upgraded.version, DB_VERSION + 1);
  upgraded.close();
});
