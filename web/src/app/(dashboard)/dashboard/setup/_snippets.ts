/**
 * Config snippets shown on the Connections page and served by
 * /api/v1/setup/managed-settings. Pure (no server/client-only imports).
 *
 * MUST stay identical to what the CLI writes (cli/lib/otel.js) — the
 * _snippets.test.ts parity test compares them byte for byte. In particular the
 * Codex TOML must NOT contain `metrics_exporter = "otlp-http"`: next to the
 * [otel.metrics_exporter.otlp-http] table it is invalid TOML and Codex
 * refuses to start.
 */

export interface SnippetOpts { prompts?: boolean }

/** Claude Code `env` block (~/.claude/settings.json or managed-settings.json). */
export function claudeEnv(otelEndpoint: string, key: string, opts: SnippetOpts = {}): Record<string, string> {
  const env: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_EXPORTER_OTLP_ENDPOINT: otelEndpoint,
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer ' + key,
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'cumulative',
  }
  if (opts.prompts !== false) env.OTEL_LOG_USER_PROMPTS = '1'
  env.OTEL_METRICS_INCLUDE_REPOSITORY = '1'
  return env
}

/** Codex `[otel]` TOML body — identical to cli/lib/otel.js codexOtelToml(). */
export function codexToml(otelEndpoint: string, key: string, opts: SnippetOpts = {}): string {
  return [
    '[otel]',
    'environment = "prod"',
    'exporter = "none"',
    'log_user_prompt = ' + (opts.prompts === false ? 'false' : 'true'),
    '',
    '[otel.metrics_exporter.otlp-http]',
    `endpoint = "${otelEndpoint}/v1/metrics"`,
    'protocol = "json"',
    '',
    '[otel.metrics_exporter.otlp-http.headers]',
    `Authorization = "Bearer ${key}"`,
  ].join('\n')
}

/** Gemini `telemetry` block — identical to cli/lib/otel.js geminiTelemetry(). */
export function geminiTelemetry(otelEndpoint: string, key: string, opts: SnippetOpts = {}) {
  return {
    enabled: true,
    target: 'local',
    useCollector: true,
    otlpProtocol: 'http',
    otlpEndpoint: `${otelEndpoint}?key=${key}`,
    logPrompts: opts.prompts !== false,
  }
}

export const TEAM_PLACEHOLDER = 'REPLACE_WITH_TEAM'

/**
 * managed-settings.json for fleet rollout. Claude Code reads it (highest
 * precedence, users can't override) from:
 *   macOS   /Library/Application Support/ClaudeCode/managed-settings.json
 *   Linux   /etc/claude-code/managed-settings.json   (also WSL)
 *   Windows C:\Program Files\ClaudeCode\managed-settings.json
 * or as a drop-in under managed-settings.d/ next to it. Uses ONE org ingest
 * key; per-developer attribution comes from the user.email Claude Code puts
 * on every event. `team.name` lands in usage_events tags for cost allocation.
 */
export function managedSettings(otelEndpoint: string, ingestKey: string, opts: SnippetOpts & { team?: string } = {}): { env: Record<string, string> } {
  const team = (opts.team ?? '').replace(/[,=\s]/g, '_').slice(0, 64) || TEAM_PLACEHOLDER
  return {
    env: {
      ...claudeEnv(otelEndpoint, ingestKey, opts),
      OTEL_RESOURCE_ATTRIBUTES: `team.name=${team}`,
    },
  }
}

export const MANAGED_PATHS = {
  macos: '/Library/Application Support/ClaudeCode/managed-settings.json',
  linux: '/etc/claude-code/managed-settings.json',
  windows: 'C:\\Program Files\\ClaudeCode\\managed-settings.json',
} as const
