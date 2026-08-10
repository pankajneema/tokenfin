'use client'

import { useState } from 'react'
import { ClipboardCheck, ThumbsUp, ThumbsDown, Check } from 'lucide-react'
import type { CaptureRow } from './page'

export function AnnotationsClient({ orgId, rows }: { orgId: string; rows: CaptureRow[] }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2 text-[19px] font-bold text-[var(--fg)]"><ClipboardCheck size={18} className="text-teal" /> Annotation queue</div>
      <p className="mb-5 text-[13px] text-[var(--fg-secondary)]">Human review of captured prompts. Your ratings become ground truth (evaluator = human).</p>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-[12.5px] text-[var(--fg-tertiary)]">
          No captured prompts to review.        </div>
      ) : (
        <div className="space-y-3">{rows.map(r => <Item key={r.id} orgId={orgId} row={r} />)}</div>
      )}
    </div>
  )
}

function Item({ orgId, row }: { orgId: string; row: CaptureRow }) {
  const [note, setNote] = useState('')
  const [done, setDone] = useState<'up' | 'down' | null>(null)
  const [busy, setBusy] = useState(false)

  async function rate(passed: boolean) {
    setBusy(true)
    await fetch('/api/v1/evals/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, target_type: 'prompt_capture', target_id: row.id, passed, score: passed ? 1 : 0, rationale: note || undefined }),
    })
    setBusy(false); setDone(passed ? 'up' : 'down')
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-1 text-[11.5px] text-[var(--fg-tertiary)]">{row.model} · {new Date(row.created_at).toLocaleString('en-US')}</div>
      <div className="mb-1 text-[12px] font-semibold text-[var(--fg)]">Prompt</div>
      <pre className="mb-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--bg-tertiary)] p-2 font-mono text-[11px] text-[var(--fg)]">{row.prompt_text.slice(0, 2000)}</pre>
      <div className="mb-1 text-[12px] font-semibold text-[var(--fg)]">Response</div>
      <pre className="mb-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--bg-tertiary)] p-2 font-mono text-[11px] text-[var(--fg)]">{(row.response_text ?? '').slice(0, 2000)}</pre>
      {done ? (
        <div className="flex items-center gap-1.5 text-[12px] text-teal"><Check size={14} /> Recorded ({done === 'up' ? 'good' : 'bad'})</div>
      ) : (
        <div className="flex items-center gap-2">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note"
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11.5px] text-[var(--fg)] outline-none" />
          <button onClick={() => rate(true)} disabled={busy} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[12px] text-teal hover:bg-[var(--green-bg)] disabled:opacity-60"><ThumbsUp size={13} /> Good</button>
          <button onClick={() => rate(false)} disabled={busy} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[12px] text-red-500 hover:bg-[var(--red-bg)] disabled:opacity-60"><ThumbsDown size={13} /> Bad</button>
        </div>
      )}
    </div>
  )
}
