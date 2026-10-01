'use client'

/**
 * Hooks tab — Claude Code hooks (event → matcher → commands), read from the
 * snapshot's hooks_index (commands redacted on the machine). Allowed remote
 * operations: enable / disable / delete an existing hook, or add a FIXED
 * TokenFin template. Free-form commands are never accepted from the web.
 */
import { useMemo, useState } from 'react'
import { Loader2, Plus, Power, PowerOff, Trash2, Undo2, Webhook } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HOOK_TEMPLATES, validatePatch, type HookOp } from '@/lib/agent-configs/allowlist'
import type { AgentView } from '@/lib/agent-configs/server'
import type { HookEntry } from '@/lib/agent-configs/summary'
import { submitChange } from './_api'

const CARD = 'bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl'
type Staged = 'disable' | 'enable' | 'delete'

export function HooksCard({ orgId, deviceRef, agent, canEdit, onSaved }: { orgId: string; deviceRef: string; agent: AgentView; canEdit: boolean; onSaved: () => void }) {
  const hooks = agent.summary.hookList
  const [staged, setStaged] = useState<Record<string, Staged>>({})
  const [addTemplate, setAddTemplate] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const groups = useMemo(() => {
    const m = new Map<string, Map<string, HookEntry[]>>()
    for (const h of hooks) {
      if (!m.has(h.event)) m.set(h.event, new Map())
      const byMatcher = m.get(h.event)!
      byMatcher.set(h.matcher, [...(byMatcher.get(h.matcher) ?? []), h])
    }
    return m
  }, [hooks])
  const hasSessionTemplate = hooks.some(h => h.tokenfin && h.event === 'SessionStart')
  const ops: HookOp[] = [
    ...Object.entries(staged).map(([id, op]) => ({ op, id })),
    ...(addTemplate ? [{ op: 'add_template' as const, template: 'tokenfin-session' as const }] : []),
  ]
  const patch = ops.length ? { $tokenfin: { hooks: ops } } : null
  const check = patch ? validatePatch(agent.agent, patch) : null
  const toggle = (id: string, op: Staged) => setStaged(x => { const n = { ...x }; if (n[id] === op) delete n[id]; else n[id] = op; return n })

  const save = async () => {
    if (!patch) return
    setBusy(true); setErr(null)
    const e = await submitChange(orgId, deviceRef, agent.agent, patch, reason)
    setBusy(false)
    if (e) setErr(e); else { setStaged({}); setAddTemplate(false); setReason(''); onSaved() }
  }

  return (
    <div className="space-y-4">
      <div className={cn(CARD, 'p-5')}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--fg)]">Hooks</h3>
            <p className="text-[11px] text-[var(--fg-tertiary)]">Shell commands Claude Code runs on events. Commands are shown redacted. Disabled hooks are parked in ~/.tokenfin on the machine and can be re-enabled.</p>
          </div>
          {canEdit && !hasSessionTemplate && (
            <button onClick={() => setAddTemplate(x => !x)} className={cn('btn-secondary text-[12px]', addTemplate && 'ring-2 ring-[var(--teal)]')}>
              <Plus size={12} /> {addTemplate ? 'Will add' : 'Add'} TokenFin session hooks
            </button>
          )}
        </div>
        {hooks.length === 0 && !addTemplate && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[12.5px] text-[var(--fg-secondary)]">
            <Webhook size={20} className="mx-auto mb-2 text-[var(--fg-tertiary)]" /> No hooks configured.
          </div>
        )}
        <div className="space-y-4">
          {Array.from(groups.entries()).map(([event, byMatcher]) => (
            <div key={event}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{event}</p>
              <div className="space-y-2">
                {Array.from(byMatcher.entries()).map(([matcher, list]) => (
                  <div key={matcher} className="rounded-xl border border-[var(--border)]">
                    <p className="border-b border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--fg-secondary)]">
                      matcher <code className="font-mono text-[var(--fg)]">{matcher || '(all)'}</code>
                    </p>
                    {list.map(h => {
                      const st = staged[h.id]
                      return (
                        <div key={h.id} className={cn('flex flex-wrap items-center gap-2 px-3 py-2', (h.disabled && st !== 'enable') || st === 'disable' ? 'opacity-60' : '', st === 'delete' && 'line-through')}>
                          <code className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-[var(--fg)]">{h.command || `(${h.type})`}</code>
                          {h.timeout !== null && <span className="text-[10.5px] text-[var(--fg-tertiary)]">{h.timeout}s</span>}
                          {h.tokenfin && <span className="rounded bg-[var(--blue-bg)] px-1.5 text-[10px] font-semibold text-[var(--blue)]">TokenFin</span>}
                          {h.disabled && <span className="rounded bg-[var(--bg-tertiary)] px-1.5 text-[10px] font-semibold text-[var(--fg-tertiary)]">disabled</span>}
                          {st && <span className="rounded bg-[var(--amber-bg)] px-1.5 text-[10px] font-semibold text-[var(--amber)]">will {st}</span>}
                          {canEdit && (
                            <span className="flex gap-1">
                              {h.disabled
                                ? <button onClick={() => toggle(h.id, 'enable')} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"><Power size={11} /> Enable</button>
                                : <button onClick={() => toggle(h.id, 'disable')} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"><PowerOff size={11} /> Disable</button>}
                              <button onClick={() => toggle(h.id, 'delete')} aria-label="Delete hook" className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--fg-secondary)] hover:bg-[var(--red-bg)] hover:text-[var(--red)]"><Trash2 size={11} /> Delete</button>
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {addTemplate && (
            <div className="rounded-xl border border-dashed border-[var(--teal)] px-3 py-2 text-[12px] text-[var(--fg-secondary)]">
              <span className="font-semibold text-[var(--fg)]">+ {HOOK_TEMPLATES['tokenfin-session']}</span>
              <span className="block font-mono text-[11px] text-[var(--fg-tertiary)]">node ~/.tokenfin/hooks/session.js · timeout 5s · sends session id, cwd, git branch/remote, hostname — never transcripts</span>
            </div>
          )}
        </div>
        <p className="mt-3 text-[11px] text-[var(--fg-tertiary)]">New hooks can only come from fixed TokenFin templates here. A custom command must be added on the machine itself.</p>
      </div>

      {canEdit && patch && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{ops.length} hook operation{ops.length === 1 ? '' : 's'}</p>
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="Reason (shown to the machine's owner)" className="input w-full text-[12px]" />
          {check && !check.ok && <p className="text-[11.5px] text-[var(--red)]">{check.errors.join(' · ')}</p>}
          {err && <p className="text-[11.5px] text-[var(--red)]">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setStaged({}); setAddTemplate(false) }} className="btn-secondary text-[12px]"><Undo2 size={12} /> Discard</button>
            <button onClick={save} disabled={busy || !check?.ok} className="btn-primary text-[12px] disabled:opacity-50">{busy && <Loader2 size={12} className="animate-spin" />} Request change</button>
          </div>
        </div>
      )}
    </div>
  )
}
