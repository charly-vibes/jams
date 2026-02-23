/**
 * Cloudflare Worker — GitHub OAuth CORS proxy for commit-insights
 *
 * Proxies the two GitHub Device Flow endpoints and adds CORS headers so the
 * browser can call them directly from a static GitHub Pages site.
 *
 * Deploy: Cloudflare dashboard → Workers → Create → paste this file → Deploy
 * Then paste your Worker URL into the app's "Login with GitHub" panel.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

const TARGETS = {
  '/device/code':  'https://github.com/login/device/code',
  '/access_token': 'https://github.com/login/oauth/access_token',
};

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { pathname } = new URL(request.url);
  const target = TARGETS[pathname];

  if (!target) {
    return new Response('Not found', { status: 404 });
  }

  const upstream = await fetch(target, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: await request.text(),
  });

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
