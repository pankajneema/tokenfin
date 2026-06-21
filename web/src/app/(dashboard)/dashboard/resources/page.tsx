'use client'
import { useState } from 'react'
import {
  BookOpen, Code, Terminal, Globe, Zap, CheckCircle2, ArrowRight,
  ExternalLink, Copy, Check, ChevronDown, ChevronUp,
  MessageCircle, Mail, FileText, PlayCircle, Star,
  AlertCircle, Package, Clock, Rocket, Layers, Key,
  Shield, Bell, GitBranch, BarChart3, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════ */
type SdkLang = 'typescript' | 'python' | 'rest'

/* ══════════════════════════════════════════════════════════════
   CHANGELOG DATA
══════════════════════════════════════════════════════════════ */
interface ChangelogEntry {
  version:  string
  date:     string
  tag:      'new' | 'improved' | 'fix' | 'breaking'
  title:    string
  items:    string[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.4.0',
    date:    'Jun 12, 2026',
    tag:     'new',
    title:   'Connected Platforms (MCP) + Integrations',
    items: [
      'New Connected Platforms page — connect any agent, SaaS tool, or CLI and track its LLM usage via ingest API keys',
      'Integrations hub with 24 connectors across Observability, Notifications, Auth, DevTools & Billing',
      'ConnectModal with 3-step flow: info → config → success',
      'Auto-sync error banners when a connected integration reports a failure',
    ],
  },
  {
    version: '1.3.0',
    date:    'Jun 2, 2026',
    tag:     'new',
    title:   'Limits & Alerts v2',
    items: [
      'Edit and duplicate alert rules inline — no page reload',
      '"Add alert rule" from a limit card now opens a pre-filled modal scoped to that limit',
      'Cool-down period selector (1h / 4h / 24h / 72h) on all alert rules',
      'Notification channel multi-select: Email, Slack, Webhook, In-app',
    ],
  },
  {
    version: '1.2.0',
    date:    'May 18, 2026',
    tag:     'improved',
    title:   'UI quality pass — Manage section',
    items: [
      'Fixed status toggle overflow on API Keys page',
      'Active filter badge now uses bg-white/20 pill pattern — no more white blob on dark backgrounds',
      'Menu item text contrast improved across all Manage pages',
    ],
  },
  {
    version: '1.1.0',
    date:    'May 4, 2026',
    tag:     'new',
    title:   'Models page + cost-per-model analytics',
    items: [
      'Dedicated Models page with provider + tier filter tabs',
      'Cost per 1M tokens shown inline for every model variant',
      'Deprecation warnings for models with upcoming end-of-life',
    ],
  },
  {
    version: '1.0.0',
    date:    'Apr 14, 2026',
    tag:     'new',
    title:   'TokenFin public launch',
    items: [
      'Dashboard overview with cost, tokens, and savings widgets',
      'Projects & Teams workspace with role-based access',
      'API Keys management with rotation and revocation',
      'Usage analytics with model, project, and cost breakdowns',
      'Limits with Warn / Throttle / Block thresholds',
      'Alert rules with multi-channel delivery',
    ],
  },
]

/* ══════════════════════════════════════════════════════════════
   GUIDES
══════════════════════════════════════════════════════════════ */
const GUIDES = [
  { icon: Rocket,   title: 'Quick start — first API key',        desc: 'Generate your first ingest key and send a test event in under 5 minutes.',  time: '5 min', href: '#' },
  { icon: Layers,   title: 'Connect Cowork / Claude Code',       desc: 'Instrument Anthropic tools to attribute every LLM call to the right project.', time: '8 min', href: '#' },
  { icon: BarChart3,title: 'Read your cost dashboard',           desc: 'Understand the Overview widgets, drill-down flows, and export options.',      time: '6 min', href: '#' },
  { icon: Shield,   title: 'Set budget limits',                  desc: 'Create Warn / Throttle / Block limits at the project or team level.',         time: '4 min', href: '#' },
  { icon: Bell,     title: 'Configure alert rules',              desc: 'Route Slack + email alerts for spend spikes, anomalies, and limit breaches.',  time: '5 min', href: '#' },
  { icon: GitBranch,title: 'Connect Datadog / Grafana',          desc: 'Push TokenFin metrics to your observability stack via the Integrations hub.',  time: '7 min', href: '#' },
  { icon: Key,      title: 'Rotate & scope API keys',            desc: 'Key rotation best practices, prefix scoping, and revocation workflows.',       time: '3 min', href: '#' },
  { icon: RefreshCw,title: 'Export data to BigQuery',            desc: 'Sync daily usage snapshots to BigQuery for long-term cost analytics.',         time: '10 min', href: '#' },
]

/* ══════════════════════════════════════════════════════════════
   API REFERENCE SECTIONS
══════════════════════════════════════════════════════════════ */
const API_SECTIONS = [
  { method: 'POST', path: '/v1/ingest',           desc: 'Track a single LLM call (model, tokens, cost, metadata)',         tag: 'Ingest' },
  { method: 'POST', path: '/v1/ingest/batch',     desc: 'Track up to 1 000 LLM calls in a single request',                 tag: 'Ingest' },
  { method: 'GET',  path: '/v1/usage',            desc: 'Query aggregated usage by project, model, team, or date range',    tag: 'Analytics' },
  { method: 'GET',  path: '/v1/costs',            desc: 'Cost totals with model-level breakdown',                           tag: 'Analytics' },
  { method: 'GET',  path: '/v1/limits',           desc: 'List all active limits and their current consumption',             tag: 'Limits' },
  { method: 'POST', path: '/v1/limits',           desc: 'Create or update a Warn / Throttle / Block limit',                 tag: 'Limits' },
  { method: 'GET',  path: '/v1/alerts',           desc: 'List alert rules and their last-fired timestamps',                 tag: 'Alerts' },
  { method: 'POST', path: '/v1/export',           desc: 'Trigger an async CSV / JSON export job',                          tag: 'Export' },
]

/* ══════════════════════════════════════════════════════════════
   SDK SNIPPETS
══════════════════════════════════════════════════════════════ */
const SNIPPET: Record<SdkLang, string> = {
  typescript: `import { TokenFin } from '@tokenfin/node'

const tf = new TokenFin({
  apiKey:  process.env.TOKENFIN_API_KEY!,
  project: 'my-project',   // default project
})

// Wrap any LLM call — tokens + cost tracked automatically
const response = await tf.track({
  model:    'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Hello!' }],
  metadata: { session_id: 'abc123', user: 'pankaj@co.com' },
})
console.log(response.choices[0].message.content)`,

  python: `from tokenfin import TokenFin
import os

tf = TokenFin(
    api_key=os.environ["TOKENFIN_API_KEY"],
    project="my-project",
)

# Wrap any LLM call
response = tf.track(
    model="claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Hello!"}],
    metadata={"session_id": "abc123"},
)
print(response["choices"][0]["message"]["content"])`,

  rest: `# Single event
curl -X POST https://api.tokenfin.io/v1/ingest \\
  -H "Authorization: Bearer $TOKENFIN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model":         "claude-sonnet-4-6",
    "project":       "my-project",
    "input_tokens":  1240,
    "output_tokens": 380,
    "cost_usd":      0.0072,
    "metadata":      { "session_id": "abc123" }
  }'

# Batch (up to 1 000 events)
curl -X POST https://api.tokenfin.io/v1/ingest/batch \\
  -H "Authorization: Bearer $TOKENFIN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "events": [ { ... }, { ... } ] }'`,
}

/* ══════════════════════════════════════════════════════════════
   SETUP STEPS
══════════════════════════════════════════════════════════════ */
const SETUP_STEPS = [
  {
    n: 1,
    title: 'Create a project',
    desc:  'Go to Projects → New project. Give it a name and assign a team. All costs will be bucketed here.',
    href:  '/dashboard/projects',
    cta:   'Open Projects',
  },
  {
    n: 2,
    title: 'Connect a platform',
    desc:  'Go to Connected Platforms → Connect platform. Choose your app type and generate an ingest API key.',
    href:  '/dashboard/mcp',
    cta:   'Connected Platforms',
  },
  {
    n: 3,
    title: 'Instrument your code',
    desc:  'Install the SDK (npm / pip) or POST directly to /v1/ingest. Pass your API key and project name.',
    href:  '#sdk',
    cta:   'See SDK',
  },
  {
    n: 4,
    title: 'Set a budget limit',
    desc:  'Go to Limits → New limit. Set Warn at 80%, Throttle at 95%, Block at 100% of your monthly budget.',
    href:  '/dashboard/limits',
    cta:   'Open Limits',
  },
  {
    n: 5,
    title: 'Create an alert rule',
    desc:  "Go to Alerts → New rule. Choose channels (Slack, email) and a cool-down so you're not spammed.",
    href:  '/dashboard/alerts',
    cta:   'Open Alerts',
  },
]

/* ══════════════════════════════════════════════════════════════
   COMPONENTS
══════════════════════════════════════════════════════════════ */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative group">
      <pre className="text-[11.5px] font-mono text-[#C9D1D9] bg-[#0D1117] rounded-xl p-4 overflow-x-auto leading-relaxed border border-[#30363D]">
        {code}
      </pre>
      <button
        onClick={copy}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/10 text-[11px] font-semibold text-white hover:bg-white/20"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function TagPill({ tag }: { tag: ChangelogEntry['tag'] }) {
  const map = {
    new:      { label: 'New',      class: 'bg-[var(--green-bg)] text-teal'            },
    improved: { label: 'Improved', class: 'bg-[var(--blue-bg)] text-[var(--blue)]'   },
    fix:      { label: 'Fix',      class: 'bg-[var(--amber-bg)] text-[var(--amber)]' },
    breaking: { label: 'Breaking', class: 'bg-[var(--red-bg)] text-[var(--red)]'     },
  }
  const m = map[tag]
  return (
    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide', m.class)}>
      {m.label}
    </span>
  )
}

function ChangelogCard({ entry }: { entry: ChangelogEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[var(--border)] rounded-2xl bg-white dark:bg-[#141428] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[var(--bg-hover)] transition-colors"
      >
        <div className="flex-1 flex items-center gap-3 flex-wrap min-w-0">
          <span className="text-[11px] font-mono font-bold text-[var(--fg-tertiary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-md border border-[var(--border)]">
            v{entry.version}
          </span>
          <TagPill tag={entry.tag} />
          <span className="text-[13px] font-semibold text-[var(--fg)]">{entry.title}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[11px] text-[var(--fg-tertiary)] hidden sm:block">{entry.date}</span>
          {open ? <ChevronUp size={14} className="text-[var(--fg-tertiary)]" /> : <ChevronDown size={14} className="text-[var(--fg-tertiary)]" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-5 py-4 bg-[var(--bg-secondary)]/40 space-y-2">
          {entry.items.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <CheckCircle2 size={13} className="text-teal mt-0.5 flex-shrink-0" />
              <p className="text-[12.5px] text-[var(--fg-secondary)] leading-relaxed">{item}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   PAGE
══════════════════════════════════════════════════════════════ */
export default function ResourcesPage() {
  const [activeTab, setActiveTab] = useState<'start'|'sdk'|'api'|'changelog'|'support'>('start')
  const [sdkLang,   setSdkLang]   = useState<SdkLang>('typescript')

  const tabs: { id: typeof activeTab; label: string; icon: React.ElementType }[] = [
    { id: 'start',     label: 'Get started', icon: Rocket    },
    { id: 'sdk',       label: 'SDK',         icon: Package   },
    { id: 'api',       label: 'API reference',icon: Code     },
    { id: 'changelog', label: 'Changelog',   icon: Clock     },
    { id: 'support',   label: 'Support',     icon: MessageCircle },
  ]

  return (
    <div className="space-y-6 max-w-[900px]">

      {/* ── Header ── */}
      <div>
        <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Resources</h1>
        <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
          Guides, SDK docs, API reference, and changelog — everything to get the most out of TokenFin
        </p>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl w-fit">
        {tabs.map(t => {
          const Icon = t.icon
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12.5px] font-semibold transition-all',
                active
                  ? 'bg-[var(--fg)] text-[var(--bg)] shadow-sm'
                  : 'text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <Icon size={13} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ═══════════════════════════════════════════════════ GET STARTED */}
      {activeTab === 'start' && (
        <div className="space-y-6">

          {/* Steps */}
          <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <p className="text-[13.5px] font-bold text-[var(--fg)]">5-step setup</p>
              <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">From zero to full cost attribution in ~20 minutes</p>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {SETUP_STEPS.map(s => (
                <div key={s.n} className="flex items-start gap-4 px-5 py-4 hover:bg-[var(--bg-hover)] transition-colors">
                  <div className="w-7 h-7 rounded-full bg-coral/15 border border-coral/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-[12px] font-bold text-coral">{s.n}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[var(--fg)]">{s.title}</p>
                    <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5 leading-relaxed">{s.desc}</p>
                  </div>
                  <a
                    href={s.href}
                    className="flex items-center gap-1.5 text-[12px] font-semibold text-coral hover:opacity-80 flex-shrink-0 mt-0.5"
                  >
                    {s.cta} <ArrowRight size={12} />
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* Guides grid */}
          <div>
            <p className="text-[13px] font-bold text-[var(--fg)] mb-3">How-to guides</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {GUIDES.map(g => {
                const Icon = g.icon
                return (
                  <a
                    key={g.title}
                    href={g.href}
                    className="flex items-start gap-3 p-4 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl hover:border-coral/40 hover:bg-coral/5 transition-all group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0 group-hover:bg-coral/10 transition-colors">
                      <Icon size={16} className="text-[var(--fg-tertiary)] group-hover:text-coral transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-semibold text-[var(--fg)] group-hover:text-coral transition-colors leading-snug">{g.title}</p>
                      <p className="text-[11px] text-[var(--fg-tertiary)] mt-1 leading-relaxed">{g.desc}</p>
                      <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-1.5 flex items-center gap-1">
                        <Clock size={10} /> {g.time} read
                      </p>
                    </div>
                    <ExternalLink size={12} className="text-[var(--fg-tertiary)] group-hover:text-coral mt-0.5 flex-shrink-0 transition-colors" />
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ SDK */}
      {activeTab === 'sdk' && (
        <div className="space-y-5" id="sdk">

          {/* Install cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { lang: 'TypeScript / Node', cmd: 'npm install @tokenfin/node', icon: Package,  color: 'text-[var(--blue)]',  bg: 'bg-[var(--blue-bg)]'  },
              { lang: 'Python',            cmd: 'pip install tokenfin',        icon: Terminal, color: 'text-teal',            bg: 'bg-[var(--green-bg)]' },
              { lang: 'REST',              cmd: 'No install — just curl',       icon: Globe,   color: 'text-coral',           bg: 'bg-coral/10'          },
            ].map(s => {
              const Icon = s.icon
              return (
                <div key={s.lang} className="p-4 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl space-y-2.5">
                  <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', s.bg)}>
                    <Icon size={16} className={s.color} />
                  </div>
                  <p className="text-[12.5px] font-semibold text-[var(--fg)]">{s.lang}</p>
                  <code className="block text-[11px] font-mono text-[var(--fg-secondary)] bg-[var(--bg-secondary)] px-2.5 py-1.5 rounded-lg border border-[var(--border)]">
                    {s.cmd}
                  </code>
                </div>
              )
            })}
          </div>

          {/* Lang switcher + snippet */}
          <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
              <p className="text-[13px] font-semibold text-[var(--fg)]">Track your first LLM call</p>
              <div className="flex gap-1 p-0.5 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)]">
                {(['typescript', 'python', 'rest'] as SdkLang[]).map(l => (
                  <button
                    key={l}
                    onClick={() => setSdkLang(l)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all',
                      sdkLang === l ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]',
                    )}
                  >
                    {l === 'typescript' ? 'TypeScript' : l === 'python' ? 'Python' : 'REST'}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4">
              <CodeBlock code={SNIPPET[sdkLang]} />
            </div>
          </div>

          {/* SDK features */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { icon: Zap,         title: 'Auto token counting', desc: 'SDK reads response headers to pull exact input/output token counts — no manual calculation.' },
              { icon: Layers,      title: 'Multi-model support', desc: 'Anthropic, OpenAI, Google Gemini, Mistral, Cohere — one unified ingest format.' },
              { icon: RefreshCw,   title: 'Batch flushing',      desc: 'SDK buffers events in-process and flushes every 5 seconds to avoid per-call HTTP overhead.' },
              { icon: Shield,      title: 'Async / non-blocking',desc: 'Ingest never blocks your LLM call. Fire-and-forget with automatic retry on failure.' },
            ].map(f => {
              const Icon = f.icon
              return (
                <div key={f.title} className="flex items-start gap-3 p-4 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-coral/10 flex items-center justify-center flex-shrink-0">
                    <Icon size={14} className="text-coral" />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-semibold text-[var(--fg)]">{f.title}</p>
                    <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5 leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ API REFERENCE */}
      {activeTab === 'api' && (
        <div className="space-y-4">

          <div className="flex items-center gap-3 px-4 py-3 bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-xl">
            <AlertCircle size={13} className="text-[var(--blue)] flex-shrink-0" />
            <p className="text-[12px] text-[var(--blue)]">
              Base URL: <code className="font-mono font-semibold">https://api.tokenfin.io</code> — all requests need{' '}
              <code className="font-mono font-semibold">Authorization: Bearer &lt;API_KEY&gt;</code>
            </p>
          </div>

          <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden divide-y divide-[var(--border)]">
            {API_SECTIONS.map((ep, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--bg-hover)] transition-colors group">
                <span className={cn(
                  'text-[10.5px] font-bold px-2 py-0.5 rounded-md font-mono flex-shrink-0 w-12 text-center',
                  ep.method === 'GET'  ? 'bg-[var(--green-bg)] text-teal'       :
                  ep.method === 'POST' ? 'bg-[var(--blue-bg)] text-[var(--blue)]' :
                  'bg-[var(--red-bg)] text-[var(--red)]',
                )}>
                  {ep.method}
                </span>
                <code className="text-[12.5px] font-mono font-semibold text-[var(--fg)] flex-shrink-0">{ep.path}</code>
                <p className="text-[12px] text-[var(--fg-secondary)] flex-1">{ep.desc}</p>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[var(--bg-secondary)] text-[var(--fg-tertiary)] border border-[var(--border)] flex-shrink-0">
                  {ep.tag}
                </span>
                <ExternalLink size={12} className="text-[var(--fg-tertiary)] group-hover:text-coral transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0" />
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <a href="#" className="flex items-center gap-2 px-4 py-2.5 border border-[var(--border)] rounded-xl text-[12.5px] font-semibold text-[var(--fg)] hover:border-coral/40 hover:text-coral transition-all">
              <FileText size={13} /> Full API docs
            </a>
            <a href="#" className="flex items-center gap-2 px-4 py-2.5 border border-[var(--border)] rounded-xl text-[12.5px] font-semibold text-[var(--fg)] hover:border-coral/40 hover:text-coral transition-all">
              <PlayCircle size={13} /> Postman collection
            </a>
            <a href="#" className="flex items-center gap-2 px-4 py-2.5 border border-[var(--border)] rounded-xl text-[12.5px] font-semibold text-[var(--fg)] hover:border-coral/40 hover:text-coral transition-all">
              <Code size={13} /> OpenAPI spec (JSON)
            </a>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ CHANGELOG */}
      {activeTab === 'changelog' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-[var(--fg-secondary)]">
              {CHANGELOG.length} releases — click any entry to expand
            </p>
            <a href="#" className="flex items-center gap-1.5 text-[12px] font-semibold text-coral hover:opacity-80">
              <Star size={12} /> Subscribe to updates
            </a>
          </div>
          {CHANGELOG.map(e => <ChangelogCard key={e.version} entry={e} />)}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ SUPPORT */}
      {activeTab === 'support' && (
        <div className="space-y-5">

          {/* Status */}
          <div className="flex items-center gap-3 px-5 py-4 bg-[var(--green-bg)] border border-teal/20 rounded-2xl">
            <span className="w-2 h-2 rounded-full bg-teal animate-pulse flex-shrink-0" />
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-teal">All systems operational</p>
              <p className="text-[11.5px] text-teal/70 mt-0.5">Ingest API, Dashboard, Webhooks — Last checked 2 min ago</p>
            </div>
            <a href="#" className="text-[12px] font-semibold text-teal hover:opacity-80 flex items-center gap-1">
              Status page <ExternalLink size={11} />
            </a>
          </div>

          {/* Channels */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                icon: Mail, title: 'Email support', desc: 'hello@tokenfin.io — we reply within 24 hours on business days.',
                cta: 'Send email', href: 'mailto:hello@tokenfin.io', color: 'text-coral', bg: 'bg-coral/10',
              },
              {
                icon: MessageCircle, title: 'Community Slack', desc: 'Ask questions, share configs, get help from the TokenFin community.',
                cta: 'Join Slack', href: '#', color: 'text-[var(--blue)]', bg: 'bg-[var(--blue-bg)]',
              },
              {
                icon: BookOpen, title: 'Docs site', desc: 'Full reference docs, cookbooks, and integration guides.',
                cta: 'Open docs', href: '#', color: 'text-teal', bg: 'bg-[var(--green-bg)]',
              },
            ].map(c => {
              const Icon = c.icon
              return (
                <div key={c.title} className="flex flex-col bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 gap-3">
                  <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center', c.bg)}>
                    <Icon size={18} className={c.color} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[13px] font-bold text-[var(--fg)]">{c.title}</p>
                    <p className="text-[11.5px] text-[var(--fg-secondary)] mt-1 leading-relaxed">{c.desc}</p>
                  </div>
                  <a href={c.href} className={cn('flex items-center gap-1.5 text-[12.5px] font-semibold', c.color, 'hover:opacity-80')}>
                    {c.cta} <ArrowRight size={12} />
                  </a>
                </div>
              )
            })}
          </div>

          {/* FAQ */}
          <div>
            <p className="text-[13px] font-bold text-[var(--fg)] mb-3">Frequently asked questions</p>
            <div className="space-y-2">
              {[
                { q: 'What counts as a "token" in TokenFin?', a: 'TokenFin uses the token counts reported by your LLM provider — input_tokens and output_tokens from the response object. If your provider doesn\'t report them, you can pass them manually in the ingest payload.' },
                { q: 'How accurate is the cost calculation?', a: 'Costs are calculated using the pricing table for each model+provider (configurable in Models → Manage pricing). Since provider prices change, we recommend updating prices whenever a provider announces a change.' },
                { q: 'Can I use TokenFin across multiple orgs?', a: 'Yes. Each workspace is org-scoped. You can create multiple projects and teams inside one workspace, or create separate workspaces for separate business units.' },
                { q: 'Does TokenFin store my prompts or completions?', a: 'No. TokenFin only stores metadata: model, tokens, cost, timestamp, project, and any custom metadata fields you pass. Prompt and completion content never leaves your infrastructure.' },
                { q: 'What happens when a limit is hit (Block)?', a: 'If your SDK wraps the LLM call, the SDK returns a 429-like error before making the request. If you\'re using the raw ingest API, Block limits send a webhook; enforcement is up to your application logic.' },
              ].map((f, i) => (
                <FaqItem key={i} q={f.q} a={f.a} />
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[var(--border)] rounded-xl bg-white dark:bg-[#141428] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
      >
        <p className="text-[12.5px] font-semibold text-[var(--fg)]">{q}</p>
        {open ? <ChevronUp size={13} className="text-[var(--fg-tertiary)] flex-shrink-0" /> : <ChevronDown size={13} className="text-[var(--fg-tertiary)] flex-shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-4 py-3.5 bg-[var(--bg-secondary)]/40">
          <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  )
}
