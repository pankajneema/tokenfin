'use client'

/**
 * Setup wizard — one unified 3-phase flow, the SAME for every tool:
 *   0 · Pick your tool     (grouped grid; recorder-tier + accuracy badges up front)
 *   1 · Connect the MCP    (auto-provisioned key baked into every snippet)
 *   2 · Install the recorder (hook / proxy / rule — the step other products skip)
 *   3 · Verify             (polls a REAL endpoint; first real event → 🎉 you're live)
 *
 * Layout: slim top progress bar + a persistent LEFT RAIL (stepper + masked key
 * chip + a live connection beacon) + one focused step on the right. The key is
 * provisioned server-side and injected everywhere — the user never hunts for it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy, Check, Eye, EyeOff, KeyRound, ShieldCheck, Search, ArrowRight, ArrowLeft,
  ArrowUpRight, Radio, PartyPopper, Rocket, Send, ChevronRight,
  Plug, Cable, Circle, Info, HelpCircle,
} from 'lucide-react'
import {
  TOOLS, CATEGORIES, TIER_META, ACCURACY_META, TOOL_BY_ID,
  type Tool, type Block, type PhaseSpec,
} from './_catalog'

// ── confetti (self-contained, respects prefers-reduced-motion) ────────────────
function fireConfetti() {
  if (typeof window === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999'
  canvas.width = window.innerWidth; canvas.height = window.innerHeight
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d'); if (!ctx) { canvas.remove(); return }
  const colors = ['#00C48C', '#D97757', '#F5C842', '#60A5FA', '#E8533A']
  const parts = Array.from({ length: 140 }, () => ({
    x: canvas.width / 2, y: canvas.height * 0.4,
    vx: (Math.random() - 0.5) * 16, vy: Math.random() * -16 - 4,
    r: Math.random() * 6 + 3, c: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
  }))
  const start = performance.now()
  function frame(t: number) {
    const el = t - start
    ctx!.clearRect(0, 0, canvas.width, canvas.height)
    for (const p of parts) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += p.vr
      ctx!.save(); ctx!.translate(p.x, p.y); ctx!.rotate(p.rot)
      ctx!.globalAlpha = Math.max(0, 1 - el / 2400)
      ctx!.fillStyle = p.c; ctx!.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6)
      ctx!.restore()
    }
    if (el < 2400) requestAnimationFrame(frame); else canvas.remove()
  }
  requestAnimationFrame(frame)
}

const STEPS = ['Pick your tool', 'Connect MCP', 'Install recorder', 'Verify'] as const

// ═══════════════════════════════════════════════════════════════════════════════
export function SetupClient({
  endpoint, orgId, isAdmin, keyError, initialKey,
}: {
  endpoint: string
  orgId: string
  isAdmin: boolean
  keyError: boolean
  initialKey: { id: string; raw: string; masked: string } | null
}) {
  const key = initialKey?.raw ?? ''

  const [phase, setPhase]   = useState(0)
  const [toolId, setToolId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // live connection beacon — flips the moment a real event lands, any phase.
  const [live, setLive] = useState<{ model: string; tokens: number; cost: number } | null>(null)
  const sinceRef = useRef<string>('')
  if (!sinceRef.current && typeof window !== 'undefined') sinceRef.current = new Date().toISOString()

  const tool = toolId ? TOOL_BY_ID[toolId] : null

  const copy = useCallback((id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(id); setTimeout(() => setCopied(null), 1800)
  }, [])

  // Continuous poller (all phases) → drives the rail beacon + verify screen.
  useEffect(() => {
    if (!orgId || !key || live) return
    let stop = false
    const poll = async () => {
      try {
        const r = await fetch(`/api/v1/verify?org_id=${orgId}&since=${encodeURIComponent(sinceRef.current)}`)
        if (!r.ok) return
        const d = await r.json()
        if (!stop && d?.count > 0 && d.latest) {
          setLive({ model: d.latest.model, tokens: d.latest.tokens, cost: d.latest.cost })
          fireConfetti()
        }
      } catch { /* keep waiting */ }
    }
    const t = setInterval(poll, 4000); poll()
    return () => { stop = true; clearInterval(t) }
  }, [orgId, key, live])

  // ── gated states ──
  if (!isAdmin) {
    return <Shell><Gate icon={ShieldCheck} title="Ask an admin to open Setup"
      body="Setup mints a shared connection key for your whole org, so only an admin (or owner) can create it. Once a tool is connected, your usage shows up automatically." /></Shell>
  }
  if (keyError || !initialKey) {
    return <Shell><Gate icon={KeyRound} title="Couldn’t provision your setup key"
      body="We couldn’t create the connection key just now. Refresh to try again — if it keeps failing, check that the DB migrations are applied and KEY_ENCRYPTION_SECRET is set." /></Shell>
  }

  return (
    <div className="mx-auto max-w-5xl px-1">
      {/* slim top progress bar */}
      <div className="mb-5 h-1 overflow-hidden rounded-full bg-[var(--bg-tertiary)]" aria-hidden>
        <div className="h-full rounded-full bg-coral transition-all duration-500"
          style={{ width: `${((phase + 1) / STEPS.length) * 100}%` }} />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[240px_1fr]">
        {/* ── persistent left rail ── */}
        <aside className="md:sticky md:top-4 md:self-start">
          <Rail
            phase={phase} onGoto={p => p <= phase && setPhase(p)}
            tool={tool} masked={initialKey.masked} rawKey={key} endpoint={endpoint}
            copied={copied} onCopy={copy} live={live}
          />
        </aside>

        {/* ── focused step ── */}
        <main className="min-w-0">
          {phase === 0 && (
            <PickTool selectedId={toolId} onPick={id => { setToolId(id); setPhase(1) }} />
          )}
          {phase === 1 && tool && (
            <StepPanel
              step={1} tool={tool} spec={tool.connect(endpoint, key)} endpoint={endpoint} apiKey={key}
              copied={copied} onCopy={copy}
              onBack={() => setPhase(0)} onNext={() => setPhase(2)} nextLabel="Next · install recorder"
              intro={<ConnectIntro />}
            />
          )}
          {phase === 2 && tool && (
            <StepPanel
              step={2} tool={tool} spec={tool.recorder(endpoint, key)} endpoint={endpoint} apiKey={key}
              copied={copied} onCopy={copy}
              onBack={() => setPhase(1)} onNext={() => setPhase(3)} nextLabel="Next · verify"
              intro={<RecorderIntro tool={tool} />}
            />
          )}
          {phase === 3 && tool && (
            <Verify tool={tool} orgId={orgId} live={live} onBack={() => setPhase(2)} />
          )}
        </main>
      </div>
    </div>
  )
}

// ── left rail ─────────────────────────────────────────────────────────────────
function Rail({
  phase, onGoto, tool, masked, rawKey, endpoint, copied, onCopy, live,
}: {
  phase: number
  onGoto: (p: number) => void
  tool: Tool | null
  masked: string
  rawKey: string
  endpoint: string
  copied: string | null
  onCopy: (id: string, t: string) => void
  live: { model: string; tokens: number; cost: number } | null
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="flex items-center gap-2 text-[13px] font-bold tracking-tight text-[var(--fg)]">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-coral/10"><Cable size={14} className="text-coral" /></span>
        Connect a tool
      </div>

      {/* stepper */}
      <ol className="space-y-0.5">
        {STEPS.map((label, i) => {
          const state = i < phase ? 'done' : i === phase ? 'active' : 'todo'
          const clickable = i <= phase
          return (
            <li key={label}>
              <button
                onClick={() => onGoto(i)} disabled={!clickable}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                  clickable ? 'hover:bg-[var(--bg-hover)]' : 'cursor-default'} ${
                  state === 'active' ? 'font-semibold text-[var(--fg)]' : 'text-[var(--fg-secondary)]'}`}>
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  state === 'done'   ? 'bg-[var(--green-bg)] text-teal'
                  : state === 'active' ? 'bg-coral text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]'}`}>
                  {state === 'done' ? <Check size={12} /> : i + 1}
                </span>
                <span className="truncate">{label}</span>
                {tool && i === 0 && state !== 'active' && (
                  <span className="ml-auto truncate text-[10.5px] text-[var(--fg-tertiary)]">{tool.name}</span>
                )}
              </button>
            </li>
          )
        })}
      </ol>

      <div className="divider" />

      {/* auto-provisioned key chip */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
          <KeyRound size={11} /> Your key · auto-provisioned
        </div>
        <div className="flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[11px] text-[var(--fg)]">
            {show ? rawKey : masked}
          </code>
          <button onClick={() => setShow(v => !v)} aria-label={show ? 'Hide key' : 'Reveal key'}
            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]">
            {show ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button onClick={() => onCopy('railkey', rawKey)} aria-label="Copy key"
            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]">
            {copied === 'railkey' ? <Check size={13} className="text-teal" /> : <Copy size={13} />}
          </button>
        </div>
        <p className="mt-1 truncate text-[10px] text-[var(--fg-tertiary)]" title={endpoint}>{endpoint}</p>
      </div>

      <div className="divider" />

      {/* live beacon */}
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] transition-colors ${
        live ? 'border-teal/40 bg-[var(--green-bg)]' : 'border-[var(--border)] bg-[var(--bg)]'}`}>
        {live ? (
          <>
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-teal" />
            <span className="font-semibold text-teal">● LIVE</span>
            <span className="ml-auto truncate font-mono text-[10.5px] text-[var(--fg-secondary)]">{live.model}</span>
          </>
        ) : (
          <>
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--fg-tertiary)] opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--fg-tertiary)]" />
            </span>
            <span className="text-[var(--fg-secondary)]">Waiting for first event…</span>
          </>
        )}
      </div>
    </div>
  )
}

// ── Phase 0 · pick tool ─────────────────────────────────────────────────────────
function PickTool({ selectedId, onPick }: { selectedId: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [helper, setHelper] = useState(false)
  const query = q.trim().toLowerCase()
  const filtered = useMemo(
    () => TOOLS.filter(t => !query || t.name.toLowerCase().includes(query) || t.blurb.toLowerCase().includes(query) || t.category.includes(query)),
    [query],
  )
  return (
    <div>
      <StepHeader step={0} title="Pick your tool" sub="Every tool takes the same 3 steps — only how it records differs." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="Search tools…"
            aria-label="Search tools"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2 pl-9 pr-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--fg-tertiary)] focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/20" />
        </div>
        <button onClick={() => setHelper(v => !v)}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-[12.5px] font-medium text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]">
          <HelpCircle size={14} /> Not sure?
        </button>
      </div>

      {helper && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--blue-bg)] px-3.5 py-2.5 text-[12px] leading-snug text-[var(--fg-secondary)]">
          <b className="text-[var(--fg)]">Terminal agents</b> (Claude Code, Codex, Gemini) record <b className="text-teal">exactly</b> — start there.
          IDEs and chat apps route calls through the vendor, so they record from a rule (<b className="text-[var(--amber)]">estimated</b>) unless you run the proxy.
        </div>
      )}

      <div className="space-y-6">
        {CATEGORIES.map(cat => {
          const items = filtered.filter(t => t.category === cat.id)
          if (!items.length) return null
          return (
            <section key={cat.id}>
              <div className="mb-2">
                <h3 className="text-[12.5px] font-bold tracking-tight text-[var(--fg)]">{cat.label}</h3>
                <p className="text-[11px] text-[var(--fg-tertiary)]">{cat.hint}</p>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {items.map(t => <ToolCard key={t.id} tool={t} selected={t.id === selectedId} onClick={() => onPick(t.id)} />)}
              </div>
            </section>
          )
        })}
        {filtered.length === 0 && (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-6 text-center text-[12.5px] text-[var(--fg-secondary)]">
            No tools match “{q}”. Every tool that speaks MCP works — try <b>Custom &amp; API</b>.
          </p>
        )}
      </div>
    </div>
  )
}

function ToolCard({ tool, selected, onClick }: { tool: Tool; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`group flex items-start gap-3 rounded-2xl border bg-[var(--bg-secondary)] p-3 text-left transition-all hover:shadow-soft ${
        selected ? 'border-coral ring-2 ring-coral/20' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
      <BrandTile brand={tool.brand} Icon={tool.Icon} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-[var(--fg)]">{tool.name}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--fg-secondary)]">{tool.blurb}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TierBadge tier={tool.tier} />
          <AccuracyBadge accuracy={tool.accuracy} />
        </div>
      </div>
      <ChevronRight size={16} className="mt-1 flex-shrink-0 text-[var(--fg-tertiary)] transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

// ── Phase 1 / 2 · generic step panel ─────────────────────────────────────────────
function StepPanel({
  step, tool, spec, endpoint, apiKey, copied, onCopy, onBack, onNext, nextLabel, intro,
}: {
  step: 1 | 2
  tool: Tool
  spec: PhaseSpec
  endpoint: string
  apiKey: string
  copied: string | null
  onCopy: (id: string, t: string) => void
  onBack: () => void
  onNext: () => void
  nextLabel: string
  intro: React.ReactNode
}) {
  const title = step === 1 ? `Connect ${tool.name}` : `Install the recorder`
  return (
    <div>
      <StepHeader
        step={step} title={title} sub={spec.lede}
        badge={step === 2 ? <AccuracyBadge accuracy={tool.accuracy} /> : undefined}
      />
      {intro}
      <div className="mt-4 space-y-3">
        {spec.blocks.map((b, i) => (
          <BlockView key={i} block={b} idBase={`${tool.id}-${step}-${i}`} copied={copied} onCopy={onCopy} />
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button onClick={onBack} className="btn-ghost"><ArrowLeft size={15} /> Back</button>
        <button onClick={onNext} className="btn-primary">{nextLabel} <ArrowRight size={15} /></button>
      </div>
    </div>
  )
}

function ConnectIntro() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3.5 py-2.5 text-[12px] leading-snug text-[var(--fg-secondary)]">
      <Info size={13} className="mr-1 inline align-[-2px] text-[var(--blue)]" />
      This adds the tokenfin server (read · compress · record_usage). Connecting alone doesn’t fill your dashboard —
      the next step installs what actually sends usage.
    </div>
  )
}

function RecorderIntro({ tool }: { tool: Tool }) {
  const why =
    tool.tier === 'hook'  ? 'Claude Code fires a Stop hook after each turn — the recorder reads real token counts with no agent cooperation.'
    : tool.tier === 'proxy' ? 'The proxy is the one universal recorder: your tool’s API calls pass through it, so it records real provider-reported usage and forwards the response unchanged.'
    : tool.tier === 'rule'  ? 'This tool’s calls run on the vendor’s servers, so nothing can intercept them. The model follows a saved rule and reports its own counts — accurate enough for trends, but estimated.'
    : 'You control the recorder: pass real token counts to record_usage (exact), or route everything through the proxy.'
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3.5 py-2.5 text-[12px] leading-snug text-[var(--fg-secondary)]">
      <Plug size={13} className="mr-1 inline align-[-2px] text-coral" />
      <b className="text-[var(--fg)]">Why this step?</b> {why}
    </div>
  )
}

// ── block renderer ───────────────────────────────────────────────────────────────
function BlockView({ block, idBase, copied, onCopy }: {
  block: Block; idBase: string; copied: string | null; onCopy: (id: string, t: string) => void
}) {
  if (block.kind === 'deeplink') {
    return (
      <div className="flex flex-col gap-1.5">
        <a href={block.href} className="btn-primary w-fit"><Rocket size={15} /> {block.label}</a>
        {block.alt && (
          <a href={block.alt.href} target="_blank" rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 text-[11.5px] font-medium text-[var(--fg-tertiary)] hover:text-coral">
            {block.alt.label} <ArrowUpRight size={11} />
          </a>
        )}
      </div>
    )
  }
  if (block.kind === 'open') {
    return <a href={block.href} target="_blank" rel="noreferrer" className="btn-primary w-fit">{block.label} <ArrowUpRight size={13} /></a>
  }
  if (block.kind === 'command') {
    return (
      <div>
        <CodeBlock id={idBase} code={block.code} copied={copied} onCopy={onCopy} />
        {block.note && <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--fg-tertiary)]">{block.note}</p>}
      </div>
    )
  }
  if (block.kind === 'config') {
    return (
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[var(--fg-secondary)]">
          <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[10.5px]">{block.lang}</span>
          <span className="truncate font-mono">{block.filename}</span>
        </div>
        <CodeBlock id={idBase} code={block.code} copied={copied} onCopy={onCopy} />
      </div>
    )
  }
  if (block.kind === 'chips') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {block.chips.map(ch => {
          const id = `${idBase}-${ch.label}`
          return (
            <button key={ch.label} onClick={() => onCopy(id, ch.value)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[11.5px] transition-colors hover:border-coral">
              <span className="font-semibold text-[var(--fg-tertiary)]">{ch.label}</span>
              <span className="truncate font-mono text-[var(--fg)]">{ch.value}</span>
              {copied === id ? <Check size={12} className="flex-shrink-0 text-teal" /> : <Copy size={12} className="flex-shrink-0 text-[var(--fg-tertiary)]" />}
            </button>
          )
        })}
      </div>
    )
  }
  if (block.kind === 'code') {
    return <CodeTabs tabs={block.tabs} idBase={idBase} copied={copied} onCopy={onCopy} />
  }
  // note
  return (
    <p className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-[11.5px] leading-snug text-[var(--fg-secondary)]">
      {block.text}
    </p>
  )
}

function CodeTabs({ tabs, idBase, copied, onCopy }: {
  tabs: { label: string; code: string }[]; idBase: string; copied: string | null; onCopy: (id: string, t: string) => void
}) {
  const [i, setI] = useState(0)
  return (
    <div>
      <div className="mb-2 inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-0.5">
        {tabs.map((t, idx) => (
          <button key={t.label} onClick={() => setI(idx)}
            className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
              i === idx ? 'bg-[var(--bg)] text-[var(--fg)] shadow-soft' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg)]'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <CodeBlock id={`${idBase}-${tabs[i].label}`} code={tabs[i].code} copied={copied} onCopy={onCopy} />
    </div>
  )
}

function CodeBlock({ id, code, copied, onCopy }: {
  id: string; code: string; copied: string | null; onCopy: (id: string, t: string) => void
}) {
  return (
    <div className="relative">
      <pre className="max-h-72 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 pr-14 font-mono text-[11px] leading-relaxed text-[var(--fg)]">{code}</pre>
      <button onClick={() => onCopy(id, code)} aria-label="Copy"
        className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[10.5px] font-medium text-[var(--fg)] hover:border-coral">
        {copied === id ? <><Check size={11} className="text-teal" /> Copied</> : <><Copy size={11} /> Copy</>}
      </button>
    </div>
  )
}

// ── Phase 3 · verify ──────────────────────────────────────────────────────────────
function Verify({ tool, orgId, live, onBack }: {
  tool: Tool
  orgId: string
  live: { model: string; tokens: number; cost: number } | null
  onBack: () => void
}) {
  const [testing, setTesting] = useState(false)
  const sendTest = async () => {
    setTesting(true)
    try {
      await fetch('/api/v1/test-event', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      })
    } catch { /* the top-level poller keeps listening */ }
    setTesting(false)
  }

  return (
    <div>
      <StepHeader step={3} title="Verify" sub="We’re polling your usage feed. The first real event lights this up." />

      {live ? (
        <div className="rounded-2xl border border-teal/40 bg-[var(--green-bg)] p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/50">
            <PartyPopper size={24} className="text-teal" />
          </div>
          <h3 className="text-[17px] font-bold text-teal">🎉 You’re live!</h3>
          <p className="mt-1 text-[12.5px] text-[var(--fg-secondary)]">
            First event recorded from <b className="text-[var(--fg)]">{tool.name}</b> — your pipeline works end to end.
          </p>
          <div className="mx-auto mt-4 grid max-w-sm grid-cols-3 gap-2">
            <Stat label="Model" value={live.model} mono />
            <Stat label="Tokens" value={live.tokens.toLocaleString()} />
            <Stat label="Cost" value={`$${live.cost.toFixed(6)}`} />
          </div>
          <a href="/dashboard" className="btn-primary mt-5">Go to dashboard <ArrowRight size={15} /></a>
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-tertiary)]">
            <span className="relative flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-coral opacity-60" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-coral" />
            </span>
          </div>
          <h3 className="text-[15px] font-bold text-[var(--fg)]">Listening for your first event…</h3>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-snug text-[var(--fg-secondary)]">
            Trigger {tool.name} (send a message / run a turn), or send a real test event to prove the pipeline right now.
          </p>
          <button onClick={sendTest} disabled={testing} className="btn-primary mt-4 disabled:opacity-60">
            {testing ? <><Radio size={15} className="animate-pulse" /> Sending…</> : <><Send size={15} /> Send a test event</>}
          </button>
          <p className="mt-3 text-[11.5px]">
            <a href="/dashboard" className="text-[var(--fg-tertiary)] underline-offset-2 hover:text-coral hover:underline">Skip for now</a>
          </p>
        </div>
      )}

      <div className="mt-6">
        <button onClick={onBack} className="btn-ghost"><ArrowLeft size={15} /> Back</button>
      </div>
    </div>
  )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-2 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{label}</div>
      <div className={`mt-0.5 truncate text-[12.5px] font-semibold tabular-nums text-[var(--fg)] ${mono ? 'font-mono' : ''}`} title={value}>{value}</div>
    </div>
  )
}

// ── shared atoms ────────────────────────────────────────────────────────────────
function StepHeader({ step, title, sub, badge }: { step: number; title: string; sub: string; badge?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-coral">Step {step + 1} of {STEPS.length}</span>
        {badge}
      </div>
      <h2 className="page-title">{title}</h2>
      <p className="mt-1 text-[12.5px] leading-snug text-[var(--fg-secondary)]">{sub}</p>
    </div>
  )
}

function BrandTile({ brand, Icon, size = 38 }: { brand: string; Icon: React.ElementType; size?: number }) {
  return (
    <div className="flex flex-shrink-0 items-center justify-center rounded-xl" style={{ width: size, height: size, background: brand }}>
      <Icon size={size * 0.5} className="text-white" strokeWidth={2} />
    </div>
  )
}

export function TierBadge({ tier }: { tier: import('./_catalog').Tier }) {
  const m = TIER_META[tier]
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>
    <Cable size={9} /> {m.label}
  </span>
}

export function AccuracyBadge({ accuracy }: { accuracy: import('./_catalog').Accuracy }) {
  const m = ACCURACY_META[accuracy]
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>
    <Circle size={7} fill={m.dot} stroke="none" /> {m.label}
  </span>
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-1">{children}</div>
}

function Gate({ icon: Icon, title, body }: { icon: React.ElementType; title: string; body: string }) {
  return (
    <div className="mt-10 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-tertiary)]">
        <Icon size={22} className="text-[var(--fg-secondary)]" />
      </div>
      <h2 className="text-[16px] font-bold text-[var(--fg)]">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">{body}</p>
    </div>
  )
}
