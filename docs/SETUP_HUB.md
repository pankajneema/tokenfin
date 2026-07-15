# Connecting tools to TokenFin

> The old hook / proxy / `record_usage` setup was removed in the Connections rebuild — see
> [`MIGRATION.md`](../MIGRATION.md) for why. This is the current model.

TokenFin is an **OpenTelemetry receiver**. Coding agents that ship native OTLP (Claude Code, Codex,
Gemini) push token usage to us directly — no proxy in the request path, no provider keys held, no
transcript parsing.

## Claude Code (available now)

```bash
npx tokenfin login
npx tokenfin setup     # writes an OTel env block to ~/.claude/settings.json, waits for the first event
```

`setup` writes:

```json
"env": {
  "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
  "OTEL_METRICS_EXPORTER": "otlp",
  "OTEL_LOGS_EXPORTER": "otlp",
  "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
  "OTEL_EXPORTER_OTLP_ENDPOINT": "<app>/api/otel",
  "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <key>",
  "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "cumulative"
}
```

Then it **waits for a real event** before reporting success. Verify anytime with `npx tokenfin status`
or diagnose with `npx tokenfin doctor`. Undo with `npx tokenfin remove`.

## What lands

The receiver (`web/src/app/api/otel/v1/*`, lib in `web/src/lib/otlp/*`) turns each
`claude_code.api_request` log event into one `usage_events` row (deduped by `event_id`): model,
input/output tokens, cache read/write tokens, cost. Claude Code cost is **notional** (subscription
usage priced at API rates), shown separately from metered spend.

## Not yet

Codex CLI, Gemini CLI (OTLP, same shape) and the pull connectors (Copilot, Cursor, Anthropic Admin)
land in later milestones. The grouped `/connections` dashboard (five states, per-tool guides)
replaces the interim `/dashboard/setup` surface then.

## Query from chat (read-only MCP)

`setup` also registers the read-only TokenFin MCP server, so you can ask your dashboard questions in
chat (`get_spend`, `get_usage_by_model`, …). It has no write tools. See [`MCP.md`](./MCP.md).
