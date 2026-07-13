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
  // ── Auto-sync: report usage (+ optional prompt) after each model call ──
  // ── Evaluation (quality / hallucination) ──
  {
    name: 'evaluate',
    description: 'Score an answer. evaluator "faithfulness" checks grounding against context (hallucination); "correctness" compares to a reference. Returns a 0–1 score.',
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
  {
    name: 'record_usage',
    description: 'Report an LLM call so TokenFin syncs token usage and cost. Call this once after each model response. Optionally include the prompt/response text to capture it for prompt analytics. Cost is computed automatically if omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        input_tokens: { type: 'integer', minimum: 0, description: 'Non-cached input tokens.' },
        output_tokens: { type: 'integer', minimum: 0 },
        cache_read_tokens: { type: 'integer', minimum: 0, description: 'Cache-read input tokens (priced ~10% of input).' },
        cache_creation_tokens: { type: 'integer', minimum: 0, description: 'Cache-write input tokens (priced ~125% of input).' },
        cost_usd: { type: 'number', description: 'Optional; computed from the model if omitted.' },
        prompt: { type: 'string', description: 'Optional full prompt to capture.' },
        response: { type: 'string', description: 'Optional full response to capture.' },
        event_id: { type: 'string', description: 'Optional idempotency key — a repeat call with the same value is ignored (prevents double-counting on retries).' },
      },
      required: ['model'], additionalProperties: false,
    },
    annotations: { title: 'Record usage', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
] as const

export const TOOL_NAMES = new Set(TOOLS.map(t => t.name))
