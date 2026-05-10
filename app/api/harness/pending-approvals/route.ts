import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// Read-only, non-sensitive endpoint — returns pending approval notifications
// older than 5 minutes so the cockpit banner can surface stuck approvals.
// No auth required: data is notification summaries only, no secrets.
export async function GET() {
  const supabase = createServiceClient()
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('outbound_notifications')
    .select('id, payload, created_at, attempts, last_error')
    .eq('requires_response', true)
    .eq('status', 'pending')
    .lt('created_at', fiveMinAgo)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ notifications: data ?? [] })
}
