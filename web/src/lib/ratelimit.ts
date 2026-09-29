/**
 * Rate limiting for API routes.
 *
 * Uses Upstash Redis with a sliding window algorithm.
 * Falls back to "allow" when UPSTASH_REDIS_REST_URL is not configured
 * so dev environments never break.
 *
 * Usage:
 *   const result = await rateLimit(apiKeyId)
 *   if (!result.allowed) return rateLimitResponse(result)
 */

import { Ratelimit }  from '@upstash/ratelimit'
import { Redis }      from '@upstash/redis'

/* ── Optional abuse guard (requests per minute, per API key) ──────────────────
 * TokenFin monitoring is free and unlimited, so there are no per-plan limits.
 * Operators can opt into a burst guard with TOKENFIN_ENFORCE_RATE_LIMITS=1 and
 * tune it with TOKENFIN_RATE_LIMIT_PER_MIN (default 600).
 */
const LIMIT_PER_MIN = Math.max(1, Number(process.env.TOKENFIN_RATE_LIMIT_PER_MIN) || 600)

/* ── Result type ────────────────────────────────────────────────────────────── */
export interface RateLimitResult {
  allowed:   boolean
  limit:     number
  remaining: number
  resetAt:   number   // unix ms
  retryAfter: number  // seconds
}

/* ── Redis + limiter singletons ─────────────────────────────────────────────── */
let redis: Redis | null = null

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null
  if (!redis) {
    redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
    })
  }
  return redis
}

let limiter: Ratelimit | null = null
function getLimiter(): Ratelimit | null {
  const r = getRedis()
  if (!r) return null
  if (!limiter) {
    limiter = new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(LIMIT_PER_MIN, '1 m'), prefix: 'tf:rl' })
  }
  return limiter
}

/* ── Main function ──────────────────────────────────────────────────────────── */
export async function rateLimit(apiKeyId: string): Promise<RateLimitResult> {
  if (process.env.TOKENFIN_ENFORCE_RATE_LIMITS !== '1') {
    return { allowed: true, limit: Number.MAX_SAFE_INTEGER, remaining: Number.MAX_SAFE_INTEGER, resetAt: 0, retryAfter: 0 }
  }
  const limiter = getLimiter()
  const maxReqs = LIMIT_PER_MIN

  // No Redis configured → fail open (allow everything, log in dev)
  if (!limiter) {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[ratelimit] Upstash not configured — skipping rate limit check')
    }
    return { allowed: true, limit: maxReqs, remaining: maxReqs, resetAt: 0, retryAfter: 0 }
  }

  try {
    const { success, limit, remaining, reset } = await limiter.limit(`key:${apiKeyId}`)
    return {
      allowed:    success,
      limit,
      remaining:  Math.max(0, remaining),
      resetAt:    reset,
      retryAfter: success ? 0 : Math.ceil((reset - Date.now()) / 1_000),
    }
  } catch (err) {
    // Redis error → fail open, never block legitimate traffic
    console.error('[ratelimit] Redis error, failing open:', err)
    return { allowed: true, limit: maxReqs, remaining: maxReqs, resetAt: 0, retryAfter: 0 }
  }
}

/* ── Response helper ────────────────────────────────────────────────────────── */
import { NextResponse } from 'next/server'

export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      error:      'Rate limit exceeded.',
      message:    `Too many requests in a short burst. Please retry after ${result.retryAfter} seconds.`,
      retry_after: result.retryAfter,
      reset_at:   new Date(result.resetAt).toISOString(),
    },
    {
      status: 429,
      headers: {
        'Retry-After':          result.retryAfter.toString(),
        'X-RateLimit-Limit':    result.limit.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset':    result.resetAt.toString(),
      },
    }
  )
}
