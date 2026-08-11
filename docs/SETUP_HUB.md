# Connecting tools to TokenFin

> The old hook / proxy / `record_usage` setup was removed in the Connections rebuild — see
> [`MIGRATION.md`](../MIGRATION.md) for why. This is the current model. For the deeper "why does
> this work this way" (OTLP metric shapes, metered vs. notional, the bugs we found testing this
> for real), see [`data-flow.md`](./data-flow.md).

TokenFin is an **OpenTelemetry receiver**. Coding agents that ship native OTLP (Claude Code, Codex,
Gemini, OpenCode) push token usage to us directly — no proxy in the request path, no provider keys
held, no transcript parsing.

## One command, all four agents

```bash
npx tokenfin login
npx tokenfin setup     # configures every installed agent, waits for the first real event
```

`setup` detects Claude Code, Codex CLI, Gemini CLI, and OpenCode and writes each one's own config
format — below. It only reports success once a **real event** actually lands, not just when config is
written. Verify anytime with `npx tokenfin status` or diagnose with `npx tokenfin doctor`. Undo
with `npx tokenfin remove`.

## Claude Code — fully verified

Writes to `~/.claude/settings.json`:

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

The receiver (`web/src/app/api/otel/v1/*`, lib in `web/src/lib/otlp/*`) turns each
`claude_code.api_request` log event into one `usage_events` row (deduped by `event_id`): model,
input/output tokens, cache read/write tokens, cost. Verified with a real `claude -p` call
(2026-08-10) — event landed within seconds, dashboard reflected it correctly.

## Codex CLI — fully verified (was completely broken until 2026-08-10)

Writes an `[otel]` block to `~/.codex/config.toml` (user-level only — Codex ignores project-local
config for this). A real `codex exec` session on 2026-08-10 surfaced three stacked bugs, all now
fixed:

1. The written TOML was invalid and made Codex refuse to start at all (a flat
   `metrics_exporter = "otlp-http"` string conflicted with the
   `[otel.metrics_exporter.otlp-http]` table underneath it).
2. Codex reports tokens as an OTLP **histogram**, not a counter — the derivation code only read
   counter-shaped metrics, so even a working config produced zero captured events.
3. Cost was double-counting cached tokens (`cached_input` is a *subset* of `input`, not additive —
   confirmed by exact arithmetic on real data: `input + output == total`).

See [`data-flow.md`](./data-flow.md#deriving-events-from-metrics-codex-gemini) for the full
writeup. `codex exec` **does** emit usable metrics — a doc comment claiming otherwise
(`openai/codex#12913`) is gone; we have a correctly-priced captured row to prove it.

## Gemini CLI — config verified against docs, not yet end-to-end tested with a real account

Writes a `telemetry` block to `~/.gemini/settings.json`. Field names were checked against Gemini
CLI's own telemetry docs and match. Given Codex's config *also* looked right until it was tested
against a real session, treat this as "should work" rather than "confirmed" until someone runs it
end-to-end with real Gemini credentials.

## OpenCode — receiver verified, end-to-end pending real session

Writes the `opencode-otel-plugin` into the `plugin` array of
`~/.config/opencode/opencode.json` (`setup`), and the receiver attributes the plugin's
`gen_ai` traces/metrics to the `opencode` source (resource `service.name=opencode`). The plugin
reads standard OTel env vars at process init, so the shell that launches opencode must export them
(the same block `setup` documents for Claude Code — see `cli/README.md`):

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<app>/api/otel"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <key>"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative
```

The plugin ships traces+metrics only (no logs), and its traces are **protobuf**, which the receiver
decodes via the same `readOtlp` path as the other agents. Verified: live protobuf/JSON payloads
accepted by `/v1/traces` and `/v1/metrics`, source attribution correct (service.name discriminates
OpenCode from Gemini — both emit `gen_ai.client.token.usage`). Pending: an end-to-end run of
`opencode` with the plugin to confirm the exact metric/span shapes on a real session.

## Not yet

The pull connectors (Copilot, Cursor, Anthropic Admin) land in later milestones. The grouped
`/connections` dashboard (five states, per-tool guides) replaces the interim `/dashboard/setup`
surface then. IDE extensions (Claude Code for VS Code/JetBrains, Codex for VS Code) are shown as
connected via the same `sourceId` as their CLI counterpart — reasoned to be correct because both
extensions wrap the same CLI binary reading the same user-level config file, but not empirically
tested (no IDE available in the environment this was verified from).

## Query from chat (read-only MCP)

`setup` also registers the read-only TokenFin MCP server, so you can ask your dashboard questions in
chat (`get_spend`, `get_usage_by_model`, …). It has no write tools. See [`MCP.md`](./MCP.md).
