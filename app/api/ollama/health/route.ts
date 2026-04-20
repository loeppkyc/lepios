/**
 * GET /api/ollama/health
 *
 * Returns Ollama reachability status, available models, and latency.
 * Protected by session auth (cookie-based) — dashboard use only.
 *
 * Response shape:
 *   200 { reachable: true,  models: string[], latency_ms: number, tunnel_used: boolean }
 *   200 { reachable: false, models: [],       latency_ms: number, tunnel_used: boolean }
 *   401 { error: 'Unauthorized' }
 */

import { createClient } from '@/lib/supabase/server'
import { healthCheck } from '@/lib/ollama/client'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await healthCheck()
  return NextResponse.json(result)
}
