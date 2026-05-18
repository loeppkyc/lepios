// F18: bench=total_earned_ytd vs prior year; surface=Cashback HQ KPI tile (YTD earned)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { CashbackClient } from './_components/CashbackClient'

export const metadata = { title: 'Cashback HQ — LepiOS' }
export const dynamic = 'force-dynamic'

export default async function CashbackHQPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('cashback-hq', 'page.viewed', {
    actor: user.id,
    status: 'success',
    entity: 'cashback-hq',
  })

  return <CashbackClient />
}
