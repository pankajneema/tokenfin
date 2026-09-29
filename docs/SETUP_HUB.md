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
npx tokenfin@latest setup     # signs in if needed, configures every installed agent, waits for the first real event
```

Over SSH / in a devcontainer (no browser): `npx tokenfin@latest login --device`, approve the code at
`<app>/cli/device` from any signed-in browser, then `npx tokenfin@latest setup`.

`setup` detects Claude Code, Codex CLI, Gemini CLI, and OpenCode, **skips the ones that aren't
installed**, and writes each one's own config format — below. It only reports success once a
**real event** actually lands, not just when config is written. Verify anytime with
`npx tokenfin@latest status`, diagnose with `npx tokenfin@latest doctor` (including revoked keys and
key drift), undo with `npx tokenfin@latest remove`. Always use `@latest`: `npx` otherwise re-runs
whatever version it cached first; the CLI prints a notice when a newer one exists.

### Keys: per device, ingest vs read

`login` (browser or `--device`) sends the machine's hostname and a stable `device_id` (generated once,
stored in `~/.tokenfin/config.json`). The server mints **two keys for that device**:

| Key | Scope | Used for |
|---|---|---|
| ingest | `ingest` | OTLP config of every agent (Claude Code env, Codex, Gemini) |
| read | `read` | `status` / `doctor` / `budget` / statusline, and the MCP registration |

Logging in again on the same device rotates only that device's keys, and **re-points every agent
config that already uses TokenFin at the new key** — capture never silently breaks after a rotation.
Viewers get a read key only (they can't send usage). Keys from 0.3 (one read+write key) still work.
`remove` revokes the device's keys (`DELETE /api/v1/cli/token`) and deletes `~/.tokenfin`.

### Prompt text

By default setup enables prompt logging (Claude Code `OTEL_LOG_USER_PROMPTS=1`, Codex
`log_user_prompt = true`, Gemini `logPrompts: true`), so **the text of each prompt is sent** and
shown in Prompt Analytics next to its cost. It prints a notice saying so. Opt out per machine with
`npx tokenfin@latest setup --no-prompts` (sticky; `--prompts` re-enables). Workspace admins can turn
prompt capture off for everyone (organizations.capture_prompts — Settings → Workspace); managed
settings downloads follow that policy. Prompt text expires after 90 days (Settings → Data).

### Statusline

`npx tokenfin@latest setup --statusline` adds `TokenFin $x today · $y MTD · 62% of budget` to Claude
Code's status bar (from `GET /api/v1/me/budget`, cached 60 s). It never replaces an existing
`statusLine`. `npx tokenfin@latest budget` prints the same data in full.

### Rolling out to a team

See [`ROLLOUT.md`](./ROLLOUT.md) — managed-settings.json via Jamf / Intune / Ansible, and the
per-member rollout tracker on `/dashboard/setup`.

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
  "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "cumulative",
  "OTEL_LOG_USER_PROMPTS": "1",
  "OTEL_METRICS_INCLUDE_REPOSITORY": "1"
}
```

(`OTEL_LOG_USER_PROMPTS` is omitted with `--no-prompts`. The file is `$CLAUDE_CONFIG_DIR/settings.json`
when that variable is set. Writes are atomic with a `.bak-tokenfin` backup. A legacy 0.2 `Stop` hook
running `~/.tokenfin/record-usage.js` is removed, along with the script.)

The receiver (`web/src/app/api/otel/v1/*`, lib in `web/src/lib/otlp/*`) turns each
`claude_code.api_request` log event into one `usage_events` row (deduped by `event_id`): model,
input/output tokens, cache read/write tokens, cost. Verified with a real `claude -p` call
(2026-08-10) — event landed within seconds, dashboard reflected it correctly.

## Codex CLI — fully verified (was completely broken until 2026-08-10)

Writes an `[otel]` block to `~/.codex/config.toml` (user-level only — Codex ignores project-local
config for this; `$CODEX_HOME` is honoured). Exactly this, between `# >>> tokenfin (managed)` markers:

```toml
[otel]
environment = "prod"
exporter = "none"
log_user_prompt = true            # false with --no-prompts

[otel.metrics_exporter.otlp-http]
endpoint = "<app>/api/otel/v1/metrics"
protocol = "json"

[otel.metrics_exporter.otlp-http.headers]
Authorization = "Bearer <ingest key>"
```

There is deliberately **no** `metrics_exporter = "otlp-http"` line: the table header selects the
exporter, and a string of the same name next to it is invalid TOML — Codex refuses to start. The
Connections page renders the identical snippet (a parity test in
`web/src/app/(dashboard)/dashboard/setup/_snippets.test.ts` compares it with the CLI byte for byte). A real `codex exec` session on 2026-08-10 surfaced three stacked bugs, all now
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
