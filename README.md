<div align="center">

# TokenFin

**Open-source LLM cost attribution and FinOps for AI coding agents and your own backend.**

See what Claude Code, Codex CLI, Gemini CLI, OpenCode and your own services spend on tokens, broken down by project, model, team and person. TokenFin never sits in the model request path and never holds provider API keys.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

</div>

---

## Table of contents

- [Overview](#overview)
- [Key features](#key-features)
- [How it works](#how-it-works)
- [Architecture](#architecture)
  - [System context](#system-context)
  - [Ingest data flow](#ingest-data-flow-claude-code)
  - [Data model](#data-model)
- [Tech stack](#tech-stack)
- [Design](#design)
  - [Frontend](#frontend)
  - [Backend](#backend)
  - [Database](#database)
- [Project structure](#project-structure)
- [Quick start (customers)](#quick-start-customers)
- [Local development](#local-development)
- [Docker](#docker)
- [Deployment](#deployment)
- [Testing](#testing)
- [Security](#security)
- [API overview](#api-overview)
- [SDK usage](#sdk-usage)
- [Screenshots](#screenshots)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

AI coding agents and LLM-backed services create spend that is hard to see and even harder to attribute. The provider invoice tells you *how much*. It does not tell you *which project, which model, which engineer or which prompt*.

TokenFin answers those questions:

- **CLI coding agents** (Claude Code, Codex CLI, Gemini CLI, OpenCode) already emit OpenTelemetry. TokenFin is an **OTLP/HTTP receiver**: one command points each agent's native telemetry at your dashboard.
- **Your own backend** reports usage through the TypeScript or Python SDK, or a plain `POST /api/v1/ingest`.
- A **read-only MCP server** lets you ask your dashboard questions from chat ("what did we spend on Opus this week?").

**TokenFin is free and unlimited.** There are no plans, no billing and no usage caps. Spend limits in the product are budgets *you* set for your own org, not limits we impose. A self-hosted deployment can optionally turn on a per-key abuse guard (`TOKENFIN_ENFORCE_RATE_LIMITS=1`); it is off by default.

**No proxy, ever.** TokenFin is not in the model request path, so our downtime can never stop your agent, and we never need your provider API keys. [`MIGRATION.md`](./MIGRATION.md) explains why this is a hard rule and not a missing feature.

## Key features

| Area | What you get |
|---|---|
| **One-command capture** | `npx tokenfin@latest setup` signs you in, mints this device's own keys, configures every installed agent (Claude Code, Codex CLI, Gemini CLI, OpenCode) and only reports success once a real event arrives. `login --device` covers SSH / devcontainers. |
| **Team rollout** | Download a Claude Code `managed-settings.json` for Jamf / Intune / Ansible from the Connections page, and watch a per-member rollout tracker ([`docs/ROLLOUT.md`](./docs/ROLLOUT.md)). |
| **Cost attribution** | Spend and tokens by org, project, model, team, member, tool and account. Includes input, output, cache-read, cache-write and reasoning tokens. |
| **Honest cost accounting** | Every event carries a `cost_basis`. `metered` is a real bill (SDK path). `notional` is subscription usage priced at API rates (CLI agents). Notional dollars are never added into a "real bill" total. One pricing table covers Anthropic, OpenAI (GPT-5, GPT-4.1, o-series) and Gemini 2.5 / 3.x, including cache-read and cache-write pricing. |
| **Prompt analytics** | Prompt text capture is **on by default** — `setup` says so when it runs. Prompts are joined to their token counts and cost by prompt id, so you can see which prompts are expensive. Prompt text expires after 90 days. Opt out per machine with `setup --no-prompts`, per workspace with the org prompt-capture setting, or per deployment with `CAPTURE_PROMPTS=0`. |
| **Data controls** | **Dashboard → Settings → Data** (owner-only): delete monitoring data (usage events, daily aggregates, captured prompts, traces) older than 7, 30 or 90 days, or delete all of it. Set automatic retention (keep the last *N* days). A daily cron (`/api/v1/cron/retention`) purges expired data. |
| **Limits and alerts** | Budgets with warn / throttle / block thresholds. Alert rules are evaluated on a schedule and delivered by email (Resend), Slack or webhook. Throttle and block apply to the SDK path only (see [`docs/alerts-and-limits.md`](./docs/alerts-and-limits.md)). |
| **Team management** | Orgs, projects, teams, roles (owner / admin / member / viewer), invites and bulk provisioning with single-use key-reveal links. |
| **MCP server (read key)** | `get_spend`, `get_usage_by_model`, `get_daily_costs`, `get_budget_status`, `list_projects`, `savings_stats`, `get_eval_summary`, plus `compress`/`retrieve` (stores the original for reversal) and `evaluate` (calls your configured judge model). Never captures usage. See [`docs/MCP.md`](./docs/MCP.md). |
| **Budget in your status bar** | `npx tokenfin@latest budget` and an optional Claude Code statusline: `TokenFin $1.23 today · $45.67 MTD · 62% of budget`. |
| **SDKs** | `@tokenfin/sdk` (TypeScript) and `tokenfin` (Python, sync and async): batched, non-blocking, retry with backoff, circuit breaker. |

## How it works

1. **Connect.** `npx tokenfin@latest setup` (or `login`) opens a browser, you approve, and this device gets its own **ingest** key (for telemetry) and **read** key (for status, budget and MCP), saved to `~/.tokenfin/config.json` (mode `0600`) with a stable device id. Re-login rotates only this device's keys and re-points existing agent configs.
2. **Configure.** `setup` writes each installed agent's own telemetry config: an `env` block in `~/.claude/settings.json`, `[otel]` in `~/.codex/config.toml`, `telemetry` in `~/.gemini/settings.json`, and the `opencode-otel-plugin` in `~/.config/opencode/opencode.json` (atomic writes, backups first). Teams can instead push a managed-settings.json via MDM.
3. **Capture.** Agents push OTLP (JSON or protobuf) to `/api/otel/v1/{logs,metrics,traces}`. The receiver authenticates the key by its SHA-256 hash, normalizes each event and writes `usage_events` rows. It deduplicates on `event_id`, so a replay is a no-op.
4. **Attribute.** Each row carries org, project, key, user, model, tool, token breakdown and cost. Cost comes from a single pricing table that includes cache pricing ([`web/src/lib/mcp/pricing.ts`](./web/src/lib/mcp/pricing.ts)), with per-org overrides.
5. **Explore.** The dashboard, the alert engine and the MCP server read those tables. Row-Level Security scopes every read to the caller's org.

## Architecture

### System context

```mermaid
flowchart LR
    subgraph Dev["Developer machines"]
        CC["Claude Code"]
        CX["Codex CLI"]
        GM["Gemini CLI"]
        OC["OpenCode"]
        CLI["tokenfin CLI<br/>login / setup / status / doctor / budget / remove"]
    end

    subgraph Apps["Your services"]
        SDK["@tokenfin/sdk / tokenfin (Python)<br/>or raw HTTP"]
    end

    subgraph Chat["MCP clients"]
        MC["Claude Desktop / Cursor / VS Code"]
    end

    Browser["Browser<br/>dashboard user"]

    subgraph Web["web/ · Next.js 15 (Vercel)"]
        OTLP["/api/otel/v1/{logs,metrics,traces}<br/>OTLP receiver"]
        ING["/api/v1/ingest<br/>SDK ingest + enforcement"]
        REST["/api/v1/*<br/>dashboard REST API"]
        MCP["/api/mcp<br/>read-only MCP"]
        CRON["/api/v1/cron/{alerts,retention}<br/>scheduled jobs"]
        UI["Dashboard (RSC)"]
    end

    DB[("Supabase<br/>Postgres + Auth + RLS")]
    Mail["Resend / Slack / webhooks"]

    CLI -. writes config .-> CC & CX & GM & OC
    CC & CX & GM & OC -- "OTLP/HTTP + Bearer ingest key" --> OTLP
    SDK -- "POST + Bearer tfk_…" --> ING
    MC -- "JSON-RPC + read key" --> MCP
    CLI -- "read key: connections, me/budget" --> REST
    Browser --> UI
    Browser --> REST

    OTLP --> DB
    ING --> DB
    REST --> DB
    MCP --> DB
    UI --> DB
    CRON --> DB
    CRON --> Mail
```

AI providers (Anthropic, OpenAI, Google) never appear in this diagram. Agents talk to them directly, and TokenFin only receives the telemetry the agents emit.

### Ingest data flow (Claude Code)

```mermaid
sequenceDiagram
    autonumber
    participant CC as Claude Code
    participant R as /api/otel/v1/logs
    participant A as otlp/auth.ts
    participant N as otlp/decode + normalize
    participant P as otlp/persist.ts
    participant DB as Supabase (usage_events, prompt_captures, usage_agg)
    participant D as Dashboard

    Note over CC: tokenfin setup wrote OTEL_* env<br/>into ~/.claude/settings.json
    CC->>R: OTLP logs (protobuf or JSON), Authorization: Bearer tfk_…
    R->>A: authOtlp(req)
    A->>DB: api_keys lookup by SHA-256(key_hash), is_active, not expired
    A-->>R: { org_id, project_id, api_key_id, user_id }
    R->>N: decode + normalizeLogs(body)
    Note over N: claude_code.api_request → model, input/output,<br/>cache read/write tokens, cost, prompt.id, session.id<br/>claude_code.user_prompt → prompt text
    N->>P: normalized rows + prompts
    P->>DB: INSERT usage_events … ON CONFLICT (event_id) DO NOTHING
    P->>DB: INSERT prompt_captures (keyed by prompt.id, skipped if CAPTURE_PROMPTS=0)
    P->>DB: roll into usage_agg only when cost_basis ≠ 'notional'
    R-->>CC: 200 (OTLP partial-success shape)
    D->>DB: RLS-scoped reads: usage_events ⋈ prompt_captures on prompt id
    DB-->>D: spend, tokens, top prompts, per-member breakdown
```

Codex and Gemini report tokens only as metric counters or histograms. `/api/otel/v1/metrics` derives per-turn rows from them in `web/src/lib/otlp/metrics.ts`, keeping state in `otlp_metric_state`. See [`docs/data-flow.md`](./docs/data-flow.md) for the full derivation rules and the metered vs. notional split.

### Data model

Core tables, with columns as created by `db/migrations/001_schema.sql` and the later additive migrations. Supporting tables (teams, notifications, invitations, key_reveals, otlp_metric_state, traces/spans, evals and others) are left out for clarity.

```mermaid
erDiagram
    organizations ||--o{ members : has
    organizations ||--o{ projects : owns
    organizations ||--o{ api_keys : issues
    organizations ||--o{ usage_events : records
    organizations ||--o{ usage_agg : rolls_up
    organizations ||--o{ prompt_captures : stores
    organizations ||--o{ limits : sets
    organizations ||--o{ alert_rules : defines
    organizations ||--o{ org_integrations : connects
    projects ||--o{ api_keys : scopes
    projects ||--o{ usage_events : attributes
    projects ||--o{ usage_agg : attributes
    projects ||--o{ limits : "may scope"
    api_keys ||--o{ usage_events : "authenticated"

    organizations {
        uuid id PK
        text name
        text slug UK
        uuid owner_id FK
        int retention_days "NULL = keep forever"
        bool kill_switch
        timestamptz created_at
    }
    members {
        uuid id PK
        uuid org_id FK
        uuid user_id FK "auth.users"
        uuid team_id FK
        text role "owner|admin|member|viewer"
        timestamptz joined_at
    }
    projects {
        uuid id PK
        uuid org_id FK
        text name
        text slug "unique per org"
        text description
    }
    api_keys {
        uuid id PK
        uuid org_id FK
        uuid project_id FK
        uuid user_id FK "assigned member"
        uuid team_id FK
        text name
        text key_hash UK "SHA-256"
        text key_prefix "masked"
        text env
        text_array scopes "read, write"
        bool is_active
        bool is_service_account
        text key_enc_cipher "AES-256-GCM"
        timestamptz expires_at
        timestamptz last_used_at
    }
    usage_events {
        uuid id PK
        uuid org_id FK
        uuid project_id FK
        uuid api_key_id FK
        uuid user_id
        text event_id UK "dedupe key"
        text source "claude_code, codex_cli, ..."
        text model
        bigint input_tokens
        bigint output_tokens
        bigint cache_read_tokens
        bigint cache_write_tokens
        bigint reasoning_tokens
        numeric cost_usd
        text cost_basis "metered|notional|vendor_reported"
        text correlation_id "prompt.id"
        text session_id
        text user_email
        text actor_id
        text tool_name
        text prompt_hash
        jsonb tags
        jsonb metadata
        timestamptz created_at
    }
    usage_agg {
        uuid id PK
        uuid org_id FK
        uuid project_id FK
        text model
        timestamptz bucket "daily bucket"
        bigint total_tokens
        numeric cost_usd
        int request_count
        bigint tokens_saved
        numeric cost_saved
    }
    prompt_captures {
        uuid id PK
        uuid org_id FK
        uuid project_id FK
        uuid user_id
        text model
        text prompt_hash "prompt id / hash"
        text prompt_text
        text response_text
        bigint input_tokens
        bigint output_tokens
        numeric cost_usd
        timestamptz created_at
        timestamptz expires_at
    }
    limits {
        uuid id PK
        uuid org_id FK
        uuid project_id FK
        uuid team_id FK
        text scope "org|project|team|member"
        text period "daily|weekly|monthly"
        text metric
        numeric budget_usd
        int warn_at
        int throttle_at
        int block_at
        bool is_active
    }
    alert_rules {
        uuid id PK
        uuid org_id FK
        uuid project_id FK
        text name
        text trigger_type "threshold|anomaly|limit_breach"
        text condition
        numeric threshold
        jsonb channels
        int cooldown_hours
        int fired_count
        timestamptz last_fired_at
        bool is_active
    }
    org_integrations {
        uuid id PK
        uuid org_id FK
        text provider "unique per org"
        jsonb config
        text status
        bool is_active
        timestamptz connected_at
    }
```

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Web app and API | [Next.js 15](https://nextjs.org/) App Router, React 18, TypeScript (strict) | UI and every API route, in `web/` |
| Styling and charts | Tailwind CSS, CSS custom properties, Recharts, lucide-react | Design tokens live in `web/src/app/globals.css` |
| Auth | Supabase Auth via `@supabase/ssr` | Email/password, GitHub, Google. Optional hCaptcha/Turnstile |
| Database | [Supabase](https://supabase.com/) Postgres with Row-Level Security | Schema in `db/migrations/` |
| Telemetry intake | OTLP/HTTP (JSON and protobuf via `protobufjs`) | `web/src/lib/otlp/` |
| MCP | Streamable HTTP, JSON-RPC 2.0 | `web/src/lib/mcp/` |
| Validation | Zod | |
| Optional burst guard | Upstash Redis rate limiting | Only enforced when `TOKENFIN_ENFORCE_RATE_LIMITS=1` |
| Email | Resend | Alert delivery. If no key is set, email delivery is skipped |
| CLI | Node.js ≥ 16, CommonJS, no runtime deps | `cli/`, published as `tokenfin` |
| SDKs | TypeScript (tsup), Python ≥ 3.9 (stdlib; `aiohttp` optional) | `sdk/`, `sdk/python/` |
| Tests | Vitest (web), `node:test` (CLI), pytest | See [Testing](#testing) |
| CI | GitHub Actions | `.github/workflows/ci.yml` |

## Design

### Frontend

- **Server/client split, everywhere.** Each dashboard route has a `page.tsx` Server Component that queries Supabase and passes props, and a `_client.tsx` (`'use client'`) component that owns UI state and mutations. Shared shapes go in `_types.ts`.
- **Two Supabase clients.** `createClient()` (user session, RLS applies) for reads in server components and session-bound routes. `createAdminClient()` (service role, bypasses RLS, `cache: 'no-store'`) for server-only work such as the OTLP receiver, cron and admin-gated routes. It is never imported into client components.
- **No mock data.** Empty tables render an informative empty state that tells you how to connect a source. Trend percentages come from a real previous-period comparison, or are hidden.
- **Main pages:** Overview, Analytics (costs, models, projects, prompts, savings), My Usage, Projects, Teams, Keys, Limits, Alerts, Integrations, Setup (Connections), MCP, Traces, Evals, and Settings (Profile, Notifications, **Data**).
- **Auth gating.** `web/src/middleware.ts` refreshes the Supabase session and redirects unauthenticated `/dashboard/*` requests to `/login`. It skips the key-authenticated APIs (`/api/v1/ingest`, `/api/otel/*`, `/api/mcp`, `/api/v1/cron/*`). `(dashboard)/layout.tsx` sends users without an org to `/welcome`, which creates their workspace automatically (there is no plan to pick), and users without a project to `/onboarding`.

### Backend

- **The web app is the backend.** Every API route lives in `web/src/app/api`. A typical deployment is one Next.js app plus one Supabase project.
- **OTLP receiver** (`web/src/lib/otlp/`): `auth` → `decode`/`proto` → `mapping` → `normalize` / `metrics` → `persist`. The metric-name mapping lives in one versioned file. Unrecognized metrics are logged loudly and never dropped silently.
- **SDK ingest** (`/api/v1/ingest`): validates the key and its `write` scope, checks org-level monthly spend limits against metered month-to-date spend (the `org_spend_since` RPC; returns `403` at block, `429` with `Retry-After` at throttle), prices the event, writes `usage_events` + `usage_agg`, and captures prompt text when supplied.
- **Alert engine** (`web/src/lib/alerts/engine.ts`): shared by the scheduled sweep (`GET /api/v1/cron/alerts`) and the "test fire" button.
- **Data retention** (`/api/v1/data`, `GET /api/v1/cron/retention`): owner-only deletion and retention settings, plus a daily purge that calls the `purge_expired_data()` database function. Both cron routes fail closed: they return `401` unless `CRON_SECRET` is set and presented as a Bearer token.
- **CLI login** (`/api/v1/cli/token`, `/cli/authorize`, device flow `/api/v1/cli/device/{start,poll,approve}` + `/cli/device`): mints per-device ingest + read keys and hands them over through single-use `key_reveals` tokens. The device flow is stateless until approval (HMAC-signed device codes); the approved reveal token is parked in `key_reveals` under a server-derived handle for 10 minutes.
- **Rollout** (`/api/v1/setup/managed-settings`): owner/admin download of a Claude Code managed-settings.json carrying the org's ingest-only key; audited.

### Database

- **`usage_events` is the source of truth.** It holds every captured event with any `cost_basis`.
- **`usage_agg` is a daily rollup of metered spend only.** Analytics totals that must never exceed the real bill read `usage_agg`. SDK-side enforcement sums only metered `usage_events` rows (`org_spend_since`). Views that must see *all* activity, including notional CLI usage (limits display, alerts, My Usage), read `usage_events`. See [`docs/data-flow.md`](./docs/data-flow.md#the-metered-vs-notional-split).
- **`prompt_captures`** stores prompt text (and an optional response) in its own table, so it can be purged independently. It is joined to `usage_events` by prompt id (`prompt_captures.prompt_hash` = `usage_events.correlation_id` for Claude Code).
- **Idempotency.** There is a unique `event_id` on `usage_events` for OTLP, and a unique `(org_id, request_idempotency_key)` for SDK retries.
- **Tenant isolation.** RLS is enabled on every table. Org members can only read their own org's rows. Sensitive tables (`key_reveals`, `org_integrations`, `user_preferences`, `ccr_store`) have no policies, so only the service role can touch them.
- **Safe deletes.** Deleting an API key or a project keeps its usage history: `usage_events.api_key_id` / `project_id` and `usage_agg.project_id` are `ON DELETE SET NULL` (migration 004).
- **Retention.** `organizations.retention_days` (`NULL` = keep forever, 1–3650) drives the daily purge. Captured prompt text also carries its own `expires_at` (90-day default since migration 005).
- **Migrations** are ordered, idempotent SQL files in `db/migrations/`:

| File | Purpose |
|---|---|
| `001_schema.sql` | Complete base schema: the historical migrations 001–025 folded into one file |
| `002_account_attribution.sql` | Actor, tool, provider and prompt-fingerprint dimensions on `usage_events` |
| `003_prompt_capture_retention.sql` | Longer default `prompt_captures.expires_at` |
| `004_app_schema_sync.sql` | Tables, columns and grants the app needs on a fresh install (`org_integrations`, `user_preferences`, `org_models`, key scopes/env/expiry, alert-rule fields, `service_role` grants). Also makes deleting API keys and projects safe: usage is kept and detached (`ON DELETE SET NULL`) |
| `005_security_hardening.sql` | RLS fixes (non-recursive `members` policies, scoped notifications, owner-checked org insert), `security_invoker` `orgs` view, `SECURITY DEFINER` functions executable only by `service_role` with pinned `search_path`, RLS on remaining tables, tenant-scoped keys for traces/spans/`ccr_store` and `UNIQUE (org_id, event_id)` on `usage_events`, 90-day prompt-capture default |
| `006_data_retention.sql` | `organizations.retention_days`, `purge_org_data()` / `purge_expired_data()` for **Settings → Data** and the daily cron, and `org_spend_since()` for ingest limit checks |

One-time repair script (not a migration): [`db/scripts/reprice_claude_code.sql`](./db/scripts/reprice_claude_code.sql) recomputes historical Claude Code `cost_usd` from stored token counts at current list prices. It is idempotent and prints a preview; change its final `COMMIT` to `ROLLBACK` for a dry run.

`supabase/migrations/` holds timestamped copies of the incremental migrations (002–006) for `supabase db push` against a linked project that already has the base schema.

## Project structure

```text
tokenfin/
├── web/                         Next.js 15 app: dashboard UI + every API route
│   ├── src/app/
│   │   ├── (auth)/              login, signup, password reset, accept-invitation
│   │   ├── (onboarding)/        org + first-project wizard
│   │   ├── (dashboard)/dashboard/
│   │   │   ├── analytics/       costs, models, projects, prompts, savings
│   │   │   ├── setup/           Connections: CLI onboarding + live event beacon
│   │   │   ├── keys/ limits/ alerts/ teams/ projects/ integrations/ mcp/ …
│   │   │   └── settings/        profile, notifications, data (retention + deletion)
│   │   ├── api/v1/              REST API (keys, limits, alerts, ingest, data, cron/{alerts,retention}, …)
│   │   ├── api/otel/v1/         OTLP receiver: logs, metrics, traces
│   │   ├── api/mcp/             read-only MCP server endpoint
│   │   ├── welcome/             first-run page: auto-creates the workspace
│   │   ├── cli/authorize/       browser half of `tokenfin login`
│   │   ├── cli/device/          approve a `tokenfin login --device` code
│   │   └── keys/reveal/         one-time key reveal page
│   ├── src/lib/
│   │   ├── otlp/                auth · decode · proto · mapping · normalize · metrics · persist
│   │   ├── mcp/                 tool definitions, handlers, pricing.ts (single price table)
│   │   ├── alerts/              alert evaluation + delivery
│   │   ├── api/                 route auth helpers, key generation
│   │   ├── crypto/              AES-256-GCM key reveal
│   │   └── supabase/            server/admin/browser clients, pagination
│   ├── src/middleware.ts        session refresh + dashboard auth redirect
│   ├── src/components/          dashboard widgets, layout, onboarding, ui primitives
│   ├── vercel.json              cron schedules (alerts, retention)
│   └── .env.local.example
├── cli/                         npm package `tokenfin` (login, setup, status, doctor, budget, statusline, remove) + node:test suite
├── sdk/                         @tokenfin/sdk (TypeScript)
│   └── python/                  `tokenfin` Python SDK (sync + async) and tests
├── db/
│   ├── migrations/              ordered SQL migrations (apply 001 → 006)
│   ├── scripts/                 one-time data repairs (reprice_claude_code.sql)
│   ├── schema.sql               historical reference schema
│   └── functions.sql            SQL helper functions
├── supabase/migrations/         timestamped incremental migrations for `supabase db push`
├── infra/
│   ├── docker/                  Dockerfile.web, docker-compose.yml (web only)
│   └── k8s/                     placeholder (README only)
├── scripts/                     regression and e2e scripts (Node .mjs)
├── docs/                        architecture, data flow, alerts, setup, rollout, MCP
├── .github/workflows/           ci.yml (web, SDKs, Docker web image), cron.yml, publish-cli.yml / publish-sdk.yml (manual)
├── Makefile                     common dev targets
├── CLAUDE.md                    quick reference for AI coding sessions
└── MIGRATION.md                 what was deliberately removed (proxy, hooks, MCP writes) and why
```

## Quick start (customers)

You need a TokenFin account (sign up on your TokenFin deployment) and Node.js ≥ 16.

```bash
npx tokenfin@latest setup     # sign in (browser), per-device keys, configure every installed agent, wait for the first event
```

Then run one turn in Claude Code (or Codex, Gemini, OpenCode). `setup` exits when the event lands.
No browser on the machine? `npx tokenfin@latest login --device` first. Always use `@latest` — npx
otherwise reuses an old cached version (the CLI tells you when an update exists).

**Prompt text is sent by default** (90-day retention, visible to workspace admins). Opt out with
`npx tokenfin@latest setup --no-prompts`.

| Command | Purpose |
|---|---|
| `npx tokenfin@latest status` | Shows which agents are configured and whether events are flowing |
| `npx tokenfin@latest doctor` | Diagnoses silent data loss: config validity, protocol, temporality, key drift, revoked keys, recent events |
| `npx tokenfin@latest budget` | Today / month-to-date spend and your tightest budget (`setup --statusline` puts it in Claude Code's status bar) |
| `npx tokenfin@latest remove` | Revokes this device's keys, strips every agent's TokenFin config (backed up first), unregisters MCP, deletes `~/.tokenfin` |

Options: `--key <tfk_…>` (or `TOKENFIN_KEY`) skips browser login. `--app-url <url>` (or `TOKENFIN_APP_URL`) targets a self-hosted deployment. `--yes` runs non-interactively. See [`cli/README.md`](./cli/README.md), [`docs/SETUP_HUB.md`](./docs/SETUP_HUB.md) and, for teams, [`docs/ROLLOUT.md`](./docs/ROLLOUT.md).

## Local development

### Prerequisites

- Node.js 20 (matches CI) and npm
- A Supabase project, either hosted (free tier) or local through the [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker
- Optional: Python ≥ 3.9 (Python SDK)

### 1. Install

```bash
git clone https://github.com/pankajneema/tokenfin.git
cd tokenfin
make install            # = cd web && npm install
```

### 2. Database

**Option A: hosted Supabase (simplest).** Create a project, then run each file in `db/migrations/` **in order (001 → 006)** in the SQL Editor.

**Option B: local Supabase CLI.** The repo does not commit a `supabase/config.toml`. The files in `supabase/migrations/` are incremental and assume the base schema already exists, so a fresh `supabase start` in this repo would try to apply them to an empty database. Start the local stack from a scratch directory instead, then apply the ordered migrations with `psql`:

```bash
# one-time local stack (outside the repo)
mkdir -p ~/tokenfin-supabase && cd ~/tokenfin-supabase
supabase init
supabase start          # prints API URL, anon key and service_role key
                        # (run `supabase status` to see them again)

# back in the repo: apply migrations 001 → 006 in order
cd /path/to/tokenfin
for f in db/migrations/*.sql; do
  echo "applying $f"
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f "$f"
done
```

The migrations are idempotent, so re-running them is safe.

### 3. Environment

```bash
cp web/.env.local.example web/.env.local
```

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | Supabase API URL (local: `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required** | Supabase anon key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** | Service-role key. Server-only, never expose to the client |
| `KEY_ENCRYPTION_SECRET` | Required for CLI login, key reveal/copy | Secret for AES-256-GCM encryption of one-time reveal links and copyable keys, and for signing `login --device` codes |
| `NEXT_PUBLIC_APP_URL` | Optional | Public origin used in invite links, setup commands and the MCP Origin check. Defaults to the hosted app URL, so set it when self-hosting |
| `CAPTURE_PROMPTS` | Optional | Prompt text capture is on unless set to `0` |
| `CRON_SECRET` | Required for scheduled jobs | Bearer secret for `/api/v1/cron/alerts` and `/api/v1/cron/retention`. Both fail closed (`401`) when it is unset. Vercel Cron sends it automatically |
| `RESEND_API_KEY` | Optional | Enables alert email. If blank, email delivery is skipped |
| `ALERT_EMAIL_FROM` | Optional | From-address for alert email |
| `TOKENFIN_ENFORCE_RATE_LIMITS` | Optional | `1` enables the per-key abuse guard (off by default; not a product cap) |
| `TOKENFIN_RATE_LIMIT_PER_MIN` | Optional | Requests per minute allowed by the abuse guard (default `600`) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional | Upstash Redis backing the abuse guard |
| `NEXT_PUBLIC_CAPTCHA_PROVIDER` / `NEXT_PUBLIC_CAPTCHA_SITE_KEY` | Optional | `hcaptcha` or `turnstile` on auth forms. Must match your Supabase Auth captcha setting. Leave the key blank to disable |
| `EVAL_ALLOW_SERVER_KEY` | Optional | Set to `1` to let orgs without their own judge key fall back to the server key below. Off by default, so tenants can't spend the operator's key |
| `EVAL_JUDGE_KEY` / `ANTHROPIC_API_KEY` / `EVAL_JUDGE_MODEL` | Optional | Server-side LLM judge for the Evals feature only (used only when `EVAL_ALLOW_SERVER_KEY=1`). This is not a capture path; orgs normally bring their own key |
| `NEXT_PUBLIC_BACKEND_URL` | Optional | Legacy backend base URL constant (`lib/constants.ts`) |

Sample files: `web/.env.local.example` (local dev), `web/.env.production.example` (paste into Vercel) and `.env.example` at the repo root (docker compose). Generate `KEY_ENCRYPTION_SECRET` and `CRON_SECRET` with `openssl rand -hex 32`.

### 4. Run

```bash
make dev                # = cd web && npm run dev → http://localhost:3001
```

Sign up, create an org and project, then point the CLI at your local app:

```bash
node cli/bin/tokenfin.js setup --app-url http://localhost:3001   # the CLI from this checkout
```

To try the CLI without touching your real agent configs, give it a throwaway home:
`HOME=$(mktemp -d) node cli/bin/tokenfin.js setup --app-url http://localhost:3001 --no-mcp`.

Other useful targets: `make typecheck`, `make lint`, `make sdk-build`, `make sdk-py-test`, `make check` (web typecheck + SDK typecheck + Python tests), `make db-migrate` (lists migration files in order), `make gen-types`.

## Docker

[`infra/docker/`](./infra/docker) holds `Dockerfile.web` (Node 20 Alpine) and `docker-compose.yml` with a single `web` service (Supabase stays external). The Makefile wraps them:

```bash
cp .env.example .env     # root env file used by docker compose
make docker-build        # build the web image
make docker-up           # web, detached
make docker-logs         # follow logs
make docker-down         # stop and remove containers
```

The web image builds a Next.js standalone server: `Dockerfile.web` sets `NEXT_OUTPUT_STANDALONE=1`, which makes `web/next.config.js` emit `output: 'standalone'` (Vercel builds leave it unset). The server listens on port **3001**. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_APP_URL` are inlined into the client bundle at build time, so they are passed as **build args**. Compose reads them from the root `.env`, and `NEXT_PUBLIC_APP_URL` defaults to `http://localhost:3001`. SDK ingest and the OTLP receivers are served by the same web container.

To run the full stack:

1. Fill in the Supabase values in the root `.env` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus `KEY_ENCRYPTION_SECRET` and `CRON_SECRET`). Add `NEXT_PUBLIC_APP_URL` if you serve it somewhere other than `http://localhost:3001`.
2. Apply the database migrations (see [Database](#2-database)).
3. Run `make docker-up`, then open http://localhost:3001.

To build only the web image:

```bash
docker build -f infra/docker/Dockerfile.web \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  --build-arg NEXT_PUBLIC_APP_URL=http://localhost:3001 \
  -t tokenfin-web .
```

Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `KEY_ENCRYPTION_SECRET`, `CRON_SECRET`, …) are runtime environment variables, not build args. Add any optional ones from the [env table](#3-environment) to the `web` service's `environment`. Scheduled jobs are not triggered inside compose; call the cron routes from an external scheduler (see [Deployment](#deployment)).

## Deployment

A production deployment has two parts: Supabase and the Next.js app on Vercel.

| Component | Platform | How |
|---|---|---|
| **Database** | Supabase | Create a project and apply `db/migrations/001` → `006` in order (SQL Editor or `psql`). For later incremental changes on a linked project, use `supabase db push` with `supabase/migrations/` |
| **Web app** | Vercel | Import the repo and set **Root Directory = `web`** (it has its own `web/vercel.json`; functions run in region `icn1`). Framework preset: Next.js. Add the env vars from the table above. Set `NEXT_PUBLIC_APP_URL` to your production origin |
| **CLI** *(npm)* | npm | Bump `cli/package.json`, then run GitHub → Actions → **Publish CLI** (`.github/workflows/publish-cli.yml`, manual; tests on Linux/macOS/Windows, then `npm publish --access public` with the `NPM_TOKEN` secret). Leave *dry run* ticked to only test + pack |

**Scheduled jobs.** Two endpoints run on a schedule. Both require `Authorization: Bearer $CRON_SECRET` and return `401` without it.

| Path | Purpose | Vercel Cron (`web/vercel.json`) | GitHub Actions (`.github/workflows/cron.yml`) |
|---|---|---|---|
| `/api/v1/cron/alerts` | Evaluate alert rules and deliver the ones that fire | daily, 04:00 UTC | every 15 min |
| `/api/v1/cron/retention` | `purge_expired_data()`: apply each org's retention, drop expired prompt text and cache | daily, 03:30 UTC | daily, 03:30 UTC |

`web/vercel.json` only uses daily schedules, so it deploys on the Vercel **Hobby** plan. The GitHub Actions workflow provides the 15-minute alert sweep on any plan; alerts are claimed atomically, so overlapping runs never send the same alert twice. On Vercel **Pro** you can instead set the alerts schedule in `web/vercel.json` to `*/15 * * * *` and disable the workflow.

To enable the workflow, add in GitHub → Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| Secret | `CRON_SECRET` | same value as `CRON_SECRET` in Vercel |
| Variable | `TOKENFIN_URL` | your app origin, e.g. `https://tokenfin.your-domain.com` |

The workflow skips itself until `TOKENFIN_URL` is set, and can be run by hand from the Actions tab (**Run workflow** → `alerts` or `retention`).

> The repo-root `vercel.json` contains a single-page-app rewrite to `/index.html` that does not apply to the Next.js app. Deploy from `web/` so that file is ignored.

## Testing

| Suite | Command | Notes |
|---|---|---|
| Web unit tests | `cd web && npm test` | Vitest, Node environment, `src/**/*.test.ts` (OTLP decode/normalize, metric derivation, pagination) |
| Web typecheck | `make typecheck` (= `cd web && npm run typecheck`) | `tsc --noEmit`, strict mode |
| Web lint | `make lint` (= `cd web && npm run lint`) | `next lint` |
| CLI | `cd cli && npm test` | `node:test`: hook stripping, atomic writes, `--no-prompts`, statusline, update check, and end-to-end runs against a mock server with a temp `HOME` |
| TypeScript SDK | `make sdk-typecheck` | `cd sdk && npm run typecheck` |
| Python SDK | `make sdk-py-install && make sdk-py-test` | pytest in `sdk/python/tests` |
| Everything | `make check` | Web typecheck, SDK typecheck, Python tests |

CI (`.github/workflows/ci.yml`) runs on pushes to `main`/`dev` and on pull requests to `main`. It runs web typecheck, lint and Vitest; Python SDK pytest; and TypeScript SDK typecheck. The Docker web image build runs on pushes only. The CLI suite runs in the manual Publish CLI workflow. The Node regression scripts in `scripts/` need a running deployment and real keys, so they are not part of CI.

## Security

- **No provider keys, no proxy.** TokenFin only receives telemetry. It cannot see or reuse your Anthropic, OpenAI or Google credentials. See [`MIGRATION.md`](./MIGRATION.md).
- **API keys are hashed.** Keys (`tfk_<env>_<segment>_<32 hex>`) are stored as a **SHA-256** `key_hash` plus a masked `key_prefix`. Authentication hashes the presented key and looks it up, then checks `is_active`, `expires_at` and scopes. CLI logins mint **per-device** keys: an `ingest` key (telemetry only, cannot read) and a `read` key (status, budget, MCP).
- **Encrypted reveal.** Bulk-provisioned keys are delivered through single-use, expiring **AES-256-GCM** reveal links. The ciphertext is nulled after the first reveal. Copy-anytime keys are encrypted at rest and decrypted only for org admins. Both need `KEY_ENCRYPTION_SECRET`.
- **Row-Level Security** on every table: members read only their own org. Sensitive tables have no client policies at all. Migration `005_security_hardening` removes client-side writes to `members`, makes `SECURITY DEFINER` functions executable only by `service_role` (with a pinned `search_path`), switches the `orgs` view to `security_invoker`, and adds tenant-scoped keys to traces, spans and `ccr_store`.
- **Service role stays on the server.** `createAdminClient()` is used only in server code (OTLP receiver, ingest, cron, admin-gated routes), which enforces org membership and role checks itself (`lib/api/auth.ts`, `lib/rbac.ts`).
- **MCP needs a read key.** Ingest-only keys are refused. No tool captures or deletes usage; `compress` stores originals for `retrieve` and `evaluate` calls your configured judge model (see [`docs/MCP.md`](./docs/MCP.md)). Browser requests are checked against an Origin allow-list.
- **Your data, your retention.** Settings → Data lets the org **owner** delete old monitoring data or all of it (the API requires `confirm: "DELETE"`) and set automatic retention. Prompt capture can be disabled per machine (`setup --no-prompts`), per workspace (org setting), or per deployment (`CAPTURE_PROMPTS=0`); prompt text expires after 90 days.
- **Fail-closed cron.** `/api/v1/cron/*` returns `401` unless `CRON_SECRET` is configured and matches (constant-time comparison on the retention route).

Found a vulnerability? Please **do not open a public issue**. Follow [`SECURITY.md`](./SECURITY.md).

## API overview

All routes are under `web/src/app/api`. "Key" means `Authorization: Bearer tfk_…`. "Session" means a signed-in dashboard user (Supabase cookie), with role checks where noted.

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/v1/ingest` | POST | Key (`write`) | SDK / direct usage ingest. Supports `Idempotency-Key`. Returns `403`/`429` when an org monthly limit blocks or throttles |
| `/api/otel/v1/logs` | POST | Key | OTLP logs: per-turn usage (Claude Code `api_request`) and prompt capture |
| `/api/otel/v1/metrics` | POST | Key (Bearer or `?key=`) | OTLP metrics: Codex / Gemini / OpenCode derivation, health |
| `/api/otel/v1/traces` | POST | Key | OTLP traces: GenAI spans → traces/spans and usage |
| `/api/mcp` | POST | Key (`read`) | Read-only MCP server (Streamable HTTP, JSON-RPC 2.0) |
| `/api/v1/connections` | GET | Key or session | Per-source connection status (used by `setup`, `status`, `doctor`) |
| `/api/v1/cli/token` | POST | Session | Mints this device's ingest + read keys during `tokenfin login` (rotating only that device's old ones) and returns a single-use reveal token (never a raw key) |
| `/api/v1/cli/device/start`, `/api/v1/cli/device/poll` | POST | None (signed device code) | `tokenfin login --device`: issue a user code; poll until approved, then receive the single-use reveal token |
| `/api/v1/cli/device/approve` | POST | Session | Approve a device code from `/cli/device` (mints keys via `/api/v1/cli/token`) |
| `/api/v1/me/budget` | GET | Key (`read`) or session | Today / MTD spend (yours and the org's) and the tightest limit with % used — powers `tokenfin budget` and the statusline |
| `/api/v1/setup/managed-settings` | GET | Session (owner/admin) | Claude Code managed-settings.json with the org ingest key, team tag and prompt policy (`?download=1`) |
| `/api/v1/analytics`, `/api/v1/analytics/prompts` | GET | Session | Aggregated spend and prompt analytics |
| `/api/v1/budget`, `/api/v1/models` | GET | Session | Budget vs. spend, model usage summary |
| `/api/v1/keys` | GET, POST, PATCH, DELETE | Session (admin) | Manage API keys (raw key returned once on create) |
| `/api/v1/keys/reveal`, `/api/v1/keys/reveal-full` | POST | Single-use token / session (admin) | One-time reveal (also used by `tokenfin login`), admin copy |
| `/api/v1/limits` | GET, POST, PATCH, DELETE | Session (admin) | Spend limits |
| `/api/v1/alerts`, `/api/v1/alerts/test` | GET, POST, PATCH, DELETE / POST | Session (admin) | Alert rules and test-fire |
| `/api/v1/notifications` | GET, PATCH | Session | Alert history and read state |
| `/api/v1/integrations` | GET, POST, DELETE | Session (admin) | Slack / webhook channels |
| `/api/v1/projects`, `/api/v1/teams`, `/api/v1/members`, `/api/v1/orgs` | CRUD | Session (role-checked) | Org management |
| `/api/v1/invites`, `/api/v1/invites/accept`, `/api/v1/provision` | POST (accept also DELETE) | Session | Invites and bulk provisioning |
| `/api/v1/preferences` | GET, POST | Session | Per-user settings |
| `/api/v1/data` | GET, PATCH, POST | Session (GET: member; PATCH/POST: owner) | Settings → Data. `GET` returns the retention setting and stored-data counts. `PATCH {org_id, retention_days}` (1–3650 or `null` = forever). `POST {org_id, older_than_days, confirm: "DELETE"}` deletes data older than N days, or everything when `older_than_days` is `null` |
| `/api/v1/cron/alerts` | GET | `CRON_SECRET` | Scheduled alert sweep (every 15 min) |
| `/api/v1/cron/retention` | GET | `CRON_SECRET` | Daily retention purge (`purge_expired_data()`) |

See [`CLAUDE.md`](./CLAUDE.md) for the full route table and a page → data-source map.

## SDK usage

Both SDKs send events to `POST {baseUrl}/api/v1/ingest` in the background. They batch, retry with exponential backoff, and open a circuit breaker if the endpoint is down, so `track()` never blocks or throws. The base URL defaults to `https://tokenfin.curiousdevs.com`; set it only when you self-host. Keys start with `tfk_`.

**TypeScript** ([`sdk/`](./sdk), package `@tokenfin/sdk`, Node ≥ 18):

```ts
import { TokenFinClient } from '@tokenfin/sdk'

const tf = new TokenFinClient({
  apiKey: process.env.TOKENFIN_API_KEY!,     // tfk_… key with the "write" scope
  baseUrl: 'https://your-tokenfin.example.com',  // optional; omit for the hosted app
})

// After each LLM call — fire-and-forget, never throws
tf.track({
  model: 'claude-sonnet-4-6',
  inputTokens: 812,
  outputTokens: 164,
  tags: { feature: 'chat' },
})

await tf.flush()   // drain the queue before the process exits
```

Also exported: `createTokenFin(cfg)` (factory) and `tf.destroy()` (stop without flushing). Options: `timeoutMs`, `flushIntervalMs`, `batchSize`, `maxQueueSize`, `debug`.

**Python** ([`sdk/python/`](./sdk/python), package `tokenfin`, Python ≥ 3.9):

```python
from tokenfin import TokenFinClient

tf = TokenFinClient(
    api_key="tfk_...",
    base_url="https://your-tokenfin.example.com",  # optional; omit for the hosted app
)
tf.track(model="gpt-4o", input_tokens=800, output_tokens=120, tags={"feature": "chat"})
tf.flush()  # also runs automatically at exit
```

```python
from tokenfin import AsyncTokenFinClient   # pip install "tokenfin[async]"

tf = AsyncTokenFinClient(api_key="tfk_...", base_url="https://your-tokenfin.example.com")
await tf.track(model="gpt-4o", input_tokens=800, output_tokens=120)
await tf.flush()
```

**Raw HTTP:**

```bash
curl -X POST https://your-tokenfin.example.com/api/v1/ingest \
  -H "Authorization: Bearer $TOKENFIN_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"model":"claude-sonnet-4-6","input_tokens":812,"output_tokens":164,"tags":{"feature":"chat"}}'
```

## Screenshots

> Screenshots are not committed yet. The paths below are placeholders.

| View | Path |
|---|---|
| Overview dashboard | `docs/screenshots/overview.png` |
| Analytics: cost by model and project | `docs/screenshots/analytics.png` |
| Prompt analytics | `docs/screenshots/prompts.png` |
| Connections (`tokenfin setup` beacon) | `docs/screenshots/setup.png` |
| Limits and alerts | `docs/screenshots/limits-alerts.png` |
| Settings → Data (retention) | `docs/screenshots/settings-data.png` |

**To add one:** capture it at 1440 px wide from a demo org with no real customer data, prompts or emails visible. Save it as a PNG under `docs/screenshots/` with the name above. Then replace the table row with `![Overview](docs/screenshots/overview.png)`.

## Roadmap

Derived from the verification status in [`docs/`](./docs) and [`MIGRATION.md`](./MIGRATION.md):

- [x] Claude Code capture verified end-to-end against real sessions
- [x] Codex CLI capture verified end-to-end (histogram metrics, cache-token de-duplication)
- [x] Alerts (rule → cron → delivery) and SDK-side limit enforcement verified
- [x] Free and unlimited: no plans, billing or usage caps
- [x] Customer data controls: delete by age, delete all, automatic retention with a daily purge
- [x] Pricing for Anthropic, OpenAI (GPT-5, GPT-4.1, o-series) and Gemini 2.5 / 3.x, with cache pricing
- [x] CI runs web and Python SDK tests; CLI tests gate the npm publish workflow
- [x] Per-device CLI keys (ingest + read), device-code login, managed-settings rollout kit
- [ ] **Gemini CLI**: end-to-end verification with a real account (config matches official docs)
- [ ] **OpenCode**: end-to-end session run (receiver path already verified with real payloads)
- [ ] IDE extensions (Claude Code / Codex for VS Code and JetBrains): empirical verification
- [ ] **SQL-side aggregation** for dashboard analytics in very large orgs, replacing paginated in-app aggregation (the ingest spend check already runs in SQL via `org_spend_since`)
- [ ] Keep `pricing.ts` current as providers ship new models, and add more providers
- [ ] Grouped `/connections` UI with per-tool guides, replacing the interim `/dashboard/setup`
- [ ] Pull connectors: GitHub Copilot, Cursor, Anthropic Admin API reconciliation
- [ ] Rework legacy regression scripts to post OTLP payloads (see `MIGRATION.md`)

## Documentation

| Doc | Covers |
|---|---|
| [`docs/architecture.md`](./docs/architecture.md) | System map, monorepo layout, auth flow |
| [`docs/data-flow.md`](./docs/data-flow.md) | Capture paths, metered vs. notional, OTLP metric derivation |
| [`docs/alerts-and-limits.md`](./docs/alerts-and-limits.md) | What limits can enforce vs. warn about, how alerts fire |
| [`docs/SETUP_HUB.md`](./docs/SETUP_HUB.md) | Per-agent connection details, keys, prompt capture, statusline |
| [`docs/ROLLOUT.md`](./docs/ROLLOUT.md) | Rolling out to a team: managed settings, rollout tracker, privacy, offboarding |
| [`docs/MCP.md`](./docs/MCP.md) | The read-only MCP server and client configs |
| [`cli/README.md`](./cli/README.md) | CLI command reference |
| [`CLAUDE.md`](./CLAUDE.md) | Schema quick reference, route table, page → data-source map |
| [`MIGRATION.md`](./MIGRATION.md) | What was removed (proxy, hooks, MCP writes) and why |

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, conventions (server/client split, admin-client rule, no mock data, additive migrations) and the pull-request checklist.

## License

TokenFin is released under the [MIT License](./LICENSE).
