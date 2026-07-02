import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Scale, Sparkles } from 'lucide-react'
import { RoutesPanel, type RouteRow } from './_routes'

export const metadata = { title: 'Quality × Cost — TokenFin' }

const usd = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`

const QUALITY_TARGET = 0.8

export default async function QualityCostPage() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user!.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''
  const since = new Date(Date.now() - 30 * 864e5).toISOString()

  const [{ data: scores }, { data: events }, { data: routes }] = await Promise.all([
    admin.from('eval_scores').select('model, score').eq('org_id', orgId).gte('created_at', since).not('model', 'is', null).not('score', 'is', null),
    admin.from('usage_events').select('model, total_tokens, output_tokens, cost_usd').eq('org_id', orgId).gte('created_at', since).limit(50_000),
    admin.from('model_routes').select('id, from_model, to_model').eq('org_id', orgId).eq('is_active', true),
  ])

  // Quality per model (mean eval score).
  const q = new Map<string, { sum: number; n: number }>()
  for (const s of scores ?? []) { const m = q.get(s.model) ?? { sum: 0, n: 0 }; m.sum += Number(s.score); m.n++; q.set(s.model, m) }

  // Cost/usage per model + output-token variability (stddev).
  const u = new Map<string, { cost: number; calls: number; tokens: number; out: number[] }>()
  for (const e of events ?? []) {
    const m = u.get(e.model) ?? { cost: 0, calls: 0, tokens: 0, out: [] }
    m.cost += Number(e.cost_usd ?? 0); m.calls++; m.tokens += Number(e.total_tokens ?? 0); m.out.push(Number(e.output_tokens ?? 0))
    u.set(e.model, m)
  }
  const std = (a: number[]) => { if (a.length < 2) return 0; const mean = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length) }

  const models = Array.from(new Set([...Array.from(q.keys()), ...Array.from(u.keys())])).map(model => {
    const qq = q.get(model), uu = u.get(model)
    const quality = qq && qq.n ? qq.sum / qq.n : null
    const cost = uu?.cost ?? 0, calls = uu?.calls ?? 0
    const avgOut = uu && uu.out.length ? uu.out.reduce((s, v) => s + v, 0) / uu.out.length : 0
    const variability = avgOut > 0 ? std(uu!.out) / avgOut : 0        // coefficient of variation
    const costPerCorrect = quality && quality > 0 && calls > 0 ? cost / (calls * quality) : null
    return { model, quality, cost, calls, tokens: uu?.tokens ?? 0, variability, costPerCorrect }
  }).sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0))

  // Recommendation: cheapest model (by avg cost/call) that meets the quality target.
  const eligible = models.filter(m => m.quality != null && m.quality >= QUALITY_TARGET && m.calls > 0)
  const rec = eligible.sort((a, b) => (a.cost / a.calls) - (b.cost / b.calls))[0]

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-2 text-[19px] font-bold text-[var(--fg)]"><Scale size={18} className="text-teal" /> Quality × Cost</div>
      <p className="mb-5 text-[13px] text-[var(--fg-secondary)]">Cost-per-correct-answer and quality-vs-cost per model (last 30 days). Quality = mean eval score.</p>

      {rec && (
        <div className="mb-5 flex items-start gap-2 rounded-2xl border border-[var(--border)] bg-[var(--green-bg)] p-4 text-[13px] text-[var(--fg)]">
          <Sparkles size={16} className="mt-0.5 text-teal" />
          <span><span className="font-semibold">Recommendation:</span> route to <span className="font-semibold">{rec.model}</span> — cheapest model meeting ≥{QUALITY_TARGET * 100}% quality
            ({(rec.quality! * 100).toFixed(0)}% at {usd(rec.cost / rec.calls)}/call). This is the eval-informed routing target (Phase 4).</span>
        </div>
      )}

      {models.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-[12.5px] text-[var(--fg-tertiary)]">
          No data yet — run evals (for quality) and send usage (for cost) to populate this.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg-secondary)] text-[var(--fg-tertiary)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Quality</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">$/correct</th>
                <th className="px-3 py-2 text-right font-medium">Out-token var.</th>
              </tr>
            </thead>
            <tbody>
              {models.map(m => (
                <tr key={m.model} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 font-medium text-[var(--fg)]">{m.model}{rec?.model === m.model && <span className="ml-1 text-teal">★</span>}</td>
                  <td className="px-3 py-2 text-right">{m.quality == null ? <span className="text-[var(--fg-tertiary)]">—</span> : <span className={m.quality >= QUALITY_TARGET ? 'text-teal' : 'text-amber-500'}>{(m.quality * 100).toFixed(0)}%</span>}</td>
                  <td className="px-3 py-2 text-right text-[var(--fg-secondary)]">{m.calls}</td>
                  <td className="px-3 py-2 text-right text-[var(--fg)]">{usd(m.cost)}</td>
                  <td className="px-3 py-2 text-right text-[var(--fg-secondary)]">{m.costPerCorrect == null ? '—' : usd(m.costPerCorrect)}</td>
                  <td className="px-3 py-2 text-right text-[var(--fg-tertiary)]">{(m.variability * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-[var(--fg-tertiary)]">$/correct = spend ÷ (calls × quality). Out-token variability = stddev/mean of output tokens (cost predictability).</p>

      <RoutesPanel orgId={orgId} models={models.map(m => m.model)} recommended={rec?.model ?? null} routes={(routes ?? []) as RouteRow[]} />
    </div>
  )
}
