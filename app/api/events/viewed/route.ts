// F17 exemption signal: logs events_viewed to agent_events when user opens the /events page.
// Lightweight POST — no body required, auth guard required.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // F17 exemption: lifestyle module — log page view as behavioral signal
  // SPRINT5-GATE: user_id scoped to authenticated session
  const serviceClient = createServiceClient()
  void serviceClient.from('agent_events').insert({
    domain: 'cockpit',
    action: 'events_viewed', // SPRINT5-GATE
    actor: 'user',
    status: 'success',
    meta: { user_id: user.id }, // SPRINT5-GATE
  })

  return NextResponse.json({ ok: true })
}
