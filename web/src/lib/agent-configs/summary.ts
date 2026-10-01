/**
 * Readable summary + warnings for one agent snapshot. Pure (no I/O) — used by
 * the Agents page (server) and unit-tested. The snapshot shape is written by
 * cli/lib/agentconfig.js:
 *
 *   claude_code  { settings, mcp_servers: [{name,type,url?,command?}], statusline_script }
 *   opencode     { settings, plugin_dir: string[], tokenfin_plugin: {installed,ours,version,current}, tokenfin_app_url }
 *   codex_cli    { settings (TOML as JSON), tokenfin_block }
 *   gemini_cli   { settings }
 *   (any)        parse_error — the file exists but could not be parsed
 */
import type { AgentId } from './agents'
import { getPath } from './allowlist'
import { claudeRuleRisk, dirRisk, ocRisk } from './permissions'

export type Severity = 'error' | 'warn' | 'info'
export interface Warning { severity: Severity; text: string; fix?: 'repair' | 'setup' | 'edit' }

export interface HookEntry {
  /** Stable id computed on the machine: sha256(event\0matcher\0command)[:12] */
  id: string; event: string; matcher: string; type: string; command: string; timeout: number | null
  disabled: boolean; tokenfin: boolean
}
export type PermissionsView =
  | { kind: 'claude'; allow: string[]; ask: string[]; deny: string[]; defaultMode: string | null; additionalDirectories: string[] }
  | { kind: 'opencode'; all: string | null; edit: string | null; webfetch: string | null; bash: string | Record<string, string> | null }

export interface AgentSummary {
  permissions:    PermissionsView | null
  hookList:       HookEntry[]
  model:          string | null
  smallModel?:    string | null
  telemetry:      { on: boolean; host: string | null; pointsHere: boolean | null; headers: boolean | null }
  prompts:        boolean | null
  permissionMode: string | null
  plugins:        string[]
  mcp:            { name: string; type: string }[]
  hooks:          number
  statusLine:     'tokenfin' | 'custom' | 'none' | null
  warnings:       Warning[]
  /** Current values of the editable fields, keyed by allow-list path. */
  current:        Record<string, unknown>
}

export interface SummaryContext {
  /** This TokenFin's origin, e.g. https://tokenfin.example.com */
  appUrl:          string
  /** organizations.capture_prompts */
  capturePrompts:  boolean
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const LEGACY_OPENCODE = 'opencode-otel-plugin'
const isRedacted = (v: unknown) => typeof v === 'string' && v.includes('[redacted]')

function hostOf(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).host } catch { return url.slice(0, 80) }
}
function sameOrigin(url: string | null, appUrl: string): boolean | null {
  if (!url) return null
  try { return new URL(url).origin === new URL(appUrl).origin } catch { return false }
}
function countHooks(hooks: unknown): number {
  let n = 0
  for (const entries of Object.values(obj(hooks))) {
    if (!Array.isArray(entries)) continue
    for (const e of entries) n += Array.isArray(obj(e).hooks) ? (obj(e).hooks as unknown[]).length : 1
  }
  return n
}
const isOurStatusline = (sl: unknown) => {
  const c = str(obj(sl).command) ?? ''
  return c.includes('.tokenfin') && c.includes('statusline')
}

export function summarize(agent: AgentId, config: unknown, ctx: SummaryContext): AgentSummary {
  const c = obj(config)
  const s = obj(c.settings)
  const w: Warning[] = []
  if (str(c.parse_error)) w.push({ severity: 'error', text: `The config file could not be parsed on the machine: ${str(c.parse_error)}` })

  const promptWarnings = (prompts: boolean | null) => {
    if (prompts === false && ctx.capturePrompts) w.push({ severity: 'info', text: 'Prompt capture is off on this machine although the workspace allows it — cost is tracked, but prompts won\'t appear in Prompt Analytics.', fix: 'edit' })
    if (prompts === true && !ctx.capturePrompts) w.push({ severity: 'info', text: 'Prompt capture is on here but off for the workspace — TokenFin drops the text on arrival.', fix: 'edit' })
  }
  const endpointWarnings = (t: AgentSummary['telemetry'], what: string) => {
    if (!t.on) { w.push({ severity: 'error', text: `TokenFin telemetry is not configured — no usage from ${what} reaches this workspace.`, fix: 'repair' }); return }
    if (t.pointsHere === false) w.push({ severity: 'error', text: `Telemetry goes to ${t.host ?? 'another endpoint'}, not this TokenFin (${hostOf(ctx.appUrl)}).`, fix: 'repair' })
    if (t.headers === false) w.push({ severity: 'error', text: 'No TokenFin key is sent with the telemetry (OTEL headers missing) — the receiver rejects it.', fix: 'repair' })
  }

  if (agent === 'claude_code') {
    const env = obj(s.env)
    const ep = str(env.OTEL_EXPORTER_OTLP_ENDPOINT)
    const telemetry = {
      on: env.CLAUDE_CODE_ENABLE_TELEMETRY === '1' && !!ep,
      host: hostOf(ep), pointsHere: sameOrigin(ep, ctx.appUrl),
      headers: ep ? !!str(env.OTEL_EXPORTER_OTLP_HEADERS) : null,
    }
    endpointWarnings(telemetry, 'Claude Code')
    if (telemetry.on && env.OTEL_EXPORTER_OTLP_PROTOCOL === 'grpc') w.push({ severity: 'error', text: 'OTLP protocol is grpc — TokenFin\'s receiver needs http/protobuf.', fix: 'repair' })
    if (telemetry.on && env.OTEL_LOGS_EXPORTER !== 'otlp') w.push({ severity: 'error', text: 'OTEL_LOGS_EXPORTER is not "otlp" — per-turn usage comes from logs, so nothing is captured.', fix: 'repair' })
    if (telemetry.on && env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE && env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE !== 'cumulative') {
      w.push({ severity: 'warn', text: 'Metrics temporality is not cumulative — delta metrics may be dropped.', fix: 'repair' })
    }
    const prompts = telemetry.on ? !!env.OTEL_LOG_USER_PROMPTS : null
    promptWarnings(prompts)
    const hooks = Array.isArray(c.hooks_index) ? (c.hooks_index as unknown[]).filter(h => obj(h).disabled !== true).length : countHooks(s.hooks)
    if (JSON.stringify(s.hooks ?? '').includes('record-usage.js')) w.push({ severity: 'error', text: 'The legacy 0.2 Stop hook (record-usage.js) is still installed — it double-counts. Run `npx tokenfin@latest setup` on the machine.', fix: 'setup' })
    const sl = s.statusLine
    const statusLine = !sl ? 'none' : isOurStatusline(sl) ? 'tokenfin' : 'custom'
    if (statusLine === 'tokenfin' && c.statusline_script === false) w.push({ severity: 'warn', text: 'The status line points at ~/.tokenfin/statusline.js, which is missing on the machine.', fix: 'edit' })
    const mode = str(getPath(s, 'permissions.defaultMode'))
    if (mode === 'bypassPermissions') w.push({ severity: 'warn', text: 'Permission mode is bypassPermissions — Claude Code runs every tool without asking.', fix: 'edit' })
    const plugins = Object.entries(obj(s.enabledPlugins)).filter(([, v]) => v === true).map(([k]) => k)
    const mcp = (Array.isArray(c.mcp_servers) ? c.mcp_servers : []).map(m => ({ name: String(obj(m).name ?? '?'), type: String(obj(m).type ?? 'stdio') }))
    const perm = obj(s.permissions)
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    const permissions: PermissionsView = { kind: 'claude', allow: list(perm.allow), ask: list(perm.ask), deny: list(perm.deny), defaultMode: mode, additionalDirectories: list(perm.additionalDirectories) }
    for (const r of permissions.allow) { const risk = claudeRuleRisk(r, 'allow'); if (risk) w.push({ severity: 'warn', text: `Risky allow rule ${r}: ${risk}.`, fix: 'edit' }) }
    for (const d of permissions.additionalDirectories) { const risk = dirRisk(d); if (risk) w.push({ severity: 'warn', text: `Additional directory ${d} ${risk}.`, fix: 'edit' }) }
    const hookList: HookEntry[] = (Array.isArray(c.hooks_index) ? c.hooks_index : []).map(h => {
      const o = obj(h)
      return { id: String(o.id ?? ''), event: String(o.event ?? '?'), matcher: String(o.matcher ?? ''), type: String(o.type ?? 'command'),
        command: String(o.command ?? ''), timeout: typeof o.timeout === 'number' ? o.timeout : null, disabled: o.disabled === true, tokenfin: o.tokenfin === true }
    })
    return {
      permissions, hookList,
      model: str(s.model), telemetry, prompts, permissionMode: mode, plugins, mcp, hooks, statusLine, warnings: w,
      current: {
        model: str(s.model), 'env.OTEL_LOG_USER_PROMPTS': str(env.OTEL_LOG_USER_PROMPTS),
        'permissions.defaultMode': mode, '$tokenfin.statusline': statusLine === 'tokenfin',
      },
    }
  }

  if (agent === 'opencode') {
    const plugin = Array.isArray(s.plugin) ? s.plugin.map(p => String(Array.isArray(p) ? p[0] : p)) : []
    const tp = obj(c.tokenfin_plugin)
    const installed = tp.installed === true && tp.ours !== false
    const appUrl = str(c.tokenfin_app_url)
    const telemetry = { on: installed, host: installed ? hostOf(appUrl) : null, pointsHere: installed ? sameOrigin(appUrl, ctx.appUrl) : null, headers: installed ? c.tokenfin_key_present !== false : null }
    if (plugin.some(p => p === LEGACY_OPENCODE || p.startsWith(LEGACY_OPENCODE + '@'))) {
      w.push({ severity: installed ? 'error' : 'warn', text: installed
        ? 'opencode-otel-plugin is still in the plugin list — it double-counts with the TokenFin plugin.'
        : 'Still using the old opencode-otel-plugin, which drops cache tokens, sessions and prompts. Switch to the TokenFin plugin.', fix: 'repair' })
    }
    if (tp.installed === true && tp.ours === false) w.push({ severity: 'warn', text: 'plugin/tokenfin.js exists but is not the TokenFin plugin.' })
    endpointWarnings(telemetry, 'OpenCode')
    if (installed && tp.current === false) w.push({ severity: 'warn', text: `The TokenFin plugin (v${str(tp.version) ?? '?'}) is outdated.`, fix: 'repair' })
    const mcp = Object.entries(obj(s.mcp)).map(([name, v]) => ({ name, type: String(obj(v).type ?? 'local') }))
    for (const risk of ocRisk(s.permission)) w.push({ severity: 'warn', text: `Risky permission: ${risk}.`, fix: 'edit' })
    const pm = obj(s.permission)
    const bash = typeof pm.bash === 'string' ? pm.bash : pm.bash && typeof pm.bash === 'object' ? Object.fromEntries(Object.entries(pm.bash as Obj).map(([k, v]) => [k, String(v)])) : null
    const permissions: PermissionsView = { kind: 'opencode', all: typeof s.permission === 'string' ? s.permission : null, edit: str(pm.edit), webfetch: str(pm.webfetch), bash }
    return {
      permissions, hookList: [],
      model: str(s.model), smallModel: str(s.small_model), telemetry, prompts: installed ? true : null, permissionMode: null,
      plugins: [...plugin, ...(installed ? [`tokenfin (v${str(tp.version) ?? '?'})`] : [])], mcp, hooks: 0, statusLine: null, warnings: w,
      current: { model: str(s.model), small_model: str(s.small_model), '$tokenfin.plugin': installed },
    }
  }

  if (agent === 'codex_cli') {
    const otel = obj(s.otel)
    const me = otel.metrics_exporter
    const http = obj(obj(me)['otlp-http'])
    const ep = str(http.endpoint)
    const telemetry = { on: !!ep, host: hostOf(ep), pointsHere: sameOrigin(ep, ctx.appUrl), headers: ep ? !!str(obj(http.headers).Authorization) || !!str(obj(http.headers).authorization) : null }
    if (typeof me === 'string') w.push({ severity: 'error', text: `metrics_exporter = "${me}" — Codex sends token metrics to ${me === 'statsig' ? 'OpenAI (statsig)' : me}, not TokenFin.`, fix: 'repair' })
    endpointWarnings(telemetry, 'Codex')
    if (Object.keys(otel).length && c.tokenfin_block === false) w.push({ severity: 'warn', text: 'The [otel] table is hand-written (no TokenFin-managed block) — `tokenfin setup` will not update it.' })
    const prompts = telemetry.on ? otel.log_user_prompt === true : null
    promptWarnings(prompts)
    const mcp = Object.entries(obj(s.mcp_servers)).map(([name, v]) => ({ name, type: str(obj(v).url) ? 'http' : 'stdio' }))
    return {
      permissions: null, hookList: [],
      model: str(s.model), telemetry, prompts, permissionMode: str(s.approval_policy), plugins: [], mcp, hooks: 0, statusLine: null, warnings: w,
      current: { model: str(s.model), 'otel.log_user_prompt': otel.log_user_prompt === true },
    }
  }

  // gemini_cli
  const t = obj(s.telemetry)
  const ep = str(t.otlpEndpoint)
  const telemetry = { on: t.enabled === true && !!ep, host: hostOf(ep), pointsHere: sameOrigin(ep, ctx.appUrl), headers: ep ? /[?&]key=/.test(ep) || isRedacted(ep) : null }
  endpointWarnings(telemetry, 'Gemini CLI')
  if (telemetry.on && t.target && t.target !== 'local') w.push({ severity: 'warn', text: `telemetry.target is "${String(t.target)}" — TokenFin needs "local" with useCollector.`, fix: 'repair' })
  const prompts = telemetry.on ? t.logPrompts !== false : null
  promptWarnings(prompts)
  const model = str(getPath(s, 'model.name')) ?? str(s.model)
  const mcp = Object.entries(obj(s.mcpServers)).map(([name, v]) => ({ name, type: str(obj(v).httpUrl) || str(obj(v).url) ? 'http' : 'stdio' }))
  return {
    permissions: null, hookList: [],
    model, telemetry, prompts, permissionMode: null, plugins: [], mcp, hooks: 0, statusLine: null, warnings: w,
    current: { 'model.name': model, 'telemetry.logPrompts': t.logPrompts !== false },
  }
}
