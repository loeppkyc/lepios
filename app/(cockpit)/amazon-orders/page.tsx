// F18: bench=Seller Central orders count for same month/status; surface=order count KPI tile on page + CSV export for reconciliation
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AmazonOrdersClient } from './_components/AmazonOrdersClient'

export const metadata = { title: 'Amazon Orders — LepiOS' }

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // F18 metrics capture: log page view for F18 surfacing
  void supabase.from('agent_events').insert({
    domain: 'amazon',
    action: 'amazon_orders_viewed',
    actor: 'user',
    status: 'success',
    meta: { user_id: user.id },
  })

  return <AmazonOrdersClient />
}
