// F18: bench=deal_watch_load<500ms; surface=watch_targets row count + last alert age in morning_digest
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { DealWatchClient } from './_components/DealWatchClient'

export const metadata = { title: 'Deal Watch — LepiOS' }

export default async function Page() {
  const supabase = await createClient()

  void logEvent('deal-watch', 'page.viewed', { actor: 'user', status: 'success' })

  const [{ data: targets }, { data: events }] = await Promise.all([
    supabase.from('watch_targets').select('*').order('created_at', { ascending: false }),
    supabase
      .from('watch_events')
      .select('*, watch_targets(name)')
      .order('occurred_at', { ascending: false })
      .limit(20),
  ])

  return <DealWatchClient initialTargets={targets ?? []} initialEvents={events ?? []} />
}
