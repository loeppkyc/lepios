// F18: bench=total_portfolio_balance vs prior month; surface=Retirement KPI tile (total balance)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { RetirementClient } from './_components/RetirementClient'

export const metadata = { title: 'Retirement — LepiOS' }
export const dynamic = 'force-dynamic'

export default async function RetirementPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('retirement', 'page.viewed', {
    actor: user.id,
    status: 'success',
    entity: 'retirement',
  })

  return <RetirementClient />
}
