// MCP tool registry — the unified TokenFin tool set: read-only analytics plus
// reversible token-saving (compress / retrieve / savings_stats). Definitions
// only; execution lives in run.ts.

const RANGE_PROPS = {
  days: { type: 'integer', minimum: 1, maximum: 366, description: 'Last N days including today (default 30). Ignored when from/to are given.' },
  from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start day YYYY-MM-DD (inclusive, org time zone).' },
  to:   { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End day YYYY-MM-DD (inclusive, default today).' },
} as const

const FILTERS_SCHEMA = {
  type: 'object',
  description: 'Optional exact-match filters.',
  properties: {
    project_id: { type: 'string', description: 'Project UUID from list_projects.' },
    user_key:   { type: 'string', description: 'A member key (lowercased email) as returned by get_breakdown dim=member.' },
    model:      { type: 'string' },
    source:     { type: 'string', description: 'e.g. claude_code, codex, gemini_cli, sdk' },
    repo:       { type: 'string' },
    agent:      { type: 'string' },
  },
  additionalProperties: false,
} as const

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
    description: 'Total org AI spend (USD), tokens and request count over the last N days (default 30). Quick headline number; use get_breakdown for detail.',
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
  // ── Rollup analytics (org-local days; role-scoped) ──
  {
    name: 'get_breakdown',
    description: 'Break spend down by ONE dimension over a date range: model, project, member (person), source (e.g. claude_code, sdk), agent, skill, mcp_server, or repo. Returns rows sorted by cost with metered (billable) and notional (subscription at API rates, not a bill) cost, requests and tokens. Use for "which model/repo/person costs most". Members and viewers only ever see their own row for dim=member.',
    inputSchema: {
      type: 'object',
      properties: {
        dim: { type: 'string', enum: ['model', 'project', 'member', 'source', 'agent', 'skill', 'mcp_server', 'repo'], description: 'Dimension to group by.' },
        ...RANGE_PROPS,
        filters: FILTERS_SCHEMA,
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max rows (default 20); the rest is summed into "other".' },
      },
      required: ['dim'], additionalProperties: false,
    },
    annotations: { title: 'Spend breakdown', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_sessions',
    description: 'List agent/CLI sessions (e.g. one Claude Code session) active in a date range, with cost, tokens, requests, model, repo and user. Order by recent (default), cost or tokens. Owners/admins see everyone; members/viewers see only their own sessions. Use get_session for one session\'s detail.',
    inputSchema: {
      type: 'object',
      properties: {
        ...RANGE_PROPS,
        filters: FILTERS_SCHEMA,
        order: { type: 'string', enum: ['recent', 'cost', 'tokens'] },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20.' },
        offset: { type: 'integer', minimum: 0, description: 'For paging.' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List sessions', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_session',
    description: 'Detail for one session_id (from get_sessions): totals plus its first 200 LLM calls in order (model, tokens, cost, tool). Includes redacted prompt previews only if prompt capture is on for the org. Returns found:false for sessions you may not see.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'A session_id returned by get_sessions.' } },
      required: ['session_id'], additionalProperties: false,
    },
    annotations: { title: 'Session detail', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_prompts',
    description: 'Most expensive (or most recent) prompts in a date range. One prompt = one user turn, which may fan out into several LLM calls; each row has cost, tokens and request count. Includes a short redacted prompt_preview only when prompt capture is on (set include_text=false to skip text). Owners/admins see everyone; members/viewers see only their own prompts.',
    inputSchema: {
      type: 'object',
      properties: {
        ...RANGE_PROPS,
        filters: FILTERS_SCHEMA,
        order: { type: 'string', enum: ['cost', 'recent', 'tokens', 'requests'], description: 'Default cost.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20.' },
        offset: { type: 'integer', minimum: 0 },
        include_text: { type: 'boolean', description: 'Include redacted prompt previews when capture is on (default true).' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'Top prompts', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_mtd_and_forecast',
    description: 'Month-to-date spend for the org\'s current calendar month (org time zone) and a projected month-end total from a trailing N-day average (default 7 complete days). Metered (billable) and notional (subscription at API rates) are reported separately. Use for "how much will we spend this month?".',
    inputSchema: {
      type: 'object',
      properties: {
        trailing_days: { type: 'integer', minimum: 3, maximum: 30, description: 'Days in the trailing average (default 7).' },
        filters: FILTERS_SCHEMA,
      },
      additionalProperties: false,
    },
    annotations: { title: 'Month-to-date & forecast', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_insights',
    description: 'Ranked cost-saving insights for the org (e.g. cheaper model candidates, cache misses, runaway sessions), as shown on the dashboard Insights page. Returns available:false if this deployment has no insights service.',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365, description: 'Look-back window (default 30).' } }, additionalProperties: false },
    annotations: { title: 'Cost insights', readOnlyHint: true, openWorldHint: false },
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
  // ── Evaluation (quality / hallucination) ──
  {
    name: 'evaluate',
    description: 'Owner/admin keys only. Score an answer with the org\'s configured LLM judge (spends the org eval key and stores the score). evaluator "faithfulness" checks grounding against context (hallucination); "correctness" compares to a reference. Returns a 0–1 score.',
    inputSchema: {
      type: 'object',
      properties: {
        evaluator: { type: 'string', enum: ['faithfulness', 'correctness'] },
        answer: { type: 'string' },
        context: { type: 'string', description: 'for faithfulness' },
        question: { type: 'string', description: 'for correctness' },
        reference: { type: 'string', description: 'for correctness' },
      },
      required: ['evaluator', 'answer'], additionalProperties: false,
    },
    annotations: { title: 'Evaluate answer', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'get_eval_summary',
    description: 'Hallucination rate and mean faithfulness over the last N days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
    annotations: { title: 'Eval summary', readOnlyHint: true, openWorldHint: false },
  },
] as const

export const TOOL_NAMES = new Set(TOOLS.map(t => t.name))
