/**
 * Rate limiting for API routes.
 *
 * Uses Upstash Redis with a sliding window algorithm.
 * Falls back to "allow" when UPSTASH_REDIS_REST_URL is not configured
 * so dev environments never break.
 *
 * Usage:
 *   const result = await rateLimit(apiKeyId, orgPlan)
 *   if (!result.allowed) return rateLimitResponse(result)
 */

import { Ratelimit }  from '@upstash/ratelimit'
import { Redis }      from '@upstash/redis'

/* ── Per-plan limits (requests per minute) ─────────────────────────────────── */
export const PLAN_LIMITS: Record<string, number> = {
  free:       60,
  pro:        300,
  enterprise: 2_000,
}

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
const limiters = new Map<string, Ratelimit>()

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

function getLimiter(plan: string): Ratelimit | null {
  const r = getRedis()
  if (!r) return null

  if (!limiters.has(plan)) {
    limiters.set(plan, new Ratelimit({
      redis:   r,
      limiter: Ratelimit.slidingWindow(PLAN_LIMITS[plan] ?? PLAN_LIMITS.free, '1 m'),
      prefix:  `tf:rl:${plan}`,
    }))
  }
  return limiters.get(plan)!
}

/* ── Main function ──────────────────────────────────────────────────────────── */
export async function rateLimit(
  apiKeyId: string,
  plan = 'free',
): Promise<RateLimitResult> {
  const limiter = getLimiter(plan)
  const maxReqs = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

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
      message:    `Too many requests. You can send up to ${result.limit} events per minute on your current plan.`,
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
