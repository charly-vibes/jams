// db.js — IndexedDB wrapper (TDD). Contract: List/Item/Audio stores, CRUD, ordering, per-list queries.
// jams-y8c.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { List, Item, Audio } from '../db.js';

// --- Setup: IndexedDB shim for Node ---
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
const DB_NAME = 'listar';

async function clearStores() {
  // Open with the same schema as db.js (incl. indexes), then clear each store.
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const db_ = e.target.result;
      if (!db_.objectStoreNames.contains('lists')) {
        const s = db_.createObjectStore('lists', { keyPath: 'id' });
        s.createIndex('order', 'order', { unique: false });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db_.objectStoreNames.contains('items')) {
        const s = db_.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('listId', 'listId', { unique: false });
        s.createIndex('order', 'order', { unique: false });
        s.createIndex('done', 'done', { unique: false });
      }
      if (!db_.objectStoreNames.contains('audio')) {
        const s = db_.createObjectStore('audio', { keyPath: 'id' });
        s.createIndex('listId', 'listId', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
  for (const s of ['lists', 'items', 'audio']) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(s, 'readwrite');
      tx.objectStore(s).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  db.close();
}

describe('List store', () => {
  beforeEach(async () => { await clearStores(); });
  test('add returns record with id, name, emoji, createdAt, order', async () => {
    const rec = await List.add({ name: 'Compras', emoji: '🛒' });
    assert.ok(rec.id);
    assert.equal(rec.name, 'Compras');
    assert.equal(rec.emoji, '🛒');
    assert.ok(rec.createdAt);
    assert.ok(rec.order);
  });

  test('get retrieves by id', async () => {
    const added = await List.add({ name: 'Test' });
    const got = await List.get(added.id);
    assert.equal(got.name, 'Test');
  });

  test('all returns ordered by order asc', async () => {
    await List.add({ name: 'B', order: 2 });
    await List.add({ name: 'A', order: 1 });
    const all = await List.all();
    assert.deepEqual(all.map(l => l.name), ['A', 'B']);
  });

  test('put updates record', async () => {
    const added = await List.add({ name: 'Old' });
    await List.put({ ...added, name: 'New' });
    const got = await List.get(added.id);
    assert.equal(got.name, 'New');
  });

  test('del removes record', async () => {
    const added = await List.add({ name: 'DeleteMe' });
    await List.del(added.id);
    const got = await List.get(added.id);
    assert.equal(got, undefined);
  });
});

describe('Item store', () => {
  beforeEach(async () => { await clearStores(); });
  test('add returns record with all fields incl listId, done:false', async () => {
    const rec = await Item.add({ listId: 'list-1', label: 'Leche', text: '2 litros de leche', quantity: 2, unit: 'litros' });
    assert.ok(rec.id);
    assert.equal(rec.listId, 'list-1');
    assert.equal(rec.label, 'Leche');
    assert.equal(rec.text, '2 litros de leche');
    assert.equal(rec.quantity, 2);
    assert.equal(rec.unit, 'litros');
    assert.equal(rec.done, false);
    assert.ok(rec.createdAt);
    assert.ok(rec.order);
  });

  test('list returns items for listId ordered by order asc', async () => {
    await Item.add({ listId: 'L1', label: 'B', order: 2 });
    await Item.add({ listId: 'L1', label: 'A', order: 1 });
    await Item.add({ listId: 'L2', label: 'Other' });
    const items = await Item.list('L1');
    assert.deepEqual(items.map(i => i.label), ['A', 'B']);
  });

  test('put updates item', async () => {
    const added = await Item.add({ listId: 'L', label: 'Old' });
    await Item.put({ ...added, label: 'New', done: true });
    const items = await Item.list('L');
    assert.equal(items[0].label, 'New');
    assert.equal(items[0].done, true);
  });

  test('del removes item', async () => {
    const added = await Item.add({ listId: 'L', label: 'DeleteMe' });
    await Item.del(added.id);
    const items = await Item.list('L');
    assert.equal(items.length, 0);
  });
});

describe('Audio store', () => {
  beforeEach(async () => { await clearStores(); });
  test('add returns record with listId, blob, transcript, model, createdAt', async () => {
    const rec = await Audio.add({ listId: 'L1', blob: 'fake-blob', transcript: 'hola', model: 'whisper-tiny' });
    assert.ok(rec.id);
    assert.equal(rec.listId, 'L1');
    assert.equal(rec.blob, 'fake-blob');
    assert.equal(rec.transcript, 'hola');
    assert.equal(rec.model, 'whisper-tiny');
    assert.ok(rec.createdAt);
  });

  test('byList returns audio for listId ordered by createdAt asc', async () => {
    await Audio.add({ listId: 'L1', transcript: 'first' });
    await Audio.add({ listId: 'L1', transcript: 'second' });
    await Audio.add({ listId: 'L2', transcript: 'other' });
    const audios = await Audio.byList('L1');
    assert.deepEqual(audios.map(a => a.transcript), ['first', 'second']);
  });

  test('del removes audio', async () => {
    const added = await Audio.add({ listId: 'L', transcript: 'DeleteMe' });
    await Audio.del(added.id);
    const audios = await Audio.byList('L');
    assert.equal(audios.length, 0);
  });
});