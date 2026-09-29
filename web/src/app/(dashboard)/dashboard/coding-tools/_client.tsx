'use client'
import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, ChevronDown, ChevronRight, Code2, Info, Link2, RefreshCw, Trash2, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MergedPrs } from '@/components/dashboard/merged-prs'
import type { ToolAgg, DevRow } from '@/lib/connectors/summary'
import type { CodingToolsData, ConnectorStatus } from './_types'

const card = 'bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl'
const usd  = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`
const num  = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : v.toLocaleString()
const pct  = (v: number | null) => v === null ? '—' : `${Math.round(v * 100)}%`

type Provider = 'claude_code_analytics' | 'cursor' | 'github_copilot' | 'github'
const CONNECTORS: { provider: Provider; name: string; keyLabel: string; placeholder: string; steps: string[]; extra?: 'org' | 'repos' }[] = [
  {
    provider: 'claude_code_analytics', name: 'Claude Code (Analytics API)', keyLabel: 'Anthropic Admin API key', placeholder: 'sk-ant-admin01-…',
    steps: ['Claude Console → Settings → Admin keys → create a key (org admins only).', 'Per-developer sessions, lines, commits, PRs, tool accept/reject, tokens and estimated cost by model.', 'API customers = vendor-reported cost; Pro/Team seats = notional.'],
  },
  {
    provider: 'cursor', name: 'Cursor', keyLabel: 'Cursor Admin API key', placeholder: 'key_…',
    steps: ['Cursor dashboard → Settings → Advanced → Admin API keys (team admins).', 'Daily usage per developer (requests, accepted lines, tab accepts) and charged spend per request.'],
  },
  {
    provider: 'github_copilot', name: 'GitHub Copilot', keyLabel: 'GitHub token', placeholder: 'github_pat_… or ghp_…', extra: 'org',
    steps: ['Token with org read access to Copilot metrics (classic: read:org; fine-grained: organization “Copilot metrics: read”).', 'Add billing read (org admin) to include Copilot spend — otherwise spend shows $0.', 'Copilot reports GitHub logins — map them to emails below to join them with other tools.'],
  },
  {
    provider: 'github', name: 'GitHub (merged PRs)', keyLabel: 'Fine-grained GitHub token', placeholder: 'github_pat_…', extra: 'repos',
    steps: ['github.com → Settings → Developer settings → Fine-grained tokens; select the repos; grant “Pull requests: read” and “Contents: read”.', 'Pulls merged PRs from the last 60 days to compute cost per merged PR.'],
  },
]

export function CodingToolsClient({ data }: { data: CodingToolsData }) {
  const router = useRouter()
  const { view } = data
  const hasData = view.tools.length > 0
  const byProvider = new Map(data.connections.map(c => [c.provider, c]))
  const t = view.totals

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight flex items-center gap-2"><Code2 size={20} /> Coding tools</h2>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5 max-w-[760px]">
            All coding AI in one view — Claude Code, Cursor, GitHub Copilot, Codex and Gemini CLI — per tool and per developer.
            Vendor data is pulled daily from each vendor’s admin API; CLI agents come from TokenFin’s own telemetry. UTC days since {data.since}.
          </p>
        </div>
        <select value={data.days} onChange={e => router.push(`?days=${e.target.value}`)} aria-label="Period"
          className="px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[12.5px] text-[var(--fg)]">
          {[7, 30].map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>

      {data.connections.filter(c => c.status === 'error').map(c => (
        <p key={c.provider} className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 rounded-xl px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={12} /> {CONNECTORS.find(x => x.provider === c.provider)?.name ?? c.provider} sync is failing: {c.last_error ?? 'unknown error'}
        </p>
      ))}

      {!hasData ? (
        <div className={cn(card, 'px-6 py-12 flex flex-col items-center text-center gap-3')}>
          <div className="w-12 h-12 rounded-2xl bg-[var(--bg-secondary)] flex items-center justify-center"><Link2 size={20} className="text-[var(--fg-tertiary)]" /></div>
          <p className="text-[15px] font-bold text-[var(--fg)]">No coding-tool usage yet</p>
          <p className="text-[12.5px] text-[var(--fg-secondary)] max-w-[560px]">
            Connect a vendor below (Claude Code Analytics, Cursor, GitHub Copilot), or capture Claude Code / Codex / Gemini CLI usage directly with{' '}
            <span className="font-mono">npx tokenfin@latest setup</span>.
          </p>
          <Link href="/dashboard/setup" className="btn-secondary text-[12.5px] mt-1">Set up CLI telemetry</Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: 'Vendor-reported spend', value: usd(t.costVendor), hint: 'Billed / estimated by the vendor' },
              { label: 'Notional spend', value: usd(t.costNotional), hint: 'Subscription usage priced at API rates — not a bill' },
              { label: 'Developers', value: String(t.developers) },
              { label: 'Accept rate', value: pct(t.acceptRate), hint: 'Accepted ÷ suggested/proposed' },
              { label: 'PRs by AI tools', value: num(t.prs) },
            ].map(s => (
              <div key={s.label} className={cn(card, 'p-4')} title={s.hint}>
                <p className="text-[10.5px] text-[var(--fg-tertiary)] uppercase tracking-wider font-semibold">{s.label}</p>
                <p className="text-[18px] font-bold tabular-nums mt-1 text-[var(--fg)]">{s.value}</p>
                {s.hint && <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{s.hint}</p>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {view.tools.map(tool => <ToolCard key={tool.tool} t={tool} />)}
          </div>

          <DevTable devs={view.developers} />
        </>
      )}

      <section className="space-y-3" aria-labelledby="connect-tools">
        <h2 id="connect-tools" className="text-[15px] font-bold text-[var(--fg)] flex items-center gap-2"><Link2 size={15} /> Connections</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {CONNECTORS.map(c => (
            <ConnectCard key={c.provider} spec={c} conn={byProvider.get(c.provider)} orgId={data.orgId}
              canConnect={data.canConnect} canManage={data.canManage} onChange={() => router.refresh()} />
          ))}
        </div>
      </section>

      {(view.unmappedLogins.length > 0 || data.mappings.length > 0 || byProvider.has('github') || byProvider.has('github_copilot')) && (
        <LoginMapping data={data} onChange={() => router.refresh()} />
      )}

      <MergedPrs data={data.prs} connectHref="#connect-tools" />
    </div>
  )
}

function ToolCard({ t }: { t: ToolAgg }) {
  const isTelemetry = t.tool.startsWith('otel:')
  return (
    <div className={cn(card, 'p-4 space-y-3')}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13.5px] font-bold text-[var(--fg)]">{t.label}</p>
        <span className={cn('text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full',
          isTelemetry ? 'bg-[var(--blue-bg)] text-[var(--blue)]' : 'bg-[var(--green-bg)] text-[var(--green)]')}>
          {isTelemetry ? 'TokenFin telemetry' : 'Vendor API'}
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-y-2 gap-x-3 text-[12px]">
        <Stat k="Vendor-reported" v={usd(t.costVendor)} />
        <Stat k="Notional" v={usd(t.costNotional)} />
        <Stat k="Developers" v={String(t.developers)} />
        <Stat k="Requests" v={num(t.requests)} />
        <Stat k="Lines +/−" v={`${num(t.linesAdded)} / ${num(t.linesRemoved)}`} />
        <Stat k="Accept rate" v={pct(t.acceptRate)} />
        <Stat k="PRs" v={num(t.prs)} />
        <Stat k="Commits" v={num(t.commits)} />
        <Stat k="Tokens" v={num(t.tokens)} />
      </dl>
      {t.orgLevelCost > 0 && <p className="text-[11px] text-[var(--fg-tertiary)]">{usd(t.orgLevelCost)} is org-level (seats / billing) — not per developer.</p>}
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10.5px] text-[var(--fg-tertiary)]">{k}</dt>
      <dd className="font-semibold tabular-nums text-[var(--fg)]">{v}</dd>
    </div>
  )
}

function DevTable({ devs }: { devs: DevRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setOpen(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  return (
    <section className={cn(card, 'overflow-hidden')} aria-labelledby="per-dev">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-3 flex-wrap">
        <h2 id="per-dev" className="text-[14px] font-bold text-[var(--fg)] flex items-center gap-2"><Users size={14} /> Per developer, across tools</h2>
        <p className="text-[11.5px] text-[var(--fg-tertiary)]">Click a row for the per-tool breakdown</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-[var(--fg-tertiary)] border-b border-[var(--border)]">
              <th className="px-4 py-2.5 font-semibold">Developer</th>
              <th className="px-4 py-2.5 font-semibold">Tools</th>
              <th className="px-4 py-2.5 font-semibold text-right">Vendor-reported</th>
              <th className="px-4 py-2.5 font-semibold text-right">Notional</th>
              <th className="px-4 py-2.5 font-semibold text-right">Requests</th>
              <th className="px-4 py-2.5 font-semibold text-right">Lines +</th>
              <th className="px-4 py-2.5 font-semibold text-right">Accept</th>
              <th className="px-4 py-2.5 font-semibold text-right">PRs</th>
            </tr>
          </thead>
          <tbody>
            {devs.map(d => (
              <Fragment key={d.key}>
                <tr onClick={() => toggle(d.key)} className="border-b border-[var(--border)] cursor-pointer hover:bg-[var(--bg-secondary)]"
                  aria-expanded={open.has(d.key)}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {open.has(d.key) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <div>
                        <p className="text-[var(--fg)] font-medium">{d.label}</p>
                        {d.sub && <p className={cn('text-[11px]', d.mapped ? 'text-[var(--fg-tertiary)]' : 'text-[var(--amber)]')}>{d.sub}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--fg-secondary)]">{d.tools.filter(c => !c.excluded).length}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{usd(d.costVendor)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">{usd(d.costNotional)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{num(d.requests)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{num(d.linesAdded)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{pct(d.acceptRate)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{num(d.prs)}</td>
                </tr>
                {open.has(d.key) && d.tools.map(c => (
                  <tr key={c.tool} className={cn('border-b border-[var(--border)] bg-[var(--bg-secondary)] text-[12px]', c.excluded && 'opacity-60')}>
                    <td className="pl-10 pr-4 py-2 text-[var(--fg-secondary)]" colSpan={2}>
                      {c.label}{c.excluded && <span className="ml-1 text-[11px]" title="Also reported by the Claude Code Analytics API — not added to totals">(overlaps Analytics API — not in totals)</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{usd(c.costVendor)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{usd(c.costNotional)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{num(c.requests)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{num(c.linesAdded)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pct(c.acceptRate)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{num(c.prs)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-[11.5px] text-[var(--fg-tertiary)] flex items-start gap-1.5 border-t border-[var(--border)]">
        <Info size={12} className="mt-0.5 flex-shrink-0" />
        Vendor-reported = what the vendor charged or estimated (Cursor charges, Claude Code API customers, Copilot billing).
        Notional = subscription / CLI usage priced at API rates — useful for comparison, never a bill. Developers are joined by email;
        Copilot logins join once mapped.
      </p>
    </section>
  )
}

function ConnectCard({ spec, conn, orgId, canConnect, canManage, onChange }: {
  spec: typeof CONNECTORS[number]; conn: ConnectorStatus | undefined; orgId: string
  canConnect: boolean; canManage: boolean; onChange: () => void
}) {
  const [key, setKey] = useState('')
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function call(url: string, init: RequestInit) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(url, init)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Request failed — check the fields')
      return j
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); return null }
    finally { setBusy(false) }
  }

  async function connect() {
    const config = spec.extra === 'org' ? { github_org: extra.trim() }
      : spec.extra === 'repos' ? { repos: extra.split(/[\s,]+/).map(s => s.trim()).filter(Boolean) } : undefined
    const j = await call('/api/v1/provider-connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, provider: spec.provider, admin_key: key.trim(), ...(config ? { config } : {}) }),
    })
    if (!j) return
    setKey('')
    setMsg(j.sync?.ok ? { ok: true, text: `Connected — imported ${j.sync.rows} rows.` } : { ok: false, text: `Connected, but the first sync failed: ${j.sync?.error ?? 'unknown'}` })
    onChange()
  }
  async function sync() {
    const j = await call('/api/v1/provider-connections?action=sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, provider: spec.provider }),
    })
    if (!j) return
    const r = j.results?.[0]
    setMsg(r?.ok ? { ok: true, text: `Synced ${r.rows} rows.` } : { ok: false, text: r?.error ?? 'Sync failed' })
    onChange()
  }
  async function disconnect() {
    if (!confirm(`Disconnect ${spec.name}? The stored key is deleted; imported history is kept.`)) return
    const j = await call(`/api/v1/provider-connections?org_id=${orgId}&provider=${spec.provider}`, { method: 'DELETE' })
    if (j) onChange()
  }

  return (
    <div className={cn(card, 'p-4 space-y-3')}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13.5px] font-bold text-[var(--fg)]">{spec.name}</p>
        {conn ? (
          <span className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-full',
            conn.status === 'ok' ? 'bg-[var(--green-bg)] text-[var(--green)]' : conn.status === 'error' ? 'bg-[var(--red-bg)] text-[var(--red)]' : 'bg-[var(--amber-bg)] text-[var(--amber)]')}>
            {conn.status === 'ok' ? 'Connected' : conn.status === 'error' ? 'Error' : 'Pending'}
          </span>
        ) : <span className="text-[10.5px] text-[var(--fg-tertiary)]">Not connected</span>}
      </div>
      <ul className="text-[12px] text-[var(--fg-secondary)] list-disc pl-4 space-y-0.5">
        {spec.steps.map(s => <li key={s}>{s}</li>)}
      </ul>

      {conn ? (
        <div className="space-y-2">
          <p className="text-[12px] text-[var(--fg-secondary)]">
            Key <span className="font-mono">{conn.key_hint}</span>
            {conn.config?.github_org && <> · org <span className="font-mono">{conn.config.github_org}</span></>}
            {conn.config?.repos?.length ? <> · {conn.config.repos.length} repo{conn.config.repos.length > 1 ? 's' : ''}</> : null}
            {' · '}{conn.last_synced_at ? `synced ${new Date(conn.last_synced_at).toLocaleString()}` : 'never synced'}
          </p>
          {conn.status === 'ok' && conn.last_error && <p className="text-[11.5px] text-[var(--amber)]">{conn.last_error}</p>}
          <div className="flex gap-2">
            {canManage && <button onClick={sync} disabled={busy} className="btn-secondary text-[12px] disabled:opacity-40"><RefreshCw size={12} /> Sync now</button>}
            {canConnect && <button onClick={disconnect} disabled={busy} className="btn-secondary text-[12px] disabled:opacity-40"><Trash2 size={12} /> Disconnect</button>}
          </div>
        </div>
      ) : canConnect ? (
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); void connect() }}>
          <label className="block text-[11.5px] text-[var(--fg-tertiary)]">{spec.keyLabel}
            <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={spec.placeholder}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[12.5px] text-[var(--fg)] font-mono" />
          </label>
          {spec.extra && (
            <label className="block text-[11.5px] text-[var(--fg-tertiary)]">
              {spec.extra === 'org' ? 'GitHub organization' : 'Repositories (owner/name, comma-separated — blank = every repo the token can see)'}
              <input value={extra} onChange={e => setExtra(e.target.value)} placeholder={spec.extra === 'org' ? 'my-org' : 'my-org/web, my-org/api'}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[12.5px] text-[var(--fg)] font-mono" />
            </label>
          )}
          <button type="submit" disabled={busy || key.trim().length < 20 || (spec.extra === 'org' && !extra.trim())} className="btn-primary text-[12.5px] disabled:opacity-40">
            {busy ? 'Verifying…' : 'Connect'}
          </button>
          <p className="text-[11px] text-[var(--fg-tertiary)]">The key is verified with one read-only call, then stored encrypted. It is never shown again.</p>
        </form>
      ) : (
        <p className="text-[11.5px] text-[var(--fg-tertiary)]">Only the workspace owner can connect this.</p>
      )}
      {msg && <p className={cn('text-[12px]', msg.ok ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{msg.text}</p>}
    </div>
  )
}

function LoginMapping({ data, onChange }: { data: CodingToolsData; onChange: () => void }) {
  const mapped = new Set(data.mappings.map(m => m.login))
  const pending = data.view.unmappedLogins.filter(l => !mapped.has(l))
  const [login, setLogin] = useState(pending[0] ?? '')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true); setErr(null)
    const res = await fetch('/api/v1/provider-connections?action=github_map', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: data.orgId, login: login.trim(), user_key: email.trim() }),
    })
    setBusy(false)
    if (!res.ok) { setErr('Could not save — check the login and email.'); return }
    setEmail(''); setLogin(''); onChange()
  }
  async function remove(l: string) {
    const res = await fetch(`/api/v1/provider-connections?action=github_map&org_id=${data.orgId}&login=${encodeURIComponent(l)}`, { method: 'DELETE' })
    if (res.ok) onChange()
  }

  return (
    <section className={cn(card, 'p-4 space-y-3')} aria-labelledby="gh-map">
      <div>
        <h2 id="gh-map" className="text-[14px] font-bold text-[var(--fg)]">GitHub login → developer email</h2>
        <p className="text-[12px] text-[var(--fg-secondary)]">
          Copilot and pull requests identify people by GitHub login. Map logins to the email they use elsewhere so usage and PRs join up.
          {pending.length > 0 && <> Unmapped: <span className="font-mono">{pending.join(', ')}</span>.</>}
        </p>
      </div>
      {data.canManage && (
        <form className="flex gap-2 flex-wrap items-end" onSubmit={e => { e.preventDefault(); void save() }}>
          <label className="text-[11.5px] text-[var(--fg-tertiary)]">GitHub login
            <input value={login} onChange={e => setLogin(e.target.value)} list="gh-unmapped" placeholder="octocat"
              className="mt-1 block px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[12.5px] text-[var(--fg)] font-mono" />
            <datalist id="gh-unmapped">{pending.map(l => <option key={l} value={l} />)}</datalist>
          </label>
          <label className="text-[11.5px] text-[var(--fg-tertiary)]">Email
            <input value={email} onChange={e => setEmail(e.target.value)} list="member-emails" placeholder="dev@company.com" type="email"
              className="mt-1 block px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[12.5px] text-[var(--fg)]" />
            <datalist id="member-emails">{data.memberEmails.map(e => <option key={e} value={e} />)}</datalist>
          </label>
          <button type="submit" disabled={busy || !login.trim() || !email.trim()} className="btn-primary text-[12.5px] disabled:opacity-40">Save mapping</button>
          {err && <p className="text-[12px] text-[var(--red)] w-full">{err}</p>}
        </form>
      )}
      {data.mappings.length > 0 && (
        <ul className="text-[12.5px] divide-y divide-[var(--border)]">
          {data.mappings.map(m => (
            <li key={m.login} className="py-1.5 flex items-center justify-between gap-2">
              <span><span className="font-mono">@{m.login}</span> → {m.user_key}</span>
              {data.canManage && <button onClick={() => remove(m.login)} className="text-[11.5px] text-[var(--fg-tertiary)] hover:text-[var(--red)]" aria-label={`Remove mapping for ${m.login}`}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
