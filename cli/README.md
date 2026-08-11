# tokenfin

Point **Claude Code** (and Codex CLI, Gemini CLI, OpenCode) at your
[TokenFin](https://tokenfin.curiousdevs.com) dashboard in one command.

TokenFin is an **OpenTelemetry receiver**. Claude Code (and Codex, Gemini, OpenCode) already emit
token usage over OTLP — this CLI just writes the config that sends it to TokenFin. No proxy sits in
your request path, no provider API keys are held, and no hooks parse your transcripts.

## Quick start

```bash
npx tokenfin login    # browser sign-in, stores an ingest key in ~/.tokenfin/config.json
npx tokenfin setup    # writes telemetry config for every installed agent, waits for the first event
```

`setup` doesn't exit on "config written" — it waits until a real event lands, then reports the model
it saw. Open Claude Code and run a turn.

## Commands

| Command | What it does |
|---|---|
| `login` | Browser OAuth; stores an ingest key. |
| `setup` | Writes OTel config into every installed agent's own file — `env` in `~/.claude/settings.json`, `[otel]` in `~/.codex/config.toml`, `telemetry` in `~/.gemini/settings.json`, the `opencode-otel-plugin` into `~/.config/opencode/opencode.json` — then waits for the first event. Also registers the read-only MCP server so you can query your dashboard from chat. |
| `status` | Whether configured agents are pushing and events are flowing. |
| `doctor` | Diagnoses silent data loss: config present/valid, protocol/temporality correct, events in the last 24h. |
| `remove` | Full clean uninstall — strips every agent's TokenFin config (backup first) and unregisters the MCP server. |

Options: `--key <tfk_…>` / `TOKENFIN_KEY`, `--app-url <url>` / `TOKENFIN_APP_URL`, `--yes`.

## OpenCode

`setup` ensures `opencode-otel-plugin` is listed in the `plugin` array of
`~/.config/opencode/opencode.json`. The plugin reads the standard OTel env vars when opencode
starts, so the shell that launches opencode must export them:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<app>/api/otel"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <key>"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative
```

OpenCode pushes per-turn tokens as `gen_ai` traces/metrics; the receiver attributes them to the
`opencode` source. Prereqs: the plugin's npm package resolvable by opencode (`opencode-otel-plugin`).

## What's captured

Per turn: model, input/output tokens, cache read/write tokens, and cost — from each agent's native
telemetry (`claude_code.api_request` logs, `codex.turn.token_usage` / `gen_ai.client.token.usage`
metrics, OpenCode `gen_ai` traces/metrics). CLI agents report **notional** cost (what it would cost on
the API), shown separately from metered spend, never summed into it.

## Privacy

The ingest key authenticates OTLP pushes to TokenFin; it is never sent to your model provider. Prompts
are not captured by this setup.
