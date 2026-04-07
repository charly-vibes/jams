// ─── service worker (inlined via Blob) ───
// caches the app shell + fonts + readability so it works offline
if ('serviceWorker' in navigator) {
  const swCode = `
    const CACHE = 'nyx-v1';
    const SHELL = [
      './',
      'style.css',
      'script.js',
      'https://unpkg.com/@mozilla/readability@0.5.0/Readability.js',
      'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..500;1,6..72,300..500&family=JetBrains+Mono:wght@400;500&display=swap'
    ];
    self.addEventListener('install', (e) => {
      e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(()=>{})).then(()=>self.skipWaiting()));
    });
    self.addEventListener('activate', (e) => {
      e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      ).then(()=>self.clients.claim()));
    });
    self.addEventListener('fetch', (e) => {
      const req = e.request;
      if (req.method !== 'GET') return;
      const url = new URL(req.url);
      // never cache proxied article HTML
      if (url.hostname.includes('corsproxy.io') || url.hostname.includes('allorigins.win')) return;
      e.respondWith(
        caches.match(req).then(cached => {
          if (cached) return cached;
          return fetch(req).then(res => {
            if (res.ok && (url.origin === location.origin || url.hostname.includes('gstatic') || url.hostname.includes('googleapis') || url.hostname.includes('unpkg'))) {
              const copy = res.clone();
              caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
            }
            return res;
          }).catch(() => cached);
        })
      );
    });
  `;
  try {
    const blob = new Blob([swCode], { type: 'text/javascript' });
    const swUrl = URL.createObjectURL(blob);
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(swUrl).catch(() => {});
    });
  } catch (_) {}
}

// ─── elements ───
const $ = (id) => document.getElementById(id);
const intake = $('intake');
const article = $('article');
const form = $('form');
const urlInput = $('url');
const goBtn = $('go');
const errBox = $('err');
const btnTheme = $('btn-theme');
const btnSize = $('btn-size');
const btnHome = $('btn-home');

// ─── theme toggle ───
const themes = ['void', 'ash'];
let themeIdx = 0;
function applyTheme() {
  const t = themes[themeIdx];
  if (t === 'void') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  btnTheme.textContent = t;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', t === 'void' ? '#000000' : '#0e0e0e');
}
btnTheme.addEventListener('click', () => {
  themeIdx = (themeIdx + 1) % themes.length;
  applyTheme();
});
applyTheme();

// ─── text size ───
const sizes = ['s', 'm', 'l', 'xl'];
let sizeIdx = 1;
btnSize.addEventListener('click', () => {
  sizeIdx = (sizeIdx + 1) % sizes.length;
  document.body.dataset.size = sizes[sizeIdx];
});

// ─── reset ───
btnHome.addEventListener('click', () => {
  article.hidden = true;
  article.innerHTML = '';
  intake.hidden = false;
  btnHome.hidden = true;
  urlInput.value = '';
  errBox.hidden = true;
  window.scrollTo(0, 0);
});

function showErr(msg) {
  errBox.textContent = msg;
  errBox.hidden = false;
}

async function fetchArticle(rawUrl) {
  let url;
  try { url = new URL(rawUrl); }
  catch { throw new Error('Not a valid URL.'); }

  const proxies = [
    (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  ];

  let html, lastErr;
  for (const p of proxies) {
    try {
      const res = await fetch(p(url.href), { redirect: 'follow' });
      if (!res.ok) throw new Error('Proxy returned ' + res.status);
      html = await res.text();
      if (html && html.length > 500) break;
    } catch (e) { lastErr = e; }
  }
  if (!html) throw new Error('Could not fetch the page. ' + (lastErr ? lastErr.message : ''));

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.href = url.href;
  doc.head.prepend(base);

  if (typeof Readability === 'undefined') {
    throw new Error('Readability failed to load. Check your connection.');
  }
  const reader = new Readability(doc, { charThreshold: 200 });
  const parsed = reader.parse();
  if (!parsed || !parsed.content) throw new Error('No readable article found on that page.');
  return { ...parsed, sourceHost: url.hostname.replace(/^www\./, '') };
}

function renderArticle(parsed) {
  const minutes = Math.max(1, Math.round((parsed.textContent || '').split(/\s+/).length / 220));
  const meta = [
    parsed.sourceHost,
    parsed.byline ? parsed.byline.trim() : '',
    minutes + ' min read'
  ].filter(Boolean);

  article.innerHTML = `
    <div class="meta">${meta.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>
    <h1 class="title">${escapeHtml(parsed.title || 'Untitled')}</h1>
    <div class="content">${parsed.content}</div>
  `;
  article.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));
  article.querySelectorAll('script, style, iframe[src*="ads"]').forEach(el => el.remove());
  article.querySelectorAll('a[href]').forEach(a => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  intake.hidden = true;
  article.hidden = false;
  btnHome.hidden = false;
  window.scrollTo(0, 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errBox.hidden = true;
  const u = urlInput.value.trim();
  if (!u) return;
  goBtn.disabled = true;
  const original = goBtn.textContent;
  goBtn.textContent = 'fetching…';
  intake.insertAdjacentHTML('beforeend', '<div class="loading" id="ld">extracting</div>');
  try {
    const parsed = await fetchArticle(u);
    renderArticle(parsed);
  } catch (err) {
    showErr(err.message || String(err));
  } finally {
    goBtn.disabled = false;
    goBtn.textContent = original;
    const ld = $('ld'); if (ld) ld.remove();
  }
});

// share target / ?u= query
const params = new URLSearchParams(location.search);
const sharedUrl = params.get('u') || params.get('url') || params.get('text');
if (sharedUrl) {
  urlInput.value = sharedUrl;
  form.requestSubmit();
}
