"""Model routes / blocks from the org policy (GET /api/v1/policy), with a mocked fetcher."""
from __future__ import annotations

import asyncio
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace as NS

import pytest

from tokenfin import TokenFinClient, TokenFinPolicyError, find_route, is_model_blocked, wrap_anthropic, wrap_openai
from tokenfin.policy import PolicyManager, fetch_policy_urllib

POLICY = {
    "routes": [
        {"from": "claude-opus", "to": "claude-sonnet-4-6", "match": "prefix"},
        {"from": "gpt-4o", "to": "gpt-4o-mini", "match": "exact"},
    ],
    "blocked_models": ["claude-3-opus"],
    "version": "v1",
    "ttl_seconds": 60,
}


class Messages:
    def __init__(self):
        self.calls = []

    def create(self, **params):
        self.calls.append(params)
        return NS(model=params["model"], usage=NS(input_tokens=10, output_tokens=5,
                                                  cache_read_input_tokens=0, cache_creation_input_tokens=0))


class AsyncMessages:
    def __init__(self):
        self.calls = []

    async def create(self, **params):
        self.calls.append(params)
        return NS(model=params["model"], usage=NS(input_tokens=1, output_tokens=1,
                                                  cache_read_input_tokens=0, cache_creation_input_tokens=0))


class Completions:
    def __init__(self):
        self.calls = []

    def create(self, **params):
        self.calls.append(params)
        return NS(model=params["model"], choices=[], usage=NS(prompt_tokens=5, completion_tokens=1))


def make_tf(fetcher, server=None):
    tf = TokenFinClient(api_key="tfk_test", base_url=server.url if server else "http://127.0.0.1:9",
                        flush_interval=0, flush_on_exit=False)
    tf._policy_mgr = PolicyManager(fetcher)
    return tf


def fixed(policy, delay=0.0, fail=False):
    calls = []

    def fetch(etag):
        calls.append(etag)
        if delay:
            time.sleep(delay)
        if fail:
            raise RuntimeError("network down")
        return ("ok", policy, '"v1"') if policy is not None else ("unavailable",)
    fetch.calls = calls  # type: ignore[attr-defined]
    return fetch


def test_find_route_and_blocked():
    p = {"routes": [{"from": "claude-opus", "to": "a", "match": "prefix"},
                    {"from": "claude-opus-4", "to": "b", "match": "prefix"},
                    {"from": "claude-opus-4-8", "to": "c"}], "blocked_models": ["claude-3-opus"]}
    assert find_route(p, "claude-opus-4-8")["to"] == "c"
    assert find_route(p, "Claude-Opus-4-1")["to"] == "b"
    assert find_route(p, "claude-opus-3")["to"] == "a"
    assert find_route(p, "claude-sonnet-4") is None
    assert find_route({"routes": [{"from": "gpt-4o", "to": "x"}]}, "gpt-4o-mini") is None
    assert is_model_blocked(p, "claude-3-opus-20240229") and not is_model_blocked(p, "claude-3-5-sonnet")


def test_anthropic_routes_and_records_routed_from(server):
    tf = make_tf(fixed(POLICY), server)
    msgs = Messages()
    client = NS(messages=msgs)
    wrap_anthropic(client, tf)
    res = client.messages.create(model="claude-opus-4-8", max_tokens=5, messages=[])
    assert msgs.calls[0]["model"] == "claude-sonnet-4-6"
    assert res.model == "claude-sonnet-4-6"
    tf.flush()
    ev = server.events()[0]
    assert ev["model"] == "claude-sonnet-4-6"
    assert ev["metadata"]["routed_from"] == "claude-opus-4-8"


def test_first_call_waits_at_most_policy_wait_then_fails_open():
    tf = make_tf(fixed(POLICY, delay=0.5))
    msgs = Messages()
    client = NS(messages=msgs)
    wrap_anthropic(client, tf, policy_wait_ms=50)
    t0 = time.monotonic()
    client.messages.create(model="claude-opus-4-8", messages=[])
    assert time.monotonic() - t0 < 0.3
    assert msgs.calls[0]["model"] == "claude-opus-4-8"       # policy not there yet → unchanged
    time.sleep(0.6)
    client.messages.create(model="claude-opus-4-8", messages=[])
    assert msgs.calls[1]["model"] == "claude-sonnet-4-6"


def test_fetch_errors_and_404_fail_open():
    for f in (fixed(None), fixed(POLICY, fail=True)):
        tf = make_tf(f)
        comp = Completions()
        comp_client = NS(chat=NS(completions=comp))
        wrap_openai(comp_client, tf, enforce_policy=True)
        tf.policy().ready(1)
        comp_client.chat.completions.create(model="gpt-4o", messages=[])
        assert comp.calls[-1]["model"] == "gpt-4o"


def test_block_only_with_enforce_policy():
    tf = make_tf(fixed(POLICY))
    tf.policy().ready(1)
    a = Messages()
    ca = NS(messages=a)
    wrap_anthropic(ca, tf)
    ca.messages.create(model="claude-3-opus-20240229", messages=[])
    assert len(a.calls) == 1                                    # default never blocks

    b = Messages()
    cb = NS(messages=b)
    wrap_anthropic(cb, tf, enforce_policy=True)
    with pytest.raises(TokenFinPolicyError) as e:
        cb.messages.create(model="claude-3-opus-20240229", messages=[])
    assert e.value.model == "claude-3-opus-20240229"
    assert b.calls == []


def test_route_models_false_and_exact_match():
    tf = make_tf(fixed(POLICY))
    tf.policy().ready(1)
    comp = Completions()
    c = NS(chat=NS(completions=comp))
    wrap_openai(c, tf)
    c.chat.completions.create(model="gpt-4o", messages=[])
    c.chat.completions.create(model="gpt-4o-2024-08-06", messages=[])
    assert [x["model"] for x in comp.calls] == ["gpt-4o-mini", "gpt-4o-2024-08-06"]
    comp2 = Completions()
    c2 = NS(chat=NS(completions=comp2))
    wrap_openai(c2, tf, route_models=False)
    c2.chat.completions.create(model="gpt-4o", messages=[])
    assert comp2.calls[0]["model"] == "gpt-4o"


def test_async_client_waits_without_blocking_the_loop():
    tf = make_tf(fixed(POLICY, delay=0.05))
    am = AsyncMessages()
    client = NS(messages=am)
    wrap_anthropic(client, tf)

    async def main():
        return await client.messages.create(model="claude-opus-4-1", messages=[])
    res = asyncio.run(main())
    assert am.calls[0]["model"] == "claude-sonnet-4-6"
    assert res.model == "claude-sonnet-4-6"


class _PolicyServer:
    def __init__(self, status=200):
        self.requests = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                outer.requests.append({k.lower(): v for k, v in self.headers.items()})
                if status != 200:
                    self.send_response(status); self.end_headers(); return
                if self.headers.get("If-None-Match") == '"v1"':
                    self.send_response(304); self.end_headers(); return
                data = json.dumps(POLICY).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("ETag", '"v1"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()


def test_urllib_fetcher_bearer_etag_304_and_404():
    srv = _PolicyServer()
    fetch = fetch_policy_urllib(srv.url, "tfk_abc", 2.0)
    r = fetch(None)
    assert r[0] == "ok" and r[1]["version"] == "v1" and r[2] == '"v1"'
    assert srv.requests[0]["authorization"] == "Bearer tfk_abc"
    assert fetch('"v1"') == ("not_modified",)
    srv.httpd.shutdown()
    missing = _PolicyServer(status=404)
    assert fetch_policy_urllib(missing.url, "k", 2.0)(None) == ("unavailable",)
    missing.httpd.shutdown()
