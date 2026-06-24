/**
 * TokenFin MCP Server
 * ───────────────────
 * Exposes TokenFin as a set of MCP tools so any MCP-compatible AI tool
 * (Claude Desktop, Cursor, OpenCode, Claude CLI, Windsurf, etc.) can
 * track usage and query cost data directly — no code integration needed.
 *
 * Tools:
 *   track_usage       — log a model call (tokens + cost auto-computed)
 *   get_spending      — current-period cost, tokens, requests
 *   check_limits      — budget status with % used
 *   list_projects     — available TokenFin projects to tag usage against
 *   get_top_models    — model breakdown for last 30 days
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z }         from 'zod'
import { TokenFinApiClient } from './client.js'

/* ── Pricing table (for display only — actual cost stored in DB at ingest) ── */
const PRICE: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8':           { in: 15.00, out: 75.00 },
  'claude-sonnet-4-6':         { in:  3.00, out: 15.00 },
  'claude-haiku-4-5-20251001': { in:  0.80, out:  4.00 },
  'claude-haiku-4-5':          { in:  0.80, out:  4.00 },
  'gpt-4o':                    { in:  2.50, out: 10.00 },
  'gpt-4o-mini':               { in:  0.15, out:  0.60 },
  'gpt-4-turbo':               { in: 10.00, out: 30.00 },
  'gpt-3.5-turbo':             { in:  0.50, out:  1.50 },
  'gemini-1.5-pro':            { in:  1.25, out:  5.00 },
  'gemini-1.5-flash':          { in:  0.075, out: 0.30 },
}

function estimateCost(model: string, inputTok: number, outputTok: number): number {
  const p = PRICE[model] ?? { in: 2.00, out: 8.00 }
  return (inputTok * p.in + outputTok * p.out) / 1_000_000
}

function fmtCost(n: number)   { return `$${n.toFixed(4)}` }
function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/* ════════════════════════════════════════════════════════════ */

export function createTokenFinServer(client: TokenFinApiClient): McpServer {
  const server = new McpServer({
    name:    'tokenfin',
    version: '0.1.0',
  })

  /* ──────────────────────────────────────────────────────────
     TOOL: track_usage
     Call this after every LLM interaction to record tokens + cost
  ────────────────────────────────────────────────────────── */
  server.tool(
    'track_usage',
    'Track an LLM model call in TokenFin. Call this after every AI interaction to log tokens and cost to your dashboard.',
    {
      model: z.string().describe(
        'Model identifier, e.g. "claude-sonnet-4-6", "gpt-4o", "gemini-1.5-flash"'
      ),
      input_tokens: z.number().int().positive().describe(
        'Number of input / prompt tokens consumed'
      ),
      output_tokens: z.number().int().positive().describe(
        'Number of output / completion tokens produced'
      ),
      project_id: z.string().optional().describe(
        'Optional TokenFin project ID to attribute this usage to. Use list_projects to get IDs.'
      ),
      tags: z.record(z.string(), z.string()).optional().describe(
        'Optional key-value labels, e.g. { "feature": "chat", "env": "prod" }'
      ),
    },
    async ({ model, input_tokens, output_tokens, project_id, tags }) => {
      try {
        const result = await client.trackUsage({
          model,
          inputTokens:  input_tokens,
          outputTokens: output_tokens,
          projectId:    project_id,
          tags:         { ...tags, source: 'mcp' },
          metadata:     { tracked_via: 'tokenfin-mcp' },
        })

        const totalTok = input_tokens + output_tokens
        const costEst  = estimateCost(model, input_tokens, output_tokens)

        return {
          content: [{
            type: 'text',
            text: [
              `✅ Usage tracked in TokenFin`,
              ``,
              `  Model:   ${model}`,
              `  Tokens:  ${fmtTokens(input_tokens)} in + ${fmtTokens(output_tokens)} out = ${fmtTokens(totalTok)} total`,
              `  Cost:    ${fmtCost(result.cost_usd ?? costEst)}`,
              `  Bucket:  ${result.bucket}`,
              `  Source:  ${result.source ?? 'direct'}`,
            ].join('\n'),
          }],
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          content: [{ type: 'text', text: `❌ Failed to track usage: ${msg}` }],
          isError: true,
        }
      }
    }
  )

  /* ──────────────────────────────────────────────────────────
     TOOL: get_spending
     Current period cost + token summary
  ────────────────────────────────────────────────────────── */
  server.tool(
    'get_spending',
    'Get your current LLM spend summary from TokenFin — total cost, tokens, requests and per-model breakdown for the last 30 days.',
    async () => {
      try {
        const data = await client.getSpending()

        const modelLines = (data.byModel ?? [])
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 8)
          .map(m =>
            `  ${m.model.padEnd(32)} ${fmtCost(m.cost).padStart(8)}  ${fmtTokens(m.tokens).padStart(8)} tok  ${m.requests} req`
          )

        return {
          content: [{
            type: 'text',
            text: [
              `📊 TokenFin — Spending (last 30 days)`,
              ``,
              `  Total cost:     ${fmtCost(data.totalCost)}`,
              `  Total tokens:   ${fmtTokens(data.totalTokens)}`,
              `  Total requests: ${data.totalRequests}`,
              ``,
              `  By model:`,
              ...modelLines,
            ].join('\n'),
          }],
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          content: [{ type: 'text', text: `❌ Failed to fetch spending: ${msg}` }],
          isError: true,
        }
      }
    }
  )

  /* ──────────────────────────────────────────────────────────
     TOOL: check_limits
     Budget status — how close are you to your limits?
  ────────────────────────────────────────────────────────── */
  server.tool(
    'check_limits',
    'Check your TokenFin budget limits and how close you are to hitting them.',
    async () => {
      try {
        const [limits, budget] = await Promise.allSettled([
          client.getLimits(),
          client.getBudget(),
        ])

        const lines: string[] = ['💰 TokenFin — Budget & Limits', '']

        // Budget summary
        if (budget.status === 'fulfilled' && budget.value?.budget_usd > 0) {
          const b = budget.value
          const bar = buildBar(b.pct_used)
          lines.push(
            `  Budget:   ${fmtCost(b.spent_usd)} / ${fmtCost(b.budget_usd)} (${b.pct_used.toFixed(1)}%)`,
            `  Progress: ${bar}`,
            `  Period:   ${b.period}`,
            ''
          )
        }

        // Limit rules
        if (limits.status === 'fulfilled' && limits.value?.length > 0) {
          lines.push('  Active limits:')
          for (const l of limits.value.filter(x => x.is_active)) {
            lines.push(
              `  • ${l.scope} / ${l.period}  budget=$${l.budget_usd}  warn=${l.warn_at}%  block=${l.block_at}%`
            )
          }
        } else {
          lines.push('  No active limits configured.')
          lines.push('  → Set limits at Dashboard → Limits')
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          content: [{ type: 'text', text: `❌ Failed to fetch limits: ${msg}` }],
          isError: true,
        }
      }
    }
  )

  /* ──────────────────────────────────────────────────────────
     TOOL: list_projects
     Returns project IDs for use with track_usage
  ────────────────────────────────────────────────────────── */
  server.tool(
    'list_projects',
    'List your TokenFin projects. Use the project ID with track_usage to attribute costs to a specific project.',
    async () => {
      try {
        const projects = await client.getProjects()

        if (!projects?.length) {
          return {
            content: [{
              type: 'text',
              text: 'No projects found. Create one at Dashboard → Projects.',
            }],
          }
        }

        const lines = [
          `📁 TokenFin Projects (${projects.length})`,
          '',
          ...projects.map(p => `  ${p.name.padEnd(28)} id: ${p.id}`),
          '',
          'Pass the id as project_id in track_usage to attribute costs.',
        ]

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          content: [{ type: 'text', text: `❌ Failed to fetch projects: ${msg}` }],
          isError: true,
        }
      }
    }
  )

  /* ──────────────────────────────────────────────────────────
     TOOL: get_top_models
     Model cost breakdown for the last 30 days
  ────────────────────────────────────────────────────────── */
  server.tool(
    'get_top_models',
    'Get token and cost breakdown by LLM model for the last 30 days from TokenFin.',
    async () => {
      try {
        const models = await client.getTopModels()

        if (!models?.length) {
          return {
            content: [{
              type: 'text',
              text: 'No model usage data yet. Start tracking with track_usage.',
            }],
          }
        }

        const sorted = [...models].sort((a, b) => b.cost - a.cost)
        const total  = sorted.reduce((s, m) => s + m.cost, 0)

        const lines = [
          `🤖 TokenFin — Model Breakdown (last 30 days)`,
          '',
          `  ${'Model'.padEnd(32)} ${'Cost'.padStart(8)}  ${'Tokens'.padStart(10)}  ${'Req'.padStart(6)}  ${'Share'.padStart(6)}`,
          `  ${'─'.repeat(70)}`,
          ...sorted.map(m => {
            const share = total > 0 ? ((m.cost / total) * 100).toFixed(1) + '%' : '—'
            return `  ${m.model.padEnd(32)} ${fmtCost(m.cost).padStart(8)}  ${fmtTokens(m.tokens).padStart(10)}  ${String(m.requests).padStart(6)}  ${share.padStart(6)}`
          }),
          `  ${'─'.repeat(70)}`,
          `  ${'TOTAL'.padEnd(32)} ${fmtCost(total).padStart(8)}`,
        ]

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          content: [{ type: 'text', text: `❌ Failed to fetch models: ${msg}` }],
          isError: true,
        }
      }
    }
  )

  return server
}

/* ── Helpers ── */
function buildBar(pct: number, width = 20): string {
  const filled = Math.round((Math.min(pct, 100) / 100) * width)
  const empty  = width - filled
  const color  = pct >= 90 ? '🔴' : pct >= 70 ? '🟡' : '🟢'
  return `${color} [${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct.toFixed(1)}%`
}
