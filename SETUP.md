# TokenFin — Developer Setup Guide

Complete runbook to get every service running locally from scratch.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & Environment](#2-clone--environment)
3. [Supabase Setup](#3-supabase-setup)
4. [Service 1 — Redis](#4-service-1--redis)
5. [Service 2 — Go Ingest Service](#5-service-2--go-ingest-service)
6. [Service 3 — Go Worker Service](#6-service-3--go-worker-service)
7. [Service 4 — Next.js Web App](#7-service-4--nextjs-web-app)
8. [TypeScript SDK](#8-typescript-sdk)
9. [Python SDK](#9-python-sdk)
10. [All Services via Docker Compose](#10-all-services-via-docker-compose)
11. [Verify Everything is Working](#11-verify-everything-is-working)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

Install these tools before anything else.

### Required

| Tool | Min Version | Install |
|---|---|---|
| **Node.js** | 18.x | https://nodejs.org or `nvm install 18` |
| **Go** | 1.23 | https://go.dev/dl |
| **Docker Desktop** | 24+ | https://www.docker.com/products/docker-desktop |
| **Git** | any | https://git-scm.com |

### Optional (for local non-Docker development)

| Tool | Purpose | Install |
|---|---|---|
| **Redis CLI** | Inspect Redis keys | Bundled with Docker Redis |
| **Supabase CLI** | Run migrations, generate types | `npm install -g supabase` |
| **Python 3.9+** | Python SDK development | https://python.org |

### Verify installations

```bash
node  --version   # v18.x.x or higher
go    version     # go1.23.x
docker --version  # Docker version 24.x.x
git   --version   # git version 2.x.x
```

---

## 2. Clone & Environment

### Clone the repo

```bash
git clone https://github.com/your-org/tokenfin.git
cd tokenfin
```

### Set up environment files

The project uses three env files. Start by copying the examples:

```bash
# Root — used by Docker Compose and Go services
cp .env.example .env

# Web — used by Next.js dev server
cp web/.env.local.example web/.env.local
```

### Fill in required values

Open `.env` and set:

```bash
# .env

# ── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...   # Settings → API → service_role key

# ── Supabase public (safe for browser) ──────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...   # Settings → API → anon key

# ── Redis (leave as-is for local Docker dev) ─────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── Ports ────────────────────────────────────────────────────────────────────
INGEST_PORT=8001
WORKER_PORT=8002
WEB_PORT=3000

# ── Runtime ───────────────────────────────────────────────────────────────────
ENV=development

# ── Internal service URL (Next.js → Go proxy) ─────────────────────────────────
INGEST_SERVICE_URL=http://localhost:8001
```

Open `web/.env.local` and set the same Supabase values:

```bash
# web/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
INGEST_SERVICE_URL=http://localhost:8001

# Optional — enables SDK tracking from the web app itself
NEXT_PUBLIC_TOKENFIN_API_KEY=tf_live_your_key
```

> **Never commit `.env` or `.env.local`** — they are already in `.gitignore`.

---

## 3. Supabase Setup

You need a Supabase project. Create a free one at https://supabase.com.

### Run migrations

Migrations are in `db/migrations/` and must be run in order.

**Option A — Supabase Dashboard (recommended for first setup):**

1. Open your project → SQL Editor.
2. Run each file in `db/migrations/` in ascending order:

```
db/migrations/
├── 001_initial_schema.sql       ← run first
├── 002_usage_agg.sql
├── 003_limits.sql
├── 004_alerts.sql
├── 005_integrations.sql
└── 006_rpc_upsert_agg.sql      ← run last
```

**Option B — Supabase CLI:**

```bash
# Link to your project (run once)
npx supabase link --project-ref your-project-ref

# Push all migrations
npx supabase db push
```

### Verify schema

In the Supabase Table Editor, confirm these tables exist:

```
orgs, projects, members, teams, api_keys,
usage_events, usage_agg, limits, alert_rules,
notifications, org_integrations, user_preferences
```

### Enable Row Level Security

RLS is enabled in the migration scripts. Verify in the Authentication → Policies section that each table has policies.

### Generate TypeScript types (optional)

Keep `web/src/types/db.ts` in sync with your schema:

```bash
make gen-types
# or:
npx supabase gen types typescript \
  --project-id your-project-ref \
  > web/src/types/db.ts
```

---

## 4. Service 1 — Redis

Redis is the message bus between the Ingest and Worker services. It must be running before either Go service starts.

### Start Redis via Docker (easiest)

```bash
make docker-redis
# or directly:
docker compose -f infra/docker/docker-compose.yml up redis -d
```

Verify it is running:

```bash
docker ps | grep redis
# redis   redis:7-alpine   Up X seconds   0.0.0.0:6379->6379/tcp
```

Test the connection:

```bash
docker exec -it $(docker ps -qf name=redis) redis-cli ping
# PONG
```

### Alternative — Redis installed locally

```bash
# macOS
brew install redis && brew services start redis

# Ubuntu / Debian
sudo apt install redis-server && sudo systemctl start redis

# Verify
redis-cli ping   # PONG
```

---

## 5. Service 2 — Go Ingest Service

The Ingest Service validates API keys, checks limits, and publishes events to Redis Streams. It runs on port `8001`.

### Prerequisites check

```bash
go version        # go1.23.x
redis-cli ping    # PONG  (Redis must be running first)
```

### Install Go dependencies

```bash
cd backend
go mod download   # downloads all dependencies
```

### Start the service

```bash
# Option A — using make (from repo root)
make go-ingest

# Option B — directly
cd backend
go run ./cmd/ingest

# Option C — build binary first, then run
make go-build
./backend/bin/ingest
```

Expected output:

```
{"time":"...","level":"INFO","msg":"ingest service started","port":"8001","env":"development"}
```

### Verify it is healthy

```bash
curl http://localhost:8001/health
# {"ok":true}
```

### Environment variables required

The service reads from the shell environment. Export from `.env` before running:

```bash
export $(grep -v '^#' .env | xargs)
cd backend && go run ./cmd/ingest
```

Or use `direnv` — place an `.envrc` at the repo root:

```bash
dotenv .env
```

---

## 6. Service 3 — Go Worker Service

The Worker Service reads from the Redis stream, writes events to Supabase, fires alerts, and keeps Redis counters in sync. It runs on port `8002`.

> **The Ingest Service and Redis must already be running before starting the Worker.**

### Start the service

```bash
# Option A — using make (from repo root)
make go-worker

# Option B — directly
cd backend
go run ./cmd/worker

# Option C — after building
./backend/bin/worker
```

Expected startup output (in order):

```
{"level":"INFO","msg":"worker started","env":"development"}
{"level":"INFO","msg":"limits sync started","interval":"2m0s"}
{"level":"DEBUG","msg":"limits synced","total":0,"synced":0}
{"level":"INFO","msg":"consumer started","name":"worker-0"}
{"level":"INFO","msg":"alert consumer started"}
{"level":"INFO","msg":"reconciler started","interval":"5m0s"}
```

### Verify it is processing

Send a test ingest event (requires a valid API key — create one in the web dashboard):

```bash
curl -X POST http://localhost:8001/v1/ingest \
  -H "Authorization: Bearer tf_live_your_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","input_tokens":100,"output_tokens":50}'

# Expected: HTTP 202 Accepted
```

Within a second you should see the worker log:

```
{"level":"DEBUG","msg":"batch written","events":1,"acked":1}
```

---

## 7. Service 4 — Next.js Web App

The web app is the main dashboard. It also acts as a BFF (Backend-For-Frontend) proxy for the ingest endpoint.

### Install dependencies

```bash
# Option A — using make
make install

# Option B — directly
cd web && npm install
```

### Start the dev server

```bash
# Option A — using make
make dev

# Option B — directly
cd web && npm run dev
```

The app starts on **https://tokenfin.curiousdevs.com**.

Expected output:

```
▲ Next.js 14.x.x
- Local:        https://tokenfin.curiousdevs.com
- Environments: .env.local
✓ Ready in 2.1s
```

### Verify the web app

Open https://tokenfin.curiousdevs.com in your browser. You should see the login page.

Sign up with an email address and complete the onboarding wizard:
1. Create your organisation
2. Create your first project
3. (Optional) invite team members

### TypeScript type check

Confirm zero type errors before committing:

```bash
make typecheck
# or:
cd web && npm run typecheck
```

---

## 8. TypeScript SDK

The `@tokenfin/sdk` package lives in `sdk/`. You can develop against it locally by linking it.

### Install and build

```bash
# Install dependencies
make sdk-install
# or: cd sdk && npm install

# Build (CJS + ESM + .d.ts)
make sdk-build
# or: cd sdk && npm run build
```

### Type check

```bash
make sdk-typecheck
# or: cd sdk && npm run typecheck
```

### Use the SDK locally in your project

```bash
# In your application directory:
npm install /absolute/path/to/tokenfin/sdk
```

Or link globally for development:

```bash
cd sdk && npm link
# Then in your app:
npm link @tokenfin/sdk
```

### Quick test

```typescript
import { createTokenFin } from '@tokenfin/sdk'

const tf = createTokenFin({
  apiKey:  'tf_live_your_key',
  baseUrl: 'https://tokenfin.curiousdevs.com',  // point at local Next.js
  debug:   true,
})

tf.track({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 })
await tf.flush()
```

---

## 9. Python SDK

The Python SDK lives in `sdk/python/`.

### Install for development

```bash
# Option A — using make
make sdk-py-install

# Option B — directly
cd sdk/python
pip install -e ".[dev]"
```

This installs the package in editable mode plus test dependencies.

### Run tests

```bash
# Option A — using make
make sdk-py-test

# Option B — directly
cd sdk/python && python -m pytest tests/ -v
```

Expected output:

```
collected 9 items

tests/test_client.py::TestTokenFinClientTrack::test_queue_drops_oldest_when_full PASSED
tests/test_client.py::TestTokenFinClientTrack::test_tags_and_metadata_included PASSED
... (9 passed)
```

### Quick test

```python
from tokenfin import TokenFinClient

tf = TokenFinClient(
    api_key="tf_live_your_key",
    base_url="https://tokenfin.curiousdevs.com",   # point at local Next.js
    debug=True,
)

tf.track(model="gpt-4o", input_tokens=100, output_tokens=50)
tf.flush()
```

### Async client test (requires aiohttp)

```bash
pip install "tokenfin[async]"
```

```python
import asyncio
from tokenfin import AsyncTokenFinClient

async def main():
    tf = AsyncTokenFinClient(api_key="tf_live_your_key", base_url="https://tokenfin.curiousdevs.com")
    await tf.track(model="gpt-4o", input_tokens=100, output_tokens=50)
    await tf.flush()

asyncio.run(main())
```

---

## 10. All Services via Docker Compose

The simplest way to run the full stack is Docker Compose. This starts Redis, the Go ingest service, the Go worker service, and the Next.js web app in the correct order.

### Prerequisites

- Docker Desktop is running.
- `.env` is filled in (Step 2).

### Start everything

```bash
# Background (detached)
make docker-up

# Foreground with live logs (good for debugging)
make docker-up-fg
```

This runs: **redis → ingest → worker → web** (each waits for the previous to be healthy).

### Check all services are healthy

```bash
docker ps
```

You should see 4 containers:

```
NAME              STATUS
tokenfin-web      Up X seconds (healthy)
tokenfin-worker   Up X seconds
tokenfin-ingest   Up X seconds (healthy)
redis             Up X seconds (healthy)
```

### View logs

```bash
make docker-logs
# or for a single service:
docker compose -f infra/docker/docker-compose.yml logs -f ingest
```

### Stop and clean up

```bash
# Stop containers, remove volumes
make docker-down

# Stop without removing volumes (preserves Redis data)
docker compose -f infra/docker/docker-compose.yml down
```

### Rebuild after code changes

```bash
make docker-up
# docker compose automatically rebuilds changed images
```

---

## 11. Verify Everything is Working

Run this sequence to confirm the full pipeline is operational:

### 1. Create an API key

1. Open https://tokenfin.curiousdevs.com and log in.
2. Go to **Settings → API Keys → New Key**.
3. Select your project and copy the key (`tf_live_...`).

### 2. Send a test event

```bash
curl -X POST https://tokenfin.curiousdevs.com/api/v1/ingest \
  -H "Authorization: Bearer tf_live_your_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","input_tokens":800,"output_tokens":120,"tags":{"env":"dev"}}'

# Expected: 202 Accepted
```

### 3. Check worker logs

```bash
# If running via make:
# Watch the terminal where you ran make go-worker

# If running via Docker:
make docker-logs
```

Look for:

```
{"level":"DEBUG","msg":"batch written","events":1,"acked":1}
```

### 4. Check the dashboard

Open https://tokenfin.curiousdevs.com/dashboard — within a few seconds you should see:

- The KPI cards update with token count and cost.
- The recent events table shows your test event.
- The analytics pages show the model breakdown.

### 5. Run all CI checks locally

```bash
make check
```

This runs:
- `go vet ./...` (Go static analysis)
- `npm run typecheck` (TypeScript — zero errors required)
- `npm run typecheck` (SDK TypeScript)
- `python -m pytest tests/ -v` (Python SDK — 9 tests)

---

## 12. Troubleshooting

### Redis connection refused

```
Error: redis ping failed: dial tcp 127.0.0.1:6379: connect: connection refused
```

**Fix:** Start Redis first — `make docker-redis` or `brew services start redis`.

---

### Go: missing required env vars

```
config error: missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

**Fix:** Export env vars before running Go services:

```bash
export $(grep -v '^#' .env | xargs)
```

---

### Next.js: NEXT_PUBLIC_SUPABASE_URL is not set

**Fix:** Ensure `web/.env.local` exists and contains both Supabase variables. Restart the dev server.

---

### Ingest returns 401

```json
{"error": "invalid api key"}
```

**Fix:** The API key is wrong, expired, or inactive. Check Settings → API Keys.

---

### Worker not writing to Supabase

Check the worker logs for errors. Common causes:

1. **Wrong `SUPABASE_URL`** — must be `https://your-project.supabase.co`, not the dashboard URL.
2. **Wrong `SUPABASE_SERVICE_ROLE_KEY`** — use the `service_role` key, not the `anon` key.
3. **Migrations not run** — the `usage_events` or `usage_agg` table doesn't exist.

---

### Docker: port already in use

```
Error: bind: address already in use
```

**Fix:** Stop whatever is using the port:

```bash
# Find the PID using port 3000:
lsof -i :3000
kill -9 <PID>
```

Or change the port in `.env` (e.g. `WEB_PORT=3001`).

---

### TypeScript: tsc reports errors

```bash
cd web && npm run typecheck
```

Common causes:
- `web/src/types/db.ts` is stale — run `make gen-types`.
- Missing `web/.env.local` causing type inference issues.

---

### Python SDK: `BackendUnavailable` on install

```bash
pip install setuptools --upgrade
cd sdk/python && pip install -e ".[dev]"
```

---

## Quick Reference

```bash
# Full stack (Docker)
make docker-up       # start all 4 services
make docker-down     # stop and remove

# Individual services (local)
make docker-redis    # Redis only
make go-ingest       # Go Ingest Service (requires Redis)
make go-worker       # Go Worker Service (requires Redis + DB)
make dev             # Next.js web app

# SDK
make sdk-build       # build TypeScript SDK
make sdk-py-test     # run Python SDK tests

# Quality checks
make check           # go vet + typecheck + sdk-typecheck + py-test

# Logs (Docker)
make docker-logs
```

---

*Questions? Open an issue or ping the #tokenfin-dev channel.*
