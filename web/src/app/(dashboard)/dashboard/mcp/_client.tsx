'use client'

/**
 * Connected Platforms — every connected key/tool as a card: name, recorder-tier
 * badge (Hook/Proxy/Rule/Code), accuracy badge (Exact/Estimated), last-used,
 * 30-day tokens + cost + per-model breakdown, and a live/idle status. All from
 * real usage (usage_events attributed by api_key_id) — no mock data. Prominent
 * "Connect a tool" CTA → /dashboard/setup.
 */

import { useState } from 'react'
import Link from 'next/link'
import {
  Plus, ChevronDown, Activity, Clock, Cable, KeyRound, Boxes, Search, Copy, Check, MessagesSquare, ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PlatformRow, ReadKeyRow } from './_types'
import { TierBadge, AccuracyBadge } from '../setup/_client'
import { TimeAgo } from '@/components/ui/time-ago'

const fmtInt   = (n: number) => n.toLocaleString()
const fmtCost  = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`)
const LIVE_MS  = 15 * 60_000

function relTime(iso: string | null): string {
  if (!iso) return 'never used'
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60_000)      return 'just now'
  if (d < 3_600_000)   return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000)  return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

interface McpClientProps {
  initialPlatforms: PlatformRow[]
  orgId: string
  readKeys: ReadKeyRow[]
  appUrl: string
  orgWide: boolean
}

export function McpClient({ initialPlatforms, readKeys, appUrl, orgWide }: McpClientProps) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const platforms = query
    ? initialPlatforms.filter(p => p.name.toLowerCase().includes(query) || p.projectName.toLowerCase().includes(query))
    : initialPlatforms

  const totals = initialPlatforms.reduce(
    (a, p) => ({ tokens: a.tokens + p.tokens30d, cost: a.cost + p.cost30d, calls: a.calls + p.calls30d, prompts: a.prompts + p.prompts30d }),
    { tokens: 0, cost: 0, calls: 0, prompts: 0 },
  )
  const activeCount = initialPlatforms.filter(p => p.calls30d > 0).length

  return (
    <div className="mx-auto max-w-5xl px-1">
      {/* header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="page-title">Connected Platforms</h2>
          <p className="mt-1 text-[12.5px] text-[var(--fg-secondary)]">
            Every tool sending usage to TokenFin, with how it records and how accurate that is.
          </p>
        </div>
        <Link href="/dashboard/setup" className="btn-primary"><Plus size={15} /> Connect a tool</Link>
      </div>

      <ConnectPanel readKeys={readKeys} appUrl={appUrl} orgWide={orgWide} />

      {initialPlatforms.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* summary */}
          <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <Summary label="Tools" value={String(initialPlatforms.length)} sub={`${activeCount} active`} />
            <Summary label="30-day tokens" value={fmtInt(totals.tokens)} />
            <Summary label="30-day cost" value={fmtCost(totals.cost)} />
            <Summary label="30-day prompts" value={fmtInt(totals.prompts)} />
            <Summary label="30-day calls" value={fmtInt(totals.calls)} />
          </div>

          {/* search */}
          <div className="relative mb-4 max-w-xs">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
            <input
              value={q} onChange={e => setQ(e.target.value)} placeholder="Search platforms…" aria-label="Search platforms"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2 pl-9 pr-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--fg-tertiary)] focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/20" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {platforms.map(p => <PlatformCard key={p.id} p={p} />)}
          </div>
          {platforms.length === 0 && (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-6 text-center text-[12.5px] text-[var(--fg-secondary)]">
              No platforms match “{q}”.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function Summary({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{label}</div>
      <div className="mt-0.5 text-[17px] font-bold tabular-nums text-[var(--fg)]">{value}</div>
      {sub && <div className="text-[10.5px] text-[var(--fg-tertiary)]">{sub}</div>}
    </div>
  )
}

function PlatformCard({ p }: { p: PlatformRow }) {
  const [open, setOpen] = useState(false)
  const live = !!p.lastUsedAt && Date.now() - new Date(p.lastUsedAt).getTime() < LIVE_MS
  const recording = p.calls30d > 0

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      {/* header */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--bg-tertiary)]">
          <Cable size={16} className="text-[var(--fg-secondary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-[var(--fg)]">{p.name}</span>
            {!p.isActive && <span className="badge-gray">revoked</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--fg-tertiary)]">
            <span className="truncate font-mono">{p.keyPrefix}</span>
            <span>·</span>
            <span className="truncate">{p.projectName}</span>
          </div>
        </div>
        <span className={cn(
          'inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
          live ? 'bg-[var(--green-bg)] text-teal' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]',
        )}>
          <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-teal' : 'bg-[var(--fg-tertiary)]')} />
          {live ? 'Live' : 'Idle'}
        </span>
      </div>

      {/* badges */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {p.tier ? <TierBadge tier={p.tier} /> : <span className="badge-gray">Recorder unknown</span>}
        {p.accuracy ? <AccuracyBadge accuracy={p.accuracy} /> : null}
        <span className="badge-gray uppercase">{p.env}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[var(--fg-tertiary)]">
          <Clock size={11} /> <TimeAgo value={p.lastUsedAt} format={relTime} />
        </span>
      </div>

      {/* stats */}
      {recording ? (
        <>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric label="Tokens" value={fmtInt(p.tokens30d)} />
            <Metric label="Cost" value={fmtCost(p.cost30d)} />
            <Metric label="Prompts" value={fmtInt(p.prompts30d)} />
            <Metric label="Calls" value={fmtInt(p.calls30d)} />
          </div>

          {p.models.length > 0 && (
            <div className="mt-2">
              <button onClick={() => setOpen(o => !o)}
                className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-[11.5px] font-medium text-[var(--fg-secondary)] hover:text-[var(--fg)]">
                <Activity size={12} /> {p.models.length} model{p.models.length > 1 ? 's' : ''}
                <ChevronDown size={13} className={cn('ml-auto transition-transform', open && 'rotate-180')} />
              </button>
              {open && (
                <div className="mt-1 space-y-1">
                  {p.models.map(m => (
                    <div key={m.model} className="flex items-center gap-2 rounded-lg bg-[var(--bg)] px-2.5 py-1.5 text-[11.5px]">
                      <span className="truncate font-mono text-[var(--fg)]">{m.model}</span>
                      <span className="ml-auto tabular-nums text-[var(--fg-tertiary)]">{fmtInt(m.tokens30d)} tok</span>
                      <span className="tabular-nums text-[var(--fg-secondary)]">{fmtCost(m.cost30d)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11.5px] text-[var(--fg-secondary)]">
          <KeyRound size={13} className="flex-shrink-0 text-[var(--fg-tertiary)]" />
          Connected, but no usage recorded yet — run a turn in your agent and it appears here.
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{label}</div>
      <div className="mt-0.5 text-[13.5px] font-semibold tabular-nums text-[var(--fg)]">{value}</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-secondary)] p-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-tertiary)]">
        <Boxes size={22} className="text-[var(--fg-secondary)]" />
      </div>
      <h2 className="text-[16px] font-bold text-[var(--fg)]">No tools connected yet</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
        Connect Claude Code, Cursor, Codex, ChatGPT or your own SDK — the wizard bakes in your key,
        installs the recorder, and lights up when your first real event lands.
      </p>
      <Link href="/dashboard/setup" className="btn-primary mt-4"><Plus size={15} /> Connect a tool</Link>
    </div>
  )
}

// ── Query from chat (MCP) ─────────────────────────────────────────────────────

type ClientTab = 'claude-code' | 'plugin' | 'desktop' | 'cursor'
const TABS: { id: ClientTab; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'plugin',      label: 'Claude Code plugin' },
  { id: 'desktop',     label: 'Claude Desktop' },
  { id: 'cursor',      label: 'Cursor / VS Code' },
]

function snippets(url: string): Record<ClientTab, { hint: string; code: string }[]> {
  const mcp = `${url}/api/mcp`
  return {
    'claude-code': [
      { hint: 'Automatic: registers the server with this device’s read key', code: 'npx tokenfin@latest setup' },
      { hint: 'Or by hand (user scope)', code: `claude mcp add-json -s user tokenfin '{"type":"http","url":"${mcp}","headers":{"Authorization":"Bearer <READ_KEY>"}}'` },
    ],
    plugin: [
      { hint: '1. Export your read key (and your TokenFin URL if self-hosted) in the shell that starts Claude Code', code: `export TOKENFIN_READ_KEY="<READ_KEY>"\nexport TOKENFIN_URL="${url}"` },
      { hint: '2. In Claude Code, from a checkout of the TokenFin repo', code: '/plugin marketplace add ./plugins/claude-code\n/plugin install tokenfin@tokenfin' },
      { hint: '3. Restart Claude Code, then try', code: '/tokenfin:spend 7 by model\n/tokenfin:budget\n/tokenfin:top-models' },
    ],
    desktop: [
      { hint: 'claude_desktop_config.json: bridges stdio to the remote server with mcp-remote', code: JSON.stringify({ mcpServers: { tokenfin: { command: 'npx', args: ['-y', 'mcp-remote', mcp, '--header', 'Authorization: Bearer <READ_KEY>'] } } }, null, 2) },
    ],
    cursor: [
      { hint: '~/.cursor/mcp.json (Cursor) or .vscode/mcp.json (VS Code / Cline)', code: JSON.stringify({ mcpServers: { tokenfin: { type: 'http', url: mcp, headers: { Authorization: 'Bearer <READ_KEY>' } } } }, null, 2) },
    ],
  }
}

function ConnectPanel({ readKeys, appUrl, orgWide }: { readKeys: ReadKeyRow[]; appUrl: string; orgWide: boolean }) {
  const [tab, setTab] = useState<ClientTab>('claude-code')
  const sn = snippets(appUrl)[tab]
  return (
    <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--bg-tertiary)]">
          <MessagesSquare size={16} className="text-[var(--fg-secondary)]" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-[var(--fg)]">Ask your dashboard from chat (MCP)</h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--fg-secondary)]">
            A read-only MCP server at <code className="font-mono">{appUrl}/api/mcp</code>. Ask “what did we spend on Opus last week?”
            and the assistant calls <code className="font-mono">get_breakdown</code>, <code className="font-mono">get_mtd_and_forecast</code>,
            {' '}<code className="font-mono">get_sessions</code> and more. It authenticates with a <b>read key</b>. Ingest keys are refused.
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg bg-[var(--bg)] px-3 py-2 text-[11.5px] text-[var(--fg-secondary)]">
        <ShieldCheck size={13} className="mt-0.5 flex-shrink-0 text-teal" />
        <span>
          Results follow the key owner’s role. {orgWide
            ? 'As an owner/admin, your keys see the whole org.'
            : 'Your keys see org totals, but only your own prompts, sessions and member spend.'}
        </span>
      </div>

      {/* read keys */}
      <div className="mt-3">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
          Read keys {orgWide ? 'in this org' : 'you own'}
        </div>
        {readKeys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11.5px] text-[var(--fg-secondary)]">
            No read key yet. Run <code className="font-mono">npx tokenfin@latest login</code>. It stores this device’s read key as
            {' '}<code className="font-mono">read_key</code> in <code className="font-mono">~/.tokenfin/config.json</code>, and setup uses that key for MCP.
          </p>
        ) : (
          <div className="space-y-1">
            {readKeys.slice(0, 5).map(k => (
              <div key={k.id} className="flex items-center gap-2 rounded-lg bg-[var(--bg)] px-2.5 py-1.5 text-[11.5px]">
                <KeyRound size={12} className="flex-shrink-0 text-[var(--fg-tertiary)]" />
                <span className="truncate text-[var(--fg)]">{k.name}</span>
                <span className="truncate font-mono text-[var(--fg-tertiary)]">{k.keyPrefix}</span>
                {k.mine && <span className="badge-gray">yours</span>}
                {!k.readOnly && <span className="badge-gray">legacy read+write</span>}
                <span className="ml-auto flex-shrink-0 text-[var(--fg-tertiary)]"><TimeAgo value={k.lastUsedAt} format={relTime} /></span>
              </div>
            ))}
            {readKeys.length > 5 && <p className="px-1 text-[11px] text-[var(--fg-tertiary)]">+{readKeys.length - 5} more under API Keys</p>}
            <p className="px-1 pt-1 text-[11px] text-[var(--fg-tertiary)]">
              Keys are stored hashed, so the full value is never shown again. Your device’s copy is <code className="font-mono">read_key</code> in
              {' '}<code className="font-mono">~/.tokenfin/config.json</code>. Replace <code className="font-mono">&lt;READ_KEY&gt;</code> below with it.
            </p>
          </div>
        )}
      </div>

      {/* client tabs */}
      <div className="mt-4 flex flex-wrap gap-1" role="tablist" aria-label="MCP client">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cn('rounded-lg px-2.5 py-1 text-[11.5px] font-medium',
              tab === t.id ? 'bg-[var(--bg-tertiary)] text-[var(--fg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-2">
        {sn.map((x, i) => <Snippet key={`${tab}-${i}`} hint={x.hint} code={x.code} />)}
      </div>
    </section>
  )
}

function Snippet({ hint, code }: { hint: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <div>
      <div className="mb-1 text-[11px] text-[var(--fg-tertiary)]">{hint}</div>
      <div className="relative">
        <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 pr-10 font-mono text-[11.5px] leading-relaxed text-[var(--fg)]">{code}</pre>
        <button onClick={copy} aria-label="Copy snippet"
          className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-[var(--fg-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--fg)]">
          {copied ? <Check size={13} className="text-teal" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  )
}
