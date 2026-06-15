# TokenFin Architecture

## Overview

TokenFin is a two-service application:

| Service   | Stack              | Port | Responsibility                               |
|-----------|--------------------|------|----------------------------------------------|
| **web**   | Next.js 14         | 3001 | UI, auth (Supabase SSR), lightweight API v1  |
| **api**   | Python FastAPI     | 8000 | Heavy processing, limits, alerts, scheduler  |

Both read/write the same **Supabase Postgres** database via the service-role key.

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
│   │   ├── api/            Server-side helpers (auth, crypto)
│   │   ├── supabase/       Browser + server clients
│   │   ├── constants.ts    App-wide constants
│   │   └── utils.ts        Pure utility functions
│   └── types/
│       ├── db.ts           DB row types (mirrors schema.sql)
│       └── api.ts          API wire types
├── backend/                Python FastAPI
│   ├── app/
│   │   ├── main.py         FastAPI app + lifespan
│   │   ├── core/           Config, DB client, logging
│   │   ├── api/            Route handlers + deps.py
│   │   ├── models/         Pydantic schemas
│   │   ├── services/       Business logic
│   │   └── workers/        APScheduler background jobs
│   ├── tests/
│   └── pyproject.toml
├── db/
│   ├── migrations/         Numbered SQL migrations
│   ├── schema.sql          Full schema reference
│   └── functions.sql       Postgres functions
└── .github/workflows/      CI (type-check + lint + tests)
```

## Data Flow

```
User LLM call
    ↓
TokenFin SDK (fire-and-forget, 2s timeout, circuit breaker)
    ↓
POST /api/v1/ingest (Next.js route handler)
    ↓
Validates API key (SHA-256 lookup) → Calculates cost → Inserts usage_event
    ↓ (fire-and-forget)
upsert_usage_agg() RPC → usage_agg table (pre-aggregated for fast dashboard)

Background (Python scheduler, every 1 min):
    alert_engine.evaluate_rules() → check thresholds/anomalies → dispatch()
```

## Auth Flow

1. User signs in via Supabase Auth (GitHub OAuth or email)
2. `/auth/callback` exchanges code for session cookie
3. Middleware reads cookie on every request → protects `/dashboard`
4. Dashboard layout checks `members` table → redirects to `/onboarding` if no org
5. API routes call `requireAuth()` → 401 if no session

## API Versioning

All Next.js API routes live under `/api/v1/`. When breaking changes are needed, 
add `/api/v2/` alongside without touching v1.
