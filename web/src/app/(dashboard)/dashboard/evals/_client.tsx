'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Loader2, Play, KeyRound, Check } from 'lucide-react'
import type { ScoreRow, RunRow } from './page'

export function EvalsClient({ orgId, meanFaithfulness, hallucinationRate, scoredCount, runs, scores, keyConfigured, judgeModel }: {
  orgId: string; meanFaithfulness: number | null; hallucinationRate: number | null; scoredCount: number; runs: RunRow[]; scores: ScoreRow[]; keyConfigured: boolean; judgeModel: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function run() {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/v1/evals/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, evaluator: 'faithfulness', days: 7, sample: 10 }),
      })
      const d = await res.json()
      if (!res.ok) { setMsg(typeof d.error === 'string' ? d.error : 'Eval failed'); return }
      setMsg(`Scored ${d.count} captures · mean ${d.mean_score ?? '—'} · hallucination ${d.hallucination_rate != null ? (d.hallucination_rate * 100).toFixed(0) + '%' : '—'}`)
      router.refresh()
    } catch { setMsg('Network error') } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-2 text-[19px] font-bold text-[var(--fg)]"><ShieldCheck size={18} className="text-teal" /> Evals</div>
      <p className="mb-5 text-[13px] text-[var(--fg-secondary)]">Quality &amp; hallucination scoring over your captured prompts (reference-free LLM-as-judge).</p>

      <EvalKeyCard orgId={orgId} configured={keyConfigured} model={judgeModel} />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Kpi label="Hallucination rate" value={hallucinationRate == null ? '—' : `${hallucinationRate}%`} tone={hallucinationRate != null && hallucinationRate > 20 ? 'bad' : 'good'} />
        <Kpi label="Mean faithfulness" value={meanFaithfulness == null ? '—' : meanFaithfulness.toFixed(2)} />
        <Kpi label="Scored (recent)" value={String(scoredCount)} />
      </div>

      <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center justify-between">
          <div className="text-[12.5px] text-[var(--fg-secondary)]">Run a faithfulness eval on the last 7 days of captured prompts (sample 10).</div>
          <button onClick={run} disabled={busy} className="btn-primary justify-center disabled:opacity-60">
            {busy ? <><Loader2 size={14} className="animate-spin" /> Running…</> : <><Play size={14} /> Run eval</>}
          </button>
        </div>
        {msg && <p className="mt-2 text-[12px] text-[var(--fg)]">{msg}</p>}
        <p className="mt-2 text-[11px] text-[var(--fg-tertiary)]">Needs captured prompts (CAPTURE_PROMPTS) + judge key (EVAL_JUDGE_KEY / ANTHROPIC_API_KEY).</p>
      </div>

      {runs.length > 0 && (
        <Panel title="Recent runs">
          <div className="space-y-1.5">
            {runs.map(r => (
              <div key={r.id} className="flex justify-between text-[12.5px]">
                <span className="font-medium text-[var(--fg)]">{r.evaluator} <span className="text-[var(--fg-tertiary)]">· {r.kind}</span></span>
                <span className="text-[var(--fg-secondary)]">
                  {typeof r.summary?.hallucination_rate === 'number' ? `${Math.round((r.summary.hallucination_rate as number) * 100)}% halluc · ` : ''}
                  {typeof r.summary?.count === 'number' ? `${r.summary.count} scored · ` : ''}
                  {new Date(r.created_at).toLocaleString('en-US')}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {scores.length > 0 && (
        <Panel title="Recent scores">
          <div className="space-y-2">
            {scores.slice(0, 25).map(s => (
              <div key={s.id} className="rounded-lg border border-[var(--border)] p-2.5">
                <div className="flex justify-between text-[12px]">
                  <span className="font-medium text-[var(--fg)]">{s.evaluator} · {s.model ?? '—'}</span>
                  <span className={s.passed === false ? 'text-red-500' : 'text-teal'}>{s.score == null ? '—' : s.score.toFixed(2)} {s.passed === false ? '⚠' : ''}</span>
                </div>
                {s.rationale && <p className="mt-1 line-clamp-2 text-[11px] text-[var(--fg-tertiary)]">{s.rationale}</p>}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function EvalKeyCard({ orgId, configured, model }: { orgId: string; configured: boolean; model: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [jm, setJm] = useState(model)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    await fetch('/api/v1/eval-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, key: key || undefined, judge_model: jm }) })
    setBusy(false); setKey(''); setOpen(false); router.refresh()
  }

  return (
    <div className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12.5px]">
          <KeyRound size={15} className="text-[var(--fg-tertiary)]" />
          <span className="font-medium text-[var(--fg)]">Eval provider key</span>
          {configured
            ? <span className="flex items-center gap-1 text-teal"><Check size={12} /> configured · {model}</span>
            : <span className="text-red-500">not set — evals will fail</span>}
        </div>
        <button onClick={() => setOpen(o => !o)} className="btn-secondary text-[12px]">{open ? 'Cancel' : (configured ? 'Update' : 'Set key')}</button>
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--fg-tertiary)]">Bring your own Anthropic key — your org pays for eval/judge calls. Stored encrypted; never shown again.</p>
      {open && (
        <div className="mt-3 space-y-2">
          <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-[12px] text-[var(--fg)] outline-none" />
          <div className="flex items-center gap-2">
            <input value={jm} onChange={e => setJm(e.target.value)} className="w-56 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--fg)]" />
            <button onClick={save} disabled={busy} className="btn-primary text-[12px] disabled:opacity-60">{busy ? <Loader2 size={13} className="animate-spin" /> : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-1 text-[11.5px] font-medium text-[var(--fg-tertiary)]">{label}</div>
      <div className={`text-[22px] font-bold ${tone === 'bad' ? 'text-red-500' : tone === 'good' ? 'text-teal' : 'text-[var(--fg)]'}`}>{value}</div>
    </div>
  )
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
      <div className="mb-3 text-[13px] font-semibold text-[var(--fg)]">{title}</div>
      {children}
    </div>
  )
}
