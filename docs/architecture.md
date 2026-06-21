# TokenFin Architecture

## Overview

TokenFin is a single Next.js application — UI + API routes in one service, backed by Supabase Postgres.

| Service | Stack      | Port | Responsibility                              |
|---------|------------|------|---------------------------------------------|
| **web** | Next.js 14 | 3001 | UI, auth (Supabase SSR), REST API v1        |

## Folder Structure

```
tokenfin/
├── src/                    Next.js source (App Router)
│   ├── app/                Routes + layouts
│   │   ├── (auth)/         Login / signup
│   │   ├── (dashboard)/    Protected dashboard
│   │   ├── (onboarding)/   First-run wizard
│   │   └── api/v1/         REST API routes (versioned)
│   ├── components/
│   │   ├── ui/             Primitive components (Button, Input, Badge…)
│   │   ├── layout/         Sidebar, Topbar
│   │   ├── dashboard/      Feature components
│   │   └── onboarding/     Wizard steps
│   ├── hooks/              Client-side SWR hooks
│   ├── lib/
│   │   ├── supabase/       Browser + server clients
│   │   ├── utils.ts        Pure utility functions
│   │   └── tokenfin-sdk.ts SDK wrapper for POST /api/v1/ingest
│   └── types/
│       ├── db.ts           DB row types (mirrors schema.sql)
│       └── api.ts          API wire types
├── db/
│   ├── migrations/         Numbered SQL migrations
│   ├── schema.sql          Full schema reference
│   └── functions.sql       Postgres functions
├── docs/                   Architecture docs
├── CLAUDE.md               AI session reference
└── .github/workflows/      CI (type-check + lint)
```

## Data Flow

```
User LLM call
    ↓
TokenFin SDK (fire-and-forget, 2s timeout, circuit breaker)
    ↓
POST /api/v1/ingest  (Next.js route handler)
    ↓
Validates API key (SHA-256 lookup) → Calculates cost → Inserts usage_event
    ↓ (fire-and-forget)
upsert_usage_agg() RPC → usage_agg table (pre-aggregated for fast dashboard)
```

## Auth Flow

1. User signs in via Supabase Auth (GitHub OAuth or email)
2. `/auth/callback` exchanges code for session cookie
3. Middleware reads cookie on every request → protects `/dashboard`
4. Dashboard layout checks `members` table → redirects to `/onboarding` if no org
5. API routes call `requireAuth()` → 401 if no session

## API Versioning

All API routes live under `/api/v1/`. When breaking changes are needed,
add `/api/v2/` alongside without touching v1.

## Go Backend (Planned)

A separate Go service will be added for high-throughput ingest and background jobs:
- High-throughput `POST /ingest` (10k+ req/sec)
- Alert rule evaluation (cron every 1 min)
- Usage aggregation worker
- Single binary deployment, low memory footprint
