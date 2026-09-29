# Traces — OpenTelemetry GenAI spans in TokenFin

TokenFin is an OTLP trace backend. Point any OpenTelemetry exporter at it and you get:

- **/dashboard/traces**: recent traces (root span, service, duration, span count, tokens, cost, errors), filterable by service, model, status and time range, with keyset paging.
- **Trace detail**: a waterfall (spans nested by parent, bars scaled to time), a redacted attribute panel, and tokens and cost for each span.
- **Cost analytics**: every leaf LLM span is priced and mirrored into `usage_events` / `usage_agg` as **metered** usage, so it shows up on Overview, Usage, By model and in budgets.

## Endpoint

| | |
|---|---|
| URL | `https://<your-tokenfin-host>/api/otel/v1/traces` |
| Auth | `Authorization: Bearer tfk_…` (or `x-api-key: tfk_…`). An **ingest** key from *Settings → API keys*. |
| Protocols | `http/protobuf` (default for most SDKs) and `http/json`; `Content-Encoding: gzip` is accepted |
| Limits | 8 MB per request (16 MB after gzip) |

Replays are safe. Spans upsert on `(org, trace_id, span_id)` and mirrored usage dedupes on `span:<org>:<trace>:<span>`, so an exporter retry never counts anything twice. Storage errors answer `503` with `Retry-After`, which tells exporters to retry.

Generic environment variables (work for every OTel SDK):

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://<host>/api/otel/v1/traces
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="Authorization=Bearer tfk_..."
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf
export OTEL_SERVICE_NAME=support-bot          # becomes the "service" filter
```

## Setup

### OpenTelemetry SDK: Python (GenAI instrumentation)

```bash
pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http \
            opentelemetry-instrumentation-openai-v2
```

```python
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor

provider = TracerProvider(resource=Resource.create({"service.name": "support-bot"}))
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
    endpoint="https://<host>/api/otel/v1/traces",
    headers={"Authorization": "Bearer tfk_..."},
)))
trace.set_tracer_provider(provider)
OpenAIInstrumentor().instrument()

# Optional: attribute a request to a person / conversation.
with trace.get_tracer(__name__).start_as_current_span("invoke_agent support") as span:
    span.set_attribute("user.email", "dev@acme.com")          # → member attribution
    span.set_attribute("gen_ai.conversation.id", "conv-42")   # → session
    ...  # your LLM calls; child spans inherit user + session from the same export
```

### OpenTelemetry SDK: Node

```bash
npm i @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-proto @opentelemetry/resources
```

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'

new NodeSDK({
  resource: resourceFromAttributes({ 'service.name': 'support-bot' }),
  traceExporter: new OTLPTraceExporter({
    url: 'https://<host>/api/otel/v1/traces',
    headers: { Authorization: 'Bearer tfk_...' },
  }),
  // add a GenAI instrumentation (e.g. OpenLLMetry's, below) or set gen_ai.* attributes yourself
}).start()
```

### OpenLLMetry (Traceloop)

Python:

```python
from traceloop.sdk import Traceloop
Traceloop.init(
    app_name="support-bot",
    api_endpoint="https://<host>/api/otel",          # the SDK appends /v1/traces
    headers={"Authorization": "Bearer tfk_..."},
    # trace_content=False  → don't send prompts at all
)
Traceloop.set_association_properties({"user_id": "dev@acme.com", "session_id": "conv-42"})
```

Node: `traceloop.initialize({ appName: 'support-bot', baseUrl: 'https://<host>/api/otel', headers: { Authorization: 'Bearer tfk_...' } })`.
Or use the env vars `TRACELOOP_BASE_URL=https://<host>/api/otel` and `TRACELOOP_HEADERS="Authorization=Bearer tfk_..."`.

### OpenInference (Arize Phoenix instrumentations)

```bash
pip install openinference-instrumentation-openai opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```

```python
from openinference.instrumentation.openai import OpenAIInstrumentor
# …the same TracerProvider + OTLPSpanExporter as in the OpenTelemetry Python example above…
OpenAIInstrumentor().instrument(tracer_provider=provider)
```

Every OpenInference instrumentor (LangChain, LlamaIndex, Anthropic, Bedrock, …) works the same way. Session and user come from `session.id` and `user.id` (use `openinference.instrumentation.using_attributes(session_id=…, user_id=…)`).

## Attribute mapping

Defined in one versioned file, `web/src/lib/otlp/genai.ts` (`GENAI_MAPPING_VERSION`). When several attributes are present, the first one in the list wins.

| TokenFin field | OpenTelemetry GenAI semconv | OpenLLMetry / legacy | OpenInference |
|---|---|---|---|
| model | `gen_ai.response.model`, `gen_ai.request.model` | `llm.response.model`, `llm.request.model` | `llm.model_name`, `embedding.model_name` |
| provider | `gen_ai.provider.name`, `gen_ai.system` | `gen_ai.system`, `llm.vendor` | `llm.provider`, `llm.system` |
| operation | `gen_ai.operation.name` | `llm.request.type`, `traceloop.span.kind` | `openinference.span.kind` |
| input tokens | `gen_ai.usage.input_tokens` | `gen_ai.usage.prompt_tokens`, `llm.usage.prompt_tokens` | `llm.token_count.prompt` |
| output tokens | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.usage.completion_tokens` | `llm.token_count.completion` |
| total (fallback only) | `gen_ai.usage.total_tokens` | `llm.usage.total_tokens` | `llm.token_count.total` |
| cache read | `gen_ai.usage.cache_read.input_tokens` | `gen_ai.usage.cache_read_input_tokens`, `gen_ai.usage.cache_read_tokens` | `llm.token_count.prompt_details.cache_read` |
| cache write | `gen_ai.usage.cache_creation.input_tokens` | `gen_ai.usage.cache_creation_input_tokens`, `gen_ai.usage.cache_write_tokens` | `llm.token_count.prompt_details.cache_write` |
| reasoning | `gen_ai.usage.reasoning.output_tokens` | `gen_ai.usage.reasoning_tokens` | `llm.token_count.completion_details.reasoning` |
| session | `gen_ai.conversation.id` | `traceloop.association.properties.session_id` / `conversation_id` | `session.id` |
| user | `user.email`, `enduser.id`, `user.id` | `traceloop.association.properties.user_id` / `user_email` | `user.id` |
| status | span `status.code` = ERROR, or `error.type`; the message comes from `status.message` or the `exception` event | | |
| service | resource `service.name` | | |

**Token normalization.** TokenFin stores *uncached* input, with cache read and cache write in separate columns, and total = input + output + cache read + cache write. The semconv and OpenInference report input tokens *including* cached tokens, so the cached tokens are subtracted. When the cache tokens are larger than the reported input, the instrumentation copied Anthropic's raw usage (where input excludes cache), and the input is used as is. If a span reports only a total, that total is priced as input.

**Pricing.** An org price override (*Models → custom prices*, longest prefix) is used when one matches. Otherwise TokenFin uses the list price from `lib/mcp/pricing.ts`. Cache tokens are priced at the cache rates.

**Content and privacy.** Prompt and completion content attributes are the following:

- `gen_ai.input.messages` / `gen_ai.output.messages`
- `gen_ai.system_instructions`
- `gen_ai.prompt*` / `gen_ai.completion*`
- `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result`
- `input.value` / `output.value`
- `llm.input_messages.*` / `llm.output_messages.*`
- `traceloop.entity.input` / `traceloop.entity.output`
- `retrieval.documents.*`
- `exception.stacktrace`

TokenFin **drops** them when the workspace has prompt capture turned off (*Settings → Workspace*, or `CAPTURE_PROMPTS=0` on the server). When capture is on, it keeps them after redaction. Every string attribute is passed through `lib/redact.ts` (API keys, JWTs, emails, card numbers) and capped at 4 KB, with at most 256 attributes per span.

## What counts as usage

- **Leaf spans only.** A span whose child also carries token usage (an agent, chain or workflow summing its calls) is an aggregate. It is stored and shown with a Σ marker, but it is never mirrored and never added to the trace total. The check runs against every stored span of the trace. OTel SDKs export a span when it *ends*, so children arrive before or together with their parent.
- **Spans from CLI agents are stored but not mirrored.** This covers Claude Code, Codex, Gemini CLI and OpenCode, matched by resource `service.name`. Their OTLP logs and metrics already own that usage.
- Mirrored rows use `source = 'otlp'` and `cost_basis = 'metered'` (a real API call). `correlation_id = trace:<id>` makes one trace count as one prompt. `session_id` comes from the conversation id, and the day bucket follows the workspace time zone.
- **User attribution.** A personal ingest key attributes spans to its owner. With a shared key, TokenFin matches the span's email (`user.email`, or an email-shaped `enduser.id` / `user.id`) to a workspace member. A span without user or session attributes inherits them from the nearest ancestor *in the same export*.

## Who sees what

- **Owners and admins** see every trace.
- **Members and viewers** see:
  - traces attributed to them;
  - **unattributed** traces. Most app traces come from a backend service with no end user, and hiding those would leave the page empty for everyone except admins.

Members and viewers never see traces attributed to another member. On a trace that isn't theirs, prompt and completion content is stripped from the attribute panel. This follows the same `prompts:view_all` rule as Prompts and Sessions.

## Schema (migration 018)

- `spans` gains the following columns:
  - `status_code`, `status_message`
  - `span_kind`, `service_name`, `operation`, `provider`
  - `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`
  - `duration_ms`
  - `user_id`, `user_email`, `session_id`
- `traces` gains the following columns:
  - `service_name`, `root_span_id`
  - `duration_ms`, `error_count`
  - `models[]`, `user_id`, `session_id`
  - `input_tokens`, `output_tokens`
  - plus an index for `(org_id, start_time DESC, trace_id DESC)` keyset paging
- New RPCs, service role only:
  - `refresh_traces` recomputes the rollup for the touched traces in SQL.
  - `trace_usage_parents` returns the aggregate spans.
  - `trace_filter_options` returns the service and model dropdowns.

## Known limits

- If a parent span that carries usage is exported **before** its token-bearing children, which OTel SDKs don't normally do, both are mirrored. The trace total is still correct because `refresh_traces` recomputes it.
- User and session inheritance only looks at spans in the same export. Children exported in an earlier batch than their root stay unattributed.
- The detail view renders the first 5,000 spans of a trace.
