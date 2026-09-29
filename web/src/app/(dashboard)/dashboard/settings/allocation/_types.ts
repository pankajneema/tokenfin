/** One usage group (last month) the allocation preview re-allocates client-side. */
export interface PreviewRow {
  project_id: string | null
  source: string | null
  model: string
  cost_basis: string | null
  user_id: string | null
  user_email: string | null
  repo: string | null
  tags: Record<string, unknown>
  member_team: string | null
  cost: number
  tokens: number
}
