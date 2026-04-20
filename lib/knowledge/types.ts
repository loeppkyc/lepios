export type EventStatus = 'success' | 'error' | 'failure' | 'warning'

export type KnowledgeCategory =
  | 'error_fix'
  | 'workflow'
  | 'pattern'
  | 'principle'
  | 'rule'
  | 'tip'
  | 'debug_step'
  | 'failed_approach'
  | 'translation_pattern'

export interface LogEventOptions {
  actor?: string
  status?: EventStatus
  entity?: string
  inputSummary?: string
  outputSummary?: string
  errorMessage?: string
  errorType?: string
  durationMs?: number
  tokensUsed?: number
  confidence?: number
  parentId?: string
  sessionId?: string
  tags?: string[]
  meta?: Record<string, unknown>
}

export interface SaveKnowledgeOptions {
  problem?: string
  solution?: string
  context?: string
  entity?: string
  sourceEvents?: string[]
  tags?: string[]
  confidence?: number
}

export interface FindKnowledgeOptions {
  category?: KnowledgeCategory
  domain?: string
  minConfidence?: number
  limit?: number
}

export interface KnowledgeEntry {
  id: string
  created_at: string
  updated_at: string
  category: KnowledgeCategory
  domain: string
  entity?: string | null
  title: string
  problem?: string | null
  solution?: string | null
  context?: string | null
  confidence: number
  times_used: number
  times_helpful: number
  last_used_at?: string | null
  source_events?: string[] | null
  tags?: string[] | null
  embedding_id?: string | null
}

export interface AgentEventRow {
  id: string
  occurred_at: string
  domain: string
  action: string
  actor: string
  status: EventStatus
  entity?: string | null
  input_summary?: string | null
  output_summary?: string | null
  error_message?: string | null
  error_type?: string | null
  duration_ms?: number | null
  tokens_used?: number | null
  confidence?: number | null
  parent_id?: string | null
  session_id?: string | null
  tags?: string[] | null
  meta?: Record<string, unknown> | null
}

export interface NightlyLearnResult {
  eventsAnalyzed: number
  knowledgeCreated: number
  consolidated: number
}

export interface MemoryHealthStats {
  total: number
  avgConfidence: number
  staleCount: number
  byCategory: Record<string, number>
  byDomain: Record<string, number>
  coverageGaps: string[]
}
