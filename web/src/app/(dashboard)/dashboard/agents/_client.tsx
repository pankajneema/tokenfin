'use client'

/**
 * Agents — which coding agents run on each person's machines and how they are
 * configured. Left: people → devices → agents. Right: the selected agent's
 * summary, warnings, full (redacted) config, history and change requests.
 * Changes are pull-based: saving creates a PENDING request that the CLI on the
 * machine applies with `npx tokenfin config pull` (docs/AGENTS_CONFIG.md).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Bot, Laptop, ChevronRight, ChevronDown, Search, Copy, Check, AlertTriangle, AlertOctagon, Info, Wrench,
  Pencil, RefreshCw, History as HistoryIcon, ListChecks, Braces, FileCode2, Radio, Loader2, X, Terminal, User2, ShieldHalf, Webhook, RotateCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog } from '@/components/ui/dialog'
import { TimeAgo, relTime } from '@/components/ui/time-ago'
import { AGENT_META, type AgentId } from '@/lib/agent-configs/agents'
import { ALLOW, patchFrom, validatePatch, type FieldSpec } from '@/lib/agent-configs/allowlist'
import { diffConfigs, type DiffEntry } from '@/lib/agent-configs/diff'
import type { AgentSummary, Warning } from '@/lib/agent-configs/summary'
import type { PersonView, DeviceView, AgentView, ChangeRow, HistoryRow } from '@/lib/agent-configs/server'
import { submitChange } from './_api'
import { PermissionsCard } from './_permissions'
import { HooksCard } from './_hooks'

interface Props { orgId: string; people: PersonView[]; viewerId: string; isAdmin: boolean; appUrl: string; loadError: boolean }
type Sel = { ref: string; agent: AgentId } | null
type Tab = 'overview' | 'permissions' | 'hooks' | 'history' | 'changes'

const CARD = 'bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl'
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`

function health(a: AgentView): 'ok' | 'warn' | 'error' {
  if (a.summary.warnings.some(w => w.severity === 'error')) return 'error'
  if (!a.flowing || a.summary.warnings.some(w => w.severity === 'warn')) return 'warn'
  return 'ok'
}
const DOT = { ok: 'bg-[var(--teal)]', warn: 'bg-amber-400', error: 'bg-[var(--accent)]' }

function useCopy() {
  const [done, setDone] = useState(false)
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => { setDone(true); setTimeout(() => setDone(false), 1400) }) }
  return { done, copy }
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function AgentsClient({ orgId, people, viewerId, isAdmin, appUrl, loadError }: Props) {
  const router = useRouter()
  const devices = useMemo(() => people.flatMap(p => p.devices.map(d => ({ person: p, device: d }))), [people])
  const firstSel = useMemo<Sel>(() => {
    const hit = devices.find(x => x.device.agents.length > 0)
    return hit ? { ref: hit.device.ref, agent: hit.device.agents[0].agent } : null
  }, [devices])
  const [sel, setSel] = useState<Sel>(firstSel)
  const [q, setQ] = useState('')
  useEffect(() => { if (!sel && firstSel) setSel(firstSel) }, [sel, firstSel])

  const current = useMemo(() => {
    if (!sel) return null
    const hit = devices.find(x => x.device.ref === sel.ref)
    const agent = hit?.device.agents.find(a => a.agent === sel.agent)
    return hit && agent ? { ...hit, agent } : null
  }, [devices, sel])

  // While a change is pending anywhere visible, refresh so "applied" shows up.
  const anyPending = devices.some(x => x.device.changes.some(c => c.status === 'pending'))
  useEffect(() => {
    if (!anyPending) return
    const t = setInterval(() => router.refresh(), 10_000)
    return () => clearInterval(t)
  }, [anyPending, router])

  const totals = useMemo(() => {
    const agents = devices.flatMap(x => x.device.agents)
    return {
      people: people.filter(p => p.devices.length > 0).length, devices: devices.length, agents: agents.length,
      flowing: agents.filter(a => a.flowing).length, issues: agents.filter(a => health(a) === 'error').length,
      pending: devices.reduce((n, x) => n + x.device.changes.filter(c => c.status === 'pending').length, 0),
    }
  }, [people, devices])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return people
    return people.map(p => {
      const personHit = p.email.toLowerCase().includes(s) || p.name.toLowerCase().includes(s)
      return {
        ...p,
        devices: personHit ? p.devices : p.devices.filter(d =>
          (d.hostname ?? '').toLowerCase().includes(s) ||
          d.agents.some(a => AGENT_META[a.agent].label.toLowerCase().includes(s) || (a.summary.model ?? '').toLowerCase().includes(s))),
      }
    }).filter(p => p.devices.length > 0 || p.email.toLowerCase().includes(s))
  }, [people, q])

  if (loadError) {
    return <div className={cn(CARD, 'p-8 text-center text-[13px] text-[var(--fg-secondary)]')}>Could not load agent configs. Is migration 022 applied?</div>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-[13px] text-[var(--fg-secondary)]">
            Which coding agents run on {isAdmin ? 'each person’s' : 'your'} machines and how they are configured.
            Configs are redacted on the machine before upload — keys and tokens never leave it.
          </p>
          <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
            {totals.devices} device{totals.devices === 1 ? '' : 's'} · {totals.agents} agent{totals.agents === 1 ? '' : 's'}
            {isAdmin && <> · {totals.people} {totals.people === 1 ? 'person' : 'people'}</>}
            {' '}· <span className="font-semibold text-[var(--green)]">{totals.flowing} sending telemetry</span>
            {totals.issues > 0 && <> · <span className="font-semibold text-[var(--red)]">{totals.issues} need attention</span></>}
            {totals.pending > 0 && <> · <span className="font-semibold text-[var(--amber)]">{totals.pending} change{totals.pending === 1 ? '' : 's'} pending</span></>}
          </p>
        </div>
        <button onClick={() => router.refresh()} className="btn-secondary text-[12.5px]"><RefreshCw size={13} /> Refresh</button>
      </div>

      {devices.length === 0 ? (
        <EmptyState isAdmin={isAdmin} memberCount={people.length} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className={cn(CARD, 'p-3 self-start lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto')}>
            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={isAdmin ? 'Person, machine, agent, model…' : 'Machine, agent, model…'}
                aria-label="Filter devices" className="input w-full py-2 pl-8 text-[12.5px]" />
            </div>
            <PeopleTree people={filtered} sel={sel} onSelect={setSel} viewerId={viewerId} isAdmin={isAdmin} />
          </aside>

          <section className="min-w-0">
            {current ? (
              <AgentDetail key={`${current.device.ref}:${current.agent.agent}`} orgId={orgId} appUrl={appUrl}
                person={current.person} device={current.device} agent={current.agent} onChanged={() => router.refresh()} />
            ) : (
              <div className={cn(CARD, 'p-10 text-center text-[13px] text-[var(--fg-secondary)]')}>Select an agent on the left.</div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function EmptyState({ isAdmin, memberCount }: { isAdmin: boolean; memberCount: number }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
      <Bot size={26} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
      <p className="text-[14px] font-semibold text-[var(--fg)]">No agent configs synced yet</p>
      <p className="mx-auto mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
        Each machine uploads a redacted snapshot of its Claude Code, OpenCode, Codex and Gemini settings when you run{' '}
        <code className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[11.5px]">npx tokenfin@latest setup</code>, or at any time with{' '}
        <code className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[11.5px]">npx tokenfin@latest config push</code>.
        {isAdmin && memberCount > 1 && <> Teammates show up here once they do.</>}
      </p>
      <Link href="/dashboard/setup" className="btn-secondary mt-4 inline-flex text-[12.5px]"><Terminal size={13} /> Connect an agent</Link>
    </div>
  )
}

// ── Left: people → devices → agents ─────────────────────────────────────────
function PeopleTree({ people, sel, onSelect, viewerId, isAdmin }: { people: PersonView[]; sel: Sel; onSelect: (s: Sel) => void; viewerId: string; isAdmin: boolean }) {
  if (!people.length) return <p className="px-2 py-6 text-center text-[12px] text-[var(--fg-tertiary)]">No match.</p>
  return (
    <div className="space-y-3">
      {people.map(p => (
        <div key={p.userId ?? 'shared'}>
          {isAdmin && (
            <div className="flex items-center gap-2 px-1.5 pb-1">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[10.5px] font-bold uppercase text-[var(--fg-secondary)]">
                {p.userId ? (p.name || p.email).slice(0, 1) : <User2 size={12} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-[var(--fg)]">{p.name}{p.userId === viewerId && <span className="ml-1 font-normal text-[var(--fg-tertiary)]">(you)</span>}</p>
                <p className="truncate text-[10.5px] text-[var(--fg-tertiary)]">{p.email} · {p.role}</p>
              </div>
            </div>
          )}
          {p.devices.length === 0 ? (
            <p className="ml-9 pb-1 text-[11px] text-[var(--fg-tertiary)]">No machine synced</p>
          ) : p.devices.map(d => (
            <div key={d.ref} className={cn('mb-1.5', isAdmin && 'ml-3 border-l border-[var(--border)] pl-2')}>
              <div className="flex items-center gap-1.5 px-1.5 py-1 text-[12px] text-[var(--fg-secondary)]">
                <Laptop size={13} className="shrink-0" />
                <span className="truncate font-medium text-[var(--fg)]">{d.hostname ?? d.deviceId.slice(0, 8)}</span>
                <span className="ml-auto shrink-0 text-[10.5px] text-[var(--fg-tertiary)]"><TimeAgo value={d.lastSyncedAt} format={relTime} /></span>
              </div>
              {d.agents.length === 0 && <p className="px-7 pb-1 text-[11px] text-[var(--fg-tertiary)]">No supported agent found</p>}
              {d.agents.map(a => {
                const active = sel?.ref === d.ref && sel.agent === a.agent
                const pending = d.changes.filter(c => c.agent === a.agent && c.status === 'pending').length
                return (
                  <button key={a.agent} onClick={() => onSelect({ ref: d.ref, agent: a.agent })}
                    className={cn('flex w-full items-center gap-2 rounded-lg py-1.5 pl-7 pr-2 text-left text-[12.5px] transition-colors',
                      active ? 'bg-[var(--bg-active)] text-[var(--fg)]' : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]')}>
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[health(a)])} aria-hidden />
                    <span className={cn('shrink-0', active && 'font-semibold')}>{AGENT_META[a.agent].label}</span>
                    {pending > 0 && <span className="rounded bg-[var(--amber-bg)] px-1 text-[10px] font-semibold text-[var(--amber)]">{pending} pending</span>}
                    {a.needsRestartSince && <span title="Restart to apply"><RotateCw size={11} className="shrink-0 text-[var(--amber)]" /></span>}
                    <span className="ml-auto min-w-0 truncate text-[10.5px] text-[var(--fg-tertiary)]" title={a.summary.model ?? ''}>{a.summary.model ?? ''}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Right: one agent ─────────────────────────────────────────────────────────
function AgentDetail({ orgId, appUrl, person, device, agent, onChanged }: {
  orgId: string; appUrl: string; person: PersonView; device: DeviceView; agent: AgentView; onChanged: () => void
}) {
  const [tab, setTab] = useState<Tab>('overview')
  const [edit, setEdit] = useState(false)
  const [repair, setRepair] = useState(false)
  const meta = AGENT_META[agent.agent]
  const changes = device.changes.filter(c => c.agent === agent.agent)
  const pending = changes.filter(c => c.status === 'pending').length
  const s = agent.summary
  const tabs: [Tab, string, typeof Braces][] = [
    ['overview', 'Overview', Braces],
    ...(s.permissions ? [['permissions', 'Permissions', ShieldHalf] as [Tab, string, typeof Braces]] : []),
    ...(agent.agent === 'claude_code' ? [['hooks', `Hooks${s.hookList.length ? ` (${s.hookList.length})` : ''}`, Webhook] as [Tab, string, typeof Braces]] : []),
    ['history', 'History', HistoryIcon],
    ['changes', `Changes${changes.length ? ` (${changes.length})` : ''}`, ListChecks],
  ]

  return (
    <div className="space-y-4">
      <div className={cn(CARD, 'p-5')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[280px]">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-semibold text-[var(--fg)]">{meta.label}</h2>
              {agent.version && <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fg-secondary)]">{agent.version}</span>}
              <FlowPill agent={agent} />
              {agent.needsRestartSince && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--amber-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--amber)]" title={`Config changed ${fmtWhen(agent.needsRestartSince)} while ${meta.label} was running`}>
                  <RotateCw size={11} /> Restart {meta.label} to apply
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] text-[var(--fg-secondary)]">
              <Laptop size={12} className="mr-1 inline -translate-y-px" />{device.hostname ?? device.deviceId}
              {device.os && <> · {device.os}</>}
              {person.userId && <> · {person.email}</>}
              {!person.userId && <> · shared org key</>}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--fg-tertiary)]" title={agent.path ?? meta.file}>{agent.path ?? meta.file}</p>
            <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
              Synced <TimeAgo value={agent.syncedAt} format={relTime} />
              {agent.mtime && <> · file modified <TimeAgo value={agent.mtime} format={relTime} /></>}
              {device.cliVersion && <> · tokenfin CLI {device.cliVersion}</>}
            </p>
          </div>
          {device.canEdit && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <button onClick={() => setRepair(true)} className="btn-secondary text-[12.5px]"><Wrench size={13} /> Repair connection</button>
              <button onClick={() => setEdit(true)} className="btn-primary text-[12.5px]"><Pencil size={13} /> Edit settings</button>
            </div>
          )}
        </div>
        {pending > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--amber-bg)] px-3 py-2 text-[12px] text-[var(--amber)]">
            <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />
            <span>{pending} change{pending === 1 ? '' : 's'} waiting for the machine. {person.userId ? 'Its owner' : 'Someone on it'} runs{' '}
              <code className="font-mono">npx tokenfin@latest config pull</code> (setup, status and doctor also offer it).</span>
          </div>
        )}
      </div>

      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-1" role="tablist">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[12px] font-semibold transition-all',
              tab === id ? 'bg-white dark:bg-[#1e1e3a] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]')}>
            <Icon size={12} />{label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <SummaryCard agent={agent} appUrl={appUrl} />
          <Warnings warnings={s.warnings} canEdit={device.canEdit} onRepair={() => setRepair(true)} onEdit={() => setEdit(true)} />
          <ConfigCard agent={agent} />
        </>
      )}
      {tab === 'permissions' && <PermissionsCard orgId={orgId} deviceRef={device.ref} agent={agent} canEdit={device.canEdit} onSaved={() => { setTab('changes'); onChanged() }} />}
      {tab === 'hooks' && <HooksCard orgId={orgId} deviceRef={device.ref} agent={agent} canEdit={device.canEdit} onSaved={() => { setTab('changes'); onChanged() }} />}
      {tab === 'history' && <HistoryCard orgId={orgId} deviceRef={device.ref} agent={agent.agent} />}
      {tab === 'changes' && <ChangesCard orgId={orgId} changes={changes} canEdit={device.canEdit} onChanged={onChanged} />}

      {edit && <EditDialog orgId={orgId} device={device} agent={agent} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); setTab('changes'); onChanged() }} />}
      {repair && <RepairDialog orgId={orgId} device={device} agent={agent} onClose={() => setRepair(false)} onSaved={() => { setRepair(false); setTab('changes'); onChanged() }} />}
    </div>
  )
}

function FlowPill({ agent }: { agent: AgentView }) {
  if (agent.flowing) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--green-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--green)]">
      <Radio size={11} /> Telemetry flowing{agent.tokensToday ? ` · ${fmtTok(agent.tokensToday)} tokens today` : ''}
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--fg-secondary)]">
      <Radio size={11} /> {agent.lastEventAt ? <>Last event <TimeAgo value={agent.lastEventAt} format={relTime} /></> : 'No events from this machine'}
    </span>
  )
}

// ── Summary ─────────────────────────────────────────────────────────────────
function SummaryCard({ agent, appUrl }: { agent: AgentView; appUrl: string }) {
  const s: AgentSummary = agent.summary
  const onOff = (v: boolean | null, on = 'On', off = 'Off') => v === null ? <span className="text-[var(--fg-tertiary)]">—</span>
    : <span className={cn('font-semibold', v ? 'text-[var(--green)]' : 'text-[var(--fg-secondary)]')}>{v ? on : off}</span>
  let appHost = appUrl
  try { appHost = new URL(appUrl).host } catch { /* keep */ }
  const tiles: { label: string; value: React.ReactNode; wide?: boolean }[] = [
    { label: 'Model', value: s.model ? <code className="font-mono text-[12.5px]">{s.model}</code> : <span className="text-[var(--fg-tertiary)]">agent default</span> },
    ...(s.smallModel !== undefined ? [{ label: 'Small model', value: s.smallModel ? <code className="font-mono text-[12.5px]">{s.smallModel}</code> : <span className="text-[var(--fg-tertiary)]">default</span> }] : []),
    {
      label: 'TokenFin telemetry', value: s.telemetry.on ? (
        <span>
          <span className="font-semibold text-[var(--green)]">On</span>
          {s.telemetry.host && <span className={cn('ml-1.5 font-mono text-[11.5px]', s.telemetry.pointsHere === false ? 'text-[var(--red)]' : 'text-[var(--fg-secondary)]')}>→ {s.telemetry.host}</span>}
          {s.telemetry.pointsHere === false && <span className="block text-[11px] text-[var(--red)]">not {appHost}</span>}
        </span>
      ) : <span className="font-semibold text-[var(--red)]">Off</span>,
    },
    { label: 'Prompt capture', value: onOff(s.prompts) },
    ...(agent.agent === 'claude_code' || agent.agent === 'codex_cli' ? [{ label: agent.agent === 'codex_cli' ? 'Approval policy' : 'Permission mode', value: s.permissionMode ? <code className="font-mono text-[12.5px]">{s.permissionMode}</code> : <span className="text-[var(--fg-tertiary)]">default</span> }] : []),
    ...(agent.agent === 'claude_code' ? [
      { label: 'Hooks', value: <span className="font-semibold">{s.hooks}</span> },
      { label: 'Status line', value: s.statusLine === 'tokenfin' ? <span className="font-semibold text-[var(--green)]">TokenFin</span> : s.statusLine === 'custom' ? 'Custom' : <span className="text-[var(--fg-tertiary)]">None</span> },
    ] : []),
    { label: `Plugins (${s.plugins.length})`, wide: true, value: s.plugins.length ? <Chips items={s.plugins} /> : <span className="text-[var(--fg-tertiary)]">None</span> },
    { label: `MCP servers (${s.mcp.length})`, wide: true, value: s.mcp.length ? <Chips items={s.mcp.map(m => `${m.name} · ${m.type}`)} /> : <span className="text-[var(--fg-tertiary)]">None</span> },
  ]
  return (
    <div className={cn(CARD, 'p-5')}>
      <h3 className="mb-3 text-[13px] font-semibold text-[var(--fg)]">Summary</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(t => (
          <div key={t.label} className={cn('min-w-0', t.wide && 'sm:col-span-2')}>
            <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{t.label}</dt>
            <dd className="mt-0.5 break-words text-[13px] text-[var(--fg)]">{t.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
function Chips({ items }: { items: string[] }) {
  return <div className="flex flex-wrap gap-1">{items.map(i => <span key={i} className="rounded-md bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fg-secondary)]">{i}</span>)}</div>
}

function Warnings({ warnings, canEdit, onRepair, onEdit }: { warnings: Warning[]; canEdit: boolean; onRepair: () => void; onEdit: () => void }) {
  if (!warnings.length) return (
    <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--green-bg)] px-4 py-3 text-[12.5px] text-[var(--green)]">
      <Check size={14} /> Configuration looks right — nothing to fix.
    </div>
  )
  const style = {
    error: { Icon: AlertOctagon, cls: 'bg-[var(--red-bg)] text-[var(--red)]' },
    warn:  { Icon: AlertTriangle, cls: 'bg-[var(--amber-bg)] text-[var(--amber)]' },
    info:  { Icon: Info, cls: 'bg-[var(--blue-bg)] text-[var(--blue)]' },
  }
  return (
    <div className="space-y-2">
      {warnings.map((w, i) => {
        const { Icon, cls } = style[w.severity]
        return (
          <div key={i} className={cn('flex items-start gap-2.5 rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-[12.5px]', cls)}>
            <Icon size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1 leading-relaxed">{w.text}</span>
            {canEdit && w.fix === 'repair' && <button onClick={onRepair} className="shrink-0 rounded-md border border-current px-2 py-0.5 text-[11px] font-semibold">Repair</button>}
            {canEdit && w.fix === 'edit' && <button onClick={onEdit} className="shrink-0 rounded-md border border-current px-2 py-0.5 text-[11px] font-semibold">Edit</button>}
          </div>
        )
      })}
    </div>
  )
}

// ── Config tree / raw ───────────────────────────────────────────────────────
function ConfigCard({ agent }: { agent: AgentView }) {
  const [mode, setMode] = useState<'tree' | 'raw'>('tree')
  const [depth, setDepth] = useState(2)
  const [gen, setGen] = useState(0)
  const { done, copy } = useCopy()
  const raw = JSON.stringify(agent.config, null, 2)
  return (
    <div className={cn(CARD, 'p-5')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--fg)]">Full configuration</h3>
          <p className="text-[11px] text-[var(--fg-tertiary)]">{AGENT_META[agent.agent].format === 'toml' ? 'config.toml shown as JSON · ' : ''}secrets appear as <RedactedPill /></p>
        </div>
        <div className="flex items-center gap-1.5">
          {mode === 'tree' && <>
            <button onClick={() => { setDepth(99); setGen(g => g + 1) }} className="rounded-md px-2 py-1 text-[11.5px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]">Expand all</button>
            <button onClick={() => { setDepth(1); setGen(g => g + 1) }} className="rounded-md px-2 py-1 text-[11.5px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]">Collapse</button>
          </>}
          <div className="flex rounded-lg border border-[var(--border)] p-0.5">
            <button onClick={() => setMode('tree')} className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px]', mode === 'tree' ? 'bg-[var(--bg-tertiary)] font-semibold text-[var(--fg)]' : 'text-[var(--fg-tertiary)]')}><Braces size={11} /> Tree</button>
            <button onClick={() => setMode('raw')} className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px]', mode === 'raw' ? 'bg-[var(--bg-tertiary)] font-semibold text-[var(--fg)]' : 'text-[var(--fg-tertiary)]')}><FileCode2 size={11} /> Raw</button>
          </div>
          <button onClick={() => copy(raw)} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11.5px] text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)]">
            {done ? <Check size={12} className="text-teal" /> : <Copy size={12} />}{done ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="max-h-[560px] overflow-auto rounded-xl bg-[var(--bg-secondary)] p-3 font-mono text-[12px] leading-[1.55]">
        {mode === 'tree' ? <JsonNode key={gen} value={agent.config} depth={0} openDepth={depth} /> : <pre className="whitespace-pre-wrap break-all"><JsonHighlight text={raw} /></pre>}
      </div>
    </div>
  )
}

const RedactedPill = () => <span className="rounded bg-[var(--bg-tertiary)] px-1 py-px font-mono text-[10.5px] text-[var(--fg-tertiary)]">[redacted]</span>

function Scalar({ v }: { v: unknown }) {
  if (v === null) return <span className="text-[var(--fg-tertiary)]">null</span>
  if (typeof v === 'boolean') return <span className="text-[var(--amber)]">{String(v)}</span>
  if (typeof v === 'number') return <span className="text-[var(--blue)]">{v}</span>
  const s = String(v)
  if (s === '[redacted]') return <RedactedPill />
  return <span className="break-all text-[var(--green)]">&quot;{s}&quot;</span>
}

function JsonNode({ name, value, depth, openDepth, last = true }: { name?: string; value: unknown; depth: number; openDepth: number; last?: boolean }) {
  const isArr = Array.isArray(value)
  const isObj = !!value && typeof value === 'object'
  const [open, setOpen] = useState(depth < openDepth)
  const label = name !== undefined && <><span className="text-[var(--fg)]">{/^\d+$/.test(name) ? '' : `"${name}"`}</span>{/^\d+$/.test(name) ? '' : <span className="text-[var(--fg-tertiary)]">: </span>}</>
  if (!isObj) return <div style={{ paddingLeft: depth ? 14 : 0 }}>{label}<Scalar v={value} />{!last && ','}</div>
  const entries = isArr ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>)
  const [o, c] = isArr ? ['[', ']'] : ['{', '}']
  if (!entries.length) return <div style={{ paddingLeft: depth ? 14 : 0 }}>{label}<span className="text-[var(--fg-tertiary)]">{o}{c}</span>{!last && ','}</div>
  return (
    <div style={{ paddingLeft: depth ? 14 : 0 }}>
      <button onClick={() => setOpen(x => !x)} className="-ml-3.5 inline-flex items-center text-left hover:opacity-80" aria-expanded={open}>
        {open ? <ChevronDown size={11} className="mr-0.5 text-[var(--fg-tertiary)]" /> : <ChevronRight size={11} className="mr-0.5 text-[var(--fg-tertiary)]" />}
        {label}<span className="text-[var(--fg-tertiary)]">{o}</span>
        {!open && <span className="mx-1 rounded bg-[var(--bg-tertiary)] px-1 text-[10.5px] text-[var(--fg-tertiary)]">{entries.length} {isArr ? 'items' : 'keys'}</span>}
        {!open && <span className="text-[var(--fg-tertiary)]">{c}{!last && ','}</span>}
      </button>
      {open && <>
        {entries.map(([k, v], i) => <JsonNode key={k} name={k} value={v} depth={depth + 1} openDepth={openDepth} last={i === entries.length - 1} />)}
        <div className="text-[var(--fg-tertiary)]">{c}{!last && ','}</div>
      </>}
    </div>
  )
}

function JsonHighlight({ text }: { text: string }) {
  const parts = text.split(/("(?:[^"\\]|\\.)*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g)
  return <>{parts.map((p, i) => {
    if (i % 2 === 0) return <span key={i} className="text-[var(--fg-tertiary)]">{p}</span>
    if (/:$/.test(p)) return <span key={i} className="text-[var(--fg)]">{p}</span>
    if (p === '"[redacted]"') return <span key={i} className="text-[var(--fg-tertiary)] italic">{p}</span>
    if (p.startsWith('"')) return <span key={i} className="text-[var(--green)]">{p}</span>
    if (p === 'true' || p === 'false') return <span key={i} className="text-[var(--amber)]">{p}</span>
    if (p === 'null') return <span key={i} className="text-[var(--fg-tertiary)]">{p}</span>
    return <span key={i} className="text-[var(--blue)]">{p}</span>
  })}</>
}

// ── History ─────────────────────────────────────────────────────────────────
function HistoryCard({ orgId, deviceRef, agent }: { orgId: string; deviceRef: string; agent: AgentId }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/v1/agent-configs/history?org_id=${orgId}&device_ref=${deviceRef}&agent=${agent}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: { history: HistoryRow[] }) => { if (alive) setRows(j.history) })
      .catch((e: Error) => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [orgId, deviceRef, agent])

  if (err) return <div className={cn(CARD, 'p-6 text-[12.5px] text-[var(--red)]')}>Could not load history ({err}).</div>
  if (!rows) return <div className={cn(CARD, 'flex items-center gap-2 p-6 text-[12.5px] text-[var(--fg-secondary)]')}><Loader2 size={14} className="animate-spin" /> Loading history…</div>
  return (
    <div className={cn(CARD, 'p-5')}>
      <h3 className="text-[13px] font-semibold text-[var(--fg)]">History</h3>
      <p className="mb-4 text-[11px] text-[var(--fg-tertiary)]">The last {rows.length} distinct snapshot{rows.length === 1 ? '' : 's'} (a new one is stored only when the file changes).</p>
      <ol className="relative space-y-4 border-l border-[var(--border)] pl-5">
        {rows.map((r, i) => {
          const prev = rows[i + 1]
          // hooks_index is derived from settings.hooks — diffing it again is noise.
          const strip = (c: unknown) => { const { hooks_index: _h, ...rest } = (c ?? {}) as Record<string, unknown>; void _h; return rest }
          const diff = prev ? diffConfigs(strip(prev.config), strip(r.config)) : []
          return (
            <li key={r.id} className="relative">
              <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg)] bg-[var(--accent)]" />
              <p className="text-[12.5px] font-semibold text-[var(--fg)]">{fmtWhen(r.captured_at)}
                <span className="ml-2 font-mono text-[10.5px] font-normal text-[var(--fg-tertiary)]">{r.sha256?.slice(0, 10) ?? '—'}{r.version ? ` · ${r.version}` : ''}</span>
              </p>
              {!prev ? <p className="text-[11.5px] text-[var(--fg-tertiary)]">First snapshot</p>
                : diff.length === 0 ? <p className="text-[11.5px] text-[var(--fg-tertiary)]">No visible change (only redacted values differ)</p>
                : <DiffList diff={diff} />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const short = (v: unknown) => { const s = JSON.stringify(v); return s === undefined ? '—' : s.length > 120 ? s.slice(0, 117) + '…' : s }
function DiffList({ diff }: { diff: DiffEntry[] }) {
  return (
    <div className="mt-1.5 space-y-0.5 rounded-lg bg-[var(--bg-secondary)] p-2 font-mono text-[11.5px]">
      {diff.slice(0, 60).map(d => (
        <div key={d.path + d.kind} className="break-all">
          {d.kind === 'added' && <span className="text-[var(--green)]">+ {d.path} = {short(d.after)}</span>}
          {d.kind === 'removed' && <span className="text-[var(--red)]">− {d.path} (was {short(d.before)})</span>}
          {d.kind === 'changed' && <span className="text-[var(--amber)]">~ {d.path}: {short(d.before)} → {short(d.after)}</span>}
        </div>
      ))}
      {diff.length > 60 && <div className="text-[var(--fg-tertiary)]">… {diff.length - 60} more</div>}
    </div>
  )
}

// ── Changes ─────────────────────────────────────────────────────────────────
const STATUS = {
  pending:   'bg-[var(--amber-bg)] text-[var(--amber)]',
  applied:   'bg-[var(--green-bg)] text-[var(--green)]',
  failed:    'bg-[var(--red-bg)] text-[var(--red)]',
  cancelled: 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]',
} as const

function describePatch(patch: Record<string, unknown>): string[] {
  const out: string[] = []
  const walk = (o: Record<string, unknown>, pre: string) => {
    for (const [k, v] of Object.entries(o)) {
      const p = pre ? `${pre}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v) && p !== 'permission.bash') walk(v as Record<string, unknown>, p)
      else if (p === '$tokenfin.repair') out.push('Repair TokenFin connection')
      else if (p === '$tokenfin.statusline') out.push(`TokenFin status line → ${v ? 'on' : 'off'}`)
      else if (p === '$tokenfin.plugin') out.push(`TokenFin plugin → ${v ? 'installed' : 'removed'}`)
      else if (p === '$tokenfin.hooks' && Array.isArray(v)) for (const o of v as { op: string; id?: string; template?: string }[]) out.push(o.op === 'add_template' ? `hooks: add template ${o.template}` : `hooks: ${o.op} ${o.id}`)
      else if (Array.isArray(v)) out.push(`${p} → [${v.length} item${v.length === 1 ? '' : 's'}]${v.length ? ': ' + v.slice(0, 4).join(', ') + (v.length > 4 ? ', …' : '') : ''}`)
      else out.push(`${p} → ${v === null ? '(unset)' : JSON.stringify(v)}`)
    }
  }
  walk(patch, '')
  return out
}

function ChangesCard({ orgId, changes, canEdit, onChanged }: { orgId: string; changes: ChangeRow[]; canEdit: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const cancel = async (id: string) => {
    setBusy(id)
    try { await fetch('/api/v1/agent-configs/changes', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ org_id: orgId, id, status: 'cancelled' }) }) }
    finally { setBusy(null); onChanged() }
  }
  if (!changes.length) return (
    <div className={cn(CARD, 'p-8 text-center text-[12.5px] text-[var(--fg-secondary)]')}>
      No change requests yet.{canEdit && ' Use “Edit settings” or “Repair connection” — the machine applies them with `tokenfin config pull`.'}
    </div>
  )
  return (
    <div className={cn(CARD, 'divide-y divide-[var(--border)]')}>
      {changes.map(c => (
        <div key={c.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
          <span className={cn('mt-0.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide', STATUS[c.status])}>{c.status}</span>
          <div className="min-w-0 flex-1">
            <ul className="space-y-0.5 font-mono text-[12px] text-[var(--fg)]">{describePatch(c.patch).map(l => <li key={l}>{l}</li>)}</ul>
            <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
              Requested by {c.requested_by_email ?? 'someone'} · {fmtWhen(c.created_at)}
              {c.applied_at && <> · applied {fmtWhen(c.applied_at)}</>}
              {c.status === 'failed' && <> · failed {fmtWhen(c.updated_at)}</>}
            </p>
            {c.reason && <p className="mt-0.5 text-[11.5px] italic text-[var(--fg-secondary)]">“{c.reason}”</p>}
            {c.error && <p className="mt-1 rounded-md bg-[var(--red-bg)] px-2 py-1 font-mono text-[11px] text-[var(--red)]">{c.error}</p>}
          </div>
          {c.status === 'pending' && canEdit && (
            <button onClick={() => cancel(c.id)} disabled={busy === c.id} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11.5px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]">
              {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Edit / Repair ───────────────────────────────────────────────────────────
function EditDialog({ orgId, device, agent, onClose, onSaved }: { orgId: string; device: DeviceView; agent: AgentView; onClose: () => void; onSaved: () => void }) {
  const fields = ALLOW[agent.agent].filter(f => f.kind !== 'flag' && !f.advanced)
  const cur = agent.summary.current
  const [vals, setVals] = useState<Record<string, unknown>>(() => ({ ...cur }))
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const changed = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const f of fields) {
      const a = cur[f.path] ?? null, b = vals[f.path] ?? null
      if (JSON.stringify(a) !== JSON.stringify(b)) out[f.path] = f.kind === 'model' && typeof b === 'string' && !b.trim() ? null : b
    }
    return out
  }, [fields, cur, vals])
  const patch = useMemo(() => patchFrom(changed), [changed])
  const check = Object.keys(changed).length ? validatePatch(agent.agent, patch) : null

  const save = useCallback(async () => {
    setSaving(true); setErr(null)
    const e = await submitChange(orgId, device.ref, agent.agent, patch, reason)
    setSaving(false)
    if (e) setErr(e); else onSaved()
  }, [orgId, device, agent.agent, patch, reason, onSaved])

  return (
    <Dialog open onClose={onClose} title={`Edit ${AGENT_META[agent.agent].label} settings`}
      description={`${device.hostname ?? device.deviceId} · only these fields can be changed remotely`}
      footer={<>
        <span className="text-[11px] text-[var(--fg-tertiary)]">Applied on the machine with <code className="font-mono">tokenfin config pull</code></span>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary text-[12.5px]">Cancel</button>
          <button onClick={save} disabled={saving || !check || !check.ok} className="btn-primary text-[12.5px] disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} Request change
          </button>
        </div>
      </>}>
      <div className="space-y-4 px-6 py-5">
        {fields.map(f => <FieldInput key={f.path} spec={f} value={vals[f.path]} current={cur[f.path]} onChange={v => setVals(x => ({ ...x, [f.path]: v }))} />)}
        <label className="block">
          <span className="text-[12px] font-semibold text-[var(--fg)]">Reason <span className="font-normal text-[var(--fg-tertiary)]">(shown to the machine&apos;s owner)</span></span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={2} className="input mt-1 w-full text-[12.5px]" placeholder="e.g. Standardise on Sonnet for day-to-day work" />
        </label>
        {Object.keys(changed).length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">Merge patch</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-[var(--bg-secondary)] p-2.5 font-mono text-[11.5px]"><JsonHighlight text={JSON.stringify(patch, null, 2)} /></pre>
          </div>
        )}
        {check && !check.ok && <p className="text-[12px] text-[var(--red)]">{check.errors.join(' · ')}</p>}
        {err && <p className="rounded-md bg-[var(--red-bg)] px-2.5 py-1.5 text-[12px] text-[var(--red)]">{err}</p>}
      </div>
    </Dialog>
  )
}

function FieldInput({ spec, value, current, onChange }: { spec: FieldSpec; value: unknown; current: unknown; onChange: (v: unknown) => void }) {
  const id = `f-${spec.path}`
  const dirty = JSON.stringify(value ?? null) !== JSON.stringify(current ?? null)
  const head = (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-[12px] font-semibold text-[var(--fg)]">{spec.label}</label>
      {dirty && <span className="text-[10.5px] font-semibold text-[var(--amber)]">changed</span>}
    </div>
  )
  const help = <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">{spec.help}</p>
  if (spec.kind === 'model') return (
    <div>{head}
      <input id={id} value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)} placeholder="(agent default)" className="input mt-1 w-full font-mono text-[12.5px]" />
      {help}</div>
  )
  if (spec.kind === 'enum') return (
    <div>{head}
      <select id={id} value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value || null)} className="input mt-1 w-full text-[12.5px]">
        <option value="">(not set — agent default)</option>
        {(spec.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>{help}</div>
  )
  const on = spec.kind === 'prompt_env' ? value === '1' : value === true
  const set = (b: boolean) => onChange(spec.kind === 'prompt_env' ? (b ? '1' : null) : b)
  return (
    <div>{head}
      <button id={id} type="button" role="switch" aria-checked={on} onClick={() => set(!on)}
        className={cn('mt-1 inline-flex h-6 w-11 items-center rounded-full transition-colors', on ? 'bg-[var(--teal)]' : 'bg-[var(--border-strong)]')}>
        <span className={cn('h-5 w-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
      {help}</div>
  )
}

function RepairDialog({ orgId, device, agent, onClose, onSaved }: { orgId: string; device: DeviceView; agent: AgentView; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const what: Record<AgentId, string> = {
    claude_code: 'Rewrites the OpenTelemetry env block in ~/.claude/settings.json (endpoint, protocol, exporters, key header) and removes the legacy 0.2 hook. Your other settings are untouched.',
    opencode: 'Installs / updates the TokenFin plugin in ~/.config/opencode/plugin/ and removes opencode-otel-plugin from the plugin list.',
    codex_cli: 'Rewrites the TokenFin-managed [otel] block in ~/.codex/config.toml (otlp-http exporter, endpoint, key header).',
    gemini_cli: 'Rewrites the telemetry block in ~/.gemini/settings.json (local collector, endpoint with key).',
  }
  const save = async () => {
    setSaving(true); setErr(null)
    const e = await submitChange(orgId, device.ref, agent.agent, { $tokenfin: { repair: true } }, reason)
    setSaving(false)
    if (e) setErr(e); else onSaved()
  }
  return (
    <Dialog open onClose={onClose} size="md" title="Repair TokenFin connection" description={`${AGENT_META[agent.agent].label} on ${device.hostname ?? device.deviceId}`}
      footer={<>
        <span />
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary text-[12.5px]">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary text-[12.5px]">{saving && <Loader2 size={13} className="animate-spin" />} Request repair</button>
        </div>
      </>}>
      <div className="space-y-3 px-6 py-5 text-[12.5px] text-[var(--fg-secondary)]">
        <p>{what[agent.agent]}</p>
        <p>The machine uses <span className="font-semibold text-[var(--fg)]">its own stored key</span> — TokenFin never has it. A backup of the file is written first.</p>
        <label className="block">
          <span className="text-[12px] font-semibold text-[var(--fg)]">Reason</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={2} className="input mt-1 w-full text-[12.5px]" placeholder="e.g. Telemetry points at the old endpoint" />
        </label>
        {err && <p className="rounded-md bg-[var(--red-bg)] px-2.5 py-1.5 text-[12px] text-[var(--red)]">{err}</p>}
      </div>
    </Dialog>
  )
}
