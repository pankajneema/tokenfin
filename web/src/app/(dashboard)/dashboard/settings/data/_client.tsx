'use client'
import { useCallback, useEffect, useState } from 'react'
import { Database, Trash2, Clock, AlertTriangle, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

type DataInfo = {
  retention_days: number | null
  counts: { usage_events: number; prompt_captures: number; traces: number }
  oldest_event_at: string | null
  presets: { days: number; events: number }[]
}

const RETENTION_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Keep forever', value: null },
  { label: '7 days',       value: 7 },
  { label: '30 days',      value: 30 },
  { label: '90 days',      value: 90 },
  { label: '180 days',     value: 180 },
  { label: '1 year',       value: 365 },
]

const card = 'bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl'
const fmt  = (n: number) => n.toLocaleString()

export function DataClient({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const [info, setInfo]           = useState<DataInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retention, setRetention] = useState<number | null>(null)
  const [savingRet, setSavingRet] = useState(false)
  const [retSaved, setRetSaved]   = useState(false)

  // Deletion: pick a scope, then type DELETE to confirm.
  const [scope, setScope]     = useState<number | null | undefined>(undefined)  // undefined = nothing picked, null = everything
  const [typed, setTyped]     = useState('')
  const [deleting, setDeleting] = useState(false)
  const [result, setResult]   = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const res = await fetch(`/api/v1/data?org_id=${orgId}`)
    if (!res.ok) { setLoadError('Could not load your data summary. Refresh to try again.'); return }
    const d: DataInfo = await res.json()
    setInfo(d)
    setRetention(d.retention_days)
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function saveRetention() {
    setSavingRet(true); setRetSaved(false); setError(null)
    const res = await fetch('/api/v1/data', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, retention_days: retention }),
    })
    setSavingRet(false)
    if (!res.ok) { setError('Could not save the retention setting. Only the workspace owner can change it.'); return }
    setRetSaved(true)
    load()
  }

  async function runDelete() {
    if (scope === undefined || typed !== 'DELETE') return
    setDeleting(true); setError(null); setResult(null)
    const res = await fetch('/api/v1/data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, older_than_days: scope, confirm: 'DELETE' }),
    })
    setDeleting(false)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setError(typeof body.error === 'string' ? body.error : 'Deletion failed. Nothing was deleted.'); return }
    const d = body.deleted ?? {}
    setResult(`Deleted ${fmt(Number(d.usage_events ?? 0))} usage events, ${fmt(Number(d.prompt_captures ?? 0))} captured prompts and ${fmt(Number(d.traces ?? 0))} traces.`)
    setScope(undefined); setTyped('')
    load()
  }

  const retentionDirty = info != null && retention !== info.retention_days
  const deleteChoices: { key: string; value: number | null; label: string; events: number | null }[] = [
    ...(info?.presets ?? []).map(p => ({ key: `d${p.days}`, value: p.days, label: `Older than ${p.days} days`, events: p.events })),
    { key: 'all', value: null, label: 'All monitoring data', events: info?.counts.usage_events ?? null },
  ]

  return (
    <div className="space-y-5">
      {/* What is stored */}
      <div className={cn(card, 'p-6')}>
        <div className="flex items-center gap-2 mb-4">
          <Database size={15} className="text-[var(--fg-secondary)]" />
          <h2 className="text-[15px] font-bold text-[var(--fg)]">Stored monitoring data</h2>
        </div>
        {loadError && <p className="text-[12.5px] text-[var(--red)]">{loadError}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            ['Usage events',     info ? fmt(info.counts.usage_events) : '—'],
            ['Captured prompts', info ? fmt(info.counts.prompt_captures) : '—'],
            ['Traces',           info ? fmt(info.counts.traces) : '—'],
            ['Oldest event',     info?.oldest_event_at ? new Date(info.oldest_event_at).toLocaleDateString() : '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[11px] uppercase tracking-wide text-[var(--fg-tertiary)]">{label}</p>
              <p className="text-[18px] font-bold text-[var(--fg)] tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-[var(--fg-secondary)] mt-4">
          Monitoring is free and unlimited. Data stays until you delete it or set automatic retention below.
          Your workspace, projects, keys, limits and alert rules are never deleted here.
        </p>
      </div>

      {/* Automatic retention */}
      <div className={cn(card, 'p-6')}>
        <div className="flex items-center gap-2 mb-1">
          <Clock size={15} className="text-[var(--fg-secondary)]" />
          <h2 className="text-[15px] font-bold text-[var(--fg)]">Automatic retention</h2>
        </div>
        <p className="text-[12.5px] text-[var(--fg-secondary)] mb-4">
          Once a day, monitoring data older than this is deleted automatically.
        </p>
        <div className="flex flex-wrap gap-2">
          {RETENTION_OPTIONS.map(o => (
            <button
              key={o.label}
              id={`retention-${o.value ?? 'forever'}`}
              disabled={!isOwner}
              onClick={() => { setRetention(o.value); setRetSaved(false) }}
              className={cn(
                'px-3 py-1.5 rounded-lg border text-[12.5px] font-medium transition-colors disabled:opacity-60',
                retention === o.value
                  ? 'border-coral bg-coral/10 text-coral'
                  : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={saveRetention} disabled={!isOwner || !retentionDirty || savingRet} className="btn-primary disabled:opacity-50">
            {savingRet ? 'Saving…' : 'Save retention'}
          </button>
          {retSaved && <span className="text-[12px] text-[var(--green)] flex items-center gap-1"><Check size={12} /> Saved</span>}
          {!isOwner && <span className="text-[12px] text-[var(--fg-tertiary)]">Only the workspace owner can change retention.</span>}
        </div>
      </div>

      {/* Delete now */}
      <div className={cn(card, 'p-6 border-[var(--red)]/30')}>
        <div className="flex items-center gap-2 mb-1">
          <Trash2 size={15} className="text-[var(--red)]" />
          <h2 className="text-[15px] font-bold text-[var(--fg)]">Delete monitoring data</h2>
        </div>
        <p className="text-[12.5px] text-[var(--fg-secondary)] mb-4">
          Permanently deletes usage events, daily totals, captured prompts and traces. This cannot be undone.
        </p>

        <div className="grid sm:grid-cols-2 gap-2">
          {deleteChoices.map(c => (
            <button
              key={c.key}
              id={`delete-${c.key}`}
              disabled={!isOwner}
              onClick={() => { setScope(c.value); setTyped(''); setResult(null); setError(null) }}
              className={cn(
                'flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors disabled:opacity-60',
                scope === c.value ? 'border-[var(--red)] bg-[var(--red-bg)]' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <span className="text-[13px] font-medium text-[var(--fg)]">{c.label}</span>
              <span className="text-[11.5px] text-[var(--fg-tertiary)] tabular-nums">{c.events == null ? '' : `${fmt(c.events)} events`}</span>
            </button>
          ))}
        </div>

        {scope !== undefined && (
          <div className="mt-4 p-4 rounded-xl bg-[var(--red-bg)] space-y-3">
            <p className="text-[12.5px] text-[var(--fg)] flex items-start gap-2">
              <AlertTriangle size={14} className="text-[var(--red)] mt-0.5 flex-shrink-0" />
              {scope == null
                ? 'This deletes ALL monitoring data for this workspace.'
                : `This deletes all monitoring data older than ${scope} days.`}
              {' '}Type DELETE to confirm.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                id="delete-confirm"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                placeholder="DELETE"
                className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)]"
              />
              <button
                onClick={runDelete}
                disabled={typed !== 'DELETE' || deleting}
                className="px-4 py-2 rounded-lg bg-[var(--red)] text-white text-[13px] font-semibold disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button onClick={() => { setScope(undefined); setTyped('') }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        )}

        {result && <p className="mt-4 text-[12.5px] text-[var(--green)] flex items-center gap-1.5"><Check size={13} /> {result}</p>}
        {error  && <p className="mt-4 text-[12.5px] text-[var(--red)]">{error}</p>}
        {!isOwner && <p className="mt-3 text-[12px] text-[var(--fg-tertiary)]">Only the workspace owner can delete data.</p>}
      </div>
    </div>
  )
}
