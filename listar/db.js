// db.js — IndexedDB wrapper for Listar. List/Item/Audio stores, CRUD, ordering, per-list queries.
// jams-y8c.
const DB_NAME = 'listar';
const DB_VERSION = 1;

const STORE_LISTS = 'lists';
const STORE_ITEMS = 'items';
const STORE_AUDIO = 'audio';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_LISTS)) {
        const ls = db.createObjectStore(STORE_LISTS, { keyPath: 'id' });
        ls.createIndex('order', 'order', { unique: false });
        ls.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const is_ = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        is_.createIndex('listId', 'listId', { unique: false });
        is_.createIndex('order', 'order', { unique: false });
        is_.createIndex('done', 'done', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        const as_ = db.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
        as_.createIndex('listId', 'listId', { unique: false });
        as_.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let _ts = 0;
function now() { return ++_ts; }

function genId() { return `${now()}-${Math.random().toString(36).slice(2)}`; }

/** List store { id, name, emoji, createdAt, order } */
export class List {
  static async all() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LISTS, 'readonly');
      const store = tx.objectStore(STORE_LISTS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      req.onerror = () => reject(req.error);
    });
  }
  static async get(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_LISTS).objectStore(STORE_LISTS).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  static async add({ name = '', emoji = '', order = Date.now() } = {}) {
    const id = genId();
    const rec = { id, name, emoji, createdAt: now(), order };
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_LISTS, 'readwrite').objectStore(STORE_LISTS).add(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return rec;
  }
  static async put(rec) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_LISTS, 'readwrite').objectStore(STORE_LISTS).put(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return rec;
  }
  static async del(id) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_LISTS, 'readwrite').objectStore(STORE_LISTS).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

/** Item store { id, listId, label, text, quantity?, unit?, done, createdAt, order, sourceAudioId? } */
export class Item {
  static async list(listId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ITEMS, 'readonly');
      const store = tx.objectStore(STORE_ITEMS);
      const idx = store.index('listId');
      const req = idx.getAll(IDBKeyRange.only(listId));
      req.onsuccess = () => resolve(req.result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      req.onerror = () => reject(req.error);
    });
  }
  static async add({ listId, label, text = '', quantity, unit, order = Date.now(), sourceAudioId } = {}) {
    const id = genId();
    const rec = {
      id, listId, label, text, quantity, unit,
      done: false, createdAt: now(), order, sourceAudioId,
    };
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_ITEMS, 'readwrite').objectStore(STORE_ITEMS).add(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return rec;
  }
  static async put(rec) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_ITEMS, 'readwrite').objectStore(STORE_ITEMS).put(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return rec;
  }
  static async del(id) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_ITEMS, 'readwrite').objectStore(STORE_ITEMS).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

/** Audio store { id, listId, blob, transcript, model, createdAt } */
export class Audio {
  static async add({ listId, blob = null, transcript = '', model = '' } = {}) {
    const id = genId();
    const rec = { id, listId, blob, transcript, model, createdAt: now() };
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_AUDIO, 'readwrite').objectStore(STORE_AUDIO).add(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return rec;
  }
  static async byList(listId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUDIO, 'readonly');
      const store = tx.objectStore(STORE_AUDIO);
      const idx = store.index('listId');
      const req = idx.getAll(IDBKeyRange.only(listId));
      req.onsuccess = () => resolve(req.result.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)));
      req.onerror = () => reject(req.error);
    });
  }
  static async del(id) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_AUDIO, 'readwrite').objectStore(STORE_AUDIO).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
