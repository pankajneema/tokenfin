# TokenFin — Phase 1 Implementation Architecture
> CTO/System Architect reference. 4 priority items. UI → API → Backend/DB.

---

## Overview: Execution Order

```
1. RBAC             — 1 day    — blocks all paid customers
2. Rate Limiting    — 0.5 day  — blocks public launch
3. Prompt Analytics — 2 days   — core differentiator
4. First Event UX   — 0.5 day  — drives activation
```

Dependencies:
- Rate limiting has zero dependencies, ship it first (touches only ingest route)
- RBAC needs a shared `lib/rbac.ts` which Prompt Analytics can reuse
- First Event UX is standalone, can be done in parallel

---

## 1. RBAC — UI Enforcement

### Current State
- DB: `members.role` column exists → `owner | admin | member | viewer`
- DB: RLS policies check `role IN ('owner','admin')` for mutations ✅
- Gap: UI shows every button/page to everyone, API routes don't check role

### Architecture Decision
**Single source of truth: `lib/rbac.ts`**. Permission matrix lives here. Every page, every API route, every button imports from it. Never check role strings inline.

### Layer 1 — DB (already done, verify only)
```sql
-- Confirm roles are correctly scoped in 001_initial_schema.sql:
-- members.role CHECK (role IN ('owner','admin','member','viewer'))
-- RLS on api_keys, limits, alert_rules already checks ('owner','admin') ✅
-- Add missing RLS check on integrations if not present
```

### Layer 2 — Shared Permission Library
**New file: `web/src/lib/rbac.ts`**

```typescript
export type Role = 'owner' | 'admin' | 'member' | 'viewer'

// Permission matrix — single source of truth
export const PERMISSIONS = {
  // Projects
  'projects:create':       ['owner', 'admin'],
  'projects:delete':       ['owner', 'admin'],
  // API Keys
  'keys:view':             ['owner', 'admin'],
  'keys:create':           ['owner', 'admin'],
  'keys:delete':           ['owner', 'admin'],
  // Members
  'members:invite':        ['owner', 'admin'],
  'members:remove':        ['owner'],
  'members:change_role':   ['owner'],
  // Limits & Alerts (create/edit — viewing is open to all)
  'limits:write':          ['owner', 'admin'],
  'alerts:write':          ['owner', 'admin'],
  // Billing — owner only, never admin
  'billing:view':          ['owner'],
  'billing:edit':          ['owner'],
  // Integrations
  'integrations:manage':   ['owner', 'admin'],
  // Org
  'org:delete':            ['owner'],
} as const

export type Permission = keyof typeof PERMISSIONS

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role)
}

// Helper for API routes — throws 403 if unauthorized
export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new Error('FORBIDDEN')
  }
}
```

### Layer 3 — Server Components (page.tsx pattern)

Add role fetch to every server page. Already fetching `org_id` — just add one more query:

```typescript
// In page.tsx — add this ONCE per page, reuse pattern:
const { data: member } = await supabase
  .from('members')
  .select('role')
  .eq('user_id', user.id)
  .eq('org_id', orgId)
  .single()

const role = (member?.role ?? 'viewer') as Role

// Pass to client:
return <KeysClient keys={keys} role={role} />
```

### Layer 4 — API Routes (all mutating routes)

**New helper: `web/src/lib/api/auth.ts`**

```typescript
import { createAdminClient } from '@/lib/supabase/server'
import { can, Role } from '@/lib/rbac'
import { NextRequest, NextResponse } from 'next/server'

// Returns { orgId, userId, role } or returns a 403 NextResponse
export async function requireRole(
  req: NextRequest,
  permission: keyof typeof PERMISSIONS
): Promise<{ orgId: string; userId: string; role: Role } | NextResponse> {
  const admin = createAdminClient()
  const { data: { user } } = await admin.auth.getUser(
    req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  )
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = req.headers.get('x-org-id') ?? ''
  const { data: member } = await admin
    .from('members')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .single()

  const role = (member?.role ?? 'viewer') as Role
  if (!can(role, permission)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return { orgId, userId: user.id, role }
}
```

Usage in every mutating API route:
```typescript
// POST /api/v1/keys
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'keys:create')
  if (auth instanceof NextResponse) return auth
  // ... rest of handler using auth.orgId
}
```

### Layer 5 — UI Components

**Pattern: pass `role` prop to every `_client.tsx`, gate buttons conditionally**

```tsx
// In _client.tsx — receive role prop
interface Props {
  role: Role
  // ... other props
}

// Gate any destructive/admin action:
{can(role, 'keys:create') && (
  <Button onClick={handleCreate}>Create API Key</Button>
)}

// Gate entire pages (in page.tsx server component):
if (!can(role, 'billing:view')) {
  redirect('/dashboard')
}
```

### Files to Touch
```
web/src/lib/rbac.ts                           ← NEW (permission matrix)
web/src/lib/api/auth.ts                       ← NEW (API route helper)
web/src/app/(dashboard)/dashboard/
  keys/page.tsx + _client.tsx                 ← add role fetch + gates
  limits/page.tsx + _client.tsx               ← add role fetch + gates
  alerts/page.tsx + _client.tsx               ← add role fetch + gates
  integrations/page.tsx + _client.tsx         ← add role fetch + gates
  teams/page.tsx + _client.tsx                ← add role fetch + gates
  settings/billing/page.tsx                   ← redirect if not owner
web/src/app/api/v1/
  keys/route.ts                               ← add requireRole('keys:create/delete')
  limits/route.ts                             ← add requireRole('limits:write')
  alerts/route.ts                             ← add requireRole('alerts:write')
  members/route.ts                            ← add requireRole('members:invite/remove')
  integrations/route.ts                       ← add requireRole('integrations:manage')
```

---

## 2. Rate Limiting on Ingest

### Current State
- `/api/v1/ingest` — no rate limiting
- API keys validated via SHA256 hash lookup in DB
- Anyone with valid key can flood ingest indefinitely

### Architecture Decision
**Upstash Redis + sliding window.** Reasons:
- Serverless-safe (no persistent connection, HTTP-based)
- Free tier: 10k requests/day, enough for dev
- `@upstash/ratelimit` library is 3 lines of code
- Per-key limiting (not per-IP — proxies would break IP limiting)

**Do NOT use in-memory** — Vercel spins up multiple instances, memory doesn't share across them.

### Layer 1 — Infrastructure
```
1. upstash.com → Create Redis database → copy REST URL + TOKEN
2. Vercel Dashboard → Add env vars:
   UPSTASH_REDIS_REST_URL=https://...
   UPSTASH_REDIS_REST_TOKEN=...
3. npm install @upstash/ratelimit @upstash/redis
```

### Layer 2 — Rate Limit Config (plan-aware)

**New file: `web/src/lib/ratelimit.ts`**

```typescript
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

// Per-plan limits (requests per minute)
export const PLAN_LIMITS: Record<string, number> = {
  free:       60,
  pro:        300,
  enterprise: 2000,
}

// One limiter per plan — created lazily
const limiters = new Map<string, Ratelimit>()

export function getRatelimiter(plan: string): Ratelimit {
  if (!limiters.has(plan)) {
    limiters.set(plan, new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(PLAN_LIMITS[plan] ?? 60, '1 m'),
      prefix: `tf:rl:${plan}`,
    }))
  }
  return limiters.get(plan)!
}
```

### Layer 3 — Ingest Route Change

In `web/src/app/api/v1/ingest/route.ts`, after API key validation:

```typescript
import { getRatelimiter } from '@/lib/ratelimit'

// After fetching org (already done for limit-check):
const plan = org?.plan ?? 'free'
const limiter = getRatelimiter(plan)
const identifier = `key:${apiKeyId}`  // per API key, not per IP

const { success, limit, remaining, reset } = await limiter.limit(identifier)

if (!success) {
  return NextResponse.json(
    { error: 'Rate limit exceeded. Upgrade your plan for higher limits.' },
    {
      status: 429,
      headers: {
        'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(reset).toISOString(),
      }
    }
  )
}
```

### Layer 4 — Go Service (backend/ingest/main.go)

When Go service is primary path, rate limit there too with token bucket per key stored in sync.Map:

```go
// Simple token bucket — good enough until Redis on Railway
type bucket struct {
  tokens   float64
  lastFill time.Time
  mu       sync.Mutex
}

var buckets sync.Map  // keyID → *bucket

func checkRateLimit(keyID string, ratePerMin float64) bool {
  v, _ := buckets.LoadOrStore(keyID, &bucket{tokens: ratePerMin, lastFill: time.Now()})
  b := v.(*bucket)
  b.mu.Lock()
  defer b.mu.Unlock()
  
  now := time.Now()
  elapsed := now.Sub(b.lastFill).Minutes()
  b.tokens = min(ratePerMin, b.tokens + elapsed*ratePerMin)
  b.lastFill = now
  
  if b.tokens < 1 { return false }
  b.tokens--
  return true
}
```

### Files to Touch
```
web/src/lib/ratelimit.ts                      ← NEW
web/src/app/api/v1/ingest/route.ts            ← add ~15 lines after key validation
backend/ingest/main.go                        ← add token bucket (optional, for Go path)
web/package.json                              ← add @upstash/ratelimit @upstash/redis
```

---

## 3. Prompt Analytics

### Architecture Overview
```
Proxy (captures) → ingest API (stores in metadata) → usage_events table
→ /api/v1/analytics/prompts (aggregates) → analytics/prompts page (displays)
```

Three principles:
1. **Privacy first** — never store raw prompt text, only hash + char count
2. **No schema change** — metadata JSONB column already exists in usage_events
3. **No new table** — aggregate on-the-fly from usage_events for now (< 1M rows fine)

### Layer 1 — Proxy Changes (`proxy/index.js`)

The proxy already has `input` and `output` token counts. Add latency + prompt fingerprint:

```javascript
// In track() function — add metadata params:
function track(model, inputTokens, outputTokens, metadata = {}) {
  if (!inputTokens && !outputTokens) return
  const payload = JSON.stringify({
    model: model || 'unknown',
    input_tokens:  inputTokens  || 0,
    output_tokens: outputTokens || 0,
    tags: { tool: 'codex' },
    metadata,         // ← NEW
  })
  // ... rest unchanged
}

// In HTTP handler — capture start time and request body:
clientReq.on('data', c => chunks.push(c))
clientReq.on('end', () => {
  const startTime = Date.now()       // ← capture here

  // ... existing parsing logic ...

  // After getting usage from response, pass metadata to track():
  const latency_ms = Date.now() - startTime
  
  // Prompt fingerprint (no raw text stored):
  const messages = parsed?.messages || parsed?.input || []
  const promptText = Array.isArray(messages)
    ? messages.map(m => typeof m.content === 'string' ? m.content : '').join('')
    : ''
  const promptChars = promptText.length
  const promptHash = djb2Hash(promptText)   // see below
  
  track(model, input, output, {
    latency_ms,
    prompt_chars: promptChars,
    prompt_hash: promptHash,
    messages_count: messages.length,
    has_system_prompt: messages.some(m => m.role === 'system'),
  })
})

// Hash function (no deps needed):
function djb2Hash(str) {
  let hash = 5381
  for (let i = 0; i < Math.min(str.length, 500); i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    hash = hash & 0xFFFFFFFF
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
```

Also sync this change to `web/public/proxy.js`.

### Layer 2 — Ingest Route (already passes metadata through)

Current ingest route already forwards `metadata` to usage_events. Verify the field lands correctly:
```typescript
// In route.ts fallback path — confirm metadata is in INSERT:
await admin.from('usage_events').insert({
  // ...
  metadata: body.metadata ?? {},   // ← should already be here
})
```

Add DB index for analytics queries:
```sql
-- New migration: db/migrations/005_prompt_analytics_indexes.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_events_prompt_hash
  ON usage_events ((metadata->>'prompt_hash'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_events_latency
  ON usage_events (org_id, ((metadata->>'latency_ms')::int));
```

### Layer 3 — New API Route

**New file: `web/src/app/api/v1/analytics/prompts/route.ts`**

```typescript
// GET /api/v1/analytics/prompts?org_id=...&days=30
// Returns: top prompt patterns by cost, avg latency P95, token ratios

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get('days') ?? '30')
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

  // Group by prompt_hash — find expensive/slow patterns
  const { data: rows } = await admin
    .from('usage_events')
    .select('model, total_tokens, cost_usd, metadata, created_at')
    .eq('org_id', orgId)
    .gte('created_at', since)
    .not('metadata->prompt_hash', 'is', null)

  // Aggregate in-process (JS) — group by prompt_hash
  const byHash = new Map<string, {
    hash: string
    count: number
    totalCost: number
    totalInputTokens: number
    totalOutputTokens: number
    latencies: number[]
    models: Record<string, number>
    promptChars: number
  }>()

  for (const row of rows ?? []) {
    const hash = row.metadata?.prompt_hash as string
    if (!hash) continue
    const existing = byHash.get(hash) ?? {
      hash, count: 0, totalCost: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      latencies: [], models: {}, promptChars: row.metadata?.prompt_chars ?? 0
    }
    existing.count++
    existing.totalCost += Number(row.cost_usd ?? 0)
    existing.totalInputTokens += Number(row.metadata?.input_tokens ?? 0)
    existing.totalOutputTokens += Number(row.metadata?.output_tokens ?? 0)
    if (row.metadata?.latency_ms) existing.latencies.push(Number(row.metadata.latency_ms))
    existing.models[row.model] = (existing.models[row.model] ?? 0) + 1
    byHash.set(hash, existing)
  }

  // Sort by total cost desc, compute P95 latency
  const results = [...byHash.values()]
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 50)
    .map(p => {
      const sorted = p.latencies.sort((a, b) => a - b)
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? null
      const avgLatency = sorted.length
        ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length)
        : null
      const ioRatio = p.totalOutputTokens > 0
        ? +(p.totalInputTokens / p.totalOutputTokens).toFixed(1)
        : null
      return {
        hash: p.hash,
        count: p.count,
        total_cost_usd: +p.totalCost.toFixed(4),
        avg_cost_usd: +(p.totalCost / p.count).toFixed(6),
        avg_input_tokens: Math.round(p.totalInputTokens / p.count),
        avg_output_tokens: Math.round(p.totalOutputTokens / p.count),
        io_ratio: ioRatio,          // > 3 = verbose prompt
        avg_latency_ms: avgLatency,
        p95_latency_ms: p95,
        prompt_chars: p.promptChars,
        top_model: Object.entries(p.models).sort((a,b) => b[1]-a[1])[0]?.[0],
      }
    })

  return NextResponse.json({ data: results })
}
```

### Layer 4 — New UI Page

**New files: `web/src/app/(dashboard)/dashboard/analytics/prompts/page.tsx` + `_client.tsx`**

```
page.tsx (server):
  - Fetch from /api/v1/analytics/prompts
  - Pass to client

_client.tsx metrics shown:
  ┌─────────────────────────────────────────────────────┐
  │  Top Expensive Prompt Patterns — Last 30 days        │
  ├──────────┬───────┬──────────┬──────────┬────────────┤
  │ Hash     │ Calls │ Total $  │ Avg Tok  │ P95 ms    │
  │ #a3f2b1  │  847  │ $23.40   │ 1,240    │ 2,100ms   │
  │ #cc8812  │  312  │  $8.10   │   890    │   980ms   │
  └──────────┴───────┴──────────┴──────────┴────────────┘

  Summary cards:
  - "847 identical requests — consider caching"    (count > 100 same hash)
  - "I/O ratio 4.2 — prompts may be too verbose"  (ratio > 3)
  - "Avg latency 2.1s on GPT-4 — try GPT-4o"     (latency > 2000ms)
```

Add to Sidebar nav under Analytics section: **Prompts** link.

### Files to Touch
```
proxy/index.js                                          ← add latency + hash + metadata
web/public/proxy.js                                     ← sync with proxy/index.js
web/src/app/api/v1/analytics/prompts/route.ts           ← NEW
web/src/app/(dashboard)/dashboard/analytics/
  prompts/page.tsx                                      ← NEW server component
  prompts/_client.tsx                                   ← NEW client component
web/src/components/layout/Sidebar.tsx                   ← add Prompts nav item
db/migrations/005_prompt_analytics_indexes.sql          ← NEW (2 indexes)
```

---

## 4. First Event Celebration + Progressive Empty States

### Architecture Decision
Track two things in `user_preferences` table (already exists):
1. `first_event_celebrated = 'true'` — one-time flag, set after showing confetti
2. `onboarding_checklist` — JSON, tracks which steps are done

No new tables. No schema changes.

### Layer 1 — State Machine

```
State 0: no projects           → show "Create your first project"
State 1: has project, 0 events → show install.command + setup steps
State 2: 1-9 events            → show checklist (add budget, invite member)
State 3: ≥10 events, not yet   → show first-event celebration banner + mark done
State 4: celebrated = true     → normal dashboard
```

### Layer 2 — Server Component (dashboard page.tsx)

```typescript
// Add to existing dashboard page.tsx queries:
const [
  { count: totalEvents },
  { data: celebPref }
] = await Promise.all([
  supabase
    .from('usage_events')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId),
  supabase
    .from('user_preferences')
    .select('value')
    .eq('user_id', user.id)
    .eq('key', 'first_event_celebrated')
    .maybeSingle()
])

const dashboardState = {
  totalEvents: totalEvents ?? 0,
  celebrated: celebPref?.value === 'true',
}

// Pass to client:
<DashboardClient ... dashboardState={dashboardState} />
```

### Layer 3 — Client Component

```tsx
// In dashboard/_client.tsx — add celebration logic

useEffect(() => {
  if (dashboardState.totalEvents >= 1 && !dashboardState.celebrated) {
    // Fire confetti (canvas-confetti, lazy loaded):
    import('canvas-confetti').then(({ default: confetti }) => {
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } })
    })
    // Mark celebrated (fire-and-forget):
    fetch('/api/v1/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'first_event_celebrated', value: 'true' })
    })
  }
}, [])

// Celebration banner (shown for 8s then auto-dismiss):
{showCelebration && (
  <div className="flex items-center gap-3 px-5 py-4 mb-6 
                  bg-[var(--green-bg)] border border-[var(--green)] rounded-2xl">
    <span className="text-2xl">🎉</span>
    <div>
      <p className="font-semibold text-[var(--fg)]">Your first event is in!</p>
      <p className="text-sm text-[var(--fg-secondary)]">
        TokenFin is now tracking your AI usage in real time.
      </p>
    </div>
    <button onClick={() => setShowCelebration(false)} className="ml-auto">✕</button>
  </div>
)}
```

### Layer 4 — Onboarding Checklist Component (State 2)

**New component: `web/src/components/dashboard/OnboardingChecklist.tsx`**

```tsx
// Shown when 1 ≤ events < 10 AND checklist not completed
const STEPS = [
  { key: 'account',    label: 'Created your account',           alwaysDone: true },
  { key: 'project',    label: 'Set up a project',               check: hasProject },
  { key: 'first_call', label: 'Sent your first AI call',        check: totalEvents >= 1 },
  { key: 'budget',     label: 'Set a spending limit',           check: hasLimit },
  { key: 'invite',     label: 'Invited a team member',          check: memberCount > 1 },
]

// Progress bar: 3/5 steps → 60%
// Each incomplete step has a CTA link → correct page
// "Dismiss" link → stores 'checklist_dismissed=true' in user_preferences
```

### Empty State: State 1 (has project, 0 events)

Replace current generic empty state on dashboard with a focused "get started" card:

```tsx
{totalEvents === 0 && (
  <div className="flex flex-col items-center gap-6 py-16 text-center">
    <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
      <Zap size={28} className="text-coral" />
    </div>
    <div>
      <h3 className="text-lg font-semibold mb-2">No events yet</h3>
      <p className="text-[var(--fg-secondary)] text-sm max-w-sm">
        Download the proxy and route your AI tool through TokenFin 
        to see usage appear here in real time.
      </p>
    </div>
    <a href="/dashboard/resources" className="btn-primary">
      Get setup guide →
    </a>
  </div>
)}
```

### Files to Touch
```
web/src/app/(dashboard)/dashboard/page.tsx            ← add state queries
web/src/app/(dashboard)/dashboard/dashboard_client.tsx ← add celebration logic
web/src/components/dashboard/OnboardingChecklist.tsx   ← NEW
web/package.json                                       ← add canvas-confetti
```

---

## Summary: Full File Change List

```
NEW files:
  web/src/lib/rbac.ts
  web/src/lib/api/auth.ts
  web/src/lib/ratelimit.ts
  web/src/app/api/v1/analytics/prompts/route.ts
  web/src/app/(dashboard)/dashboard/analytics/prompts/page.tsx
  web/src/app/(dashboard)/dashboard/analytics/prompts/_client.tsx
  web/src/components/dashboard/OnboardingChecklist.tsx
  db/migrations/005_prompt_analytics_indexes.sql

MODIFIED files:
  proxy/index.js                              (latency + hash metadata)
  web/public/proxy.js                         (sync with above)
  web/src/app/api/v1/ingest/route.ts          (rate limit)
  web/src/app/api/v1/keys/route.ts            (requireRole)
  web/src/app/api/v1/limits/route.ts          (requireRole)
  web/src/app/api/v1/alerts/route.ts          (requireRole)
  web/src/app/api/v1/members/route.ts         (requireRole)
  web/src/app/(dashboard)/dashboard/page.tsx  (state queries)
  web/src/app/(dashboard)/dashboard/*/_client.tsx  (role gates)
  web/src/components/layout/Sidebar.tsx       (Prompts nav item)

NEW deps:
  @upstash/ratelimit
  @upstash/redis
  canvas-confetti
```

---

## Execution Sequence

```
Day 1 AM:  Rate limiting (ingest route + Upstash setup) — 0.5 day, zero risk
Day 1 PM:  lib/rbac.ts + lib/api/auth.ts — foundation for everything else
Day 2:     RBAC on all API routes + page role fetching
Day 2 PM:  UI gates (buttons + page redirects)
Day 3:     Proxy metadata (latency + hash) + ingest route metadata passthrough
Day 3 PM:  Analytics/prompts API route + page
Day 4 AM:  First event celebration + empty states + checklist
Day 4 PM:  Test end-to-end, run `npm run build`, fix TypeScript
```
