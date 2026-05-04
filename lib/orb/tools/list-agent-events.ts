/**
 * listAgentEvents — chat_ui Slice 4 read tool.
 *
 * Queries recent rows from agent_events. Read-only; no approval gate.
 */

import { z } from 'zod'
import type { ChatTool } from './registry'
import { createServiceClient } from '@/lib/supabase/service'

type Input = {
  limit?: number
  action?: string
  status?: 'success' | 'error' | 'pending'
  hoursBack?: number
}

type AgentEvent = {
  id: string
  occurred_at: string
  domain: string
  action: string
  actor: string
  status: string
  error_message: string | null
  duration_ms: number | null
  meta: Record<string, unknown> | null
}

type Output = { events: AgentEvent[]; count: number }

export const listAgentEventsTool: ChatTool<Input, Output> = {
  name: 'listAgentEvents',
  description:
    'Lists recent entries from the harness agent_events audit log. ' +
    'Use to check recent activity, diagnose failures, or review what the system has been doing. ' +
    'Optionally filter by action name or status (success/error/pending).',
  parameters: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe('Max rows to return (default 10, max 50)'),
    action: z.string().optional().describe('Filter by exact action name (e.g. "smoke_test_failed")'),
    status: z
      .enum(['success', 'error', 'pending'])
      .optional()
      .describe('Filter by status'),
    hoursBack: z
      .number()
      .min(1)
      .max(168)
      .optional()
      .default(24)
      .describe('Look back N hours (default 24, max 168)'),
  }),
  capability: 'tool.chat_ui.read.agent_events',
  execute: async ({ limit, action, status, hoursBack }) => {
    const db = createServiceClient()
    const since = new Date(Date.now() - (hoursBack ?? 24) * 3_600_000).toISOString()

    let q = db
      .from('agent_events')
      .select('id, occurred_at, domain, action, actor, status, error_message, duration_ms, meta')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(limit ?? 10)

    if (action) q = q.eq('action', action)
    if (status) q = q.eq('status', status)

    const { data, error } = await q
    if (error) throw new Error(`Failed to query agent_events: ${error.message}`)
    const events = (data ?? []) as AgentEvent[]
    return { events, count: events.length }
  },
}
