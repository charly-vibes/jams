// Purpose: provide the checklist workspace persistence boundary.
// Responsibilities: store unassigned and collected items, collections and memberships;
//   read a revisioned coherent snapshot merged with legacy data; commit captures,
//   membership moves and collection management idempotently under a revision guard.
// Rationale: first use must work before a collection exists, retries must not duplicate
//   items, views need one snapshot where legacy list IDs are collections and legacy
//   listId is membership, and removing a collection must unassign its items without
//   ever deleting them — without copying or mutating legacy rows except one explicit
//   detach when the collection itself is removed. Reviewed drafts commit through one
//   guarded atomic batch whose identical retry replays the original outcome (A02/A04/A14).

import { List, Item, detachListContent } from './db.js';

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

function normalizeBatchItems(items) {
  if (!Array.isArray(items)) throw new TypeError('captureBatch needs an array of item proposals.');
  const normalized = items.map((item, index) => {
    const label = String(item?.label ?? '').trim();
    if (!label) throw new TypeError(`Batch item ${index} needs a non-empty label.`);
    const row = { label, text: String(item.text ?? label) };
    if (item.quantity !== undefined && item.quantity !== null) {
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new TypeError(`Batch item ${index} needs a finite quantity greater than zero.`);
      }
      row.quantity = quantity;
    }
    if (item.unit !== undefined && item.unit !== null && String(item.unit).trim()) {
      row.unit = String(item.unit).trim();
    }
    return row;
  });
  if (normalized.length === 0) throw new TypeError('captureBatch needs at least one item.');
  return normalized;
}

// A02/A04/A14: a reviewed draft commits as ONE atomic batch — every item, one
// revision bump, destination memberships and the replay receipt in a single
// transaction. Identical retry (same operation ID and payload, even after the
// database is reopened or the revision moved on) returns the original outcome;
// a changed payload with a reused operation ID aborts, and a stale expected
// revision aborts — both with zero partial writes.
export async function captureBatch(items, operationId = crypto.randomUUID(), expectedRevision, { collectionId } = {}) {
  const batch = normalizeBatchItems(items);
  if (typeof operationId !== 'string' || !operationId.trim()) throw new TypeError('Capture needs a stable operation ID.');
  const destinationId = collectionId ?? null;
  const db = await open();
  if (destinationId !== null && !(await collectionExists(db, destinationId))) {
    db.close();
    throw new TypeError(`Unknown collection: ${destinationId}`);
  }
  const payload = { items: batch, collectionId: destinationId };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['meta', 'items', 'operations', 'memberships'], 'readwrite');
    const meta = tx.objectStore('meta');
    const itemsStore = tx.objectStore('items');
    const operations = tx.objectStore('operations');
    const memberships = tx.objectStore('memberships');
    const replay = operations.get(operationId);
    let result;
    replay.onsuccess = () => {
      if (replay.result) {
        // Replay lookup precedes stale rejection: an identical retry returns the
        // original outcome; a changed payload with a reused ID never writes.
        if (JSON.stringify(replay.result.payload) !== JSON.stringify(payload)) { tx.abort(); return; }
        result = replay.result.items;
        return;
      }
      const revisionRequest = meta.get('revision');
      revisionRequest.onsuccess = () => {
        const current = revisionRequest.result.value;
        if (expectedRevision !== undefined && current !== expectedRevision) { tx.abort(); return; }
        const revision = current + 1;
        const createdAt = Date.now();
        // createdAt advances per row so batches of any size keep dictation order
        // under the deterministic order → createdAt → id tie-break.
        const persisted = batch.map((row, index) => ({
          id: `${operationId}:item:${index}`,
          ...row,
          done: false,
          createdAt: createdAt + index,
          order: revision,
        }));
        for (const item of persisted) itemsStore.add(item);
        meta.put({ key: 'revision', value: revision });
        if (destinationId !== null) {
          for (const item of persisted) memberships.put({ itemId: item.id, collectionId: destinationId });
        }
        operations.add({ id: operationId, payload, items: persisted });
        result = persisted;
      };
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('El espacio de trabajo se actualizó o el ID de operación se reutilizó con un contenido diferente.'));
    };
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

const VOICE_KINDS = new Set(['archive', 'detach', 'add', 'increment']);

function normalizeVoiceActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new TypeError('Se necesita al menos un cambio confirmado.');
  }
  return actions.map((action, index) => {
    if (!action || !VOICE_KINDS.has(action.kind)) throw new TypeError(`Cambio de voz sin soporte: ${action?.kind}`);
    if (action.kind === 'add') {
      const label = String(action.item?.label ?? '').trim();
      if (!label) throw new TypeError(`El cambio ${index + 1} necesita una etiqueta.`);
      const item = { label, text: String(action.item.text ?? label) };
      if (action.item.quantity != null) {
        const quantity = Number(action.item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new TypeError('La cantidad debe ser un número finito mayor que cero.');
        item.quantity = quantity;
      }
      if (action.item.unit != null && String(action.item.unit).trim()) item.unit = String(action.item.unit).trim();
      if (action.item.sourceAudioId != null) item.sourceAudioId = action.item.sourceAudioId;
      return { kind: 'add', item, collectionId: action.collectionId ?? null };
    }
    if (typeof action.itemId !== 'string' || !action.itemId.trim()) throw new TypeError(`El cambio ${index + 1} necesita un artículo de destino.`);
    if (action.kind === 'detach') {
      if (typeof action.fromCollectionId !== 'string' || !action.fromCollectionId.trim()) {
        throw new TypeError('Quitar de una lista necesita la membresía esperada.');
      }
      return { kind: 'detach', itemId: action.itemId, fromCollectionId: action.fromCollectionId };
    }
    if (action.kind === 'increment') {
      const quantity = Number(action.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new TypeError('El incremento debe ser un número finito mayor que cero.');
      return { kind: 'increment', itemId: action.itemId, quantity, ...(action.unit == null ? {} : { unit: String(action.unit) }) };
    }
    return { kind: 'archive', itemId: action.itemId };
  });
}

// A05/A06 persistence seam: resolved voice changes commit through the same
// guarded workspace revision as every other writer. Fresh preconditions run
// against the live snapshot (a missing target or a changed membership rejects
// for renewed review with zero writes); identical retries replay the original
// outcome through the operations receipt. Archive preserves the full record;
// detach writes exactly one membership record and never deletes an item.
export async function commitVoiceActions(actions, operationId = crypto.randomUUID(), expectedRevision) {
  const batch = normalizeVoiceActions(actions);
  if (typeof operationId !== 'string' || !operationId.trim()) throw new TypeError('Capture needs a stable operation ID.');
  const snapshot = await readWorkspace();
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
  for (const action of batch) {
    if (action.kind === 'add') continue;
    const item = itemById.get(action.itemId);
    if (!item) throw new TypeError('El artículo ya no existe; vuelve a revisar el cambio.');
    if (action.kind === 'detach' && (item.collectionId ?? null) !== action.fromCollectionId) {
      throw new Error('La membresía cambió desde la revisión; vuelve a revisar el cambio.');
    }
    if (action.kind === 'increment' && item.quantity == null) {
      throw new TypeError('No hay una cantidad base que pueda incrementarse; edita la cantidad.');
    }
  }
  const payload = batch.map((action) => ({ ...action, item: action.kind === 'add' ? { ...action.item } : undefined }));
  const db = await open();
  const owned = await Promise.all(batch.map((action) => (action.kind === 'add'
    ? Promise.resolve(true)
    : new Promise((resolve, reject) => {
      const request = db.transaction('items', 'readonly').objectStore('items').get(action.itemId);
      request.onsuccess = () => resolve(request.result != null);
      request.onerror = () => reject(request.error);
    }))));
  const legacyArchives = batch.filter((action, index) => !owned[index] && (action.kind === 'archive' || action.kind === 'increment'));
  // Legacy-owned archive/increment delegate to the db.js adapter after a guarded
  // revision bump; bump-first ordering rejects later stale actions instead of
  // allowing lost updates (same precedent as commitItemRecord). When every
  // write delegates, the workspace transaction only records the receipt and
  // must not advance the revision a second time.
  let guard = expectedRevision;
  let skipBump = false;
  if (legacyArchives.length) {
    await bumpRevision(expectedRevision);
    for (const action of legacyArchives) {
      const { collectionId: _viewField, ...current } = itemById.get(action.itemId);
      const record = action.kind === 'archive'
        ? { ...current, archived: true }
        : { ...current, quantity: (current.quantity ?? 0) + action.quantity, ...(action.unit === undefined ? {} : { unit: action.unit }) };
      await Item.put(record);
    }
    guard = expectedRevision === undefined ? undefined : expectedRevision + 1;
    skipBump = batch.every((action, index) => !owned[index] && (action.kind === 'archive' || action.kind === 'increment'));
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['meta', 'items', 'memberships', 'operations'], 'readwrite');
    const meta = tx.objectStore('meta');
    const items = tx.objectStore('items');
    const memberships = tx.objectStore('memberships');
    const operations = tx.objectStore('operations');
    const replay = operations.get(operationId);
    let result;
    replay.onsuccess = () => {
      if (replay.result) {
        if (JSON.stringify(replay.result.payload) !== JSON.stringify(payload)) { tx.abort(); return; }
        result = replay.result.outcome;
        return;
      }
      const revisionRequest = meta.get('revision');
      revisionRequest.onsuccess = () => {
        const current = revisionRequest.result.value;
        if (guard !== undefined && current !== guard) { tx.abort(); return; }
        const revision = skipBump ? current : current + 1;
        const createdAt = Date.now();
        const added = [];
        const archived = [];
        const detached = [];
        const incremented = [];
        let addIndex = 0;
        batch.forEach((action, index) => {
          if (action.kind === 'add') {
            const item = {
              id: `${operationId}:item:${addIndex++}`,
              ...action.item,
              done: false,
              createdAt: createdAt + index,
              order: revision,
            };
            items.add(item);
            if (action.collectionId !== null) memberships.put({ itemId: item.id, collectionId: action.collectionId });
            added.push(item);
            return;
          }
          if (action.kind === 'archive' || action.kind === 'increment') {
            if (action.kind === 'archive') archived.push(action.itemId);
            else incremented.push(action.itemId);
            if (!owned[index]) return; // legacy-owned writes already delegated above
            const read = items.get(action.itemId);
            read.onsuccess = () => {
              if (!read.result) return;
              if (action.kind === 'archive') {
                items.put({ ...read.result, archived: true });
                return;
              }
              const record = { ...read.result };
              record.quantity = (record.quantity ?? 0) + action.quantity;
              if (action.unit !== undefined) record.unit = action.unit;
              items.put(record);
            };
            return;
          }
          if (action.kind === 'detach') {
            memberships.put({ itemId: action.itemId, collectionId: null });
            detached.push(action.itemId);
            return;
          }
        });
        meta.put({ key: 'revision', value: revision });
        result = { revision, archived, detached, incremented, added };
        operations.add({ id: operationId, payload, outcome: result });
      };
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('El espacio de trabajo se actualizó o el ID de operación se reutilizó con un contenido diferente.'));
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

export async function createCollection({ name, emoji = '' } = {}, expectedRevision) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new TypeError('La colección necesita un nombre.');
  const collection = {
    id: crypto.randomUUID(),
    name: cleanName,
    emoji: String(emoji ?? '').trim(),
    order: Date.now(),
  };
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['meta', 'collections'], 'readwrite');
    const meta = tx.objectStore('meta');
    const revisionRequest = meta.get('revision');
    revisionRequest.onsuccess = () => {
      const current = revisionRequest.result.value;
      if (expectedRevision !== undefined && current !== expectedRevision) { tx.abort(); return; }
      tx.objectStore('collections').add(collection);
      meta.put({ key: 'revision', value: current + 1 });
    };
    tx.oncomplete = () => { db.close(); resolve(collection); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('El espacio de trabajo se actualizó durante la creación de la colección.')); };
  });
}

export async function renameCollection(id, { name, emoji } = {}, expectedRevision) {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('renameCollection needs a collection ID.');
  const cleanName = name === undefined ? null : String(name).trim();
  if (cleanName !== null && !cleanName) throw new TypeError('La colección necesita un nombre.');
  const cleanEmoji = emoji === undefined ? undefined : String(emoji).trim();
  const db = await open();
  const workspaceOwned = await new Promise((resolve, reject) => {
    const request = db.transaction('collections', 'readonly').objectStore('collections').get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  if (workspaceOwned) {
    const unchanged = (cleanName === null || cleanName === workspaceOwned.name) &&
      (cleanEmoji === undefined || cleanEmoji === (workspaceOwned.emoji ?? ''));
    if (unchanged) { db.close(); return workspaceOwned; }
    const record = {
      ...workspaceOwned,
      ...(cleanName !== null ? { name: cleanName } : {}),
      ...(cleanEmoji !== undefined ? { emoji: cleanEmoji } : {}),
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['meta', 'collections'], 'readwrite');
      const meta = tx.objectStore('meta');
      let result;
      const revisionRequest = meta.get('revision');
      revisionRequest.onsuccess = () => {
        const current = revisionRequest.result.value;
        if (expectedRevision !== undefined && current !== expectedRevision) { tx.abort(); return; }
        tx.objectStore('collections').put(record);
        meta.put({ key: 'revision', value: current + 1 });
        result = record;
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('El espacio de trabajo se actualizó durante el cambio de nombre.')); };
    });
  }
  db.close();
  const current = await List.get(id);
  if (!current) throw new TypeError(`Unknown collection: ${id}`);
  const unchanged = (cleanName === null || cleanName === current.name) &&
    (cleanEmoji === undefined || cleanEmoji === (current.emoji ?? ''));
  if (unchanged) return current;
  // Legacy-owned rename delegates to the db.js adapter after a guarded revision
  // bump; bump-first ordering makes a crash between the two reject later stale
  // actions instead of allowing lost updates, and the list keeps its identity.
  await bumpRevision(expectedRevision);
  return List.put({
    ...current,
    ...(cleanName !== null ? { name: cleanName } : {}),
    ...(cleanEmoji !== undefined ? { emoji: cleanEmoji } : {}),
  });
}

export async function removeCollection(id, expectedRevision) {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('removeCollection needs a collection ID.');
  const snapshot = await readWorkspace();
  const collection = snapshot.collections.find((entry) => entry.id === id);
  if (!collection) throw new TypeError(`Unknown collection: ${id}`);
  const db = await open();
  const workspaceOwned = await new Promise((resolve, reject) => {
    const request = db.transaction('collections', 'readonly').objectStore('collections').get(id);
    request.onsuccess = () => resolve(request.result != null);
    request.onerror = () => reject(request.error);
  });
  if (workspaceOwned) {
    // A10: detach membership and remove the collection in ONE transaction; item
    // records are never touched, so removal cannot delete or mutate an item.
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['meta', 'collections', 'memberships'], 'readwrite');
      const meta = tx.objectStore('meta');
      const memberships = tx.objectStore('memberships');
      const revisionRequest = meta.get('revision');
      revisionRequest.onsuccess = () => {
        const current = revisionRequest.result.value;
        if (expectedRevision !== undefined && current !== expectedRevision) { tx.abort(); return; }
        const all = memberships.getAll();
        all.onsuccess = () => {
          for (const record of all.result) {
            if (record.collectionId === id) memberships.delete(record.itemId);
          }
          tx.objectStore('collections').delete(id);
          meta.put({ key: 'revision', value: current + 1 });
        };
        all.onerror = () => { tx.abort(); };
      };
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('El espacio de trabajo se actualizó durante la eliminación de la colección.')); };
    });
  }
  db.close();
  // Legacy-owned removal: clear workspace membership records that point at the
  // legacy list under one guarded revision bump, then detach the legacy content.
  // Items and audio survive without listId; a crash between the transactions
  // rejects later stale actions instead of losing data.
  const clearDb = await open();
  await new Promise((resolve, reject) => {
    const tx = clearDb.transaction(['meta', 'memberships'], 'readwrite');
    const meta = tx.objectStore('meta');
    const memberships = tx.objectStore('memberships');
    const revisionRequest = meta.get('revision');
    revisionRequest.onsuccess = () => {
      const current = revisionRequest.result.value;
      if (expectedRevision !== undefined && current !== expectedRevision) { tx.abort(); return; }
      const all = memberships.getAll();
      all.onsuccess = () => {
        for (const record of all.result) {
          if (record.collectionId === id) memberships.delete(record.itemId);
        }
        meta.put({ key: 'revision', value: current + 1 });
      };
      all.onerror = () => { tx.abort(); };
    };
    tx.oncomplete = () => { clearDb.close(); resolve(); };
    tx.onabort = () => { clearDb.close(); reject(tx.error ?? new Error('El espacio de trabajo se actualizó durante la eliminación de la colección.')); };
  });
  await detachListContent(id);
  return true;
}
