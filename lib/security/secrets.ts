import { createClient } from '@supabase/supabase-js'
import { requireCapability } from './capability'
import { currentAgentId } from './agent-context'

// Bootstrap-layer client: reads env directly (this module IS the secrets layer,
// so it cannot use getSecret() for its own DB access — that would be circular).
function mkDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

/**
 * Retrieve a secret value with a capability audit trail.
 *
 * Resolution order:
 *   1. AsyncLocalStorage agent context (set by runWithAgentContext)
 *   2. opts.agentId
 *   3. 'harness' fallback
 *
 * Value resolution order:
 *   1. harness_config table (key column)
 *   2. process.env[key]
 *
 * Throws if the value is not found in either source.
 * Never throws on DB tracking failures — those are fire-and-forget.
 */
export async function getSecret(key: string, opts?: { agentId?: string }): Promise<string> {
  const agentId = currentAgentId() ?? opts?.agentId ?? 'harness'
  const capability = `secret.read.${key}`

  // 1. Capability gate — log_only mode: never throws; always audits to agent_actions
  await requireCapability({ agentId, capability })

  // 2. Try harness_config first
  const db = mkDb()
  const { data } = await db
    .from('harness_config')
    .select('value, access_count')
    .eq('key', key)
    .maybeSingle()

  if (data?.value) {
    // Fire-and-forget access tracking — never breaks the caller
    void (async () => {
      try {
        await db
          .from('harness_config')
          .update({
            last_accessed_at: new Date().toISOString(),
            access_count: (data.access_count ?? 0) + 1,
          })
          .eq('key', key)
      } catch {
        // Non-fatal
      }
    })()

    return data.value as string
  }

  // 3. Fall back to process.env
  const envValue = process.env[key]
  if (envValue !== undefined && envValue !== '') {
    return envValue
  }

  throw new Error(
    `Secret "${key}" not found: no row in harness_config and process.env.${key} is not set`
  )
}
