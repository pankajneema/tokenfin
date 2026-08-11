/**
 * Setup display helpers.
 *
 * Usage now reaches TokenFin exactly one way for CLI agents: the tool's native
 * OpenTelemetry export pushes token usage to our OTLP receiver (/api/otel). No
 * hooks, no proxy, no record tool. This module only holds the small display
 * helpers still shared with the Connected Platforms page (/dashboard/mcp).
 */

export type Tier     = 'hook' | 'proxy' | 'rule' | 'code'
export type Accuracy = 'exact' | 'estimated'

// ── badge meta (semantic, SEPARATE from the coral accent) ────────────────────
export const TIER_META: Record<Tier, { label: string; cls: string }> = {
  hook:  { label: 'Hook',      cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]' },
  proxy: { label: 'Gateway',   cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]' },
  rule:  { label: 'Rule',      cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]' },
  code:  { label: 'Telemetry', cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]' },
}

export const ACCURACY_META: Record<Accuracy, { label: string; cls: string; dot: string }> = {
  exact:     { label: 'Exact',     cls: 'bg-[var(--green-bg)] text-teal',           dot: 'var(--teal)'  },
  estimated: { label: 'Estimated', cls: 'bg-[var(--amber-bg)] text-[var(--amber)]', dot: 'var(--amber)' },
}

const OTLP_SOURCES = new Set(['claude_code', 'codex_cli', 'gemini_cli', 'opencode'])

/**
 * Best-effort inference of a connected key's recorder tier + accuracy for the
 * Connected Platforms page. `sources` — the actual `usage_events.source`
 * values this key has recorded — is the ground truth and checked first: it's
 * set by the OTLP receiver's own detection (otlp/mapping.ts), not guessed.
 * The key name is only a fallback for keys with no events yet (e.g. right
 * after `tokenfin login`, before setup's first real event lands) — and it's
 * a weak one, since `login` names keys after the machine hostname by
 * default ("pnkj.local"), which rarely contains "claude"/"codex"/"gemini".
 */
export function inferConnection(name: string, models: string[], sources: string[] = []): { tier: Tier | null; accuracy: Accuracy | null } {
  if (sources.some(s => OTLP_SOURCES.has(s))) return { tier: 'code', accuracy: 'exact' }

  const n = (name || '').toLowerCase()
  if (n.includes('claude') || n.includes('codex') || n.includes('gemini') || n.includes('opencode')) {
    return { tier: 'code', accuracy: 'exact' }
  }
  // setup-hub / test keys record through the exact server path.
  if (n.includes('setup') || models.includes('setup-test')) return { tier: 'code', accuracy: 'exact' }
  return { tier: null, accuracy: null }
}
