// Purpose: connect Listar's IndexedDB state, microphone/upload flow, and review UI.
// Responsibilities: render and handle list actions, audio capture/transcription, editable append preview.
// Rationale: voice-derived items stay reviewable and enter the database only after one explicit confirmation.

import { Item, List } from './db.js';
import {
  bindDatabaseStatus, clearAudioForList, clearDoneItems, copyText, createList, createPreviewSubmission, decodeAudioToMono16k, deleteItem,
  deleteList, formatListExport, loadSettings, makePreview, renameList, saveAudioCapture, saveSettings,
  shareOrCopy, toggleItem, transcribeWithWorker,
} from './app-core.mjs';
import {
  bindContextConfirmation, createContextConfirmation, isAppendOnlyExtraction,
  prepareContextReview, renderContextPreview,
} from './context-review.mjs';

const $ = (selector) => document.querySelector(selector);
const homeView = $('#home-view');
const listView = $('#list-view');
const listsGrid = $('#lists-grid');
const itemsList = $('#items-list');
const homeEmpty = $('#home-empty');
const itemsEmpty = $('#items-empty');
const listHeading = $('#list-heading');
const appStatus = $('#app-status');
bindDatabaseStatus(appStatus);
const captureStatus = $('#capture-status');
const progressRegion = $('#progress-region');
const progressMessage = $('#progress-message');
const recordButton = $('#record-button');
const audioFile = $('#audio-file');
const settingsDialog = $('#settings-dialog');
const settingsForm = $('#settings-form');
const listDialog = $('#list-dialog');
const listForm = $('#list-form');
const previewDialog = $('#preview-dialog');
const previewForm = $('#preview-form');
const previewRows = $('#preview-rows');

let activeList = null;
let editListId = null;
let previewDraft = [];
let pendingAudioId = null;
let pendingTranscription = null;
let worker = null;
let mediaRecorder = null;
let micStream = null;
let recordingParts = [];
let recordingStartedAt = 0;
let timerHandle = null;
let appendPending = false;
let captureLocked = false;
let previewTargetListId = null;
let previewSubmission = null;
let contextReview = null;
let contextConfirmation = null;
let contextSubmission = null;
let contextPreviewControl = null;
let queuedSharedAudioToken = null;
const SHARED_AUDIO_CACHE = 'listar-shared-audio-v1';
let appSettings = loadSettings();

try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
} catch (error) {
  console.error('No se pudo iniciar el trabajador de audio', error);
}

function setStatus(message, isError = false) {
  appStatus.textContent = message;
  appStatus.classList.toggle('error', isError);
}

function resetPreviewCopy() {
  $('#preview-eyebrow').textContent = 'REVISA ANTES DE AGREGAR';
  $('#preview-heading').textContent = 'Artículos detectados';
  $('#preview-description').textContent = 'Puedes editar cada nombre y cantidad. Solo se agregan los seleccionados.';
  $('#confirm-append').textContent = 'Agregar a la lista';
}

function clearPreviewSession() {
  previewDraft = [];
  previewTargetListId = null;
  pendingAudioId = null;
  previewSubmission = null;
  contextReview = null;
  contextConfirmation = null;
  contextSubmission = null;
  contextPreviewControl = null;
  resetPreviewCopy();
}

async function finishPreview(message) {
  previewDialog.close();
  clearPreviewSession();
  setCaptureLock(false);
  setStatus(message);
  await renderItems();
}

function showContextPreview(review) {
  contextReview = review;
  contextConfirmation = createContextConfirmation(review);
  previewTargetListId = review.snapshot.listId;
  $('#preview-eyebrow').textContent = 'REVISA EL CAMBIO ANTES DE CONFIRMAR';
  $('#preview-heading').textContent = 'Propuestas para tu lista';
  $('#preview-description').textContent = 'Confirma solo propuestas con destino y evidencia claros. Las dudas quedan sin guardar.';
  $('#confirm-append').textContent = 'Confirmar cambios';
  contextPreviewControl = renderContextPreview({ document, container: previewRows, review });
  previewDialog.showModal();
  contextSubmission = bindContextConfirmation({
    form: previewForm,
    getConfirmation: () => contextConfirmation,
    getResolutions: () => contextPreviewControl.readResolutions(),
    onBusy: (busy) => { appendPending = busy; $('#confirm-append').disabled = busy; },
    onSuccess: async (result) => finishPreview(result.status === 'committed' ? 'Cambios confirmados en la lista.' : 'No se hicieron cambios.'),
    onStale: async (freshReview) => {
      contextReview = freshReview;
      contextConfirmation = createContextConfirmation(freshReview);
      contextPreviewControl = renderContextPreview({ document, container: previewRows, review: freshReview });
      $('#preview-description').textContent = 'La lista cambió mientras revisabas. Comprueba de nuevo los destinos y confirma otra vez.';
      setStatus('La lista cambió. Se actualizó el análisis; confirma de nuevo para guardar.', true);
    },
    onError: (error) => setStatus(error.message || 'No se pudo guardar; la revisión sigue abierta.', true),
  });
}

function showProgress(message) {
  progressMessage.textContent = message;
  progressRegion.classList.remove('hidden');
  captureStatus.textContent = message;
}

function hideProgress() {
  progressRegion.classList.add('hidden');
  captureStatus.textContent = 'Agrega artículos hablando';
}

function button(label, className, onClick, ariaLabel = label) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.setAttribute('aria-label', ariaLabel);
  element.addEventListener('click', onClick);
  return element;
}

async function renderHome() {
  const lists = await List.all();
  listsGrid.replaceChildren();
  homeEmpty.classList.toggle('hidden', lists.length > 0);
  for (const list of lists) {
    const card = document.createElement('article');
    card.className = 'list-card';
    const open = button('', 'list-card-open', () => openList(list.id), `Abrir ${list.name}`);
    const emoji = document.createElement('span');
    emoji.className = 'list-card-emoji';
    emoji.textContent = list.emoji || '📝';
    const name = document.createElement('span');
    name.className = 'list-card-name';
    name.textContent = list.name;
    const count = document.createElement('span');
    count.className = 'list-card-count';
    count.textContent = `${(await Item.list(list.id)).length} artículos`;
    open.append(emoji, name, count);
    card.append(open);
    listsGrid.append(card);
  }
}

async function renderItems() {
  if (!activeList) return;
  const items = await Item.list(activeList.id);
  itemsList.replaceChildren();
  itemsEmpty.classList.toggle('hidden', items.length > 0);
  const doneCount = items.filter(({ done }) => done).length;
  $('#clear-done').classList.toggle('hidden', doneCount === 0);
  for (const item of items) {
    const row = document.createElement('article');
    row.className = `item-row${item.done ? ' is-done' : ''}`;
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = Boolean(item.done);
    check.setAttribute('aria-label', `Marcar ${item.label} como ${item.done ? 'pendiente' : 'completado'}`);
    check.addEventListener('change', async () => {
      await toggleItem(item.id, check.checked);
      await renderItems();
    });
    const label = document.createElement('span');
    label.className = 'item-label';
    label.textContent = item.label;
    const quantity = document.createElement('span');
    quantity.className = 'item-quantity';
    quantity.textContent = item.quantity === undefined ? '' : `${item.quantity}${item.unit ? ` ${item.unit}` : ''}`;
    const remove = button('×', 'remove-item', async () => {
      await deleteItem(item.id);
      await renderItems();
    }, `Eliminar ${item.label}`);
    row.append(check, label, quantity, remove);
    itemsList.append(row);
  }
}

async function openList(id) {
  activeList = await List.get(id);
  if (!activeList) return renderHome();
  listHeading.textContent = `${activeList.emoji || '📝'} ${activeList.name}`;
  homeView.classList.add('hidden');
  listView.classList.remove('hidden');
  $('#back-button').classList.remove('hidden');
  await renderItems();
  setStatus('');
  if (queuedSharedAudioToken) {
    try {
      const file = await consumeSharedAudio(queuedSharedAudioToken);
      queuedSharedAudioToken = null;
      const url = new URL(location.href);
      url.searchParams.delete('shared_audio');
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      await processAudio(file);
    } catch (error) {
      setStatus(`No se pudo recuperar el audio compartido: ${error.message}`, true);
    }
  }
}

function goHome() {
  activeList = null;
  listView.classList.add('hidden');
  homeView.classList.remove('hidden');
  $('#back-button').classList.add('hidden');
  setStatus('');
  renderHome().catch(showDatabaseError);
}

function setCaptureLock(locked) {
  captureLocked = locked;
  for (const selector of ['#create-list', '#back-button', '#rename-list', '#delete-list', '#settings-button', '#open-settings', '#export-copy', '#export-share', '#audio-file']) {
    const element = $(selector);
    if (element) element.disabled = locked;
  }
  recordButton.disabled = locked && mediaRecorder?.state !== 'recording';
  document.querySelectorAll('.list-card-open').forEach((element) => { element.disabled = locked; });
}

function showDatabaseError(error) {
  setStatus(`No se pudo acceder al almacenamiento local: ${error.message}`, true);
}

function showListDialog(list = null) {
  editListId = list?.id ?? null;
  $('#list-dialog-title').textContent = list ? 'Editar lista' : 'Crear lista';
  $('#list-emoji').value = list?.emoji || '🛒';
  $('#list-name').value = list?.name || '';
  listDialog.showModal();
  $('#list-name').focus();
}

listForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const values = { name: $('#list-name').value, emoji: $('#list-emoji').value.trim() || '📝' };
    if (editListId) {
      await renameList(editListId, values);
      if (activeList?.id === editListId) {
        activeList = await List.get(editListId);
        listHeading.textContent = `${activeList.emoji || '📝'} ${activeList.name}`;
      }
    } else {
      await createList(values);
    }
    listDialog.close();
    await renderHome();
  } catch (error) {
    setStatus(error.message, true);
  }
});

$('#create-list').addEventListener('click', () => showListDialog());
$('#list-cancel').addEventListener('click', () => listDialog.close());
$('#back-button').addEventListener('click', goHome);
$('#rename-list').addEventListener('click', () => showListDialog(activeList));
$('#settings-button').addEventListener('click', openSettings);
$('#open-settings').addEventListener('click', openSettings);
$('#settings-cancel').addEventListener('click', () => settingsDialog.close());
$('#delete-list').addEventListener('click', async () => {
  if (!activeList || !confirm(`¿Eliminar la lista “${activeList.name}” y sus artículos?`)) return;
  try {
    await deleteList(activeList.id);
    goHome();
  } catch (error) { showDatabaseError(error); }
});
settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  appSettings = {
    language: $('#language-setting').value,
    model: $('#model-setting').value,
    saveAudio: $('#save-audio-setting').checked,
  };
  const saved = saveSettings(undefined, appSettings);
  settingsDialog.close();
  setStatus(saved ? 'Preferencias guardadas.' : 'Preferencias activas, pero el navegador no pudo guardarlas.', !saved);
});

function openSettings() {
  $('#language-setting').value = appSettings.language;
  $('#model-setting').value = appSettings.model;
  $('#save-audio-setting').checked = appSettings.saveAudio;
  settingsDialog.showModal();
}

$('#clear-audio').addEventListener('click', async () => {
  if (!activeList) return;
  if (!confirm(`¿Borrar todos los audios guardados de “${activeList.name}”?`)) return;
  try {
    const count = await clearAudioForList(activeList.id);
    setStatus(count ? `Se borraron ${count} audios.` : 'Esta lista no tiene audios guardados.');
  } catch (error) { showDatabaseError(error); }
});

async function exportActiveList(mode) {
  if (!activeList) return;
  try {
    const text = formatListExport(await Item.list(activeList.id));
    if (!text) { setStatus('La lista no tiene artículos para exportar.'); return; }
    if (mode === 'copy') {
      await copyText(text);
      setStatus('Lista copiada al portapapeles.');
      return;
    }
    const result = await shareOrCopy(text);
    if (result === 'shared') setStatus('Lista compartida.');
    else if (result === 'copied') setStatus('No se pudo compartir directamente; la lista se copió al portapapeles.');
  } catch (error) {
    setStatus(`No se pudo exportar la lista: ${error.message}`, true);
  }
}
$('#export-copy').addEventListener('click', () => exportActiveList('copy'));
$('#export-share').addEventListener('click', () => exportActiveList('share'));

$('#clear-done').addEventListener('click', async () => {
  if (!activeList) return;
  try {
    await clearDoneItems(activeList.id);
    await renderItems();
  } catch (error) { showDatabaseError(error); }
});

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function startRecording() {
  if (captureLocked) return;
  if (!activeList) { setStatus('Abre una lista antes de grabar.', true); return; }
  const captureTargetId = activeList.id;
  setCaptureLock(true);
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    setCaptureLock(false);
    setStatus('Este navegador no permite grabar. Puedes subir un archivo de audio.', true);
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find((type) => MediaRecorder.isTypeSupported(type));
    mediaRecorder = new MediaRecorder(micStream, mimeType ? { mimeType } : {});
    recordingParts = [];
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) recordingParts.push(event.data);
    });
    mediaRecorder.addEventListener('stop', async () => {
      const blob = new Blob(recordingParts, { type: mediaRecorder?.mimeType || mimeType || 'audio/webm' });
      releaseMicrophone();
      recordButton.disabled = true;
      recordButton.classList.remove('recording');
      recordButton.setAttribute('aria-label', 'Grabar una lista');
      $('#record-icon').textContent = '🎙';
      clearInterval(timerHandle);
      $('#record-timer').classList.add('hidden');
      if (blob.size) await processAudio(blob, { targetListId: captureTargetId, lockAlready: true });
      else { setCaptureLock(false); setStatus('La grabación quedó vacía. Intenta hablar un poco más.', true); }
    }, { once: true });
    mediaRecorder.addEventListener('error', (event) => {
      setStatus(`Error durante la grabación: ${event.error?.message || 'falló el micrófono'}.`, true);
      if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    }, { once: true });
    mediaRecorder.start(250);
    recordButton.disabled = false;
    recordingStartedAt = Date.now();
    recordButton.classList.add('recording');
    recordButton.setAttribute('aria-label', 'Detener grabación');
    $('#record-icon').textContent = '■';
    $('#record-timer').classList.remove('hidden');
    timerHandle = setInterval(() => {
      $('#record-timer').textContent = formatTime(Math.floor((Date.now() - recordingStartedAt) / 1000));
    }, 250);
    setStatus('Grabando. Toca el botón para terminar.');
  } catch (error) {
    releaseMicrophone();
    setCaptureLock(false);
    setStatus(`No se pudo iniciar el micrófono: ${error.message}. Puedes subir un audio.`, true);
  }
}

function releaseMicrophone() {
  if (micStream) micStream.getTracks().forEach((track) => track.stop());
  micStream = null;
  mediaRecorder = null;
}

function stopRecording() {
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
}

recordButton.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') stopRecording();
  else startRecording();
});

audioFile.addEventListener('change', async () => {
  const file = audioFile.files?.[0];
  audioFile.value = '';
  if (file) await processAudio(file);
});

async function processAudio(blob, { targetListId = activeList?.id, lockAlready = false } = {}) {
  if (captureLocked && !lockAlready) return;
  if (!targetListId) { setStatus('Abre una lista antes de agregar audio.', true); return; }
  if (!worker) { setCaptureLock(false); setStatus('No se pudo iniciar el transcriptor. Recarga la página e inténtalo de nuevo.', true); return; }
  if (!lockAlready) setCaptureLock(true);
  let keepLockedForPreview = false;
  try {
    setStatus('Preparando audio…');
    showProgress('Decodificando y convirtiendo audio a 16 kHz…');
    const audio = await decodeAudioToMono16k(blob, globalThis.AudioContext || globalThis.webkitAudioContext);
    if (!audio.data.length) throw new Error('El audio no contiene muestras.');
    showProgress('Preparando modelo Whisper…');
    const options = { task: 'transcribe' };
    if (appSettings.language !== 'auto') options.language = appSettings.language;
    pendingAudioId = null;
    pendingTranscription = transcribeWithWorker(worker, audio.data, appSettings.model, options, ({ message }) => showProgress(message));
    const result = await pendingTranscription;
    pendingTranscription = null;
    hideProgress();
    const audioRecord = await saveAudioCapture(targetListId, blob, result.text, appSettings.model, appSettings.saveAudio);
    pendingAudioId = audioRecord?.id ?? null;
    if (result.empty || !result.text.trim()) {
      setStatus('No se escuchó nada claro. No se agregó ningún artículo.');
      return;
    }
    const contextualReview = await prepareContextReview(result.text, targetListId, { audioId: pendingAudioId });
    if (!isAppendOnlyExtraction(contextualReview.analysis)) {
      showContextPreview(contextualReview);
      keepLockedForPreview = true;
      return;
    }
    previewTargetListId = targetListId;
    previewDraft = makePreview(result.text);
    if (previewDraft.length === 0) {
      setStatus('No se escuchó nada claro. No se agregó ningún artículo.');
      return;
    }
    resetPreviewCopy();
    renderPreview();
    previewDialog.showModal();
    previewSubmission = createPreviewSubmission({
      form: previewForm,
      getTargetId: () => previewTargetListId,
      getDraft: () => previewDraft,
      getSourceAudioId: () => pendingAudioId,
      readFieldValues: () => [...previewRows.querySelectorAll('.preview-row')].map((row) =>
        [...row.querySelectorAll('input')].map((field, fieldIndex) => fieldIndex === 0 ? field.checked : field.value)),
      onBusy: (busy) => { appendPending = busy; $('#confirm-append').disabled = busy; },
      onSuccess: async () => {
        await finishPreview('Artículos agregados a la lista.');
      },
      onError: (error) => setStatus(`No se pudieron agregar los artículos: ${error.message}`, true),
    });
    keepLockedForPreview = true;
  } catch (error) {
    pendingTranscription = null;
    hideProgress();
    if (error.name === 'AbortError') setStatus('Transcripción cancelada.');
    else setStatus(`No se pudo transcribir: ${error.message}`, true);
  } finally {
    if (!keepLockedForPreview) setCaptureLock(false);
  }
}

function renderPreview() {
  previewRows.replaceChildren();
  previewDraft.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'preview-row';
    const selected = document.createElement('input');
    selected.type = 'checkbox';
    selected.checked = item.selected;
    selected.setAttribute('aria-label', `Incluir ${item.label}`);
    selected.addEventListener('change', () => { item.selected = selected.checked; label.required = item.selected; });
    const editor = document.createElement('div');
    editor.className = 'preview-editor';
    const label = document.createElement('input');
    label.type = 'text';
    label.required = item.selected;
    label.value = item.label;
    label.setAttribute('aria-label', `Nombre del artículo ${index + 1}`);
    label.addEventListener('input', () => { item.label = label.value; });
    const quantityRow = document.createElement('div');
    quantityRow.className = 'quantity-editor';
    const quantity = document.createElement('input');
    quantity.type = 'number';
    quantity.step = 'any';
    quantity.min = '0';
    quantity.value = item.quantity ?? '';
    quantity.placeholder = 'Cantidad';
    quantity.setAttribute('aria-label', `Cantidad de ${item.label}`);
    quantity.addEventListener('input', () => { item.quantity = quantity.value === '' ? undefined : Number(quantity.value); });
    const unit = document.createElement('input');
    unit.type = 'text';
    unit.value = item.unit ?? '';
    unit.placeholder = 'Unidad';
    unit.setAttribute('aria-label', `Unidad de ${item.label}`);
    unit.addEventListener('input', () => { item.unit = unit.value.trim() || undefined; });
    quantityRow.append(quantity, unit);
    editor.append(label, quantityRow);
    row.append(selected, editor);
    previewRows.append(row);
  });
}

function discardPreview() {
  if (previewSubmission && !previewSubmission.cancel()) return false;
  if (contextSubmission && !contextSubmission.cancel()) return false;
  clearPreviewSession();
  setCaptureLock(false);
  return true;
}
$('#preview-cancel').addEventListener('click', () => { if (discardPreview()) previewDialog.close(); });
previewDialog.addEventListener('cancel', (event) => { if (!discardPreview()) event.preventDefault(); });

$('#cancel-transcription').addEventListener('click', () => pendingTranscription?.cancel());

async function storeSharedAudio(file) {
  if (!globalThis.caches || typeof Response === 'undefined') throw new Error('El almacenamiento local de archivos no está disponible.');
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const key = new URL(`./__shared_audio__/${encodeURIComponent(token)}`, import.meta.url).href;
  const cache = await caches.open(SHARED_AUDIO_CACHE);
  await cache.put(key, new Response(file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Shared-Filename': file.name || 'audio-compartido' },
  }));
  return token;
}

async function consumeSharedAudio(token) {
  const key = new URL(`./__shared_audio__/${encodeURIComponent(token)}`, import.meta.url).href;
  const cache = await caches.open(SHARED_AUDIO_CACHE);
  const response = await cache.match(key);
  if (!response) throw new Error('El archivo ya no está disponible.');
  const blob = await response.blob();
  const name = response.headers.get('X-Shared-Filename') || 'audio-compartido';
  await cache.delete(key);
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

function isAudioFile(file) {
  return String(file.type || '').startsWith('audio/') || /\.(wav|mp3|m4a|ogg|webm|mp4)$/i.test(file.name || '');
}

async function acceptLaunchFiles(files) {
  if (!Array.isArray(files)) return;
  let audio = null;
  for (const handle of files) {
    const file = typeof handle.getFile === 'function' ? await handle.getFile() : handle;
    if (isAudioFile(file)) { audio = file; break; }
  }
  if (!audio) return;
  if (!activeList) {
    queuedSharedAudioToken = await storeSharedAudio(audio);
    setStatus('Audio guardado en este dispositivo. Abre una lista para transcribirlo.');
    return;
  }
  await processAudio(audio);
}

if (window.launchQueue?.setConsumer) {
  window.launchQueue.setConsumer((params) => acceptLaunchFiles(params.files).catch((error) => setStatus(error.message, true)));
}

async function initialize() {
  await renderHome();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('No se pudo registrar el modo offline', error));
  }
  const url = new URL(location.href);
  queuedSharedAudioToken = url.searchParams.get('shared_audio');
  if (queuedSharedAudioToken) {
    setStatus('Audio compartido guardado en este dispositivo. Abre una lista para transcribirlo.');
  } else if (url.searchParams.has('share_error')) {
    setStatus('No se pudo guardar el audio compartido. Puedes subir el archivo desde una lista.', true);
  } else if (url.searchParams.get('text')) {
    setStatus('Se compartió texto. Puedes abrir una lista y dictarlo.');
  }
}

initialize().catch(showDatabaseError);
