/** Application-wide constants. Import from here; never hardcode strings inline. */

export const APP_NAME    = 'TokenFin'
export const APP_VERSION = '0.1.0'

// Plans
export const PLANS = ['free', 'starter', 'pro', 'enterprise'] as const

// API
export const API_BASE      = '/api/v1'
export const BACKEND_URL   = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'
export const INGEST_URL    = `${API_BASE}/ingest`

// Limits — default thresholds
export const WARN_AT_PCT     = 0.70
export const THROTTLE_AT_PCT = 0.90
export const BLOCK_AT_PCT    = 1.00

// SDK circuit breaker
export const CIRCUIT_THRESHOLD = 3
export const CIRCUIT_COOLDOWN  = 60_000   // 60 s

// Colours (mirrors CSS vars — for use in Recharts which needs hex)
export const COLOR_ACCENT  = '#E8533A'
export const COLOR_SUCCESS = '#00C48C'
export const COLOR_WARN    = '#F59E0B'

// Models (display names)
export const MODEL_DISPLAY: Record<string, string> = {
  'gpt-4o':              'GPT-4o',
  'gpt-4o-mini':         'GPT-4o mini',
  'gpt-4-turbo':         'GPT-4 Turbo',
  'gpt-3.5-turbo':       'GPT-3.5 Turbo',
  'claude-3-5-sonnet':   'Claude 3.5 Sonnet',
  'claude-3-5-haiku':    'Claude 3.5 Haiku',
  'claude-3-opus':       'Claude 3 Opus',
  'gemini-1.5-pro':      'Gemini 1.5 Pro',
  'gemini-1.5-flash':    'Gemini 1.5 Flash',
  'llama-3-70b':         'Llama 3 70B',
  'mistral-large':       'Mistral Large',
}
