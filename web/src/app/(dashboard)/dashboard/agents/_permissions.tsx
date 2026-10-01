'use client'

/**
 * Permissions tab — Claude Code `permissions` (allow / ask / deny rules,
 * defaultMode, additionalDirectories) and OpenCode `permission` (edit,
 * webfetch, bash patterns). Edits become ONE pending change request whose
 * patch replaces each edited list whole; the machine applies it with
 * `tokenfin config pull` after showing the diff.
 */
import { useMemo, useState } from 'react'
import { Plus, Trash2, AlertTriangle, Loader2, FlaskConical, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { validatePatch, patchFrom, CLAUDE_PERMISSION_MODES, OC_ACTIONS } from '@/lib/agent-configs/allowlist'
import { claudeDecide, claudeRuleRisk, dirRisk, ocBashDecide, ocRisk, shadowedBy, type Decision } from '@/lib/agent-configs/permissions'
import type { AgentView } from '@/lib/agent-configs/server'
import { submitChange } from './_api'

const CARD = 'bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl'
const ACTION_CLS: Record<Decision, string> = {
  allow: 'bg-[var(--green-bg)] text-[var(--green)]',
  ask:   'bg-[var(--amber-bg)] text-[var(--amber)]',
  deny:  'bg-[var(--red-bg)] text-[var(--red)]',
}
type List = 'allow' | 'ask' | 'deny'
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function ActionSelect({ value, onChange, disabled, allowEmpty }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; allowEmpty?: boolean }) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value || null)} aria-label="Action"
      className={cn('rounded-md border border-[var(--border)] px-1.5 py-1 text-[11.5px] font-semibold', value ? ACTION_CLS[value as Decision] : 'bg-[var(--bg)] text-[var(--fg-tertiary)]')}>
      {allowEmpty && <option value="">(default)</option>}
      {OC_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
    </select>
  )
}

function SaveBar({ agent, orgId, deviceRef, patch, canEdit, onSaved, onReset }: {
  agent: AgentView; orgId: string; deviceRef: string; patch: Record<string, unknown>; canEdit: boolean; onSaved: () => void; onReset: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = Object.keys(patch).length > 0
  const check = dirty ? validatePatch(agent.agent, patch) : null
  if (!canEdit) return <p className="text-[11.5px] text-[var(--fg-tertiary)]">Read-only — only the machine&apos;s owner or a workspace admin can request changes.</p>
  if (!dirty) return <p className="text-[11.5px] text-[var(--fg-tertiary)]">Edit rules above, then request the change. The machine&apos;s owner applies it with <code className="font-mono">tokenfin config pull</code>.</p>
  const save = async () => {
    setBusy(true); setErr(null)
    const e = await submitChange(orgId, deviceRef, agent.agent, patch, reason)
    setBusy(false)
    if (e) setErr(e); else { setReason(''); onSaved() }
  }
  return (
    <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">Pending edit · lists are replaced whole</p>
      <pre className="max-h-40 overflow-auto font-mono text-[11px] text-[var(--fg-secondary)]">{JSON.stringify(patch, null, 2)}</pre>
      <input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="Reason (shown to the machine's owner)" className="input w-full text-[12px]" />
      {check && !check.ok && <p className="text-[11.5px] text-[var(--red)]">{check.errors.join(' · ')}</p>}
      {err && <p className="text-[11.5px] text-[var(--red)]">{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onReset} className="btn-secondary text-[12px]"><Undo2 size={12} /> Discard</button>
        <button onClick={save} disabled={busy || !check?.ok} className="btn-primary text-[12px] disabled:opacity-50">{busy && <Loader2 size={12} className="animate-spin" />} Request change</button>
      </div>
    </div>
  )
}

export function PermissionsCard({ orgId, deviceRef, agent, canEdit, onSaved }: { orgId: string; deviceRef: string; agent: AgentView; canEdit: boolean; onSaved: () => void }) {
  const p = agent.summary.permissions
  if (!p) return <div className={cn(CARD, 'p-8 text-center text-[12.5px] text-[var(--fg-secondary)]')}>This agent has no permission settings TokenFin can manage.</div>
  return p.kind === 'claude'
    ? <ClaudePermissions orgId={orgId} deviceRef={deviceRef} agent={agent} canEdit={canEdit} onSaved={onSaved} />
    : <OpencodePermissions orgId={orgId} deviceRef={deviceRef} agent={agent} canEdit={canEdit} onSaved={onSaved} />
}

// ── Claude Code ─────────────────────────────────────────────────────────────
function ClaudePermissions({ orgId, deviceRef, agent, canEdit, onSaved }: { orgId: string; deviceRef: string; agent: AgentView; canEdit: boolean; onSaved: () => void }) {
  const init = agent.summary.permissions as Extract<NonNullable<AgentView['summary']['permissions']>, { kind: 'claude' }>
  const [lists, setLists] = useState<Record<List, string[]>>({ allow: init.allow, ask: init.ask, deny: init.deny })
  const [mode, setMode] = useState<string | null>(init.defaultMode)
  const [dirs, setDirs] = useState<string[]>(init.additionalDirectories)
  const [newRule, setNewRule] = useState('')
  const [newList, setNewList] = useState<List>('deny')
  const [newDir, setNewDir] = useState('')
  const [probe, setProbe] = useState('Bash(git push origin main)')

  const reset = () => { setLists({ allow: init.allow, ask: init.ask, deny: init.deny }); setMode(init.defaultMode); setDirs(init.additionalDirectories) }
  const rows = (['deny', 'ask', 'allow'] as List[]).flatMap(list => lists[list].map(rule => ({ rule, list })))
  const perms = { ...lists, defaultMode: mode }
  const decision = probe.trim() ? claudeDecide(perms, probe.trim()) : null

  const patch = useMemo(() => {
    const v: Record<string, unknown> = {}
    for (const l of ['allow', 'ask', 'deny'] as List[]) if (!same(lists[l], init[l])) v[`permissions.${l}`] = lists[l]
    if (mode !== init.defaultMode) v['permissions.defaultMode'] = mode
    if (!same(dirs, init.additionalDirectories)) v['permissions.additionalDirectories'] = dirs
    return Object.keys(v).length ? patchFrom(v) : {}
  }, [lists, mode, dirs, init])

  const move = (rule: string, from: List, to: List) => setLists(x => ({ ...x, [from]: x[from].filter(r => r !== rule), [to]: x[to].includes(rule) ? x[to] : [...x[to], rule] }))
  const remove = (rule: string, from: List) => setLists(x => ({ ...x, [from]: x[from].filter(r => r !== rule) }))
  const add = () => {
    const r = newRule.trim()
    if (!r) return
    setLists(x => ({ ...x, [newList]: x[newList].includes(r) ? x[newList] : [...x[newList], r] }))
    setNewRule('')
  }
  const addRisk = newRule.trim() ? claudeRuleRisk(newRule.trim(), newList) : null

  return (
    <div className="space-y-4">
      <div className={cn(CARD, 'p-5')}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--fg)]">Permission rules</h3>
            <p className="text-[11px] text-[var(--fg-tertiary)]">deny wins over ask, ask over allow; anything unmatched follows the permission mode.</p>
          </div>
          <label className="text-[11.5px] text-[var(--fg-secondary)]">
            Permission mode{' '}
            <select value={mode ?? ''} disabled={!canEdit} onChange={e => setMode(e.target.value || null)} className="ml-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 font-mono text-[11.5px]">
              <option value="">default (unset)</option>
              {CLAUDE_PERMISSION_MODES.filter(m => m !== 'default').map(m => <option key={m} value={m}>{m}</option>)}
              {mode === 'bypassPermissions' && <option value="bypassPermissions" disabled>bypassPermissions (machine only)</option>}
            </select>
          </label>
        </div>
        {mode === 'bypassPermissions' && (
          <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-[var(--red-bg)] px-2.5 py-1.5 text-[11.5px] text-[var(--red)]"><AlertTriangle size={12} /> bypassPermissions: Claude Code runs every tool without asking. It can be removed from here, never set.</p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                <th className="py-2 pr-2">Rule</th><th className="px-2 py-2">Action</th><th className="px-2 py-2">Effect</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="py-5 text-center text-[var(--fg-tertiary)]">No rules — every tool call follows the permission mode.</td></tr>}
              {rows.map(({ rule, list }) => {
                const shadow = shadowedBy(perms, rule, list)
                const risk = claudeRuleRisk(rule, list)
                const isNew = !init[list].includes(rule)
                return (
                  <tr key={list + rule} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-1.5 pr-2 font-mono text-[12px] text-[var(--fg)]">{rule}{isNew && <span className="ml-1.5 rounded bg-[var(--blue-bg)] px-1 text-[10px] font-sans font-semibold text-[var(--blue)]">new</span>}</td>
                    <td className="px-2 py-1.5">
                      <select value={list} disabled={!canEdit} onChange={e => move(rule, list, e.target.value as List)} aria-label={`Action for ${rule}`}
                        className={cn('rounded-md border border-[var(--border)] px-1.5 py-1 text-[11.5px] font-semibold', ACTION_CLS[list])}>
                        <option value="allow">allow</option><option value="ask">ask</option><option value="deny">deny</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-[11.5px]">
                      {shadow ? <span className="text-[var(--fg-tertiary)]">shadowed by <code className="font-mono">{shadow}</code></span>
                        : risk ? <span className="inline-flex items-center gap-1 font-semibold text-[var(--red)]"><AlertTriangle size={11} /> {risk}</span>
                        : <span className="text-[var(--fg-tertiary)]">applies</span>}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      {canEdit && <button onClick={() => remove(rule, list)} aria-label={`Remove ${rule}`} className="rounded p-1 text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--red)]"><Trash2 size={13} /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input value={newRule} onChange={e => setNewRule(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
              placeholder="Bash(git push:*)  ·  Edit(src/**)  ·  WebFetch(domain:github.com)" className="input min-w-[240px] flex-1 font-mono text-[12px]" aria-label="New rule" />
            <select value={newList} onChange={e => setNewList(e.target.value as List)} aria-label="New rule action" className={cn('rounded-md border border-[var(--border)] px-1.5 py-1.5 text-[12px] font-semibold', ACTION_CLS[newList])}>
              <option value="deny">deny</option><option value="ask">ask</option><option value="allow">allow</option>
            </select>
            <button onClick={add} disabled={!newRule.trim()} className="btn-secondary text-[12px] disabled:opacity-50"><Plus size={12} /> Add rule</button>
            {addRisk && <span className="flex w-full items-center gap-1 text-[11.5px] font-semibold text-[var(--red)]"><AlertTriangle size={11} /> {addRisk}</span>}
          </div>
        )}
      </div>

      <div className={cn(CARD, 'p-5')}>
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--fg)]"><FlaskConical size={13} /> Which rule wins?</h3>
        <input value={probe} onChange={e => setProbe(e.target.value)} className="input w-full font-mono text-[12px]" aria-label="Test a tool call" placeholder="Bash(npm test) · Edit(src/app.ts)" />
        {decision && (
          <p className="mt-2 text-[12px] text-[var(--fg-secondary)]">
            {decision.decision === 'mode'
              ? <>No rule matches → the permission mode decides (<code className="font-mono">{mode ?? 'default'}</code>: {mode === 'acceptEdits' ? 'edits auto-accepted, other tools ask' : mode === 'plan' ? 'read-only planning' : mode === 'bypassPermissions' ? 'runs without asking' : 'asks'}).</>
              : <><span className={cn('rounded px-1.5 py-0.5 font-semibold', ACTION_CLS[decision.decision])}>{decision.decision}</span> by <code className="font-mono">{decision.rule}</code></>}
            <span className="block text-[10.5px] text-[var(--fg-tertiary)]">Approximation of Claude Code&apos;s matcher, for explaining the config.</span>
          </p>
        )}
      </div>

      <div className={cn(CARD, 'p-5')}>
        <h3 className="text-[13px] font-semibold text-[var(--fg)]">Additional directories</h3>
        <p className="mb-2 text-[11px] text-[var(--fg-tertiary)]">Working directories beyond the project that Claude Code may read and edit.</p>
        {dirs.length === 0 && <p className="text-[12px] text-[var(--fg-tertiary)]">None.</p>}
        <ul className="space-y-1">
          {dirs.map(d => (
            <li key={d} className="flex items-center gap-2 font-mono text-[12px]">
              <span className="text-[var(--fg)]">{d}</span>
              {dirRisk(d) && <span className="inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-[var(--red)]"><AlertTriangle size={11} /> {dirRisk(d)}</span>}
              {canEdit && <button onClick={() => setDirs(x => x.filter(y => y !== d))} aria-label={`Remove ${d}`} className="ml-auto rounded p-1 text-[var(--fg-tertiary)] hover:text-[var(--red)]"><Trash2 size={12} /></button>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="mt-2 flex gap-2">
            <input value={newDir} onChange={e => setNewDir(e.target.value)} placeholder="~/work/shared-lib" className="input flex-1 font-mono text-[12px]" aria-label="New directory" />
            <button onClick={() => { const d = newDir.trim(); if (d && !dirs.includes(d)) setDirs(x => [...x, d]); setNewDir('') }} disabled={!newDir.trim()} className="btn-secondary text-[12px] disabled:opacity-50"><Plus size={12} /> Add</button>
          </div>
        )}
      </div>

      <SaveBar agent={agent} orgId={orgId} deviceRef={deviceRef} patch={patch} canEdit={canEdit} onSaved={onSaved} onReset={reset} />
    </div>
  )
}

// ── OpenCode ────────────────────────────────────────────────────────────────
function OpencodePermissions({ orgId, deviceRef, agent, canEdit, onSaved }: { orgId: string; deviceRef: string; agent: AgentView; canEdit: boolean; onSaved: () => void }) {
  const init = agent.summary.permissions as Extract<NonNullable<AgentView['summary']['permissions']>, { kind: 'opencode' }>
  const initPatterns = init.bash && typeof init.bash === 'object' ? Object.entries(init.bash) : []
  const [edit, setEdit] = useState(init.edit)
  const [webfetch, setWebfetch] = useState(init.webfetch)
  const [bashMode, setBashMode] = useState<'single' | 'patterns'>(typeof init.bash === 'object' && init.bash ? 'patterns' : 'single')
  const [bashAll, setBashAll] = useState<string | null>(typeof init.bash === 'string' ? init.bash : null)
  const [patterns, setPatterns] = useState<[string, string][]>(initPatterns)
  const [newPat, setNewPat] = useState('')
  const [newAct, setNewAct] = useState('deny')
  const [probe, setProbe] = useState('git push --force')

  const reset = () => { setEdit(init.edit); setWebfetch(init.webfetch); setBashMode(typeof init.bash === 'object' && init.bash ? 'patterns' : 'single'); setBashAll(typeof init.bash === 'string' ? init.bash : null); setPatterns(initPatterns) }
  const bashValue: string | Record<string, string> | null = bashMode === 'single' ? bashAll : patterns.length ? Object.fromEntries(patterns) : null
  const patch = useMemo(() => {
    const v: Record<string, unknown> = {}
    if (edit !== init.edit) v['permission.edit'] = edit
    if (webfetch !== init.webfetch) v['permission.webfetch'] = webfetch
    if (!same(bashValue, init.bash)) v['permission.bash'] = bashValue
    return Object.keys(v).length ? patchFrom(v) : {}
  }, [edit, webfetch, bashValue, init])
  const risks = ocRisk({ edit, webfetch, bash: bashValue })
  const decision = probe.trim() ? ocBashDecide(bashValue, probe) : null

  return (
    <div className="space-y-4">
      <div className={cn(CARD, 'p-5')}>
        <h3 className="text-[13px] font-semibold text-[var(--fg)]">Permissions</h3>
        {init.all && <p className="mt-1 text-[11.5px] text-[var(--amber)]">The whole <code className="font-mono">permission</code> is set to &quot;{init.all}&quot;. Setting a field below turns it into per-tool settings.</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[12.5px]">
            <span><span className="font-semibold text-[var(--fg)]">edit</span><span className="block text-[11px] text-[var(--fg-tertiary)]">File edits and writes</span></span>
            <ActionSelect value={edit} onChange={setEdit} disabled={!canEdit} allowEmpty />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[12.5px]">
            <span><span className="font-semibold text-[var(--fg)]">webfetch</span><span className="block text-[11px] text-[var(--fg-tertiary)]">Fetching URLs</span></span>
            <ActionSelect value={webfetch} onChange={setWebfetch} disabled={!canEdit} allowEmpty />
          </label>
        </div>
        {risks.map(r => <p key={r} className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--red)]"><AlertTriangle size={11} /> {r}</p>)}
      </div>

      <div className={cn(CARD, 'p-5')}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--fg)]">bash</h3>
            <p className="text-[11px] text-[var(--fg-tertiary)]">Patterns use * and ?; the <span className="font-semibold">last</span> matching pattern wins.</p>
          </div>
          <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-[11.5px]">
            {(['single', 'patterns'] as const).map(m => (
              <button key={m} disabled={!canEdit} onClick={() => setBashMode(m)} className={cn('rounded-md px-2 py-0.5', bashMode === m ? 'bg-[var(--bg-tertiary)] font-semibold text-[var(--fg)]' : 'text-[var(--fg-tertiary)]')}>
                {m === 'single' ? 'One action' : 'Per pattern'}
              </button>
            ))}
          </div>
        </div>
        {bashMode === 'single' ? (
          <label className="flex items-center gap-2 text-[12.5px]">Every command: <ActionSelect value={bashAll} onChange={setBashAll} disabled={!canEdit} allowEmpty /></label>
        ) : (
          <>
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-[var(--border)] text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]"><th className="py-2 pr-2 w-8">#</th><th className="py-2 pr-2">Pattern</th><th className="px-2 py-2">Action</th><th /></tr></thead>
              <tbody>
                {patterns.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-[var(--fg-tertiary)]">No patterns.</td></tr>}
                {patterns.map(([pat, act], i) => (
                  <tr key={pat} className={cn('border-b border-[var(--border)] last:border-0', decision?.pattern === pat && 'bg-[var(--bg-active)]')}>
                    <td className="py-1.5 pr-2 text-[var(--fg-tertiary)]">{i + 1}</td>
                    <td className="py-1.5 pr-2 font-mono text-[var(--fg)]">{pat}</td>
                    <td className="px-2 py-1.5"><ActionSelect value={act} disabled={!canEdit} onChange={v => setPatterns(x => x.map(([k, a]) => [k, k === pat ? (v ?? a) : a]))} /></td>
                    <td className="py-1.5 pl-2 text-right">{canEdit && <button onClick={() => setPatterns(x => x.filter(([k]) => k !== pat))} aria-label={`Remove ${pat}`} className="rounded p-1 text-[var(--fg-tertiary)] hover:text-[var(--red)]"><Trash2 size={13} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canEdit && (
              <div className="mt-3 flex flex-wrap gap-2">
                <input value={newPat} onChange={e => setNewPat(e.target.value)} placeholder="git push*" className="input min-w-[200px] flex-1 font-mono text-[12px]" aria-label="New pattern" />
                <ActionSelect value={newAct} onChange={v => setNewAct(v ?? 'deny')} />
                <button disabled={!newPat.trim()} onClick={() => { const k = newPat.trim(); setPatterns(x => [...x.filter(([p]) => p !== k), [k, newAct]]); setNewPat('') }} className="btn-secondary text-[12px] disabled:opacity-50"><Plus size={12} /> Add pattern</button>
              </div>
            )}
          </>
        )}
        <div className="mt-4 rounded-lg bg-[var(--bg-secondary)] p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--fg)]"><FlaskConical size={12} /> Test a command</p>
          <input value={probe} onChange={e => setProbe(e.target.value)} className="input w-full font-mono text-[12px]" aria-label="Test a bash command" />
          {decision && <p className="mt-1.5 text-[12px] text-[var(--fg-secondary)]">
            {decision.action ? <><span className={cn('rounded px-1.5 py-0.5 font-semibold', ACTION_CLS[decision.action])}>{decision.action}</span> by <code className="font-mono">{decision.pattern}</code></> : <>No pattern matches → OpenCode&apos;s default (ask).</>}
          </p>}
        </div>
      </div>

      <SaveBar agent={agent} orgId={orgId} deviceRef={deviceRef} patch={patch} canEdit={canEdit} onSaved={onSaved} onReset={reset} />
    </div>
  )
}
