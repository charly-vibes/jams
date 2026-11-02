// Purpose: cache Listar's local app shell and receive offline-safe shared audio.
// Responsibilities: same-origin app caching, POST share handoff, one-time local file delivery.
// Rationale: audio must survive the navigation from a share sheet without reaching a server.
const CACHE_NAME = 'listar-shell-v6';
const SHARED_AUDIO_CACHE = 'listar-shared-audio-v1';
const SHELL = [
  './', './index.html', './style.css', './manifest.json', './icon.svg', './sw.js', './script.js',
  './app-core.mjs', './workspace.mjs', './views.mjs', './undo.mjs', './context-review.mjs', './context-preview.mjs', './analysis-router.mjs', './debug.mjs', './db.js', './splitter.js', './transcript-filter.mjs', './analyze.mjs', './command-reducer.mjs', './worker.js',
];

function audioFile(file) {
  return file && Number(file.size) > 0 && (
    String(file.type || '').startsWith('audio/') || /\.(wav|mp3|m4a|ogg|webm|mp4)$/i.test(file.name || '')
  );
}

function cleanFilename(name) {
  return String(name || 'audio-compartido').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function sharedAudioKey(token) {
  return new URL(`./__shared_audio__/${encodeURIComponent(token)}`, self.registration.scope).href;
}

async function receiveSharedAudio(request) {
  try {
    const form = await request.formData();
    const candidates = form.getAll('audio');
    const file = candidates.find(audioFile);
    if (!file) {
      const destination = new URL('./index.html', request.url);
      for (const field of ['title', 'text', 'url']) {
        const value = form.get(field);
        if (typeof value === 'string' && value) destination.searchParams.set(field, value);
      }
      if (destination.search) return Response.redirect(destination, 303);
      return Response.redirect(new URL('./index.html?share_error=no_audio', request.url), 303);
    }

    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const key = sharedAudioKey(token);
    const response = new Response(file, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Shared-Filename': cleanFilename(file.name),
      },
    });
    const cache = await caches.open(SHARED_AUDIO_CACHE);
    await cache.put(key, response);
    return Response.redirect(new URL(`./index.html?shared_audio=${encodeURIComponent(token)}`, request.url), 303);
  } catch {
    return Response.redirect(new URL('./index.html?share_error=storage', request.url), 303);
  }
}

async function deliverSharedAudio(request) {
  const cache = await caches.open(SHARED_AUDIO_CACHE);
  const response = await cache.match(request);
  if (!response) return new Response('Audio compartido no encontrado.', { status: 404 });
  await cache.delete(request);
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('listar-') && key !== CACHE_NAME && key !== SHARED_AUDIO_CACHE)
        .map((key) => caches.delete(key)),
    )),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const shareActionPath = new URL('./index.html', self.registration.scope).pathname;
  const sharedAudioPath = new URL('./__shared_audio__/', self.registration.scope).pathname;
  if (request.method === 'POST' && request.mode === 'navigate' && url.pathname === shareActionPath) {
    event.respondWith(receiveSharedAudio(request));
    return;
  }
  if (request.method === 'GET' && url.pathname.startsWith(sharedAudioPath)) {
    event.respondWith(deliverSharedAudio(request));
    return;
  }
  if (request.method !== 'GET') return;

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});
