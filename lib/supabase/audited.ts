import { createClient } from '@supabase/supabase-js'
import { getSecret } from '@/lib/security/secrets'

/**
 * Canary implementation: creates a Supabase service-role client via the
 * secrets indirection layer so that access is capability-audited.
 *
 * Use this in new code that runs with a known agentId. The existing
 * createServiceClient() is kept for backwards compatibility — migrate
 * call sites to this function as they are touched.
 */
export async function createAuditedServiceClient(agentId: string) {
  const serviceRoleKey = await getSecret('SUPABASE_SERVICE_ROLE_KEY', { agentId })
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey)
}
