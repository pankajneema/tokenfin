import { describe, it, expect } from 'vitest'
import { formatInsightLines } from './insights'
import type { Finding } from '@/lib/insights/types'

const f = (id: string, saving: number): Finding => ({
  id, rule: 'runaway_session', title: `T-${id}`, detail: '', recommendation: '', monthly_saving_usd: saving,
  bill_saving_usd: saving, notional_saving_usd: 0, confidence: 'medium', evidence: { label: '', href: '' }, metrics: {},
})

describe('formatInsightLines', () => {
  it('lists top findings with savings and the latest spike', () => {
    const lines = formatInsightLines({
      findings: [f('a', 12), f('b', 5), f('c', 0)],
      totals: { monthly_saving_usd: 17, bill_saving_usd: 17, notional_saving_usd: 0, findings: 3 },
      spikes: [{ day: '2026-09-27', sentence: '+$41.00 vs usual' } as never],
    })
    expect(lines).toEqual([
      'Potential savings (estimate): ~$17.00/month',
      '• T-a — ~$12.00/mo (medium confidence)',
      '• T-b — ~$5.00/mo (medium confidence)',
      'Latest spike 2026-09-27: +$41.00 vs usual',
    ])
  })
  it('is empty with nothing to report', () => {
    expect(formatInsightLines({ findings: [f('c', 0)], totals: { monthly_saving_usd: 0, bill_saving_usd: 0, notional_saving_usd: 0, findings: 1 }, spikes: [] })).toEqual([])
  })
})
