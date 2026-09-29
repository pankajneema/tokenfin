import Link from 'next/link'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { promptScope } from '@/lib/rbac'
import { resolveUserScope, eventScopeOr } from '@/lib/rollup-scope'
import { selectAll } from '@/lib/supabase/paginate'
import { countPrompts, promptKey } from '@/lib/prompts'
import { CacheEfficiency, computeCacheStats } from '@/components/dashboard/cache-efficiency'

export const metadata = { title: 'Session — TokenFin' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

type Row = {
  id: string; correlation_id: string | null; prompt_hash: string | null; prompt_preview: string | null
  user_email: string | null; source: string | null; repo: string | null; model: string
  cost_usd: number | string | null; cost_basis: string | null; total_tokens: number | string | null
  input_tokens: number | string | null; output_tokens: number | string | null
  cache_read_tokens: number | string | null; cache_write_tokens: number | string | null
  latency_ms: number | null; created_at: string
  query_source: string | null; agent_name: string | null; skill_name: string | null; mcp_server: string | null
}

const num = (v: number | string | null) => Number(v ?? 0) || 0
const fmtUsd = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const DIMENSIONS: { key: 'query_source' | 'agent_name' | 'skill_name' | 'mcp_server'; label: string }[] = [
  { key: 'query_source', label: 'Query source' },
  { key: 'agent_name',   label: 'Agent' },
  { key: 'skill_name',   label: 'Skill' },
  { key: 'mcp_server',   label: 'MCP server' },
]

export default async function SessionDetail({ params }: { params: Promise<{ session_id: string }> }) {
  const { session_id: raw } = await params
  const sessionId = decodeURIComponent(raw)
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  // Members & viewers can only open their own sessions (someone else's reads as "not found").
  const scope = await resolveUserScope(admin, promptScope(ctx.role, ctx.user.id), ctx.user.email)

  // One session's calls: a bounded raw read (the timeline needs every call).
  const { data: evs } = await selectAll<Row>(() => {
    let q = admin.from('usage_events')
      .select('id,correlation_id,prompt_hash,prompt_preview,user_email,source,repo,model,cost_usd,cost_basis,total_tokens,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,latency_ms,created_at,query_source,agent_name,skill_name,mcp_server')
      .eq('org_id', orgId).eq('session_id', sessionId)
    if (scope) q = q.or(eventScopeOr(scope))
    return q
  })
  const rows = [...evs].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-5xl">
        <Link href="/dashboard/sessions" className="inline-flex items-center gap-1 text-[12.5px] text-teal"><ArrowLeft size={13} /> Sessions</Link>
        <p className="mt-6 text-[13px] text-[var(--fg-secondary)]">Session not found in this workspace.</p>
      </div>
    )
  }

  // Prompt text: prompt_captures joined on prompt_hash = correlation_id (or the event's own prompt_hash).
  const hashes = Array.from(new Set(rows.flatMap(r => [r.correlation_id, r.prompt_hash]).filter((h): h is string => !!h)))
  const promptText = new Map<string, string>()
  for (let i = 0; i < hashes.length; i += 200) {
    const { data } = await admin.from('prompt_captures').select('prompt_hash,prompt_text')
      .eq('org_id', orgId).in('prompt_hash', hashes.slice(i, i + 200))
    for (const p of data ?? []) if (p.prompt_hash && !promptText.has(p.prompt_hash)) promptText.set(p.prompt_hash, p.prompt_text)
  }

  // Timeline: consecutive calls grouped by prompt (all calls of a prompt share correlation_id).
  const groups: { key: string; text: string | null; calls: Row[] }[] = []
  const byKey = new Map<string, (typeof groups)[number]>()
  for (const r of rows) {
    const k = promptKey(r)
    let g = byKey.get(k)
    if (!g) {
      g = { key: k, text: null, calls: [] }
      byKey.set(k, g); groups.push(g)
    }
    g.calls.push(r)
    g.text ??= (r.correlation_id && promptText.get(r.correlation_id)) || (r.prompt_hash && promptText.get(r.prompt_hash)) || r.prompt_preview || null
  }

  const cost = rows.reduce((s, r) => s + num(r.cost_usd), 0)
  const tokens = rows.reduce((s, r) => s + num(r.total_tokens), 0)
  const start = rows[0].created_at, end = rows[rows.length - 1].created_at
  const cache = computeCacheStats(rows)
  const firstOf = (k: 'user_email' | 'source' | 'repo') => rows.find(r => r[k])?.[k] ?? null
  const notionalCost = rows.filter(r => r.cost_basis === 'notional').reduce((s, r) => s + num(r.cost_usd), 0)
  const meteredCost  = cost - notionalCost

  const breakdowns = DIMENSIONS.map(d => {
    const m = new Map<string, { calls: number; cost: number; tokens: number }>()
    for (const r of rows) {
      const v = r[d.key]
      if (!v) continue
      const e = m.get(v) ?? { calls: 0, cost: 0, tokens: 0 }
      e.calls++; e.cost += num(r.cost_usd); e.tokens += num(r.total_tokens)
      m.set(v, e)
    }
    return { ...d, items: Array.from(m.entries()).sort((a, b) => b[1].cost - a[1].cost) }
  }).filter(b => b.items.length > 0)

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href="/dashboard/sessions" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-teal"><ArrowLeft size={13} /> Sessions</Link>
        <h2 className="text-[20px] font-bold text-[var(--fg)] tracking-tight">Session</h2>
        <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5">
          <span className="font-mono">{sessionId}</span>
          {firstOf('user_email') && <> · {firstOf('user_email')}</>}
          {firstOf('source') && <> · {firstOf('source')}</>}
          {firstOf('repo') && <> · {firstOf('repo')}</>}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ['Started', new Date(start).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })],
          ['Duration', fmtDuration(new Date(end).getTime() - new Date(start).getTime())],
          ['Prompts', String(countPrompts(rows))],
          ['LLM calls', String(rows.length)],
          ['Tokens', fmtTok(tokens)],
          [notionalCost > 0 && meteredCost > 0 ? `Cost · ${fmtUsd(meteredCost)} metered` : notionalCost > 0 ? 'Cost (notional)' : 'Cost (metered)', fmtUsd(cost)],
        ].map(([l, v]) => (
          <div key={l} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl px-4 py-3">
            <p className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wide">{l}</p>
            <p className="text-[17px] font-bold tabular-nums text-[var(--fg)] mt-0.5">{v}</p>
          </div>
        ))}
      </div>

      <CacheEfficiency stats={cache} title="Cache efficiency (this session)" />

      {breakdowns.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {breakdowns.map(b => (
            <div key={b.key} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
              <p className="text-[13px] font-bold text-[var(--fg)] mb-3">By {b.label.toLowerCase()}</p>
              <div className="space-y-2">
                {b.items.map(([name, v]) => (
                  <div key={name}>
                    <div className="flex justify-between text-[12px] mb-1">
                      <span className="font-medium text-[var(--fg)] truncate">{name}</span>
                      <span className="text-[var(--fg-secondary)] tabular-nums whitespace-nowrap">{fmtUsd(v.cost)} · {v.calls} call{v.calls !== 1 ? 's' : ''} · {fmtTok(v.tokens)}</span>
                    </div>
                    <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div className="h-full bg-coral rounded-full" style={{ width: `${cost > 0 ? Math.max(2, v.cost / cost * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
        <p className="text-[13px] font-bold text-[var(--fg)] mb-4">Timeline</p>
        <div className="space-y-4">
          {groups.map((g, i) => {
            const gCost = g.calls.reduce((s, r) => s + num(r.cost_usd), 0)
            return (
              <div key={g.key} className="relative pl-5 border-l-2 border-[var(--border)]">
                <span className="absolute -left-[7px] top-0.5 w-3 h-3 rounded-full bg-coral" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--fg)]">
                      <MessageSquare size={12} className="text-coral" /> Prompt {i + 1}
                      <span className="font-normal text-[var(--fg-tertiary)]">· {fmtTime(g.calls[0].created_at)}</span>
                    </p>
                    <p className="mt-1 text-[12px] text-[var(--fg-secondary)] whitespace-pre-wrap break-words line-clamp-4">
                      {g.text ?? <span className="italic text-[var(--fg-tertiary)]">Prompt text not captured</span>}
                    </p>
                  </div>
                  <span className="text-[11.5px] tabular-nums text-[var(--fg-secondary)] whitespace-nowrap">{g.calls.length} call{g.calls.length !== 1 ? 's' : ''} · {fmtUsd(gCost)}</span>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-[11.5px]">
                    <tbody>
                      {g.calls.map(r => {
                        const tags = [r.query_source, r.agent_name, r.skill_name, r.mcp_server].filter(Boolean)
                        return (
                          <tr key={r.id} className="border-t border-[var(--border)]">
                            <td className="py-1.5 pr-2 tabular-nums text-[var(--fg-tertiary)] whitespace-nowrap">{fmtTime(r.created_at)}</td>
                            <td className="py-1.5 px-2 font-medium text-[var(--fg)] whitespace-nowrap">{r.model}</td>
                            <td className="py-1.5 px-2">
                              <div className="flex flex-wrap gap-1">
                                {tags.map(t => <span key={t} className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[10px] text-[var(--fg-secondary)]">{t}</span>)}
                              </div>
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-[var(--fg-secondary)] whitespace-nowrap">
                              {fmtTok(num(r.input_tokens))} in · {fmtTok(num(r.output_tokens))} out · {fmtTok(num(r.cache_read_tokens))} cached
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-[var(--fg-tertiary)] whitespace-nowrap">{r.latency_ms != null ? `${(r.latency_ms / 1000).toFixed(1)}s` : ''}</td>
                            <td className="py-1.5 pl-2 text-right tabular-nums font-semibold whitespace-nowrap">{fmtUsd(num(r.cost_usd))}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
