#!/usr/bin/env node
/**
 * TokenFin MCP Server — Entry point
 *
 * Runs as a stdio MCP server. Add to any MCP-compatible tool:
 *
 * Claude Desktop (~/.config/claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "tokenfin": {
 *       "command": "npx",
 *       "args": ["-y", "@tokenfin/mcp"],
 *       "env": {
 *         "TOKENFIN_API_KEY": "tf_live_...",
 *         "TOKENFIN_BASE_URL": "http://localhost:3000"
 *       }
 *     }
 *   }
 * }
 *
 * Or run locally:
 *   TOKENFIN_API_KEY=tf_live_... TOKENFIN_BASE_URL=http://localhost:3000 node dist/index.js
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { TokenFinApiClient }    from './client.js'
import { createTokenFinServer } from './server.js'

/* ── Config from environment ── */
const API_KEY  = process.env.TOKENFIN_API_KEY  ?? ''
const BASE_URL = process.env.TOKENFIN_BASE_URL ?? 'http://localhost:3000'

if (!API_KEY) {
  console.error('[tokenfin-mcp] ERROR: TOKENFIN_API_KEY environment variable is required.')
  console.error('[tokenfin-mcp] Get your API key from Dashboard → API Keys.')
  process.exit(1)
}

/* ── Boot ── */
const client    = new TokenFinApiClient({ apiKey: API_KEY, baseUrl: BASE_URL })
const mcpServer = createTokenFinServer(client)
const transport = new StdioServerTransport()

mcpServer.connect(transport).then(() => {
  // MCP servers must NOT write to stdout (it's the protocol channel).
  // Log to stderr only.
  process.stderr.write(`[tokenfin-mcp] Server running  base=${BASE_URL}\n`)
}).catch(err => {
  process.stderr.write(`[tokenfin-mcp] Fatal: ${err}\n`)
  process.exit(1)
})
