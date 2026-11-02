import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('app shell exposes home, list actions, capture, and editable confirmation controls', () => {
  const html = read('index.html');
  for (const id of [
    'home-view', 'lists-grid', 'create-list', 'list-view', 'rename-list', 'delete-list',
    'items-list', 'clear-done', 'record-button', 'audio-file', 'progress-region',
    'settings-button', 'settings-dialog', 'language-setting', 'model-setting', 'save-audio-setting',
    'clear-audio', 'export-copy', 'export-share', 'debug-log-setting', 'debug-text-setting', 'debug-export', 'debug-clear',
    'cancel-transcription', 'preview-dialog', 'preview-rows', 'preview-eyebrow', 'preview-heading', 'preview-description', 'confirm-append',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /type="module" src="\.\/script\.js"/);
});

test('UI uses real IndexedDB domain APIs, worker protocol, splitter preview, and safe append controls', () => {
  const script = read('script.js');
  for (const operation of ['List.all()', 'Item.list(', 'createList(', 'renameList(', 'deleteList(', 'toggleItem(', 'deleteItem(', 'clearDoneItems(']) {
    assert.ok(script.includes(operation), `expected UI to use ${operation}`);
  }
  assert.match(script, /decodeAudioToMono16k\(blob/);
  assert.match(script, /transcribeWithWorker\(worker, audio\.data/);
  assert.match(script, /result\.empty[\s\S]*No se escuchó nada claro/);
  assert.match(script, /makePreview\(result\.text\)/);
  assert.match(script, /if \(appSettings\.language !== 'auto'\) options\.language = appSettings\.language/);
  assert.match(script, /saveAudioCapture\(targetListId, blob, result\.text, appSettings\.model, appSettings\.saveAudio\)/);
  assert.match(script, /pendingAudioId = audioRecord\?\.id \?\? null/);
  assert.match(script, /formatListExport\(await Item\.list\(activeList\.id\)\)/);
  assert.match(script, /shareOrCopy\(text\)/);
  assert.match(script, /clearAudioForList\(activeList\.id\)/);
  assert.doesNotMatch(script, /Dijiste:/);
  assert.match(script, /createPreviewSubmission\(/);
  assert.match(script, /prepareContextReview\(result\.text, targetListId/);
  assert.match(script, /isAppendOnlyExtraction\(contextualReview\.analysis\)/);
  assert.match(script, /showContextPreview\(contextualReview\)/);
  assert.match(script, /createContextConfirmation\(freshReview\)/);
  assert.match(script, /Confirmar cambios/);
  assert.match(script, /consumeSharedAudio\(queuedSharedAudioToken\)/);
  assert.match(script, /queuedSharedAudioToken = url\.searchParams\.get\('shared_audio'\)/);
  assert.match(script, /storeSharedAudio\(audio\)/);
  assert.match(script, /url\.searchParams\.delete\('shared_audio'\)/);
  assert.match(script, /querySelectorAll\('input'\)\]\.map\(\(field, fieldIndex\) => fieldIndex === 0 \? field\.checked : field\.value\)/);
  assert.match(script, /onBusy: \(busy\) => \{ appendPending = busy/);
  assert.match(script, /getTargetId: \(\) => previewTargetListId/);
  assert.match(script, /bindDatabaseStatus\(appStatus\)/);
});

test('home offers direct unassigned capture wired to the guarded workspace', () => {
  const html = read('index.html');
  for (const id of ['quick-capture', 'quick-capture-input', 'quick-capture-submit', 'quick-items']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const script = read('script.js');
  assert.ok(script.includes('applyItemUpdate, toggleDone, setArchived, applyItemFields, removeCapturedItem'));
  assert.match(script, /await captureItem\(label, crypto\.randomUUID\(\), lastSnapshot\?\.revision/);
  assert.match(script, /quickCaptureInput\.value = ''/);
  assert.match(script, /setStatus\(`No se pudo guardar: \$\{error\.message\}`, true\)/);
  assert.match(script, /quickCaptureSubmit\.disabled = true/);
  assert.match(script, /quickCaptureSubmit\.disabled = false/);
});

test('home exposes checklist views, destination control, receipt and per-row moves', () => {
  const html = read('index.html');
  for (const id of ['view-selector', 'capture-destination', 'capture-receipt', 'receipt-goto']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const script = read('script.js');
  assert.ok(script.includes("import { project, defaultDestination, resolveSavedView, STANDARD_VIEWS } from './views.mjs'"));
  assert.ok(script.includes('moveItem(itemId, collectionId'));
  assert.match(script, /currentView = savedView\(\) \?\? 'pendientes'/);
  assert.match(script, /Ver en Pendientes/);
  assert.match(script, /Guardado en \$\{where\}\./);
  assert.match(script, /storeView\(currentView\)/);
});

test('home manages collections without deleting items and distinguishes shortcuts from collections', () => {
  const html = read('index.html');
  for (const id of ['collections-panel', 'collection-form', 'collection-name', 'collection-emoji', 'collections-list', 'collection-dialog', 'forget-shortcut']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const script = read('script.js');
  assert.ok(script.includes('createCollection('));
  assert.ok(script.includes('renameCollection('));
  assert.ok(script.includes('removeCollection('));
  assert.ok(script.includes('removeSavedView('));
  assert.match(script, /quedar[aá]n sin lista/);
  assert.match(script, /sigue disponible en el selector/);
  assert.match(script, /no se puede deshacer/i);
});

test('home header has exactly two action groups: view selector and overflow menu', () => {
  const html = read('index.html');
  const topbar = html.match(/<header class="topbar">[\s\S]*?<\/header>/)[0];
  assert.doesNotMatch(topbar, /create-list/, 'legacy list creation belongs in the overflow menu');
  assert.doesNotMatch(topbar, /settings/i, 'settings has a single overflow entry, never a header link');
  const viewBar = html.match(/<div class="view-bar">[\s\S]*?(?=<p class="subhead")/)[0];
  assert.match(viewBar, /id="view-selector"/);
  assert.match(viewBar, /id="overflow-button"/);
  assert.match(viewBar, /id="overflow-menu"/);
  assert.doesNotMatch(viewBar, /id="capture-destination"/, 'destination is a capture control, not a header action');
  assert.match(html, /<label[^>]*for="capture-destination"[^>]*>\s*Destino\s*<\/label>/);
  assert.doesNotMatch(html, /id="open-settings"/, 'no separate settings link near capture');
});

test('overflow menu gathers list creation, view copy/share, collections and the single settings entry', () => {
  const html = read('index.html');
  for (const id of [
    'overflow-button', 'overflow-menu', 'overflow-export', 'overflow-collections', 'overflow-settings',
    'export-dialog', 'export-scope', 'export-preview', 'export-view-copy', 'export-view-share',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  const menu = html.match(/<div id="overflow-menu"[\s\S]*?<\/div>/)[0];
  assert.match(menu, /id="create-list"/);
  assert.match(menu, /Compartir o copiar vista/);
  assert.match(menu, /Colecciones/);
  assert.match(menu, /Configuración/);
  const dialog = html.match(/<dialog id="export-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.match(dialog, /readonly/);
  // The user sees the scope before any copy/share control (spec: Export).
  assert.ok(dialog.indexOf('id="export-scope"') < dialog.indexOf('id="export-view-copy"'));
  assert.ok(dialog.indexOf('id="export-preview"') < dialog.indexOf('id="export-view-share"'));
});

test('view export projects the visible scope and honours cancellation without a success claim', () => {
  const script = read('script.js');
  assert.ok(script.includes("from './view-export.mjs'"));
  assert.match(script, /formatViewExport\(currentView, snapshot\)/);
  assert.match(script, /project\(snapshot, currentView\)/);
  assert.match(script, /viewScopeLabel\(currentView, snapshot\)/);
  assert.match(script, /shareOrCopy\(exportViewText\)/);
  assert.match(script, /await copyText\(exportViewText\)/);
  assert.match(script, /if \(result === 'cancelled'\)/);
  assert.match(script, /Vista copiada al portapapeles\./);
  assert.match(script, /Vista compartida\./);
  assert.doesNotMatch(script, /open-settings/);
  // Exactly one settings entry point in the overflow menu.
  assert.match(script, /\$\('#overflow-settings'\)\.addEventListener\('click'/);
  assert.match(script, /closeOverflowMenu/);
});

test('settings keep language and retention first, model under Avanzado, diagnostics under Ayuda y diagnóstico', () => {
  const html = read('index.html');
  const settings = html.match(/<dialog id="settings-dialog"[\s\S]*?<\/dialog>/)[0];
  for (const id of [
    'language-setting', 'save-audio-setting', 'model-setting', 'clear-audio',
    'debug-settings', 'debug-log-setting', 'debug-text-setting', 'debug-export', 'debug-clear',
  ]) assert.match(settings, new RegExp(`id="${id}"`));
  const order = [
    settings.indexOf('id="language-setting"'),
    settings.indexOf('id="save-audio-setting"'),
    settings.indexOf('id="advanced-settings"'),
    settings.indexOf('id="debug-settings"'),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'language and retention come first, diagnostics last');
  assert.match(settings, /<fieldset id="advanced-settings"[^>]*>[\s\S]*?<legend>Avanzado<\/legend>[\s\S]*?id="model-setting"/);
  assert.match(settings, /<fieldset id="debug-settings"[^>]*>[\s\S]*?<legend>Ayuda y diagnóstico<\/legend>/);
  assert.doesNotMatch(settings, /id="debug-log-setting"[^>]*checked/, 'diagnostics stay default-off');
  assert.doesNotMatch(settings, /id="debug-text-setting"[^>]*checked/);
});

test('rows expose inline editing, completion, details and archive without per-row delete', () => {
  const html = read('index.html');
  for (const id of ['action-receipt', 'action-undo']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Deshacer/);
  const script = read('script.js');
  assert.ok(script.includes('applyItemUpdate, toggleDone, setArchived'));
  assert.match(script, /Guardar/);
  assert.match(script, /Cancelar/);
  assert.match(script, /Agregar cantidad/);
  assert.match(script, /Archivar/);
  assert.match(script, /Restaurar/);
  assert.match(script, /row-label/);
  assert.ok(script.includes("import { planUndo } from './undo.mjs'"));
  assert.match(script, /planUndo\(lastReceipt, current, \{ confirmStale: undoAwaitingConfirm \}\)/);
  assert.match(script, /removeCapturedItem\(plan\.itemId, snapshot\.revision, \{ expected \}\)/);
  assert.match(script, /Esto cambió en otra pestaña/);
  assert.match(script, /event\.key === 'Enter'/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.doesNotMatch(script, /row-delete/);
});

test('shared audio handoffs are durable through an intake card with frozen-identity commits', () => {
  const html = read('index.html');
  for (const id of ['intake-card', 'intake-summary', 'intake-review', 'intake-discard']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /hasta que lo guardes o lo descartes[^<]*Destino: Sin lista/);
  const script = read('script.js');
  assert.ok(script.includes("import { planRecovery, nextOperationIdentity } from './intake.mjs'"));
  assert.match(script, /await Intake\.save\(\{ token, createdAt: Date\.now\(\), status: 'pending' \}\)/);
  assert.match(script, /recoverIntakes\(\)\.catch/);
  assert.match(script, /planRecovery\(intakes, receiptIds\)/);
  assert.match(script, /await Intake\.save\(activeIntake\);/);
  assert.match(script, /await finishIntakeCleanup\(activeIntake\);/);
  assert.match(script, /commitFailed: true/);
});

test('home offers an inline draft review before one batch commit', () => {
  const html = read('index.html');
  for (const id of [
    'draft-card', 'draft-status', 'draft-scope', 'draft-rows', 'draft-confirm', 'draft-cancel',
    'draft-choice', 'draft-continue', 'draft-replace',
    'home-record-button', 'home-audio-file', 'home-capture-status', 'home-progress-region',
    'home-progress-message', 'home-cancel-transcription',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  const script = read('script.js');
  assert.ok(script.includes("from './draft.mjs'"));
  for (const operation of ['captureBatch(', 'draftFromText(', 'draftFromTranscript(', 'openDraft(', 'payloadForCommit(']) {
    assert.ok(script.includes(operation), `expected UI to use ${operation}`);
  }
  assert.match(script, /draftConfirm\.textContent = confirmLabel\(workspaceDraft\)/);
  const draft = read('draft.mjs');
  assert.match(draft, /Agregar \$\{/);
  assert.match(draft, /Seguir revisando/);
  assert.match(draft, /Descartar y reemplazar/);
  assert.match(script, /Quitar de esta captura/);
  assert.match(script, /Destino: \$\{/);
  assert.match(script, /beforeunload/);
  assert.match(script, /La revisi[oó]n sigue abierta/);
  assert.match(script, /No se escuch[oó] nada claro/);
  assert.match(script, /transcribeWithWorker\(worker, audio\.data/);
  assert.match(script, /home-audio-file/);
});

test('manifest declares a Spanish standalone app with audio file handling and text share target', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.lang, 'es');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.share_target.method, 'POST');
  assert.equal(manifest.share_target.enctype, 'multipart/form-data');
  assert.ok(manifest.share_target.params.files.some(({ name, accept }) => name === 'audio' && accept.includes('audio/*')));
  assert.ok(manifest.file_handlers.some(({ accept }) => Object.keys(accept).includes('audio/*')));
});

test('offline shell precaches worker dependencies and removes only listar-owned caches', () => {
  const worker = read('sw.js');
  for (const asset of ['./index.html', './style.css', './manifest.json', './script.js', './app-core.mjs', './context-review.mjs', './context-preview.mjs', './undo.mjs', './analysis-router.mjs', './debug.mjs', './db.js', './splitter.js', './transcript-filter.mjs', './analyze.mjs', './command-reducer.mjs', './worker.js', './view-export.mjs', './draft.mjs']) {
    assert.ok(worker.includes(asset), `missing precached ${asset}`);
  }
  const cacheAssets = new Set([...worker.matchAll(/'\.\/([^']+)'/gu)].map(([, asset]) => asset));
  const visited = new Set();
  const visitImports = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = read(file);
    for (const [, imported] of source.matchAll(/(?:from\s*|import\s*)['"]\.\/([^'"]+)['"]/gu)) {
      assert.ok(cacheAssets.has(imported), `${file} imports ${imported}, which is missing from the offline shell`);
      visitImports(imported);
    }
  };
  for (const entry of ['script.js', 'worker.js', 'analyze.mjs', 'command-reducer.mjs', 'context-review.mjs', 'db.js', 'app-core.mjs']) visitImports(entry);
  assert.match(worker, /key\.startsWith\('listar-'\)/);
  assert.match(worker, /const CACHE_NAME = 'listar-shell-v10'/);
  assert.doesNotMatch(worker, /caches\.delete\(key\)[\s\S]*startsWith\('transcribir-'/);
});

test('settings form offers validated language/model choices and retention defaults on', () => {
  const html = read('index.html');
  assert.match(html, /<option value="es"/);
  assert.match(html, /<option value="en"/);
  assert.match(html, /<option value="auto"/);
  assert.match(html, /id="save-audio-setting" type="checkbox"/);
  assert.doesNotMatch(html, /id="save-audio-setting"[^>]*checked/);
});

test('diagnostic controls document local privacy and wire export, clear, and runtime hooks', () => {
  const html = read('index.html');
  const script = read('script.js');
  const spec = read('spec/debug.md');
  assert.match(html, /id="debug-log-setting" type="checkbox"/);
  assert.match(html, /id="debug-text-setting" type="checkbox"(?![^>]*disabled)/);
  assert.match(html, /no se envía por internet ni incluye audio/i);
  assert.match(html, /tampoco recopila eventos internos del navegador o del service worker/i);
  assert.match(html, /500 eventos o 256 KiB/u);
  assert.match(script, /configureDebug\(/);
  assert.match(script, /attachDebugInteractionListeners\(document\)/);
  assert.match(script, /exportDebugLog\(\)/);
  assert.match(script, /clearDebugLog\(\)/);
  assert.match(script, /addEventListener\('unhandledrejection'/);
  assert.match(spec, /session-only in-memory buffer/u);
  assert.match(spec, /service worker and browser internals are not captured/u);
  assert.doesNotMatch(read('debug.mjs'), /\bfetch\s*\(|XMLHttpRequest|sendBeacon/u);
});
