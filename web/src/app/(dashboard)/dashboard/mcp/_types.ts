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
  models:      PlatformModel[]
}
