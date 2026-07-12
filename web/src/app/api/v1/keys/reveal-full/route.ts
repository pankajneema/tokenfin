import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/api/auth'
import { openKey } from '@/lib/crypto/key-reveal'
import { z } from 'zod'

/**
 * POST /api/v1/keys/reveal-full  { id }
 * Returns the FULL, ready-to-use API key by decrypting the stored ciphertext
 * (migration 022). Admin-only. Keys created before migration 022 have no stored
 * secret → 410 (regenerate to enable copy-anytime).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const parsed = z.object({ id: z.string().uuid() }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'id required' }, { status: 422 })

  const admin = createAdminClient()
  const { data: key } = await admin
    .from('api_keys')
    .select('org_id, key_enc_cipher, key_enc_iv, key_enc_tag')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const guard = await requirePermission(key.org_id, 'keys:view')
  if (guard instanceof NextResponse) return guard

  if (!key.key_enc_cipher || !key.key_enc_iv || !key.key_enc_tag) {
    return NextResponse.json({ error: 'This key was created before copy-anytime. Regenerate it to enable copy.' }, { status: 410 })
  }
  try {
    const raw = openKey({ ciphertext: key.key_enc_cipher, iv: key.key_enc_iv, authTag: key.key_enc_tag })
    return NextResponse.json({ key: raw })
  } catch {
    return NextResponse.json({ error: 'Unable to decrypt key' }, { status: 500 })
  }
}
