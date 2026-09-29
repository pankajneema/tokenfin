# TokenFin SDKs

Track LLM token usage and cost from your own code and see it in TokenFin
(dollar-first dashboards, per-project / per-user attribution, budgets).

| Language   | Package          | Source            |
|------------|------------------|-------------------|
| TypeScript | `@tokenfin/sdk`  | [`sdk/src`](./src) |
| Python     | `tokenfin`       | [`sdk/python`](./python) |

Both SDKs have the same features:

- **Auto-instrumentation.** `wrapAnthropic` / `wrap_anthropic` and `wrapOpenAI` / `wrap_openai`
  record the model, input, output and cache tokens, and latency for every call, including streaming.
- **Batching.** Events go to `POST /api/v1/ingest/batch`. On older servers without that
  endpoint, the SDK falls back to `POST /api/v1/ingest`.
- **Safety.** `track()` never throws or blocks. The queue has a fixed size, retries honour
  `Retry-After`, and a circuit breaker stops sending while TokenFin is down.
- **Prompt capture is off by default.** Nothing about your prompts leaves your process unless
  you turn on `capturePrompts` / `capture_prompts`.

Get an API key from **Dashboard → API Keys**. It starts with `tfk_` and needs the `ingest` or `write` scope.

---

## TypeScript

```bash
npm install @tokenfin/sdk
# plus whichever LLM SDK you use (optional peer deps):
npm install @anthropic-ai/sdk   # and/or: npm install openai
```

### Auto-instrument Anthropic

```ts
import Anthropic from '@anthropic-ai/sdk'
import { TokenFinClient, wrapAnthropic } from '@tokenfin/sdk'

const tf = new TokenFinClient({ apiKey: process.env.TOKENFIN_API_KEY! })
const anthropic = wrapAnthropic(new Anthropic(), tf, {
  userEmail: 'dev@acme.com',          // attribution (optional)
  tags: { feature: 'support-bot' },
})

const msg = await anthropic.messages.create({
  model: 'claude-sonnet-4-6', max_tokens: 512,
  messages: [{ role: 'user', content: 'Hello' }],
})

// Streaming works too, including messages.stream():
const stream = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 512, stream: true, messages })
for await (const event of stream) { /* unchanged */ }
```

### Auto-instrument OpenAI

```ts
import OpenAI from 'openai'
import { TokenFinClient, wrapOpenAI } from '@tokenfin/sdk'

const tf = new TokenFinClient({ apiKey: process.env.TOKENFIN_API_KEY! })
const openai = wrapOpenAI(new OpenAI(), tf)

await openai.chat.completions.create({ model: 'gpt-4o', messages })
await openai.responses.create({ model: 'gpt-5', input: 'Hi' })

// Streaming: stream_options.include_usage is switched on for you, and the extra
// usage-only chunk is hidden, so `chunk.choices[0]` code keeps working.
const s = await openai.chat.completions.create({ model: 'gpt-4o', stream: true, messages })
for await (const chunk of s) process.stdout.write(chunk.choices[0]?.delta?.content ?? '')
```

For OpenAI, TokenFin records `input_tokens = prompt_tokens − cached_tokens` and
`cache_read_tokens = cached_tokens`. Cached tokens are billed at the lower cache rate.

### Manual tracking

```ts
tf.track({
  model: 'claude-sonnet-4-6',
  inputTokens: 1200, outputTokens: 380,
  cacheReadTokens: 9000, cacheWriteTokens: 400,
  projectId: '…uuid…', userEmail: 'dev@acme.com', sessionId: 'run-42',
  latencyMs: 812, timestamp: new Date(),
  idempotencyKey: 'req_123',          // optional; a UUID is generated otherwise
  tags: { feature: 'chat' }, metadata: { customer: 'acme' },
})
```

### Shutdown

The SDK flushes on Node's `beforeExit`. It **does not** install SIGINT/SIGTERM handlers, so
it never changes how your process exits. For graceful shutdown, call:

```ts
process.on('SIGTERM', async () => { await tf.shutdown(); process.exit(0) })
// serverless: await tf.flush() before returning the response
```

`flush()` and `shutdown()` resolve to `{ sent, dropped }`. `tf.stats()` returns lifetime
`{ sent, dropped, queued }`.

### Options

| Option | Default | |
|---|---|---|
| `apiKey` | required | `tfk_…` |
| `baseUrl` | `https://tokenfin.curiousdevs.com` | self-hosted URL |
| `batchSize` | `100` | events per request (server max 500) |
| `flushIntervalMs` | `1000` | `0` = manual flush only |
| `maxQueueSize` | `10000` | when full, the oldest event is dropped and counted |
| `maxRetries` | `3` | for 408 / 429 / 5xx / network errors |
| `maxRetryAfterMs` | `30000` | cap on honouring `Retry-After` |
| `timeoutMs` | `5000` | per request |
| `flushOnExit` | `true` | flush on `beforeExit` |
| `debug` | `false` | `console.debug` logging |

Wrapper options: `capturePrompts` (default `false`), `maxPromptChars`, `projectId`,
`userEmail`, `sessionId`, `tags`, `metadata`, `source`.

---

## Python

```bash
pip install tokenfin                 # zero dependencies
pip install "tokenfin[async]"        # aiohttp transport for AsyncTokenFinClient (optional)
```

### Auto-instrument

```python
from anthropic import Anthropic
from openai import OpenAI
from tokenfin import TokenFinClient, wrap_anthropic, wrap_openai

tf = TokenFinClient(api_key="tfk_...")
anthropic = wrap_anthropic(Anthropic(), tf, user_email="dev@acme.com")
openai = wrap_openai(OpenAI(), tf)

anthropic.messages.create(model="claude-sonnet-4-6", max_tokens=512,
                          messages=[{"role": "user", "content": "Hello"}])

with anthropic.messages.stream(model="claude-sonnet-4-6", max_tokens=512, messages=msgs) as s:
    for text in s.text_stream:
        print(text, end="")

for chunk in openai.chat.completions.create(model="gpt-4o", stream=True, messages=msgs):
    print(chunk.choices[0].delta.content or "", end="")
```

`AsyncAnthropic` and `AsyncOpenAI` work the same way. Streams keep their exact type.

### Manual tracking

```python
tf.track("gpt-4o", 800, 120,
         cache_read_tokens=400, project_id="…uuid…", user_email="dev@acme.com",
         session_id="run-42", latency_ms=640, tags={"feature": "chat"})
tf.shutdown()                      # or: with TokenFinClient(...) as tf: ...
```

### Async

```python
from tokenfin import AsyncTokenFinClient

tf = AsyncTokenFinClient(api_key="tfk_...")
tf.track("gpt-4o", 800, 120)        # non-blocking; `await tf.track(...)` also works
await tf.shutdown()                 # e.g. in your FastAPI lifespan
```

The Python config uses the same options in snake_case (`base_url`, `batch_size`, `flush_interval`
in seconds, `max_queue_size`, `max_retries`, `max_retry_after`, `timeout`, `flush_on_exit`,
`debug`). It drains the queue with `atexit` and installs no signal handlers.

---

## Delivery semantics

| Server response | What the SDK does |
|---|---|
| 2xx (including idempotent duplicates) | counted as `sent` |
| 408, 429, 5xx, network error | retried with backoff; `Retry-After` is honoured |
| other 4xx (bad key, invalid event) | counted as `dropped`, **not** retried |
| batch endpoint 404 / 405 | falls back to the single endpoint for the rest of the process |

Every event carries an idempotency key, so retries never double-count.

## Development

```bash
cd sdk && npm test                           # node:test + tsx, local mock server
cd sdk/python && python -m pytest            # pytest, local mock server
```

Releases are published by the manual **Publish SDKs** GitHub workflow
(`.github/workflows/publish-sdk.yml`).
