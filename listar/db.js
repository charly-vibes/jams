// db.js — IndexedDB wrapper for Listar. Versioned list state, atomic commands, and connection lifecycle.
// Responsibilities: own database handles, preserve legacy records, and serialize all governed list writes.
// Rationale: coherent snapshots and durable operation receipts prevent stale or duplicate command application.
export const DB_NAME = 'listar';
export const DB_VERSION = 2;

const STORE_LISTS = 'lists';
const STORE_ITEMS = 'items';
const STORE_AUDIO = 'audio';
const STORE_OPERATIONS = 'operations';

export class ReloadRequiredError extends Error {
  constructor() {
    super('Esta pestaña usa una versión anterior de Listar. Recarga la página para continuar.');
    this.name = 'ReloadRequiredError';
    this.code = 'reload-required';
  }
}

export class StaleSnapshotError extends Error {
  constructor(expected, actual) {
    super(`La lista cambió (versión esperada ${expected}, versión actual ${actual}). Vuelve a revisar los cambios.`);
    this.name = 'StaleSnapshotError';
    this.code = 'stale-snapshot';
  }
}

let upgradeBlockedHandler = null;
let pendingOpen = null;

export function setUpgradeBlockedHandler(handler) {
  upgradeBlockedHandler = typeof handler === 'function' ? handler : null;
  return () => {
    if (upgradeBlockedHandler === handler) upgradeBlockedHandler = null;
  };
}

function initializeSchema(event) {
  const db = event.target.result;
  const transaction = event.target.transaction;
  if (!db.objectStoreNames.contains(STORE_LISTS)) {
    const lists = db.createObjectStore(STORE_LISTS, { keyPath: 'id' });
    lists.createIndex('order', 'order', { unique: false });
    lists.createIndex('name', 'name', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_ITEMS)) {
    const items = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
    items.createIndex('listId', 'listId', { unique: false });
    items.createIndex('order', 'order', { unique: false });
    items.createIndex('done', 'done', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_AUDIO)) {
    const audio = db.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
    audio.createIndex('listId', 'listId', { unique: false });
    audio.createIndex('createdAt', 'createdAt', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_OPERATIONS)) {
    db.createObjectStore(STORE_OPERATIONS, { keyPath: 'operationId' });
  }

  if (event.oldVersion < DB_VERSION) {
    const lists = transaction.objectStore(STORE_LISTS);
    const request = lists.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!Number.isInteger(cursor.value.version) || cursor.value.version < 0) {
        cursor.update({ ...cursor.value, version: 0 });
      }
      cursor.continue();
    };
  }
}

function openDB() {
  if (pendingOpen) return pendingOpen;
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.reject(new Error('IndexedDB no está disponible en este navegador.'));
  pendingOpen = new Promise((resolve, reject) => {
    let req;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      pendingOpen = null;
      reject(error);
      return;
    }
    let wasBlocked = false;
    req.onupgradeneeded = initializeSchema;
    req.onblocked = () => {
      wasBlocked = true;
      try {
        upgradeBlockedHandler?.({
          code: 'blocked-upgrade',
          message: 'Cierra o recarga las otras pestañas de Listar para continuar. La operación seguirá cuando se libere la base de datos.',
        });
      } catch { /* Status handlers must not break or restart the single pending upgrade request. */ }
    };
    req.onsuccess = () => {
      if (wasBlocked) {
        try { upgradeBlockedHandler?.({ code: 'upgrade-ready', message: '' }); }
        catch { /* Status handlers must not interfere with the upgraded connection. */ }
      }
      const connection = req.result;
      let closing = false;
      connection.onversionchange = () => {
        closing = true;
        connection.close();
      };
      const database = {
        connection,
        transaction(stores, mode) {
          if (closing) throw new ReloadRequiredError();
          const transaction = connection.transaction(stores, mode);
          const closeAfter = () => connection.close();
          transaction.addEventListener('complete', closeAfter, { once: true });
          transaction.addEventListener('abort', closeAfter, { once: true });
          return transaction;
        },
        close() { connection.close(); },
      };
      pendingOpen = null;
      resolve(database);
    };
    req.onerror = () => {
      pendingOpen = null;
      reject(req.error?.name === 'VersionError' ? new ReloadRequiredError() : req.error);
    };
  });
  return pendingOpen;
}

function runTransaction(stores, mode, work) {
  return openDB().then((database) => new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = database.transaction(stores, mode);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    let value;
    let failure;
    let settled = false;
    const close = () => database.close();
    const abort = (error) => {
      failure ??= error;
      try { transaction.abort(); } catch { /* It may already have completed or aborted. */ }
    };
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };
    transaction.onerror = () => { failure ??= transaction.error; };
    transaction.onabort = () => {
      if (settled) return;
      settled = true;
      close();
      reject(failure || transaction.error || new Error('La transacción de Listar se canceló.'));
    };
    try {
      work({ transaction, setValue(result) { value = result; }, abort });
    } catch (error) {
      abort(error);
    }
  }));
}

let _ts = 0;
function now() { return ++_ts; }

function genId() { return `${now()}-${Math.random().toString(36).slice(2)}`; }

/** List store { id, name, emoji, createdAt, order } */
export class List {
  static async all() {
    return runTransaction(STORE_LISTS, 'readonly', ({ transaction, setValue, abort }) => {
      const request = transaction.objectStore(STORE_LISTS).getAll();
      request.onsuccess = () => setValue(request.result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      request.onerror = () => abort(request.error);
    });
  }
  static async get(id) {
    return runTransaction(STORE_LISTS, 'readonly', ({ transaction, setValue, abort }) => {
      const request = transaction.objectStore(STORE_LISTS).get(id);
      request.onsuccess = () => setValue(request.result);
      request.onerror = () => abort(request.error);
    });
  }
  static async add({ name = '', emoji = '', order = Date.now() } = {}) {
    const id = genId();
    const rec = { id, name, emoji, createdAt: now(), order, version: 0 };
    await runTransaction(STORE_LISTS, 'readwrite', ({ transaction, setValue, abort }) => {
      const request = transaction.objectStore(STORE_LISTS).add(rec);
      request.onsuccess = () => setValue(rec);
      request.onerror = () => abort(request.error);
    });
    return rec;
  }
  static async put(rec) {
    return runTransaction(STORE_LISTS, 'readwrite', ({ transaction, setValue, abort }) => {
      const store = transaction.objectStore(STORE_LISTS);
      const currentRequest = store.get(rec.id);
      currentRequest.onsuccess = () => {
        const current = currentRequest.result;
        const updated = {
          ...(current ?? {}), ...rec,
          version: current ? (current.version ?? 0) + 1 : 0,
        };
        const request = store.put(updated);
        request.onsuccess = () => setValue(updated);
        request.onerror = () => abort(request.error);
      };
      currentRequest.onerror = () => abort(currentRequest.error);
    });
  }
  static async del(id) {
    await runTransaction([STORE_LISTS, STORE_ITEMS, STORE_AUDIO, STORE_OPERATIONS], 'readwrite', ({ transaction, setValue, abort }) => {
      const listStore = transaction.objectStore(STORE_LISTS);
      const itemsRequest = transaction.objectStore(STORE_ITEMS).index('listId').getAll(id);
      const audioRequest = transaction.objectStore(STORE_AUDIO).index('listId').getAll(id);
      const operationsRequest = transaction.objectStore(STORE_OPERATIONS).openCursor();
      let pending = 3;
      const deleteRelated = () => {
        if (--pending > 0) return;
        for (const { id: itemId } of itemsRequest.result) transaction.objectStore(STORE_ITEMS).delete(itemId);
        for (const { id: audioId } of audioRequest.result) transaction.objectStore(STORE_AUDIO).delete(audioId);
        listStore.delete(id);
        setValue(undefined);
      };
      itemsRequest.onsuccess = deleteRelated;
      itemsRequest.onerror = () => abort(itemsRequest.error);
      audioRequest.onsuccess = deleteRelated;
      audioRequest.onerror = () => abort(audioRequest.error);
      operationsRequest.onsuccess = () => {
        const cursor = operationsRequest.result;
        if (!cursor) { deleteRelated(); return; }
        if (cursor.value.listId === id) cursor.delete();
        cursor.continue();
      };
      operationsRequest.onerror = () => abort(operationsRequest.error);
    });
  }
}

const ATTRIBUTE_ROLES = new Set(['observation', 'requirement', 'preference']);
const PRICE_BASIS_TYPES = new Set(['item', 'mass', 'volume', 'package']);
const PRICE_BASIS_UNITS = {
  mass: new Set(['mg', 'g', 'kg', 'oz', 'lb']),
  volume: new Set(['mL', 'L', 'cL', 'fl-oz', 'pt', 'qt', 'gal']),
  package: new Set(['package', 'pack', 'box', 'bottle', 'can', 'bag', 'dozen']),
};
const ISO_CURRENCIES = new Set(
  typeof Intl?.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') :
    ['ARS', 'AUD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'EUR', 'GBP', 'JPY', 'KWD', 'MXN', 'NZD', 'PEN', 'USD', 'UYU'],
);
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value, path, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError(`${path} must contain only JSON-serializable values`);
  if (!Array.isArray(value) && !isPlainObject(value)) throw new TypeError(`${path} must contain only plain JSON values`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) assertJsonValue(child, `${path}.${key}`, seen);
  seen.delete(value);
}

function isValidIsoTimestamp(value) {
  const match = ISO_TIMESTAMP.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) && date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) && date.getUTCSeconds() === Number(second);
}

function validatePrice(assertion, attributeKey) {
  const { value, role, evidence } = assertion;
  if (attributeKey !== 'price') throw new TypeError('Price values must use the price attribute key');
  if (!Number.isSafeInteger(value.amountMinor) || value.amountMinor < 0) {
    throw new TypeError('Price amountMinor must be a non-negative integer');
  }
  if (typeof value.currency !== 'string' || !ISO_CURRENCIES.has(value.currency)) {
    throw new TypeError('Price currency must be an uppercase ISO currency code');
  }
  if (!isPlainObject(value.basis) || !PRICE_BASIS_TYPES.has(value.basis.type)) {
    throw new TypeError('Price basis must be item, mass, volume, or package');
  }
  if (value.basis.type === 'item') {
    if (Object.hasOwn(value.basis, 'unit') || Object.hasOwn(value.basis, 'quantity')) {
      throw new TypeError('Item price basis does not take a unit or quantity');
    }
  } else if (typeof value.basis.unit !== 'string' || !PRICE_BASIS_UNITS[value.basis.type].has(value.basis.unit) ||
      !Number.isFinite(value.basis.quantity) || value.basis.quantity <= 0) {
    throw new TypeError(`Price basis ${value.basis.type} needs a supported unit and positive quantity`);
  }
  if (role === 'observation') {
    if (typeof value.observedAt !== 'string' || !isValidIsoTimestamp(value.observedAt)) {
      throw new TypeError('Price observations need an ISO observedAt timestamp');
    }
    if (typeof evidence.source !== 'string' || !evidence.source.trim()) {
      throw new TypeError('Price observations need an evidence source');
    }
  } else if (Object.hasOwn(value, 'observedAt')) {
    throw new TypeError('Price requirements and preferences do not have observation timestamps');
  }
}

function validateAttributes(attributes) {
  if (!isPlainObject(attributes)) throw new TypeError('attributes must be a map of assertion arrays');
  const ids = new Set();
  for (const [key, assertions] of Object.entries(attributes)) {
    if (!key.trim() || key !== key.trim() || !Array.isArray(assertions)) {
      throw new TypeError('Each attribute key must be a trimmed string mapped to an assertion array');
    }
    for (const assertion of assertions) {
      if (!isPlainObject(assertion)) throw new TypeError('Assertions must be plain objects');
      if (typeof assertion.id !== 'string' || !assertion.id.trim() || assertion.id !== assertion.id.trim()) {
        throw new TypeError('Assertion IDs must be non-empty trimmed strings');
      }
      if (ids.has(assertion.id)) throw new TypeError(`Duplicate assertion ID: ${assertion.id}`);
      ids.add(assertion.id);
      if (!ATTRIBUTE_ROLES.has(assertion.role)) throw new TypeError(`Invalid assertion role: ${assertion.role}`);
      if (!isPlainObject(assertion.value) || typeof assertion.value.type !== 'string' || !assertion.value.type.trim()) {
        throw new TypeError('Assertions need a typed value object');
      }
      if (!isPlainObject(assertion.evidence)) throw new TypeError('Assertions need an evidence object');
      assertJsonValue(assertion, `attribute ${key}`);
      if (assertion.value.type === 'price') validatePrice(assertion, key);
      else if (key === 'price') throw new TypeError('The price attribute must use a typed price value');
    }
  }
}

/** Validate a serializable attributes map without opening IndexedDB. */
export function validateItemAttributes(attributes) {
  validateAttributes(attributes);
  return attributes;
}

function preserveAssertionIdentity(previous, next) {
  if (!previous?.attributes) return;
  const nextById = new Map();
  for (const [key, assertions] of Object.entries(next ?? {})) {
    for (const assertion of assertions) nextById.set(assertion.id, { key, assertion });
  }
  for (const [key, assertions] of Object.entries(previous.attributes)) {
    for (const assertion of assertions) {
      const replacement = nextById.get(assertion.id);
      if (!replacement) throw new TypeError(`Assertion ${assertion.id} must be removed explicitly`);
      if (replacement.key !== key) throw new TypeError(`Assertion ${assertion.id} cannot move to another attribute key`);
      if (replacement.assertion.role !== assertion.role) throw new TypeError(`Assertion ${assertion.id} role is immutable`);
    }
  }
}

async function mutateItemAttributes(id, update) {
  return runTransaction([STORE_LISTS, STORE_ITEMS], 'readwrite', ({ transaction, setValue, abort }) => {
    const itemStore = transaction.objectStore(STORE_ITEMS);
    const request = itemStore.get(id);
    request.onsuccess = () => {
      const item = request.result;
      if (!item) { abort(new Error(`Item not found: ${id}`)); return; }
      const listRequest = transaction.objectStore(STORE_LISTS).get(item.listId);
      listRequest.onerror = () => abort(listRequest.error);
      listRequest.onsuccess = () => {
        const list = listRequest.result;
        if (!list) { abort(new Error(`List not found: ${item.listId}`)); return; }
        try {
          const attributes = Object.fromEntries(Object.entries(item.attributes ?? {}).map(([key, values]) => [key, [...values]]));
          update(attributes);
          validateAttributes(attributes);
          const updated = { ...item, attributes };
          transaction.objectStore(STORE_LISTS).put({ ...list, version: (list.version ?? 0) + 1 });
          itemStore.put(updated);
          setValue(updated);
        } catch (error) {
          abort(error);
        }
      };
    };
    request.onerror = () => abort(request.error);
  });
}

/** Item store { id, listId, label, text, quantity?, unit?, done, createdAt, order, sourceAudioId?, attributes?: { [key: string]: Assertion[] } } */
export class Item {
  static async get(id) {
    return runTransaction(STORE_ITEMS, 'readonly', ({ transaction, setValue, abort }) => {
      const request = transaction.objectStore(STORE_ITEMS).get(id);
      request.onsuccess = () => setValue(request.result);
      request.onerror = () => abort(request.error);
    });
  }
  static async list(listId) {
    return runTransaction(STORE_ITEMS, 'readonly', ({ transaction, setValue, abort }) => {
      const request = transaction.objectStore(STORE_ITEMS).index('listId').getAll(listId);
      request.onsuccess = () => setValue(request.result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      request.onerror = () => abort(request.error);
    });
  }
  static async add(input = {}) {
    const { listId, label, text = '', quantity, unit, order = Date.now(), sourceAudioId, attributes } = input;
    if (Object.hasOwn(input, 'attributes')) validateAttributes(attributes);
    const id = genId();
    const rec = {
      id, listId, label, text,
      ...(quantity === undefined ? {} : { quantity }),
      ...(unit === undefined ? {} : { unit }),
      done: false, createdAt: now(), order,
      ...(sourceAudioId === undefined ? {} : { sourceAudioId }),
      ...(Object.hasOwn(input, 'attributes') ? { attributes } : {}),
    };
    await runTransaction([STORE_LISTS, STORE_ITEMS], 'readwrite', ({ transaction, setValue, abort }) => {
      const listStore = transaction.objectStore(STORE_LISTS);
      const listRequest = listStore.get(listId);
      listRequest.onsuccess = () => {
        const list = listRequest.result;
        if (!list) { abort(new Error(`List not found: ${listId}`)); return; }
        listStore.put({ ...list, version: (list.version ?? 0) + 1 });
        const request = transaction.objectStore(STORE_ITEMS).add(rec);
        request.onsuccess = () => setValue(rec);
        request.onerror = () => abort(request.error);
      };
      listRequest.onerror = () => abort(listRequest.error);
    });
    return rec;
  }
  static async put(rec) {
    return runTransaction([STORE_LISTS, STORE_ITEMS], 'readwrite', ({ transaction, setValue, abort }) => {
      const itemStore = transaction.objectStore(STORE_ITEMS);
      const currentRequest = itemStore.get(rec.id);
      currentRequest.onsuccess = () => {
        let result;
        try {
          const current = currentRequest.result;
          if (current && rec.listId != null && rec.listId !== current.listId) {
            throw new TypeError('An item cannot move between lists');
          }
          result = { ...(current ?? {}), ...rec, listId: current?.listId ?? rec.listId };
          if (currentRequest.result?.attributes && !Object.hasOwn(rec, 'attributes')) {
            result.attributes = currentRequest.result.attributes;
          }
          if (Object.hasOwn(result, 'attributes')) {
            validateAttributes(result.attributes);
            preserveAssertionIdentity(current, result.attributes);
          }
        } catch (error) {
          abort(error);
          return;
        }
        if (typeof result.listId !== 'string' || !result.listId) { abort(new TypeError('Items need a listId')); return; }
        const listStore = transaction.objectStore(STORE_LISTS);
        const listRequest = listStore.get(result.listId);
        listRequest.onsuccess = () => {
          const list = listRequest.result;
          if (!list) { abort(new Error(`List not found: ${result.listId}`)); return; }
          listStore.put({ ...list, version: (list.version ?? 0) + 1 });
          const request = itemStore.put(result);
          request.onsuccess = () => setValue(result);
          request.onerror = () => abort(request.error);
        };
        listRequest.onerror = () => abort(listRequest.error);
      };
      currentRequest.onerror = () => abort(currentRequest.error);
    });
  }
  static async appendAttribute(id, key, assertion) {
    return mutateItemAttributes(id, (attributes) => {
      if (typeof key !== 'string' || !key.trim() || key !== key.trim()) throw new TypeError('Attribute key must be a non-empty trimmed string');
      attributes[key] = [...(attributes[key] ?? []), assertion];
    });
  }
  static async replaceAttribute(id, key, assertionId, replacement) {
    return mutateItemAttributes(id, (attributes) => {
      const values = attributes[key];
      const index = values?.findIndex((assertion) => assertion.id === assertionId) ?? -1;
      if (index < 0) throw new Error(`Assertion not found: ${key}/${assertionId}`);
      const current = values[index];
      if (Object.hasOwn(replacement, 'id') && replacement.id !== assertionId) {
        throw new TypeError(`Assertion ${assertionId} ID is immutable`);
      }
      if (Object.hasOwn(replacement, 'role') && replacement.role !== current.role) {
        throw new TypeError(`Assertion ${assertionId} role is immutable`);
      }
      values[index] = { ...current, value: replacement.value, evidence: replacement.evidence };
    });
  }
  static async removeAttribute(id, key, assertionId) {
    return mutateItemAttributes(id, (attributes) => {
      const values = attributes[key];
      const index = values?.findIndex((assertion) => assertion.id === assertionId) ?? -1;
      if (index < 0) throw new Error(`Assertion not found: ${key}/${assertionId}`);
      values.splice(index, 1);
      if (values.length === 0) delete attributes[key];
    });
  }
  static async del(id) {
    return runTransaction([STORE_LISTS, STORE_ITEMS], 'readwrite', ({ transaction, setValue, abort }) => {
      const itemStore = transaction.objectStore(STORE_ITEMS);
      const request = itemStore.get(id);
      request.onsuccess = () => {
        const item = request.result;
        if (!item) { setValue(undefined); return; }
        const listStore = transaction.objectStore(STORE_LISTS);
        const listRequest = listStore.get(item.listId);
        listRequest.onsuccess = () => {
          const list = listRequest.result;
          if (!list) { abort(new Error(`List not found: ${item.listId}`)); return; }
          listStore.put({ ...list, version: (list.version ?? 0) + 1 });
          const deletion = itemStore.delete(id);
          deletion.onsuccess = () => setValue(undefined);
          deletion.onerror = () => abort(deletion.error);
        };
        listRequest.onerror = () => abort(listRequest.error);
      };
      request.onerror = () => abort(request.error);
    });
  }
}

/** Audio store { id, listId, blob, transcript, model, createdAt } */
export class Audio {
  static async add({ listId, blob = null, transcript = '', model = '' } = {}) {
    const id = genId();
    const rec = { id, listId, blob, transcript, model, createdAt: now() };
    await runTransaction(STORE_AUDIO, 'readwrite', ({ transaction, setValue, abort }) => {
      const request = transaction.objectStore(STORE_AUDIO).add(rec);
      request.onsuccess = () => setValue(rec);
      request.onerror = () => abort(request.error);
    });
    return rec;
  }
  static async byList(listId) {
    return runTransaction(STORE_AUDIO, 'readonly', ({ transaction, setValue, abort }) => {
      const request = transaction.objectStore(STORE_AUDIO).index('listId').getAll(listId);
      request.onsuccess = () => setValue(request.result.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)));
      request.onerror = () => abort(request.error);
    });
  }
  static async del(id) {
    return runTransaction(STORE_AUDIO, 'readwrite', ({ transaction, setValue, abort }) => {
      const request = transaction.objectStore(STORE_AUDIO).delete(id);
      request.onsuccess = () => setValue(undefined);
      request.onerror = () => abort(request.error);
    });
  }
}

function stableSerialize(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return `boolean:${value}`;
  if (typeof value === 'number' && Number.isFinite(value)) return `number:${JSON.stringify(value)}`;
  if (Array.isArray(value)) return `array:[${value.map(stableSerialize).join(',')}]`;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError('Operation payload must contain only serializable JSON values');
  }
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
  return `object:{${entries.join(',')}}`;
}

/** Read list version and its items together; only expose the snapshot after transaction completion. */
export function readSnapshot(listId) {
  return runTransaction([STORE_LISTS, STORE_ITEMS], 'readonly', ({ transaction, setValue, abort }) => {
    const listRequest = transaction.objectStore(STORE_LISTS).get(listId);
    const itemsRequest = transaction.objectStore(STORE_ITEMS).index('listId').getAll(listId);
    let listReady = false;
    let itemsReady = false;
    let list;
    let items;
    const finish = () => {
      if (!listReady || !itemsReady) return;
      if (!list) { abort(new Error(`List not found: ${listId}`)); return; }
      setValue({
        listId,
        version: Number.isInteger(list.version) && list.version >= 0 ? list.version : 0,
        items: items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      });
    };
    listRequest.onsuccess = () => { list = listRequest.result; listReady = true; finish(); };
    listRequest.onerror = () => abort(listRequest.error);
    itemsRequest.onsuccess = () => { items = itemsRequest.result; itemsReady = true; finish(); };
    itemsRequest.onerror = () => abort(itemsRequest.error);
  });
}

/** Atomically apply a confirmed batch, advance its list version, and persist its replay receipt. */
export async function commitCommands({ snapshot, commands, operationId } = {}) {
  if (!snapshot || typeof snapshot.listId !== 'string' || !snapshot.listId || !Number.isInteger(snapshot.version) || snapshot.version < 0) {
    throw new TypeError('A command commit needs a list snapshot with listId and version');
  }
  if (typeof operationId !== 'string' || !operationId.trim() || operationId !== operationId.trim()) {
    throw new TypeError('A command commit needs a stable operationId');
  }
  if (!Array.isArray(commands)) throw new TypeError('A command commit needs a command array');
  const listId = snapshot.listId;
  const expectedVersion = snapshot.version;
  let commandSnapshot;
  try {
    commandSnapshot = typeof structuredClone === 'function'
      ? structuredClone(commands)
      : JSON.parse(JSON.stringify(commands));
  } catch {
    throw new TypeError('Operation commands must be serializable before commit');
  }
  const payload = stableSerialize({ listId, commands: commandSnapshot });
  const { applyCommands } = await import('./command-reducer.mjs');

  return runTransaction([STORE_LISTS, STORE_ITEMS, STORE_OPERATIONS], 'readwrite', ({ transaction, setValue, abort }) => {
    const listRequest = transaction.objectStore(STORE_LISTS).get(listId);
    const itemRequest = transaction.objectStore(STORE_ITEMS).index('listId').getAll(listId);
    const receiptRequest = transaction.objectStore(STORE_OPERATIONS).get(operationId);
    let listReady = false;
    let itemsReady = false;
    let receiptReady = false;
    let list;
    let currentItems;
    let receipt;

    const applyWhenReady = () => {
      if (!listReady || !itemsReady || !receiptReady) return;
      try {
        if (receipt) {
          if (receipt.payload !== payload) throw new Error(`Operation ID ${operationId} was already used with a different payload`);
          setValue(receipt.result);
          return;
        }
        if (!list) throw new Error(`List not found: ${listId}`);
        const actualVersion = Number.isInteger(list.version) && list.version >= 0 ? list.version : 0;
        if (expectedVersion !== actualVersion) throw new StaleSnapshotError(expectedVersion, actualVersion);
        const currentSnapshot = {
          listId,
          version: actualVersion,
          items: currentItems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        };
        const reduced = applyCommands(currentSnapshot, commandSnapshot);
        const changed = reduced !== currentSnapshot;
        const committedVersion = changed ? actualVersion + 1 : actualVersion;
        const result = { listId, version: committedVersion, items: reduced.items };

        const beforeById = new Map(currentItems.map((item) => [item.id, item]));
        const afterById = new Map(reduced.items.map((item) => [item.id, item]));
        const itemStore = transaction.objectStore(STORE_ITEMS);
        for (const [id, before] of beforeById) {
          if (!afterById.has(id)) itemStore.delete(id);
          else if (stableSerialize(before) !== stableSerialize(afterById.get(id))) itemStore.put(afterById.get(id));
        }
        for (const [id, after] of afterById) if (!beforeById.has(id)) itemStore.add(after);
        if (changed) transaction.objectStore(STORE_LISTS).put({ ...list, version: committedVersion });
        transaction.objectStore(STORE_OPERATIONS).add({ operationId, listId, payload, result, createdAt: now() });
        setValue(result);
      } catch (error) {
        abort(error);
      }
    };

    listRequest.onsuccess = () => { list = listRequest.result; listReady = true; applyWhenReady(); };
    listRequest.onerror = () => abort(listRequest.error);
    itemRequest.onsuccess = () => { currentItems = itemRequest.result; itemsReady = true; applyWhenReady(); };
    itemRequest.onerror = () => abort(itemRequest.error);
    receiptRequest.onsuccess = () => { receipt = receiptRequest.result; receiptReady = true; applyWhenReady(); };
    receiptRequest.onerror = () => abort(receiptRequest.error);
  });
}
