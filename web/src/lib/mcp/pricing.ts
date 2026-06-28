// Input price per 1M tokens — used to value compression savings in USD.
const IN_PRICE: Record<string, number> = {
  'claude-opus-4-8': 15, 'claude-sonnet-4-6': 3, 'claude-haiku-4-5': 0.8,
  'gpt-4o': 2.5, 'gpt-4o-mini': 0.15, 'gemini-1.5-pro': 1.25, 'gemini-1.5-flash': 0.075,
}

export const inputPrice = (model: string) => IN_PRICE[model] ?? 2
