'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Database, Plus, Play, Loader2 } from 'lucide-react'
import type { DatasetRow } from './page'

export function DatasetsClient({ orgId, datasets }: { orgId: string; datasets: DatasetRow[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  async function createDataset() {
    if (!name.trim()) return
    setBusy(true)
    await fetch('/api/v1/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, name }) })
    setName(''); setBusy(false); router.refresh()
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2 text-[19px] font-bold text-[var(--fg)]"><Database size={18} className="text-teal" /> Datasets</div>
      <p className="mb-5 text-[13px] text-[var(--fg-secondary)]">Curated test cases (input + reference output) for offline correctness evals.</p>

      <div className="mb-5 flex gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New dataset name"
          className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--border-strong)]" />
        <button onClick={createDataset} disabled={busy} className="btn-primary disabled:opacity-60"><Plus size={14} /> Create</button>
      </div>

      {datasets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-[12.5px] text-[var(--fg-tertiary)]">No datasets yet.</div>
      ) : (
        <div className="space-y-2">
          {datasets.map(d => (
            <div key={d.id} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
              <button onClick={() => setOpen(open === d.id ? null : d.id)} className="flex w-full items-center justify-between text-left">
                <span className="text-[13px] font-semibold text-[var(--fg)]">{d.name}</span>
                <span className="text-[11.5px] text-[var(--fg-tertiary)]">{d.examples?.[0]?.count ?? 0} examples</span>
              </button>
              {open === d.id && <DatasetDetail orgId={orgId} datasetId={d.id} onChange={() => router.refresh()} setMsg={setMsg} />}
            </div>
          ))}
        </div>
      )}
      {msg && <p className="mt-3 text-[12px] text-[var(--fg)]">{msg}</p>}
    </div>
  )
}

function DatasetDetail({ orgId, datasetId, onChange, setMsg }: { orgId: string; datasetId: string; onChange: () => void; setMsg: (s: string) => void }) {
  const [input, setInput] = useState('')
  const [ref, setRef] = useState('')
  const [model, setModel] = useState('claude-haiku-4-5')
  const [busy, setBusy] = useState(false)

  async function addExample() {
    if (!input.trim() || !ref.trim()) return
    setBusy(true)
    await fetch('/api/v1/datasets/examples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_id: datasetId, input, reference_output: ref }) })
    setInput(''); setRef(''); setBusy(false); onChange()
  }
  async function runEval() {
    setBusy(true); setMsg('')
    const res = await fetch('/api/v1/evals/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, evaluator: 'correctness', dataset_id: datasetId, model, sample: 20 }) })
    const d = await res.json()
    setBusy(false)
    setMsg(res.ok ? `Offline eval: ${d.count} scored · mean ${d.mean_score ?? '—'}` : (d.error ?? 'failed'))
  }

  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
      <textarea value={input} onChange={e => setInput(e.target.value)} rows={2} placeholder="Example input (question/prompt)"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 text-[12px] text-[var(--fg)] outline-none" />
      <textarea value={ref} onChange={e => setRef(e.target.value)} rows={2} placeholder="Reference (expected answer)"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 text-[12px] text-[var(--fg)] outline-none" />
      <div className="flex items-center gap-2">
        <button onClick={addExample} disabled={busy} className="btn-secondary text-[12px] disabled:opacity-60"><Plus size={13} /> Add example</button>
        <input value={model} onChange={e => setModel(e.target.value)} className="w-44 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11.5px] text-[var(--fg)]" />
        <button onClick={runEval} disabled={busy} className="btn-primary text-[12px] disabled:opacity-60">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run correctness
        </button>
      </div>
    </div>
  )
}
