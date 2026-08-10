# TokenFin

LLM cost-attribution / FinOps platform. Tracks token usage and spend across
projects, models, and team members — for CLI coding agents (Claude Code,
Codex CLI, Gemini CLI) via their native OpenTelemetry export, and for your
own backend via a direct ingest API/SDK.

No proxy in the model request path. TokenFin never holds your provider API
keys. See [`MIGRATION.md`](./MIGRATION.md) for why that's a hard rule, not a
missing feature.

## Docs

Start here if you're new to the codebase — read in this order:

| Doc | Covers |
|---|---|
| [`docs/architecture.md`](./docs/architecture.md) | System map, monorepo layout, tech stack, auth flow |
| [`docs/data-flow.md`](./docs/data-flow.md) | How usage is captured, the metered-vs-notional split, OTLP metric derivation |
| [`docs/alerts-and-limits.md`](./docs/alerts-and-limits.md) | What limits can actually enforce vs. just warn about, how alert rules fire |
| [`docs/SETUP_HUB.md`](./docs/SETUP_HUB.md) | Per-agent connection details (Claude Code / Codex / Gemini) |
| [`docs/MCP.md`](./docs/MCP.md) | The read-only MCP server — query your dashboard from chat |
| [`CLAUDE.md`](./CLAUDE.md) | Quick-reference schema table + page→data-source map (for AI coding sessions, but useful for anyone) |
| [`MIGRATION.md`](./MIGRATION.md) | What was deliberately removed (proxy, hooks, write-capable MCP) and why — read before reintroducing any of it |

## Quick start (customer-facing)

```bash
npx tokenfin login    # browser sign-in, stores an ingest key in ~/.tokenfin/config.json
npx tokenfin setup    # configures every installed agent, waits for the first real event
```

That's the whole setup for Claude Code, Codex CLI, and Gemini CLI. See the
[`cli/README.md`](./cli/README.md) for the full command reference
(`status`, `doctor`, `remove`).

## Local development

```bash
git clone <this repo> && cd tokenfin
make install    # cd web && npm install
make dev        # cd web && npm run dev — http://localhost:3001
```

Copy `web/.env.local.example` → `web/.env.local` and fill in your Supabase
project's URL + anon key + service-role key at minimum. Everything else
(Resend, CRON_SECRET, eval judge, Go ingest URL) is optional — the app runs
without them, with that specific feature disabled.

Other `make` targets: `make typecheck`, `make lint`, `make go-build` (Go
backend, optional — see [`docs/data-flow.md`](./docs/data-flow.md#path-2--sdk--direct-ingest-post-apiv1ingest)
for when you actually need it), `make sdk-build`, `make db-migrate` (lists
migration files — apply via the Supabase SQL editor or CLI in order).

## Monorepo

```
web/       Next.js 14 App Router — UI + all API routes (the only service most deploys need)
backend/   Go — optional high-throughput scaling layer for the SDK ingest path only
cli/       npm package `tokenfin` — the customer-facing setup tool
sdk/       Client SDKs (TS + Python) for instrumenting your own backend
db/        Postgres schema + migrations
docs/      You are here
```

Full breakdown in [`docs/architecture.md`](./docs/architecture.md#monorepo-layout).

## Status

Verified against real, running agents as of 2026-08-10 — not just read from
the code:

- ✅ Claude Code CLI — full capture pipeline confirmed end-to-end
- ✅ Codex CLI — confirmed end-to-end after fixing three real bugs found during testing (invalid config TOML, unread histogram metrics, double-counted cache tokens) — see [`docs/data-flow.md`](./docs/data-flow.md#deriving-events-from-metrics-codex-gemini)
- 🟡 Gemini CLI — config matches official docs, not yet run against a real account
- 🟡 Claude Code / Codex IDE extensions (VS Code, JetBrains) — architecturally reasoned to work (same underlying CLI binary, same config file), not empirically tested
- ✅ Alerts (rule creation → cron evaluation → delivery) — confirmed with a real fired alert
- ✅ Limits — spend tracking and SDK-side enforcement (`403`/`429`) both confirmed for real; CLI-agent block/throttle is architecturally impossible by design, not a bug (see [`docs/alerts-and-limits.md`](./docs/alerts-and-limits.md))
- ✅ Integrations (Slack connect) — was completely broken (wrong DB column, every connect attempt 500'd), fixed and confirmed
