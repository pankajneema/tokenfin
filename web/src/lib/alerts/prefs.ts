/**
 * Per-user notification preferences — the single source of truth for keys,
 * defaults, validation and delivery decisions. Stored as one JSON object in
 * user_preferences.settings (one row per user), written by POST
 * /api/v1/preferences from Settings → Notifications. Pure; no I/O.
 */
import { z } from 'zod'

export interface NotifPrefs {
  budget_breach_email:   boolean
  budget_breach_slack:   boolean
  weekly_digest_email:   boolean
  weekly_digest_inapp:   boolean
  weekly_digest_slack:   boolean
  anomaly_email:         boolean
  anomaly_inapp:         boolean
  member_events_email:   boolean
  member_events_inapp:   boolean
  api_errors_email:      boolean
  api_errors_inapp:      boolean
  quiet_start:           string   // "HH:MM" local to `timezone`
  quiet_end:             string
  timezone:              string   // IANA zone captured from the browser on save; '' = use the workspace zone
}

export const NOTIF_DEFAULTS: NotifPrefs = {
  budget_breach_email:  true,
  budget_breach_slack:  false,
  weekly_digest_email:  true,
  weekly_digest_inapp:  true,
  weekly_digest_slack:  false,
  anomaly_email:        true,
  anomaly_inapp:        true,
  member_events_email:  false,
  member_events_inapp:  true,
  api_errors_email:     true,
  api_errors_inapp:     true,
  quiet_start:          '22:00',
  quiet_end:            '08:00',
  timezone:             '',
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function validTz(tz: string): boolean {
  if (!tz) return true
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

/** Body accepted by POST /api/v1/preferences. Unknown keys are rejected. */
export const NotifPrefsSchema = z.object({
  budget_breach_email: z.boolean(),
  budget_breach_slack: z.boolean(),
  weekly_digest_email: z.boolean(),
  weekly_digest_inapp: z.boolean(),
  weekly_digest_slack: z.boolean(),
  anomaly_email:       z.boolean(),
  anomaly_inapp:       z.boolean(),
  member_events_email: z.boolean(),
  member_events_inapp: z.boolean(),
  api_errors_email:    z.boolean(),
  api_errors_inapp:    z.boolean(),
  quiet_start:         z.string().regex(HHMM, 'HH:MM'),
  quiet_end:           z.string().regex(HHMM, 'HH:MM'),
  timezone:            z.string().max(64).refine(validTz, 'unknown time zone'),
}).partial().strict()

/** Merge a stored settings blob over the defaults, dropping bad values. */
export function resolvePrefs(raw: unknown): NotifPrefs {
  const out: NotifPrefs = { ...NOTIF_DEFAULTS }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  for (const k of Object.keys(NOTIF_DEFAULTS) as (keyof NotifPrefs)[]) {
    const v = r[k]
    if (typeof NOTIF_DEFAULTS[k] === 'boolean') { if (typeof v === 'boolean') (out as unknown as Record<string, unknown>)[k] = v }
    else if (k === 'timezone') { if (typeof v === 'string' && validTz(v)) out.timezone = v }
    else if (typeof v === 'string' && HHMM.test(v)) (out as unknown as Record<string, unknown>)[k] = v
  }
  return out
}

const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }

/** Minutes past local midnight in `tz` (falls back to UTC on a bad zone). */
export function localMinutes(now: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
    return h * 60 + m
  } catch { return now.getUTCHours() * 60 + now.getUTCMinutes() }
}

/** True when `now` falls inside the user's quiet window (wraps midnight). */
export function inQuietHours(p: NotifPrefs, now: Date = new Date(), fallbackTz = 'UTC'): boolean {
  if (!HHMM.test(p.quiet_start) || !HHMM.test(p.quiet_end)) return false
  const s = toMin(p.quiet_start), e = toMin(p.quiet_end)
  if (s === e) return false
  const t = localMinutes(now, p.timezone || fallbackTz)
  return s < e ? t >= s && t < e : t >= s || t < e
}

/** Which preference row an alert rule's trigger maps to. */
export type AlertCategory = 'budget' | 'anomaly'
export function categoryFor(trigger: string): AlertCategory {
  return trigger === 'anomaly' ? 'anomaly' : 'budget' // threshold, limit_breach, member, forecast
}

/**
 * Email decision for one user. Critical alerts (a limit at its block level) are
 * "Required" in the settings UI: always emailed, never held by quiet hours.
 */
export function wantsEmail(p: NotifPrefs, cat: AlertCategory, critical: boolean, now: Date, fallbackTz: string): boolean {
  if (critical) return true
  const on = cat === 'anomaly' ? p.anomaly_email : p.budget_breach_email
  return on && !inQuietHours(p, now, fallbackTz)
}

/** In-app decision. Budget alerts have no in-app toggle (always on). */
export function wantsInapp(p: NotifPrefs, cat: AlertCategory, critical: boolean): boolean {
  if (critical || cat === 'budget') return true
  return p.anomaly_inapp
}
