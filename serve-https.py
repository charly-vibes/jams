#!/usr/bin/env python3
"""HTTPS server and browser-log collector for local PWA testing.
Usage: python3 serve-https.py [PORT]

Requires mkcert-generated certs: localhost.pem + localhost-key.pem
Generate with: mkcert -install && mkcert localhost 127.0.0.1 ::1 <LAN_IP>

Logs are written to per-session files in the .logs/ directory:
  .logs/transcribir-session-<sessionId>.jsonl

Only the most recent MAX_SESSION_LOGS session files are retained.
"""
import datetime
import functools
import http.server
import json
import os
import socket
import ssl
import subprocess
import sys
import threading
from pathlib import Path

HOST = '0.0.0.0'
LOG_ENDPOINT = '/__debug/logs'
CA_ENDPOINT = '/__debug/ca.pem'
MAX_LOG_BODY = 1024 * 1024
MAX_SESSION_LOGS = 50
_log_lock = threading.Lock()


def _caroot_path():
    """Return the mkcert root CA directory (cached after first call)."""
    if _caroot_path._cached is not None:
        return _caroot_path._cached
    try:
        result = subprocess.run(['mkcert', '-CAROOT'], capture_output=True, text=True, check=True)
        _caroot_path._cached = Path(result.stdout.strip())
        return _caroot_path._cached
    except (subprocess.SubprocessError, FileNotFoundError):
        _caroot_path._cached = None
        return None
_caroot_path._cached = None  # Sentinel: uncomputed


def _session_filename(log_dir, session_id):
    return log_dir / f'transcribir-session-{session_id}.jsonl'


def _prune_sessions(log_dir):
    """Return list of oldest session files to delete when over MAX_SESSION_LOGS."""
    files = sorted(
        log_dir.glob('transcribir-session-*.jsonl'),
        key=lambda f: f.stat().st_mtime,
        reverse=True,  # newest first
    )
    return files[MAX_SESSION_LOGS:]


def make_handler(serve_directory, log_directory):
    log_dir = Path(log_directory)

    class DevHandler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('X-Transcribir-Debug', '1')
            super().end_headers()

        def do_GET(self):
            if self.path.split('?', 1)[0] == LOG_ENDPOINT:
                self.send_response(204)
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                return
            if self.path == CA_ENDPOINT:
                self._serve_ca()
                return
            super().do_GET()

        def _serve_ca(self):
            caroot = _caroot_path()
            if caroot is None:
                self.send_error(500, 'mkcert not found')
                return
            ca_file = caroot / 'rootCA.pem'
            if not ca_file.exists():
                self.send_error(404, 'rootCA.pem not found')
                return
            try:
                data = ca_file.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'application/x-pem-file')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Content-Disposition', 'attachment; filename="rootCA.pem"')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(data)
            except OSError:
                self.send_error(500)

        def do_POST(self):
            if self.path.split('?', 1)[0] != LOG_ENDPOINT:
                self.send_error(404)
                return

            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                self.send_error(400, 'Invalid Content-Length')
                return
            if length < 1 or length > MAX_LOG_BODY:
                self.send_error(413 if length > MAX_LOG_BODY else 400)
                return

            try:
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict) or not isinstance(payload.get('entries'), list):
                    raise ValueError('Expected an entries array')
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
                self.send_error(400, str(error))
                return

            session_id = payload.get('sessionId', 'unknown')
            record = {
                **payload,
                'receivedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'remoteAddress': self.client_address[0],
            }

            # Write to per-session log file
            session_path = _session_filename(log_dir, session_id)
            log_dir.mkdir(parents=True, exist_ok=True)
            stale = []
            with _log_lock:
                with session_path.open('a', encoding='utf-8') as output:
                    output.write(json.dumps(record, ensure_ascii=False) + '\n')
                stale = _prune_sessions(log_dir)
            # Delete stale files outside the lock to avoid blocking concurrent writes
            for f in stale:
                try:
                    f.unlink()
                except OSError:
                    pass

            session = session_id[:12]
            for entry in payload['entries']:
                if not isinstance(entry, dict):
                    continue
                level = str(entry.get('level', 'info')).upper()
                event = entry.get('event', 'diagnostic')
                details = entry.get('args') or entry.get('message') or ''
                if details:
                    details = ' ' + json.dumps(details, ensure_ascii=False)
                print(
                    f"[device {self.client_address[0]} {session}] {level}: {event}{details}",
                    flush=True,
                )

            self.send_response(204)
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()

    return functools.partial(DevHandler, directory=str(serve_directory))


def local_ip():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(('8.8.8.8', 80))
        return sock.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        sock.close()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
    cert = 'localhost.pem'
    key = 'localhost-key.pem'

    if not os.path.exists(cert) or not os.path.exists(key):
        print(f"Missing cert files: {cert}, {key}")
        print(f"Generate with: mkcert -install && mkcert localhost 127.0.0.1 ::1 {local_ip()}")
        sys.exit(1)

    handler = make_handler(Path.cwd(), Path.cwd() / '.logs')
    httpd = http.server.ThreadingHTTPServer((HOST, port), handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    ip = local_ip()

    print(f"HTTPS serving on https://localhost:{port}")
    print(f"Device URL:   https://{ip}:{port}/transcribir/")
    print()
    print(f"To install the mkcert CA on the Android device (required for SW):")
    print(f"  1. Open https://{ip}:{port}/__debug/ca.pem on the device")
    print(f"  2. Download the rootCA.pem file")
    print(f"  3. Go to Settings → Security → Encryption & credentials → Install a certificate")
    print(f"  4. Select the downloaded rootCA.pem → name it \"mkcert\" → install")
    print(f"  5. Reopen the device URL — Service Worker should register successfully")
    caroot = _caroot_path()
    if caroot:
        ca_path = caroot / 'rootCA.pem'
        if ca_path.exists():
            print(f"  (Local CA file: {ca_path})")
    print()
    print("Device diagnostics will appear here and in .logs/transcribir-session-*.jsonl")
    print(f"Keeps up to {MAX_SESSION_LOGS} recent session files. Press Ctrl+C to stop")
    httpd.serve_forever()


if __name__ == '__main__':
    main()
