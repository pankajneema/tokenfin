import { NextResponse }       from 'next/server'
import type { NextRequest }   from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { dbError } from '@/lib/api/auth'
import { NotifPrefsSchema, resolvePrefs } from '@/lib/alerts/prefs'

function db() { return createAdminClient() }

/**
 * Notification preferences live in ONE row per user: user_preferences.settings
 * (JSONB), keyed exactly as NotifPrefs in lib/alerts/prefs.ts. The alert engine
 * and weekly digest read the same row via resolvePrefs(), so what the settings
 * page saves is what delivery honours.
 */

/* GET /api/v1/preferences — current user's effective preferences (defaults applied) */
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await db()
    .from('user_preferences')
    .select('settings')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return dbError(error, 'GET preferences')
  return NextResponse.json(resolvePrefs(data?.settings))
}

/* POST (or PATCH) /api/v1/preferences — validate and merge into stored settings */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = NotifPrefsSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const admin = db()
  const { data: existing, error: readErr } = await admin
    .from('user_preferences').select('settings').eq('user_id', user.id).maybeSingle()
  if (readErr) return dbError(readErr, 'POST preferences')

  const settings = { ...((existing?.settings as Record<string, unknown> | null) ?? {}), ...parsed.data }
  const { error } = await admin
    .from('user_preferences')
    .upsert({ user_id: user.id, settings }, { onConflict: 'user_id' })

  if (error) return dbError(error, 'POST preferences')
  return NextResponse.json(resolvePrefs(settings))
}

export const PATCH = POST
