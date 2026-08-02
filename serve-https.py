#!/usr/bin/env python3
"""HTTPS server for local PWA testing with service workers.
Usage: python3 serve-https.py [PORT]

Requires mkcert-generated certs: localhost.pem + localhost-key.pem
Generate with: mkcert -install && mkcert localhost 127.0.0.1 ::1
"""
import ssl, http.server, sys, os

HOST = '0.0.0.0'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443

cert = 'localhost.pem'
key = 'localhost-key.pem'

if not os.path.exists(cert) or not os.path.exists(key):
    print(f"Missing cert files: {cert}, {key}")
    print("Generate with: mkcert -install && mkcert localhost 127.0.0.1 ::1")
    sys.exit(1)

httpd = http.server.HTTPServer(
    (HOST, PORT),
    http.server.SimpleHTTPRequestHandler
)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

print(f"HTTPS serving on https://{HOST}:{PORT}")
print("Service Workers will work on any device on your network.")
print("Press Ctrl+C to stop")
httpd.serve_forever()