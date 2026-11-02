// Purpose: provide the checklist workspace persistence boundary.
// Responsibilities: store unassigned and collected items, collections and memberships;
//   read a revisioned coherent snapshot merged with legacy data; commit captures and
//   membership moves idempotently under a revision guard.
// Rationale: first use must work before a collection exists, retries must not duplicate
//   items, and views need one snapshot where legacy list IDs are collections and legacy
//   listId is membership — without copying or mutating legacy rows.

import { List, Item } from './db.js';

const DB = 'listar-workspace';
const VERSION = 2;

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' }).put({ key: 'revision', value: 0 });
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('operations')) db.createObjectStore('operations', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('memberships')) db.createObjectStore('memberships', { keyPath: 'itemId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readStore(db, store) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readLegacy() {
  const [lists, items] = await Promise.all([List.all(), Item.all()]);
  return {
    collections: lists.map((list) => ({ id: list.id, name: list.name, emoji: list.emoji ?? '', order: list.order ?? 0 })),
    items: items.map((item) => ({ ...item, collectionId: item.listId ?? null })),
  };
}

export async function readWorkspace() {
  const db = await open();
  let revision = 0;
  let workspaceItems = [];
  let workspaceCollections = [];
  let memberships = [];
  try {
    const [meta, items, collections, membershipRecords] = await Promise.all([
      readStore(db, 'meta'), readStore(db, 'items'), readStore(db, 'collections'), readStore(db, 'memberships'),
    ]);
    revision = meta.find((entry) => entry.key === 'revision')?.value ?? 0;
    workspaceItems = items;
    workspaceCollections = collections;
    memberships = membershipRecords;
  } finally {
    db.close();
  }
  const membershipByItem = new Map(memberships.map((record) => [record.itemId, record.collectionId ?? null]));
  const workspaceIds = new Set(workspaceItems.map((item) => item.id));
  const itemsWithMembership = workspaceItems.map((item) => ({
    ...item,
    collectionId: membershipByItem.has(item.id) ? membershipByItem.get(item.id) : (item.collectionId ?? null),
  }));
  const legacy = await readLegacy();
  const mergedLegacyItems = legacy.items.map((item) => ({
    ...item,
    collectionId: membershipByItem.has(item.id) ? membershipByItem.get(item.id) : item.collectionId,
  }));
  return {
    revision,
    items: [...itemsWithMembership, ...mergedLegacyItems.filter((item) => !workspaceIds.has(item.id))],
    collections: [...workspaceCollections, ...legacy.collections],
  };
}

async function collectionExists(db, collectionId) {
  const workspaceHit = await new Promise((resolve, reject) => {
    const request = db.transaction('collections', 'readonly').objectStore('collections').get(collectionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (workspaceHit) return true;
  return (await List.get(collectionId)) != null;
}

export async function captureItem(label, operationId = crypto.randomUUID(), expectedRevision, destination = {}) {
  const text = String(label ?? '');
  if (!text.trim()) return null;
  if (typeof operationId !== 'string' || !operationId.trim()) throw new TypeError('Capture needs a stable operation ID.');
  const collectionId = destination.collectionId ?? null;
  const db = await open();
  if (collectionId !== null && !(await collectionExists(db, collectionId))) {
    db.close();
    throw new TypeError(`Unknown collection: ${collectionId}`);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['meta', 'items', 'operations', 'memberships'], 'readwrite');
    const meta = tx.objectStore('meta');
    const items = tx.objectStore('items');
    const operations = tx.objectStore('operations');
    const memberships = tx.objectStore('memberships');
    const replay = operations.get(operationId);
    let result;
    replay.onsuccess = () => {
      if (replay.result) {
        if (replay.result.label !== text) { tx.abort(); return; }
        result = replay.result.item;
        return;
      }
      const revisionRequest = meta.get('revision');
      revisionRequest.onsuccess = () => {
        const current = revisionRequest.result.value;
        if (expectedRevision !== undefined && current !== expectedRevision) { tx.abort(); return; }
        const revision = current + 1;
        const item = { id: operationId, label: text, text, done: false, createdAt: Date.now(), order: revision };
        items.add(item);
        meta.put({ key: 'revision', value: revision });
        if (collectionId !== null) memberships.put({ itemId: operationId, collectionId });
        operations.add({ id: operationId, label: text, item });
        result = item;
      };
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Workspace changed or operation ID was reused with different text.')); };
  });
}

export async function moveItem(itemId, collectionId, expectedRevision) {
  if (typeof itemId !== 'string' || !itemId.trim()) throw new TypeError('moveItem needs an item ID.');
  if (collectionId !== null && (typeof collectionId !== 'string' || !collectionId.trim())) {
    throw new TypeError('moveItem collectionId must be null or a non-empty string.');
  }
  const snapshot = await readWorkspace();
  const item = snapshot.items.find((entry) => entry.id === itemId);
  if (!item) throw new TypeError(`Unknown item: ${itemId}`);
  if ((item.collectionId ?? null) === collectionId) return { moved: false, item };
  const db = await open();
  if (collectionId !== null && !(await collectionExists(db, collectionId))) {
    db.close();
    throw new TypeError(`Unknown collection: ${collectionId}`);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['meta', 'memberships'], 'readwrite');
    const meta = tx.objectStore('meta');
    let result;
    const revisionRequest = meta.get('revision');
    revisionRequest.onsuccess = () => {
      const current = revisionRequest.result.value;
      if (expectedRevision !== undefined && current !== expectedRevision) { tx.abort(); return; }
      const revision = current + 1;
      tx.objectStore('memberships').put({ itemId, collectionId });
      meta.put({ key: 'revision', value: revision });
      result = { moved: true, item: { ...item, collectionId } };
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Workspace changed during the move.')); };
  });
}
