"""
Shared types for the TokenFin Python SDK.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional, Union


@dataclass
class TokenFinConfig:
    """Configuration for the TokenFin client."""

    api_key: str
    """API key — starts with 'tfk_'. Required."""

    base_url: str = "https://tokenfin.curiousdevs.com"
    """Base URL of your TokenFin instance. Override for self-hosted deployments."""

    timeout: float = 5.0
    """Per-request HTTP timeout in seconds."""

    flush_interval: float = 1.0
    """Auto-flush interval in seconds. 0 disables background flushing."""

    batch_size: int = 100
    """Maximum events per HTTP request (server cap: 500)."""

    max_queue_size: int = 10_000
    """Maximum events held in memory. The OLDEST event is dropped (and counted) when full."""

    max_retries: int = 3
    """Retries per request for 408/429/5xx/network errors."""

    max_retry_after: float = 30.0
    """Upper bound (seconds) for honouring a Retry-After header."""

    flush_on_exit: bool = True
    """Drain the queue from an ``atexit`` hook. No signal handlers are ever installed."""

    debug: bool = False
    """Emit debug logs via the ``tokenfin`` logger."""


@dataclass
class TrackEvent:
    """A single LLM usage event."""

    model: str
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cache_read_tokens: Optional[int] = None
    cache_write_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    project_id: Optional[str] = None
    user_email: Optional[str] = None
    session_id: Optional[str] = None
    latency_ms: Optional[float] = None
    timestamp: Optional[Union[datetime, str]] = None
    provider: Optional[str] = None
    source: Optional[str] = None
    tool: Optional[str] = None
    prompt_text: Optional[str] = None
    """Only send when you have opted in to prompt capture."""
    prompt_hash: Optional[str] = None
    idempotency_key: Optional[str] = None
    """Deduplication key; auto-generated (UUID v4) when omitted."""
    tags: Optional[Dict[str, str]] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class FlushResult:
    """Outcome of a flush call."""

    sent: int = 0
    """Events accepted by the server (incl. idempotent duplicates)."""

    dropped: int = 0
    """Events rejected (non-retryable 4xx) or failed after all retries."""
