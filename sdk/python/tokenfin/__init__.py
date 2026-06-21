"""
tokenfin — Python SDK for TokenFin LLM Cost Attribution.

Usage (sync)::

    from tokenfin import TokenFinClient

    tf = TokenFinClient(api_key="tf_live_...")
    tf.track(model="gpt-4o", input_tokens=800, output_tokens=120)
    tf.flush()          # drain before process exit

Usage (async)::

    from tokenfin import AsyncTokenFinClient

    tf = AsyncTokenFinClient(api_key="tf_live_...")
    await tf.track(model="gpt-4o", input_tokens=800, output_tokens=120)
    await tf.flush()

"""

from .client import TokenFinClient
from .async_client import AsyncTokenFinClient
from .types import TrackEvent, FlushResult, TokenFinConfig

__all__ = [
    "TokenFinClient",
    "AsyncTokenFinClient",
    "TrackEvent",
    "FlushResult",
    "TokenFinConfig",
]

__version__ = "0.1.0"
