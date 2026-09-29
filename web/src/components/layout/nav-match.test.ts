import { describe, it, expect } from 'vitest'
import { activeHref, hrefMatches, fuzzyScore, fuzzyFilter } from './nav-match'
import { SIDEBAR_HREFS, ALL_HREFS, NAV_SECTIONS } from './nav-config'

describe('activeHref (most specific wins)', () => {
  it('picks the deepest matching route', () => {
    expect(activeHref('/dashboard/analytics/models', SIDEBAR_HREFS)).toBe('/dashboard/analytics/models')
    expect(activeHref('/dashboard/analytics', SIDEBAR_HREFS)).toBe('/dashboard/analytics')
    expect(activeHref('/dashboard/analytics/what-if', SIDEBAR_HREFS)).toBe('/dashboard/analytics/what-if')
    expect(activeHref('/dashboard/sessions/abc123', SIDEBAR_HREFS)).toBe('/dashboard/sessions')
    expect(activeHref('/dashboard', SIDEBAR_HREFS)).toBe('/dashboard')
  })
  it('Overview does not light up for child pages it does not own', () => {
    expect(activeHref('/dashboard/settings/profile', SIDEBAR_HREFS)).toBe('/dashboard/settings')
    expect(activeHref('/dashboard/settings/profile', ALL_HREFS)).toBe('/dashboard/settings/profile')
  })
  it('segment boundaries: /dashboard/keysX is not /dashboard/keys', () => {
    expect(hrefMatches('/dashboard/keysX', '/dashboard/keys')).toBe(false)
    expect(hrefMatches('/dashboard/keys/', '/dashboard/keys')).toBe(true)
    expect(hrefMatches('/dashboard/keys?new=1', '/dashboard/keys')).toBe(true)
  })
})

describe('nav config', () => {
  it('has the agreed sections in order and the new routes', () => {
    expect(NAV_SECTIONS.map(s => s.label)).toEqual(['Overview', 'Analyze', 'Engineering', 'Govern', 'Team', 'Connect', 'Settings'])
    for (const h of ['/dashboard/explore', '/dashboard/insights', '/dashboard/analytics/what-if', '/dashboard/traces']) {
      expect(SIDEBAR_HREFS).toContain(h)
    }
    expect(new Set(SIDEBAR_HREFS).size).toBe(SIDEBAR_HREFS.length)
  })
})

describe('fuzzy', () => {
  it('ranks prefix above substring above subsequence', () => {
    const a = fuzzyScore('lim', 'Limits')!
    const b = fuzzyScore('mit', 'Limits')!
    const c = fuzzyScore('lmt', 'Limits')!
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
    expect(fuzzyScore('zzz', 'Limits')).toBeNull()
  })
  it('matches keywords and typos-by-omission', () => {
    const items = [{ label: 'Limits', keywords: 'budget cap' }, { label: 'Alerts', keywords: 'slack' }, { label: 'API keys' }]
    expect(fuzzyFilter('budget', items)[0].label).toBe('Limits')
    expect(fuzzyFilter('slack', items)[0].label).toBe('Alerts')
    expect(fuzzyFilter('apky', items)[0].label).toBe('API keys')
  })
})
