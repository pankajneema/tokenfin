// MCP tool registry — the unified TokenFin tool set: read-only analytics plus
// reversible token-saving (compress / retrieve / savings_stats). Definitions
// only; execution lives in run.ts.

export const TOOLS = [
  // ── Analytics (read-only) ──
  {
    name: 'list_projects',
    description: 'List the projects in the organization.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List projects', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_spend',
    description: 'Total AI spend, tokens, and request count for the org over the last N days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
    annotations: { title: 'Get spend', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_usage_by_model',
    description: 'Cost, tokens, and requests broken down by model over the last N days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
    annotations: { title: 'Usage by model', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_daily_costs',
    description: 'Daily cost series for the org over the last N days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
    annotations: { title: 'Daily costs', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_budget_status',
    description: 'Active org budget limits with current month spend and % used.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Budget status', readOnlyHint: true, openWorldHint: false },
  },
  // ── Token saving (reversible CCR compression) ──
  {
    name: 'compress',
    description: 'Compress a bulky tool output, JSON array, or log to save tokens before adding it to context. Returns a compressed version with a <<ccr:HASH>> marker; call retrieve with that hash to get the original back. Reversible — nothing is lost.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The text/JSON/log to compress.' },
        model: { type: 'string', description: 'Optional model id, to value the savings in USD.' },
      },
      required: ['content'], additionalProperties: false,
    },
    annotations: { title: 'Compress content', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'retrieve',
    description: 'Retrieve the original, uncompressed content for a hash from a <<ccr:HASH>> marker.',
    inputSchema: {
      type: 'object',
      properties: { hash: { type: 'string' } },
      required: ['hash'], additionalProperties: false,
    },
    annotations: { title: 'Retrieve original', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'savings_stats',
    description: 'Tokens and USD saved by compression over the last N days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
    annotations: { title: 'Savings stats', readOnlyHint: true, openWorldHint: false },
  },
] as const

export const TOOL_NAMES = new Set(TOOLS.map(t => t.name))
