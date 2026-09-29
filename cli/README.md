# tokenfin

Point **Claude Code** (and Codex CLI, Gemini CLI, OpenCode) at your
[TokenFin](https://tokenfin.curiousdevs.com) dashboard in one command.

TokenFin is an **OpenTelemetry receiver**. These agents already emit token usage over OTLP — this
CLI writes the config that sends it to TokenFin. No proxy sits in your request path, no provider
API keys are held, and no hooks parse your transcripts.

## Quick start

```bash
npx tokenfin@latest setup
```

That signs you in (browser), creates **this device's own keys**, configures every installed agent,
and waits until a real event lands. Always use `@latest` — `npx` otherwise keeps running whatever
version it cached first. The CLI tells you when a newer version exists (checked at most once a day,
1.5 s timeout, never in CI or with `--yes`).

No browser on that machine (SSH, devcontainer, Codespaces)?

```bash
npx tokenfin@latest login --device   # prints a code; approve it at <app>/cli/device from any browser
npx tokenfin@latest setup
```

Got a one-time key link from your admin? The reveal page shows the exact command:
`npx tokenfin@latest setup --key <ingest key> --read-key <read key>`.

## Prompt capture — read this

By default `setup` turns on prompt logging (`OTEL_LOG_USER_PROMPTS=1` for Claude Code,
`log_user_prompt = true` for Codex, `logPrompts: true` for Gemini). **The text of every prompt you
type is sent to TokenFin** with its token counts, and your workspace admins can read it in Prompt
Analytics. It expires after 90 days (owners can delete sooner in Settings → Data), and an admin can
turn it off for the whole workspace — then prompt text is dropped on arrival.

Opt out on this machine (sticky across re-runs and logins):

```bash
npx tokenfin@latest setup --no-prompts   # token counts, model and cost only
npx tokenfin@latest setup --prompts      # turn it back on
```

Model responses, files and your provider API keys are never sent.

## Commands

| Command | What it does |
|---|---|
| `login` | Browser sign-in. Stores this device's **ingest** key (agents' telemetry) and **read** key (status, budget, MCP) in `~/.tokenfin/config.json` (mode 0600) with a stable `device_id`. Logging in again rotates only this device's keys — and re-points any agent config that already uses TokenFin at the new key, so capture never silently breaks. |
| `login --device` | Same, via a short code approved in any signed-in browser (`/cli/device`). |
| `setup` | Writes OTel config for each **installed** agent (others are skipped): `env` in `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), `[otel]` in `~/.codex/config.toml`, `telemetry` in `~/.gemini/settings.json`, `opencode-otel-plugin` in `~/.config/opencode/opencode.json`. Registers the read-only MCP server with the read key. Removes the legacy 0.2 Stop hook (`record-usage.js`) if present. Waits for the first event. |
| `status` | Configured? Events flowing? Prompt capture on or off? |
| `doctor` | Diagnoses silent data loss: config validity, protocol, temporality, **key drift** (settings.json / Codex / Gemini / MCP using a different key than `config.json`), **revoked keys** (checks the ingest key against the receiver and the read key against `/api/v1/connections`), a leftover legacy hook, events in the last 24 h. Exit code 1 on problems. |
| `budget` | Today / month-to-date spend (yours) and the tightest budget with % used. `--json` for raw output. |
| `statusline` | One line for Claude Code's status bar: `TokenFin $1.23 today · $45.67 MTD · 62% of budget`. |
| `remove` | Asks the server to revoke this device's keys, strips every agent's TokenFin config, the legacy hook and our statusLine (backups first), unregisters MCP, deletes `~/.tokenfin`. |

Options:

| Flag | Meaning |
|---|---|
| `-k, --key <tfk_…>` / `TOKENFIN_KEY` | Ingest key; skips browser login. |
| `--read-key <tfk_…>` / `TOKENFIN_READ_KEY` | Read key (defaults to `--key`, which works for legacy read+write keys). |
| `-a, --app-url <url>` / `TOKENFIN_APP_URL` | App origin (self-hosted / local). |
| `--no-prompts`, `--prompts` | Prompt text capture off / on. |
| `--statusline` | Add the budget line to Claude Code's `statusLine` — only if you don't already have one (never overwritten). |
| `--no-wait`, `--no-mcp` | Don't wait for the first event / don't register MCP. |
| `--no-revoke` | `remove` without revoking the keys server-side. |
| `-y, --yes` | Non-interactive (no browser, no update check). |

## Budgets as code

Keep limits and budget alerts in a reviewed file and apply them from CI:

```yaml
# tokenfin-budgets.yaml
version: 1
defaults: { period: monthly, warn: 70, notify: [email, inapp] }
budgets:
  - name: Workspace total
    scope: org
    amount_usd: 5000
  - scope: project
    target: payments-api
    amount_usd: 800
```

```bash
TOKENFIN_API_KEY=<admin-scoped key> npx tokenfin@latest budgets apply ./tokenfin-budgets.yaml --dry-run
```

`--dry-run` prints the plan; without it the CLI asks before applying (`--yes` in CI).
The per-device login keys can't do this — create an admin-scoped key in Dashboard → API Keys.
Exit codes: 0 ok / nothing to do, 1 rejected or failed, 2 usage error.

## Statusline

`setup --statusline` copies a self-contained script to `~/.tokenfin/statusline.js` and sets

```json
"statusLine": { "type": "command", "command": "node \"~/.tokenfin/statusline.js\"", "padding": 0 }
```

It calls `GET /api/v1/me/budget` with your read key and caches the answer for 60 s in
`~/.tokenfin/budget-cache.json`, so it adds no noticeable latency. If you already have a status
line, setup leaves it alone — call `node ~/.tokenfin/statusline.js` from your own script instead.

## Robustness notes

- Every config file is written atomically (temp file + rename) after a `.bak-tokenfin` backup, so a
  crash can't leave a half-written `settings.json`.
- No shell is used to run `claude` / browsers, so headers and URLs with `&` survive on Windows
  (`rundll32 url.dll,FileProtocolHandler` opens the browser). If `claude` is only an npm `.cmd`
  shim on Windows, setup prints the `claude mcp add-json …` command for you to run.
- `claude mcp add-json` takes the server JSON (including the read key) as an argument, so the key is
  briefly visible in the local process list while it runs.
- Honours `CLAUDE_CONFIG_DIR` and `CODEX_HOME`.
- `remove` revokes via `DELETE /api/v1/cli/token`; on servers without that endpoint it tells you to
  revoke the key in Dashboard → API Keys (a key can't delete itself through `/api/v1/keys`).

## Upgrading from 0.2 / 0.3

0.2 installed a Claude Code `Stop` hook running `~/.tokenfin/record-usage.js`; it double-counts
alongside OpenTelemetry. `npx tokenfin@latest setup` removes the hook and the script. 0.3 stored a
single read+write key; it keeps working — run `npx tokenfin@latest login` to switch this device to
separate ingest + read keys.

## OpenCode

`setup` ensures `opencode-otel-plugin` is listed in the `plugin` array of
`~/.config/opencode/opencode.json`. The plugin reads the standard OTel env vars when opencode
starts, so the shell that launches opencode must export them:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<app>/api/otel"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <ingest key>"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative
```

## What's captured

Per turn: model, input/output tokens, cache read/write tokens, and cost — from each agent's native
telemetry (`claude_code.api_request` logs, `codex.turn.token_usage` / `gen_ai.client.token.usage`
metrics, OpenCode `gen_ai` traces/metrics) — plus prompt text unless you opted out. CLI agents
report **notional** cost (what it would cost on the API), shown separately from metered spend.

`OTEL_METRICS_INCLUDE_REPOSITORY=1` (Claude Code v2.1.269+) adds `vcs.repository.*` so cost and
productivity (lines, commits, PRs, edit decisions, active time) split per repository.

Optional cost-allocation labels: any `OTEL_RESOURCE_ATTRIBUTES` key starting with `team.`,
`cost_center`, `cost.center`, `department` or `project` (for example
`OTEL_RESOURCE_ATTRIBUTES=team.name=platform,cost_center=eng-42`) is copied onto each usage row's tags.

## Development

```bash
cd cli && npm test          # node:test — unit + end-to-end against a mock server and a temp HOME
npm pack --dry-run          # what would be published
```

Publishing is manual: GitHub → Actions → **Publish CLI** (needs the `NPM_TOKEN` secret).
