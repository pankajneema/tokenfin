import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { ModelsClient }       from './_client'
import type { ModelRow }      from './_client'

export const metadata = { title: 'By Model — TokenFin Analytics' }

/* ── Static catalog: provider/tier/pricing/latency reference ── */
const CATALOG: Record<string, { provider: string; tier: 'frontier'|'standard'|'fast'; costPer1M: number; avgLatencyMs: number; color: string }> = {
  'claude-opus-4-8':    { provider:'Anthropic', tier:'frontier', costPer1M:15.00, avgLatencyMs:3840, color:'#D97757' },
  'claude-sonnet-4-6':  { provider:'Anthropic', tier:'standard', costPer1M:3.00,  avgLatencyMs:1240, color:'#E8896A' },
  'claude-haiku-4-5':   { provider:'Anthropic', tier:'fast',     costPer1M:0.80,  avgLatencyMs:420,  color:'#F0AC8A' },
  'gpt-4o':             { provider:'OpenAI',    tier:'frontier', costPer1M:5.00,  avgLatencyMs:2180, color:'#10A37F' },
  'gpt-4o-mini':        { provider:'OpenAI',    tier:'fast',     costPer1M:0.30,  avgLatencyMs:380,  color:'#0D8A6A' },
  'gemini-2.5-pro':     { provider:'Google',    tier:'frontier', costPer1M:2.50,  avgLatencyMs:1680, color:'#4285F4' },
  'gemini-2.5-flash':   { provider:'Google',    tier:'fast',     costPer1M:0.075, avgLatencyMs:290,  color:'#669DF6' },
  'gemini-1.5-pro':     { provider:'Google',    tier:'frontier', costPer1M:3.50,  avgLatencyMs:2200, color:'#4285F4' },
  'gemini-1.5-flash':   { provider:'Google',    tier:'fast',     costPer1M:0.35,  avgLatencyMs:480,  color:'#669DF6' },
}

function guessProvider(name: string) {
  if (name.startsWith('claude'))  return 'Anthropic'
  if (name.startsWith('gpt') || name.startsWith('o1') || name.startsWith('o3')) return 'OpenAI'
  if (name.startsWith('gemini')) return 'Google'
  return 'Other'
}

export default async function ModelsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: membership } = await supabase
    .from('members').select('org_id').eq('user_id', user.id).maybeSingle()
  const orgId = membership?.org_id ?? ''

  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
  const since60 = new Date(Date.now() - 60 * 86400_000).toISOString()

  const [{ data: curr }, { data: prev }] = await Promise.all([
    admin.from('usage_agg')
      .select('model,total_tokens,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since30),
    admin.from('usage_agg')
      .select('model,total_tokens,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since60).lt('bucket', since30),
  ])

  /* ── Aggregate current period by model ── */
  const currMap = new Map<string, { tokens: number; cost: number; calls: number }>()
  for (const r of curr ?? []) {
    const m = r.model ?? 'unknown'
    const e = currMap.get(m) ?? { tokens: 0, cost: 0, calls: 0 }
    e.tokens += Number(r.total_tokens  ?? 0)
    e.cost   += Number(r.cost_usd      ?? 0)
    e.calls  += Number(r.request_count ?? 0)
    currMap.set(m, e)
  }

  /* ── Aggregate prev period by model ── */
  const prevMap = new Map<string, { cost: number; calls: number }>()
  for (const r of prev ?? []) {
    const m = r.model ?? 'unknown'
    const e = prevMap.get(m) ?? { cost: 0, calls: 0 }
    e.cost  += Number(r.cost_usd      ?? 0)
    e.calls += Number(r.request_count ?? 0)
    prevMap.set(m, e)
  }

  const COLORS = ['#D97757','#E8896A','#10A37F','#F0AC8A','#0D8A6A','#4285F4','#669DF6','#6B7280']

  const models: ModelRow[] = Array.from(currMap.entries())
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([name, v], i) => {
      const meta = CATALOG[name]
      const p    = prevMap.get(name) ?? { cost: 0, calls: 0 }
      // Tokens split: assume 60/40 input/output (real split needs input/output separate fields)
      const inputTok  = +(v.tokens * 0.6 / 1_000_000).toFixed(2)
      const outputTok = +(v.tokens * 0.4 / 1_000_000).toFixed(2)
      return {
        id:          name,
        name,
        provider:    meta?.provider    ?? guessProvider(name),
        tier:        meta?.tier        ?? 'standard',
        color:       meta?.color       ?? COLORS[i % COLORS.length],
        bg:          meta?.color       ?? COLORS[i % COLORS.length],
        costPer1M:   meta?.costPer1M   ?? 0,
        avgLatencyMs:meta?.avgLatencyMs ?? 0,
        cost30d:     v.cost,
        costPrev:    p.cost,
        inputTok,
        outputTok,
        calls30d:    v.calls,
        callsPrev:   p.calls,
      }
    })

  return <ModelsClient models={models} />
}
