"""
Synchronous TokenFin client.

Uses a background daemon thread for auto-flushing. Registers atexit and
signal handlers to drain the queue on process exit.
"""
from __future__ import annotations

import atexit
import json
import logging
import signal
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import List, Optional

from .types import TokenFinConfig, TrackEvent, FlushResult
from .utils import backoff_seconds, event_to_payload, RETRYABLE_STATUSES

logger = logging.getLogger("tokenfin")

# Circuit-breaker constants
_CB_THRESHOLD = 5
_CB_COOLDOWN  = 60.0   # seconds


class TokenFinClient:
    """
    Synchronous TokenFin client.

    Events are queued in memory and flushed in batches by a background
    daemon thread, so ``track()`` never blocks your application.

    Example::

        tf = TokenFinClient(api_key="tf_live_...")

        # After every LLM call:
        tf.track(model="gpt-4o", input_tokens=800, output_tokens=120,
                 tags={"feature": "chat"})

        # Graceful shutdown (drain queue before exit):
        tf.flush()

    """

    def __init__(self, api_key: Optional[str] = None, **kwargs):
        """
        Create a TokenFin client.

        Args:
            api_key: API key starting with ``tf_``. Required.
            **kwargs: Any field from :class:`TokenFinConfig`
                      (``base_url``, ``timeout``, ``flush_interval``,
                      ``batch_size``, ``max_queue_size``, ``max_retries``,
                      ``debug``).
        """
        if api_key is not None:
            kwargs["api_key"] = api_key
        self._cfg = TokenFinConfig(**kwargs)
        self._ingest_url = self._cfg.base_url.rstrip("/") + "/api/v1/ingest"

        if self._cfg.debug:
            logging.basicConfig(level=logging.DEBUG)

        self._queue: List[dict] = []
        self._lock  = threading.Lock()
        self._flush_event = threading.Event()

        # Circuit breaker
        self._cb_failures  = 0
        self._cb_open_until: float = 0.0

        # Background flush thread
        self._stop  = threading.Event()
        self._thread: Optional[threading.Thread] = None
        if self._cfg.flush_interval > 0:
            self._thread = threading.Thread(
                target=self._flush_loop, daemon=True, name="tokenfin-flusher"
            )
            self._thread.start()

        # Drain on process exit
        atexit.register(self._atexit_flush)
        self._register_signals()

    # ── Public API ────────────────────────────────────────────────────────────

    def track(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        *,
        idempotency_key: Optional[str] = None,
        tags: Optional[dict] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        """
        Enqueue a usage event. Returns immediately — never raises.

        Args:
            model: LLM model identifier, e.g. ``"gpt-4o"``.
            input_tokens: Prompt/input token count.
            output_tokens: Completion/output token count.
            idempotency_key: Optional dedup key (auto-generated UUID if omitted).
            tags: String key-value labels, filterable in the dashboard.
            metadata: Arbitrary JSON — stored but not indexed.
        """
        event = TrackEvent(
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            idempotency_key=idempotency_key,
            tags=tags,
            metadata=metadata,
        )
        payload = event_to_payload(event)

        with self._lock:
            if len(self._queue) >= self._cfg.max_queue_size:
                self._queue.pop(0)   # drop oldest
                logger.debug("queue full — dropped oldest event")
            self._queue.append(payload)
            queue_len = len(self._queue)

        logger.debug("queued event (queue=%d)", queue_len)

        # Trigger immediate flush if batch threshold reached
        if queue_len >= self._cfg.batch_size:
            self._flush_event.set()

    def flush(self) -> FlushResult:
        """
        Drain the queue synchronously and wait for all batches to be sent.

        Returns a :class:`FlushResult` with ``sent`` and ``dropped`` counts.
        Call this before your process exits to avoid dropping queued events.
        """
        self._stop.set()
        result = self._flush_once()
        return result

    def destroy(self) -> None:
        """Stop the auto-flush thread and discard all queued events."""
        self._stop.set()
        with self._lock:
            dropped = len(self._queue)
            self._queue.clear()
        logger.debug("destroyed — dropped %d events", dropped)

    # ── Internal ──────────────────────────────────────────────────────────────

    def _flush_loop(self) -> None:
        interval = self._cfg.flush_interval
        while not self._stop.is_set():
            # Wait for timer or batch-size trigger, whichever comes first
            self._flush_event.wait(timeout=interval)
            self._flush_event.clear()
            with self._lock:
                has_work = len(self._queue) > 0
            if has_work:
                self._flush_once()

    def _flush_once(self) -> FlushResult:
        result = FlushResult()
        while True:
            with self._lock:
                if not self._queue:
                    break
                # Circuit breaker
                if time.monotonic() < self._cb_open_until:
                    dropped = len(self._queue)
                    self._queue.clear()
                    result.dropped += dropped
                    logger.debug("circuit open — dropped %d events", dropped)
                    break
                batch = self._queue[: self._cfg.batch_size]
                del self._queue[: self._cfg.batch_size]

            ok = self._send_batch(batch)
            if ok:
                result.sent += len(batch)
                self._cb_failures = 0
            else:
                result.dropped += len(batch)
                break

        return result

    def _send_batch(self, batch: List[dict]) -> bool:
        """Send each event in the batch as a separate request (parallel in threads)."""
        url = self._ingest_url
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._cfg.api_key}",
        }

        failures = 0
        threads: List[threading.Thread] = []
        results: List[bool] = [False] * len(batch)

        def send_one(idx: int, payload: dict) -> None:
            results[idx] = self._send_one(url, headers, payload)

        for i, payload in enumerate(batch):
            t = threading.Thread(target=send_one, args=(i, payload), daemon=True)
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        failures = results.count(False)
        if failures == 0:
            logger.debug("batch sent ok (%d events)", len(batch))
            return True

        self._open_circuit()
        return False

    def _send_one(self, url: str, headers: dict, payload: dict) -> bool:
        body = json.dumps(payload).encode()
        for attempt in range(self._cfg.max_retries):
            if attempt > 0:
                time.sleep(backoff_seconds(attempt - 1))
            try:
                req = urllib.request.Request(url, data=body, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=self._cfg.timeout) as resp:
                    if resp.status < 300:
                        return True
                    if resp.status not in RETRYABLE_STATUSES:
                        logger.debug("non-retryable status %d — dropping", resp.status)
                        return False
                    logger.debug("retryable status %d (attempt %d)", resp.status, attempt + 1)
            except urllib.error.HTTPError as e:
                if e.code not in RETRYABLE_STATUSES:
                    logger.debug("HTTP error %d — dropping", e.code)
                    return False
                logger.debug("HTTP %d, will retry (attempt %d)", e.code, attempt + 1)
            except Exception as e:
                logger.debug("send error (attempt %d): %s", attempt + 1, str(e))
        return False

    def _open_circuit(self) -> None:
        self._cb_failures += 1
        if self._cb_failures >= _CB_THRESHOLD:
            self._cb_open_until = time.monotonic() + _CB_COOLDOWN
            logger.warning(
                "tokenfin: circuit breaker opened — will retry after %.0fs", _CB_COOLDOWN
            )

    def _atexit_flush(self) -> None:
        try:
            self._flush_once()
        except Exception:
            pass

    def _register_signals(self) -> None:
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                original = signal.getsignal(sig)

                def handler(signum, frame, _orig=original):
                    self._atexit_flush()
                    if callable(_orig):
                        _orig(signum, frame)
                    else:
                        sys.exit(0)

                signal.signal(sig, handler)
            except (ValueError, OSError):
                pass   # not in main thread — skip signal registration
