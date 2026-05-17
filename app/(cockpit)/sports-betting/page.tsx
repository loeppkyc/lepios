// F18: bench=bets_log_latency<300ms; surface=sports-betting P&L KPI + morning_digest bets_won_rate
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { SportsBettingPage } from './_components/SportsBettingPage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sports Betting — LepiOS' }

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('sports-betting', 'page.viewed', { actor: 'user', status: 'success' })

  const { data: recentBets } = await supabase
    .from('bets')
    .select('*')
    .order('bet_date', { ascending: false })
    .limit(50)

  return <SportsBettingPage initialBets={recentBets ?? []} />
}
