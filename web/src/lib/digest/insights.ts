/**
 * Weekly-digest "Insights" section: the top waste findings + the latest spike,
 * as plain text lines. Server-only; fail-open (a digest never fails on this).
 *
 * Hook (in lib/digest/run.ts, owned elsewhere):
 *   const extra = await digestInsightLines(admin, orgId, tz)   // append to the digest body
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeInsights } from '@/lib/insights/load'
import type { InsightsResult } from '@/lib/insights/types'

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`)

/** Pure formatter (unit-tested). Empty when there is nothing worth saying. */
export function formatInsightLines(r: Pick<InsightsResult, 'findings' | 'totals' | 'spikes'>, max = 3): string[] {
  const top = r.findings.filter(f => f.monthly_saving_usd > 0).slice(0, max)
  const lines: string[] = []
  if (top.length) {
    lines.push(`Potential savings (estimate): ~${usd(r.totals.monthly_saving_usd)}/month`)
    for (const f of top) lines.push(`• ${f.title} — ~${usd(f.monthly_saving_usd)}/mo (${f.confidence} confidence)`)
  }
  const spike = r.spikes[0]
  if (spike) lines.push(`Latest spike ${spike.day}: ${spike.sentence}`)
  return lines
}

export async function digestInsightLines(admin: SupabaseClient, orgId: string, timezone: string): Promise<string[]> {
  try {
    return formatInsightLines(await computeInsights(admin, orgId, { timezone, maxSpikes: 1 }))
  } catch (e) {
    console.warn('[digest] insights skipped:', e instanceof Error ? e.message : e)
    return []
  }
}
