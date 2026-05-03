import { createServiceClient } from '@/lib/supabase/service'
import { cleanupSandbox, buildOrphanGcQuery } from './runtime'

export interface SandboxGcResult {
  swept: number
  errors: number
}

export async function runSandboxGc(): Promise<SandboxGcResult> {
  const db = createServiceClient()
  const { data: orphans } = await buildOrphanGcQuery(db)
  if (!orphans?.length) return { swept: 0, errors: 0 }

  let swept = 0
  let errors = 0
  for (const row of orphans) {
    try {
      await cleanupSandbox(row.id)
      swept++
    } catch {
      errors++
    }
  }
  return { swept, errors }
}
