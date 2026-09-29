"""
tokenfin — Python SDK for TokenFin LLM cost attribution.

Auto-instrumentation::

    from anthropic import Anthropic
    from tokenfin import TokenFinClient, wrap_anthropic

    tf = TokenFinClient(api_key="tfk_...")
    client = wrap_anthropic(Anthropic(), tf)      # every call is now tracked

Manual tracking::

    tf.track(model="gpt-4o", input_tokens=800, output_tokens=120,
             cache_read_tokens=400, user_email="dev@acme.com")
    tf.shutdown()          # drain before exit
"""

from .client import TokenFinClient
from .async_client import AsyncTokenFinClient
from .types import TrackEvent, FlushResult, TokenFinConfig
from .utils import SDK_VERSION
from .wrappers import wrap_anthropic, wrap_openai

__all__ = [
    "TokenFinClient",
    "AsyncTokenFinClient",
    "TrackEvent",
    "FlushResult",
    "TokenFinConfig",
    "wrap_anthropic",
    "wrap_openai",
]

__version__ = SDK_VERSION
