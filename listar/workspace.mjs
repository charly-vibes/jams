// Purpose: provide the greenfield checklist workspace persistence boundary.
// Responsibilities: store unassigned items, read a revisioned snapshot, and commit capture idempotently.
// Rationale: first use must work before a collection exists and retries must not duplicate items.

const DB = 'listar-workspace';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('meta', { keyPath: 'key' }).put({ key: 'revision', value: 0 });
      db.createObjectStore('items', { keyPath: 'id' });
      db.createObjectStore('operations', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readWorkspace() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['meta', 'items'], 'readonly');
    const revision = tx.objectStore('meta').get('revision');
    const items = tx.objectStore('items').getAll();
    let revisionValue;
    let itemValues;
    let value;
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    const finish = () => {
      if (revisionValue !== undefined && itemValues !== undefined) value = { revision: revisionValue, items: itemValues };
    };
    revision.onsuccess = () => { revisionValue = revision.result.value; finish(); };
    items.onsuccess = () => { itemValues = items.result; finish(); };
  });
}

export async function captureItem(label, operationId = crypto.randomUUID(), expectedRevision) {
  const text = String(label ?? '');
  if (!text.trim()) return null;
  if (typeof operationId !== 'string' || !operationId.trim()) throw new TypeError('Capture needs a stable operation ID.');
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['meta', 'items', 'operations'], 'readwrite');
    const meta = tx.objectStore('meta');
    const items = tx.objectStore('items');
    const operations = tx.objectStore('operations');
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
        const item = { id: operationId, label: text, text, done: false, archived: false, order: revision };
        items.add(item);
        meta.put({ key: 'revision', value: revision });
        operations.add({ id: operationId, label: text, item });
        result = item;
      };
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Workspace changed or operation ID was reused with different text.')); };
  });
}
