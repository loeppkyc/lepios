// F18: bench=QBO COGS accounts for same period (within 5%); surface=three stat tiles (this month/quarter/YTD) on page
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { InventorySpendClient } from './_components/InventorySpendClient'

export const metadata = { title: 'Inventory Spend — LepiOS' }

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // F18 metrics capture: log page view for F18 surfacing
  void supabase.from('agent_events').insert({
    domain: 'inventory',
    action: 'inventory_spend_viewed',
    actor: 'user',
    status: 'success',
    meta: { user_id: user.id },
  })

  return <InventorySpendClient />
}
