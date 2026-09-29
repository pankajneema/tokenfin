# TokenFin — CLAUDE.md
> Architecture reference for AI sessions. Keep this updated when adding pages, tables, or API routes.

## What is TokenFin
LLM Cost Attribution & FinOps platform. Tracks API usage (tokens, cost, requests) across projects, models, and team members. Built with Next.js 15 App Router + Supabase. Free and unlimited — no plans or billing.

---

## Tech Stack
- **Framework**: Next.js 15 App Router, TypeScript strict, `src/` directory (middleware in `src/middleware.ts`)
- **Database**: Supabase (Postgres + Auth + RLS)
- **Styling**: Tailwind CSS + CSS custom properties (design tokens in `globals.css`)
- **Charts**: Recharts
- **Auth**: Supabase SSR (`@supabase/ssr`)

---

## Critical Patterns

### Server / Client Split
Every page follows this pattern — NO EXCEPTIONS:
```
page.tsx        → server component (no 'use client')  — fetches DB, passes props
_client.tsx     → 'use client' component               — all UI, state, mutations
_types.ts       → shared interfaces (when both files need them)
```

### Supabase Clients
```typescript
// In server components and API routes:
import { createClient }      from '@/lib/supabase/server'  // anon/user — respects RLS
import { createAdminClient } from '@/lib/supabase/server'  // service-role — bypasses RLS

// In client components:
import { createClient } from '@/lib/supabase/client'       // browser anon client
```

**Rule**: `createAdminClient()` is server-only. Never import in `'use client'` files.

### Empty State Rule
When a page has no real data → show an **informative empty state**, NEVER fall back to mock/demo data.
```tsx
if (data.length === 0) {
  return <EmptyState message="Send events via POST /api/v1/ingest to see data here" />
}
```

### Trend % Pattern (prev-period comparison)
Fetch current 30d + previous 30d (60-30 days ago), compute `(curr - prev) / prev * 100`.
```typescript
const trendPct = prev > 0 ? +((curr - prev) / prev * 100).toFixed(1) : null
```
Return `null` when no prev data — UI shows no badge instead of fake %.

### Prev-Period Alignment for Daily Charts
Fetch prev period rows and shift bucket dates forward 30 days to align with current period:
```typescript
const shifted = new Date(new Date(rawDay).getTime() + 30 * 86400_000).toISOString().slice(0, 10)
prevMap.set(shifted, prev + cost)
```

---

## Database Tables

| Table | Key columns | Used by |
|---|---|---|
| `organizations` | `id, name, slug, retention_days` | onboarding, Settings → Data (TokenFin is free and unlimited — `plan` is unused) |
| `projects` | `id, org_id, name, slug` | projects page, analytics, dashboard |
| `members` | `id, org_id, user_id, role` | teams page, analytics/projects |
| `teams` | `id, org_id, name` | limits page (scope), teams page |
| `api_keys` | `id, org_id, project_id, name, key_prefix, key_hash, env, scopes, is_active, expires_at, last_used_at, created_by` | keys settings, mcp page |
| `usage_events` | `id, org_id, project_id, user_id, model, total_tokens, cost_usd, created_at, tags, metadata` | dashboard recent events, sparklines |
| `usage_agg` | `org_id, project_id, model, bucket (date), total_tokens, cost_usd, request_count` | ALL analytics pages, dashboard KPIs |
| `limits` | `id, org_id, project_id, team_id, scope, metric, period, value, warn_at, throttle_at, block_at, budget_usd, is_active` | limits page, analytics/projects budget |
| `alert_rules` | `id, org_id, name, trigger_type, condition, scope, channels, is_active, fired_count, last_fired_at, cooldown_hours` | alerts page |
| `notifications` | `id, org_id, user_id, title, body, type, is_read` | alerts history tab |
| `org_integrations` | `id, org_id, provider, status, config` | integrations page |
| `user_preferences` | `user_id, key, value` | notifications settings |
| `productivity_daily` | `org_id, user_key, user_id, repo, day, lines_added/removed, commits, pull_requests, edits_accepted/rejected, active_seconds, sessions` | Productivity, Teams, My Usage (from Claude Code metrics, migration 007) |
| `api_errors_daily` | `org_id, user_key, model, day, errors` | error counts from `api_error` log events (007) |
| `org_model_prices` | `org_id, model_prefix, input/output/cache_read/cache_write_per_m` | Models page custom prices; override `lib/mcp/pricing.ts` (007) |
| `provider_connections` / `provider_costs` | sealed admin key; daily provider-billed cost | Bill check (reconciliation), `lib/billing-sync` (008) |
| `digest_runs` | `org_id, week_key` | weekly digest idempotency (009) |
| `coding_tool_usage` / `merged_prs` / `github_user_map` | per-user daily usage from Claude Code Analytics, Cursor, Copilot; merged GitHub PRs + login→member map | `/dashboard/coding-tools`, cost per merged PR on Productivity (`lib/connectors/*`, migration 013; service-role only, RPCs `coding_tools_summary`, `merged_pr_costs`) |
| `usage_daily` / `usage_sessions` / `usage_daily_prompts` | org-local daily rollups of usage_events (by project/model/user/source/cost_basis), per-session and per-prompt | **Dashboards read these** via `lib/rollups.ts` (`dashSummary`, `dashBreakdown`, `dashSessions`, `dashPrompts`, `orgSpendSince`). Maintained by INSERT/UPDATE/DELETE triggers on usage_events; `rebuild_rollups(org)` runs automatically on a time-zone change (011) |
| `allocation_rules` | `org_id, match, target (team / cost_center), split` | Settings → Allocation; applied by chargeback + FOCUS exports (014) |
| `price_sync_findings` | `model, kind, ours, theirs, orgs[]` | nightly LiteLLM price diff → Models page `<PriceFindings>` (014) |
| `audit_log` | `org_id, actor_user_id, actor_email, action, target_type, target_id, details` | Settings → Audit log, `lib/audit.ts` (010) |

`organizations.capture_prompts` (011, default true; Settings → Workspace) drops prompt text on arrival when false. `organizations.retention_days` (006) and `organizations.timezone` (010, IANA, default `Asia/Kolkata`) drive Settings → Data and day bucketing. Server code gets the zone with `getOrgTimezone(orgId)` (`lib/org-timezone.ts`) and buckets with `toZonedDate` / `daysAgoIn`; a `usage_agg.bucket` is already a day label — use `bucketDay` / `shiftDay`, never re-convert it.

Prompts vs LLM calls: count prompts with `countPrompts()` from `lib/prompts.ts` (one CLI prompt = one `correlation_id`; each SDK request = one prompt). Read raw rows with `selectAll()` (`lib/supabase/paginate.ts`, keyset-paged when the select has `created_at,id`) — PostgREST caps a single response at 1,000 rows. Prefer the rollup RPCs in `lib/rollups.ts` for anything aggregate.

Migrations 011–015: 011 rollups + ingest (event ids are org-prefixed; `purge_org_data` covers rollups), 012 keys/access, 013 connectors, 014 FinOps, 015 retention for connector tables, 017 `job_runs` (every cron route runs inside `withJobRun()` from `lib/jobs.ts`; 30-day self-prune), 018 traces (span/trace columns, keyset index, `refresh_traces`), 016 prompt privacy (RLS on `prompt_captures`, `usage_events`, `spans`: owner/admin read all, others only their own rows), 019 `dash_breakdown` returns `prompts` per key (each prompt attributed to one key, so they sum to the total; null for skill / mcp_server / cost_basis). Every migration is idempotent and has a byte-identical copy in `supabase/migrations/2026093000001N_*.sql`.

### `usage_agg` is the central analytics table
- Pre-aggregated daily by `(org_id, project_id, model, bucket)`
- Written by the ingest pipeline when usage events arrive
- Query with `.gte('bucket', since30)` for 30-day windows

---

## API Routes (`/src/app/api/v1/`)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/v1/ingest` | POST | API key header | Write one usage event → usage_events (+ usage_agg for metered rows). Shared logic in `ingest/_core.ts` |
| `/api/v1/ingest/batch` | POST | API key header | `{events:[…]}` (1–500) → `{results:[{index,status,code}],accepted,duplicates,errors}`; used by the SDKs, which fall back to `/ingest` on 404 |
| `/api/v1/keys` | GET POST DELETE | Admin | Manage api_keys table |
| `/api/v1/limits` | GET POST PATCH DELETE | Admin | Manage limits table |
| `/api/v1/alerts` | GET POST PATCH DELETE | Admin | Manage alert_rules + notifications |
| `/api/v1/integrations` | GET POST DELETE | Admin | Manage org_integrations table |
| `/api/v1/analytics` | GET | Admin | Aggregated analytics query |
| `/api/v1/projects` | GET POST PATCH DELETE | Admin | Manage projects |
| `/api/v1/members` | GET POST DELETE | Admin | Manage members |
| `/api/v1/orgs` | GET PATCH | Admin | Org settings |
| `/api/v1/preferences` | GET PATCH | User | user_preferences table |
| `/api/v1/budget` | GET | Admin | Budget vs spend summary |
| `/api/v1/models` | GET | Admin | Model usage summary |
| `/api/v1/teams` | GET POST PATCH DELETE | Admin | Manage teams |
| `/api/v1/invites` | POST | Admin | Send member invites (`lib/invites.ts`: branded email via Resend with a `/auth/confirm` link; existing accounts get a sign-in link; falls back to Supabase's mailer — templates in `docs/email-templates`) |
| `/api/v1/invites/pending` | GET | Session | The caller's pending invitation (used by /welcome) |
| `/api/v1/invites/accept` | POST DELETE | Session | Join the invited org (sets `tf_org` so it opens next) / decline |
| `/api/v1/provision` | POST | Admin | Bulk onboard members + auto-generate keys (one-time reveal links) + service accounts |
| `/api/v1/keys/reveal` | POST | Token (single-use) | Reveal a provisioned raw key exactly once |
| `/api/mcp` | POST | API key (Bearer, read) | Remote MCP server — Streamable HTTP, JSON-RPC, read-only FinOps tools |
| `/api/otel/v1/logs` | POST | API key (Bearer) | **OTLP receiver — per-turn usage.** Parses `*.api_request` log events → one usage_events row, deduped by `event_id`. JSON + protobuf. |
| `/api/otel/v1/metrics` | POST | API key (Bearer/`?key=`) | OTLP receiver — health checks + **Codex/Gemini capture**: derives per-turn rows by diffing cumulative counters (`lib/otlp/metrics.ts`, state in `otlp_metric_state`, migration 024). Claude Code metrics are NOT derived (its logs own those rows). |
| `/api/otel/v1/traces` | POST | API key (Bearer) | OTLP receiver — spans/traces (JSON, protobuf, gzip). GenAI semconv + OpenLLMetry + OpenInference mapped in `lib/otlp/genai.ts` (versioned); only LEAF LLM spans are mirrored into usage_events (metered), CLI-agent spans skipped. See `docs/TRACES.md`. |
| `/api/v1/connections` | GET | API key or session | Per-source connection status (last event, tokens today, cost_basis). Powers CLI `setup`/`status`/`doctor` + setup beacon. |
| `/api/v1/data` | GET PATCH POST | Session (owner for writes) | Retention setting + delete monitoring data |
| `/api/v1/audit` | GET | Owner/admin | Audit log |
| `/api/v1/export/chargeback` | GET | Owner/admin | Monthly chargeback CSV by team/project/member |
| `/api/v1/provider-connections` | GET POST DELETE | Owner | Anthropic/OpenAI admin keys for bill sync; also Claude Code Analytics, Cursor, GitHub Copilot and GitHub connectors (`?action=github_map` maps GitHub logins to members) |
| `/api/v1/cron/{alerts,retention,digest,reconcile,connectors,prices}` | GET | `CRON_SECRET` | Scheduled jobs (fail closed) |
| `/api/v1/cli/token` | POST DELETE | Session (POST) / device key (DELETE) | CLI login mints the per-device key pair; DELETE self-revokes that device's keys (`tokenfin remove`) |
| `/api/v1/cli/device/{start,poll,approve}` | POST | — / session | Device-code login for headless machines (`tokenfin login --device`, page `/cli/device`) |
| `/api/v1/setup/managed-settings` | GET | Owner/admin | Downloadable Claude Code managed-settings.json for fleet rollout (`docs/ROLLOUT.md`) |
| `/api/v1/export/focus` | GET | Owner/admin | FOCUS 1.2 CSV (streamed; notional rows bill $0, ListCost = computed) |
| `/api/v1/allocation-rules` | GET POST PATCH DELETE | Owner/admin | Team / cost-center allocation rules |
| `/api/v1/budgets/apply` | POST | Admin session or admin-scoped key | Budgets-as-code: plan / apply limits + alerts from YAML/JSON (dry run by default) |
| `/api/v1/me/budget` | GET | API key (read) or session | Caller's today + month-to-date spend (notional share) and tightest limit %. Powers the CLI statusline. |
| `/.well-known/oauth-{protected-resource,authorization-server}` | GET | — | Deliberate 404 JSON: MCP is Bearer-only, no OAuth discovery |
| `/api/v1/ask` | POST | Session | ⌘K "ask your spend": deterministic intent parser (`lib/ask`), optional Claude mapping when `ANTHROPIC_API_KEY` is set (question + intent schema only, never usage rows); answers from rollups, member-scoped |
| `/api/v1/insights` | GET | API key (read) or session | Waste findings + spikes (`lib/insights`) |
| `/api/health` | GET | — | `{ok, db latency, version, migrations}` (10 s cache, no secrets) |
| `/auth/callback` | GET | — | Supabase OAuth callback (no `?code` → hands off to /login, whose hash handler finishes Supabase-mailer links) |
| `/auth/confirm` | GET | — | Server-side email-link verification (`verifyOtp` with `token_hash`) → `next`. Used by invites and custom templates |

### Invitations (IMPORTANT)
- Signed in without a workspace → `requireOrgContext()` / `/auth/callback` / `/welcome` send the user to `/accept-invitation` if a pending invitation matches their email; only otherwise is a new workspace created.
- People who already have a workspace see a "You've been invited" banner (dashboard layout).
- Pages pick the workspace ONLY via `requireOrgContext()` (never `members … limit(1)`), so the `tf_org` choice is consistent everywhere.

### Key security model (IMPORTANT)
- API keys are stored ONLY as `key_hash` (SHA-256) + a **masked** `key_prefix` (e.g. `tfk_prod_abc1_…c05a`). The raw key is returned **once** in the POST response, never again.
- Bulk-provisioned keys are delivered via single-use, expiring, AES-256-GCM reveal links (`/keys/reveal/[token]`). Needs `KEY_ENCRYPTION_SECRET` env + migration 012 (`key_reveals` table, `api_keys.is_service_account`).
- **Key kinds (migration 012 `keys_access`):** `api_keys.kind` + `device_id`. CLI login mints a per-device pair: an **ingest-only** key (OTLP/ingest) and a **read** key (MCP, status, `me/budget`). Re-login rotates only that device's keys. `requireApiKeyOrOrgMember` answers 401 for a bad Bearer, 403 for an ingest-only key. MCP rejects `?key=` (OTLP still accepts it for Gemini).
- Demoting a member to viewer narrows their keys to read; removing a member revokes their keys and destroys pending reveals (audited as `keys_revoked`).
- Org selection: use `getOrgContext()` / `requireOrgContext()` (`lib/org-context.ts`, React `cache()`); honours a `tf_org` cookie only when the user is a member.
- Security headers (CSP, frame DENY, nosniff, Permissions-Policy) are set in `next.config.js`; `/keys/reveal/*` is `no-store` + `no-referrer`.
- MCP keys are created **read-only** (`scopes: ['read']`); the MCP server (`/api/mcp`) exposes no write tools. See `docs/MCP.md`.

### New dashboard pages
- `/dashboard/my-usage` — per-user, dollar-first personal analytics (scoped to `usage_events.user_id`); shows a savings card.
- `/dashboard/provision` — bulk team provisioning UI.
- `/dashboard/setup` — interim Claude Code connect surface (OTLP one-command + live ingest beacon). Full grouped `/connections` is a later milestone.
- `/dashboard/analytics/savings` — savings (measured vs estimated, by lever).
- `/keys/reveal/[token]` — public one-time key reveal page.

### Capture = OpenTelemetry push (the Connections rebuild)
Usage is captured from each CLI agent's **native OTLP export**, not from MCP/hooks/proxy (all
removed — see `MIGRATION.md`). `npx tokenfin setup` writes an OTel `env` block into
`~/.claude/settings.json` pointing Claude Code at `/api/otel`.
- **Receiver**: `web/src/lib/otlp/*` (auth · attrs · proto · decode · mapping · normalize · persist)
  behind `web/src/app/api/otel/v1/{logs,metrics,traces}/route.ts`. Accepts OTLP/JSON **and**
  protobuf (protobufjs, inlined proto). Bearer key → org via `api_keys` hash.
- **Per-turn rows come from logs**: Claude Code's `claude_code.api_request` event carries model,
  token counts, cost, `prompt.id`, `session.id`, `user.email`. `normalize.ts` → one `usage_events`
  row; `persist.ts` upserts with `ON CONFLICT (event_id) DO NOTHING` (idempotent; replays are no-ops).
  Metrics (`claude_code.token.usage`) are cumulative counters of the same tokens → health-only,
  never persisted (would double-count).
- **cost_basis**: CLI-agent usage is `notional` (subscription usage priced at API rates — NOT a
  bill; never summed into a metered total). `metered`/`vendor_reported` come with pull connectors.
- **Mapping is versioned in one file** (`otlp/mapping.ts`); unrecognized metric names are logged,
  never silently dropped. `detectSource` matches CLI agents by service.name **prefix** (`claude-code`, `codex*`,
  `gemini-cli`, `opencode*`) or event-name prefix — never by model name — so a generic app calling claude-* models stays metered `otlp`.
- **Claude Cowork** (Team/Enterprise): org-wide, no per-person install. Admin settings → Cowork → OTLP endpoint
  `<app>/api/otel`, protocol `http/json`, headers `Authorization=Bearer <ingest key>`. Events are bare
  `api_request` / `user_prompt` / `tool_result` with `service.name=cowork` → source `cowork`, notional,
  attributed by `user.email`. Shown on /dashboard/setup (Desktop & chat).
- **Codex/Gemini (Phase 4, needs a real-session confirm)**: they report tokens only as metric
  counters. `otlp/metrics.ts` derives per-turn rows by cumulative-diffing (first-seen = baseline,
  emit nothing). `setup` writes `~/.codex/config.toml` (`[otel]`, user-level, `metrics_exporter=otlp-http`
  — NOT the statsig default) and `~/.gemini/settings.json` (telemetry; auth via `?key=` since Gemini
  can't set headers). Exact metric attribute names + temporality still need one real session to verify.

### MCP is read-only (query the dashboard from chat)
`web/src/lib/mcp/*` behind `web/src/app/api/mcp/route.ts` (Streamable HTTP, JSON-RPC, Bearer,
Origin guard). Tools:
- **Analytics (read):** list_projects, get_spend, get_usage_by_model, get_daily_costs, get_budget_status,
  get_breakdown, get_sessions, get_session, get_prompts, get_mtd_and_forecast, get_insights (rollup-backed)
- **Role-aware:** a member/viewer key sees only its owner's sessions, prompts and per-member spend (`lib/mcp/scope.ts`); org totals stay visible. `evaluate` needs owner/admin.
- **Claude Code plugin:** `plugins/claude-code/` (MCP server via `TOKENFIN_READ_KEY`, `/tokenfin:spend`, `/tokenfin:budget`, `/tokenfin:top-models`).
- **Token saving:** compress / retrieve (reversible CCR, needs migration 015 for retrieve), savings_stats

There is **no** `record_usage` / write tool — MCP never captures usage (it can't reliably know
token counts). `setup` optionally registers this server so you can ask your dashboard questions
in chat.

### Removed: the Go gateway / proxy
The `cmd/gateway` reverse-proxy, base-URL rewriting, and the LaunchAgent/CLI proxies are **deleted**
(`MIGRATION.md`): a proxy in the request path is an unacceptable failure mode for an observability
tool and would force us to hold customer provider keys. Savings columns (migration 013) and
`prompt_captures` (014) remain; the MCP `compress`/`savings_stats` tools still use them.

---

## Page → Data Source Map

```
/login, /signup               → supabase.auth
/onboarding                   → orgs + projects + members
/welcome                      → creates the workspace (no plans)

/dashboard                    ← SERVER (page.tsx)
  usage_events (30d + prev30d) → KPI cards, real trend %, sparklines
  usage_events (7d)            → sparkline data
  usage_agg (14d)              → CostChart
  usage_events (30d)           → ModelBreakdown, RecentEvents
  usage_agg (30d)              → TopProjects
  projects                     → TopProjects names
  members                      → Engineers count

/dashboard/projects           ← SERVER
  projects                     → project cards
  usage_agg (30d)              → cost per project

/dashboard/teams              ← SERVER
  members + profiles           → member table
  projects + limits            → budget per project
  usage_agg                    → cost per member

/dashboard/keys               ← SERVER ✅
  api_keys                     → key list (key_hash never sent to client)
  projects                     → project name lookup
  auth.admin.listUsers         → created_by name

/dashboard/limits             ← SERVER ✅
  limits                       → limit rows
  projects, teams              → scope name lookup

/dashboard/alerts             ← SERVER ✅
  alert_rules                  → rules list
  notifications                → history tab

/dashboard/integrations       ← SERVER ✅
  org_integrations             → connector list + status

/dashboard/mcp                ← SERVER ✅
  api_keys (type=mcp)          → connected platforms
  usage_agg                    → token usage per platform

/dashboard/analytics          ← SERVER ✅
  usage_agg (30d + prev30d)    → daily chart, model/project/platform slices

/dashboard/analytics/models   ← SERVER ✅
  usage_agg (30d + prev30d)    → cost/tokens/calls per model
  CATALOG (static in page.tsx) → pricing, latency, tier metadata

/dashboard/analytics/projects ← SERVER ✅
  usage_agg (30d + prev30d)    → cost/tokens per project
  projects + limits + members  → names, budgets, user counts

/dashboard/analytics/costs    ← SERVER ✅
  usage_agg (30d + prev30d)    → daily rows, top model/project per day
  projects                     → project name lookup

/dashboard/settings/profile       ← SERVER (supabase.auth.getUser)
/dashboard/settings/notifications ← SERVER (user_preferences table)
/dashboard/settings/data          ← SERVER + /api/v1/data (retention & deletion)
/dashboard/settings/workspace     ← organizations (name, timezone) + SSO help
/dashboard/settings/audit         ← /api/v1/audit
/dashboard/productivity           ← productivity_daily + usage_events (cost per PR/commit/1k lines)
/dashboard/sessions[/id]          ← usage_events grouped by session_id (+ prompt_captures)
/dashboard/analytics/reconciliation ← provider_costs vs metered usage_events (anthropic/openai connections only)
/dashboard/insights                ← lib/insights (waste finder: 6 rules with monthly-saving estimates; spike explainer: mean+3σ, decomposed by dimension). Also GET /api/v1/insights, MCP get_insights, weekly digest section
/dashboard/analytics/what-if       ← lib/insights/whatif.ts (pure simulator: model switch, cache-hit, output cap, seats→API)
/dashboard/traces[/trace_id]       ← spans/traces (018): keyset list + waterfall. Members see their own + unattributed service traces; prompt content stripped on others'
/dashboard/explore                 ← lib/explore.ts + components/filters (group-by any rollup dimension, URL-state filters, CSV)
/dashboard/members/[key]           ← per-member drill-down (owner/admin: anyone; others: only themselves)
/dashboard/settings/allocation    ← allocation_rules (preview of the split)
/dashboard/coding-tools            ← coding_tool_usage (Claude Code Analytics, Cursor, Copilot) via lib/connectors
/welcome                          ← creates the free workspace after signup
```

---

## Monorepo Structure

```
tokenfin/                         ← root (control plane only)
├── web/                          ← Next.js app (UI + /api/v1/* routes)
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/           login, signup, forgot-password, reset-password
│   │   │   ├── (onboarding)/     onboarding wizard
│   │   │   ├── (dashboard)/
│   │   │   │   ├── layout.tsx    Sidebar + Topbar wrapper
│   │   │   │   └── dashboard/
│   │   │   │       ├── page.tsx                        Overview (server)
│   │   │   │       ├── projects/{page,_client}.tsx
│   │   │   │       ├── teams/{page,_client}.tsx
│   │   │   │       ├── keys/{page,_client}.tsx
│   │   │   │       ├── limits/{page,_client}.tsx
│   │   │   │       ├── alerts/{page,_client,_types}.tsx
│   │   │   │       ├── integrations/{page,_client,_types}.tsx
│   │   │   │       ├── mcp/{page,_client,_types}.tsx
│   │   │   │       ├── models/{page,_client}.tsx
│   │   │   │       ├── analytics/{page,_client,_types}.tsx
│   │   │   │       │   ├── models/{page,_client}.tsx
│   │   │   │       │   ├── projects/{page,_client}.tsx
│   │   │   │       │   └── costs/{page,_client}.tsx
│   │   │   │       └── settings/
│   │   │   │           ├── profile/{page,_client}.tsx
│   │   │   │           ├── notifications/{page,_client}.tsx
│   │   │   │           └── data/{page,_client}.tsx
│   │   │   └── api/v1/           All REST API routes
│   │   ├── components/
│   │   │   ├── dashboard/        Overview widgets
│   │   │   ├── layout/           Sidebar, Topbar
│   │   │   ├── onboarding/       Wizard step components
│   │   │   └── ui/               Design system primitives
│   │   ├── lib/
│   │   │   ├── supabase/
│   │   │   │   ├── server.ts     createClient() + createAdminClient()
│   │   │   │   └── client.ts     Browser createClient()
│   │   │   ├── utils.ts
│   │   │   └── tokenfin-sdk.ts
│   │   ├── hooks/
│   │   └── types/                db.ts, api.ts, index.ts
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   └── tsconfig.json
│
├── infra/
│   ├── docker/
│   │   ├── Dockerfile.web
│   │   └── docker-compose.yml
│   └── k8s/                      ← future K8s manifests
│
├── db/                           ← Supabase schema + migrations
├── docs/
├── .github/workflows/ci.yml      ← root (GitHub hard requirement)
├── CLAUDE.md
├── .gitignore
└── Makefile
```

### Working directory for web development
All `npm` commands run from `web/`:
```bash
cd web && npm run dev
# or from root:
make dev
```

---

## Operations & tests
- Logs: `lib/log.ts` (JSON lines, secrets masked). Errors: `lib/monitoring.ts` → Sentry envelope API when `SENTRY_DSN` is set.
- Tests: `npx vitest run` (unit + route-auth in `src/app/api/_tests`), `npm run test:e2e` (Playwright smoke; authed specs need `E2E_EMAIL`/`E2E_PASSWORD`), `scripts/rls-check.sql`.
- CI applies every migration twice to a fresh Supabase (`scripts/ci-db-check.sh`), checks `db/` ↔ `supabase/` copies are byte-identical, runs the RLS check, web, SDK and CLI tests.
- `npm run gen:types` regenerates `src/types/supabase.ts` from the local DB. Runbook: `docs/OPERATIONS.md` (pg_cron alternative, opt-in `scripts/partition-usage-events.sql`).

## Mock Data Status
**Zero mock data** — all pages connected to real Supabase. If user has no data, empty states are shown with onboarding hints.

Previously removed:
- `DEMO_KEYS`, `DEMO_LIMITS`, `DEMO_RULES` — replaced with real DB queries
- `DEMO_TEAM`, `DEMO` arrays in dashboard widgets — replaced with empty states
- `placeholder()` in cost-chart (Math.random) — replaced with empty state
- Hardcoded trend percentages (+12.4%, +8.1%, +5.3%) — replaced with real prev30d comparison
- Hardcoded `DAILY` array in analytics/costs — replaced with usage_agg query
- Hardcoded `MODELS`, `PROJECTS`, `PLATFORMS` arrays in analytics pages
- `ALL_DAILY`, `MODELS`, `PROJECTS`, `PLATFORMS` in analytics/_client

---

## App shell
- Navigation lives in ONE place: `components/layout/nav-config.ts` (sidebar sections, ⌘K palette destinations + actions, topbar titles). Add every new page there.
- The topbar title is the page's single `<h1>`; in-page titles are `<h2>`.
- Mobile: below `md` the sidebar is an off-canvas dialog (`components/ui/dialog.tsx` focus trap + scroll lock). `?new=1` on keys / alerts / limits opens the create form.

## Design System

CSS custom properties (in `globals.css`):
```css
--fg, --fg-secondary, --fg-tertiary   /* text */
--bg, --bg-secondary, --bg-tertiary   /* backgrounds */
--border, --border-strong             /* borders */
--green, --green-bg                   /* success/teal */
--red, --red-bg                       /* danger */
--blue, --blue-bg                     /* info */
--amber, --amber-bg                   /* warning */
```

Utility classes: `btn-primary`, `btn-secondary`, `coral`, `teal`, `bg-coral`, `text-teal`

---

## Environment Variables Required
```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server-only, never expose to client
```
