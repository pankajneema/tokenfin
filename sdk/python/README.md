# tokenfin — Python SDK

Track LLM token usage and cost from any Python application.

## Install

```bash
# Sync client (zero dependencies):
pip install tokenfin

# Async client (FastAPI / Django ASGI):
pip install "tokenfin[async]"
```

## Quick start — sync

```python
from tokenfin import TokenFinClient

tf = TokenFinClient(api_key="tf_live_your_key")

# After every LLM call:
response = openai.chat.completions.create(model="gpt-4o", ...)
tf.track(
    model="gpt-4o",
    input_tokens=response.usage.prompt_tokens,
    output_tokens=response.usage.completion_tokens,
    tags={"feature": "chat", "env": "prod"},
)

# Drain queue before exit:
tf.flush()
```

## Quick start — async (FastAPI)

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from tokenfin import AsyncTokenFinClient

tf = AsyncTokenFinClient(api_key="tf_live_your_key")

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await tf.flush()          # drain on shutdown

app = FastAPI(lifespan=lifespan)

@app.post("/chat")
async def chat():
    response = await async_openai.chat.completions.create(...)
    await tf.track(
        model="gpt-4o",
        input_tokens=response.usage.prompt_tokens,
        output_tokens=response.usage.completion_tokens,
    )
```

## Configuration

| Parameter | Default | Description |
|---|---|---|
| `api_key` | required | API key starting with `tf_` |
| `base_url` | `https://app.tokenfin.io` | Override for self-hosted |
| `timeout` | `3.0` | Per-request timeout (seconds) |
| `flush_interval` | `1.0` | Auto-flush interval (seconds). `0` = manual only |
| `batch_size` | `50` | Max events per HTTP request |
| `max_queue_size` | `1000` | Max in-memory queue depth |
| `max_retries` | `3` | Retry attempts on 5xx/429 |
| `debug` | `False` | Log debug output to stderr |

## License

MIT
