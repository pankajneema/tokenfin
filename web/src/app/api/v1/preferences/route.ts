import { NextResponse }       from 'next/server'
import type { NextRequest }   from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { dbError } from '@/lib/api/auth'

function db() { return createAdminClient() }

/* GET /api/v1/preferences — returns current user's preferences */
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
  return NextResponse.json(data?.settings ?? {})
}

/* POST /api/v1/preferences — upsert preferences */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = await req.json()

  const { data, error } = await db()
    .from('user_preferences')
    .upsert({ user_id: user.id, settings }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return dbError(error, 'POST preferences')
  return NextResponse.json(data)
}
