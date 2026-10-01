import { describe, it, expect } from 'vitest'
import { parseMeta, parseToolCall, sessionContextFromLogs } from './session-meta'
import { attrsToMap } from './otlp/attrs'
import { detectSource } from './otlp/mapping'

const kv = (key: string, v: unknown) => ({ key, value: typeof v === 'number' ? { intValue: v } : { stringValue: String(v) } })

describe('parseMeta / parseToolCall (untrusted input)', () => {
  it('accepts a Claude Code SessionStart hook payload and trims fields', () => {
    const m = parseMeta({ session_id: 'abc', event: 'start', agent: 'claude_code', cwd: '/Users/dev/app', git_branch: 'main',
      repo: 'acme/app', hostname: 'mbp', start_source: 'startup', at: '2026-09-30T10:00:00Z', user_email: 'Dev@Acme.com' })
    expect(m).toMatchObject({ session_id: 'abc', event: 'start', cwd: '/Users/dev/app', user_email: 'dev@acme.com', at: '2026-09-30T10:00:00.000Z' })
  })
  it('rejects events without a session or with an unknown event type', () => {
    expect(parseMeta({ event: 'start' })).toBeNull()
    expect(parseMeta({ session_id: 'a', event: 'explode' })).toBeNull()
    expect(parseMeta(null)).toBeNull()
  })
  it('tool calls: redacts error text, clamps duration, requires key + tool', () => {
    const t = parseToolCall({ event_key: 'k1', session_id: 's', tool: 'Bash', success: 'false', duration_ms: 1234.6, error: 'failed with sk-ant-api03-' + 'x'.repeat(40) })
    expect(t).toMatchObject({ tool: 'Bash', success: false, duration_ms: 1235 })
    expect(t!.error).not.toContain('sk-ant-api03')
    expect(parseToolCall({ session_id: 's', tool: 'Bash' })).toBeNull()
  })
})

describe('sessionContextFromLogs (Claude Code / Cowork OTLP)', () => {
  const T = '1790000000000000000'
  const body = {
    resourceLogs: [{
      resource: { attributes: [kv('service.name', 'claude-code'), kv('service.version', '2.1.9'), kv('host.name', 'mbp')] },
      scopeLogs: [{ logRecords: [
        { timeUnixNano: T, eventName: 'claude_code.api_request', attributes: [kv('session.id', 's1'), kv('user.email', 'Dev@acme.com'), kv('model', 'x')] },
        { timeUnixNano: T, eventName: 'claude_code.tool_result', attributes: [kv('session.id', 's1'), kv('prompt.id', 'p1'), kv('event.sequence', 7),
          kv('tool_name', 'mcp__github__search'), kv('success', 'true'), kv('duration_ms', 842), kv('decision_type', 'accept'),
          kv('tool_parameters', JSON.stringify({ mcp_server_name: 'github', mcp_tool_name: 'search' })), kv('tool_input', '{"secret":"do not store"}')] },
        { timeUnixNano: T, eventName: 'claude_code.tool_result', attributes: [kv('session.id', 's1'), kv('event.sequence', 8), kv('tool_name', 'Bash'), kv('success', 'false'), kv('error', 'exit 1')] },
      ] }],
    }],
  }
  it('one "seen" meta per session with agent, version and host', () => {
    const { metas } = sessionContextFromLogs(body, attrsToMap, detectSource)
    expect(metas).toHaveLength(1)
    expect(metas[0]).toMatchObject({ session_id: 's1', event: 'seen', agent: 'claude_code', agent_version: '2.1.9', hostname: 'mbp', user_email: 'dev@acme.com' })
  })
  it('tool calls keyed by session + sequence (replay-safe), MCP server parsed, inputs never kept', () => {
    const { tools } = sessionContextFromLogs(body, attrsToMap, detectSource)
    expect(tools.map(t => t.event_key)).toEqual(['s1:7', 's1:8'])
    expect(tools[0]).toMatchObject({ tool: 'mcp__github__search', mcp_server: 'github', success: true, duration_ms: 842, decision: 'accept', prompt_id: 'p1' })
    expect(tools[1]).toMatchObject({ tool: 'Bash', success: false, error: 'exit 1' })
    expect(JSON.stringify(tools)).not.toContain('do not store')
  })
  it('Cowork: workspace.host_paths becomes the working directory', () => {
    const cw = { resourceLogs: [{ resource: { attributes: [kv('service.name', 'cowork')] }, scopeLogs: [{ logRecords: [
      { timeUnixNano: T, eventName: 'api_request', attributes: [kv('session.id', 'c1'), { key: 'workspace.host_paths', value: { arrayValue: { values: [{ stringValue: '/Users/dev/Docs' }] } } }] },
    ] }] }] }
    expect(sessionContextFromLogs(cw, attrsToMap, detectSource).metas[0]).toMatchObject({ agent: 'cowork', cwd: '/Users/dev/Docs' })
  })
})
