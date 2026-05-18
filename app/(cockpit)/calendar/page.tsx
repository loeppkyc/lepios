// F18: bench=notes_per_month vs prior month; surface=Calendar KPI tile
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { CalendarClient } from './_components/CalendarClient'

export const metadata = { title: 'Calendar -- LepiOS' }
export const dynamic = 'force-dynamic'

export default async function CalendarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  void logEvent('calendar', 'page.viewed', { actor: user.id, status: 'success', entity: 'calendar' })
  return <CalendarClient />
}