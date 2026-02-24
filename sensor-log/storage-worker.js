'use strict';
// Web Worker: handles OPFS binary writes and IndexedDB session metadata.
// Runs dedicated so createSyncAccessHandle() is available.

let syncHandle = null;
let writePos = 0;
let db = null;
let currentSessionId = null;

// ─── IndexedDB helpers ───────────────────────────────────────────────────────
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('SensorLogDB', 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('sessions')) {
        d.createObjectStore('sessions', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => res(e.target.result);
    req.onerror = () => rej(req.error);
  });
}

function dbPut(item) {
  return new Promise((res, rej) => {
    const tx = db.transaction('sessions', 'readwrite');
    const req = tx.objectStore('sessions').put(item);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

function dbGet(id) {
  return new Promise((res, rej) => {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function dbGetAll() {
  return new Promise((res, rej) => {
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function dbDelete(id) {
  return new Promise((res, rej) => {
    const tx = db.transaction('sessions', 'readwrite');
    const req = tx.objectStore('sessions').delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

// ─── OPFS helpers ────────────────────────────────────────────────────────────
async function getOPFSDir() {
  return navigator.storage.getDirectory();
}

// ─── Session init ────────────────────────────────────────────────────────────
async function initSession(sessionId, meta) {
  currentSessionId = sessionId;
  const dir = await getOPFSDir();
  const fileHandle = await dir.getFileHandle(`session-${sessionId}.bin`, { create: true });
  syncHandle = await fileHandle.createSyncAccessHandle();

  // Binary header: [4 bytes: header_json_len][header_json_bytes]
  const headerJSON = JSON.stringify({ sessionId, ...meta });
  const headerBytes = new TextEncoder().encode(headerJSON);
  const lenBuf = new ArrayBuffer(4);
  new DataView(lenBuf).setUint32(0, headerBytes.byteLength, true);

  syncHandle.write(lenBuf, { at: 0 });
  syncHandle.write(headerBytes.buffer, { at: 4 });
  syncHandle.flush();
  writePos = 4 + headerBytes.byteLength;

  await dbPut({
    id: sessionId,
    ...meta,
    status: 'recording',
    opfsFile: `session-${sessionId}.bin`,
    startTime: meta.startTime || Date.now()
  });

  self.postMessage({ type: 'initDone', sessionId });
}

// ─── Write a batch of sensor samples ────────────────────────────────────────
// buffer: ArrayBuffer (Float64Array.buffer), sensorId: 0-6
function writeBatch(buffer, sensorId) {
  if (!syncHandle) return;
  // Block format: [4 bytes: total_block_len][1 byte: sensorId][float64 data...]
  const totalLen = 1 + buffer.byteLength;
  const lenBuf = new ArrayBuffer(4);
  new DataView(lenBuf).setUint32(0, totalLen, true);

  const sidBuf = new Uint8Array([sensorId & 0xff]);

  syncHandle.write(lenBuf, { at: writePos });
  writePos += 4;
  syncHandle.write(sidBuf.buffer, { at: writePos });
  writePos += 1;
  syncHandle.write(buffer, { at: writePos });
  writePos += buffer.byteLength;
}

// ─── Flush to OS ─────────────────────────────────────────────────────────────
function doFlush() {
  if (syncHandle) syncHandle.flush();
}

// ─── Close session ────────────────────────────────────────────────────────────
async function closeSession(endTime, sampleCounts) {
  if (syncHandle) {
    syncHandle.flush();
    syncHandle.close();
    syncHandle = null;
  }
  if (currentSessionId && db) {
    const existing = await dbGet(currentSessionId);
    if (existing) {
      await dbPut({
        ...existing,
        status: 'completed',
        endTime,
        sampleCounts,
        durationMs: endTime - existing.startTime
      });
    }
  }
  currentSessionId = null;
  writePos = 0;
  self.postMessage({ type: 'closeDone' });
}

// ─── Read session for export ─────────────────────────────────────────────────
async function readSession(sessionId) {
  const meta = await dbGet(sessionId);
  const dir = await getOPFSDir();
  try {
    const fileHandle = await dir.getFileHandle(`session-${sessionId}.bin`);
    const sh = await fileHandle.createSyncAccessHandle();
    const size = sh.getSize();
    if (size === 0) { sh.close(); throw new Error('Empty file'); }

    const raw = new ArrayBuffer(size);
    sh.read(raw, { at: 0 });
    sh.close();

    const dv = new DataView(raw);
    const headerLen = dv.getUint32(0, true);
    const headerText = new TextDecoder().decode(new Uint8Array(raw, 4, headerLen));
    const header = JSON.parse(headerText);

    // Parse blocks: sensorId → array of Float64Array rows
    const sensorData = {};
    let pos = 4 + headerLen;
    while (pos + 5 <= size) {
      const blockLen = dv.getUint32(pos, true);
      pos += 4;
      if (pos + blockLen > size) break;
      const sid = dv.getUint8(pos);
      pos += 1;
      const floatBytes = blockLen - 1;
      const floatCount = floatBytes / 8;
      const floats = new Float64Array(floatCount);
      for (let i = 0; i < floatCount; i++) {
        floats[i] = dv.getFloat64(pos + i * 8, true);
      }
      pos += floatBytes;
      if (!sensorData[sid]) sensorData[sid] = [];
      sensorData[sid].push(floats);
    }

    self.postMessage({ type: 'sessionData', sessionId, header, meta, sensorData });
  } catch (e) {
    self.postMessage({ type: 'sessionData', sessionId, meta, error: e.message });
  }
}

// ─── List all sessions ────────────────────────────────────────────────────────
async function listSessions() {
  const sessions = await dbGetAll();
  sessions.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  self.postMessage({ type: 'sessionsList', sessions });
}

// ─── Delete a session ─────────────────────────────────────────────────────────
async function deleteSession(sessionId) {
  const dir = await getOPFSDir();
  try { await dir.removeEntry(`session-${sessionId}.bin`); } catch (_) {}
  await dbDelete(sessionId);
  self.postMessage({ type: 'deleteSessionDone', sessionId });
}

// ─── Check for interrupted sessions on startup ───────────────────────────────
async function checkInterrupted() {
  const sessions = await dbGetAll();
  const interrupted = sessions.filter(s => s.status === 'recording');
  for (const s of interrupted) {
    await dbPut({ ...s, status: 'interrupted' });
  }
  self.postMessage({ type: 'interruptedSessions', sessions: interrupted });
}

// ─── Get file size for a session ─────────────────────────────────────────────
async function getSessionSize(sessionId) {
  const dir = await getOPFSDir();
  try {
    const fh = await dir.getFileHandle(`session-${sessionId}.bin`);
    const sh = await fh.createSyncAccessHandle();
    const size = sh.getSize();
    sh.close();
    self.postMessage({ type: 'sessionSize', sessionId, size });
  } catch (_) {
    self.postMessage({ type: 'sessionSize', sessionId, size: 0 });
  }
}

// ─── Message dispatcher ───────────────────────────────────────────────────────
self.onmessage = async ({ data }) => {
  try {
    if (!db && data.type !== 'writeBatch' && data.type !== 'flush') {
      db = await openDB();
    }
    switch (data.type) {
      case 'init':
        if (!db) db = await openDB();
        await initSession(data.sessionId, data.meta);
        break;
      case 'writeBatch':
        writeBatch(data.buffer, data.sensorId);
        break;
      case 'flush':
        doFlush();
        break;
      case 'close':
        await closeSession(data.endTime, data.sampleCounts);
        break;
      case 'readSession':
        await readSession(data.sessionId);
        break;
      case 'listSessions':
        await listSessions();
        break;
      case 'deleteSession':
        await deleteSession(data.sessionId);
        break;
      case 'checkInterrupted':
        await checkInterrupted();
        break;
      case 'getSessionSize':
        await getSessionSize(data.sessionId);
        break;
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message, context: data.type });
  }
};
