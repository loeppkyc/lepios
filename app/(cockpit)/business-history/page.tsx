// F18: bench=milestones_load_latency<400ms; surface=business-history page views in morning_digest
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { BusinessHistoryClient } from './_components/BusinessHistoryClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Business History — LepiOS' }

export default async function BusinessHistoryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('business-history', 'page.viewed', { actor: 'user', status: 'success' })

  const { data: milestones } = await supabase
    .from('business_milestones')
    .select('*')
    .order('milestone_date', { ascending: false })

  return <BusinessHistoryClient initialMilestones={milestones ?? []} />
}
