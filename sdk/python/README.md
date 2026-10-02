# tokenfin — Python SDK

Track LLM token usage and cost in [TokenFin](https://github.com/pankajneema/tokenfin).
The sync client has no dependencies. `anthropic`, `openai` and `aiohttp` are all optional.

```bash
pip install tokenfin
pip install "tokenfin[async]"   # optional aiohttp transport for AsyncTokenFinClient
```

## Auto-instrument Anthropic / OpenAI

```python
from anthropic import Anthropic
from openai import OpenAI
from tokenfin import TokenFinClient, wrap_anthropic, wrap_openai

tf = TokenFinClient(api_key="tfk_...")
anthropic = wrap_anthropic(Anthropic(), tf, user_email="dev@acme.com", tags={"feature": "chat"})
openai = wrap_openai(OpenAI(), tf)
```

Every `messages.create` / `messages.stream` / `chat.completions.create` / `responses.create`
call is now recorded. This works for sync and async clients, with and without streaming.
The wrappers record the model, input and output tokens, cache read/write tokens, and latency.

- The wrappers do not change return values, and SDK errors propagate unchanged.
- Prompt capture is **off** by default. Turn it on with `capture_prompts=True`.
- For OpenAI streaming, `stream_options.include_usage` is set for you and the usage-only
  chunk is hidden.

## Manual tracking

```python
tf.track("claude-sonnet-4-6", 1200, 380,
         cache_read_tokens=9000, cache_write_tokens=400,
         project_id="…uuid…", user_email="dev@acme.com", session_id="run-42",
         latency_ms=812, idempotency_key="req_123", tags={"feature": "chat"})
tf.shutdown()     # drain before exit (also runs from atexit; no signal handlers are installed)
```

`flush()` and `shutdown()` return `FlushResult(sent, dropped)`, and `tf.stats()` returns
lifetime counters. A non-retryable 4xx counts as **dropped**. The SDK retries 408, 429, 5xx
and network errors, and honours `Retry-After`.

## Configuration

| Parameter | Default | Description |
|---|---|---|
| `api_key` | required | `tfk_…` key with the `ingest` or `write` scope |
| `base_url` | `https://tokenfin.curiousdevs.com` | self-hosted URL |
| `batch_size` | `100` | events per request (server max 500) |
| `flush_interval` | `1.0` | seconds; `0` = manual flush only |
| `max_queue_size` | `10000` | when full, the oldest event is dropped and counted |
| `max_retries` | `3` | retries for 408 / 429 / 5xx / network errors |
| `max_retry_after` | `30.0` | cap (seconds) on honouring `Retry-After` |
| `timeout` | `5.0` | per-request timeout (seconds) |
| `flush_on_exit` | `True` | drain the queue from `atexit` |
| `debug` | `False` | debug logging on the `tokenfin` logger |
| `policy_ttl` | `60.0` | seconds between refreshes of the org policy (model routes / blocks) |

### Model routes and limits

`wrap_anthropic` / `wrap_openai` read the org policy (`GET /api/v1/policy`, same key) on a
background thread and fail open. Active model routes — including automatic switches when a
per-model limit is reached — rewrite `model` before the call and record `metadata.routed_from`.
Pass `enforce_policy=True` to raise `TokenFinPolicyError` for models a limit blocked;
`route_models=False` disables routing; `policy_wait_ms` (default 200) caps how long the first
call waits for the first fetch (async clients wait without blocking the event loop).

```python
from tokenfin import TokenFinPolicyError
client = wrap_anthropic(Anthropic(), tf, enforce_policy=True)
try:
    client.messages.create(model="claude-opus-4-8", max_tokens=512, messages=msgs)
except TokenFinPolicyError as e:
    ...  # e.model is blocked for this org
```

See the [full SDK guide](https://github.com/pankajneema/tokenfin/blob/main/sdk/README.md) for everything else.

## License

MIT
