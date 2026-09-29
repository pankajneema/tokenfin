import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import path from 'path'
import { claudeEnv, codexToml, geminiTelemetry, managedSettings, TEAM_PLACEHOLDER } from './_snippets'

// The page's snippets must be byte-identical to what `npx tokenfin setup` writes.
const require_ = createRequire(import.meta.url)
const cli = require_(path.resolve(__dirname, '../../../../../../cli/lib/otel.js'))
const EP = 'https://tokenfin.example/api/otel'
const KEY = 'tfk_prod_abcd_0123456789abcdef0123456789abcdef'

describe('setup snippets ↔ CLI parity', () => {
  for (const prompts of [true, false]) {
    it(`Claude env (prompts=${prompts})`, () => {
      expect(claudeEnv(EP, KEY, { prompts })).toEqual(cli.otelEnv(EP, KEY, { prompts }))
    })
    it(`Codex TOML (prompts=${prompts})`, () => {
      expect(codexToml(EP, KEY, { prompts })).toBe(cli.codexOtelToml(EP, KEY, { prompts }))
    })
    it(`Gemini telemetry (prompts=${prompts})`, () => {
      expect(geminiTelemetry(EP, KEY, { prompts })).toEqual(cli.geminiTelemetry(EP, KEY, { prompts }))
    })
  }
  it('Codex TOML never carries a metrics_exporter string next to the table', () => {
    expect(codexToml(EP, KEY)).not.toMatch(/^\s*metrics_exporter\s*=/m)
  })
})

describe('managedSettings', () => {
  it('embeds the ingest key, team placeholder and prompt policy', () => {
    const on = managedSettings(EP, KEY)
    expect(on.env.OTEL_EXPORTER_OTLP_HEADERS).toBe('Authorization=Bearer ' + KEY)
    expect(on.env.OTEL_RESOURCE_ATTRIBUTES).toBe('team.name=' + TEAM_PLACEHOLDER)
    expect(on.env.OTEL_LOG_USER_PROMPTS).toBe('1')
    const off = managedSettings(EP, KEY, { prompts: false, team: 'platform eng,x=y' })
    expect(off.env).not.toHaveProperty('OTEL_LOG_USER_PROMPTS')
    expect(off.env.OTEL_RESOURCE_ATTRIBUTES).toBe('team.name=platform_eng_x_y')
  })
})
