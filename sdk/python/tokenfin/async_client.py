"""
Async TokenFin client (asyncio).

Requires Python 3.9+ and aiohttp::

    pip install tokenfin[async]

"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import List, Optional

from .types import TokenFinConfig, TrackEvent, FlushResult
from .utils import backoff_seconds, event_to_payload, RETRYABLE_STATUSES

logger = logging.getLogger("tokenfin.async")

_CB_THRESHOLD = 5
_CB_COOLDOWN  = 60.0


class AsyncTokenFinClient:
    """
    Async TokenFin client for asyncio applications (FastAPI, Django ASGI, etc.).

    Example::

        import asyncio
        from tokenfin import AsyncTokenFinClient

        tf = AsyncTokenFinClient(api_key="tf_live_...")

        async def call_llm():
            response = await openai_client.chat.completions.create(...)
            await tf.track(
                model="gpt-4o",
                input_tokens=response.usage.prompt_tokens,
                output_tokens=response.usage.completion_tokens,
            )

        async def shutdown():
            await tf.flush()

    """

    def __init__(self, api_key: Optional[str] = None, **kwargs):
        """
        Create an async TokenFin client.

        Args:
            api_key: API key starting with ``tf_``. Required.
            **kwargs: Any field from :class:`TokenFinConfig`.
        """
        if api_key is not None:
            kwargs["api_key"] = api_key
        self._cfg = TokenFinConfig(**kwargs)
        self._ingest_url = self._cfg.base_url.rstrip("/") + "/api/v1/ingest"

        if self._cfg.debug:
            logging.basicConfig(level=logging.DEBUG)

        self._queue: List[dict] = []
        self._lock  = asyncio.Lock()

        # Circuit breaker
        self._cb_failures  = 0
        self._cb_open_until: float = 0.0

        # Background flush task (started lazily on first track() call)
        self._flush_task: Optional[asyncio.Task] = None
        self._stop = False

    # ── Public API ────────────────────────────────────────────────────────────

    async def track(
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

        Starts the background flush task on first call.
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

        async with self._lock:
            if len(self._queue) >= self._cfg.max_queue_size:
                self._queue.pop(0)
                logger.debug("queue full — dropped oldest event")
            self._queue.append(payload)
            queue_len = len(self._queue)

        logger.debug("queued event (queue=%d)", queue_len)

        # Start background flusher lazily
        if self._flush_task is None and self._cfg.flush_interval > 0:
            self._flush_task = asyncio.create_task(self._flush_loop())

        # Trigger immediate flush if batch threshold reached
        if queue_len >= self._cfg.batch_size:
            await self._flush_once()

    async def flush(self) -> FlushResult:
        """
        Drain the queue and wait for all batches to complete.

        Call this in your app shutdown handler before the event loop closes.
        """
        self._stop = True
        if self._flush_task and not self._flush_task.done():
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        return await self._flush_once()

    async def destroy(self) -> None:
        """Cancel the flush task and discard all queued events."""
        self._stop = True
        if self._flush_task and not self._flush_task.done():
            self._flush_task.cancel()
        async with self._lock:
            dropped = len(self._queue)
            self._queue.clear()
        logger.debug("destroyed — dropped %d events", dropped)

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _flush_loop(self) -> None:
        while not self._stop:
            await asyncio.sleep(self._cfg.flush_interval)
            async with self._lock:
                has_work = bool(self._queue)
            if has_work:
                await self._flush_once()

    async def _flush_once(self) -> FlushResult:
        result = FlushResult()
        while True:
            async with self._lock:
                if not self._queue:
                    break
                if time.monotonic() < self._cb_open_until:
                    dropped = len(self._queue)
                    self._queue.clear()
                    result.dropped += dropped
                    logger.debug("circuit open — dropped %d events", dropped)
                    break
                batch = self._queue[: self._cfg.batch_size]
                del self._queue[: self._cfg.batch_size]

            ok = await self._send_batch(batch)
            if ok:
                result.sent += len(batch)
                self._cb_failures = 0
            else:
                result.dropped += len(batch)
                break
        return result

    async def _send_batch(self, batch: List[dict]) -> bool:
        """Send all events in the batch concurrently."""
        try:
            import aiohttp
        except ImportError:
            raise ImportError(
                "aiohttp is required for AsyncTokenFinClient.\n"
                "Install it with: pip install tokenfin[async]"
            ) from None

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._cfg.api_key}",
        }

        async def send_one(session: aiohttp.ClientSession, payload: dict) -> bool:
            body = json.dumps(payload)
            for attempt in range(self._cfg.max_retries):
                if attempt > 0:
                    await asyncio.sleep(backoff_seconds(attempt - 1))
                try:
                    async with session.post(
                        self._ingest_url,
                        data=body,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=self._cfg.timeout),
                    ) as resp:
                        if resp.status < 300:
                            return True
                        if resp.status not in RETRYABLE_STATUSES:
                            logger.debug("non-retryable %d — dropping", resp.status)
                            return False
                        logger.debug("retryable %d (attempt %d)", resp.status, attempt + 1)
                except Exception as e:
                    logger.debug("send error (attempt %d): %s", attempt + 1, str(e))
            return False

        timeout = aiohttp.ClientTimeout(total=self._cfg.timeout * self._cfg.max_retries + 5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            results = await asyncio.gather(
                *[send_one(session, p) for p in batch], return_exceptions=False
            )

        failures = results.count(False)
        if failures == 0:
            logger.debug("batch sent ok (%d events)", len(batch))
            return True

        self._open_circuit()
        return False

    def _open_circuit(self) -> None:
        self._cb_failures += 1
        if self._cb_failures >= _CB_THRESHOLD:
            self._cb_open_until = time.monotonic() + _CB_COOLDOWN
            logger.warning(
                "tokenfin: circuit breaker opened — will retry after %.0fs", _CB_COOLDOWN
            )
