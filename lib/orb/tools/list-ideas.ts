/**
 * listIdeas — chat_ui Slice 5 read tool.
 *
 * Queries idea_inbox by status. Read-only; no approval gate.
 */

import { z } from 'zod'
import type { ChatTool } from './registry'
import { createServiceClient } from '@/lib/supabase/service'

type Input = {
  status?: 'parked' | 'active' | 'shipped' | 'dismissed' | 'all'
  limit?: number
}

type Idea = {
  id: string
  title: string
  summary: string | null
  status: string
  score: number
  source: string
  tags: unknown
  created_at: string
}

type Output = { ideas: Idea[]; count: number }

export const listIdeasTool: ChatTool<Input, Output> = {
  name: 'listIdeas',
  description:
    "Lists ideas from Colin's idea_inbox. " +
    'Default shows active ideas sorted by score. ' +
    'Pass status: "parked" to see queued ideas, "all" to see everything.',
  parameters: z.object({
    status: z
      .enum(['parked', 'active', 'shipped', 'dismissed', 'all'])
      .optional()
      .default('active')
      .describe('Filter by lifecycle status (default: active)'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe('Max rows to return (default 10)'),
  }),
  capability: 'tool.chat_ui.read.idea_inbox',
  execute: async ({ status, limit }) => {
    const db = createServiceClient()
    let q = db
      .from('idea_inbox')
      .select('id, title, summary, status, score, source, tags, created_at')
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit ?? 10)

    if ((status ?? 'active') !== 'all') {
      q = q.eq('status', status ?? 'active')
    }

    const { data, error } = await q
    if (error) throw new Error(`Failed to query idea_inbox: ${error.message}`)
    const ideas = (data ?? []) as Idea[]
    return { ideas, count: ideas.length }
  },
}
