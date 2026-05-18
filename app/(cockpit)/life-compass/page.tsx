// F18: bench=avg_life_balance_score vs prior month; surface=Life Compass KPI tile
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { LifeCompassClient } from './_components/LifeCompassClient'

export const metadata = { title: 'Life Compass -- LepiOS' }
export const dynamic = 'force-dynamic'

export default async function LifeCompassPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  void logEvent('life-compass', 'page.viewed', { actor: user.id, status: 'success', entity: 'life-compass' })
  return <LifeCompassClient />
}