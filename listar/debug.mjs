// Purpose: store optional local diagnostics without exposing dictated content by default.
// Responsibilities: redact, bound, persist, clear, and export semantic application events.
// Rationale: local troubleshooting should not alter app behavior or transmit user data.

export const DEBUG_OPTIONS_KEY = 'listar-debug-options';
export const DEBUG_LOG_KEY = 'listar-debug-log';
export const DEBUG_MAX_EVENTS = 500;
export const DEBUG_MAX_BYTES = 256 * 1024;
const REDACTED = '[redacted]';
const OMITTED = '[omitted]';
const SAFE_STRING_KEYS = new Set([
  'listId', 'operationId', 'correlationId', 'route', 'phase', 'kind', 'modelKey', 'language',
  'store', 'mode', 'errorName', 'mediaSource', 'mimeType', 'status', 'intent', 'intents', 'optionKeys', 'stores',
  'targetId', 'controlType', 'eventType', 'action', 'tag', 'diagnosticCodes', 'targetItemIds',
]);
const SAFE_NUMBER_KEYS = new Set(['progress', 'sampleCount', 'sampleRate', 'duration', 'byteLength', 'candidateCount', 'candidateIndex', 'commandCount', 'segmentCount', 'itemCount', 'selectedCount', 'version', 'retryCount', 'count']);
const SAFE_BOOLEAN_KEYS = new Set(['empty', 'saveAudio', 'debugEnabled', 'captureText', 'selectedIdentity', 'selected', 'checked', 'hasTarget', 'hasAssertion', 'hasPriceAmount', 'hasObservedAt', 'requiresChoice', 'online']);
const BINARY_KEYS = /(?:audio|blob|buffer|binary|file|pcm|samples)/iu;

let nextStorageId = 0;

function resolveStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function makeId(prefix) {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${globalThis.crypto.randomUUID()}`;
  } catch { /* Fall through for older/locked-down browser contexts. */ }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function safeOptions(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(DEBUG_OPTIONS_KEY) || '{}');
    return {
      enabled: parsed.enabled === true,
      captureText: parsed.captureText === true,
    };
  } catch { return { enabled: false, captureText: false }; }
}

function sanitize(value, { captureText, depth = 0, key = '' }) {
  if (BINARY_KEYS.test(key)) return OMITTED;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return OMITTED;
  if (typeof File !== 'undefined' && value instanceof File) return OMITTED;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return OMITTED;
  if (captureText && value === null) return null;
  if (captureText && (typeof value === 'boolean' || typeof value === 'number')) return value;
  if (captureText && typeof value === 'string') return value.slice(0, 500);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if ((typeof value === 'number' && SAFE_NUMBER_KEYS.has(key)) || (typeof value === 'boolean' && SAFE_BOOLEAN_KEYS.has(key))) return value;
    return OMITTED;
  }
  if (typeof value === 'string') return SAFE_STRING_KEYS.has(key) ? value.slice(0, 160) : REDACTED;
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return OMITTED;
  if (depth >= 4) return OMITTED;
  if (Array.isArray(value)) return value.slice(0, 30).map((entry) => sanitize(entry, { captureText, depth: depth + 1, key }));
  if (typeof value === 'object') {
    const clean = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 40)) {
      clean[childKey] = sanitize(childValue, { captureText, depth: depth + 1, key: childKey });
    }
    return clean;
  }
  return OMITTED;
}

function byteLength(value) {
  try { return new TextEncoder().encode(value).length; }
  catch { return value.length * 2; }
}

function loadLog(storage) {
  try {
    const value = JSON.parse(storage?.getItem(DEBUG_LOG_KEY) || '{}');
    return {
      events: Array.isArray(value.events) ? value.events : [],
      droppedEventCount: Number.isSafeInteger(value.droppedEventCount) && value.droppedEventCount > 0 ? value.droppedEventCount : 0,
    };
  } catch { return { events: [], droppedEventCount: 0 }; }
}

export function createDebugLogger({
  storage,
  sessionId = makeId('session'),
  now = () => new Date().toISOString(),
  maxEvents = DEBUG_MAX_EVENTS,
  maxBytes = DEBUG_MAX_BYTES,
  environment = () => ({
    app: 'Listar',
    userAgent: globalThis.navigator?.userAgent ?? 'unknown',
    language: globalThis.navigator?.language ?? 'unknown',
    platform: globalThis.navigator?.platform ?? 'unknown',
    online: typeof globalThis.navigator?.onLine === 'boolean' ? globalThis.navigator.onLine : null,
  }),
} = {}) {
  const target = resolveStorage(storage);
  const memoryKey = `memory-${++nextStorageId}`;
  let memoryOptions = safeOptions(target);
  let memoryLog = loadLog(target);
  let useMemory = false;
  const limits = {
    maxEvents: Number.isSafeInteger(maxEvents) && maxEvents > 0 ? maxEvents : DEBUG_MAX_EVENTS,
    maxBytes: Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : DEBUG_MAX_BYTES,
  };
  let disposed = false;

  function persist(log) {
    const serialized = JSON.stringify(log);
    try {
      if (!target) throw new Error('No persistent storage');
      target.setItem(DEBUG_LOG_KEY, serialized);
      memoryLog = log;
      useMemory = false;
      return true;
    } catch {
      memoryLog = log;
      useMemory = true;
      return true;
    }
  }

  function currentOptions() {
    const persisted = safeOptions(target);
    // Once storage has failed, keep this logger usable for the rest of the session.
    if (useMemory) return memoryOptions;
    memoryOptions = persisted;
    return persisted;
  }

  function currentLog() {
    if (useMemory) return memoryLog;
    const persisted = loadLog(target);
    memoryLog = persisted;
    return persisted;
  }

  function configure(patch = {}) {
    const current = currentOptions();
    const next = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
      captureText: typeof patch.captureText === 'boolean' ? patch.captureText : current.captureText,
    };
    memoryOptions = next;
    try {
      if (!target) throw new Error('No persistent storage');
      target.setItem(DEBUG_OPTIONS_KEY, JSON.stringify(next));
    } catch { useMemory = true; }
    return next;
  }

  function record(name, fields = {}, metadata = {}) {
    if (disposed) return false;
    const options = currentOptions();
    if (!options.enabled) return false;
    const event = {
      timestamp: now(),
      sessionId,
      ...(typeof metadata.correlationId === 'string' ? { correlationId: metadata.correlationId } : {}),
      ...(typeof metadata.requestId === 'string' || Number.isSafeInteger(metadata.requestId) ? { requestId: metadata.requestId } : {}),
      ...(typeof metadata.operationId === 'string' ? { operationId: metadata.operationId } : {}),
      name: /^[a-z][a-z0-9._-]{0,99}$/iu.test(String(name)) ? String(name) : 'app.event',
      fields: sanitize(fields, { captureText: options.captureText }),
    };
    const log = currentLog();
    event.sequence = (log.events.at(-1)?.sequence ?? 0) + 1;
    log.events.push(event);
    while (log.events.length > limits.maxEvents) {
      log.events.shift();
      log.droppedEventCount += 1;
    }
    while (log.events.length && byteLength(JSON.stringify(log)) > limits.maxBytes) {
      log.events.shift();
      log.droppedEventCount += 1;
    }
    if (byteLength(JSON.stringify(log)) > limits.maxBytes) {
      log.droppedEventCount += 1;
      return false;
    }
    return persist(log);
  }

  function exportLog() {
    const log = currentLog();
    let env = {};
    try { env = sanitize(environment(), { captureText: true }); } catch { env = {}; }
    return {
      schemaVersion: 1,
      exportedAt: now(),
      environment: env,
      events: log.events.map((event) => ({ ...event, fields: sanitize(event.fields, { captureText: currentOptions().captureText }) })),
      droppedEventCount: log.droppedEventCount,
    };
  }

  function clear() {
    if (disposed) return false;
    memoryLog = { events: [], droppedEventCount: 0 };
    try { target?.removeItem(DEBUG_LOG_KEY); useMemory = !target; return Boolean(target); }
    catch { useMemory = true; return true; }
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    return true;
  }

  return { configure, record, export: exportLog, clear, dispose, getOptions: currentOptions };
}

const defaultLogger = createDebugLogger();
let testLogger = null;

export function configureDebug(patch) { return defaultLogger.configure(patch); }
function activeLogger() { return testLogger ?? defaultLogger; }
export function getDebugOptions() { return activeLogger().getOptions(); }
export function recordDebugEvent(name, fields, metadata) {
  const logger = activeLogger();
  try { return logger.record(name, fields, metadata); } catch { return false; }
}
export function exportDebugLog() { return defaultLogger.export(); }
export function clearDebugLog() { return defaultLogger.clear(); }

function stableToken(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(value) ? value : undefined;
}

export function describeDebugInteraction(eventType, target, captureText = getDebugOptions().captureText) {
  if (!['click', 'input', 'change', 'submit'].includes(eventType) || !target) return null;
  const tag = String(target.tagName ?? '').toLowerCase();
  const controlType = ['text', 'checkbox', 'radio', 'button', 'submit', 'file', 'range', 'number', 'search', 'date', 'datetime-local', 'email', 'tel', 'url'].includes(target.type)
    ? target.type : undefined;
  const targetId = stableToken(target.dataset?.debugTarget) ?? stableToken(target.id);
  const candidateText = target.dataset?.debugCandidate;
  const candidateIndex = typeof candidateText === 'string' && /^\d{1,4}$/u.test(candidateText) ? Number(candidateText) : undefined;
  const fields = {
    eventType,
    action: eventType,
    ...(tag ? { tag } : {}),
    ...(targetId ? { targetId } : {}),
    ...(controlType ? { controlType } : {}),
    ...(candidateIndex === undefined ? {} : { candidateIndex }),
  };
  if (captureText && typeof target.checked === 'boolean') fields.checked = target.checked;
  if (captureText && ['input', 'textarea', 'select'].includes(tag) && !['file', 'password'].includes(controlType) && typeof target.value === 'string') {
    fields.value = target.value.slice(0, 500);
  }
  return fields;
}

export function attachDebugInteractionListeners(documentObject = globalThis.document) {
  if (!documentObject?.addEventListener || !documentObject?.removeEventListener) return () => {};
  const types = ['click', 'input', 'change', 'submit'];
  const handlers = new Map(types.map((type) => [type, (event) => {
    const target = event.target?.closest?.('[data-debug-target], [id]') ?? event.target;
    if (type === 'change' && target?.id === 'debug-log-setting' && target.checked === false) {
      activeLogger().configure({ enabled: false });
    }
    if (type === 'change' && target?.id === 'debug-text-setting' && target.checked === false) {
      activeLogger().configure({ captureText: false });
    }
    const fields = describeDebugInteraction(type, target);
    if (fields) recordDebugEvent('ui.interaction', fields);
  }]));
  for (const [type, handler] of handlers) documentObject.addEventListener(type, handler, true);
  let disposed = false;
  return () => {
    if (disposed) return false;
    disposed = true;
    for (const [type, handler] of handlers) documentObject.removeEventListener(type, handler, true);
    return true;
  };
}

export function setDebugLoggerForTests(logger) {
  const previous = testLogger;
  testLogger = logger ?? null;
  return () => { if (testLogger === logger) testLogger = previous; };
}
