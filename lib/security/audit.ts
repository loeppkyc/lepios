import { createServiceClient } from '@/lib/supabase/service'
import type { ActionType, ActionResult, EnforcementMode } from './types'

export interface AgentActionInput {
  agentId: string
  capability: string
  actionType: ActionType
  result: ActionResult
  reason: string
  enforcementMode: EnforcementMode
  target?: string
  context?: Record<string, unknown>
  parentActionId?: string
}

// Writes one row to agent_actions. Returns the inserted row's UUID.
// Never throws — audit failures must not break the capability check that invoked them.
// Returns '' on error so callers can detect failure without crashing.
export async function logAgentAction(input: AgentActionInput): Promise<string> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('agent_actions')
    .insert({
      agent_id: input.agentId,
      capability: input.capability,
      action_type: input.actionType,
      result: input.result,
      reason: input.reason,
      enforcement_mode: input.enforcementMode,
      target: input.target ?? null,
      context: input.context ?? {},
      parent_action_id: input.parentActionId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[security/audit] Failed to write agent_action:', error.message)
    return ''
  }

  return (data as { id: string }).id
}
