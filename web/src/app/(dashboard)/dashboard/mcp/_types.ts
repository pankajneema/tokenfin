import type { Tier, Accuracy } from '../setup/_catalog'

export interface PlatformModel {
  model:    string
  tokens30d: number
  cost30d:   number
  calls30d:  number
}

export interface PlatformRow {
  id:          string
  name:        string
  keyPrefix:   string
  env:         string
  scopes:      string[]
  isActive:    boolean
  lastUsedAt:  string | null
  createdAt:   string
  projectId:   string
  projectName: string
  tokens30d:   number
  cost30d:     number
  calls30d:    number
  prompts30d:  number
  models:      PlatformModel[]
  tier:        Tier | null
  accuracy:    Accuracy | null
}

/** An active key with the 'read' scope — what the MCP server authenticates with. */
export interface ReadKeyRow {
  id:         string
  name:       string
  keyPrefix:  string
  lastUsedAt: string | null
  createdAt:  string
  /** Owned by the viewer (personal key, or org key they created). */
  mine:       boolean
  /** Split read-only key (vs a legacy read+write key). */
  readOnly:   boolean
}
