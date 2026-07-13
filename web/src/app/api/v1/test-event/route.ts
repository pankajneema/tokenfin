import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { requireOrgMember } from '@/lib/api/auth'
import { getOrCreateSetupKey } from '@/lib/setup/key'
import { runTool } from '@/lib/mcp/run'
import type { KeyCtx } from '@/lib/mcp/types'
import { z } from 'zod'

/**
 * POST /api/v1/test-event  { org_id }
 *
 * Fires one real record_usage server-side (model "setup-test") through the exact
 * same write path the MCP tool uses, attributed to the org's setup-hub key. Lets
 * a user prove the pipeline end-to-end before their AI tool is wired up — the
 * verify bar lights up the moment this lands. Session-authenticated (org member).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const parsed = z.object({ org_id: z.string().uuid() }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'org_id required' }, { status: 422 })

  const guard = await requireOrgMember(parsed.data.org_id)
  if (guard instanceof NextResponse) return guard

  try {
    const key = await getOrCreateSetupKey(parsed.data.org_id, guard.userId)
    const ctx: KeyCtx = {
      keyId: key.id,
      orgId: parsed.data.org_id,
      projectId: key.projectId,
      userId: guard.userId,
      scopes: ['read', 'write'],
    }
    const result = await runTool('record_usage', {
      model: 'setup-test',
      input_tokens: 100,
      output_tokens: 50,
      // Unique id per click so repeated tests each record (not deduped).
      event_id: `setup-test-${crypto.randomUUID()}`,
    }, ctx)
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    console.error('[test-event] failed:', e)
    return NextResponse.json({ error: 'Could not send test event' }, { status: 500 })
  }
}
