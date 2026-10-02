"""
Internal utilities shared by the sync and async clients.
"""
from __future__ import annotations

import random
import time
import uuid as _uuid_mod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional

from .types import TrackEvent

SDK_VERSION = "0.2.1"
SERVER_BATCH_CAP = 500


def new_uuid() -> str:
    return str(_uuid_mod.uuid4())


def backoff_seconds(attempt: int, cap: float = 5.0) -> float:
    """Exponential backoff with 30% jitter: ~0.1s, ~0.2s, ~0.4s … capped."""
    base = 0.1 * (2 ** attempt)
    return min(base + random.random() * base * 0.3, cap)


def is_retryable(status: int) -> bool:
    """408, 429 and 5xx are retried. Every other 4xx is permanent → dropped."""
    return status in (408, 429) or status >= 500


def parse_retry_after(value: Optional[str], now: Optional[float] = None) -> Optional[float]:
    """Parse Retry-After (delta-seconds or HTTP-date) into seconds."""
    if not value:
        return None
    value = value.strip()
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        at = parsedate_to_datetime(value).timestamp()
    except (TypeError, ValueError, IndexError):
        return None
    return max(0.0, at - (time.time() if now is None else now))


def _nonneg(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n != n or n in (float("inf"), float("-inf")):
        return None
    n = max(0.0, n)
    return int(n) if n.is_integer() else n


def event_to_payload(event: TrackEvent) -> Dict[str, Any]:
    """Convert a TrackEvent to the snake_case wire format."""
    ts = event.timestamp
    if isinstance(ts, datetime):
        ts = (ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)).isoformat()
    elif ts is None:
        ts = datetime.now(timezone.utc).isoformat()
    payload: Dict[str, Any] = {
        "model": event.model,
        "idempotency_key": event.idempotency_key or new_uuid(),
        "timestamp": ts,
    }
    for name in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
                 "total_tokens", "latency_ms"):
        v = _nonneg(getattr(event, name))
        if v is not None:
            payload[name] = v
    for name in ("project_id", "user_email", "session_id", "provider", "source", "tool",
                 "prompt_text", "prompt_hash"):
        v = getattr(event, name)
        if v:
            payload[name] = v
    if event.tags:
        payload["tags"] = event.tags
    if event.metadata:
        payload["metadata"] = event.metadata
    return payload


@dataclass
class HttpResult:
    status: Optional[int]          # None = network error / timeout
    retry_after: Optional[float] = None
    body: Any = None


@dataclass
class SendOutcome:
    sent: int = 0
    dropped: int = 0
    retry: List[dict] = field(default_factory=list)
    retry_after: Optional[float] = None


_OK_WORDS = {"ok", "accepted", "created", "inserted", "duplicate", "deduped", "skipped", "success"}
_RETRY_WORDS = {"retry", "throttled", "rate_limited", "unavailable"}


def _classify_item(item: Any) -> str:
    if not isinstance(item, dict):
        return "sent"
    status = item.get("status")
    if isinstance(status, int) and not isinstance(status, bool):
        if status < 300:
            return "sent"
        return "retry" if is_retryable(status) else "dropped"
    if isinstance(status, str):
        s = status.lower()
        if s in _OK_WORDS:
            return "sent"
        if s in _RETRY_WORDS:
            return "retry"
        return "dropped"
    if item.get("ok") is True or item.get("accepted") is True or item.get("duplicate") is True:
        return "sent"
    if item.get("ok") is False or item.get("error"):
        return "dropped"
    return "sent"


def interpret_batch(r: HttpResult, events: List[dict]) -> SendOutcome:
    """Map a /api/v1/ingest/batch response onto sent / dropped / retry."""
    if r.status is None:
        return SendOutcome(retry=list(events))
    if is_retryable(r.status):
        return SendOutcome(retry=list(events), retry_after=r.retry_after)
    if r.status >= 300:
        return SendOutcome(dropped=len(events))
    results = r.body.get("results") if isinstance(r.body, dict) else None
    if not isinstance(results, list):
        return SendOutcome(sent=len(events))
    by_index = {x.get("index"): x for x in results if isinstance(x, dict) and "index" in x}
    out = SendOutcome()
    for i, ev in enumerate(events):
        item = by_index.get(i, results[i] if i < len(results) else None)
        verdict = _classify_item(item)
        if verdict == "sent":
            out.sent += 1
        elif verdict == "retry":
            out.retry.append(ev)
        else:
            out.dropped += 1
    return out


def interpret_single(results: List[HttpResult], events: List[dict]) -> SendOutcome:
    out = SendOutcome()
    for r, ev in zip(results, events):
        if r.status is None or is_retryable(r.status):
            out.retry.append(ev)
            if r.retry_after is not None:
                out.retry_after = max(out.retry_after or 0.0, r.retry_after)
        elif r.status < 300:
            out.sent += 1
        else:
            out.dropped += 1
    return out


def headers_for(api_key: str, idempotency_key: Optional[str] = None) -> Dict[str, str]:
    h = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "X-TokenFin-SDK": f"python/{SDK_VERSION}",
        "User-Agent": f"tokenfin-python/{SDK_VERSION}",
    }
    if idempotency_key:
        h["Idempotency-Key"] = idempotency_key
    return h
