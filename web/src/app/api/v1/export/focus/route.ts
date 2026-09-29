import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission, dbError } from '@/lib/api/auth'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { DEFAULT_TIMEZONE, isValidTimeZone, toZonedDate, shiftDay } from '@/lib/dates'
import { loadMemberTeams, loadRules } from '@/lib/allocation/load'
import { referencedTagKeys } from '@/lib/allocation/apply'
import { focusInputsForDay, type DimsRow, type FocusContext } from '@/lib/focus/aggregate'
import { focusCsvHeader, focusCsvLine, toFocusRow } from '@/lib/focus/map'
import { daysBetween, localMidnightUtc, nextDay } from '@/lib/focus/time'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_DAYS = 400
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/v1/export/focus?org_id=…&from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv
 * FinOps FOCUS 1.2 cost & usage export at daily grain (workspace time zone),
 * one row per day × provider × model × project × source × cost basis × team ×
 * cost center (team/cost center from Settings → Allocation rules). `from`/`to`
 * are inclusive; default is the last 30 days. Streams one day at a time.
 * Owners and admins only.
 */
export async function GET(req: NextRequest) {
  const p     = req.nextUrl.searchParams
  const orgId = p.get('org_id')
  const guard = await requirePermission(orgId, 'members:view')
  if (guard instanceof NextResponse) return guard

  const format = p.get('format') ?? 'csv'
  if (format !== 'csv') return NextResponse.json({ error: 'format must be csv' }, { status: 422 })

  const admin = createAdminClient()
  const { data: org, error: orgErr } = await admin.from('organizations').select('name, timezone').eq('id', orgId!).maybeSingle()
  if (orgErr) return dbError(orgErr, 'GET export/focus org')
  const tzRaw = (org?.timezone as string | undefined) ?? DEFAULT_TIMEZONE
  const tz = isValidTimeZone(tzRaw) ? tzRaw : DEFAULT_TIMEZONE

  const today = toZonedDate(Date.now(), tz)
  const to    = p.get('to') ?? today
  const from  = p.get('from') ?? shiftDay(to, -29)
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json({ error: 'from and to must be YYYY-MM-DD' }, { status: 422 })
  }
  if (from > to) return NextResponse.json({ error: 'from must be on or before to' }, { status: 422 })
  const days = daysBetween(from, to)
  if (days.length > MAX_DAYS) return NextResponse.json({ error: `range too large (max ${MAX_DAYS} days)` }, { status: 422 })

  let ctx: FocusContext
  try {
    const [rules, memberTeam, projects] = await Promise.all([
      loadRules(admin, orgId!),
      loadMemberTeams(admin, orgId!),
      fetchAllRows<{ id: string; name: string }>((a, b) =>
        admin.from('projects').select('id, name').eq('org_id', orgId!).order('id').range(a, b)),
    ])
    ctx = {
      orgId: orgId!, orgName: (org?.name as string | undefined) ?? 'Workspace', tz, rules,
      projectName: new Map(projects.map(r => [r.id, r.name])), memberTeam,
    }
  } catch (e) {
    return dbError(e, 'GET export/focus context')
  }
  const tagKeys = referencedTagKeys(ctx.rules)

  const fetchDay = (day: string) => fetchAllRows<DimsRow>((a, b) =>
    admin.rpc('finops_usage_dims', {
      p_org: orgId, p_from: localMidnightUtc(day, tz), p_to: localMidnightUtc(nextDay(day), tz),
      p_tz: tz, p_tag_keys: tagKeys, p_by_day: true,
    }).range(a, b))

  // Fail before streaming if the RPC is missing (migration 014 not applied).
  let first: DimsRow[]
  try {
    first = await fetchDay(days[0])
  } catch (e) {
    return dbError(e, 'GET export/focus rows')
  }

  const enc = new TextEncoder()
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(focusCsvHeader()))
    },
    // Each pull must enqueue or close — a pull that does neither stalls the
    // stream — so skip over empty days within one pull.
    async pull(controller) {
      try {
        while (i < days.length) {
          const day = days[i]
          const rows = i === 0 ? first : await fetchDay(day)
          i++
          const lines = focusInputsForDay(day, rows, ctx).map(r => focusCsvLine(toFocusRow(r))).join('')
          if (lines) { controller.enqueue(enc.encode(lines)); return }
        }
        controller.close()
      } catch (e) {
        console.error('[API] GET export/focus stream:', e)
        controller.error(new Error('export failed'))
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tokenfin-focus-${from}-to-${to}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
