import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { z } from 'zod'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function generateApiKey(projectId: string): string {
  const prefix  = 'tf_live_proj'
  const segment = projectId.replace(/-/g, '').slice(0, 4)
  const secret  = crypto.randomBytes(16).toString('hex')
  return `${prefix}_${segment}_${secret}`
}

// GET /api/keys?org_id=xxx
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, is_active, last_used_at, created_at, project_id, projects(name)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/keys  { org_id, project_id, name, created_by }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    org_id:     z.string().uuid(),
    project_id: z.string().uuid(),
    name:       z.string().min(1).max(64),
    created_by: z.string().uuid(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { org_id, project_id, name, created_by } = parsed.data
  const rawKey   = generateApiKey(project_id)
  const keyHash  = crypto.createHash('sha256').update(rawKey).digest('hex')
  const keyPrefix = rawKey.slice(0, 20)

  const { data, error } = await supabase.from('api_keys').insert({
    org_id, project_id, name, created_by, key_hash: keyHash, key_prefix: keyPrefix,
  }).select('id, name, key_prefix, created_at').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Return raw key ONCE — never stored
  return NextResponse.json({ ...data, raw_key: rawKey }, { status: 201 })
}

// PATCH /api/keys  { id, is_active }
export async function PATCH(req: NextRequest) {
  const { id, is_active } = await req.json()
  const { error } = await supabase.from('api_keys').update({ is_active }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/keys?id=xxx
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('api_keys').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
