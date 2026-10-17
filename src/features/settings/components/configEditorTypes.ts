export type JsonRecord = Record<string, unknown>
export type Lang = string
export type Choice = { value: string; label: string; hint?: string; disabled?: boolean }

export type SectionID =
  | 'general'
  | 'commands'
  | 'skills'
  | 'plugins'
  | 'providers'
  | 'agents'
  | 'mcp'
  | 'permissions'
  | 'formatters'
  | 'lsp'
  | 'media'
  | 'runtime'
  | 'experimental'
  | 'advanced'
