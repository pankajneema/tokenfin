'use client'
import { useState } from 'react'
import Link from 'next/link'
import {
  Check, X, AlertTriangle, Plus, Settings, Zap, Link2, Clock,
  RefreshCw, Receipt, KeyRound, ArrowRight, Mail,
} from 'lucide-react'
import { cn, readApiError } from '@/lib/utils'
import type { OrgIntegration, ProviderConnection } from './_types'
import { TimeAgo } from '@/components/ui/time-ago'
import { Dialog } from '@/components/ui/dialog'

/* ══════════════════════════════════════════════════════════════
   CATALOG — only Slack, generic webhook and email actually deliver
   (see lib/notify/send.ts). Everything else is shown as "Coming soon"
   and cannot be connected.
══════════════════════════════════════════════════════════════ */
type Category = 'notifications' | 'observability' | 'data' | 'devtools'

interface CatalogItem {
  id:        string
  name:      string
  category:  Category
  desc:      string
  initials:  string
  color:     string
  bg:        string
  dot:       string
  available: boolean
  /** For available items: which field the connect form asks for. */
  field?:    { label: string; placeholder: string; help: string }
}

const CATALOG: CatalogItem[] = [
  {
    id: 'slack', name: 'Slack', category: 'notifications', available: true,
    desc: 'Post alert-rule notifications (spend thresholds, anomalies, budget breaches) to a Slack channel.',
    initials: 'SL', color: 'text-[#4A154B]', bg: 'bg-[#4A154B]/10', dot: '#4A154B',
    field: { label: 'Incoming webhook URL', placeholder: 'https://hooks.slack.com/services/…', help: 'Create one in Slack → Apps → Incoming Webhooks. Stored encrypted; only a masked version is shown again.' },
  },
  {
    id: 'webhook', name: 'Webhook', category: 'notifications', available: true,
    desc: 'POST a JSON payload for every fired alert to your own HTTPS endpoint — route it anywhere.',
    initials: 'WH', color: 'text-[var(--blue)]', bg: 'bg-[var(--blue-bg)]', dot: '#3b82f6',
    field: { label: 'Endpoint URL', placeholder: 'https://example.com/tokenfin-alerts', help: 'Must be public HTTPS. Payload: { rule, org_id, message, test, at }. Stored encrypted.' },
  },
  {
    id: 'email', name: 'Email', category: 'notifications', available: true,
    desc: 'Email fired alerts to the organization’s owners and admins. Enable “Email” on an alert rule to use it.',
    initials: 'EM', color: 'text-teal', bg: 'bg-[var(--green-bg)]', dot: '#14b8a6',
  },
  {
    id: 'teams', name: 'Microsoft Teams', category: 'notifications', available: false,
    desc: 'Post alert cards to Teams channels.',
    initials: 'MT', color: 'text-[#6264A7]', bg: 'bg-[#6264A7]/10', dot: '#6264A7',
  },
  {
    id: 'datadog', name: 'Datadog', category: 'observability', available: false,
    desc: 'Ship LLM cost and token metrics to Datadog as custom metrics.',
    initials: 'DD', color: 'text-[#632CA6]', bg: 'bg-[#632CA6]/10', dot: '#632CA6',
  },
  {
    id: 'grafana', name: 'Grafana', category: 'observability', available: false,
    desc: 'Push token usage timeseries to Grafana Cloud.',
    initials: 'GF', color: 'text-[#F46800]', bg: 'bg-[#F46800]/10', dot: '#F46800',
  },
  {
    id: 'bigquery', name: 'BigQuery', category: 'data', available: false,
    desc: 'Export usage events to BigQuery.',
    initials: 'BQ', color: 'text-[#4285F4]', bg: 'bg-[#4285F4]/10', dot: '#4285F4',
  },
  {
    id: 'snowflake', name: 'Snowflake', category: 'data', available: false,
    desc: 'Load usage events into Snowflake.',
    initials: 'SF', color: 'text-[#29B5E8]', bg: 'bg-[#29B5E8]/10', dot: '#29B5E8',
  },
  {
    id: 'github-actions', name: 'GitHub Actions', category: 'devtools', available: false,
    desc: 'Post CI cost summaries on pull requests.',
    initials: 'GA', color: 'text-[#24292E]', bg: 'bg-[#24292E]/10', dot: '#24292E',
  },
]

const CATEGORY_META: Record<Category, { label: string }> = {
  notifications: { label: 'Notifications'    },
  observability: { label: 'Observability'    },
  data:          { label: 'Data & Analytics' },
  devtools:      { label: 'Dev Tools'        },
}

const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'

/* ══════════════════════════════════════════════════════════════
   CONNECT MODAL (Slack / Webhook / Email only)
══════════════════════════════════════════════════════════════ */
function ConnectModal({ item, orgId, onClose, onConnected }: {
  item:        CatalogItem
  orgId:       string
  onClose:     () => void
  onConnected: (row: OrgIntegration) => void
}) {
  const [url,    setUrl]    = useState('')
  const [label,  setLabel]  = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const canSubmit = !item.field || url.trim().length > 0

  async function handleConnect() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/v1/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: orgId, integration: item.id, detail: label.trim() || null,
          config: item.field ? { webhook_url: url.trim() } : {},
        }),
      })
      if (!res.ok) throw new Error(await readApiError(res))
      const r = await res.json()
      onConnected({
        integration: r.integration, isActive: true, connectedAt: r.connected_at,
        lastSyncedAt: r.last_synced_at, syncOk: r.sync_ok, detail: r.detail, label: r.label, target: r.target,
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral'

  return (
    <Dialog open onClose={onClose} bare ariaLabel={`Connect ${item.name}`} size="md">
        <div className="flex items-center gap-4 px-6 py-5 border-b border-[var(--border)]">
          <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-[14px] flex-shrink-0 border', item.bg, item.color)}
            style={{ borderColor: `${item.dot}25` }}>{item.initials}</div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-[var(--fg)]">Connect {item.name}</h2>
            <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5">{item.desc}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)]">
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label htmlFor="integ-label" className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
              Friendly name <span className="normal-case font-normal text-[var(--fg-tertiary)]">(optional)</span>
            </label>
            <input id="integ-label" value={label} onChange={e => setLabel(e.target.value)} placeholder={`e.g. #finops-alerts`} className={inputCls} />
          </div>

          {item.field ? (
            <div>
              <label htmlFor="integ-url" className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">{item.field.label}</label>
              <input id="integ-url" data-autofocus type="password" autoComplete="off" value={url} onChange={e => setUrl(e.target.value)}
                placeholder={item.field.placeholder} className={cn(inputCls, 'font-mono')} />
              <p className="text-[11px] text-[var(--fg-tertiary)] mt-1.5">{item.field.help}</p>
            </div>
          ) : (
            <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed">
              No setup needed: alert emails go to every owner and admin of this organization. Delivery needs the
              server’s email provider to be configured (<span className="font-mono">RESEND_API_KEY</span>); the card
              will show the real result after the first alert is sent.
            </p>
          )}

          <p className="text-[11.5px] text-[var(--fg-tertiary)]">
            Status shows the result of the last real delivery. Use <strong>Test fire</strong> on an alert rule to check it now.
          </p>

          {error && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--red)] bg-[var(--red-bg)] px-3 py-2 rounded-xl border border-[var(--red)]/20">
              <AlertTriangle size={12} className="flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleConnect} disabled={!canSubmit || saving} className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
            {saving
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Saving…</>
              : <><Link2 size={13} /> {item.field ? 'Connect' : 'Enable'}</>}
          </button>
        </div>
    </Dialog>
  )
}

/* ══════════════════════════════════════════════════════════════
   INTEGRATION CARD
══════════════════════════════════════════════════════════════ */
function StatusBadge({ item, conn, emailReady }: { item: CatalogItem; conn: OrgIntegration | null; emailReady: boolean }) {
  const base = 'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold flex-shrink-0'
  if (!item.available) return <span className={cn(base, 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}><Clock size={10} aria-hidden="true" /> Coming soon</span>
  // Email needs no per-org connection — it works iff the server can send mail.
  if (item.id === 'email' && !emailReady) return <span className={cn(base, 'bg-[var(--amber-bg)] text-[var(--amber)]')}><span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]" aria-hidden="true" /> Server not configured</span>
  if (item.id === 'email' && conn?.syncOk !== false && conn?.syncOk !== true) return <span className={cn(base, 'bg-[var(--green-bg)] text-teal')}><span className="w-1.5 h-1.5 rounded-full bg-teal" aria-hidden="true" /> Available</span>
  if (!conn) return <span className={cn(base, 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}><span className="w-1.5 h-1.5 rounded-full bg-[var(--border-strong)]" /> Not connected</span>
  if (conn.syncOk === false) return <span className={cn(base, 'bg-[var(--red-bg)] text-[var(--red)]')}><span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" /> Delivery failed</span>
  if (conn.syncOk === true) return <span className={cn(base, 'bg-[var(--green-bg)] text-teal')}><span className="w-1.5 h-1.5 rounded-full bg-teal" /> Delivering</span>
  return <span className={cn(base, 'bg-[var(--blue-bg)] text-[var(--blue)]')}><span className="w-1.5 h-1.5 rounded-full bg-[var(--blue)]" /> Connected</span>
}

function IntegrationCard({ item, conn, canManage, onConnect, onDisconnect, emailReady }: {
  emailReady:   boolean
  item:         CatalogItem
  conn:         OrgIntegration | null
  canManage:    boolean
  onConnect:    (id: string) => void
  onDisconnect: (id: string) => void
}) {
  return (
    <div className={cn(
      'bg-white dark:bg-[#141428] border rounded-2xl p-5 flex flex-col gap-4 transition-all',
      conn?.syncOk === false ? 'border-[var(--red)]/40' : 'border-[var(--border)]',
      !item.available && 'opacity-75',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-[13px] flex-shrink-0 border', item.bg, item.color)}
            style={{ borderColor: `${item.dot}25` }}>{item.initials}</div>
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold text-[var(--fg)] truncate">{item.name}</p>
            <span className="text-[10px] font-semibold text-[var(--fg-tertiary)]">{CATEGORY_META[item.category].label}</span>
          </div>
        </div>
        <StatusBadge item={item} conn={conn} emailReady={emailReady} />
      </div>

      <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed flex-1">{item.desc}</p>

      {conn && item.available && (
        <div className="text-[11px] px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] space-y-1">
          {(conn.label || conn.target) && (
            <p className="font-mono text-[var(--fg-secondary)] truncate" title={conn.target ?? undefined}>
              {conn.label ? `${conn.label}${conn.target ? ' · ' : ''}` : ''}{conn.target ?? ''}
            </p>
          )}
          <p className={cn(conn.syncOk === false ? 'text-[var(--red)]' : 'text-[var(--fg-tertiary)]')}>
            {conn.detail ?? 'No deliveries yet — fires when an alert rule with this channel triggers.'}
          </p>
        </div>
      )}

      {conn && !item.available && (
        <p className="text-[11px] text-[var(--amber)]">A saved configuration exists but this connector does not deliver anything yet.</p>
      )}

      {item.id === 'email' && !emailReady && (
        <p className="text-[11px] text-[var(--amber)]">This server has no mail provider (RESEND_API_KEY), so email alerts are skipped. In-app, Slack and webhook still deliver.</p>
      )}

      <div className="flex gap-2 pt-1">
        {item.id === 'email' ? (
          <Link href="/dashboard/alerts" className="flex-1 btn-secondary text-[12px] py-2 justify-center">
            Turn on “Email” per rule in Alerts <ArrowRight size={12} aria-hidden="true" />
          </Link>
        ) : !item.available ? (
          conn && canManage
            ? <button onClick={() => onDisconnect(item.id)} className="flex-1 btn-secondary text-[12px] py-2">Remove saved config</button>
            : <span className="flex-1 text-center text-[12px] py-2 rounded-xl border border-dashed border-[var(--border)] text-[var(--fg-tertiary)]">Not available yet</span>
        ) : !canManage ? (
          <span className="flex-1 text-center text-[12px] py-2 text-[var(--fg-tertiary)]">Owners and admins can manage integrations</span>
        ) : conn ? (
          <>
            <button onClick={() => onConnect(item.id)} className="flex-1 btn-secondary text-[12px] py-2"><Settings size={12} /> Reconfigure</button>
            <button onClick={() => onDisconnect(item.id)}
              className="px-3 py-2 rounded-xl border border-[var(--border)] text-[12px] font-semibold text-[var(--fg-tertiary)] hover:border-[var(--red)]/50 hover:text-[var(--red)] hover:bg-[var(--red-bg)] transition-all">
              Disconnect
            </button>
          </>
        ) : (
          <button onClick={() => onConnect(item.id)} className="flex-1 btn-primary text-[12px] py-2">
            <Plus size={12} /> {item.field ? 'Connect' : 'Enable'}
          </button>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   PROVIDER BILLING (Anthropic / OpenAI admin keys → reconciliation)
══════════════════════════════════════════════════════════════ */
const PROVIDERS = [
  {
    id: 'anthropic' as const, name: 'Anthropic', initials: 'AN', prefix: 'sk-ant-admin…',
    where: 'Claude Console → Settings → Admin keys (organization admins only).',
    href: 'https://platform.claude.com/settings/admin-keys',
  },
  {
    id: 'openai' as const, name: 'OpenAI', initials: 'OA', prefix: 'sk-admin-…',
    where: 'OpenAI Platform → Settings → Organization → Admin keys (read-only is enough).',
    href: 'https://platform.openai.com/settings/organization/admin-keys',
  },
]

function ProviderBilling({ orgId, initial, canConnect, canSync }: {
  orgId: string; initial: ProviderConnection[]; canConnect: boolean; canSync: boolean
}) {
  const [conns,   setConns]   = useState<ProviderConnection[]>(initial)
  const [open,    setOpen]    = useState<'anthropic' | 'openai' | null>(null)
  const [key,     setKey]     = useState('')
  const [busy,    setBusy]    = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [note,    setNote]    = useState<string | null>(null)

  const byProvider = new Map(conns.map(c => [c.provider, c]))

  async function connect(provider: 'anthropic' | 'openai') {
    setBusy(provider); setError(null); setNote(null)
    try {
      const res = await fetch('/api/v1/provider-connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, provider, admin_key: key.trim() }),
      })
      if (!res.ok) throw new Error(await readApiError(res))
      const r = await res.json()
      setConns(prev => [...prev.filter(c => c.provider !== provider), r.connection])
      setNote(r.sync?.ok ? `Connected — imported ${r.sync.rows} cost rows.` : `Connected, but the first sync failed: ${r.sync?.error ?? 'unknown error'}`)
      setOpen(null); setKey('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect')
    } finally { setBusy(null) }
  }

  async function syncNow() {
    setBusy('sync'); setError(null); setNote(null)
    try {
      const res = await fetch('/api/v1/provider-connections?action=sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId }),
      })
      if (!res.ok) throw new Error(await readApiError(res))
      const r = await res.json()
      setConns(r.connections)
      const failed = (r.results as { ok: boolean }[]).filter(x => !x.ok).length
      setNote(failed ? `${failed} provider${failed > 1 ? 's' : ''} failed to sync — see the error below.` : 'Sync complete.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally { setBusy(null) }
  }

  async function disconnect(provider: string) {
    if (!confirm(`Disconnect ${provider}? The stored admin key is deleted; already-imported cost history is kept.`)) return
    setBusy(provider); setError(null); setNote(null)
    try {
      const res = await fetch(`/api/v1/provider-connections?org_id=${orgId}&provider=${provider}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await readApiError(res))
      setConns(prev => prev.filter(c => c.provider !== provider))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect')
    } finally { setBusy(null) }
  }

  return (
    <section className="space-y-3" aria-labelledby="provider-billing">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 id="provider-billing" className="text-[15px] font-bold text-[var(--fg)] flex items-center gap-2"><Receipt size={15} /> Provider billing</h2>
          <p className="text-[12.5px] text-[var(--fg-secondary)] mt-0.5 max-w-[720px]">
            Connect a read-only <strong>admin key</strong> so TokenFin can pull what Anthropic / OpenAI actually billed and compare it with
            the spend TokenFin measured. Keys are encrypted at rest, used only to read cost reports, and never shown again.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {conns.length > 0 && canSync && (
            <button onClick={syncNow} disabled={!!busy} className="btn-secondary text-[12px] disabled:opacity-50">
              <RefreshCw size={12} className={cn(busy === 'sync' && 'animate-spin')} /> Sync now
            </button>
          )}
          <Link href="/dashboard/analytics/reconciliation" className="btn-primary text-[12px]">
            Reconciliation <ArrowRight size={12} />
          </Link>
        </div>
      </div>

      {note  && <p className="text-[12px] text-[var(--fg-secondary)] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl px-3 py-2">{note}</p>}
      {error && <p className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 rounded-xl px-3 py-2 flex items-center gap-2"><AlertTriangle size={12} /> {error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROVIDERS.map(p => {
          const c = byProvider.get(p.id)
          return (
            <div key={p.id} className={cn('bg-white dark:bg-[#141428] border rounded-2xl p-5 space-y-3',
              c?.status === 'error' ? 'border-[var(--red)]/40' : 'border-[var(--border)]')}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-[12px] bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--fg)]">{p.initials}</div>
                  <div>
                    <p className="text-[13.5px] font-bold text-[var(--fg)]">{p.name}</p>
                    <p className="text-[11px] text-[var(--fg-tertiary)] font-mono">{c ? c.key_hint : `Admin key ${p.prefix}`}</p>
                  </div>
                </div>
                {c ? (
                  <span className={cn('px-2 py-0.5 rounded-full text-[10.5px] font-semibold',
                    c.status === 'ok' ? 'bg-[var(--green-bg)] text-teal' : c.status === 'error' ? 'bg-[var(--red-bg)] text-[var(--red)]' : 'bg-[var(--blue-bg)] text-[var(--blue)]')}>
                    {c.status === 'ok' ? 'Synced' : c.status === 'error' ? 'Sync error' : 'Pending'}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]">Not connected</span>
                )}
              </div>

              {c ? (
                <div className="text-[11.5px] space-y-1">
                  <p className="text-[var(--fg-secondary)]">Last sync: <TimeAgo value={c.last_synced_at} format={fmtTime} /></p>
                  {c.last_error && <p className="text-[var(--red)] break-words">{c.last_error}</p>}
                </div>
              ) : (
                <p className="text-[11.5px] text-[var(--fg-secondary)]">
                  Where to create it: {p.where}{' '}
                  <a href={p.href} target="_blank" rel="noreferrer" className="text-coral hover:underline">Open settings</a>
                </p>
              )}

              {open === p.id ? (
                <div className="space-y-2">
                  <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)}
                    placeholder={`Paste ${p.prefix}`} aria-label={`${p.name} admin key`}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] font-mono bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:ring-2 focus:ring-coral/30" />
                  <div className="flex gap-2">
                    <button onClick={() => connect(p.id)} disabled={key.trim().length < 20 || !!busy} className="btn-primary text-[12px] disabled:opacity-40">
                      {busy === p.id ? 'Verifying…' : <><KeyRound size={12} /> Verify & connect</>}
                    </button>
                    <button onClick={() => { setOpen(null); setKey('') }} className="btn-secondary text-[12px]">Cancel</button>
                  </div>
                  <p className="text-[10.5px] text-[var(--fg-tertiary)]">We make one small read request to verify the key before saving it.</p>
                </div>
              ) : canConnect ? (
                <div className="flex gap-2">
                  <button onClick={() => { setOpen(p.id); setKey(''); setError(null) }} disabled={!!busy} className={cn('text-[12px]', c ? 'btn-secondary' : 'btn-primary')}>
                    {c ? <><Settings size={12} /> Replace key</> : <><Plus size={12} /> Connect</>}
                  </button>
                  {c && (
                    <button onClick={() => disconnect(p.id)} disabled={!!busy}
                      className="px-3 py-2 rounded-xl border border-[var(--border)] text-[12px] font-semibold text-[var(--fg-tertiary)] hover:text-[var(--red)] hover:border-[var(--red)]/50">
                      Disconnect
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-[var(--fg-tertiary)]">Only the organization owner can connect billing keys.</p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN CLIENT
══════════════════════════════════════════════════════════════ */
interface Props {
  emailReady:        boolean
  initialConnected:  OrgIntegration[]
  initialProviders:  ProviderConnection[]
  orgId:             string
  canManage:         boolean
  canConnectBilling: boolean
}

export function IntegrationsClient({ initialConnected, initialProviders, orgId, canManage, canConnectBilling, emailReady }: Props) {
  const [connected, setConnected] = useState<OrgIntegration[]>(initialConnected)
  const [modalId,   setModalId]   = useState<string | null>(null)
  const [toast,     setToast]     = useState('')
  const [catFilter, setCatFilter] = useState<Category | 'all'>('all')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  function handleConnected(row: OrgIntegration) {
    setConnected(prev => [...prev.filter(c => c.integration !== row.integration), row])
    setModalId(null)
    showToast(`${CATALOG.find(c => c.id === row.integration)?.name} saved`)
  }

  async function handleDisconnect(id: string) {
    const res = await fetch(`/api/v1/integrations?org_id=${orgId}&integration=${id}`, { method: 'DELETE' })
    if (!res.ok) { showToast(await readApiError(res)); return }
    setConnected(prev => prev.filter(c => c.integration !== id))
    showToast(`${CATALOG.find(c => c.id === id)?.name} removed`)
  }

  const connMap       = new Map(connected.map(c => [c.integration, c]))
  const available     = CATALOG.filter(i => i.available)
  // "Connected" = would actually deliver: a saved URL for Slack/webhook, a mail provider for email.
  const liveCount     = available.filter(i => i.id === 'email' ? emailReady : !!connMap.get(i.id)?.target).length
  const failCount     = available.filter(i => connMap.get(i.id)?.syncOk === false).length
  const filtered      = CATALOG.filter(item => catFilter === 'all' || item.category === catFilter)
  const modalItem     = modalId ? CATALOG.find(c => c.id === modalId && c.available) ?? null : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Integrations</h2>
        <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
          Alert delivery channels and provider billing reconciliation
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Channels delivering', value: liveCount,                           color: 'text-teal',          icon: Check },
          { label: 'Delivery failures',  value: failCount,                           color: 'text-[var(--red)]',  icon: AlertTriangle },
          { label: 'Available now',      value: available.length,                    color: 'text-[var(--blue)]', icon: Zap },
          { label: 'Coming soon',        value: CATALOG.length - available.length,   color: 'text-[var(--fg)]',   icon: Clock },
        ].map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0">
                <Icon size={15} className={s.color} />
              </div>
              <div>
                <p className={cn('text-[18px] font-bold leading-none tabular-nums', s.color)}>{s.value}</p>
                <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{s.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      {failCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--red-bg)] border border-[var(--red)]/30 rounded-xl">
          <AlertTriangle size={14} className="text-[var(--red)] flex-shrink-0" />
          <p className="text-[12.5px] text-[var(--red)] flex-1">
            <span className="font-semibold">{failCount} channel{failCount > 1 ? 's' : ''} failed on the last delivery.</span>
            {' '}Check the URL, then use <Link href="/dashboard/alerts" className="underline">Test fire</Link> on an alert rule.
          </p>
        </div>
      )}

      <ProviderBilling orgId={orgId} initial={initialProviders} canConnect={canConnectBilling} canSync={canManage} />

      <section className="space-y-3" aria-labelledby="alert-channels">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 id="alert-channels" className="text-[15px] font-bold text-[var(--fg)] flex items-center gap-2"><Mail size={15} /> Alert channels & connectors</h2>
            <p className="text-[12.5px] text-[var(--fg-secondary)] mt-0.5">Slack, webhook and email deliver alerts today. The rest are on the roadmap.</p>
          </div>
          <div className="flex items-center gap-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl p-1 flex-wrap">
            {(['all', 'notifications', 'observability', 'data', 'devtools'] as const).map(cat => {
              const active = catFilter === cat
              return (
                <button key={cat} onClick={() => setCatFilter(cat)}
                  className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                    active ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                  {cat === 'all' ? 'All' : CATEGORY_META[cat].label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(item => (
            <IntegrationCard key={item.id} item={item} conn={connMap.get(item.id) ?? null} canManage={canManage}
              onConnect={id => setModalId(id)} onDisconnect={handleDisconnect} emailReady={emailReady} />
          ))}
        </div>
      </section>

      {modalItem && (
        <ConnectModal item={modalItem} orgId={orgId} onClose={() => setModalId(null)} onConnected={handleConnected} />
      )}

      <div className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
        toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none',
      )}>
        <Check size={14} className="text-teal" /> {toast}
      </div>
    </div>
  )
}
