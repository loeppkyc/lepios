import { createServiceClient } from '@/lib/supabase/service'
import type { PostgrestError } from '@supabase/supabase-js'

// Postgres permission-denied error code
const PG_PERMISSION_DENIED = '42501'

interface WriteResult<T> {
  data: T | null
  error: PostgrestError | null
}

async function alertPermissionDenied(table: string, op: string): Promise<void> {
  try {
    const db = createServiceClient()
    const text = `⚠️ DB permission denied (42501) on ${table}.${op} — service_role missing GRANT. Check migration grants.`
    await Promise.all([
      db.from('agent_events').insert({
        domain: 'db_guard',
        action: 'permission_denied',
        status: 'error',
        output_summary: text,
        metadata: { table, op, pg_code: PG_PERMISSION_DENIED },
      }),
      db.from('outbound_notifications').insert({
        channel: 'telegram',
        payload: { text },
        correlation_id: `db_guard_42501_${table}_${op}_${Date.now()}`,
        requires_response: false,
      }),
    ])
  } catch {
    // Alert itself non-fatal — original error still propagates
  }
}

/**
 * Wrap a Supabase write operation (insert/update/delete) so that a
 * PostgreSQL 42501 permission-denied error fires a Telegram alert and logs
 * to agent_events. The original result is returned unchanged so callers can
 * still inspect the error.
 *
 * Usage:
 *   const { error } = await guardedWrite(
 *     db.from('harness_config').update({ value: x }).eq('key', k),
 *     'harness_config', 'update'
 *   )
 */
export async function guardedWrite<T>(
  query: PromiseLike<WriteResult<T>>,
  table: string,
  op: string,
): Promise<WriteResult<T>> {
  const result = await query
  if (result.error?.code === PG_PERMISSION_DENIED) {
    await alertPermissionDenied(table, op)
  }
  return result
}
