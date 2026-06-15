'use client'
import { useState, useEffect } from 'react'
import { Plus, Bell, Mail, Slack, Trash2, ToggleRight, ToggleLeft } from 'lucide-react'
import { formatCost } from '@/lib/utils'

interface AlertRule {
  id: string; name: string; trigger_type: string; threshold: number | null
  channels: { email?: boolean; slack?: boolean; telegram?: boolean; webhook?: string }
  is_active: boolean; created_at: string
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: '', trigger_type: 'threshold', threshold: '', email: true, slack: false, telegram: false, webhook: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetch('/api/alerts?org_id=demo').then(r => r.json()).then(setRules).catch(() => {}) }, [])

  async function createRule() {
    setLoading(true)
    await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: 'demo', name: form.name, trigger_type: form.trigger_type,
        threshold: form.threshold ? +form.threshold : undefined,
        channels: { email: form.email, slack: form.slack, telegram: form.telegram, webhook: form.webhook || undefined },
      })
    })
    setLoading(false); setShowNew(false)
    fetch('/api/alerts?org_id=demo').then(r => r.json()).then(setRules)
  }

  async function toggleRule(id: string, current: boolean) {
    await fetch('/api/alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_active: !current }) })
    setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: !current } : r))
  }

  async function deleteRule(id: string) {
    await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' })
    setRules(prev => prev.filter(r => r.id !== id))
  }

  const TYPE_BADGE: Record<string, string> = { threshold: 'badge-amber', anomaly: 'badge-blue', limit_breach: 'badge-red' }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="text-sm text-[var(--fg-secondary)] mt-0.5">Notify via email, Slack, Telegram, or webhook</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={15} /> New Alert</button>
      </div>

      {showNew && (
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--fg)]">New alert rule</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label mb-1.5 block">Rule name</label>
              <input value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))} className="input" placeholder="Daily spend over $100" />
            </div>
            <div>
              <label className="label mb-1.5 block">Trigger</label>
              <select value={form.trigger_type} onChange={e => setForm(p => ({...p, trigger_type: e.target.value}))} className="input">
                <option value="threshold">Threshold ($ amount)</option>
                <option value="anomaly">Anomaly detection</option>
                <option value="limit_breach">Limit breach</option>
              </select>
            </div>
            {form.trigger_type === 'threshold' && (
              <div>
                <label className="label mb-1.5 block">Threshold (USD)</label>
                <input type="number" value={form.threshold} onChange={e => setForm(p => ({...p, threshold: e.target.value}))} className="input" placeholder="100" />
              </div>
            )}
          </div>
          <div>
            <label className="label mb-2 block">Channels</label>
            <div className="flex flex-wrap gap-2">
              {[{ key: 'email', label: 'Email', icon: Mail }, { key: 'slack', label: 'Slack', icon: Slack }, { key: 'telegram', label: 'Telegram', icon: Bell }].map(ch => (
                <button key={ch.key} onClick={() => setForm(p => ({...p, [ch.key]: !(p as any)[ch.key]}))}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${(form as any)[ch.key] ? 'bg-coral text-white border-coral' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]'}`}>
                  <ch.icon size={14} /> {ch.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createRule} disabled={!form.name || loading} className="btn-primary">{loading ? 'Saving…' : 'Save rule'}</button>
            <button onClick={() => setShowNew(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {rules.length === 0 ? (
          <div className="py-16 text-center">
            <Bell size={32} className="text-[var(--fg-tertiary)] mx-auto mb-3" />
            <p className="text-sm text-[var(--fg-secondary)]">No alert rules — you won't be notified of spend spikes</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)]">
              <tr>{['Name','Type','Threshold','Channels','Status',''].map(h => (
                <th key={h} className="text-left px-4 py-3 label">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rules.map(r => (
                <tr key={r.id} className="hover:bg-[var(--bg-hover)] transition-colors">
                  <td className="px-4 py-3 font-medium text-[var(--fg)]">{r.name}</td>
                  <td className="px-4 py-3"><span className={TYPE_BADGE[r.trigger_type] ?? 'badge-gray'}>{r.trigger_type.replace('_',' ')}</span></td>
                  <td className="px-4 py-3 text-[var(--fg-secondary)]">{r.threshold ? formatCost(r.threshold) : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {r.channels.email    && <span className="badge-gray"><Mail size={10} /> Email</span>}
                      {r.channels.slack    && <span className="badge-gray"><Slack size={10} /> Slack</span>}
                      {r.channels.telegram && <span className="badge-gray"><Bell size={10} /> Telegram</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={r.is_active ? 'badge-green' : 'badge-gray'}>{r.is_active ? 'Active' : 'Paused'}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => toggleRule(r.id, r.is_active)} className="btn-ghost p-1.5">
                        {r.is_active ? <ToggleRight size={16} className="text-teal" /> : <ToggleLeft size={16} />}
                      </button>
                      <button onClick={() => deleteRule(r.id)} className="btn-ghost p-1.5 text-[var(--red)] hover:bg-[var(--red-bg)]">
                        <Trash2 size={14} />
                      </button>
                    </div>
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
