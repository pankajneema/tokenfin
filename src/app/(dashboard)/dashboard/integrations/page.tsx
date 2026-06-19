'use client'
import { useState } from 'react'
import {
  Search, Check, X, ExternalLink, RefreshCw, AlertTriangle,
  Plus, Settings, Zap, ChevronRight, Link2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════ */
type Category = 'all' | 'observability' | 'notifications' | 'data' | 'auth' | 'devtools' | 'billing'
type Status   = 'connected' | 'available' | 'soon'

interface Integration {
  id:          string
  name:        string
  desc:        string
  category:    Exclude<Category, 'all'>
  status:      Status
  initials:    string
  color:       string
  bg:          string
  dot:         string
  connectedAt?: string
  lastSync?:   string
  syncOk?:     boolean
  detail?:     string           // e.g. workspace, org, endpoint
  features:    string[]
  docsUrl?:    string
}

/* ══════════════════════════════════════════════════════════════
   REGISTRY
══════════════════════════════════════════════════════════════ */
const INTEGRATIONS: Integration[] = [
  // ── Observability ──
  {
    id: 'datadog', name: 'Datadog', category: 'observability', status: 'connected',
    desc: 'Ship LLM cost metrics, token usage, and latency as custom Datadog metrics. Trigger monitors on spend anomalies.',
    initials: 'DD', color: 'text-[#632CA6]', bg: 'bg-[#632CA6]/10', dot: '#632CA6',
    connectedAt: '2 months ago', lastSync: '3 min ago', syncOk: true,
    detail: 'org: acme-corp', features: ['Custom metrics', 'Monitors', 'Dashboards', 'Logs'],
    docsUrl: '#',
  },
  {
    id: 'grafana', name: 'Grafana', category: 'observability', status: 'connected',
    desc: 'Push usage timeseries to Grafana Cloud. Pre-built dashboards for cost-per-model and team spend.',
    initials: 'GF', color: 'text-[#F46800]', bg: 'bg-[#F46800]/10', dot: '#F46800',
    connectedAt: '1 month ago', lastSync: '5 min ago', syncOk: true,
    detail: 'grafana.acme.io', features: ['Timeseries', 'Dashboards', 'Alerts', 'Panels'],
    docsUrl: '#',
  },
  {
    id: 'prometheus', name: 'Prometheus', category: 'observability', status: 'available',
    desc: 'Expose a /metrics scrape endpoint in Prometheus format. Works with any Prometheus-compatible stack.',
    initials: 'PM', color: 'text-[#E6522C]', bg: 'bg-[#E6522C]/10', dot: '#E6522C',
    features: ['Metrics endpoint', 'Labels', 'PromQL', 'Alertmanager'],
    docsUrl: '#',
  },
  {
    id: 'newrelic', name: 'New Relic', category: 'observability', status: 'available',
    desc: 'Forward token usage and cost events as New Relic custom events with full attribute support.',
    initials: 'NR', color: 'text-[#1CE783]', bg: 'bg-[#1CE783]/10', dot: '#1CE783',
    features: ['Custom events', 'NRQL', 'Dashboards', 'APM traces'],
    docsUrl: '#',
  },
  {
    id: 'opentelemetry', name: 'OpenTelemetry', category: 'observability', status: 'available',
    desc: 'Emit OTLP traces and metrics. Works with any OTel Collector — Jaeger, Zipkin, Tempo, and more.',
    initials: 'OT', color: 'text-[#425CC7]', bg: 'bg-[#425CC7]/10', dot: '#425CC7',
    features: ['OTLP traces', 'Metrics', 'Logs', 'W3C context propagation'],
    docsUrl: '#',
  },

  // ── Notifications ──
  {
    id: 'slack', name: 'Slack', category: 'notifications', status: 'connected',
    desc: 'Post spend alerts, weekly digests, and limit-breach notifications to any Slack channel or DM.',
    initials: 'SL', color: 'text-[#4A154B]', bg: 'bg-[#4A154B]/10', dot: '#4A154B',
    connectedAt: '3 months ago', lastSync: '2 min ago', syncOk: true,
    detail: '#tokenfin-alerts', features: ['Alert routing', 'Digest posts', 'Interactive buttons', 'Thread replies'],
    docsUrl: '#',
  },
  {
    id: 'pagerduty', name: 'PagerDuty', category: 'notifications', status: 'available',
    desc: 'Trigger incidents for critical spend events. Map alert severity to PagerDuty escalation policies.',
    initials: 'PD', color: 'text-[#06AC38]', bg: 'bg-[#06AC38]/10', dot: '#06AC38',
    features: ['Incidents', 'Escalation', 'On-call routing', 'Auto-resolve'],
    docsUrl: '#',
  },
  {
    id: 'teams', name: 'Microsoft Teams', category: 'notifications', status: 'available',
    desc: 'Send adaptive cards to Teams channels for spend alerts, approval flows, and budget updates.',
    initials: 'MT', color: 'text-[#6264A7]', bg: 'bg-[#6264A7]/10', dot: '#6264A7',
    features: ['Adaptive cards', 'Channel posts', 'Approval flows', 'Mentions'],
    docsUrl: '#',
  },
  {
    id: 'opsgenie', name: 'OpsGenie', category: 'notifications', status: 'soon',
    desc: 'Route critical budget breaches to OpsGenie schedules with enriched alert payloads.',
    initials: 'OG', color: 'text-[#0052CC]', bg: 'bg-[#0052CC]/10', dot: '#0052CC',
    features: ['Alerts', 'On-call', 'Escalation', 'Runbooks'],
    docsUrl: '#',
  },
  {
    id: 'discord', name: 'Discord', category: 'notifications', status: 'available',
    desc: 'Webhook-based alerts to Discord channels. Perfect for dev teams running LLM services.',
    initials: 'DC', color: 'text-[#5865F2]', bg: 'bg-[#5865F2]/10', dot: '#5865F2',
    features: ['Webhooks', 'Embeds', 'Channel routing', 'Mentions'],
    docsUrl: '#',
  },

  // ── Data & Analytics ──
  {
    id: 'bigquery', name: 'BigQuery', category: 'data', status: 'connected',
    desc: 'Stream every LLM usage event to BigQuery in real-time. Query spend with SQL and build BI dashboards.',
    initials: 'BQ', color: 'text-[#4285F4]', bg: 'bg-[#4285F4]/10', dot: '#4285F4',
    connectedAt: '2 months ago', lastSync: '1 min ago', syncOk: true,
    detail: 'acme-data.llm_events', features: ['Streaming inserts', 'Partitioned tables', 'IAM', 'Looker Studio'],
    docsUrl: '#',
  },
  {
    id: 'snowflake', name: 'Snowflake', category: 'data', status: 'available',
    desc: 'Load usage events to Snowflake via Snowpipe. Build cost models in dbt or directly in worksheets.',
    initials: 'SF', color: 'text-[#29B5E8]', bg: 'bg-[#29B5E8]/10', dot: '#29B5E8',
    features: ['Snowpipe', 'dbt-ready schema', 'Time-travel', 'Data sharing'],
    docsUrl: '#',
  },
  {
    id: 'segment', name: 'Segment', category: 'data', status: 'available',
    desc: 'Emit track events to your Segment source. Route LLM cost data to 300+ downstream destinations.',
    initials: 'SG', color: 'text-[#52BD94]', bg: 'bg-[#52BD94]/10', dot: '#52BD94',
    features: ['Track events', 'Identify', 'Destinations', 'Functions'],
    docsUrl: '#',
  },
  {
    id: 'amplitude', name: 'Amplitude', category: 'data', status: 'soon',
    desc: 'Send LLM usage as Amplitude events. Cohort analysis on which teams use which models.',
    initials: 'AM', color: 'text-[#1C73E8]', bg: 'bg-[#1C73E8]/10', dot: '#1C73E8',
    features: ['Events', 'Cohorts', 'Funnels', 'Revenue'],
    docsUrl: '#',
  },
  {
    id: 'redshift', name: 'Amazon Redshift', category: 'data', status: 'available',
    desc: 'Bulk-load usage snapshots to Redshift via S3 COPY. Works with Redshift Serverless.',
    initials: 'RS', color: 'text-[#8C1D18]', bg: 'bg-[#8C1D18]/10', dot: '#8C1D18',
    features: ['S3 COPY', 'Spectrum', 'Serverless', 'QuickSight'],
    docsUrl: '#',
  },

  // ── Auth & SSO ──
  {
    id: 'google-sso', name: 'Google SSO', category: 'auth', status: 'connected',
    desc: 'Sign in with Google Workspace. Automatically provision users from your org domain.',
    initials: 'GG', color: 'text-[#4285F4]', bg: 'bg-[#4285F4]/10', dot: '#4285F4',
    connectedAt: '3 months ago', lastSync: 'Active',  syncOk: true,
    detail: '@acmecorp.com', features: ['SSO', 'Auto-provision', 'Domain lock', 'MFA passthrough'],
    docsUrl: '#',
  },
  {
    id: 'okta', name: 'Okta', category: 'auth', status: 'available',
    desc: 'SAML 2.0 / OIDC SSO via Okta. Sync groups as TokenFin teams. Deprovisioning on offboard.',
    initials: 'OK', color: 'text-[#007DC1]', bg: 'bg-[#007DC1]/10', dot: '#007DC1',
    features: ['SAML 2.0', 'OIDC', 'Group sync', 'SCIM provisioning'],
    docsUrl: '#',
  },
  {
    id: 'azure-ad', name: 'Azure AD', category: 'auth', status: 'available',
    desc: 'Enterprise SSO and user provisioning via Microsoft Entra ID (formerly Azure AD) with SCIM 2.0.',
    initials: 'AZ', color: 'text-[#0078D4]', bg: 'bg-[#0078D4]/10', dot: '#0078D4',
    features: ['SAML', 'SCIM 2.0', 'Conditional access', 'MFA'],
    docsUrl: '#',
  },
  {
    id: 'github-sso', name: 'GitHub SSO', category: 'auth', status: 'available',
    desc: 'OAuth login with GitHub. Map GitHub org teams to TokenFin teams automatically.',
    initials: 'GH', color: 'text-[#24292E]', bg: 'bg-[#24292E]/10', dot: '#24292E',
    features: ['OAuth', 'Org sync', 'Team mapping', 'Audit log'],
    docsUrl: '#',
  },

  // ── Dev Tools ──
  {
    id: 'github-actions', name: 'GitHub Actions', category: 'devtools', status: 'available',
    desc: 'Official action to post CI cost summaries. Block PRs that exceed per-run token budgets.',
    initials: 'GA', color: 'text-[#24292E]', bg: 'bg-[#24292E]/10', dot: '#24292E',
    features: ['PR comments', 'Budget gates', 'Cost summary', 'OIDC auth'],
    docsUrl: '#',
  },
  {
    id: 'jira', name: 'Jira', category: 'devtools', status: 'connected',
    desc: 'Auto-create Jira tickets on limit breaches. Link cost anomalies to epics and sprints.',
    initials: 'JR', color: 'text-[#0052CC]', bg: 'bg-[#0052CC]/10', dot: '#0052CC',
    connectedAt: '1 month ago', lastSync: '10 min ago', syncOk: false,
    detail: 'acme.atlassian.net', features: ['Auto-tickets', 'Epic linking', 'Sprint sync', 'Webhooks'],
    docsUrl: '#',
  },
  {
    id: 'linear', name: 'Linear', category: 'devtools', status: 'available',
    desc: 'Create Linear issues on spend anomalies. Triage cost spikes directly in your eng workflow.',
    initials: 'LN', color: 'text-[#5E6AD2]', bg: 'bg-[#5E6AD2]/10', dot: '#5E6AD2',
    features: ['Issues', 'Cycle triage', 'Project tracking', 'Webhooks'],
    docsUrl: '#',
  },
  {
    id: 'terraform', name: 'Terraform', category: 'devtools', status: 'soon',
    desc: 'Manage TokenFin resources (projects, limits, API keys) as Terraform resources. GitOps-ready.',
    initials: 'TF', color: 'text-[#7B42BC]', bg: 'bg-[#7B42BC]/10', dot: '#7B42BC',
    features: ['Resources', 'Data sources', 'Import', 'Modules'],
    docsUrl: '#',
  },

  // ── Billing ──
  {
    id: 'stripe', name: 'Stripe', category: 'billing', status: 'connected',
    desc: 'Metered billing for internal chargeback. Bill teams per token consumed. Invoice via Stripe.',
    initials: 'ST', color: 'text-[#635BFF]', bg: 'bg-[#635BFF]/10', dot: '#635BFF',
    connectedAt: '2 months ago', lastSync: '1 hour ago', syncOk: true,
    detail: 'acme · live mode', features: ['Metered usage', 'Subscriptions', 'Invoicing', 'Customer portal'],
    docsUrl: '#',
  },
  {
    id: 'aws-marketplace', name: 'AWS Marketplace', category: 'billing', status: 'soon',
    desc: 'Purchase and consolidate TokenFin billing via AWS Marketplace into your AWS bill.',
    initials: 'AW', color: 'text-[#FF9900]', bg: 'bg-[#FF9900]/10', dot: '#FF9900',
    features: ['AWS billing', 'Private offers', 'SaaS contracts', 'EDP credits'],
    docsUrl: '#',
  },
]

/* ══════════════════════════════════════════════════════════════
   META
══════════════════════════════════════════════════════════════ */
const CATEGORY_META: Record<Exclude<Category,'all'>, { label: string; desc: string }> = {
  observability: { label: 'Observability',     desc: 'Metrics, traces & dashboards' },
  notifications: { label: 'Notifications',     desc: 'Alerts & incident routing'    },
  data:          { label: 'Data & Analytics',  desc: 'Warehouses & BI'              },
  auth:          { label: 'Auth & SSO',        desc: 'Identity & provisioning'      },
  devtools:      { label: 'Dev Tools',         desc: 'CI/CD & engineering'          },
  billing:       { label: 'Billing',           desc: 'Metered billing & invoicing'  },
}

const STATUS_META: Record<Status, { label: string; color: string; bg: string; dot: string }> = {
  connected: { label: 'Connected',    color: 'text-teal',           bg: 'bg-[var(--green-bg)]',  dot: 'bg-teal'               },
  available: { label: 'Available',    color: 'text-[var(--fg-secondary)]', bg: 'bg-[var(--bg-tertiary)]', dot: 'bg-[var(--border-strong)]' },
  soon:      { label: 'Coming soon',  color: 'text-[var(--amber)]', bg: 'bg-[var(--amber-bg)]',  dot: 'bg-[var(--amber)]'     },
}

/* ══════════════════════════════════════════════════════════════
   CONNECT MODAL
══════════════════════════════════════════════════════════════ */
function ConnectModal({ integration, onClose, onConnect }: {
  integration: Integration
  onClose:    () => void
  onConnect:  (id: string) => void
}) {
  const [step,    setStep]    = useState<'info' | 'config' | 'done'>('info')
  const [apiKey,  setApiKey]  = useState('')
  const [endpoint,setEndpoint]= useState('')
  const [saving,  setSaving]  = useState(false)

  const needsEndpoint = ['prometheus','opentelemetry','discord','redshift'].includes(integration.id)
  const needsApiKey   = !['google-sso','okta','azure-ad','github-sso'].includes(integration.id)

  async function handleConnect() {
    setSaving(true)
    await new Promise(r => setTimeout(r, 800))
    onConnect(integration.id)
    setStep('done')
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-[500px] bg-white dark:bg-[#141428] rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-5 border-b border-[var(--border)]">
          <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-[14px] flex-shrink-0 border', integration.bg, integration.color)} style={{ borderColor: `${integration.dot}25` }}>
            {integration.initials}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-[var(--fg)]">Connect {integration.name}</h2>
            <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5 truncate">{integration.desc}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)]">
            <X size={15} />
          </button>
        </div>

        {step === 'done' ? (
          <div className="px-6 py-10 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--green-bg)] flex items-center justify-center">
              <Check size={26} className="text-teal" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-[var(--fg)]">{integration.name} connected!</p>
              <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1">Data will start flowing within a few minutes.</p>
            </div>
            <button onClick={onClose} className="btn-primary mt-2">Done</button>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-5">
              {/* Features */}
              <div>
                <p className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider mb-2.5">What you'll get</p>
                <div className="grid grid-cols-2 gap-2">
                  {integration.features.map(f => (
                    <div key={f} className="flex items-center gap-2 text-[12px] text-[var(--fg-secondary)]">
                      <Check size={11} className="text-teal flex-shrink-0" /> {f}
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[var(--border)]" />

              {/* Config fields */}
              {needsApiKey && (
                <div>
                  <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
                    {integration.category === 'auth' ? 'Client ID' : 'API Key / Token'}
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={integration.category === 'auth' ? 'client_id_…' : 'sk-… or dd-api-key-…'}
                    className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral font-mono"
                  />
                  <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-1.5">Stored encrypted at rest. Never logged.</p>
                </div>
              )}
              {needsEndpoint && (
                <div>
                  <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Endpoint URL</label>
                  <input
                    value={endpoint}
                    onChange={e => setEndpoint(e.target.value)}
                    placeholder="https://your-collector:4317"
                    className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral font-mono"
                  />
                </div>
              )}
              {['google-sso','okta','azure-ad','github-sso'].includes(integration.id) && (
                <div className="p-3 bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-xl text-[12px] text-[var(--blue)]">
                  <span className="font-semibold">OAuth flow: </span>
                  You'll be redirected to {integration.name} to grant access. No secrets stored manually.
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
              <a href={integration.docsUrl} className="flex items-center gap-1 text-[12px] text-[var(--fg-secondary)] hover:text-coral transition-colors">
                <ExternalLink size={12} /> Docs
              </a>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">Cancel</button>
                <button
                  onClick={handleConnect}
                  disabled={saving || (needsApiKey && !apiKey && !['google-sso','okta','azure-ad','github-sso'].includes(integration.id))}
                  className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving
                    ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Connecting…</>
                    : ['google-sso','okta','azure-ad','github-sso'].includes(integration.id)
                      ? <><ExternalLink size={13} /> Authorize</>
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
function IntegrationCard({ integration, onConnect, onDisconnect, onConfigure }: {
  integration: Integration
  onConnect:   (id: string) => void
  onDisconnect:(id: string) => void
  onConfigure: (id: string) => void
}) {
  const sm = STATUS_META[integration.status]
  const catMeta = CATEGORY_META[integration.category]

  return (
    <div className={cn(
      'bg-white dark:bg-[#141428] border rounded-2xl p-5 flex flex-col gap-4 transition-all',
      integration.status === 'connected'
        ? 'border-[var(--border)] hover:border-[var(--border-strong)]'
        : integration.status === 'soon'
          ? 'border-dashed border-[var(--border)] opacity-70'
          : 'border-[var(--border)] hover:border-[var(--border-strong)]',
    )}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn('w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-[13px] flex-shrink-0 border', integration.bg, integration.color)}
            style={{ borderColor: `${integration.dot}25` }}
          >
            {integration.initials}
          </div>
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold text-[var(--fg)] truncate">{integration.name}</p>
            <span className="text-[10px] font-semibold text-[var(--fg-tertiary)]">{catMeta.label}</span>
          </div>
        </div>

        {/* Status badge */}
        <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold flex-shrink-0', sm.bg, sm.color)}>
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', sm.dot)} />
          {sm.label}
        </div>
      </div>

      {/* Description */}
      <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed flex-1">{integration.desc}</p>

      {/* Features */}
      <div className="flex flex-wrap gap-1.5">
        {integration.features.slice(0, 3).map(f => (
          <span key={f} className="text-[10.5px] px-2 py-0.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--fg-tertiary)] border border-[var(--border)]">
            {f}
          </span>
        ))}
        {integration.features.length > 3 && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--fg-tertiary)] border border-[var(--border)]">
            +{integration.features.length - 3} more
          </span>
        )}
      </div>

      {/* Connected detail / sync */}
      {integration.status === 'connected' && integration.detail && (
        <div className="flex items-center justify-between text-[11px] px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
          <span className="font-mono text-[var(--fg-secondary)]">{integration.detail}</span>
          <div className="flex items-center gap-1.5">
            {integration.syncOk
              ? <><Check size={10} className="text-teal" /><span className="text-[var(--fg-tertiary)]">{integration.lastSync}</span></>
              : <><AlertTriangle size={10} className="text-[var(--red)]" /><span className="text-[var(--red)] font-semibold">Sync error</span></>
            }
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {integration.status === 'connected' ? (
          <>
            <button
              onClick={() => onConfigure(integration.id)}
              className="flex-1 btn-secondary text-[12px] py-2"
            >
              <Settings size={12} /> Configure
            </button>
            <button
              onClick={() => onDisconnect(integration.id)}
              className="px-3 py-2 rounded-xl border border-[var(--border)] text-[12px] font-semibold text-[var(--fg-tertiary)] hover:border-[var(--red)]/50 hover:text-[var(--red)] hover:bg-[var(--red-bg)] transition-all"
            >
              Disconnect
            </button>
          </>
        ) : integration.status === 'available' ? (
          <button
            onClick={() => onConnect(integration.id)}
            className="flex-1 btn-primary text-[12px] py-2"
          >
            <Plus size={12} /> Connect
          </button>
        ) : (
          <button disabled className="flex-1 py-2 rounded-xl border border-dashed border-[var(--border)] text-[12px] font-semibold text-[var(--fg-tertiary)] cursor-not-allowed">
            Coming soon
          </button>
        )}
        {integration.docsUrl && (
          <a
            href={integration.docsUrl}
            className="w-9 flex items-center justify-center rounded-xl border border-[var(--border)] text-[var(--fg-tertiary)] hover:text-coral hover:border-coral/40 transition-all"
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   PAGE
══════════════════════════════════════════════════════════════ */
export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>(INTEGRATIONS)
  const [category,     setCategory]     = useState<Category>('all')
  const [search,       setSearch]       = useState('')
  const [connectTarget,setConnectTarget]= useState<Integration | null>(null)
  const [toast,        setToast]        = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  function handleConnect(id: string) {
    setIntegrations(prev => prev.map(i =>
      i.id === id ? { ...i, status: 'connected', connectedAt: 'just now', lastSync: 'just now', syncOk: true } : i
    ))
    setConnectTarget(null)
    showToast(`${integrations.find(i => i.id === id)?.name} connected`)
  }

  function handleDisconnect(id: string) {
    const name = integrations.find(i => i.id === id)?.name
    setIntegrations(prev => prev.map(i =>
      i.id === id ? { ...i, status: 'available', connectedAt: undefined, lastSync: undefined, syncOk: undefined, detail: undefined } : i
    ))
    showToast(`${name} disconnected`)
  }

  const filtered = integrations.filter(i => {
    if (category !== 'all' && i.category !== category) return false
    if (search && !i.name.toLowerCase().includes(search.toLowerCase()) && !i.desc.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const connectedCount  = integrations.filter(i => i.status === 'connected').length
  const availableCount  = integrations.filter(i => i.status === 'available').length
  const syncErrCount    = integrations.filter(i => i.status === 'connected' && !i.syncOk).length

  return (
    <div className="space-y-6 max-w-[1100px]">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Integrations</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
            Connect TokenFin to your observability stack, data warehouse, and notification channels
          </p>
        </div>
        <a href="#" className="btn-secondary text-[12.5px] flex-shrink-0">
          <ExternalLink size={13} /> API & webhooks
        </a>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Connected',         value: connectedCount.toString(),    color: 'text-teal',           bg: 'bg-[var(--green-bg)]',  icon: Check      },
          { label: 'Available',         value: availableCount.toString(),    color: 'text-[var(--blue)]',  bg: 'bg-[var(--blue-bg)]',   icon: Zap        },
          { label: 'Sync errors',       value: syncErrCount.toString(),      color: 'text-[var(--red)]',   bg: 'bg-[var(--red-bg)]',    icon: AlertTriangle },
          { label: 'Total integrations',value: INTEGRATIONS.length.toString(), color: 'text-[var(--fg)]', bg: 'bg-[var(--bg-secondary)]', icon: Link2    },
        ].map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-3">
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', s.bg)}>
                <Icon size={15} className={s.color} />
              </div>
              <div>
                <p className={cn('text-[18px] font-bold leading-none', s.color)}>{s.value}</p>
                <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{s.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Sync error banner ── */}
      {syncErrCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--red-bg)] border border-[var(--red)]/30 rounded-xl">
          <AlertTriangle size={14} className="text-[var(--red)] flex-shrink-0" />
          <p className="text-[12.5px] text-[var(--red)] flex-1">
            <span className="font-semibold">{syncErrCount} integration{syncErrCount > 1 ? 's have' : ' has'} sync errors.</span>
            {' '}Check connection credentials or endpoint availability.
          </p>
          <button className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--red)] hover:underline flex-shrink-0">
            <RefreshCw size={11} /> Retry all
          </button>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Category tabs */}
        <div className="flex items-center gap-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl p-1 flex-wrap">
          <button
            onClick={() => setCategory('all')}
            className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all', category === 'all' ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}
          >
            All
            <span className={cn('ml-1.5 text-[10px] px-1.5 py-0.5 rounded-md font-semibold', category === 'all' ? 'bg-white/20 text-[var(--bg)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
              {INTEGRATIONS.length}
            </span>
          </button>
          {(Object.keys(CATEGORY_META) as Exclude<Category,'all'>[]).map(cat => {
            const count  = INTEGRATIONS.filter(i => i.category === cat).length
            const active = category === cat
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all', active ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}
              >
                {CATEGORY_META[cat].label}
                <span className={cn('ml-1.5 text-[10px] px-1.5 py-0.5 rounded-md font-semibold', active ? 'bg-white/20 text-[var(--bg)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-[260px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search integrations…"
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-coral focus:ring-2 focus:ring-coral/20 transition-all"
          />
        </div>
      </div>

      {/* ── Grid ── */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl py-20 text-center">
          <Search size={32} className="text-[var(--fg-tertiary)] mx-auto mb-4" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No integrations found</p>
          <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1">Try a different search or category</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(i => (
            <IntegrationCard
              key={i.id}
              integration={i}
              onConnect={id => setConnectTarget(integrations.find(x => x.id === id) ?? null)}
              onDisconnect={handleDisconnect}
              onConfigure={id => setConnectTarget(integrations.find(x => x.id === id) ?? null)}
            />
          ))}
        </div>
      )}

      {/* ── Build your own callout ── */}
      <div className="flex items-center gap-4 px-5 py-4 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl">
        <div className="w-10 h-10 rounded-xl bg-coral/10 flex items-center justify-center flex-shrink-0">
          <Zap size={18} className="text-coral" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[var(--fg)]">Build a custom integration</p>
          <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">Use our REST API or webhook delivery to connect any internal tool or data pipeline.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a href="#" className="btn-secondary text-[12px]"><ExternalLink size={12} /> API docs</a>
          <a href="#" className="btn-primary text-[12px]"><ChevronRight size={12} /> Webhooks</a>
        </div>
      </div>

      {/* ── Connect modal ── */}
      {connectTarget && (
        <ConnectModal
          integration={connectTarget}
          onClose={() => setConnectTarget(null)}
          onConnect={handleConnect}
        />
      )}

      {/* ── Toast ── */}
      <div className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
        toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none',
      )}>
        <Check size={14} className="text-teal" /> {toast}
      </div>
    </div>
  )
}
