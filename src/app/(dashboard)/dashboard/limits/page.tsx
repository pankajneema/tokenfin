'use client'
import { useState, useEffect } from 'react'
import { Plus, Trash2, Shield } from 'lucide-react'
import { formatCost } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface Limit {
  id: string; scope: string; period: string; budget_usd: number
  warn_at: number; throttle_at: number; block_at: number; is_active: boolean; created_at: string
}

export default function LimitsPage() {
  const [limits, setLimits] = useState<Limit[]>([])
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ scope: 'project', period: 'monthly', budget_usd: '', warn_at: 70, throttle_at: 90, block_at: 100 })
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetch('/api/limits?org_id=demo').then(r => r.json()).then(setLimits).catch(() => {}) }, [])

  async function createLimit() {
    setLoading(true)
    await fetch('/api/limits', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: 'demo', ...form, budget_usd: Number(form.budget_usd) }) })
    setLoading(false); setShowNew(false)
    fetch('/api/limits?org_id=demo').then(r => r.json()).then(setLimits)
  }

  async function deleteLimit(id: string) {
    await fetch(`/api/limits?id=${id}`, { method: 'DELETE' })
    setLimits(prev => prev.filter(l => l.id !== id))
  }

  const SCOPE_COLORS: Record<string, string> = { org: 'badge-amber', project: 'badge-blue', team: 'badge-green', member: 'badge-gray' }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Limits</h1>
          <p className="text-sm text-[var(--fg-secondary)] mt-0.5">Budget guardrails · 70% warn → 90% throttle → 100% block</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={15} /> New Limit</button>
      </div>

      {showNew && (
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--fg)]">New budget limit</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-1.5 block">Scope</label>
              <select value={form.scope} onChange={e => setForm(p => ({...p, scope: e.target.value}))} className="input">
                {['org','project','team','member'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label mb-1.5 block">Period</label>
              <select value={form.period} onChange={e => setForm(p => ({...p, period: e.target.value}))} className="input">
                {['daily','weekly','monthly'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label mb-1.5 block">Budget (USD)</label>
              <input type="number" value={form.budget_usd} onChange={e => setForm(p => ({...p, budget_usd: e.target.value}))}
                className="input" placeholder="500" />
            </div>
            <div>
              <label className="label mb-1.5 block">Warn at %</label>
              <input type="number" value={form.warn_at} onChange={e => setForm(p => ({...p, warn_at: +e.target.value}))} className="input" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createLimit} disabled={!form.budget_usd || loading} className="btn-primary">{loading ? 'Saving…' : 'Save limit'}</button>
            <button onClick={() => setShowNew(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {limits.length === 0 ? (
          <div className="py-16 text-center">
            <Shield size={32} className="text-[var(--fg-tertiary)] mx-auto mb-3" />
            <p className="text-sm text-[var(--fg-secondary)]">No limits set — all spend is uncapped</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)]">
              <tr>{['Scope','Period','Budget','Warn','Throttle','Block',''].map(h => (
                <th key={h} className="text-left px-4 py-3 label">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {limits.map(l => (
                <tr key={l.id} className="hover:bg-[var(--bg-hover)] transition-colors">
                  <td className="px-4 py-3"><span className={SCOPE_COLORS[l.scope] ?? 'badge-gray'}>{l.scope}</span></td>
                  <td className="px-4 py-3 text-[var(--fg-secondary)] capitalize">{l.period}</td>
                  <td className="px-4 py-3 font-semibold text-[var(--fg)]">{formatCost(l.budget_usd)}</td>
                  <td className="px-4 py-3 text-[var(--amber)]">{l.warn_at}%</td>
                  <td className="px-4 py-3 text-[var(--red)]">{l.throttle_at}%</td>
                  <td className="px-4 py-3 text-[var(--red)] font-medium">{l.block_at}%</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => deleteLimit(l.id)} className="btn-ghost p-1.5 text-[var(--red)] hover:bg-[var(--red-bg)]">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
