"""
Internal utilities for the TokenFin Python SDK.
"""
from __future__ import annotations

import random
import time
import uuid as _uuid_mod
from typing import Dict, Any, Optional

from .types import TrackEvent


def new_uuid() -> str:
    """Generate a UUID v4 string."""
    return str(_uuid_mod.uuid4())


def backoff_seconds(attempt: int, cap: float = 5.0) -> float:
    """
    Exponential backoff with 30% jitter.

    attempt=0 → ~0.1s, attempt=1 → ~0.2s, attempt=2 → ~0.4s, capped at cap.
    """
    base = 0.1 * (2 ** attempt)
    jitter = random.random() * base * 0.3
    return min(base + jitter, cap)


# HTTP status codes that are worth retrying
RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


def event_to_payload(event: TrackEvent) -> Dict[str, Any]:
    """Convert a TrackEvent to the snake_case wire format expected by the API."""
    payload: Dict[str, Any] = {
        "model": event.model,
        "input_tokens": event.input_tokens,
        "output_tokens": event.output_tokens,
        "idempotency_key": event.idempotency_key or new_uuid(),
    }
    if event.tags:
        payload["tags"] = event.tags
    if event.metadata:
        payload["metadata"] = event.metadata
    return payload
