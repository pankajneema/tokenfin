# TokenFin — End-to-End Test & System Report
_Generated 2026-06-27 against `main`. Live tests run on the configured Supabase dev project + local `next dev` (port 3001)._

---

## 0. TL;DR

| Area | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ 0 errors |
| Lint (`next lint`) | ✅ 0 errors / 0 warnings |
| Web production build (`next build`) | ✅ success, 310 routes compiled |
| Go backend build (`go build ./...`) | ✅ success (ingest + worker + shared) |
| Auth / route guards (live) | ✅ ingest 401s on no/bad key; `/dashboard` redirects to `/login`; org routes verify membership server-side |
| Ingest happy-path (live, 12 events) | ✅ all accepted, `usage_events` written |
| **`usage_agg` accumulation (live)** | ❌ **CRITICAL — counts/cost/tokens are overwritten, not summed** |

**One blocker found.** Everything compiles and the request path works, but **daily aggregates are silently corrupted**: the second+ event for any `(model, day)` overwrites the first instead of adding to it. Cost, token, and request totals on every analytics page are undercounted. Root cause + fix below (§4).

---

## 1. How to test as a real tester

### A. Automated end-to-end API test (recommended first)
A self-contained script seeds a temporary key, sends realistic events, verifies the writes, runs negative auth tests, and cleans up.

```bash
# Terminal 1
cd web && npm run dev          # serves on http://localhost:3001

# Terminal 2 (from repo root)
node scripts/e2e-test.mjs                 # 12 events, auto-pick org+project, cleans up
node scripts/e2e-test.mjs --n=50 --keep   # 50 events, keep the test key + data
node scripts/e2e-test.mjs --project=<uuid>
```
It reads creds from `web/.env.local` (service role) — no secrets are hardcoded.

### B. Manual browser walkthrough (QA script)
Sign in and click through in this order; at each page check that **real numbers** appear (or a proper empty state, never mock data).

1. **Auth** — `/signup` → confirm email → `/login`. Try a wrong password (expect inline error). `/forgot-password` sends a reset link.
2. **Onboarding** — create org + first project. Land on `/dashboard`.
3. **Keys** — `/dashboard/keys` → "Create key". Copy the `tfk_…` value (shown once). Toggle active/revoke.
4. **Send data** — use the key with curl (§C) or the script (§A). Watch `/dashboard/keys` `last_used_at` update.
5. **Overview** — `/dashboard`: 4 KPI cards (cost/tokens/requests/engineers), cost chart, model breakdown, top projects, recent events. Trend % badges only appear with prior-period data.
6. **Projects** — `/dashboard/projects`: per-project cost, tokens, key count, last activity.
7. **Analytics** — `/dashboard/analytics` + `/models`, `/projects`, `/costs`, `/prompts`. Verify daily chart, model/project slices, prompt grouping.
8. **Teams** — `/dashboard/teams`: members, roles, cost attribution. Invite a member (`/api/v1/invites`).
9. **Limits** — `/dashboard/limits`: create a monthly budget; set warn/throttle/block %. Confirm "current spend %" reflects usage.
10. **Alerts** — `/dashboard/alerts`: create a rule; History tab shows fired notifications.
11. **Integrations / MCP** — `/dashboard/integrations`, `/dashboard/mcp`: connect/disconnect.
12. **Settings** — profile, notifications prefs, billing/plan.

**Key things to assert:** numbers on Overview == sum on Analytics for the same window; revoked key → ingest returns 401; a project with no data shows an empty state with the ingest hint, not zeros-as-mock.

### C. Raw curl
```bash
# health
curl http://localhost:3001/api/v1/ingest

# ingest one event
curl -X POST http://localhost:3001/api/v1/ingest \
  -H "Authorization: Bearer tfk_prod_xxxx_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","input_tokens":1200,"output_tokens":350,
       "tags":{"feature":"chat"},"metadata":{"prompt_hash":"abc","latency_ms":740}}'
# → {"ok":true,"model":"...","total_tokens":1550,"cost_usd":...,"bucket":"YYYY-MM-DD","source":"direct"}

# negative: no auth → 401, bad key → 401
curl -X POST http://localhost:3001/api/v1/ingest -d '{}'                          # 401
curl -X POST http://localhost:3001/api/v1/ingest -H "Authorization: Bearer tfk_nope" -d '{"model":"gpt-4o"}'  # 401
```
`cost_usd` is optional — omit it and the server computes from its pricing catalog (Opus 4.8 $15/$75 per 1M; Sonnet 4.6 $3/$15; GPT-4o $2.50/$10; unknown → $2/$8). You may also send `total_tokens` alone; it's split 70/30 input/output.

---

## 2. Architecture (end-to-end)

```
Client SDK / curl
   │  POST /api/v1/ingest   Authorization: Bearer tfk_...
   ▼
Next.js route (web/src/app/api/v1/ingest/route.ts)
   │  if INGEST_SERVICE_URL set → proxy to Go ingest (4s timeout), else ↓ direct
   │  directIngest():
   │   1. sha256(key) → api_keys.key_hash lookup (is_active, not expired)
   │   2. rate limit (plan-aware, Upstash)
   │   3. validate + compute cost (catalog) + IST bucket date
   │   4. INSERT usage_events
   │   5. rpc upsert_usage_agg(...)  ── fallback → usage_agg.upsert()   ◀── BUG (§4)
   │   6. api_keys.last_used_at = now
   │   7. checkLimitsAndNotify() (async, non-blocking) → notifications
   ▼
Supabase Postgres
   usage_events (raw, 1/req)  ──aggregates──▶  usage_agg (daily by org,project,model,bucket)
                                                      │
   Dashboard pages (server components) read usage_agg/usage_events ─▶ KPIs, charts, slices

Go backend (optional high-throughput path, port 8001)
   ingest  → validate → Redis stream usage.events.raw
   worker  → consumer (bulk insert events + upsert agg)
           → limits_sync (every 2m → Redis)
           → alert_consumer (usage.alerts → notifications)
           → reconciler (every 5m, fixes Redis↔DB drift >1%)
```

### Auth model
- **API keys:** `tfk_{env}_{projslug4}_{16-byte hex}`. Stored as `key_hash` = SHA-256 (raw never stored except `key_prefix` for display). Same hashing in Next.js and Go.
- **Dashboard/API routes:** Supabase SSR session → `requireOrgMember(orgId)` verifies `auth.getUser()` then membership in `members` (admin client for the check). Admin-only routes add `requirePermission`. Guards live in `web/src/lib/api/auth.ts`. _(Note: routes return `400 org_id required` before `401` when the query param is missing — cosmetic ordering, not a hole; membership is still enforced when a real org_id is supplied.)_

### Data tables (central ones)
- `usage_events` — immutable per-request log; carries `tags`, `metadata` (prompt_hash, latency_ms). RLS: members read; service-role writes.
- `usage_agg` — pre-aggregated daily `(org_id, project_id, model, bucket DATE)`; columns `total_tokens, cost_usd, request_count`. **Every analytics page reads this.**
- Plus `organizations`(+`orgs` view), `projects`, `teams`, `members`, `api_keys`, `limits`, `alert_rules`, `notifications`, `org_integrations`, `user_preferences`, `invitations`, `model_prices`, `budget_requests`, `blocks`.

### Time zone
Buckets are computed in **IST (UTC+5:30)** in both the app and migration 010. Stored timestamps are UTC; bucketing happens in the app layer. (Tester note: events near IST midnight land on the IST calendar day, which can look "off by one" vs UTC.)

---

## 3. Live test results (evidence)

Build/static (from this run):
```
tsc --noEmit ............ No errors found
next lint ............... Errors: 0 | Warnings: 0
next build ............. ✓ compiled, 310 routes (api/v1/* + all dashboard pages)
go build ./... ......... Success (ingest, worker, shared)
```

Runtime smoke (localhost:3001):
```
GET  /api/v1/ingest .................... 200
POST /api/v1/ingest (no auth) ......... 401 {"error":"Authorization: Bearer <api_key> required"}
POST /api/v1/ingest (bad key) ......... 401 {"error":"Invalid API key"}
GET  /dashboard (unauth) .............. 307 → /login
GET  /login ........................... 200
```

`scripts/e2e-test.mjs` (12 events, org "Pankaj neema/test"):
```
✓ created test key
✓ 12/12 events accepted (total cost ~$0.2219)
✓ usage_events grew by 12 (expected ≥ 12)
✓ usage_agg has 5 rows for 2026-06-27, request_count sum = 5     ◀── should be 12
✗ request_count sum 5 < 12 — upsert overwriting instead of incrementing
✓ no-auth → 401
✓ bad-key → 401
✓ test key deleted
```
Inspecting the agg rows directly: every `(model, 2026-06-27)` row has `request_count = 1` and token/cost values equal to **only the last event** for that model — earlier events' tokens/cost are lost.

---

## 4. 🔴 CRITICAL BUG — `usage_agg` overwrites instead of accumulating

**Symptom.** Sending 12 events across 5 models produced 5 agg rows each with `request_count = 1`; `total_tokens`/`cost_usd` matched only the most recent event per model. All analytics totals (cost, tokens, requests) are therefore undercounted whenever a model gets >1 event in a day.

**Root cause (confirmed live).** The RPC call fails and the JS fallback does last-write-wins:
- Calling `rpc('upsert_usage_agg', …)` returns **HTTP 300 `PGRST203` — "Could not choose the best candidate function"**: the database has **two overloaded `upsert_usage_agg` definitions** (the old `p_bucket TIMESTAMPTZ` and the new `DATE`). PostgREST can't disambiguate, so the RPC always errors.
- The route then hits its fallback at [web/src/app/api/v1/ingest/route.ts:228-239](web/src/app/api/v1/ingest/route.ts#L228-L239), which calls `usage_agg.upsert({... request_count: 1})`. Supabase `.upsert()` is **INSERT … ON CONFLICT DO UPDATE with the literal values** — it *replaces* `total_tokens`, `cost_usd`, `request_count` rather than adding. So each subsequent event for the same key clobbers the prior totals.

**Why it exists.** Migrations `009_fix_upsert_usage_agg.sql` (canonical `DATE` signature + `org_id` in the conflict target) and `010_recompute_usage_agg_from_events.sql` (rebuild from raw events) are present in `db/migrations/` **but are untracked/unapplied** to this database, and the old function was never dropped — leaving the ambiguous overload.

**Fix (in order):**
1. **DB:** `DROP FUNCTION` the stale `upsert_usage_agg(… TIMESTAMPTZ …)` overload, then apply `009` so exactly one `(…, p_bucket DATE, …)` function exists with `ON CONFLICT (org_id, project_id, model, bucket) DO UPDATE SET total_tokens = usage_agg.total_tokens + EXCLUDED…` (increment).
2. **DB:** apply `010` to recompute historical `usage_agg` from `usage_events` (existing data is already corrupted).
3. **App (defense-in-depth):** the fallback at route.ts:228 must not last-write-wins. Either remove it (force the RPC to be the only path) or make it read-modify-write / increment. As written it masks RPC failures with silent data loss.
4. **Verify:** re-run `node scripts/e2e-test.mjs` → `request_count sum` should equal events sent, and the `✗` line should turn green.

**Note:** the Go worker path (`upsert_usage_agg_batch`) uses `ON CONFLICT (bucket, project_id, model)` — **missing `org_id`** in the conflict target. If two orgs ever share a `(bucket, project_id, model)` (won't happen with UUID project_ids, but the unique index on the table is `(org_id, project_id, model, bucket)`) this conflict target won't match the index and the batch upsert will error. Align it to the 4-column target when fixing.

---

## 5. Other findings (non-blocking)

| Sev | Finding | Where |
|---|---|---|
| Med | `throttle_at` threshold is configurable on limits but never enforced — only `block_at` hard-stops. "Throttle" is UI-only today. | limits + ingest |
| Med | API key `scopes` column exists but is not checked by any endpoint — any active key can call any key-authed route. | ingest/route auth |
| Low | Limit warn/alert notifications dedupe **per calendar day** only; an org at the threshold re-fires once after IST midnight. No per-rule cooldown on ingest-side checks. | ingest checkLimitsAndNotify |
| Low | Limits page had `spentUsd: 0 // until usage_agg is wired` — confirm it's now sourced from `usage_agg` after the §4 fix. | limits/page.tsx |
| Low | Invitation emails go through `auth.admin.inviteUserByEmail()` (magic link) — no custom template; silently continues if the user already exists. | invites route |
| Low | Reconciler resets Redis counters on >1% drift with no audit log of the correction. | backend worker reconciler |
| Info | Route guards return `400 org_id required` before `401 Unauthorized` when the param is absent (ordering only; membership still enforced). | lib/api/auth.ts |
| Info | Many untracked migrations (005–010) + `db_reset.sql` + `ARCHITECTURE_PHASE1.md` + `backend/internal/worker/Untitled-1.md` in working tree — decide what to commit. | git status |

---

## 6. What was verified clean
- Full TS typecheck, lint, and production build of the web app (310 routes).
- Go backend compiles (ingest, worker, shared).
- Ingest auth: rejects missing + invalid keys (401); accepts valid keys; updates `last_used_at`.
- `usage_events` is written correctly (1 row per request, tokens/cost/tags/metadata intact).
- Dashboard is gated (unauth → `/login`); org API routes verify session + membership.
- Cost computation from the pricing catalog works (cost returned per event).
- No mock/demo data observed leaking into pages (per CLAUDE.md "zero mock data" rule).

> The single must-fix before trusting any dashboard number is §4. Re-run `scripts/e2e-test.mjs` after applying migrations 009 + 010 and patching the fallback — green there means end-to-end aggregation is trustworthy.
