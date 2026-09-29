import { describe, it, expect } from 'vitest'
import { resolvePrefs, inQuietHours, wantsEmail, wantsInapp, categoryFor, NotifPrefsSchema, NOTIF_DEFAULTS } from './prefs'

describe('resolvePrefs', () => {
  it('applies defaults and drops bad values', () => {
    const p = resolvePrefs({ anomaly_email: false, quiet_start: '25:00', timezone: 'Not/AZone', junk: 1 })
    expect(p.anomaly_email).toBe(false)
    expect(p.quiet_start).toBe(NOTIF_DEFAULTS.quiet_start)
    expect(p.timezone).toBe('')
    expect(resolvePrefs(null)).toEqual(NOTIF_DEFAULTS)
  })
  it('schema rejects unknown keys and bad times', () => {
    expect(NotifPrefsSchema.safeParse({ anomaly_email: true }).success).toBe(true)
    expect(NotifPrefsSchema.safeParse({ foo: true }).success).toBe(false)
    expect(NotifPrefsSchema.safeParse({ quiet_end: '8am' }).success).toBe(false)
    expect(NotifPrefsSchema.safeParse({ timezone: 'Asia/Kolkata' }).success).toBe(true)
  })
})

describe('quiet hours', () => {
  const p = { ...NOTIF_DEFAULTS, quiet_start: '22:00', quiet_end: '08:00', timezone: 'Asia/Kolkata' }
  it('wraps midnight in the user zone', () => {
    expect(inQuietHours(p, new Date('2026-09-29T17:00:00Z'))).toBe(true)   // 22:30 IST
    expect(inQuietHours(p, new Date('2026-09-29T02:00:00Z'))).toBe(true)   // 07:30 IST
    expect(inQuietHours(p, new Date('2026-09-29T03:00:00Z'))).toBe(false)  // 08:30 IST
  })
  it('falls back to the workspace zone, and start==end disables', () => {
    const q = { ...p, timezone: '' }
    expect(inQuietHours(q, new Date('2026-09-29T23:00:00Z'), 'UTC')).toBe(true)
    expect(inQuietHours({ ...q, quiet_start: '09:00', quiet_end: '09:00' }, new Date(), 'UTC')).toBe(false)
  })
})

describe('delivery decisions', () => {
  const night = new Date('2026-09-29T23:00:00Z')
  const noon  = new Date('2026-09-29T12:00:00Z')
  const base  = { ...NOTIF_DEFAULTS, timezone: 'UTC' }
  it('maps triggers to categories', () => {
    expect(categoryFor('anomaly')).toBe('anomaly')
    for (const t of ['threshold', 'limit_breach', 'member', 'forecast']) expect(categoryFor(t)).toBe('budget')
  })
  it('honours opt-outs and quiet hours for non-critical email', () => {
    expect(wantsEmail(base, 'budget', false, noon, 'UTC')).toBe(true)
    expect(wantsEmail(base, 'budget', false, night, 'UTC')).toBe(false)
    expect(wantsEmail({ ...base, anomaly_email: false }, 'anomaly', false, noon, 'UTC')).toBe(false)
    expect(wantsEmail({ ...base, budget_breach_email: false }, 'budget', false, noon, 'UTC')).toBe(false)
  })
  it('critical (limit block) always emails', () => {
    expect(wantsEmail({ ...base, budget_breach_email: false }, 'budget', true, night, 'UTC')).toBe(true)
  })
  it('in-app: anomaly toggle; budget always', () => {
    expect(wantsInapp({ ...base, anomaly_inapp: false }, 'anomaly', false)).toBe(false)
    expect(wantsInapp(base, 'budget', false)).toBe(true)
  })
})
