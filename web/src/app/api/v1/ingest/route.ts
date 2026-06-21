/**
 * POST /api/v1/ingest — proxy to the Go ingest service.
 *
 * This Next.js route forwards ingest requests to the Go service running on
 * INGEST_SERVICE_URL (default: http://localhost:8001). The Go service owns
 * authentication, validation, pricing, and stream publishing.
 *
 * SDK and external callers should send:
 *   Authorization: Bearer tf_...
 *   Content-Type: application/json
 *   { model, input_tokens, output_tokens, idempotency_key?, tags?, metadata? }
 *
 * This route intentionally does NOT require a Supabase session — it is
 * authenticated by the Bearer API key handled by the Go service.
 */
import { NextResponse }     from 'next/server'
import type { NextRequest } from 'next/server'

const INGEST_URL = (
  process.env.INGEST_SERVICE_URL ?? 'http://localhost:8001'
).replace(/\/$/, '') + '/v1/ingest'

export async function POST(req: NextRequest) {
  // Forward the Authorization header — never read or log it here
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Authorization header required' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), 5_000)

    const upstream = await fetch(INGEST_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': authHeader,         // pass through opaquely
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    })

    clearTimeout(timer)

    // Return Go service status + body unchanged
    const responseBody = await upstream.text()
    return new NextResponse(responseBody, {
      status:  upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // Don't leak Go service details — log server-side only
    console.error('[ingest proxy] upstream error:', err)
    return NextResponse.json({ error: 'Ingest service unavailable' }, { status: 503 })
  }
}

/* Health check passthrough */
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'ingest-proxy' })
}
