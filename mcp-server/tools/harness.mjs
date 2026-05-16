/**
 * harness.mjs — get_agent_events and get_harness_config tools
 *
 * Purpose-built tools for the LepiOS autonomous harness workflow.
 * Secrets are masked: any harness_config key containing 'SECRET', 'KEY', or 'TOKEN'
 * has its value replaced with "[redacted]".
 *
 * Kill signal guard: get_harness_config NEVER returns a raw secret value.
 * Masking is applied unconditionally before the result is returned.
 */

import { z } from 'zod'

/**
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveKey(key) {
  const upper = key.toUpperCase()
  return upper.includes('SECRET') || upper.includes('KEY') || upper.includes('TOKEN')
}

/**
 * Register get_agent_events and get_harness_config on the given McpServer.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('@supabase/supabase-js').SupabaseClient | null} db
 * @param {(toolName: string, latencyMs: number) => void} [logFn]
 */
export function registerHarnessTools(server, db, logFn) {
  // ── get_agent_events ────────────────────────────────────────────────────
  server.registerTool(
    'get_agent_events',
    {
      description:
        'Returns the last N agent_events rows, optionally filtered by action or domain. Default N=20, max N=100.',
      inputSchema: z.object({
        n: z.number().optional().describe('Number of rows to return (default 20, max 100).'),
        action: z.string().optional().describe('Filter by action field. Optional.'),
        domain: z.string().optional().describe('Filter by domain field. Optional.'),
      }),
    },
    async ({ n, action, domain }) => {
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

      const limit = typeof n === 'number' && n > 0 ? Math.min(n, 100) : 20

      let query = db
        .from('agent_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (action) query = query.eq('action', action)
      if (domain) query = query.eq('domain', domain)

      const { data, error } = await query

      if (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
          isError: true,
        }
      }

      if (logFn) logFn('get_agent_events', Date.now() - t0)
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
      }
    }
  )

  // ── get_harness_config ──────────────────────────────────────────────────
  server.registerTool(
    'get_harness_config',
    {
      description:
        'Returns all harness_config rows. Any key containing SECRET, KEY, or TOKEN is masked as "[redacted]" — sensitive values are never returned.',
      inputSchema: z.object({}),
    },
    async () => {
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

      const { data, error } = await db.from('harness_config').select('key, value, updated_at')

      if (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
          isError: true,
        }
      }

      // Kill signal guard: mask sensitive keys unconditionally.
      // No code path returns a raw secret value.
      const masked = (data ?? []).map((row) => ({
        ...row,
        value: isSensitiveKey(row.key) ? '[redacted]' : row.value,
      }))

      // Defensive assertion — if this fires, abort rather than leak
      for (const row of masked) {
        if (isSensitiveKey(row.key) && row.value !== '[redacted]') {
          process.stderr.write(
            `[lepios-mcp] SECURITY: sensitive key "${row.key}" was not masked — aborting response\n`
          )
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Internal security check failed — sensitive value not masked',
                }),
              },
            ],
            isError: true,
          }
        }
      }

      if (logFn) logFn('get_harness_config', Date.now() - t0)
      return {
        content: [{ type: 'text', text: JSON.stringify(masked) }],
      }
    }
  )
}
