/**
 * queryDb — chat_ui Slice 6 read tool.
 *
 * Queries a read-only allowlist of Supabase tables. No approval gate.
 * Returns up to 20 rows; caller controls limit (default 10).
 *
 * Spec: docs/acceptance/chat-ui-slice-6.md §query_db.
 */

import { z } from 'zod'
import type { ChatTool } from './registry'
import { createServiceClient } from '@/lib/supabase/service'

// Tables the chat UI is allowed to read
const ALLOWED_TABLES = [
  'agent_events',
  'harness_components',
  'task_queue',
  'knowledge',
  'utility_bills',
  'mileage_trips',
  'expenses',
  'amazon_orders',
  'harness_config',
] as const

type AllowedTable = (typeof ALLOWED_TABLES)[number]

type Input = {
  table: AllowedTable
  filters?: Record<string, unknown>
  limit?: number
  order_by?: string
}

type Output =
  | { table: string; rows: unknown[]; count: number }
  | { error: 'query_error'; message: string }

export const queryDbTool: ChatTool<Input, Output> = {
  name: 'queryDb',
  description:
    'Query a LepiOS database table (read-only). ' +
    'Allowed tables: agent_events, harness_components, task_queue, knowledge, utility_bills, ' +
    'mileage_trips, expenses, amazon_orders, harness_config. Returns up to 20 rows.',
  parameters: z.object({
    table: z.enum(ALLOWED_TABLES),
    filters: z.record(z.string(), z.string()).optional(),
    limit: z.number().int().min(1).max(20).optional().default(10),
    order_by: z.string().optional(),
  }),
  capability: 'tool.chat_ui.read.db',
  execute: async ({ table, filters, limit, order_by }) => {
    try {
      const db = createServiceClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = db.from(table).select('*')

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          q = q.eq(key, value)
        }
      }

      if (order_by) {
        q = q.order(order_by, { ascending: false })
      }

      q = q.limit(limit ?? 10)

      const { data, error } = await q
      if (error) {
        return { error: 'query_error', message: error.message }
      }

      const rows = data ?? []
      return { table, rows, count: rows.length }
    } catch (err: unknown) {
      return { error: 'query_error', message: String(err) }
    }
  },
}
