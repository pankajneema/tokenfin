"""
Async TokenFin client (asyncio).

Uses aiohttp when installed (``pip install "tokenfin[async]"``); otherwise it
falls back to the stdlib transport in a worker thread, so it works with zero
dependencies.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional

from .client import post_urllib, _json
from .policy import PolicyManager, fetch_policy_urllib
from .types import FlushResult, TokenFinConfig, TrackEvent
from .utils import (
    SERVER_BATCH_CAP, HttpResult, SendOutcome, backoff_seconds, event_to_payload,
    headers_for, interpret_batch, interpret_single, parse_retry_after,
)

logger = logging.getLogger("tokenfin.async")

_CB_THRESHOLD = 5
_CB_COOLDOWN = 60.0
_SINGLE_CONCURRENCY = 8


class AsyncTokenFinClient:
    """
    Async TokenFin client for asyncio apps (FastAPI, ASGI workers, …).

    Example::

        tf = AsyncTokenFinClient(api_key="tfk_prod_...")
        tf.track(model="gpt-4o", input_tokens=800, output_tokens=120)   # sync, non-blocking
        await tf.shutdown()                                             # drain on app shutdown

    ``track()`` is a plain (non-async) method; ``await tf.track(...)`` also
    works for backwards compatibility.
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
        self._drain_lock: Optional[asyncio.Lock] = None
        self._task: Optional[asyncio.Task] = None
        self._stopped = False
        self._closed = False
        self._batch_supported: Optional[bool] = None
        self._sent_total = 0
        self._dropped_total = 0
        self._cb_failures = 0
        self._cb_open_until = 0.0
        self._session: Any = None

    # ── Public API ────────────────────────────────────────────────────────────

    def policy(self) -> "PolicyManager":
        """The org's SDK policy (model routes / blocked models) from ``GET /api/v1/policy``,
        refreshed on a background thread. Used by the wrappers."""
        pm = getattr(self, "_policy_mgr", None)
        if pm is None:
            pm = PolicyManager(fetch_policy_urllib(self._base, self._cfg.api_key, self._cfg.timeout), self._cfg.policy_ttl)
            self._policy_mgr = pm
        return pm

    def track(self, model: str, input_tokens: Optional[int] = None,
              output_tokens: Optional[int] = None, **fields: Any) -> "_Done":
        """Enqueue a usage event. Never raises. Awaiting the return value is optional."""
        try:
            if model:
                self._enqueue(event_to_payload(TrackEvent(
                    model=model, input_tokens=input_tokens, output_tokens=output_tokens, **fields)))
        except Exception as e:
            logger.debug("track() failed: %s", e)
        return _DONE

    def track_event(self, event: TrackEvent) -> "_Done":
        try:
            self._enqueue(event_to_payload(event))
        except Exception as e:
            logger.debug("track_event() failed: %s", e)
        return _DONE

    async def flush(self) -> FlushResult:
        """Send everything queued so far and wait for it. Never raises."""
        try:
            return await self._drain()
        except Exception as e:
            logger.debug("flush() failed: %s", e)
            return FlushResult()

    async def shutdown(self) -> FlushResult:
        """Cancel the background task, drain the queue and close the HTTP session."""
        self._stopped = True
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        result = await self.flush()
        self._closed = True
        if self._session is not None:
            try:
                await self._session.close()
            except Exception:
                pass
            self._session = None
        return result

    aclose = shutdown

    async def destroy(self) -> None:
        """Cancel the background task and discard queued events (counted as dropped)."""
        self._stopped = True
        if self._task and not self._task.done():
            self._task.cancel()
        self._dropped_total += len(self._queue)
        self._queue.clear()
        self._closed = True

    def stats(self) -> Dict[str, int]:
        return {"sent": self._sent_total, "dropped": self._dropped_total, "queued": len(self._queue)}

    async def __aenter__(self) -> "AsyncTokenFinClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.shutdown()

    # ── Internal ──────────────────────────────────────────────────────────────

    def _enqueue(self, payload: dict) -> None:
        if self._closed:
            self._dropped_total += 1
            return
        if len(self._queue) >= self._cfg.max_queue_size:
            self._queue.popleft()
            self._dropped_total += 1
        self._queue.append(payload)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # no loop yet: events wait for flush()/shutdown()
        if self._task is None and self._cfg.flush_interval > 0 and not self._stopped:
            self._task = loop.create_task(self._loop())
        if len(self._queue) >= self._batch_size:
            loop.create_task(self.flush())

    async def _loop(self) -> None:
        while not self._stopped:
            await asyncio.sleep(self._cfg.flush_interval)
            if self._queue:
                await self.flush()

    async def _drain(self) -> FlushResult:
        if self._drain_lock is None:
            self._drain_lock = asyncio.Lock()
        result = FlushResult()
        async with self._drain_lock:
            while self._queue:
                if time.monotonic() < self._cb_open_until:
                    result.dropped += len(self._queue)
                    self._queue.clear()
                    break
                batch = [self._queue.popleft() for _ in range(min(self._batch_size, len(self._queue)))]
                sent, dropped, failed_hard = await self._send_with_retry(batch)
                result.sent += sent
                result.dropped += dropped
                if failed_hard:
                    self._cb_failures += 1
                    if self._cb_failures >= _CB_THRESHOLD:
                        self._cb_open_until = time.monotonic() + _CB_COOLDOWN
                        logger.warning("tokenfin: circuit breaker opened for %.0fs", _CB_COOLDOWN)
                    break
                self._cb_failures = 0
        self._sent_total += result.sent
        self._dropped_total += result.dropped
        return result

    async def _send_with_retry(self, batch: List[dict]):
        sent = dropped = 0
        pending = batch
        for attempt in range(self._cfg.max_retries + 1):
            out = await self._send(pending)
            sent += out.sent
            dropped += out.dropped
            pending = out.retry
            if not pending or attempt == self._cfg.max_retries:
                break
            wait = (min(out.retry_after, self._cfg.max_retry_after)
                    if out.retry_after is not None else backoff_seconds(attempt))
            await asyncio.sleep(wait)
        return sent, dropped + len(pending), bool(pending) and sent == 0

    async def _send(self, events: List[dict]) -> SendOutcome:
        if self._batch_supported is not False:
            r = await self._post("/api/v1/ingest/batch", {"events": events}, None)
            if r.status in (404, 405):
                self._batch_supported = False
            else:
                if r.status is not None and r.status < 300:
                    self._batch_supported = True
                return interpret_batch(r, events)
        sem = asyncio.Semaphore(_SINGLE_CONCURRENCY)

        async def one(e: dict) -> HttpResult:
            async with sem:
                return await self._post("/api/v1/ingest", e, e.get("idempotency_key"))

        results = await asyncio.gather(*(one(e) for e in events))
        return interpret_single(list(results), events)

    async def _post(self, path: str, body: Any, idem: Optional[str]) -> HttpResult:
        try:
            import aiohttp  # type: ignore
        except ImportError:
            return await asyncio.to_thread(
                post_urllib, self._base + path, body, self._cfg.api_key, idem, self._cfg.timeout)
        try:
            if self._session is None or self._session.closed:
                self._session = aiohttp.ClientSession()
            async with self._session.post(
                self._base + path, data=json.dumps(body), headers=headers_for(self._cfg.api_key, idem),
                timeout=aiohttp.ClientTimeout(total=self._cfg.timeout),
            ) as resp:
                raw = await resp.read()
                return HttpResult(resp.status, parse_retry_after(resp.headers.get("Retry-After")), _json(raw))
        except Exception as e:
            logger.debug("request to %s failed: %s", path, type(e).__name__)
            return HttpResult(None)


class _Done:
    """Awaitable no-op so legacy ``await tf.track(...)`` keeps working."""

    def __await__(self):
        if False:  # pragma: no cover
            yield
        return None


_DONE = _Done()
