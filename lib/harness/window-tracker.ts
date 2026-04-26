import { createServiceClient } from '@/lib/supabase/service'

export interface WindowSession {
  session_id: string
  started_at: string
  last_heartbeat: string
  current_task: string | null
  status: 'active' | 'ended'
  metadata: Record<string, unknown>
}

export async function startWindowSession(
  sessionId: string,
  initialTask?: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const db = createServiceClient()
  await db.from('window_sessions').upsert(
    {
      session_id: sessionId,
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      current_task: initialTask ?? null,
      status: 'active',
      metadata,
    },
    { onConflict: 'session_id' }
  )
}

export async function heartbeatWindow(sessionId: string, currentTask: string): Promise<void> {
  const db = createServiceClient()
  await db
    .from('window_sessions')
    .update({
      last_heartbeat: new Date().toISOString(),
      current_task: currentTask,
      status: 'active',
    })
    .eq('session_id', sessionId)
}

export async function endWindowSession(sessionId: string): Promise<void> {
  const db = createServiceClient()
  await db
    .from('window_sessions')
    .update({ status: 'ended', last_heartbeat: new Date().toISOString() })
    .eq('session_id', sessionId)
}

export async function getActiveSessions(): Promise<WindowSession[]> {
  const db = createServiceClient()
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data, error } = await db
    .from('window_sessions')
    .select('*')
    .eq('status', 'active')
    .gte('last_heartbeat', staleThreshold)
    .order('started_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as WindowSession[]
}
