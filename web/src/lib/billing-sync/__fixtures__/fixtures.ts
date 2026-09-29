/** Fixture responses shaped exactly like the documented provider APIs (test-only). */

// Anthropic cost_report (group_by workspace_id + description). amount = cents, decimal string.
export const anthropicCostPage1 = {
  data: [
    {
      starting_at: '2026-09-01T00:00:00Z', ending_at: '2026-09-02T00:00:00Z',
      results: [
        { amount: '123.45', currency: 'USD', cost_type: 'tokens', description: 'Claude Sonnet 4.6 Usage - Input Tokens', model: 'claude-sonnet-4-6', service_tier: 'standard', token_type: 'uncached_input_tokens', context_window: '0-200k', inference_geo: 'global', workspace_id: 'wrkspc_A' },
        { amount: '250', currency: 'USD', cost_type: 'tokens', description: 'Claude Sonnet 4.6 Usage - Output Tokens', model: 'claude-sonnet-4-6', service_tier: 'standard', token_type: 'output_tokens', context_window: '0-200k', inference_geo: 'global', workspace_id: null },
      ],
    },
  ],
  has_more: true,
  next_page: 'page_2',
}
export const anthropicCostPage2 = {
  data: [
    {
      starting_at: '2026-09-02T00:00:00Z', ending_at: '2026-09-03T00:00:00Z',
      results: [
        { amount: '10', currency: 'USD', cost_type: 'web_search', description: 'Web Search', model: null, service_tier: null, token_type: null, context_window: null, inference_geo: null, workspace_id: 'wrkspc_A' },
      ],
    },
    { starting_at: '2026-09-03T00:00:00Z', ending_at: '2026-09-04T00:00:00Z', results: [] },
  ],
  has_more: false,
  next_page: null,
}

// Anthropic usage_report/messages (bucket_width=1d, group_by workspace_id + model).
export const anthropicUsage = {
  data: [
    {
      starting_at: '2026-09-01T00:00:00Z', ending_at: '2026-09-02T00:00:00Z',
      results: [
        { uncached_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 50 }, cache_read_input_tokens: 3000, output_tokens: 400, server_tool_use: { web_search_requests: 0 }, api_key_id: null, workspace_id: 'wrkspc_A', model: 'claude-sonnet-4-6', service_tier: null, context_window: null },
      ],
    },
  ],
  has_more: false,
  next_page: null,
}

// OpenAI /v1/organization/costs (group_by project_id + line_item). amount.value = USD.
const day = (d: string) => Date.parse(d + 'T00:00:00Z') / 1000
export const openaiPage1 = {
  object: 'page',
  data: [
    {
      object: 'bucket', start_time: day('2026-09-01'), end_time: day('2026-09-02'),
      results: [
        { object: 'organization.costs.result', amount: { value: 0.5, currency: 'usd' }, line_item: 'gpt-4o-2024-08-06, input', project_id: 'proj_1' },
        { object: 'organization.costs.result', amount: { value: 1.25, currency: 'usd' }, line_item: 'gpt-4o-2024-08-06, output', project_id: 'proj_1' },
      ],
    },
  ],
  has_more: true,
  next_page: 'page_AAA',
}
export const openaiPage2 = {
  object: 'page',
  data: [
    {
      object: 'bucket', start_time: day('2026-09-02'), end_time: day('2026-09-03'),
      results: [
        { object: 'organization.costs.result', amount: { value: 0.02, currency: 'usd' }, line_item: 'web search tool calls', project_id: null },
      ],
    },
  ],
  has_more: false,
  next_page: null,
}
