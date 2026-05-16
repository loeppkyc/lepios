/**
 * tasks.mjs — get_task_queue and post_task tools
 *
 * Purpose-built tools for the LepiOS harness task workflow.
 * get_task_queue: returns task_queue rows by status (no raw SQL).
 * post_task: inserts a new task with source='mcp'.
 */

import { z } from 'zod'

/**
 * Register get_task_queue and post_task on the given McpServer.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('@supabase/supabase-js').SupabaseClient | null} db
 * @param {(toolName: string, latencyMs: number) => void} [logFn]
 */
export function registerTaskTools(server, db, logFn) {
  const VALID_STATUSES = ['queued', 'claimed', 'complete', 'parked']

  // ── get_task_queue ──────────────────────────────────────────────────────
  server.registerTool(
    'get_task_queue',
    {
      description:
        'Returns task_queue rows filtered by status. Valid statuses: queued, claimed, complete, parked. No raw SQL — purpose-built for the harness workflow.',
      inputSchema: z.object({
        status: z
          .enum(['queued', 'claimed', 'complete', 'parked'])
          .optional()
          .describe('Filter by task status. Optional — omit to return all statuses.'),
        limit: z.number().optional().describe('Maximum rows to return. Defaults to 50.'),
      }),
    },
    async ({ status, limit }) => {
      const t0 = Date.now()
      if (!db) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  'Supabase client not initialised — check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
              }),
            },
          ],
          isError: true,
        }
      }

      const maxRows = typeof limit === 'number' && limit > 0 ? Math.min(limit, 200) : 50

      let query = db
        .from('task_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(maxRows)

      if (status) {
        query = query.eq('status', status)
      }

      const { data, error } = await query

      if (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
          isError: true,
        }
      }

      if (logFn) logFn('get_task_queue', Date.now() - t0)
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
      }
    }
  )

  // ── post_task ───────────────────────────────────────────────────────────
  server.registerTool(
    'post_task',
    {
      description:
        'Insert a new task into the task_queue with source="mcp". Returns the created row id, title, priority, status, and created_at.',
      inputSchema: z.object({
        title: z.string().min(1).describe('Short title for the task (required).'),
        description: z.string().optional().describe('Full description of the task. Optional.'),
        priority: z
          .number()
          .min(1)
          .max(5)
          .optional()
          .describe('Priority 1–5 (1=low, 5=highest). Defaults to 3.'),
      }),
    },
    async ({ title, description, priority }) => {
      const t0 = Date.now()
      if (!db) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  'Supabase client not initialised — check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
              }),
            },
          ],
          isError: true,
        }
      }

      const taskPriority =
        typeof priority === 'number' && priority >= 1 && priority <= 5 ? priority : 3

      const { data, error } = await db
        .from('task_queue')
        .insert({
          title: title.trim(),
          description: description ?? null,
          priority: taskPriority,
          source: 'mcp',
          status: 'queued',
        })
        .select('id, title, priority, status, created_at')
        .single()

      if (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
          isError: true,
        }
      }

      if (logFn) logFn('post_task', Date.now() - t0)
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
      }
    }
  )
}
