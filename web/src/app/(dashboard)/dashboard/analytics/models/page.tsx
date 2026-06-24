import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { daysAgoIST, tsNDaysAgo } from '@/lib/dates'
import { ModelsClient }       from './_client'
import type { ModelRow }      from './_client'

export const metadata = { title: 'By Model — TokenFin Analytics' }

/* ── Static catalog: provider/tier/pricing/latency reference ── */
const CATALOG: Record<string, { provider: string; tier: 'frontier'|'standard'|'fast'; costPer1M: number; avgLatencyMs: number; color: string }> = {
  'claude-opus-4-8':            { provider:'Anthropic', tier:'frontier', costPer1M:15.00, avgLatencyMs:3840, color:'#D97757' },
  'claude-sonnet-4-6':          { provider:'Anthropic', tier:'standard', costPer1M:3.00,  avgLatencyMs:1240, color:'#E8896A' },
  'claude-haiku-4-5':           { provider:'Anthropic', tier:'fast',     costPer1M:0.80,  avgLatencyMs:420,  color:'#F0AC8A' },
  'claude-haiku-4-5-20251001':  { provider:'Anthropic', tier:'fast',     costPer1M:0.80,  avgLatencyMs:420,  color:'#F0AC8A' },
  'gpt-4o':                     { provider:'OpenAI',    tier:'frontier', costPer1M:5.00,  avgLatencyMs:2180, color:'#10A37F' },
  'gpt-4o-mini':                { provider:'OpenAI',    tier:'fast',     costPer1M:0.30,  avgLatencyMs:380,  color:'#0D8A6A' },
  'gemini-2.5-pro':             { provider:'Google',    tier:'frontier', costPer1M:2.50,  avgLatencyMs:1680, color:'#4285F4' },
  'gemini-2.5-flash':           { provider:'Google',    tier:'fast',     costPer1M:0.075, avgLatencyMs:290,  color:'#669DF6' },
  'gemini-1.5-pro':             { provider:'Google',    tier:'frontier', costPer1M:3.50,  avgLatencyMs:2200, color:'#4285F4' },
  'gemini-1.5-flash':           { provider:'Google',    tier:'fast',     costPer1M:0.35,  avgLatencyMs:480,  color:'#669DF6' },
}

function guessProvider(name: string) {
  if (name.startsWith('claude'))  return 'Anthropic'
  if (name.startsWith('gpt') || name.startsWith('o1') || name.startsWith('o3') || name.startsWith('o4')) return 'OpenAI'
  if (name.startsWith('gemini')) return 'Google'
  return 'Other'
}

const COLORS = ['#D97757','#E8896A','#10A37F','#F0AC8A','#0D8A6A','#4285F4','#669DF6','#6B7280']

export default async function ModelsAnalyticsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: _mb } = await admin
    .from('members').select('org_id').eq('user_id', user.id).limit(1)
  const orgId = _mb?.[0]?.org_id ?? ''

  const since30date = daysAgoIST(30)   // IST date for usage_agg.bucket
  const since60date = daysAgoIST(60)
  const since30ts   = tsNDaysAgo(30)   // UTC ts for usage_events.created_at
  const since60ts   = tsNDaysAgo(60)

  const [{ data: curr }, { data: prev }, { data: evts }, { data: evtsPrev }] = await Promise.all([
    admin.from('usage_agg')
      .select('model,total_tokens,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since30date),
    admin.from('usage_agg')
      .select('model,total_tokens,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since60date).lt('bucket', since30date),
    admin.from('usage_events')
      .select('model,input_tokens,output_tokens,total_tokens,cost_usd')
      .eq('org_id', orgId).gte('created_at', since30ts),
    admin.from('usage_events')
      .select('model,input_tokens,output_tokens,total_tokens,cost_usd')
      .eq('org_id', orgId).gte('created_at', since60ts).lt('created_at', since30ts),
  ])

  // If usage_agg has no cost data, fall back to usage_events
  const aggHasCost = (curr ?? []).some(r => Number(r.cost_usd ?? 0) > 0)
  const currSource = aggHasCost ? (curr ?? []) : (evts ?? [])
  const prevSource = aggHasCost ? (prev ?? []) : (evtsPrev ?? [])

  /* ── Aggregate current period by model ── */
  const currMap = new Map<string, { inputTok: number; outputTok: number; totalTok: number; cost: number; calls: number }>()
  for (const r of currSource) {
    const m  = r.model ?? 'unknown'
    const e  = currMap.get(m) ?? { inputTok: 0, outputTok: 0, totalTok: 0, cost: 0, calls: 0 }
    const row = r as Record<string,unknown>
    const inTok  = Number(row.input_tokens  ?? 0)
    const outTok = Number(row.output_tokens ?? 0)
    const tot    = Number(row.total_tokens  ?? 0)
    e.inputTok  += inTok
    e.outputTok += outTok
    // total_tokens is the source of truth; input+output as bonus precision
    e.totalTok  += tot > 0 ? tot : inTok + outTok
    e.cost      += Number(r.cost_usd ?? 0)
    e.calls     += Number(row.request_count ?? 1)
    currMap.set(m, e)
  }

  /* ── Aggregate prev period by model ── */
  const prevMap = new Map<string, { cost: number; calls: number }>()
  for (const r of prevSource) {
    const m = r.model ?? 'unknown'
    const e = prevMap.get(m) ?? { cost: 0, calls: 0 }
    e.cost  += Number(r.cost_usd      ?? 0)
    e.calls += Number((r as Record<string,unknown>).request_count ?? 1)
    prevMap.set(m, e)
  }

  const models: ModelRow[] = Array.from(currMap.entries())
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([name, v], i) => {
      const meta = CATALOG[name]
      const p    = prevMap.get(name) ?? { cost: 0, calls: 0 }

      // Use real DB input/output when available
      // Fall back to 70/30 split of total_tokens only when input/output weren't stored
      const hasRealSplit = v.inputTok > 0 || v.outputTok > 0
      const totalForSplit = v.totalTok > 0 ? v.totalTok : (v.inputTok + v.outputTok)
      const inTok  = hasRealSplit ? v.inputTok  : Math.round(totalForSplit * 0.7)
      const outTok = hasRealSplit ? v.outputTok : totalForSplit - Math.round(totalForSplit * 0.7)

      // Values are in raw token counts — convert to millions for the client
      const inputTok  = inTok  / 1_000_000
      const outputTok = outTok / 1_000_000
      return {
        id:           name,
        name,
        provider:     meta?.provider     ?? guessProvider(name),
        tier:         meta?.tier         ?? 'standard',
        color:        meta?.color        ?? COLORS[i % COLORS.length],
        bg:           meta?.color        ?? COLORS[i % COLORS.length],
        costPer1M:    meta?.costPer1M    ?? 0,
        avgLatencyMs: meta?.avgLatencyMs ?? 0,
        cost30d:      v.cost,
        costPrev:     p.cost,
        inputTok,
        outputTok,
        calls30d:     v.calls,
        callsPrev:    p.calls,
      }
    })

  return <ModelsClient models={models} />
}
