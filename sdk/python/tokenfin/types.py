"""
Shared types for the TokenFin Python SDK.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class TokenFinConfig:
    """Configuration for the TokenFin client."""

    api_key: str
    """API key — must start with 'tf_'. Required."""

    base_url: str = "https://app.tokenfin.io"
    """Base URL of your TokenFin instance. Override for self-hosted deployments."""

    timeout: float = 3.0
    """Per-request HTTP timeout in seconds."""

    flush_interval: float = 1.0
    """Auto-flush interval in seconds. Set to 0 to disable background flushing."""

    batch_size: int = 50
    """Maximum events sent in a single HTTP request."""

    max_queue_size: int = 1_000
    """Maximum events held in memory. Oldest event is dropped when exceeded."""

    max_retries: int = 3
    """Maximum retry attempts per batch on retryable errors."""

    debug: bool = False
    """Emit debug logs to stderr."""


@dataclass
class TrackEvent:
    """A single LLM usage event to be tracked."""

    model: str
    """Model identifier, e.g. 'gpt-4o', 'claude-sonnet-4-6'."""

    input_tokens: int
    """Number of input/prompt tokens consumed."""

    output_tokens: int
    """Number of output/completion tokens produced."""

    idempotency_key: Optional[str] = None
    """
    Optional deduplication key. Duplicate events with the same key are
    silently discarded within a 24-hour window. Auto-generated if omitted.
    """

    tags: Optional[Dict[str, str]] = None
    """Free-form string labels — filterable in the dashboard."""

    metadata: Optional[Dict[str, Any]] = None
    """Arbitrary JSON payload — stored but not indexed."""


@dataclass
class FlushResult:
    """Outcome of a flush call."""

    sent: int = 0
    """Events successfully accepted by the server."""

    dropped: int = 0
    """Events that failed after all retries and were discarded."""
