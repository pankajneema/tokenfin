/**
 * TokenFin API client for the MCP server.
 * Thin wrapper over fetch — talks to the TokenFin Next.js API routes.
 */

export interface TokenFinClientConfig {
  apiKey:  string   // API key — used as Bearer token for /ingest; Admin routes use it via cookie
  baseUrl: string   // e.g. http://localhost:3000 or https://app.yourdomain.com
}

export class TokenFinApiClient {
  private readonly apiKey:  string
  private readonly baseUrl: string

  constructor(cfg: TokenFinClientConfig) {
    this.apiKey  = cfg.apiKey
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '')
  }

  /* ─── Ingest ─────────────────────────────────────────────── */

  async trackUsage(payload: {
    model:        string
    inputTokens:  number
    outputTokens: number
    projectId?:   string
    tags?:        Record<string, string>
    metadata?:    Record<string, unknown>
  }) {
    const body = {
      model:         payload.model,
      input_tokens:  payload.inputTokens,
      output_tokens: payload.outputTokens,
      ...(payload.projectId ? { project_id: payload.projectId } : {}),
      ...(payload.tags      ? { tags:       payload.tags      } : {}),
      ...(payload.metadata  ? { metadata:   payload.metadata  } : {}),
    }

    const res = await fetch(`${this.baseUrl}/api/v1/ingest`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Ingest failed (${res.status}): ${text}`)
    }

    return res.json() as Promise<{
      ok: boolean; model: string; total_tokens: number
      cost_usd: number; bucket: string; source: string
    }>
  }

  /* ─── Analytics ──────────────────────────────────────────── */

  async getSpending() {
    const res = await this._get('/api/v1/analytics?period=30d')
    return res as {
      totalCost:     number
      totalTokens:   number
      totalRequests: number
      byModel:       Array<{ model: string; cost: number; tokens: number; requests: number }>
      daily:         Array<{ date: string; cost: number; tokens: number }>
    }
  }

  async getTopModels() {
    const res = await this._get('/api/v1/models')
    return res as Array<{
      model:    string
      cost:     number
      tokens:   number
      requests: number
    }>
  }

  async getProjects() {
    const res = await this._get('/api/v1/projects')
    return res as Array<{ id: string; name: string; slug: string }>
  }

  async getLimits() {
    const res = await this._get('/api/v1/limits')
    return res as Array<{
      id:         string
      scope:      string
      period:     string
      budget_usd: number
      warn_at:    number
      block_at:   number
      is_active:  boolean
    }>
  }

  async getBudget() {
    const res = await this._get('/api/v1/budget')
    return res as {
      budget_usd:  number
      spent_usd:   number
      remaining:   number
      pct_used:    number
      period:      string
    }
  }

  /* ─── Helpers ────────────────────────────────────────────── */

  private async _get(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'x-api-key':     this.apiKey,
      },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`API error ${res.status}: ${text}`)
    }

    return res.json()
  }
}
