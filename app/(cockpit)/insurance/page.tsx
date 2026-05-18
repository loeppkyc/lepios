// F18: bench=total_annual_premium vs prior month; surface=Insurance KPI tile (premium total)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { InsuranceClient } from './_components/InsuranceClient'

export const metadata = { title: 'Insurance — LepiOS' }
export const dynamic = 'force-dynamic'

export default async function InsurancePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('insurance', 'page.viewed', {
    actor: user.id,
    status: 'success',
    entity: 'insurance',
  })

  return <InsuranceClient />
}
