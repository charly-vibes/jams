// Purpose: keep durable list actions and audio processing independent of the DOM.
// Responsibilities: IndexedDB workflows, transcript preview/append, PCM conversion, worker lifecycle.
// Rationale: these state-changing paths need direct tests and must not depend on UI rendering;
//   removing a list always preserves its items and audio, leaving them unassigned (A10).

import { Audio, Item, List, commitCommands, readSnapshot, setUpgradeBlockedHandler } from './db.js';
import { removeCollection } from './workspace.mjs';
import { recordDebugEvent } from './debug.mjs';
import { split } from './splitter.js';

let nextRequestId = 1;
let nextOperationId = 1;

function createOperationId() {
  return globalThis.crypto?.randomUUID?.() || `listar-${Date.now()}-${nextOperationId++}`;
}

export const SETTINGS_KEY = 'listar-settings';
export const DEFAULT_SETTINGS = Object.freeze({ language: 'es', model: 'tiny', saveAudio: true });
const SUPPORTED_LANGUAGES = new Set(['auto', 'es', 'en']);
const SUPPORTED_MODELS = new Set(['tiny', 'base', 'small']);

export function bindDatabaseStatus(element) {
  if (!element) return () => {};
  return setUpgradeBlockedHandler(({ code, message }) => {
    element.textContent = message ?? '';
    element.hidden = code !== 'blocked-upgrade';
  });
}

function availableStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function validatedSettings(value = {}) {
  return {
    language: SUPPORTED_LANGUAGES.has(value.language) ? value.language : DEFAULT_SETTINGS.language,
    model: SUPPORTED_MODELS.has(value.model) ? value.model : DEFAULT_SETTINGS.model,
    saveAudio: typeof value.saveAudio === 'boolean' ? value.saveAudio : DEFAULT_SETTINGS.saveAudio,
  };
}

export function loadSettings(storage) {
  try {
    const raw = availableStorage(storage)?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return validatedSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage, settings) {
  const target = availableStorage(storage);
  if (!target || !settings ||
      !SUPPORTED_LANGUAGES.has(settings.language) ||
      !SUPPORTED_MODELS.has(settings.model) ||
      typeof settings.saveAudio !== 'boolean') return false;
  try {
    target.setItem(SETTINGS_KEY, JSON.stringify(validatedSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

export async function createList({ name = '', emoji = '📝' } = {}) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Escribe un nombre para la lista.');
  const list = await List.add({ name: cleanName, emoji });
  recordDebugEvent('list.create', { listId: list.id });
  return list;
}

export async function renameList(id, { name, emoji }) {
  const current = await List.get(id);
  if (!current) throw new Error('No se encontró la lista.');
  const cleanName = String(name ?? current.name).trim();
  if (!cleanName) throw new Error('Escribe un nombre para la lista.');
  const updated = await List.put({ ...current, name: cleanName, emoji: emoji ?? current.emoji });
  recordDebugEvent('list.rename', { listId: id });
  return updated;
}

export async function deleteList(id) {
  // A10: removal detaches membership, it never deletes items or audio; the
  // legacy destructive path delegates to the same preserve-items workspace commit.
  await removeCollection(id);
  recordDebugEvent('list.delete', { listId: id });
}

export async function toggleItem(id, done) {
  const lists = await List.all();
  for (const list of lists) {
    const item = (await Item.list(list.id)).find((row) => row.id === id);
    if (item) {
      const updated = await Item.put({ ...item, done: Boolean(done) });
      recordDebugEvent('item.toggle', { listId: list.id, itemId: id, done: Boolean(done) });
      return updated;
    }
  }
  throw new Error('No se encontró el artículo.');
}

export async function deleteItem(id) {
  const result = await Item.del(id);
  recordDebugEvent('item.delete', { itemId: id });
  return result;
}

export async function clearDoneItems(listId) {
  const items = await Item.list(listId);
  const done = items.filter(({ done: isDone }) => isDone);
  await Promise.all(done.map(({ id }) => Item.del(id)));
  recordDebugEvent('item.clear-done', { listId, count: done.length });
  return done.length;
}

export function makePreview(transcript) {
  return split(transcript).map((item) => ({
    label: item.label,
    text: item.text,
    quantity: item.quantity,
    unit: item.unit,
    selected: true,
  }));
}

export function applyPreviewFields(item, [selected, label, quantity, unit]) {
  item.selected = Boolean(selected);
  item.label = String(label).trim();
  item.quantity = quantity === '' ? undefined : Number(quantity);
  item.unit = String(unit).trim() || undefined;
  return item;
}

export async function appendSelectedItems(listId, rows, sourceAudioId, {
  operationId = createOperationId(), commandTime = Date.now(),
} = {}) {
  const selected = rows.filter((row) => row.selected && String(row.label ?? '').trim());
  if (selected.length === 0) return [];
  const snapshot = await readSnapshot(listId);
  const commands = selected.map((row, index) => {
    const item = {
      id: `${operationId}:item:${index}`,
      listId,
      label: String(row.label).trim(),
      text: String(row.text ?? row.label),
      done: false,
      createdAt: commandTime + index,
      order: commandTime + index,
    };
    if (row.quantity !== undefined) item.quantity = row.quantity;
    if (row.unit !== undefined) item.unit = row.unit;
    if (sourceAudioId !== undefined) item.sourceAudioId = sourceAudioId;
    return { intent: 'add', item };
  });
  const result = await commitCommands({ snapshot, commands, operationId });
  const ids = new Set(commands.map(({ item }) => item.id));
  return result.items.filter(({ id }) => ids.has(id));
}

export function createPreviewSubmission({
  form, getTargetId, getDraft, getSourceAudioId, readFieldValues,
  onBusy = () => {}, onSuccess = () => {}, onError = () => {},
}) {
  let busy = false;
  let completed = false;
  let active = true;
  let submission = null;
  const correlationId = `append-preview-${Date.now()}-${nextOperationId++}`;
  const submit = async (event) => {
    event.preventDefault();
    if (!active || busy || completed || !getTargetId()) return;
    busy = true;
    onBusy(true);
    try {
      const draft = getDraft();
      readFieldValues().forEach((fields, index) => applyPreviewFields(draft[index], fields));
      const signature = JSON.stringify(draft.map(({ selected, label, text, quantity, unit }) => ({ selected, label, text, quantity, unit })));
      if (!submission || submission.signature !== signature) {
        submission = { signature, operationId: createOperationId(), commandTime: Date.now() };
      }
      recordDebugEvent('preview.append.confirm', {
        listId: getTargetId(), operationId: submission.operationId,
        selectedCount: draft.filter(({ selected, label }) => selected && label).length,
        editedLabels: draft.map(({ label }) => label),
      }, { correlationId, operationId: submission.operationId });
      const items = await appendSelectedItems(getTargetId(), draft, getSourceAudioId(), submission);
      completed = true;
      active = false;
      form.removeEventListener('submit', submit);
      recordDebugEvent('preview.append.complete', { listId: getTargetId(), itemCount: items.length }, { correlationId, operationId: submission.operationId });
      await onSuccess(items);
    } catch (error) {
      recordDebugEvent('preview.append.error', { errorName: error?.name || 'Error' }, { correlationId, operationId: submission?.operationId });
      await onError(error);
    } finally {
      busy = false;
      onBusy(false);
    }
  };
  form.addEventListener('submit', submit);
  return {
    cancel() {
      if (busy || completed) return false;
      active = false;
      form.removeEventListener('submit', submit);
      return true;
    },
  };
}

export function saveAudioCapture(listId, blob, transcript, model, retain = true) {
  return retain ? Audio.add({ listId, blob, transcript, model }) : Promise.resolve(null);
}

export async function clearAudioForList(listId) {
  const records = await Audio.byList(listId);
  await Promise.all(records.map(({ id }) => Audio.del(id)));
  return records.length;
}

export function formatListExport(items) {
  return items.map((item) => {
    const status = item.done ? '✓' : '☐';
    const amount = item.quantity === undefined ? '' : ` ×${item.quantity}${item.unit ? ` ${item.unit}` : ''}`;
    return `${status} ${item.label}${amount}`;
  }).join('\n');
}

export async function copyText(text, { clipboard, document = globalThis.document } = {}) {
  try {
    const targetClipboard = clipboard ?? globalThis.navigator?.clipboard;
    if (!targetClipboard?.writeText) throw new Error('Clipboard API no disponible');
    await targetClipboard.writeText(text);
    return;
  } catch {
    if (!document?.createElement || !document?.execCommand) throw new Error('No se pudo copiar al portapapeles.');
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus?.();
    textarea.select();
    try {
      if (!document.execCommand('copy')) throw new Error('El navegador rechazó la copia.');
    } finally {
      textarea.remove();
    }
  }
}

export async function shareOrCopy(text, {
  navigator = globalThis.navigator,
  copy = (value) => copyText(value),
} = {}) {
  if (navigator?.share) {
    try {
      await navigator.share({ title: 'Lista de Listar', text });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  await copy(text);
  return 'copied';
}

export async function decodeAudioToMono16k(blob, AudioContextClass = globalThis.AudioContext) {
  if (!AudioContextClass) throw new Error('El navegador no permite decodificar audio.');
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.length || !decoded.numberOfChannels || !decoded.sampleRate) {
      throw new Error('El audio está vacío o tiene un formato no compatible.');
    }
    const sourceRate = decoded.sampleRate;
    const outputLength = Math.max(1, Math.round(decoded.length * 16000 / sourceRate));
    const monoSource = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const samples = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) monoSource[i] += samples[i] / decoded.numberOfChannels;
    }
    const data = new Float32Array(outputLength);
    const ratio = sourceRate / 16000;
    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio;
      const left = Math.min(Math.floor(position), monoSource.length - 1);
      const right = Math.min(left + 1, monoSource.length - 1);
      const fraction = position - left;
      data[i] = monoSource[left] * (1 - fraction) + monoSource[right] * fraction;
    }
    return { data, sampleRate: 16000, duration: decoded.duration };
  } finally {
    await context.close?.();
  }
}

export function transcribeWithWorker(worker, audio, modelKey, options = {}, onProgress = () => {}, flowCorrelationId) {
  const requestId = nextRequestId++;
  const correlationId = flowCorrelationId || `worker-${requestId}`;
  recordDebugEvent('worker.request', { modelKey, sampleCount: audio?.length ?? null, optionKeys: Object.keys(options ?? {}) }, { requestId, correlationId });
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const onMessage = ({ data }) => {
    if (data.requestId !== requestId) return;
    if (data.type === 'progress') {
      recordDebugEvent('worker.progress', { progress: Number.isFinite(data.progress) ? data.progress : null, phase: data.step ?? 'transcribing' }, { requestId, correlationId });
      onProgress(data);
      return;
    }
    if (data.type === 'model-loaded') return;
    if (data.type === 'result') {
      cleanup();
      recordDebugEvent('worker.result', { empty: data.empty === true, segmentCount: Array.isArray(data.chunks) ? data.chunks.length : null }, { requestId, correlationId });
      resolvePromise(data);
    } else if (data.type === 'error') {
      cleanup();
      recordDebugEvent('worker.error', { errorName: 'TranscriptionError', message: data.message }, { requestId, correlationId });
      rejectPromise(new Error(data.message || 'No se pudo transcribir el audio.'));
    } else if (data.type === 'cancelled') {
      cleanup();
      recordDebugEvent('worker.cancelled', {}, { requestId, correlationId });
      rejectPromise(new DOMException('Transcripción cancelada.', 'AbortError'));
    }
  };
  const onWorkerFailure = (event) => {
    cleanup();
    recordDebugEvent('worker.error', { errorName: event.error?.name || 'WorkerError', message: event.message }, { requestId, correlationId });
    rejectPromise(event.error || new Error(event.message || 'El trabajador de audio falló.'));
  };
  const onMessageFailure = () => {
    cleanup();
    recordDebugEvent('worker.error', { errorName: 'MessageError' }, { requestId, correlationId });
    rejectPromise(new Error('No se pudo leer la respuesta del trabajador de audio.'));
  };
  const cleanup = () => {
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onWorkerFailure);
    worker.removeEventListener('messageerror', onMessageFailure);
  };
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onWorkerFailure);
  worker.addEventListener('messageerror', onMessageFailure);
  try {
    worker.postMessage({ type: 'transcribe', requestId, audio, modelKey, options });
  } catch (error) {
    cleanup();
    recordDebugEvent('worker.error', { errorName: error?.name || 'PostMessageError' }, { requestId, correlationId });
    rejectPromise(error);
  }
  promise.cancel = () => worker.postMessage({ type: 'cancel', requestId });
  return promise;
}
