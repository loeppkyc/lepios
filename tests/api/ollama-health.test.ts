// F21 acceptance skeleton — Cline fills in the bodies
// Route: app/api/ollama/health/route.ts
//
// Acceptance criteria:
//   1. Returns 401 { error: 'Unauthorized' } when no authenticated user
//   2. Returns 200 { reachable: true, models: string[], latency_ms: number, tunnel_used: boolean }
//      when healthCheck returns reachable: true
//   3. Returns 200 { reachable: false, models: [], latency_ms: number, tunnel_used: boolean }
//      when healthCheck returns reachable: false
//
// Mocks required:
//   - @/lib/supabase/server → createClient → auth.getUser()
//   - @/lib/ollama/client → healthCheck

import { describe, it, expect, vi } from 'vitest'
import { GET } from '@/app/api/ollama/health/route'

// TODO: Cline — fill in vi.mock blocks and test bodies per acceptance criteria above

describe('GET /api/ollama/health', () => {
  it('returns 401 when no authenticated user', async () => {
    // TODO
  })

  it('returns 200 with reachable:true shape when Ollama is up', async () => {
    // TODO
  })

  it('returns 200 with reachable:false when Ollama is unreachable', async () => {
    // TODO
  })
})
