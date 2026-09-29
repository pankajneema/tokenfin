"""Transport tests for the sync + async clients against a local mock server."""
from __future__ import annotations

import asyncio
import signal
import time
from datetime import datetime, timezone

from tokenfin import AsyncTokenFinClient, TokenFinClient
from tokenfin.utils import parse_retry_after


def mk(url: str, **kw) -> TokenFinClient:
    return TokenFinClient(api_key="tfk_test", base_url=url, flush_interval=0, flush_on_exit=False, **kw)


def ev(tf, i=0, **kw):
    tf.track(f"m{i}", 1, 1, **kw)


def test_batch_wire_format(server):
    server.responder = lambda req, n: (200, {"results": [{"index": 0, "status": "accepted"},
                                                         {"index": 1, "status": "duplicate"}]}, None)
    tf = mk(server.url)
    tf.track("claude-sonnet-4-6", 10, 5, cache_read_tokens=100, cache_write_tokens=7, project_id="p1",
             user_email="a@b.test", session_id="s1", latency_ms=42,
             timestamp=datetime(2026, 9, 1, tzinfo=timezone.utc), idempotency_key="k1")
    ev(tf, 1)
    r = tf.shutdown()
    assert (r.sent, r.dropped) == (2, 0)
    assert len(server.received) == 1
    req = server.received[0]
    assert req["path"] == "/api/v1/ingest/batch"
    assert req["headers"]["authorization"] == "Bearer tfk_test"
    e = req["body"]["events"][0]
    assert (e["cache_read_tokens"], e["cache_write_tokens"], e["project_id"], e["user_email"],
            e["session_id"], e["latency_ms"], e["idempotency_key"]) == (100, 7, "p1", "a@b.test", "s1", 42, "k1")
    assert e["timestamp"].startswith("2026-09-01T00:00:00")
    assert len(req["body"]["events"][1]["idempotency_key"]) == 36


def test_fallback_to_single_on_404(server):
    server.responder = lambda req, n: (404, None, None) if req["path"].endswith("/batch") else (201, {}, None)
    tf = mk(server.url)
    for i in range(3):
        ev(tf, i, idempotency_key=f"k{i}")
    r = tf.flush()
    assert (r.sent, r.dropped) == (3, 0)
    ev(tf)
    tf.flush()
    paths = [x["path"] for x in server.received]
    assert paths.count("/api/v1/ingest/batch") == 1
    assert paths.count("/api/v1/ingest") == 4
    assert {x["headers"].get("idempotency-key") for x in server.received[1:4]} == {"k0", "k1", "k2"}


def test_non_retryable_4xx_counts_as_dropped(server):
    server.responder = lambda req, n: (404, None, None) if req["path"].endswith("/batch") else (400, {"error": "bad"}, None)
    tf = mk(server.url)
    ev(tf); ev(tf)
    r = tf.flush()
    assert (r.sent, r.dropped) == (0, 2)
    assert len(server.received) == 3  # probe + 2 singles, no retries
    assert tf.stats() == {"sent": 0, "dropped": 2, "queued": 0}


def test_batch_mixed_results_retries_only_retryable(server):
    def responder(req, n):
        if n == 1:
            return 207, {"results": [{"index": 0, "status": 201}, {"index": 1, "status": 422},
                                     {"index": 2, "status": 503}]}, None
        assert len(req["body"]["events"]) == 1
        return 200, {"results": [{"index": 0, "ok": True}]}, None
    server.responder = responder
    tf = mk(server.url, max_retries=2)
    for i in range(3):
        ev(tf, i)
    r = tf.flush()
    assert (r.sent, r.dropped) == (2, 1)
    assert len(server.received) == 2


def test_retry_after_honoured(server):
    times = []

    def responder(req, n):
        times.append(time.monotonic())
        return (429, {}, {"Retry-After": "1"}) if n == 1 else (200, {}, None)
    server.responder = responder
    tf = mk(server.url)
    ev(tf)
    r = tf.flush()
    assert (r.sent, r.dropped) == (1, 0)
    assert times[1] - times[0] >= 0.95


def test_503_exhausts_retries_then_dropped(server):
    server.responder = lambda req, n: (503, {}, {"Retry-After": "0"})
    tf = mk(server.url, max_retries=2)
    ev(tf)
    r = tf.flush()
    assert (r.sent, r.dropped) == (0, 1)
    assert len(server.received) == 3


def test_network_errors_never_raise():
    tf = mk("http://127.0.0.1:1", max_retries=0, timeout=0.5)
    for _ in range(6):
        ev(tf)
        assert tf.flush().dropped == 1
    assert tf.stats()["dropped"] == 6


def test_bounded_queue_drops_oldest(server):
    tf = mk(server.url, max_queue_size=2, batch_size=10)
    for i in range(5):
        ev(tf, i)
    assert tf.stats() == {"sent": 0, "dropped": 3, "queued": 2}
    tf.flush()
    assert [e["model"] for e in server.events()] == ["m3", "m4"]


def test_background_thread_flushes_and_no_signal_hijack(server):
    before = (signal.getsignal(signal.SIGINT), signal.getsignal(signal.SIGTERM))
    tf = TokenFinClient(api_key="tfk_test", base_url=server.url, flush_interval=0.05, batch_size=2,
                        flush_on_exit=False)
    assert (signal.getsignal(signal.SIGINT), signal.getsignal(signal.SIGTERM)) == before
    for i in range(3):
        ev(tf, i)
    time.sleep(0.4)
    assert tf.stats()["sent"] == 3
    tf.shutdown()


def test_bad_kwargs_never_raise(server):
    tf = mk(server.url)
    tf.track("m", 1, 1, not_a_field=True)
    tf.track("", 1, 1)
    assert tf.stats()["queued"] == 0


def test_retry_after_parsing():
    assert parse_retry_after("3") == 3.0
    assert parse_retry_after("Thu, 01 Jan 1970 00:00:10 GMT", now=5.0) == 5.0
    assert parse_retry_after("nope") is None


def test_async_client_batch_and_drop_accounting(server):
    server.responder = lambda req, n: (404, None, None) if req["path"].endswith("/batch") else \
        ((400, {}, None) if req["body"]["model"] == "bad" else (200, {}, None))

    async def main():
        tf = AsyncTokenFinClient(api_key="tfk_test", base_url=server.url, flush_interval=0)
        tf.track("good", 1, 1)
        await tf.track("bad", 1, 1)  # legacy awaited form still works
        return await tf.shutdown()

    r = asyncio.run(main())
    assert (r.sent, r.dropped) == (1, 1)
