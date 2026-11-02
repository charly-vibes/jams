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

function validatePatch(current, patch) {
  const next = { ...current };
  const touched = [];
  if (Object.hasOwn(patch, 'label')) {
    const label = String(patch.label ?? '');
    if (!label.trim()) throw new TypeError('Item label cannot be empty.');
    next.label = label;
    touched.push(['label', label]);
  }
  if (Object.hasOwn(patch, 'quantity') || Object.hasOwn(patch, 'unit')) {
    if (patch.quantity === null) {
      delete next.quantity;
      delete next.unit;
      touched.push(['quantity', undefined], ['unit', undefined]);
    } else {
      const quantity = Number(patch.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new TypeError('Quantity must be a finite number greater than zero.');
      next.quantity = quantity;
      touched.push(['quantity', quantity]);
      if (Object.hasOwn(patch, 'unit')) {
        if (patch.unit === null || !String(patch.unit).trim()) { delete next.unit; touched.push(['unit', undefined]); }
        else { next.unit = String(patch.unit); touched.push(['unit', next.unit]); }
      }
    }
  }
  const isNoop = touched.every(([key, value]) =>
    value === undefined ? !Object.hasOwn(current, key) : current[key] === value);
  return { next, isNoop };
}

async function findItem(snapshot, itemId) {
  const item = snapshot.items.find((entry) => entry.id === itemId);
  if (!item) throw new TypeError(`Unknown item: ${itemId}`);
  return item;
}

async function commitItemRecord(item, record, expectedRevision) {
  const { collectionId: _joined, ...persisted } = record;
  const db = await open();
  const workspaceOwned = await new Promise((resolve, reject) => {
    const request = db.transaction('items', 'readonly').objectStore('items').get(item.id);
    request.onsuccess = () => resolve(request.result != null);
    request.onerror = () => reject(request.error);
  });
  if (workspaceOwned) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['meta', 'items'], 'readwrite');
      const meta = tx.objectStore('meta');
      let result;
      const revisionRequest = meta.get('revision');
      revisionRequest.onsuccess = () => {
        const current = revisionRequest.result.value;
        if (expectedRevision !== undefined && current !== expectedRevision) { tx.abort(); return; }
        const revision = current + 1;
        tx.objectStore('items').put(record);
        meta.put({ key: 'revision', value: revision });
        result = record;
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Workspace changed during the edit.')); };
    });
  }
  db.close();
  // Legacy-owned items delegate field writes to the db.js adapter after a workspace
  // revision bump; bump-first ordering makes a crash between the two reject later
  // stale actions instead of allowing lost updates.
  await bumpRevision(expectedRevision);
  await Item.put(record);
  return record;
}

function bumpRevision(expectedRevision) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(['meta'], 'readwrite');
    const meta = tx.objectStore('meta');
    const revisionRequest = meta.get('revision');
    revisionRequest.onsuccess = () => {
      const current = revisionRequest.result.value;
      if (expectedRevision !== undefined && current !== expectedRevision) { tx.abort(); return; }
      meta.put({ key: 'revision', value: current + 1 });
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Workspace changed during the edit.')); };
  }));
}

export async function applyItemUpdate(itemId, patch, expectedRevision) {
  const snapshot = await readWorkspace();
  const item = await findItem(snapshot, itemId);
  const { next, isNoop } = validatePatch(item, patch);
  if (isNoop) return item;
  return commitItemRecord(item, next, expectedRevision);
}

export async function toggleDone(itemId, expectedRevision) {
  const snapshot = await readWorkspace();
  const item = await findItem(snapshot, itemId);
  return commitItemRecord(item, { ...item, done: !item.done }, expectedRevision);
}

export async function setArchived(itemId, archived, expectedRevision) {
  const snapshot = await readWorkspace();
  const item = await findItem(snapshot, itemId);
  return commitItemRecord(item, { ...item, archived: archived === true }, expectedRevision);
}

export async function applyItemFields(itemId, fields, expectedRevision) {
  const snapshot = await readWorkspace();
  const item = await findItem(snapshot, itemId);
  if (Object.hasOwn(fields, 'label') && !String(fields.label ?? '').trim()) {
    throw new TypeError('Item label cannot be empty.');
  }
  const record = { ...item };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete record[key];
    else record[key] = value;
  }
  const same = ['label', 'quantity', 'unit', 'done', 'archived'].every((key) =>
    !Object.hasOwn(fields, key) || fields[key] === item[key] || (fields[key] === null && item[key] === undefined));
  if (same) return item;
  return commitItemRecord(item, record, expectedRevision);
}

export async function removeCapturedItem(itemId, expectedRevision, { expected } = {}) {
  if (typeof itemId !== 'string' || !itemId.trim()) throw new TypeError('removeCapturedItem needs an item ID.');
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['meta', 'items', 'memberships'], 'readwrite');
    const meta = tx.objectStore('meta');
    const items = tx.objectStore('items');
    let result = false;
    const existing = items.get(itemId);
    existing.onsuccess = () => {
      if (!existing.result) { tx.abort(); return; }
      if (expected && JSON.stringify(existing.result) !== JSON.stringify(expected)) { tx.abort(); return; }
      const revisionRequest = meta.get('revision');
      revisionRequest.onsuccess = () => {
        const current = revisionRequest.result.value;
        if (expectedRevision !== undefined && current !== expectedRevision) { tx.abort(); return; }
        items.delete(itemId);
        tx.objectStore('memberships').delete(itemId);
        meta.put({ key: 'revision', value: current + 1 });
        result = true;
      };
    };
    existing.onerror = () => { tx.abort(); };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('El artículo no existe, cambió desde el agregado, o el espacio de trabajo se actualizó.'));
    };
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
