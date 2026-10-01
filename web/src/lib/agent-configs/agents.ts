/**
 * The coding agents whose USER-level config the CLI collects (`tokenfin config
 * push`). Agent ids equal usage_events.source values, so a snapshot joins
 * straight onto telemetry. Pure — safe in client components.
 */
export type AgentId = 'claude_code' | 'opencode' | 'codex_cli' | 'gemini_cli'

export const AGENT_IDS: readonly AgentId[] = ['claude_code', 'opencode', 'codex_cli', 'gemini_cli']

export const AGENT_META: Record<AgentId, { label: string; file: string; format: 'json' | 'toml' }> = {
  claude_code: { label: 'Claude Code', file: '~/.claude/settings.json',          format: 'json' },
  opencode:    { label: 'OpenCode',    file: '~/.config/opencode/opencode.json', format: 'json' },
  codex_cli:   { label: 'Codex CLI',   file: '~/.codex/config.toml',             format: 'toml' },
  gemini_cli:  { label: 'Gemini CLI',  file: '~/.gemini/settings.json',          format: 'json' },
}

export const isAgentId = (v: unknown): v is AgentId => typeof v === 'string' && (AGENT_IDS as readonly string[]).includes(v)

/** device_id as minted by the CLI (config.js ensureDeviceId). */
export const DEVICE_ID_RE = /^[A-Za-z0-9-]{8,64}$/
