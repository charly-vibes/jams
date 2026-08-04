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


def test_debug_collector_advertises_its_capability(tmp_path):
    module = load_server_module()
    handler = module.make_handler(tmp_path, tmp_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()

    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{server.server_port}/__debug/logs"
        ) as response:
            assert response.status == 204
            assert response.headers["X-Transcribir-Debug"] == "1"
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


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

        session_path = tmp_path / f"transcribir-session-{payload['sessionId']}.jsonl"
        assert session_path.exists(), f"Session file not found: {session_path}"
        records = [json.loads(line) for line in session_path.read_text().splitlines()]
        assert records[0]["sessionId"] == "device-1"
        assert records[0]["entries"][0]["event"] == "page.load"
        assert records[0]["remoteAddress"] == "127.0.0.1"
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def test_different_sessions_write_to_separate_files(tmp_path):
    module = load_server_module()
    handler = module.make_handler(tmp_path, tmp_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()

    try:
        sessions = ["session-aaa", "session-bbb", "session-ccc"]
        for sid in sessions:
            payload = {
                "sessionId": sid,
                "entries": [{"level": "info", "event": "page.load", "session": sid}],
            }
            req = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/__debug/logs",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req) as resp:
                assert resp.status == 204

        # Each session should have its own file
        for sid in sessions:
            path = tmp_path / f"transcribir-session-{sid}.jsonl"
            assert path.exists(), f"Missing session file: {path}"
            records = [json.loads(l) for l in path.read_text().splitlines()]
            assert len(records) == 1
            assert records[0]["sessionId"] == sid

        # No combined file should exist
        combined = list(tmp_path.glob("transcribir-debug.jsonl"))
        assert len(combined) == 0, f"Unexpected combined file: {combined}"
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def test_session_log_pruning(tmp_path):
    module = load_server_module()
    handler = module.make_handler(tmp_path, tmp_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()

    try:
        # Write more sessions than MAX_SESSION_LOGS
        import time
        for i in range(module.MAX_SESSION_LOGS + 5):
            payload = {
                "sessionId": f"session-{i:03d}",
                "entries": [{"level": "info", "event": "page.load"}],
            }
            req = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/__debug/logs",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req) as resp:
                assert resp.status == 204
            time.sleep(0.01)  # ensure distinct mtimes

        # Should have at most MAX_SESSION_LOGS files
        files = sorted(tmp_path.glob("transcribir-session-*.jsonl"))
        assert len(files) <= module.MAX_SESSION_LOGS, (
            f"Expected <= {module.MAX_SESSION_LOGS} session files, got {len(files)}"
        )
        # The pruned ones should be the earliest (lowest numbers)
        remaining_ids = {f.stem.replace("transcribir-session-", "") for f in files}
        assert "session-000" not in remaining_ids, "Oldest session should have been pruned"
        assert "session-049" in remaining_ids, "Newest session should remain"
    finally:
        server.shutdown()
        thread.join()
        server.server_close()
