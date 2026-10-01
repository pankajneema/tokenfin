import Link from 'next/link'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { promptScope } from '@/lib/rbac'
import { resolveUserScope, eventScopeOr } from '@/lib/rollup-scope'
import { selectAll } from '@/lib/supabase/paginate'
import { countPrompts, promptKey } from '@/lib/prompts'
import { CacheEfficiency, computeCacheStats } from '@/components/dashboard/cache-efficiency'
import { PromptText } from '@/components/dashboard/prompt-text'
import { sessionTitles, untitledLabel } from '@/lib/session-titles'
import { sourceLabel } from '@/lib/rollup-scope'

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

type SessionMeta = {
  agent: string | null; agent_version: string | null; cwd: string | null; git_branch: string | null; repo: string | null
  hostname: string | null; start_source: string | null; started_at: string | null; ended_at: string | null; end_reason: string | null
}
type ToolCall = { prompt_id: string | null; tool: string; mcp_server: string | null; success: boolean | null; duration_ms: number | null; decision: string | null; at: string }

const END_REASON: Record<string, string> = {
  prompt_input_exit: 'exited by the user', clear: 'cleared (/clear)', logout: 'logged out', other: 'closed',
}
const START_SOURCE: Record<string, string> = {
  startup: 'new session', resume: 'resumed', clear: 'after /clear', compact: 'after compaction', subagent: 'sub-agent',
}
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })

function summarizeTools(calls: ToolCall[]) {
  const m = new Map<string, { tool: string; mcp: string | null; calls: number; failed: number; ms: number; timed: number }>()
  for (const c of calls) {
    const e = m.get(c.tool) ?? { tool: c.tool, mcp: c.mcp_server, calls: 0, failed: 0, ms: 0, timed: 0 }
    e.calls++; if (c.success === false) e.failed++
    if (c.duration_ms != null) { e.ms += c.duration_ms; e.timed++ }
    m.set(c.tool, e)
  }
  return Array.from(m.values()).sort((a, b) => b.calls - a.calls).map(e => ({ ...e, avgMs: e.timed ? e.ms / e.timed : null }))
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
  const groups: { key: string; text: string | null; previewOnly: boolean; calls: Row[] }[] = []
  const byKey = new Map<string, (typeof groups)[number]>()
  for (const r of rows) {
    const k = promptKey(r)
    let g = byKey.get(k)
    if (!g) {
      g = { key: k, text: null, previewOnly: false, calls: [] }
      byKey.set(k, g); groups.push(g)
    }
    g.calls.push(r)
    if (g.text == null || g.previewOnly) {
      const full = (r.correlation_id && promptText.get(r.correlation_id)) || (r.prompt_hash && promptText.get(r.prompt_hash)) || null
      if (full) { g.text = full; g.previewOnly = false }
      else if (g.text == null && r.prompt_preview) { g.text = r.prompt_preview; g.previewOnly = true }
    }
  }

  const [titleMap, metaRes, toolRes] = await Promise.all([
    sessionTitles(admin, orgId, [sessionId]),
    admin.from('session_meta').select('agent,agent_version,cwd,git_branch,repo,hostname,start_source,started_at,ended_at,end_reason')
      .eq('org_id', orgId).eq('session_id', sessionId).maybeSingle(),
    admin.from('session_tool_calls').select('prompt_id,tool,mcp_server,success,duration_ms,decision,at')
      .eq('org_id', orgId).eq('session_id', sessionId).order('at', { ascending: true }).limit(5000),
  ])
  const title = titleMap.get(sessionId) ?? null
  const meta = (metaRes.error ? null : metaRes.data) as SessionMeta | null      // before migration 023: no context
  const toolCalls = (toolRes.error ? [] : toolRes.data ?? []) as ToolCall[]
  const toolsByPrompt = new Map<string, ToolCall[]>()
  for (const t of toolCalls) if (t.prompt_id) {
    const l = toolsByPrompt.get(t.prompt_id); if (l) l.push(t); else toolsByPrompt.set(t.prompt_id, [t])
  }
  const cost = rows.reduce((s, r) => s + num(r.cost_usd), 0)
  const tokens = rows.reduce((s, r) => s + num(r.total_tokens), 0)
  // Session window: the agent's own start/end when known (hooks / plugin), else first/last LLM call.
  const start = meta?.started_at && meta.started_at < rows[0].created_at ? meta.started_at : rows[0].created_at
  const lastCall = rows[rows.length - 1].created_at
  const end = meta?.ended_at && meta.ended_at > lastCall ? meta.ended_at : lastCall
  const ended = !!meta?.ended_at
  const live = !ended && Date.now() - new Date(lastCall).getTime() < 15 * 60_000
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
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={`text-[20px] font-bold tracking-tight break-words ${title ? 'text-[var(--fg)]' : 'text-[var(--fg-secondary)] italic'}`}>{title ?? untitledLabel(sessionId)}</h2>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? 'bg-[var(--green-bg)] text-[var(--green)]' : 'bg-[var(--bg-secondary)] text-[var(--fg-secondary)]'}`}>
            {ended ? `Ended${meta?.end_reason ? ` · ${END_REASON[meta.end_reason] ?? meta.end_reason}` : ''}` : live ? 'Active' : 'Idle'}
          </span>
          {(meta?.agent || firstOf('source')) && <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--fg-secondary)]">{sourceLabel(meta?.agent || firstOf('source') || '')}{meta?.agent_version ? ` ${meta.agent_version}` : ''}</span>}
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-[var(--fg-tertiary)] break-all">{sessionId}</p>
      </div>

      <section aria-label="Session report" className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
        <p className="text-[13px] font-bold text-[var(--fg)] mb-3">Session report</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-[12.5px]">
          {([
            ['Directory', meta?.cwd ? <span key="d" className="font-mono break-all">{meta.cwd}</span> : null],
            ['Git branch', meta?.git_branch ? <span key="b" className="font-mono">{meta.git_branch}</span> : null],
            ['Repository', meta?.repo || firstOf('repo')],
            ['Person', firstOf('user_email')],
            ['Machine', meta?.hostname],
            ['Started', `${fmtDateTime(start)}${meta?.start_source ? ` · ${START_SOURCE[meta.start_source] ?? meta.start_source}` : ''}`],
            [ended ? 'Ended' : 'Last activity', `${fmtDateTime(end)}${ended && meta?.end_reason ? ` · ${END_REASON[meta.end_reason] ?? meta.end_reason}` : ''}`],
            ['Duration', fmtDuration(new Date(end).getTime() - new Date(start).getTime())],
            ['Models', Array.from(new Set(rows.map(r => r.model))).join(', ')],
          ] as const).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{k}</dt>
              <dd className="mt-0.5 text-[var(--fg)]">{v || <span className="text-[var(--fg-tertiary)]">—</span>}</dd>
            </div>
          ))}
        </dl>
        {!meta?.cwd && (
          <p className="mt-3 text-[11.5px] text-[var(--fg-tertiary)]">
            Directory, branch and exact start/end come from the session hooks — run <code className="font-mono">npx tokenfin@latest setup</code> on that machine (OpenCode sends them through the TokenFin plugin).
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          ['Prompts', String(countPrompts(rows))],
          ['LLM calls', String(rows.length)],
          ['Tokens', fmtTok(tokens)],
          ['Tool calls', toolCalls.length ? `${toolCalls.length}${toolCalls.some(t => t.success === false) ? ` · ${toolCalls.filter(t => t.success === false).length} failed` : ''}` : '—'],
          [notionalCost > 0 && meteredCost > 0 ? `Cost · ${fmtUsd(meteredCost)} metered` : notionalCost > 0 ? 'Cost (notional)' : 'Cost (metered)', fmtUsd(cost)],
        ].map(([l, v]) => (
          <div key={l} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl px-4 py-3">
            <p className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wide">{l}</p>
            <p className="text-[17px] font-bold tabular-nums text-[var(--fg)] mt-0.5">{v}</p>
          </div>
        ))}
      </div>

      <CacheEfficiency stats={cache} title="Cache efficiency (this session)" />

      {toolCalls.length > 0 && (
        <section aria-label="Tools used" className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-[13px] font-bold text-[var(--fg)]">Tools used</p>
            <p className="text-[11.5px] text-[var(--fg-tertiary)]">
              {toolCalls.length} call{toolCalls.length !== 1 ? 's' : ''} · {toolCalls.filter(t => t.success === false).length} failed · {toolCalls.filter(t => t.decision === 'reject').length} rejected
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
                  <th className="py-1.5 pr-2 font-semibold">Tool</th>
                  <th className="py-1.5 px-2 font-semibold">MCP server</th>
                  <th className="py-1.5 px-2 font-semibold text-right">Calls</th>
                  <th className="py-1.5 px-2 font-semibold text-right">Failed</th>
                  <th className="py-1.5 pl-2 font-semibold text-right">Avg time</th>
                </tr>
              </thead>
              <tbody>
                {summarizeTools(toolCalls).map(t => (
                  <tr key={t.tool} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-2 font-medium text-[var(--fg)]">{t.tool}</td>
                    <td className="py-1.5 px-2 text-[var(--fg-secondary)]">{t.mcp ?? '—'}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{t.calls}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums ${t.failed ? 'text-[var(--red)] font-semibold' : 'text-[var(--fg-tertiary)]'}`}>{t.failed}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-[var(--fg-secondary)]">{t.avgMs == null ? '—' : t.avgMs < 1000 ? `${Math.round(t.avgMs)} ms` : `${(t.avgMs / 1000).toFixed(1)} s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-[14px] font-bold text-[var(--fg)]">Prompts in this session</p>
          <p className="text-[11.5px] text-[var(--fg-tertiary)]">{groups.length} prompt{groups.length !== 1 ? 's' : ''} · full text as captured</p>
        </div>
        {groups.map((g, i) => {
          const sum = (k: 'cost_usd' | 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_write_tokens' | 'total_tokens') =>
            g.calls.reduce((s, r) => s + num(r[k]), 0)
          const gCost = sum('cost_usd')
          const models = Array.from(new Set(g.calls.map(r => r.model)))
          const notional = g.calls.every(r => r.cost_basis === 'notional')
          const promptId = g.calls[0].correlation_id ?? g.calls[0].prompt_hash
          return (
            <section key={g.key} id={`prompt-${encodeURIComponent(g.key)}`} aria-label={`Prompt ${i + 1}`} className="scroll-mt-20 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--fg)]">
                    <MessageSquare size={13} className="text-coral" /> Prompt {i + 1}
                    <span className="font-normal text-[var(--fg-tertiary)]">· {fmtTime(g.calls[0].created_at)} · {models.join(', ')}</span>
                  </p>
                  {promptId && <p className="mt-0.5 font-mono text-[10.5px] text-[var(--fg-tertiary)] break-all">{promptId}</p>}
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-bold tabular-nums text-[var(--fg)]">{fmtUsd(gCost)}</p>
                  <p className="text-[10.5px] text-[var(--fg-tertiary)]">{notional ? 'notional (at API rates)' : 'metered'}</p>
                </div>
              </div>

              {g.text
                ? <PromptText text={g.text} previewOnly={g.previewOnly} />
                : <p className="mt-2 rounded-xl border border-dashed border-[var(--border)] px-3.5 py-3 text-[12px] italic text-[var(--fg-tertiary)]">
                    Prompt text not captured. Claude Code sends it when prompt capture is on (the default for <code className="font-mono not-italic">npx tokenfin@latest setup</code>) and the workspace allows it (Settings → Workspace).
                  </p>}

              <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {([
                  ['LLM calls', String(g.calls.length)],
                  ['Input', fmtTok(sum('input_tokens'))],
                  ['Output', fmtTok(sum('output_tokens'))],
                  ['Cache read', fmtTok(sum('cache_read_tokens'))],
                  ['Cache write', fmtTok(sum('cache_write_tokens'))],
                  ['Total tokens', fmtTok(sum('total_tokens'))],
                ] as const).map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-[var(--bg-secondary)] px-2.5 py-1.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{l}</dt>
                    <dd className="text-[13px] font-semibold tabular-nums text-[var(--fg)]">{v}</dd>
                  </div>
                ))}
              </dl>

              {promptId && toolsByPrompt.get(promptId) && (
                <div className="mt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)] mb-1">Tools in this prompt</p>
                  <div className="flex flex-wrap gap-1.5">
                    {summarizeTools(toolsByPrompt.get(promptId)!).map(t => (
                      <span key={t.tool} className={`rounded-md px-2 py-0.5 text-[11px] ${t.failed ? 'bg-[var(--red-bg)] text-[var(--red)]' : 'bg-[var(--bg-secondary)] text-[var(--fg-secondary)]'}`}>
                        {t.tool} ×{t.calls}{t.failed ? ` · ${t.failed} failed` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
                      <th className="py-1.5 pr-2 font-semibold">Time</th>
                      <th className="py-1.5 px-2 font-semibold">Model</th>
                      <th className="py-1.5 px-2 font-semibold">Context</th>
                      <th className="py-1.5 px-2 font-semibold text-right">Input</th>
                      <th className="py-1.5 px-2 font-semibold text-right">Output</th>
                      <th className="py-1.5 px-2 font-semibold text-right">Cache read</th>
                      <th className="py-1.5 px-2 font-semibold text-right">Cache write</th>
                      <th className="py-1.5 px-2 font-semibold text-right">Latency</th>
                      <th className="py-1.5 pl-2 font-semibold text-right">Cost</th>
                    </tr>
                  </thead>
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
                          <td className="py-1.5 px-2 text-right tabular-nums text-[var(--fg-secondary)]">{fmtTok(num(r.input_tokens))}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-[var(--fg-secondary)]">{fmtTok(num(r.output_tokens))}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-[var(--fg-secondary)]">{fmtTok(num(r.cache_read_tokens))}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-[var(--fg-secondary)]">{fmtTok(num(r.cache_write_tokens))}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-[var(--fg-tertiary)] whitespace-nowrap">{r.latency_ms != null ? `${(r.latency_ms / 1000).toFixed(1)}s` : '—'}</td>
                          <td className="py-1.5 pl-2 text-right tabular-nums font-semibold whitespace-nowrap">{fmtUsd(num(r.cost_usd))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
