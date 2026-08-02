import importlib.util
import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path


def load_server_module():
    path = Path(__file__).parents[1] / "serve-https.py"
    spec = importlib.util.spec_from_file_location("serve_https", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_debug_logs_are_written_and_acknowledged(tmp_path):
    module = load_server_module()
    handler = module.make_handler(tmp_path, tmp_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()

    try:
        payload = {
            "sessionId": "device-1",
            "entries": [{"level": "info", "event": "page.load"}],
        }
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/__debug/logs",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(request) as response:
            assert response.status == 204

        records = [json.loads(line) for line in (tmp_path / "transcribir-debug.jsonl").read_text().splitlines()]
        assert records[0]["sessionId"] == "device-1"
        assert records[0]["entries"][0]["event"] == "page.load"
        assert records[0]["remoteAddress"] == "127.0.0.1"
    finally:
        server.shutdown()
        thread.join()
        server.server_close()
