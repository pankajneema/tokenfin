import { NextResponse } from 'next/server'

/** Shared 404 for OAuth discovery probes (this deployment has no OAuth server). */
export function wellKnownNotFound(doc: string): NextResponse {
  return NextResponse.json(
    { error: 'not_found', error_description: `No ${doc} metadata: the TokenFin MCP server uses Bearer API keys (Authorization: Bearer tfk_…).` },
    { status: 404, headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
