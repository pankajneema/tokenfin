# tokenfin

Point **Claude Code** at your [TokenFin](https://tokenfin.curiousdevs.com) dashboard in one command.

TokenFin is an **OpenTelemetry receiver**. Claude Code (and Codex, Gemini) already emit token usage
over OTLP — this CLI just writes the config that sends it to TokenFin. No proxy sits in your request
path, no provider API keys are held, and no hooks parse your transcripts.

## Quick start

```bash
npx tokenfin login    # browser sign-in, stores an ingest key in ~/.tokenfin/config.json
npx tokenfin setup    # writes the OTel env block to ~/.claude/settings.json, waits for the first event
```

`setup` doesn't exit on "config written" — it waits until a real event lands, then reports the model
it saw. Open Claude Code and run a turn.

## Commands

| Command | What it does |
|---|---|
| `login` | Browser OAuth; stores an ingest key. |
| `setup` | Writes `env` (telemetry on, OTLP → `<app>/api/otel`, `http/protobuf`, `cumulative`) into `~/.claude/settings.json`, then waits for the first event. Also registers the read-only MCP server so you can query your dashboard from chat. |
| `status` | Whether Claude Code is configured and events are flowing. |
| `doctor` | Diagnoses silent data loss: config present/valid, protocol/temporality correct, events in the last 24h. |
| `remove` | Full clean uninstall — strips the env block (backup first) and unregisters the MCP server. |

Options: `--key <tfk_…>` / `TOKENFIN_KEY`, `--app-url <url>` / `TOKENFIN_APP_URL`, `--yes`.

## What's captured

Per turn: model, input/output tokens, cache read/write tokens, and cost — from Claude Code's
`claude_code.api_request` telemetry. Claude Code on Pro/Max reports **notional** cost (what it would
cost on the API), shown separately from metered spend, never summed into it.

## Privacy

The ingest key authenticates OTLP pushes to TokenFin; it is never sent to your model provider. Prompts
are not captured by this setup.
