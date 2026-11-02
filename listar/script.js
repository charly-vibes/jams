// Purpose: connect Listar's IndexedDB state, microphone/upload flow, and review UI.
// Responsibilities: render and handle list and collection actions, audio capture/transcription,
//   editable append preview, and the workspace inline draft reviewed before one atomic batch commit.
// Rationale: voice-derived items stay reviewable and enter the database only after one explicit
//   confirmation, reviewed drafts commit through one guarded batch with durable retry, and collection
//   removal always preserves items by leaving them unassigned (A10).

import { Item, List } from './db.js';
import {
  captureItem, captureBatch, commitVoiceActions, moveItem, readWorkspace, applyItemUpdate, toggleDone, setArchived, applyItemFields, removeCapturedItem,
  createCollection, renameCollection, removeCollection,
} from './workspace.mjs';
import {
  actionSummaries, analyzeVoiceTranscript, answerStep, createVoiceSession, sessionActions, sessionStep,
} from './voice-resolution.mjs';
import {
  CAPTURE_STATES, canConfirm, confirmLabel, draftFromText, draftFromTranscript,
  editRowLabel, payloadForCommit, planSecondCapture, removeRow, setEditingRow, setRowIncluded,
} from './draft.mjs';
import { planUndo } from './undo.mjs';
import { project, defaultDestination, resolveSavedView, STANDARD_VIEWS } from './views.mjs';
import { removeSavedView } from './views.mjs';
import { formatViewExport, viewScopeLabel } from './view-export.mjs';
import {
  bindDatabaseStatus, clearAudioForList, clearDoneItems, copyText, createList, createPreviewSubmission, decodeAudioToMono16k, deleteItem,
  deleteList, formatListExport, loadSettings, makePreview, renameList, saveAudioCapture, saveSettings,
  shareOrCopy, toggleItem, transcribeWithWorker,
} from './app-core.mjs';
import {
  bindContextConfirmation, createContextConfirmation, isAppendOnlyExtraction,
  prepareContextReview, renderContextPreview,
} from './context-review.mjs';
import {
  attachDebugInteractionListeners, clearDebugLog, configureDebug, exportDebugLog, getDebugOptions, recordDebugEvent,
} from './debug.mjs';

const $ = (selector) => document.querySelector(selector);
const disposeDebugInteractions = attachDebugInteractionListeners(document);
window.addEventListener('pagehide', disposeDebugInteractions, { once: true });
const homeView = $('#home-view');
const quickCaptureForm = $('#quick-capture');
const quickCaptureInput = $('#quick-capture-input');
const quickCaptureSubmit = $('#quick-capture-submit');
const quickItems = $('#quick-items');
const viewSelector = $('#view-selector');
const captureDestination = $('#capture-destination');
const captureReceipt = $('#capture-receipt');
const receiptGoto = $('#receipt-goto');
const draftCard = $('#draft-card');
const draftRows = $('#draft-rows');
const draftStatus = $('#draft-status');
const draftScope = $('#draft-scope');
const draftConfirm = $('#draft-confirm');
const draftCancel = $('#draft-cancel');
const draftChoice = $('#draft-choice');
const draftActions = $('#draft-actions');
const voiceCard = $('#voice-resolution');
const voiceScope = $('#voice-scope');
const voiceQuestion = $('#voice-question');
const voiceChoices = $('#voice-choices');
const voiceDetail = $('#voice-detail');
const voiceSummary = $('#voice-summary');
const voiceConfirm = $('#voice-confirm');
const voiceCancel = $('#voice-cancel');
const VIEW_STORAGE_KEY = 'listar-last-view';
let currentView = 'pendientes';
let lastSnapshot = null;

// A02/A04/A14: one active inline draft reviewed before a single guarded batch.
let workspaceDraft = null;
let draftCollectionId = null;
let draftCommitting = false;

// jams-8be.7 (A05/A06): dictated voice changes resolve one question at a time
// in this session; nothing persists until Guardar N cambios commits the batch.
let voiceSession = null;
let voiceCommitting = false;
let pendingDraftSource = null;

function savedView() {
  try { return globalThis.localStorage?.getItem(VIEW_STORAGE_KEY) ?? null; } catch { return null; }
}

function storeView(view) {
  try { globalThis.localStorage?.setItem(VIEW_STORAGE_KEY, view); } catch { /* view persistence is best-effort */ }
}

function collectionOptions(snapshot) {
  return [
    { value: '', label: 'Sin lista' },
    ...snapshot.collections.map((collection) => ({ value: collection.id, label: collection.name })),
  ];
}

let lastCapturedId = null;
let editing = null;
let lastReceipt = null;
let undoAwaitingConfirm = false;

function attributeSummary(item) {
  if (!item.attributes) return '';
  return Object.entries(item.attributes)
    .map(([key, assertions]) => `${key}: ${assertions.map((a) => a.value?.name ?? a.value?.type ?? '').filter(Boolean).join(', ')}`)
    .join('; ');
}

function renderEditorRow(item, snapshot) {
  const row = document.createElement('div');
  row.className = 'item-row item-editing';
  const isQuantity = editing.field === 'quantity';
  const input = document.createElement('input');
  input.className = 'row-edit-input';
  input.setAttribute('aria-label', isQuantity ? `Cantidad de ${item.label}` : `Nombre de ${item.label}`);
  if (isQuantity) {
    input.type = 'number';
    input.step = 'any';
    input.value = item.quantity ?? '';
  } else {
    input.value = item.label;
  }
  const unitInput = document.createElement('input');
  unitInput.className = 'row-edit-unit';
  unitInput.setAttribute('aria-label', `Unidad de ${item.label}`);
  unitInput.placeholder = 'unidad';
  unitInput.value = item.unit ?? '';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'primary-button';
  save.textContent = 'Guardar';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary-button';
  cancel.textContent = 'Cancelar';
  const finish = () => { editing = null; renderWorkspaceView().catch((error) => setStatus(error.message, true)); };
  cancel.addEventListener('click', finish);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save.click();
    if (event.key === 'Escape') finish();
  });
  unitInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save.click();
    if (event.key === 'Escape') finish();
  });
  save.addEventListener('click', async () => {
    const patch = isQuantity
      ? (input.value.trim() === '' ? { quantity: null, unit: null } : { quantity: input.value, unit: unitInput.value.trim() || null })
      : { label: input.value };
    try {
      const updated = await applyItemUpdate(item.id, patch, lastSnapshot?.revision);
      lastReceipt = { action: isQuantity ? 'quantity' : 'label', itemId: item.id, label: updated.label, before: item, after: updated };
      undoAwaitingConfirm = false;
      finish();
      showActionReceipt(`${updated.label} guardado.`);
    } catch (error) {
      // A15: keep the entered values and the editor open on failure.
      setStatus(`No se pudo guardar: ${error.message}`, true);
    }
  });
  row.append(input);
  if (isQuantity) row.append(unitInput);
  row.append(save, cancel);
  return row;
}

function showActionReceipt(message, receipt = undefined) {
  if (receipt) lastReceipt = receipt;
  const receiptElement = $('#action-receipt');
  receiptElement.textContent = message;
  receiptElement.classList.remove('hidden');
  const undo = $('#action-undo');
  if (receipt === false) {
    lastReceipt = null;
    undoAwaitingConfirm = false;
    undo.classList.add('hidden');
    return;
  }
  undo.classList.remove('hidden');
  undo.onclick = () => undoLast().catch((error) => setStatus(error.message, true));
}

async function undoLast() {
  if (!lastReceipt) return;
  const snapshot = await readWorkspace();
  lastSnapshot = snapshot;
  const current = snapshot.items.find((entry) => entry.id === lastReceipt.itemId);
  const plan = planUndo(lastReceipt, current, { confirmStale: undoAwaitingConfirm });
  if (!plan.ok) {
    if (plan.stale) {
      undoAwaitingConfirm = true;
      const value = plan.current.quantity != null ? `${plan.current.quantity}${plan.current.unit ? ` ${plan.current.unit}` : ''}` : plan.current.label;
      setStatus(`Esto cambió en otra pestaña. Valor actual: ${value}. Tocá Deshacer de nuevo para confirmar.`, true);
      return;
    }
    setStatus(plan.reason, true);
    return;
  }
  try {
    if (plan.kind === 'remove') {
      const { collectionId: _omit, ...expected } = lastReceipt.after;
      await removeCapturedItem(plan.itemId, snapshot.revision, { expected });
    } else if (plan.kind === 'membership') {
      await moveItem(lastReceipt.itemId, plan.collectionId, snapshot.revision);
    } else {
      await applyItemFields(lastReceipt.itemId, plan.fields, snapshot.revision);
    }
    const label = lastReceipt.label;
    lastReceipt = null;
    undoAwaitingConfirm = false;
    $('#action-undo').classList.add('hidden');
    await renderWorkspaceView();
    setStatus(`${label} deshecho.`);
  } catch (error) {
    setStatus(`No se pudo deshacer: ${error.message}`, true);
  }
}

async function toggleRow(itemId) {
  try {
    const updated = await toggleDone(itemId, lastSnapshot?.revision);
    lastReceipt = { action: 'completion', itemId, label: updated.label, before: lastSnapshot?.items.find((entry) => entry.id === itemId), after: updated };
    undoAwaitingConfirm = false;
    await renderWorkspaceView();
    showActionReceipt(updated.done ? `${updated.label} completado.` : `${updated.label} reactivado.`);
  } catch (error) {
    setStatus(`No se pudo completar: ${error.message}`, true);
    await renderWorkspaceView().catch(() => {});
  }
}

async function archiveRow(itemId, archived) {
  try {
    const updated = await setArchived(itemId, archived, lastSnapshot?.revision);
    lastReceipt = { action: archived ? 'archive' : 'restore', itemId, label: updated.label, before: lastSnapshot?.items.find((entry) => entry.id === itemId), after: updated };
    undoAwaitingConfirm = false;
    if (currentView === 'archivados' && archived) editing = null;
    await renderWorkspaceView();
    showActionReceipt(archived ? `${updated.label} archivado.` : `${updated.label} restaurado.`);
  } catch (error) {
    setStatus(`No se pudo archivar: ${error.message}`, true);
    await renderWorkspaceView().catch(() => {});
  }
}

function renderRow(item, snapshot) {
  if (editing && editing.itemId === item.id) return renderEditorRow(item, snapshot);
  const row = document.createElement('div');
  row.className = 'item-row';
  const done = document.createElement('input');
  done.type = 'checkbox';
  done.className = 'row-done';
  done.checked = item.done === true;
  done.setAttribute('aria-label', `Completar ${item.label}`);
  done.addEventListener('change', () => toggleRow(item.id));
  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'row-label';
  label.textContent = item.label;
  if (item.done) label.classList.add('done');
  label.addEventListener('click', () => { editing = { itemId: item.id, field: 'label' }; renderWorkspaceView().catch((error) => setStatus(error.message, true)); });
  const quantity = document.createElement('button');
  quantity.type = 'button';
  quantity.className = 'row-qty';
  quantity.textContent = item.quantity != null ? `${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : 'Agregar cantidad';
  quantity.addEventListener('click', () => { editing = { itemId: item.id, field: 'quantity' }; renderWorkspaceView().catch((error) => setStatus(error.message, true)); });
  row.append(done, label, quantity);
  const move = document.createElement('select');
  move.className = 'row-move';
  move.setAttribute('aria-label', `Mover ${item.label}`);
  for (const option of collectionOptions(snapshot)) {
    const entry = document.createElement('option');
    entry.value = option.value;
    entry.textContent = option.label;
    if ((item.collectionId ?? '') === option.value) entry.selected = true;
    move.append(entry);
  }
  move.addEventListener('change', () => moveRow(item.id, move.value || null));
  row.append(move);
  const details = document.createElement('details');
  details.className = 'row-details';
  const summary = document.createElement('summary');
  summary.textContent = 'Detalles';
  details.append(summary);
  const collectionName = snapshot.collections.find((c) => c.id === item.collectionId)?.name ?? 'Sin lista';
  const facts = [
    `Origen: ${item.text || item.label}`,
    `Colección: ${collectionName}`,
  ];
  const attributes = attributeSummary(item);
  if (attributes) facts.push(`Atributos: ${attributes}`);
  const factsParagraph = document.createElement('p');
  factsParagraph.textContent = facts.join('. ');
  details.append(factsParagraph);
  const archive = document.createElement('button');
  archive.type = 'button';
  archive.className = 'secondary-button';
  archive.textContent = item.archived ? 'Restaurar' : 'Archivar';
  archive.addEventListener('click', () => archiveRow(item.id, !item.archived));
  details.append(archive);
  row.append(details);
  return row;
}

async function renderWorkspaceView() {
  const snapshot = await readWorkspace();
  lastSnapshot = snapshot;
  currentView = resolveSavedView(currentView, snapshot);
  const views = [...STANDARD_VIEWS, ...snapshot.collections.map((collection) => ({ id: 'collection:' + collection.id, label: collection.name }))];
  viewSelector.replaceChildren(...views.map((view) => {
    const option = document.createElement('option');
    option.value = view.id;
    option.textContent = view.label;
    if (view.id === currentView) option.selected = true;
    return option;
  }));
  const previousDestination = captureDestination.value;
  captureDestination.replaceChildren(...collectionOptions(snapshot).map((option) => {
    const entry = document.createElement('option');
    entry.value = option.value;
    entry.textContent = option.label;
    return entry;
  }));
  // An existing draft destination survives rerenders; only an empty control resets to the view defaults.
  const validPrevious = collectionOptions(snapshot).some((option) => option.value === previousDestination);
  if (workspaceDraft || voiceSession) {
    // View navigation never retargets an active capture; only an explicit change
    // of the destination control (below) moves it. A voice review pins the
    // reviewed scope, which the destination control mirrors.
    const pinnedDestination = workspaceDraft ? draftCollectionId : voiceSession.scope.collectionId;
    const validCaptureDestination = collectionOptions(snapshot).some((option) => option.value === (pinnedDestination ?? ''));
    captureDestination.value = validCaptureDestination ? (pinnedDestination ?? '') : '';
  } else {
    captureDestination.value = validPrevious ? previousDestination : (defaultDestination(currentView).collectionId ?? '');
  }
  const rows = project(snapshot, currentView);
  quickItems.replaceChildren(...rows.map((item) => renderRow(item, snapshot)));
  $('#home-empty').classList.toggle('hidden', rows.length > 0);
  renderCollectionsPanel(snapshot);
  const forgetShortcut = $('#forget-shortcut');
  forgetShortcut.classList.toggle('hidden', !currentView.startsWith('collection:'));
}

function renderCollectionsPanel(snapshot) {
  const list = $('#collections-list');
  list.replaceChildren(...snapshot.collections.map((collection) => {
    const row = document.createElement('div');
    row.className = 'collection-row';
    const name = document.createElement('span');
    name.className = 'collection-name';
    name.textContent = collection.emoji ? `${collection.emoji} ${collection.name}` : collection.name;
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'text-button';
    rename.textContent = 'Renombrar';
    rename.addEventListener('click', () => showCollectionDialog(collection));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-button danger';
    remove.textContent = 'Quitar';
    remove.setAttribute('aria-label', `Quitar la colección ${collection.name}`);
    remove.addEventListener('click', () => removeCollectionRow(collection));
    row.append(name, rename, remove);
    return row;
  }));
}

const collectionDialog = $('#collection-dialog');
let editCollectionId = null;

function showCollectionDialog(collection = null) {
  editCollectionId = collection?.id ?? null;
  $('#collection-dialog-name').value = collection?.name ?? '';
  $('#collection-dialog-emoji').value = collection?.emoji ?? '';
  collectionDialog.showModal();
  $('#collection-dialog-name').focus();
}

$('#collection-form-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const values = { name: $('#collection-dialog-name').value, emoji: $('#collection-dialog-emoji').value };
    if (editCollectionId) await renameCollection(editCollectionId, values, lastSnapshot?.revision);
    else await createCollection(values, lastSnapshot?.revision);
    collectionDialog.close();
    await renderWorkspaceView();
  } catch (error) {
    setStatus(`No se pudo guardar la colección: ${error.message}`, true);
  }
});
$('#collection-dialog-cancel').addEventListener('click', () => collectionDialog.close());

$('#collection-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await createCollection({ name: $('#collection-name').value, emoji: $('#collection-emoji').value }, lastSnapshot?.revision);
    $('#collection-name').value = '';
    $('#collection-emoji').value = '';
    await renderWorkspaceView();
  } catch (error) {
    setStatus(`No se pudo crear la colección: ${error.message}`, true);
  }
});

async function removeCollectionRow(collection) {
  if (!confirm(`¿Quitar la colección “${collection.name}”? Sus artículos quedarán sin lista. Esta acción no se puede deshacer.`)) return;
  try {
    await removeCollection(collection.id, lastSnapshot?.revision);
    if (currentView === `collection:${collection.id}`) {
      // The saved shortcut of a removed collection falls back to a safe view.
      currentView = 'pendientes';
      storeView(currentView);
    }
    await renderWorkspaceView();
    setStatus(`Colección “${collection.name}” quitada; sus artículos quedaron sin lista.`);
  } catch (error) {
    setStatus(`No se pudo quitar la colección: ${error.message}`, true);
    await renderWorkspaceView().catch(() => {});
  }
}

$('#forget-shortcut').addEventListener('click', async () => {
  // A10: removing a saved shortcut deletes only the view definition; the
  // collection and its items stay intact and remain in the selector.
  const removed = currentView;
  const remaining = removeSavedView([savedView()], removed);
  currentView = remaining[0] ?? 'pendientes';
  storeView(currentView);
  await renderWorkspaceView();
  setStatus('Acceso directo quitado. La colección sigue disponible en el selector.');
});

viewSelector.addEventListener('change', () => {
  currentView = viewSelector.value;
  storeView(currentView);
  renderWorkspaceView().catch((error) => setStatus(error.message, true));
});

captureDestination.addEventListener('change', () => {
  if (workspaceDraft) {
    // An explicit destination override moves the draft before its confirmation;
    // view switching never retargets it (renderWorkspaceView pins it).
    draftCollectionId = captureDestination.value || null;
    renderDraft();
  }
  if (voiceSession && !voiceCommitting) {
    // Explicit re-scoping restarts the review against the new command scope;
    // the resolved answers belong to the previous scope and are discarded.
    const transcript = voiceSession.transcript;
    const audioId = voiceSession.audioId;
    const collectionId = captureDestination.value || null;
    readWorkspace()
      .then((snapshot) => {
        lastSnapshot = snapshot;
        voiceSession = createVoiceSession(analyzeVoiceTranscript(transcript, snapshot, { collectionId, audioId: audioId ?? undefined }), { audioId });
        renderDraft();
      })
      .catch((error) => setStatus(error.message, true));
  }
});

// The overflow menu is the single home for secondary actions (spec: one starting
// screen — header actions are the view selector and a labeled overflow menu).
const overflowButton = $('#overflow-button');
const overflowMenu = $('#overflow-menu');

function closeOverflowMenu({ refocus = false } = {}) {
  overflowMenu.classList.add('hidden');
  overflowButton.setAttribute('aria-expanded', 'false');
  if (refocus) overflowButton.focus();
}

overflowButton.addEventListener('click', () => {
  const opening = overflowMenu.classList.contains('hidden');
  overflowMenu.classList.toggle('hidden');
  overflowButton.setAttribute('aria-expanded', String(opening));
});
document.addEventListener('click', (event) => {
  if (!overflowMenu.classList.contains('hidden') && !event.target.closest('.overflow')) closeOverflowMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !overflowMenu.classList.contains('hidden')) closeOverflowMenu({ refocus: true });
});
$('#overflow-collections').addEventListener('click', () => {
  closeOverflowMenu();
  $('#collections-panel').scrollIntoView?.({ block: 'nearest' });
  $('#collection-name').focus();
});
$('#overflow-settings').addEventListener('click', () => {
  closeOverflowMenu();
  openSettings();
});

// Export (spec: Export): share/copy exactly the visible projection; the scope is
// stated in the dialog before any copy/share control and the text carries no
// source, attribute or diagnostic records.
const exportDialog = $('#export-dialog');
let exportViewText = '';

function openViewExport() {
  closeOverflowMenu();
  const snapshot = lastSnapshot;
  if (!snapshot) return;
  const rows = project(snapshot, currentView);
  if (rows.length === 0) {
    setStatus(`La vista “${viewScopeLabel(currentView, snapshot)}” no tiene artículos para exportar.`);
    return;
  }
  const scope = viewScopeLabel(currentView, snapshot);
  exportViewText = formatViewExport(currentView, snapshot);
  $('#export-scope').textContent = `${scope} · ${rows.length} artículo${rows.length === 1 ? '' : 's'}. Se exporta exactamente lo que ves, sin datos de origen ni diagnóstico.`;
  $('#export-preview').value = exportViewText;
  exportDialog.showModal();
}
$('#overflow-export').addEventListener('click', openViewExport);
$('#export-cancel').addEventListener('click', () => exportDialog.close());

async function exportCurrentView(mode) {
  if (!exportViewText) return;
  try {
    if (mode === 'copy') {
      await copyText(exportViewText);
      exportDialog.close();
      setStatus('Vista copiada al portapapeles.');
      return;
    }
    const result = await shareOrCopy(exportViewText);
    // Cancellation remains cancellation: no success message, no clipboard write.
    if (result === 'cancelled') { exportDialog.close(); return; }
    exportDialog.close();
    if (result === 'shared') setStatus('Vista compartida.');
    else setStatus('No se pudo compartir directamente; la vista se copió al portapapeles.');
  } catch (error) {
    // A failure never yields a success message; the dialog stays open for retry.
    setStatus(`No se pudo exportar la vista: ${error.message}`, true);
  }
}
$('#export-view-copy').addEventListener('click', () => exportCurrentView('copy'));
$('#export-view-share').addEventListener('click', () => exportCurrentView('share'));

async function moveRow(itemId, collectionId) {
  try {
    const before = lastSnapshot?.items.find((entry) => entry.id === itemId);
    const result = await moveItem(itemId, collectionId, lastSnapshot?.revision);
    if (result.moved) {
      lastReceipt = { action: 'membership', itemId, label: result.item.label, before, after: result.item };
      undoAwaitingConfirm = false;
      showActionReceipt(collectionId ? `${result.item.label} movido de colección.` : `${result.item.label} quitado de la colección.`);
    }
    await renderWorkspaceView();
  } catch (error) {
    setStatus(`No se pudo mover: ${error.message}`, true);
    await renderWorkspaceView().catch(() => {});
  }
}

function showReceipt(message, destinationCollectionId, snapshot) {
  captureReceipt.textContent = message;
  captureReceipt.classList.remove('hidden');
  const destinationView = destinationCollectionId ? 'collection:' + destinationCollectionId : 'pendientes';
  const visible = project(snapshot, currentView).some((row) => row.id === lastCapturedId)
    || (destinationCollectionId == null && currentView === 'pendientes');
  receiptGoto.classList.toggle('hidden', visible);
  receiptGoto.textContent = destinationCollectionId ? 'Ver en colección' : 'Ver en Pendientes';
  receiptGoto.onclick = () => {
    currentView = destinationView;
    storeView(currentView);
    renderWorkspaceView().catch((error) => setStatus(error.message, true));
  };
}

function updateLeaveWarning() {
  // Reload durability is not promised: only unsaved input installs the browser
  // leave warning, and only while it exists.
  const unsaved = (workspaceDraft && canConfirm(workspaceDraft)) || voiceSession != null;
  window.onbeforeunload = unsaved ? (event) => { event.preventDefault(); } : null;
}

function draftDestinationName() {
  return lastSnapshot?.collections.find((collection) => collection.id === draftCollectionId)?.name ?? 'Sin lista';
}

function renderDraft() {
  const captureActive = workspaceDraft != null || voiceSession != null;
  draftCard.classList.toggle('hidden', !captureActive);
  // A second capture waits for an explicit choice; it never silently replaces
  // the active capture.
  draftChoice.classList.toggle('hidden', !pendingDraftSource);
  draftRows.classList.toggle('hidden', workspaceDraft == null);
  draftScope.classList.toggle('hidden', workspaceDraft == null);
  draftActions.classList.toggle('hidden', workspaceDraft == null);
  renderVoice();
  if (!workspaceDraft) return;
  draftConfirm.disabled = !canConfirm(workspaceDraft) || draftCommitting;
  draftCancel.disabled = draftCommitting;
  draftConfirm.textContent = confirmLabel(workspaceDraft);
  draftScope.textContent = `Destino: ${draftDestinationName()}. Solo se agregan las propuestas seleccionadas.`;
  draftRows.replaceChildren(...workspaceDraft.rows.map((row, index) => renderDraftRow(row, index)));
  // Focus lands on the expanded editor only after its row is attached.
  draftRows.querySelector('input[type="text"]')?.focus();
}

// A05/A06: one question, one control. The voice card shows the first pending
// step (target, disposition, repair, repeat-add or blocked); once nothing is
// pending it lists concrete change summaries and enables Guardar N cambios.
function renderVoice() {
  const active = voiceSession != null;
  voiceCard.classList.toggle('hidden', !active);
  if (!active) return;
  voiceScope.textContent = `Cambios en ${voiceSession.scope.label}.`;
  const step = sessionStep(voiceSession);
  voiceChoices.replaceChildren();
  if (step) {
    voiceSummary.classList.add('hidden');
    voiceQuestion.textContent = step.question;
    voiceDetail.textContent = step.detail ?? '';
    voiceChoices.classList.remove('hidden');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Elige una opción';
    voiceChoices.append(placeholder);
    for (const choice of step.choices) {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.text;
      voiceChoices.append(option);
    }
    voiceChoices.value = '';
    // Unresolved proposals block the batch: no saving until answered or excluded.
    voiceConfirm.disabled = true;
    voiceConfirm.textContent = 'Guardar cambios';
    return;
  }
  const plan = sessionActions(voiceSession);
  voiceChoices.classList.add('hidden');
  voiceQuestion.textContent = plan.ok ? 'Revisa los cambios antes de guardarlos.' : 'Quedan propuestas sin resolver.';
  voiceDetail.textContent = '';
  voiceSummary.classList.toggle('hidden', !plan.ok || plan.actions.length === 0);
  voiceSummary.replaceChildren(...(plan.ok ? actionSummaries(plan.actions, voiceSession.snapshot) : []).map((text) => {
    const entry = document.createElement('li');
    entry.textContent = text;
    return entry;
  }));
  voiceConfirm.disabled = !plan.ok || voiceCommitting;
  voiceConfirm.textContent = `Guardar ${plan.actions.length} cambio${plan.actions.length === 1 ? '' : 's'}`;
}

function startVoiceSession(voice) {
  voiceSession = createVoiceSession(voice);
  voiceCommitting = false;
  draftStatus.textContent = CAPTURE_STATES.draft;
  renderDraft();
  updateLeaveWarning();
}

function renderDraftRow(row, index) {
  const element = document.createElement('div');
  element.className = 'draft-row';
  const include = document.createElement('input');
  include.type = 'checkbox';
  include.checked = row.included;
  include.setAttribute('aria-label', `Incluir ${row.label}`);
  include.addEventListener('change', () => {
    workspaceDraft = setRowIncluded(workspaceDraft, index, include.checked);
    renderDraft();
  });
  element.append(include);
  if (row.editing) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = row.label;
    input.setAttribute('aria-label', `Nombre del artículo ${index + 1}`);
    const collapseEdit = () => {
      workspaceDraft = setEditingRow(workspaceDraft, null);
      renderDraft();
    };
    const applyEdit = () => {
      // A04: the corrected label is saved; the raw source phrase stays untouched.
      workspaceDraft = editRowLabel(workspaceDraft, index, input.value);
      collapseEdit();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyEdit();
      if (event.key === 'Escape') collapseEdit();
    });
    element.append(input);
  } else {
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'draft-label';
    label.textContent = row.label;
    if (row.quantity != null) {
      // Rows read "Leche · 2 litros"; quantity fields expand only when edited.
      const amount = document.createElement('span');
      amount.className = 'draft-amount';
      amount.textContent = ` · ${row.quantity}${row.unit ? ` ${row.unit}` : ''}`;
      label.append(amount);
    }
    label.setAttribute('aria-label', `Editar ${row.label}`);
    label.addEventListener('click', () => {
      workspaceDraft = setEditingRow(workspaceDraft, index);
      renderDraft();
    });
    element.append(label);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-button draft-remove';
  remove.textContent = 'Quitar de esta captura';
  remove.setAttribute('aria-label', `Quitar ${row.label} de esta captura`);
  remove.addEventListener('click', () => {
    workspaceDraft = removeRow(workspaceDraft, index);
    renderDraft();
  });
  element.append(remove);
  return element;
}

function openIncomingCapture(incoming, { source, kind } = {}) {
  // Only one active capture: a plain draft and a voice review both count.
  const plan = planSecondCapture(workspaceDraft ?? (voiceSession ? voiceSession.candidates : null));
  if (plan.kind === 'choose') {
    // A second capture never silently overwrites the active capture.
    pendingDraftSource = { incoming, source, kind };
    draftChoice.classList.remove('hidden');
    draftStatus.textContent = 'Hay una captura sin confirmar.';
    return;
  }
  if (kind === 'voice') {
    startVoiceSession(incoming.voice);
    return;
  }
  workspaceDraft = incoming;
  draftCollectionId = captureDestination.value || null;
  draftStatus.textContent = CAPTURE_STATES.draft;
  renderDraft();
  updateLeaveWarning();
}

function openDraft(incoming, { source } = {}) {
  openIncomingCapture(incoming, { source, kind: 'draft' });
}

function discardDraft(message = 'Captura descartada. No se agregó nada.') {
  workspaceDraft = null;
  pendingDraftSource = null;
  draftCommitting = false;
  renderDraft();
  updateLeaveWarning();
  setStatus(message);
}

$('#draft-continue').addEventListener('click', () => {
  pendingDraftSource = null;
  renderDraft();
});
$('#draft-replace').addEventListener('click', () => {
  const pending = pendingDraftSource;
  workspaceDraft = null;
  voiceSession = null;
  pendingDraftSource = null;
  if (!pending) return;
  if (pending.kind === 'voice') startVoiceSession(pending.incoming.voice);
  else openDraft(pending.incoming, { source: pending.source });
});
draftCancel.addEventListener('click', () => discardDraft());

voiceChoices.addEventListener('change', () => {
  if (!voiceSession || !voiceChoices.value || voiceCommitting) return;
  const step = sessionStep(voiceSession);
  if (!step) return;
  try {
    voiceSession = answerStep(voiceSession, step, voiceChoices.value);
  } catch (error) {
    setStatus(error.message, true);
  }
  renderDraft();
});

voiceCancel.addEventListener('click', () => {
  // Cancellation writes nothing: the session is dropped before any commit.
  voiceSession = null;
  voiceCommitting = false;
  renderDraft();
  updateLeaveWarning();
  setStatus('Cambios descartados. No se guardó nada.');
});

// Single-action voice commits get an undoable receipt (archive, membership and
// quantity inverses already exist); multi-action batches report without undo.
function voiceReceipt(session, actions) {
  if (actions.length !== 1) return false;
  const action = actions[0];
  const item = session.snapshot.items.find((entry) => entry.id === action.itemId) ?? null;
  if (action.kind === 'archive') {
    return { action: 'archive', itemId: action.itemId, label: item?.label ?? 'artículo', before: item, after: item ? { ...item, archived: true } : null };
  }
  if (action.kind === 'detach') {
    return {
      action: 'membership', itemId: action.itemId, label: item?.label ?? 'artículo',
      before: { collectionId: action.fromCollectionId }, after: { collectionId: null },
    };
  }
  if (action.kind === 'increment') {
    return {
      action: 'quantity', itemId: action.itemId, label: item?.label ?? 'artículo',
      before: item ? { quantity: item.quantity, unit: item.unit } : null,
      after: { quantity: (item?.quantity ?? 0) + action.quantity, unit: action.unit ?? item?.unit },
    };
  }
  if (action.kind === 'add') {
    return { action: 'capture', itemId: action.item.id, label: action.item.label, before: null, after: action.item };
  }
  return false;
}

voiceConfirm.addEventListener('click', async () => {
  if (!voiceSession || voiceCommitting) return;
  const plan = sessionActions(voiceSession);
  if (!plan.ok) return;
  voiceCommitting = true;
  renderDraft();
  const session = voiceSession;
  try {
    // Retry after an unknown transaction result reuses the session's operation
    // ID and payload first (A14); a renewed session after stale rejection
    // carries a fresh identity for the re-reviewed plan.
    await commitVoiceActions(plan.actions, session.operationId, lastSnapshot?.revision);
    lastSnapshot = await readWorkspace();
    const pending = pendingDraftSource;
    voiceSession = null;
    pendingDraftSource = null;
    voiceCommitting = false;
    renderDraft();
    updateLeaveWarning();
    await renderWorkspaceView();
    const summaries = actionSummaries(plan.actions, session.snapshot).join('; ');
    showActionReceipt(`Cambios guardados: ${summaries}.`, voiceReceipt(session, plan.actions));
    // A capture that arrived while committing is offered again, not dropped.
    if (pending) openIncomingCapture(pending.incoming, { source: pending.source, kind: pending.kind });
  } catch (error) {
    voiceCommitting = false;
    if (/actualizó|membresía cambió|ya no existe/i.test(error.message)) {
      // A18/A13: the workspace or a membership changed mid-review; refresh the
      // analysis and require fresh confirmation — never commit against stale data.
      try {
        const fresh = await readWorkspace();
        lastSnapshot = fresh;
        voiceSession = createVoiceSession(analyzeVoiceTranscript(session.transcript, fresh, {
          collectionId: session.scope.collectionId, audioId: session.audioId ?? undefined,
        }), { audioId: session.audioId });
        setStatus('Esto cambió en otra pestaña. Revisa el valor actual y confirma de nuevo.', true);
      } catch {
        voiceSession = session;
        setStatus(`No se pudo guardar: ${error.message}`, true);
      }
    } else {
      // A15: storage failure keeps the review open with its resolutions and offers retry.
      setStatus(`No se pudo guardar: ${error.message}. La revisión sigue abierta; puedes reintentar.`, true);
    }
    renderDraft();
    if (pendingDraftSource) draftChoice.classList.remove('hidden');
  }
});

draftConfirm.addEventListener('click', async () => {
  if (!workspaceDraft || !canConfirm(workspaceDraft) || draftCommitting) return;
  draftCommitting = true;
  renderDraft();
  draftStatus.textContent = CAPTURE_STATES.committing;
  const proposals = payloadForCommit(workspaceDraft);
  const operationId = crypto.randomUUID();
  const destinationCollectionId = draftCollectionId;
  try {
    const items = await captureBatch(proposals, operationId, lastSnapshot?.revision, { collectionId: destinationCollectionId });
    lastCapturedId = items[items.length - 1]?.id ?? null;
    const count = items.length;
    const pending = pendingDraftSource;
    workspaceDraft = null;
    pendingDraftSource = null;
    draftCommitting = false;
    renderDraft();
    updateLeaveWarning();
    await renderWorkspaceView();
    const where = destinationCollectionId
      ? (lastSnapshot?.collections.find((c) => c.id === destinationCollectionId)?.name ?? 'colección')
      : 'Pendientes';
    showReceipt(`${count} artículo${count === 1 ? '' : 's'} guardado${count === 1 ? '' : 's'} en ${where}.`, destinationCollectionId, lastSnapshot);
    // A capture that arrived while committing is offered again, not dropped.
    if (pending) openDraft(pending.incoming, { source: pending.source });
  } catch (error) {
    // A15: storage failure keeps the draft open with its values and offers retry.
    draftCommitting = false;
    renderDraft();
    if (pendingDraftSource) draftChoice.classList.remove('hidden');
    setStatus(`No se pudo guardar: ${error.message}. La revisión sigue abierta; puedes reintentar.`, true);
  }
});

quickCaptureForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const label = quickCaptureInput.value;
  // Multiline typed/pasted input reviews inline; a single line stays literal.
  const multilineDraft = draftFromText(label);
  if (multilineDraft) {
    quickCaptureInput.value = '';
    openDraft(multilineDraft, { source: 'text' });
    return;
  }
  if (!label.trim()) return;
  quickCaptureInput.disabled = true;
  quickCaptureSubmit.disabled = true;
  try {
    const destinationCollectionId = captureDestination.value || null;
    const captured = await captureItem(label, crypto.randomUUID(), lastSnapshot?.revision, { collectionId: destinationCollectionId });
    lastCapturedId = captured.id;
    lastReceipt = { action: 'capture', itemId: captured.id, label: captured.label, before: null, after: captured };
    undoAwaitingConfirm = false;
    quickCaptureInput.value = '';
    const snapshot = await readWorkspace();
    lastSnapshot = snapshot;
    await renderWorkspaceView();
    const where = destinationCollectionId
      ? (snapshot.collections.find((c) => c.id === destinationCollectionId)?.name ?? 'colección')
      : 'Pendientes';
    showReceipt(`Guardado en ${where}.`, destinationCollectionId, snapshot);
  } catch (error) {
    setStatus(`No se pudo guardar: ${error.message}`, true);
  } finally {
    quickCaptureInput.disabled = false;
    quickCaptureSubmit.disabled = false;
  }
});
// Resolve against the real snapshot on first render; a cold start must not
// downgrade a saved collection view before the snapshot exists.
currentView = savedView() ?? 'pendientes';
renderWorkspaceView().catch((error) => setStatus(error.message, true));
const listView = $('#list-view');
const listsGrid = $('#lists-grid');
const itemsList = $('#items-list');
const itemsEmpty = $('#items-empty');
const listHeading = $('#list-heading');
const appStatus = $('#app-status');
bindDatabaseStatus(appStatus);
window.addEventListener('error', (event) => recordDebugEvent('runtime.error', {
  kind: 'window', errorName: event.error?.name || 'ErrorEvent', message: event.message,
}));
window.addEventListener('unhandledrejection', (event) => recordDebugEvent('runtime.error', {
  kind: 'unhandled-rejection', errorName: event.reason?.name || 'UnhandledRejection', message: event.reason?.message,
}));
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
  recordDebugEvent('worker.initialize.error', { errorName: error?.name || 'WorkerError' });
  console.error('No se pudo iniciar el trabajador de audio', error);
}
recordDebugEvent('app.start', { language: navigator.language ?? 'unknown' });

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
  contextPreviewControl = renderContextPreview({
    document, container: previewRows, review,
    onChange(index, resolution) {
      recordDebugEvent('preview.resolution.changed', {
        candidateIndex: index,
        intent: review.analysis.candidates[index]?.intent ?? 'unknown',
        selected: resolution.selected !== false,
        hasTarget: Boolean(resolution.targetItemId),
        hasAssertion: Boolean(resolution.assertionId),
        hasPriceAmount: Boolean(resolution.priceAmount),
        hasObservedAt: Boolean(resolution.observedAt),
        inputValues: {
          targetItemId: resolution.targetItemId, assertionId: resolution.assertionId,
          action: resolution.action, priceAmount: resolution.priceAmount,
          priceCurrency: resolution.priceCurrency, observedAt: resolution.observedAt,
          evidenceSource: resolution.evidenceSource,
        },
      }, { operationId: review.operationId });
    },
  });
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
      contextPreviewControl = renderContextPreview({
        document, container: previewRows, review: freshReview,
        onChange(index, resolution) {
          recordDebugEvent('preview.resolution.changed', {
            candidateIndex: index, intent: freshReview.analysis.candidates[index]?.intent ?? 'unknown',
            selected: resolution.selected !== false, hasTarget: Boolean(resolution.targetItemId),
            hasAssertion: Boolean(resolution.assertionId), hasPriceAmount: Boolean(resolution.priceAmount),
            hasObservedAt: Boolean(resolution.observedAt),
            inputValues: {
              targetItemId: resolution.targetItemId, assertionId: resolution.assertionId,
              action: resolution.action, priceAmount: resolution.priceAmount,
              priceCurrency: resolution.priceCurrency, observedAt: resolution.observedAt,
              evidenceSource: resolution.evidenceSource,
            },
          }, { operationId: freshReview.operationId });
        },
      });
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
    check.dataset.debugTarget = 'item-toggle';
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
    remove.dataset.debugTarget = 'item-delete';
    row.append(check, label, quantity, remove);
    itemsList.append(row);
  }
}

async function openList(id) {
  recordDebugEvent('navigation.open-list', { listId: id });
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
  recordDebugEvent('navigation.home');
  activeList = null;
  listView.classList.add('hidden');
  homeView.classList.remove('hidden');
  $('#back-button').classList.add('hidden');
  setStatus('');
  renderHome().catch(showDatabaseError);
}

function setCaptureLock(locked) {
  captureLocked = locked;
  for (const selector of ['#create-list', '#back-button', '#rename-list', '#delete-list', '#settings-button', '#export-copy', '#export-share', '#overflow-button', '#audio-file']) {
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
$('#settings-cancel').addEventListener('click', () => settingsDialog.close());
$('#delete-list').addEventListener('click', async () => {
  if (!activeList || !confirm(`¿Quitar la lista “${activeList.name}”? Sus artículos quedarán sin lista.`)) return;
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
  const debugSettings = configureDebug({
    enabled: $('#debug-log-setting').checked,
    captureText: $('#debug-text-setting').checked,
  });
  recordDebugEvent('settings.saved', {
    language: appSettings.language, model: appSettings.model, saveAudio: appSettings.saveAudio,
    debugEnabled: debugSettings.enabled, captureText: debugSettings.captureText,
  });
  settingsDialog.close();
  setStatus(saved ? 'Preferencias guardadas.' : 'Preferencias activas, pero el navegador no pudo guardarlas.', !saved);
});

function openSettings() {
  recordDebugEvent('navigation.settings');
  $('#language-setting').value = appSettings.language;
  $('#model-setting').value = appSettings.model;
  $('#save-audio-setting').checked = appSettings.saveAudio;
  const debug = getDebugOptions();
  $('#debug-log-setting').checked = debug.enabled;
  $('#debug-text-setting').checked = debug.captureText;
  settingsDialog.showModal();
}

$('#debug-log-setting').addEventListener('change', () => {
  if (!$('#debug-log-setting').checked) configureDebug({ enabled: false });
});
$('#debug-text-setting').addEventListener('change', () => {
  configureDebug({ captureText: $('#debug-text-setting').checked });
});
$('#debug-export').addEventListener('click', () => {
  try {
    recordDebugEvent('debug.export');
    const contents = JSON.stringify(exportDebugLog(), null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `listar-debug-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus('Se descargó el registro local de diagnóstico.');
  } catch { setStatus('No se pudo exportar el registro de diagnóstico.', true); }
});
$('#debug-clear').addEventListener('click', () => {
  if (!confirm('¿Borrar el registro local de diagnóstico?')) return;
  clearDebugLog();
  setStatus('Se borró el registro local de diagnóstico.');
});

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
  recordDebugEvent('mic.start', { listId: captureTargetId });
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
      recordDebugEvent('mic.stop', { listId: captureTargetId, byteLength: blob.size });
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
      recordDebugEvent('mic.error', { errorName: event.error?.name || 'MediaRecorderError', message: event.error?.message });
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
    recordDebugEvent('mic.ready', { listId: captureTargetId, mimeType: mediaRecorder.mimeType || mimeType || 'unknown' });
  } catch (error) {
    recordDebugEvent('mic.error', { errorName: error?.name || 'MicrophoneError', message: error?.message });
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

// Workspace dictation: record/import → processing → inline draft → Agregar N.
// The legacy list-view modal preview stays untouched for list-scoped capture.
const homeRecordButton = $('#home-record-button');
const homeAudioFile = $('#home-audio-file');
const homeCaptureStatus = $('#home-capture-status');
const homeProgressRegion = $('#home-progress-region');
const homeProgressMessage = $('#home-progress-message');
let homeMediaRecorder = null;
let homeMicStream = null;
let homeRecordingParts = [];
let homeRecordingStartedAt = 0;
let homeTimerHandle = null;
let pendingWorkspaceTranscription = null;

function setHomeCaptureStatus(message, isError = false) {
  homeCaptureStatus.textContent = message;
  homeCaptureStatus.classList.toggle('error', isError);
}

function showHomeProgress(message) {
  homeProgressMessage.textContent = message;
  homeProgressRegion.classList.remove('hidden');
  setHomeCaptureStatus(message);
}

function hideHomeProgress() {
  homeProgressRegion.classList.add('hidden');
}

function releaseHomeMicrophone() {
  if (homeMicStream) homeMicStream.getTracks().forEach((track) => track.stop());
  homeMicStream = null;
  homeMediaRecorder = null;
}

async function startHomeRecording() {
  if (draftCommitting || voiceCommitting) return;
  setHomeCaptureStatus(CAPTURE_STATES.requesting);
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    setHomeCaptureStatus('Este navegador no permite dictar. Puedes escribir o subir un audio.', true);
    return;
  }
  try {
    homeMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find((type) => MediaRecorder.isTypeSupported(type));
    homeMediaRecorder = new MediaRecorder(homeMicStream, mimeType ? { mimeType } : {});
    homeRecordingParts = [];
    homeMediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) homeRecordingParts.push(event.data);
    });
    homeMediaRecorder.addEventListener('stop', async () => {
      const blob = new Blob(homeRecordingParts, { type: homeMediaRecorder?.mimeType || mimeType || 'audio/webm' });
      releaseHomeMicrophone();
      homeRecordButton.classList.remove('recording');
      homeRecordButton.setAttribute('aria-label', 'Dictar artículos');
      $('#home-record-icon').textContent = '🎙';
      clearInterval(homeTimerHandle);
      $('#home-record-timer').classList.add('hidden');
      if (blob.size) await processWorkspaceAudio(blob);
      else setHomeCaptureStatus('La grabación quedó vacía. Intenta hablar un poco más.', true);
    }, { once: true });
    homeMediaRecorder.start(250);
    homeRecordingStartedAt = Date.now();
    homeRecordButton.classList.add('recording');
    homeRecordButton.setAttribute('aria-label', 'Detener dictado');
    $('#home-record-icon').textContent = '■';
    $('#home-record-timer').classList.remove('hidden');
    homeTimerHandle = setInterval(() => {
      $('#home-record-timer').textContent = formatTime(Math.floor((Date.now() - homeRecordingStartedAt) / 1000));
    }, 250);
    setHomeCaptureStatus(CAPTURE_STATES.recording);
  } catch (error) {
    releaseHomeMicrophone();
    setHomeCaptureStatus(`No se pudo iniciar el micrófono: ${error.message}. Puedes escribir o subir un audio.`, true);
  }
}

homeRecordButton.addEventListener('click', () => {
  if (homeMediaRecorder?.state === 'recording') homeMediaRecorder.stop();
  else startHomeRecording();
});

homeAudioFile.addEventListener('change', async () => {
  const file = homeAudioFile.files?.[0];
  homeAudioFile.value = '';
  if (file) await processWorkspaceAudio(file);
});

$('#home-cancel-transcription').addEventListener('click', () => {
  pendingWorkspaceTranscription?.cancel();
});

async function processWorkspaceAudio(blob) {
  if (voiceCommitting) return;
  const correlationId = `home-audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  showHomeProgress(CAPTURE_STATES.processing);
  try {
    const audio = await decodeAudioToMono16k(blob, globalThis.AudioContext || globalThis.webkitAudioContext);
    if (!audio.data.length) throw new Error('El audio no contiene muestras.');
    const options = { task: 'transcribe' };
    if (appSettings.language !== 'auto') options.language = appSettings.language;
    pendingWorkspaceTranscription = transcribeWithWorker(worker, audio.data, appSettings.model, options, ({ message }) => showHomeProgress(message), correlationId);
    const result = await pendingWorkspaceTranscription;
    pendingWorkspaceTranscription = null;
    hideHomeProgress();
    if (result.empty || !result.text.trim()) {
      setHomeCaptureStatus('No se escuchó nada claro. No se agregó ningún artículo.');
      return;
    }
    // A05/A06: dictation that proposes changes routes through one question at a
    // time; plain item dictation keeps the inline add draft. The reviewed
    // command scope is the chosen destination, or the whole workspace.
    const snapshot = await readWorkspace();
    lastSnapshot = snapshot;
    const voice = analyzeVoiceTranscript(result.text, snapshot, { collectionId: captureDestination.value || null });
    if (voice.commandLike) {
      openIncomingCapture({ voice }, { source: 'audio', kind: 'voice' });
      setHomeCaptureStatus('Dictado con cambios. Resuelve una pregunta a la vez.');
      return;
    }
    const incoming = draftFromTranscript(result.text);
    if (!incoming || incoming.rows.length === 0) {
      setHomeCaptureStatus('No se escuchó nada claro. No se agregó ningún artículo.');
      return;
    }
    // A02/A04: interpreted audio reviews inline; nothing persists until Agregar N.
    openDraft(incoming, { source: 'audio' });
    setHomeCaptureStatus('Dictado listo. Revísalo antes de agregar.');
  } catch (error) {
    pendingWorkspaceTranscription = null;
    hideHomeProgress();
    if (error.name === 'AbortError') setHomeCaptureStatus('Transcripción cancelada.');
    // A17/A15: never claim success; keep the flow and offer typing/retry.
    else setHomeCaptureStatus(`No se pudo transcribir: ${error.message}. Puedes escribirlo o reintentar.`, true);
  }
}

async function processAudio(blob, { targetListId = activeList?.id, lockAlready = false } = {}) {
  if (captureLocked && !lockAlready) return;
  if (!targetListId) { setStatus('Abre una lista antes de agregar audio.', true); return; }
  if (!worker) { setCaptureLock(false); setStatus('No se pudo iniciar el transcriptor. Recarga la página e inténtalo de nuevo.', true); return; }
  if (!lockAlready) setCaptureLock(true);
  let keepLockedForPreview = false;
  const correlationId = `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    recordDebugEvent('audio.decode.start', { listId: targetListId, mediaSource: typeof File !== 'undefined' && blob instanceof File ? 'file' : 'recording', byteLength: blob?.size ?? null }, { correlationId });
    setStatus('Preparando audio…');
    showProgress('Decodificando y convirtiendo audio a 16 kHz…');
    const audio = await decodeAudioToMono16k(blob, globalThis.AudioContext || globalThis.webkitAudioContext);
    recordDebugEvent('audio.decode.complete', { sampleCount: audio.data.length, sampleRate: audio.sampleRate, duration: audio.duration }, { correlationId });
    if (!audio.data.length) throw new Error('El audio no contiene muestras.');
    showProgress('Preparando modelo Whisper…');
    const options = { task: 'transcribe' };
    if (appSettings.language !== 'auto') options.language = appSettings.language;
    pendingAudioId = null;
    pendingTranscription = transcribeWithWorker(worker, audio.data, appSettings.model, options, ({ message }) => showProgress(message), correlationId);
    const result = await pendingTranscription;
    pendingTranscription = null;
    recordDebugEvent('transcription.complete', { empty: result.empty === true, text: result.text }, { correlationId });
    hideProgress();
    const audioRecord = await saveAudioCapture(targetListId, blob, result.text, appSettings.model, appSettings.saveAudio);
    pendingAudioId = audioRecord?.id ?? null;
    if (result.empty || !result.text.trim()) {
      setStatus('No se escuchó nada claro. No se agregó ningún artículo.');
      return;
    }
    const contextualReview = await prepareContextReview(result.text, targetListId, { audioId: pendingAudioId, debugCorrelationId: correlationId });
    if (!isAppendOnlyExtraction(contextualReview.analysis)) {
      recordDebugEvent('preview.context.open', { listId: targetListId, version: contextualReview.snapshot.version, candidateCount: contextualReview.analysis.candidates.length }, { correlationId });
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
    recordDebugEvent('preview.append.open', { listId: targetListId, itemCount: previewDraft.length }, { correlationId });
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
    recordDebugEvent('audio.pipeline.error', { errorName: error?.name || 'AudioPipelineError', message: error?.message }, { correlationId });
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
    selected.dataset.debugTarget = 'preview-select';
    selected.checked = item.selected;
    selected.setAttribute('aria-label', `Incluir ${item.label}`);
    selected.addEventListener('change', () => { item.selected = selected.checked; label.required = item.selected; });
    const editor = document.createElement('div');
    editor.className = 'preview-editor';
    const label = document.createElement('input');
    label.type = 'text';
    label.dataset.debugTarget = 'preview-label';
    label.required = item.selected;
    label.value = item.label;
    label.setAttribute('aria-label', `Nombre del artículo ${index + 1}`);
    label.addEventListener('input', () => { item.label = label.value; });
    const quantityRow = document.createElement('div');
    quantityRow.className = 'quantity-editor';
    const quantity = document.createElement('input');
    quantity.type = 'number';
    quantity.dataset.debugTarget = 'preview-quantity';
    quantity.step = 'any';
    quantity.min = '0';
    quantity.value = item.quantity ?? '';
    quantity.placeholder = 'Cantidad';
    quantity.setAttribute('aria-label', `Cantidad de ${item.label}`);
    quantity.addEventListener('input', () => { item.quantity = quantity.value === '' ? undefined : Number(quantity.value); });
    const unit = document.createElement('input');
    unit.type = 'text';
    unit.dataset.debugTarget = 'preview-unit';
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
$('#preview-cancel').addEventListener('click', () => {
  recordDebugEvent('preview.cancel');
  if (discardPreview()) previewDialog.close();
});
previewDialog.addEventListener('cancel', (event) => {
  recordDebugEvent('preview.cancel', { source: 'escape' });
  if (!discardPreview()) event.preventDefault();
});

$('#cancel-transcription').addEventListener('click', () => {
  recordDebugEvent('transcription.cancel');
  pendingTranscription?.cancel();
});

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
