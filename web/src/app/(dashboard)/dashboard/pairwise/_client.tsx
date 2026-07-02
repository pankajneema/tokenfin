'use client'

import { useState } from 'react'
import { GitCompare, Loader2, Trophy } from 'lucide-react'

interface Result { winner: 'A' | 'B' | 'tie'; rationale: string; model_a: string; model_b: string; answer_a: string; answer_b: string }

export function PairwiseClient({ orgId }: { orgId: string }) {
  const [prompt, setPrompt] = useState('')
  const [modelA, setModelA] = useState('claude-haiku-4-5')
  const [modelB, setModelB] = useState('claude-sonnet-4-6')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState<Result | null>(null)

  async function compare() {
    setBusy(true); setErr(''); setRes(null)
    try {
      const r = await fetch('/api/v1/evals/pairwise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, prompt, model_a: modelA, model_b: modelB }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(typeof d.error === 'string' ? d.error : 'failed'); return }
      setRes(d)
    } catch { setErr('Network error') } finally { setBusy(false) }
  }

  const won = (side: 'A' | 'B') => res?.winner === side

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2 text-[19px] font-bold text-[var(--fg)]"><GitCompare size={18} className="text-teal" /> Pairwise compare</div>
      <p className="mb-5 text-[13px] text-[var(--fg-secondary)]">A/B two models on the same prompt; an LLM judge picks the winner (head-to-head beats independent scoring).</p>

      <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="Prompt to test on both models"
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--border-strong)]" />
        <div className="grid grid-cols-2 gap-3">
          <input value={modelA} onChange={e => setModelA(e.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12.5px] text-[var(--fg)]" />
          <input value={modelB} onChange={e => setModelB(e.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12.5px] text-[var(--fg)]" />
        </div>
        {err && <p className="text-[12px] text-red-500">{err}</p>}
        <button onClick={compare} disabled={busy || !prompt.trim()} className="btn-primary w-full justify-center disabled:opacity-60">
          {busy ? <><Loader2 size={14} className="animate-spin" /> Comparing…</> : 'Compare'}
        </button>
      </div>

      {res && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(['A', 'B'] as const).map(side => (
            <div key={side} className={`rounded-2xl border p-4 ${won(side) ? 'border-teal bg-[var(--green-bg)]' : 'border-[var(--border)] bg-[var(--bg-secondary)]'}`}>
              <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-[var(--fg)]">
                <span>{side === 'A' ? res.model_a : res.model_b}</span>
                {won(side) && <span className="flex items-center gap-1 text-teal"><Trophy size={13} /> winner</span>}
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-[var(--fg)]">{side === 'A' ? res.answer_a : res.answer_b}</pre>
            </div>
          ))}
          <div className="col-span-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-[12px] text-[var(--fg-secondary)]">
            <span className="font-semibold text-[var(--fg)]">Verdict:</span> {res.winner === 'tie' ? 'Tie' : `Model ${res.winner} wins`} — {res.rationale}
          </div>
        </div>
      )}
    </div>
  )
}
