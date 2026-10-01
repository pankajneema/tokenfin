import { sessionTitles } from '@/lib/session-titles'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { promptScope } from '@/lib/rbac'
import { selectAllKeyset } from '@/lib/supabase/paginate'
import { countPrompts } from '@/lib/prompts'
import { cacheHitPct } from '@/components/dashboard/cache-efficiency'
import { resolveWindow, resolveUserScope, scopedSessions, scopedSummary, sourceLabel, memberEmailMap } from '@/lib/rollup-scope'
import { SessionsClient } from './_client'

export const metadata = { title: 'Sessions — TokenFin' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

export interface SessionSummary {
  id:       string
  /** OpenCode's own title, else the first line of the first prompt; null when unknown */
  title:    string | null
  /** working directory + git branch (session hooks / OpenCode plugin, migration 023) */
  cwd:      string | null
  branch:   string | null
  ended:    boolean
  start:    string
  end:      string
  durationMs: number
  user:     string
  models:   { model: string; calls: number }[]
  prompts:  number
  calls:    number
  tokens:   number
  cost:     number
  cacheHitPct: number | null
  source:   string
  repo:     string
}

const sessionStart = (hook: string | null | undefined, firstCall: string) => (hook && hook < firstCall ? hook : firstCall)
const sessionEnd   = (hook: string | null | undefined, lastCall: string)  => (hook && hook > lastCall ? hook : lastCall)

export interface SessionsMeta {
  windowLabel: string
  days:        number
  /** set when the viewer only sees their own sessions */
  scopeNote:   string | null
  total:       number
  page:        number
  pageSize:    number
  prompts:     number
  calls:       number
  cost:        number
  meteredCost: number
  notionalCost: number
}

const PAGE_SIZE = 100

export default async function SessionsPage({ searchParams }: { searchParams?: Promise<{ days?: string; page?: string }> }) {
  const sp    = await searchParams
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  const win   = resolveWindow(sp, ctx.timezone, { defaultDays: 30, allowed: [7, 30, 90] })
  const page  = Math.max(1, parseInt(sp?.page ?? '1', 10) || 1)
  // Members & viewers only see their own sessions; owners & admins see everyone's.
  const scope = await resolveUserScope(admin, promptScope(ctx.role, ctx.user.id), ctx.user.email)

  const [list, summary, emails] = await Promise.all([
    scopedSessions(admin, orgId, win.from, win.to, scope, undefined, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, order: 'recent' }),
    scopedSummary(admin, orgId, win.from, win.to, scope),
    memberEmailMap(admin, orgId),
  ])

  // Prompt counts and the per-model call mix are per-session details the
  // rollup doesn't keep: read just this page's sessions' events (keyset).
  const ids = list.rows.map(s => s.session_id)
  type Ev = { id: string; created_at: string; session_id: string; correlation_id: string | null; model: string | null }
  const evs: Ev[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await selectAllKeyset<Ev>(() => admin.from('usage_events')
      .select('id,created_at,session_id,correlation_id,model')
      .eq('org_id', orgId).in('session_id', ids.slice(i, i + 50)))
    evs.push(...data)
  }
  const [titles, metaRows] = await Promise.all([
    sessionTitles(admin, orgId, ids),
    ids.length
      ? admin.from('session_meta').select('session_id,cwd,git_branch,started_at,ended_at').eq('org_id', orgId).in('session_id', ids)
          .then(r => (r.error ? [] : r.data ?? []) as { session_id: string; cwd: string | null; git_branch: string | null; started_at: string | null; ended_at: string | null }[])
      : Promise.resolve([]),
  ])
  const metaBy = new Map(metaRows.map(m => [m.session_id, m]))
  const bySession = new Map<string, Ev[]>()
  for (const e of evs) {
    const g = bySession.get(e.session_id)
    if (g) g.push(e); else bySession.set(e.session_id, [e])
  }

  const sessions: SessionSummary[] = list.rows.map(s => {
    const es = bySession.get(s.session_id) ?? []
    const models = new Map<string, number>()
    for (const e of es) { const m = e.model || 'unknown'; models.set(m, (models.get(m) ?? 0) + 1) }
    return {
      id:         s.session_id,
      title:      titles.get(s.session_id) ?? null,
      cwd:        metaBy.get(s.session_id)?.cwd ?? null,
      branch:     metaBy.get(s.session_id)?.git_branch ?? null,
      ended:      !!metaBy.get(s.session_id)?.ended_at,
      // The agent's own start/end (session hooks / OpenCode) when known, else first/last LLM call — same as the session page.
      start:      sessionStart(metaBy.get(s.session_id)?.started_at, s.first_at),
      end:        sessionEnd(metaBy.get(s.session_id)?.ended_at, s.last_at),
      durationMs: new Date(sessionEnd(metaBy.get(s.session_id)?.ended_at, s.last_at)).getTime()
                - new Date(sessionStart(metaBy.get(s.session_id)?.started_at, s.first_at)).getTime(),
      user:       emails.get(s.user_key) ?? (s.user_key || '—'),
      models:     models.size
        ? Array.from(models.entries()).sort((a, b) => b[1] - a[1]).map(([model, calls]) => ({ model, calls }))
        : [{ model: s.model || 'unknown', calls: s.requests }],
      prompts:    es.length ? countPrompts(es) : 0,
      calls:      s.requests,
      tokens:     s.total_tokens,
      cost:       s.cost_usd,
      cacheHitPct: cacheHitPct(s.input_tokens, s.cache_read_tokens, s.cache_write_tokens),
      source:     s.source ? sourceLabel(s.source) : '—',
      repo:       s.repo,
    }
  })

  const meta: SessionsMeta = {
    windowLabel: win.label,
    days:        win.days,
    scopeNote:   scope ? 'Showing your sessions only — owners and admins see everyone\'s.' : null,
    total:       list.total,
    page,
    pageSize:    PAGE_SIZE,
    prompts:     summary.prompts,
    calls:       summary.requests,
    cost:        summary.cost_usd,
    meteredCost: summary.metered_cost_usd,
    notionalCost: summary.notional_cost_usd,
  }
  return <SessionsClient sessions={sessions} meta={meta} />
}
