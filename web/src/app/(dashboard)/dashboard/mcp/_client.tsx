'use client'
import { useState, useMemo } from 'react'
import {
  Plus, Search, X, Check, AlertTriangle, ChevronDown, ChevronUp,
  Copy, Eye, EyeOff, RefreshCw, MoreHorizontal, Trash2,
  Activity, Zap, Clock, Code, ExternalLink, Key,
  Shield, Puzzle, Terminal, Globe, Monitor, Code2, SquareTerminal,
  ArrowRight, Plug,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PlatformRow } from './_types'

/* ── Types ── */
type PlatformType = 'saas' | 'agent' | 'cli' | 'api' | 'custom'
type SdkLang      = 'typescript' | 'python' | 'rest'

const TYPE_META: Record<PlatformType, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  saas:   { label: 'SaaS product',     icon: Globe,    color: 'text-[var(--blue)]', bg: 'bg-[var(--blue-bg)]'  },
  agent:  { label: 'AI agent',          icon: Zap,      color: 'text-[#8B5CF6]',    bg: 'bg-[#8B5CF6]/10'      },
  cli:    { label: 'CLI tool',           icon: Terminal, color: 'text-teal',          bg: 'bg-[var(--green-bg)]' },
  api:    { label: 'REST API / service', icon: Code,     color: 'text-coral',         bg: 'bg-coral/10'          },
  custom: { label: 'Custom',             icon: Puzzle,   color: 'text-[var(--amber)]',bg: 'bg-[var(--amber-bg)]' },
}

const PROVIDER_DOT: Record<string, string> = {
  Anthropic: '#D97757', OpenAI: '#10A37F', Google: '#4285F4',
}

/* ── Quick connect tool metadata ── */
const QUICK_TOOLS = [
  {
    id:       'codex',
    name:     'Codex',
    hint:     'Proxy · Auto-tracked',
    Icon:     SquareTerminal,
    color:    'text-teal',
    bg:       'bg-[var(--green-bg)]',
    preFill:  { name: 'Codex', type: 'cli' as PlatformType },
  },
  {
    id:       'cursor',
    name:     'Cursor',
    hint:     'Proxy · Auto-tracked',
    Icon:     Code2,
    color:    'text-[var(--blue)]',
    bg:       'bg-[var(--blue-bg)]',
    preFill:  { name: 'Cursor', type: 'agent' as PlatformType },
  },
  {
    id:       'cowork',
    name:     'Cowork',
    hint:     'MCP server',
    Icon:     Monitor,
    color:    'text-[#8B5CF6]',
    bg:       'bg-[#8B5CF6]/10',
    preFill:  { name: 'Cowork', type: 'agent' as PlatformType },
  },
  {
    id:       'claude-cli',
    name:     'Claude CLI',
    hint:     'Proxy · Env var',
    Icon:     SquareTerminal,
    color:    'text-coral',
    bg:       'bg-coral/10',
    preFill:  { name: 'Claude CLI', type: 'cli' as PlatformType },
  },
  {
    id:       'opencode',
    name:     'OpenCode',
    hint:     'Proxy · Auto-tracked',
    Icon:     Code,
    color:    'text-[var(--amber)]',
    bg:       'bg-[var(--amber-bg)]',
    preFill:  { name: 'OpenCode', type: 'cli' as PlatformType },
  },
]

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return `${n}`
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const m    = Math.floor(diff / 60_000)
  if (m < 1)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/* ── SDK Snippets ── */
const SDK_SNIPPETS: Record<SdkLang, (key: string) => string> = {
  typescript: (key) => `import { TokenFin } from '@tokenfin/node'

const tf = new TokenFin({ apiKey: '${key}' })

const response = await tf.track({
  model:    'claude-sonnet-4-6',
  project:  'my-project',
  messages: [{ role: 'user', content: 'Hello!' }],
})`,
  python: (key) => `from tokenfin import TokenFin

tf = TokenFin(api_key="${key}")

response = tf.track(
    model="claude-sonnet-4-6",
    project="my-project",
    messages=[{"role": "user", "content": "Hello!"}],
)`,
  rest: (key) => `POST https://api.tokenfin.io/v1/ingest
Authorization: Bearer ${key}
Content-Type: application/json

{
  "model":         "claude-sonnet-4-6",
  "project":       "my-project",
  "input_tokens":  1240,
  "output_tokens": 380,
  "cost_usd":      0.0072,
  "metadata":      { "session_id": "abc123" }
}`,
}

/* ══════════════════════════════════════════════════════════════
   ADD PLATFORM MODAL  (creates an API key via /api/v1/keys)
══════════════════════════════════════════════════════════════ */
function AddPlatformModal({ orgId, onClose, onAdd }: {
  orgId:   string
  onClose: () => void
  onAdd:   (p: PlatformRow) => void
}) {
  const [name,     setName]     = useState('')
  const [desc,     setDesc]     = useState('')
  const [type,     setType]     = useState<PlatformType>('custom')
  const [env,      setEnv]      = useState<'production' | 'staging' | 'development'>('production')
  const [sdkLang,  setSdkLang]  = useState<SdkLang>('typescript')
  const [step,     setStep]     = useState<'config' | 'key'>('config')
  const [rawKey,   setRawKey]   = useState('')
  const [keyPrefix,setKeyPrefix]= useState('')
  const [keyId,    setKeyId]    = useState('')
  const [copied,   setCopied]   = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  function copyKey() {
    navigator.clipboard.writeText(rawKey)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  async function handleCreate() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: orgId,
          name:   name || 'Unnamed platform',
          env,
          scopes: ['read', 'write'],
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setRawKey(data.raw_key ?? '')
      setKeyPrefix(data.key_prefix ?? '')
      setKeyId(data.id ?? '')

      const newPlatform: PlatformRow = {
        id:          data.id,
        name:        name || 'Unnamed platform',
        keyPrefix:   data.key_prefix ?? '',
        env,
        scopes:      ['read', 'write'],
        isActive:    true,
        lastUsedAt:  null,
        createdAt:   new Date().toISOString(),
        projectId:   data.project_id ?? '',
        projectName: 'Default',
        tokens30d:   0,
        cost30d:     0,
        calls30d:    0,
        models:      [],
      }
      onAdd(newPlatform)
      setStep('key')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  const valid = name.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-[540px] bg-white dark:bg-[#141428] rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">
              {step === 'config' ? 'Connect a platform' : 'Your API key is ready'}
            </h2>
            <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5">
              {step === 'config'
                ? 'Generate an ingest key for any platform sending LLM usage to TokenFin'
                : "Copy this key — it won't be shown again"}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)]">
            <X size={15} />
          </button>
        </div>

        {step === 'config' ? (
          <>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Platform name</label>
                <input value={name} onChange={e => setName(e.target.value)} autoFocus
                  placeholder="e.g. My Chatbot, CI Bot, Cowork"
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
                  Description <span className="text-[var(--fg-tertiary)] normal-case font-normal">(optional)</span>
                </label>
                <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What does this platform do?"
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
              </div>

              {/* Type */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Platform type</label>
                <div className="grid grid-cols-5 gap-2">
                  {(Object.keys(TYPE_META) as PlatformType[]).map(t => {
                    const tm   = TYPE_META[t]
                    const Icon = tm.icon
                    return (
                      <button key={t} onClick={() => setType(t)}
                        className={cn('flex flex-col items-center gap-1.5 py-3 rounded-xl border text-center transition-all',
                          type === t ? `${tm.bg} ${tm.color} border-current/30` : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]')}>
                        <Icon size={15} />
                        <span className="text-[10px] font-semibold leading-tight">
                          {t === 'saas' ? 'SaaS' : t === 'cli' ? 'CLI' : t === 'api' ? 'API' : t === 'agent' ? 'Agent' : 'Custom'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Env */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Environment</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['production', 'staging', 'development'] as const).map(e => (
                    <button key={e} onClick={() => setEnv(e)}
                      className={cn('py-2 rounded-xl border text-[12px] font-semibold transition-all',
                        env === e ? 'border-coral bg-coral/10 text-coral' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]')}>
                      {e.charAt(0).toUpperCase() + e.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] px-3 py-2 rounded-xl border border-[var(--red)]/20">
                  {error}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
              <button onClick={onClose} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate} disabled={!valid || saving}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
                {saving
                  ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Creating…</>
                  : <><Key size={13} /> Generate API key</>
                }
              </button>
            </div>
          </>
        ) : (
          /* Step 2: show key + SDK snippet */
          <div className="px-6 py-5 space-y-5">
            <div className="p-4 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">Ingest API key</p>
                <button onClick={copyKey}
                  className={cn('flex items-center gap-1.5 text-[12px] font-semibold transition-colors',
                    copied ? 'text-teal' : 'text-[var(--fg-secondary)] hover:text-coral')}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <code className="block text-[13px] font-mono text-[var(--fg)] bg-white dark:bg-[#1E1E35] px-3 py-2.5 rounded-lg border border-[var(--border)]">
                {rawKey || `${keyPrefix}••••••••`}
              </code>
              <div className="flex items-center gap-2 text-[11px] text-[var(--amber)]">
                <AlertTriangle size={11} className="flex-shrink-0" /> Store this key securely — it won&apos;t be shown again.
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">Quick start</p>
                <div className="flex gap-1 p-0.5 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)]">
                  {(['typescript', 'python', 'rest'] as SdkLang[]).map(l => (
                    <button key={l} onClick={() => setSdkLang(l)}
                      className={cn('px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all',
                        sdkLang === l ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                      {l === 'typescript' ? 'TypeScript' : l === 'python' ? 'Python' : 'REST'}
                    </button>
                  ))}
                </div>
              </div>
              <pre className="text-[11.5px] font-mono bg-[#0F0F1A] text-[#C9D1D9] rounded-xl p-4 overflow-x-auto leading-relaxed border border-[var(--border)]">
                {SDK_SNIPPETS[sdkLang](rawKey || keyPrefix + '••••')}
              </pre>
            </div>

            <div className="flex items-center gap-2">
              <a href="#" className="btn-secondary text-[12px] flex-1 justify-center"><ExternalLink size={12} /> Full SDK docs</a>
              <button onClick={onClose} className="btn-primary flex-1">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   PLATFORM CARD
══════════════════════════════════════════════════════════════ */
function PlatformCard({ platform, onRevoke, onDelete }: {
  platform: PlatformRow
  onRevoke: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [expanded,   setExpanded]   = useState(false)
  const [menu,       setMenu]       = useState(false)
  const [keyVisible, setKeyVisible] = useState(false)
  const [keyCopied,  setKeyCopied]  = useState(false)

  const isError   = !platform.isActive && platform.lastUsedAt
  const isRevoked = !platform.isActive

  const totalTokens = platform.models.reduce((s, m) => s + m.tokens30d, 0)

  function copyKey() {
    navigator.clipboard.writeText(platform.keyPrefix + '••••••••')
    setKeyCopied(true); setTimeout(() => setKeyCopied(false), 2000)
  }

  const envColor: Record<string, string> = {
    production:  'text-coral bg-coral/10',
    staging:     'text-[var(--amber)] bg-[var(--amber-bg)]',
    development: 'text-[var(--blue)] bg-[var(--blue-bg)]',
  }

  return (
    <div className={cn('bg-white dark:bg-[#141428] border rounded-2xl overflow-hidden transition-all',
      isError   ? 'border-[var(--red)]/40' :
      isRevoked ? 'border-dashed border-[var(--border)] opacity-60' :
      'border-[var(--border)]')}>

      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 bg-coral/10">
              <Puzzle size={18} className="text-coral" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[13.5px] font-bold text-[var(--fg)]">{platform.name}</p>
                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-md', envColor[platform.env] ?? 'text-[var(--fg-tertiary)] bg-[var(--bg-secondary)]')}>
                  {platform.env}
                </span>
              </div>
              <p className="text-[11px] text-[var(--fg-tertiary)] mt-0.5">{platform.projectName} · Added {timeAgo(platform.createdAt)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {platform.isActive ? (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--green-bg)] text-teal text-[10.5px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-teal" /> Active
              </div>
            ) : (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)] text-[10.5px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--border-strong)]" /> Revoked
              </div>
            )}

            <div className="relative">
              <button onClick={() => setMenu(v => !v)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
                <MoreHorizontal size={14} />
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-[9]" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 top-8 w-44 bg-white dark:bg-[#1E1E35] border border-[var(--border)] rounded-xl shadow-2xl z-10 p-1">
                    {([
                      { icon: RefreshCw, label: 'Rotate key',  danger: false, fn: () => setMenu(false)                              },
                      { icon: Shield,    label: 'Revoke key',  danger: false, fn: () => { onRevoke(platform.id); setMenu(false) }   },
                      { icon: Trash2,    label: 'Delete',       danger: true,  fn: () => { onDelete(platform.id); setMenu(false) }  },
                    ] as { icon: React.ElementType; label: string; danger: boolean; fn: () => void }[]).map((item, i) => (
                      <button key={i} onClick={item.fn}
                        className={cn('w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] font-medium text-left transition-colors',
                          item.danger ? 'text-[var(--red)] hover:bg-[var(--red-bg)]' : 'text-[var(--fg)] hover:bg-[var(--bg-hover)]')}>
                        <item.icon size={13} className="flex-shrink-0" /> {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Cost 30d',   value: `$${platform.cost30d.toFixed(2)}`,   color: 'text-coral'          },
            { label: 'Tokens 30d', value: fmtTokens(platform.tokens30d),        color: 'text-[var(--blue)]'  },
            { label: 'API calls',  value: fmtTokens(platform.calls30d),         color: 'text-[var(--fg)]'    },
          ].map(s => (
            <div key={s.label} className="bg-[var(--bg-secondary)] rounded-xl px-3 py-2.5 border border-[var(--border)]">
              <p className={cn('text-[15px] font-bold tabular-nums', s.color)}>{s.value}</p>
              <p className="text-[10px] text-[var(--fg-tertiary)] mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* API key */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
          <Key size={12} className="text-[var(--fg-tertiary)] flex-shrink-0" />
          <code className="flex-1 text-[11.5px] font-mono text-[var(--fg-secondary)] truncate">
            {keyVisible ? `${platform.keyPrefix}••••••••••••••••` : `${platform.keyPrefix.slice(0, 10)}••••`}
          </code>
          <button onClick={() => setKeyVisible(v => !v)} className="text-[var(--fg-tertiary)] hover:text-[var(--fg)] transition-colors">
            {keyVisible ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button onClick={copyKey} className="text-[var(--fg-tertiary)] hover:text-coral transition-colors">
            {keyCopied ? <Check size={12} className="text-teal" /> : <Copy size={12} />}
          </button>
        </div>

        {/* Last seen + scopes */}
        <div className="flex items-center justify-between text-[11px] text-[var(--fg-tertiary)]">
          <div className="flex items-center gap-1.5">
            <Clock size={11} />
            {platform.lastUsedAt ? `Last seen ${timeAgo(platform.lastUsedAt)}` : 'Never seen — key not yet used'}
          </div>
          <div className="flex gap-1">
            {platform.scopes.map(s => (
              <span key={s} className="px-1.5 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[10px] font-medium">{s}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Model breakdown */}
      {platform.models.length > 0 && (
        <>
          <button onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-between px-5 py-2.5 border-t border-[var(--border)] text-[11.5px] font-semibold text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
            <span>Model breakdown · {platform.models.length} model{platform.models.length > 1 ? 's' : ''}</span>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {expanded && (
            <div className="border-t border-[var(--border)] p-4 space-y-2.5 bg-[var(--bg-secondary)]/40">
              {platform.models.map(m => {
                const pct = totalTokens > 0 ? (m.tokens30d / totalTokens) * 100 : 0
                const dot = Object.entries(PROVIDER_DOT).find(([k]) => m.model.toLowerCase().includes(k.toLowerCase()))?.[1] ?? '#888'
                return (
                  <div key={m.model} className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11.5px] font-semibold text-[var(--fg)] truncate">{m.model}</span>
                        <span className="text-[11px] font-semibold text-[var(--fg)] tabular-nums ml-2">${m.cost30d.toFixed(2)}</span>
                      </div>
                      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: dot }} />
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10.5px] text-[var(--fg-tertiary)]">{fmtTokens(m.tokens30d)} tok</p>
                      <p className="text-[10px] text-[var(--fg-tertiary)]">{fmtTokens(m.calls30d)} calls</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Error notice */}
      {isError && (
        <div className="flex items-center gap-2.5 px-5 py-3 border-t border-[var(--red)]/30 bg-[var(--red-bg)]">
          <AlertTriangle size={12} className="text-[var(--red)] flex-shrink-0" />
          <p className="text-[11.5px] text-[var(--red)]">Ingest requests failing — check API key validity and network access.</p>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN CLIENT
══════════════════════════════════════════════════════════════ */
interface Props {
  initialPlatforms: PlatformRow[]
  orgId:            string
}

export function McpClient({ initialPlatforms, orgId }: Props) {
  const [platforms, setPlatforms] = useState<PlatformRow[]>(initialPlatforms)
  const [showModal, setShowModal] = useState(false)
  const [search,    setSearch]    = useState('')
  const [envFil,    setEnvFil]    = useState<string>('all')
  const [toast,     setToast]     = useState('')

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(''), 2500)
  }

  function handleAdd(p: PlatformRow) {
    setPlatforms(prev => [p, ...prev])
    showToast(`${p.name} connected`)
  }

  async function handleRevoke(id: string) {
    await fetch(`/api/v1/keys/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    })
    const name = platforms.find(p => p.id === id)?.name
    setPlatforms(prev => prev.map(p => p.id === id ? { ...p, isActive: false } : p))
    showToast(`API key for ${name} revoked`)
  }

  async function handleDelete(id: string) {
    await fetch(`/api/v1/keys?id=${id}`, { method: 'DELETE' })
    const name = platforms.find(p => p.id === id)?.name
    setPlatforms(prev => prev.filter(p => p.id !== id))
    showToast(`${name} removed`)
  }

  const filtered = useMemo(() => platforms.filter(p => {
    if (envFil !== 'all' && p.env !== envFil) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [platforms, envFil, search])

  const totalCost   = platforms.reduce((s, p) => s + p.cost30d, 0)
  const totalTokens = platforms.reduce((s, p) => s + p.tokens30d, 0)
  const activeCount = platforms.filter(p => p.isActive).length

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Connected Platforms</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
            Every product or agent sending LLM usage to TokenFin — API keys, cost attribution, model breakdown
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex-shrink-0">
          <Plus size={14} /> Connect platform
        </button>
      </div>

      {/* How it works */}
      <div className="flex items-start gap-4 px-5 py-4 bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-2xl">
        <div className="w-9 h-9 rounded-xl bg-[var(--blue)]/15 flex items-center justify-center flex-shrink-0">
          <Zap size={16} className="text-[var(--blue)]" />
        </div>
        <div>
          <p className="text-[13px] font-semibold text-[var(--blue)]">How platform tracking works</p>
          <p className="text-[12px] text-[var(--blue)]/80 mt-0.5 leading-relaxed">
            Each platform gets a unique ingest API key. Instrument your app with the TokenFin SDK (Node, Python) or POST directly to{' '}
            <code className="font-mono font-semibold text-[var(--blue)]">api.tokenfin.io/v1/ingest</code>.
            TokenFin attributes every LLM call to the right platform, project, and model.
          </p>
        </div>
        <a href="#" className="btn-secondary text-[12px] flex-shrink-0 mt-0.5">
          <ExternalLink size={12} /> SDK docs
        </a>
      </div>

      {/* Quick connect tool cards */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-[13.5px] font-bold text-[var(--fg)]">Popular integrations</p>
            <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-0.5">Click a tool to connect it and get your API key — full guides in Resources</p>
          </div>
          <a href="/dashboard/resources" className="flex items-center gap-1.5 text-[12px] font-semibold text-coral hover:opacity-80">
            Full setup guides <ArrowRight size={12} />
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {QUICK_TOOLS.map(tool => {
            const Icon = tool.Icon
            return (
              <button
                key={tool.id}
                onClick={() => setShowModal(true)}
                className="group flex flex-col items-center gap-2.5 p-3.5 rounded-2xl border border-[var(--border)] hover:border-coral/40 hover:bg-coral/5 transition-all text-center"
              >
                <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center transition-all group-hover:scale-105', tool.bg)}>
                  <Icon size={18} className={tool.color} />
                </div>
                <div>
                  <p className="text-[12px] font-bold text-[var(--fg)] group-hover:text-coral transition-colors leading-snug">{tool.name}</p>
                  <p className="text-[10px] text-[var(--fg-tertiary)] mt-0.5 leading-tight">{tool.hint}</p>
                </div>
                <span className="text-[10px] font-semibold text-coral opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  <Plug size={9} /> Connect
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Connected platforms', value: platforms.length.toString(), color: 'text-[var(--blue)]', icon: Puzzle   },
          { label: 'Active',               value: activeCount.toString(),     color: 'text-teal',          icon: Activity  },
          { label: 'Total cost 30d',       value: `$${totalCost.toFixed(2)}`, color: 'text-coral',         icon: Zap       },
          { label: 'Total tokens 30d',     value: fmtTokens(totalTokens),     color: 'text-[var(--amber)]',icon: Clock     },
        ].map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0">
                <Icon size={16} className={s.color} />
              </div>
              <div>
                <p className={cn('text-[18px] font-bold leading-none tabular-nums', s.color)}>{s.value}</p>
                <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{s.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Empty state */}
      {platforms.length === 0 ? (
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl py-20 text-center">
          <Puzzle size={32} className="text-[var(--fg-tertiary)] mx-auto mb-4" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No platforms connected yet</p>
          <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1">Connect any app, agent, or API to start tracking LLM costs</p>
          <button onClick={() => setShowModal(true)} className="btn-primary mt-5">
            <Plus size={13} /> Connect platform
          </button>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl p-1">
              {(['all', 'production', 'staging', 'development'] as const).map(e => (
                <button key={e} onClick={() => setEnvFil(e)}
                  className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                    envFil === e ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                  {e === 'all' ? 'All' : e.charAt(0).toUpperCase() + e.slice(1)}
                  <span className={cn('ml-1.5 text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                    envFil === e ? 'bg-white/20 text-[var(--bg)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
                    {e === 'all' ? platforms.length : platforms.filter(p => p.env === e).length}
                  </span>
                </button>
              ))}
            </div>
            <div className="relative flex-1 max-w-[260px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search platforms…"
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-coral focus:ring-2 focus:ring-coral/20 transition-all" />
            </div>
          </div>

          {/* Grid */}
          {filtered.length === 0 ? (
            <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl py-12 text-center">
              <p className="text-[13px] text-[var(--fg-secondary)]">No platforms match your filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filtered.map(p => (
                <PlatformCard key={p.id} platform={p} onRevoke={handleRevoke} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Custom app / REST ingest tip */}
      <div className="flex items-center gap-4 px-5 py-4 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl">
        <div className="w-10 h-10 rounded-xl bg-coral/10 flex items-center justify-center flex-shrink-0">
          <Globe size={18} className="text-coral" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[var(--fg)]">Building a custom app?</p>
          <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">
            Send a <code className="font-mono bg-[var(--bg-secondary)] px-1 rounded text-[11px]">POST https://tokenfin.curiousdevs.com/api/v1/ingest</code> with your API key after each LLM call — works in any language, no package to install.
          </p>
        </div>
        <a href="/dashboard/resources?tab=api" className="flex items-center gap-1.5 text-[12px] font-semibold text-coral hover:opacity-80 transition-opacity flex-shrink-0">
          API reference <ArrowRight size={12} />
        </a>
      </div>

      {showModal && <AddPlatformModal orgId={orgId} onClose={() => setShowModal(false)} onAdd={handleAdd} />}

      <div className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
        toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none',
      )}>
        <Check size={14} className="text-teal" /> {toast}
      </div>
    </div>
  )
}
