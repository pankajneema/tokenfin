import { TOOLS } from './tools'
import { runTool } from './run'
import type { KeyCtx } from './types'

export const PROTOCOL_VERSION = '2025-06-18'
export const SERVER_INFO = { name: 'tokenfin', title: 'TokenFin FinOps', version: '1.0.0' }

const INSTRUCTIONS =
  'TokenFin: read-only FinOps analytics (spend, per-model usage, daily costs, budgets) ' +
  'plus reversible token saving — call compress() on bulky tool output/JSON/logs before ' +
  'adding them to context, and retrieve(hash) to get the original back.'

// Dispatches one JSON-RPC message. Returns the response object, or null for
// notifications (which get a 202 with no body).
export async function handleRpc(msg: any, ctx: KeyCtx): Promise<any | null> {
  const { id, method, params } = msg ?? {}
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      })
    case 'notifications/initialized':
      return null
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: TOOLS })
    case 'tools/call': {
      const name = params?.name as string
      if (!TOOLS.find(t => t.name === name)) return err(-32602, `Unknown tool: ${name}`)
      try {
        const data = await runTool(name, (params?.arguments ?? {}) as Record<string, unknown>, ctx)
        return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: false })
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true })
      }
    }
    default:
      if (id === undefined) return null // unknown notification
      return err(-32601, `Method not found: ${method}`)
  }
}
