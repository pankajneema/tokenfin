/**
 * FOCUS (FinOps Open Cost & Usage Specification) mapping — pure functions.
 *
 * Column set follows FOCUS 1.2 (focus.finops.org; column definitions verified
 * against the FOCUS_Spec repo, tag v1.2). Every Mandatory column is emitted;
 * Conditional columns TokenFin can populate are emitted; provider-specific
 * data lives in `x_`-prefixed custom columns as the spec requires.
 *
 * Cost semantics:
 *  • notional  (subscription usage priced at API list rates — NOT a bill):
 *      BilledCost = EffectiveCost = ContractedCost = 0, ListCost = notional cost
 *  • metered / vendor_reported / unknown:
 *      BilledCost = EffectiveCost = ContractedCost = vendor cost when reported,
 *      else computed cost; ListCost = computed (list-price) cost
 * Token rows mix input/output/cache prices, so the pricing unit is a blended
 * "1M Tokens" and unit prices are cost ÷ PricingQuantity — this keeps the
 * spec's ListUnitPrice × PricingQuantity = ListCost invariant exact.
 */

export const FOCUS_VERSION = '1.2'

export const FOCUS_COLUMNS = [
  'BilledCost', 'BillingAccountId', 'BillingAccountName', 'BillingAccountType', 'BillingCurrency',
  'BillingPeriodEnd', 'BillingPeriodStart', 'ChargeCategory', 'ChargeClass', 'ChargeDescription',
  'ChargeFrequency', 'ChargePeriodEnd', 'ChargePeriodStart', 'ConsumedQuantity', 'ConsumedUnit',
  'ContractedCost', 'ContractedUnitPrice', 'EffectiveCost', 'InvoiceId', 'InvoiceIssuerName',
  'ListCost', 'ListUnitPrice', 'PricingCategory', 'PricingQuantity', 'PricingUnit',
  'ProviderName', 'PublisherName', 'RegionId', 'RegionName', 'ResourceId', 'ResourceName',
  'ResourceType', 'ServiceCategory', 'ServiceName', 'ServiceSubcategory', 'SkuId', 'SkuPriceId',
  'SubAccountId', 'SubAccountName', 'SubAccountType', 'Tags',
  'x_TokenFinCostBasis', 'x_Source', 'x_Team', 'x_CostCenter', 'x_AllocationMethod',
  'x_InputTokens', 'x_OutputTokens', 'x_CacheReadTokens', 'x_CacheWriteTokens', 'x_ReasoningTokens',
  'x_RequestCount', 'x_FocusVersion',
] as const

export type FocusColumn = typeof FOCUS_COLUMNS[number]
export type FocusRow = Record<FocusColumn, string | number | null>

/** One pre-aggregated usage row for a single day (FOCUS grain after allocation). */
export interface FocusInput {
  day: string                    // YYYY-MM-DD in the workspace zone
  chargePeriodStart: string      // ISO UTC instant of local midnight
  chargePeriodEnd: string        // ISO UTC instant of next local midnight
  billingPeriodStart: string
  billingPeriodEnd: string
  orgId: string
  orgName: string
  provider: string | null
  model: string
  projectId: string | null
  projectName: string | null
  source: string | null
  costBasis: string | null
  team: string | null
  costCenter: string | null
  allocationMethod: 'rule' | 'member' | 'shared_split' | 'none'
  events: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  cost: number                   // computed cost at list rates
  vendorCost: number | null      // provider-reported cost, when any
}

const PROVIDERS: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', gemini: 'Google', vertex: 'Google',
  azure: 'Microsoft', azure_openai: 'Microsoft', bedrock: 'Amazon Web Services', aws: 'Amazon Web Services',
  mistral: 'Mistral AI', cohere: 'Cohere', xai: 'xAI', deepseek: 'DeepSeek', groq: 'Groq', cursor: 'Cursor',
}

export function providerName(provider: string | null, model: string): string {
  const p = (provider ?? '').toLowerCase().trim()
  if (p && PROVIDERS[p]) return PROVIDERS[p]
  if (p) return p.charAt(0).toUpperCase() + p.slice(1)
  const m = model.toLowerCase()
  if (m.startsWith('claude')) return 'Anthropic'
  if (/^(gpt|o\d|chatgpt|text-embedding|codex)/.test(m)) return 'OpenAI'
  if (m.startsWith('gemini')) return 'Google'
  return 'Unknown'
}

const SOURCES: Record<string, string> = {
  claude_code: 'Claude Code', 'claude-code': 'Claude Code', cowork: 'Claude Cowork', codex: 'Codex CLI', codex_cli: 'Codex CLI',
  gemini_cli: 'Gemini CLI', 'gemini-cli': 'Gemini CLI', cursor: 'Cursor',
}

export function serviceName(provider: string, source: string | null): string {
  const s = (source ?? '').toLowerCase()
  if (SOURCES[s]) return SOURCES[s]
  return `${provider} API`
}

/** Round to 10 decimal places and drop float noise. */
export function dec(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1e10) / 1e10 : 0
}

export function toFocusRow(i: FocusInput): FocusRow {
  const provider = providerName(i.provider, i.model)
  const service  = serviceName(provider, i.source)
  const basis    = i.costBasis ?? 'metered'
  const notional = basis === 'notional'
  const list     = dec(i.cost)
  const billed   = notional ? 0 : dec(i.vendorCost ?? i.cost)
  const pricingQty = dec(i.totalTokens / 1_000_000)
  const unit = (c: number) => (pricingQty > 0 ? dec(c / pricingQty) : 0)

  const tags: Record<string, string> = {}
  if (i.team)        tags.team = i.team
  if (i.costCenter)  tags.cost_center = i.costCenter
  if (i.projectName) tags.project = i.projectName
  if (i.source)      tags.source = i.source

  return {
    BilledCost:          billed,
    BillingAccountId:    i.orgId,
    BillingAccountName:  i.orgName,
    BillingAccountType:  'Workspace',
    BillingCurrency:     'USD',
    BillingPeriodEnd:    i.billingPeriodEnd,
    BillingPeriodStart:  i.billingPeriodStart,
    ChargeCategory:      'Usage',
    ChargeClass:         null,
    ChargeDescription:   `${i.model} tokens via ${service}${notional ? ' (subscription usage priced at list rates — not billed)' : ''}`,
    ChargeFrequency:     'Usage-Based',
    ChargePeriodEnd:     i.chargePeriodEnd,
    ChargePeriodStart:   i.chargePeriodStart,
    ConsumedQuantity:    i.totalTokens,
    ConsumedUnit:        'Tokens',
    ContractedCost:      billed,
    ContractedUnitPrice: unit(billed),
    EffectiveCost:       billed,
    InvoiceId:           null,
    InvoiceIssuerName:   provider,
    ListCost:            list,
    ListUnitPrice:       unit(list),
    PricingCategory:     'Standard',
    PricingQuantity:     pricingQty,
    PricingUnit:         '1M Tokens',
    ProviderName:        provider,
    PublisherName:       provider,
    RegionId:            null,
    RegionName:          null,
    ResourceId:          i.projectId ?? `${i.orgId}/unassigned`,
    ResourceName:        i.projectName ?? 'Unassigned',
    ResourceType:        'Project',
    ServiceCategory:     'AI and Machine Learning',
    ServiceName:         service,
    ServiceSubcategory:  'Generative AI',
    SkuId:               i.model,
    SkuPriceId:          `${provider.toLowerCase().replace(/\s+/g, '-')}:${i.model}:${notional ? 'notional' : 'list'}`,
    SubAccountId:        i.projectId,
    SubAccountName:      i.projectName,
    SubAccountType:      i.projectId ? 'Project' : null,
    Tags:                JSON.stringify(tags),
    x_TokenFinCostBasis: basis,
    x_Source:            i.source,
    x_Team:              i.team,
    x_CostCenter:        i.costCenter,
    x_AllocationMethod:  i.allocationMethod,
    x_InputTokens:       i.inputTokens,
    x_OutputTokens:      i.outputTokens,
    x_CacheReadTokens:   i.cacheReadTokens,
    x_CacheWriteTokens:  i.cacheWriteTokens,
    x_ReasoningTokens:   i.reasoningTokens,
    x_RequestCount:      i.events,
    x_FocusVersion:      FOCUS_VERSION,
  }
}

function csvCell(v: string | number | null): string {
  if (v == null) return ''
  if (typeof v === 'number') return String(v)
  // Neutralise spreadsheet formula injection, then quote.
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n\r]/.test(s) || s !== v ? `"${s.replace(/"/g, '""')}"` : s
}

export function focusCsvHeader(): string {
  return FOCUS_COLUMNS.join(',') + '\n'
}

export function focusCsvLine(r: FocusRow): string {
  return FOCUS_COLUMNS.map(c => csvCell(r[c])).join(',') + '\n'
}
