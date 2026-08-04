// Streams browser diagnostics to the local development server.
(function () {
  'use strict';

  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || host.endsWith('.local')
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
  const params = new URLSearchParams(window.location.search);
  if (!isLocalHost && params.get('remoteDebug') !== '1') return;

  const endpoint = new URL('/__debug/logs', window.location.origin);
  const sessionId = window.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const originalConsole = {};
  const originalFetch = window.fetch.bind(window);
  let queue = [];
  let flushTimer = null;

  async function startIfSupported() {
    try {
      const probeUrl = new URL('index.html', window.location.href);
      const response = await originalFetch(probeUrl, { cache: 'no-store' });
      if (response.headers.get('X-Transcribir-Debug') !== '1') return;
    } catch {
      return;
    }
    startDiagnostics();
  }

  function startDiagnostics() {
  function safeValue(value) {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (value instanceof Event) {
      return { type: value.type, target: describeTarget(value.target) };
    }
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }

  function describeTarget(target) {
    if (!target || !target.tagName) return null;
    let description = target.tagName.toLowerCase();
    if (target.id) description += `#${target.id}`;
    if (target.classList?.length) description += `.${[...target.classList].join('.')}`;
    return description;
  }

  function record(entry) {
    queue.push({ at: new Date().toISOString(), ...entry });
    if (queue.length >= 20) flush();
    else if (!flushTimer) flushTimer = window.setTimeout(flush, 500);
  }

  function flush(useBeacon = false) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
    if (!queue.length) return;
    const entries = queue;
    queue = [];
    const body = JSON.stringify({ sessionId, entries });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      return;
    }
    window.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {});
  }

  for (const level of ['debug', 'log', 'info', 'warn', 'error']) {
    originalConsole[level] = console[level].bind(console);
    console[level] = (...args) => {
      originalConsole[level](...args);
      record({ level, event: 'console', args: args.map(safeValue) });
    };
  }

  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : new URL(String(input), window.location.href).href;
    if (url === endpoint.href) return originalFetch(input, init);

    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const startedAt = performance.now();
    record({ level: 'info', event: 'network.request', method, url });
    try {
      const response = await originalFetch(input, init);
      record({
        level: response.ok ? 'info' : 'warn',
        event: 'network.response',
        method,
        url,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return response;
    } catch (error) {
      record({
        level: 'error',
        event: 'network.error',
        method,
        url,
        durationMs: Math.round(performance.now() - startedAt),
        error: safeValue(error),
      });
      throw error;
    }
  };

  window.addEventListener('error', (event) => record({
    level: 'error',
    event: 'window.error',
    message: event.message || 'Resource failed to load',
    source: event.filename || event.target?.src || event.target?.href,
    target: describeTarget(event.target),
    line: event.lineno,
    column: event.colno,
    error: safeValue(event.error),
  }), true);
  window.addEventListener('unhandledrejection', (event) => record({
    level: 'error',
    event: 'unhandledrejection',
    reason: safeValue(event.reason),
  }));

  for (const eventName of ['click', 'change', 'submit']) {
    document.addEventListener(eventName, (event) => record({
      level: 'info',
      event: `ui.${eventName}`,
      target: describeTarget(event.target),
    }), true);
  }
  document.addEventListener('visibilitychange', () => record({
    level: 'info', event: 'page.visibility', state: document.visibilityState,
  }));
  window.addEventListener('online', () => record({ level: 'info', event: 'network.online' }));
  window.addEventListener('offline', () => record({ level: 'warn', event: 'network.offline' }));
  window.addEventListener('load', () => record({ level: 'info', event: 'page.ready' }));
  window.addEventListener('pagehide', () => {
    record({ level: 'info', event: 'page.hide' });
    flush(true);
  });
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type === 'transcribir-debug') {
      record({ level: event.data.level || 'info', event: 'service-worker', args: event.data.args });
    }
  });

  record({
    level: 'info',
    event: 'page.load',
    url: window.location.href,
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    secureContext: window.isSecureContext,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  });
  }

  startIfSupported();
}());
