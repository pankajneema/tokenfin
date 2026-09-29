/** RFC 8414 authorization-server metadata probe — bearer-only server, see ../../_not-found.ts. */
import { wellKnownNotFound } from '../../_not-found'

export function GET() { return wellKnownNotFound('oauth-authorization-server') }
