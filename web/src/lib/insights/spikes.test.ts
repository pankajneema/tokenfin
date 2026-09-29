import { describe, it, expect } from 'vitest'
import { contributors, detectSpikes, explainSpike, meanSd, memoFetcher, spikeSentence, type BreakRow, type DayCost, type Fetcher } from './spikes'
import type { SpikeDim } from './types'

const days = (costs: number[], start = '2026-09-01'): DayCost[] =>
  costs.map((cost, i) => ({ day: new Date(Date.parse(start + 'T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10), cost }))

describe('meanSd', () => {
  it('is the population mean / σ', () => {
    const { mean, sd } = meanSd([2, 4, 4, 4, 5, 5, 7, 9])
    expect(mean).toBe(5)
    expect(sd).toBe(2)
  })
  it('handles empty input', () => expect(meanSd([])).toEqual({ mean: 0, sd: 0 }))
})

describe('detectSpikes', () => {
  it('flags a day above mean + 3σ and reports the baseline', () => {
    const s = detectSpikes(days([10, 11, 9, 10, 12, 8, 10, 10, 50]))
    expect(s).toHaveLength(1)
    expect(s[0].day).toBe('2026-09-09')
    expect(s[0].history_days).toBe(8)
    expect(s[0].baseline_mean).toBe(10)
    expect(s[0].delta).toBe(40)
    expect(s[0].threshold).toBeCloseTo(10 + 3 * Math.sqrt(1.25), 3)
    expect(s[0].baseline_from).toBe('2026-09-01')
    expect(s[0].baseline_to).toBe('2026-09-08')
  })
  it('needs ≥ 7 days of history counted from the first day with cost', () => {
    // 5 zero days, then 6 real days, then a jump: only 6 days of history → nothing
    expect(detectSpikes(days([0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10, 100]))).toEqual([])
    // one more real day → detected
    expect(detectSpikes(days([0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10, 10, 100]))).toHaveLength(1)
  })
  it('does not flag a day inside 3σ', () => {
    expect(detectSpikes(days([10, 20, 10, 20, 10, 20, 10, 20, 29]))).toEqual([])
  })
  it('guards σ≈0 noise with minDelta', () => {
    expect(detectSpikes(days([1, 1, 1, 1, 1, 1, 1, 1.5]))).toEqual([])
    expect(detectSpikes(days([1, 1, 1, 1, 1, 1, 1, 2.5]))).toHaveLength(1)
    expect(detectSpikes(days([1, 1, 1, 1, 1, 1, 1, 1.5]), { minDelta: 0.1 })).toHaveLength(1)
  })
  it('uses a trailing window and respects `since`', () => {
    // big early values leave the 7-day window, so the later rise is a spike
    const s = detectSpikes(days([100, 100, 5, 5, 5, 5, 5, 5, 5, 40]), { window: 7 })
    expect(s.map(x => x.day)).toEqual(['2026-09-10'])
    expect(detectSpikes(days([100, 100, 5, 5, 5, 5, 5, 5, 5, 40]), { window: 7, since: '2026-09-11' })).toEqual([])
  })
  it('returns nothing for an all-zero series', () => expect(detectSpikes(days([0, 0, 0]))).toEqual([]))
})

describe('contributors', () => {
  it('compares the day with the baseline daily mean and ranks by delta', () => {
    const today: BreakRow[] = [{ key: 'opus', cost_usd: 45 }, { key: 'haiku', cost_usd: 2 }, { key: 'sonnet', cost_usd: 3 }]
    const base: BreakRow[] = [{ key: 'opus', cost_usd: 35 }, { key: 'haiku', cost_usd: 21 }, { key: 'sonnet', cost_usd: 14 }]
    const c = contributors(today, base, 7, 40)
    expect(c.map(x => x.key)).toEqual(['opus', 'sonnet'])   // haiku fell (2 < 3/day)
    expect(c[0]).toMatchObject({ today: 45, usual: 5, delta: 40, pct: 100 })
    expect(c[1]).toMatchObject({ usual: 2, delta: 1 })
  })
  it('counts keys new on the spike day', () => {
    expect(contributors([{ key: 'new', cost_usd: 8 }], [], 7, 8)[0]).toMatchObject({ usual: 0, delta: 8, pct: 100 })
  })
})

describe('explainSpike', () => {
  // Synthetic data: on the spike day alice spends $40 extra on opus in repo acme/api.
  // Baseline (7 days): $10/day spread across bob/sonnet/other.
  const baseDays = 7
  function fetcher(): { f: Fetcher; calls: number } {
    const state = { calls: 0 }
    const f: Fetcher = async (dim, from, _to, filters) => {
      state.calls++
      const spikeDay = from === '2026-09-08'
      const rows: { member: string; model: string; repo: string; source: string; project: string; agent: string; cost: number }[] = spikeDay
        ? [
          { member: 'alice@x.com', model: 'claude-opus-4-8', repo: 'acme/api', source: 'claude_code', project: 'p1', agent: '', cost: 38 },
          { member: 'alice@x.com', model: 'claude-opus-4-8', repo: 'acme/web', source: 'claude_code', project: 'p1', agent: '', cost: 2 },
          { member: 'bob@x.com', model: 'claude-sonnet-4-6', repo: 'acme/api', source: 'claude_code', project: 'p1', agent: '', cost: 10 },
        ]
        : [{ member: 'bob@x.com', model: 'claude-sonnet-4-6', repo: 'acme/api', source: 'claude_code', project: 'p1', agent: '', cost: 10 * baseDays }]
      const keyOf: Record<SpikeDim, keyof (typeof rows)[number]> = { member: 'member', model: 'model', repo: 'repo', source: 'source', project: 'project', agent: 'agent' }
      const match = (r: (typeof rows)[number]) =>
        (!filters.user_key || r.member === filters.user_key) && (!filters.model || r.model === filters.model) &&
        (!filters.repo || r.repo === filters.repo) && (!filters.source || r.source === filters.source)
      const agg = new Map<string, number>()
      for (const r of rows.filter(match)) agg.set(String(r[keyOf[dim]]), (agg.get(String(r[keyOf[dim]])) ?? 0) + r.cost)
      return [...agg].map(([key, cost_usd]) => ({ key, cost_usd }))
    }
    return { f, get calls() { return state.calls } }
  }
  const spike = {
    day: '2026-09-08', cost: 50, baseline_mean: 10, baseline_sd: 0, threshold: 10, delta: 40,
    history_days: baseDays, baseline_from: '2026-09-01', baseline_to: '2026-09-07',
  }

  it('names the joint top contributor with $ and %', async () => {
    const e = await explainSpike(spike, fetcher().f)
    expect(e.path.map(p => [p.dim, p.key])).toEqual([['member', 'alice@x.com'], ['model', 'claude-opus-4-8'], ['repo', 'acme/api'], ['source', 'claude_code']])
    expect(e.path[2].pct).toBe(95)   // 38 of 40
    expect(e.path[3].pct).toBe(95)
    expect(e.sentence).toBe('+$40.00 vs usual ($10.00/day); 95% from alice@x.com on claude-opus-4-8 in repo acme/api via claude_code')
    expect(e.contributors.member?.[0]).toMatchObject({ key: 'alice@x.com', delta: 40, pct: 100 })
    expect(e.contributors.model?.[0].key).toBe('claude-opus-4-8')
    expect(e.evidence.href).toContain('/dashboard/explore?')
    expect(e.evidence.href).toContain('member=alice%40x.com')
    expect(e.evidence.href).toContain('from=2026-09-08')
  })

  it('skips dimensions already fixed by the base filter (member scope)', async () => {
    const e = await explainSpike(spike, fetcher().f, { base: { user_key: 'alice@x.com' } })
    expect(e.contributors.member).toBeUndefined()
    expect(e.path[0].dim).toBe('model')
  })

  it('stops drilling when no single key explains half the delta', async () => {
    const flat: Fetcher = async (dim, from) => from === spike.day
      ? [{ key: `${dim}-a`, cost_usd: 18 }, { key: `${dim}-b`, cost_usd: 18 }, { key: `${dim}-c`, cost_usd: 14 }]
      : [{ key: `${dim}-c`, cost_usd: 70 }]
    const e = await explainSpike(spike, flat)
    expect(e.path).toEqual([])
    expect(e.sentence).toContain('no single member, model or repo stands out')
  })

  it('memoizes repeated breakdown queries', async () => {
    const fx = fetcher()
    const m = memoFetcher(fx.f)
    await m('model', 'a', 'b', {}); await m('model', 'a', 'b', {}); await m('model', 'a', 'b', { model: '' })
    expect(fx.calls).toBe(1)
  })

  it('formats the sentence without a path', () => {
    expect(spikeSentence({ delta: 0.5, baseline_mean: 0.25 }, [])).toContain('+$0.5000 vs usual ($0.2500/day)')
  })
})
