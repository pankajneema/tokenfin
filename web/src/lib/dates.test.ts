import { describe, it, expect } from 'vitest'
import { toZonedDate, toISTDate, isValidTimeZone } from './dates'

describe('dates', () => {
  // 2026-09-28 20:00 UTC = 2026-09-29 01:30 in India, still the 28th in UTC and New York
  const ts = '2026-09-28T20:00:00Z'
  it('buckets by the workspace time zone', () => {
    expect(toZonedDate(ts, 'Asia/Kolkata')).toBe('2026-09-29')
    expect(toZonedDate(ts, 'UTC')).toBe('2026-09-28')
    expect(toZonedDate(ts, 'America/New_York')).toBe('2026-09-28')
  })
  it('keeps the old IST helper behaviour', () => {
    expect(toISTDate(ts)).toBe('2026-09-29')
  })
  it('validates zone names and falls back safely', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(toZonedDate(ts, 'Mars/Olympus')).toBe('2026-09-29')
  })
})
