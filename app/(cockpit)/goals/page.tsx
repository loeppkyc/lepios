// F18: bench=habit_streak_days vs prior week; surface=Goals KPI tile (active streak)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { GoalsClient } from './_components/GoalsClient'

export const metadata = { title: 'Goals & Habits -- LepiOS' }
export const dynamic = 'force-dynamic'

export default async function GoalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  void logEvent('goals', 'page.viewed', { actor: user.id, status: 'success', entity: 'goals' })
  return <GoalsClient />
}