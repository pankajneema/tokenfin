/**
 * RFC 9728 protected-resource metadata probe. The TokenFin MCP server is
 * bearer-only (API keys) — there is no OAuth authorization server — so answer a
 * fast, cacheable 404 JSON instead of the HTML not-found page. MCP clients then
 * fall back to asking the user for a bearer token.
 */
import { wellKnownNotFound } from '../../_not-found'

export function GET() { return wellKnownNotFound('oauth-protected-resource') }
