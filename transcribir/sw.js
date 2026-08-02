// transcribir — Service Worker
// Handles: app shell caching, offline support, Web Share Target POST interception

const VERSION = '2';  // bump when publishing a new version
const SHELL_CACHE = `transcribir-shell-v${VERSION}`;
const SHARED_CACHE = `transcribir-shared-v${VERSION}`;
const STATIC_ASSETS = [
  './',
  './index.html',
  './script.js',
  './style.css',
  './manifest.json',
  './icon.svg',
];

/* ─── Install: precache app shell ─── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Add each asset individually so one failure doesn't block the rest.
      // './' may fail on some hosts (redirect loops) — it's non-critical.
      Promise.allSettled(STATIC_ASSETS.map((url) =>
        cache.add(url).catch(() => {} /* skip uncooperative URLs */)
      ))
    )
  );
  self.skipWaiting();
});

/* ─── Message: respond to skipWaiting requests from the page ─── */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ─── Activate: prune stale caches ─── */
self.addEventListener('activate', (event) => {
  // Enable navigation preload for faster cold starts
  if (self.registration.navigationPreload) {
    event.waitUntil(self.registration.navigationPreload.enable().catch(() => {}));
  }
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== SHARED_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ─── Fetch: serve shell + intercept share target POSTs ─── */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Web Share Target POST — extract audio files, store in cache, redirect
  if (request.method === 'POST') {
    event.respondWith(handleShareTarget(request));
    return;
  }

  // Cache-first for same-origin GET assets
  if (request.method === 'GET') {
    if (request.url.startsWith(self.location.origin)) {
      event.respondWith(
        caches.match(request).then((cached) =>
          cached || fetch(request).catch(() =>
            // Offline fallback: serve index.html for navigations
            request.mode === 'navigate'
              ? caches.match('./index.html')
              : Response.error()
          )
        )
      );
    }
    // Cross-origin GETs (CDN) pass through untouched
  }
});

/* ─── Share target handler ─── */
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('audio_files');

    if (!files || files.length === 0) {
      return Response.redirect('./?share_error=no_files');
    }

    // Store shared files in dedicated cache (only audio/*)
    const cache = await caches.open(SHARED_CACHE);
    const audioFiles = files.filter(f => f.type && f.type.startsWith('audio/'));

    if (audioFiles.length === 0) {
      return Response.redirect('./?share_error=no_files');
    }

    await cache.put('file-count', new Response(JSON.stringify(audioFiles.length)));

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const headers = new Headers({
        'Content-Type': file.type || 'audio/unknown',
        'X-File-Name': encodeURIComponent(file.name || `audio-${i}`),
      });
      await cache.put(`file-${i}`, new Response(file, { headers }));
    }

    return Response.redirect('./?shared=true');
  } catch (err) {
    console.error('[SW] Share target error:', err);
    return Response.redirect('./?share_error=processing_failed');
  }
}