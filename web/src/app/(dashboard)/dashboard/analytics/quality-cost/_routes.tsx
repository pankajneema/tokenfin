'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Route, Trash2, Loader2 } from 'lucide-react'

export interface RouteRow { id: string; from_model: string; to_model: string }

export function RoutesPanel({ orgId, models, recommended, routes }: {
  orgId: string; models: string[]; recommended: string | null; routes: RouteRow[]
}) {
  const router = useRouter()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(recommended ?? '')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!from || !to || from === to) return
    setBusy(true)
    await fetch('/api/v1/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, from_model: from, to_model: to }) })
    setBusy(false); setFrom(''); router.refresh()
  }
  async function remove(id: string) {
    setBusy(true)
    await fetch(`/api/v1/routes?id=${id}`, { method: 'DELETE' })
    setBusy(false); router.refresh()
  }

  return (
    <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--fg)]"><Route size={15} className="text-teal" /> Auto-routing</div>
      <p className="mb-3 text-[11.5px] text-[var(--fg-tertiary)]">The gateway rewrites requests for “from” to “to” (same provider). Savings recorded automatically. Requires the gateway with TOKENFIN_ROUTING=1.</p>

      {routes.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {routes.map(r => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px]">
              <span className="text-[var(--fg)]"><span className="font-medium">{r.from_model}</span> → <span className="font-medium text-teal">{r.to_model}</span></span>
              <button onClick={() => remove(r.id)} disabled={busy} className="text-[var(--fg-tertiary)] hover:text-red-500"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <select value={from} onChange={e => setFrom(e.target.value)} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--fg)]">
          <option value="">from model…</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-[var(--fg-tertiary)]">→</span>
        <select value={to} onChange={e => setTo(e.target.value)} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--fg)]">
          <option value="">to model…</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={create} disabled={busy || !from || !to} className="btn-primary text-[12px] disabled:opacity-60">{busy ? <Loader2 size={13} className="animate-spin" /> : 'Add route'}</button>
      </div>
    </div>
  )
}
