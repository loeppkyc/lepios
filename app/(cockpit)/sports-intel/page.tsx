// F18: bench=Streamlit_sports_betting odds_fetch_latency<2s; surface=agent_events sports-intel.coach + morning_digest picks_logged count
// Chunk B: Full rebuild — Elo overlay, auto-settlement, gate dashboard
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { SportsIntelPage as SportsIntelPageComponent } from './_components/SportsIntelPage'

export const dynamic = 'force-dynamic'

export default async function SportsIntelPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  void logEvent('sports-intel', 'page.viewed', { actor: 'user', status: 'success' })
  return <SportsIntelPageComponent />
}
