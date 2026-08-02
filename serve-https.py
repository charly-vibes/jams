#!/usr/bin/env python3
"""HTTPS server and browser-log collector for local PWA testing.
Usage: python3 serve-https.py [PORT]

Requires mkcert-generated certs: localhost.pem + localhost-key.pem
Generate with: mkcert -install && mkcert localhost 127.0.0.1 ::1 <LAN_IP>
"""
import datetime
import functools
import http.server
import json
import os
import socket
import ssl
import sys
import threading
from pathlib import Path

HOST = '0.0.0.0'
LOG_ENDPOINT = '/__debug/logs'
MAX_LOG_BODY = 1024 * 1024
_log_lock = threading.Lock()


def make_handler(serve_directory, log_directory):
    log_path = Path(log_directory) / 'transcribir-debug.jsonl'

    class DevHandler(http.server.SimpleHTTPRequestHandler):
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

            record = {
                **payload,
                'receivedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'remoteAddress': self.client_address[0],
            }
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with _log_lock:
                with log_path.open('a', encoding='utf-8') as output:
                    output.write(json.dumps(record, ensure_ascii=False) + '\n')

            session = str(payload.get('sessionId', 'unknown'))[:12]
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

    print(f"HTTPS serving on https://localhost:{port}")
    print(f"Device URL: https://{local_ip()}:{port}/transcribir/")
    print("Device diagnostics will appear here and in .logs/transcribir-debug.jsonl")
    print("Press Ctrl+C to stop")
    httpd.serve_forever()


if __name__ == '__main__':
    main()
