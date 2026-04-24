import { createServiceClient } from '@/lib/supabase/service'
import type { AttributionContext } from './types'

/**
 * Records one attribution row for an entity write event.
 *
 * Fire-and-forget contract:
 *   - Callers do NOT need to await success; attribution failure is non-fatal.
 *   - This function NEVER throws. All errors are caught, logged to agent_events,
 *     and discarded so the calling write path is unaffected.
 *   - Returns void in all cases.
 */
export async function recordAttribution(
  context: AttributionContext,
  entity: { type: string; id: string },
  action: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    const db = createServiceClient()

    await db.from('entity_attribution').insert({
      entity_type: entity.type,
      entity_id: entity.id,
      action,
      actor_type: context.actor_type,
      actor_id: context.actor_id ?? null,
      run_id: context.run_id ?? null,
      coordinator_session_id: context.coordinator_session_id ?? null,
      source_task_id: context.source_task_id ?? null,
      commit_sha: context.commit_sha ?? null,
      details: details ?? null,
    })
  } catch (err) {
    // Attribution failure is non-fatal — log and continue.
    // Do not re-throw under any circumstances.
    try {
      const db = createServiceClient()
      await db.from('agent_events').insert({
        domain: 'attribution',
        action: 'attribution.write_failed',
        actor: context.actor_type,
        status: 'error',
        task_type: 'attribution',
        output_summary: `attribution.write_failed for ${entity.type}/${entity.id} action=${action}`,
        meta: {
          entity_type: entity.type,
          entity_id: entity.id,
          action,
          actor_type: context.actor_type,
          error: err instanceof Error ? err.message : String(err),
        },
        tags: ['attribution', 'error'],
      })
    } catch {
      // Swallow error logging failure too — attribution must never propagate exceptions.
    }
  }
}
