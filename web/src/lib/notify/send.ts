/**
 * Outbound alert delivery — email (Resend), Slack (incoming webhook), and generic
 * webhook. All senders are FAIL-OPEN: they never throw, and return { sent } so the
 * caller can record what happened. Missing config (no API key / no URL) → skipped,
 * not an error. Server-only.
 *
 * SSRF hardening for user-supplied URLs (Slack + generic webhook):
 *  - https only (http://localhost allowed only when NODE_ENV !== 'production')
 *  - Slack URLs must be on hooks.slack.com
 *  - generic webhooks: every DNS answer must be a public unicast address
 *    (private, loopback, link-local, CGNAT, metadata, multicast, reserved,
 *    IPv4-mapped/NAT64/6to4 are rejected)
 *  - redirects are NOT followed (redirect: 'manual'), 10s timeout
 *
 * Residual risk: DNS is resolved once for validation and again by fetch, so a
 * hostile resolver could in theory rebind between the two (TOCTOU). Pinning the
 * connection to the validated IP would need a custom dispatcher (undici) which
 * this project does not depend on.
 */
import dns from 'dns'
import net from 'net'

const TIMEOUT_MS = 10_000

// ─── IP classification ────────────────────────────────────────────────────────

const blocked = new net.BlockList()
for (const [addr, prefix] of [
  ['0.0.0.0', 8],        // "this" network
  ['10.0.0.0', 8],       // RFC1918
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local (incl. 169.254.169.254 cloud metadata)
  ['172.16.0.0', 12],    // RFC1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.88.99.0', 24],   // 6to4 relay anycast
  ['192.168.0.0', 16],   // RFC1918
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved + broadcast
] as const) blocked.addSubnet(addr, prefix, 'ipv4')
for (const [addr, prefix] of [
  ['::', 128],           // unspecified
  ['::1', 128],          // loopback
  ['64:ff9b::', 96],     // NAT64 (embeds IPv4)
  ['64:ff9b:1::', 48],   // local-use NAT64
  ['100::', 64],         // discard-only
  ['2001:db8::', 32],    // documentation
  ['2002::', 16],        // 6to4 (embeds IPv4)
  ['fc00::', 7],         // unique local (incl. fd00:ec2::254 metadata)
  ['fe80::', 10],        // link-local
  ['fec0::', 10],        // deprecated site-local
  ['ff00::', 8],         // multicast
] as const) blocked.addSubnet(addr, prefix, 'ipv6')

/** True if `ip` is not a public unicast address (or is not an IP at all). */
export function isPrivateAddress(ip: string): boolean {
  const fam = net.isIP(ip)
  if (fam === 4) return blocked.check(ip, 'ipv4')
  if (fam === 6) {
    // IPv4-mapped (::ffff:a.b.c.d / ::ffff:xxxx:xxxx) — never legitimate for a
    // webhook, so reject outright. (Not put in the BlockList: Node matches plain
    // IPv4 addresses against a ::ffff:0:0/96 rule, which would block everything.)
    let canon = ip.toLowerCase()
    try { canon = new URL(`http://[${ip}]/`).hostname.slice(1, -1) } catch { return true }
    if (/^::ffff:/.test(canon) || /^0:0:0:0:0:ffff:/.test(canon)) return true
    return blocked.check(ip, 'ipv6')
  }
  return true
}

// ─── URL validation ───────────────────────────────────────────────────────────

export type UrlKind = 'slack' | 'webhook'
export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string }

const isDev = () => process.env.NODE_ENV !== 'production'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Synchronous format check (no DNS). Use at config-save time; send time also
 * runs the async DNS check in validateOutboundUrl.
 */
export function checkUrlFormat(raw: string, kind: UrlKind): UrlCheck {
  let url: URL
  try { url = new URL(raw) } catch { return { ok: false, reason: 'invalid URL' } }
  if (url.username || url.password) return { ok: false, reason: 'credentials in URL are not allowed' }

  const host = url.hostname.toLowerCase()
  const devLocal = isDev() && url.protocol === 'http:' && LOCAL_HOSTS.has(host)
  if (url.protocol !== 'https:' && !devLocal) return { ok: false, reason: 'URL must use https' }

  if (kind === 'slack') {
    if (host !== 'hooks.slack.com' || (url.port && url.port !== '443'))
      return { ok: false, reason: 'Slack webhook must be on https://hooks.slack.com' }
    return { ok: true, url }
  }

  if (devLocal) return { ok: true, url }
  // Literal IPs are checked right away; hostnames are checked after DNS.
  const literal = host.startsWith('[') ? host.slice(1, -1) : host
  if (net.isIP(literal) && isPrivateAddress(literal)) return { ok: false, reason: 'destination address is not allowed' }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local'))
    return { ok: false, reason: 'destination host is not allowed' }
  return { ok: true, url }
}

/** Full check: format + (for generic webhooks) DNS resolution of every answer. */
export async function validateOutboundUrl(raw: string, kind: UrlKind): Promise<UrlCheck> {
  const fmt = checkUrlFormat(raw, kind)
  if (!fmt.ok || kind === 'slack') return fmt
  const url = fmt.url
  const host = url.hostname.toLowerCase()
  if (isDev() && url.protocol === 'http:' && LOCAL_HOSTS.has(host)) return fmt

  const literal = host.startsWith('[') ? host.slice(1, -1) : host
  if (net.isIP(literal)) return fmt   // already classified in checkUrlFormat

  let answers: { address: string }[]
  try {
    answers = await dns.promises.lookup(literal, { all: true, verbatim: true })
  } catch {
    return { ok: false, reason: 'could not resolve host' }
  }
  if (answers.length === 0) return { ok: false, reason: 'could not resolve host' }
  if (answers.some(a => isPrivateAddress(a.address)))
    return { ok: false, reason: 'destination resolves to a private or reserved address' }
  return fmt
}

async function safePost(url: URL, body: string): Promise<Response> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      method:   'POST',
      headers:  { 'Content-Type': 'application/json' },
      body,
      redirect: 'manual',
      signal:   ctrl.signal,
      cache:    'no-store',
    })
  } finally {
    clearTimeout(timer)
  }
}

// ─── Senders ──────────────────────────────────────────────────────────────────

export async function sendEmail(to: string[], subject: string, text: string): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.ALERT_EMAIL_FROM || 'TokenFin <alerts@tokenfin.curiousdevs.com>'
  const recipients = to.filter(Boolean)
  if (!key) return { sent: false, reason: 'RESEND_API_KEY not set' }
  if (recipients.length === 0) return { sent: false, reason: 'no recipients' }
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, text }),
      signal: ctrl.signal,
    })
    return { sent: res.ok, reason: res.ok ? undefined : `resend ${res.status}` }
  } catch (e) { return { sent: false, reason: (e as Error).message } }
  finally { clearTimeout(timer) }
}

export async function sendSlack(webhookUrl: string | null | undefined, text: string): Promise<{ sent: boolean; reason?: string }> {
  if (!webhookUrl) return { sent: false, reason: 'no slack webhook' }
  const check = await validateOutboundUrl(webhookUrl, 'slack')
  if (!check.ok) return { sent: false, reason: `blocked: ${check.reason}` }
  try {
    const res = await safePost(check.url, JSON.stringify({ text }))
    return { sent: res.ok, reason: res.ok ? undefined : `slack ${res.status}` }
  } catch (e) { return { sent: false, reason: (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message } }
}

export async function sendWebhook(url: string | null | undefined, payload: unknown): Promise<{ sent: boolean; reason?: string }> {
  if (!url) return { sent: false, reason: 'no webhook url' }
  const check = await validateOutboundUrl(url, 'webhook')
  if (!check.ok) return { sent: false, reason: `blocked: ${check.reason}` }
  try {
    const res = await safePost(check.url, JSON.stringify(payload))
    return { sent: res.ok, reason: res.ok ? undefined : `webhook ${res.status}` }
  } catch (e) { return { sent: false, reason: (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message } }
}
