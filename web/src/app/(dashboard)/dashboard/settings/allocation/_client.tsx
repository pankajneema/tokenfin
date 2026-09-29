'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Split, Plus, Pencil, Trash2, X, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { allocateRows, describeMatch, normalizeRule, type AllocationRule, type RuleKind } from '@/lib/allocation/apply'
import type { AllocationRuleRow } from '@/lib/allocation/load'
import type { PreviewRow } from './_types'

interface Props {
  orgId: string
  canEdit: boolean
  initialRules: AllocationRuleRow[]
  projects: { id: string; name: string }[]
  teamNames: string[]
  preview: PreviewRow[]
  previewMonth: string
  previewTruncated: boolean
}

interface Draft {
  id: string | null
  name: string; kind: RuleKind; priority: string
  tag: string; equals: string; repo_prefix: string; email_domain: string; project_id: string; source: string; model_prefix: string
  team: string; cost_center: string; among: string
}

const EMPTY: Draft = {
  id: null, name: '', kind: 'assign', priority: '100',
  tag: '', equals: '', repo_prefix: '', email_domain: '', project_id: '', source: '', model_prefix: '',
  team: '', cost_center: '', among: '',
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function toDraft(r: AllocationRuleRow): Draft {
  const m = r.match as Record<string, string | undefined>
  const a = r.assign as { team?: string; cost_center?: string; among?: string[] }
  return {
    id: r.id, name: r.name ?? '', kind: (r.kind as RuleKind) ?? 'assign', priority: String(r.priority ?? 100),
    tag: m.tag ?? '', equals: m.equals ?? '', repo_prefix: m.repo_prefix ?? '', email_domain: m.email_domain ?? '',
    project_id: m.project_id ?? '', source: m.source ?? '', model_prefix: m.model_prefix ?? '',
    team: a.team ?? '', cost_center: a.cost_center ?? '', among: (a.among ?? []).join(', '),
  }
}

function draftBody(d: Draft) {
  const match: Record<string, string> = {}
  for (const k of ['tag', 'equals', 'repo_prefix', 'email_domain', 'project_id', 'source', 'model_prefix'] as const) {
    if (d[k].trim()) match[k] = d[k].trim()
  }
  const assign: Record<string, unknown> = {}
  if (d.kind === 'assign') {
    if (d.team.trim()) assign.team = d.team.trim()
    if (d.cost_center.trim()) assign.cost_center = d.cost_center.trim()
  } else {
    const among = d.among.split(',').map(s => s.trim()).filter(Boolean)
    if (among.length) assign.among = among
  }
  return { name: d.name.trim(), kind: d.kind, priority: Number(d.priority) || 0, match, assign }
}

export function AllocationClient({ orgId, canEdit, initialRules, projects, teamNames, preview, previewMonth, previewTruncated }: Props) {
  const router = useRouter()
  const [rules, setRules]   = useState<AllocationRuleRow[]>(initialRules)
  const [draft, setDraft]   = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const projectName = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects])

  // Rules used by the preview: saved rules, with the open draft applied on top.
  const previewRules = useMemo(() => {
    const out: AllocationRule[] = []
    for (const r of rules) {
      if (draft?.id && r.id === draft.id) continue
      const n = normalizeRule(r)
      if (typeof n !== 'string') out.push(n)
    }
    if (draft) {
      const n = normalizeRule({ ...draftBody(draft), id: draft.id ?? 'draft', created_at: '9999' })
      if (typeof n !== 'string') out.push(n)
    }
    return out
  }, [rules, draft])
  const draftError = useMemo(() => {
    if (!draft) return null
    const n = normalizeRule(draftBody(draft))
    return typeof n === 'string' ? n : null
  }, [draft])

  const summary = useMemo(() => {
    const allocated = allocateRows(preview, r => r, r => r.cost, previewRules)
    const byTeam = new Map<string, { metered: number; notional: number; split: number }>()
    const byCc = new Map<string, { metered: number; notional: number }>()
    let total = 0
    for (const a of allocated) {
      const c = a.row.cost * a.weight
      total += c
      const notional = a.row.cost_basis === 'notional'
      const t = byTeam.get(a.team ?? '') ?? { metered: 0, notional: 0, split: 0 }
      if (notional) t.notional += c; else t.metered += c
      if (a.split_rule) t.split += c
      byTeam.set(a.team ?? '', t)
      const k = byCc.get(a.cost_center ?? '') ?? { metered: 0, notional: 0 }
      if (notional) k.notional += c; else k.metered += c
      byCc.set(a.cost_center ?? '', k)
    }
    const sort = <T extends { metered: number; notional: number }>(m: Map<string, T>) =>
      Array.from(m.entries()).sort((a, b) => (b[1].metered + b[1].notional) - (a[1].metered + a[1].notional))
    return { total, teams: sort(byTeam), ccs: sort(byCc) }
  }, [preview, previewRules])

  async function save() {
    if (!draft) return
    setSaving(true); setError(null)
    const body = draftBody(draft)
    const res = await fetch('/api/v1/allocation-rules', {
      method: draft.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft.id ? { id: draft.id, ...body } : { org_id: orgId, ...body }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(typeof j.error === 'string' ? j.error : 'Could not save the rule.')
      return
    }
    const row: AllocationRuleRow = await res.json()
    setRules(prev => (draft.id ? prev.map(r => (r.id === row.id ? row : r)) : [...prev, row])
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)))
    setDraft(null)
    router.refresh()   // re-fetch preview rows so newly referenced tags are included
  }

  async function toggle(r: AllocationRuleRow) {
    const res = await fetch('/api/v1/allocation-rules', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, is_active: !r.is_active }),
    })
    if (res.ok) { const row = await res.json(); setRules(prev => prev.map(x => (x.id === row.id ? row : x))) }
  }

  async function remove(r: AllocationRuleRow) {
    if (!confirm(`Delete the rule "${r.name || describeMatch(r.match)}"?`)) return
    const res = await fetch(`/api/v1/allocation-rules?id=${r.id}`, { method: 'DELETE' })
    if (res.ok) setRules(prev => prev.filter(x => x.id !== r.id))
  }

  const input = 'w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[12.5px] text-[var(--fg)] focus:outline-none focus:border-coral'
  const label = 'block text-[11px] font-semibold text-[var(--fg-secondary)] mb-1'
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft(d => (d ? { ...d, [k]: e.target.value } : d))

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <div className="flex items-center gap-2">
              <Split size={15} className="text-[var(--fg-secondary)]" />
              <h2 className="text-[15px] font-bold text-[var(--fg)]">Cost allocation rules</h2>
            </div>
            <p className="text-[12px] text-[var(--fg-secondary)] mt-1 max-w-[560px]">
              Map usage to a team and cost center by tag, repo, email domain, project or source. Rules run by priority
              (lowest first); the first match sets each field, and a member&apos;s own team is the fallback. Used by the
              chargeback CSV and the FOCUS export.
            </p>
          </div>
          {canEdit && !draft && (
            <button id="allocation-add-rule" onClick={() => { setError(null); setDraft({ ...EMPTY }) }} className="btn-primary text-[12px]">
              <Plus size={13} /> Add rule
            </button>
          )}
        </div>

        {!canEdit && (
          <p className="px-5 py-3 text-[12px] text-[var(--fg-tertiary)] border-b border-[var(--border)]">
            Read-only — only workspace owners and admins can change allocation rules.
          </p>
        )}

        {draft && (
          <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)] space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-[var(--fg)]">{draft.id ? 'Edit rule' : 'New rule'}</p>
              <button onClick={() => setDraft(null)} aria-label="Cancel" className="text-[var(--fg-tertiary)] hover:text-[var(--fg)]"><X size={15} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label className={label}>Name</label><input className={input} value={draft.name} onChange={set('name')} placeholder="Payments repos" /></div>
              <div>
                <label className={label}>Type</label>
                <select className={input} value={draft.kind} onChange={set('kind')}>
                  <option value="assign">Assign team / cost center</option>
                  <option value="shared_split">Split shared (unattributed) cost</option>
                </select>
              </div>
              <div><label className={label}>Priority (lower runs first)</label><input className={input} type="number" value={draft.priority} onChange={set('priority')} /></div>
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)] pt-1">
              When usage matches (all filled fields; leave empty to match everything{draft.kind === 'shared_split' ? ' unattributed' : ''})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label className={label}>Tag key</label><input className={input} value={draft.tag} onChange={set('tag')} placeholder="cost_center" /></div>
              <div><label className={label}>Tag equals</label><input className={input} value={draft.equals} onChange={set('equals')} placeholder="cc-42 (empty = any value)" /></div>
              <div><label className={label}>Repo starts with</label><input className={input} value={draft.repo_prefix} onChange={set('repo_prefix')} placeholder="payments-" /></div>
              <div><label className={label}>Email domain</label><input className={input} value={draft.email_domain} onChange={set('email_domain')} placeholder="contractor.com" /></div>
              <div>
                <label className={label}>Project</label>
                <select className={input} value={draft.project_id} onChange={set('project_id')}>
                  <option value="">Any project</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div><label className={label}>Source</label><input className={input} value={draft.source} onChange={set('source')} placeholder="claude_code" /></div>
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)] pt-1">
              {draft.kind === 'assign' ? 'Then assign' : 'Split across'}
            </p>
            {draft.kind === 'assign' ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={label}>Team</label>
                  <input className={input} list="allocation-teams" value={draft.team} onChange={set('team')} placeholder="Payments" />
                  <datalist id="allocation-teams">{teamNames.map(t => <option key={t} value={t} />)}</datalist>
                </div>
                <div><label className={label}>Cost center</label><input className={input} value={draft.cost_center} onChange={set('cost_center')} placeholder="cc-42" /></div>
              </div>
            ) : (
              <div>
                <label className={label}>Only these teams (comma-separated; empty = every team with attributed cost)</label>
                <input className={input} value={draft.among} onChange={set('among')} placeholder="Payments, Search" />
                <p className="text-[11px] text-[var(--fg-tertiary)] mt-1">Cost with no team is split in proportion to each team&apos;s attributed cost.</p>
              </div>
            )}
            {(error || draftError) && <p className="text-[12px] text-[var(--red)]">{error ?? draftError}</p>}
            <div className="flex gap-2">
              <button id="allocation-save-rule" onClick={save} disabled={saving || !!draftError} className="btn-primary text-[12px] disabled:opacity-50">
                {saving ? 'Saving…' : 'Save rule'}
              </button>
              <button onClick={() => setDraft(null)} className="btn-secondary text-[12px]">Cancel</button>
              <span className="text-[11px] text-[var(--fg-tertiary)] self-center">The preview below already includes this draft.</span>
            </div>
          </div>
        )}

        {rules.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-[var(--fg-tertiary)]">
            No rules yet — cost is allocated to each member&apos;s team. Add a rule to route usage by tag, repo or email domain.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-[var(--fg-tertiary)] border-b border-[var(--border)]">
                  <th className="px-5 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Rule</th>
                  <th className="px-3 py-2.5 font-semibold">When</th>
                  <th className="px-3 py-2.5 font-semibold">Then</th>
                  <th className="px-3 py-2.5 font-semibold">Active</th>
                  {canEdit && <th className="px-3 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {rules.map(r => {
                  const a = r.assign as { team?: string; cost_center?: string; among?: string[] }
                  return (
                    <tr key={r.id} className={cn('border-b border-[var(--border)] last:border-0 align-top', !r.is_active && 'opacity-50')}>
                      <td className="px-5 py-2.5 tabular-nums text-[var(--fg-tertiary)]">{r.priority}</td>
                      <td className="px-3 py-2.5 text-[var(--fg)] font-medium">{r.name || (r.kind === 'shared_split' ? 'Shared cost split' : 'Untitled')}</td>
                      <td className="px-3 py-2.5 text-[var(--fg-secondary)]">
                        {r.kind === 'shared_split' ? 'unattributed cost' + (Object.keys(r.match).length ? ` where ${describeMatch(r.match, id => projectName.get(id))}` : '')
                          : describeMatch(r.match, id => projectName.get(id))}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--fg-secondary)]">
                        {r.kind === 'shared_split'
                          ? `split across ${a.among?.length ? a.among.join(', ') : 'all teams'} by usage`
                          : [a.team && `team ${a.team}`, a.cost_center && `cost center ${a.cost_center}`].filter(Boolean).join(', ')}
                      </td>
                      <td className="px-3 py-2.5">
                        <button disabled={!canEdit} onClick={() => toggle(r)} aria-label="Toggle rule"
                          className={cn('w-8 h-4.5 rounded-full relative transition-colors disabled:cursor-default', r.is_active ? 'bg-coral' : 'bg-[var(--bg-tertiary)]')}
                          style={{ height: 18 }}>
                          <span className={cn('absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all', r.is_active ? 'left-4' : 'left-0.5')} />
                        </button>
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2.5 whitespace-nowrap text-right">
                          <button onClick={() => { setError(null); setDraft(toDraft(r)) }} aria-label="Edit rule" className="p-1 text-[var(--fg-tertiary)] hover:text-[var(--fg)]"><Pencil size={13} /></button>
                          <button onClick={() => remove(r)} aria-label="Delete rule" className="p-1 text-[var(--fg-tertiary)] hover:text-[var(--red)]"><Trash2 size={13} /></button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">Preview — {previewMonth}</h2>
            <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">
              How last month&apos;s cost ({usd(summary.total)}) would be allocated with these rules. Metered (billed) and
              notional (subscription usage at list prices) are kept apart.
              {previewTruncated && ' Showing the first 20,000 usage groups.'}
            </p>
          </div>
          {canEdit && (
            <a href={`/api/v1/export/chargeback?org_id=${orgId}&month=${previewMonth}&group=team`} className="btn-secondary text-[12px]">
              <Download size={12} /> Chargeback CSV
            </a>
          )}
        </div>
        {preview.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-[var(--fg-tertiary)]">
            No usage last month. Send events via POST /api/v1/ingest or connect a CLI agent to see an allocation preview.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:divide-x divide-[var(--border)]">
            {([['Team', summary.teams, 'No team'], ['Cost center', summary.ccs, 'No cost center']] as const).map(([title, rows, none]) => (
              <div key={title} className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[10.5px] uppercase tracking-wide text-[var(--fg-tertiary)] border-b border-[var(--border)]">
                      <th className="px-5 py-2.5 font-semibold">{title}</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Metered</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Notional</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([k, v]) => {
                      const tot = v.metered + v.notional
                      const split = 'split' in v ? (v as { split: number }).split : 0
                      return (
                        <tr key={k || '-'} className="border-b border-[var(--border)] last:border-0">
                          <td className={cn('px-5 py-2', k ? 'text-[var(--fg)]' : 'text-[var(--amber)] italic')}>
                            {k || none}
                            {split > 0 && <span className="ml-1.5 text-[10.5px] text-[var(--fg-tertiary)]">incl. {usd(split)} shared</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{usd(v.metered)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[var(--fg-secondary)]">{usd(v.notional)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[var(--fg-secondary)]">{summary.total > 0 ? `${(tot / summary.total * 100).toFixed(1)}%` : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
