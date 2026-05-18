// F18: bench=monthly_utility_total vs prior month; surface=Utilities KPI tile (monthly total)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { UtilitiesClient } from './_components/UtilitiesClient'

export const metadata = { title: 'Utilities — LepiOS' }
export const dynamic = 'force-dynamic'

export default async function UtilitiesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('utilities', 'page.viewed', {
    actor: user.id,
    status: 'success',
    entity: 'utilities',
  })

  return <UtilitiesClient />
}
