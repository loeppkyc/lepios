// F18: bench=total_monthly_phone_cost vs prior month; surface=Phone Plans KPI tile (monthly total)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { PhonePlansClient } from './_components/PhonePlansClient'

export const metadata = { title: 'Phone Plans — LepiOS' }
export const dynamic = 'force-dynamic'

export default async function PhonePlansPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('phone-plans', 'page.viewed', {
    actor: user.id,
    status: 'success',
    entity: 'phone-plans',
  })

  return <PhonePlansClient />
}
