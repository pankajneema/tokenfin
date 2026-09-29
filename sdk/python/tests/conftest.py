"""Local mock TokenFin server for tests (no network, no live services)."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Optional

import pytest


class MockServer:
    def __init__(self) -> None:
        self.received: List[Dict[str, Any]] = []
        self.responder: Callable[[Dict[str, Any], int], Any] = lambda req, n: (200, {}, None)
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                req = {"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()},
                       "body": json.loads(raw) if raw else None}
                outer.received.append(req)
                status, body, headers = outer.responder(req, len(outer.received))
                data = json.dumps(body if body is not None else {}).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a: Any) -> None:
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def events(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for r in self.received:
            b = r["body"]
            out.extend(b["events"] if isinstance(b, dict) and "events" in b else [b])
        return out


@pytest.fixture
def server():
    s = MockServer()
    yield s
    s.httpd.shutdown()
