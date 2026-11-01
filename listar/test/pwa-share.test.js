import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('PWA manifest declares portrait mode, a real icon, and audio file and share handlers', () => {
  assert.equal(manifest.orientation, 'portrait');
  assert.ok(manifest.icons.some(({ src, type }) => src === './icon.svg' && type === 'image/svg+xml'));
  assert.equal(manifest.share_target.method, 'POST');
  assert.equal(manifest.share_target.enctype, 'multipart/form-data');
  assert.ok(manifest.share_target.params.files.some(({ name, accept }) => name === 'audio' && accept.includes('audio/*')));
  assert.ok(manifest.file_handlers.some(({ accept }) => Object.hasOwn(accept, 'audio/*')));
});

test('service worker stores shared audio locally, redirects, then serves and consumes it once', async () => {
  const listeners = new Map();
  const storage = new Map();
  const cacheKey = (key) => String(key.url || key);
  const cache = {
    async put(key, response) { storage.set(cacheKey(key), response.clone()); },
    async match(key) { return storage.get(cacheKey(key))?.clone(); },
    async delete(key) { return storage.delete(cacheKey(key)); },
    async addAll() {},
  };
  const deletedCaches = [];
  const caches = {
    async open() { return cache; },
    async match(key) { return cache.match(key); },
    async keys() { return ['listar-shell-v0', 'listar-shell-v1', 'listar-shell-v2', 'listar-shared-audio-v1', 'transcribir-shell-v1']; },
    async delete(name) { deletedCaches.push(name); return true; },
  };
  const self = {
    location: new URL('https://example.test/listar/sw.js'),
    registration: { scope: 'https://example.test/listar/' },
    clients: { claim: async () => {} },
    addEventListener(type, listener) { listeners.set(type, listener); },
    skipWaiting() {},
  };
  const context = { self, caches, URL, Request, Response, crypto: { randomUUID }, console };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context, { filename: 'sw.js' });
  const fetchHandler = listeners.get('fetch');
  const sharedFile = new File(['audio payload'], 'compra.wav', { type: 'audio/wav' });
  let postResponse;
  const postEvent = {
    request: {
      method: 'POST', mode: 'navigate', url: 'https://example.test/listar/index.html',
      async formData() { return { getAll: (name) => name === 'audio' ? [sharedFile] : [] }; },
    },
    respondWith(promise) { postResponse = promise; },
  };
  fetchHandler(postEvent);
  const redirected = await postResponse;
  assert.equal(redirected.status, 303);
  const location = redirected.headers.get('location');
  assert.match(location, /shared_audio=/);
  const token = new URL(location).searchParams.get('shared_audio');
  assert.ok(token);

  const key = `https://example.test/listar/__shared_audio__/${encodeURIComponent(token)}`;
  const stored = await cache.match(key);
  assert.equal(await stored.text(), 'audio payload');
  assert.equal(stored.headers.get('content-type'), 'audio/wav');
  assert.equal(stored.headers.get('x-shared-filename'), 'compra.wav');

  let consumeResponse;
  fetchHandler({
    request: { method: 'GET', url: key },
    respondWith(promise) { consumeResponse = promise; },
  });
  assert.equal(await (await consumeResponse).text(), 'audio payload');
  assert.equal(await cache.match(key), undefined, 'shared file is removed after one consumption');

  let textShareResponse;
  fetchHandler({
    request: {
      method: 'POST', mode: 'navigate', url: 'https://example.test/listar/index.html',
      async formData() { return { getAll: () => [], get(name) { return ({ title: 'Lista', text: 'leche y pan', url: '' })[name]; } }; },
    },
    respondWith(promise) { textShareResponse = promise; },
  });
  const textRedirect = await textShareResponse;
  const textUrl = new URL(textRedirect.headers.get('location'));
  assert.equal(textUrl.searchParams.get('title'), 'Lista');
  assert.equal(textUrl.searchParams.get('text'), 'leche y pan');

  let activation;
  listeners.get('activate')({ waitUntil(promise) { activation = promise; } });
  await activation;
  assert.deepEqual(deletedCaches, ['listar-shell-v0', 'listar-shell-v1']);
});

test('offline cache contains the icon and deletes only Listar cache names', () => {
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(worker, /'\.\/icon\.svg'/);
  assert.match(worker, /'\.\/sw\.js'/);
  assert.match(worker, /key\.startsWith\('listar-'\)/);
  assert.match(worker, /SHARED_AUDIO_CACHE/);
  assert.doesNotMatch(worker, /caches\.delete\(key\)[\s\S]*startsWith\('transcribir-'/);
});
