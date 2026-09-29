import type { CodingToolsView } from '@/lib/connectors/summary'
import type { MergedPrData } from '@/lib/connectors/merged-prs'

export interface ConnectorStatus {
  provider: string
  key_hint: string
  status: 'pending' | 'ok' | 'error'
  last_synced_at: string | null
  last_error: string | null
  config: { github_org?: string; repos?: string[] } | null
}

export interface GithubMapping { login: string; user_key: string }

export interface CodingToolsData {
  orgId: string
  days: number
  since: string
  canConnect: boolean      // owner (org:edit)
  canManage: boolean       // owner/admin (integrations:manage) — sync + login mapping
  connections: ConnectorStatus[]
  view: CodingToolsView
  mappings: GithubMapping[]
  memberEmails: string[]
  prs: MergedPrData
}
