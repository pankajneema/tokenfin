'use client'
import { useState, useEffect } from 'react'
import { Plus, Copy, Eye, EyeOff, Trash2, ToggleLeft, ToggleRight, Key } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ApiKey {
  id: string; name: string; key_prefix: string; is_active: boolean
  last_used_at: string | null; created_at: string; projects?: { name: string }
}

export default function KeysPage() {
  const [keys, setKeys]         = useState<ApiKey[]>([])
  const [showNew, setShowNew]   = useState(false)
  const [newKey, setNewKey]     = useState<string | null>(null)
  const [name, setName]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [copied, setCopied]     = useState(false)

  useEffect(() => { fetchKeys() }, [])

  async function fetchKeys() {
    // In production: use actual org_id from session
    const res = await fetch('/api/keys?org_id=demo')
    if (res.ok) setKeys(await res.json())
  }

  async function createKey() {
    setLoading(true)
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: 'demo', project_id: 'demo', name, created_by: 'demo' }),
    })
    const data = await res.json()
    if (data.raw_key) { setNewKey(data.raw_key); fetchKeys() }
    setLoading(false); setShowNew(false); setName('')
  }

  async function toggleKey(id: string, current: boolean) {
    await fetch('/api/keys', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_active: !current }) })
    fetchKeys()
  }

  async function deleteKey(id: string) {
    if (!confirm('Delete this API key? This cannot be undone.')) return
    await fetch(`/api/keys?id=${id}`, { method: 'DELETE' })
    fetchKeys()
  }

  function copyKey() {
    if (newKey) { navigator.clipboard.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">API Keys</h1>
          <p className="text-sm text-[var(--fg-secondary)] mt-0.5">Manage keys for SDK integration</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <Plus size={15} /> New Key
        </button>
      </div>

      {/* New key revealed */}
      {newKey && (
        <div className="card p-4 border-teal/30 bg-[var(--green-bg)]">
          <p className="text-sm font-medium text-[var(--green)] mb-2">⚡ Copy your key now — it won't be shown again</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white dark:bg-[#0A2A20] px-3 py-2 rounded-lg text-[var(--fg)] font-mono break-all">{newKey}</code>
            <button onClick={copyKey} className={cn('btn-secondary shrink-0', copied && 'border-teal text-teal')}>
              <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="mt-2 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg)]">Dismiss</button>
        </div>
      )}

      {/* New key form */}
      {showNew && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[var(--fg)] mb-4">Create new API key</h3>
          <div className="flex gap-3">
            <input value={name} onChange={e => setName(e.target.value)} className="input flex-1"
              placeholder="e.g. Production Backend" />
            <button onClick={createKey} disabled={!name || loading} className="btn-primary">
              {loading ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setShowNew(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Keys list */}
      <div className="card overflow-hidden">
        {keys.length === 0 ? (
          <div className="py-16 text-center">
            <Key size={32} className="text-[var(--fg-tertiary)] mx-auto mb-3" />
            <p className="text-sm text-[var(--fg-secondary)]">No API keys yet</p>
            <button onClick={() => setShowNew(true)} className="mt-3 text-sm text-coral hover:underline">Create your first key</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)]">
              <tr>{['Name','Prefix','Project','Status','Last Used',''].map(h => (
                <th key={h} className="text-left px-4 py-3 label">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {keys.map(k => (
                <tr key={k.id} className="hover:bg-[var(--bg-hover)] transition-colors">
                  <td className="px-4 py-3 font-medium text-[var(--fg)]">{k.name}</td>
                  <td className="px-4 py-3 mono text-[var(--fg-secondary)]">{k.key_prefix}…</td>
                  <td className="px-4 py-3 text-[var(--fg-secondary)]">{k.projects?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={k.is_active ? 'badge-green' : 'badge-gray'}>
                      {k.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-tertiary)] text-xs">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => toggleKey(k.id, k.is_active)} className="btn-ghost p-1.5" title={k.is_active ? 'Deactivate' : 'Activate'}>
                        {k.is_active ? <ToggleRight size={16} className="text-teal" /> : <ToggleLeft size={16} />}
                      </button>
                      <button onClick={() => deleteKey(k.id)} className="btn-ghost p-1.5 text-[var(--red)] hover:bg-[var(--red-bg)]">
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
