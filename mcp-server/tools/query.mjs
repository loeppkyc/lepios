/**
 * query.mjs — query_table tool
 *
 * Executes a read-only SELECT against an allowlisted LepiOS Supabase table.
 * Any table not on the allowlist is rejected before any network call is made.
 */

import { z } from 'zod'

/** @type {string[]} */
const ALLOWED_TABLES = [
  'task_queue',
  'agent_events',
  'harness_config',
  'scan_results',
  'amazon_listings',
  'arb_decisions',
  'local_sales',
  'outbound_notifications',
  'module_ceiling_metrics',
  'improvement_log',
  'failures_log',
]

/**
 * Register the query_table tool on the given McpServer.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('@supabase/supabase-js').SupabaseClient | null} db
 * @param {(toolName: string, latencyMs: number) => void} [logFn]
 */
export function registerQueryTool(server, db, logFn) {
  server.registerTool(
    'query_table',
    {
      description: `Execute a read-only SELECT against a LepiOS Supabase table. Only tables on the allowlist can be queried. Filters are ANDed together as equality conditions. Allowed tables: ${ALLOWED_TABLES.join(', ')}`,
      inputSchema: z.object({
        table_name: z
          .string()
          .describe(`Name of the table to query. Must be one of: ${ALLOWED_TABLES.join(', ')}`),
        filters: z
          .record(z.unknown())
          .optional()
          .describe('Key/value pairs added as equality filters (WHERE col = val). Optional.'),
        limit: z.number().optional().describe('Maximum rows to return. Defaults to 50.'),
      }),
    },
    async ({ table_name, filters, limit }) => {
      const t0 = Date.now()

      if (!ALLOWED_TABLES.includes(table_name)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'table not on allowlist',
                allowed_tables: ALLOWED_TABLES,
              }),
            },
          ],
          isError: true,
        }
      }

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

      const maxRows = typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : 50

      let query = db.from(table_name).select('*').limit(maxRows)

      if (filters && typeof filters === 'object') {
        for (const [col, val] of Object.entries(filters)) {
          query = query.eq(col, val)
        }
      }

      const { data, error } = await query

      if (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
          isError: true,
        }
      }

      if (logFn) logFn('query_table', Date.now() - t0)
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
      }
    }
  )
}
