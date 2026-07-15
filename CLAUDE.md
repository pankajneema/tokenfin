# TokenFin — CLAUDE.md
> Architecture reference for AI sessions. Keep this updated when adding pages, tables, or API routes.

## What is TokenFin
LLM Cost Attribution & FinOps platform. Tracks API usage (tokens, cost, requests) across projects, models, and team members. Built with Next.js 14 App Router + Supabase.

---

## Tech Stack
- **Framework**: Next.js 14 App Router, TypeScript strict, `src/` directory
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
| `orgs` | `id, name, slug, plan` | billing settings, onboarding |
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

### `usage_agg` is the central analytics table
- Pre-aggregated daily by `(org_id, project_id, model, bucket)`
- Written by the ingest pipeline when usage events arrive
- Query with `.gte('bucket', since30)` for 30-day windows

---

## API Routes (`/src/app/api/v1/`)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/v1/ingest` | POST | API key header | Write usage events → upsert usage_agg |
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
| `/api/v1/invites` | POST | Admin | Send member invites |
| `/api/v1/provision` | POST | Admin | Bulk onboard members + auto-generate keys (one-time reveal links) + service accounts |
| `/api/v1/keys/reveal` | POST | Token (single-use) | Reveal a provisioned raw key exactly once |
| `/api/mcp` | POST | API key (Bearer, read) | Remote MCP server — Streamable HTTP, JSON-RPC, read-only FinOps tools |
| `/api/otel/v1/logs` | POST | API key (Bearer) | **OTLP receiver — per-turn usage.** Parses `*.api_request` log events → one usage_events row, deduped by `event_id`. JSON + protobuf. |
| `/api/otel/v1/metrics` | POST | API key (Bearer/`?key=`) | OTLP receiver — health checks + **Codex/Gemini capture**: derives per-turn rows by diffing cumulative counters (`lib/otlp/metrics.ts`, state in `otlp_metric_state`, migration 024). Claude Code metrics are NOT derived (its logs own those rows). |
| `/api/otel/v1/traces` | POST | API key (Bearer) | OTLP receiver — GenAI spans → spans/traces + usage mirror. |
| `/api/v1/connections` | GET | API key or session | Per-source connection status (last event, tokens today, cost_basis). Powers CLI `setup`/`status`/`doctor` + setup beacon. |
| `/auth/callback` | GET | — | Supabase OAuth callback |

### Key security model (IMPORTANT)
- API keys are stored ONLY as `key_hash` (SHA-256) + a **masked** `key_prefix` (e.g. `tfk_prod_abc1_…c05a`). The raw key is returned **once** in the POST response, never again.
- Bulk-provisioned keys are delivered via single-use, expiring, AES-256-GCM reveal links (`/keys/reveal/[token]`). Needs `KEY_ENCRYPTION_SECRET` env + migration 012 (`key_reveals` table, `api_keys.is_service_account`).
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
  never silently dropped.
- **Codex/Gemini (Phase 4, needs a real-session confirm)**: they report tokens only as metric
  counters. `otlp/metrics.ts` derives per-turn rows by cumulative-diffing (first-seen = baseline,
  emit nothing). `setup` writes `~/.codex/config.toml` (`[otel]`, user-level, `metrics_exporter=otlp-http`
  — NOT the statsig default) and `~/.gemini/settings.json` (telemetry; auth via `?key=` since Gemini
  can't set headers). Exact metric attribute names + temporality still need one real session to verify.

### MCP is read-only (query the dashboard from chat)
`web/src/lib/mcp/*` behind `web/src/app/api/mcp/route.ts` (Streamable HTTP, JSON-RPC, Bearer,
Origin guard). Tools:
- **Analytics (read):** list_projects, get_spend, get_usage_by_model, get_daily_costs, get_budget_status
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
/plans                        → orgs.plan

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
/dashboard/settings/billing       ← SERVER (orgs.plan)
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
│   │   │   │           └── billing/{page,_client}.tsx
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
├── backend/                      ← Go services
│   ├── ingest/                   ← high-throughput ingest (port 8001)
│   │   ├── main.go
│   │   └── go.mod
│   ├── worker/                   ← alerts + aggregation cron
│   │   ├── main.go
│   │   └── go.mod
│   └── shared/                   ← shared Go packages
│       ├── config/config.go
│       ├── models/event.go
│       └── db/
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
