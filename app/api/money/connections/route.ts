import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isConnected } from '@/lib/quickbooks/client'

export const dynamic = 'force-dynamic'

export interface ConnectionStatus {
  id: string
  name: string
  status: 'connected' | 'disconnected' | 'pending'
  lastActivityAt: string | null
}

export interface ConnectionsResponse {
  connections: ConnectionStatus[]
  fetchedAt: string
}

async function getLastActivity(domain: string): Promise<string | null> {
  const db = createServiceClient()
  const { data } = await db
    .from('agent_events')
    .select('occurred_at')
    .eq('domain', domain)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.occurred_at as string | null) ?? null
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [qboConnected, amazonLast, gmailLast, telegramLast] = await Promise.all([
    isConnected(),
    getLastActivity('amazon'),
    getLastActivity('gmail'),
    getLastActivity('telegram'),
  ])

  const connections: ConnectionStatus[] = [
    {
      id: 'quickbooks',
      name: 'QuickBooks',
      status: qboConnected ? 'connected' : 'disconnected',
      lastActivityAt: null,
    },
    {
      id: 'amazon',
      name: 'Amazon',
      status: amazonLast ? 'connected' : 'disconnected',
      lastActivityAt: amazonLast,
    },
    {
      id: 'gmail',
      name: 'Gmail',
      status: gmailLast ? 'connected' : 'disconnected',
      lastActivityAt: gmailLast,
    },
    {
      id: 'telegram',
      name: 'Telegram',
      status: telegramLast ? 'connected' : 'disconnected',
      lastActivityAt: telegramLast,
    },
    {
      id: 'square',
      name: 'Square',
      status: 'pending',
      lastActivityAt: null,
    },
  ]

  return NextResponse.json({
    connections,
    fetchedAt: new Date().toISOString(),
  } satisfies ConnectionsResponse)
}
