/** @type {import('next').NextConfig} */

// ── Security headers ─────────────────────────────────────────────────────────
// CSP without nonces: Next's inline bootstrap scripts need 'unsafe-inline'.
// Dev additionally needs 'unsafe-eval' (React Refresh) and ws: (HMR).
const isDev = process.env.NODE_ENV !== 'production'

function origin(u) {
  try { return new URL(u).origin } catch { return null }
}

function buildCsp() {
  const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
  const supabaseWs = supabase ? supabase.replace(/^http/, 'ws') : null

  // CAPTCHA (optional, env-driven — see components/auth/captcha.tsx).
  const captcha = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY
    ? ((process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER || 'hcaptcha') === 'turnstile'
        ? ['https://challenges.cloudflare.com']
        : ['https://hcaptcha.com', 'https://*.hcaptcha.com'])
    : []

  const connect = ["'self'", supabase, supabaseWs, 'https://*.supabase.co', 'wss://*.supabase.co', ...captcha]
  if (isDev) connect.push('ws:')
  const script = ["'self'", "'unsafe-inline'", ...captcha]
  if (isDev) script.push("'unsafe-eval'")

  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect.filter(Boolean).join(' ')}`,
    `frame-src ${captcha.length ? captcha.join(' ') : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

const PERMISSIONS_POLICY = [
  'camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()',
  'interest-cohort=()', 'browsing-topics=()',
].join(', ')

const nextConfig = {
  // Standalone server output is for the Docker image only (Vercel doesn't need it).
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' ? 'standalone' : undefined,
  images: { domains: ["avatars.githubusercontent.com", "lh3.googleusercontent.com"] },
  poweredByHeader: false,
  async headers() {
    const common = [
      { key: 'Content-Security-Policy', value: buildCsp() },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
      ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
    ]
    return [
      { source: '/:path*', headers: [...common, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
      // One-time key reveal pages carry the secret token in the path — never leak it via Referer.
      // (Later entries override earlier ones for the same header key.)
      { source: '/keys/reveal/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] },
      { source: '/cli/authorize', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ]
  },
}
module.exports = nextConfig
