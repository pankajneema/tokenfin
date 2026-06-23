'use client'
import { useState } from 'react'
import {
  Check, X, ExternalLink, RefreshCw, AlertTriangle,
  Plus, Settings, Zap, Link2, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OrgIntegration } from './_types'

/* ══════════════════════════════════════════════════════════════
   CATALOG — 8 top integrations for LLM FinOps
   Selected by: category coverage, adoption rate, FinOps relevance
══════════════════════════════════════════════════════════════ */
type Category = 'notifications' | 'observability' | 'data' | 'devtools' | 'billing'

interface CatalogItem {
  id:        string
  name:      string
  category:  Category
  desc:      string
  initials:  string
  color:     string
  bg:        string
  dot:       string
  features:  string[]
  docsUrl:   string
  needsKey:      boolean
  needsEndpoint: boolean
  isOAuth:       boolean
  keyLabel?:     string
  endpointLabel?: string
  endpointPlaceholder?: string
}

const CATALOG: CatalogItem[] = [
  {
    id: 'slack', name: 'Slack', category: 'notifications',
    desc: 'Send spend alerts, budget breach notifications, and weekly cost digests to any Slack channel or DM.',
    initials: 'SL', color: 'text-[#4A154B]', bg: 'bg-[#4A154B]/10', dot: '#4A154B',
    features: ['Alert routing', 'Weekly digest', 'Limit breach DMs', 'Interactive buttons'],
    docsUrl: '#', needsKey: false, needsEndpoint: true, isOAuth: false,
    endpointLabel: 'Webhook URL', endpointPlaceholder: 'https://hooks.slack.com/services/…',
  },
  {
    id: 'teams', name: 'Microsoft Teams', category: 'notifications',
    desc: 'Post adaptive cards to Teams channels for spend alerts, approval flows, and budget notifications.',
    initials: 'MT', color: 'text-[#6264A7]', bg: 'bg-[#6264A7]/10', dot: '#6264A7',
    features: ['Adaptive cards', 'Channel posts', 'Approval flows', 'Mentions'],
    docsUrl: '#', needsKey: false, needsEndpoint: true, isOAuth: false,
    endpointLabel: 'Webhook URL', endpointPlaceholder: 'https://your-tenant.webhook.office.com/…',
  },
  {
    id: 'datadog', name: 'Datadog', category: 'observability',
    desc: 'Ship LLM cost metrics, token usage, and latency as custom Datadog metrics. Trigger monitors on spend anomalies.',
    initials: 'DD', color: 'text-[#632CA6]', bg: 'bg-[#632CA6]/10', dot: '#632CA6',
    features: ['Custom metrics', 'Monitors & alerts', 'Dashboards', 'Log forwarding'],
    docsUrl: '#', needsKey: true, needsEndpoint: false, isOAuth: false,
    keyLabel: 'Datadog API Key',
  },
  {
    id: 'grafana', name: 'Grafana', category: 'observability',
    desc: 'Push token usage timeseries to Grafana Cloud. Pre-built dashboards for cost-per-model and team spend.',
    initials: 'GF', color: 'text-[#F46800]', bg: 'bg-[#F46800]/10', dot: '#F46800',
    features: ['Timeseries', 'Pre-built dashboards', 'Alerts', 'Cost panels'],
    docsUrl: '#', needsKey: true, needsEndpoint: true, isOAuth: false,
    keyLabel: 'Service Account Token', endpointLabel: 'Grafana URL', endpointPlaceholder: 'https://your-org.grafana.net',
  },
  {
    id: 'bigquery', name: 'BigQuery', category: 'data',
    desc: 'Stream every LLM usage event to BigQuery in real-time. Build BI dashboards with SQL or Looker Studio.',
    initials: 'BQ', color: 'text-[#4285F4]', bg: 'bg-[#4285F4]/10', dot: '#4285F4',
    features: ['Streaming inserts', 'Partitioned tables', 'SQL analytics', 'Looker Studio'],
    docsUrl: '#', needsKey: true, needsEndpoint: false, isOAuth: false,
    keyLabel: 'Service Account JSON (base64)',
  },
  {
    id: 'snowflake', name: 'Snowflake', category: 'data',
    desc: 'Load usage events to Snowflake via Snowpipe. Build cost models in dbt or directly in worksheets.',
    initials: 'SF', color: 'text-[#29B5E8]', bg: 'bg-[#29B5E8]/10', dot: '#29B5E8',
    features: ['Snowpipe auto-ingest', 'dbt-ready schema', 'Time-travel', 'Data sharing'],
    docsUrl: '#', needsKey: true, needsEndpoint: true, isOAuth: false,
    keyLabel: 'Private Key', endpointLabel: 'Account Identifier', endpointPlaceholder: 'orgname-accountname',
  },
  {
    id: 'stripe', name: 'Stripe', category: 'billing',
    desc: 'Metered billing for internal chargeback. Bill teams per token consumed and generate invoices via Stripe.',
    initials: 'ST', color: 'text-[#635BFF]', bg: 'bg-[#635BFF]/10', dot: '#635BFF',
    features: ['Metered usage records', 'Subscriptions', 'Invoicing', 'Customer portal'],
    docsUrl: '#', needsKey: true, needsEndpoint: false, isOAuth: false,
    keyLabel: 'Stripe Secret Key (sk_live_…)',
  },
  {
    id: 'github-actions', name: 'GitHub Actions', category: 'devtools',
    desc: 'Official action to post CI cost summaries on PRs and block merges that exceed per-run token budgets.',
    initials: 'GA', color: 'text-[#24292E]', bg: 'bg-[#24292E]/10', dot: '#24292E',
    features: ['PR cost comments', 'Budget gate checks', 'Cost summary step', 'OIDC auth'],
    docsUrl: '#', needsKey: true, needsEndpoint: false, isOAuth: false,
    keyLabel: 'GitHub Personal Access Token',
  },
]

const CATEGORY_META: Record<Category, { label: string; desc: string }> = {
  notifications: { label: 'Notifications',    desc: 'Alerts & incident routing'  },
  observability: { label: 'Observability',    desc: 'Metrics, traces & dashboards'},
  data:          { label: 'Data & Analytics', desc: 'Warehouses & BI'             },
  devtools:      { label: 'Dev Tools',        desc: 'CI/CD & engineering'         },
  billing:       { label: 'Billing',          desc: 'Metered billing & invoicing' },
}

/* ══════════════════════════════════════════════════════════════
   CONNECT MODAL
══════════════════════════════════════════════════════════════ */
function ConnectModal({ item, orgId, onClose, onConnected }: {
  item:        CatalogItem
  orgId:       string
  onClose:     () => void
  onConnected: (id: string, detail: string) => void
}) {
  const [apiKey,    setApiKey]    = useState('')
  const [endpoint,  setEndpoint]  = useState('')
  const [detail,    setDetail]    = useState('')
  const [saving,    setSaving]    = useState(false)
  const [done,      setDone]      = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const canSubmit = item.isOAuth ||
    (!item.needsKey || apiKey.trim().length > 0) &&
    (!item.needsEndpoint || endpoint.trim().length > 0)

  async function handleConnect() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/v1/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id:      orgId,
          integration: item.id,
          detail:      detail || endpoint || null,
          config: {
            ...(apiKey    ? { api_key:  apiKey    } : {}),
            ...(endpoint  ? { endpoint: endpoint  } : {}),
          },
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      onConnected(item.id, detail || endpoint || item.name)
      setDone(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-[500px] bg-white dark:bg-[#141428] rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-5 border-b border-[var(--border)]">
          <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-[14px] flex-shrink-0 border', item.bg, item.color)}
            style={{ borderColor: `${item.dot}25` }}>
            {item.initials}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-[var(--fg)]">Connect {item.name}</h2>
            <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5 line-clamp-1">{item.desc}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)]">
            <X size={15} />
          </button>
        </div>

        {done ? (
          <div className="px-6 py-12 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--green-bg)] flex items-center justify-center">
              <Check size={26} className="text-teal" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-[var(--fg)]">{item.name} connected!</p>
              <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1">Data will start flowing within a few minutes.</p>
            </div>
            <button onClick={onClose} className="btn-primary mt-2">Done</button>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-5">
              {/* Features */}
              <div>
                <p className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider mb-2.5">What you&apos;ll get</p>
                <div className="grid grid-cols-2 gap-2">
                  {item.features.map(f => (
                    <div key={f} className="flex items-center gap-2 text-[12px] text-[var(--fg-secondary)]">
                      <Check size={11} className="text-teal flex-shrink-0" /> {f}
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[var(--border)]" />

              {/* Workspace/detail */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
                  Friendly name <span className="normal-case font-normal text-[var(--fg-tertiary)]">(optional)</span>
                </label>
                <input value={detail} onChange={e => setDetail(e.target.value)}
                  placeholder={`e.g. ${item.name} workspace`}
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
              </div>

              {item.needsKey && (
                <div>
                  <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
                    {item.keyLabel ?? 'API Key / Token'}
                  </label>
                  <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                    placeholder="Paste your key…"
                    className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral font-mono" />
                  <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-1.5">Stored encrypted at rest. Never logged.</p>
                </div>
              )}

              {item.needsEndpoint && (
                <div>
                  <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
                    {item.endpointLabel ?? 'Endpoint URL'}
                  </label>
                  <input value={endpoint} onChange={e => setEndpoint(e.target.value)}
                    placeholder={item.endpointPlaceholder ?? 'https://…'}
                    className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral font-mono" />
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-[12px] text-[var(--red)] bg-[var(--red-bg)] px-3 py-2 rounded-xl border border-[var(--red)]/20">
                  <AlertTriangle size={12} className="flex-shrink-0" /> {error}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
              <a href={item.docsUrl} className="flex items-center gap-1 text-[12px] text-[var(--fg-secondary)] hover:text-coral transition-colors">
                <ExternalLink size={12} /> Docs
              </a>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">Cancel</button>
                <button onClick={handleConnect} disabled={!canSubmit || saving}
                  className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
                  {saving
                    ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Connecting…</>
                    : <><Link2 size={13} /> Connect</>
                  }
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   INTEGRATION CARD
══════════════════════════════════════════════════════════════ */
function IntegrationCard({ item, conn, orgId, onConnect, onDisconnect }: {
  item:         CatalogItem
  conn:         OrgIntegration | null
  orgId:        string
  onConnect:    (id: string) => void
  onDisconnect: (id: string) => void
}) {
  const isConnected = !!conn
  const catMeta     = CATEGORY_META[item.category]

  return (
    <div className={cn(
      'bg-white dark:bg-[#141428] border rounded-2xl p-5 flex flex-col gap-4 transition-all hover:shadow-sm',
      isConnected
        ? conn?.syncOk === false ? 'border-[var(--red)]/40' : 'border-[var(--border)] hover:border-[var(--border-strong)]'
        : 'border-[var(--border)] hover:border-[var(--border-strong)]',
    )}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-[13px] flex-shrink-0 border', item.bg, item.color)}
            style={{ borderColor: `${item.dot}25` }}>
            {item.initials}
          </div>
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold text-[var(--fg)] truncate">{item.name}</p>
            <span className="text-[10px] font-semibold text-[var(--fg-tertiary)]">{catMeta.label}</span>
          </div>
        </div>

        {/* Status badge */}
        {isConnected ? (
          <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold flex-shrink-0',
            conn?.syncOk === false
              ? 'bg-[var(--red-bg)] text-[var(--red)]'
              : 'bg-[var(--green-bg)] text-teal')}>
            <span className={cn('w-1.5 h-1.5 rounded-full', conn?.syncOk === false ? 'bg-[var(--red)]' : 'bg-teal')} />
            {conn?.syncOk === false ? 'Sync error' : 'Connected'}
          </div>
        ) : (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--border-strong)]" />
            Available
          </div>
        )}
      </div>

      {/* Description */}
      <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed flex-1">{item.desc}</p>

      {/* Features */}
      <div className="flex flex-wrap gap-1.5">
        {item.features.slice(0, 3).map(f => (
          <span key={f} className="text-[10.5px] px-2 py-0.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--fg-tertiary)] border border-[var(--border)]">
            {f}
          </span>
        ))}
        {item.features.length > 3 && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--fg-tertiary)] border border-[var(--border)]">
            +{item.features.length - 3} more
          </span>
        )}
      </div>

      {/* Connected detail row */}
      {isConnected && conn?.detail && (
        <div className="flex items-center justify-between text-[11px] px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
          <span className="font-mono text-[var(--fg-secondary)] truncate">{conn.detail}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
            {conn.syncOk
              ? <><Check size={10} className="text-teal" /><span className="text-[var(--fg-tertiary)]">Synced</span></>
              : <><AlertTriangle size={10} className="text-[var(--red)]" /><span className="text-[var(--red)] font-semibold">Error</span></>
            }
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {isConnected ? (
          <>
            <button onClick={() => onConnect(item.id)}
              className="flex-1 btn-secondary text-[12px] py-2">
              <Settings size={12} /> Reconfigure
            </button>
            <button onClick={() => onDisconnect(item.id)}
              className="px-3 py-2 rounded-xl border border-[var(--border)] text-[12px] font-semibold text-[var(--fg-tertiary)] hover:border-[var(--red)]/50 hover:text-[var(--red)] hover:bg-[var(--red-bg)] transition-all">
              Disconnect
            </button>
          </>
        ) : (
          <button onClick={() => onConnect(item.id)} className="flex-1 btn-primary text-[12px] py-2">
            <Plus size={12} /> Connect
          </button>
        )}
        <a href={item.docsUrl}
          className="w-9 flex items-center justify-center rounded-xl border border-[var(--border)] text-[var(--fg-tertiary)] hover:text-coral hover:border-coral/40 transition-all">
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN CLIENT
══════════════════════════════════════════════════════════════ */
interface Props {
  initialConnected: OrgIntegration[]
  orgId:            string
}

export function IntegrationsClient({ initialConnected, orgId }: Props) {
  const [connected, setConnected] = useState<OrgIntegration[]>(initialConnected)
  const [modalId,   setModalId]   = useState<string | null>(null)
  const [toast,     setToast]     = useState('')
  const [catFilter, setCatFilter] = useState<Category | 'all'>('all')
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  function handleConnected(id: string, detail: string) {
    const now = new Date().toISOString()
    setConnected(prev => {
      const without = prev.filter(c => c.integration !== id)
      return [...without, { integration: id, isActive: true, connectedAt: now, lastSyncedAt: now, syncOk: true, detail }]
    })
    setModalId(null)
    showToast(`${CATALOG.find(c => c.id === id)?.name} connected`)
  }

  async function handleDisconnect(id: string) {
    setDisconnecting(id)
    try {
      await fetch(`/api/v1/integrations?org_id=${orgId}&integration=${id}`, { method: 'DELETE' })
      setConnected(prev => prev.filter(c => c.integration !== id))
      showToast(`${CATALOG.find(c => c.id === id)?.name} disconnected`)
    } finally {
      setDisconnecting(null)
    }
  }

  const connMap = new Map(connected.map(c => [c.integration, c]))
  const connectedCount  = connected.length
  const syncErrCount    = connected.filter(c => !c.syncOk).length

  const filtered = CATALOG.filter(item =>
    catFilter === 'all' || item.category === catFilter
  )

  const modalItem = modalId ? CATALOG.find(c => c.id === modalId) ?? null : null

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Integrations</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
            Connect TokenFin to your observability stack, data warehouses, and alert channels
          </p>
        </div>
        <a href="#" className="btn-secondary text-[12.5px] flex-shrink-0">
          <ExternalLink size={13} /> API & webhooks
        </a>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Connected',          value: connectedCount.toString(),          color: 'text-teal',          icon: Check         },
          { label: 'Available',          value: (CATALOG.length - connectedCount).toString(), color: 'text-[var(--blue)]', icon: Zap  },
          { label: 'Sync errors',        value: syncErrCount.toString(),            color: 'text-[var(--red)]',  icon: AlertTriangle  },
          { label: 'Total integrations', value: CATALOG.length.toString(),          color: 'text-[var(--fg)]',   icon: Link2          },
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

      {/* Sync error banner */}
      {syncErrCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--red-bg)] border border-[var(--red)]/30 rounded-xl">
          <AlertTriangle size={14} className="text-[var(--red)] flex-shrink-0" />
          <p className="text-[12.5px] text-[var(--red)] flex-1">
            <span className="font-semibold">{syncErrCount} integration{syncErrCount > 1 ? 's have' : ' has'} sync errors.</span>
            {' '}Check credentials or endpoint availability.
          </p>
          <button className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--red)] hover:underline flex-shrink-0">
            <RefreshCw size={11} /> Retry all
          </button>
        </div>
      )}

      {/* Category filter */}
      <div className="flex items-center gap-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl p-1 w-fit flex-wrap">
        {(['all', 'notifications', 'observability', 'data', 'devtools', 'billing'] as const).map(cat => {
          const count = cat === 'all' ? CATALOG.length : CATALOG.filter(i => i.category === cat).length
          const active = catFilter === cat
          return (
            <button key={cat} onClick={() => setCatFilter(cat)}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                active ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
              {cat === 'all' ? 'All' : CATEGORY_META[cat as Category].label}
              <span className={cn('ml-1.5 text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                active ? 'bg-white/20 text-[var(--bg)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {filtered.map(item => (
          <IntegrationCard
            key={item.id}
            item={item}
            conn={connMap.get(item.id) ?? null}
            orgId={orgId}
            onConnect={id => setModalId(id)}
            onDisconnect={handleDisconnect}
          />
        ))}
      </div>

      {/* Build your own */}
      <div className="flex items-center gap-4 px-5 py-4 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl">
        <div className="w-10 h-10 rounded-xl bg-coral/10 flex items-center justify-center flex-shrink-0">
          <Zap size={18} className="text-coral" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[var(--fg)]">Build a custom integration</p>
          <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">
            Use our REST API or webhook delivery to connect any internal tool or data pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a href="#" className="btn-secondary text-[12px]"><ExternalLink size={12} /> API docs</a>
          <a href="#" className="btn-primary text-[12px]"><ChevronRight size={12} /> Webhooks</a>
        </div>
      </div>

      {/* Connect modal */}
      {modalItem && (
        <ConnectModal
          item={modalItem}
          orgId={orgId}
          onClose={() => setModalId(null)}
          onConnected={handleConnected}
        />
      )}

      {/* Disconnecting spinner */}
      {disconnecting && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold z-50">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--bg)]/30 border-t-[var(--bg)] animate-spin" />
          Disconnecting…
        </div>
      )}

      {/* Toast */}
      <div className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
        toast && !disconnecting ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none',
      )}>
        <Check size={14} className="text-teal" /> {toast}
      </div>
    </div>
  )
}
