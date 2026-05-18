// F18: bench=coupons_load_latency<400ms; surface=coupons page views in morning_digest
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { CouponsClient } from './_components/CouponsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Coupon Lady — LepiOS' }

export default async function CouponsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('coupons', 'page.viewed', { actor: 'user', status: 'success' })

  const { data: coupons } = await supabase
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false })

  return <CouponsClient initialCoupons={coupons ?? []} />
}
