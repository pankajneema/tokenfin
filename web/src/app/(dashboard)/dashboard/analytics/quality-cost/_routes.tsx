'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Route, Trash2, Loader2, Undo2, Ban, Zap } from 'lucide-react'

export interface RouteRow {
  id: string; from_model: string; to_model: string
  // migration 024 (optional so older callers still type-check)
  match?: 'exact' | 'prefix'
  origin?: 'manual' | 'auto'
  reason?: string | null
  activated_at?: string | null
  /** the limit that switched it, for auto routes */
  limit_label?: string | null
  /** API keys whose SDK fetched the policy since the route was activated */
  sdk_keys?: number | null
}

export interface BlockRow {
  id: string; model: string; reason: string | null; created_at: string
  limit_label: string | null; sdk_keys: number | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Locale-independent (no hydration mismatch): "Sep 30, 17:48 UTC". */
function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

function PickedUp({ n }: { n: number | null | undefined }) {
  if (n == null) return null
  return n > 0
    ? <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md bg-[var(--green-bg)] text-teal" title="API keys whose SDK fetched the policy since this was activated">picked up by {n} SDK key{n === 1 ? '' : 's'}</span>
    : <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md bg-[var(--amber-bg)] text-[var(--amber)]" title="No SDK has fetched the policy since this was activated">no SDK has picked it up yet</span>
}

/**
 * Active model routes (and SDK model blocks). Enforced only by apps using the
 * TokenFin SDK wrappers, which poll GET /api/v1/policy every 60 s — there is
 * no proxy. Auto routes come from a limit's switch_model action.
 */
export function RoutesPanel({ orgId, models, recommended, routes, blocks = [], canWrite = true, title = 'Model routing' }: {
  orgId: string; models: string[]; recommended: string | null; routes: RouteRow[]
  blocks?: BlockRow[]; canWrite?: boolean; title?: string
}) {
  const router = useRouter()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(recommended ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create() {
    if (!from || !to || from === to) return
    setBusy(true); setErr(null)
    const res = await fetch('/api/v1/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, from_model: from, to_model: to }) })
    if (!res.ok) setErr((await res.json().catch(() => ({})))?.error?.toString?.() ?? 'Could not add the route')
    setBusy(false); setFrom(''); router.refresh()
  }
  async function remove(q: string) {
    setBusy(true); setErr(null)
    const res = await fetch(`/api/v1/routes?${q}`, { method: 'DELETE' })
    if (!res.ok) setErr('Could not turn it off')
    setBusy(false); router.refresh()
  }

  return (
    <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4" data-testid="routes-panel">
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--fg)]"><Route size={15} className="text-teal" aria-hidden="true" /> {title}</h3>
      <p className="mb-3 text-[11.5px] text-[var(--fg-tertiary)]">
        Requests for “from” are sent to “to” by apps using the TokenFin SDK wrappers (wrapAnthropic / wrapOpenAI), which re-read
        this policy every 60 s. There is no proxy, so other callers are unaffected. Claude Code and other CLI agents get a pending model
        change on the Agents page when a limit switches automatically.
      </p>

      {routes.length === 0 && blocks.length === 0 && (
        <p className="mb-3 text-[11.5px] text-[var(--fg-secondary)]">No active routes.</p>
      )}

      {routes.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {routes.map(r => (
            <li key={r.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[var(--fg)]">
                  <span className="font-medium">{r.from_model}{r.match === 'prefix' ? '*' : ''}</span> → <span className="font-medium text-teal">{r.to_model}</span>
                </span>
                {canWrite && (
                  <button type="button" onClick={() => remove(`id=${encodeURIComponent(r.id)}`)} disabled={busy}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[var(--fg-tertiary)] hover:text-[var(--red)]"
                    aria-label={r.origin === 'auto' ? `Revert automatic switch from ${r.from_model}` : `Remove route from ${r.from_model}`}>
                    {r.origin === 'auto' ? <><Undo2 size={12} aria-hidden="true" /> Revert</> : <Trash2 size={13} aria-hidden="true" />}
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-[var(--fg-tertiary)]">
                {r.origin === 'auto'
                  ? <span className="flex items-center gap-1 font-semibold text-[var(--amber)]"><Zap size={10} aria-hidden="true" /> Auto-switched {fmtWhen(r.activated_at)}{r.limit_label ? ` because of limit ${r.limit_label}` : ''}</span>
                  : <span>Manual{r.activated_at ? ` · since ${fmtWhen(r.activated_at)}` : ''}</span>}
                {r.origin === 'auto' && r.reason && <span title={r.reason} className="truncate max-w-[260px]">· {r.reason}</span>}
                <PickedUp n={r.sdk_keys} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {blocks.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {blocks.map(b => (
            <li key={b.id} className="rounded-lg border border-[var(--red)]/30 bg-[var(--bg)] px-3 py-2 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium text-[var(--red)]"><Ban size={12} aria-hidden="true" /> {b.model}* blocked for SDK apps with enforcePolicy</span>
                {canWrite && (
                  <button type="button" onClick={() => remove(`block_id=${encodeURIComponent(b.id)}`)} disabled={busy}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[var(--fg-tertiary)] hover:text-[var(--red)]" aria-label={`Lift the block on ${b.model}`}>
                    <Undo2 size={12} aria-hidden="true" /> Lift
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-[var(--fg-tertiary)]">
                <span>Since {fmtWhen(b.created_at)}{b.limit_label ? ` because of limit ${b.limit_label}` : ''}</span>
                <PickedUp n={b.sdk_keys} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="From model" value={from} onChange={e => setFrom(e.target.value)} className="min-w-[140px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--fg)]">
            <option value="">from model…</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="text-[var(--fg-tertiary)]" aria-hidden="true">→</span>
          <select aria-label="To model" value={to} onChange={e => setTo(e.target.value)} className="min-w-[140px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--fg)]">
            <option value="">to model…</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button type="button" onClick={create} disabled={busy || !from || !to} className="btn-primary text-[12px] disabled:opacity-60">{busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : 'Add route'}</button>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-[11.5px] text-[var(--red)]">{err}</p>}
    </div>
  )
}
