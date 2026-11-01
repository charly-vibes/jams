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
    'clear-audio', 'export-copy', 'export-share',
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
  for (const asset of ['./index.html', './style.css', './manifest.json', './script.js', './app-core.mjs', './context-review.mjs', './analysis-router.mjs', './db.js', './splitter.js', './transcript-filter.mjs', './analyze.mjs', './command-reducer.mjs', './worker.js']) {
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
  for (const entry of ['script.js', 'worker.js', 'analyze.mjs', 'command-reducer.mjs', 'context-review.mjs']) visitImports(entry);
  assert.match(worker, /key\.startsWith\('listar-'\)/);
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
