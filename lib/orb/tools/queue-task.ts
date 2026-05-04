/**
 * queueTask — chat_ui Slice 4 action tool.
 *
 * Inserts a row into task_queue for the coordinator to pick up.
 * Approval-gated: call with dryRun: true (default) to preview,
 * then dryRun: false after Colin confirms in the conversation.
 */

import { z } from 'zod'
import type { ChatTool } from './registry'
import { createServiceClient } from '@/lib/supabase/service'

type Input = { task: string; description?: string; priority?: number; dryRun?: boolean }
type Output = {
  queued: boolean
  preview: { task: string; description?: string; priority: number }
  task_id?: string
}

export const queueTaskTool: ChatTool<Input, Output> = {
  name: 'queueTask',
  description:
    'Adds a task to the coordinator task_queue. ' +
    'ALWAYS call with dryRun: true first — show the task preview to Colin and get his ' +
    'explicit confirmation in the conversation before calling with dryRun: false.',
  parameters: z.object({
    task: z.string().min(1).max(500).describe('Short task title'),
    description: z.string().max(2000).optional().describe('Detailed description (optional)'),
    priority: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .default(3)
      .describe('Priority 1 (highest) – 5 (lowest), default 3'),
    dryRun: z
      .boolean()
      .optional()
      .default(true)
      .describe('true = preview only (default); false = actually queue'),
  }),
  capability: 'tool.chat_ui.action.queue_task',
  execute: async ({ task, description, priority, dryRun }) => {
    const resolvedPriority = priority ?? 3
    const preview = { task, description, priority: resolvedPriority }
    if (dryRun !== false) {
      return { queued: false, preview }
    }
    const db = createServiceClient()
    const { data, error } = await db
      .from('task_queue')
      .insert({
        task,
        description: description ?? null,
        priority: resolvedPriority,
        status: 'queued',
        source: 'manual',
      })
      .select('id')
      .single()
    if (error) throw new Error(`Failed to queue task: ${error.message}`)
    return { queued: true, preview, task_id: data.id }
  },
}
