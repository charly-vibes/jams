// Purpose: serve the zero-build Listar app for real-browser acceptance runs without external dependencies.
// Responsibilities: static file server over the listar package directory on a fixed loopback port.
// Rationale: the browser harness must be reproducible with plain node; no framework or CDN in the loop.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.LISTAR_SERVE_PORT || 4173);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};

http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.join(root, pathname);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
    return;
  }
  // Service workers require the correct MIME type and no caching between runs.
  response.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
    'Service-Worker-Allowed': '/',
  });
  fs.createReadStream(file).pipe(response);
}).listen(PORT, '127.0.0.1', () => console.log(`listar test server on http://127.0.0.1:${PORT}/`));
