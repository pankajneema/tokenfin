"""
Synchronous TokenFin client.

Events are queued in memory and sent in batches by a background daemon
thread to ``/api/v1/ingest/batch`` (falling back to ``/api/v1/ingest`` on
servers without it). ``track()`` never blocks and never raises.

The client drains on ``atexit`` but never installs signal handlers — call
``shutdown()`` from your own shutdown path.
"""
from __future__ import annotations

import atexit
import json
import logging
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Deque, Dict, List, Optional

from .types import FlushResult, TokenFinConfig, TrackEvent
from .utils import (
    SERVER_BATCH_CAP, HttpResult, SendOutcome, backoff_seconds, event_to_payload,
    headers_for, interpret_batch, interpret_single, parse_retry_after,
)

logger = logging.getLogger("tokenfin")

_CB_THRESHOLD = 5
_CB_COOLDOWN = 60.0
_SINGLE_CONCURRENCY = 8


class TokenFinClient:
    """
    Synchronous TokenFin client.

    Example::

        tf = TokenFinClient(api_key="tfk_prod_...")
        tf.track(model="gpt-4o", input_tokens=800, output_tokens=120,
                 user_email="dev@acme.com", tags={"feature": "chat"})
        tf.shutdown()   # drain before exit
    """

    def __init__(self, api_key: Optional[str] = None, **kwargs: Any) -> None:
        if api_key is not None:
            kwargs["api_key"] = api_key
        self._cfg = TokenFinConfig(**kwargs)
        self._base = self._cfg.base_url.rstrip("/")
        self._batch_size = max(1, min(self._cfg.batch_size, SERVER_BATCH_CAP))
        if self._cfg.debug:
            logger.setLevel(logging.DEBUG)

        self._queue: Deque[dict] = deque()
        self._lock = threading.Lock()          # guards queue + counters
        self._drain_lock = threading.Lock()    # one drain at a time
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._closed = False
        self._batch_supported: Optional[bool] = None
        self._sent_total = 0
        self._dropped_total = 0
        self._cb_failures = 0
        self._cb_open_until = 0.0

        self._thread: Optional[threading.Thread] = None
        if self._cfg.flush_interval > 0:
            self._thread = threading.Thread(target=self._loop, daemon=True, name="tokenfin-flusher")
            self._thread.start()
        if self._cfg.flush_on_exit:
            atexit.register(self._atexit)

    # ── Public API ────────────────────────────────────────────────────────────

    def track(self, model: str, input_tokens: Optional[int] = None,
              output_tokens: Optional[int] = None, **fields: Any) -> None:
        """
        Enqueue a usage event. Returns immediately — never raises.

        Keyword fields: cache_read_tokens, cache_write_tokens, total_tokens,
        project_id, user_email, session_id, latency_ms, timestamp, provider,
        source, tool, prompt_text, prompt_hash, idempotency_key, tags, metadata.
        """
        try:
            if not model:
                logger.debug("track() ignored: model is required")
                return
            payload = event_to_payload(TrackEvent(
                model=model, input_tokens=input_tokens, output_tokens=output_tokens, **fields))
        except Exception as e:  # bad kwargs etc. — never raise into the host
            logger.debug("track() failed: %s", e)
            return
        self._enqueue(payload)

    def track_event(self, event: TrackEvent) -> None:
        """Enqueue a prebuilt :class:`TrackEvent`."""
        try:
            self._enqueue(event_to_payload(event))
        except Exception as e:
            logger.debug("track_event() failed: %s", e)

    def flush(self) -> FlushResult:
        """Send everything queued so far and wait for it. Never raises."""
        try:
            return self._drain()
        except Exception as e:
            logger.debug("flush() failed: %s", e)
            return FlushResult()

    def shutdown(self, timeout: Optional[float] = None) -> FlushResult:
        """Stop the background thread and drain the queue. Idempotent."""
        self._stop.set()
        self._wake.set()
        if self._thread and self._thread.is_alive() and self._thread is not threading.current_thread():
            self._thread.join(timeout)
        result = self.flush()
        self._closed = True
        return result

    close = shutdown

    def destroy(self) -> None:
        """Stop the background thread and discard queued events (counted as dropped)."""
        self._stop.set()
        self._wake.set()
        with self._lock:
            self._dropped_total += len(self._queue)
            self._queue.clear()
        self._closed = True

    def stats(self) -> Dict[str, int]:
        """Lifetime counters: sent, dropped, queued."""
        with self._lock:
            return {"sent": self._sent_total, "dropped": self._dropped_total, "queued": len(self._queue)}

    def __enter__(self) -> "TokenFinClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.shutdown()

    # ── Internal ──────────────────────────────────────────────────────────────

    def _enqueue(self, payload: dict) -> None:
        with self._lock:
            if self._closed:
                self._dropped_total += 1
                return
            if len(self._queue) >= self._cfg.max_queue_size:
                self._queue.popleft()
                self._dropped_total += 1
                logger.debug("queue full — dropped oldest event")
            self._queue.append(payload)
            n = len(self._queue)
        if n >= self._batch_size:
            self._wake.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(timeout=self._cfg.flush_interval)
            self._wake.clear()
            if self._stop.is_set():
                break
            try:
                self._drain()
            except Exception as e:
                logger.debug("background flush failed: %s", e)

    def _drain(self) -> FlushResult:
        result = FlushResult()
        with self._drain_lock:
            while True:
                with self._lock:
                    if not self._queue:
                        break
                    if time.monotonic() < self._cb_open_until:
                        n = len(self._queue)
                        self._queue.clear()
                        result.dropped += n
                        logger.debug("circuit open — dropped %d events", n)
                        break
                    batch = [self._queue.popleft() for _ in range(min(self._batch_size, len(self._queue)))]
                sent, dropped, failed_hard = self._send_with_retry(batch)
                result.sent += sent
                result.dropped += dropped
                if failed_hard:
                    self._open_circuit()
                    break
                self._cb_failures = 0
        with self._lock:
            self._sent_total += result.sent
            self._dropped_total += result.dropped
        return result

    def _send_with_retry(self, batch: List[dict]):
        sent = dropped = 0
        pending = batch
        for attempt in range(self._cfg.max_retries + 1):
            out = self._send(pending)
            sent += out.sent
            dropped += out.dropped
            pending = out.retry
            if not pending or attempt == self._cfg.max_retries:
                break
            wait = (min(out.retry_after, self._cfg.max_retry_after)
                    if out.retry_after is not None else backoff_seconds(attempt))
            logger.debug("%d events retryable — sleeping %.2fs", len(pending), wait)
            time.sleep(wait)
        return sent, dropped + len(pending), bool(pending) and sent == 0

    def _send(self, events: List[dict]) -> SendOutcome:
        if self._batch_supported is not False:
            r = self._post("/api/v1/ingest/batch", {"events": events}, None)
            if r.status in (404, 405):
                logger.debug("batch endpoint unavailable — falling back to /api/v1/ingest")
                self._batch_supported = False
            else:
                if r.status is not None and r.status < 300:
                    self._batch_supported = True
                return interpret_batch(r, events)
        with ThreadPoolExecutor(max_workers=min(_SINGLE_CONCURRENCY, len(events))) as pool:
            results = list(pool.map(
                lambda e: self._post("/api/v1/ingest", e, e.get("idempotency_key")), events))
        return interpret_single(results, events)

    def _post(self, path: str, body: Any, idem: Optional[str]) -> HttpResult:
        return post_urllib(self._base + path, body, self._cfg.api_key, idem, self._cfg.timeout)

    def _open_circuit(self) -> None:
        self._cb_failures += 1
        if self._cb_failures >= _CB_THRESHOLD:
            self._cb_open_until = time.monotonic() + _CB_COOLDOWN
            logger.warning("tokenfin: circuit breaker opened — sending paused for %.0fs", _CB_COOLDOWN)

    def _atexit(self) -> None:
        try:
            if not self._closed:
                self.shutdown(timeout=self._cfg.timeout)
        except Exception:
            pass


def post_urllib(url: str, body: Any, api_key: str, idem: Optional[str], timeout: float) -> HttpResult:
    """POST JSON with the stdlib; never raises (status=None on network errors)."""
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers=headers_for(api_key, idem), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return HttpResult(resp.status, parse_retry_after(resp.headers.get("Retry-After")),
                              _json(resp.read()))
    except urllib.error.HTTPError as e:
        try:
            raw = e.read()
        except Exception:
            raw = b""
        return HttpResult(e.code, parse_retry_after(e.headers.get("Retry-After") if e.headers else None),
                          _json(raw))
    except Exception as e:
        # Log only the exception type — never headers (Bearer token).
        logger.debug("request to %s failed: %s", url, type(e).__name__)
        return HttpResult(None)


def _json(raw: bytes) -> Any:
    try:
        return json.loads(raw) if raw else None
    except Exception:
        return None
