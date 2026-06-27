'use client'

import { useState } from 'react'
import { Users, Copy, Check, KeyRound, Loader2 } from 'lucide-react'
import type { SimpleRow } from './page'

interface ProvisionResult {
  members: Array<{ email: string; invited: boolean; keys: Array<{ ok: boolean; reveal_url?: string; project_id: string; error?: string }> }>
  service_accounts: Array<{ name: string; ok: boolean; reveal_url?: string; error?: string }>
  summary: { members_invited: number; keys_created: number }
}

export function ProvisionClient({ orgId, projects, teams }: { orgId: string; projects: SimpleRow[]; teams: SimpleRow[] }) {
  const [emails, setEmails]       = useState('')
  const [role, setRole]           = useState('member')
  const [env, setEnv]             = useState('production')
  const [teamId, setTeamId]       = useState('')
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [autoKey, setAutoKey]     = useState(true)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState('')
  const [result, setResult]       = useState<ProvisionResult | null>(null)
  const [copied, setCopied]       = useState('')

  const emailList = emails.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean)

  function toggleProject(id: string) {
    setProjectIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  }

  async function submit() {
    setError(''); setResult(null)
    if (emailList.length === 0) { setError('Add at least one email'); return }
    if (autoKey && projectIds.length === 0) { setError('Pick at least one project (or turn off auto-key)'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/v1/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, role, env, team_id: teamId || null, project_ids: projectIds, emails: emailList, auto_key: autoKey }),
      })
      const data = await res.json()
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Provisioning failed'); return }
      setResult(data)
    } catch { setError('Network error') } finally { setBusy(false) }
  }

  function copy(url: string) { navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(''), 2000) }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--green-bg)]"><Users size={20} className="text-teal" /></div>
        <div>
          <h1 className="text-[19px] font-bold text-[var(--fg)]">Provision team</h1>
          <p className="text-[13px] text-[var(--fg-secondary)]">Invite many members and auto-generate a key for each — no logins or manual tokens.</p>
        </div>
      </div>

      {!result && (
        <div className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--fg)]">Emails</label>
            <textarea value={emails} onChange={e => setEmails(e.target.value)} rows={5}
              placeholder="alice@co.com, bob@co.com — paste up to hundreds, separated by commas, spaces, or newlines"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--border-strong)]" />
            <p className="mt-1 text-[11.5px] text-[var(--fg-tertiary)]">{emailList.length} email{emailList.length === 1 ? '' : 's'} detected</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Role">
              <select value={role} onChange={e => setRole(e.target.value)} className={selectCls}>
                <option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option>
              </select>
            </Field>
            <Field label="Environment">
              <select value={env} onChange={e => setEnv(e.target.value)} className={selectCls}>
                <option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option>
              </select>
            </Field>
            <Field label="Team (optional)">
              <select value={teamId} onChange={e => setTeamId(e.target.value)} className={selectCls}>
                <option value="">No team</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2.5 text-[13px] font-medium text-[var(--fg)]">
            <input type="checkbox" checked={autoKey} onChange={e => setAutoKey(e.target.checked)} className="h-4 w-4 accent-teal" />
            <KeyRound size={15} className="text-[var(--fg-tertiary)]" /> Auto-generate an API key for each member (one-time secure reveal link)
          </label>

          {autoKey && (
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--fg)]">Projects</label>
              {projects.length === 0 ? (
                <p className="text-[12.5px] text-[var(--fg-tertiary)]">No projects yet — create one first.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {projects.map(p => (
                    <button key={p.id} type="button" onClick={() => toggleProject(p.id)}
                      className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${projectIds.includes(p.id) ? 'border-teal bg-[var(--green-bg)] text-teal' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)]'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-[12.5px] text-red-500">{error}</p>}

          <button onClick={submit} disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60">
            {busy ? <><Loader2 size={15} className="animate-spin" /> Provisioning…</> : `Provision ${emailList.length || ''} member${emailList.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
          <div className="mb-4 rounded-xl bg-[var(--green-bg)] p-3 text-[13px] text-teal">
            ✓ Invited {result.summary.members_invited} member(s) · created {result.summary.keys_created} key(s).
            Share each reveal link with its owner — usable once.
          </div>
          <div className="space-y-3">
            {result.members.map(m => (
              <div key={m.email} className="rounded-xl border border-[var(--border)] p-3">
                <div className="mb-2 text-[13px] font-semibold text-[var(--fg)]">{m.email}</div>
                {m.keys.length === 0 && <p className="text-[12px] text-[var(--fg-tertiary)]">Invited (no key requested)</p>}
                {m.keys.map((k, i) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    {k.ok && k.reveal_url ? (
                      <>
                        <code className="flex-1 truncate font-mono text-[11px] text-[var(--fg-secondary)]">{k.reveal_url}</code>
                        <button onClick={() => copy(k.reveal_url!)} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)]">
                          {copied === k.reveal_url ? <><Check size={11} className="text-teal" />Copied</> : <><Copy size={11} />Copy link</>}
                        </button>
                      </>
                    ) : <p className="text-[11.5px] text-red-500">Key failed: {k.error}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button onClick={() => { setResult(null); setEmails(''); setProjectIds([]) }} className="btn-secondary mt-4">Provision more</button>
        </div>
      )}
    </div>
  )
}

const selectCls = 'w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--border-strong)]'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--fg)]">{label}</label>{children}</div>
}
