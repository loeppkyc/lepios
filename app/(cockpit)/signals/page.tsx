// F18: bench=signals_load<500ms; surface=signals grid card statuses in morning_digest
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { SignalsPage } from './_components/SignalsPage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Life Signals — LepiOS' }

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('signals', 'page.viewed', { actor: 'user', status: 'success' })

  // eslint-disable-next-line react-hooks/purity -- server component, not a hook
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [{ data: oura }, { data: moods }, { data: weather }, { data: trades }, { data: bets }] =
    await Promise.all([
      supabase
        .from('oura_daily')
        .select('date,sleep_score,readiness_score,activity_score,hrv,resting_hr,steps')
        .gte('date', since)
        .order('date', { ascending: true }),
      supabase
        .from('mood_log')
        .select('logged_at,energy,focus,notes')
        .gte('logged_at', since)
        .order('logged_at', { ascending: true }),
      supabase
        .from('weather_log')
        .select('recorded_at,temp_c,feels_like_c,condition,humidity')
        .gte('recorded_at', since)
        .order('recorded_at', { ascending: true }),
      supabase
        .from('trades')
        .select('trade_date,dollar_pnl,direction,ticker,mode')
        .gte('trade_date', since)
        .not('dollar_pnl', 'is', null)
        .order('trade_date', { ascending: true }),
      supabase
        .from('bets')
        .select('bet_date,pnl,result,sport,stake')
        .gte('bet_date', since)
        .not('pnl', 'is', null)
        .order('bet_date', { ascending: true }),
    ])

  return (
    <SignalsPage
      oura={oura ?? []}
      moods={moods ?? []}
      weather={weather ?? []}
      trades={trades ?? []}
      bets={bets ?? []}
    />
  )
}
